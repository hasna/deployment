import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import {
  getDeploymentSecrets,
  isSecretsAvailable,
  setDeploymentSecret,
  listDeploymentSecrets,
} from "./secrets-integration.js";

describe("secrets-integration", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("isSecretsAvailable", () => {
    it("returns false when @hasna/secrets is not available", () => {
      expect(isSecretsAvailable()).toBe(false);
    });
  });

  describe("getDeploymentSecrets", () => {
    it("returns empty credentials and envVars when secrets not available", () => {
      const secrets = getDeploymentSecrets("my-project", "dev");
      expect(secrets).toEqual({ credentials: {}, envVars: {} });
    });
  });

  describe("setDeploymentSecret", () => {
    it("throws when secrets not available", () => {
      expect(() =>
        setDeploymentSecret("my-project", "dev", "API_KEY", "value123")
      ).toThrow("@hasna/secrets not available");
    });
  });

  describe("listDeploymentSecrets", () => {
    it("returns empty array when secrets not available", () => {
      const result = listDeploymentSecrets("my-project", "dev");
      expect(result).toEqual([]);
    });

    it("returns empty array without env name", () => {
      const result = listDeploymentSecrets("my-project");
      expect(result).toEqual([]);
    });
  });
});
