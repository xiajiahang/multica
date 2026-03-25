"use client";

import { useState, useEffect, useMemo } from "react";
import { useInboxStore } from "@/features/inbox";
import { toast } from "sonner";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  ArrowRightLeft,
} from "lucide-react";
import type { InboxItem, InboxItemType, InboxSeverity } from "@multica/types";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/shared/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityOrder: Record<InboxSeverity, number> = {
  action_required: 0,
  attention: 1,
  info: 2,
};

const typeIcons: Record<InboxItemType, typeof AlertCircle> = {
  agent_blocked: AlertCircle,
  review_requested: GitPullRequest,
  issue_assigned: CircleDot,
  agent_completed: CheckCircle2,
  mentioned: MessageSquare,
  status_change: ArrowRightLeft,
};

const severityColors: Record<InboxSeverity, string> = {
  action_required: "text-destructive",
  attention: "text-warning",
  info: "text-muted-foreground",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function InboxListItem({
  item,
  isSelected,
  onClick,
}: {
  item: InboxItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = typeIcons[item.type] ?? CircleDot;
  const colorClass = severityColors[item.severity];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      } ${!item.read ? "font-medium" : ""}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{item.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(item.created_at)}
          </span>
        </div>
        {(item.type === "agent_blocked" || item.type === "review_requested") && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <Bot className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Agent action</span>
          </div>
        )}
      </div>
      {!item.read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

function InboxDetail({
  item,
  onMarkRead,
  onArchive,
}: {
  item: InboxItem;
  onMarkRead: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const Icon = typeIcons[item.type] ?? CircleDot;
  const colorClass = severityColors[item.severity];

  const severityLabel: Record<InboxSeverity, string> = {
    action_required: "Action required",
    attention: "Needs attention",
    info: "Info",
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={`mt-1 h-5 w-5 shrink-0 ${colorClass}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold truncate">{item.title}</h2>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className={colorClass}>{severityLabel[item.severity]}</span>
            <span>·</span>
            <span>{timeAgo(item.created_at)}</span>
          </div>
        </div>
        {!item.read && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onMarkRead(item.id)}
            className="shrink-0"
          >
            Mark read
          </Button>
        )}
        {item.issue_id && (
          <Link
            href={`/issues/${item.issue_id}`}
            className="inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            View Issue
          </Link>
        )}
        <Button
          variant="outline"
          size="xs"
          onClick={() => onArchive(item.id)}
          className="shrink-0"
        >
          Archive
        </Button>
      </div>

      {/* Body */}
      {item.body && (
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
          {item.body}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string>("");

  // Read from global store (populated by workspace hydrate + useRealtimeSync)
  const storeItems = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);

  // Sort: severity first, then newest first
  const items = useMemo(() => {
    return [...storeItems]
      .filter((i) => !i.archived)
      .sort(
        (a, b) =>
          severityOrder[a.severity] - severityOrder[b.severity] ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [storeItems]);

  // Auto-select first item when items change
  useEffect(() => {
    if (items.length > 0 && !selectedId) {
      setSelectedId(items[0]!.id);
    }
  }, [items, selectedId]);

  const handleMarkRead = async (id: string) => {
    try {
      await api.markInboxRead(id);
      useInboxStore.getState().markRead(id);
    } catch (err) {
      toast.error("Failed to mark as read");
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await api.archiveInbox(id);
      useInboxStore.getState().archive(id);
      // If archived item was selected, clear selection
      if (selectedId === id) {
        setSelectedId("");
      }
    } catch (err) {
      toast.error("Failed to archive");
    }
  };

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const unreadCount = items.filter((i) => !i.read).length;

  if (loading) {
    return (
      <div className="flex flex-1 min-h-0">
        <div className="w-80 shrink-0 border-r">
          <div className="flex h-12 items-center border-b px-4">
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4 shrink-0 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-4 h-4 w-32" />
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left column — inbox list */}
      <div className="w-80 shrink-0 overflow-y-auto border-r">
        <div className="flex h-12 items-center border-b px-4">
          <h1 className="text-sm font-semibold">Inbox</h1>
          {unreadCount > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
            <p>No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <InboxListItem
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right column — detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <InboxDetail item={selected} onMarkRead={handleMarkRead} onArchive={handleArchive} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {items.length === 0
              ? "Your inbox is empty"
              : "Select an item to view details"}
          </div>
        )}
      </div>
    </div>
  );
}
