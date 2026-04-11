import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EvalCaseResult } from "../src/index";
import {
  compareSkillVersionToBaseline,
  createEvalCaseFromTask,
  runSkillVersionEval,
} from "../src/index";
import { AgentStore } from "@purityjs/agent-store";

describe("@purityjs/agent-evals", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("creates replayable eval cases from successful tasks", () => {
    store = new AgentStore();

    store.putEvalDataset({
      id: "dataset_eval_case",
      name: "task replay",
      scope: "project",
      createdAt: "2026-04-11T11:00:00.000Z",
    });
    store.putSession({
      id: "session_eval_case",
      projectId: "purity",
      startedAt: "2026-04-11T11:00:00.000Z",
      createdAt: "2026-04-11T11:00:00.000Z",
    });
    store.putTask({
      id: "task_eval_case",
      sessionId: "session_eval_case",
      title: "Pin workflow refs",
      prompt: "use immutable github action refs",
      status: "completed",
      success: true,
      outcomeSummary: "Pinned mutable refs and re-ran checks.",
      createdAt: "2026-04-11T11:00:01.000Z",
      completedAt: "2026-04-11T11:00:04.000Z",
    });
    store.appendTaskEvent({
      id: "event_eval_case_1",
      taskId: "task_eval_case",
      seq: 1,
      type: "tool_call",
      payload: { tool: "vp_check" },
      createdAt: "2026-04-11T11:00:02.000Z",
    });
    store.appendTaskEvent({
      id: "event_eval_case_2",
      taskId: "task_eval_case",
      seq: 2,
      type: "file_edit",
      payload: { path: ".github/workflows/ci.yml" },
      createdAt: "2026-04-11T11:00:03.000Z",
    });

    const evalCase = createEvalCaseFromTask(store, "task_eval_case", {
      datasetId: "dataset_eval_case",
      caseId: "eval_case_1",
      now: "2026-04-11T11:00:05.000Z",
    });

    expect(evalCase.id).toBe("eval_case_1");
    expect(evalCase.input.filesTouched).toEqual([".github/workflows/ci.yml"]);
    expect(evalCase.input.tools).toEqual(["vp_check"]);
    expect(store.getEvalCase(evalCase.id)).toEqual(evalCase);
  });

  it("runs skill-version evals and persists aggregate metrics", async () => {
    store = new AgentStore();

    store.putEvalDataset({
      id: "dataset_run_eval",
      name: "workflow replay",
      scope: "project",
      createdAt: "2026-04-11T11:10:00.000Z",
    });
    store.putEvalCase({
      id: "case_run_eval_1",
      datasetId: "dataset_run_eval",
      title: "Case 1",
      input: { prompt: "first" },
      expected: { result: "pass" },
      createdAt: "2026-04-11T11:10:01.000Z",
    });
    store.putEvalCase({
      id: "case_run_eval_2",
      datasetId: "dataset_run_eval",
      title: "Case 2",
      input: { prompt: "second" },
      expected: { result: "pass" },
      createdAt: "2026-04-11T11:10:02.000Z",
    });
    store.putSkill({
      id: "skill_eval_run",
      name: "Workflow hardening",
      description: "Pins workflow refs and validates checks.",
      domain: "github-workflow",
      status: "candidate",
      createdAt: "2026-04-11T11:10:03.000Z",
    });
    store.putSkillVersion({
      id: "skill_version_eval_run",
      skillId: "skill_eval_run",
      version: 1,
      bodyMarkdown: "Candidate body",
      status: "candidate",
      createdAt: "2026-04-11T11:10:04.000Z",
    });

    const result = await runSkillVersionEval(store, {
      skillVersionId: "skill_version_eval_run",
      datasetId: "dataset_run_eval",
      runId: "eval_run_1",
      now: "2026-04-11T11:10:05.000Z",
      executor: ({ evalCase }): EvalCaseResult => ({
        caseId: evalCase.id,
        passed: true,
        score: evalCase.id === "case_run_eval_1" ? 0.8 : 1,
      }),
    });

    expect(result.averageScore).toBe(0.9);
    expect(result.passedCases).toBe(2);
    expect(result.run.passed).toBe(true);
    expect(store.listEvalRunsForTarget("skill_version", "skill_version_eval_run")).toEqual([
      result.run,
    ]);
  });

  it("compares candidate skill versions against a baseline", async () => {
    store = new AgentStore();

    store.putEvalDataset({
      id: "dataset_compare",
      name: "compare",
      scope: "project",
      createdAt: "2026-04-11T11:20:00.000Z",
    });
    store.putEvalCase({
      id: "case_compare_1",
      datasetId: "dataset_compare",
      title: "Case 1",
      input: { prompt: "compare" },
      expected: { result: "pass" },
      createdAt: "2026-04-11T11:20:01.000Z",
    });
    store.putSkill({
      id: "skill_compare",
      name: "Compare skill",
      description: "Compare baseline and candidate",
      domain: "repo-tooling",
      status: "approved",
      createdAt: "2026-04-11T11:20:02.000Z",
    });
    store.putSkillVersion({
      id: "skill_version_baseline",
      skillId: "skill_compare",
      version: 1,
      bodyMarkdown: "Baseline",
      status: "active",
      createdAt: "2026-04-11T11:20:03.000Z",
    });
    store.putSkillVersion({
      id: "skill_version_candidate",
      skillId: "skill_compare",
      version: 2,
      bodyMarkdown: "Candidate",
      status: "candidate",
      createdAt: "2026-04-11T11:20:04.000Z",
    });

    const result = await compareSkillVersionToBaseline(store, {
      candidateSkillVersionId: "skill_version_candidate",
      baselineSkillVersionId: "skill_version_baseline",
      datasetId: "dataset_compare",
      now: "2026-04-11T11:20:05.000Z",
      executor: ({ skillVersion }): EvalCaseResult => ({
        caseId: "case_compare_1",
        passed: true,
        score: skillVersion.id === "skill_version_candidate" ? 0.95 : 0.7,
      }),
    });

    expect(result.verdict).toBe("candidate_better");
    expect(result.scoreDelta).toBe(0.25);
    expect(result.candidate.averageScore).toBeGreaterThan(result.baseline.averageScore);
  });
});
