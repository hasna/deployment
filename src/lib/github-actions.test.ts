import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  getAnnotations,
  getFailureLogs,
  getLatestCommit,
  getLatestRun,
  getRunStatus,
  isGhAuthenticated,
  triggerWorkflow,
} from "./github-actions.js";

let originalPath: string | undefined;
let originalGhArgsLog: string | undefined;
let tempDir: string;
let ghArgsLog: string;

function readGhCalls(): string[][] {
  if (!existsSync(ghArgsLog)) return [];
  return readFileSync(ghArgsLog, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

describe("github-actions", () => {
  beforeEach(() => {
    originalPath = process.env["PATH"];
    originalGhArgsLog = process.env["GH_ARGS_LOG"];
    tempDir = mkdtempSync(join(tmpdir(), "open-deployment-gh-"));
    ghArgsLog = join(tempDir, "gh-args.jsonl");
    const ghPath = join(tempDir, "gh");
    writeFileSync(ghPath, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GH_ARGS_LOG!, JSON.stringify(args) + "\\n");

if (args[0] === "auth" && args[1] === "status") {
  process.exit(0);
}

if (args[0] === "workflow" && args[1] === "run") {
  process.exit(0);
}

if (args[0] === "run" && args[1] === "list") {
  console.log(JSON.stringify([{
    databaseId: 123,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-06-23T00:00:00Z",
    headBranch: "main",
    displayTitle: "Deploy",
    event: "workflow_dispatch"
  }]));
  process.exit(0);
}

if (args[0] === "run" && args[1] === "view") {
  console.log("first\\nsecond\\nthird");
  process.exit(0);
}

if (args[0] === "api") {
  const endpoint = args[1] ?? "";
  if (endpoint.endsWith("/jobs") && args.includes(".jobs[].id")) {
    console.log("456");
    process.exit(0);
  }
  if (endpoint.endsWith("/jobs")) {
    console.log(JSON.stringify([{
      name: "deploy",
      status: "in_progress",
      conclusion: null,
      steps: [{ name: "ship", status: "in_progress", conclusion: null }]
    }]));
    process.exit(0);
  }
  if (endpoint.includes("/check-runs/")) {
    console.log("annotation");
    process.exit(0);
  }
  if (endpoint.includes("/commits/")) {
    console.log("abc123");
    process.exit(0);
  }
  console.log(JSON.stringify({
    status: "in_progress",
    conclusion: null,
    createdAt: "2026-06-23T00:00:00Z",
    headBranch: "main",
    displayTitle: "Deploy",
    event: "workflow_dispatch"
  }));
  process.exit(0);
}

console.error("unexpected gh args", args);
process.exit(2);
`);
    chmodSync(ghPath, 0o755);
    process.env["GH_ARGS_LOG"] = ghArgsLog;
    process.env["PATH"] = `${tempDir}${delimiter}${originalPath ?? ""}`;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;

    if (originalGhArgsLog === undefined) delete process.env["GH_ARGS_LOG"];
    else process.env["GH_ARGS_LOG"] = originalGhArgsLog;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("isGhAuthenticated returns boolean", () => {
    const result = isGhAuthenticated();
    expect(typeof result).toBe("boolean");
  });

  it("module exports expected functions", async () => {
    const mod = await import("./github-actions.js");
    expect(typeof mod.triggerWorkflow).toBe("function");
    expect(typeof mod.getLatestRun).toBe("function");
    expect(typeof mod.getRunStatus).toBe("function");
    expect(typeof mod.getFailureLogs).toBe("function");
    expect(typeof mod.getAnnotations).toBe("function");
    expect(typeof mod.isGhAuthenticated).toBe("function");
  });

  it("passes workflow input values as argv without shell interpretation", () => {
    const injectedValue = "hello; echo INJECTED >&2 #";

    const result = triggerWorkflow("owner/repo", "deploy.yml", {
      message: injectedValue,
      environment: "prod",
    });

    expect(result.triggered).toBe(true);
    expect(readGhCalls()).toEqual([
      [
        "workflow",
        "run",
        "deploy.yml",
        "--repo",
        "owner/repo",
        "-f",
        `message=${injectedValue}`,
        "-f",
        "environment=prod",
      ],
    ]);
  });

  it("rejects injected repo, workflow, and input keys before spawning gh", () => {
    expect(() => triggerWorkflow("owner/repo; echo INJECTED >&2 #", "deploy.yml")).toThrow("Invalid GitHub repo");
    expect(() => triggerWorkflow("owner/repo", "deploy.yml; echo INJECTED >&2 #")).toThrow("Invalid GitHub Actions workflow");
    expect(() => triggerWorkflow("owner/repo", "deploy.yml", { "bad;key": "value" })).toThrow("Invalid GitHub Actions workflow input key");
    expect(readGhCalls()).toEqual([]);
  });

  it("uses argv-safe gh calls for status, logs, and commit helpers", () => {
    const runs = getLatestRun("owner/repo", "deploy.yml", 3);
    const status = getRunStatus("owner/repo", 123);
    const logs = getFailureLogs("owner/repo", 123, 2);
    const annotations = getAnnotations("owner/repo", 123);
    const sha = getLatestCommit("owner/repo", "release/v1");

    expect(runs[0]?.htmlUrl).toBe("https://github.com/owner/repo/actions/runs/123");
    expect(status.activeStep).toBe("deploy: ship");
    expect(logs).toBe("second\nthird");
    expect(annotations).toEqual(["annotation"]);
    expect(sha).toBe("abc123");
    expect(readGhCalls()).toEqual([
      [
        "run",
        "list",
        "--workflow",
        "deploy.yml",
        "--repo",
        "owner/repo",
        "--limit",
        "3",
        "--json",
        "databaseId,status,conclusion,createdAt,headBranch,displayTitle,event",
      ],
      [
        "api",
        "repos/owner/repo/actions/runs/123",
        "--jq",
        "{status,conclusion,createdAt: .created_at,headBranch: .head_branch,displayTitle: .display_title,event}",
      ],
      [
        "api",
        "repos/owner/repo/actions/runs/123/jobs",
        "--jq",
        "[.jobs[] | {name, status, conclusion, steps: [.steps[] | {name, status, conclusion}]}]",
      ],
      ["run", "view", "123", "--repo", "owner/repo", "--log-failed"],
      ["api", "repos/owner/repo/actions/runs/123/jobs", "--jq", ".jobs[].id"],
      ["api", "repos/owner/repo/check-runs/456/annotations", "--jq", ".[].message"],
      ["api", "repos/owner/repo/commits/release%2Fv1", "--jq", ".sha"],
    ]);
  });

  it("rejects invalid status, log, annotation, and commit parameters before spawning gh", () => {
    expect(() => getLatestRun("owner/repo; echo INJECTED >&2 #", "deploy.yml")).toThrow("Invalid GitHub repo");
    expect(() => getLatestRun("owner/repo", "deploy.yml; echo INJECTED >&2 #")).toThrow("Invalid GitHub Actions workflow");
    expect(() => getRunStatus("owner/repo", 12.5)).toThrow("Invalid workflow run ID");
    expect(() => getFailureLogs("owner/repo", 123, 0)).toThrow("Invalid log line count");
    expect(() => getAnnotations("owner/repo; echo INJECTED >&2 #", 123)).toThrow("Invalid GitHub repo");
    expect(() => getLatestCommit("owner/repo", "bad branch")).toThrow("Invalid GitHub branch/ref name");
    expect(readGhCalls()).toEqual([]);
  });
});
