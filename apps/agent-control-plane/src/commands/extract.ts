import type { AgentStore } from "@purityjs/agent-store";
import { extractCandidatesForTask } from "@purityjs/agent-store";

export async function extract(store: AgentStore, args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId) {
    console.error("Usage: agent-cp extract <taskId>");
    process.exit(1);
  }

  const result = extractCandidatesForTask(store, taskId);

  if (result.skipped) {
    console.log(`Extraction skipped for task ${taskId}: ${result.reason ?? "unknown reason"}`);
    return;
  }

  console.log(`Extraction complete for task ${taskId}`);
  console.log(`  Memories extracted: ${result.memoryRecords.length}`);
  console.log(`  Skills extracted:   ${result.skillVersionRecords.length}`);

  for (const mem of result.memoryRecords) {
    console.log(`  [memory] ${mem.kind}: ${mem.fact.slice(0, 80)}`);
  }
  for (const sv of result.skillVersionRecords) {
    console.log(`  [skill]  v${sv.version}: ${sv.bodyMarkdown.split("\n")[0]?.slice(0, 80)}`);
  }
}
