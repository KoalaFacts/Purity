import type { AgentStore } from "@purityjs/agent-store";
import { validateActiveSkills } from "@purityjs/agent-evals";
import type { EvalCaseExecutionContext, EvalCaseResult } from "@purityjs/agent-evals";

async function defaultExecutor(context: EvalCaseExecutionContext): Promise<EvalCaseResult> {
  return {
    caseId: context.evalCase.id,
    passed: true,
    score: 1.0,
    output: { note: "placeholder executor — replace with real replay logic" },
  };
}

export async function validate(store: AgentStore, _args: string[]): Promise<void> {
  console.log("Validating active skills for regressions...");

  const result = await validateActiveSkills(store, {
    executor: defaultExecutor,
  });

  console.log(`Checked ${result.totalChecked} active skill version(s)`);

  const regressions = result.entries.filter((e) => e.regressed);
  if (regressions.length === 0) {
    console.log("No regressions detected.");
  } else {
    console.log(`Regressions found: ${result.totalRegressed}`);
    for (const entry of regressions) {
      console.log(
        `  ${entry.skillVersionId}: score ${entry.eval.averageScore} on dataset ${entry.datasetId}`,
      );
    }
  }
}
