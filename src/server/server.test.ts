import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { PACKAGE_VERSION } from "../lib/package.js";

// The server/index.ts registers providers, seeds blueprints, and exports
// { port, fetch: app.fetch }. We import it to get the fetch handler.
// We set the DB env var BEFORE import so the module uses :memory:.
process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";

// Dynamic import to ensure env is set first
const serverModule = await import("./index.js");
const serverFetch = serverModule.default.fetch;

function request(path: string, init?: RequestInit): Promise<Response> {
  return serverFetch(new Request(`http://localhost${path}`, init), {} as any);
}

describe("server REST API", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("GET /api/health", () => {
    it("returns 200 with status ok", async () => {
      const res = await request("/api/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; version: string };
      expect(body.status).toBe("ok");
      expect(body.version).toBe(PACKAGE_VERSION);
    });
  });

  describe("POST /api/projects", () => {
    it("creates a project and returns 201", async () => {
      const res = await request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test-proj",
          source_type: "git",
          source_url: "https://github.com/test/repo",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string };
      expect(body.name).toBe("test-proj");
      expect(body.id).toBeDefined();
    });
  });

  describe("GET /api/projects", () => {
    it("lists projects", async () => {
      // Create a project first
      await request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "list-proj", source_type: "git", source_url: "" }),
      });
      const res = await request("/api/projects");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; name: string }[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /api/projects/:id", () => {
    it("returns 404 for missing project", async () => {
      const res = await request("/api/projects/nonexistent-id");
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeDefined();
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("deletes a project", async () => {
      const createRes = await request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "del-proj", source_type: "git", source_url: "" }),
      });
      const created = (await createRes.json()) as { id: string };

      const delRes = await request(`/api/projects/${created.id}`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);
      const body = (await delRes.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify it's gone
      const getRes = await request(`/api/projects/${created.id}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe("POST /api/providers", () => {
    it("creates a provider", async () => {
      const res = await request("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "my-vercel",
          type: "vercel",
          credentials_key: "vercel-key",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; name: string; type: string };
      expect(body.name).toBe("my-vercel");
      expect(body.type).toBe("vercel");
    });
  });
});
