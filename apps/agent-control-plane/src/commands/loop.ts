import type { AgentStore } from "@purityjs/agent-store";
import { extractCandidatesForTask, reviewCandidates } from "@purityjs/agent-store";
import {
  createEvalCaseFromTask,
  promoteWithEval,
  createTrajectoryExecutor,
} from "@purityjs/agent-evals";

const executor = createTrajectoryExecutor({ passThreshold: 0.4 });

export async function loop(store: AgentStore, args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId) {
    console.error("Usage: agent-cp loop <taskId> [--dataset <datasetId>]");
    process.exit(1);
  }

  const dsIdx = args.indexOf("--dataset");
  const datasetId = dsIdx >= 0 ? args[dsIdx + 1] : undefined;

  // Step 1: Extract candidates
  console.log(`[1/4] Extracting candidates from task ${taskId}...`);
  const extraction = extractCandidatesForTask(store, taskId);

  if (extraction.skipped) {
    console.log(`Extraction skipped: ${extraction.reason ?? "unknown reason"}`);
    return;
  }

  console.log(
    `  ${extraction.memoryRecords.length} memories, ${extraction.skillVersionRecords.length} skill versions`,
  );

  // Step 2: Create eval case if dataset specified
  if (datasetId) {
    console.log(`[2/4] Creating eval case in dataset ${datasetId}...`);
    const evalCase = createEvalCaseFromTask(store, taskId, { datasetId });
    console.log(`  Created: ${evalCase.id}`);
  } else {
    console.log("[2/4] Skipping eval case creation (no --dataset)");
  }

  // Step 3: Review candidates
  console.log("[3/4] Reviewing candidates...");
  const report = reviewCandidates(store, {
    memory: { minConfidence: 0.8 },
    skill: { minEvalScore: 0.8 },
  });
  console.log(
    `  Promoted: ${report.promotedMemories} memories, ${report.promotedSkillVersions} skills`,
  );
  console.log(
    `  Rejected: ${report.rejectedMemories} memories, ${report.failedSkillVersions} skills`,
  );

  // Step 4: Evaluate extracted skill versions if dataset provided
  if (datasetId && extraction.skillVersionRecords.length > 0) {
    console.log("[4/4] Evaluating extracted skill versions...");
    for (const sv of extraction.skillVersionRecords) {
      console.log(`  Evaluating ${sv.id}...`);
      const result = await promoteWithEval(store, {
        skillVersionId: sv.id,
        datasetId,
        executor: executor,
      });
      const verb = result.promoted ? "promoted" : "not promoted";
      console.log(`  ${sv.id}: score ${result.eval.averageScore} → ${verb}`);
    }
  } else {
    console.log("[4/4] Skipping evaluation (no dataset or no skill versions)");
  }

  console.log("Loop complete.");
}
