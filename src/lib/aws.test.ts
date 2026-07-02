import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { AwsProvider, prepareAwsFetchHeaders } from "./aws.js";

describe("AwsProvider", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
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

  it("prepares signed AWS headers for fetch without explicit host", () => {
    const headers = prepareAwsFetchHeaders({
      host: "sts.us-east-1.amazonaws.com",
      Host: "should-also-be-stripped.example",
      Authorization: "AWS4-HMAC-SHA256 SignedHeaders=content-type;host;x-amz-date",
      "content-type": "application/x-amz-json-1.1",
      "x-amz-date": "20260702T120000Z",
      "x-amz-target": "AWSSecurityTokenServiceV20110615.GetCallerIdentity",
      "x-amz-security-token": "session-token",
    });

    expect(headers["host"]).toBeUndefined();
    expect(headers["Host"]).toBeUndefined();
    expect(headers["Authorization"]).toContain("SignedHeaders=content-type;host;x-amz-date");
    expect(headers["content-type"]).toBe("application/x-amz-json-1.1");
    expect(headers["x-amz-date"]).toBe("20260702T120000Z");
    expect(headers["x-amz-target"]).toBe(
      "AWSSecurityTokenServiceV20110615.GetCallerIdentity"
    );
    expect(headers["x-amz-security-token"]).toBe("session-token");
  });

  it("does not pass an explicit host header to fetch during connect", async () => {
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = async (_url, init) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    };

    const provider = new AwsProvider();
    await provider.connect({
      access_key_id: "AKID",
      secret_access_key: "SECRET",
      session_token: "TOKEN",
      region: "us-east-1",
    });

    expect(capturedHeaders).toBeDefined();
    const headers = capturedHeaders as Record<string, string>;
    const lowerHeaderNames = Object.keys(headers).map((name) => name.toLowerCase());
    const headerValue = (name: string) =>
      Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name)?.[1];
    const signedHeaders = headers["Authorization"]?.match(/SignedHeaders=([^,]+)/)?.[1];
    expect(lowerHeaderNames).not.toContain("host");
    expect(signedHeaders?.split(";")).toContain("host");
    expect(signedHeaders?.split(";")).toContain("x-amz-security-token");
    expect(headerValue("content-type")).toBe("application/x-amz-json-1.1");
    expect(headerValue("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headerValue("x-amz-target")).toBe(
      "AWSSecurityTokenServiceV20110615.GetCallerIdentity"
    );
    expect(headerValue("x-amz-security-token")).toBe("TOKEN");
  });
});
