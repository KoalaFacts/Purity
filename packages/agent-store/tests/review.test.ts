import { afterEach, describe, expect, it } from "vite-plus/test";
import type { MemoryRecord, SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import {
  AgentStore,
  reviewCandidateMemory,
  reviewCandidateSkillVersion,
  reviewCandidates,
} from "../src/index";

describe("candidate review and promotion", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("promotes candidate skill version to active when latest eval passes threshold", () => {
    store = new AgentStore();

    const skill: SkillRecord = {
      id: "skill_review_1",
      name: "Normalize workflow SHAs",
      description: "Promote immutable action refs",
      domain: "github-workflow",
      status: "candidate",
      createdAt: "2026-04-11T14:00:00.000Z",
    };

    const version: SkillVersionRecord = {
      id: "skill_version_review_1",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "Candidate skill body",
      status: "candidate",
      createdAt: "2026-04-11T14:00:01.000Z",
    };

    store.putSkill(skill);
    store.putSkillVersion(version);

    store.putEvalDataset({
      id: "dataset_review_1",
      name: "baseline",
      scope: "project",
      createdAt: "2026-04-11T14:00:02.000Z",
    });

    store.putEvalRun({
      id: "eval_review_1",
      targetType: "skill_version",
      targetId: version.id,
      datasetId: "dataset_review_1",
      passed: true,
      score: 0.95,
      metrics: { successRate: 1 },
      createdAt: "2026-04-11T14:00:03.000Z",
    });

    const result = reviewCandidateSkillVersion(store, version.id, {
      minEvalScore: 0.9,
      now: "2026-04-11T14:00:04.000Z",
    });

    expect(result.promoted).toBe(true);
    expect(result.nextStatus).toBe("active");
    expect(store.getSkillVersion(version.id)?.status).toBe("active");
    expect(store.getSkill(skill.id)?.status).toBe("active");
  });

  it("marks candidate skill version as failed_eval when latest eval fails", () => {
    store = new AgentStore();

    const skill: SkillRecord = {
      id: "skill_review_2",
      name: "Bad candidate",
      description: "Should fail",
      domain: "repo-tooling",
      status: "candidate",
      createdAt: "2026-04-11T14:10:00.000Z",
    };

    const version: SkillVersionRecord = {
      id: "skill_version_review_2",
      skillId: skill.id,
      version: 1,
      bodyMarkdown: "Candidate skill body",
      status: "candidate",
      createdAt: "2026-04-11T14:10:01.000Z",
    };

    store.putSkill(skill);
    store.putSkillVersion(version);

    store.putEvalDataset({
      id: "dataset_review_2",
      name: "regression",
      scope: "project",
      createdAt: "2026-04-11T14:10:02.000Z",
    });

    store.putEvalRun({
      id: "eval_review_2",
      targetType: "skill_version",
      targetId: version.id,
      datasetId: "dataset_review_2",
      passed: false,
      score: 0.89,
      metrics: { successRate: 0.5 },
      createdAt: "2026-04-11T14:10:03.000Z",
    });

    const result = reviewCandidateSkillVersion(store, version.id, {
      minEvalScore: 0.8,
      now: "2026-04-11T14:10:04.000Z",
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("latest_run_failed");
    expect(store.getSkillVersion(version.id)?.status).toBe("failed_eval");
    expect(store.getSkill(skill.id)?.status).toBe("candidate");
  });

  it("rejects low-confidence candidate memory and activates high-confidence memory", () => {
    store = new AgentStore();

    const low: MemoryRecord = {
      id: "mem_review_low",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "low confidence",
      confidence: 0.6,
      source: "trajectory",
      status: "candidate",
      createdAt: "2026-04-11T14:20:00.000Z",
    };

    const high: MemoryRecord = {
      id: "mem_review_high",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "high confidence",
      confidence: 0.96,
      source: "trajectory",
      status: "candidate",
      createdAt: "2026-04-11T14:20:01.000Z",
    };

    store.putMemory(low);
    store.putMemory(high);

    const lowResult = reviewCandidateMemory(store, low.id, {
      minConfidence: 0.9,
      now: "2026-04-11T14:20:02.000Z",
    });
    const highResult = reviewCandidateMemory(store, high.id, {
      minConfidence: 0.9,
      now: "2026-04-11T14:20:02.000Z",
    });

    expect(lowResult.promoted).toBe(false);
    expect(lowResult.reason).toBe("confidence_below_threshold");
    expect(store.getMemory(low.id)?.status).toBe("rejected");

    expect(highResult.promoted).toBe(true);
    expect(store.getMemory(high.id)?.status).toBe("active");
  });

  it("reviews all current candidates and returns a summary report", () => {
    store = new AgentStore();

    const lowMemory: MemoryRecord = {
      id: "mem_batch_low",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "low confidence candidate",
      confidence: 0.5,
      source: "trajectory",
      status: "candidate",
      createdAt: "2026-04-11T15:00:00.000Z",
    };

    const highMemory: MemoryRecord = {
      id: "mem_batch_high",
      scope: "project",
      projectId: "purity",
      kind: "repo",
      fact: "high confidence candidate",
      confidence: 0.97,
      source: "trajectory",
      status: "candidate",
      createdAt: "2026-04-11T15:00:01.000Z",
    };

    const passingSkill: SkillRecord = {
      id: "skill_batch_ok",
      name: "Passing skill",
      description: "Should promote",
      domain: "repo-tooling",
      status: "candidate",
      createdAt: "2026-04-11T15:00:02.000Z",
    };

    const failingSkill: SkillRecord = {
      id: "skill_batch_bad",
      name: "Failing skill",
      description: "Should fail eval",
      domain: "repo-tooling",
      status: "candidate",
      createdAt: "2026-04-11T15:00:03.000Z",
    };

    const passingVersion: SkillVersionRecord = {
      id: "skill_version_batch_ok",
      skillId: passingSkill.id,
      version: 1,
      bodyMarkdown: "ok",
      status: "candidate",
      createdAt: "2026-04-11T15:00:04.000Z",
    };

    const failingVersion: SkillVersionRecord = {
      id: "skill_version_batch_bad",
      skillId: failingSkill.id,
      version: 1,
      bodyMarkdown: "bad",
      status: "candidate",
      createdAt: "2026-04-11T15:00:05.000Z",
    };

    store.putMemory(lowMemory);
    store.putMemory(highMemory);
    store.putSkill(passingSkill);
    store.putSkill(failingSkill);
    store.putSkillVersion(passingVersion);
    store.putSkillVersion(failingVersion);

    store.putEvalDataset({
      id: "dataset_batch",
      name: "batch",
      scope: "project",
      createdAt: "2026-04-11T15:00:06.000Z",
    });

    store.putEvalRun({
      id: "eval_batch_ok",
      targetType: "skill_version",
      targetId: passingVersion.id,
      datasetId: "dataset_batch",
      passed: true,
      score: 0.94,
      metrics: { successRate: 1 },
      createdAt: "2026-04-11T15:00:07.000Z",
    });

    store.putEvalRun({
      id: "eval_batch_bad",
      targetType: "skill_version",
      targetId: failingVersion.id,
      datasetId: "dataset_batch",
      passed: false,
      score: 0.41,
      metrics: { successRate: 0.25 },
      createdAt: "2026-04-11T15:00:08.000Z",
    });

    const report = reviewCandidates(store, {
      memory: { minConfidence: 0.9, now: "2026-04-11T15:00:09.000Z" },
      skill: { minEvalScore: 0.9, now: "2026-04-11T15:00:09.000Z" },
    });

    expect(report.promotedMemories).toBe(1);
    expect(report.rejectedMemories).toBe(1);
    expect(report.promotedSkillVersions).toBe(1);
    expect(report.failedSkillVersions).toBe(1);
    expect(report.skippedMemories).toBe(0);
    expect(report.skippedSkillVersions).toBe(0);

    expect(store.getMemory(lowMemory.id)?.status).toBe("rejected");
    expect(store.getMemory(highMemory.id)?.status).toBe("active");
    expect(store.getSkillVersion(passingVersion.id)?.status).toBe("active");
    expect(store.getSkillVersion(failingVersion.id)?.status).toBe("failed_eval");
  });
});
