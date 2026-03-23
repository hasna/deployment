import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import {
  setDeploymentSecret,
  listDeploymentSecrets,
  getDeploymentSecret,
  deleteDeploymentSecret,
  diffSecrets,
  checkSecretParity,
  syncSecrets,
  rotateSecret,
  setConfigParam,
  listConfigParams,
  getDeploymentSecrets,
  initSecrets,
  isSecretsAvailable,
} from "./secrets-integration.js";

describe("secrets-integration (local DB)", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("initSecrets always returns true (local DB)", async () => {
    expect(await initSecrets()).toBe(true);
  });

  it("isSecretsAvailable returns true", () => {
    expect(isSecretsAvailable()).toBe(true);
  });

  it("set and get a secret", () => {
    const record = setDeploymentSecret("my-project", "dev", "JWT_SECRET", "super-secret");
    expect(record.key).toBe("JWT_SECRET");
    expect(record.value).toBe("super-secret");
    expect(record.project_name).toBe("my-project");
    expect(record.environment).toBe("dev");
    expect(record.source).toBe("local");

    const retrieved = getDeploymentSecret("my-project", "dev", "JWT_SECRET");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.value).toBe("super-secret");
  });

  it("upserts on duplicate (project, env, key)", () => {
    setDeploymentSecret("proj", "dev", "KEY", "value1");
    const updated = setDeploymentSecret("proj", "dev", "KEY", "value2");
    expect(updated.value).toBe("value2");

    const all = listDeploymentSecrets("proj", "dev", true);
    expect(all).toHaveLength(1);
    expect(all[0]!.value).toBe("value2");
  });

  it("lists secrets with masked values by default", () => {
    setDeploymentSecret("proj", "staging", "DB_URL", "postgres://user:pass@host:5432/db");
    setDeploymentSecret("proj", "staging", "API_KEY", "sk-1234567890abcdef");

    const secrets = listDeploymentSecrets("proj", "staging");
    expect(secrets).toHaveLength(2);
    expect(secrets[0]!.value).toContain("****");
  });

  it("lists secrets with full values when requested", () => {
    setDeploymentSecret("proj", "dev", "SECRET", "full-value-here");
    const secrets = listDeploymentSecrets("proj", "dev", true);
    expect(secrets[0]!.value).toBe("full-value-here");
  });

  it("lists all environments for a project when env is omitted", () => {
    setDeploymentSecret("proj", "dev", "KEY1", "v1");
    setDeploymentSecret("proj", "staging", "KEY2", "v2");
    setDeploymentSecret("proj", "production", "KEY3", "v3");

    const all = listDeploymentSecrets("proj");
    expect(all).toHaveLength(3);
    const envs = new Set(all.map((s) => s.environment));
    expect(envs.has("dev")).toBe(true);
    expect(envs.has("staging")).toBe(true);
    expect(envs.has("production")).toBe(true);
  });

  it("deletes a secret", () => {
    setDeploymentSecret("proj", "dev", "TO_DELETE", "value");
    expect(getDeploymentSecret("proj", "dev", "TO_DELETE")).not.toBeNull();

    const deleted = deleteDeploymentSecret("proj", "dev", "TO_DELETE");
    expect(deleted).toBe(true);
    expect(getDeploymentSecret("proj", "dev", "TO_DELETE")).toBeNull();
  });

  it("delete returns false for nonexistent secret", () => {
    expect(deleteDeploymentSecret("proj", "dev", "NONEXISTENT")).toBe(false);
  });

  it("stores aws_arn and source correctly", () => {
    setDeploymentSecret(
      "proj",
      "prod",
      "JWT_SECRET",
      "(aws-managed)",
      "aws-secretsmanager",
      "arn:aws:secretsmanager:us-east-1:123:secret:proj/auth/jwt_secret-abc123"
    );

    const record = getDeploymentSecret("proj", "prod", "JWT_SECRET");
    expect(record!.source).toBe("aws-secretsmanager");
    expect(record!.aws_arn).toBe(
      "arn:aws:secretsmanager:us-east-1:123:secret:proj/auth/jwt_secret-abc123"
    );
  });

  it("masks short values correctly", () => {
    setDeploymentSecret("proj", "dev", "SHORT", "abc");
    const secrets = listDeploymentSecrets("proj", "dev");
    expect(secrets[0]!.value).toBe("****");
  });

  it("masks aws-managed values as-is", () => {
    setDeploymentSecret("proj", "dev", "AWS_KEY", "(aws-managed)", "aws-secretsmanager");
    const secrets = listDeploymentSecrets("proj", "dev");
    expect(secrets[0]!.value).toBe("(aws-managed)");
  });

  it("getDeploymentSecrets returns credentials and envVars", () => {
    setDeploymentSecret("proj", "dev", "LOCAL_VAR", "local-value", "local");
    setDeploymentSecret("proj", "dev", "AWS_VAR", "aws-value", "aws-secretsmanager", "arn:...");

    const { credentials, envVars } = getDeploymentSecrets("proj", "dev");
    expect(Object.keys(envVars)).toContain("LOCAL_VAR");
    expect(Object.keys(credentials)).toContain("AWS_VAR");
  });
});

describe("diffSecrets", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("shows secrets present in both envs", () => {
    setDeploymentSecret("proj", "dev", "JWT_SECRET", "v1");
    setDeploymentSecret("proj", "staging", "JWT_SECRET", "v2");

    const diff = diffSecrets("proj", "dev", "staging");
    const jwt = diff.find((d) => d.key === "JWT_SECRET");
    expect(jwt!.in_env1).toBe(true);
    expect(jwt!.in_env2).toBe(true);
  });

  it("shows secrets missing in one env", () => {
    setDeploymentSecret("proj", "dev", "DB_URL", "v1");
    setDeploymentSecret("proj", "dev", "API_KEY", "v2");
    setDeploymentSecret("proj", "staging", "DB_URL", "v3");

    const diff = diffSecrets("proj", "dev", "staging");
    const apiKey = diff.find((d) => d.key === "API_KEY");
    expect(apiKey!.in_env1).toBe(true);
    expect(apiKey!.in_env2).toBe(false);
  });

  it("returns empty for project with no secrets", () => {
    expect(diffSecrets("empty", "dev", "staging")).toEqual([]);
  });
});

describe("checkSecretParity", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("passes when all required keys present and non-empty", () => {
    setDeploymentSecret("proj", "prod", "JWT_SECRET", "value1");
    setDeploymentSecret("proj", "prod", "DB_URL", "value2");

    const result = checkSecretParity("proj", "prod", ["JWT_SECRET", "DB_URL"]);
    expect(result.passed).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.empty).toEqual([]);
    expect(result.present).toBe(2);
  });

  it("fails when required keys are missing", () => {
    setDeploymentSecret("proj", "prod", "JWT_SECRET", "value1");

    const result = checkSecretParity("proj", "prod", ["JWT_SECRET", "DB_URL", "API_KEY"]);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(["DB_URL", "API_KEY"]);
    expect(result.present).toBe(1);
    expect(result.total).toBe(3);
  });

  it("fails when required keys are empty", () => {
    setDeploymentSecret("proj", "prod", "JWT_SECRET", "value1");
    setDeploymentSecret("proj", "prod", "DB_URL", "");

    const result = checkSecretParity("proj", "prod", ["JWT_SECRET", "DB_URL"]);
    expect(result.passed).toBe(false);
    expect(result.empty).toEqual(["DB_URL"]);
    expect(result.missing).toEqual([]);
  });

  it("checks all registered secrets when no required keys given", () => {
    setDeploymentSecret("proj", "prod", "GOOD", "value");
    setDeploymentSecret("proj", "prod", "BAD", "");

    const result = checkSecretParity("proj", "prod");
    expect(result.passed).toBe(false);
    expect(result.empty).toEqual(["BAD"]);
    expect(result.total).toBe(2);
  });

  it("passes with no secrets and no required keys", () => {
    const result = checkSecretParity("empty", "prod");
    expect(result.passed).toBe(true);
    expect(result.total).toBe(0);
  });
});

describe("syncSecrets", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("syncs all secrets from source to target", () => {
    setDeploymentSecret("proj", "dev", "KEY1", "v1");
    setDeploymentSecret("proj", "dev", "KEY2", "v2");

    const result = syncSecrets("proj", "dev", "staging");
    expect(result.synced).toEqual(["KEY1", "KEY2"]);
    expect(result.skipped).toEqual([]);
    expect(result.total).toBe(2);

    // Verify target has the secrets
    const target = listDeploymentSecrets("proj", "staging", true);
    expect(target).toHaveLength(2);
    expect(target[0]!.value).toBe("v1");
  });

  it("respects include filter", () => {
    setDeploymentSecret("proj", "dev", "KEY1", "v1");
    setDeploymentSecret("proj", "dev", "KEY2", "v2");

    const result = syncSecrets("proj", "dev", "staging", { include: ["KEY1"] });
    expect(result.synced).toEqual(["KEY1"]);
    expect(result.skipped).toEqual(["KEY2"]);
  });

  it("respects exclude filter", () => {
    setDeploymentSecret("proj", "dev", "KEY1", "v1");
    setDeploymentSecret("proj", "dev", "KEY2", "v2");

    const result = syncSecrets("proj", "dev", "staging", { exclude: ["KEY2"] });
    expect(result.synced).toEqual(["KEY1"]);
    expect(result.skipped).toEqual(["KEY2"]);
  });

  it("dry run does not write to target", () => {
    setDeploymentSecret("proj", "dev", "KEY1", "v1");

    const result = syncSecrets("proj", "dev", "staging", { dryRun: true });
    expect(result.synced).toEqual(["KEY1"]);

    const target = listDeploymentSecrets("proj", "staging");
    expect(target).toHaveLength(0);
  });
});

describe("config params (SSM)", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("sets and lists config params", () => {
    setConfigParam("proj", "dev", "NEXT_PUBLIC_APP_URL", "https://dev.alumia.com");
    setConfigParam("proj", "dev", "REDIS_URL", "redis://localhost:6379");

    const params = listConfigParams("proj", "dev");
    expect(params).toHaveLength(2);
    // Config values shown unmasked
    expect(params[0]!.value).toBe("https://dev.alumia.com");
  });

  it("only returns aws-ssm source params", () => {
    setConfigParam("proj", "dev", "APP_URL", "https://dev.alumia.com");
    setDeploymentSecret("proj", "dev", "JWT_SECRET", "secret-value", "local");

    const params = listConfigParams("proj", "dev");
    expect(params).toHaveLength(1);
    expect(params[0]!.key).toBe("APP_URL");
  });

  it("lists across all envs when env omitted", () => {
    setConfigParam("proj", "dev", "URL", "https://dev.alumia.com");
    setConfigParam("proj", "prod", "URL", "https://alumia.com");

    const params = listConfigParams("proj");
    expect(params).toHaveLength(2);
  });
});

describe("rotateSecret", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("rotates a local secret with new random value", () => {
    setDeploymentSecret("proj", "prod", "JWT_SECRET", "old-value", "local");

    const result = rotateSecret("proj", "prod", "JWT_SECRET");
    expect(result.rotated).toBe(true);
    expect(result.key).toBe("JWT_SECRET");
    expect(result.previousLength).toBe(9); // "old-value"
    expect(result.newLength).toBe(64); // default length

    // Verify value changed
    const updated = getDeploymentSecret("proj", "prod", "JWT_SECRET");
    expect(updated!.value).not.toBe("old-value");
    expect(updated!.value.length).toBe(64);
    expect(updated!.last_rotated).not.toBe("");
  });

  it("rotates with custom length", () => {
    setDeploymentSecret("proj", "prod", "HMAC", "old", "local");

    const result = rotateSecret("proj", "prod", "HMAC", 32);
    expect(result.newLength).toBe(32);
  });

  it("refuses to rotate non-local secrets", () => {
    setDeploymentSecret("proj", "prod", "API_KEY", "value", "aws-secretsmanager", "arn:...");

    expect(() => rotateSecret("proj", "prod", "API_KEY")).toThrow(
      "Cannot rotate API_KEY"
    );
  });

  it("throws for nonexistent secret", () => {
    expect(() => rotateSecret("proj", "prod", "NOPE")).toThrow("Secret not found");
  });
});
