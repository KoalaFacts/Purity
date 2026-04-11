import type { AgentStore } from "./store";

export interface PruneOptions {
  now?: string;
}

export interface DeduplicateMemoriesOptions extends PruneOptions {
  scope?: string;
  projectId?: string;
}

export interface DeduplicateMemoriesResult {
  scanned: number;
  duplicatesRemoved: number;
  removedIds: string[];
}

export interface DemoteStaleCandidatesOptions extends PruneOptions {
  maxAgeDays?: number;
}

export interface DemoteStaleCandidatesResult {
  memoriesDemoted: number;
  skillVersionsDemoted: number;
  demotedMemoryIds: string[];
  demotedSkillVersionIds: string[];
}

export interface ArchiveInactiveSkillsOptions extends PruneOptions {
  maxInactiveDays?: number;
}

export interface ArchiveInactiveSkillsResult {
  archived: number;
  archivedIds: string[];
}

export interface CompactOldTasksOptions extends PruneOptions {
  maxAgeDays?: number;
  preserveSuccessful?: boolean;
}

export interface CompactOldTasksResult {
  tasksCompacted: number;
  eventsDeleted: number;
}

export interface PruneReport {
  dedup: DeduplicateMemoriesResult;
  staleCandidates: DemoteStaleCandidatesResult;
  archivedSkills: ArchiveInactiveSkillsResult;
  compactedTasks: CompactOldTasksResult;
}

function nowIso(explicit?: string): string {
  return explicit ?? new Date().toISOString();
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 86_400_000;
  return (new Date(to).getTime() - new Date(from).getTime()) / msPerDay;
}

/**
 * Remove duplicate candidate memories that share the same fact text
 * within the same scope/project combination, keeping the newest one.
 */
export function deduplicateMemories(
  store: AgentStore,
  options: DeduplicateMemoriesOptions = {},
): DeduplicateMemoriesResult {
  const candidates = store.listCandidateMemories();
  const now = nowIso(options.now);

  const groups = new Map<string, typeof candidates>();
  for (const memory of candidates) {
    if (options.scope && memory.scope !== options.scope) continue;
    if (options.projectId && memory.projectId !== options.projectId) continue;

    const key = `${memory.scope}|${memory.projectId ?? ""}|${memory.fact.toLowerCase().trim()}`;
    const group = groups.get(key);
    if (group) {
      group.push(memory);
    } else {
      groups.set(key, [memory]);
    }
  }

  const removedIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (let i = 1; i < group.length; i++) {
      store.setMemoryStatus(group[i]!.id, "rejected", now);
      removedIds.push(group[i]!.id);
    }
  }

  return {
    scanned: candidates.length,
    duplicatesRemoved: removedIds.length,
    removedIds,
  };
}

/**
 * Demote candidate memories and skill versions that have been waiting
 * longer than maxAgeDays without promotion.
 */
export function demoteStaleCandidates(
  store: AgentStore,
  options: DemoteStaleCandidatesOptions = {},
): DemoteStaleCandidatesResult {
  const maxAge = options.maxAgeDays ?? 30;
  const now = nowIso(options.now);

  const candidateMemories = store.listCandidateMemories();
  const demotedMemoryIds: string[] = [];
  for (const memory of candidateMemories) {
    const age = daysBetween(memory.createdAt, now);
    if (age >= maxAge) {
      store.setMemoryStatus(memory.id, "demoted", now);
      demotedMemoryIds.push(memory.id);
    }
  }

  const candidateSkillVersions = store.listCandidateSkillVersions();
  const demotedSkillVersionIds: string[] = [];
  for (const version of candidateSkillVersions) {
    const age = daysBetween(version.createdAt, now);
    if (age >= maxAge) {
      store.setSkillVersionStatus(version.id, "demoted", { updatedAt: now });
      demotedSkillVersionIds.push(version.id);
    }
  }

  return {
    memoriesDemoted: demotedMemoryIds.length,
    skillVersionsDemoted: demotedSkillVersionIds.length,
    demotedMemoryIds,
    demotedSkillVersionIds,
  };
}

/**
 * Archive skills whose active versions have not been invoked
 * within maxInactiveDays.
 */
export function archiveInactiveSkills(
  store: AgentStore,
  options: ArchiveInactiveSkillsOptions = {},
): ArchiveInactiveSkillsResult {
  const maxInactive = options.maxInactiveDays ?? 90;
  const now = nowIso(options.now);

  const activeVersions = store.listSkillVersionsByStatus("active");
  const archivedIds: string[] = [];

  for (const version of activeVersions) {
    const latestDate = version.updatedAt ?? version.createdAt;
    const age = daysBetween(latestDate, now);
    if (age >= maxInactive) {
      store.setSkillVersionStatus(version.id, "archived", { updatedAt: now });
      archivedIds.push(version.id);
    }
  }

  return {
    archived: archivedIds.length,
    archivedIds,
  };
}

/**
 * Delete event rows for old tasks, keeping the task row itself
 * (and its outcome summary) for future retrieval lookups.
 */
export function compactOldTasks(
  store: AgentStore,
  options: CompactOldTasksOptions = {},
): CompactOldTasksResult {
  const maxAge = options.maxAgeDays ?? 60;
  const now = nowIso(options.now);
  const preserveSuccessful = options.preserveSuccessful ?? true;

  const cutoff = new Date(new Date(now).getTime() - maxAge * 86_400_000).toISOString();

  let query = `SELECT t.id FROM tasks t
    WHERE COALESCE(t.completed_at, t.created_at) < ?`;
  const params: (string | number)[] = [cutoff];

  if (preserveSuccessful) {
    query += " AND t.success = 0";
  }

  const rows = store.db.prepare(query).all(...params) as Array<{ id: string }>;

  let eventsDeleted = 0;
  for (const row of rows) {
    const deleted = store.db.prepare("DELETE FROM task_events WHERE task_id = ?").run(row.id);
    eventsDeleted += Number(deleted.changes);
  }

  return {
    tasksCompacted: rows.length,
    eventsDeleted,
  };
}

/**
 * Run all prune operations in sequence and return a combined report.
 */
export function pruneStore(store: AgentStore, options: PruneOptions = {}): PruneReport {
  return {
    dedup: deduplicateMemories(store, options),
    staleCandidates: demoteStaleCandidates(store, options),
    archivedSkills: archiveInactiveSkills(store, options),
    compactedTasks: compactOldTasks(store, options),
  };
}
