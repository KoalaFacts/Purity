import type { AgentStore } from "@purityjs/agent-store";
import { generateReviewDigest } from "@purityjs/agent-store";

export async function digest(store: AgentStore, _args: string[]): Promise<void> {
  const result = generateReviewDigest(store);

  console.log("=== Review Digest ===");
  console.log();
  console.log(`Period: ${result.period.since} to ${result.period.until}`);
  console.log();
  console.log("Promoted skills:");
  if (result.promotedSkills.length === 0) {
    console.log("  (none)");
  }
  for (const skill of result.promotedSkills) {
    console.log(`  ${skill.id}: score ${skill.evalScore ?? "n/a"}`);
  }

  console.log();
  console.log("Rejected skills:");
  if (result.rejectedSkills.length === 0) {
    console.log("  (none)");
  }
  for (const skill of result.rejectedSkills) {
    console.log(`  ${skill.id}: ${skill.reason}`);
  }

  console.log();
  console.log("Eval summary:");
  console.log(`  Total runs:  ${result.evals.totalRuns}`);
  console.log(`  Passed:      ${result.evals.passed}`);
  console.log(`  Failed:      ${result.evals.failed}`);
  console.log(`  Avg score:   ${result.evals.averageScore}`);

  console.log();
  console.log("Memory summary:");
  console.log(`  Total:       ${result.memories.total}`);
  for (const [status, count] of Object.entries(result.memories.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
}
