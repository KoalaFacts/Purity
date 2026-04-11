import type {
  EvalCase,
  EvalDatasetRecord,
  EvalRun,
  JsonObject,
  SkillVersionRecord,
  TaskEvent,
  TaskRecord,
} from "@purityjs/agent-types";
import type { AgentStore } from "@purityjs/agent-store";

export interface CreateEvalCaseFromTaskOptions {
  datasetId: string;
  caseId?: string;
  title?: string;
  now?: string;
  persist?: boolean;
  includeEvents?: boolean;
  maxEvents?: number;
  idFactory?: () => string;
}

export interface EvalCaseExecutionContext {
  store: AgentStore;
  dataset: EvalDatasetRecord;
  evalCase: EvalCase;
  skillVersion: SkillVersionRecord;
}

export interface EvalCaseResult {
  caseId: string;
  passed: boolean;
  score?: number;
  output?: JsonObject;
  metrics?: JsonObject;
}

export type EvalCaseExecutor = (
  context: EvalCaseExecutionContext,
) => EvalCaseResult | Promise<EvalCaseResult>;

export interface RunSkillVersionEvalOptions {
  skillVersionId: string;
  datasetId: string;
  executor: EvalCaseExecutor;
  now?: string;
  runId?: string;
  persist?: boolean;
  requireAllCasesPassed?: boolean;
  minAverageScore?: number;
  idFactory?: () => string;
}

export interface RunSkillVersionEvalResult {
  dataset: EvalDatasetRecord;
  skillVersion: SkillVersionRecord;
  run: EvalRun;
  caseResults: EvalCaseResult[];
  averageScore: number;
  passedCases: number;
  failedCases: number;
}

export interface CompareSkillVersionToBaselineOptions {
  candidateSkillVersionId: string;
  baselineSkillVersionId: string;
  datasetId: string;
  executor: EvalCaseExecutor;
  now?: string;
  persist?: boolean;
  requireAllCasesPassed?: boolean;
  minAverageScore?: number;
  idFactory?: () => string;
}

export interface CompareSkillVersionToBaselineResult {
  candidate: RunSkillVersionEvalResult;
  baseline: RunSkillVersionEvalResult;
  verdict: "candidate_better" | "baseline_better" | "tie";
  scoreDelta: number;
}

function nowIso(explicit?: string): string {
  return explicit ?? new Date().toISOString();
}

function defaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `${Date.now().toString(36)}_${counter.toString(36)}`;
  };
}

function clampScore(score: number | undefined, passed: boolean): number {
  if (score === undefined || Number.isNaN(score)) {
    return passed ? 1 : 0;
  }
  return Math.max(0, Math.min(1, score));
}

function roundScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

function collectTouchedFiles(events: TaskEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    if (event.type !== "file_edit") continue;
    const path = event.payload.path;
    if (typeof path === "string" && path.trim().length > 0) {
      files.add(path);
    }
  }
  return [...files];
}

function collectTools(events: TaskEvent[]): string[] {
  const tools = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const tool = event.payload.tool ?? event.payload.name;
    if (typeof tool === "string" && tool.trim().length > 0) {
      tools.add(tool);
    }
  }
  return [...tools];
}

function toReplayEvent(event: TaskEvent): JsonObject {
  return {
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

function toReplayExpected(
  task: TaskRecord,
  summary: string,
  files: string[],
  tools: string[],
): JsonObject {
  return {
    outcomeSummary: task.outcomeSummary ?? "",
    summary,
    filesTouched: files,
    tools,
  };
}

export function createEvalCaseFromTask(
  store: AgentStore,
  taskId: string,
  options: CreateEvalCaseFromTaskOptions,
): EvalCase {
  const task = store.getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  const session = store.getSession(task.sessionId);
  if (!session) {
    throw new Error(`Session ${task.sessionId} not found for task ${taskId}`);
  }

  const events = store.listTaskEvents(taskId);
  const limitedEvents = events.slice(0, options.maxEvents ?? events.length);
  const summary = store.summarizeTask(taskId) ?? task.outcomeSummary ?? task.prompt;
  const filesTouched = collectTouchedFiles(events);
  const tools = collectTools(events);
  const makeId = options.idFactory ?? defaultIdFactory();

  const input: JsonObject = {
    taskId: task.id,
    sessionId: task.sessionId,
    projectId: session.projectId,
    title: task.title,
    prompt: task.prompt,
    summary,
    outcomeSummary: task.outcomeSummary ?? "",
    filesTouched,
    tools,
  };

  if (options.includeEvents !== false) {
    input.events = limitedEvents.map((event) => toReplayEvent(event));
  }

  const evalCase: EvalCase = {
    id: options.caseId ?? `eval_case_${makeId()}`,
    datasetId: options.datasetId,
    title: options.title ?? task.title,
    input,
    expected: toReplayExpected(task, summary, filesTouched, tools),
    createdAt: nowIso(options.now),
    updatedAt: nowIso(options.now),
  };

  if (options.persist !== false) {
    store.putEvalCase(evalCase);
  }

  return evalCase;
}

export async function runSkillVersionEval(
  store: AgentStore,
  options: RunSkillVersionEvalOptions,
): Promise<RunSkillVersionEvalResult> {
  const dataset = store.getEvalDataset(options.datasetId);
  if (!dataset) {
    throw new Error(`Eval dataset ${options.datasetId} not found`);
  }

  const skillVersion = store.getSkillVersion(options.skillVersionId);
  if (!skillVersion) {
    throw new Error(`Skill version ${options.skillVersionId} not found`);
  }

  const evalCases = store.listEvalCasesByDataset(dataset.id);
  if (evalCases.length === 0) {
    throw new Error(`Eval dataset ${dataset.id} has no cases`);
  }

  const caseResults: EvalCaseResult[] = [];
  for (const evalCase of evalCases) {
    const result = await options.executor({
      store,
      dataset,
      evalCase,
      skillVersion,
    });
    caseResults.push({
      ...result,
      caseId: result.caseId || evalCase.id,
      score: clampScore(result.score, result.passed),
    });
  }

  const scores = caseResults.map((result) => clampScore(result.score, result.passed));
  const passedCases = caseResults.filter((result) => result.passed).length;
  const failedCases = caseResults.length - passedCases;
  const averageScore = roundScore(
    scores.reduce((sum, score) => sum + score, 0) / caseResults.length,
  );
  const requireAllCasesPassed = options.requireAllCasesPassed ?? true;
  const minAverageScore = options.minAverageScore ?? 0.8;
  const passed = averageScore >= minAverageScore && (!requireAllCasesPassed || failedCases === 0);

  const metrics: JsonObject = {
    caseCount: caseResults.length,
    passedCases,
    failedCases,
    averageScore,
    minCaseScore: roundScore(Math.min(...scores)),
    maxCaseScore: roundScore(Math.max(...scores)),
    requireAllCasesPassed,
    minAverageScore,
  };

  const makeId = options.idFactory ?? defaultIdFactory();
  const run: EvalRun = {
    id: options.runId ?? `eval_run_${makeId()}`,
    targetType: "skill_version",
    targetId: skillVersion.id,
    datasetId: dataset.id,
    passed,
    score: averageScore,
    metrics,
    createdAt: nowIso(options.now),
    updatedAt: nowIso(options.now),
  };

  if (options.persist !== false) {
    store.putEvalRun(run);
  }

  return {
    dataset,
    skillVersion,
    run,
    caseResults,
    averageScore,
    passedCases,
    failedCases,
  };
}

function candidateOutperformsBaseline(
  candidate: RunSkillVersionEvalResult,
  baseline: RunSkillVersionEvalResult,
): boolean {
  if (candidate.run.passed !== baseline.run.passed) {
    return candidate.run.passed;
  }

  if (candidate.averageScore !== baseline.averageScore) {
    return candidate.averageScore > baseline.averageScore;
  }

  if (candidate.failedCases !== baseline.failedCases) {
    return candidate.failedCases < baseline.failedCases;
  }

  return false;
}

export async function compareSkillVersionToBaseline(
  store: AgentStore,
  options: CompareSkillVersionToBaselineOptions,
): Promise<CompareSkillVersionToBaselineResult> {
  const sharedOptions = {
    datasetId: options.datasetId,
    executor: options.executor,
    now: options.now,
    persist: options.persist,
    requireAllCasesPassed: options.requireAllCasesPassed,
    minAverageScore: options.minAverageScore,
    idFactory: options.idFactory,
  };

  const baseline = await runSkillVersionEval(store, {
    skillVersionId: options.baselineSkillVersionId,
    ...sharedOptions,
  });
  const candidate = await runSkillVersionEval(store, {
    skillVersionId: options.candidateSkillVersionId,
    ...sharedOptions,
  });

  const verdict = candidateOutperformsBaseline(candidate, baseline)
    ? "candidate_better"
    : candidateOutperformsBaseline(baseline, candidate)
      ? "baseline_better"
      : "tie";

  return {
    candidate,
    baseline,
    verdict,
    scoreDelta: roundScore(candidate.averageScore - baseline.averageScore),
  };
}

export {
  promoteWithBaselineComparison,
  promoteWithEval,
  validateActiveSkills,
} from "./orchestrate";
export type {
  PromoteWithBaselineOptions,
  PromoteWithBaselineResult,
  PromoteWithEvalOptions,
  PromoteWithEvalResult,
  SkillValidationEntry,
  ValidateActiveSkillsOptions,
  ValidateActiveSkillsResult,
} from "./orchestrate";

export { createTrajectoryExecutor, scoreTrajectoryMatch } from "./executor";
export type { TrajectoryMatchOptions, TrajectoryMatchScores } from "./executor";
