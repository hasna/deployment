/**
 * GitHub Actions integration — trigger workflows, poll status, fetch logs.
 * Generic: works with any repo that has GitHub Actions workflows.
 *
 * Requires either:
 * - `gh` CLI authenticated (preferred)
 * - GITHUB_TOKEN env var
 */

import { execSync } from "child_process";

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
  const args = [`gh`, `workflow`, `run`, workflow, `--repo`, repo];
  if (inputs) {
    for (const [key, value] of Object.entries(inputs)) {
      args.push("-f", `${key}=${value}`);
    }
  }

  try {
    execSync(args.join(" "), { encoding: "utf-8", timeout: 30000 });
    return { triggered: true, repo, workflow, inputs: inputs ?? {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to trigger workflow ${workflow} on ${repo}: ${message}`);
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
  try {
    const output = execSync(
      `gh run list --workflow=${workflow} --repo ${repo} --limit ${limit} --json databaseId,status,conclusion,createdAt,headBranch,displayTitle,event`,
      { encoding: "utf-8", timeout: 30000 }
    );
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
      htmlUrl: `https://github.com/${repo}/actions/runs/${r.databaseId}`,
    }));
  } catch {
    return [];
  }
}

/**
 * Get detailed status of a workflow run including active step.
 */
export function getRunStatus(repo: string, runId: number): WorkflowStatusResult {
  try {
    const runsOutput = execSync(
      `gh api repos/${repo}/actions/runs/${runId} --jq '{status,conclusion,createdAt: .created_at,headBranch: .head_branch,displayTitle: .display_title,event}'`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const runData = JSON.parse(runsOutput) as {
      status: string;
      conclusion: string | null;
      createdAt: string;
      headBranch: string;
      displayTitle: string;
      event: string;
    };

    const run: GitHubWorkflowRun = {
      id: runId,
      status: runData.status as GitHubWorkflowRun["status"],
      conclusion: (runData.conclusion || null) as GitHubWorkflowRun["conclusion"],
      createdAt: runData.createdAt,
      headBranch: runData.headBranch,
      displayTitle: runData.displayTitle,
      event: runData.event,
      htmlUrl: `https://github.com/${repo}/actions/runs/${runId}`,
    };

    // Get jobs and active step
    const jobsOutput = execSync(
      `gh api repos/${repo}/actions/runs/${runId}/jobs --jq '[.jobs[] | {name, status, conclusion, steps: [.steps[] | {name, status, conclusion}]}]'`,
      { encoding: "utf-8", timeout: 30000 }
    );
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
  try {
    return execSync(
      `gh run view ${runId} --repo ${repo} --log-failed 2>&1 | tail -${lines}`,
      { encoding: "utf-8", timeout: 30000 }
    ).trim();
  } catch {
    return "(no logs available)";
  }
}

/**
 * Get annotations (error messages) for a workflow run.
 */
export function getAnnotations(repo: string, runId: number): string[] {
  try {
    const jobsOutput = execSync(
      `gh api repos/${repo}/actions/runs/${runId}/jobs --jq '.jobs[].id'`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const jobIds = jobsOutput.trim().split("\n").filter(Boolean);

    const annotations: string[] = [];
    for (const jobId of jobIds) {
      try {
        const output = execSync(
          `gh api repos/${repo}/check-runs/${jobId}/annotations --jq '.[].message'`,
          { encoding: "utf-8", timeout: 15000 }
        );
        annotations.push(...output.trim().split("\n").filter(Boolean));
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
  try {
    return execSync(
      `gh api repos/${repo}/commits/${branch} --jq '.sha'`,
      { encoding: "utf-8", timeout: 15000 }
    ).trim() || null;
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
    execSync("gh auth status", { encoding: "utf-8", timeout: 10000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
