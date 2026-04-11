import type { AgentStore } from "@purityjs/agent-store";

export async function retrieve(store: AgentStore, args: string[]): Promise<void> {
  const projectIdx = args.indexOf("--project");
  const projectId = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

  const userIdx = args.indexOf("--user");
  const userId = userIdx >= 0 ? args[userIdx + 1] : undefined;

  const repoIdx = args.indexOf("--repo-path");
  const repoPath = repoIdx >= 0 ? args[repoIdx + 1] : undefined;

  const query = args.filter(
    (_, i) =>
      i !== projectIdx &&
      i !== projectIdx + 1 &&
      i !== userIdx &&
      i !== userIdx + 1 &&
      i !== repoIdx &&
      i !== repoIdx + 1,
  );

  if (!projectId) {
    console.error(
      "Usage: agent-cp retrieve --project <id> [--user <id>] [--repo-path <path>] <query...>",
    );
    process.exit(1);
  }

  const result = store.retrieve({
    projectId,
    userId: userId ?? undefined,
    repoPath: repoPath ?? undefined,
    query: query.join(" "),
    maxMemories: 10,
    maxSkills: 5,
  });

  if (result.memories.length === 0 && result.skills.length === 0 && result.summaries.length === 0) {
    console.log("No relevant context found.");
    return;
  }

  if (result.memories.length > 0) {
    console.log(`Memories (${result.memories.length}):`);
    for (const mem of result.memories) {
      console.log(`  [${mem.scope}] ${mem.kind}: ${mem.fact}`);
    }
    console.log();
  }

  if (result.skills.length > 0) {
    console.log(`Skills (${result.skills.length}):`);
    for (const sv of result.skills) {
      const score = sv.evalScore != null ? ` (score: ${sv.evalScore})` : "";
      console.log(`  v${sv.version}: ${sv.bodyMarkdown.split("\n")[0]}${score}`);
    }
    console.log();
  }

  if (result.summaries.length > 0) {
    console.log(`Related summaries (${result.summaries.length}):`);
    for (const summary of result.summaries) {
      console.log(`  - ${summary}`);
    }
  }
}
