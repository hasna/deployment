import { describe, it, expect } from "bun:test";
import { isEconomyAvailable, trackDeploymentCost } from "./economy-integration.js";
import type { HookContext } from "./hooks.js";

const mockContext: HookContext = {
  project_id: "proj-123",
  project_name: "test-project",
  environment_id: "env-456",
  environment_name: "production",
  environment_type: "prod",
  provider_type: "aws",
  deployment_id: "dep-789",
  version: "2.0.0",
  url: "https://app.example.com",
  commit_sha: "def56789",
  status: "live",
};

describe("economy-integration", () => {
  describe("isEconomyAvailable", () => {
    it("returns false when @hasna/economy is not installed", () => {
      expect(isEconomyAvailable()).toBe(false);
    });

    it("returns a boolean", () => {
      expect(typeof isEconomyAvailable()).toBe("boolean");
    });
  });

  describe("trackDeploymentCost", () => {
    it("does not throw when @hasna/economy is not available", async () => {
      await expect(trackDeploymentCost(mockContext)).resolves.toBeUndefined();
    });

    it("does not throw with explicit cost parameter", async () => {
      await expect(trackDeploymentCost(mockContext, 0.05)).resolves.toBeUndefined();
    });

    it("does not throw with zero cost", async () => {
      await expect(trackDeploymentCost(mockContext, 0)).resolves.toBeUndefined();
    });

    it("handles context with minimal fields", async () => {
      const minimalContext: HookContext = {
        project_id: "proj-1",
        project_name: "minimal",
        environment_id: "env-1",
        environment_name: "dev",
        environment_type: "dev",
        provider_type: "railway",
      };
      await expect(trackDeploymentCost(minimalContext)).resolves.toBeUndefined();
    });

    it("handles context without deployment_id", async () => {
      const ctx: HookContext = {
        project_id: "proj-1",
        project_name: "test",
        environment_id: "env-1",
        environment_name: "staging",
        environment_type: "staging",
        provider_type: "digitalocean",
      };
      await expect(trackDeploymentCost(ctx, 1.50)).resolves.toBeUndefined();
    });
  });
});
