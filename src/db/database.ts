import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";

let db: Database | null = null;

const PRIMARY_STORAGE_MODE_ENV = "HASNA_DEPLOYMENT_STORAGE_MODE";
const FALLBACK_STORAGE_MODE_ENV = "DEPLOYMENT_STORAGE_MODE";
const LOCAL_STORAGE_MODES = new Set(["", "local", "sqlite"]);

export type DeploymentStorageMode = "local";

interface SqliteColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

interface AddColumnMigration {
  table: string;
  column: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
}

export interface SaveFeedbackInput {
  id?: string;
  service?: string;
  version?: string;
  message: string;
  email?: string | null;
  category?: string | null;
  machine_id?: string;
  created_at?: string;
}

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
  // v2: Secrets registry
  `CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    environment TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'local',
    aws_arn TEXT NOT NULL DEFAULT '',
    last_rotated TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_name, environment, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_secrets_project_env ON secrets(project_name, environment)`,
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
  // v3: Deployment history tracking
  `ALTER TABLE deployments ADD COLUMN failure_reason TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE deployments ADD COLUMN build_skipped INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE deployments ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE deployments ADD COLUMN triggered_by TEXT NOT NULL DEFAULT ''`,
];

export function getDataDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  migrateLegacyDeploymentDir(home);
  const newDir = join(home, ".hasna", "deployment");
  mkdirSync(newDir, { recursive: true });
  return newDir;
}

export function getStorageMode(): DeploymentStorageMode {
  const rawMode =
    process.env[PRIMARY_STORAGE_MODE_ENV] ??
    process.env[FALLBACK_STORAGE_MODE_ENV] ??
    "local";
  const mode = rawMode.trim().toLowerCase();

  if (LOCAL_STORAGE_MODES.has(mode)) return "local";

  throw new Error(
    "Unsupported deployment storage mode. " +
      `Runtime storage is local SQLite only; set ${PRIMARY_STORAGE_MODE_ENV}=local or ${FALLBACK_STORAGE_MODE_ENV}=local. ` +
      "Database URL variables do not select remote storage."
  );
}

function migrateLegacyDeploymentDir(home: string): void {
  const hasnaDir = join(home, ".hasna");
  const newDir = join(hasnaDir, "deployment");
  const oldDir = join(home, ".deployment");
  const oldDbPath = join(oldDir, "deployment.db");
  const newDbPath = join(newDir, "deployment.db");

  if (!existsSync(newDir) && existsSync(oldDir)) {
    try {
      mkdirSync(hasnaDir, { recursive: true });
      cpSync(oldDir, newDir, { recursive: true });
      return;
    } catch {
      // Best-effort compatibility migration; the canonical directory is still created below.
    }
  }

  if (!existsSync(newDbPath) && existsSync(oldDbPath)) {
    copyLegacyDatabaseFiles(oldDir, newDir);
  }
}

function copyLegacyDatabaseFiles(oldDir: string, newDir: string): void {
  const databaseFiles = [
    "deployment.db",
    "deployment.db-wal",
    "deployment.db-shm",
    "deployment.db-journal",
  ];

  try {
    mkdirSync(newDir, { recursive: true });
    for (const file of databaseFiles) {
      const source = join(oldDir, file);
      const destination = join(newDir, file);
      if (existsSync(source) && !existsSync(destination)) {
        copyFileSync(source, destination);
      }
    }
  } catch {
    // The DB will be created normally if the compatibility copy cannot run.
  }
}

function getDbPath(): string {
  if (process.env["HASNA_DEPLOYMENT_DB_PATH"]) return process.env["HASNA_DEPLOYMENT_DB_PATH"];
  const envPath = process.env["OPEN_DEPLOYMENT_DB"];
  if (envPath) return envPath;

  return join(getDataDir(), "deployment.db");
}

function getColumnInfo(
  database: Database,
  table: string,
  column: string
): SqliteColumnInfo | null {
  const rows = database
    .query(`PRAGMA table_info(${table})`)
    .all() as SqliteColumnInfo[];

  return rows.find((row) => row.name === column) ?? null;
}

function markMigrationApplied(database: Database, id: number): void {
  database
    .query("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)")
    .run(id, now());
}

function parseAddColumnMigration(migration: string): AddColumnMigration | null {
  const match = migration.match(
    /^ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/i
  );
  if (!match) return null;

  const definition = match[3]?.trim() ?? "";
  const type = definition.split(/\s+/)[0]?.toUpperCase() ?? "";
  const defaultMatch = definition.match(/\bDEFAULT\s+(.+)$/i);

  return {
    table: match[1]!,
    column: match[2]!,
    type,
    notNull: /\bNOT\s+NULL\b/i.test(definition),
    defaultValue: defaultMatch ? defaultMatch[1]!.trim() : null,
  };
}

function isAddColumnMigrationAlreadyApplied(
  database: Database,
  migration: string
): boolean {
  const parsed = parseAddColumnMigration(migration);
  if (!parsed) return false;

  const column = getColumnInfo(database, parsed.table, parsed.column);
  if (!column) return false;

  return (
    column.type.toUpperCase() === parsed.type &&
    Boolean(column.notnull) === parsed.notNull &&
    column.dflt_value === parsed.defaultValue
  );
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
      const migration = MIGRATIONS[i]!;
      if (isAddColumnMigrationAlreadyApplied(database, migration)) {
        markMigrationApplied(database, i);
        continue;
      }

      database.exec(migration);
      markMigrationApplied(database, i);
    }
  }
}

function configureDatabase(database: Database): void {
  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA busy_timeout = 5000");
}

function ensureParentDir(dbPath: string): void {
  if (dbPath === ":memory:") return;
  mkdirSync(dirname(dbPath), { recursive: true });
}

function ensureFeedbackTable(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      service TEXT NOT NULL DEFAULT 'deployment',
      version TEXT DEFAULT '',
      message TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      email TEXT DEFAULT '',
      machine_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  ensureFeedbackColumn(database, "service", "TEXT NOT NULL DEFAULT 'deployment'");
  ensureFeedbackColumn(database, "version", "TEXT DEFAULT ''");
  ensureFeedbackColumn(database, "category", "TEXT DEFAULT 'general'");
  ensureFeedbackColumn(database, "email", "TEXT DEFAULT ''");
  ensureFeedbackColumn(database, "machine_id", "TEXT DEFAULT ''");
  ensureFeedbackColumn(database, "created_at", "TEXT DEFAULT ''");
}

function ensureFeedbackColumn(
  database: Database,
  column: string,
  definition: string
): void {
  const existing = getColumnInfo(database, "feedback", column);
  if (existing) return;
  database.exec(`ALTER TABLE feedback ADD COLUMN ${column} ${definition}`);
}

export function getDatabase(): Database {
  if (db) return db;

  getStorageMode();
  const dbPath = getDbPath();
  ensureParentDir(dbPath);
  const database = new Database(dbPath);

  try {
    configureDatabase(database);
    runMigrations(database);
    ensureFeedbackTable(database);
  } catch (error) {
    database.close();
    throw error;
  }

  db = database;
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
}

export function saveFeedback(input: SaveFeedbackInput): string {
  const database = getDatabase();
  const id = input.id ?? randomUUID();
  const service = input.service ?? "deployment";
  const version = input.version ?? "";
  const email = input.email ?? "";
  const category = input.category ?? "general";
  const machineId = input.machine_id ?? hostname();
  const createdAt = input.created_at ?? now();

  database
    .query(
      `INSERT INTO feedback (id, service, version, message, email, category, machine_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, service, version, input.message, email, category, machineId, createdAt);

  return id;
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
