"use client";

import { useState } from "react";
import { Hash, Lock, MessageSquare } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { useCreateChannel } from "@multica/core/channels/mutations";
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

  const createChannel = useCreateChannel();

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

          {/* Name input */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Channel Name</label>
            <div className="relative">
              {type !== "dm" && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">#</span>
              )}
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={type === "dm" ? "Username or email" : "channel-name"}
                className={type !== "dm" ? "pl-7" : ""}
              />
            </div>
          </div>

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
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
