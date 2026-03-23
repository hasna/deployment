import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveCredentials, signRequest, type AwsCredentials } from "./aws-auth.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("resolveCredentials", () => {
  const savedEnv: Record<string, string | undefined> = {};

  function saveAndClear(...keys: string[]) {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  function restoreEnv() {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeEach(() => {
    saveAndClear(
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
      "AWS_ROLE_SESSION_NAME",
      "AWS_SHARED_CREDENTIALS_FILE",
      "AWS_PROFILE",
      "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"
    );
  });

  afterEach(() => {
    restoreEnv();
  });

  it("resolves explicit credentials", async () => {
    const creds = await resolveCredentials({
      access_key_id: "AKID_EXPLICIT",
      secret_access_key: "SECRET_EXPLICIT",
      region: "eu-west-1",
    });
    expect(creds.accessKeyId).toBe("AKID_EXPLICIT");
    expect(creds.secretAccessKey).toBe("SECRET_EXPLICIT");
    expect(creds.region).toBe("eu-west-1");
    expect(creds.sessionToken).toBeUndefined();
  });

  it("resolves explicit credentials with session token", async () => {
    const creds = await resolveCredentials({
      access_key_id: "AKID",
      secret_access_key: "SECRET",
      session_token: "TOKEN",
    });
    expect(creds.sessionToken).toBe("TOKEN");
  });

  it("resolves from environment variables", async () => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKID_ENV";
    process.env["AWS_SECRET_ACCESS_KEY"] = "SECRET_ENV";
    process.env["AWS_SESSION_TOKEN"] = "TOKEN_ENV";
    process.env["AWS_REGION"] = "ap-southeast-1";

    const creds = await resolveCredentials();
    expect(creds.accessKeyId).toBe("AKID_ENV");
    expect(creds.secretAccessKey).toBe("SECRET_ENV");
    expect(creds.sessionToken).toBe("TOKEN_ENV");
    expect(creds.region).toBe("ap-southeast-1");
  });

  it("uses AWS_DEFAULT_REGION as fallback", async () => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKID";
    process.env["AWS_SECRET_ACCESS_KEY"] = "SECRET";
    process.env["AWS_DEFAULT_REGION"] = "us-west-2";

    const creds = await resolveCredentials();
    expect(creds.region).toBe("us-west-2");
  });

  it("defaults region to us-east-1", async () => {
    const creds = await resolveCredentials({
      access_key_id: "AKID",
      secret_access_key: "SECRET",
    });
    expect(creds.region).toBe("us-east-1");
  });

  it("resolves from shared credentials file", async () => {
    const tmpDir = join(tmpdir(), `aws-auth-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const credFile = join(tmpDir, "credentials");
    writeFileSync(
      credFile,
      [
        "[default]",
        "aws_access_key_id = AKID_FILE",
        "aws_secret_access_key = SECRET_FILE",
        "",
        "[staging]",
        "aws_access_key_id = AKID_STAGING",
        "aws_secret_access_key = SECRET_STAGING",
        "aws_session_token = TOKEN_STAGING",
      ].join("\n")
    );
    process.env["AWS_SHARED_CREDENTIALS_FILE"] = credFile;

    const defaultCreds = await resolveCredentials();
    expect(defaultCreds.accessKeyId).toBe("AKID_FILE");
    expect(defaultCreds.secretAccessKey).toBe("SECRET_FILE");

    process.env["AWS_PROFILE"] = "staging";
    const stagingCreds = await resolveCredentials();
    expect(stagingCreds.accessKeyId).toBe("AKID_STAGING");
    expect(stagingCreds.sessionToken).toBe("TOKEN_STAGING");

    rmSync(tmpDir, { recursive: true });
  });

  it("throws when no credentials found", async () => {
    // Point to nonexistent credentials file to skip file-based resolution
    process.env["AWS_SHARED_CREDENTIALS_FILE"] = "/nonexistent/path/credentials";

    await expect(resolveCredentials()).rejects.toThrow("no credentials found");
  });

  it("explicit credentials take priority over env vars", async () => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKID_ENV";
    process.env["AWS_SECRET_ACCESS_KEY"] = "SECRET_ENV";

    const creds = await resolveCredentials({
      access_key_id: "AKID_EXPLICIT",
      secret_access_key: "SECRET_EXPLICIT",
    });
    expect(creds.accessKeyId).toBe("AKID_EXPLICIT");
  });
});

describe("signRequest", () => {
  const testCreds: AwsCredentials = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
  };

  it("produces a valid Authorization header", () => {
    const signed = signRequest(
      "POST",
      "https://sts.us-east-1.amazonaws.com",
      "sts",
      "{}",
      testCreds,
      { "X-Amz-Target": "AWSSecurityTokenServiceV20110615.GetCallerIdentity" }
    );

    expect(signed.headers["Authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/);
    expect(signed.headers["Authorization"]).toContain("SignedHeaders=");
    expect(signed.headers["Authorization"]).toContain("Signature=");
    expect(signed.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("includes session token header when present", () => {
    const credsWithToken: AwsCredentials = {
      ...testCreds,
      sessionToken: "MY_SESSION_TOKEN",
    };

    const signed = signRequest(
      "POST",
      "https://ecs.us-east-1.amazonaws.com",
      "ecs",
      "{}",
      credsWithToken
    );

    expect(signed.headers["x-amz-security-token"]).toBe("MY_SESSION_TOKEN");
  });

  it("does not include session token when absent", () => {
    const signed = signRequest(
      "POST",
      "https://ecs.us-east-1.amazonaws.com",
      "ecs",
      "{}",
      testCreds
    );

    expect(signed.headers["x-amz-security-token"]).toBeUndefined();
  });

  it("uses correct region in credential scope", () => {
    const euCreds: AwsCredentials = { ...testCreds, region: "eu-west-1" };
    const signed = signRequest(
      "POST",
      "https://ecs.eu-west-1.amazonaws.com",
      "ecs",
      "{}",
      euCreds
    );

    expect(signed.headers["Authorization"]).toContain("eu-west-1/ecs/aws4_request");
  });

  it("signs body content correctly", () => {
    const body1 = signRequest("POST", "https://ecs.us-east-1.amazonaws.com", "ecs", '{"a":1}', testCreds);
    const body2 = signRequest("POST", "https://ecs.us-east-1.amazonaws.com", "ecs", '{"b":2}', testCreds);

    // Different bodies should produce different signatures
    const sig1 = body1.headers["Authorization"]?.match(/Signature=(\w+)/)?.[1];
    const sig2 = body2.headers["Authorization"]?.match(/Signature=(\w+)/)?.[1];
    expect(sig1).not.toBe(sig2);
  });
});
