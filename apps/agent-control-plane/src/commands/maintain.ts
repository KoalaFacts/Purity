import type { AgentStore } from "@purityjs/agent-store";
import { getLastRunTimestamp, runScheduledMaintenance } from "@purityjs/agent-store";
import type { ScheduledJobName } from "@purityjs/agent-store";
import { DEFAULT_JOB_CONFIGS } from "@purityjs/agent-store";

export async function maintain(store: AgentStore, args: string[]): Promise<void> {
  const action = args[0] ?? "run";

  if (action === "status") {
    console.log("=== Scheduled Maintenance Status ===\n");
    for (const job of DEFAULT_JOB_CONFIGS) {
      const lastRun = getLastRunTimestamp(store, job.name);
      const intervalHours = Math.round(job.intervalMs / (60 * 60 * 1000));
      console.log(`  ${job.name}`);
      console.log(`    interval: ${intervalHours}h`);
      console.log(`    last run: ${lastRun ?? "never"}`);
      if (lastRun) {
        const elapsed = Date.now() - new Date(lastRun).getTime();
        const remaining = job.intervalMs - elapsed;
        if (remaining > 0) {
          const hours = Math.round(remaining / (60 * 60 * 1000));
          console.log(`    next due in: ${hours}h`);
        } else {
          console.log(`    next due in: now (overdue)`);
        }
      }
      console.log();
    }
    return;
  }

  if (action === "run") {
    const force = args.includes("--force");
    const jobFilter = args.find((a) => a.startsWith("--job="));
    const jobName = jobFilter?.split("=")[1] as ScheduledJobName | undefined;

    const jobs = jobName
      ? DEFAULT_JOB_CONFIGS.filter((j) => j.name === jobName)
      : DEFAULT_JOB_CONFIGS;

    if (jobName && jobs.length === 0) {
      console.error(`Unknown job: ${jobName}`);
      console.error(`Available: ${DEFAULT_JOB_CONFIGS.map((j) => j.name).join(", ")}`);
      return;
    }

    const result = runScheduledMaintenance(store, { force, jobs });

    console.log("=== Scheduled Maintenance ===\n");
    for (const job of result.jobs) {
      if (job.skipped) {
        console.log(`  ${job.name}: skipped (last run: ${job.lastRun ?? "never"})`);
      } else {
        console.log(`  ${job.name}: ran`);
      }
    }
    console.log(`\nRan: ${result.ranCount}  Skipped: ${result.skippedCount}`);
    return;
  }

  console.error(`Unknown action: ${action}`);
  console.error("Usage: maintain [run [--force] [--job=<name>] | status]");
}
