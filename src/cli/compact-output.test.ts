import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createDeployment } from "../db/deployments.js";
import { createEnvironment } from "../db/environments.js";
import { createProject } from "../db/projects.js";
import { createProvider } from "../db/providers.js";

const tempDirs: string[] = [];

afterEach(() => {
  resetDatabase();
  closeDatabase();
  delete process.env["OPEN_DEPLOYMENT_DB"];
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function seedProjectDb(count: number): string {
  resetDatabase();
  closeDatabase();
  const dir = mkdtempSync(join(tmpdir(), "open-deployment-cli-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "deployment.db");
  process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

  for (let i = 0; i < count; i++) {
    createProject({
      name: `service-${String(i).padStart(2, "0")}-with-a-long-agent-facing-name`,
      source_type: "git",
      source_url: `https://github.com/example/service-${i}?branch=main&token=this-part-should-not-appear-in-default-output`,
      description: "A noisy project description that should stay out of default list output.",
    });
  }

  closeDatabase();
  return dbPath;
}

function seedDeploymentDb(count: number): { dbPath: string; projectName: string } {
  resetDatabase();
  closeDatabase();
  const dir = mkdtempSync(join(tmpdir(), "open-deployment-cli-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "deployment.db");
  process.env["OPEN_DEPLOYMENT_DB"] = dbPath;

  const project = createProject({ name: "history-test", source_type: "git", source_url: "" });
  const provider = createProvider({ name: "history-provider", type: "vercel", credentials_key: "" });
  const environment = createEnvironment({ project_id: project.id, name: "prod", type: "prod", provider_id: provider.id });

  for (let i = 0; i < count; i++) {
    createDeployment({
      project_id: project.id,
      environment_id: environment.id,
      version: `release-${String(i).padStart(2, "0")}-${"x".repeat(80)}`,
      commit_sha: `commit-${i}`,
    });
  }

  closeDatabase();
  return { dbPath, projectName: project.name };
}

async function runCli(dbPath: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPEN_DEPLOYMENT_DB: dbPath,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("CLI compact output", () => {
  it("caps project list output and points to pagination/detail paths", async () => {
    const dbPath = seedProjectDb(22);

    const result = await runCli(dbPath, ["project", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const rows = result.stdout.split("\n").filter((line) => /^\s+[a-f0-9]{8}\s+/.test(line));
    expect(rows.length).toBe(20);
    expect(result.stdout).toContain("projects: showing 20 of 22");
    expect(result.stdout).toContain("next: deployment project list --cursor 20");
    expect(result.stdout).toContain("use project show <id> for details");
    expect(result.stdout).not.toContain("this-part-should-not-appear-in-default-output");
  });

  it("keeps project JSON output machine-readable and full by default", async () => {
    const dbPath = seedProjectDb(22);

    const result = await runCli(dbPath, ["project", "list", "--format", "json"]);

    expect(result.exitCode).toBe(0);
    const projects = JSON.parse(result.stdout) as Array<{ source_url: string }>;
    expect(projects.length).toBe(22);
    expect(projects.some((project) => project.source_url.includes("this-part-should-not-appear-in-default-output"))).toBe(true);
  });

  it("applies explicit JSON pagination when requested", async () => {
    const dbPath = seedProjectDb(22);

    const result = await runCli(dbPath, ["project", "list", "--format", "json", "--limit", "3", "--cursor", "2"]);

    expect(result.exitCode).toBe(0);
    const projects = JSON.parse(result.stdout) as unknown[];
    expect(projects.length).toBe(3);
  });

  it("reports the actual row count on the final cursor page", async () => {
    const dbPath = seedProjectDb(22);

    const result = await runCli(dbPath, ["project", "list", "--cursor", "20"]);

    expect(result.exitCode).toBe(0);
    const rows = result.stdout.split("\n").filter((line) => /^\s+[a-f0-9]{8}\s+/.test(line));
    expect(rows.length).toBe(2);
    expect(result.stdout).toContain("projects: showing 2 of 22");
    expect(result.stdout).not.toContain("next: deployment project list");
  });

  it("keeps history JSON on the existing default limit and supports explicit pagination", async () => {
    const { dbPath, projectName } = seedDeploymentDb(25);

    const defaultResult = await runCli(dbPath, ["history", "list", projectName, "--format", "json"]);
    expect(defaultResult.exitCode).toBe(0);
    const defaultDeployments = JSON.parse(defaultResult.stdout) as unknown[];
    expect(defaultDeployments.length).toBe(20);

    const pagedResult = await runCli(dbPath, ["history", "list", projectName, "--format", "json", "--limit", "3", "--cursor", "2"]);
    expect(pagedResult.exitCode).toBe(0);
    const pagedDeployments = JSON.parse(pagedResult.stdout) as unknown[];
    expect(pagedDeployments.length).toBe(3);
  });

  it("pages ps output without loading the full history into the printed output", async () => {
    const { dbPath } = seedDeploymentDb(25);

    const result = await runCli(dbPath, ["ps", "--limit", "5"]);

    expect(result.exitCode).toBe(0);
    const rows = result.stdout.split("\n").filter((line) => /^\s+[a-f0-9]{8}\s+/.test(line));
    expect(rows.length).toBe(5);
    expect(result.stdout).toContain("deployments: showing 5 of 25");
    expect(result.stdout).toContain("next: deployment ps --cursor 5");
  });
});
