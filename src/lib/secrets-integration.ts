import type { DeploymentProviderInterface } from "../types/index.js";
import { getDatabase, uuid, now } from "../db/database.js";
import { AwsProvider } from "./aws.js";
import { resolveCredentials } from "./aws-auth.js";

/**
 * Secret record stored in local DB.
 */
export interface SecretRecord {
  id: string;
  project_name: string;
  environment: string;
  key: string;
  value: string;
  source: "local" | "aws-secretsmanager" | "aws-ssm";
  aws_arn: string;
  last_rotated: string;
  created_at: string;
  updated_at: string;
}

export interface DeploymentSecrets {
  credentials: Record<string, string>;
  envVars: Record<string, string>;
}

// ── Local DB Operations ────────────────────────────────────────────────────

/**
 * Set a secret in local DB. Upserts by (project, env, key).
 */
export function setDeploymentSecret(
  projectName: string,
  envName: string,
  key: string,
  value: string,
  source: string = "local",
  awsArn: string = ""
): SecretRecord {
  const db = getDatabase();
  const timestamp = now();

  const existing = db
    .query(
      "SELECT id FROM secrets WHERE project_name = ? AND environment = ? AND key = ?"
    )
    .get(projectName, envName, key) as { id: string } | null;

  if (existing) {
    db.query(
      `UPDATE secrets SET value = ?, source = ?, aws_arn = ?, updated_at = ? WHERE id = ?`
    ).run(value, source, awsArn, timestamp, existing.id);

    return db
      .query("SELECT * FROM secrets WHERE id = ?")
      .get(existing.id) as SecretRecord;
  }

  const id = uuid();
  db.query(
    `INSERT INTO secrets (id, project_name, environment, key, value, source, aws_arn, last_rotated, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).run(id, projectName, envName, key, value, source, awsArn, timestamp, timestamp);

  return db.query("SELECT * FROM secrets WHERE id = ?").get(id) as SecretRecord;
}

/**
 * List secrets for a project, optionally filtered by environment.
 * Values are masked by default.
 */
export function listDeploymentSecrets(
  projectName: string,
  envName?: string,
  showValues: boolean = false
): { key: string; environment: string; source: string; aws_arn: string; last_rotated: string; value: string }[] {
  const db = getDatabase();

  let rows: SecretRecord[];
  if (envName) {
    rows = db
      .query(
        "SELECT * FROM secrets WHERE project_name = ? AND environment = ? ORDER BY key"
      )
      .all(projectName, envName) as SecretRecord[];
  } else {
    rows = db
      .query(
        "SELECT * FROM secrets WHERE project_name = ? ORDER BY environment, key"
      )
      .all(projectName) as SecretRecord[];
  }

  return rows.map((r) => ({
    key: r.key,
    environment: r.environment,
    source: r.source,
    aws_arn: r.aws_arn,
    last_rotated: r.last_rotated,
    value: showValues ? r.value : maskValue(r.value),
  }));
}

/**
 * Get a single secret's full record.
 */
export function getDeploymentSecret(
  projectName: string,
  envName: string,
  key: string
): SecretRecord | null {
  const db = getDatabase();
  return db
    .query(
      "SELECT * FROM secrets WHERE project_name = ? AND environment = ? AND key = ?"
    )
    .get(projectName, envName, key) as SecretRecord | null;
}

/**
 * Delete a secret from local DB.
 */
export function deleteDeploymentSecret(
  projectName: string,
  envName: string,
  key: string
): boolean {
  const db = getDatabase();
  const result = db
    .query(
      "DELETE FROM secrets WHERE project_name = ? AND environment = ? AND key = ?"
    )
    .run(projectName, envName, key);
  return result.changes > 0;
}

// ── AWS Secrets Manager Sync ───────────────────────────────────────────────

/**
 * Import secrets from AWS Secrets Manager into local DB.
 * Reads secret names (not values) by prefix.
 */
export async function importSecretsFromAws(
  prefix: string,
  projectName: string,
  envName: string
): Promise<number> {
  const provider = await getAwsProvider();
  const awsSecrets = await provider.listSecrets(prefix);

  let imported = 0;
  for (const secret of awsSecrets) {
    const keyName = secret.name.split("/").pop() ?? secret.name;
    setDeploymentSecret(
      projectName,
      envName,
      keyName,
      "(aws-managed)",
      "aws-secretsmanager",
      secret.arn
    );
    imported++;
  }

  return imported;
}

/**
 * Push a local secret value to AWS Secrets Manager.
 */
export async function pushSecretToAws(
  projectName: string,
  envName: string,
  key: string
): Promise<void> {
  const record = getDeploymentSecret(projectName, envName, key);
  if (!record) throw new Error(`Secret not found: ${projectName}/${envName}/${key}`);
  if (!record.aws_arn) throw new Error(`Secret ${key} has no AWS ARN — cannot push`);

  const provider = await getAwsProvider();
  await provider.putSecret(record.aws_arn, record.value);
}

/**
 * Pull a secret value from AWS Secrets Manager into local DB.
 */
export async function pullSecretFromAws(
  projectName: string,
  envName: string,
  key: string
): Promise<void> {
  const record = getDeploymentSecret(projectName, envName, key);
  if (!record) throw new Error(`Secret not found: ${projectName}/${envName}/${key}`);
  if (!record.aws_arn) throw new Error(`Secret ${key} has no AWS ARN — cannot pull`);

  const provider = await getAwsProvider();
  const awsSecret = await provider.getSecret(record.aws_arn);

  const db = getDatabase();
  db.query("UPDATE secrets SET value = ?, updated_at = ? WHERE id = ?").run(
    awsSecret.value,
    now(),
    record.id
  );
}

// ── Diff Across Environments ───────────────────────────────────────────────

/**
 * Compare secrets across two environments for a project.
 */
export function diffSecrets(
  projectName: string,
  env1: string,
  env2: string
): { key: string; in_env1: boolean; in_env2: boolean }[] {
  const secrets1 = listDeploymentSecrets(projectName, env1);
  const secrets2 = listDeploymentSecrets(projectName, env2);

  const keys1 = new Set(secrets1.map((s) => s.key));
  const keys2 = new Set(secrets2.map((s) => s.key));
  const allKeys = new Set([...keys1, ...keys2]);

  return [...allKeys]
    .sort()
    .map((key) => ({
      key,
      in_env1: keys1.has(key),
      in_env2: keys2.has(key),
    }));
}

// ── Pre-Deploy Parity Check ────────────────────────────────────────────────

export interface SecretParityResult {
  passed: boolean;
  total: number;
  present: number;
  missing: string[];
  empty: string[];
}

/**
 * Check that all required secrets for a project/env are present and non-empty.
 * If `requiredKeys` is provided, checks those. Otherwise checks all registered secrets
 * for the environment and ensures none are empty.
 */
export function checkSecretParity(
  projectName: string,
  envName: string,
  requiredKeys?: string[]
): SecretParityResult {
  const db = getDatabase();

  if (requiredKeys && requiredKeys.length > 0) {
    // Check specific required keys
    const existing = db
      .query(
        "SELECT key, value FROM secrets WHERE project_name = ? AND environment = ?"
      )
      .all(projectName, envName) as { key: string; value: string }[];

    const existingMap = new Map(existing.map((s) => [s.key, s.value]));
    const missing: string[] = [];
    const empty: string[] = [];

    for (const key of requiredKeys) {
      if (!existingMap.has(key)) {
        missing.push(key);
      } else if (!existingMap.get(key) || existingMap.get(key) === "") {
        empty.push(key);
      }
    }

    return {
      passed: missing.length === 0 && empty.length === 0,
      total: requiredKeys.length,
      present: requiredKeys.length - missing.length,
      missing,
      empty,
    };
  }

  // Check all registered secrets are non-empty
  const secrets = db
    .query(
      "SELECT key, value FROM secrets WHERE project_name = ? AND environment = ?"
    )
    .all(projectName, envName) as { key: string; value: string }[];

  const empty = secrets
    .filter((s) => !s.value || s.value === "")
    .map((s) => s.key);

  return {
    passed: empty.length === 0,
    total: secrets.length,
    present: secrets.length - empty.length,
    missing: [],
    empty,
  };
}

// ── Secret Sync Between Environments ───────────────────────────────────────

export interface SyncResult {
  synced: string[];
  skipped: string[];
  total: number;
}

/**
 * Sync secrets from one environment to another.
 * Only syncs keys that exist in source. Does not delete extras in target.
 * Optionally filter by include/exclude lists.
 */
export function syncSecrets(
  projectName: string,
  fromEnv: string,
  toEnv: string,
  options?: { include?: string[]; exclude?: string[]; dryRun?: boolean }
): SyncResult {
  const db = getDatabase();
  const sourceSecrets = db
    .query(
      "SELECT * FROM secrets WHERE project_name = ? AND environment = ? ORDER BY key"
    )
    .all(projectName, fromEnv) as SecretRecord[];

  const synced: string[] = [];
  const skipped: string[] = [];

  for (const secret of sourceSecrets) {
    if (options?.include && !options.include.includes(secret.key)) {
      skipped.push(secret.key);
      continue;
    }
    if (options?.exclude && options.exclude.includes(secret.key)) {
      skipped.push(secret.key);
      continue;
    }

    if (!options?.dryRun) {
      setDeploymentSecret(
        projectName,
        toEnv,
        secret.key,
        secret.value,
        secret.source,
        secret.aws_arn
      );
    }
    synced.push(secret.key);
  }

  return { synced, skipped, total: sourceSecrets.length };
}

// ── SSM Parameter Store (non-sensitive config) ─────────────────────────────

/**
 * Set a non-sensitive config parameter in local DB (source: aws-ssm).
 */
export function setConfigParam(
  projectName: string,
  envName: string,
  key: string,
  value: string,
  awsArn: string = ""
): SecretRecord {
  return setDeploymentSecret(projectName, envName, key, value, "aws-ssm", awsArn);
}

/**
 * List config parameters (aws-ssm source) for a project/env.
 * Unlike secrets, values are shown unmasked by default.
 */
export function listConfigParams(
  projectName: string,
  envName?: string
): { key: string; environment: string; value: string; aws_arn: string }[] {
  const db = getDatabase();

  let rows: SecretRecord[];
  if (envName) {
    rows = db
      .query(
        "SELECT * FROM secrets WHERE project_name = ? AND environment = ? AND source = 'aws-ssm' ORDER BY key"
      )
      .all(projectName, envName) as SecretRecord[];
  } else {
    rows = db
      .query(
        "SELECT * FROM secrets WHERE project_name = ? AND source = 'aws-ssm' ORDER BY environment, key"
      )
      .all(projectName) as SecretRecord[];
  }

  return rows.map((r) => ({
    key: r.key,
    environment: r.environment,
    value: r.value,
    aws_arn: r.aws_arn,
  }));
}

// ── Secret Rotation ────────────────────────────────────────────────────────

export interface RotationResult {
  key: string;
  environment: string;
  rotated: boolean;
  previousLength: number;
  newLength: number;
}

/**
 * Rotate an internal secret by generating a new random value.
 * Only rotates secrets with source=local (internal random secrets).
 * Does NOT rotate external API keys (aws-secretsmanager source).
 */
export function rotateSecret(
  projectName: string,
  envName: string,
  key: string,
  length: number = 64
): RotationResult {
  const record = getDeploymentSecret(projectName, envName, key);
  if (!record) throw new Error(`Secret not found: ${projectName}/${envName}/${key}`);

  if (record.source !== "local") {
    throw new Error(
      `Cannot rotate ${key} — source is '${record.source}'. Only local secrets can be rotated. External API keys must be rotated at the provider.`
    );
  }

  const previousLength = record.value.length;
  const newValue = generateRandomSecret(length);

  const db = getDatabase();
  const timestamp = now();
  db.query(
    "UPDATE secrets SET value = ?, last_rotated = ?, updated_at = ? WHERE id = ?"
  ).run(newValue, timestamp, timestamp, record.id);

  return {
    key,
    environment: envName,
    rotated: true,
    previousLength,
    newLength: newValue.length,
  };
}

function generateRandomSecret(length: number): string {
  const { randomBytes } = require("crypto");
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

// ── Legacy Compatibility ───────────────────────────────────────────────────

export function getDeploymentSecrets(
  projectName: string,
  envName: string
): DeploymentSecrets {
  const secrets = listDeploymentSecrets(projectName, envName, true);
  const credentials: Record<string, string> = {};
  const envVars: Record<string, string> = {};

  for (const s of secrets) {
    if (s.source === "local") {
      envVars[s.key] = s.value;
    } else {
      credentials[s.key] = s.value;
    }
  }

  return { credentials, envVars };
}

export async function injectSecretsToProvider(
  provider: DeploymentProviderInterface,
  projectName: string,
  envName: string
): Promise<void> {
  const { envVars } = getDeploymentSecrets(projectName, envName);
  if (Object.keys(envVars).length === 0) return;
  await provider.setEnvVars(projectName, envVars);
}

/**
 * Always returns true — secrets are now stored in local DB.
 */
export async function initSecrets(): Promise<boolean> {
  // Ensure DB is initialized (creates secrets table if needed)
  getDatabase();
  return true;
}

export function isSecretsAvailable(): boolean {
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function maskValue(value: string): string {
  if (!value || value === "(aws-managed)") return value;
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

async function getAwsProvider(): Promise<AwsProvider> {
  const provider = new AwsProvider();
  const creds = await resolveCredentials();
  const connection: Record<string, string> = {
    access_key_id: creds.accessKeyId,
    secret_access_key: creds.secretAccessKey,
    region: creds.region,
  };
  if (creds.sessionToken) connection["session_token"] = creds.sessionToken;
  await provider.connect(connection);
  return provider;
}
