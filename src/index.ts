// Types
export * from "./types/index.js";

// Database
export { getDatabase, closeDatabase, resetDatabase, uuid, now, resolvePartialId } from "./db/database.js";

// Database — PostgreSQL migrations
export { PG_MIGRATIONS } from "./db/pg-migrations.js";
export { createProject, getProject, listProjects, updateProject, deleteProject } from "./db/projects.js";
export { createEnvironment, getEnvironment, listEnvironments, updateEnvironment, deleteEnvironment } from "./db/environments.js";
export { createProvider, getProvider as getDbProvider, listProviders, updateProvider, deleteProvider } from "./db/providers.js";
export { createDeployment, getDeployment, listDeployments, updateDeployment, getLatestDeployment, getDeploymentsByStatus, deleteDeployment } from "./db/deployments.js";
export { createResource, getResource, listResources, updateResource, deleteResource } from "./db/resources.js";
export { createBlueprint, getBlueprint, listBlueprints, updateBlueprint, deleteBlueprint } from "./db/blueprints.js";
export { registerAgent, getAgent, listAgents, updateAgent, deleteAgent, touchAgent, heartbeat, setFocus } from "./db/agents.js";

// Lib
export { registerProvider, getProvider, listRegisteredProviders, hasProvider, clearProviders } from "./lib/provider.js";
export { deploy, rollback, promote, getStatus, getLogs, previewDeploy } from "./lib/deployer.js";
export type { DeployInput, PromoteInput, DeployPreview } from "./lib/deployer.js";
export { getDeploymentSecrets, setDeploymentSecret, listDeploymentSecrets, injectSecretsToProvider, initSecrets, isSecretsAvailable } from "./lib/secrets-integration.js";
export { applyBlueprint, seedBuiltinBlueprints } from "./lib/blueprints.js";
export { detectProjectType, detectAllMatches } from "./lib/detect.js";
export type { DetectionResult } from "./lib/detect.js";
export { timeAgo, shortId } from "./lib/format.js";
export { addHook, getHook, listHooks, removeHook, toggleHook, runHooks, ensureHooksTable } from "./lib/hooks.js";
export type { DeploymentHookEvent, DeploymentHook, HookContext, HookResult } from "./lib/hooks.js";
export { announceDeployment, announceRollback, announceFailure, isConversationsAvailable } from "./lib/conversations-integration.js";
export { trackDeploymentCost, isEconomyAvailable } from "./lib/economy-integration.js";

// Providers
export { VercelProvider } from "./lib/vercel.js";
export { CloudflareProvider } from "./lib/cloudflare.js";
export { RailwayProvider } from "./lib/railway.js";
export { FlyioProvider } from "./lib/flyio.js";
export { AwsProvider } from "./lib/aws.js";
export { DigitalOceanProvider } from "./lib/digitalocean.js";
