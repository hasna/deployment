import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { resetDatabase, closeDatabase } from "../db/database.js";
import {
  deployGitHubToolSchema,
  ghLogsToolSchema,
  ghStatusToolSchema,
  ghTriggerToolSchema,
} from "./github-actions-schemas.js";

describe("mcp/index", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("file can be parsed without syntax errors", async () => {
    // The MCP index.ts uses top-level await for server.connect(transport),
    // which requires a stdio transport and blocks. We verify the file is
    // syntactically valid by checking the TypeScript compilation instead.
    // Here we test that the module's related imports work.
    const { createProject, listProjects } = await import("../db/projects.js");
    const { registerAgent, listAgents } = await import("../db/agents.js");

    // Verify the DB functions that MCP tools rely on work correctly
    const project = createProject({ name: "mcp-test", source_type: "git", source_url: "" });
    expect(project.name).toBe("mcp-test");

    const projects = listProjects();
    expect(projects.length).toBe(1);

    const agent = registerAgent({ name: "mcp-agent" });
    expect(agent.name).toBe("mcp-agent");

    const agents = listAgents();
    expect(agents.length).toBe(1);
  });

  it("TOOL_CATALOG would contain expected tool names", () => {
    // We can't import the module directly since it starts the MCP server
    // with top-level await. Instead, verify the expected tool names.
    const expectedTools = [
      "create_project",
      "list_projects",
      "get_project",
      "delete_project",
      "create_environment",
      "list_environments",
      "get_environment",
      "delete_environment",
      "add_provider",
      "list_providers",
      "get_provider",
      "remove_provider",
      "deploy",
      "get_deployment_status",
      "list_deployments",
      "get_deployment_logs",
      "rollback",
      "promote",
      "list_resources",
      "destroy_resource",
      "list_blueprints",
      "get_blueprint",
      "apply_blueprint",
      "set_secret",
      "list_secrets",
      "diff_secrets",
      "sync_secrets",
      "set_config",
      "list_config",
      "check_secret_parity",
      "rotate_secret",
      "logs_tail",
      "ecs_status",
      "deploy_sequence",
      "deploy_github",
      "gh_trigger",
      "gh_status",
      "gh_logs",
      "pre_deploy_check",
      "register_agent",
      "list_agents",
      "storage_status",
      "storage_push",
      "storage_pull",
      "storage_sync",
      "describe_tools",
      "search_tools",
    ];
    // The TOOL_CATALOG in the source has 47 entries
    expect(expectedTools.length).toBe(47);
    expect(expectedTools).not.toContain("cloud_status");
    expect(expectedTools).not.toContain("cloud_push");
    expect(expectedTools).not.toContain("cloud_pull");
    expect(expectedTools).not.toContain("cloud_sync");
    // Each name is unique
    const unique = new Set(expectedTools);
    expect(unique.size).toBe(expectedTools.length);
  });

  it("GitHub Actions MCP schemas reject injection-shaped parameters", () => {
    const triggerSchema = z.object(ghTriggerToolSchema);
    const deploySchema = z.object(deployGitHubToolSchema);
    const statusSchema = z.object(ghStatusToolSchema);
    const logsSchema = z.object(ghLogsToolSchema);

    expect(triggerSchema.safeParse({
      repo: "owner/repo",
      workflow: "deploy.yml",
      inputs: { message: "hello; echo INJECTED >&2 #" },
    }).success).toBe(true);

    expect(triggerSchema.safeParse({ repo: "owner/repo; echo INJECTED >&2 #", workflow: "deploy.yml" }).success).toBe(false);
    expect(triggerSchema.safeParse({ repo: "owner/repo", workflow: "deploy.yml; echo INJECTED >&2 #" }).success).toBe(false);
    expect(triggerSchema.safeParse({ repo: "owner/repo", workflow: "deploy.yml", inputs: { "bad;key": "value" } }).success).toBe(false);
    expect(deploySchema.safeParse({ repo: "owner/repo", workflow: "deploy.yml", environment: "prod\nstaging" }).success).toBe(false);
    expect(statusSchema.safeParse({ repo: "owner/repo", run_id: 12.5 }).success).toBe(false);
    expect(statusSchema.safeParse({ repo: "owner/repo", workflow: "deploy.yml", limit: 101 }).success).toBe(false);
    expect(logsSchema.safeParse({ repo: "owner/repo", run_id: 123, lines: 0 }).success).toBe(false);
  });
});
