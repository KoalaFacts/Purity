import { afterEach, describe, expect, it } from "vite-plus/test";
import type { SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import { AgentStore, getLastRunTimestamp, runScheduledMaintenance } from "../src/index";

function seedSession(store: AgentStore): void {
  store.putSession({
    id: "sess_sched",
    projectId: "proj_test",
    startedAt: "2026-04-11T09:00:00.000Z",
    createdAt: "2026-04-11T09:00:00.000Z",
  });
}

describe("scheduled maintenance", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("runs all jobs when no prior runs exist", () => {
    store = new AgentStore();
    seedSession(store);

    const result = runScheduledMaintenance(store, {
      now: "2026-04-15T00:00:00.000Z",
    });

    expect(result.ranCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(result.jobs.every((j) => !j.skipped)).toBe(true);
  });

  it("records last-run timestamps after execution", () => {
    store = new AgentStore();
    seedSession(store);

    runScheduledMaintenance(store, { now: "2026-04-15T00:00:00.000Z" });

    expect(getLastRunTimestamp(store, "weekly_prune")).toBe("2026-04-15T00:00:00.000Z");
    expect(getLastRunTimestamp(store, "monthly_digest")).toBe("2026-04-15T00:00:00.000Z");
    expect(getLastRunTimestamp(store, "feedback_demote")).toBe("2026-04-15T00:00:00.000Z");
  });

  it("skips jobs that are not yet due", () => {
    store = new AgentStore();
    seedSession(store);

    // First run
    runScheduledMaintenance(store, { now: "2026-04-15T00:00:00.000Z" });

    // Second run 1 hour later — nothing should be due
    const result = runScheduledMaintenance(store, {
      now: "2026-04-15T01:00:00.000Z",
    });

    expect(result.ranCount).toBe(0);
    expect(result.skippedCount).toBe(3);
    expect(result.jobs.every((j) => j.skipped)).toBe(true);
  });

  it("runs feedback_demote after 24h interval", () => {
    store = new AgentStore();
    seedSession(store);

    runScheduledMaintenance(store, { now: "2026-04-15T00:00:00.000Z" });

    // 25 hours later — only feedback_demote (24h) should be due
    const result = runScheduledMaintenance(store, {
      now: "2026-04-16T01:00:00.000Z",
    });

    const feedbackJob = result.jobs.find((j) => j.name === "feedback_demote")!;
    const pruneJob = result.jobs.find((j) => j.name === "weekly_prune")!;
    const digestJob = result.jobs.find((j) => j.name === "monthly_digest")!;

    expect(feedbackJob.skipped).toBe(false);
    expect(pruneJob.skipped).toBe(true);
    expect(digestJob.skipped).toBe(true);
    expect(result.ranCount).toBe(1);
  });

  it("forces all jobs regardless of timestamps", () => {
    store = new AgentStore();
    seedSession(store);

    runScheduledMaintenance(store, { now: "2026-04-15T00:00:00.000Z" });

    // Force immediately after
    const result = runScheduledMaintenance(store, {
      now: "2026-04-15T00:00:01.000Z",
      force: true,
    });

    expect(result.ranCount).toBe(3);
    expect(result.skippedCount).toBe(0);
  });

  it("runs a single job via custom config", () => {
    store = new AgentStore();
    seedSession(store);

    const result = runScheduledMaintenance(store, {
      now: "2026-04-15T00:00:00.000Z",
      jobs: [{ name: "weekly_prune", intervalMs: 7 * 24 * 60 * 60 * 1000 }],
    });

    expect(result.ranCount).toBe(1);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]!.name).toBe("weekly_prune");
  });

  it("returns job results from actual maintenance functions", () => {
    store = new AgentStore();
    seedSession(store);

    // Seed some data so prune has something to report on
    store.putMemory({
      id: "mem_sched_1",
      scope: "global",
      kind: "fact",
      fact: "test memory for schedule",
      confidence: 0.8,
      source: "test",
      status: "active",
      createdAt: "2026-04-10T00:00:00.000Z",
    });

    const result = runScheduledMaintenance(store, {
      now: "2026-04-15T00:00:00.000Z",
    });

    const pruneJob = result.jobs.find((j) => j.name === "weekly_prune")!;
    expect(pruneJob.result).toBeDefined();
    expect(pruneJob.result).toHaveProperty("dedup");
  });

  it("runs weekly_prune after 7 days", () => {
    store = new AgentStore();
    seedSession(store);

    runScheduledMaintenance(store, { now: "2026-04-15T00:00:00.000Z" });

    // 8 days later — weekly_prune and feedback_demote should run
    const result = runScheduledMaintenance(store, {
      now: "2026-04-23T00:00:00.000Z",
    });

    const pruneJob = result.jobs.find((j) => j.name === "weekly_prune")!;
    const digestJob = result.jobs.find((j) => j.name === "monthly_digest")!;

    expect(pruneJob.skipped).toBe(false);
    expect(digestJob.skipped).toBe(true);
  });
});

describe("store metadata", () => {
  let store: AgentStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("returns undefined for missing keys", () => {
    store = new AgentStore();
    expect(store.getMetadata("nonexistent")).toBeUndefined();
  });

  it("sets and gets metadata", () => {
    store = new AgentStore();
    store.setMetadata("test_key", "test_value");
    expect(store.getMetadata("test_key")).toBe("test_value");
  });

  it("overwrites existing metadata", () => {
    store = new AgentStore();
    store.setMetadata("test_key", "value1");
    store.setMetadata("test_key", "value2");
    expect(store.getMetadata("test_key")).toBe("value2");
  });
});
