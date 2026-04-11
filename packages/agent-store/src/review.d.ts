import type { ArtifactStatus, SkillVersionRecord } from "@purityjs/agent-types";
import type { AgentStore } from "./store";
export interface SkillPromotionOptions {
  minEvalScore?: number;
  requirePassedRun?: boolean;
  activateParentSkill?: boolean;
  now?: string;
}
export interface SkillPromotionResult {
  updated: boolean;
  promoted: boolean;
  reason?:
    | "skill_version_not_found"
    | "not_candidate"
    | "no_eval_runs"
    | "latest_run_failed"
    | "score_below_threshold";
  previousStatus?: SkillVersionRecord["status"];
  nextStatus?: ArtifactStatus;
  latestEvalScore?: number;
  latestEvalPassed?: boolean;
}
export interface MemoryPromotionOptions {
  minConfidence?: number;
  now?: string;
}
export interface MemoryPromotionResult {
  updated: boolean;
  promoted: boolean;
  reason?: "memory_not_found" | "not_candidate" | "confidence_below_threshold";
  previousStatus?: ArtifactStatus;
  nextStatus?: ArtifactStatus;
}
export interface ReviewCandidatesOptions {
  memory?: MemoryPromotionOptions;
  skill?: SkillPromotionOptions;
}
export interface ReviewedMemoryResult extends MemoryPromotionResult {
  memoryId: string;
}
export interface ReviewedSkillResult extends SkillPromotionResult {
  skillVersionId: string;
}
export interface ReviewCandidatesReport {
  memoryResults: ReviewedMemoryResult[];
  skillResults: ReviewedSkillResult[];
  promotedMemories: number;
  rejectedMemories: number;
  promotedSkillVersions: number;
  failedSkillVersions: number;
  skippedMemories: number;
  skippedSkillVersions: number;
}
export declare function reviewCandidateSkillVersion(
  store: AgentStore,
  skillVersionId: string,
  options?: SkillPromotionOptions,
): SkillPromotionResult;
export declare function reviewCandidateMemory(
  store: AgentStore,
  memoryId: string,
  options?: MemoryPromotionOptions,
): MemoryPromotionResult;
export declare function reviewCandidates(
  store: AgentStore,
  options?: ReviewCandidatesOptions,
): ReviewCandidatesReport;
