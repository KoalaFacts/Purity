import type {
  MemoryRecord,
  SkillRecord,
  SkillVersionRecord,
  TaskEvent,
} from "@purityjs/agent-types";
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

function defaultNow(): string {
  return new Date().toISOString();
}

function buildIdFactory(customFactory?: () => string): () => string {
  if (customFactory) {
    return customFactory;
  }

  let counter = 0;
  return () => {
    counter += 1;
    return `${Date.now().toString(36)}_${counter.toString(36)}`;
  };
}

function toDomain(title: string, prompt: string): string {
  const raw = `${title} ${prompt}`.toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(" ").filter(Boolean).slice(0, 4);
  return parts.length > 0 ? parts.join("-") : "general";
}

function toRepoPath(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== "file_edit") continue;

    const path = event.payload.path;
    if (typeof path !== "string") continue;

    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : path;
  }
  return undefined;
}

function toStep(event: TaskEvent): string | undefined {
  if (event.type === "tool_call") {
    const tool = event.payload.tool ?? event.payload.name;
    if (typeof tool === "string" && tool.trim().length > 0) {
      return `Run ${tool}.`;
    }
    return "Run a tool step.";
  }

  if (event.type === "file_edit") {
    const path = event.payload.path;
    if (typeof path === "string" && path.trim().length > 0) {
      return `Edit ${path}.`;
    }
    return "Edit relevant files.";
  }

  if (event.type === "validation") {
    return "Run validation checks and confirm results.";
  }

  if (event.type === "user_feedback") {
    return "Apply user feedback and re-validate.";
  }

  return undefined;
}

function buildSkillBody(
  title: string,
  prompt: string,
  outcomeSummary: string,
  events: TaskEvent[],
  maxSteps: number,
): string {
  const seen = new Set<string>();
  const steps: string[] = [];

  for (const event of events) {
    const step = toStep(event);
    if (!step || seen.has(step)) continue;
    seen.add(step);
    steps.push(step);
    if (steps.length >= maxSteps) break;
  }

  if (steps.length === 0) {
    steps.push("Execute implementation and validation iteratively.");
  }

  const validations = events.filter((event) => event.type === "validation").length;

  return [
    `# ${title}`,
    "",
    "Use when:",
    `- similar request: ${prompt}`,
    "",
    "Procedure:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Validate:",
    validations > 0
      ? `- replay ${validations} validation step(s) from the source trajectory`
      : "- run checks and tests relevant to touched files",
    "",
    "Outcome pattern:",
    `- ${outcomeSummary}`,
  ].join("\n");
}

export function extractCandidatesForTask(
  store: AgentStore,
  taskId: string,
  options: PostTaskExtractionOptions = {},
): PostTaskExtractionResult {
  const task = store.getTask(taskId);
  if (!task) {
    return {
      skipped: true,
      reason: "task_not_found",
      memoryRecords: [],
      skillRecords: [],
      skillVersionRecords: [],
    };
  }

  if (!task.success || task.status !== "completed") {
    return {
      skipped: true,
      reason: "task_not_successful",
      memoryRecords: [],
      skillRecords: [],
      skillVersionRecords: [],
    };
  }

  const events = store.listTaskEvents(taskId);
  const minEvents = options.minEvents ?? 2;
  if (events.length < minEvents) {
    return {
      skipped: true,
      reason: "task_too_trivial",
      memoryRecords: [],
      skillRecords: [],
      skillVersionRecords: [],
    };
  }

  const session = store.getSession(task.sessionId);
  if (!session) {
    return {
      skipped: true,
      reason: "session_not_found",
      memoryRecords: [],
      skillRecords: [],
      skillVersionRecords: [],
    };
  }

  const now = options.now ?? defaultNow();
  const makeId = buildIdFactory(options.idFactory);
  const source = options.source ?? "post_task_extract";
  const confidence = options.memoryConfidence ?? 0.8;

  const outcomeSummary = task.outcomeSummary?.trim() || store.summarizeTask(taskId) || task.prompt;
  const repoPath = toRepoPath(events);

  const memory: MemoryRecord = {
    id: `mem_${makeId()}`,
    scope: "project",
    projectId: session.projectId,
    userId: session.userId,
    repoPath,
    kind: "trajectory_outcome",
    fact: outcomeSummary,
    evidenceTaskId: task.id,
    confidence,
    source,
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  };
  store.putMemory(memory);

  const skill: SkillRecord = {
    id: `skill_${makeId()}`,
    name: `Candidate: ${task.title}`,
    description: `Generated from successful task ${task.id}`,
    domain: toDomain(task.title, task.prompt),
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  };
  store.putSkill(skill);

  const version: SkillVersionRecord = {
    id: `skill_version_${makeId()}`,
    skillId: skill.id,
    version: 1,
    bodyMarkdown: buildSkillBody(
      task.title,
      task.prompt,
      outcomeSummary,
      events,
      options.maxSkillSteps ?? 6,
    ),
    extractionTaskId: task.id,
    generatorModel: "heuristic-v1",
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  };
  store.putSkillVersion(version);

  return {
    skipped: false,
    memoryRecords: [memory],
    skillRecords: [skill],
    skillVersionRecords: [version],
  };
}
