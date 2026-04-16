import { describe, expect, it, vi } from "vitest";
import { createMentionSuggestion } from "./mention-suggestion";

vi.mock("@multica/core/workspace", () => ({
  useWorkspaceStore: {
    getState: () => ({
      workspace: { id: "ws-1" },
    }),
  },
}));

describe("createMentionSuggestion", () => {
  it("limits member and agent mentions to the provided scope", () => {
    const qc = {
      getQueryData: (key: readonly unknown[]) => {
        const serialized = JSON.stringify(key);
        if (serialized === JSON.stringify(["workspaces", "ws-1", "members"])) {
          return [
            {
              id: "member-1",
              user_id: "user-1",
              name: "Alice",
            },
            {
              id: "member-2",
              user_id: "user-2",
              name: "Bob",
            },
          ];
        }
        if (serialized === JSON.stringify(["workspaces", "ws-1", "agents"])) {
          return [
            {
              id: "agent-1",
              name: "Coder",
              archived_at: null,
            },
            {
              id: "agent-2",
              name: "Reviewer",
              archived_at: null,
            },
          ];
        }
        if (serialized === JSON.stringify(["issues", "ws-1", "list"])) {
          return { issues: [] };
        }
        return undefined;
      },
    } as any;

    const suggestion = createMentionSuggestion(qc, {
      memberIds: ["user-2"],
      agentIds: ["agent-2"],
      includeAll: false,
      includeIssues: false,
    });

    const getItems = suggestion.items;
    expect(getItems).toBeDefined();
    const items = getItems!({ query: "" as never, editor: {} as never });

    expect(items).toEqual([
      {
        id: "user-2",
        label: "Bob",
        type: "member",
      },
      {
        id: "agent-2",
        label: "Reviewer",
        type: "agent",
      },
    ]);
  });
});
