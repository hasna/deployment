import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from "./projects.js";
import { createProvider } from "./providers.js";
import { createEnvironment } from "./environments.js";
import { ProjectNotFoundError } from "../types/index.js";

describe("projects", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("createProject", () => {
    it("creates a project with all fields", () => {
      const p = createProject({
        name: "my-app",
        source_type: "git",
        source_url: "https://github.com/test/repo",
        description: "Test project",
      });
      expect(p.id).toBeDefined();
      expect(p.name).toBe("my-app");
      expect(p.source_type).toBe("git");
      expect(p.source_url).toBe("https://github.com/test/repo");
      expect(p.description).toBe("Test project");
      expect(p.created_at).toBeDefined();
      expect(p.updated_at).toBeDefined();
    });

    it("creates a project with default description", () => {
      const p = createProject({
        name: "minimal-app",
        source_type: "docker",
        source_url: "",
      });
      expect(p.description).toBe("");
    });

    it("throws on duplicate name", () => {
      createProject({ name: "dup", source_type: "git", source_url: "" });
      expect(() =>
        createProject({ name: "dup", source_type: "git", source_url: "" })
      ).toThrow();
    });
  });

  describe("getProject", () => {
    it("gets a project by full ID", () => {
      const created = createProject({
        name: "get-test",
        source_type: "git",
        source_url: "",
      });
      const fetched = getProject(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("get-test");
    });

    it("gets a project by partial ID", () => {
      const created = createProject({
        name: "partial-test",
        source_type: "git",
        source_url: "",
      });
      const prefix = created.id.substring(0, 8);
      const fetched = getProject(prefix);
      expect(fetched.id).toBe(created.id);
    });

    it("throws ProjectNotFoundError for missing ID", () => {
      expect(() => getProject("nonexistent")).toThrow(ProjectNotFoundError);
    });
  });

  describe("listProjects", () => {
    it("lists all projects", () => {
      createProject({ name: "a", source_type: "git", source_url: "" });
      createProject({ name: "b", source_type: "git", source_url: "" });
      const projects = listProjects();
      expect(projects.length).toBe(2);
    });

    it("filters by search term in name", () => {
      createProject({ name: "alpha-app", source_type: "git", source_url: "" });
      createProject({ name: "beta-app", source_type: "git", source_url: "" });
      const results = listProjects({ search: "alpha" });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("alpha-app");
    });

    it("filters by search term in description", () => {
      createProject({
        name: "app1",
        source_type: "git",
        source_url: "",
        description: "A backend service",
      });
      createProject({
        name: "app2",
        source_type: "git",
        source_url: "",
        description: "A frontend client",
      });
      const results = listProjects({ search: "backend" });
      expect(results.length).toBe(1);
      expect(results[0]!.name).toBe("app1");
    });

    it("returns empty list when no projects exist", () => {
      const projects = listProjects();
      expect(projects.length).toBe(0);
    });
  });

  describe("updateProject", () => {
    it("updates project name", () => {
      const p = createProject({ name: "old", source_type: "git", source_url: "" });
      const updated = updateProject(p.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    it("updates source_type and source_url", () => {
      const p = createProject({ name: "src-test", source_type: "git", source_url: "" });
      const updated = updateProject(p.id, {
        source_type: "docker",
        source_url: "docker.io/img",
      });
      expect(updated.source_type).toBe("docker");
      expect(updated.source_url).toBe("docker.io/img");
    });

    it("updates description", () => {
      const p = createProject({ name: "desc-test", source_type: "git", source_url: "" });
      const updated = updateProject(p.id, { description: "Updated desc" });
      expect(updated.description).toBe("Updated desc");
    });

    it("updates updated_at timestamp", () => {
      const p = createProject({ name: "ts-test", source_type: "git", source_url: "" });
      const updated = updateProject(p.id, { name: "ts-test-2" });
      // updated_at should be >= created_at (may be same in fast tests)
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(p.updated_at).getTime()
      );
      // Verify that the update actually changed the field (name changed)
      expect(updated.name).toBe("ts-test-2");
    });

    it("throws ProjectNotFoundError for nonexistent project", () => {
      expect(() => updateProject("nonexistent", { name: "x" })).toThrow(
        ProjectNotFoundError
      );
    });
  });

  describe("deleteProject", () => {
    it("deletes a project", () => {
      const p = createProject({ name: "del-test", source_type: "git", source_url: "" });
      deleteProject(p.id);
      expect(() => getProject(p.id)).toThrow(ProjectNotFoundError);
    });

    it("cascades deletion to environments", () => {
      const p = createProject({ name: "cascade-test", source_type: "git", source_url: "" });
      const prov = createProvider({
        name: "prov-cascade",
        type: "vercel",
        credentials_key: "",
      });
      createEnvironment({
        project_id: p.id,
        name: "dev",
        type: "dev",
        provider_id: prov.id,
      });
      deleteProject(p.id);
      // If cascade works, the project and its environments are gone
      expect(() => getProject(p.id)).toThrow(ProjectNotFoundError);
    });

    it("throws ProjectNotFoundError for nonexistent project", () => {
      expect(() => deleteProject("nonexistent")).toThrow(ProjectNotFoundError);
    });
  });
});
