import { getProvider } from "./provider.js";
import { getDeploymentSecrets, injectSecretsToProvider } from "./secrets-integration.js";
import { createDeployment, updateDeployment, getLatestDeployment } from "../db/deployments.js";
import { getEnvironment } from "../db/environments.js";
import { getProject } from "../db/projects.js";
import { getProvider as getDbProvider } from "../db/providers.js";
import { now } from "../db/database.js";
import type {
  Deployment,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
} from "../types/index.js";
import { DeploymentFailedError } from "../types/index.js";

export interface DeployInput {
  projectId: string;
  environmentId: string;
  image?: string;
  commitSha?: string;
  version?: string;
  config?: Record<string, unknown>;
}

export interface PromoteInput {
  projectId: string;
  fromEnvironmentId: string;
  toEnvironmentId: string;
}

export async function deploy(input: DeployInput): Promise<Deployment> {
  const project = getProject(input.projectId);
  const environment = getEnvironment(input.environmentId);
  const dbProvider = getDbProvider(environment.provider_id);
  const provider = getProvider(dbProvider.type);

  // Create deployment record
  const deployment = createDeployment({
    project_id: project.id,
    environment_id: environment.id,
    version: input.version,
    image: input.image,
    commit_sha: input.commitSha,
  });

  try {
    // Connect to provider
    const secrets = getDeploymentSecrets(project.name, environment.name);
    await provider.connect(secrets.credentials);

    // Update status: building
    updateDeployment(deployment.id, {
      status: "building",
      started_at: now(),
    });

    // Inject env vars from secrets
    await injectSecretsToProvider(provider, project.name, environment.name);

    // Update status: deploying
    updateDeployment(deployment.id, { status: "deploying" });

    // Execute deployment
    const opts: DeployOptions = {
      projectId: input.config?.["provider_project_id"] as string ?? project.name,
      environmentId: environment.name,
      image: input.image,
      source: project.source_url,
      commitSha: input.commitSha,
      envVars: secrets.envVars,
      config: { ...environment.config, ...input.config },
    };

    const result: DeployResult = await provider.deploy(opts);

    // Update deployment with result
    updateDeployment(deployment.id, {
      status: result.status === "live" ? "live" : "deploying",
      url: result.url,
    });

    // If still deploying, poll for completion
    if (result.status !== "live") {
      const finalStatus = await pollDeploymentStatus(
        provider,
        result.deploymentId,
        deployment.id
      );
      if (finalStatus === "failed") {
        throw new DeploymentFailedError(deployment.id, "Deployment failed on provider");
      }
    }

    updateDeployment(deployment.id, {
      status: "live",
      completed_at: now(),
    });

    return { ...deployment, status: "live", url: result.url, completed_at: now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateDeployment(deployment.id, {
      status: "failed",
      logs: message,
      completed_at: now(),
    });
    throw new DeploymentFailedError(deployment.id, message);
  }
}

export async function rollback(
  projectId: string,
  environmentId: string,
  targetDeploymentId?: string
): Promise<Deployment> {
  const project = getProject(projectId);
  const environment = getEnvironment(environmentId);
  const dbProvider = getDbProvider(environment.provider_id);
  const provider = getProvider(dbProvider.type);

  const latest = getLatestDeployment(environmentId);
  if (!latest) throw new Error("No deployments found for this environment");

  const secrets = getDeploymentSecrets(project.name, environment.name);
  await provider.connect(secrets.credentials);

  // Mark current as rolled back
  updateDeployment(latest.id, { status: "rolled_back" });

  // Create new deployment record for the rollback
  const deployment = createDeployment({
    project_id: project.id,
    environment_id: environment.id,
    version: `rollback-${latest.version}`,
    image: latest.image,
    commit_sha: latest.commit_sha,
  });

  try {
    updateDeployment(deployment.id, { status: "deploying", started_at: now() });

    const result = await provider.rollback(targetDeploymentId ?? latest.id);

    updateDeployment(deployment.id, {
      status: "live",
      url: result.url,
      completed_at: now(),
    });

    return { ...deployment, status: "live", url: result.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateDeployment(deployment.id, {
      status: "failed",
      logs: message,
      completed_at: now(),
    });
    throw new DeploymentFailedError(deployment.id, message);
  }
}

export async function promote(input: PromoteInput): Promise<Deployment> {
  const latestSource = getLatestDeployment(input.fromEnvironmentId);
  if (!latestSource || latestSource.status !== "live") {
    throw new Error("No live deployment in source environment to promote");
  }

  return deploy({
    projectId: input.projectId,
    environmentId: input.toEnvironmentId,
    image: latestSource.image,
    commitSha: latestSource.commit_sha,
    version: `promoted-${latestSource.version}`,
  });
}

export async function getStatus(
  projectId: string,
  environmentId: string
): Promise<{ deployment: Deployment | null; providerStatus: DeploymentStatus | null }> {
  const latest = getLatestDeployment(environmentId);
  if (!latest) return { deployment: null, providerStatus: null };

  try {
    const environment = getEnvironment(environmentId);
    const dbProvider = getDbProvider(environment.provider_id);
    const provider = getProvider(dbProvider.type);
    const project = getProject(projectId);
    const secrets = getDeploymentSecrets(project.name, environment.name);
    await provider.connect(secrets.credentials);

    const providerStatus = await provider.getDeploymentStatus(latest.id);
    return { deployment: latest, providerStatus };
  } catch {
    return { deployment: latest, providerStatus: null };
  }
}

export async function getLogs(
  projectId: string,
  environmentId: string,
  deploymentId?: string
): Promise<string> {
  const environment = getEnvironment(environmentId);
  const dbProvider = getDbProvider(environment.provider_id);
  const provider = getProvider(dbProvider.type);
  const project = getProject(projectId);
  const secrets = getDeploymentSecrets(project.name, environment.name);
  await provider.connect(secrets.credentials);

  const id = deploymentId ?? getLatestDeployment(environmentId)?.id;
  if (!id) return "No deployments found";

  return provider.getDeploymentLogs(id);
}

async function pollDeploymentStatus(
  provider: { getDeploymentStatus: (id: string) => Promise<DeploymentStatus> },
  providerDeploymentId: string,
  localDeploymentId: string,
  maxAttempts = 60,
  intervalMs = 5000
): Promise<DeploymentStatus> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const status = await provider.getDeploymentStatus(providerDeploymentId);

    if (status === "live" || status === "failed" || status === "cancelled") {
      updateDeployment(localDeploymentId, { status });
      return status;
    }

    updateDeployment(localDeploymentId, { status });
  }

  return "failed";
}
