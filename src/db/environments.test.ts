import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { createProvider } from "./providers.js";
import {
  createEnvironment,
  getEnvironment,
  listEnvironments,
  updateEnvironment,
  deleteEnvironment,
} from "./environments.js";
import { EnvironmentNotFoundError } from "../types/index.js";

describe("environments", () => {
  let projectId: string;
  let providerId: string;

  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const project = createProject({ name: "env-test-proj", source_type: "git", source_url: "" });
    projectId = project.id;
    const provider = createProvider({ name: "env-test-prov", type: "vercel", credentials_key: "" });
    providerId = provider.id;
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("createEnvironment", () => {
    it("creates an environment with all fields", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "production",
        type: "prod",
        provider_id: providerId,
        region: "us-east-1",
        config: { foo: "bar" },
      });
      expect(env.id).toBeDefined();
      expect(env.project_id).toBe(projectId);
      expect(env.name).toBe("production");
      expect(env.type).toBe("prod");
      expect(env.provider_id).toBe(providerId);
      expect(env.region).toBe("us-east-1");
      expect(env.config).toEqual({ foo: "bar" });
      expect(env.created_at).toBeDefined();
      expect(env.updated_at).toBeDefined();
    });

    it("creates an environment with defaults", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "dev",
        type: "dev",
        provider_id: providerId,
      });
      expect(env.region).toBe("");
      expect(env.config).toEqual({});
    });
  });

  describe("getEnvironment", () => {
    it("gets an environment by full ID", () => {
      const created = createEnvironment({
        project_id: projectId,
        name: "staging",
        type: "staging",
        provider_id: providerId,
      });
      const fetched = getEnvironment(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("staging");
    });

    it("throws EnvironmentNotFoundError for missing ID", () => {
      expect(() => getEnvironment("nonexistent")).toThrow(EnvironmentNotFoundError);
    });
  });

  describe("listEnvironments", () => {
    it("lists environments by project_id", () => {
      createEnvironment({
        project_id: projectId,
        name: "dev",
        type: "dev",
        provider_id: providerId,
      });
      createEnvironment({
        project_id: projectId,
        name: "staging",
        type: "staging",
        provider_id: providerId,
      });
      const envs = listEnvironments({ project_id: projectId });
      expect(envs.length).toBe(2);
    });

    it("filters by type", () => {
      createEnvironment({
        project_id: projectId,
        name: "dev-env",
        type: "dev",
        provider_id: providerId,
      });
      createEnvironment({
        project_id: projectId,
        name: "prod-env",
        type: "prod",
        provider_id: providerId,
      });
      const devEnvs = listEnvironments({ type: "dev" });
      expect(devEnvs.length).toBe(1);
      expect(devEnvs[0]!.type).toBe("dev");
    });

    it("returns all environments when no filter", () => {
      createEnvironment({
        project_id: projectId,
        name: "e1",
        type: "dev",
        provider_id: providerId,
      });
      const envs = listEnvironments();
      expect(envs.length).toBe(1);
    });
  });

  describe("updateEnvironment", () => {
    it("updates environment name", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "old-env",
        type: "dev",
        provider_id: providerId,
      });
      const updated = updateEnvironment(env.id, { name: "new-env" });
      expect(updated.name).toBe("new-env");
    });

    it("updates environment type", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "type-test",
        type: "dev",
        provider_id: providerId,
      });
      const updated = updateEnvironment(env.id, { type: "staging" });
      expect(updated.type).toBe("staging");
    });

    it("updates environment region and config", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "region-test",
        type: "dev",
        provider_id: providerId,
      });
      const updated = updateEnvironment(env.id, {
        region: "eu-west-1",
        config: { setting: true },
      });
      expect(updated.region).toBe("eu-west-1");
      expect(updated.config).toEqual({ setting: true });
    });

    it("throws EnvironmentNotFoundError for nonexistent env", () => {
      expect(() => updateEnvironment("nonexistent", { name: "x" })).toThrow(
        EnvironmentNotFoundError
      );
    });
  });

  describe("deleteEnvironment", () => {
    it("deletes an environment", () => {
      const env = createEnvironment({
        project_id: projectId,
        name: "del-env",
        type: "dev",
        provider_id: providerId,
      });
      deleteEnvironment(env.id);
      expect(() => getEnvironment(env.id)).toThrow(EnvironmentNotFoundError);
    });

    it("throws EnvironmentNotFoundError for nonexistent env", () => {
      expect(() => deleteEnvironment("nonexistent")).toThrow(EnvironmentNotFoundError);
    });
  });
});
