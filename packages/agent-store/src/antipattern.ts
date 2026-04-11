import type { AntiPatternNote, MemoryRecord, TaskEvent } from "@purityjs/agent-types";
import type { AgentStore } from "./store";

export interface AntiPatternExtractionOptions {
  now?: string;
  idFactory?: () => string;
  source?: string;
  confidence?: number;
  minEvents?: number;
}

export interface AntiPatternExtractionResult {
  skipped: boolean;
  reason?: string;
  antiPatterns: MemoryRecord[];
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

function extractErrorSummary(events: TaskEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "error") {
      const msg = event.payload.message ?? event.payload.error;
      if (typeof msg === "string" && msg.trim().length > 0) {
        return msg.trim();
      }
    }
  }
  return undefined;
}

function extractFailedValidation(events: TaskEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "validation") {
      const passed = event.payload.passed ?? event.payload.success;
      if (passed === false || passed === 0) {
        const detail = event.payload.message ?? event.payload.output;
        if (typeof detail === "string" && detail.trim().length > 0) {
          return detail.trim();
        }
        return "validation failed";
      }
    }
  }
  return undefined;
}

function extractNegativeFeedback(events: TaskEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type === "user_feedback") {
      const text = event.payload.text ?? event.payload.message ?? event.payload.content;
      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }
  return undefined;
}

function extractToolChain(events: TaskEvent[], maxTools: number): string[] {
  const tools: string[] = [];
  for (const event of events) {
    if (event.type !== "tool_call") continue;
    const name = event.payload.tool ?? event.payload.name;
    if (typeof name === "string" && name.trim().length > 0) {
      tools.push(name.trim());
    }
    if (tools.length >= maxTools) break;
  }
  return tools;
}

function repoPathFromEvents(events: TaskEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== "file_edit") continue;
    const path = event.payload.path;
    if (typeof path !== "string") continue;
    const index = path.lastIndexOf("/");
    return index > 0 ? path.slice(0, index) : path;
  }
  return undefined;
}

function buildAntiPatternFact(
  title: string,
  prompt: string,
  outcomeSummary: string | undefined,
  errorSummary: string | undefined,
  failedValidation: string | undefined,
  negativeFeedback: string | undefined,
  toolChain: string[],
): string {
  const parts: string[] = [];

  parts.push(`Avoid: ${title}`);

  if (errorSummary) {
    parts.push(`Error: ${errorSummary}`);
  }

  if (failedValidation) {
    parts.push(`Failed check: ${failedValidation}`);
  }

  if (negativeFeedback) {
    parts.push(`User feedback: ${negativeFeedback}`);
  }

  if (outcomeSummary) {
    parts.push(`Outcome: ${outcomeSummary}`);
  }

  if (toolChain.length > 0) {
    parts.push(`Tools tried: ${toolChain.join(" → ")}`);
  }

  parts.push(`Original prompt: ${prompt}`);

  return parts.join("\n");
}

/**
 * Extract anti-pattern notes from a failed task.
 *
 * Creates candidate memory records with `kind: "anti_pattern"` that capture
 * what went wrong — error messages, failed validations, negative user feedback,
 * and the tool sequence that led to failure.
 */
export function extractAntiPatternsForTask(
  store: AgentStore,
  taskId: string,
  options: AntiPatternExtractionOptions = {},
): AntiPatternExtractionResult {
  const task = store.getTask(taskId);
  if (!task) {
    return { skipped: true, reason: "task_not_found", antiPatterns: [] };
  }

  if (task.success || task.status !== "completed") {
    return { skipped: true, reason: "task_not_failed", antiPatterns: [] };
  }

  const events = store.listTaskEvents(taskId);
  const minEvents = options.minEvents ?? 1;
  if (events.length < minEvents) {
    return { skipped: true, reason: "task_too_trivial", antiPatterns: [] };
  }

  const session = store.getSession(task.sessionId);
  if (!session) {
    return { skipped: true, reason: "session_not_found", antiPatterns: [] };
  }

  const now = options.now ?? defaultNow();
  const makeId = buildIdFactory(options.idFactory);
  const source = options.source ?? "anti_pattern_extract";
  const confidence = options.confidence ?? 0.6;

  const errorSummary = extractErrorSummary(events);
  const failedValidation = extractFailedValidation(events);
  const negativeFeedback = extractNegativeFeedback(events);
  const toolChain = extractToolChain(events, 5);
  const repoPath = repoPathFromEvents(events);

  const fact = buildAntiPatternFact(
    task.title,
    task.prompt,
    task.outcomeSummary ?? undefined,
    errorSummary,
    failedValidation,
    negativeFeedback,
    toolChain,
  );

  const memory: MemoryRecord = {
    id: `mem_ap_${makeId()}`,
    scope: "project",
    projectId: session.projectId,
    userId: session.userId,
    repoPath,
    kind: "anti_pattern",
    fact,
    evidenceTaskId: task.id,
    confidence,
    source,
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  };
  store.putMemory(memory);

  return { skipped: false, antiPatterns: [memory] };
}

/**
 * List all anti-pattern memories by status.
 */
export function listAntiPatterns(
  store: AgentStore,
  status: "candidate" | "active" | "archived" = "active",
): AntiPatternNote[] {
  return store
    .listMemoriesByStatus(status)
    .filter((m): m is AntiPatternNote => m.kind === "anti_pattern");
}
