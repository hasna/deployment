import { Database } from "bun:sqlite";
import { SqliteAdapter, ensureFeedbackTable, migrateDotfile } from "@hasna/cloud";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

const MIGRATIONS = [
  // v1: Core tables
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL DEFAULT 'git',
    source_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    credentials_key TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'dev',
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    region TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    url TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    commit_sha TEXT NOT NULL DEFAULT '',
    logs TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_resource_id TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'provisioning',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    provider_type TEXT NOT NULL,
    template TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'agent',
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )`,
  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_env ON deployments(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_env ON resources(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type)`,
  `CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(type)`,
  `CREATE INDEX IF NOT EXISTS idx_blueprints_provider ON blueprints(provider_type)`,
  // v2: Add project_id to agents for set_focus support
  `ALTER TABLE agents ADD COLUMN project_id TEXT`,
];

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  migrateDotfile("deployment");
  const newDir = join(home, ".hasna", "deployment");
  mkdirSync(newDir, { recursive: true });
  return newDir;
}

function getDbPath(): string {
  if (process.env["HASNA_DEPLOYMENT_DB_PATH"]) return process.env["HASNA_DEPLOYMENT_DB_PATH"];
  const envPath = process.env["OPEN_DEPLOYMENT_DB"];
  if (envPath) return envPath;

  return join(getDataDir(), "deployment.db");
}

function runMigrations(database: Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  const applied = database
    .query("SELECT id FROM _migrations ORDER BY id")
    .all() as { id: number }[];
  const appliedSet = new Set(applied.map((r) => r.id));

  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (!appliedSet.has(i)) {
      database.exec(MIGRATIONS[i]!);
      database
        .query("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
        .run(i, now());
    }
  }
}

export function getDatabase(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  _adapter = new SqliteAdapter(dbPath);
  db = _adapter.raw;
  runMigrations(db);
  ensureFeedbackTable(_adapter);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    _adapter = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
}

export function uuid(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function resolvePartialId(
  table: string,
  partialId: string
): string | null {
  const database = getDatabase();
  const allowedTables = [
    "projects",
    "environments",
    "providers",
    "deployments",
    "resources",
    "blueprints",
    "agents",
  ];
  if (!allowedTables.includes(table)) return null;

  const rows = database
    .query(`SELECT id FROM ${table} WHERE id LIKE ? || '%'`)
    .all(partialId) as { id: string }[];

  if (rows.length === 1) return rows[0]!.id;
  return null;
}
