import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

const API = "https://api.vercel.com";

export class VercelProvider implements DeploymentProviderInterface {
  type = "vercel" as const;
  private token = "";
  private teamId = "";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.token = credentials["token"] ?? "";
    this.teamId = credentials["team_id"] ?? "";
    if (!this.token) throw new Error("Vercel: token is required");

    const res = await this.api("/v2/user");
    if (!res.ok) throw new Error(`Vercel: authentication failed (${res.status})`);
  }

  async createProject(name: string, config?: Record<string, unknown>): Promise<string> {
    const body: Record<string, unknown> = { name, framework: config?.["framework"] ?? null };
    const res = await this.api("/v10/projects", "POST", body);
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.api(`/v9/projects/${projectId}`, "DELETE");
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const body: Record<string, unknown> = {
      name: opts.projectId,
      target: opts.config?.["target"] ?? "production",
      gitSource: opts.source
        ? { type: "github", repo: opts.source, ref: opts.commitSha ?? "main" }
        : undefined,
    };

    if (opts.envVars) {
      body["env"] = opts.envVars;
    }

    const res = await this.api("/v13/deployments", "POST", body);
    const data = (await res.json()) as { id: string; url: string; readyState: string };

    return {
      deploymentId: data.id,
      url: `https://${data.url}`,
      status: mapVercelStatus(data.readyState),
    };
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const res = await this.api(`/v13/deployments/${deploymentId}`);
    const data = (await res.json()) as { readyState: string };
    return mapVercelStatus(data.readyState);
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const res = await this.api(`/v2/deployments/${deploymentId}/events`);
    const events = (await res.json()) as { text: string }[];
    return events.map((e) => e.text).join("\n");
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const res = await this.api("/v1/deployments/rollback", "POST", {
      deploymentId,
    });
    const data = (await res.json()) as { id: string; url: string };
    return {
      deploymentId: data.id,
      url: `https://${data.url}`,
      status: "deploying",
    };
  }

  async provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult> {
    if (type === "storage") {
      const res = await this.api("/v1/storage/blob", "POST", { name });
      const data = (await res.json()) as { storeId: string };
      return { resourceId: data.storeId, type, name, config: config ?? {} };
    }
    if (type === "database") {
      const res = await this.api("/v1/storage/postgres", "POST", {
        name,
        region: config?.["region"] ?? "iad1",
      });
      const data = (await res.json()) as {
        databaseId: string;
        connectionString: string;
      };
      return {
        resourceId: data.databaseId,
        type,
        name,
        config: config ?? {},
        connectionString: data.connectionString,
      };
    }
    if (type === "cache") {
      const res = await this.api("/v1/storage/kv", "POST", { name });
      const data = (await res.json()) as { storeId: string };
      return { resourceId: data.storeId, type, name, config: config ?? {} };
    }
    throw new Error(`Vercel: unsupported resource type: ${type}`);
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.api(`/v1/storage/${resourceId}`, "DELETE");
  }

  async listResources(): Promise<ProvisionResult[]> {
    const res = await this.api("/v1/storage");
    const data = (await res.json()) as { stores: { id: string; type: string; name: string }[] };
    return (data.stores ?? []).map((s) => ({
      resourceId: s.id,
      type: s.type as ResourceType,
      name: s.name,
      config: {},
    }));
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    const envs = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      target: ["production", "preview", "development"],
      type: "encrypted",
    }));

    await this.api(`/v10/projects/${projectId}/env`, "POST", envs);
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.api(`/v9/projects/${projectId}/env`);
    const data = (await res.json()) as { envs: { key: string; value: string }[] };
    const result: Record<string, string> = {};
    for (const env of data.envs ?? []) {
      result[env.key] = env.value;
    }
    return result;
  }

  async getDomains(projectId: string): Promise<string[]> {
    const res = await this.api(`/v9/projects/${projectId}/domains`);
    const data = (await res.json()) as { domains: { name: string }[] };
    return (data.domains ?? []).map((d) => d.name);
  }

  async addDomain(projectId: string, domain: string): Promise<void> {
    await this.api(`/v10/projects/${projectId}/domains`, "POST", { name: domain });
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    await this.api(`/v9/projects/${projectId}/domains/${domain}`, "DELETE");
  }

  private async api(
    path: string,
    method = "GET",
    body?: unknown
  ): Promise<Response> {
    const url = new URL(path, API);
    if (this.teamId) url.searchParams.set("teamId", this.teamId);

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok && method !== "DELETE") {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Vercel API ${method} ${path}: ${res.status} — ${text}`);
    }

    return res;
  }
}

function mapVercelStatus(state: string): DeploymentStatus {
  switch (state) {
    case "QUEUED":
    case "INITIALIZING":
      return "pending";
    case "BUILDING":
      return "building";
    case "DEPLOYING":
      return "deploying";
    case "READY":
      return "live";
    case "ERROR":
      return "failed";
    case "CANCELED":
      return "cancelled";
    default:
      return "pending";
  }
}
