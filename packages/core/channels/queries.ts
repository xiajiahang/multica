import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

// NOTE on workspace scoping:
// `wsId` is used only as part of queryKey for cache isolation per workspace.
// The actual workspace context comes from ApiClient's X-Workspace-ID header.

export const channelKeys = {
  all: (wsId: string) => ["channels", wsId] as const,
  list: (wsId: string) => [...channelKeys.all(wsId), "list"] as const,
  channel: (wsId: string, id: string) => [...channelKeys.all(wsId), "channel", id] as const,
  members: (channelId: string) => ["channels", "members", channelId] as const,
  messages: (channelId: string) => ["channels", "messages", channelId] as const,
  issues: (channelId: string) => ["channels", "issues", channelId] as const,
};

export function listChannelsOptions(wsId: string) {
  return queryOptions({
    queryKey: channelKeys.list(wsId),
    queryFn: () => api.listChannels(),
    staleTime: Infinity,
  });
}

export function channelOptions(wsId: string, id: string) {
  return queryOptions({
    queryKey: channelKeys.channel(wsId, id),
    queryFn: () => api.getChannel(id),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function channelMembersOptions(channelId: string) {
  return queryOptions({
    queryKey: channelKeys.members(channelId),
    queryFn: () => api.listChannelMembers(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}

export function channelMessagesOptions(channelId: string) {
  return queryOptions({
    queryKey: channelKeys.messages(channelId),
    queryFn: () => api.listChannelMessages(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}

export function channelIssuesOptions(channelId: string) {
  return queryOptions({
    queryKey: channelKeys.issues(channelId),
    queryFn: () => api.listChannelIssues(channelId),
    enabled: !!channelId,
    staleTime: Infinity,
  });
}
