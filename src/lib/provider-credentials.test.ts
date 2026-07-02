import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getProviderConnectionCredentials,
  normalizeCredentialValue,
} from "./provider-credentials.js";

describe("provider credentials", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let tempDir = "";

  beforeEach(() => {
    savedEnv["PATH"] = process.env["PATH"];
    tempDir = mkdtempSync(join(tmpdir(), "deployment-provider-creds-"));
  });

  afterEach(() => {
    if (savedEnv["PATH"] === undefined) delete process.env["PATH"];
    else process.env["PATH"] = savedEnv["PATH"];
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("normalizes AWS metadata-style provider secrets", () => {
    const credentials = normalizeCredentialValue(
      JSON.stringify({
        credential_strategy: "aws-profile-or-role",
        aws_profile: "hasna-xyz-infra",
        region: "us-east-1",
        contains_static_credentials: false,
      })
    );

    expect(credentials).toEqual({
      aws_profile: "hasna-xyz-infra",
      region: "us-east-1",
    });
  });

  it("reads provider credentials from the secrets CLI without printing values", () => {
    const vaultBin = join(tempDir, "secrets");
    writeFileSync(
      vaultBin,
      [
        "#!/usr/bin/env sh",
        "if [ \"$1\" = \"get\" ]; then",
        "  printf '%s' '{\"aws_profile\":\"hasna-xyz-infra\",\"region\":\"us-east-1\"}'",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n")
    );
    chmodSync(vaultBin, 0o755);
    process.env["PATH"] = `${tempDir}:${savedEnv["PATH"] ?? ""}`;

    const credentials = getProviderConnectionCredentials({
      credentials_key: "hasna/xyz/opensource/deployment/prod/aws",
      config: {},
    });

    expect(credentials).toEqual({
      aws_profile: "hasna-xyz-infra",
      region: "us-east-1",
    });
  });
});
