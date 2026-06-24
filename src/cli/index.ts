#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander";
import chalk from "chalk";
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js";
import { createEnvironment, getEnvironment, listEnvironments, deleteEnvironment } from "../db/environments.js";
import { createProvider, getProvider as getDbProvider, listProviders, deleteProvider } from "../db/providers.js";
import { countDeployments, listDeployments, getDeployment } from "../db/deployments.js";
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
import { pageItems, parseCursor, parsePositiveInt, summarizeObject, tailLines, truncateText } from "../lib/compact-output.js";
import { PACKAGE_VERSION } from "../lib/package.js";
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

interface ListOutputOptions {
  format?: string;
  limit?: string;
  cursor?: string;
  verbose?: boolean;
}

function isJsonFormat(format?: string): boolean {
  return format === "json";
}

function printPageHint(noun: string, page: { items: readonly unknown[]; total: number; nextCursor: number | null }, command: string, detailHint?: string): void {
  if (page.total <= page.items.length && !detailHint) return;
  const parts: string[] = [];
  if (page.total > page.items.length) {
    parts.push(`showing ${page.items.length} of ${page.total}`);
    if (page.nextCursor !== null) parts.push(`next: ${command} --cursor ${page.nextCursor}`);
  }
  if (detailHint) parts.push(detailHint);
  console.log(chalk.dim(`  ${noun}: ${parts.join("; ")}`));
}

function compactSource(type: string, url: string, verbose?: boolean): string {
  const source = `${type}:${url || "none"}`;
  return verbose ? source : truncateText(source, 64);
}

function compactUrl(url: string, verbose?: boolean): string {
  return verbose ? url : truncateText(url, 48);
}

const program = new Command()
  .name("deployment")
  .description("General-purpose deployment orchestration for AI agents")
  .version(PACKAGE_VERSION);

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
  .option("-s, --search <query>", "Search project name or description")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("--verbose", "Show longer fields")
  .action((opts: ListOutputOptions & { search?: string }) => {
    const projects = listProjects({ search: opts.search });
    if (isJsonFormat(opts.format)) {
      const limit = opts.limit ? parsePositiveInt(opts.limit, projects.length || 1) : projects.length;
      const page = pageItems(projects, { limit, cursor: opts.cursor, defaultLimit: projects.length || 1 });
      return printJson(page.items);
    }
    if (projects.length === 0) return console.log(chalk.dim("No projects"));
    const page = pageItems(projects, opts);
    console.log(chalk.bold("Projects:"));
    for (const p of page.items) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(truncateText(p.name, 32))} ${chalk.dim(compactSource(p.source_type, p.source_url, opts.verbose))} ${chalk.dim(timeAgo(p.created_at))}`);
    }
    printPageHint("projects", page, "deployment project list", "use project show <id> for details");
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
  .option("-t, --type <type>", "Filter by type: dev|staging|prod")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action((projectName: string | undefined, opts: ListOutputOptions & { type?: string }) => {
    try {
      let projectId: string | undefined;
      if (projectName) projectId = getProject(projectName).id;
      const envs = listEnvironments({ project_id: projectId, type: opts.type as EnvironmentType | undefined });
      if (isJsonFormat(opts.format)) {
        const limit = opts.limit ? parsePositiveInt(opts.limit, envs.length || 1) : envs.length;
        const page = pageItems(envs, { limit, cursor: opts.cursor, defaultLimit: envs.length || 1 });
        return printJson(page.items);
      }
      if (envs.length === 0) return console.log(chalk.dim("No environments"));
      const page = pageItems(envs, opts);
      console.log(chalk.bold("Environments:"));
      for (const e of page.items) {
        console.log(`  ${chalk.cyan(shortId(e.id))} ${chalk.bold(e.name)} ${statusColor(e.type)} ${chalk.dim(e.region || "")} ${chalk.dim(timeAgo(e.created_at))}`);
      }
      printPageHint("environments", page, "deployment env list", "use env show <id> for details");
    } catch (e) { handleError(e); }
  });

envCmd
  .command("show <id>")
  .description("Show environment details")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("--verbose", "Show full config")
  .action((id: string, opts: { format: string; verbose?: boolean }) => {
    try {
      const e = getEnvironment(id);
      if (isJsonFormat(opts.format)) return printJson(e);
      console.log(chalk.bold("Environment: ") + e.name);
      console.log(chalk.cyan("  ID:       ") + e.id);
      console.log(chalk.cyan("  Type:     ") + e.type);
      console.log(chalk.cyan("  Provider: ") + e.provider_id);
      console.log(chalk.cyan("  Region:   ") + (e.region || chalk.dim("default")));
      console.log(chalk.cyan("  Config:   ") + (opts.verbose ? JSON.stringify(e.config, null, 2) : summarizeObject(e.config)));
      if (!opts.verbose && Object.keys(e.config).length > 0) console.log(chalk.dim("  use --verbose or --format json for full config"));
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
  .option("-t, --type <type>", "Filter by provider type")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action((opts: ListOutputOptions & { type?: string }) => {
    const providers = listProviders({ type: opts.type as ProviderType | undefined });
    if (isJsonFormat(opts.format)) {
      const limit = opts.limit ? parsePositiveInt(opts.limit, providers.length || 1) : providers.length;
      const page = pageItems(providers, { limit, cursor: opts.cursor, defaultLimit: providers.length || 1 });
      return printJson(page.items);
    }
    if (providers.length === 0) return console.log(chalk.dim("No providers"));
    const page = pageItems(providers, opts);
    console.log(chalk.bold("Providers:"));
    for (const p of page.items) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(p.name)} ${chalk.magenta(p.type)} ${chalk.dim(timeAgo(p.created_at))}`);
    }
    printPageHint("providers", page, "deployment provider list", "use provider show <id> for details");
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
  .option("--verbose", "Show full URL and version")
  .action(async (projectName: string, envName: string, opts: { verbose?: boolean }) => {
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
      console.log(chalk.cyan("  URL:      ") + (deployment.url ? compactUrl(deployment.url, opts.verbose) : chalk.dim("none")));
      console.log(chalk.cyan("  Version:  ") + (deployment.version ? (opts.verbose ? deployment.version : truncateText(deployment.version, 48)) : chalk.dim("none")));
      if (providerStatus) {
        console.log(chalk.cyan("  Provider: ") + statusColor(providerStatus));
      }
      if (!opts.verbose && (deployment.url.length > 48 || deployment.version.length > 48)) {
        console.log(chalk.dim("  use --verbose for full URL and version"));
      }
    } catch (e) { handleError(e); }
  });

// ── Logs Command ────────────────────────────────────────────────────────────

program
  .command("logs <project> <environment>")
  .description("Get deployment logs")
  .option("--lines <n>", "Tail the last N lines (default: 120)")
  .option("--full", "Print full logs")
  .action(async (projectName: string, envName: string, opts: { lines?: string; full?: boolean }) => {
    try {
      const project = getProject(projectName);
      const envs = listEnvironments({ project_id: project.id });
      const env = envs.find((e) => e.name === envName);
      if (!env) return handleError(new Error(`Environment "${envName}" not found`));

      const logs = await getLogs(project.id, env.id);
      if (!logs) return console.log(chalk.dim("No logs available"));
      if (opts.full) return console.log(logs);
      const tailed = tailLines(logs, parsePositiveInt(opts.lines, 120, 10_000));
      console.log(tailed.text);
      if (tailed.omitted > 0) console.log(chalk.dim(`  omitted ${tailed.omitted} earlier line(s); use --full or --lines <n>`));
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
  .option("-t, --type <type>", "Filter by resource type")
  .option("-s, --status <status>", "Filter by status")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action((envId: string | undefined, opts: ListOutputOptions & { type?: string; status?: string }) => {
    const resources = listResources({ environment_id: envId, type: opts.type as any, status: opts.status as any });
    if (isJsonFormat(opts.format)) {
      const limit = opts.limit ? parsePositiveInt(opts.limit, resources.length || 1) : resources.length;
      const page = pageItems(resources, { limit, cursor: opts.cursor, defaultLimit: resources.length || 1 });
      return printJson(page.items);
    }
    if (resources.length === 0) return console.log(chalk.dim("No resources"));
    const page = pageItems(resources, opts);
    console.log(chalk.bold("Resources:"));
    for (const r of page.items) {
      console.log(`  ${chalk.cyan(shortId(r.id))} ${chalk.bold(r.name)} ${chalk.magenta(r.type)} ${statusColor(r.status)}`);
    }
    printPageHint("resources", page, "deployment resource list", "use --format json for full resource configs");
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
  .option("-p, --provider <type>", "Filter by provider type")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action((opts: ListOutputOptions & { provider?: string }) => {
    seedBuiltinBlueprints();
    const blueprints = listBlueprints({ provider_type: opts.provider as ProviderType | undefined });
    if (isJsonFormat(opts.format)) {
      const limit = opts.limit ? parsePositiveInt(opts.limit, blueprints.length || 1) : blueprints.length;
      const page = pageItems(blueprints, { limit, cursor: opts.cursor, defaultLimit: blueprints.length || 1 });
      return printJson(page.items);
    }
    if (blueprints.length === 0) return console.log(chalk.dim("No blueprints"));
    const page = pageItems(blueprints, opts);
    console.log(chalk.bold("Blueprints:"));
    for (const b of page.items) {
      console.log(`  ${chalk.cyan(shortId(b.id))} ${chalk.bold(b.name)} ${chalk.magenta(b.provider_type)} ${chalk.dim(truncateText(b.description, 72))}`);
    }
    printPageHint("blueprints", page, "deployment blueprint list", "use blueprint show <id> --verbose for template details");
  });

blueprintCmd
  .command("show <id>")
  .description("Show blueprint details")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("--verbose", "Show full template")
  .action((id: string, opts: { format: string; verbose?: boolean }) => {
    try {
      const b = getBlueprint(id);
      if (isJsonFormat(opts.format)) return printJson(b);
      console.log(chalk.bold("Blueprint: ") + b.name);
      console.log(chalk.cyan("  Provider: ") + b.provider_type);
      console.log(chalk.cyan("  Desc:     ") + b.description);
      if (opts.verbose) {
        console.log(chalk.cyan("  Template: ") + JSON.stringify(b.template, null, 2));
      } else {
        console.log(chalk.cyan("  Template: ") + `${b.template.resources.length} resource(s), ${Object.keys(b.template.env_vars).length} env var(s), ${Object.keys(b.template.deploy_config).length} deploy key(s)`);
        console.log(chalk.dim("  use --verbose or --format json for the full template"));
      }
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
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action((opts: ListOutputOptions) => {
    const agents = listAgents();
    if (agents.length === 0) return console.log(chalk.dim("No agents"));
    const page = pageItems(agents, opts);
    console.log(chalk.bold("Agents:"));
    for (const a of page.items) {
      console.log(`  ${chalk.cyan(shortId(a.id))} ${chalk.bold(a.name)} ${chalk.dim(a.type)} ${chalk.dim(timeAgo(a.last_seen))}`);
    }
    printPageHint("agents", page, "deployment agent list");
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
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .action(async (project: string, env: string | undefined, opts: ListOutputOptions) => {
    try {
      await initSecrets();
      const secrets = listDeploymentSecrets(project, env);
      if (secrets.length === 0) return console.log(chalk.dim("No secrets"));
      const page = pageItems(secrets, opts);
      console.log(chalk.bold("Secrets:"));
      for (const s of page.items) {
        console.log(`  ${chalk.cyan(s.key)} ${chalk.dim("***")}`);
      }
      printPageHint("secrets", page, `deployment secret list ${project}${env ? ` ${env}` : ""}`);
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
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .action((projectName: string | undefined, opts: ListOutputOptions & { env?: string; status?: string }) => {
    try {
      let projectId: string | undefined;
      if (projectName) projectId = getProject(projectName).id;

      const filters = {
        project_id: projectId,
        environment_id: opts.env,
        status: opts.status as any,
      };
      const limit = parsePositiveInt(opts.limit, 20, 200);
      const cursor = parseCursor(opts.cursor);
      const total = countDeployments(filters);
      const deployments = listDeployments({ ...filters, limit, offset: cursor });

      if (isJsonFormat(opts.format)) {
        return printJson(deployments);
      }
      if (total === 0) return console.log(chalk.dim("No deployments"));

      const page = {
        items: deployments,
        total,
        nextCursor: cursor + deployments.length < total ? cursor + deployments.length : null,
      };
      console.log(chalk.bold("Deployments:"));
      for (const d of page.items) {
        console.log(
          `  ${chalk.cyan(shortId(d.id))} ${statusColor(d.status)} ${chalk.dim(truncateText(d.version || "no version", 28))} ${chalk.dim(compactUrl(d.url || "", opts.verbose))} ${chalk.dim(timeAgo(d.created_at))}`
        );
      }
      printPageHint("deployments", page, "deployment history list", "use history show <id> for details");
    } catch (e) { handleError(e); }
  });

historyCmd
  .command("show <id>")
  .description("Show deployment details")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("--verbose", "Show full logs")
  .option("--logs", "Show recent logs")
  .option("--log-lines <n>", "Recent log lines to show with --logs (default: 40)")
  .action((id: string, opts: { format: string; verbose?: boolean; logs?: boolean; logLines?: string }) => {
    try {
      const d = getDeployment(id);
      if (isJsonFormat(opts.format)) return printJson(d);
      console.log(chalk.bold("Deployment: ") + shortId(d.id));
      console.log(chalk.cyan("  Status:    ") + statusColor(d.status));
      console.log(chalk.cyan("  URL:       ") + (d.url || chalk.dim("none")));
      console.log(chalk.cyan("  Version:   ") + (d.version || chalk.dim("none")));
      console.log(chalk.cyan("  Image:     ") + (d.image || chalk.dim("none")));
      console.log(chalk.cyan("  Commit:    ") + (d.commit_sha || chalk.dim("none")));
      console.log(chalk.cyan("  Started:   ") + (d.started_at || chalk.dim("none")));
      console.log(chalk.cyan("  Completed: ") + (d.completed_at || chalk.dim("none")));
      if (d.logs && opts.verbose) {
        console.log(chalk.cyan("  Logs:\n") + d.logs);
      } else if (d.logs && opts.logs) {
        const tailed = tailLines(d.logs, parsePositiveInt(opts.logLines, 40, 10_000));
        console.log(chalk.cyan("  Logs:\n") + tailed.text);
        if (tailed.omitted > 0) console.log(chalk.dim(`  omitted ${tailed.omitted} earlier line(s); use --verbose for full logs`));
      } else if (d.logs) {
        console.log(chalk.dim("  Logs omitted; use --logs, --verbose, or --format json"));
      }
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
  .option("--verbose", "Show all detected files")
  .action(async (opts: { yes?: boolean; verbose?: boolean }) => {
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
        const files = opts.verbose ? detection.detectedFiles : detection.detectedFiles.slice(0, 8);
        console.log(chalk.cyan("  Files:      ") + files.map((file) => opts.verbose ? file : truncateText(file, 36)).join(", "));
        if (!opts.verbose && detection.detectedFiles.length > files.length) {
          console.log(chalk.dim(`  omitted ${detection.detectedFiles.length - files.length} detected file(s); use --verbose for all files`));
        }
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
  .option("-n, --limit <n>", "Max environment rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("--verbose", "Show longer URLs and names")
  .action((opts: ListOutputOptions) => {
    try {
      const projects = listProjects();
      if (projects.length === 0) return console.log(chalk.dim("No projects"));

      const rows: Array<{ project: string; env: string; provider: string; status: string; url: string; lastDeploy: string }> = [];
      for (const p of projects) {
        const envs = listEnvironments({ project_id: p.id });
        if (envs.length === 0) {
          rows.push({ project: p.name, env: "no environments", provider: "", status: "—", url: "", lastDeploy: "—" });
          continue;
        }
        for (const env of envs) {
          let providerName = "";
          try {
            const prov = getDbProvider(env.provider_id);
            providerName = prov.type;
          } catch { providerName = "?"; }

          const latest = getLatestDeployment(env.id);
          rows.push({
            project: p.name,
            env: env.name,
            provider: providerName,
            status: latest ? latest.status : "—",
            url: latest?.url || "",
            lastDeploy: latest ? timeAgo(latest.created_at) : "—",
          });
        }
      }

      const page = pageItems(rows, opts);
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

      for (const row of page.items) {
        const projectName = opts.verbose ? row.project : truncateText(row.project, 18);
        const envName = opts.verbose ? row.env : truncateText(row.env, 13);
        const url = opts.verbose ? row.url : truncateText(row.url, 33);
        console.log(
          `  ${chalk.bold(projectName.padEnd(19))} ` +
          `${chalk.bold(envName.padEnd(14))} ` +
          `${chalk.magenta(row.provider.padEnd(14))} ` +
          `${statusColor(row.status).padEnd(14 + (statusColor(row.status).length - row.status.length))} ` +
          `${chalk.dim(url.padEnd(34))} ` +
          `${chalk.dim(row.lastDeploy)}`
        );
      }
      printPageHint("overview", page, "deployment overview", "use --verbose for longer fields");
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
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("--verbose", "Show longer hook commands")
  .action((opts: ListOutputOptions & { event?: string }) => {
    try {
      ensureHooksTable();
      const hooks = listHooks(opts.event as DeploymentHookEvent | undefined);
      if (hooks.length === 0) return console.log(chalk.dim("No hooks"));
      const page = pageItems(hooks, opts);
      console.log(chalk.bold("Hooks:"));
      for (const h of page.items) {
        console.log(
          `  ${chalk.cyan(shortId(h.id))} ${chalk.magenta(h.event)} ${chalk.bold(opts.verbose ? h.command : truncateText(h.command, 56))} ` +
          `${h.enabled ? chalk.green("enabled") : chalk.red("disabled")} ${chalk.dim(timeAgo(h.created_at))}`
        );
      }
      printPageHint("hooks", page, "deployment hook list", "use --verbose for full commands");
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
      console.log(chalk.green("✓ Hook added: ") + chalk.bold(hook.event) + " → " + chalk.cyan(truncateText(hook.command, 96)));
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
          console.log(chalk.green("  ✓ ") + truncateText(r.command, 72) + chalk.dim(` (${r.duration_ms}ms)`));
        } else {
          console.log(chalk.red("  ✗ ") + truncateText(r.command, 72) + chalk.dim(` — ${truncateText(r.error, 120)}`));
        }
      }
    } catch (e) { handleError(e); }
  });

// ── Top-level Aliases ────────────────────────────────────────────────────

program
  .command("ls")
  .description("Alias for project list")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("-n, --limit <n>", "Max rows to print (default: 20)")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("--verbose", "Show longer fields")
  .action((opts: ListOutputOptions) => {
    const projects = listProjects();
    if (isJsonFormat(opts.format)) {
      const limit = opts.limit ? parsePositiveInt(opts.limit, projects.length || 1) : projects.length;
      const page = pageItems(projects, { limit, cursor: opts.cursor, defaultLimit: projects.length || 1 });
      return printJson(page.items);
    }
    if (projects.length === 0) return console.log(chalk.dim("No projects"));
    const page = pageItems(projects, opts);
    console.log(chalk.bold("Projects:"));
    for (const p of page.items) {
      console.log(`  ${chalk.cyan(shortId(p.id))} ${chalk.bold(truncateText(p.name, 32))} ${chalk.dim(compactSource(p.source_type, p.source_url, opts.verbose))} ${chalk.dim(timeAgo(p.created_at))}`);
    }
    printPageHint("projects", page, "deployment ls", "use project show <id> for details");
  });

program
  .command("ps")
  .description("Alias for history list")
  .option("-n, --limit <n>", "Limit results", "20")
  .option("--cursor <offset>", "Pagination cursor from previous output")
  .option("-f, --format <fmt>", "Output format: table|json", "table")
  .option("--verbose", "Show longer URLs and versions")
  .action((opts: ListOutputOptions) => {
    try {
      const limit = parsePositiveInt(opts.limit, 20, 200);
      const cursor = parseCursor(opts.cursor);
      const total = countDeployments();
      const deployments = listDeployments({ limit, offset: cursor });
      if (isJsonFormat(opts.format)) {
        return printJson(deployments);
      }
      if (total === 0) return console.log(chalk.dim("No deployments"));
      const page = {
        items: deployments,
        total,
        nextCursor: cursor + deployments.length < total ? cursor + deployments.length : null,
      };
      console.log(chalk.bold("Deployments:"));
      for (const d of page.items) {
        console.log(
          `  ${chalk.cyan(shortId(d.id))} ${statusColor(d.status)} ${chalk.dim(truncateText(d.version || "no version", 28))} ${chalk.dim(compactUrl(d.url || "", opts.verbose))} ${chalk.dim(timeAgo(d.created_at))}`
        );
      }
      printPageHint("deployments", page, "deployment ps", "use history show <id> for details");
    } catch (e) { handleError(e); }
  });

// ── feedback ────────────────────────────────────────────────────────────────

program
  .command("feedback <message>")
  .description("Send feedback about this service")
  .option("-e, --email <email>", "Contact email")
  .option("-c, --category <cat>", "Category: bug, feature, general", "general")
  .action(async (message: string, opts: { email?: string; category?: string }) => {
    try {
      const { getDatabase } = await import("../db/database.js");
      const db = getDatabase();
      db.run(
        "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
        [message, opts.email || null, opts.category || "general", PACKAGE_VERSION]
      );
      console.log(chalk.green("✓") + " Feedback saved. Thank you!");
    } catch (e) { handleError(e); }
  });
registerEventsCommands(program, { source: "deployment" });

program.parse(process.argv);
