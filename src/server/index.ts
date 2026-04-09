#!/usr/bin/env bun
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createProject, getProject, listProjects, updateProject, deleteProject } from "../db/projects.js";
import { createEnvironment, getEnvironment, listEnvironments, updateEnvironment, deleteEnvironment } from "../db/environments.js";
import { createProvider as createDbProvider, getProvider as getDbProvider, listProviders, deleteProvider } from "../db/providers.js";
import { listDeployments, getDeployment } from "../db/deployments.js";
import { listResources, deleteResource } from "../db/resources.js";
import { listBlueprints, getBlueprint } from "../db/blueprints.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { deploy, rollback, promote, getLogs, previewDeploy } from "../lib/deployer.js";
import { applyBlueprint, seedBuiltinBlueprints } from "../lib/blueprints.js";
import { registerProvider, getProvider as getRegisteredProvider } from "../lib/provider.js";
import { detectProjectType } from "../lib/detect.js";
import { addHook, listHooks, removeHook, runHooks, ensureHooksTable } from "../lib/hooks.js";
import { initSecrets } from "../lib/secrets-integration.js";
import { getLatestDeployment } from "../db/deployments.js";
import { timeAgo } from "../lib/format.js";
import type { DeploymentHookEvent } from "../lib/hooks.js";
import { VercelProvider } from "../lib/vercel.js";
import { CloudflareProvider } from "../lib/cloudflare.js";
import { RailwayProvider } from "../lib/railway.js";
import { FlyioProvider } from "../lib/flyio.js";
import { AwsProvider } from "../lib/aws.js";
import { DigitalOceanProvider } from "../lib/digitalocean.js";
import { PACKAGE_DESCRIPTION, PACKAGE_VERSION } from "../lib/package.js";
import type { SourceType, ProviderType, EnvironmentType } from "../types/index.js";

function handleProcessFlags(argv: readonly string[]): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`${PACKAGE_DESCRIPTION}

Usage: deployment-serve [options]

Options:
  -h, --help     Show this help message
  -V, --version  Show the current version`);
    process.exit(0);
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(PACKAGE_VERSION);
    process.exit(0);
  }
}

if (import.meta.main) {
  handleProcessFlags(process.argv.slice(2));
}

// Register providers
registerProvider(new VercelProvider());
registerProvider(new CloudflareProvider());
registerProvider(new RailwayProvider());
registerProvider(new FlyioProvider());
registerProvider(new AwsProvider());
registerProvider(new DigitalOceanProvider());

seedBuiltinBlueprints();

const PORT = Number(process.env["OPEN_DEPLOYMENT_PORT"] ?? 3460);

const app = new Hono();
app.use("*", cors());

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/api/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString(), version: PACKAGE_VERSION })
);

// ── Projects ────────────────────────────────────────────────────────────────

app.get("/api/projects", (c) => {
  const search = c.req.query("search");
  return c.json(listProjects({ search }));
});

app.post("/api/projects", async (c) => {
  try {
    const body = await c.req.json() as { name: string; source_type?: string; source_url?: string; description?: string };
    const p = createProject({
      name: body.name,
      source_type: (body.source_type ?? "git") as SourceType,
      source_url: body.source_url ?? "",
      description: body.description,
    });
    return c.json(p, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.get("/api/projects/:id", (c) => {
  try { return c.json(getProject(c.req.param("id"))); }
  catch { return c.json({ error: "Project not found" }, 404); }
});

app.put("/api/projects/:id", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    return c.json(updateProject(c.req.param("id"), body));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.delete("/api/projects/:id", (c) => {
  try { deleteProject(c.req.param("id")); return c.json({ deleted: true }); }
  catch { return c.json({ error: "Project not found" }, 404); }
});

// ── Environments ────────────────────────────────────────────────────────────

app.get("/api/projects/:id/environments", (c) => {
  const type = c.req.query("type") as EnvironmentType | undefined;
  return c.json(listEnvironments({ project_id: c.req.param("id"), type }));
});

app.post("/api/projects/:id/environments", async (c) => {
  try {
    const body = await c.req.json() as { name: string; type?: string; provider_id: string; region?: string };
    return c.json(createEnvironment({
      project_id: c.req.param("id"),
      name: body.name,
      type: (body.type ?? "dev") as EnvironmentType,
      provider_id: body.provider_id,
      region: body.region,
    }), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.get("/api/environments/:id", (c) => {
  try { return c.json(getEnvironment(c.req.param("id"))); }
  catch { return c.json({ error: "Environment not found" }, 404); }
});

app.put("/api/environments/:id", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    return c.json(updateEnvironment(c.req.param("id"), body));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.delete("/api/environments/:id", (c) => {
  try { deleteEnvironment(c.req.param("id")); return c.json({ deleted: true }); }
  catch { return c.json({ error: "Environment not found" }, 404); }
});

// ── Providers ───────────────────────────────────────────────────────────────

app.get("/api/providers", (c) => {
  const type = c.req.query("type") as ProviderType | undefined;
  return c.json(listProviders({ type }));
});

app.post("/api/providers", async (c) => {
  try {
    const body = await c.req.json() as { name: string; type: string; credentials_key?: string };
    return c.json(createDbProvider({
      name: body.name,
      type: body.type as ProviderType,
      credentials_key: body.credentials_key ?? "",
    }), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.get("/api/providers/:id", (c) => {
  try { return c.json(getDbProvider(c.req.param("id"))); }
  catch { return c.json({ error: "Provider not found" }, 404); }
});

app.delete("/api/providers/:id", (c) => {
  try { deleteProvider(c.req.param("id")); return c.json({ deleted: true }); }
  catch { return c.json({ error: "Provider not found" }, 404); }
});

// ── Deployments ─────────────────────────────────────────────────────────────

app.post("/api/deploy", async (c) => {
  try {
    const body = await c.req.json() as {
      project_id: string; environment_id: string; image?: string; commit_sha?: string; version?: string;
    };
    const result = await deploy({
      projectId: body.project_id,
      environmentId: body.environment_id,
      image: body.image,
      commitSha: body.commit_sha,
      version: body.version,
    });
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.get("/api/deployments", (c) => {
  const project_id = c.req.query("project_id");
  const environment_id = c.req.query("environment_id");
  const status = c.req.query("status");
  const limit = c.req.query("limit");
  return c.json(listDeployments({
    project_id: project_id ?? undefined,
    environment_id: environment_id ?? undefined,
    status: status as any,
    limit: limit ? parseInt(limit, 10) : undefined,
  }));
});

app.get("/api/deployments/:id", (c) => {
  try { return c.json(getDeployment(c.req.param("id"))); }
  catch { return c.json({ error: "Deployment not found" }, 404); }
});

app.get("/api/deployments/:id/logs", async (c) => {
  try {
    const d = getDeployment(c.req.param("id"));
    const logs = await getLogs(d.project_id, d.environment_id, d.id);
    return c.json({ logs });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.post("/api/rollback/:id", async (c) => {
  try {
    const d = getDeployment(c.req.param("id"));
    const result = await rollback(d.project_id, d.environment_id, d.id);
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.post("/api/promote", async (c) => {
  try {
    const body = await c.req.json() as { project_id: string; from_environment_id: string; to_environment_id: string };
    const result = await promote({
      projectId: body.project_id,
      fromEnvironmentId: body.from_environment_id,
      toEnvironmentId: body.to_environment_id,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// ── Resources ───────────────────────────────────────────────────────────────

app.get("/api/resources", (c) => {
  const environment_id = c.req.query("environment_id");
  const type = c.req.query("type");
  return c.json(listResources({ environment_id: environment_id ?? undefined, type: type as any }));
});

app.delete("/api/resources/:id", (c) => {
  try { deleteResource(c.req.param("id")); return c.json({ deleted: true }); }
  catch { return c.json({ error: "Resource not found" }, 404); }
});

// ── Blueprints ──────────────────────────────────────────────────────────────

app.get("/api/blueprints", (c) => {
  const provider_type = c.req.query("provider_type");
  return c.json(listBlueprints({ provider_type: provider_type as any }));
});

app.get("/api/blueprints/:id", (c) => {
  try { return c.json(getBlueprint(c.req.param("id"))); }
  catch { return c.json({ error: "Blueprint not found" }, 404); }
});

app.post("/api/blueprints/apply", async (c) => {
  try {
    const body = await c.req.json() as { blueprint_id: string; environment_id: string };
    return c.json(await applyBlueprint(body.blueprint_id, body.environment_id));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// ── Agents ──────────────────────────────────────────────────────────────────

app.get("/api/agents", (c) => c.json(listAgents()));

app.post("/api/agents", async (c) => {
  try {
    const body = await c.req.json() as { name: string; type?: "human" | "agent" };
    return c.json(registerAgent(body), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// ── Doctor ──────────────────────────────────────────────────────────────

app.get("/api/doctor", async (c) => {
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
  return c.json(checks);
});

// ── Overview ────────────────────────────────────────────────────────────

app.get("/api/overview", (c) => {
  try {
    const projects = listProjects();
    const result: Array<{
      project: string;
      environment: string;
      provider: string;
      status: string;
      url: string;
      last_deploy: string;
    }> = [];

    for (const p of projects) {
      const envs = listEnvironments({ project_id: p.id });
      for (const env of envs) {
        let providerType = "";
        try { providerType = getDbProvider(env.provider_id).type; } catch { providerType = "unknown"; }
        const latest = getLatestDeployment(env.id);
        result.push({
          project: p.name,
          environment: env.name,
          provider: providerType,
          status: latest?.status ?? "none",
          url: latest?.url ?? "",
          last_deploy: latest ? timeAgo(latest.created_at) : "never",
        });
      }
    }

    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ── Dry-Run Deploy ──────────────────────────────────────────────────────

app.post("/api/deploy/dry-run", async (c) => {
  try {
    const body = await c.req.json() as {
      project_id: string; environment_id: string; image?: string; commit_sha?: string; version?: string;
    };
    return c.json(previewDeploy({
      projectId: body.project_id,
      environmentId: body.environment_id,
      image: body.image,
      commitSha: body.commit_sha,
      version: body.version,
    }));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// ── Detect ──────────────────────────────────────────────────────────────

app.get("/api/detect", (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path query parameter required" }, 400);
  try { return c.json(detectProjectType(path)); }
  catch (e) { return c.json({ error: (e as Error).message }, 422); }
});

// ── Hooks ───────────────────────────────────────────────────────────────

app.get("/api/hooks", (c) => {
  ensureHooksTable();
  const event = c.req.query("event") as DeploymentHookEvent | undefined;
  const project_id = c.req.query("project_id") ?? undefined;
  return c.json(listHooks(event, project_id));
});

app.post("/api/hooks", async (c) => {
  try {
    const body = await c.req.json() as { event: string; command: string; project_id?: string; environment_id?: string };
    return c.json(addHook(body.event as DeploymentHookEvent, body.command, body.project_id, body.environment_id), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

app.delete("/api/hooks/:id", (c) => {
  try { removeHook(c.req.param("id")); return c.json({ deleted: true }); }
  catch { return c.json({ error: "Hook not found" }, 404); }
});

app.post("/api/hooks/test/:event", async (c) => {
  try {
    ensureHooksTable();
    const event = c.req.param("event") as DeploymentHookEvent;
    const results = await runHooks(event, {
      project_id: "test",
      project_name: "test-project",
      environment_id: "test",
      environment_name: "test-env",
      environment_type: "dev",
      provider_type: "railway",
    });
    return c.json(results);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

if (import.meta.main) {
  console.log(`deployment server running on http://localhost:${PORT}`);
}

export default {
  port: PORT,
  fetch: app.fetch,
};
