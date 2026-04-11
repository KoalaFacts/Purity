import type { AgentStore, SkillFeedbackSummary } from "@purityjs/agent-store";
import { summarizeAllActiveSkillFeedback, demoteSkillsByFeedback } from "@purityjs/agent-store";

export async function feedback(store: AgentStore, args: string[]): Promise<void> {
  const action = args[0] ?? "summary";

  if (action === "summary") {
    const summaries = summarizeAllActiveSkillFeedback(store);

    if (summaries.length === 0) {
      console.log("No active skill versions with invocations.");
      return;
    }

    console.log("=== Skill Invocation Feedback ===\n");
    for (const s of summaries) {
      const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
      console.log(`  ${s.skillVersionId}`);
      console.log(
        `    invocations=${s.totalInvocations} accepted=${s.accepted} rejected=${s.rejected} rollbacks=${s.rollbacks}`,
      );
      console.log(`    acceptance=${pct(s.acceptanceRate)} rollback=${pct(s.rollbackRate)}`);
      console.log();
    }
    return;
  }

  if (action === "demote") {
    const minInvArg = args.indexOf("--min-invocations");
    const minInvocations = minInvArg >= 0 ? Number(args[minInvArg + 1]) : undefined;

    const minAccArg = args.indexOf("--min-acceptance");
    const minAcceptanceRate = minAccArg >= 0 ? Number(args[minAccArg + 1]) : undefined;

    const maxRbArg = args.indexOf("--max-rollback");
    const maxRollbackRate = maxRbArg >= 0 ? Number(args[maxRbArg + 1]) : undefined;

    const result = demoteSkillsByFeedback(store, {
      minInvocations,
      minAcceptanceRate,
      maxRollbackRate,
    });

    console.log(`Reviewed ${result.reviewed} active skill version(s)`);
    if (result.demoted > 0) {
      console.log(`Demoted ${result.demoted} skill version(s):`);
      for (const id of result.demotedIds) {
        const s = result.summaries.find((x: SkillFeedbackSummary) => x.skillVersionId === id);
        if (s) {
          console.log(
            `  ${id}: acceptance=${(s.acceptanceRate * 100).toFixed(0)}% rollback=${(s.rollbackRate * 100).toFixed(0)}%`,
          );
        }
      }
    } else {
      console.log("No skill versions demoted.");
    }
    return;
  }

  console.error("Usage: agent-cp feedback [summary|demote] [options]");
  console.error("  summary                          Show feedback stats for active skills");
  console.error("  demote [--min-invocations N]      Demote poorly-performing skills");
  console.error("         [--min-acceptance 0.5]");
  console.error("         [--max-rollback 0.3]");
  process.exit(1);
}
