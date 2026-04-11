import { afterEach, describe, expect, it } from "vite-plus/test";
import type { EvalCaseResult } from "../src/index";
import { createEvalCaseFromTask, promoteWithEval, validateActiveSkills } from "../src/index";
import {
  AgentStore,
  extractCandidatesForTask,
  generateReviewDigest,
  pruneStore,
  reviewCandidates,
} from "@purityjs/agent-store";

describe("full self-improving pipeline", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("runs the complete loop: capture → extract → review → evaluate → retrieve → prune → digest", async () => {
    store = new AgentStore();
    const t = "2026-04-11T";

    // ── 1. Capture: create a session with a successful task and events ──

    store.putSession({
      id: "sess_pipe",
      projectId: "purity",
      userId: "dev1",
      startedAt: `${t}10:00:00.000Z`,
      createdAt: `${t}10:00:00.000Z`,
    });

    store.putTask({
      id: "task_pipe",
      sessionId: "sess_pipe",
      title: "Add FTS5 search indexing",
      prompt: "add full-text search over task summaries using FTS5",
      status: "completed",
      success: true,
      outcomeSummary:
        "Implemented FTS5 virtual table for task search with auto-indexing on completion.",
      createdAt: `${t}10:00:01.000Z`,
      completedAt: `${t}10:05:00.000Z`,
    });

    store.appendTaskEvent({
      id: "evt_pipe_1",
      taskId: "task_pipe",
      seq: 1,
      type: "tool_call",
      payload: { tool: "grep_search", query: "FTS5" },
      createdAt: `${t}10:01:00.000Z`,
    });

    store.appendTaskEvent({
      id: "evt_pipe_2",
      taskId: "task_pipe",
      seq: 2,
      type: "file_edit",
      payload: { path: "packages/agent-store/src/schema.ts" },
      createdAt: `${t}10:02:00.000Z`,
    });

    store.appendTaskEvent({
      id: "evt_pipe_3",
      taskId: "task_pipe",
      seq: 3,
      type: "file_edit",
      payload: { path: "packages/agent-store/src/store.ts" },
      createdAt: `${t}10:03:00.000Z`,
    });

    store.appendTaskEvent({
      id: "evt_pipe_4",
      taskId: "task_pipe",
      seq: 4,
      type: "validation",
      payload: { command: "vp run --filter @purityjs/agent-store test" },
      createdAt: `${t}10:04:00.000Z`,
    });

    // Complete the task so FTS index gets populated
    store.completeTask("task_pipe", {
      success: true,
      outcomeSummary:
        "Implemented FTS5 virtual table for task search with auto-indexing on completion.",
      completedAt: `${t}10:05:00.000Z`,
    });

    // ── 2. Extract: pull candidate memory + skill from completed task ──

    let idSeq = 0;
    const extraction = extractCandidatesForTask(store, "task_pipe", {
      now: `${t}10:06:00.000Z`,
      idFactory: () => String(++idSeq),
    });

    expect(extraction.skipped).toBe(false);
    expect(extraction.memoryRecords).toHaveLength(1);
    expect(extraction.skillRecords).toHaveLength(1);
    expect(extraction.skillVersionRecords).toHaveLength(1);

    const candidateMemoryId = extraction.memoryRecords[0]!.id;
    const candidateSkillVersionId = extraction.skillVersionRecords[0]!.id;

    // Candidates should be visible
    expect(store.listCandidateMemories().map((m) => m.id)).toContain(candidateMemoryId);
    expect(store.listCandidateSkillVersions().map((sv) => sv.id)).toContain(
      candidateSkillVersionId,
    );

    // ── 3. Review: batch-review promotes the memory and skill ──

    const review = reviewCandidates(store, {
      memory: { minConfidence: 0.5 },
      skill: { minEvalScore: 0.0 },
    });

    expect(review.memoryResults).toHaveLength(1);
    expect(review.promotedMemories).toBe(1);
    expect(review.memoryResults[0]!.promoted).toBe(true);

    // Memory is now active
    expect(store.getMemory(candidateMemoryId)?.status).toBe("active");

    // Skill version was NOT promoted (review requires an eval run with score >= threshold)
    // so it remains candidate — that's expected behavior
    expect(review.skillResults).toHaveLength(1);

    // ── 4. Evaluate: create eval case from the task and run eval ──

    store.putEvalDataset({
      id: "ds_pipe",
      name: "Pipeline test dataset",
      scope: "project",
      createdAt: `${t}10:07:00.000Z`,
    });

    const evalCase = createEvalCaseFromTask(store, "task_pipe", {
      datasetId: "ds_pipe",
      caseId: "case_pipe_1",
      now: `${t}10:07:01.000Z`,
    });

    expect(evalCase.id).toBe("case_pipe_1");
    expect(evalCase.input.title).toBe("Add FTS5 search indexing");

    // Run promote-with-eval — executor simulates a passing eval
    const promotion = await promoteWithEval(store, {
      skillVersionId: candidateSkillVersionId,
      datasetId: "ds_pipe",
      runId: "run_pipe_1",
      now: `${t}10:08:00.000Z`,
      executor: ({ evalCase: ec }): EvalCaseResult => ({
        caseId: ec.id,
        passed: true,
        score: 0.92,
      }),
    });

    expect(promotion.promoted).toBe(true);
    expect(promotion.eval.averageScore).toBe(0.92);
    expect(store.getSkillVersion(candidateSkillVersionId)?.status).toBe("active");

    // ── 5. Retrieve: promoted artifacts should appear in retrieval ──

    const retrieved = store.retrieve({
      projectId: "purity",
      userId: "dev1",
      query: "FTS5 search",
      maxMemories: 5,
      maxSkills: 5,
    });

    expect(retrieved.memories.length).toBeGreaterThanOrEqual(1);
    expect(retrieved.memories.some((m) => m.id === candidateMemoryId)).toBe(true);
    expect(retrieved.skills.length).toBeGreaterThanOrEqual(1);
    expect(retrieved.skills.some((sv) => sv.id === candidateSkillVersionId)).toBe(true);

    // Summaries should include FTS-indexed content
    expect(retrieved.summaries.length).toBeGreaterThanOrEqual(1);

    // ── 6. Validate: active skill should not regress ──

    const validation = await validateActiveSkills(store, {
      now: `${t}10:09:00.000Z`,
      executor: (): EvalCaseResult => ({
        caseId: "case_pipe_1",
        passed: true,
        score: 0.95,
      }),
    });

    expect(validation.totalChecked).toBe(1);
    expect(validation.totalRegressed).toBe(0);
    expect(validation.entries[0]!.regressed).toBe(false);

    // ── 7. Prune: nothing should be pruned from a fresh store ──

    const pruneReport = pruneStore(store, { now: `${t}10:10:00.000Z` });

    expect(pruneReport.dedup.duplicatesRemoved).toBe(0);
    expect(pruneReport.archivedSkills.archived).toBe(0);

    // ── 8. Digest: review digest should reflect the period activity ──

    const digest = generateReviewDigest(store, {
      now: `${t}10:11:00.000Z`,
    });

    expect(digest.period.since).toBeDefined();
    expect(digest.period.until).toBeDefined();
    expect(digest.evals.totalRuns).toBeGreaterThanOrEqual(1);
    expect(digest.memories.total).toBeGreaterThanOrEqual(1);
  });
});
