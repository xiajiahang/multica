/**
 * Subagent registry — in-memory tracking + lifecycle management.
 *
 * Tracks all active subagent runs, persists state to disk,
 * watches for child completion, and triggers announce flow.
 */

import { getHub, isHubInitialized } from "../../hub/hub-singleton.js";
import { loadSubagentRuns, saveSubagentRuns } from "./registry-store.js";
import { readLatestAssistantReply, runCoalescedAnnounceFlow } from "./announce.js";
import type {
  RegisterSubagentRunParams,
  SubagentRunRecord,
} from "./types.js";
import { resolveSessionDir } from "../session/storage.js";
import { rmSync } from "node:fs";
import { enqueueInLane, setLaneConcurrency } from "./command-queue.js";
import { SubagentLane, DEFAULT_SUBAGENT_MAX_CONCURRENT, resolveSubagentTimeoutMs } from "./lanes.js";

/** Default archive retention: 60 minutes after completion */
const DEFAULT_ARCHIVE_AFTER_MS = 60 * 60 * 1000;

/** Archive sweep interval: 60 seconds */
const SWEEP_INTERVAL_MS = 60 * 1000;

// ============================================================================
// Module-level state
// ============================================================================

const subagentRuns = new Map<string, SubagentRunRecord>();
let sweepTimer: ReturnType<typeof setInterval> | undefined;
const resumedRequesters = new Set<string>();

// ============================================================================
// Public API
// ============================================================================

/** Initialize registry from persisted state. Call once at startup. */
export function initSubagentRegistry(): void {
  setLaneConcurrency(SubagentLane.Subagent, DEFAULT_SUBAGENT_MAX_CONCURRENT);

  const persisted = loadSubagentRuns();
  for (const [runId, record] of persisted) {
    subagentRuns.set(runId, record);

    // Backward compat: old records with cleanupHandled but no announced field
    if (record.cleanupHandled && record.announced === undefined) {
      record.announced = true;
      record.findingsCaptured = true;
    }
  }

  // Process incomplete runs
  const affectedRequesters = new Set<string>();

  for (const record of subagentRuns.values()) {
    if (record.announced && record.cleanupHandled) continue; // Already fully done

    if (!record.endedAt) {
      // Child was running when process crashed — mark as ended/unknown
      record.endedAt = Date.now();
      record.outcome = { status: "unknown" };
    }

    if (!record.findingsCaptured) {
      captureFindings(record);
    }

    // Recovery cleanup must be independent from findings capture:
    // the process may crash after captureFindings() persisted but before deletion.
    if (record.cleanup === "delete" && !record.cleanupHandled) {
      deleteChildSession(record.childSessionId);
    }

    affectedRequesters.add(record.requesterSessionId);
  }

  persist();

  // For each affected requester, check if coalesced announcement is needed
  for (const requesterId of affectedRequesters) {
    if (!resumedRequesters.has(requesterId)) {
      resumedRequesters.add(requesterId);
      checkAndAnnounce(requesterId);
    }
  }

  if (subagentRuns.size > 0) {
    startSweeper();
    console.log(`[SubagentRegistry] Loaded ${subagentRuns.size} persisted run(s)`);
  }
}

/** Register a new subagent run and start tracking its lifecycle. */
export function registerSubagentRun(params: RegisterSubagentRunParams): SubagentRunRecord {
  const {
    runId,
    childSessionId,
    requesterSessionId,
    task,
    label,
    cleanup = "delete",
    timeoutSeconds,
    announce,
    start,
  } = params;

  const record: SubagentRunRecord = {
    runId,
    childSessionId,
    requesterSessionId,
    task,
    label,
    cleanup,
    announce,
    createdAt: Date.now(),
  };

  subagentRuns.set(runId, record);
  persist();
  startSweeper();

  // Enqueue in the subagent lane — the start callback and watchChildAgent
  // only execute once a concurrency slot is available.
  void enqueueInLane(SubagentLane.Subagent, async () => {
    console.log(`[SubagentRegistry] Lane slot acquired for ${runId}, calling start()`);
    start?.();
    console.log(`[SubagentRegistry] start() returned, entering watchChildAgent`);
    return watchChildAgent(record, timeoutSeconds);
  });

  return record;
}

/** List all active runs for a given requester session. */
export function listSubagentRuns(requesterSessionId: string): SubagentRunRecord[] {
  const result: SubagentRunRecord[] = [];
  for (const record of subagentRuns.values()) {
    if (record.requesterSessionId === requesterSessionId) {
      result.push(record);
    }
  }
  return result;
}

/** Remove a run from the registry. */
export function releaseSubagentRun(runId: string): boolean {
  const deleted = subagentRuns.delete(runId);
  if (deleted) {
    persist();
    if (subagentRuns.size === 0) {
      stopSweeper();
    }
  }
  return deleted;
}

/** Get a run by ID. */
export function getSubagentRun(runId: string): SubagentRunRecord | undefined {
  return subagentRuns.get(runId);
}

/** Mark all active (non-ended) runs as ended with "unknown" status. Called during Hub shutdown. */
export function shutdownSubagentRegistry(): void {
  const now = Date.now();
  let updated = 0;

  for (const record of subagentRuns.values()) {
    if (!record.endedAt) {
      record.endedAt = now;
      record.outcome = { status: "unknown" };
      updated++;
    }

    // Opportunistically capture findings for ended-but-uncaptured runs
    if (record.endedAt && !record.findingsCaptured) {
      captureFindings(record);
      updated++;
    }
  }

  if (updated > 0) {
    persist();
    console.log(`[SubagentRegistry] Processed ${updated} run(s) during shutdown`);
  }

  stopSweeper();
}

/** Reset all state (for testing). */
export function resetSubagentRegistryForTests(): void {
  subagentRuns.clear();
  resumedRequesters.clear();
  stopSweeper();
}

// ============================================================================
// Lifecycle watching
// ============================================================================

/**
 * Watch a child agent for completion.
 * Returns a promise that resolves when the child finishes (or errors/times out),
 * keeping the command-queue lane slot occupied until then.
 */
function watchChildAgent(record: SubagentRunRecord, timeoutSeconds?: number): Promise<void> {
  const { childSessionId } = record;

  // Mark as started
  record.startedAt = Date.now();
  persist();

  const timeoutMs = resolveSubagentTimeoutMs(timeoutSeconds);

  return new Promise<void>((resolveSlot) => {
    const cleanup = (outcome: { status: "ok" | "error" | "timeout" | "unknown"; error?: string | undefined }) => {
      if (record.endedAt) return; // Already finalized
      if (timeoutTimer) clearTimeout(timeoutTimer);
      record.endedAt = Date.now();
      record.outcome = outcome;
      persist();
      handleRunCompletion(record);
      resolveSlot(); // Release the queue slot
    };

    // Always set a timeout (default 10 min, 0 = ~24 days via resolveSubagentTimeoutMs)
    const timeoutTimer = setTimeout(() => {
      cleanup({ status: "timeout" });

      // Try to close the child agent
      try {
        const hub = getHub();
        hub.closeAgent(childSessionId);
      } catch {
        // Hub may not be available
      }
    }, timeoutMs);

    // Get child agent reference (Hub may not be available in tests)
    if (!isHubInitialized()) {
      cleanup({ status: "error", error: "Hub not initialized" });
      return;
    }

    const hub = getHub();
    const childAgent = hub.getAgent(childSessionId);
    if (!childAgent) {
      cleanup({ status: "error", error: "Child agent not found" });
      return;
    }

    // Wait for the child agent's task queue to drain (task completion),
    // then trigger announce flow. Uses waitForIdle() instead of consuming
    // the stream (which would conflict with Hub.consumeAgent).
    console.log(`[SubagentRegistry] waitForIdle() called for child ${childSessionId}, pendingWrites=${childAgent.getPendingWrites()}`);
    childAgent.waitForIdle().then(
      () => {
        const runtime = Date.now() - (record.startedAt ?? 0);
        const runError = childAgent.lastRunError;
        if (runError) {
          console.log(`[SubagentRegistry] waitForIdle() resolved for child ${childSessionId} with error (runtime: ${runtime}ms): ${runError}`);
          cleanup({ status: "error", error: runError });
        } else {
          console.log(`[SubagentRegistry] waitForIdle() resolved OK for child ${childSessionId} (runtime: ${runtime}ms)`);
          cleanup({ status: "ok" });
        }
      },
      (err) => {
        console.error(`[SubagentRegistry] waitForIdle() rejected for child ${childSessionId}:`, err);
        cleanup({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );

    // Also handle explicit close (e.g., timeout kill, Hub shutdown)
    childAgent.onClose(() => {
      cleanup({ status: record.outcome?.status ?? "unknown" });
    });
  });
}

// ============================================================================
// Cleanup + Announce (two-phase: capture findings, then coalesced announce)
// ============================================================================

/** Phase 1: Capture child's findings before session deletion. */
function captureFindings(record: SubagentRunRecord): void {
  try {
    const findings = readLatestAssistantReply(record.childSessionId);
    record.findings = findings ?? undefined;
  } catch {
    record.findings = "(failed to read findings)";
  }
  record.findingsCaptured = true;
  persist();
}

/**
 * Phase 2: Announce completed-but-unannounced runs.
 *
 * Runs with announce="silent" are held back until ALL silent runs from the
 * same requester have completed. All other runs (immediate / undefined) are
 * announced per-completion as before.
 */
function checkAndAnnounce(requesterSessionId: string): void {
  const allRuns = listSubagentRuns(requesterSessionId);

  // ── Immediate runs: announce per-completion (default behavior) ──
  const immediateReady = allRuns.filter(
    r => !r.announced && r.endedAt !== undefined && r.findingsCaptured && r.announce !== "silent",
  );
  if (immediateReady.length > 0) {
    announceGroup(requesterSessionId, immediateReady);
  }

  // ── Silent runs: announce only when ALL silent runs are done ──
  const silentRuns = allRuns.filter(r => r.announce === "silent");
  const unannouncedSilent = silentRuns.filter(r => !r.announced);
  const silentReady = unannouncedSilent.filter(
    r => r.endedAt !== undefined && r.findingsCaptured,
  );

  // All unannounced silent runs must be ready (ended + findings captured)
  if (silentReady.length > 0 && silentReady.length === unannouncedSilent.length) {
    announceGroup(requesterSessionId, silentReady);
  }
}

/** Announce a group of runs and mark them as announced. */
function announceGroup(requesterSessionId: string, runs: SubagentRunRecord[]): void {
  const announced = runCoalescedAnnounceFlow(requesterSessionId, runs);

  if (announced) {
    for (const r of runs) {
      r.announced = true;
      r.cleanupHandled = true;
      // Keep records for querying via sessions_list; let sweeper archive later
      r.archiveAtMs = Date.now() + DEFAULT_ARCHIVE_AFTER_MS;
    }
    persist();
  } else {
    // Allow retry — mark cleanupHandled false so initSubagentRegistry() retries
    for (const r of runs) {
      r.cleanupHandled = false;
    }
    persist();
    console.warn(
      `[SubagentRegistry] Announce failed for requester ${requesterSessionId}`,
    );
  }
}

/** Entry point: called when a child completes. */
function handleRunCompletion(record: SubagentRunRecord): void {
  // Phase 1: capture findings (before session deletion)
  if (!record.findingsCaptured) {
    captureFindings(record);

    // Session cleanup (safe now that findings are persisted)
    if (record.cleanup === "delete") {
      deleteChildSession(record.childSessionId);
    }
  }

  // Phase 2: coalesced announce check
  checkAndAnnounce(record.requesterSessionId);
}

function deleteChildSession(sessionId: string): void {
  try {
    const sessionDir = resolveSessionDir(sessionId);
    rmSync(sessionDir, { recursive: true, force: true });
    console.log(`[SubagentRegistry] Deleted child session: ${sessionId}`);
  } catch (err) {
    console.warn(`[SubagentRegistry] Failed to delete child session ${sessionId}:`, err);
  }

  // Also close the agent in Hub
  try {
    const hub = getHub();
    hub.closeAgent(sessionId);
  } catch {
    // Hub may not be available
  }
}

// ============================================================================
// Archive sweeper
// ============================================================================

function startSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Don't prevent process exit
  if (sweepTimer.unref) sweepTimer.unref();
}

function stopSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

function sweep(): void {
  const now = Date.now();
  let removed = 0;

  for (const [runId, record] of subagentRuns) {
    if (record.archiveAtMs !== undefined && record.archiveAtMs <= now) {
      subagentRuns.delete(runId);
      removed++;
    }
  }

  if (removed > 0) {
    persist();
    console.log(`[SubagentRegistry] Archived ${removed} completed run(s)`);
  }

  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

// ============================================================================
// Persistence helper
// ============================================================================

function persist(): void {
  try {
    saveSubagentRuns(subagentRuns);
  } catch (err) {
    console.error(`[SubagentRegistry] Failed to persist runs:`, err);
  }
}
