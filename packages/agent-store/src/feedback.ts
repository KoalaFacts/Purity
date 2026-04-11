import type { AgentStore } from "./store";

export interface SkillFeedbackSummary {
  skillVersionId: string;
  totalInvocations: number;
  accepted: number;
  rejected: number;
  rollbacks: number;
  unknownOutcome: number;
  acceptanceRate: number;
  rollbackRate: number;
}

export interface FeedbackDemotionOptions {
  /** Minimum invocations before demotion is considered. Default: 3. */
  minInvocations?: number;
  /** Demote if acceptance rate falls below this. Default: 0.5. */
  minAcceptanceRate?: number;
  /** Demote if rollback rate exceeds this. Default: 0.3. */
  maxRollbackRate?: number;
  now?: string;
}

export interface FeedbackDemotionResult {
  reviewed: number;
  demoted: number;
  demotedIds: string[];
  summaries: SkillFeedbackSummary[];
}

/**
 * Aggregate invocation feedback for a single skill version.
 */
export function summarizeSkillFeedback(
  store: AgentStore,
  skillVersionId: string,
): SkillFeedbackSummary {
  const invocations = store.listSkillInvocationsByVersion(skillVersionId);
  const total = invocations.length;

  let accepted = 0;
  let rejected = 0;
  let rollbacks = 0;
  let unknownOutcome = 0;

  for (const inv of invocations) {
    if (inv.rollbackRequired) {
      rollbacks++;
    }
    if (inv.userAccepted === true) {
      accepted++;
    } else if (inv.userAccepted === false) {
      rejected++;
    } else {
      unknownOutcome++;
    }
  }

  return {
    skillVersionId,
    totalInvocations: total,
    accepted,
    rejected,
    rollbacks,
    unknownOutcome,
    acceptanceRate: total > 0 ? accepted / total : 0,
    rollbackRate: total > 0 ? rollbacks / total : 0,
  };
}

/**
 * Aggregate feedback for all active skill versions.
 */
export function summarizeAllActiveSkillFeedback(store: AgentStore): SkillFeedbackSummary[] {
  const activeVersions = store.listSkillVersionsByStatus("active");
  return activeVersions.map((v) => summarizeSkillFeedback(store, v.id));
}

/**
 * Demote active skill versions that have poor invocation feedback.
 *
 * A skill version is demoted if it has at least `minInvocations` invocations
 * and either its acceptance rate is below `minAcceptanceRate` or its rollback
 * rate exceeds `maxRollbackRate`.
 */
export function demoteSkillsByFeedback(
  store: AgentStore,
  options: FeedbackDemotionOptions = {},
): FeedbackDemotionResult {
  const minInvocations = options.minInvocations ?? 3;
  const minAcceptanceRate = options.minAcceptanceRate ?? 0.5;
  const maxRollbackRate = options.maxRollbackRate ?? 0.3;
  const now = options.now ?? new Date().toISOString();

  const summaries = summarizeAllActiveSkillFeedback(store);
  const demotedIds: string[] = [];

  for (const summary of summaries) {
    if (summary.totalInvocations < minInvocations) continue;

    const shouldDemote =
      summary.acceptanceRate < minAcceptanceRate || summary.rollbackRate > maxRollbackRate;

    if (shouldDemote) {
      store.setSkillVersionStatus(summary.skillVersionId, "demoted", {
        updatedAt: now,
      });
      demotedIds.push(summary.skillVersionId);
    }
  }

  return {
    reviewed: summaries.length,
    demoted: demotedIds.length,
    demotedIds,
    summaries,
  };
}
