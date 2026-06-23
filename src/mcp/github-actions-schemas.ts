import { z } from "zod";
import {
  isValidGitHubRepo,
  isValidGitHubWorkflow,
  isValidGitHubWorkflowInputKey,
  isValidGitHubWorkflowInputValue,
} from "../lib/github-actions.js";

export const githubRepoParam = z.string()
  .refine(isValidGitHubRepo, "Expected GitHub repo in owner/name form")
  .describe("GitHub repo (owner/name)");

export const githubWorkflowParam = z.string()
  .refine(isValidGitHubWorkflow, "Expected workflow name, numeric ID, or safe workflow YAML filename")
  .describe("Workflow filename (e.g. deploy.yml)");

export const githubWorkflowInputKeyParam = z.string()
  .refine(isValidGitHubWorkflowInputKey, "Expected workflow input key using letters, numbers, underscore, or hyphen");

export const githubWorkflowInputValueParam = z.string()
  .refine(isValidGitHubWorkflowInputValue, "Expected workflow input value without control characters");

export const githubWorkflowInputsParam = z.record(githubWorkflowInputKeyParam, githubWorkflowInputValueParam)
  .describe("Workflow dispatch inputs");

export const githubRunIdParam = z.number().int().positive().describe("Workflow run ID");
export const githubRunLimitParam = z.number().int().positive().max(100).describe("Number of recent runs (default: 3)");
export const githubLogLinesParam = z.number().int().positive().max(1000).describe("Number of log lines (default: 30)");

export const deployGitHubToolSchema = {
  repo: githubRepoParam,
  workflow: githubWorkflowParam,
  environment: githubWorkflowInputValueParam.describe("Target environment"),
  inputs: githubWorkflowInputsParam.optional().describe("Additional workflow inputs"),
  poll: z.boolean().optional().describe("Wait for completion (default: false)"),
};

export const ghTriggerToolSchema = {
  repo: githubRepoParam,
  workflow: githubWorkflowParam,
  inputs: githubWorkflowInputsParam.optional().describe("Workflow dispatch inputs"),
};

export const ghStatusToolSchema = {
  repo: githubRepoParam,
  workflow: githubWorkflowParam.optional().describe("Workflow filename (e.g. deploy.yml)"),
  run_id: githubRunIdParam.optional().describe("Specific run ID to check"),
  limit: githubRunLimitParam.optional().describe("Number of recent runs (default: 3)"),
};

export const ghLogsToolSchema = {
  repo: githubRepoParam,
  run_id: githubRunIdParam,
  lines: githubLogLinesParam.optional().describe("Number of log lines (default: 30)"),
};
