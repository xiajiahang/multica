"use client";

import { useState, useCallback, useMemo } from "react";
import { useIssueStore } from "@/features/issues";
import { useModalStore } from "@/features/modals";
import { toast } from "sonner";
import Link from "next/link";
import {
  Columns3,
  List,
  Plus,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue, IssueStatus, IssuePriority } from "@multica/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, ALL_STATUSES, PRIORITY_ORDER, STATUS_ORDER } from "@/features/issues/config";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from "@/components/ui/select";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { StatusIcon, PriorityIcon } from "@/features/issues/components";
import { api } from "@/shared/api";
import { useActorName } from "@/features/workspace";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const BOARD_STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

// ---------------------------------------------------------------------------
// Board View — Card
// ---------------------------------------------------------------------------

function BoardCardContent({ issue }: { issue: Issue }) {
  const { getActorName, getActorInitials } = useActorName();
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.id.slice(0, 8)}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug">{issue.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {issue.assignee_type && issue.assignee_id && (
            <ActorAvatar
              actorType={issue.assignee_type}
              actorId={issue.assignee_id}
              size={20}
              getName={getActorName}
              getInitials={getActorInitials}
            />
          )}
        </div>
        {issue.due_date && (
          <span className="text-xs text-muted-foreground">
            {formatDate(issue.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable card wrapper
// ---------------------------------------------------------------------------

function DraggableBoardCard({ issue }: { issue: Issue }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { status: issue.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-30" : ""}
    >
      <Link
        href={`/issues/${issue.id}`}
        className={`block transition-colors hover:opacity-80 ${isDragging ? "pointer-events-none" : ""}`}
      >
        <BoardCardContent issue={issue} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable column
// ---------------------------------------------------------------------------

function DroppableColumn({
  status,
  issues,
}: {
  status: IssueStatus;
  issues: Issue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex min-w-52 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{cfg.label}</span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[200px] flex-1 space-y-1.5 overflow-y-auto rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent/40" : ""
        }`}
      >
        {issues.map((issue) => (
          <DraggableBoardCard key={issue.id} issue={issue} />
        ))}
        {issues.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">No issues</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board View (with DnD)
// ---------------------------------------------------------------------------

function BoardView({
  issues,
  onMoveIssue,
}: {
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const visibleStatuses = BOARD_STATUSES;

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const issue = issues.find((i) => i.id === event.active.id);
      if (issue) setActiveIssue(issue);
    },
    [issues]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveIssue(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = active.id as string;
      let targetStatus: IssueStatus | undefined;

      if (visibleStatuses.includes(over.id as IssueStatus)) {
        targetStatus = over.id as IssueStatus;
      } else {
        const targetIssue = issues.find((i) => i.id === over.id);
        if (targetIssue) targetStatus = targetIssue.status;
      }

      if (targetStatus) {
        const currentIssue = issues.find((i) => i.id === issueId);
        if (currentIssue && currentIssue.status !== targetStatus) {
          onMoveIssue(issueId, targetStatus);
        }
      }
    },
    [issues, onMoveIssue, visibleStatuses]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-1 min-h-0 gap-3 overflow-x-auto p-4">
        {visibleStatuses.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            issues={issues.filter((i) => i.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? (
          <div className="w-64 rotate-2 opacity-90 shadow-lg">
            <BoardCardContent issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function ListRow({ issue }: { issue: Issue }) {
  const { getActorName, getActorInitials } = useActorName();
  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex h-9 items-center gap-2 px-4 text-[13px] transition-colors hover:bg-accent/50"
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {issue.id.slice(0, 8)}
      </span>
      <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.due_date && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(issue.due_date)}
        </span>
      )}
      {issue.assignee_type && issue.assignee_id && (
        <ActorAvatar
          actorType={issue.assignee_type}
          actorId={issue.assignee_id}
          size={20}
          getName={getActorName}
          getInitials={getActorInitials}
        />
      )}
    </Link>
  );
}

function ListView({ issues }: { issues: Issue[] }) {
  const groupOrder = STATUS_ORDER.filter((s) => s !== "cancelled");

  return (
    <div className="overflow-y-auto">
      {groupOrder.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const filtered = issues.filter((i) => i.status === status);
        if (filtered.length === 0) return null;
        return (
          <div key={status}>
            <div className="flex h-8 items-center gap-2 border-b px-4">
              <StatusIcon status={status} className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">{filtered.length}</span>
            </div>
            {filtered.map((issue) => (
              <ListRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Issue Dialog
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ViewMode = "board" | "list";

export default function IssuesPage() {
  const [view, setView] = useState<ViewMode>("board");
  const [filterStatus, setFilterStatus] = useState<IssueStatus | "">("");
  const [filterPriority, setFilterPriority] = useState<IssuePriority | "">("");

  // Read from global store (populated by workspace hydrate + useRealtimeSync)
  const allIssues = useIssueStore((s) => s.issues);
  const loading = useIssueStore((s) => s.loading);

  // Apply local filters
  const issues = useMemo(() => {
    return allIssues.filter((issue) => {
      if (filterStatus && issue.status !== filterStatus) return false;
      if (filterPriority && issue.priority !== filterPriority) return false;
      return true;
    });
  }, [allIssues, filterStatus, filterPriority]);

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus) => {
      // Optimistic update in store
      useIssueStore.getState().updateIssue(issueId, { status: newStatus });

      // Persist to API
      api.updateIssue(issueId, { status: newStatus }).catch((err) => {
        toast.error("Failed to move issue");
        // Revert on error by refetching
        api.listIssues({ limit: 200 }).then((res) => {
          useIssueStore.getState().setIssues(res.issues);
        });
      });
    },
    []
  );

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex min-w-52 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">All Issues</h1>
          <div className="ml-2 flex items-center rounded-md border p-0.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setView("board")}
              className={
                view === "board"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              <Columns3 className="h-3 w-3" />
              Board
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setView("list")}
              className={
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              <List className="h-3 w-3" />
              List
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterStatus || undefined} onValueChange={(v) => setFilterStatus((v ?? "") as IssueStatus | "")}>
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">All Status</SelectItem>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={filterPriority || undefined} onValueChange={(v) => setFilterPriority((v ?? "") as IssuePriority | "")}>
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue placeholder="All Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">All Priority</SelectItem>
                  {PRIORITY_ORDER.map((p) => (
                    <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => useModalStore.getState().open("create-issue")}>
          <Plus className="h-3.5 w-3.5" />
          New Issue
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        {issues.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>No matching issues</p>
            {(filterStatus || filterPriority) && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => { setFilterStatus(""); setFilterPriority(""); }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : view === "board" ? (
          <BoardView issues={issues} onMoveIssue={handleMoveIssue} />
        ) : (
          <ListView issues={issues} />
        )}
      </div>
    </div>
  );
}
