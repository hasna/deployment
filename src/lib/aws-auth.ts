/**
 * AWS Authentication — SigV4 signing + credential chain resolution.
 *
 * Credential resolution order:
 *   1. Explicit credentials passed to connect()
 *   2. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
 *   3. AWS SSO / OIDC web identity token (AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN)
 *   4. Shared credentials file (~/.aws/credentials) with AWS_PROFILE or "default"
 *   5. ECS container credentials (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
 *   6. EC2 instance metadata (IMDS v2)
 *
 * SigV4 signing is implemented from scratch — no AWS SDK dependency.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHmac, createHash } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  expiration?: Date;
}

export interface AwsSignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

// ── Credential Chain ───────────────────────────────────────────────────────

/**
 * Resolve AWS credentials using the standard chain.
 * Pass explicit creds to skip the chain.
 */
export async function resolveCredentials(
  explicit?: Record<string, string>
): Promise<AwsCredentials> {
  const region =
    explicit?.["region"] ??
    process.env["AWS_REGION"] ??
    process.env["AWS_DEFAULT_REGION"] ??
    "us-east-1";

  // 1. Explicit credentials
  if (explicit?.["access_key_id"] && explicit?.["secret_access_key"]) {
    return {
      accessKeyId: explicit["access_key_id"],
      secretAccessKey: explicit["secret_access_key"],
      sessionToken: explicit["session_token"],
      region,
    };
  }

  // 2. Environment variables
  if (process.env["AWS_ACCESS_KEY_ID"] && process.env["AWS_SECRET_ACCESS_KEY"]) {
    return {
      accessKeyId: process.env["AWS_ACCESS_KEY_ID"],
      secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"],
      sessionToken: process.env["AWS_SESSION_TOKEN"],
      region,
    };
  }

  // 3. Web Identity Token (OIDC — used in GH Actions, EKS, etc.)
  if (process.env["AWS_WEB_IDENTITY_TOKEN_FILE"] && process.env["AWS_ROLE_ARN"]) {
    return await assumeRoleWithWebIdentity(
      process.env["AWS_WEB_IDENTITY_TOKEN_FILE"],
      process.env["AWS_ROLE_ARN"],
      process.env["AWS_ROLE_SESSION_NAME"] ?? "open-deployment",
      region
    );
  }

  // 4. Shared credentials file
  const sharedCreds = loadSharedCredentials(
    process.env["AWS_PROFILE"] ?? "default"
  );
  if (sharedCreds) {
    return { ...sharedCreds, region };
  }

  // 5. ECS container credentials
  if (process.env["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"]) {
    return await fetchContainerCredentials(
      process.env["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"],
      region
    );
  }

  // 6. EC2 IMDS v2
  try {
    return await fetchImdsCredentials(region);
  } catch {
    // IMDS not available
  }

  throw new Error(
    "AWS: no credentials found. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, " +
      "configure AWS_WEB_IDENTITY_TOKEN_FILE for OIDC, or ensure ~/.aws/credentials exists."
  );
}

// ── OIDC Web Identity ──────────────────────────────────────────────────────

async function assumeRoleWithWebIdentity(
  tokenFile: string,
  roleArn: string,
  sessionName: string,
  region: string
): Promise<AwsCredentials> {
  const token = readFileSync(tokenFile, "utf-8").trim();

  const params = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    WebIdentityToken: token,
  });

  const res = await fetch(`https://sts.${region}.amazonaws.com/?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AWS OIDC: AssumeRoleWithWebIdentity failed (${res.status}): ${text}`);
  }

  const xml = await res.text();
  return parseSTSResponse(xml, region);
}

// ── Shared Credentials File ────────────────────────────────────────────────

function loadSharedCredentials(
  profile: string
): Omit<AwsCredentials, "region"> | null {
  const credPath =
    process.env["AWS_SHARED_CREDENTIALS_FILE"] ??
    join(process.env["HOME"] ?? "~", ".aws", "credentials");

  if (!existsSync(credPath)) return null;

  const content = readFileSync(credPath, "utf-8");
  const lines = content.split("\n");
  let inProfile = false;
  let accessKeyId = "";
  let secretAccessKey = "";
  let sessionToken: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inProfile = trimmed === `[${profile}]`;
      continue;
    }
    if (!inProfile) continue;

    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim();
    if (key?.trim() === "aws_access_key_id") accessKeyId = value;
    if (key?.trim() === "aws_secret_access_key") secretAccessKey = value;
    if (key?.trim() === "aws_session_token") sessionToken = value;
  }

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey, sessionToken };
  }
  return null;
}

// ── ECS Container Credentials ──────────────────────────────────────────────

async function fetchContainerCredentials(
  relativeUri: string,
  region: string
): Promise<AwsCredentials> {
  const res = await fetch(`http://169.254.170.2${relativeUri}`);
  if (!res.ok) throw new Error(`AWS ECS creds: ${res.status}`);

  const data = (await res.json()) as {
    AccessKeyId: string;
    SecretAccessKey: string;
    Token: string;
    Expiration: string;
  };

  return {
    accessKeyId: data.AccessKeyId,
    secretAccessKey: data.SecretAccessKey,
    sessionToken: data.Token,
    region,
    expiration: new Date(data.Expiration),
  };
}

// ── EC2 IMDS v2 ────────────────────────────────────────────────────────────

async function fetchImdsCredentials(region: string): Promise<AwsCredentials> {
  // Get token
  const tokenRes = await fetch("http://169.254.169.254/latest/api/token", {
    method: "PUT",
    headers: { "X-aws-ec2-metadata-token-ttl-seconds": "300" },
    signal: AbortSignal.timeout(2000),
  });
  if (!tokenRes.ok) throw new Error("IMDS token fetch failed");
  const imdsToken = await tokenRes.text();

  // Get role name
  const roleRes = await fetch(
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    { headers: { "X-aws-ec2-metadata-token": imdsToken }, signal: AbortSignal.timeout(2000) }
  );
  if (!roleRes.ok) throw new Error("IMDS role fetch failed");
  const roleName = (await roleRes.text()).trim();

  // Get credentials
  const credRes = await fetch(
    `http://169.254.169.254/latest/meta-data/iam/security-credentials/${roleName}`,
    { headers: { "X-aws-ec2-metadata-token": imdsToken }, signal: AbortSignal.timeout(2000) }
  );
  if (!credRes.ok) throw new Error("IMDS creds fetch failed");

  const data = (await credRes.json()) as {
    AccessKeyId: string;
    SecretAccessKey: string;
    Token: string;
    Expiration: string;
  };

  return {
    accessKeyId: data.AccessKeyId,
    secretAccessKey: data.SecretAccessKey,
    sessionToken: data.Token,
    region,
    expiration: new Date(data.Expiration),
  };
}

// ── SigV4 Signing ──────────────────────────────────────────────────────────

/**
 * Sign an AWS API request with SigV4.
 */
export function signRequest(
  method: string,
  url: string,
  service: string,
  body: string,
  credentials: AwsCredentials,
  extraHeaders?: Record<string, string>
): AwsSignedRequest {
  const parsedUrl = new URL(url);
  const now = new Date();
  const dateStamp = formatDate(now);
  const amzDate = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${credentials.region}/${service}/aws4_request`;

  const headers: Record<string, string> = {
    host: parsedUrl.host,
    "x-amz-date": amzDate,
    "content-type": "application/x-amz-json-1.1",
    ...extraHeaders,
  };

  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  // Canonical request
  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[Object.keys(headers).find((h) => h.toLowerCase() === k)!]!.trim()}`)
    .join("\n");

  const payloadHash = sha256(body);

  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.searchParams.toString(),
    canonicalHeaders + "\n",
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  // Signing key
  const signingKey = getSignatureKey(
    credentials.secretAccessKey,
    dateStamp,
    credentials.region,
    service
  );

  // Signature
  const signature = hmacHex(signingKey, stringToSign);

  // Authorization header
  headers[
    "Authorization"
  ] = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, method, headers, body };
}

// ── SigV4 Helpers ──────────────────────────────────────────────────────────

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function formatDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").slice(0, 8);
}

function formatAmzDate(d: Date): string {
  return d.toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
}

// ── STS XML Parser ─────────────────────────────────────────────────────────

function parseSTSResponse(xml: string, region: string): AwsCredentials {
  const extract = (tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
    return match?.[1] ?? "";
  };

  return {
    accessKeyId: extract("AccessKeyId"),
    secretAccessKey: extract("SecretAccessKey"),
    sessionToken: extract("SessionToken"),
    region,
    expiration: new Date(extract("Expiration")),
  };
}
