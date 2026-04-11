import type { MemoryRecord, SkillRecord, SkillVersionRecord } from "@purityjs/agent-types";
import type { AgentStore } from "./store";
export interface PostTaskExtractionOptions {
  now?: string;
  idFactory?: () => string;
  source?: string;
  memoryConfidence?: number;
  minEvents?: number;
  maxSkillSteps?: number;
}
export interface PostTaskExtractionResult {
  skipped: boolean;
  reason?: string;
  memoryRecords: MemoryRecord[];
  skillRecords: SkillRecord[];
  skillVersionRecords: SkillVersionRecord[];
}
export declare function extractCandidatesForTask(
  store: AgentStore,
  taskId: string,
  options?: PostTaskExtractionOptions,
): PostTaskExtractionResult;
