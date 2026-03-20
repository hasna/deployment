import { getProvider } from "./provider.js";
import { createResource, updateResource } from "../db/resources.js";
import { getBlueprint, listBlueprints as listDbBlueprints, createBlueprint } from "../db/blueprints.js";
import { getEnvironment } from "../db/environments.js";
import { getProvider as getDbProvider } from "../db/providers.js";
import { getDeploymentSecrets } from "./secrets-integration.js";
import { getProject } from "../db/projects.js";
import type {
  Blueprint,
  BlueprintTemplate,
  Resource,
} from "../types/index.js";

export interface ApplyBlueprintResult {
  blueprint: Blueprint;
  resources: Resource[];
  errors: string[];
}

export async function applyBlueprint(
  blueprintId: string,
  environmentId: string
): Promise<ApplyBlueprintResult> {
  const blueprint = getBlueprint(blueprintId);
  const environment = getEnvironment(environmentId);
  const dbProvider = getDbProvider(environment.provider_id);
  const provider = getProvider(dbProvider.type);
  const project = getProject(environment.project_id);

  const secrets = getDeploymentSecrets(project.name, environment.name);
  await provider.connect(secrets.credentials);

  const resources: Resource[] = [];
  const errors: string[] = [];

  for (const resourceDef of blueprint.template.resources) {
    try {
      const result = await provider.provisionResource(
        resourceDef.type,
        resourceDef.name,
        { ...resourceDef.config, project_id: project.id }
      );

      const resource = createResource({
        environment_id: environmentId,
        type: resourceDef.type,
        name: resourceDef.name,
        provider_resource_id: result.resourceId,
        config: {
          ...resourceDef.config,
          connectionString: result.connectionString,
        },
      });

      updateResource(resource.id, { status: "active" });
      resources.push({ ...resource, status: "active" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to provision ${resourceDef.type} "${resourceDef.name}": ${message}`);
    }
  }

  // Set env vars from blueprint template
  if (Object.keys(blueprint.template.env_vars).length > 0) {
    try {
      await provider.setEnvVars(project.name, blueprint.template.env_vars);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to set env vars: ${message}`);
    }
  }

  return { blueprint, resources, errors };
}

export function seedBuiltinBlueprints(): void {
  const builtins: { name: string; description: string; provider_type: string; template: BlueprintTemplate }[] = [
    {
      name: "nextjs-vercel",
      description: "Next.js app on Vercel with Postgres and KV cache",
      provider_type: "vercel",
      template: {
        resources: [
          { type: "database", name: "postgres", config: { region: "iad1" } },
          { type: "cache", name: "kv-cache", config: {} },
        ],
        env_vars: { NODE_ENV: "production" },
        deploy_config: { framework: "nextjs" },
      },
    },
    {
      name: "node-railway",
      description: "Node.js service on Railway with Postgres and Redis",
      provider_type: "railway",
      template: {
        resources: [
          { type: "database", name: "postgres", config: {} },
          { type: "cache", name: "redis", config: {} },
        ],
        env_vars: { NODE_ENV: "production" },
        deploy_config: {},
      },
    },
    {
      name: "docker-flyio",
      description: "Docker container on Fly.io with persistent volume",
      provider_type: "flyio",
      template: {
        resources: [
          { type: "storage", name: "data-volume", config: { size_gb: 1 } },
        ],
        env_vars: { NODE_ENV: "production" },
        deploy_config: { internal_port: 8080 },
      },
    },
    {
      name: "fullstack-aws",
      description: "Full AWS stack: ECS Fargate + RDS Postgres + ElastiCache Redis + S3",
      provider_type: "aws",
      template: {
        resources: [
          { type: "database", name: "postgres", config: { engine: "postgres", instance_class: "db.t3.micro" } },
          { type: "cache", name: "redis", config: { node_type: "cache.t3.micro" } },
          { type: "storage", name: "files", config: {} },
        ],
        env_vars: { NODE_ENV: "production" },
        deploy_config: { cpu: "256", memory: "512" },
      },
    },
    {
      name: "static-cloudflare",
      description: "Static site on Cloudflare Pages with KV and R2",
      provider_type: "cloudflare",
      template: {
        resources: [
          { type: "cache", name: "kv-store", config: {} },
          { type: "storage", name: "assets", config: {} },
        ],
        env_vars: {},
        deploy_config: { branch: "main" },
      },
    },
    {
      name: "app-digitalocean",
      description: "App Platform on DigitalOcean with Managed Postgres",
      provider_type: "digitalocean",
      template: {
        resources: [
          { type: "database", name: "postgres", config: { engine: "pg", size: "db-s-1vcpu-1gb" } },
        ],
        env_vars: { NODE_ENV: "production" },
        deploy_config: { size: "apps-s-1vcpu-0.5gb" },
      },
    },
  ];

  const existing = listDbBlueprints();
  const existingNames = new Set(existing.map((b) => b.name));

  for (const bp of builtins) {
    if (!existingNames.has(bp.name)) {
      createBlueprint({
        name: bp.name,
        description: bp.description,
        provider_type: bp.provider_type as Blueprint["provider_type"],
        template: bp.template,
      });
    }
  }
}
