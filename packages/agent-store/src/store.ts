import { DatabaseSync } from "node:sqlite";
import type {
  ArtifactStatus,
  EvalCase,
  EvalDatasetRecord,
  EvalRun,
  JsonObject,
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
import { migrateAgentStore } from "./schema";

export interface AgentStoreOptions {
  filename?: string;
  migrate?: boolean;
}

type Row = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  if (typeof value !== "string") {
    return {};
  }

  const parsed = JSON.parse(value) as JsonObject;
  return parsed ?? {};
}

function stringifyJson(value: JsonObject | undefined): string {
  return JSON.stringify(value ?? {});
}

function toNullable(value: string | undefined): string | null {
  return value ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function memoryFromRow(row: Row | undefined): MemoryRecord | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    scope: row.scope as MemoryRecord["scope"],
    projectId: (row.project_id as string | null) ?? undefined,
    userId: (row.user_id as string | null) ?? undefined,
    repoPath: (row.repo_path as string | null) ?? undefined,
    kind: String(row.kind),
    fact: String(row.fact),
    evidenceTaskId: (row.evidence_task_id as string | null) ?? undefined,
    confidence: Number(row.confidence),
    source: String(row.source),
    status: row.status as MemoryRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: (row.updated_at as string | null) ?? undefined,
  };
}

function evalDatasetFromRow(row: Row | undefined): EvalDatasetRecord | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? undefined,
    scope: String(row.scope),
    createdAt: String(row.created_at),
    updatedAt: (row.updated_at as string | null) ?? undefined,
  };
}

function evalCaseFromRow(row: Row | undefined): EvalCase | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    datasetId: String(row.dataset_id),
    title: String(row.title),
    input: asJsonObject(row.input_json),
    expected:
      row.expected_json === null || row.expected_json === undefined
        ? undefined
        : asJsonObject(row.expected_json),
    createdAt: String(row.created_at),
    updatedAt: (row.updated_at as string | null) ?? undefined,
  };
}

function skillVersionFromRow(row: Row | undefined): SkillVersionRecord | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    version: Number(row.version),
    bodyMarkdown: String(row.body_markdown),
    extractionTaskId: (row.extraction_task_id as string | null) ?? undefined,
    generatorModel: (row.generator_model as string | null) ?? undefined,
    status: row.status as SkillVersionRecord["status"],
    evalScore:
      row.eval_score === null || row.eval_score === undefined ? undefined : Number(row.eval_score),
    createdAt: String(row.created_at),
    updatedAt: (row.updated_at as string | null) ?? undefined,
  };
}

function skillInvocationFromRow(row: Row | undefined): SkillInvocationRecord | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    skillVersionId: String(row.skill_version_id),
    taskId: String(row.task_id),
    usedAt: String(row.used_at),
    outcome: String(row.outcome),
    userAccepted:
      row.user_accepted === null || row.user_accepted === undefined
        ? undefined
        : Boolean(row.user_accepted),
    rollbackRequired:
      row.rollback_required === null || row.rollback_required === undefined
        ? undefined
        : Boolean(row.rollback_required),
    notes: (row.notes as string | null) ?? undefined,
  };
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export class AgentStore {
  readonly db: DatabaseSync;

  constructor(options: AgentStoreOptions = {}) {
    this.db = new DatabaseSync(options.filename ?? ":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (options.migrate !== false) {
      migrateAgentStore(this.db);
    }
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    migrateAgentStore(this.db);
  }

  putSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, user_id, project_id, started_at, ended_at, summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          project_id = excluded.project_id,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          summary = excluded.summary,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        session.id,
        toNullable(session.userId),
        session.projectId,
        session.startedAt,
        toNullable(session.endedAt),
        toNullable(session.summary),
        session.createdAt,
        toNullable(session.updatedAt),
      );
  }

  getSession(id: string): SessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      userId: (row.user_id as string | null) ?? undefined,
      projectId: String(row.project_id),
      startedAt: String(row.started_at),
      endedAt: (row.ended_at as string | null) ?? undefined,
      summary: (row.summary as string | null) ?? undefined,
      createdAt: String(row.created_at),
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }

  listSessionsByProject(projectId: string): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT id FROM sessions WHERE project_id = ? ORDER BY started_at DESC")
      .all(projectId) as Row[];
    return rows.map((row) => this.getSession(String(row.id))!).filter(Boolean);
  }

  putTask(task: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, session_id, parent_task_id, title, prompt, status, success,
          completed_at, outcome_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          session_id = excluded.session_id,
          parent_task_id = excluded.parent_task_id,
          title = excluded.title,
          prompt = excluded.prompt,
          status = excluded.status,
          success = excluded.success,
          completed_at = excluded.completed_at,
          outcome_summary = excluded.outcome_summary,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.sessionId,
        toNullable(task.parentTaskId),
        task.title,
        task.prompt,
        task.status,
        Number(task.success),
        toNullable(task.completedAt),
        toNullable(task.outcomeSummary),
        task.createdAt,
        toNullable(task.updatedAt),
      );

    if (task.success && task.status === "completed") {
      this.indexCompletedTask(task.id);
    }
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      parentTaskId: (row.parent_task_id as string | null) ?? undefined,
      title: String(row.title),
      prompt: String(row.prompt),
      status: row.status as TaskRecord["status"],
      success: Boolean(row.success),
      completedAt: (row.completed_at as string | null) ?? undefined,
      outcomeSummary: (row.outcome_summary as string | null) ?? undefined,
      createdAt: String(row.created_at),
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }

  listSuccessfulTasksByProject(projectId: string): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.*
         FROM tasks t
         INNER JOIN sessions s ON s.id = t.session_id
         WHERE s.project_id = ?
           AND t.success = 1
         ORDER BY COALESCE(t.completed_at, t.created_at) DESC`,
      )
      .all(projectId) as Row[];

    return rows.map((row) => this.getTask(String(row.id))!).filter(Boolean);
  }

  listTasksBySession(sessionId: string): TaskRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Row[];
    return rows.map((row) => this.getTask(String(row.id))!).filter(Boolean);
  }

  appendTaskEvent(event: TaskEvent): void {
    this.db
      .prepare(
        `INSERT INTO task_events (id, task_id, seq, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.taskId,
        event.seq,
        event.type,
        stringifyJson(event.payload),
        event.createdAt,
      );
  }

  nextTaskEventSeq(taskId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM task_events WHERE task_id = ?")
      .get(taskId) as { max_seq?: number } | undefined;
    return (row?.max_seq ?? 0) + 1;
  }

  completeTask(
    taskId: string,
    options: {
      success: boolean;
      status?: TaskRecord["status"];
      outcomeSummary?: string;
      completedAt?: string;
      updatedAt?: string;
    },
  ): void {
    const status = options.status ?? (options.success ? "completed" : "failed");
    this.db
      .prepare(
        `UPDATE tasks
         SET status = ?,
             success = ?,
             completed_at = ?,
             outcome_summary = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        Number(options.success),
        toNullable(options.completedAt ?? nowIso()),
        toNullable(options.outcomeSummary),
        toNullable(options.updatedAt ?? nowIso()),
        taskId,
      );

    if (options.success) {
      this.indexCompletedTask(taskId);
    }
  }

  indexCompletedTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const session = this.getSession(task.sessionId);
    if (!session) return;

    this.db.prepare("DELETE FROM task_search WHERE task_id = ?").run(taskId);

    const events = this.listTaskEvents(taskId);
    const eventText = events.map((e) => JSON.stringify(e.payload)).join(" ");

    this.db
      .prepare(
        `INSERT INTO task_search(task_id, project_id, title, prompt, outcome_summary, event_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskId,
        session.projectId,
        task.title,
        task.prompt,
        task.outcomeSummary ?? "",
        eventText,
      );
  }

  summarizeTask(taskId: string, maxEvents = 50): string | undefined {
    const task = this.getTask(taskId);
    if (!task) return undefined;

    const events = this.listTaskEvents(taskId).slice(-Math.max(1, maxEvents));
    const eventTypeCounts = new Map<string, number>();
    const touchedFiles = new Set<string>();
    const tools = new Set<string>();

    for (const event of events) {
      eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);

      if (event.type === "file_edit") {
        const path = event.payload.path;
        if (typeof path === "string" && path.trim().length > 0) {
          touchedFiles.add(path);
        }
      }

      if (event.type === "tool_call") {
        const tool = event.payload.tool ?? event.payload.name;
        if (typeof tool === "string" && tool.trim().length > 0) {
          tools.add(tool);
        }
      }
    }

    const counts = [...eventTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join(", ");

    const summary = [
      `Task: ${task.title}`,
      `Status: ${task.status} (${task.success ? "success" : "not-success"})`,
      counts.length > 0 ? `Events: ${counts}` : "Events: none",
      tools.size > 0 ? `Tools: ${[...tools].join(", ")}` : "Tools: none",
      touchedFiles.size > 0 ? `Files: ${[...touchedFiles].slice(0, 8).join(", ")}` : "Files: none",
      task.outcomeSummary ? `Outcome: ${task.outcomeSummary}` : "Outcome: none",
    ].join(" | ");

    return summary;
  }

  listTaskEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY seq ASC")
      .all(taskId) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      seq: Number(row.seq),
      type: row.type as TaskEvent["type"],
      payload: asJsonObject(row.payload_json),
      createdAt: String(row.created_at),
    }));
  }

  putMemory(memory: MemoryRecord): void {
    this.db
      .prepare(
        `INSERT INTO memories (
          id, scope, project_id, user_id, repo_path, kind, fact, evidence_task_id,
          confidence, source, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          project_id = excluded.project_id,
          user_id = excluded.user_id,
          repo_path = excluded.repo_path,
          kind = excluded.kind,
          fact = excluded.fact,
          evidence_task_id = excluded.evidence_task_id,
          confidence = excluded.confidence,
          source = excluded.source,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        memory.id,
        memory.scope,
        toNullable(memory.projectId),
        toNullable(memory.userId),
        toNullable(memory.repoPath),
        memory.kind,
        memory.fact,
        toNullable(memory.evidenceTaskId),
        memory.confidence,
        memory.source,
        memory.status,
        memory.createdAt,
        toNullable(memory.updatedAt),
      );
  }

  getMemory(id: string): MemoryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
    return memoryFromRow(row);
  }

  listMemoriesByStatus(status: MemoryRecord["status"]): MemoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE status = ? ORDER BY created_at ASC")
      .all(status) as Row[];
    return rows.map((row) => memoryFromRow(row)!).filter(Boolean);
  }

  listCandidateMemories(): MemoryRecord[] {
    return this.listMemoriesByStatus("candidate");
  }

  setMemoryStatus(id: string, status: ArtifactStatus, updatedAt = nowIso()): void {
    this.db
      .prepare("UPDATE memories SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, id);
  }

  putSkill(skill: SkillRecord): void {
    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, domain, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           domain = excluded.domain,
           status = excluded.status,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        skill.id,
        skill.name,
        skill.description,
        skill.domain,
        skill.status,
        skill.createdAt,
        toNullable(skill.updatedAt),
      );
  }

  getSkill(id: string): SkillRecord | undefined {
    const row = this.db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      domain: String(row.domain),
      status: row.status as SkillRecord["status"],
      createdAt: String(row.created_at),
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }

  listSkills(): SkillRecord[] {
    const rows = this.db.prepare("SELECT * FROM skills ORDER BY created_at ASC").all() as Row[];
    return rows.map((row) => this.getSkill(String(row.id))!).filter(Boolean);
  }

  listSkillsByStatus(status: SkillRecord["status"]): SkillRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM skills WHERE status = ? ORDER BY created_at ASC")
      .all(status) as Row[];
    return rows.map((row) => this.getSkill(String(row.id))!).filter(Boolean);
  }

  setSkillStatus(id: string, status: ArtifactStatus, updatedAt = nowIso()): void {
    this.db
      .prepare("UPDATE skills SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, id);
  }

  putSkillVersion(version: SkillVersionRecord): void {
    this.db
      .prepare(
        `INSERT INTO skill_versions (
          id, skill_id, version, body_markdown, extraction_task_id, generator_model,
          status, eval_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          skill_id = excluded.skill_id,
          version = excluded.version,
          body_markdown = excluded.body_markdown,
          extraction_task_id = excluded.extraction_task_id,
          generator_model = excluded.generator_model,
          status = excluded.status,
          eval_score = excluded.eval_score,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        version.id,
        version.skillId,
        version.version,
        version.bodyMarkdown,
        toNullable(version.extractionTaskId),
        toNullable(version.generatorModel),
        version.status,
        version.evalScore ?? null,
        version.createdAt,
        toNullable(version.updatedAt),
      );
  }

  getSkillVersion(id: string): SkillVersionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM skill_versions WHERE id = ?").get(id) as
      | Row
      | undefined;
    return skillVersionFromRow(row);
  }

  listSkillVersionsByStatus(status: SkillVersionRecord["status"]): SkillVersionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM skill_versions WHERE status = ? ORDER BY created_at ASC")
      .all(status) as Row[];
    return rows.map((row) => skillVersionFromRow(row)!).filter(Boolean);
  }

  listCandidateSkillVersions(): SkillVersionRecord[] {
    return this.listSkillVersionsByStatus("candidate");
  }

  setSkillVersionStatus(
    id: string,
    status: ArtifactStatus,
    options?: { evalScore?: number; updatedAt?: string },
  ): void {
    this.db
      .prepare(
        `UPDATE skill_versions
         SET status = ?,
             eval_score = COALESCE(?, eval_score),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(status, options?.evalScore ?? null, options?.updatedAt ?? nowIso(), id);
  }

  putSkillInvocation(invocation: SkillInvocationRecord): void {
    this.db
      .prepare(
        `INSERT INTO skill_invocations (
          id, skill_version_id, task_id, used_at, outcome, user_accepted, rollback_required, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          skill_version_id = excluded.skill_version_id,
          task_id = excluded.task_id,
          used_at = excluded.used_at,
          outcome = excluded.outcome,
          user_accepted = excluded.user_accepted,
          rollback_required = excluded.rollback_required,
          notes = excluded.notes`,
      )
      .run(
        invocation.id,
        invocation.skillVersionId,
        invocation.taskId,
        invocation.usedAt,
        invocation.outcome,
        invocation.userAccepted === undefined ? null : Number(invocation.userAccepted),
        invocation.rollbackRequired === undefined ? null : Number(invocation.rollbackRequired),
        toNullable(invocation.notes),
      );
  }

  getSkillInvocation(id: string): SkillInvocationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM skill_invocations WHERE id = ?").get(id) as
      | Row
      | undefined;
    return skillInvocationFromRow(row);
  }

  listSkillInvocationsByVersion(skillVersionId: string): SkillInvocationRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM skill_invocations WHERE skill_version_id = ? ORDER BY used_at DESC")
      .all(skillVersionId) as Row[];
    return rows.map((row) => skillInvocationFromRow(row)!).filter(Boolean);
  }

  listSkillInvocationsByTask(taskId: string): SkillInvocationRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM skill_invocations WHERE task_id = ? ORDER BY used_at DESC")
      .all(taskId) as Row[];
    return rows.map((row) => skillInvocationFromRow(row)!).filter(Boolean);
  }

  putEvalDataset(dataset: EvalDatasetRecord): void {
    this.db
      .prepare(
        `INSERT INTO eval_datasets (id, name, description, scope, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           scope = excluded.scope,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        dataset.id,
        dataset.name,
        toNullable(dataset.description),
        dataset.scope,
        dataset.createdAt,
        toNullable(dataset.updatedAt),
      );
  }

  getEvalDataset(id: string): EvalDatasetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM eval_datasets WHERE id = ?").get(id) as
      | Row
      | undefined;
    return evalDatasetFromRow(row);
  }

  listEvalDatasets(): EvalDatasetRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM eval_datasets ORDER BY created_at ASC")
      .all() as Row[];
    return rows.map((row) => evalDatasetFromRow(row)!).filter(Boolean);
  }

  putEvalCase(evalCase: EvalCase): void {
    this.db
      .prepare(
        `INSERT INTO eval_cases (id, dataset_id, title, input_json, expected_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           dataset_id = excluded.dataset_id,
           title = excluded.title,
           input_json = excluded.input_json,
           expected_json = excluded.expected_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        evalCase.id,
        evalCase.datasetId,
        evalCase.title,
        stringifyJson(evalCase.input),
        evalCase.expected ? stringifyJson(evalCase.expected) : null,
        evalCase.createdAt,
        toNullable(evalCase.updatedAt),
      );
  }

  getEvalCase(id: string): EvalCase | undefined {
    const row = this.db.prepare("SELECT * FROM eval_cases WHERE id = ?").get(id) as Row | undefined;
    return evalCaseFromRow(row);
  }

  listEvalCasesByDataset(datasetId: string): EvalCase[] {
    const rows = this.db
      .prepare("SELECT * FROM eval_cases WHERE dataset_id = ? ORDER BY created_at ASC")
      .all(datasetId) as Row[];
    return rows.map((row) => evalCaseFromRow(row)!).filter(Boolean);
  }

  putEvalRun(run: EvalRun): void {
    this.db
      .prepare(
        `INSERT INTO eval_runs (
          id, target_type, target_id, dataset_id, passed, score, metrics_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          dataset_id = excluded.dataset_id,
          passed = excluded.passed,
          score = excluded.score,
          metrics_json = excluded.metrics_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        run.id,
        run.targetType,
        run.targetId,
        run.datasetId,
        Number(run.passed),
        run.score,
        stringifyJson(run.metrics),
        run.createdAt,
        toNullable(run.updatedAt),
      );
  }

  getEvalRun(id: string): EvalRun | undefined {
    const row = this.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      targetType: row.target_type as EvalRun["targetType"],
      targetId: String(row.target_id),
      datasetId: String(row.dataset_id),
      passed: Boolean(row.passed),
      score: Number(row.score),
      metrics: asJsonObject(row.metrics_json),
      createdAt: String(row.created_at),
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }

  listEvalRunsForTarget(targetType: EvalRun["targetType"], targetId: string): EvalRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM eval_runs WHERE target_type = ? AND target_id = ? ORDER BY created_at DESC",
      )
      .all(targetType, targetId) as Row[];

    return rows.map((row) => ({
      id: String(row.id),
      targetType: row.target_type as EvalRun["targetType"],
      targetId: String(row.target_id),
      datasetId: String(row.dataset_id),
      passed: Boolean(row.passed),
      score: Number(row.score),
      metrics: asJsonObject(row.metrics_json),
      createdAt: String(row.created_at),
      updatedAt: (row.updated_at as string | null) ?? undefined,
    }));
  }

  putUserProfile(profile: UserProfileRecord): void {
    this.db
      .prepare(
        `INSERT INTO user_profiles (user_id, profile_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           profile_json = excluded.profile_json,
           updated_at = excluded.updated_at`,
      )
      .run(profile.userId, stringifyJson(profile.profile), profile.updatedAt);
  }

  getUserProfile(userId: string): UserProfileRecord | undefined {
    const row = this.db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as
      | Row
      | undefined;
    if (!row) return undefined;
    return {
      userId: String(row.user_id),
      profile: asJsonObject(row.profile_json),
      updatedAt: String(row.updated_at),
    };
  }

  getMetadata(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM agent_metadata WHERE key = ?").get(key) as
      | Row
      | undefined;
    return row ? String(row.value) : undefined;
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_metadata (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, nowIso());
  }

  retrieve(context: RetrievalContext): RetrievalResult {
    const query = context.query.trim().toLowerCase();
    const memoryRows = this.db
      .prepare(
        `SELECT *
         FROM memories
         WHERE status = 'active'
           AND (
             scope = 'global'
             OR (scope = 'project' AND project_id = ?)
             OR (? IS NOT NULL AND scope = 'user' AND user_id = ?)
             OR (? IS NOT NULL AND scope = 'repo_path' AND repo_path = ?)
           )
         ORDER BY
           CASE scope
             WHEN 'repo_path' THEN 0
             WHEN 'project' THEN 1
             WHEN 'user' THEN 2
             ELSE 3
           END ASC,
           confidence DESC,
           COALESCE(updated_at, created_at) DESC
         LIMIT ?`,
      )
      .all(
        context.projectId,
        toNullable(context.userId),
        toNullable(context.userId),
        toNullable(context.repoPath),
        toNullable(context.repoPath),
        context.maxMemories ?? 10,
      ) as Row[];

    const skillRows = this.db
      .prepare(
        `SELECT sv.*
         FROM skill_versions sv
         INNER JOIN skills s ON s.id = sv.skill_id
         WHERE sv.status = 'active'
           AND s.status IN ('active', 'approved')
         ORDER BY
           CASE
             WHEN ? <> '' AND INSTR(LOWER(?), LOWER(s.domain)) > 0 THEN 0
             ELSE 1
           END ASC,
           COALESCE(sv.eval_score, -1) DESC,
           sv.version DESC,
           COALESCE(sv.updated_at, sv.created_at) DESC
         LIMIT ?`,
      )
      .all(query, query, context.maxSkills ?? 3) as Row[];

    return {
      memories: memoryRows.map((row) => memoryFromRow(row)!).filter(Boolean),
      skills: skillRows.map((row) => skillVersionFromRow(row)!).filter(Boolean),
      summaries: this.searchTaskSummaries(context.projectId, query, 2),
    };
  }

  searchTaskSummaries(projectId: string, query: string, limit = 2): string[] {
    if (query === "") {
      const tasks = this.listSuccessfulTasksByProject(projectId);
      return tasks
        .slice(0, limit)
        .map((task) => this.summarizeTask(task.id))
        .filter((summary): summary is string => typeof summary === "string");
    }

    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) {
      return this.searchTaskSummaries(projectId, "", limit);
    }

    const ftsQuery = tokens.map((t) => `"${t}"`).join(" OR ");
    const ftsRows = this.db
      .prepare(
        `SELECT task_id, rank
         FROM task_search
         WHERE task_search MATCH ?
           AND project_id = ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(ftsQuery, projectId, limit) as Row[];

    if (ftsRows.length > 0) {
      return ftsRows
        .map((row) => this.summarizeTask(String(row.task_id)))
        .filter((summary): summary is string => typeof summary === "string");
    }

    const tasks = this.listSuccessfulTasksByProject(projectId);
    return tasks
      .slice(0, limit)
      .map((task) => this.summarizeTask(task.id))
      .filter((summary): summary is string => typeof summary === "string");
  }
}

export function openAgentStore(options: AgentStoreOptions = {}): AgentStore {
  return new AgentStore(options);
}
