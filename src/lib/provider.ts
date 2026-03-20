import type {
  ProviderType,
  DeploymentProviderInterface,
} from "../types/index.js";

const providers = new Map<ProviderType, DeploymentProviderInterface>();

export function registerProvider(provider: DeploymentProviderInterface): void {
  providers.set(provider.type, provider);
}

export function getProvider(type: ProviderType): DeploymentProviderInterface {
  const provider = providers.get(type);
  if (!provider) {
    throw new Error(
      `Provider not registered: ${type}. Available: ${[...providers.keys()].join(", ") || "none"}`
    );
  }
  return provider;
}

export function listRegisteredProviders(): ProviderType[] {
  return [...providers.keys()];
}

export function hasProvider(type: ProviderType): boolean {
  return providers.has(type);
}

export function clearProviders(): void {
  providers.clear();
}

export function createBaseProvider(type: ProviderType): Partial<DeploymentProviderInterface> {
  return {
    type,
    async connect() {
      throw new Error(`${type}: connect() not implemented`);
    },
    async createProject() {
      throw new Error(`${type}: createProject() not implemented`);
    },
    async deleteProject() {
      throw new Error(`${type}: deleteProject() not implemented`);
    },
    async deploy() {
      throw new Error(`${type}: deploy() not implemented`);
    },
    async getDeploymentStatus() {
      throw new Error(`${type}: getDeploymentStatus() not implemented`);
    },
    async getDeploymentLogs() {
      throw new Error(`${type}: getDeploymentLogs() not implemented`);
    },
    async rollback() {
      throw new Error(`${type}: rollback() not implemented`);
    },
    async provisionResource() {
      throw new Error(`${type}: provisionResource() not implemented`);
    },
    async destroyResource() {
      throw new Error(`${type}: destroyResource() not implemented`);
    },
    async listResources() {
      throw new Error(`${type}: listResources() not implemented`);
    },
    async setEnvVars() {
      throw new Error(`${type}: setEnvVars() not implemented`);
    },
    async getEnvVars() {
      throw new Error(`${type}: getEnvVars() not implemented`);
    },
    async getDomains() {
      throw new Error(`${type}: getDomains() not implemented`);
    },
    async addDomain() {
      throw new Error(`${type}: addDomain() not implemented`);
    },
    async removeDomain() {
      throw new Error(`${type}: removeDomain() not implemented`);
    },
  };
}
