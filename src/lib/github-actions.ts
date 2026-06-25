/**
 * GitHub Actions integration — trigger workflows, poll status, fetch logs.
 * Generic: works with any repo that has GitHub Actions workflows.
 *
 * Requires either:
 * - `gh` CLI authenticated (preferred)
 * - GITHUB_TOKEN env var
 */

import { execFileSync } from "node:child_process";

export const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
export const GITHUB_REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
export const GITHUB_WORKFLOW_PATTERN = /^(?:\d+|(?:\.github\/workflows\/)?[A-Za-z0-9][A-Za-z0-9._ -]{0,199}(?:\.ya?ml)?)$/;
export const GITHUB_WORKFLOW_INPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
export const MAX_GITHUB_WORKFLOW_INPUT_VALUE_LENGTH = 20_000;

const MAX_GITHUB_RUN_LIMIT = 100;
const MAX_GITHUB_LOG_LINES = 1_000;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;
const INVALID_GIT_REF_CHARACTER_PATTERN = /[\x00-\x20\x7F~^:?*\[\\]/;

function runGh(args: string[], timeout: number = 30_000): string {
  return execFileSync("gh", args, { encoding: "utf-8", env: process.env, timeout, stdio: "pipe" });
}

function formatCommandError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isValidGitHubRepo(repo: string): boolean {
  const parts = repo.split("/");
  if (parts.length !== 2) return false;
  const owner = parts[0];
  const name = parts[1];
  return Boolean(
    owner &&
    name &&
    GITHUB_OWNER_PATTERN.test(owner) &&
    GITHUB_REPOSITORY_NAME_PATTERN.test(name) &&
    name !== "." &&
    name !== ".."
  );
}

export function validateGitHubRepo(repo: string): string {
  if (!isValidGitHubRepo(repo)) {
    throw new Error("Invalid GitHub repo: expected owner/name using a valid GitHub owner and repository name");
  }
  return repo;
}

function repoApiPath(repo: string): string {
  validateGitHubRepo(repo);
  const [owner, name] = repo.split("/") as [string, string];
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function isValidGitHubWorkflow(workflow: string): boolean {
  return GITHUB_WORKFLOW_PATTERN.test(workflow);
}

export function validateGitHubWorkflow(workflow: string): string {
  if (!isValidGitHubWorkflow(workflow)) {
    throw new Error("Invalid GitHub Actions workflow: expected a workflow name, numeric ID, or safe workflow YAML filename");
  }
  return workflow;
}

export function isValidGitHubWorkflowInputKey(key: string): boolean {
  return GITHUB_WORKFLOW_INPUT_KEY_PATTERN.test(key);
}

export function isValidGitHubWorkflowInputValue(value: string): boolean {
  return value.length <= MAX_GITHUB_WORKFLOW_INPUT_VALUE_LENGTH && !CONTROL_CHARACTER_PATTERN.test(value);
}

export function validateGitHubWorkflowInputs(inputs?: Record<string, string>): Record<string, string> | undefined {
  if (!inputs) return undefined;

  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (!isValidGitHubWorkflowInputKey(key)) {
      throw new Error(`Invalid GitHub Actions workflow input key: ${key}`);
    }
    if (typeof value !== "string" || !isValidGitHubWorkflowInputValue(value)) {
      throw new Error(`Invalid GitHub Actions workflow input value for key: ${key}`);
    }
    validated[key] = value;
  }
  return validated;
}

export function isValidGitHubBranch(branch: string): boolean {
  if (!branch || branch.length > 255) return false;
  if (branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") || branch.endsWith(".lock")) return false;
  if (branch.includes("//") || branch.includes("..") || branch.includes("@{")) return false;
  return !INVALID_GIT_REF_CHARACTER_PATTERN.test(branch);
}

export function validateGitHubBranch(branch: string): string {
  if (!isValidGitHubBranch(branch)) {
    throw new Error("Invalid GitHub branch/ref name");
  }
  return branch;
}

function validatePositiveInteger(name: string, value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid ${name}: expected an integer between 1 and ${max}`);
  }
  return value;
}

function tailLines(output: string, lines: number): string {
  const safeLines = validatePositiveInteger("log line count", lines, MAX_GITHUB_LOG_LINES);
  return output.trim().split(/\r?\n/).slice(-safeLines).join("\n");
}

export interface GitHubWorkflowRun {
  id: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
  createdAt: string;
  headBranch: string;
  displayTitle: string;
  event: string;
  htmlUrl: string;
}

export interface GitHubJobStep {
  name: string;
  status: "completed" | "in_progress" | "queued";
  conclusion: "success" | "failure" | "skipped" | "cancelled" | null;
}

export interface GitHubJob {
  name: string;
  status: string;
  conclusion: string | null;
  steps: GitHubJobStep[];
}

export interface WorkflowTriggerResult {
  triggered: boolean;
  repo: string;
  workflow: string;
  inputs: Record<string, string>;
}

export interface WorkflowStatusResult {
  run: GitHubWorkflowRun | null;
  activeStep: string | null;
  jobs: GitHubJob[];
}

// ── Trigger ────────────────────────────────────────────────────────────────

/**
 * Trigger a GitHub Actions workflow via workflow_dispatch.
 */
export function triggerWorkflow(
  repo: string,
  workflow: string,
  inputs?: Record<string, string>
): WorkflowTriggerResult {
  const safeRepo = validateGitHubRepo(repo);
  const safeWorkflow = validateGitHubWorkflow(workflow);
  const safeInputs = validateGitHubWorkflowInputs(inputs);
  const args = ["workflow", "run", safeWorkflow, "--repo", safeRepo];
  if (safeInputs) {
    for (const [key, value] of Object.entries(safeInputs)) {
      args.push("-f", `${key}=${value}`);
    }
  }

  try {
    runGh(args, 30_000);
    return { triggered: true, repo: safeRepo, workflow: safeWorkflow, inputs: safeInputs ?? {} };
  } catch (err) {
    throw new Error(`Failed to trigger workflow ${safeWorkflow} on ${safeRepo}: ${formatCommandError(err)}`);
  }
}

// ── Status ─────────────────────────────────────────────────────────────────

/**
 * Get the latest workflow run for a repo/workflow.
 */
export function getLatestRun(
  repo: string,
  workflow: string,
  limit: number = 1
): GitHubWorkflowRun[] {
  const safeRepo = validateGitHubRepo(repo);
  const safeWorkflow = validateGitHubWorkflow(workflow);
  const safeLimit = validatePositiveInteger("run list limit", limit, MAX_GITHUB_RUN_LIMIT);

  try {
    const output = runGh([
      "run",
      "list",
      "--workflow",
      safeWorkflow,
      "--repo",
      safeRepo,
      "--limit",
      String(safeLimit),
      "--json",
      "databaseId,status,conclusion,createdAt,headBranch,displayTitle,event",
    ]);
    const runs = JSON.parse(output) as Array<{
      databaseId: number;
      status: string;
      conclusion: string;
      createdAt: string;
      headBranch: string;
      displayTitle: string;
      event: string;
    }>;

    return runs.map((r) => ({
      id: r.databaseId,
      status: r.status as GitHubWorkflowRun["status"],
      conclusion: (r.conclusion || null) as GitHubWorkflowRun["conclusion"],
      createdAt: r.createdAt,
      headBranch: r.headBranch,
      displayTitle: r.displayTitle,
      event: r.event,
      htmlUrl: `https://github.com/${safeRepo}/actions/runs/${r.databaseId}`,
    }));
  } catch {
    return [];
  }
}

/**
 * Get detailed status of a workflow run including active step.
 */
export function getRunStatus(repo: string, runId: number): WorkflowStatusResult {
  const safeRepo = validateGitHubRepo(repo);
  const safeRunId = validatePositiveInteger("workflow run ID", runId, Number.MAX_SAFE_INTEGER);
  const apiRepo = repoApiPath(safeRepo);

  try {
    const runsOutput = runGh([
      "api",
      `${apiRepo}/actions/runs/${safeRunId}`,
      "--jq",
      "{status,conclusion,createdAt: .created_at,headBranch: .head_branch,displayTitle: .display_title,event}",
    ]);
    const runData = JSON.parse(runsOutput) as {
      status: string;
      conclusion: string | null;
      createdAt: string;
      headBranch: string;
      displayTitle: string;
      event: string;
    };

    const run: GitHubWorkflowRun = {
      id: safeRunId,
      status: runData.status as GitHubWorkflowRun["status"],
      conclusion: (runData.conclusion || null) as GitHubWorkflowRun["conclusion"],
      createdAt: runData.createdAt,
      headBranch: runData.headBranch,
      displayTitle: runData.displayTitle,
      event: runData.event,
      htmlUrl: `https://github.com/${safeRepo}/actions/runs/${safeRunId}`,
    };

    // Get jobs and active step
    const jobsOutput = runGh([
      "api",
      `${apiRepo}/actions/runs/${safeRunId}/jobs`,
      "--jq",
      "[.jobs[] | {name, status, conclusion, steps: [.steps[] | {name, status, conclusion}]}]",
    ]);
    const jobs = JSON.parse(jobsOutput) as GitHubJob[];

    // Find the currently active step
    let activeStep: string | null = null;
    for (const job of jobs) {
      if (job.status === "in_progress") {
        const step = job.steps.find((s) => s.status === "in_progress");
        if (step) {
          activeStep = `${job.name}: ${step.name}`;
          break;
        }
      }
    }

    return { run, activeStep, jobs };
  } catch {
    return { run: null, activeStep: null, jobs: [] };
  }
}

// ── Logs ───────────────────────────────────────────────────────────────────

/**
 * Get failure logs for a workflow run.
 */
export function getFailureLogs(repo: string, runId: number, lines: number = 30): string {
  const safeRepo = validateGitHubRepo(repo);
  const safeRunId = validatePositiveInteger("workflow run ID", runId, Number.MAX_SAFE_INTEGER);
  validatePositiveInteger("log line count", lines, MAX_GITHUB_LOG_LINES);

  try {
    const output = runGh(["run", "view", String(safeRunId), "--repo", safeRepo, "--log-failed"]);
    return tailLines(output, lines);
  } catch {
    return "(no logs available)";
  }
}

/**
 * Get annotations (error messages) for a workflow run.
 */
export function getAnnotations(repo: string, runId: number): string[] {
  const safeRunId = validatePositiveInteger("workflow run ID", runId, Number.MAX_SAFE_INTEGER);
  const apiRepo = repoApiPath(repo);

  try {
    const jobsOutput = runGh(["api", `${apiRepo}/actions/runs/${safeRunId}/jobs`, "--jq", ".jobs[].id"]);
    const jobIds = jobsOutput.trim().split(/\r?\n/).filter((jobId) => /^\d+$/.test(jobId));

    const annotations: string[] = [];
    for (const jobId of jobIds) {
      try {
        const output = runGh(["api", `${apiRepo}/check-runs/${jobId}/annotations`, "--jq", ".[].message"], 15_000);
        annotations.push(...output.trim().split(/\r?\n/).filter(Boolean));
      } catch {
        // skip
      }
    }
    return annotations;
  } catch {
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the latest commit SHA on a branch.
 */
export function getLatestCommit(repo: string, branch: string = "main"): string | null {
  const safeBranch = validateGitHubBranch(branch);
  const apiRepo = repoApiPath(repo);

  try {
    return runGh(["api", `${apiRepo}/commits/${encodeURIComponent(safeBranch)}`, "--jq", ".sha"], 15_000).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a new commit has been pushed since a given SHA.
 * Returns the new SHA if changed, null if same.
 */
export function checkForNewCommit(
  repo: string,
  lastKnownSha: string,
  branch: string = "main"
): string | null {
  const currentSha = getLatestCommit(repo, branch);
  if (!currentSha || currentSha === lastKnownSha) return null;
  return currentSha;
}

/**
 * Check if gh CLI is authenticated.
 */
export function isGhAuthenticated(): boolean {
  try {
    runGh(["auth", "status"], 10_000);
    return true;
  } catch {
    return false;
  }
}
