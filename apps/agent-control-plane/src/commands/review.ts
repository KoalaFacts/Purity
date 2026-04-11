import type { AgentStore } from "@purityjs/agent-store";
import { reviewCandidates } from "@purityjs/agent-store";

export async function review(store: AgentStore, _args: string[]): Promise<void> {
  const report = reviewCandidates(store, {
    memory: { minConfidence: 0.8 },
    skill: { minEvalScore: 0.8 },
  });

  console.log("Review report:");
  console.log(`  Memories reviewed:  ${report.memoryResults.length}`);
  console.log(`  Skills reviewed:    ${report.skillResults.length}`);
  console.log(`  Promoted memories:  ${report.promotedMemories}`);
  console.log(`  Rejected memories:  ${report.rejectedMemories}`);
  console.log(`  Promoted skills:    ${report.promotedSkillVersions}`);
  console.log(`  Failed skills:      ${report.failedSkillVersions}`);

  for (const m of report.memoryResults) {
    const status = m.promoted ? "promoted" : (m.nextStatus ?? "skipped");
    console.log(`  [memory] ${m.memoryId}: ${status}`);
  }
  for (const s of report.skillResults) {
    const status = s.promoted ? "promoted" : (s.nextStatus ?? "skipped");
    console.log(
      `  [skill]  ${s.skillVersionId}: ${status} (score: ${s.latestEvalScore ?? "none"})`,
    );
  }
}
