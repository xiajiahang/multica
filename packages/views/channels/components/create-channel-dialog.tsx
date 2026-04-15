"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Hash, Lock, MessageSquare, Search } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Avatar, AvatarFallback } from "@multica/ui/components/ui/avatar";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions, agentListOptions } from "@multica/core/workspace/queries";
import { useCreateChannel, useCreateOrGetDM } from "@multica/core/channels/mutations";
import type { CreateChannelRequest } from "@multica/core/types";

interface CreateChannelDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (channelId: string) => void;
}

const CHANNEL_TYPES: { type: CreateChannelRequest["type"]; label: string; icon: React.ElementType }[] = [
  { type: "public", label: "Public", icon: Hash },
  { type: "private", label: "Private", icon: Lock },
  { type: "dm", label: "Direct Message", icon: MessageSquare },
];

export function CreateChannelDialog({ open, onClose, onSuccess }: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<CreateChannelRequest["type"]>("public");
  const [submitting, setSubmitting] = useState(false);
  const [dmSearch, setDmSearch] = useState("");

  const wsId = useWorkspaceId();
  const createChannel = useCreateChannel();
  const createOrGetDM = useCreateOrGetDM();

  const { data: workspaceMembers = [] } = useQuery(memberListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const handleDMSelect = async (memberType: "user" | "agent", memberId: string, memberName: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const channel = await createOrGetDM.mutateAsync({
        other_member_type: memberType,
        other_member_id: memberId,
      });
      setName("");
      setTopic("");
      setType("public");
      setDmSearch("");
      onSuccess?.(channel.id);
      onClose();
      toast.success(`DM with ${memberName}`);
    } catch {
      toast.error("Failed to create DM");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const channel = await createChannel.mutateAsync({
        name: name.trim(),
        type,
        topic: topic.trim() || undefined,
      });
      setName("");
      setTopic("");
      setType("public");
      onSuccess?.(channel.id);
      onClose();
      toast.success(`Channel #${channel.name} created`);
    } catch {
      toast.error("Failed to create channel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[425px] p-0 gap-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Create Channel</DialogTitle>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="font-semibold">Create Channel</span>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4">
          {/* Channel type selector */}
          <div className="flex gap-2">
            {CHANNEL_TYPES.map(({ type: t, label, icon: Icon }) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors",
                  type === t
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Name/DM input */}
          {type === "dm" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Start a conversation with</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={dmSearch}
                  onChange={(e) => setDmSearch(e.target.value)}
                  placeholder="Search members or agents..."
                  className="pl-9"
                />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {agents
                  .filter((a) => !a.archived_at)
                  .filter((a) => !dmSearch || a.name.toLowerCase().includes(dmSearch.toLowerCase()))
                  .map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleDMSelect("agent", agent.id, agent.name)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
                    >
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-purple-100 text-purple-700 text-xs">
                          <Bot className="size-3" />
                        </AvatarFallback>
                      </Avatar>
                      <span>{agent.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Agent</span>
                    </button>
                  ))}
                {workspaceMembers
                  .filter((m) => !dmSearch || (m.name ?? "").toLowerCase().includes(dmSearch.toLowerCase()))
                  .map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onClick={() => handleDMSelect("user", m.user_id, m.name ?? "Unknown")}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
                    >
                      <Avatar className="size-6">
                        <AvatarFallback className="text-xs">
                          {(m.name ?? "U").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span>{m.name ?? "Unknown"}</span>
                    </button>
                  ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Channel Name</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">#</span>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="channel-name"
                  className="pl-7"
                />
              </div>
            </div>
          )}

          {/* Topic input */}
          {type !== "dm" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Topic (optional)</label>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="What's this channel about?"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {type !== "dm" && (
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || submitting}
            >
              {submitting ? "Creating..." : "Create Channel"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
