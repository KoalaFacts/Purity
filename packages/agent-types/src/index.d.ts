export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type TaskEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "file_edit"
  | "validation"
  | "error"
  | "user_feedback";
export type MemoryScope = "global" | "project" | "user" | "repo_path";
export type ArtifactStatus =
  | "candidate"
  | "active"
  | "approved"
  | "demoted"
  | "rejected"
  | "archived"
  | "failed_eval";
export type EvalTargetType = "skill_version" | "memory_policy" | "retrieval_strategy";
export interface AuditFields {
  createdAt: string;
  updatedAt?: string;
}
export interface SessionRecord extends AuditFields {
  id: string;
  userId?: string;
  projectId: string;
  startedAt: string;
  endedAt?: string;
  summary?: string;
}
export interface TaskRecord extends AuditFields {
  id: string;
  sessionId: string;
  parentTaskId?: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  success: boolean;
  completedAt?: string;
  outcomeSummary?: string;
}
export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  type: TaskEventType;
  payload: JsonObject;
  createdAt: string;
}
export interface MemoryRecord extends AuditFields {
  id: string;
  scope: MemoryScope;
  projectId?: string;
  userId?: string;
  repoPath?: string;
  kind: string;
  fact: string;
  evidenceTaskId?: string;
  confidence: number;
  source: string;
  status: ArtifactStatus;
}
export interface SkillRecord extends AuditFields {
  id: string;
  name: string;
  description: string;
  domain: string;
  status: ArtifactStatus;
}
export interface SkillVersionRecord extends AuditFields {
  id: string;
  skillId: string;
  version: number;
  bodyMarkdown: string;
  extractionTaskId?: string;
  generatorModel?: string;
  status: ArtifactStatus;
  evalScore?: number;
}
export interface SkillInvocationRecord {
  id: string;
  skillVersionId: string;
  taskId: string;
  usedAt: string;
  outcome: string;
  userAccepted?: boolean;
  rollbackRequired?: boolean;
  notes?: string;
}
export interface EvalDatasetRecord extends AuditFields {
  id: string;
  name: string;
  description?: string;
  scope: string;
}
export interface EvalCase extends AuditFields {
  id: string;
  datasetId: string;
  title: string;
  input: JsonObject;
  expected?: JsonObject;
}
export interface EvalRun extends AuditFields {
  id: string;
  targetType: EvalTargetType;
  targetId: string;
  datasetId: string;
  passed: boolean;
  score: number;
  metrics: JsonObject;
}
export interface UserProfileRecord {
  userId: string;
  profile: JsonObject;
  updatedAt: string;
}
export interface RetrievalContext {
  projectId: string;
  userId?: string;
  repoPath?: string;
  query: string;
  maxSkills?: number;
  maxMemories?: number;
}
export interface RetrievalResult {
  memories: MemoryRecord[];
  skills: SkillVersionRecord[];
  summaries: string[];
}
