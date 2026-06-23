import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resetDatabase, closeDatabase } from "../db/database.js";

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

describe("deployer", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    originalPath = process.env["PATH"];
    originalGhArgsLog = process.env["GH_ARGS_LOG"];
    tempDir = mkdtempSync(join(tmpdir(), "open-deployment-deployer-gh-"));
    ghArgsLog = join(tempDir, "gh-args.jsonl");
    const ghPath = join(tempDir, "gh");
    writeFileSync(ghPath, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.GH_ARGS_LOG!, JSON.stringify(args) + "\\n");

if (args[0] === "workflow" && args[1] === "run") {
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
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];

    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;

    if (originalGhArgsLog === undefined) delete process.env["GH_ARGS_LOG"];
    else process.env["GH_ARGS_LOG"] = originalGhArgsLog;

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports deploy as a function", async () => {
    const { deploy } = await import("./deployer.js");
    expect(typeof deploy).toBe("function");
  });

  it("exports rollback as a function", async () => {
    const { rollback } = await import("./deployer.js");
    expect(typeof rollback).toBe("function");
  });

  it("exports promote as a function", async () => {
    const { promote } = await import("./deployer.js");
    expect(typeof promote).toBe("function");
  });

  it("exports getStatus as a function", async () => {
    const { getStatus } = await import("./deployer.js");
    expect(typeof getStatus).toBe("function");
  });

  it("exports getLogs as a function", async () => {
    const { getLogs } = await import("./deployer.js");
    expect(typeof getLogs).toBe("function");
  });

  it("deployViaGitHub keeps the explicit environment input authoritative", async () => {
    const { deployViaGitHub } = await import("./deployer.js");

    const result = await deployViaGitHub({
      repo: "owner/repo",
      workflow: "deploy.yml",
      environment: "prod",
      inputs: { environment: "staging", message: "ship" },
    });

    expect(result).toEqual({ triggered: true, run: null, status: "in_progress" });
    expect(readGhCalls()).toEqual([
      [
        "workflow",
        "run",
        "deploy.yml",
        "--repo",
        "owner/repo",
        "-f",
        "environment=prod",
        "-f",
        "message=ship",
      ],
    ]);
  });
});
