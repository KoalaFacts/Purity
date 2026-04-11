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

function nowIso(explicit?: string): string {
  return explicit ?? new Date().toISOString();
}

export function reviewCandidateSkillVersion(
  store: AgentStore,
  skillVersionId: string,
  options: SkillPromotionOptions = {},
): SkillPromotionResult {
  const version = store.getSkillVersion(skillVersionId);
  if (!version) {
    return {
      updated: false,
      promoted: false,
      reason: "skill_version_not_found",
    };
  }

  if (version.status !== "candidate") {
    return {
      updated: false,
      promoted: false,
      reason: "not_candidate",
      previousStatus: version.status,
      nextStatus: version.status,
    };
  }

  const runs = store.listEvalRunsForTarget("skill_version", skillVersionId);
  if (runs.length === 0) {
    return {
      updated: false,
      promoted: false,
      reason: "no_eval_runs",
      previousStatus: version.status,
      nextStatus: version.status,
    };
  }

  const latest = runs[0]!;
  const threshold = options.minEvalScore ?? 0.8;
  const requirePassedRun = options.requirePassedRun ?? true;

  if (requirePassedRun && !latest.passed) {
    store.setSkillVersionStatus(skillVersionId, "failed_eval", {
      evalScore: latest.score,
      updatedAt: nowIso(options.now),
    });
    return {
      updated: true,
      promoted: false,
      reason: "latest_run_failed",
      previousStatus: version.status,
      nextStatus: "failed_eval",
      latestEvalScore: latest.score,
      latestEvalPassed: latest.passed,
    };
  }

  if (latest.score < threshold) {
    store.setSkillVersionStatus(skillVersionId, "failed_eval", {
      evalScore: latest.score,
      updatedAt: nowIso(options.now),
    });
    return {
      updated: true,
      promoted: false,
      reason: "score_below_threshold",
      previousStatus: version.status,
      nextStatus: "failed_eval",
      latestEvalScore: latest.score,
      latestEvalPassed: latest.passed,
    };
  }

  store.setSkillVersionStatus(skillVersionId, "active", {
    evalScore: latest.score,
    updatedAt: nowIso(options.now),
  });

  if (options.activateParentSkill !== false) {
    store.setSkillStatus(version.skillId, "active", nowIso(options.now));
  }

  return {
    updated: true,
    promoted: true,
    previousStatus: version.status,
    nextStatus: "active",
    latestEvalScore: latest.score,
    latestEvalPassed: latest.passed,
  };
}

export function reviewCandidateMemory(
  store: AgentStore,
  memoryId: string,
  options: MemoryPromotionOptions = {},
): MemoryPromotionResult {
  const memory = store.getMemory(memoryId);
  if (!memory) {
    return { updated: false, promoted: false, reason: "memory_not_found" };
  }

  if (memory.status !== "candidate") {
    return {
      updated: false,
      promoted: false,
      reason: "not_candidate",
      previousStatus: memory.status,
      nextStatus: memory.status,
    };
  }

  const threshold = options.minConfidence ?? 0.9;
  if (memory.confidence < threshold) {
    store.setMemoryStatus(memoryId, "rejected", nowIso(options.now));
    return {
      updated: true,
      promoted: false,
      reason: "confidence_below_threshold",
      previousStatus: memory.status,
      nextStatus: "rejected",
    };
  }

  store.setMemoryStatus(memoryId, "active", nowIso(options.now));
  return {
    updated: true,
    promoted: true,
    previousStatus: memory.status,
    nextStatus: "active",
  };
}

export function reviewCandidates(
  store: AgentStore,
  options: ReviewCandidatesOptions = {},
): ReviewCandidatesReport {
  const memoryResults = store.listCandidateMemories().map((memory) => ({
    memoryId: memory.id,
    ...reviewCandidateMemory(store, memory.id, options.memory),
  }));

  const skillResults = store.listCandidateSkillVersions().map((version) => ({
    skillVersionId: version.id,
    ...reviewCandidateSkillVersion(store, version.id, options.skill),
  }));

  return {
    memoryResults,
    skillResults,
    promotedMemories: memoryResults.filter((result) => result.promoted).length,
    rejectedMemories: memoryResults.filter((result) => result.nextStatus === "rejected").length,
    promotedSkillVersions: skillResults.filter((result) => result.promoted).length,
    failedSkillVersions: skillResults.filter((result) => result.nextStatus === "failed_eval")
      .length,
    skippedMemories: memoryResults.filter((result) => !result.updated).length,
    skippedSkillVersions: skillResults.filter((result) => !result.updated).length,
  };
}
