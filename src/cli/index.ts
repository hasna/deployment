#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js";
import { createEnvironment, getEnvironment, listEnvironments, deleteEnvironment } from "../db/environments.js";
import { createProvider, getProvider as getDbProvider, listProviders, deleteProvider } from "../db/providers.js";
import { listDeployments, getDeployment } from "../db/deployments.js";
import { listResources, deleteResource } from "../db/resources.js";
import { listBlueprints, getBlueprint } from "../db/blueprints.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { deploy, rollback, promote, getStatus, getLogs, previewDeploy } from "../lib/deployer.js";
import { applyBlueprint, seedBuiltinBlueprints } from "../lib/blueprints.js";
import { setDeploymentSecret, listDeploymentSecrets, initSecrets } from "../lib/secrets-integration.js";
import { registerProvider, getProvider as getRegisteredProvider } from "../lib/provider.js";
import { detectProjectType } from "../lib/detect.js";
import { timeAgo } from "../lib/format.js";
import { addHook, listHooks, removeHook, runHooks, ensureHooksTable } from "../lib/hooks.js";
import type { DeploymentHookEvent } from "../lib/hooks.js";
import { getLatestDeployment } from "../db/deployments.js";
import { VercelProvider } from "../lib/vercel.js";
import { CloudflareProvider } from "../lib/cloudflare.js";
import { RailwayProvider } from "../lib/railway.js";
import { FlyioProvider } from "../lib/flyio.js";
import { AwsProvider } from "../lib/aws.js";
import { DigitalOceanProvider } from "../lib/digitalocean.js";
import type { SourceType, ProviderType, EnvironmentType } from "../types/index.js";

// Register all providers
registerProvider(new VercelProvider());
registerProvider(new CloudflareProvider());
registerProvider(new RailwayProvider());
registerProvider(new FlyioProvider());
registerProvider(new AwsProvider());
registerProvider(new DigitalOceanProvider());

function shortId(id: string): string {
  return id.slice(0, 8);
}

function statusColor(status: string): string {
  switch (status) {
    case "live":
    case "active":
    case "completed":
      return chalk.green(status);
    case "deploying":
    case "building":
    case "in_progress":
    case "provisioning":
      return chalk.yellow(status);
    case "failed":
    case "destroyed":
      return chalk.red(status);
    case "rolled_back":
    case "cancelled":
      return chalk.dim(status);
    default:
      return chalk.cyan(status);
  }
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red.bold("Error: ") + message);
  process.exit(1);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

const program = new Command()
  .name("deployment")
  .description("General-purpose deployment orchestration for AI agents")
  .version("0.0.1");

// ── Project Commands ────────────────────────────────────────────────────────

const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("create <name>")
  .description("Register a new project")
  .option("-s, --source <url>", "Source URL (git repo, docker image, local path)")
  .option("-t, --type <type>", "Source type: git|docker|local|url", "git")
  .option("-d, --description <desc>", "Project description")
  .action((name: string, opts: { source?: string; type?: string; description?: string }) => {
    try {
      const project = createProject({
        name,
        source_type: (opts.type ?? "git") as SourceType,
        source_url: opts.source ?? "",
        description: opts.description,
      });
      console.log(chalk.green("✓ Project created: ") + chalk.bold(project.name) + chalk.dim(` (${shortId(project.id)})`));
    } catch (e) { handleError(e); }
  });

projectCmd
  .command("list")
  .alias("ls")
  .description("List all projects")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((opts: { format: string }) => {
    const projects = listProjects();
    if (opts.format === "json") return printJson(projects);
    if (projects.length === 0) return console.log(chalk.dim("No projects"));
    console.log(chalk.bold("Projects:"));
    for (const p of projects) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(p.name)} ${chalk.dim(p.source_type + ":" + p.source_url)} ${chalk.dim(timeAgo(p.created_at))}`);
    }
  });

projectCmd
  .command("show <id>")
  .description("Show project details")
  .action((id: string) => {
    try {
      const p = getProject(id);
      console.log(chalk.bold("Project: ") + p.name);
      console.log(chalk.cyan("  ID:     ") + p.id);
      console.log(chalk.cyan("  Source: ") + `${p.source_type}:${p.source_url}`);
      console.log(chalk.cyan("  Desc:   ") + (p.description || chalk.dim("none")));
      console.log(chalk.cyan("  Created:") + p.created_at);
    } catch (e) { handleError(e); }
  });

projectCmd
  .command("delete <id>")
  .description("Delete a project and all its environments/deployments")
  .action((id: string) => {
    try {
      const p = getProject(id);
      deleteProject(id);
      console.log(chalk.red("✓ Deleted project: ") + p.name);
    } catch (e) { handleError(e); }
  });

// ── Environment Commands ────────────────────────────────────────────────────

const envCmd = program.command("env").description("Manage environments");

envCmd
  .command("create <project> <name>")
  .description("Create an environment for a project")
  .option("-t, --type <type>", "Environment type: dev|staging|prod", "dev")
  .option("-p, --provider <id>", "Provider ID")
  .option("-r, --region <region>", "Region")
  .action((projectName: string, name: string, opts: { type?: string; provider?: string; region?: string }) => {
    try {
      const project = getProject(projectName);
      if (!opts.provider) return handleError(new Error("--provider is required"));
      const env = createEnvironment({
        project_id: project.id,
        name,
        type: (opts.type ?? "dev") as EnvironmentType,
        provider_id: opts.provider,
        region: opts.region,
      });
      console.log(chalk.green("✓ Environment created: ") + chalk.bold(env.name) + chalk.dim(` (${env.type})`));
    } catch (e) { handleError(e); }
  });

envCmd
  .command("list [project]")
  .alias("ls")
  .description("List environments")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((projectName: string | undefined, opts: { format: string }) => {
    try {
      let projectId: string | undefined;
      if (projectName) projectId = getProject(projectName).id;
      const envs = listEnvironments({ project_id: projectId });
      if (opts.format === "json") return printJson(envs);
      if (envs.length === 0) return console.log(chalk.dim("No environments"));
      console.log(chalk.bold("Environments:"));
      for (const e of envs) {
        console.log(`  ${chalk.cyan(shortId(e.id))} ${chalk.bold(e.name)} ${statusColor(e.type)} ${chalk.dim(e.region || "")} ${chalk.dim(timeAgo(e.created_at))}`);
      }
    } catch (e) { handleError(e); }
  });

envCmd
  .command("show <id>")
  .description("Show environment details")
  .action((id: string) => {
    try {
      const e = getEnvironment(id);
      console.log(chalk.bold("Environment: ") + e.name);
      console.log(chalk.cyan("  ID:       ") + e.id);
      console.log(chalk.cyan("  Type:     ") + e.type);
      console.log(chalk.cyan("  Provider: ") + e.provider_id);
      console.log(chalk.cyan("  Region:   ") + (e.region || chalk.dim("default")));
      console.log(chalk.cyan("  Config:   ") + JSON.stringify(e.config));
    } catch (e) { handleError(e); }
  });

envCmd
  .command("delete <id>")
  .description("Delete an environment")
  .action((id: string) => {
    try {
      const e = getEnvironment(id);
      deleteEnvironment(id);
      console.log(chalk.red("✓ Deleted environment: ") + e.name);
    } catch (e) { handleError(e); }
  });

// ── Provider Commands ───────────────────────────────────────────────────────

const providerCmd = program.command("provider").description("Manage deployment providers");

providerCmd
  .command("add <name>")
  .description("Add a provider account")
  .requiredOption("-t, --type <type>", "Provider type: vercel|cloudflare|railway|flyio|aws|digitalocean")
  .option("-c, --credentials-key <key>", "Key in @hasna/secrets for credentials")
  .action((name: string, opts: { type: string; credentialsKey?: string }) => {
    try {
      const provider = createProvider({
        name,
        type: opts.type as ProviderType,
        credentials_key: opts.credentialsKey ?? "",
      });
      console.log(chalk.green("✓ Provider added: ") + chalk.bold(provider.name) + chalk.dim(` (${provider.type})`));
    } catch (e) { handleError(e); }
  });

providerCmd
  .command("list")
  .alias("ls")
  .description("List providers")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((opts: { format: string }) => {
    const providers = listProviders();
    if (opts.format === "json") return printJson(providers);
    if (providers.length === 0) return console.log(chalk.dim("No providers"));
    console.log(chalk.bold("Providers:"));
    for (const p of providers) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(p.name)} ${chalk.magenta(p.type)} ${chalk.dim(timeAgo(p.created_at))}`);
    }
  });

providerCmd
  .command("show <id>")
  .description("Show provider details")
  .action((id: string) => {
    try {
      const p = getDbProvider(id);
      console.log(chalk.bold("Provider: ") + p.name);
      console.log(chalk.cyan("  ID:          ") + p.id);
      console.log(chalk.cyan("  Type:        ") + p.type);
      console.log(chalk.cyan("  Credentials: ") + (p.credentials_key || chalk.dim("none")));
    } catch (e) { handleError(e); }
  });

providerCmd
  .command("remove <id>")
  .description("Remove a provider")
  .action((id: string) => {
    try {
      const p = getDbProvider(id);
      deleteProvider(id);
      console.log(chalk.red("✓ Removed provider: ") + p.name);
    } catch (e) { handleError(e); }
  });

providerCmd
  .command("test <id>")
  .description("Test provider connectivity")
  .action(async (id: string) => {
    try {
      const p = getDbProvider(id);
      const provider = getRegisteredProvider(p.type);
      console.log(chalk.yellow("⟳ Testing ") + chalk.bold(p.name) + ` (${p.type})...`);
      await provider.connect({});
      console.log(chalk.green("✓ Connected successfully: ") + p.name);
    } catch (e) {
      console.log(chalk.red("✗ Connection failed: ") + (e instanceof Error ? e.message : String(e)));
    }
  });

// ── Deploy Command ──────────────────────────────────────────────────────────

program
  .command("deploy <project> <environment>")
  .description("Deploy a project to an environment")
  .option("-i, --image <image>", "Docker image to deploy")
  .option("-c, --commit <sha>", "Commit SHA")
  .option("-v, --version <version>", "Version label")
  .option("--dry-run", "Preview what would happen without executing")
  .option("--health-check <url>", "URL to check after deploy succeeds")
  .option("--auto-rollback", "Automatically rollback if health check fails")
  .action(async (projectName: string, envName: string, opts: { image?: string; commit?: string; version?: string; dryRun?: boolean; healthCheck?: string; autoRollback?: boolean }) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found for project "${projectName}"`));

      const input = {
        projectId: project.id,
        environmentId: env.id,
        image: opts.image,
        commitSha: opts.commit,
        version: opts.version,
      };

      if (opts.dryRun) {
        const preview = previewDeploy(input);
        console.log(chalk.bold("Dry-run preview:"));
        console.log(chalk.cyan("  Project:     ") + preview.project);
        console.log(chalk.cyan("  Environment: ") + preview.environment);
        console.log(chalk.cyan("  Provider:    ") + preview.provider);
        console.log(chalk.cyan("  Image:       ") + (preview.image || chalk.dim("none")));
        console.log(chalk.cyan("  Commit:      ") + (preview.commitSha || chalk.dim("none")));
        console.log(chalk.cyan("  Version:     ") + (preview.version || chalk.dim("none")));
        console.log(chalk.dim("  No changes were made."));
        return;
      }

      console.log(chalk.yellow("⟳ Deploying ") + chalk.bold(project.name) + " → " + chalk.bold(env.name) + "...");

      const result = await deploy(input);

      console.log(chalk.green("✓ Deployed: ") + (result.url || chalk.dim("no URL")));
      console.log(chalk.cyan("  Status: ") + statusColor(result.status));

      // Health check after successful deploy
      if (opts.healthCheck && result.status === "live") {
        console.log(chalk.yellow("⟳ Running health check: ") + opts.healthCheck);
        try {
          const resp = await fetch(opts.healthCheck);
          if (resp.ok) {
            console.log(chalk.green("✓ Health check passed: ") + resp.status);
          } else {
            console.log(chalk.red("✗ Health check failed: ") + resp.status);
            if (opts.autoRollback) {
              console.log(chalk.yellow("⟳ Auto-rollback triggered..."));
              const rb = await rollback(project.id, env.id);
              console.log(chalk.green("✓ Rolled back: ") + statusColor(rb.status));
            }
          }
        } catch (healthErr) {
          console.log(chalk.red("✗ Health check error: ") + (healthErr instanceof Error ? healthErr.message : String(healthErr)));
          if (opts.autoRollback) {
            console.log(chalk.yellow("⟳ Auto-rollback triggered..."));
            const rb = await rollback(project.id, env.id);
            console.log(chalk.green("✓ Rolled back: ") + statusColor(rb.status));
          }
        }
      }
    } catch (e) { handleError(e); }
  });

// ── Status Command ──────────────────────────────────────────────────────────

program
  .command("status <project> <environment>")
  .description("Show deployment status")
  .action(async (projectName: string, envName: string) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found`));

      const { deployment, providerStatus } = await getStatus(project.id, env.id);
      if (!deployment) return console.log(chalk.dim("No deployments"));

      console.log(chalk.bold("Deployment Status:"));
      console.log(chalk.cyan("  ID:       ") + shortId(deployment.id));
      console.log(chalk.cyan("  Status:   ") + statusColor(deployment.status));
      console.log(chalk.cyan("  URL:      ") + (deployment.url || chalk.dim("none")));
      console.log(chalk.cyan("  Version:  ") + (deployment.version || chalk.dim("none")));
      if (providerStatus) {
        console.log(chalk.cyan("  Provider: ") + statusColor(providerStatus));
      }
    } catch (e) { handleError(e); }
  });

// ── Logs Command ────────────────────────────────────────────────────────────

program
  .command("logs <project> <environment>")
  .description("Get deployment logs")
  .action(async (projectName: string, envName: string) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found`));

      const logs = await getLogs(project.id, env.id);
      console.log(logs || chalk.dim("No logs available"));
    } catch (e) { handleError(e); }
  });

// ── Rollback Command ────────────────────────────────────────────────────────

program
  .command("rollback <project> <environment>")
  .description("Rollback to previous deployment")
  .option("--to <deployment-id>", "Specific deployment to rollback to")
  .action(async (projectName: string, envName: string, opts: { to?: string }) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found`));

      console.log(chalk.yellow("⟳ Rolling back ") + chalk.bold(project.name) + " " + chalk.bold(env.name) + "...");
      const result = await rollback(project.id, env.id, opts.to);
      console.log(chalk.green("✓ Rolled back: ") + statusColor(result.status));
    } catch (e) { handleError(e); }
  });

// ── Promote Command ─────────────────────────────────────────────────────────

program
  .command("promote <project> <from-env> <to-env>")
  .description("Promote a deployment from one environment to another")
  .action(async (projectName: string, fromEnv: string, toEnv: string) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const from = envs.find((e) => e.name === fromEnv);
      const to = envs.find((e) => e.name === toEnv);
      if (!from) return handleError(new Error(`Source environment "${fromEnv}" not found`));
      if (!to) return handleError(new Error(`Target environment "${toEnv}" not found`));

      console.log(chalk.yellow("⟳ Promoting ") + chalk.bold(fromEnv) + " → " + chalk.bold(toEnv) + "...");
      const result = await promote({ projectId: project.id, fromEnvironmentId: from.id, toEnvironmentId: to.id });
      console.log(chalk.green("✓ Promoted: ") + statusColor(result.status));
    } catch (e) { handleError(e); }
  });

// ── Resource Commands ───────────────────────────────────────────────────────

const resourceCmd = program.command("resource").description("Manage provisioned infrastructure");

resourceCmd
  .command("list [environment]")
  .alias("ls")
  .description("List resources")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((envId: string | undefined, opts: { format: string }) => {
    const resources = listResources({ environment_id: envId });
    if (opts.format === "json") return printJson(resources);
    if (resources.length === 0) return console.log(chalk.dim("No resources"));
    console.log(chalk.bold("Resources:"));
    for (const r of resources) {
      console.log(`  ${chalk.cyan(shortId(r.id))} ${chalk.bold(r.name)} ${chalk.magenta(r.type)} ${statusColor(r.status)}`);
    }
  });

resourceCmd
  .command("destroy <id>")
  .description("Destroy a resource")
  .action((id: string) => {
    try {
      deleteResource(id);
      console.log(chalk.red("✓ Resource destroyed"));
    } catch (e) { handleError(e); }
  });

// ── Blueprint Commands ──────────────────────────────────────────────────────

const blueprintCmd = program.command("blueprint").description("Manage infrastructure blueprints");

blueprintCmd
  .command("list")
  .alias("ls")
  .description("List available blueprints")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((opts: { format: string }) => {
    seedBuiltinBlueprints();
    const blueprints = listBlueprints();
    if (opts.format === "json") return printJson(blueprints);
    if (blueprints.length === 0) return console.log(chalk.dim("No blueprints"));
    console.log(chalk.bold("Blueprints:"));
    for (const b of blueprints) {
      console.log(`  ${chalk.cyan(shortId(b.id))} ${chalk.bold(b.name)} ${chalk.magenta(b.provider_type)} ${chalk.dim(b.description)}`);
    }
  });

blueprintCmd
  .command("show <id>")
  .description("Show blueprint details")
  .action((id: string) => {
    try {
      const b = getBlueprint(id);
      console.log(chalk.bold("Blueprint: ") + b.name);
      console.log(chalk.cyan("  Provider: ") + b.provider_type);
      console.log(chalk.cyan("  Desc:     ") + b.description);
      console.log(chalk.cyan("  Template: ") + JSON.stringify(b.template, null, 2));
    } catch (e) { handleError(e); }
  });

blueprintCmd
  .command("apply <blueprint> <environment>")
  .description("Apply a blueprint to provision infrastructure")
  .action(async (blueprintId: string, envId: string) => {
    try {
      console.log(chalk.yellow("⟳ Applying blueprint..."));
      const result = await applyBlueprint(blueprintId, envId);
      console.log(chalk.green("✓ Applied: ") + result.blueprint.name);
      console.log(chalk.cyan("  Resources: ") + result.resources.length);
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(chalk.red("  Error: ") + err);
        }
      }
    } catch (e) { handleError(e); }
  });

// ── Agent Commands ──────────────────────────────────────────────────────────

const agentCmd = program.command("agent").description("Manage deployer agents");

agentCmd
  .command("register <name>")
  .description("Register an agent")
  .option("-t, --type <type>", "Agent type: human|agent", "agent")
  .action((name: string, opts: { type: string }) => {
    try {
      const agent = registerAgent({ name, type: opts.type as "human" | "agent" });
      console.log(chalk.green("✓ Agent registered: ") + chalk.bold(agent.name));
    } catch (e) { handleError(e); }
  });

agentCmd
  .command("list")
  .alias("ls")
  .description("List agents")
  .action(() => {
    const agents = listAgents();
    if (agents.length === 0) return console.log(chalk.dim("No agents"));
    console.log(chalk.bold("Agents:"));
    for (const a of agents) {
      console.log(`  ${chalk.cyan(shortId(a.id))} ${chalk.bold(a.name)} ${chalk.dim(a.type)} ${chalk.dim(timeAgo(a.last_seen))}`);
    }
  });

// ── Secret Commands ─────────────────────────────────────────────────────────

const secretCmd = program.command("secret").description("Manage deployment secrets (via @hasna/secrets)");

secretCmd
  .command("set <project> <env> <key> <value>")
  .description("Set a deployment secret")
  .action(async (project: string, env: string, key: string, value: string) => {
    try {
      await initSecrets();
      setDeploymentSecret(project, env, key, value);
      console.log(chalk.green("✓ Secret set: ") + `deployment/${project}/${env}/${key}`);
    } catch (e) { handleError(e); }
  });

secretCmd
  .command("list <project> [env]")
  .alias("ls")
  .description("List deployment secrets")
  .action(async (project: string, env?: string) => {
    try {
      await initSecrets();
      const secrets = listDeploymentSecrets(project, env);
      if (secrets.length === 0) return console.log(chalk.dim("No secrets"));
      console.log(chalk.bold("Secrets:"));
      for (const s of secrets) {
        console.log(`  ${chalk.cyan(s.key)} ${chalk.dim("***")}`);
      }
    } catch (e) { handleError(e); }
  });

// ── Deployment History ──────────────────────────────────────────────────────

const historyCmd = program.command("history").description("Deployment history");

historyCmd
  .command("list [project]")
  .alias("ls")
  .description("List deployments")
  .option("-e, --env <env>", "Filter by environment ID")
  .option("-s, --status <status>", "Filter by status")
  .option("-n, --limit <n>", "Limit results", "20")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((projectName: string | undefined, opts: { env?: string; status?: string; limit: string; format: string }) => {
    try {
      let projectId: string | undefined;
      if (projectName) projectId = getProject(projectName).id;

      const deployments = listDeployments({
        project_id: projectId,
        environment_id: opts.env,
        status: opts.status as any,
        limit: parseInt(opts.limit, 10),
      });

      if (opts.format === "json") return printJson(deployments);
      if (deployments.length === 0) return console.log(chalk.dim("No deployments"));

      console.log(chalk.bold("Deployments:"));
      for (const d of deployments) {
        console.log(
          `  ${chalk.cyan(shortId(d.id))} ${statusColor(d.status)} ${chalk.dim(d.version || "no version")} ${chalk.dim(d.url || "")} ${chalk.dim(timeAgo(d.created_at))}`
        );
      }
    } catch (e) { handleError(e); }
  });

historyCmd
  .command("show <id>")
  .description("Show deployment details")
  .action((id: string) => {
    try {
      const d = getDeployment(id);
      console.log(chalk.bold("Deployment: ") + shortId(d.id));
      console.log(chalk.cyan("  Status:    ") + statusColor(d.status));
      console.log(chalk.cyan("  URL:       ") + (d.url || chalk.dim("none")));
      console.log(chalk.cyan("  Version:   ") + (d.version || chalk.dim("none")));
      console.log(chalk.cyan("  Image:     ") + (d.image || chalk.dim("none")));
      console.log(chalk.cyan("  Commit:    ") + (d.commit_sha || chalk.dim("none")));
      console.log(chalk.cyan("  Started:   ") + (d.started_at || chalk.dim("none")));
      console.log(chalk.cyan("  Completed: ") + (d.completed_at || chalk.dim("none")));
      if (d.logs) console.log(chalk.cyan("  Logs:\n") + d.logs);
    } catch (e) { handleError(e); }
  });

// ── MCP Install Command ────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Install MCP server into Claude Code")
  .option("--target <target>", "Target: claude|codex|gemini", "claude")
  .action(async (opts: { target: string }) => {
    if (opts.target === "claude") {
      const { execSync } = await import("node:child_process");
      try {
        execSync("claude mcp add --transport stdio --scope user deployment -- deployment-mcp", { stdio: "inherit" });
        console.log(chalk.green("✓ MCP server installed into Claude Code"));
      } catch {
        console.log(chalk.yellow("Install manually: claude mcp add --transport stdio --scope user deployment -- deployment-mcp"));
      }
    } else {
      console.log(chalk.dim(`MCP install for ${opts.target} not yet supported`));
    }
  });

// ── Init Command ─────────────────────────────────────────────────────────

program
  .command("init")
  .description("Interactive setup wizard — detect project type and create config")
  .option("-y, --yes", "Non-interactive mode with defaults")
  .action(async (opts: { yes?: boolean }) => {
    try {
      const cwd = process.cwd();
      console.log(chalk.bold("Detecting project type..."));
      const detection = detectProjectType(cwd);

      console.log(chalk.cyan("  Type:       ") + detection.type);
      console.log(chalk.cyan("  Framework:  ") + detection.framework);
      console.log(chalk.cyan("  Provider:   ") + chalk.magenta(detection.suggestedProvider));
      console.log(chalk.cyan("  Blueprint:  ") + detection.suggestedBlueprint);
      console.log(chalk.cyan("  Confidence: ") + detection.confidence);
      if (detection.detectedFiles.length > 0) {
        console.log(chalk.cyan("  Files:      ") + detection.detectedFiles.join(", "));
      }

      const projectName = cwd.split("/").pop() ?? "my-project";

      if (opts.yes) {
        const project = createProject({
          name: projectName,
          source_type: "local",
          source_url: cwd,
          description: `${detection.framework} project (auto-detected)`,
        });
        console.log(chalk.green("✓ Project created: ") + chalk.bold(project.name) + chalk.dim(` (${shortId(project.id)})`));
        console.log(chalk.dim(`  Suggested: deployment provider add my-provider -t ${detection.suggestedProvider}`));
        return;
      }

      console.log(chalk.bold("\nSetup:"));
      console.log(`  1. Create project: ${chalk.cyan(`deployment project create ${projectName} --source ${cwd} --type local`)}`);
      console.log(`  2. Add provider:   ${chalk.cyan(`deployment provider add my-provider -t ${detection.suggestedProvider}`)}`);
      console.log(`  3. Create env:     ${chalk.cyan(`deployment env create ${projectName} prod -t prod --provider <provider-id>`)}`);
      console.log(`  4. Deploy:         ${chalk.cyan(`deployment deploy ${projectName} prod`)}`);
    } catch (e) { handleError(e); }
  });

// ── Doctor Command ───────────────────────────────────────────────────────

program
  .command("doctor")
  .description("System health check — verify DB, secrets, and provider connectivity")
  .action(async () => {
    console.log(chalk.bold("System Health Check:\n"));

    // Check DB accessible
    try {
      listProjects();
      console.log(chalk.green("  ✓ Database:    ") + "accessible");
    } catch {
      console.log(chalk.red("  ✗ Database:    ") + "not accessible");
    }

    // Check secrets
    try {
      const available = await initSecrets();
      if (available) {
        console.log(chalk.green("  ✓ Secrets:     ") + "@hasna/secrets available");
      } else {
        console.log(chalk.yellow("  ⚠ Secrets:     ") + "@hasna/secrets not installed (optional)");
      }
    } catch {
      console.log(chalk.yellow("  ⚠ Secrets:     ") + "@hasna/secrets not installed (optional)");
    }

    // Check providers
    const providers = listProviders();
    if (providers.length === 0) {
      console.log(chalk.dim("  — No providers configured"));
    } else {
      for (const p of providers) {
        try {
          const prov = getRegisteredProvider(p.type);
          await prov.connect({});
          console.log(chalk.green(`  ✓ ${p.name}:`) + ` ${p.type} connected`);
        } catch {
          console.log(chalk.red(`  ✗ ${p.name}:`) + ` ${p.type} connection failed`);
        }
      }
    }

    console.log(chalk.dim("\n  Checks complete."));
  });

// ── Overview Command ─────────────────────────────────────────────────────

program
  .command("overview")
  .description("Show all projects, environments, and latest deployments")
  .action(() => {
    try {
      const projects = listProjects();
      if (projects.length === 0) return console.log(chalk.dim("No projects"));

      console.log(chalk.bold("Overview:\n"));
      console.log(
        chalk.dim("  Project".padEnd(20)) +
        chalk.dim("Env".padEnd(15)) +
        chalk.dim("Provider".padEnd(15)) +
        chalk.dim("Status".padEnd(15)) +
        chalk.dim("URL".padEnd(35)) +
        chalk.dim("Last Deploy")
      );
      console.log(chalk.dim("  " + "─".repeat(110)));

      for (const p of projects) {
        const envs = listEnvironments({ project_id: p.id });
        if (envs.length === 0) {
          console.log(`  ${chalk.bold(p.name.padEnd(19))} ${chalk.dim("no environments")}`);
          continue;
        }
        for (const env of envs) {
          let providerName = "";
          try {
            const prov = getDbProvider(env.provider_id);
            providerName = prov.type;
          } catch { providerName = "?"; }

          const latest = getLatestDeployment(env.id);
          const status = latest ? latest.status : "—";
          const url = latest?.url || "";
          const lastDeploy = latest ? timeAgo(latest.created_at) : "—";

          console.log(
            `  ${chalk.bold(p.name.slice(0, 18).padEnd(19))} ` +
            `${chalk.bold(env.name.slice(0, 13).padEnd(14))} ` +
            `${chalk.magenta(providerName.padEnd(14))} ` +
            `${statusColor(status).padEnd(14 + (statusColor(status).length - status.length))} ` +
            `${chalk.dim(url.slice(0, 33).padEnd(34))} ` +
            `${chalk.dim(lastDeploy)}`
          );
        }
      }
    } catch (e) { handleError(e); }
  });

// ── Watch Command ────────────────────────────────────────────────────────

program
  .command("watch <project> <environment>")
  .description("Watch deployment status until terminal state")
  .option("--timeout <seconds>", "Timeout in seconds", "300")
  .action(async (projectName: string, envName: string, opts: { timeout: string }) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found`));

      const timeoutMs = parseInt(opts.timeout, 10) * 1000;
      const start = Date.now();
      let lastStatus = "";

      console.log(chalk.yellow("⟳ Watching ") + chalk.bold(project.name) + " " + chalk.bold(env.name) + "...");

      const terminalStates = new Set(["live", "failed", "cancelled", "rolled_back"]);

      while (Date.now() - start < timeoutMs) {
        const latest = getLatestDeployment(env.id);
        const currentStatus = latest?.status ?? "no deployment";

        if (currentStatus !== lastStatus) {
          const ts = new Date().toLocaleTimeString();
          console.log(`  ${chalk.dim(ts)} ${statusColor(currentStatus)}`);
          lastStatus = currentStatus;

          if (terminalStates.has(currentStatus)) {
            if (latest?.url) console.log(chalk.cyan("  URL: ") + latest.url);
            console.log(chalk.dim("  Watch complete."));
            return;
          }
        }

        await new Promise((r) => setTimeout(r, 2000));
      }

      console.log(chalk.yellow("  Timeout reached after " + opts.timeout + "s"));
    } catch (e) { handleError(e); }
  });

// ── Hook Commands ────────────────────────────────────────────────────────

const hookCmd = program.command("hook").description("Manage deployment hooks");

hookCmd
  .command("list")
  .alias("ls")
  .description("List all hooks")
  .option("-e, --event <event>", "Filter by event")
  .action((opts: { event?: string }) => {
    try {
      ensureHooksTable();
      const hooks = listHooks(opts.event as DeploymentHookEvent | undefined);
      if (hooks.length === 0) return console.log(chalk.dim("No hooks"));
      console.log(chalk.bold("Hooks:"));
      for (const h of hooks) {
        console.log(
          `  ${chalk.cyan(shortId(h.id))} ${chalk.magenta(h.event)} ${chalk.bold(h.command)} ` +
          `${h.enabled ? chalk.green("enabled") : chalk.red("disabled")} ${chalk.dim(timeAgo(h.created_at))}`
        );
      }
    } catch (e) { handleError(e); }
  });

hookCmd
  .command("add <event> <command>")
  .description("Add a deployment hook")
  .option("-p, --project <id>", "Scope to project")
  .option("-e, --env <id>", "Scope to environment")
  .action((event: string, command: string, opts: { project?: string; env?: string }) => {
    try {
      const hook = addHook(event as DeploymentHookEvent, command, opts.project, opts.env);
      console.log(chalk.green("✓ Hook added: ") + chalk.bold(hook.event) + " → " + chalk.cyan(hook.command));
    } catch (e) { handleError(e); }
  });

hookCmd
  .command("remove <id>")
  .description("Remove a hook")
  .action((id: string) => {
    try {
      removeHook(id);
      console.log(chalk.red("✓ Hook removed"));
    } catch (e) { handleError(e); }
  });

hookCmd
  .command("test <event>")
  .description("Dry-run hooks for an event")
  .action(async (event: string) => {
    try {
      ensureHooksTable();
      const hooks = listHooks(event as DeploymentHookEvent).filter((h) => h.enabled);
      if (hooks.length === 0) return console.log(chalk.dim(`No hooks for event: ${event}`));
      console.log(chalk.bold(`Testing ${hooks.length} hook(s) for "${event}":`));
      const results = await runHooks(event as DeploymentHookEvent, {
        project_id: "test",
        project_name: "test-project",
        environment_id: "test",
        environment_name: "test-env",
        environment_type: "dev",
        provider_type: "railway",
      });
      for (const r of results) {
        if (r.success) {
          console.log(chalk.green("  ✓ ") + r.command + chalk.dim(` (${r.duration_ms}ms)`));
        } else {
          console.log(chalk.red("  ✗ ") + r.command + chalk.dim(` — ${r.error}`));
        }
      }
    } catch (e) { handleError(e); }
  });

// ── Top-level Aliases ────────────────────────────────────────────────────

program
  .command("ls")
  .description("Alias for project list")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((opts: { format: string }) => {
    const projects = listProjects();
    if (opts.format === "json") return printJson(projects);
    if (projects.length === 0) return console.log(chalk.dim("No projects"));
    console.log(chalk.bold("Projects:"));
    for (const p of projects) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(p.name)} ${chalk.dim(p.source_type + ":" + p.source_url)} ${chalk.dim(timeAgo(p.created_at))}`);
    }
  });

program
  .command("ps")
  .description("Alias for history list")
  .option("-n, --limit <n>", "Limit results", "20")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((opts: { limit: string; format: string }) => {
    try {
      const deployments = listDeployments({ limit: parseInt(opts.limit, 10) });
      if (opts.format === "json") return printJson(deployments);
      if (deployments.length === 0) return console.log(chalk.dim("No deployments"));
      console.log(chalk.bold("Deployments:"));
      for (const d of deployments) {
        console.log(
          `  ${chalk.cyan(shortId(d.id))} ${statusColor(d.status)} ${chalk.dim(d.version || "no version")} ${chalk.dim(d.url || "")} ${chalk.dim(timeAgo(d.created_at))}`
        );
      }
    } catch (e) { handleError(e); }
  });

program.parse(process.argv);
