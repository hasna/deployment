import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import {
  registerProvider,
  getProvider,
  listRegisteredProviders,
  hasProvider,
  clearProviders,
} from "./provider.js";
import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

class MockProvider implements DeploymentProviderInterface {
  type = "vercel" as const;

  async connect(_credentials: Record<string, string>): Promise<void> {}
  async createProject(_name: string): Promise<string> {
    return "mock-id";
  }
  async deleteProject(_projectId: string): Promise<void> {}
  async deploy(_opts: DeployOptions): Promise<DeployResult> {
    return { deploymentId: "d1", url: "https://mock.dev", status: "live" };
  }
  async getDeploymentStatus(_deploymentId: string): Promise<DeploymentStatus> {
    return "live";
  }
  async getDeploymentLogs(_deploymentId: string): Promise<string> {
    return "mock logs";
  }
  async rollback(_deploymentId: string): Promise<DeployResult> {
    return { deploymentId: "d2", url: "https://mock.dev", status: "deploying" };
  }
  async provisionResource(
    _type: ResourceType,
    _name: string
  ): Promise<ProvisionResult> {
    return { resourceId: "r1", type: "database", name: "db", config: {} };
  }
  async destroyResource(_resourceId: string): Promise<void> {}
  async listResources(): Promise<ProvisionResult[]> {
    return [];
  }
  async setEnvVars(
    _projectId: string,
    _vars: Record<string, string>
  ): Promise<void> {}
  async getEnvVars(_projectId: string): Promise<Record<string, string>> {
    return {};
  }
  async getDomains(_projectId: string): Promise<string[]> {
    return [];
  }
  async addDomain(_projectId: string, _domain: string): Promise<void> {}
  async removeDomain(_projectId: string, _domain: string): Promise<void> {}
}

describe("provider registry", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    clearProviders();
  });

  afterEach(() => {
    clearProviders();
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("registerProvider", () => {
    it("registers a provider", () => {
      const mock = new MockProvider();
      registerProvider(mock);
      expect(hasProvider("vercel")).toBe(true);
    });
  });

  describe("getProvider", () => {
    it("returns the registered provider", () => {
      const mock = new MockProvider();
      registerProvider(mock);
      const p = getProvider("vercel");
      expect(p.type).toBe("vercel");
    });

    it("throws for unregistered provider type", () => {
      expect(() => getProvider("cloudflare")).toThrow("Provider not registered: cloudflare");
    });
  });

  describe("listRegisteredProviders", () => {
    it("returns list of registered provider types", () => {
      registerProvider(new MockProvider());
      const types = listRegisteredProviders();
      expect(types).toContain("vercel");
    });

    it("returns empty list when none registered", () => {
      const types = listRegisteredProviders();
      expect(types.length).toBe(0);
    });
  });

  describe("hasProvider", () => {
    it("returns true for registered provider", () => {
      registerProvider(new MockProvider());
      expect(hasProvider("vercel")).toBe(true);
    });

    it("returns false for unregistered provider", () => {
      expect(hasProvider("aws")).toBe(false);
    });
  });

  describe("clearProviders", () => {
    it("removes all registered providers", () => {
      registerProvider(new MockProvider());
      expect(hasProvider("vercel")).toBe(true);
      clearProviders();
      expect(hasProvider("vercel")).toBe(false);
      expect(listRegisteredProviders().length).toBe(0);
    });
  });
});
