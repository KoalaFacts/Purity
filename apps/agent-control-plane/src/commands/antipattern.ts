import type { AgentStore } from "@purityjs/agent-store";
import { extractAntiPatternsForTask, listAntiPatterns } from "@purityjs/agent-store";

export async function antipattern(store: AgentStore, args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "extract") {
    const taskId = args[1];
    if (!taskId) {
      console.error("Usage: agent-cp antipattern extract <taskId>");
      return;
    }

    const result = extractAntiPatternsForTask(store, taskId);
    if (result.skipped) {
      console.log(`Skipped: ${result.reason}`);
      return;
    }

    console.log(`Extracted ${result.antiPatterns.length} anti-pattern(s):`);
    for (const ap of result.antiPatterns) {
      console.log(`  ${ap.id}: ${ap.fact.split("\n")[0]}`);
    }
    return;
  }

  if (sub === "list") {
    const statusArg = args[1] ?? "active";
    const validStatuses = ["candidate", "active", "archived"] as const;
    if (!validStatuses.includes(statusArg as (typeof validStatuses)[number])) {
      console.error(`Invalid status: ${statusArg}. Use: ${validStatuses.join(", ")}`);
      return;
    }

    const patterns = listAntiPatterns(store, statusArg as "candidate" | "active" | "archived");

    if (patterns.length === 0) {
      console.log(`No anti-patterns with status "${statusArg}".`);
      return;
    }

    console.log(`Anti-patterns (${statusArg}): ${patterns.length}`);
    for (const ap of patterns) {
      const firstLine = ap.fact.split("\n")[0] ?? "";
      console.log(`  ${ap.id} [confidence=${ap.confidence}]: ${firstLine}`);
    }
    return;
  }

  console.log("Usage: agent-cp antipattern <extract|list> [options]");
  console.log();
  console.log("Subcommands:");
  console.log("  extract <taskId>               Extract anti-patterns from a failed task");
  console.log("  list [candidate|active|archived] List anti-patterns by status");
}
