import { Database } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDataDir,
  getDatabase,
  closeDatabase,
  getStorageMode,
  resetDatabase,
  saveFeedback,
  uuid,
  now,
  resolvePartialId,
} from "./database.js";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

let tempDirs: string[] = [];

describe("database", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalDeploymentDbPath: string | undefined;
  let originalDeploymentDb: string | undefined;
  let originalStorageMode: string | undefined;
  let originalFallbackStorageMode: string | undefined;
  let originalDatabaseUrl: string | undefined;

  beforeEach(() => {
    originalHome = process.env["HOME"];
    originalUserProfile = process.env["USERPROFILE"];
    originalDeploymentDbPath = process.env["HASNA_DEPLOYMENT_DB_PATH"];
    originalDeploymentDb = process.env["OPEN_DEPLOYMENT_DB"];
    originalStorageMode = process.env["HASNA_DEPLOYMENT_STORAGE_MODE"];
    originalFallbackStorageMode = process.env["DEPLOYMENT_STORAGE_MODE"];
    originalDatabaseUrl = process.env["DATABASE_URL"];

    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    delete process.env["HASNA_DEPLOYMENT_DB_PATH"];
    delete process.env["HASNA_DEPLOYMENT_STORAGE_MODE"];
    delete process.env["DEPLOYMENT_STORAGE_MODE"];
    delete process.env["DATABASE_URL"];
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("HASNA_DEPLOYMENT_DB_PATH", originalDeploymentDbPath);
    restoreEnv("OPEN_DEPLOYMENT_DB", originalDeploymentDb);
    restoreEnv("HASNA_DEPLOYMENT_STORAGE_MODE", originalStorageMode);
    restoreEnv("DEPLOYMENT_STORAGE_MODE", originalFallbackStorageMode);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs = [];
  });

  describe("getDatabase", () => {
    it("returns a Database instance", () => {
      const db = getDatabase();
      expect(db).toBeDefined();
    });

    it("returns the same singleton instance on repeated calls", () => {
      const db1 = getDatabase();
      const db2 = getDatabase();
      expect(db1).toBe(db2);
    });

    it("sets WAL mode pragma (returns memory for :memory: db)", () => {
      const db = getDatabase();
      const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
      // In-memory databases report "memory" instead of "wal"
      expect(["wal", "memory"]).toContain(result.journal_mode);
    });

    it("enables foreign keys", () => {
      const db = getDatabase();
      const result = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
    });

    it("runs migrations and creates all tables", () => {
      const db = getDatabase();
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("projects");
      expect(tableNames).toContain("providers");
      expect(tableNames).toContain("environments");
      expect(tableNames).toContain("deployments");
      expect(tableNames).toContain("resources");
      expect(tableNames).toContain("blueprints");
      expect(tableNames).toContain("agents");
      expect(tableNames).toContain("feedback");
      expect(tableNames).toContain("_migrations");
    });

    it("allows feedback inserts without caller-supplied IDs", () => {
      const db = getDatabase();

      db.run(
        "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
        ["hello", null, "general", "0.0.0"]
      );

      const row = db
        .query("SELECT id, service, message, created_at FROM feedback")
        .get() as { id: string; service: string; message: string; created_at: string };
      expect(row.message).toBe("hello");
      expect(row.service).toBe("deployment");
      expect(row.id).toMatch(/^[0-9a-f]{32}$/);
      expect(row.created_at.length).toBeGreaterThan(0);
    });

    it("saves feedback through the compatibility helper on a fresh table", () => {
      const id = saveFeedback({
        message: "fresh feedback",
        email: "person@example.com",
        category: "feature",
        version: "0.0.0",
        machine_id: "test-machine",
      });

      const row = getDatabase()
        .query("SELECT * FROM feedback WHERE id = ?")
        .get(id) as {
          id: string;
          service: string;
          version: string;
          message: string;
          email: string;
          category: string;
          machine_id: string;
          created_at: string;
        };

      expect(row).toMatchObject({
        id,
        service: "deployment",
        version: "0.0.0",
        message: "fresh feedback",
        email: "person@example.com",
        category: "feature",
        machine_id: "test-machine",
      });
      expect(row.created_at.length).toBeGreaterThan(0);
    });

    it("upgrades the retired shared feedback table before saving feedback", () => {
      const dir = mkTempDir("open-deployment-old-feedback-");
      const dbPath = join(dir, "deployment.db");
      const oldDb = new Database(dbPath);

      oldDb.exec(`
        CREATE TABLE feedback (
          id TEXT PRIMARY KEY,
          service TEXT NOT NULL,
          version TEXT DEFAULT '',
          message TEXT NOT NULL,
          email TEXT DEFAULT '',
          machine_id TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      oldDb.close();

      process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

      const id = saveFeedback({
        message: "legacy feedback",
        category: "bug",
        version: "0.0.17",
        machine_id: "legacy-machine",
      });

      const columns = getDatabase()
        .query("PRAGMA table_info(feedback)")
        .all() as ColumnInfo[];
      expect(columns.some((column) => column.name === "category")).toBe(true);

      const row = getDatabase()
        .query("SELECT id, service, version, message, email, category, machine_id FROM feedback WHERE id = ?")
        .get(id) as {
          id: string;
          service: string;
          version: string;
          message: string;
          email: string;
          category: string;
          machine_id: string;
        };
      expect(row).toEqual({
        id,
        service: "deployment",
        version: "0.0.17",
        message: "legacy feedback",
        email: "",
        category: "bug",
        machine_id: "legacy-machine",
      });
    });

    it("ignores database URL variables unless storage mode is explicitly supported", () => {
      const dir = mkTempDir("open-deployment-storage-");
      const home = join(dir, "home");
      process.env["HOME"] = home;
      delete process.env["OPEN_DEPLOYMENT_DB"];
      process.env["DATABASE_URL"] = "postgres://user:super-secret-password@example.invalid:5432/deployment";

      expect(getStorageMode()).toBe("local");

      const db = getDatabase();
      expect(db.query("SELECT name FROM sqlite_master WHERE name = 'projects'").get()).toBeDefined();

      const dbPath = join(home, ".hasna", "deployment", "deployment.db");
      expect(existsSync(dbPath)).toBe(true);

      const leakedRows = db
        .query("SELECT name FROM sqlite_master WHERE sql LIKE ?")
        .all("%super-secret-password%");
      expect(leakedRows).toHaveLength(0);
    });

    it("requires an explicit supported storage mode", () => {
      process.env["HASNA_DEPLOYMENT_STORAGE_MODE"] = "remote";

      expect(() => getDatabase()).toThrow("Unsupported deployment storage mode");
    });

    it("accepts normalized local storage modes from primary and fallback env vars", () => {
      process.env["HASNA_DEPLOYMENT_STORAGE_MODE"] = " SQLite ";
      expect(getStorageMode()).toBe("local");

      delete process.env["HASNA_DEPLOYMENT_STORAGE_MODE"];
      process.env["DEPLOYMENT_STORAGE_MODE"] = "LOCAL";
      expect(getStorageMode()).toBe("local");
    });

    it("does not expose raw unsupported storage mode values in errors", () => {
      process.env["HASNA_DEPLOYMENT_STORAGE_MODE"] =
        "postgres://user:super-secret-password@example.invalid:5432/deployment";

      expect(() => getDatabase()).toThrow("Unsupported deployment storage mode");
      expect(() => getDatabase()).not.toThrow("super-secret-password");
      expect(() => getDatabase()).not.toThrow("postgres://user");
    });

    it("copies legacy deployment data into the canonical data directory", () => {
      const dir = mkTempDir("open-deployment-legacy-");
      const home = join(dir, "home");
      const legacyDir = join(home, ".deployment");
      const legacyDb = join(legacyDir, "deployment.db");
      const newDir = join(home, ".hasna", "deployment");
      const newDb = join(newDir, "deployment.db");

      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(legacyDb, "legacy-db");
      process.env["HOME"] = home;

      expect(getDataDir()).toBe(newDir);
      expect(readFileSync(newDb, "utf8")).toBe("legacy-db");
      expect(existsSync(legacyDb)).toBe(true);
    });

    it("copies legacy SQLite sidecars when the canonical directory already exists", () => {
      const dir = mkTempDir("open-deployment-legacy-sidecars-");
      const home = join(dir, "home");
      const legacyDir = join(home, ".deployment");
      const newDir = join(home, ".hasna", "deployment");

      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(legacyDir, "deployment.db"), "legacy-db");
      writeFileSync(join(legacyDir, "deployment.db-wal"), "legacy-wal");
      writeFileSync(join(legacyDir, "deployment.db-shm"), "legacy-shm");
      process.env["HOME"] = home;

      expect(getDataDir()).toBe(newDir);
      expect(readFileSync(join(newDir, "deployment.db"), "utf8")).toBe("legacy-db");
      expect(readFileSync(join(newDir, "deployment.db-wal"), "utf8")).toBe("legacy-wal");
      expect(readFileSync(join(newDir, "deployment.db-shm"), "utf8")).toBe("legacy-shm");
    });

    it("does not overwrite an existing canonical database during legacy migration", () => {
      const dir = mkTempDir("open-deployment-legacy-no-overwrite-");
      const home = join(dir, "home");
      const legacyDir = join(home, ".deployment");
      const newDir = join(home, ".hasna", "deployment");
      const newDb = join(newDir, "deployment.db");

      mkdirSync(legacyDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });
      writeFileSync(join(legacyDir, "deployment.db"), "legacy-db");
      writeFileSync(newDb, "canonical-db");
      process.env["HOME"] = home;

      expect(getDataDir()).toBe(newDir);
      expect(readFileSync(newDb, "utf8")).toBe("canonical-db");
    });

    it("treats the agent focus migration as already applied when the column exists", () => {
      const dir = mkdtempSync(join(tmpdir(), "open-deployment-db-"));
      const dbPath = join(dir, "deployment.db");
      const existingDb = new Database(dbPath);

      existingDb.exec(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL DEFAULT 'agent',
          registered_at TEXT NOT NULL,
          last_seen TEXT NOT NULL,
          project_id TEXT
        )
      `);
      existingDb.close();

      process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

      expect(() => getDatabase()).not.toThrow();

      const columns = getDatabase()
        .query("PRAGMA table_info(agents)")
        .all() as { name: string }[];
      const projectIdColumns = columns.filter((column) => column.name === "project_id");

      expect(projectIdColumns).toHaveLength(1);

      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    });

    it("treats deployment history migrations as already applied when the columns exist", () => {
      const dir = mkdtempSync(join(tmpdir(), "open-deployment-db-"));
      const dbPath = join(dir, "deployment.db");
      const existingDb = new Database(dbPath);

      existingDb.exec(`
        CREATE TABLE deployments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          environment_id TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          url TEXT NOT NULL DEFAULT '',
          image TEXT NOT NULL DEFAULT '',
          commit_sha TEXT NOT NULL DEFAULT '',
          logs TEXT NOT NULL DEFAULT '',
          started_at TEXT NOT NULL DEFAULT '',
          completed_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          failure_reason TEXT NOT NULL DEFAULT '',
          build_skipped INTEGER NOT NULL DEFAULT 0,
          duration_seconds INTEGER NOT NULL DEFAULT 0,
          triggered_by TEXT NOT NULL DEFAULT ''
        )
      `);
      existingDb.close();

      process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

      expect(() => getDatabase()).not.toThrow();

      const columns = getDatabase()
        .query("PRAGMA table_info(deployments)")
        .all() as ColumnInfo[];

      expect(columns.find((column) => column.name === "failure_reason")).toMatchObject({
        type: "TEXT",
        notnull: 1,
        dflt_value: "''",
      });
      expect(columns.find((column) => column.name === "build_skipped")).toMatchObject({
        type: "INTEGER",
        notnull: 1,
        dflt_value: "0",
      });
      expect(columns.find((column) => column.name === "duration_seconds")).toMatchObject({
        type: "INTEGER",
        notnull: 1,
        dflt_value: "0",
      });
      expect(columns.find((column) => column.name === "triggered_by")).toMatchObject({
        type: "TEXT",
        notnull: 1,
        dflt_value: "''",
      });

      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    });

    it("does not mark incompatible existing columns as applied", () => {
      const dir = mkdtempSync(join(tmpdir(), "open-deployment-db-"));
      const dbPath = join(dir, "deployment.db");
      const existingDb = new Database(dbPath);

      existingDb.exec(`
        CREATE TABLE deployments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          environment_id TEXT NOT NULL,
          version TEXT,
          status TEXT,
          url TEXT,
          image TEXT,
          commit_sha TEXT,
          logs TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          failure_reason INTEGER,
          build_skipped TEXT,
          duration_seconds TEXT,
          triggered_by TEXT
        )
      `);
      existingDb.close();

      process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

      expect(() => getDatabase()).toThrow("duplicate column name: failure_reason");
      expect(() => getDatabase()).toThrow("duplicate column name: failure_reason");

      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
      process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    });
  });

  describe("uuid", () => {
    it("returns a string", () => {
      const id = uuid();
      expect(typeof id).toBe("string");
    });

    it("returns unique values on each call", () => {
      const id1 = uuid();
      const id2 = uuid();
      expect(id1).not.toBe(id2);
    });

    it("returns a valid UUID format", () => {
      const id = uuid();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  describe("now", () => {
    it("returns an ISO timestamp string", () => {
      const ts = now();
      expect(typeof ts).toBe("string");
      expect(new Date(ts).toISOString()).toBe(ts);
    });
  });

  describe("resolvePartialId", () => {
    it("resolves a partial ID to a full ID when there is exactly one match", () => {
      const db = getDatabase();
      const id = uuid();
      const ts = now();
      db.query(
        "INSERT INTO projects (id, name, source_type, source_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, "test-project", "git", "", "", ts, ts);

      const prefix = id.substring(0, 8);
      const resolved = resolvePartialId("projects", prefix);
      expect(resolved).toBe(id);
    });

    it("returns null when no match is found", () => {
      getDatabase();
      const resolved = resolvePartialId("projects", "nonexistent-prefix");
      expect(resolved).toBeNull();
    });

    it("returns null when multiple matches are found", () => {
      const db = getDatabase();
      const ts = now();
      // Insert two projects with IDs that share a prefix
      const prefix = "aaaa";
      db.query(
        "INSERT INTO projects (id, name, source_type, source_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(`${prefix}1111-0000-0000-0000-000000000000`, "proj1", "git", "", "", ts, ts);
      db.query(
        "INSERT INTO projects (id, name, source_type, source_url, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(`${prefix}2222-0000-0000-0000-000000000000`, "proj2", "git", "", "", ts, ts);

      const resolved = resolvePartialId("projects", prefix);
      expect(resolved).toBeNull();
    });

    it("returns null for disallowed table names", () => {
      getDatabase();
      const resolved = resolvePartialId("invalid_table", "abc");
      expect(resolved).toBeNull();
    });
  });

  describe("closeDatabase", () => {
    it("closes the database so a new one is created on next getDatabase", () => {
      const db1 = getDatabase();
      closeDatabase();
      const db2 = getDatabase();
      expect(db2).toBeDefined();
      expect(db1).not.toBe(db2);
    });

    it("is safe to call multiple times", () => {
      getDatabase();
      closeDatabase();
      closeDatabase();
      // Should not throw
    });
  });

  describe("resetDatabase", () => {
    it("resets by closing the database", () => {
      const db1 = getDatabase();
      resetDatabase();
      const db2 = getDatabase();
      expect(db1).not.toBe(db2);
    });
  });
});

function mkTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
