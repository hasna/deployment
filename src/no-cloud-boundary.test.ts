import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CHECK_PATHS = ["package.json", "bun.lock", "README.md", "src"];
const SKIP_FILES = new Set([join(ROOT, "src", "no-cloud-boundary.test.ts")]);
const FORBIDDEN_MARKERS = [
  ["@hasna", "cloud"].join("/"),
  ["open", "cloud"].join("-"),
  ["cloud", "mcp"].join("-"),
  ["register", "Cloud", "Tools"].join(""),
  ["register", "Cloud", "Commands"].join(""),
  [".hasna", "cloud"].join("/"),
  ["HASNA", "CLOUD", ""].join("_"),
  ["HASNA", "RDS"].join("_"),
  ["cloud", "setup"].join(" "),
  ["cloud", "sync"].join(" "),
  "--" + "cloud",
];

describe("no-cloud boundary", () => {
  it("does not reference the retired shared cloud runtime in source, docs, or package metadata", () => {
    const findings: string[] = [];

    for (const checkPath of CHECK_PATHS) {
      const absolute = join(ROOT, checkPath);
      if (!existsSync(absolute)) continue;
      scanPath(absolute, findings);
    }

    expect(findings).toEqual([]);
  });
});

function scanPath(path: string, findings: string[]): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === "dist") continue;
      scanPath(join(path, entry), findings);
    }
    return;
  }

  if (SKIP_FILES.has(path)) return;
  if (!/\.(json|md|ts|tsx|js|mjs|cjs|yml|yaml|toml|lock)$/.test(path)) return;

  const text = readFileSync(path, "utf8");
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.includes(marker)) {
      findings.push(`${relative(ROOT, path)} contains ${marker}`);
    }
  }
}
