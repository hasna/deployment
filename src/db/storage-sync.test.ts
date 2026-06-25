import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getStorageDatabaseEnv,
  getStorageDatabaseEnvName,
  getStorageDatabaseUrl,
  getStorageMode,
  parseStorageTables,
} from "./storage-sync";

const ENV_NAMES = [
  ...STORAGE_DATABASE_ENV,
  ...STORAGE_MODE_ENV,
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

describe("deployment storage sync configuration", () => {
  beforeEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = ORIGINAL_ENV.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("prefers canonical storage database env over fallback", () => {
    process.env["HASNA_DEPLOYMENT_DATABASE_URL"] = "postgres://canonical";
    process.env["DEPLOYMENT_DATABASE_URL"] = "postgres://fallback";

    expect(getStorageDatabaseUrl()).toBe("postgres://canonical");
    expect(getStorageDatabaseEnvName()).toBe("HASNA_DEPLOYMENT_DATABASE_URL");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "HASNA_DEPLOYMENT_DATABASE_URL",
    });
  });

  it("uses fallback storage database env when canonical env is absent", () => {
    process.env["DEPLOYMENT_DATABASE_URL"] = "postgres://fallback";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback");
    expect(getStorageDatabaseEnvName()).toBe("DEPLOYMENT_DATABASE_URL");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "DEPLOYMENT_DATABASE_URL",
    });
  });

  it("resolves storage mode from storage envs", () => {
    expect(getStorageMode()).toBe("local");

    process.env["DEPLOYMENT_DATABASE_URL"] = "postgres://remote";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_DEPLOYMENT_STORAGE_MODE"] = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  it("parses and validates storage table filters", () => {
    expect(parseStorageTables()).toContain("deployments");
    expect(parseStorageTables([" projects ", "deployments"])).toEqual(["projects", "deployments"]);
    expect(() => parseStorageTables(["missing"])).toThrow("Unknown deployment sync table");
  });
});
