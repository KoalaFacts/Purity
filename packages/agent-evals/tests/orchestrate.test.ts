import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EvalCaseResult } from "../src/index";
import { promoteWithBaselineComparison, promoteWithEval, validateActiveSkills } from "../src/index";
import { AgentStore } from "@purityjs/agent-store";

describe("promotion orchestrator", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  function seedCommon(s: AgentStore): void {
    s.putEvalDataset({
      id: "ds_orch",
      name: "orchestrator tests",
      scope: "project",
      createdAt: "2026-04-15T10:00:00.000Z",
    });
    s.putEvalCase({
      id: "case_orch_1",
      datasetId: "ds_orch",
      title: "Case 1",
      input: { prompt: "first" },
      expected: { result: "pass" },
      createdAt: "2026-04-15T10:00:01.000Z",
    });
    s.putSkill({
      id: "skill_orch",
      name: "Orchestrated skill",
      description: "Test skill for orchestrator",
      domain: "test",
      status: "candidate",
      createdAt: "2026-04-15T10:00:02.000Z",
    });
  }

  it("promotes a candidate after passing eval", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_candidate",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Candidate body",
      status: "candidate",
      createdAt: "2026-04-15T10:00:03.000Z",
    });

    const result = await promoteWithEval(store, {
      skillVersionId: "sv_orch_candidate",
      datasetId: "ds_orch",
      runId: "run_orch_1",
      now: "2026-04-15T10:00:04.000Z",
      executor: ({ evalCase }): EvalCaseResult => ({
        caseId: evalCase.id,
        passed: true,
        score: 0.95,
      }),
    });

    expect(result.promoted).toBe(true);
    expect(result.eval.averageScore).toBe(0.95);
    expect(result.review.nextStatus).toBe("active");
    expect(store.getSkillVersion("sv_orch_candidate")?.status).toBe("active");
  });

  it("rejects a candidate after failing eval", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_fail",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Weak candidate",
      status: "candidate",
      createdAt: "2026-04-15T10:00:03.000Z",
    });

    const result = await promoteWithEval(store, {
      skillVersionId: "sv_orch_fail",
      datasetId: "ds_orch",
      runId: "run_orch_2",
      now: "2026-04-15T10:00:04.000Z",
      executor: ({ evalCase }): EvalCaseResult => ({
        caseId: evalCase.id,
        passed: false,
        score: 0.3,
      }),
    });

    expect(result.promoted).toBe(false);
    expect(result.eval.averageScore).toBe(0.3);
    expect(result.review.nextStatus).toBe("failed_eval");
    expect(store.getSkillVersion("sv_orch_fail")?.status).toBe("failed_eval");
  });

  it("promotes candidate that outperforms baseline", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_baseline",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Baseline body",
      status: "active",
      createdAt: "2026-04-15T10:00:03.000Z",
    });
    store.putSkillVersion({
      id: "sv_orch_challenger",
      skillId: "skill_orch",
      version: 2,
      bodyMarkdown: "Improved body",
      status: "candidate",
      createdAt: "2026-04-15T10:00:04.000Z",
    });

    const result = await promoteWithBaselineComparison(store, {
      candidateSkillVersionId: "sv_orch_challenger",
      datasetId: "ds_orch",
      now: "2026-04-15T10:00:05.000Z",
      executor: ({ skillVersion }): EvalCaseResult => ({
        caseId: "case_orch_1",
        passed: true,
        score: skillVersion.id === "sv_orch_challenger" ? 0.95 : 0.7,
      }),
    });

    expect(result.promoted).toBe(true);
    expect(result.comparison.verdict).toBe("candidate_better");
    expect(result.comparison.scoreDelta).toBe(0.25);
    expect(store.getSkillVersion("sv_orch_challenger")?.status).toBe("active");
  });

  it("rejects candidate that does not outperform baseline", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_strong_base",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Strong baseline",
      status: "active",
      createdAt: "2026-04-15T10:00:03.000Z",
    });
    store.putSkillVersion({
      id: "sv_orch_weak_cand",
      skillId: "skill_orch",
      version: 2,
      bodyMarkdown: "Weaker candidate",
      status: "candidate",
      createdAt: "2026-04-15T10:00:04.000Z",
    });

    const result = await promoteWithBaselineComparison(store, {
      candidateSkillVersionId: "sv_orch_weak_cand",
      datasetId: "ds_orch",
      now: "2026-04-15T10:00:05.000Z",
      executor: ({ skillVersion }): EvalCaseResult => ({
        caseId: "case_orch_1",
        passed: true,
        score: skillVersion.id === "sv_orch_weak_cand" ? 0.6 : 0.85,
      }),
    });

    expect(result.promoted).toBe(false);
    expect(result.comparison.verdict).toBe("baseline_better");
  });

  it("auto-discovers active baseline when not provided", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_auto_base",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Active baseline",
      status: "active",
      createdAt: "2026-04-15T10:00:03.000Z",
    });
    store.putSkillVersion({
      id: "sv_orch_auto_cand",
      skillId: "skill_orch",
      version: 2,
      bodyMarkdown: "New candidate",
      status: "candidate",
      createdAt: "2026-04-15T10:00:04.000Z",
    });

    const result = await promoteWithBaselineComparison(store, {
      candidateSkillVersionId: "sv_orch_auto_cand",
      datasetId: "ds_orch",
      now: "2026-04-15T10:00:05.000Z",
      executor: ({ skillVersion }): EvalCaseResult => ({
        caseId: "case_orch_1",
        passed: true,
        score: skillVersion.id === "sv_orch_auto_cand" ? 0.92 : 0.8,
      }),
    });

    expect(result.promoted).toBe(true);
    expect(result.comparison.verdict).toBe("candidate_better");
  });

  it("throws when no baseline can be found", async () => {
    store = new AgentStore();
    seedCommon(store);
    store.putSkillVersion({
      id: "sv_orch_no_base",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Lone candidate",
      status: "candidate",
      createdAt: "2026-04-15T10:00:03.000Z",
    });

    await expect(
      promoteWithBaselineComparison(store, {
        candidateSkillVersionId: "sv_orch_no_base",
        datasetId: "ds_orch",
        now: "2026-04-15T10:00:05.000Z",
        executor: (): EvalCaseResult => ({
          caseId: "case_orch_1",
          passed: true,
          score: 0.9,
        }),
      }),
    ).rejects.toThrow(/No baseline found/);
  });

  it("validates active skills and detects regressions", async () => {
    store = new AgentStore();
    seedCommon(store);

    store.putSkillVersion({
      id: "sv_validate_active",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Active skill",
      status: "active",
      createdAt: "2026-04-15T10:00:03.000Z",
    });

    store.putEvalRun({
      id: "run_validate_prev",
      targetType: "skill_version",
      targetId: "sv_validate_active",
      datasetId: "ds_orch",
      passed: true,
      score: 0.95,
      metrics: {},
      createdAt: "2026-04-15T10:00:04.000Z",
    });

    const result = await validateActiveSkills(store, {
      now: "2026-04-15T10:00:05.000Z",
      executor: (): EvalCaseResult => ({
        caseId: "case_orch_1",
        passed: true,
        score: 0.7,
      }),
    });

    expect(result.totalChecked).toBe(1);
    expect(result.totalRegressed).toBe(1);
    expect(result.entries[0]!.regressed).toBe(true);
    expect(result.entries[0]!.eval.averageScore).toBe(0.7);
  });

  it("reports no regression when active skills still pass", async () => {
    store = new AgentStore();
    seedCommon(store);

    store.putSkillVersion({
      id: "sv_validate_ok",
      skillId: "skill_orch",
      version: 1,
      bodyMarkdown: "Stable skill",
      status: "active",
      createdAt: "2026-04-15T10:00:03.000Z",
    });

    store.putEvalRun({
      id: "run_validate_ok",
      targetType: "skill_version",
      targetId: "sv_validate_ok",
      datasetId: "ds_orch",
      passed: true,
      score: 0.9,
      metrics: {},
      createdAt: "2026-04-15T10:00:04.000Z",
    });

    const result = await validateActiveSkills(store, {
      now: "2026-04-15T10:00:05.000Z",
      executor: (): EvalCaseResult => ({
        caseId: "case_orch_1",
        passed: true,
        score: 0.95,
      }),
    });

    expect(result.totalChecked).toBe(1);
    expect(result.totalRegressed).toBe(0);
    expect(result.entries[0]!.regressed).toBe(false);
  });
});
