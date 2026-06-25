import { execSync } from "node:child_process";

export interface PreDeployCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface PreDeployCheckResult {
  project: string;
  environment: string;
  ok: boolean;
  checks: PreDeployCheck[];
}

export async function runPreDeployChecks(
  project: string,
  environment: string,
  config: Record<string, unknown> = {},
): Promise<PreDeployCheckResult> {
  const checks: PreDeployCheck[] = [];

  checks.push({
    name: "project",
    ok: project.trim().length > 0,
    message: project.trim().length > 0 ? `Project: ${project}` : "Project is required",
  });

  checks.push({
    name: "environment",
    ok: environment.trim().length > 0,
    message: environment.trim().length > 0 ? `Environment: ${environment}` : "Environment is required",
  });

  if (typeof config["database_url"] === "string") {
    checks.push(validateDatabaseUrl(config["database_url"]));
  }

  if (typeof config["image"] === "string") {
    checks.push({
      name: "image",
      ok: config["image"].trim().length > 0,
      message: config["image"].trim().length > 0 ? `Image: ${config["image"]}` : "Image cannot be empty",
    });
  }

  if (typeof config["schema_check_command"] === "string" && config["schema_check_command"].trim()) {
    checks.push(runCommandCheck(config["schema_check_command"]));
  }

  return { project, environment, ok: checks.every((check) => check.ok), checks };
}

function validateDatabaseUrl(value: string): PreDeployCheck {
  try {
    const url = new URL(value);
    const ok = ["postgres:", "postgresql:", "mysql:", "mysql2:"].includes(url.protocol);
    return { name: "database_url", ok, message: ok ? "Database URL is valid" : `Unsupported database URL protocol: ${url.protocol}` };
  } catch {
    return { name: "database_url", ok: false, message: "Database URL is invalid" };
  }
}

function runCommandCheck(command: string): PreDeployCheck {
  try {
    execSync(command, { stdio: "pipe", timeout: 30_000 });
    return { name: "schema_check_command", ok: true, message: "Schema check command passed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name: "schema_check_command", ok: false, message };
  }
}
