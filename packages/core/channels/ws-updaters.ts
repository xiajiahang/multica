import type { QueryClient } from "@tanstack/react-query";
import { channelKeys } from "./queries";
import type { Channel, ChannelMessage, ChannelMember } from "../types";

export function onChannelCreated(qc: QueryClient, wsId: string, channel: Channel) {
  qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) => {
    if (!old) return old;
    if (old.some((c) => c.id === channel.id)) return old;
    return [...old, channel];
  });
  qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
}

export function onChannelUpdated(
  qc: QueryClient,
  wsId: string,
  channel: Partial<Channel> & { id: string },
) {
  qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) => {
    if (!old) return old;
    return old.map((c) => (c.id === channel.id ? { ...c, ...channel } : c));
  });
  qc.setQueryData<Channel>(channelKeys.channel(wsId, channel.id), (old) =>
    old ? { ...old, ...channel } : old,
  );
  qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
}

export function onChannelDeleted(qc: QueryClient, wsId: string, channelId: string) {
  qc.setQueryData<Channel[]>(channelKeys.list(wsId), (old) => {
    if (!old) return old;
    return old.filter((c) => c.id !== channelId);
  });
  qc.removeQueries({ queryKey: channelKeys.channel(wsId, channelId) });
  qc.removeQueries({ queryKey: channelKeys.members(channelId) });
  qc.removeQueries({ queryKey: channelKeys.messages(channelId) });
  qc.removeQueries({ queryKey: channelKeys.issues(channelId) });
  qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
}

export function onChannelMessageNew(
  qc: QueryClient,
  channelId: string,
  message: ChannelMessage,
) {
  qc.setQueryData<ChannelMessage[]>(channelKeys.messages(channelId), (old) => {
    if (!old) return old;
    // Avoid duplicates
    if (old.some((m) => m.id === message.id)) return old;
    return [message, ...old];
  });
}

export function onChannelMessageEdited(
  qc: QueryClient,
  channelId: string,
  message: Partial<ChannelMessage> & { id: string },
) {
  qc.setQueryData<ChannelMessage[]>(channelKeys.messages(channelId), (old) => {
    if (!old) return old;
    return old.map((m) => (m.id === message.id ? { ...m, ...message } : m));
  });
}

export function onChannelMessageDeleted(qc: QueryClient, channelId: string, messageId: string) {
  qc.setQueryData<ChannelMessage[]>(channelKeys.messages(channelId), (old) => {
    if (!old) return old;
    return old.filter((m) => m.id !== messageId);
  });
}

export function onChannelMemberJoined(
  qc: QueryClient,
  channelId: string,
  member: ChannelMember,
) {
  qc.setQueryData<ChannelMember[]>(channelKeys.members(channelId), (old) => {
    if (!old) return old;
    if (old.some((m) => m.id === member.id)) return old;
    return [...old, member];
  });
}

export function onChannelMemberLeft(qc: QueryClient, channelId: string, memberId: string) {
  qc.setQueryData<ChannelMember[]>(channelKeys.members(channelId), (old) => {
    if (!old) return old;
    return old.filter((m) => m.id !== memberId);
  });
}

export function onChannelRead(qc: QueryClient, wsId: string, channelId: string) {
  // Invalidate channel to refresh last_message_at
  qc.invalidateQueries({ queryKey: channelKeys.channel(wsId, channelId) });
  qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
}
