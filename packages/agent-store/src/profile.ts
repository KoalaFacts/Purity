import type {
  JsonObject,
  JsonValue,
  ProfileObservation,
  TaskEvent,
  UserProfileRecord,
} from "@purityjs/agent-types";
import type { AgentStore } from "./store";

/* ------------------------------------------------------------------ */
/*  Internal profile data shape (stored as profile_json)              */
/* ------------------------------------------------------------------ */

interface ProfileData {
  [key: string]: JsonValue | Record<string, ProfileObservation> | undefined;
  _pending?: Record<string, ProfileObservation>;
}

/* ------------------------------------------------------------------ */
/*  Options & result types                                            */
/* ------------------------------------------------------------------ */

export interface ProfileUpdateOptions {
  now?: string;
  /** How many independent tasks must observe the same key before promotion. Default: 3. */
  evidenceThreshold?: number;
}

export interface ProfileUpdateResult {
  skipped: boolean;
  reason?: string;
  /** Keys that were newly observed or had their count bumped. */
  observed: string[];
  /** Keys that crossed the evidence threshold and were promoted. */
  promoted: string[];
}

export interface PendingObservation {
  key: string;
  observation: ProfileObservation;
}

/* ------------------------------------------------------------------ */
/*  Observation extractors                                            */
/* ------------------------------------------------------------------ */

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".swift": "swift",
  ".kt": "kotlin",
  ".vue": "vue",
  ".svelte": "svelte",
};

function extractFileExtension(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  return path.slice(dot).toLowerCase();
}

/** Observe preferred languages from file_edit events. */
function observeLanguages(events: TaskEvent[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "file_edit") continue;
    const path = event.payload.path;
    if (typeof path !== "string") continue;
    const ext = extractFileExtension(path);
    if (!ext) continue;
    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  // Return the primary language (most frequent)
  let best: string | undefined;
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      best = lang;
      bestCount = count;
    }
  }
  const result = new Map<string, string>();
  if (best) {
    result.set("preferredLanguage", best);
  }
  return result;
}

/** Observe preferred tools from tool_call events. */
function observeTools(events: TaskEvent[]): Map<string, JsonValue> {
  const toolSet = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const name = event.payload.tool ?? event.payload.name;
    if (typeof name === "string" && name.trim().length > 0) {
      toolSet.add(name.trim());
    }
  }
  const result = new Map<string, JsonValue>();
  if (toolSet.size > 0) {
    result.set("preferredTools", [...toolSet].sort());
  }
  return result;
}

/** Merge all extractors into a single observation map. */
function extractObservations(events: TaskEvent[]): Map<string, JsonValue> {
  const merged = new Map<string, JsonValue>();
  for (const [k, v] of observeLanguages(events)) merged.set(k, v);
  for (const [k, v] of observeTools(events)) merged.set(k, v);
  return merged;
}

/* ------------------------------------------------------------------ */
/*  Pending-observation helpers                                       */
/* ------------------------------------------------------------------ */

function loadProfileData(profile: UserProfileRecord | undefined): ProfileData {
  if (!profile) return {};
  return profile.profile as ProfileData;
}

function sameValue(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergePending(
  data: ProfileData,
  key: string,
  value: JsonValue,
  now: string,
): ProfileObservation {
  const pending = data._pending ?? {};
  const existing = pending[key];

  if (existing && sameValue(existing.value, value)) {
    return {
      ...existing,
      count: existing.count + 1,
      lastSeen: now,
    };
  }

  // New observation or value changed — reset count
  return {
    key,
    value,
    count: 1,
    firstSeen: now,
    lastSeen: now,
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Analyze a completed task's events and update the user profile with
 * observed preferences. An observation is stored as _pending until it
 * has been seen across `evidenceThreshold` distinct tasks, at which
 * point it is promoted to the top-level profile.
 *
 * Safety: "Never store permanent user profile facts from one ambiguous
 * interaction" — the evidence threshold enforces this.
 */
export function observeProfileFromTask(
  store: AgentStore,
  userId: string,
  taskId: string,
  options: ProfileUpdateOptions = {},
): ProfileUpdateResult {
  const task = store.getTask(taskId);
  if (!task) {
    return {
      skipped: true,
      reason: "task_not_found",
      observed: [],
      promoted: [],
    };
  }

  if (task.status !== "completed") {
    return {
      skipped: true,
      reason: "task_not_completed",
      observed: [],
      promoted: [],
    };
  }

  const events = store.listTaskEvents(taskId);
  if (events.length === 0) {
    return { skipped: true, reason: "no_events", observed: [], promoted: [] };
  }

  const observations = extractObservations(events);
  if (observations.size === 0) {
    return {
      skipped: true,
      reason: "no_observations",
      observed: [],
      promoted: [],
    };
  }

  const now = options.now ?? new Date().toISOString();
  const threshold = options.evidenceThreshold ?? 3;

  const existing = store.getUserProfile(userId);
  const data = loadProfileData(existing);
  const pending: Record<string, ProfileObservation> = {
    ...data._pending,
  };

  const observedKeys: string[] = [];
  const promotedKeys: string[] = [];

  for (const [key, value] of observations) {
    const updated = mergePending(data, key, value, now);
    pending[key] = updated;
    observedKeys.push(key);

    if (updated.count >= threshold) {
      // Promote: write to top-level profile, remove from pending
      (data as Record<string, JsonValue>)[key] = value;
      // biome-ignore lint/performance/noDelete: pending cleanup
      delete pending[key];
      promotedKeys.push(key);
    }
  }

  // Write back
  const updatedData: ProfileData = { ...data, _pending: pending };

  // Clean up _pending if empty
  if (Object.keys(updatedData._pending ?? {}).length === 0) {
    // biome-ignore lint/performance/noDelete: pending cleanup
    delete updatedData._pending;
  }

  store.putUserProfile({
    userId,
    profile: updatedData as JsonObject,
    updatedAt: now,
  });

  return {
    skipped: false,
    observed: observedKeys,
    promoted: promotedKeys,
  };
}

/**
 * Process all completed tasks in a session, updating the user's profile
 * for each one.
 */
export function observeProfileFromSession(
  store: AgentStore,
  sessionId: string,
  options: ProfileUpdateOptions = {},
): ProfileUpdateResult {
  const session = store.getSession(sessionId);
  if (!session) {
    return {
      skipped: true,
      reason: "session_not_found",
      observed: [],
      promoted: [],
    };
  }

  const userId = session.userId;
  if (!userId) {
    return { skipped: true, reason: "no_user_id", observed: [], promoted: [] };
  }

  const tasks = store.listTasksBySession(sessionId);
  const allObserved: string[] = [];
  const allPromoted: string[] = [];

  for (const task of tasks) {
    if (task.status !== "completed") continue;
    const result = observeProfileFromTask(store, userId, task.id, options);
    if (!result.skipped) {
      allObserved.push(...result.observed);
      allPromoted.push(...result.promoted);
    }
  }

  if (allObserved.length === 0) {
    return {
      skipped: true,
      reason: "no_observations",
      observed: [],
      promoted: [],
    };
  }

  return {
    skipped: false,
    observed: [...new Set(allObserved)],
    promoted: [...new Set(allPromoted)],
  };
}

/**
 * Return all pending (not yet promoted) observations for a user.
 */
export function getPendingObservations(store: AgentStore, userId: string): PendingObservation[] {
  const profile = store.getUserProfile(userId);
  if (!profile) return [];

  const data = loadProfileData(profile);
  const pending = data._pending ?? {};

  return Object.entries(pending).map(([key, observation]) => ({
    key,
    observation,
  }));
}
