import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactStatus,
  EvalCase,
  EvalDatasetRecord,
  EvalRun,
  MemoryRecord,
  RetrievalContext,
  RetrievalResult,
  SessionRecord,
  SkillRecord,
  SkillInvocationRecord,
  SkillVersionRecord,
  TaskEvent,
  TaskRecord,
  UserProfileRecord,
} from "@purityjs/agent-types";
export interface AgentStoreOptions {
  filename?: string;
  migrate?: boolean;
}
export declare class AgentStore {
  readonly db: DatabaseSync;
  constructor(options?: AgentStoreOptions);
  close(): void;
  migrate(): void;
  putSession(session: SessionRecord): void;
  getSession(id: string): SessionRecord | undefined;
  listSessionsByProject(projectId: string): SessionRecord[];
  putTask(task: TaskRecord): void;
  getTask(id: string): TaskRecord | undefined;
  listSuccessfulTasksByProject(projectId: string): TaskRecord[];
  listTasksBySession(sessionId: string): TaskRecord[];
  appendTaskEvent(event: TaskEvent): void;
  nextTaskEventSeq(taskId: string): number;
  completeTask(
    taskId: string,
    options: {
      success: boolean;
      status?: TaskRecord["status"];
      outcomeSummary?: string;
      completedAt?: string;
      updatedAt?: string;
    },
  ): void;
  indexCompletedTask(taskId: string): void;
  summarizeTask(taskId: string, maxEvents?: number): string | undefined;
  listTaskEvents(taskId: string): TaskEvent[];
  putMemory(memory: MemoryRecord): void;
  getMemory(id: string): MemoryRecord | undefined;
  listMemoriesByStatus(status: MemoryRecord["status"]): MemoryRecord[];
  listCandidateMemories(): MemoryRecord[];
  setMemoryStatus(id: string, status: ArtifactStatus, updatedAt?: string): void;
  putSkill(skill: SkillRecord): void;
  getSkill(id: string): SkillRecord | undefined;
  listSkills(): SkillRecord[];
  listSkillsByStatus(status: SkillRecord["status"]): SkillRecord[];
  setSkillStatus(id: string, status: ArtifactStatus, updatedAt?: string): void;
  putSkillVersion(version: SkillVersionRecord): void;
  getSkillVersion(id: string): SkillVersionRecord | undefined;
  listSkillVersionsByStatus(status: SkillVersionRecord["status"]): SkillVersionRecord[];
  listCandidateSkillVersions(): SkillVersionRecord[];
  setSkillVersionStatus(
    id: string,
    status: ArtifactStatus,
    options?: {
      evalScore?: number;
      updatedAt?: string;
    },
  ): void;
  putSkillInvocation(invocation: SkillInvocationRecord): void;
  getSkillInvocation(id: string): SkillInvocationRecord | undefined;
  listSkillInvocationsByVersion(skillVersionId: string): SkillInvocationRecord[];
  listSkillInvocationsByTask(taskId: string): SkillInvocationRecord[];
  putEvalDataset(dataset: EvalDatasetRecord): void;
  getEvalDataset(id: string): EvalDatasetRecord | undefined;
  listEvalDatasets(): EvalDatasetRecord[];
  putEvalCase(evalCase: EvalCase): void;
  getEvalCase(id: string): EvalCase | undefined;
  listEvalCasesByDataset(datasetId: string): EvalCase[];
  putEvalRun(run: EvalRun): void;
  getEvalRun(id: string): EvalRun | undefined;
  listEvalRunsForTarget(targetType: EvalRun["targetType"], targetId: string): EvalRun[];
  putUserProfile(profile: UserProfileRecord): void;
  getUserProfile(userId: string): UserProfileRecord | undefined;
  retrieve(context: RetrievalContext): RetrievalResult;
  searchTaskSummaries(projectId: string, query: string, limit?: number): string[];
}
export declare function openAgentStore(options?: AgentStoreOptions): AgentStore;
