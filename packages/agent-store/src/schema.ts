import type { DatabaseSync } from "node:sqlite";

export const AGENT_STORE_SCHEMA_VERSION = 2;

const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  outcome_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  project_id TEXT,
  user_id TEXT,
  repo_path TEXT,
  kind TEXT NOT NULL,
  fact TEXT NOT NULL,
  evidence_task_id TEXT,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_markdown TEXT NOT NULL,
  extraction_task_id TEXT,
  generator_model TEXT,
  status TEXT NOT NULL,
  eval_score REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  user_accepted INTEGER,
  rollback_required INTEGER,
  notes TEXT,
  FOREIGN KEY (skill_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS eval_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  input_json TEXT NOT NULL,
  expected_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id)
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score REAL NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (dataset_id) REFERENCES eval_datasets(id)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id_seq ON task_events(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(scope, status);
CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_repo_path ON memories(repo_path);
CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_id ON skill_versions(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_versions_status ON skill_versions(status);
CREATE INDEX IF NOT EXISTS idx_eval_runs_target ON eval_runs(target_type, target_id);
`;

const SCHEMA_V2_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(
  task_id UNINDEXED,
  project_id UNINDEXED,
  title,
  prompt,
  outcome_summary,
  event_text,
  content=''
);
`;

function populateTaskSearch(db: DatabaseSync): void {
  const tasks = db
    .prepare(
      `SELECT t.id, s.project_id, t.title, t.prompt, t.outcome_summary
       FROM tasks t
       INNER JOIN sessions s ON s.id = t.session_id
       WHERE t.status = 'completed' AND t.success = 1`,
    )
    .all() as Record<string, unknown>[];

  const insert = db.prepare(
    `INSERT INTO task_search(task_id, project_id, title, prompt, outcome_summary, event_text)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const task of tasks) {
    const events = db
      .prepare("SELECT payload_json FROM task_events WHERE task_id = ? ORDER BY seq")
      .all(String(task.id)) as Record<string, unknown>[];

    const eventText = events.map((e) => String(e.payload_json)).join(" ");

    insert.run(
      String(task.id),
      String(task.project_id),
      String(task.title),
      String(task.prompt),
      (task.outcome_summary as string | null) ?? "",
      eventText,
    );
  }
}

export function getAgentStoreSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return row?.user_version ?? 0;
}

export function migrateAgentStore(db: DatabaseSync): void {
  const version = getAgentStoreSchemaVersion(db);
  if (version > AGENT_STORE_SCHEMA_VERSION) {
    throw new Error(
      `agent-store schema version ${version} is newer than supported version ${AGENT_STORE_SCHEMA_VERSION}`,
    );
  }

  if (version === AGENT_STORE_SCHEMA_VERSION) {
    return;
  }

  db.exec("PRAGMA foreign_keys = ON;");

  if (version < 1) {
    db.exec(SCHEMA_V1_SQL);
  }

  if (version < 2) {
    db.exec(SCHEMA_V2_SQL);
    populateTaskSearch(db);
  }

  db.exec(`PRAGMA user_version = ${AGENT_STORE_SCHEMA_VERSION};`);
}
