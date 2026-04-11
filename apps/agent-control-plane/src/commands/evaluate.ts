import type { AgentStore } from "@purityjs/agent-store";
import { promoteWithEval, createTrajectoryExecutor } from "@purityjs/agent-evals";

const executor = createTrajectoryExecutor({ passThreshold: 0.4 });

export async function evaluate(store: AgentStore, args: string[]): Promise<void> {
  const skillVersionId = args[0];
  const datasetId = args[1];

  if (!skillVersionId) {
    console.error("Usage: agent-cp evaluate <skillVersionId> [datasetId]");
    process.exit(1);
  }

  if (!datasetId) {
    const datasets = store.listEvalDatasets();
    if (datasets.length === 0) {
      console.error("No eval datasets found. Create one first.");
      process.exit(1);
    }
    console.error("Available datasets:");
    for (const ds of datasets) {
      console.error(`  ${ds.id}: ${ds.name}`);
    }
    console.error("\nUsage: agent-cp evaluate <skillVersionId> <datasetId>");
    process.exit(1);
  }

  console.log(`Evaluating skill version ${skillVersionId} against dataset ${datasetId}...`);

  const result = await promoteWithEval(store, {
    skillVersionId,
    datasetId,
    executor: executor,
  });

  console.log(`Eval complete:`);
  console.log(`  Score:    ${result.eval.averageScore}`);
  console.log(`  Passed:   ${result.eval.run.passed}`);
  console.log(`  Promoted: ${result.promoted}`);
  console.log(`  Cases:    ${result.eval.passedCases}/${result.eval.caseResults.length}`);

  for (const cr of result.eval.caseResults) {
    const m = cr.metrics as Record<string, number | string> | undefined;
    const fc = m?.fileCoverage ?? "?";
    const tc = m?.toolCoverage ?? "?";
    const oo = m?.outcomeOverlap ?? "?";
    const sa = m?.stepAlignment ?? "?";
    console.log(
      `  [${cr.caseId}] score=${cr.score ?? "?"} file=${fc} tool=${tc} outcome=${oo} steps=${sa}`,
    );
  }
}
