import type { AgentStore } from "@purityjs/agent-store";
import { pruneStore } from "@purityjs/agent-store";

export async function prune(store: AgentStore, _args: string[]): Promise<void> {
  const report = pruneStore(store);

  console.log("Prune report:");
  console.log(`  Duplicates removed:   ${report.dedup.duplicatesRemoved}`);
  console.log(
    `  Stale demoted:        ${report.staleCandidates.memoriesDemoted + report.staleCandidates.skillVersionsDemoted}`,
  );
  console.log(`  Skills archived:      ${report.archivedSkills.archived}`);
  console.log(`  Tasks compacted:      ${report.compactedTasks.tasksCompacted}`);
}
