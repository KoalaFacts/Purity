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
  period: {
    since: string;
    until: string;
  };
  promotedSkills: PromotedSkillDigest[];
  rejectedSkills: RejectedSkillDigest[];
  memories: MemoryDigest;
  evals: EvalDigest;
}
export declare function generateReviewDigest(
  store: AgentStore,
  options?: DigestOptions,
): ReviewDigest;
