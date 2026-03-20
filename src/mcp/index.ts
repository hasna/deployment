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
import { registerAgent, listAgents } from "../db/agents.js";
import { deploy, rollback, promote, getStatus, getLogs } from "../lib/deployer.js";
import { applyBlueprint, seedBuiltinBlueprints } from "../lib/blueprints.js";
import { setDeploymentSecret, listDeploymentSecrets, initSecrets } from "../lib/secrets-integration.js";
import { registerProvider } from "../lib/provider.js";
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
  { name: "register_agent", description: "Register a deployer agent" },
  { name: "list_agents", description: "List registered agents" },
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

// ── Agent Tools ─────────────────────────────────────────────────────────────

server.tool("register_agent", "Register a deployer agent", {
  name: z.string(),
  type: z.enum(["human", "agent"]).optional(),
}, async (params) => {
  try { return ok(registerAgent({ name: params.name, type: params.type })); } catch (e) { return err(e); }
});

server.tool("list_agents", "List registered agents", {}, async () => {
  try { return ok(listAgents()); } catch (e) { return err(e); }
});

// ── Start Server ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
