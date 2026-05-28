export async function runPreDeployChecks(
  project: string,
  environment: string,
  config: Record<string, unknown> = {},
): Promise<{
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message?: string }>;
}> {
  const checks = [
    {
      name: "project",
      passed: Boolean(project),
      message: project ? undefined : "Project is required",
    },
    {
      name: "environment",
      passed: Boolean(environment),
      message: environment ? undefined : "Environment is required",
    },
  ];

  if (config.database_url !== undefined) {
    checks.push({
      name: "database_url",
      passed: typeof config.database_url === "string" && config.database_url.length > 0,
      message:
        typeof config.database_url === "string" && config.database_url.length > 0
          ? undefined
          : "DATABASE_URL must be a non-empty string",
    });
  }

  if (config.image !== undefined) {
    checks.push({
      name: "image",
      passed: typeof config.image === "string" && config.image.length > 0,
      message:
        typeof config.image === "string" && config.image.length > 0
          ? undefined
          : "Image must be a non-empty string",
    });
  }

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}
