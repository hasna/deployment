import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase, getDatabase } from "../db/database.js";
import {
  ensureHooksTable,
  addHook,
  listHooks,
  removeHook,
  toggleHook,
  getHook,
} from "./hooks.js";

describe("hooks", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("ensureHooksTable", () => {
    it("creates the deployment_hooks table", () => {
      ensureHooksTable();
      const db = getDatabase();
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='deployment_hooks'")
        .all() as { name: string }[];
      expect(tables.length).toBe(1);
      expect(tables[0]!.name).toBe("deployment_hooks");
    });

    it("creates the idx_hooks_event index", () => {
      ensureHooksTable();
      const db = getDatabase();
      const indexes = db
        .query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_hooks_event'")
        .all() as { name: string }[];
      expect(indexes.length).toBe(1);
    });

    it("is idempotent — can be called multiple times", () => {
      ensureHooksTable();
      ensureHooksTable();
      ensureHooksTable();
      const db = getDatabase();
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='deployment_hooks'")
        .all() as { name: string }[];
      expect(tables.length).toBe(1);
    });
  });

  describe("addHook", () => {
    it("creates a hook and returns correct structure", () => {
      const hook = addHook("pre-deploy", "echo hello");
      expect(hook.id).toBeDefined();
      expect(typeof hook.id).toBe("string");
      expect(hook.event).toBe("pre-deploy");
      expect(hook.command).toBe("echo hello");
      expect(hook.project_id).toBeNull();
      expect(hook.environment_id).toBeNull();
      expect(hook.enabled).toBe(true);
      expect(hook.created_at).toBeDefined();
    });

    it("creates a hook scoped to a project", () => {
      const hook = addHook("post-deploy", "notify.sh", "proj-123");
      expect(hook.project_id).toBe("proj-123");
      expect(hook.environment_id).toBeNull();
    });

    it("creates a hook scoped to both project and environment", () => {
      const hook = addHook("deploy-failed", "alert.sh", "proj-123", "env-456");
      expect(hook.project_id).toBe("proj-123");
      expect(hook.environment_id).toBe("env-456");
    });

    it("creates multiple hooks with unique IDs", () => {
      const h1 = addHook("pre-deploy", "cmd1");
      const h2 = addHook("pre-deploy", "cmd2");
      expect(h1.id).not.toBe(h2.id);
    });

    it("creates hooks for all event types", () => {
      const events = [
        "pre-deploy",
        "post-deploy",
        "deploy-failed",
        "pre-rollback",
        "post-rollback",
        "pre-promote",
        "post-promote",
      ] as const;

      for (const event of events) {
        const hook = addHook(event, `run-${event}`);
        expect(hook.event).toBe(event);
      }
    });
  });

  describe("getHook", () => {
    it("retrieves a hook by ID", () => {
      const created = addHook("pre-deploy", "echo test");
      const fetched = getHook(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.event).toBe("pre-deploy");
      expect(fetched.command).toBe("echo test");
    });

    it("throws for nonexistent hook", () => {
      ensureHooksTable();
      expect(() => getHook("nonexistent-id")).toThrow("Hook not found");
    });
  });

  describe("listHooks", () => {
    it("returns all hooks when no filters given", () => {
      addHook("pre-deploy", "cmd1");
      addHook("post-deploy", "cmd2");
      addHook("deploy-failed", "cmd3");

      const hooks = listHooks();
      expect(hooks.length).toBe(3);
    });

    it("returns empty array when no hooks exist", () => {
      ensureHooksTable();
      const hooks = listHooks();
      expect(hooks).toEqual([]);
    });

    it("filters by event", () => {
      addHook("pre-deploy", "cmd1");
      addHook("post-deploy", "cmd2");
      addHook("pre-deploy", "cmd3");

      const preDeployHooks = listHooks("pre-deploy");
      expect(preDeployHooks.length).toBe(2);
      for (const h of preDeployHooks) {
        expect(h.event).toBe("pre-deploy");
      }
    });

    it("filters by project_id (includes global hooks)", () => {
      addHook("pre-deploy", "global-cmd");
      addHook("pre-deploy", "project-cmd", "proj-123");
      addHook("pre-deploy", "other-project-cmd", "proj-456");

      const hooks = listHooks(undefined, "proj-123");
      expect(hooks.length).toBe(2); // global + proj-123
      const commands = hooks.map((h) => h.command);
      expect(commands).toContain("global-cmd");
      expect(commands).toContain("project-cmd");
      expect(commands).not.toContain("other-project-cmd");
    });

    it("filters by both event and project_id", () => {
      addHook("pre-deploy", "cmd1", "proj-123");
      addHook("post-deploy", "cmd2", "proj-123");
      addHook("pre-deploy", "cmd3"); // global

      const hooks = listHooks("pre-deploy", "proj-123");
      expect(hooks.length).toBe(2); // proj-123 pre-deploy + global pre-deploy
    });

    it("returns hooks ordered by created_at ASC", () => {
      const h1 = addHook("pre-deploy", "first");
      const h2 = addHook("pre-deploy", "second");
      const h3 = addHook("pre-deploy", "third");

      const hooks = listHooks();
      expect(hooks[0]!.command).toBe("first");
      expect(hooks[1]!.command).toBe("second");
      expect(hooks[2]!.command).toBe("third");
    });
  });

  describe("removeHook", () => {
    it("deletes a hook", () => {
      const hook = addHook("pre-deploy", "to-delete");
      expect(listHooks().length).toBe(1);

      removeHook(hook.id);
      expect(listHooks().length).toBe(0);
    });

    it("does not throw when removing nonexistent hook", () => {
      ensureHooksTable();
      expect(() => removeHook("nonexistent-id")).not.toThrow();
    });

    it("only deletes the specified hook", () => {
      const h1 = addHook("pre-deploy", "keep");
      const h2 = addHook("post-deploy", "delete");

      removeHook(h2.id);
      const remaining = listHooks();
      expect(remaining.length).toBe(1);
      expect(remaining[0]!.id).toBe(h1.id);
    });
  });

  describe("toggleHook", () => {
    it("disables an enabled hook", () => {
      const hook = addHook("pre-deploy", "toggle-me");
      expect(hook.enabled).toBe(true);

      const disabled = toggleHook(hook.id, false);
      expect(disabled.enabled).toBe(false);
      expect(disabled.id).toBe(hook.id);
    });

    it("enables a disabled hook", () => {
      const hook = addHook("pre-deploy", "toggle-me");
      toggleHook(hook.id, false);
      const enabled = toggleHook(hook.id, true);
      expect(enabled.enabled).toBe(true);
    });

    it("preserves all other hook fields", () => {
      const hook = addHook("post-deploy", "my-cmd", "proj-1", "env-1");
      const toggled = toggleHook(hook.id, false);

      expect(toggled.event).toBe("post-deploy");
      expect(toggled.command).toBe("my-cmd");
      expect(toggled.project_id).toBe("proj-1");
      expect(toggled.environment_id).toBe("env-1");
      expect(toggled.created_at).toBe(hook.created_at);
    });

    it("throws for nonexistent hook", () => {
      ensureHooksTable();
      expect(() => toggleHook("nonexistent-id", false)).toThrow("Hook not found");
    });
  });
});
