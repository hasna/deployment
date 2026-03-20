// ── Provider Types ──────────────────────────────────────────────────────────

export type ProviderType =
  | "vercel"
  | "cloudflare"
  | "railway"
  | "flyio"
  | "aws"
  | "digitalocean";

// ── Environment Types ───────────────────────────────────────────────────────

export type EnvironmentType = "dev" | "staging" | "prod";

// ── Deployment Status ───────────────────────────────────────────────────────

export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "live"
  | "failed"
  | "rolled_back"
  | "cancelled";

// ── Resource Types ──────────────────────────────────────────────────────────

export type ResourceType =
  | "database"
  | "cache"
  | "storage"
  | "domain"
  | "compute"
  | "queue"
  | "cdn"
  | "dns";

export type ResourceStatus = "provisioning" | "active" | "failed" | "destroyed";

// ── Source Types ────────────────────────────────────────────────────────────

export type SourceType = "git" | "docker" | "local" | "url";

// ── Domain Types ────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  source_type: SourceType;
  source_url: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  type: EnvironmentType;
  provider_id: string;
  region: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  credentials_key: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  environment_id: string;
  version: string;
  status: DeploymentStatus;
  url: string;
  image: string;
  commit_sha: string;
  logs: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

export interface Resource {
  id: string;
  environment_id: string;
  type: ResourceType;
  name: string;
  provider_resource_id: string;
  config: Record<string, unknown>;
  status: ResourceStatus;
  created_at: string;
  updated_at: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  provider_type: ProviderType;
  template: BlueprintTemplate;
  created_at: string;
  updated_at: string;
}

export interface BlueprintTemplate {
  resources: BlueprintResource[];
  env_vars: Record<string, string>;
  deploy_config: Record<string, unknown>;
}

export interface BlueprintResource {
  type: ResourceType;
  name: string;
  config: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  type: "human" | "agent";
  registered_at: string;
  last_seen: string;
}

// ── Row Types (SQLite) ──────────────────────────────────────────────────────

export interface ProjectRow {
  id: string;
  name: string;
  source_type: string;
  source_url: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  type: string;
  provider_id: string;
  region: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  credentials_key: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface DeploymentRow {
  id: string;
  project_id: string;
  environment_id: string;
  version: string;
  status: string;
  url: string;
  image: string;
  commit_sha: string;
  logs: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

export interface ResourceRow {
  id: string;
  environment_id: string;
  type: string;
  name: string;
  provider_resource_id: string;
  config: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BlueprintRow {
  id: string;
  name: string;
  description: string;
  provider_type: string;
  template: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  type: string;
  registered_at: string;
  last_seen: string;
}

// ── Input Types ─────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  name: string;
  source_type: SourceType;
  source_url: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  source_type?: SourceType;
  source_url?: string;
  description?: string;
}

export interface CreateEnvironmentInput {
  project_id: string;
  name: string;
  type: EnvironmentType;
  provider_id: string;
  region?: string;
  config?: Record<string, unknown>;
}

export interface UpdateEnvironmentInput {
  name?: string;
  type?: EnvironmentType;
  provider_id?: string;
  region?: string;
  config?: Record<string, unknown>;
}

export interface CreateProviderInput {
  name: string;
  type: ProviderType;
  credentials_key: string;
  config?: Record<string, unknown>;
}

export interface UpdateProviderInput {
  name?: string;
  credentials_key?: string;
  config?: Record<string, unknown>;
}

export interface CreateDeploymentInput {
  project_id: string;
  environment_id: string;
  version?: string;
  image?: string;
  commit_sha?: string;
}

export interface UpdateDeploymentInput {
  status?: DeploymentStatus;
  url?: string;
  logs?: string;
  started_at?: string;
  completed_at?: string;
}

export interface CreateResourceInput {
  environment_id: string;
  type: ResourceType;
  name: string;
  provider_resource_id?: string;
  config?: Record<string, unknown>;
}

export interface UpdateResourceInput {
  name?: string;
  provider_resource_id?: string;
  config?: Record<string, unknown>;
  status?: ResourceStatus;
}

export interface CreateBlueprintInput {
  name: string;
  description?: string;
  provider_type: ProviderType;
  template: BlueprintTemplate;
}

export interface UpdateBlueprintInput {
  name?: string;
  description?: string;
  template?: BlueprintTemplate;
}

export interface RegisterAgentInput {
  name: string;
  type?: "human" | "agent";
}

// ── Filter Types ────────────────────────────────────────────────────────────

export interface ProjectFilter {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EnvironmentFilter {
  project_id?: string;
  type?: EnvironmentType;
  limit?: number;
  offset?: number;
}

export interface ProviderFilter {
  type?: ProviderType;
  limit?: number;
  offset?: number;
}

export interface DeploymentFilter {
  project_id?: string;
  environment_id?: string;
  status?: DeploymentStatus;
  limit?: number;
  offset?: number;
}

export interface ResourceFilter {
  environment_id?: string;
  type?: ResourceType;
  status?: ResourceStatus;
  limit?: number;
  offset?: number;
}

export interface BlueprintFilter {
  provider_type?: ProviderType;
  limit?: number;
  offset?: number;
}

// ── Error Classes ───────────────────────────────────────────────────────────

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export class EnvironmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Environment not found: ${id}`);
    this.name = "EnvironmentNotFoundError";
  }
}

export class ProviderNotFoundError extends Error {
  constructor(id: string) {
    super(`Provider not found: ${id}`);
    this.name = "ProviderNotFoundError";
  }
}

export class DeploymentNotFoundError extends Error {
  constructor(id: string) {
    super(`Deployment not found: ${id}`);
    this.name = "DeploymentNotFoundError";
  }
}

export class DeploymentFailedError extends Error {
  constructor(id: string, reason: string) {
    super(`Deployment failed (${id}): ${reason}`);
    this.name = "DeploymentFailedError";
  }
}

export class ResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Resource not found: ${id}`);
    this.name = "ResourceNotFoundError";
  }
}

export class BlueprintNotFoundError extends Error {
  constructor(id: string) {
    super(`Blueprint not found: ${id}`);
    this.name = "BlueprintNotFoundError";
  }
}

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

// ── Provider Interface ──────────────────────────────────────────────────────

export interface DeploymentProviderInterface {
  type: ProviderType;

  connect(credentials: Record<string, string>): Promise<void>;

  createProject(name: string, config?: Record<string, unknown>): Promise<string>;
  deleteProject(projectId: string): Promise<void>;

  deploy(opts: DeployOptions): Promise<DeployResult>;
  getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus>;
  getDeploymentLogs(deploymentId: string): Promise<string>;
  rollback(deploymentId: string): Promise<DeployResult>;

  provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult>;
  destroyResource(resourceId: string): Promise<void>;
  listResources(): Promise<ProvisionResult[]>;

  setEnvVars(
    projectId: string,
    vars: Record<string, string>
  ): Promise<void>;
  getEnvVars(projectId: string): Promise<Record<string, string>>;

  getDomains(projectId: string): Promise<string[]>;
  addDomain(projectId: string, domain: string): Promise<void>;
  removeDomain(projectId: string, domain: string): Promise<void>;
}

export interface DeployOptions {
  projectId: string;
  environmentId?: string;
  image?: string;
  source?: string;
  commitSha?: string;
  envVars?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface DeployResult {
  deploymentId: string;
  url: string;
  status: DeploymentStatus;
}

export interface ProvisionResult {
  resourceId: string;
  type: ResourceType;
  name: string;
  config: Record<string, unknown>;
  connectionString?: string;
}
