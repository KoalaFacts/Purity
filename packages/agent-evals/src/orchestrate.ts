import type { AgentStore } from "@purityjs/agent-store";
import { reviewCandidateSkillVersion } from "@purityjs/agent-store";
import type { SkillPromotionOptions, SkillPromotionResult } from "@purityjs/agent-store";
import type {
  CompareSkillVersionToBaselineResult,
  EvalCaseExecutor,
  RunSkillVersionEvalResult,
} from "./index";
import { compareSkillVersionToBaseline, runSkillVersionEval } from "./index";

export interface PromoteWithEvalOptions {
  skillVersionId: string;
  datasetId: string;
  executor: EvalCaseExecutor;
  promotion?: SkillPromotionOptions;
  runId?: string;
  now?: string;
  idFactory?: () => string;
}

export interface PromoteWithEvalResult {
  eval: RunSkillVersionEvalResult;
  review: SkillPromotionResult;
  promoted: boolean;
}

export interface PromoteWithBaselineOptions {
  candidateSkillVersionId: string;
  datasetId: string;
  executor: EvalCaseExecutor;
  baselineSkillVersionId?: string;
  promotion?: SkillPromotionOptions;
  now?: string;
  idFactory?: () => string;
}

export interface PromoteWithBaselineResult {
  comparison: CompareSkillVersionToBaselineResult;
  review: SkillPromotionResult;
  promoted: boolean;
}

function findActiveBaseline(
  store: AgentStore,
  candidateSkillVersionId: string,
): string | undefined {
  const candidate = store.getSkillVersion(candidateSkillVersionId);
  if (!candidate) return undefined;

  const activeVersions = store.listSkillVersionsByStatus("active");
  const baseline = activeVersions.find((v) => v.skillId === candidate.skillId);
  return baseline?.id;
}

export async function promoteWithEval(
  store: AgentStore,
  options: PromoteWithEvalOptions,
): Promise<PromoteWithEvalResult> {
  const evalResult = await runSkillVersionEval(store, {
    skillVersionId: options.skillVersionId,
    datasetId: options.datasetId,
    executor: options.executor,
    runId: options.runId,
    now: options.now,
    idFactory: options.idFactory,
  });

  const review = reviewCandidateSkillVersion(store, options.skillVersionId, {
    ...options.promotion,
    now: options.now,
  });

  return {
    eval: evalResult,
    review,
    promoted: review.promoted,
  };
}

export async function promoteWithBaselineComparison(
  store: AgentStore,
  options: PromoteWithBaselineOptions,
): Promise<PromoteWithBaselineResult> {
  const baselineId =
    options.baselineSkillVersionId ?? findActiveBaseline(store, options.candidateSkillVersionId);

  if (!baselineId) {
    throw new Error(
      `No baseline found for candidate ${options.candidateSkillVersionId}. ` +
        "Provide baselineSkillVersionId or ensure an active version exists for the same skill.",
    );
  }

  const comparison = await compareSkillVersionToBaseline(store, {
    candidateSkillVersionId: options.candidateSkillVersionId,
    baselineSkillVersionId: baselineId,
    datasetId: options.datasetId,
    executor: options.executor,
    now: options.now,
    idFactory: options.idFactory,
  });

  if (comparison.verdict !== "candidate_better") {
    const review = reviewCandidateSkillVersion(store, options.candidateSkillVersionId, {
      ...options.promotion,
      now: options.now,
    });
    return { comparison, review, promoted: false };
  }

  const review = reviewCandidateSkillVersion(store, options.candidateSkillVersionId, {
    ...options.promotion,
    now: options.now,
  });

  return {
    comparison,
    review,
    promoted: review.promoted,
  };
}

export interface ValidateActiveSkillsOptions {
  executor: EvalCaseExecutor;
  now?: string;
  idFactory?: () => string;
}

export interface SkillValidationEntry {
  skillVersionId: string;
  datasetId: string;
  eval: RunSkillVersionEvalResult;
  regressed: boolean;
}

export interface ValidateActiveSkillsResult {
  entries: SkillValidationEntry[];
  totalChecked: number;
  totalRegressed: number;
}

export async function validateActiveSkills(
  store: AgentStore,
  options: ValidateActiveSkillsOptions,
): Promise<ValidateActiveSkillsResult> {
  const activeVersions = store.listSkillVersionsByStatus("active");
  const entries: SkillValidationEntry[] = [];

  for (const version of activeVersions) {
    const runs = store.listEvalRunsForTarget("skill_version", version.id);
    if (runs.length === 0) continue;

    const latestRun = runs[0]!;
    const dataset = store.getEvalDataset(latestRun.datasetId);
    if (!dataset) continue;

    const cases = store.listEvalCasesByDataset(dataset.id);
    if (cases.length === 0) continue;

    const evalResult = await runSkillVersionEval(store, {
      skillVersionId: version.id,
      datasetId: dataset.id,
      executor: options.executor,
      now: options.now,
      idFactory: options.idFactory,
    });

    const regressed = !evalResult.run.passed || evalResult.averageScore < latestRun.score;

    entries.push({
      skillVersionId: version.id,
      datasetId: dataset.id,
      eval: evalResult,
      regressed,
    });
  }

  return {
    entries,
    totalChecked: entries.length,
    totalRegressed: entries.filter((e) => e.regressed).length,
  };
}
