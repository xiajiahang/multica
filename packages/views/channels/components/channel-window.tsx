"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hash, Loader2, Send, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@multica/ui/components/ui/avatar";
import { Button } from "@multica/ui/components/ui/button";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import {
  channelOptions,
  channelMembersOptions,
  channelMessagesOptions,
  channelKeys,
} from "@multica/core/channels/queries";
import { agentListOptions } from "@multica/core/workspace/queries";
import { memberListOptions } from "@multica/core/workspace/queries";
import { useMarkChannelRead, useSendChannelMessage } from "@multica/core/channels/mutations";
import { useWS, useWSEvent } from "@multica/core/realtime";
import type { ChannelMessage, TaskMessagePayload } from "@multica/core/types";
import { tiptapJsonToPlainText } from "../utils/message-content";
import { ContentEditor, type ContentEditorRef } from "../../editor";
import { MemberPopover } from "./member-popover";

interface ChannelWindowProps {
  channelId: string | null;
  onClose?: () => void;
}

export function ChannelWindow({ channelId, onClose }: ChannelWindowProps) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const editorRef = useRef<ContentEditorRef>(null);

  const { data: channel } = useQuery(channelOptions(wsId, channelId ?? ""));
  const { data: channelMembers = [] } = useQuery(
    channelMembersOptions(channelId ?? ""),
  );
  const { data: messages = [] } = useQuery(
    channelMessagesOptions(channelId ?? ""),
  );
  const { data: agents = [] } = useQuery(agentListOptions(wsId ?? ""));
  const { data: members = [] } = useQuery(memberListOptions(wsId ?? ""));

  const sendMessage = useSendChannelMessage();
  const markChannelRead = useMarkChannelRead();

  // Build lookup maps for author names
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const memberMap = new Map(members.map((m) => [m.user_id, m]));

  const getAuthorDisplayName = useCallback(
    (authorType: string, authorId: string, isOwnMessage: boolean) => {
      if (isOwnMessage) {
        return user?.name ?? "You";
      }
      if (authorType === "agent") {
        const agent = agentMap.get(authorId);
        return agent?.name ?? "Agent";
      }
      const member = memberMap.get(authorId);
      return member?.name ?? authorId.slice(0, 8);
    },
    [agentMap, memberMap, user],
  );

  const getAuthorAvatar = useCallback(
    (authorType: string, authorId: string) => {
      if (authorType === "agent") {
        return agentMap.get(authorId)?.avatar_url ?? null;
      }
      const member = memberMap.get(authorId);
      return member?.avatar_url ?? null;
    },
    [agentMap, memberMap],
  );

  const mentionScope = {
    memberIds: channelMembers
      .filter((member) => member.member_type === "user")
      .map((member) => members.find((workspaceMember) => workspaceMember.id === member.member_id)?.user_id)
      .filter((id): id is string => !!id),
    agentIds: channelMembers
      .filter((member) => member.member_type === "agent")
      .map((member) => member.member_id),
    includeAll: false,
    includeIssues: true,
  };

  const { subscribe } = useWS();
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [pendingTaskAgentName, setPendingTaskAgentName] = useState<string | null>(null);
  const pendingTaskRef = useRef<string | null>(null);

  // Scroll to bottom ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Scroll to bottom when messages first load
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(scrollToBottom, 100);
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (!channelId) return;
    void markChannelRead.mutateAsync(channelId).catch(() => undefined);
  }, [channelId, markChannelRead]);

  // Subscribe to task streaming events for agent responses
  useEffect(() => {
    if (!channelId) return;

    const matchesPending = (taskId: string) =>
      !!pendingTaskRef.current && taskId === pendingTaskRef.current;

    const finalizePending = (invalidateCache: boolean) => {
      if (invalidateCache && channelId) {
        qc.invalidateQueries({ queryKey: channelKeys.messages(channelId) });
      }
      setStreamingContent(null);
      setPendingTaskAgentName(null);
      pendingTaskRef.current = null;
      // Scroll to bottom after agent response is complete
      setTimeout(scrollToBottom, 100);
    };

    const unsubMessage = subscribe("task:message", (payload) => {
      const p = payload as TaskMessagePayload;
      if (!matchesPending(p.task_id)) return;
      if (p.type === "text" && p.content) {
        setStreamingContent((prev) => (prev ?? "") + p.content);
      }
    });

    const unsubCompleted = subscribe("task:completed", (payload) => {
      const p = payload as { task_id: string };
      if (!matchesPending(p.task_id)) return;
      finalizePending(true);
    });

    const unsubFailed = subscribe("task:failed", (payload) => {
      const p = payload as { task_id: string };
      if (!matchesPending(p.task_id)) return;
      finalizePending(false);
    });

    return () => {
      unsubMessage();
      unsubCompleted();
      unsubFailed();
    };
  }, [channelId, qc, subscribe, scrollToBottom]);

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
              return [...old, p.message];
            },
          );
          // Scroll to bottom after state update
          setTimeout(scrollToBottom, 100);
        }
      },
      [channelId, qc, scrollToBottom],
    ),
  );

  const handleSend = useCallback(async () => {
    if (!channelId || !editorRef.current) return;
    const json = editorRef.current.getJSON();
    if (!json) return;

    // Extract agent_id from mention in message content
    let mentionedAgentId: string | null = null;
    const findMention = (node: unknown): string | null => {
      if (!node || typeof node !== "object") return null;
      const n = node as Record<string, unknown>;
      if (n.type === "mention" && n.attrs) {
        const attrs = n.attrs as Record<string, unknown>;
        if (attrs.type === "agent" && typeof attrs.id === "string") {
          return attrs.id;
        }
      }
      if (Array.isArray(n.content)) {
        for (const child of n.content) {
          const found = findMention(child);
          if (found) return found;
        }
      }
      return null;
    };
    mentionedAgentId = findMention(json);

    const result = await sendMessage.mutateAsync({
      channelId,
      data: { content: json },
    });

    editorRef.current.clearContent();
    editorRef.current.focus();

    // Track task for streaming agent responses
    if (result.task_id) {
      pendingTaskRef.current = result.task_id;
      // Set agent name for streaming display
      if (mentionedAgentId) {
        const agent = agentMap.get(mentionedAgentId);
        setPendingTaskAgentName(agent?.name ?? "Agent");
      } else {
        setPendingTaskAgentName("Agent");
      }
    }
  }, [channelId, sendMessage, agentMap]);

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Hash className="size-12 mx-auto mb-2 opacity-50" />
          <p>Select a channel to view messages</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Loading channel...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background border-l">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
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
          <MemberPopover channelId={channelId} />
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No messages yet. Start the conversation!
            </p>
          ) : (
            // Display in chronological order (oldest first, newest last)
            [...messages].reverse().map((message) => {
              const isOwnMessage = message.author_id === user?.id;
              const isAgent = message.author_type === "agent";
              const authorName = getAuthorDisplayName(
                message.author_type,
                message.author_id,
                isOwnMessage,
              );
              const authorAvatar = getAuthorAvatar(
                message.author_type,
                message.author_id,
              );

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${isOwnMessage ? "flex-row-reverse" : ""}`}
                >
                  <Avatar className="size-8">
                    <AvatarImage src={authorAvatar ?? undefined} />
                    <AvatarFallback className={isAgent ? "bg-purple-100" : ""}>
                      {isAgent ? (
                        <Bot className="size-4 text-purple-700" />
                      ) : (
                        <span className="text-xs">
                          {authorName.slice(0, 2).toUpperCase()}
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
                        {authorName}
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
                      {typeof message.content === "string" ? (
                        message.content
                      ) : (
                        <span className="whitespace-pre-wrap">
                          {tiptapJsonToPlainText(message.content)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Streaming agent response */}
          {streamingContent && (
            <div className="flex gap-3">
              <Avatar className="size-8">
                <AvatarFallback className="bg-purple-100">
                  <Bot className="size-4 text-purple-700" />
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1 max-w-[70%]">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {pendingTaskAgentName ?? "Agent"}
                  </span>
                  <Loader2 className="size-3 animate-spin" />
                </div>
                <div className="rounded-lg px-3 py-2 text-sm bg-purple-50 text-purple-900 whitespace-pre-wrap">
                  {streamingContent}
                </div>
              </div>
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t shrink-0">
        <div className="relative">
          <ContentEditor
            ref={editorRef}
            placeholder={`Message #${channel.name}`}
            onSubmit={handleSend}
            enterToSend
            mentionScope={mentionScope}
          />
          <Button
            variant="ghost"
            size="sm"
            className="absolute bottom-2 right-2"
            onClick={handleSend}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
