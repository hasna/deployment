import { describe, it, expect } from "bun:test";
import { isConversationsAvailable, announceDeployment, announceRollback, announceFailure } from "./conversations-integration.js";
import type { HookContext } from "./hooks.js";

const mockContext: HookContext = {
  project_id: "proj-123",
  project_name: "test-project",
  environment_id: "env-456",
  environment_name: "production",
  environment_type: "prod",
  provider_type: "vercel",
  deployment_id: "dep-789",
  version: "1.0.0",
  url: "https://test.example.com",
  commit_sha: "abc12345",
  status: "live",
};

describe("conversations-integration", () => {
  describe("isConversationsAvailable", () => {
    it("returns false when @hasna/conversations is not installed", () => {
      expect(isConversationsAvailable()).toBe(false);
    });

    it("returns a boolean", () => {
      expect(typeof isConversationsAvailable()).toBe("boolean");
    });
  });

  describe("announceDeployment", () => {
    it("does not throw when @hasna/conversations is not available", async () => {
      await expect(announceDeployment(mockContext)).resolves.toBeUndefined();
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
      await expect(announceDeployment(minimalContext)).resolves.toBeUndefined();
    });
  });

  describe("announceRollback", () => {
    it("does not throw when @hasna/conversations is not available", async () => {
      await expect(announceRollback(mockContext)).resolves.toBeUndefined();
    });

    it("handles context without version", async () => {
      const ctx: HookContext = {
        project_id: "proj-1",
        project_name: "test",
        environment_id: "env-1",
        environment_name: "staging",
        environment_type: "staging",
        provider_type: "flyio",
      };
      await expect(announceRollback(ctx)).resolves.toBeUndefined();
    });
  });

  describe("announceFailure", () => {
    it("does not throw when @hasna/conversations is not available", async () => {
      await expect(announceFailure(mockContext)).resolves.toBeUndefined();
    });

    it("handles context with error field", async () => {
      const ctx: HookContext = {
        ...mockContext,
        status: "failed",
        error: "Build timeout exceeded",
      };
      await expect(announceFailure(ctx)).resolves.toBeUndefined();
    });
  });
});
