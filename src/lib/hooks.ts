import { getDatabase, uuid, now } from "../db/database.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type DeploymentHookEvent =
  | "pre-deploy"
  | "post-deploy"
  | "deploy-failed"
  | "pre-rollback"
  | "post-rollback"
  | "pre-promote"
  | "post-promote";

export interface DeploymentHook {
  id: string;
  event: DeploymentHookEvent;
  command: string;
  project_id: string | null;
  environment_id: string | null;
  enabled: boolean;
  created_at: string;
}

export interface HookContext {
  project_id: string;
  project_name: string;
  environment_id: string;
  environment_name: string;
  environment_type: string;
  provider_type: string;
  deployment_id?: string;
  version?: string;
  image?: string;
  commit_sha?: string;
  url?: string;
  status?: string;
  error?: string;
}

export interface HookResult {
  hook_id: string;
  event: string;
  command: string;
  success: boolean;
  output: string;
  error: string;
  duration_ms: number;
}

// ── DB Schema (migration) ───────────────────────────────────────────────────

export function ensureHooksTable(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS deployment_hooks (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    command TEXT NOT NULL,
    project_id TEXT,
    environment_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_hooks_event ON deployment_hooks(event)`);
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function addHook(
  event: DeploymentHookEvent,
  command: string,
  projectId?: string,
  environmentId?: string
): DeploymentHook {
  ensureHooksTable();
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO deployment_hooks (id, event, command, project_id, environment_id, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, event, command, projectId ?? null, environmentId ?? null, ts);

  return getHook(id);
}

export function getHook(id: string): DeploymentHook {
  ensureHooksTable();
  const db = getDatabase();
  const row = db.query("SELECT * FROM deployment_hooks WHERE id = ?").get(id) as HookRow | null;
  if (!row) throw new Error(`Hook not found: ${id}`);
  return rowToHook(row);
}

export function listHooks(event?: DeploymentHookEvent, projectId?: string): DeploymentHook[] {
  ensureHooksTable();
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (event) {
    conditions.push("event = ?");
    params.push(event);
  }
  if (projectId) {
    conditions.push("(project_id = ? OR project_id IS NULL)");
    params.push(projectId);
  }

  let sql = "SELECT * FROM deployment_hooks";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at ASC";

  return (db.query(sql).all(...params) as HookRow[]).map(rowToHook);
}

export function removeHook(id: string): void {
  ensureHooksTable();
  const db = getDatabase();
  db.query("DELETE FROM deployment_hooks WHERE id = ?").run(id);
}

export function toggleHook(id: string, enabled: boolean): DeploymentHook {
  ensureHooksTable();
  const db = getDatabase();
  db.query("UPDATE deployment_hooks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return getHook(id);
}

// ── Execution ───────────────────────────────────────────────────────────────

export async function runHooks(
  event: DeploymentHookEvent,
  context: HookContext
): Promise<HookResult[]> {
  const hooks = listHooks(event, context.project_id).filter((h) => h.enabled);
  const results: HookResult[] = [];

  for (const hook of hooks) {
    const start = Date.now();
    try {
      // Try @hasna/hooks SDK first
      const hooksResult = await runViaHooksSdk(hook, context);
      if (hooksResult) {
        results.push(hooksResult);
        continue;
      }

      // Fallback: run as shell command
      const result = await runShellCommand(hook, context);
      results.push(result);
    } catch (error) {
      results.push({
        hook_id: hook.id,
        event: hook.event,
        command: hook.command,
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - start,
      });
    }
  }

  return results;
}

async function runViaHooksSdk(
  hook: DeploymentHook,
  context: HookContext
): Promise<HookResult | null> {
  try {
    const { runHook } = await import("@hasna/hooks");
    const start = Date.now();

    const result = await runHook(hook.command, {
      cwd: process.cwd(),
      tool_name: "deployment",
      tool_input: context as unknown as Record<string, unknown>,
    });

    return {
      hook_id: hook.id,
      event: hook.event,
      command: hook.command,
      success: result.exitCode === 0,
      output: JSON.stringify(result.output),
      error: result.stderr,
      duration_ms: Date.now() - start,
    };
  } catch {
    return null; // @hasna/hooks not available, fallback to shell
  }
}

async function runShellCommand(
  hook: DeploymentHook,
  context: HookContext
): Promise<HookResult> {
  const start = Date.now();
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    DEPLOY_PROJECT_ID: context.project_id,
    DEPLOY_PROJECT_NAME: context.project_name,
    DEPLOY_ENV_ID: context.environment_id,
    DEPLOY_ENV_NAME: context.environment_name,
    DEPLOY_ENV_TYPE: context.environment_type,
    DEPLOY_PROVIDER: context.provider_type,
    DEPLOY_ID: context.deployment_id ?? "",
    DEPLOY_VERSION: context.version ?? "",
    DEPLOY_IMAGE: context.image ?? "",
    DEPLOY_COMMIT: context.commit_sha ?? "",
    DEPLOY_URL: context.url ?? "",
    DEPLOY_STATUS: context.status ?? "",
    DEPLOY_ERROR: context.error ?? "",
  };

  try {
    const proc = Bun.spawn(["sh", "-c", hook.command], {
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write(JSON.stringify(context));
    proc.stdin.end();

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return {
      hook_id: hook.id,
      event: hook.event,
      command: hook.command,
      success: exitCode === 0,
      output: stdout.trim(),
      error: stderr.trim(),
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      hook_id: hook.id,
      event: hook.event,
      command: hook.command,
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - start,
    };
  }
}

// ── Internal ────────────────────────────────────────────────────────────────

interface HookRow {
  id: string;
  event: string;
  command: string;
  project_id: string | null;
  environment_id: string | null;
  enabled: number;
  created_at: string;
}

function rowToHook(row: HookRow): DeploymentHook {
  return {
    id: row.id,
    event: row.event as DeploymentHookEvent,
    command: row.command,
    project_id: row.project_id,
    environment_id: row.environment_id,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}
