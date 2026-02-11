/**
 * Announce queue for subagent result delivery.
 *
 * Handles queuing and batching of subagent announcements when the parent
 * agent is busy. Supports debounce, cap, drop policy, and collect mode.
 *
 * Ported from OpenClaw (MIT license), adapted for Super Multica.
 */

// ============================================================================
// Types
// ============================================================================

export type AnnounceQueueMode =
  /** Try steer, no queue fallback */
  | "steer"
  /** Try steer, fall back to queue */
  | "steer-backlog"
  /** Queue and send items individually */
  | "followup"
  /** Queue and batch all items into one combined prompt */
  | "collect";

export type AnnounceDropPolicy =
  /** Drop oldest items when cap reached */
  | "old"
  /** Drop newest items when cap reached */
  | "new"
  /** Summarize dropped items */
  | "summarize";

export type AnnounceQueueItem = {
  prompt: string;
  summaryLine?: string;
  enqueuedAt: number;
  requesterSessionId: string;
};

export type AnnounceQueueSettings = {
  mode: AnnounceQueueMode;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: AnnounceDropPolicy;
};

type AnnounceQueueState = {
  items: AnnounceQueueItem[];
  draining: boolean;
  lastEnqueuedAt: number;
  mode: AnnounceQueueMode;
  debounceMs: number;
  cap: number;
  dropPolicy: AnnounceDropPolicy;
  droppedCount: number;
  summaryLines: string[];
  send: (item: AnnounceQueueItem) => Promise<void>;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 1000;
const DEFAULT_CAP = 20;
const DEFAULT_DROP_POLICY: AnnounceDropPolicy = "summarize";

export const DEFAULT_ANNOUNCE_SETTINGS: AnnounceQueueSettings = {
  mode: "steer-backlog",
  debounceMs: DEFAULT_DEBOUNCE_MS,
  cap: DEFAULT_CAP,
  dropPolicy: DEFAULT_DROP_POLICY,
};

// ============================================================================
// Module state
// ============================================================================

const ANNOUNCE_QUEUES = new Map<string, AnnounceQueueState>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Enqueue an announcement for delivery. Returns true if enqueued,
 * false if dropped (cap + "new" drop policy).
 */
export function enqueueAnnounce(params: {
  key: string;
  item: AnnounceQueueItem;
  settings: AnnounceQueueSettings;
  send: (item: AnnounceQueueItem) => Promise<void>;
}): boolean {
  const queue = getOrCreateQueue(params.key, params.settings, params.send);
  queue.lastEnqueuedAt = Date.now();

  const shouldEnqueue = applyDropPolicy(queue, params.item);
  if (!shouldEnqueue) {
    if (queue.dropPolicy === "new") {
      scheduleAnnounceDrain(params.key);
    }
    return false;
  }

  queue.items.push(params.item);
  scheduleAnnounceDrain(params.key);
  return true;
}

/** Reset all queues (for testing). */
export function resetAnnounceQueuesForTests(): void {
  ANNOUNCE_QUEUES.clear();
}

/** Get the current queue depth for a key (for testing/diagnostics). */
export function getAnnounceQueueDepth(key: string): number {
  return ANNOUNCE_QUEUES.get(key)?.items.length ?? 0;
}

// ============================================================================
// Queue management
// ============================================================================

function getOrCreateQueue(
  key: string,
  settings: AnnounceQueueSettings,
  send: (item: AnnounceQueueItem) => Promise<void>,
): AnnounceQueueState {
  const existing = ANNOUNCE_QUEUES.get(key);
  if (existing) {
    existing.mode = settings.mode;
    if (typeof settings.debounceMs === "number") {
      existing.debounceMs = Math.max(0, settings.debounceMs);
    }
    if (typeof settings.cap === "number" && settings.cap > 0) {
      existing.cap = Math.floor(settings.cap);
    }
    if (settings.dropPolicy) {
      existing.dropPolicy = settings.dropPolicy;
    }
    existing.send = send;
    return existing;
  }

  const created: AnnounceQueueState = {
    items: [],
    draining: false,
    lastEnqueuedAt: 0,
    mode: settings.mode,
    debounceMs:
      typeof settings.debounceMs === "number"
        ? Math.max(0, settings.debounceMs)
        : DEFAULT_DEBOUNCE_MS,
    cap:
      typeof settings.cap === "number" && settings.cap > 0
        ? Math.floor(settings.cap)
        : DEFAULT_CAP,
    dropPolicy: settings.dropPolicy ?? DEFAULT_DROP_POLICY,
    droppedCount: 0,
    summaryLines: [],
    send,
  };
  ANNOUNCE_QUEUES.set(key, created);
  return created;
}

// ============================================================================
// Drop policy
// ============================================================================

function applyDropPolicy(
  queue: AnnounceQueueState,
  item: AnnounceQueueItem,
): boolean {
  if (queue.items.length < queue.cap) {
    return true;
  }

  switch (queue.dropPolicy) {
    case "new":
      // Reject the incoming item
      return false;

    case "old": {
      // Drop the oldest item to make room
      const dropped = queue.items.shift();
      if (dropped) {
        queue.droppedCount++;
        const summary = dropped.summaryLine?.trim() || dropped.prompt.slice(0, 80);
        queue.summaryLines.push(summary);
      }
      return true;
    }

    case "summarize": {
      // Drop the oldest item but keep a summary
      const dropped = queue.items.shift();
      if (dropped) {
        queue.droppedCount++;
        const summary = dropped.summaryLine?.trim() || dropped.prompt.slice(0, 80);
        queue.summaryLines.push(summary);
      }
      return true;
    }

    default:
      return true;
  }
}

// ============================================================================
// Drain scheduling
// ============================================================================

function scheduleAnnounceDrain(key: string): void {
  const queue = ANNOUNCE_QUEUES.get(key);
  if (!queue || queue.draining) return;

  queue.draining = true;
  void (async () => {
    try {
      while (queue.items.length > 0 || queue.droppedCount > 0) {
        await waitForDebounce(queue);

        if (queue.mode === "collect") {
          // Batch all items into one combined prompt
          const items = queue.items.splice(0, queue.items.length);
          const summary = buildDropSummary(queue);
          const prompt = buildCollectPrompt(items, summary);
          const last = items.at(-1);
          if (!last) break;
          await queue.send({ ...last, prompt });
          continue;
        }

        // followup / steer-backlog: send items individually
        const summary = buildDropSummary(queue);
        if (summary) {
          const next = queue.items.shift();
          if (!next) break;
          await queue.send({ ...next, prompt: summary });
          continue;
        }

        const next = queue.items.shift();
        if (!next) break;
        await queue.send(next);
      }
    } catch (err) {
      console.error(`[AnnounceQueue] Drain failed for ${key}: ${String(err)}`);
    } finally {
      queue.draining = false;
      if (queue.items.length === 0 && queue.droppedCount === 0) {
        ANNOUNCE_QUEUES.delete(key);
      } else {
        scheduleAnnounceDrain(key);
      }
    }
  })();
}

// ============================================================================
// Helpers
// ============================================================================

function waitForDebounce(queue: AnnounceQueueState): Promise<void> {
  const elapsed = Date.now() - queue.lastEnqueuedAt;
  const remaining = Math.max(0, queue.debounceMs - elapsed);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

function buildDropSummary(queue: AnnounceQueueState): string | undefined {
  if (queue.droppedCount === 0) return undefined;

  const parts: string[] = [
    `[${queue.droppedCount} earlier announce(s) were summarized due to queue backlog]`,
  ];
  if (queue.summaryLines.length > 0) {
    parts.push("");
    for (const line of queue.summaryLines) {
      parts.push(`- ${line}`);
    }
  }

  // Reset counters
  queue.droppedCount = 0;
  queue.summaryLines = [];

  return parts.join("\n");
}

function buildCollectPrompt(
  items: AnnounceQueueItem[],
  dropSummary: string | undefined,
): string {
  const parts: string[] = [
    `[${items.length} queued announce(s) while agent was busy]`,
    "",
  ];

  for (let i = 0; i < items.length; i++) {
    parts.push(`---`);
    parts.push(`Queued #${i + 1}`);
    parts.push(items[i]!.prompt);
    parts.push("");
  }

  if (dropSummary) {
    parts.push(dropSummary);
    parts.push("");
  }

  return parts.join("\n");
}
