import { spawnSync } from "child_process";
import type { Provider } from "../types/index.js";

export function getProviderConnectionCredentials(
  provider: Pick<Provider, "credentials_key" | "config">
): Record<string, string> {
  const credentials: Record<string, string> = {};
  Object.assign(credentials, normalizeCredentialObject(provider.config));

  if (provider.credentials_key.trim()) {
    Object.assign(credentials, readSecretCredentials(provider.credentials_key.trim()));
  }

  return credentials;
}

export function normalizeCredentialValue(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeCredentialObject(parsed as Record<string, unknown>);
    }
  } catch {
    // Plain token secrets remain useful for token-based providers.
  }
  return { token: value };
}

function readSecretCredentials(key: string): Record<string, string> {
  const result = spawnSync("secrets", ["get", key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) return {};
  return normalizeCredentialValue(result.stdout.trim());
}

function normalizeCredentialObject(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input) return {};
  const credentials: Record<string, string> = {};

  copyString(input, credentials, "access_key_id", "access_key_id");
  copyString(input, credentials, "secret_access_key", "secret_access_key");
  copyString(input, credentials, "session_token", "session_token");
  copyString(input, credentials, "region", "region");
  copyString(input, credentials, "profile", "aws_profile");
  copyString(input, credentials, "aws_profile", "aws_profile");

  copyString(input, credentials, "AWS_ACCESS_KEY_ID", "access_key_id");
  copyString(input, credentials, "AWS_SECRET_ACCESS_KEY", "secret_access_key");
  copyString(input, credentials, "AWS_SESSION_TOKEN", "session_token");
  copyString(input, credentials, "AWS_REGION", "region");
  copyString(input, credentials, "AWS_DEFAULT_REGION", "region");

  if (typeof input["token"] === "string" && input["token"].trim()) {
    credentials["token"] = input["token"].trim();
  }

  return credentials;
}

function copyString(
  input: Record<string, unknown>,
  output: Record<string, string>,
  from: string,
  to: string
) {
  const value = input[from];
  if (typeof value === "string" && value.trim()) output[to] = value.trim();
}
