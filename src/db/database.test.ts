import { Database } from "bun:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDatabase,
  closeDatabase,
  resetDatabase,
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

describe("database", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
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
      expect(tableNames).toContain("_migrations");
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
