"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { IssueStatus, IssuePriority, IssueAssigneeType } from "@multica/types";
import { STATUS_CONFIG, ALL_STATUSES, PRIORITY_CONFIG, PRIORITY_ORDER } from "@/features/issues/config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { StatusIcon, PriorityIcon, AssigneePicker } from "@/features/issues/components";
import { useIssueStore } from "@/features/issues";
import { api } from "@/shared/api";

export function CreateIssueModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [submitting, setSubmitting] = useState(false);
  const [assigneeType, setAssigneeType] = useState<IssueAssigneeType | undefined>();
  const [assigneeId, setAssigneeId] = useState<string | undefined>();

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const issue = await api.createIssue({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
        assignee_type: assigneeType,
        assignee_id: assigneeId,
      });
      useIssueStore.getState().addIssue(issue);
      onClose();
    } catch {
      toast.error("Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
          <DialogDescription className="sr-only">Create a new issue for the workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Issue title"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
            rows={3}
            className="resize-none"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
              <SelectTrigger size="sm" className="text-xs">
                <StatusIcon status={status} className="h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
              <SelectTrigger size="sm" className="text-xs">
                <PriorityIcon priority={priority} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AssigneePicker
              assigneeType={assigneeType ?? null}
              assigneeId={assigneeId ?? null}
              onUpdate={(updates) => {
                setAssigneeType(updates.assignee_type ?? undefined);
                setAssigneeId(updates.assignee_id ?? undefined);
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create Issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
