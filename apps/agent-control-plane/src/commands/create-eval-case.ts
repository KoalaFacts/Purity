import type { AgentStore } from "@purityjs/agent-store";
import { createEvalCaseFromTask } from "@purityjs/agent-evals";

export async function createEvalCase(store: AgentStore, args: string[]): Promise<void> {
  const taskId = args[0];
  const dsIdx = args.indexOf("--dataset");
  const datasetId = dsIdx >= 0 ? args[dsIdx + 1] : undefined;

  if (!taskId || !datasetId) {
    console.error("Usage: agent-cp create-eval-case <taskId> --dataset <datasetId>");
    process.exit(1);
  }

  const evalCase = createEvalCaseFromTask(store, taskId, { datasetId });

  console.log(`Eval case created: ${evalCase.id}`);
  console.log(`  Dataset:  ${evalCase.datasetId}`);
  console.log(`  Title:    ${evalCase.title}`);
  console.log(`  Task:     ${taskId}`);
}
