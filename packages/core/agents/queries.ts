import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const agentKeys = {
  all: () => ["agents"] as const,
  list: (wsId: string) => [...agentKeys.all(), "list", wsId] as const,
  detail: (id: string) => [...agentKeys.all(), "detail", id] as const,
};

export function listAgentsOptions(wsId: string) {
  return queryOptions({
    queryKey: agentKeys.list(wsId),
    queryFn: () => api.listAgents({ workspace_id: wsId }),
    staleTime: Infinity,
  });
}

export function agentOptions(id: string) {
  return queryOptions({
    queryKey: agentKeys.detail(id),
    queryFn: () => api.getAgent(id),
    enabled: !!id,
    staleTime: Infinity,
  });
}
