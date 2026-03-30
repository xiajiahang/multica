"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bot, ChevronRight, Loader2, Terminal, FileText, AlertCircle, ArrowDown } from "lucide-react";
import { api } from "@/shared/api";
import { useWSEvent } from "@/features/realtime";
import type { TaskMessagePayload, TaskCompletedPayload, TaskFailedPayload } from "@/shared/types/events";
import type { AgentTask } from "@/shared/types/agent";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface AgentLiveCardProps {
  issueId: string;
  assigneeType: string | null;
  assigneeId: string | null;
  agentName?: string;
}

// Icons for common tool names
function ToolIcon({ tool }: { tool: string }) {
  const name = tool.toLowerCase();
  if (name.includes("bash") || name.includes("shell") || name.includes("terminal")) {
    return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  if (name.includes("read") || name.includes("write") || name.includes("edit") || name.includes("glob") || name.includes("grep")) {
    return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  }
  return <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatElapsed(startedAt: string): string {
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

interface ToolCallEntry {
  seq: number;
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
}

export function AgentLiveCard({ issueId, assigneeType, assigneeId, agentName }: AgentLiveCardProps) {
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [messages, setMessages] = useState<TaskMessagePayload[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [currentText, setCurrentText] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Check for active task on mount
  useEffect(() => {
    if (assigneeType !== "agent" || !assigneeId) {
      setActiveTask(null);
      return;
    }

    let cancelled = false;
    api.getActiveTaskForIssue(issueId).then(({ task }) => {
      if (!cancelled) {
        setActiveTask(task);
        // If there's an active task, fetch existing messages for catch-up
        if (task) {
          api.listTaskMessages(task.id).then((msgs) => {
            if (!cancelled) {
              applyMessages(msgs);
            }
          }).catch(() => {});
        }
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [issueId, assigneeType, assigneeId]);

  // Process messages into tool calls and text
  const applyMessages = useCallback((msgs: TaskMessagePayload[]) => {
    const newToolCalls: ToolCallEntry[] = [];
    let text = "";

    for (const msg of msgs) {
      switch (msg.type) {
        case "tool_use":
          newToolCalls.push({ seq: msg.seq, tool: msg.tool ?? "", input: msg.input });
          break;
        case "tool_result":
          // Attach output to matching tool call
          for (let i = newToolCalls.length - 1; i >= 0; i--) {
            const tc = newToolCalls[i];
            if (tc && tc.tool === msg.tool && !tc.output) {
              tc.output = msg.output;
              break;
            }
          }
          break;
        case "text":
          text += msg.content ?? "";
          break;
        case "error":
          text += `\n[Error] ${msg.content ?? ""}\n`;
          break;
      }
    }

    setToolCalls(newToolCalls);
    setCurrentText(text);
    setMessages(msgs);
  }, []);

  // Handle real-time task messages
  useWSEvent(
    "task:message",
    useCallback((payload: unknown) => {
      const msg = payload as TaskMessagePayload;
      if (msg.issue_id !== issueId) return;

      setMessages((prev) => {
        if (prev.some((m) => m.seq === msg.seq && m.task_id === msg.task_id)) return prev;
        return [...prev, msg];
      });

      switch (msg.type) {
        case "tool_use":
          setToolCalls((prev) => [
            ...prev,
            { seq: msg.seq, tool: msg.tool ?? "", input: msg.input },
          ]);
          break;
        case "tool_result":
          setToolCalls((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              const tc = updated[i];
              if (tc && tc.tool === msg.tool && !tc.output) {
                updated[i] = { ...tc, output: msg.output };
                break;
              }
            }
            return updated;
          });
          break;
        case "text":
          setCurrentText((prev) => prev + (msg.content ?? ""));
          break;
        case "error":
          setCurrentText((prev) => prev + `\n[Error] ${msg.content ?? ""}\n`);
          break;
      }
    }, [issueId]),
  );

  // Handle task completion - hide the live card
  useWSEvent(
    "task:completed",
    useCallback((payload: unknown) => {
      const p = payload as TaskCompletedPayload;
      if (p.issue_id !== issueId) return;
      setActiveTask(null);
      setMessages([]);
      setToolCalls([]);
      setCurrentText("");
    }, [issueId]),
  );

  useWSEvent(
    "task:failed",
    useCallback((payload: unknown) => {
      const p = payload as TaskFailedPayload;
      if (p.issue_id !== issueId) return;
      setActiveTask(null);
      setMessages([]);
      setToolCalls([]);
      setCurrentText("");
    }, [issueId]),
  );

  // Also pick up new tasks starting (task:dispatch)
  useWSEvent(
    "task:dispatch",
    useCallback((payload: unknown) => {
      const p = payload as { task_id: string; issue_id?: string };
      // We don't have issue_id in dispatch payload, re-fetch
      api.getActiveTaskForIssue(issueId).then(({ task }) => {
        if (task) {
          setActiveTask(task);
          setMessages([]);
          setToolCalls([]);
          setCurrentText("");
        }
      }).catch(() => {});
    }, [issueId]),
  );

  // Update elapsed time
  useEffect(() => {
    if (!activeTask?.started_at && !activeTask?.dispatched_at) return;
    const ref = activeTask.started_at ?? activeTask.dispatched_at!;
    setElapsed(formatElapsed(ref));
    const interval = setInterval(() => {
      setElapsed(formatElapsed(ref));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTask?.started_at, activeTask?.dispatched_at]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls, currentText, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  if (!activeTask) return null;

  const lastTextLines = currentText.trim().split("\n").filter(Boolean);
  const lastLine = lastTextLines[lastTextLines.length - 1] ?? "";

  return (
    <div className="rounded-lg border border-info/20 bg-info/5">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex items-center justify-center h-5 w-5 rounded-full bg-info/10 text-info">
          <Bot className="h-3 w-3" />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Loader2 className="h-3 w-3 animate-spin text-info" />
          <span>{agentName ?? "Agent"} is working</span>
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{elapsed}</span>
        {toolCalls.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {toolCalls.length} tool {toolCalls.length === 1 ? "call" : "calls"}
          </span>
        )}
      </div>

      {/* Content */}
      {(toolCalls.length > 0 || currentText) && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative max-h-64 overflow-y-auto border-t border-info/10 px-3 py-2 space-y-1"
        >
          <div ref={contentRef}>
            {toolCalls.map((tc, idx) => (
              <ToolCallRow key={`${tc.seq}-${idx}`} entry={tc} />
            ))}

            {/* Current thinking text (last line only) */}
            {lastLine && (
              <div className="flex items-start gap-2 text-xs text-muted-foreground py-0.5">
                <span className="shrink-0 mt-0.5 h-3.5 w-3.5" />
                <span className="truncate italic">{lastLine}</span>
              </div>
            )}
          </div>

          {/* Scroll to bottom button */}
          {!autoScroll && (
            <button
              onClick={() => {
                if (scrollRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                  setAutoScroll(true);
                }
              }}
              className="sticky bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-background border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground shadow-sm"
            >
              <ArrowDown className="h-3 w-3" />
              Latest
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallRow({ entry }: { entry: ToolCallEntry }) {
  const [open, setOpen] = useState(false);

  // Extract a short summary from tool input
  const summary = getToolSummary(entry);
  const hasDetails = entry.output || (entry.input && Object.keys(entry.input).length > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded px-1 -mx-1 py-0.5 text-xs hover:bg-accent/30 transition-colors",
          hasDetails && "cursor-pointer",
        )}
        disabled={!hasDetails}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !hasDetails && "invisible",
          )}
        />
        <ToolIcon tool={entry.tool} />
        <span className="font-medium text-foreground">{entry.tool}</span>
        {summary && <span className="truncate text-muted-foreground">{summary}</span>}
        {entry.output !== undefined && (
          <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-success" />
        )}
        {entry.output === undefined && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {entry.output && (
          <pre className="ml-8 mt-1 max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
            {entry.output.length > 2000 ? entry.output.slice(0, 2000) + "\n..." : entry.output}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function getToolSummary(entry: ToolCallEntry): string {
  if (!entry.input) return "";
  const { file_path, path, pattern, command, description } = entry.input as Record<string, string>;

  // Shorten file paths
  if (file_path) return shortenPath(file_path);
  if (path) return shortenPath(path);
  if (pattern) return pattern;
  if (description) return description;
  if (command) {
    const cmd = String(command);
    return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd;
  }
  return "";
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return ".../" + parts.slice(-2).join("/");
}
