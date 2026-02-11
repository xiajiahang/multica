/**
 * sessions_spawn tool — allows a parent agent to spawn subagent runs.
 *
 * Subagents run in isolated sessions with restricted tools.
 * Results are announced back to the parent when the child completes.
 */

import { v7 as uuidv7 } from "uuid";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHub } from "../../hub/hub-singleton.js";
import { buildSubagentSystemPrompt } from "../subagent/announce.js";
import { registerSubagentRun } from "../subagent/registry.js";
import { resolveTools } from "../tools.js";

const SessionsSpawnSchema = Type.Object({
  task: Type.String({ description: "The task for the subagent to perform.", minLength: 1 }),
  label: Type.Optional(
    Type.String({ description: "Human-readable label for this background task." }),
  ),
  model: Type.Optional(
    Type.String({ description: "Override the LLM model for the subagent (e.g. 'gpt-4o', 'claude-sonnet')." }),
  ),
  cleanup: Type.Optional(
    Type.Union([Type.Literal("delete"), Type.Literal("keep")], {
      description: "Session cleanup after completion. 'delete' removes session files, 'keep' preserves for audit. Default: 'delete'.",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description:
        "Execution timeout in seconds. Default: 600 (10 min). " +
        "Set to 0 for no timeout (useful for complex, long-running tasks). " +
        "The subagent will be terminated if it exceeds this limit.",
      minimum: 0,
    }),
  ),
  announce: Type.Optional(
    Type.Union([Type.Literal("immediate"), Type.Literal("silent")], {
      description:
        "Announcement mode. 'immediate' (default): findings delivered as each subagent completes. " +
        "'silent': defer all announcements until every silent subagent from this session finishes, " +
        "then deliver one combined report. Use 'silent' when spawning multiple subagents to collect " +
        "data in parallel and you want to summarize everything at once.",
    }),
  ),
});

type SessionsSpawnArgs = {
  task: string;
  label?: string;
  model?: string;
  cleanup?: "delete" | "keep";
  timeoutSeconds?: number;
  announce?: "immediate" | "silent";
};

export type SessionsSpawnResult = {
  status: "accepted" | "error";
  childSessionId?: string;
  runId?: string;
  error?: string;
};

export interface CreateSessionsSpawnToolOptions {
  /** Whether the current agent is itself a subagent */
  isSubagent?: boolean;
  /** Session ID of the current (requester) agent */
  sessionId?: string;
  /** Resolved provider ID of the parent agent (inherited by subagents) */
  provider?: string;
}

export function createSessionsSpawnTool(
  options: CreateSessionsSpawnToolOptions,
): AgentTool<typeof SessionsSpawnSchema, SessionsSpawnResult> {
  return {
    name: "sessions_spawn",
    label: "Spawn Subagent",
    description:
      "Spawn a background subagent to handle a specific task. The subagent runs in an isolated session with its own tool set. " +
      "When it completes, its findings are delivered directly into your context automatically — you do NOT need to poll or check. " +
      "IMPORTANT: After spawning subagents, continue with any other immediate tasks you have, or simply finish your turn and wait. " +
      "Do NOT call sessions_list to check on subagents you just spawned — results take time and will arrive on their own. " +
      "Use this for parallelizable work, long-running analysis, or tasks that benefit from isolation.",
    parameters: SessionsSpawnSchema,
    execute: async (_toolCallId, args) => {
      const { task, label, model, cleanup = "delete", timeoutSeconds, announce } = args as SessionsSpawnArgs;

      // Guard: subagents cannot spawn subagents
      if (options.isSubagent) {
        return {
          content: [{ type: "text", text: "Error: sessions_spawn is not allowed from sub-agent sessions." }],
          details: {
            status: "error",
            error: "sessions_spawn is not allowed from sub-agent sessions",
          },
        };
      }

      const requesterSessionId = options.sessionId ?? "unknown";
      const runId = uuidv7();
      const childSessionId = uuidv7();

      // Resolve tools for the subagent (with isSubagent=true for policy filtering)
      const subagentTools = resolveTools({ isSubagent: true });
      const toolNames = subagentTools.map((t) => t.name);

      // Build system prompt for the child
      const systemPrompt = buildSubagentSystemPrompt({
        requesterSessionId,
        childSessionId,
        label,
        task,
        tools: toolNames,
      });

      // Spawn child agent via Hub
      try {
        const hub = getHub();
        const childAgent = hub.createSubagent(childSessionId, {
          systemPrompt,
          model,
          provider: options.provider,
        });

        // Register the run for lifecycle tracking.
        // The write is deferred via the start callback so the child only
        // begins work once a concurrency slot is available in the queue.
        registerSubagentRun({
          runId,
          childSessionId,
          requesterSessionId,
          task,
          label,
          cleanup,
          timeoutSeconds,
          announce,
          start: () => childAgent.write(task),
        });

        return {
          content: [
            {
              type: "text",
              text: `Subagent spawned successfully.\n\nRun ID: ${runId}\nSession: ${childSessionId}\nTask: ${label || task.slice(0, 80)}\n\nThe subagent is now working in the background. Its findings will be delivered directly into your context when it completes — do NOT poll or call sessions_list for it. Continue with other tasks or finish your turn.`,
            },
          ],
          details: {
            status: "accepted",
            childSessionId,
            runId,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error spawning subagent: ${message}` }],
          details: {
            status: "error",
            error: message,
          },
        };
      }
    },
  };
}
