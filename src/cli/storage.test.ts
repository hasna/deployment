import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return await new Response(stream).text();
}

async function runCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: { ...process.env, OPEN_DEPLOYMENT_DB: ":memory:" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("deployment storage command", () => {
  it("advertises storage without a legacy cloud command", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).not.toMatch(/\n\s+cloud(?:\s|$)/);
  });

  it("reports local storage status with canonical env names", async () => {
    const result = await runCli(["storage", "status", "--json"]);
    const status = JSON.parse(result.stdout) as {
      configured: boolean;
      mode: string;
      env: string[];
      service: string;
      tables: string[];
    };

    expect(result.exitCode).toBe(0);
    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.service).toBe("deployment");
    expect(status.env).toEqual(["HASNA_DEPLOYMENT_DATABASE_URL", "DEPLOYMENT_DATABASE_URL"]);
    expect(status.tables).toContain("projects");
    expect(status.tables).toContain("deployments");
  });
});
