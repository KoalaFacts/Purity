import type { EvalRun } from "@purityjs/agent-types";
import type { AgentStore } from "./store";

export interface DigestOptions {
  since?: string;
  now?: string;
}

export interface PromotedSkillDigest {
  id: string;
  skillId: string;
  version: number;
  bodySnippet: string;
  evalScore?: number;
  promotedAt: string;
}

export interface RejectedSkillDigest {
  id: string;
  skillId: string;
  version: number;
  reason: string;
  evalScore?: number;
}

export interface MemoryDigest {
  total: number;
  byStatus: Record<string, number>;
}

export interface EvalDigest {
  totalRuns: number;
  passed: number;
  failed: number;
  averageScore: number;
}

export interface ReviewDigest {
  period: { since: string; until: string };
  promotedSkills: PromotedSkillDigest[];
  rejectedSkills: RejectedSkillDigest[];
  memories: MemoryDigest;
  evals: EvalDigest;
}

function defaultSince(now: string): string {
  const date = new Date(now);
  date.setDate(date.getDate() - 30);
  return date.toISOString();
}

function snippetOf(markdown: string, maxLen = 80): string {
  const cleaned = markdown.replace(/^#.*$/m, "").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen)}...`;
}

function wasUpdatedInWindow(
  record: { createdAt: string; updatedAt?: string },
  since: string,
): boolean {
  const ts = record.updatedAt ?? record.createdAt;
  return ts >= since;
}

export function generateReviewDigest(store: AgentStore, options: DigestOptions = {}): ReviewDigest {
  const now = options.now ?? new Date().toISOString();
  const since = options.since ?? defaultSince(now);

  const activeVersions = store.listSkillVersionsByStatus("active");
  const promotedSkills: PromotedSkillDigest[] = activeVersions
    .filter((v) => wasUpdatedInWindow(v, since))
    .map((v) => ({
      id: v.id,
      skillId: v.skillId,
      version: v.version,
      bodySnippet: snippetOf(v.bodyMarkdown),
      evalScore: v.evalScore,
      promotedAt: v.updatedAt ?? v.createdAt,
    }));

  const failedVersions = store.listSkillVersionsByStatus("failed_eval");
  const rejectedVersions = store.listSkillVersionsByStatus("rejected");
  const allRejected = [...failedVersions, ...rejectedVersions];
  const rejectedSkills: RejectedSkillDigest[] = allRejected
    .filter((v) => wasUpdatedInWindow(v, since))
    .map((v) => ({
      id: v.id,
      skillId: v.skillId,
      version: v.version,
      reason: v.status === "failed_eval" ? "eval score below threshold" : "rejected",
      evalScore: v.evalScore,
    }));

  const allMemories = [
    ...store.listMemoriesByStatus("active"),
    ...store.listMemoriesByStatus("candidate"),
    ...store.listMemoriesByStatus("demoted"),
    ...store.listMemoriesByStatus("rejected"),
  ];
  const byStatus: Record<string, number> = {};
  for (const memory of allMemories) {
    byStatus[memory.status] = (byStatus[memory.status] ?? 0) + 1;
  }

  const datasets = store.listEvalDatasets();
  const allRuns: EvalRun[] = [];
  for (const dataset of datasets) {
    const runs = store.listEvalRunsForTarget("skill_version", dataset.id);
    for (const run of runs) {
      if (run.createdAt >= since) {
        allRuns.push(run);
      }
    }
  }

  const recentVersionIds = new Set([
    ...activeVersions.map((v) => v.id),
    ...allRejected.map((v) => v.id),
  ]);

  const evalRuns: EvalRun[] = [];
  for (const versionId of recentVersionIds) {
    const runs = store.listEvalRunsForTarget("skill_version", versionId);
    for (const run of runs) {
      if (run.createdAt >= since) {
        evalRuns.push(run);
      }
    }
  }

  const evalPassed = evalRuns.filter((r) => r.passed).length;
  const evalFailed = evalRuns.length - evalPassed;
  const avgScore =
    evalRuns.length > 0
      ? Math.round((evalRuns.reduce((sum, r) => sum + r.score, 0) / evalRuns.length) * 1000) / 1000
      : 0;

  return {
    period: { since, until: now },
    promotedSkills,
    rejectedSkills,
    memories: { total: allMemories.length, byStatus },
    evals: {
      totalRuns: evalRuns.length,
      passed: evalPassed,
      failed: evalFailed,
      averageScore: avgScore,
    },
  };
}
