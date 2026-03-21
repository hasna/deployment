import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { detectProjectType, detectAllMatches } from "./detect.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `detect-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detect", () => {
  const dirs: string[] = [];

  function createDir(): string {
    const dir = makeTmpDir();
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
    dirs.length = 0;
  });

  describe("detectProjectType", () => {
    it("detects nextjs/vercel with next.config.js", () => {
      const dir = createDir();
      writeFileSync(join(dir, "next.config.js"), "module.exports = {};");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("nextjs");
      expect(result.suggestedProvider).toBe("vercel");
      expect(result.confidence).toBe("high");
      expect(result.type).toBe("web");
      expect(result.detectedFiles).toContain("next.config.js");
    });

    it("detects nextjs/vercel with next.config.mjs", () => {
      const dir = createDir();
      writeFileSync(join(dir, "next.config.mjs"), "export default {};");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("nextjs");
      expect(result.suggestedProvider).toBe("vercel");
    });

    it("detects nextjs/vercel with next.config.ts", () => {
      const dir = createDir();
      writeFileSync(join(dir, "next.config.ts"), "export default {};");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("nextjs");
      expect(result.suggestedProvider).toBe("vercel");
    });

    it("detects docker/flyio with Dockerfile", () => {
      const dir = createDir();
      writeFileSync(join(dir, "Dockerfile"), "FROM node:20");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("docker");
      expect(result.suggestedProvider).toBe("flyio");
      expect(result.confidence).toBe("medium");
      expect(result.type).toBe("container");
      expect(result.detectedFiles).toContain("Dockerfile");
    });

    it("detects node/railway with package.json only (low confidence)", () => {
      const dir = createDir();
      writeFileSync(join(dir, "package.json"), '{"name": "test"}');
      const result = detectProjectType(dir);
      expect(result.framework).toBe("node");
      expect(result.suggestedProvider).toBe("railway");
      expect(result.confidence).toBe("low");
      expect(result.type).toBe("service");
      expect(result.detectedFiles).toContain("package.json");
    });

    it("returns unknown for an empty directory", () => {
      const dir = createDir();
      const result = detectProjectType(dir);
      expect(result.type).toBe("unknown");
      expect(result.framework).toBe("unknown");
      expect(result.suggestedProvider).toBe("railway");
      expect(result.confidence).toBe("low");
      expect(result.detectedFiles).toEqual([]);
    });

    it("detects cloudflare workers with wrangler.toml", () => {
      const dir = createDir();
      writeFileSync(join(dir, "wrangler.toml"), 'name = "my-worker"');
      const result = detectProjectType(dir);
      expect(result.framework).toBe("cloudflare-workers");
      expect(result.suggestedProvider).toBe("cloudflare");
      expect(result.confidence).toBe("high");
    });

    it("detects fly.io with fly.toml", () => {
      const dir = createDir();
      writeFileSync(join(dir, "fly.toml"), 'app = "my-app"');
      const result = detectProjectType(dir);
      expect(result.framework).toBe("fly");
      expect(result.suggestedProvider).toBe("flyio");
      expect(result.confidence).toBe("high");
    });

    it("detects railway with railway.toml", () => {
      const dir = createDir();
      writeFileSync(join(dir, "railway.toml"), "[build]");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("railway");
      expect(result.suggestedProvider).toBe("railway");
      expect(result.confidence).toBe("high");
    });

    it("detects vercel.json as vercel provider", () => {
      const dir = createDir();
      writeFileSync(join(dir, "vercel.json"), "{}");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("vercel");
      expect(result.suggestedProvider).toBe("vercel");
      expect(result.confidence).toBe("high");
    });

    it("detects AWS with appspec.yml", () => {
      const dir = createDir();
      writeFileSync(join(dir, "appspec.yml"), "version: 0.0");
      const result = detectProjectType(dir);
      expect(result.framework).toBe("aws-ecs");
      expect(result.suggestedProvider).toBe("aws");
    });

    it("prefers higher priority match when multiple rules match", () => {
      const dir = createDir();
      // next.config.js (priority 10) + package.json (priority 1)
      writeFileSync(join(dir, "next.config.js"), "module.exports = {};");
      writeFileSync(join(dir, "package.json"), '{"name": "test"}');
      const result = detectProjectType(dir);
      expect(result.framework).toBe("nextjs");
      expect(result.suggestedProvider).toBe("vercel");
      expect(result.confidence).toBe("high");
    });

    it("prefers vercel.json over Dockerfile when both present", () => {
      const dir = createDir();
      writeFileSync(join(dir, "vercel.json"), "{}");
      writeFileSync(join(dir, "Dockerfile"), "FROM node:20");
      const result = detectProjectType(dir);
      // vercel.json has priority 8, Dockerfile has priority 5
      expect(result.framework).toBe("vercel");
      expect(result.suggestedProvider).toBe("vercel");
    });
  });

  describe("detectAllMatches", () => {
    it("returns multiple results when multiple rules match", () => {
      const dir = createDir();
      writeFileSync(join(dir, "next.config.js"), "module.exports = {};");
      writeFileSync(join(dir, "Dockerfile"), "FROM node:20");
      writeFileSync(join(dir, "package.json"), '{"name": "test"}');
      const results = detectAllMatches(dir);
      expect(results.length).toBeGreaterThanOrEqual(3);

      const frameworks = results.map((r) => r.framework);
      expect(frameworks).toContain("nextjs");
      expect(frameworks).toContain("docker");
      expect(frameworks).toContain("node");
    });

    it("returns empty array for an empty directory", () => {
      const dir = createDir();
      const results = detectAllMatches(dir);
      expect(results).toEqual([]);
    });

    it("returns exactly one result for a single-framework project", () => {
      const dir = createDir();
      writeFileSync(join(dir, "fly.toml"), 'app = "test"');
      const results = detectAllMatches(dir);
      expect(results.length).toBe(1);
      expect(results[0]!.framework).toBe("fly");
    });

    it("each result has correct structure", () => {
      const dir = createDir();
      writeFileSync(join(dir, "wrangler.toml"), "");
      const results = detectAllMatches(dir);
      expect(results.length).toBe(1);
      const result = results[0]!;
      expect(result).toHaveProperty("type");
      expect(result).toHaveProperty("framework");
      expect(result).toHaveProperty("suggestedProvider");
      expect(result).toHaveProperty("suggestedBlueprint");
      expect(result).toHaveProperty("confidence");
      expect(result).toHaveProperty("detectedFiles");
      expect(Array.isArray(result.detectedFiles)).toBe(true);
    });
  });
});
