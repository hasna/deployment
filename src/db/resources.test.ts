import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { createProvider } from "./providers.js";
import { createEnvironment } from "./environments.js";
import {
  createResource,
  getResource,
  listResources,
  updateResource,
  deleteResource,
} from "./resources.js";
import { ResourceNotFoundError } from "../types/index.js";

describe("resources", () => {
  let environmentId: string;

  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const project = createProject({ name: "res-proj", source_type: "git", source_url: "" });
    const provider = createProvider({ name: "res-prov", type: "aws", credentials_key: "" });
    const env = createEnvironment({
      project_id: project.id,
      name: "dev",
      type: "dev",
      provider_id: provider.id,
    });
    environmentId = env.id;
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("createResource", () => {
    it("creates a resource with all fields", () => {
      const r = createResource({
        environment_id: environmentId,
        type: "database",
        name: "postgres",
        provider_resource_id: "rds-123",
        config: { engine: "postgres" },
      });
      expect(r.id).toBeDefined();
      expect(r.environment_id).toBe(environmentId);
      expect(r.type).toBe("database");
      expect(r.name).toBe("postgres");
      expect(r.provider_resource_id).toBe("rds-123");
      expect(r.config).toEqual({ engine: "postgres" });
      expect(r.status).toBe("provisioning");
      expect(r.created_at).toBeDefined();
    });

    it("creates a resource with defaults", () => {
      const r = createResource({
        environment_id: environmentId,
        type: "cache",
        name: "redis",
      });
      expect(r.provider_resource_id).toBe("");
      expect(r.config).toEqual({});
      expect(r.status).toBe("provisioning");
    });
  });

  describe("getResource", () => {
    it("gets a resource by full ID", () => {
      const created = createResource({
        environment_id: environmentId,
        type: "storage",
        name: "s3-bucket",
      });
      const fetched = getResource(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("s3-bucket");
    });

    it("throws ResourceNotFoundError for missing ID", () => {
      expect(() => getResource("nonexistent")).toThrow(ResourceNotFoundError);
    });
  });

  describe("listResources", () => {
    it("lists resources by environment_id", () => {
      createResource({ environment_id: environmentId, type: "database", name: "db1" });
      createResource({ environment_id: environmentId, type: "cache", name: "cache1" });
      const resources = listResources({ environment_id: environmentId });
      expect(resources.length).toBe(2);
    });

    it("filters by type", () => {
      createResource({ environment_id: environmentId, type: "database", name: "db" });
      createResource({ environment_id: environmentId, type: "cache", name: "cache" });
      const dbs = listResources({ type: "database" });
      expect(dbs.length).toBe(1);
      expect(dbs[0]!.type).toBe("database");
    });

    it("filters by status", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "db" });
      updateResource(r.id, { status: "active" });
      createResource({ environment_id: environmentId, type: "cache", name: "cache" });
      const activeRes = listResources({ status: "active" });
      expect(activeRes.length).toBe(1);
      expect(activeRes[0]!.status).toBe("active");
    });

    it("returns all resources when no filter", () => {
      createResource({ environment_id: environmentId, type: "database", name: "db" });
      const resources = listResources();
      expect(resources.length).toBe(1);
    });
  });

  describe("updateResource", () => {
    it("updates resource status", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "db" });
      const updated = updateResource(r.id, { status: "active" });
      expect(updated.status).toBe("active");
    });

    it("updates resource name", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "old" });
      const updated = updateResource(r.id, { name: "new" });
      expect(updated.name).toBe("new");
    });

    it("updates provider_resource_id", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "db" });
      const updated = updateResource(r.id, { provider_resource_id: "ext-123" });
      expect(updated.provider_resource_id).toBe("ext-123");
    });

    it("updates config", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "db" });
      const updated = updateResource(r.id, { config: { url: "postgres://..." } });
      expect(updated.config).toEqual({ url: "postgres://..." });
    });

    it("throws ResourceNotFoundError for nonexistent resource", () => {
      expect(() => updateResource("nonexistent", { status: "active" })).toThrow(
        ResourceNotFoundError
      );
    });
  });

  describe("deleteResource", () => {
    it("deletes a resource", () => {
      const r = createResource({ environment_id: environmentId, type: "database", name: "db" });
      deleteResource(r.id);
      expect(() => getResource(r.id)).toThrow(ResourceNotFoundError);
    });

    it("throws ResourceNotFoundError for nonexistent resource", () => {
      expect(() => deleteResource("nonexistent")).toThrow(ResourceNotFoundError);
    });
  });
});
