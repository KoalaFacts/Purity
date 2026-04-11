import type { AgentStore } from "@purityjs/agent-store";

export async function status(store: AgentStore, _args: string[]): Promise<void> {
  const memories = {
    active: store.listMemoriesByStatus("active").length,
    candidate: store.listMemoriesByStatus("candidate").length,
    demoted: store.listMemoriesByStatus("demoted").length,
  };

  const skills = store.listSkills();
  const skillVersions = {
    active: store.listSkillVersionsByStatus("active").length,
    candidate: store.listSkillVersionsByStatus("candidate").length,
    archived: store.listSkillVersionsByStatus("archived").length,
  };

  const datasets = store.listEvalDatasets();

  console.log("=== Agent Store Status ===");
  console.log();
  console.log("Memories:");
  console.log(`  Active:      ${memories.active}`);
  console.log(`  Candidate:   ${memories.candidate}`);
  console.log(`  Demoted:     ${memories.demoted}`);
  console.log();
  console.log(`Skills: ${skills.length} total`);
  for (const skill of skills) {
    console.log(`  ${skill.id}: ${skill.name} [${skill.status}]`);
  }
  console.log();
  console.log("Skill Versions:");
  console.log(`  Active:      ${skillVersions.active}`);
  console.log(`  Candidate:   ${skillVersions.candidate}`);
  console.log(`  Archived:    ${skillVersions.archived}`);
  console.log();
  console.log(`Eval Datasets: ${datasets.length}`);
  for (const ds of datasets) {
    const cases = store.listEvalCasesByDataset(ds.id);
    console.log(`  ${ds.id}: ${ds.name} (${cases.length} cases)`);
  }
}
