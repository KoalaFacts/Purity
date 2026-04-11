import { afterEach, describe, expect, it } from "vite-plus/test";
import type { MemoryRecord, SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import { AgentStore } from "../src/store";
import { generateReviewDigest } from "../src/digest";

describe("generateReviewDigest", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("produces a digest with promoted and rejected skills", () => {
    store = new AgentStore();

    const skill: SkillRecord = {
      id: "skill_digest",
      name: "Test skill",
      description: "desc",
      domain: "test",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
    };
    store.putSkill(skill);

    const promoted: SkillVersionRecord = {
      id: "sv_promoted",
      skillId: skill.id,
      version: 2,
      bodyMarkdown: "Use immutable SHAs in workflows.",
      status: "active",
      evalScore: 0.92,
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    };
    store.putSkillVersion(promoted);

    const failed: SkillVersionRecord = {
      id: "sv_failed",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "Bad draft",
      status: "failed_eval",
      evalScore: 0.3,
      createdAt: "2026-03-18T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    };
    store.putSkillVersion(failed);

    const mem: MemoryRecord = {
      id: "mem_digest",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "Use vp commands.",
      confidence: 0.8,
      source: "trajectory",
      status: "active",
      createdAt: "2026-03-20T00:00:00.000Z",
    };
    store.putMemory(mem);

    const digest = generateReviewDigest(store, {
      since: "2026-04-01T00:00:00.000Z",
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(digest.period.since).toBe("2026-04-01T00:00:00.000Z");
    expect(digest.period.until).toBe("2026-04-10T00:00:00.000Z");

    expect(digest.promotedSkills).toHaveLength(1);
    expect(digest.promotedSkills[0]!.id).toBe("sv_promoted");
    expect(digest.promotedSkills[0]!.evalScore).toBe(0.92);

    expect(digest.rejectedSkills).toHaveLength(1);
    expect(digest.rejectedSkills[0]!.id).toBe("sv_failed");
    expect(digest.rejectedSkills[0]!.reason).toBe("eval score below threshold");

    expect(digest.memories.total).toBe(1);
    expect(digest.memories.byStatus.active).toBe(1);
  });

  it("handles empty store gracefully", () => {
    store = new AgentStore();

    const digest = generateReviewDigest(store, {
      since: "2026-04-01T00:00:00.000Z",
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(digest.promotedSkills).toHaveLength(0);
    expect(digest.rejectedSkills).toHaveLength(0);
    expect(digest.memories.total).toBe(0);
    expect(digest.evals.totalRuns).toBe(0);
    expect(digest.evals.averageScore).toBe(0);
  });

  it("includes eval run stats for the period", () => {
    store = new AgentStore();

    const skill: SkillRecord = {
      id: "skill_eval_digest",
      name: "Eval skill",
      description: "desc",
      domain: "test",
      status: "active",
      createdAt: "2026-03-15T00:00:00.000Z",
    };
    store.putSkill(skill);

    store.putSkillVersion({
      id: "sv_eval_digest",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "body",
      status: "active",
      evalScore: 0.9,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    });

    store.putEvalDataset({
      id: "ds_digest",
      name: "digest test",
      scope: "project",
      createdAt: "2026-03-15T00:00:00.000Z",
    });

    store.putEvalRun({
      id: "run_digest_1",
      targetType: "skill_version",
      targetId: "sv_eval_digest",
      datasetId: "ds_digest",
      passed: true,
      score: 0.9,
      metrics: {},
      createdAt: "2026-04-05T00:00:00.000Z",
    });

    store.putEvalRun({
      id: "run_digest_2",
      targetType: "skill_version",
      targetId: "sv_eval_digest",
      datasetId: "ds_digest",
      passed: false,
      score: 0.4,
      metrics: {},
      createdAt: "2026-04-06T00:00:00.000Z",
    });

    const digest = generateReviewDigest(store, {
      since: "2026-04-01T00:00:00.000Z",
      now: "2026-04-10T00:00:00.000Z",
    });

    expect(digest.evals.totalRuns).toBe(2);
    expect(digest.evals.passed).toBe(1);
    expect(digest.evals.failed).toBe(1);
    expect(digest.evals.averageScore).toBe(0.65);
  });
});
