"use client";

import { useQuery } from "@tanstack/react-query";
import { Hash, Lock, MessageSquare } from "lucide-react";
import { useWorkspaceId } from "@multica/core/hooks";
import { listChannelsOptions } from "@multica/core/channels/queries";
import type { Channel } from "@multica/core/types";

interface ChannelListProps {
  selectedChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onCreateChannel?: () => void;
}

export function ChannelList({
  selectedChannelId,
  onSelectChannel,
  onCreateChannel,
}: ChannelListProps) {
  const wsId = useWorkspaceId();
  const { data: channels = [] } = useQuery(listChannelsOptions(wsId));
  const publicChannels = channels.filter(c => c.type !== "dm");
  const dmChannels = channels.filter(c => c.type === "dm");

  const getChannelIcon = (type: Channel["type"]) => {
    switch (type) {
      case "dm":
        return <MessageSquare className="size-4" />;
      case "private":
        return <Lock className="size-4" />;
      default:
        return <Hash className="size-4" />;
    }
  };

  const formatLastMessage = (channel: Channel) => {
    if (!channel.last_message_at) return "No messages yet";
    const date = new Date(channel.last_message_at);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold">Channels</h2>
        {onCreateChannel && (
          <button
            onClick={onCreateChannel}
            className="text-muted-foreground hover:text-foreground"
            title="Create channel"
          >
            <span className="text-lg">+</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {channels.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            No channels yet
          </div>
        ) : (
          <>
            {/* Channels section */}
            {publicChannels.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1 text-xs text-muted-foreground font-medium">
                  Channels
                </div>
                {publicChannels.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => onSelectChannel(channel.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors ${
                      selectedChannelId === channel.id ? "bg-muted" : ""
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {getChannelIcon(channel.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`truncate ${channel.unread_count ? "font-semibold" : "font-medium"}`}>{channel.name}</span>
                    </div>
                    {channel.unread_count ? (
                      <span className="ml-auto size-2 rounded-full bg-primary flex-shrink-0" />
                    ) : (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatLastMessage(channel)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {/* DM section */}
            {dmChannels.length > 0 && (
              <div className="border-t py-2">
                <div className="px-4 py-1 text-xs text-muted-foreground font-medium">
                  Direct Messages
                </div>
                {dmChannels.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => onSelectChannel(channel.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 transition-colors ${
                      selectedChannelId === channel.id ? "bg-muted" : ""
                    }`}
                  >
                    <span className="text-muted-foreground">
                      {getChannelIcon(channel.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={`truncate ${channel.unread_count ? "font-semibold" : "font-medium"}`}>{channel.name}</span>
                    </div>
                    {channel.unread_count ? (
                      <span className="ml-auto size-2 rounded-full bg-primary flex-shrink-0" />
                    ) : (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {formatLastMessage(channel)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
