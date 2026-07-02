import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { AwsProvider } from "./aws.js";

describe("AwsProvider", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const savedFetch = globalThis.fetch;

  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    // Clear AWS env to prevent credential chain from resolving
    for (const key of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Point to nonexistent file to prevent shared credentials
    savedEnv["AWS_SHARED_CREDENTIALS_FILE"] = process.env["AWS_SHARED_CREDENTIALS_FILE"];
    process.env["AWS_SHARED_CREDENTIALS_FILE"] = "/nonexistent";
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("can be instantiated", () => {
    const provider = new AwsProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new AwsProvider();
    expect(provider.type).toBe("aws");
  });

  it("connect throws without any credentials", async () => {
    const provider = new AwsProvider();
    await expect(provider.connect({})).rejects.toThrow("no credentials found");
  });

  it("connect throws with only access_key_id", async () => {
    const provider = new AwsProvider();
    await expect(
      provider.connect({ access_key_id: "AKID" })
    ).rejects.toThrow("no credentials found");
  });

  it("connect throws with only secret_access_key", async () => {
    const provider = new AwsProvider();
    await expect(
      provider.connect({ secret_access_key: "secret" })
    ).rejects.toThrow("no credentials found");
  });

  it("validates credentials with STS query protocol", async () => {
    let capturedBody = "";
    let capturedContentType = "";
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      const headers = init?.headers as Record<string, string>;
      capturedContentType = headers["content-type"] ?? "";
      return new Response(
        [
          "<GetCallerIdentityResponse>",
          "<GetCallerIdentityResult>",
          "<Account>123456789012</Account>",
          "<Arn>arn:aws:sts::123456789012:assumed-role/test/session</Arn>",
          "<UserId>USERID</UserId>",
          "</GetCallerIdentityResult>",
          "</GetCallerIdentityResponse>",
        ].join(""),
        { status: 200 }
      );
    };

    const provider = new AwsProvider();
    await provider.connect({
      access_key_id: "AKID",
      secret_access_key: "SECRET",
      session_token: "TOKEN",
      region: "us-east-1",
    });
    const identity = await provider.getCallerIdentity();

    expect(capturedBody).toContain("Action=GetCallerIdentity");
    expect(capturedContentType).toBe("application/x-www-form-urlencoded");
    expect(identity.account).toBe("123456789012");
  });

  it("exposes Secrets Manager operations", () => {
    const provider = new AwsProvider();
    expect(typeof provider.listSecrets).toBe("function");
    expect(typeof provider.getSecret).toBe("function");
    expect(typeof provider.putSecret).toBe("function");
  });

  it("exposes ECS operations", () => {
    const provider = new AwsProvider();
    expect(typeof provider.describeEcsServices).toBe("function");
  });

  it("exposes caller identity", () => {
    const provider = new AwsProvider();
    expect(typeof provider.getCallerIdentity).toBe("function");
  });
});
