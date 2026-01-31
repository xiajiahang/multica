/**
 * Skills Watcher Module
 *
 * Watches skill directories for changes and triggers reload
 */

import { join } from "node:path";
import { existsSync } from "node:fs";

import { DATA_DIR } from "../../shared/index.js";

// ============================================================================
// Types
// ============================================================================

export interface SkillsWatcherOptions {
  /** Profile ID (for profile-specific skills watching) */
  profileId?: string | undefined;
  /** Profile base directory */
  profileBaseDir?: string | undefined;
  /** Debounce delay in milliseconds (default: 250) */
  debounceMs?: number | undefined;
  /** Whether watching is enabled (default: true) */
  enabled?: boolean | undefined;
}

export interface SkillsChangeEvent {
  /** Reason for the change */
  reason: "watch" | "manual";
  /** Path that changed (if known) */
  changedPath?: string | undefined;
}

export type SkillsChangeListener = (event: SkillsChangeEvent) => void;

// ============================================================================
// State
// ============================================================================

/** Current skills version (timestamp-based) */
let currentVersion = Date.now();

/** Registered change listeners */
const listeners = new Set<SkillsChangeListener>();

/** Active watcher instance */
let watcherInstance: {
  close: () => Promise<void>;
  paths: string[];
} | null = null;

/** Debounce timer */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Pending change path */
let pendingChangePath: string | undefined;

// ============================================================================
// Version Management
// ============================================================================

/**
 * Get the current skills version
 */
export function getSkillsVersion(): number {
  return currentVersion;
}

/**
 * Bump the skills version
 *
 * @param reason - Reason for the bump
 * @param changedPath - Path that changed (optional)
 * @returns New version number
 */
export function bumpSkillsVersion(
  reason: SkillsChangeEvent["reason"] = "manual",
  changedPath?: string,
): number {
  const now = Date.now();
  currentVersion = now > currentVersion ? now : currentVersion + 1;

  // Notify listeners
  const event: SkillsChangeEvent = { reason, changedPath };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors
    }
  }

  return currentVersion;
}

// ============================================================================
// Change Listeners
// ============================================================================

/**
 * Register a change listener
 *
 * @param listener - Callback function
 * @returns Unsubscribe function
 */
export function onSkillsChange(listener: SkillsChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ============================================================================
// Watcher Management
// ============================================================================

/** Paths to ignore when watching */
const IGNORED_PATTERNS = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
];

/**
 * Resolve paths to watch
 */
function resolveWatchPaths(options: SkillsWatcherOptions): string[] {
  const paths: string[] = [];

  // Managed skills (~/.super-multica/skills)
  const managedSkills = join(DATA_DIR, "skills");
  if (existsSync(managedSkills)) {
    paths.push(managedSkills);
  }

  // Profile skills (~/.super-multica/agent-profiles/<id>/skills)
  if (options.profileId) {
    const profileBaseDir = options.profileBaseDir ?? join(DATA_DIR, "agent-profiles");
    const profileSkills = join(profileBaseDir, options.profileId, "skills");
    if (existsSync(profileSkills)) {
      paths.push(profileSkills);
    }
  }

  return paths;
}

/**
 * Start watching skill directories
 *
 * @param options - Watcher options
 * @returns Stop function
 */
export async function startSkillsWatcher(
  options: SkillsWatcherOptions = {},
): Promise<() => Promise<void>> {
  // Stop existing watcher if any
  await stopSkillsWatcher();

  if (options.enabled === false) {
    return async () => {};
  }

  const debounceMs = options.debounceMs ?? 250;
  const paths = resolveWatchPaths(options);

  if (paths.length === 0) {
    return async () => {};
  }

  // Dynamically import chokidar (optional dependency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chokidar: any;
  try {
    // @ts-expect-error - chokidar is optional, dynamically loaded
    chokidar = await import("chokidar");
  } catch {
    // chokidar not installed, skip watching
    console.warn("[skills] chokidar not installed, file watching disabled");
    return async () => {};
  }

  const watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    ignored: IGNORED_PATTERNS,
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 100,
    },
  });

  const scheduleUpdate = (changedPath?: string | undefined) => {
    pendingChangePath = changedPath ?? pendingChangePath;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const path = pendingChangePath;
      pendingChangePath = undefined;
      debounceTimer = null;
      bumpSkillsVersion("watch", path);
    }, debounceMs);
  };

  watcher.on("add", (p: string) => scheduleUpdate(p));
  watcher.on("change", (p: string) => scheduleUpdate(p));
  watcher.on("unlink", (p: string) => scheduleUpdate(p));
  watcher.on("error", (err: Error) => {
    console.error("[skills] watcher error:", err);
  });

  watcherInstance = {
    close: async () => {
      await watcher.close();
    },
    paths,
  };

  return stopSkillsWatcher;
}

/**
 * Stop the skills watcher
 */
export async function stopSkillsWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingChangePath = undefined;

  if (watcherInstance) {
    try {
      await watcherInstance.close();
    } catch {
      // Ignore close errors
    }
    watcherInstance = null;
  }
}

/**
 * Check if watcher is currently active
 */
export function isWatcherActive(): boolean {
  return watcherInstance !== null;
}

/**
 * Get currently watched paths
 */
export function getWatchedPaths(): string[] {
  return watcherInstance?.paths ?? [];
}
