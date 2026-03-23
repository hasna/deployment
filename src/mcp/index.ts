#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js";
import { createEnvironment, getEnvironment, listEnvironments, deleteEnvironment } from "../db/environments.js";
import { createProvider as createDbProvider, getProvider as getDbProvider, listProviders, deleteProvider } from "../db/providers.js";
import { listDeployments } from "../db/deployments.js";
import { listResources, deleteResource } from "../db/resources.js";
import { listBlueprints, getBlueprint } from "../db/blueprints.js";
import { registerAgent, listAgents, heartbeat as dbHeartbeat, setFocus as dbSetFocus } from "../db/agents.js";
import { deploy, rollback, promote, getStatus, getLogs, previewDeploy } from "../lib/deployer.js";
import { applyBlueprint, seedBuiltinBlueprints } from "../lib/blueprints.js";
import { setDeploymentSecret, listDeploymentSecrets, diffSecrets, checkSecretParity, syncSecrets, setConfigParam, listConfigParams, rotateSecret, initSecrets } from "../lib/secrets-integration.js";
import { registerProvider, getProvider as getRegisteredProvider } from "../lib/provider.js";
import { detectProjectType } from "../lib/detect.js";
import { addHook, listHooks, removeHook, runHooks, ensureHooksTable } from "../lib/hooks.js";
import { getLatestDeployment } from "../db/deployments.js";
import { timeAgo } from "../lib/format.js";
import { VercelProvider } from "../lib/vercel.js";
import { CloudflareProvider } from "../lib/cloudflare.js";
import { RailwayProvider } from "../lib/railway.js";
import { FlyioProvider } from "../lib/flyio.js";
import { AwsProvider } from "../lib/aws.js";
import { DigitalOceanProvider } from "../lib/digitalocean.js";
import type { SourceType, ProviderType, EnvironmentType } from "../types/index.js";

// Register providers
registerProvider(new VercelProvider());
registerProvider(new CloudflareProvider());
registerProvider(new RailwayProvider());
registerProvider(new FlyioProvider());
registerProvider(new AwsProvider());
registerProvider(new DigitalOceanProvider());

// Seed blueprints
seedBuiltinBlueprints();

const server = new McpServer({ name: "deployment", version: "0.0.1" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

const TOOL_CATALOG = [
  { name: "create_project", description: "Register a new project for deployment" },
  { name: "list_projects", description: "List all registered projects" },
  { name: "get_project", description: "Get project details by ID or name" },
  { name: "delete_project", description: "Delete a project and all its data" },
  { name: "create_environment", description: "Create a deployment environment (dev/staging/prod)" },
  { name: "list_environments", description: "List environments, optionally filtered by project" },
  { name: "get_environment", description: "Get environment details" },
  { name: "delete_environment", description: "Delete an environment" },
  { name: "add_provider", description: "Add a deployment provider account" },
  { name: "list_providers", description: "List configured providers" },
  { name: "get_provider", description: "Get provider details" },
  { name: "remove_provider", description: "Remove a provider" },
  { name: "deploy", description: "Deploy a project to an environment" },
  { name: "get_deployment_status", description: "Get current deployment status" },
  { name: "list_deployments", description: "List deployment history" },
  { name: "get_deployment_logs", description: "Get deployment logs" },
  { name: "rollback", description: "Rollback to previous deployment" },
  { name: "promote", description: "Promote deployment between environments" },
  { name: "list_resources", description: "List provisioned infrastructure resources" },
  { name: "destroy_resource", description: "Destroy a provisioned resource" },
  { name: "list_blueprints", description: "List infrastructure blueprints" },
  { name: "get_blueprint", description: "Get blueprint details" },
  { name: "apply_blueprint", description: "Apply blueprint to provision infrastructure" },
  { name: "set_secret", description: "Set a deployment secret" },
  { name: "list_secrets", description: "List deployment secrets" },
  { name: "diff_secrets", description: "Compare secrets across two environments" },
  { name: "check_secret_parity", description: "Verify all required secrets exist for an environment" },
  { name: "sync_secrets", description: "Copy secrets from one environment to another" },
  { name: "set_config", description: "Set a non-sensitive config parameter (SSM)" },
  { name: "list_config", description: "List config parameters (SSM) for an environment" },
  { name: "rotate_secret", description: "Rotate an internal secret with new random value" },
  { name: "logs_tail", description: "Tail CloudWatch logs for an ECS service" },
  { name: "ecs_status", description: "Get ECS service health — running tasks, CPU, deployments" },
  { name: "register_agent", description: "Register a deployer agent" },
  { name: "list_agents", description: "List all registered agents" },
  { name: "heartbeat", description: "Update last_seen_at to signal agent is active" },
  { name: "set_focus", description: "Set active project context for this agent session" },
  { name: "detect_project_type", description: "Detect project type from filesystem path" },
  { name: "doctor", description: "System health check — DB, secrets, providers" },
  { name: "overview", description: "All projects/environments/deployments summary" },
  { name: "deploy_dry_run", description: "Preview deploy without executing" },
  { name: "add_hook", description: "Add a deployment hook" },
  { name: "list_hooks", description: "List deployment hooks" },
  { name: "remove_hook", description: "Remove a deployment hook" },
  { name: "test_hook", description: "Test hooks for a given event" },
  { name: "describe_tools", description: "List all available tools" },
  { name: "search_tools", description: "Search tools by keyword" },
];

// ── Meta Tools ──────────────────────────────────────────────────────────────

server.tool("describe_tools", "List all available deployment tools", {}, async () => ok(TOOL_CATALOG));

server.tool("search_tools", "Search tools by keyword", { query: z.string() }, async ({ query }) => {
  const q = query.toLowerCase();
  const results = TOOL_CATALOG.filter((t) => t.name.includes(q) || t.description.toLowerCase().includes(q));
  return ok(results);
});

// ── Project Tools ───────────────────────────────────────────────────────────

server.tool("create_project", "Register a new project", {
  name: z.string().describe("Project name"),
  source_type: z.enum(["git", "docker", "local", "url"]).optional().describe("Source type"),
  source_url: z.string().optional().describe("Source URL"),
  description: z.string().optional().describe("Description"),
}, async (params) => {
  try {
    const p = createProject({
      name: params.name,
      source_type: (params.source_type ?? "git") as SourceType,
      source_url: params.source_url ?? "",
      description: params.description,
    });
    return ok(p);
  } catch (e) { return err(e); }
});

server.tool("list_projects", "List all projects", {
  search: z.string().optional().describe("Search filter"),
}, async (params) => {
  try { return ok(listProjects({ search: params.search })); } catch (e) { return err(e); }
});

server.tool("get_project", "Get project details", {
  id: z.string().describe("Project ID or name"),
}, async (params) => {
  try { return ok(getProject(params.id)); } catch (e) { return err(e); }
});

server.tool("delete_project", "Delete a project", {
  id: z.string().describe("Project ID or name"),
}, async (params) => {
  try { deleteProject(params.id); return ok({ deleted: true }); } catch (e) { return err(e); }
});

// ── Environment Tools ───────────────────────────────────────────────────────

server.tool("create_environment", "Create an environment", {
  project_id: z.string().describe("Project ID"),
  name: z.string().describe("Environment name"),
  type: z.enum(["dev", "staging", "prod"]).optional().describe("Environment type"),
  provider_id: z.string().describe("Provider ID"),
  region: z.string().optional().describe("Region"),
}, async (params) => {
  try {
    return ok(createEnvironment({
      project_id: params.project_id,
      name: params.name,
      type: (params.type ?? "dev") as EnvironmentType,
      provider_id: params.provider_id,
      region: params.region,
    }));
  } catch (e) { return err(e); }
});

server.tool("list_environments", "List environments", {
  project_id: z.string().optional().describe("Filter by project"),
  type: z.enum(["dev", "staging", "prod"]).optional().describe("Filter by type"),
}, async (params) => {
  try { return ok(listEnvironments(params)); } catch (e) { return err(e); }
});

server.tool("get_environment", "Get environment details", {
  id: z.string().describe("Environment ID"),
}, async (params) => {
  try { return ok(getEnvironment(params.id)); } catch (e) { return err(e); }
});

server.tool("delete_environment", "Delete an environment", {
  id: z.string().describe("Environment ID"),
}, async (params) => {
  try { deleteEnvironment(params.id); return ok({ deleted: true }); } catch (e) { return err(e); }
});

// ── Provider Tools ──────────────────────────────────────────────────────────

server.tool("add_provider", "Add a provider account", {
  name: z.string().describe("Provider name"),
  type: z.enum(["vercel", "cloudflare", "railway", "flyio", "aws", "digitalocean"]).describe("Provider type"),
  credentials_key: z.string().optional().describe("Key in @hasna/secrets"),
}, async (params) => {
  try {
    return ok(createDbProvider({
      name: params.name,
      type: params.type as ProviderType,
      credentials_key: params.credentials_key ?? "",
    }));
  } catch (e) { return err(e); }
});

server.tool("list_providers", "List providers", {
  type: z.enum(["vercel", "cloudflare", "railway", "flyio", "aws", "digitalocean"]).optional(),
}, async (params) => {
  try { return ok(listProviders({ type: params.type as ProviderType })); } catch (e) { return err(e); }
});

server.tool("get_provider", "Get provider details", {
  id: z.string().describe("Provider ID"),
}, async (params) => {
  try { return ok(getDbProvider(params.id)); } catch (e) { return err(e); }
});

server.tool("remove_provider", "Remove a provider", {
  id: z.string().describe("Provider ID"),
}, async (params) => {
  try { deleteProvider(params.id); return ok({ deleted: true }); } catch (e) { return err(e); }
});

// ── Deployment Tools ────────────────────────────────────────────────────────

server.tool("deploy", "Deploy a project to an environment", {
  project_id: z.string().describe("Project ID"),
  environment_id: z.string().describe("Environment ID"),
  image: z.string().optional().describe("Docker image"),
  commit_sha: z.string().optional().describe("Commit SHA"),
  version: z.string().optional().describe("Version label"),
}, async (params) => {
  try {
    const result = await deploy({
      projectId: params.project_id,
      environmentId: params.environment_id,
      image: params.image,
      commitSha: params.commit_sha,
      version: params.version,
    });
    return ok(result);
  } catch (e) { return err(e); }
});

server.tool("get_deployment_status", "Get deployment status", {
  project_id: z.string().describe("Project ID"),
  environment_id: z.string().describe("Environment ID"),
}, async (params) => {
  try { return ok(await getStatus(params.project_id, params.environment_id)); } catch (e) { return err(e); }
});

server.tool("list_deployments", "List deployment history", {
  project_id: z.string().optional(),
  environment_id: z.string().optional(),
  status: z.string().optional(),
  limit: z.number().optional(),
}, async (params) => {
  try { return ok(listDeployments(params as any)); } catch (e) { return err(e); }
});

server.tool("get_deployment_logs", "Get deployment logs", {
  project_id: z.string().describe("Project ID"),
  environment_id: z.string().describe("Environment ID"),
  deployment_id: z.string().optional().describe("Specific deployment ID"),
}, async (params) => {
  try { return ok({ logs: await getLogs(params.project_id, params.environment_id, params.deployment_id) }); } catch (e) { return err(e); }
});

server.tool("rollback", "Rollback to previous deployment", {
  project_id: z.string(),
  environment_id: z.string(),
  target_deployment_id: z.string().optional(),
}, async (params) => {
  try { return ok(await rollback(params.project_id, params.environment_id, params.target_deployment_id)); } catch (e) { return err(e); }
});

server.tool("promote", "Promote deployment between environments", {
  project_id: z.string(),
  from_environment_id: z.string(),
  to_environment_id: z.string(),
}, async (params) => {
  try {
    return ok(await promote({
      projectId: params.project_id,
      fromEnvironmentId: params.from_environment_id,
      toEnvironmentId: params.to_environment_id,
    }));
  } catch (e) { return err(e); }
});

// ── Resource Tools ──────────────────────────────────────────────────────────

server.tool("list_resources", "List provisioned resources", {
  environment_id: z.string().optional(),
  type: z.string().optional(),
}, async (params) => {
  try { return ok(listResources(params as any)); } catch (e) { return err(e); }
});

server.tool("destroy_resource", "Destroy a resource", {
  id: z.string(),
}, async (params) => {
  try { deleteResource(params.id); return ok({ deleted: true }); } catch (e) { return err(e); }
});

// ── Blueprint Tools ─────────────────────────────────────────────────────────

server.tool("list_blueprints", "List infrastructure blueprints", {
  provider_type: z.string().optional(),
}, async (params) => {
  try { return ok(listBlueprints(params as any)); } catch (e) { return err(e); }
});

server.tool("get_blueprint", "Get blueprint details", {
  id: z.string(),
}, async (params) => {
  try { return ok(getBlueprint(params.id)); } catch (e) { return err(e); }
});

server.tool("apply_blueprint", "Apply blueprint to provision infrastructure", {
  blueprint_id: z.string(),
  environment_id: z.string(),
}, async (params) => {
  try { return ok(await applyBlueprint(params.blueprint_id, params.environment_id)); } catch (e) { return err(e); }
});

// ── Secret Tools ────────────────────────────────────────────────────────────

server.tool("set_secret", "Set a deployment secret", {
  project: z.string(),
  environment: z.string(),
  key: z.string(),
  value: z.string(),
}, async (params) => {
  try {
    await initSecrets();
    setDeploymentSecret(params.project, params.environment, params.key, params.value);
    return ok({ set: true, key: `deployment/${params.project}/${params.environment}/${params.key}` });
  } catch (e) { return err(e); }
});

server.tool("list_secrets", "List deployment secrets", {
  project: z.string(),
  environment: z.string().optional(),
}, async (params) => {
  try {
    await initSecrets();
    return ok(listDeploymentSecrets(params.project, params.environment));
  } catch (e) { return err(e); }
});

server.tool("diff_secrets", "Compare secrets across two environments", {
  project: z.string(),
  env1: z.string().describe("First environment name"),
  env2: z.string().describe("Second environment name"),
}, async (params) => {
  try {
    return ok(diffSecrets(params.project, params.env1, params.env2));
  } catch (e) { return err(e); }
});

server.tool("sync_secrets", "Copy secrets from one environment to another", {
  project: z.string(),
  from_env: z.string(),
  to_env: z.string(),
  include: z.array(z.string()).optional().describe("Only sync these keys"),
  exclude: z.array(z.string()).optional().describe("Skip these keys"),
  dry_run: z.boolean().optional().describe("Preview without making changes"),
}, async (params) => {
  try {
    return ok(syncSecrets(params.project, params.from_env, params.to_env, {
      include: params.include,
      exclude: params.exclude,
      dryRun: params.dry_run,
    }));
  } catch (e) { return err(e); }
});

server.tool("set_config", "Set a non-sensitive config parameter (SSM)", {
  project: z.string(),
  environment: z.string(),
  key: z.string(),
  value: z.string(),
}, async (params) => {
  try {
    const record = setConfigParam(params.project, params.environment, params.key, params.value);
    return ok({ set: true, key: record.key, environment: record.environment });
  } catch (e) { return err(e); }
});

server.tool("list_config", "List config parameters (SSM) for an environment", {
  project: z.string(),
  environment: z.string().optional(),
}, async (params) => {
  try {
    return ok(listConfigParams(params.project, params.environment));
  } catch (e) { return err(e); }
});

server.tool("check_secret_parity", "Verify all required secrets exist for an environment", {
  project: z.string(),
  environment: z.string(),
  required_keys: z.array(z.string()).optional().describe("Specific keys to check. If omitted, checks all registered secrets are non-empty."),
}, async (params) => {
  try {
    return ok(checkSecretParity(params.project, params.environment, params.required_keys));
  } catch (e) { return err(e); }
});

server.tool("rotate_secret", "Rotate an internal secret with new random value", {
  project: z.string(),
  environment: z.string(),
  key: z.string(),
  length: z.number().optional().describe("Length of new random value (default: 64)"),
}, async (params) => {
  try {
    return ok(rotateSecret(params.project, params.environment, params.key, params.length));
  } catch (e) { return err(e); }
});

server.tool("logs_tail", "Tail CloudWatch logs for an ECS service", {
  log_group: z.string().describe("CloudWatch log group name (e.g. /ecs/alumia-dev-web)"),
  filter: z.string().optional().describe("CloudWatch filter pattern"),
  limit: z.number().optional().describe("Max events to return (default: 50)"),
  minutes_ago: z.number().optional().describe("Only show logs from last N minutes"),
}, async (params) => {
  try {
    const { AwsProvider } = await import("../lib/aws.js");
    const { resolveCredentials } = await import("../lib/aws-auth.js");
    const provider = new AwsProvider();
    const creds = await resolveCredentials();
    await provider.connect({
      access_key_id: creds.accessKeyId,
      secret_access_key: creds.secretAccessKey,
      session_token: creds.sessionToken,
      region: creds.region,
    });
    const startTime = params.minutes_ago
      ? Date.now() - params.minutes_ago * 60 * 1000
      : undefined;
    const logs = await provider.tailLogs(params.log_group, {
      filterPattern: params.filter,
      limit: params.limit,
      startTime,
    });
    return ok(logs);
  } catch (e) { return err(e); }
});

server.tool("ecs_status", "Get ECS service health — running tasks, CPU, deployments", {
  cluster: z.string().describe("ECS cluster name or ARN"),
  services: z.array(z.string()).describe("Service names to check"),
  region: z.string().optional().describe("AWS region (default: from credentials)"),
}, async (params) => {
  try {
    const { AwsProvider } = await import("../lib/aws.js");
    const { resolveCredentials } = await import("../lib/aws-auth.js");
    const provider = new AwsProvider();
    const creds = await resolveCredentials(params.region ? { region: params.region } : undefined);
    await provider.connect({
      access_key_id: creds.accessKeyId,
      secret_access_key: creds.secretAccessKey,
      session_token: creds.sessionToken,
      region: creds.region,
    });
    const status = await provider.describeEcsServices(params.cluster, params.services);
    return ok(status);
  } catch (e) { return err(e); }
});

// ── Agent Tools ─────────────────────────────────────────────────────────────

server.tool("register_agent", "Register a deployer agent", {
  name: z.string(),
  type: z.enum(["human", "agent"]).optional(),
}, async (params) => {
  try { return ok(registerAgent({ name: params.name, type: params.type })); } catch (e) { return err(e); }
});

server.tool("list_agents", "List all registered agents", {}, async () => {
  try { return ok(listAgents()); } catch (e) { return err(e); }
});

server.tool("heartbeat", "Update last_seen_at to signal agent is active", {
  agent_id: z.string(),
}, async (params) => {
  try { return ok(dbHeartbeat(params.agent_id)); } catch (e) { return err(e); }
});

server.tool("set_focus", "Set active project context for this agent session", {
  agent_id: z.string(),
  project_id: z.string().optional(),
}, async (params) => {
  try { return ok(dbSetFocus(params.agent_id, params.project_id ?? null)); } catch (e) { return err(e); }
});

// ── Detection Tools ──────────────────────────────────────────────────────

server.tool("detect_project_type", "Detect project type from filesystem path", {
  path: z.string().describe("Filesystem path to scan"),
}, async (params) => {
  try { return ok(detectProjectType(params.path)); } catch (e) { return err(e); }
});

// ── Doctor Tool ──────────────────────────────────────────────────────────

server.tool("doctor", "System health check", {}, async () => {
  const checks: Record<string, string> = {};
  try { listProjects(); checks["database"] = "ok"; } catch { checks["database"] = "error"; }
  try {
    const available = await initSecrets();
    checks["secrets"] = available ? "ok" : "not_installed";
  } catch { checks["secrets"] = "not_installed"; }

  const provs = listProviders();
  for (const p of provs) {
    try {
      const prov = getRegisteredProvider(p.type);
      await prov.connect({});
      checks[`provider_${p.name}`] = "ok";
    } catch {
      checks[`provider_${p.name}`] = "error";
    }
  }
  return ok(checks);
});

// ── Overview Tool ────────────────────────────────────────────────────────

server.tool("overview", "All projects/environments/deployments summary", {}, async () => {
  try {
    const projects = listProjects();
    const result: Array<{
      project: string;
      environment: string;
      provider: string;
      status: string;
      url: string;
      last_deploy: string;
      secrets_count: number;
      config_count: number;
      secret_parity: { passed: boolean; missing: number; empty: number } | null;
    }> = [];

    for (const p of projects) {
      const envs = listEnvironments({ project_id: p.id });
      for (const env of envs) {
        let providerType = "";
        try { providerType = getDbProvider(env.provider_id).type; } catch { providerType = "unknown"; }
        const latest = getLatestDeployment(env.id);

        // Secret and config counts
        const secrets = listDeploymentSecrets(p.name, env.name);
        const configs = listConfigParams(p.name, env.name);
        const parity = checkSecretParity(p.name, env.name);

        result.push({
          project: p.name,
          environment: env.name,
          provider: providerType,
          status: latest?.status ?? "none",
          url: latest?.url ?? "",
          last_deploy: latest ? timeAgo(latest.created_at) : "never",
          secrets_count: secrets.length,
          config_count: configs.length,
          secret_parity: {
            passed: parity.passed,
            missing: parity.missing.length,
            empty: parity.empty.length,
          },
        });
      }
    }

    return ok(result);
  } catch (e) { return err(e); }
});

// ── Dry-Run Deploy Tool ──────────────────────────────────────────────────

server.tool("deploy_dry_run", "Preview deploy without executing", {
  project_id: z.string().describe("Project ID"),
  environment_id: z.string().describe("Environment ID"),
  image: z.string().optional(),
  commit_sha: z.string().optional(),
  version: z.string().optional(),
}, async (params) => {
  try {
    return ok(previewDeploy({
      projectId: params.project_id,
      environmentId: params.environment_id,
      image: params.image,
      commitSha: params.commit_sha,
      version: params.version,
    }));
  } catch (e) { return err(e); }
});

// ── Hook Tools ───────────────────────────────────────────────────────────

server.tool("add_hook", "Add a deployment hook", {
  event: z.enum(["pre-deploy", "post-deploy", "deploy-failed", "pre-rollback", "post-rollback", "pre-promote", "post-promote"]).describe("Hook event"),
  command: z.string().describe("Command to run"),
  project_id: z.string().optional().describe("Scope to project"),
  environment_id: z.string().optional().describe("Scope to environment"),
}, async (params) => {
  try { return ok(addHook(params.event, params.command, params.project_id, params.environment_id)); } catch (e) { return err(e); }
});

server.tool("list_hooks", "List deployment hooks", {
  event: z.enum(["pre-deploy", "post-deploy", "deploy-failed", "pre-rollback", "post-rollback", "pre-promote", "post-promote"]).optional(),
  project_id: z.string().optional(),
}, async (params) => {
  try {
    ensureHooksTable();
    return ok(listHooks(params.event, params.project_id));
  } catch (e) { return err(e); }
});

server.tool("remove_hook", "Remove a deployment hook", {
  id: z.string().describe("Hook ID"),
}, async (params) => {
  try { removeHook(params.id); return ok({ deleted: true }); } catch (e) { return err(e); }
});

server.tool("test_hook", "Test hooks for a given event", {
  event: z.enum(["pre-deploy", "post-deploy", "deploy-failed", "pre-rollback", "post-rollback", "pre-promote", "post-promote"]).describe("Hook event to test"),
}, async (params) => {
  try {
    ensureHooksTable();
    const results = await runHooks(params.event, {
      project_id: "test",
      project_name: "test-project",
      environment_id: "test",
      environment_name: "test-env",
      environment_type: "dev",
      provider_type: "railway",
    });
    return ok(results);
  } catch (e) { return err(e); }
});

// ── Feedback ────────────────────────────────────────────────────────────────

server.tool("send_feedback", "Send feedback about this service", {
  message: z.string().describe("Feedback message"),
  email: z.string().optional().describe("Contact email (optional)"),
  category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
}, async (params) => {
  try {
    const { getDatabase } = await import("../db/database.js");
    const db = getDatabase();
    const pkg = require("../../package.json");
    db.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [params.message, params.email || null, params.category || "general", pkg.version]
    );
    return ok({ message: "Feedback saved. Thank you!" });
  } catch (e) { return err(e); }
});

// ── Start Server ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
