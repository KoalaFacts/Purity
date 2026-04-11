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
/**
 * Remove duplicate candidate memories that share the same fact text
 * within the same scope/project combination, keeping the newest one.
 */
export declare function deduplicateMemories(
  store: AgentStore,
  options?: DeduplicateMemoriesOptions,
): DeduplicateMemoriesResult;
/**
 * Demote candidate memories and skill versions that have been waiting
 * longer than maxAgeDays without promotion.
 */
export declare function demoteStaleCandidates(
  store: AgentStore,
  options?: DemoteStaleCandidatesOptions,
): DemoteStaleCandidatesResult;
/**
 * Archive skills whose active versions have not been invoked
 * within maxInactiveDays.
 */
export declare function archiveInactiveSkills(
  store: AgentStore,
  options?: ArchiveInactiveSkillsOptions,
): ArchiveInactiveSkillsResult;
/**
 * Delete event rows for old tasks, keeping the task row itself
 * (and its outcome summary) for future retrieval lookups.
 */
export declare function compactOldTasks(
  store: AgentStore,
  options?: CompactOldTasksOptions,
): CompactOldTasksResult;
/**
 * Run all prune operations in sequence and return a combined report.
 */
export declare function pruneStore(store: AgentStore, options?: PruneOptions): PruneReport;
