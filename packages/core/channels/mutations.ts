import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useWorkspaceId } from "../hooks";
import { channelKeys } from "./queries";
import type {
  CreateChannelRequest,
  UpdateChannelRequest,
  SendChannelMessageRequest,
  CreateOrGetDMRequest,
  LinkChannelIssueRequest,
} from "../types";

export function useCreateChannel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateChannelRequest) => api.createChannel(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelRequest }) =>
      api.updateChannel(id, data),
    onSettled: (_, __, { id }) => {
      qc.invalidateQueries({ queryKey: channelKeys.channel(wsId, id) });
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (id: string) => api.deleteChannel(id),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useAddChannelMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data: { member_type: "user" | "agent"; member_id: string; role?: "admin" | "member" };
    }) => api.addChannelMember(channelId, data),
    onSettled: (_, __, { channelId }) => {
      qc.invalidateQueries({ queryKey: channelKeys.members(channelId) });
    },
  });
}

export function useRemoveChannelMember() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      channelId,
      memberType,
      memberId,
    }: {
      channelId: string;
      memberType: string;
      memberId: string;
    }) => api.removeChannelMember(channelId, memberType, memberId),
    onSettled: (_, __, { channelId }) => {
      qc.invalidateQueries({ queryKey: channelKeys.members(channelId) });
    },
  });
}

export function useSendChannelMessage() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data: SendChannelMessageRequest;
    }) => api.sendChannelMessage(channelId, data),
    onSettled: (_, __, { channelId }) => {
      qc.invalidateQueries({ queryKey: channelKeys.messages(channelId) });
    },
  });
}

export function useCreateOrGetDM() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateOrGetDMRequest) => api.createOrGetDM(data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: channelKeys.list(wsId) });
    },
  });
}

export function useLinkChannelIssue() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data: LinkChannelIssueRequest;
    }) => api.linkChannelIssue(channelId, data),
    onSettled: (_, __, { channelId }) => {
      qc.invalidateQueries({ queryKey: channelKeys.issues(channelId) });
    },
  });
}

export function useMarkChannelRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => api.markChannelRead(channelId),
    onSuccess: () => {
      // Invalidate channel list to refresh unread counts
      // The specific workspace ID will be picked up from the query key
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
