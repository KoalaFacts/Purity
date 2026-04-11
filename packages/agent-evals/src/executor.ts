/**
 * Trajectory-matching eval executor.
 *
 * Scores a skill version against an eval case by comparing what the
 * skill's markdown body describes against what the original task
 * trajectory actually did. No LLM required — purely deterministic.
 *
 * Scoring dimensions (each 0–1, weighted equally):
 *
 *  1. **File coverage**  — do the files mentioned in the skill body
 *     overlap with the files touched in the original task?
 *  2. **Tool coverage**  — do the tools mentioned in the skill body
 *     overlap with the tools used in the original task?
 *  3. **Outcome overlap** — does the skill body share significant
 *     terms with the expected outcome summary?
 *  4. **Step count**     — does the skill contain numbered/bulleted
 *     steps that plausibly match the event count?
 *
 * A skill that perfectly mirrors the original trajectory scores 1.0.
 * A skill that shares no vocabulary with the trajectory scores ≈ 0.
 */

import type { EvalCaseExecutionContext, EvalCaseResult } from "./index";
import type { JsonObject, JsonValue } from "@purityjs/agent-types";

// ── helpers ────────────────────────────────────────────────────────

function asStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|  (0 when both empty → 1.0) */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Normalize a path to its filename for fuzzy matching. */
function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1]?.toLowerCase() ?? "";
}

/** Extract word tokens ≥ 3 chars from text, lowercased. */
function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  return new Set(words);
}

/** Count markdown list items (numbered or bulleted). */
function countSteps(markdown: string): number {
  const lines = markdown.split("\n");
  let count = 0;
  for (const line of lines) {
    if (/^\s*(\d+[.)]\s+|- \s*|\* \s*)/.test(line)) {
      count++;
    }
  }
  return count;
}

/** Ratio closeness: 1 when a === b, declining as they diverge. */
function ratioScore(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const max = Math.max(a, b);
  if (max === 0) return 1;
  const min = Math.min(a, b);
  return min / max;
}

/** Scan markdown for file paths or basenames that appear in text. */
function extractMentionedFiles(markdown: string): Set<string> {
  const files = new Set<string>();
  // Match paths like `src/foo.ts` or `foo.ts`
  const pathRegex =
    /(?:[\w./-]+\.(?:ts|js|tsx|jsx|json|md|css|html|sql|yaml|yml|toml|mjs|cjs))\b/gi;
  for (const match of markdown.matchAll(pathRegex)) {
    files.add(basename(match[0]));
  }
  return files;
}

/** Scan markdown for known tool names. */
function extractMentionedTools(markdown: string, knownTools: string[]): Set<string> {
  const found = new Set<string>();
  const lower = markdown.toLowerCase();
  for (const tool of knownTools) {
    if (lower.includes(tool.toLowerCase())) {
      found.add(tool.toLowerCase());
    }
  }
  return found;
}

// ── executor ───────────────────────────────────────────────────────

export interface TrajectoryMatchScores {
  fileCoverage: number;
  toolCoverage: number;
  outcomeOverlap: number;
  stepAlignment: number;
  aggregate: number;
}

export interface TrajectoryMatchOptions {
  /** Weights for each dimension. All default to 1. */
  weights?: {
    fileCoverage?: number;
    toolCoverage?: number;
    outcomeOverlap?: number;
    stepAlignment?: number;
  };
  /** Minimum aggregate score to pass. Default: 0.4 */
  passThreshold?: number;
}

export function scoreTrajectoryMatch(
  skillBody: string,
  evalInput: JsonObject,
  evalExpected: JsonObject | undefined,
  options: TrajectoryMatchOptions = {},
): TrajectoryMatchScores {
  const weights = {
    fileCoverage: options.weights?.fileCoverage ?? 1,
    toolCoverage: options.weights?.toolCoverage ?? 1,
    outcomeOverlap: options.weights?.outcomeOverlap ?? 1,
    stepAlignment: options.weights?.stepAlignment ?? 1,
  };

  // Extract ground-truth from eval case
  const expectedFiles = asStringArray(evalExpected?.filesTouched ?? evalInput.filesTouched).map(
    basename,
  );
  const expectedTools = asStringArray(evalExpected?.tools ?? evalInput.tools);
  const outcomeSummary = asString(
    evalExpected?.outcomeSummary ?? evalExpected?.summary ?? evalInput.outcomeSummary,
  );
  const eventCount = Array.isArray(evalInput.events) ? evalInput.events.length : 0;

  // Extract from skill body
  const mentionedFiles = extractMentionedFiles(skillBody);
  const mentionedTools = extractMentionedTools(skillBody, expectedTools);
  const skillTokens = tokenize(skillBody);
  const outcomeTokens = tokenize(outcomeSummary);
  const stepCount = countSteps(skillBody);

  // Score each dimension
  const fileCoverage = jaccard(mentionedFiles, new Set(expectedFiles));
  const toolCoverage = jaccard(mentionedTools, new Set(expectedTools.map((t) => t.toLowerCase())));
  const outcomeOverlap = jaccard(skillTokens, outcomeTokens);
  const stepAlignment =
    eventCount > 0 ? ratioScore(stepCount, eventCount) : stepCount > 0 ? 0.5 : 1;

  // Weighted aggregate
  const totalWeight =
    weights.fileCoverage + weights.toolCoverage + weights.outcomeOverlap + weights.stepAlignment;
  const aggregate =
    (fileCoverage * weights.fileCoverage +
      toolCoverage * weights.toolCoverage +
      outcomeOverlap * weights.outcomeOverlap +
      stepAlignment * weights.stepAlignment) /
    totalWeight;

  return {
    fileCoverage: round(fileCoverage),
    toolCoverage: round(toolCoverage),
    outcomeOverlap: round(outcomeOverlap),
    stepAlignment: round(stepAlignment),
    aggregate: round(aggregate),
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Creates an EvalCaseExecutor that scores by trajectory matching.
 *
 * Usage:
 * ```ts
 * import { createTrajectoryExecutor } from "@purityjs/agent-evals/executor";
 * const executor = createTrajectoryExecutor({ passThreshold: 0.5 });
 * const result = await promoteWithEval(store, { ..., executor });
 * ```
 */
export function createTrajectoryExecutor(
  options: TrajectoryMatchOptions = {},
): (context: EvalCaseExecutionContext) => EvalCaseResult {
  const passThreshold = options.passThreshold ?? 0.4;

  return (context: EvalCaseExecutionContext): EvalCaseResult => {
    const scores = scoreTrajectoryMatch(
      context.skillVersion.bodyMarkdown,
      context.evalCase.input,
      context.evalCase.expected,
      options,
    );

    return {
      caseId: context.evalCase.id,
      passed: scores.aggregate >= passThreshold,
      score: scores.aggregate,
      output: { scores: scores as unknown as JsonObject },
      metrics: {
        fileCoverage: scores.fileCoverage,
        toolCoverage: scores.toolCoverage,
        outcomeOverlap: scores.outcomeOverlap,
        stepAlignment: scores.stepAlignment,
      },
    };
  };
}
