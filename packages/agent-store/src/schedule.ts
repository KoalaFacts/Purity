import type { AgentStore } from "./store";
import { demoteSkillsByFeedback, type FeedbackDemotionResult } from "./feedback";
import { generateReviewDigest, type ReviewDigest } from "./digest";
import { pruneStore, type PruneReport } from "./prune";

export type ScheduledJobName = "weekly_prune" | "monthly_digest" | "feedback_demote";

export interface ScheduledJobConfig {
  name: ScheduledJobName;
  intervalMs: number;
}

export const DEFAULT_JOB_CONFIGS: readonly ScheduledJobConfig[] = [
  { name: "weekly_prune", intervalMs: 7 * 24 * 60 * 60 * 1000 },
  { name: "monthly_digest", intervalMs: 30 * 24 * 60 * 60 * 1000 },
  { name: "feedback_demote", intervalMs: 24 * 60 * 60 * 1000 },
] as const;

export interface ScheduledMaintenanceOptions {
  now?: string;
  force?: boolean;
  jobs?: readonly ScheduledJobConfig[];
}

export interface JobRunResult {
  name: ScheduledJobName;
  skipped: boolean;
  lastRun?: string;
  result?: PruneReport | ReviewDigest | FeedbackDemotionResult;
}

export interface ScheduledMaintenanceResult {
  jobs: JobRunResult[];
  ranCount: number;
  skippedCount: number;
}

function metadataKey(name: ScheduledJobName): string {
  return `schedule:${name}:last_run`;
}

function isDue(store: AgentStore, name: ScheduledJobName, intervalMs: number, now: Date): boolean {
  const lastRun = store.getMetadata(metadataKey(name));
  if (!lastRun) return true;
  const elapsed = now.getTime() - new Date(lastRun).getTime();
  return elapsed >= intervalMs;
}

function runJob(store: AgentStore, name: ScheduledJobName, now: string): JobRunResult["result"] {
  switch (name) {
    case "weekly_prune":
      return pruneStore(store, { now });
    case "monthly_digest":
      return generateReviewDigest(store, { now });
    case "feedback_demote":
      return demoteSkillsByFeedback(store, { now });
  }
}

export function getLastRunTimestamp(store: AgentStore, name: ScheduledJobName): string | undefined {
  return store.getMetadata(metadataKey(name));
}

export function runScheduledMaintenance(
  store: AgentStore,
  options: ScheduledMaintenanceOptions = {},
): ScheduledMaintenanceResult {
  const nowDate = options.now ? new Date(options.now) : new Date();
  const now = nowDate.toISOString();
  const force = options.force ?? false;
  const jobs = options.jobs ?? DEFAULT_JOB_CONFIGS;

  const results: JobRunResult[] = [];
  let ranCount = 0;
  let skippedCount = 0;

  for (const job of jobs) {
    const lastRun = store.getMetadata(metadataKey(job.name));

    if (!force && !isDue(store, job.name, job.intervalMs, nowDate)) {
      results.push({ name: job.name, skipped: true, lastRun: lastRun });
      skippedCount++;
      continue;
    }

    const result = runJob(store, job.name, now);
    store.setMetadata(metadataKey(job.name), now);
    results.push({ name: job.name, skipped: false, lastRun: lastRun, result });
    ranCount++;
  }

  return { jobs: results, ranCount, skippedCount };
}
