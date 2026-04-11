import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import {
  AgentStore,
  summarizeSkillFeedback,
  summarizeAllActiveSkillFeedback,
  demoteSkillsByFeedback,
} from "../src/index";

const SESSION_ID = "sess_feedback_test";

function seedSession(store: AgentStore): void {
  store.putSession({
    id: SESSION_ID,
    projectId: "proj_test",
    startedAt: "2026-04-11T09:00:00.000Z",
    createdAt: "2026-04-11T09:00:00.000Z",
  });
}

function seedTask(store: AgentStore, taskId: string): void {
  store.putTask({
    id: taskId,
    sessionId: SESSION_ID,
    title: "test task",
    prompt: "test",
    status: "completed",
    success: true,
    createdAt: "2026-04-11T10:00:00.000Z",
  });
}

function makeActiveSkill(store: AgentStore, id: string): void {
  const skill: SkillRecord = {
    id: `skill_${id}`,
    name: `Skill ${id}`,
    description: "test",
    domain: "test",
    status: "active",
    createdAt: "2026-04-11T10:00:00.000Z",
  };
  const version: SkillVersionRecord = {
    id: `sv_${id}`,
    skillId: skill.id,
    version: 1,
    bodyMarkdown: "# test",
    status: "active",
    createdAt: "2026-04-11T10:00:01.000Z",
  };
  store.putSkill(skill);
  store.putSkillVersion(version);
}

describe("skill invocation feedback", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("summarizes feedback for a skill version with mixed outcomes", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "fb1");

    seedTask(store, "task_1");
    store.putSkillInvocation({
      id: "inv_1",
      skillVersionId: "sv_fb1",
      taskId: "task_1",
      usedAt: "2026-04-11T10:01:00.000Z",
      outcome: "success",
      userAccepted: true,
      rollbackRequired: false,
    });
    seedTask(store, "task_2");
    store.putSkillInvocation({
      id: "inv_2",
      skillVersionId: "sv_fb1",
      taskId: "task_2",
      usedAt: "2026-04-11T10:02:00.000Z",
      outcome: "partial",
      userAccepted: false,
      rollbackRequired: false,
    });
    seedTask(store, "task_3");
    store.putSkillInvocation({
      id: "inv_3",
      skillVersionId: "sv_fb1",
      taskId: "task_3",
      usedAt: "2026-04-11T10:03:00.000Z",
      outcome: "failure",
      userAccepted: false,
      rollbackRequired: true,
    });

    const summary = summarizeSkillFeedback(store, "sv_fb1");

    expect(summary.totalInvocations).toBe(3);
    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(2);
    expect(summary.rollbacks).toBe(1);
    expect(summary.acceptanceRate).toBeCloseTo(1 / 3);
    expect(summary.rollbackRate).toBeCloseTo(1 / 3);
  });

  it("returns zero rates for a skill with no invocations", () => {
    store = new AgentStore();
    makeActiveSkill(store, "fb2");

    const summary = summarizeSkillFeedback(store, "sv_fb2");

    expect(summary.totalInvocations).toBe(0);
    expect(summary.acceptanceRate).toBe(0);
    expect(summary.rollbackRate).toBe(0);
  });

  it("handles unknown acceptance (null userAccepted)", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "fb3");

    seedTask(store, "task_unk");
    store.putSkillInvocation({
      id: "inv_unk",
      skillVersionId: "sv_fb3",
      taskId: "task_unk",
      usedAt: "2026-04-11T10:01:00.000Z",
      outcome: "unknown",
    });

    const summary = summarizeSkillFeedback(store, "sv_fb3");
    expect(summary.unknownOutcome).toBe(1);
    expect(summary.accepted).toBe(0);
    expect(summary.rejected).toBe(0);
  });

  it("summarizes all active skill versions", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "a1");
    makeActiveSkill(store, "a2");

    seedTask(store, "task_x");
    store.putSkillInvocation({
      id: "inv_a1",
      skillVersionId: "sv_a1",
      taskId: "task_x",
      usedAt: "2026-04-11T10:01:00.000Z",
      outcome: "success",
      userAccepted: true,
    });

    const summaries = summarizeAllActiveSkillFeedback(store);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.skillVersionId === "sv_a1")?.accepted).toBe(1);
    expect(summaries.find((s) => s.skillVersionId === "sv_a2")?.totalInvocations).toBe(0);
  });
});

describe("feedback-based demotion", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  function addInvocations(
    store: AgentStore,
    svId: string,
    count: number,
    accepted: boolean,
    rollback: boolean,
    startIndex = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      const idx = startIndex + i;
      const taskId = `task_${svId}_${idx}`;
      seedTask(store, taskId);
      store.putSkillInvocation({
        id: `inv_${svId}_${idx}`,
        skillVersionId: svId,
        taskId,
        usedAt: "2026-04-11T10:01:00.000Z",
        outcome: accepted ? "success" : "failure",
        userAccepted: accepted,
        rollbackRequired: rollback,
      });
    }
  }

  it("demotes a skill with low acceptance rate", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "dem1");

    // 1 accepted, 3 rejected = 25% acceptance
    addInvocations(store, "sv_dem1", 1, true, false);
    addInvocations(store, "sv_dem1", 3, false, false, 1);

    const result = demoteSkillsByFeedback(store, { minInvocations: 3 });

    expect(result.demoted).toBe(1);
    expect(result.demotedIds).toContain("sv_dem1");
    expect(store.getSkillVersion("sv_dem1")?.status).toBe("demoted");
  });

  it("demotes a skill with high rollback rate", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "dem2");

    // 3 accepted but 2 with rollbacks = 66% rollback rate
    addInvocations(store, "sv_dem2", 1, true, false);
    addInvocations(store, "sv_dem2", 2, true, true, 1);

    const result = demoteSkillsByFeedback(store, {
      minInvocations: 3,
      maxRollbackRate: 0.3,
    });

    expect(result.demoted).toBe(1);
    expect(result.demotedIds).toContain("sv_dem2");
  });

  it("skips skill with too few invocations", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "dem3");

    addInvocations(store, "sv_dem3", 2, false, true);

    const result = demoteSkillsByFeedback(store, { minInvocations: 3 });

    expect(result.demoted).toBe(0);
    expect(store.getSkillVersion("sv_dem3")?.status).toBe("active");
  });

  it("keeps a skill with good feedback", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "dem4");

    addInvocations(store, "sv_dem4", 5, true, false);

    const result = demoteSkillsByFeedback(store, { minInvocations: 3 });

    expect(result.demoted).toBe(0);
    expect(store.getSkillVersion("sv_dem4")?.status).toBe("active");
  });

  it("returns summaries for all reviewed skills", () => {
    store = new AgentStore();
    seedSession(store);
    makeActiveSkill(store, "dem5");
    makeActiveSkill(store, "dem6");

    addInvocations(store, "sv_dem5", 4, true, false);
    addInvocations(store, "sv_dem6", 4, false, true);

    const result = demoteSkillsByFeedback(store, { minInvocations: 3 });

    expect(result.reviewed).toBe(2);
    expect(result.summaries).toHaveLength(2);
    expect(result.demoted).toBe(1);
    expect(result.demotedIds).toContain("sv_dem6");
  });
});
