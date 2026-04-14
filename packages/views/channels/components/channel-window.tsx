"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Hash, Users, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@multica/ui/components/ui/avatar";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { ScrollArea } from "@multica/ui/components/ui/scroll-area";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import {
  channelOptions,
  channelMessagesOptions,
  channelMembersOptions,
  channelKeys,
} from "@multica/core/channels/queries";
import { useSendChannelMessage } from "@multica/core/channels/mutations";
import { useWSEvent } from "@multica/core/realtime";
import type { ChannelMessage } from "@multica/core/types";

interface ChannelWindowProps {
  channelId: string | null;
  onClose?: () => void;
}

export function ChannelWindow({ channelId, onClose }: ChannelWindowProps) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [messageInput, setMessageInput] = useState("");

  const { data: channel } = useQuery(channelOptions(wsId, channelId ?? ""));
  const { data: members = [] } = useQuery(
    channelMembersOptions(channelId ?? ""),
  );
  const { data: messages = [] } = useQuery(
    channelMessagesOptions(channelId ?? ""),
  );

  const sendMessage = useSendChannelMessage();

  // WS event handler for new messages
  useWSEvent(
    "channel:message_new",
    useCallback(
      (payload: unknown) => {
        const p = payload as { channel_id: string; message: ChannelMessage };
        if (p.channel_id === channelId) {
          qc.setQueryData<ChannelMessage[]>(
            channelKeys.messages(channelId ?? ""),
            (old) => {
              if (!old) return old;
              if (old.some((m) => m.id === p.message.id)) return old;
              return [p.message, ...old];
            },
          );
        }
      },
      [channelId, qc],
    ),
  );

  const handleSend = useCallback(async () => {
    if (!channelId || !messageInput.trim()) return;

    const content = JSON.stringify({
      type: "text",
      text: messageInput.trim(),
    });

    await sendMessage.mutateAsync({
      channelId,
      data: { content: JSON.parse(content) },
    });

    setMessageInput("");
  }, [channelId, messageInput, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!channelId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <Hash className="size-12 mx-auto mb-2 opacity-50" />
          <p>Select a channel to view messages</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Loading channel...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Hash className="size-5 text-muted-foreground" />
          <span className="font-semibold">{channel.name}</span>
          {channel.topic && (
            <span className="text-sm text-muted-foreground">
              — {channel.topic}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-2">
            <Users className="size-4" />
            {members.length}
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No messages yet. Start the conversation!
            </p>
          ) : (
            messages.map((message) => {
              const isOwnMessage = message.author_id === user?.id;
              const isAgent = message.author_type === "agent";

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}
                >
                  <Avatar className="size-8">
                    <AvatarImage />
                    <AvatarFallback className={isAgent ? "bg-purple-100" : ""}>
                      {isAgent ? (
                        <span className="text-xs">AG</span>
                      ) : (
                        <span className="text-xs">
                          {message.author_id.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={`flex flex-col gap-1 max-w-[70%] ${
                      isOwnMessage ? "items-end" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {message.author_type === "agent"
                          ? "Agent"
                          : message.author_id.slice(0, 8)}
                      </span>
                      <span>
                        {new Date(message.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div
                      className={`rounded-lg px-3 py-2 text-sm ${
                        isAgent
                          ? "bg-purple-50 text-purple-900"
                          : isOwnMessage
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                      }`}
                    >
                      {typeof message.content === "string"
                        ? message.content
                        : JSON.stringify(message.content)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            placeholder={`Message #${channel.name}`}
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={!messageInput.trim()}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
