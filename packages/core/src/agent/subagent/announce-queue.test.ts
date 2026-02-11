import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enqueueAnnounce,
  resetAnnounceQueuesForTests,
  getAnnounceQueueDepth,
  type AnnounceQueueItem,
  type AnnounceQueueSettings,
} from "./announce-queue.js";

afterEach(() => {
  resetAnnounceQueuesForTests();
});

function makeItem(overrides?: Partial<AnnounceQueueItem>): AnnounceQueueItem {
  return {
    prompt: "test prompt",
    summaryLine: "test summary",
    enqueuedAt: Date.now(),
    requesterSessionId: "session-1",
    ...overrides,
  };
}

const FAST_SETTINGS: AnnounceQueueSettings = {
  mode: "followup",
  debounceMs: 0,
  cap: 20,
  dropPolicy: "old",
};

describe("announce queue", () => {
  it("enqueues an item and drains via send callback", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => { sent.push(item); };

    enqueueAnnounce({
      key: "test",
      item: makeItem(),
      settings: FAST_SETTINGS,
      send,
    });

    // Wait for async drain
    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.prompt).toBe("test prompt");
  });

  it("batches items in collect mode", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => { sent.push(item); };

    const collectSettings: AnnounceQueueSettings = {
      mode: "collect",
      debounceMs: 0,
      cap: 20,
      dropPolicy: "old",
    };

    enqueueAnnounce({
      key: "test",
      item: makeItem({ prompt: "prompt 1" }),
      settings: collectSettings,
      send,
    });
    enqueueAnnounce({
      key: "test",
      item: makeItem({ prompt: "prompt 2" }),
      settings: collectSettings,
      send,
    });
    enqueueAnnounce({
      key: "test",
      item: makeItem({ prompt: "prompt 3" }),
      settings: collectSettings,
      send,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Collect mode batches all into one send
    expect(sent).toHaveLength(1);
    expect(sent[0]!.prompt).toContain("prompt 1");
    expect(sent[0]!.prompt).toContain("prompt 2");
    expect(sent[0]!.prompt).toContain("prompt 3");
    expect(sent[0]!.prompt).toContain("3 queued announce(s)");
  });

  it("sends items individually in followup mode", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => { sent.push(item); };

    enqueueAnnounce({
      key: "test",
      item: makeItem({ prompt: "prompt A" }),
      settings: FAST_SETTINGS,
      send,
    });
    enqueueAnnounce({
      key: "test",
      item: makeItem({ prompt: "prompt B" }),
      settings: FAST_SETTINGS,
      send,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(2);
    expect(sent[0]!.prompt).toBe("prompt A");
    expect(sent[1]!.prompt).toBe("prompt B");
  });

  it("respects cap with 'new' drop policy (rejects new items)", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => {
      // Slow send to keep items in queue
      await new Promise((r) => setTimeout(r, 200));
      sent.push(item);
    };

    const cappedSettings: AnnounceQueueSettings = {
      mode: "followup",
      debounceMs: 0,
      cap: 2,
      dropPolicy: "new",
    };

    const r1 = enqueueAnnounce({ key: "test", item: makeItem({ prompt: "1" }), settings: cappedSettings, send });
    const r2 = enqueueAnnounce({ key: "test", item: makeItem({ prompt: "2" }), settings: cappedSettings, send });
    const r3 = enqueueAnnounce({ key: "test", item: makeItem({ prompt: "3" }), settings: cappedSettings, send });

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(false); // Rejected — cap reached
  });

  it("respects cap with 'old' drop policy (drops oldest)", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => {
      await new Promise((r) => setTimeout(r, 200));
      sent.push(item);
    };

    const cappedSettings: AnnounceQueueSettings = {
      mode: "followup",
      debounceMs: 0,
      cap: 2,
      dropPolicy: "old",
    };

    enqueueAnnounce({ key: "test", item: makeItem({ prompt: "1" }), settings: cappedSettings, send });
    enqueueAnnounce({ key: "test", item: makeItem({ prompt: "2" }), settings: cappedSettings, send });
    enqueueAnnounce({ key: "test", item: makeItem({ prompt: "3" }), settings: cappedSettings, send });

    // Queue should have items 2 and 3 (oldest was dropped)
    expect(getAnnounceQueueDepth("test")).toBeLessThanOrEqual(2);
  });

  it("cleans up queue after drain completes", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => { sent.push(item); };

    enqueueAnnounce({
      key: "test",
      item: makeItem(),
      settings: FAST_SETTINGS,
      send,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(sent).toHaveLength(1);
    expect(getAnnounceQueueDepth("test")).toBe(0);
  });

  it("debounces before draining", async () => {
    const sent: AnnounceQueueItem[] = [];
    const send = async (item: AnnounceQueueItem) => { sent.push(item); };

    const debouncedSettings: AnnounceQueueSettings = {
      mode: "followup",
      debounceMs: 100,
      cap: 20,
      dropPolicy: "old",
    };

    enqueueAnnounce({
      key: "test",
      item: makeItem(),
      settings: debouncedSettings,
      send,
    });

    // Should not have sent yet (debounce)
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toHaveLength(0);

    // Wait for debounce to complete
    await new Promise((r) => setTimeout(r, 150));
    expect(sent).toHaveLength(1);
  });
});
