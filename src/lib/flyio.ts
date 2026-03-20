import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

const API = "https://api.machines.dev/v1";

export class FlyioProvider implements DeploymentProviderInterface {
  type = "flyio" as const;
  private token = "";
  private org = "personal";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.token = credentials["token"] ?? "";
    this.org = credentials["org"] ?? "personal";
    if (!this.token) throw new Error("Fly.io: token is required");

    const res = await this.api("/apps?org_slug=" + this.org);
    if (!res.ok) throw new Error(`Fly.io: authentication failed (${res.status})`);
  }

  async createProject(name: string, config?: Record<string, unknown>): Promise<string> {
    const res = await this.api("/apps", "POST", {
      app_name: name,
      org_slug: this.org,
      network: config?.["network"] ?? "",
    });
    const data = (await res.json()) as { id: string };
    return data.id ?? name;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.api(`/apps/${projectId}`, "DELETE");
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    if (!opts.image) throw new Error("Fly.io: image is required for deploy");

    const machineConfig: Record<string, unknown> = {
      image: opts.image,
      env: opts.envVars ?? {},
      services: [
        {
          ports: [
            { port: 443, handlers: ["tls", "http"] },
            { port: 80, handlers: ["http"] },
          ],
          protocol: "tcp",
          internal_port: Number(opts.config?.["internal_port"] ?? 8080),
        },
      ],
      ...(opts.config?.["size"]
        ? {
            guest: {
              cpus: 1,
              memory_mb: opts.config["size"] === "large" ? 2048 : 512,
              cpu_kind: "shared",
            },
          }
        : {}),
    };

    const res = await this.api(`/apps/${opts.projectId}/machines`, "POST", {
      config: machineConfig,
      region: opts.config?.["region"] ?? "iad",
    });
    const data = (await res.json()) as { id: string; state: string };

    return {
      deploymentId: data.id,
      url: `https://${opts.projectId}.fly.dev`,
      status: mapFlyStatus(data.state),
    };
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const parts = deploymentId.split("/");
    const appName = parts[0] ?? deploymentId;
    const machineId = parts[1] ?? deploymentId;

    const res = await this.api(`/apps/${appName}/machines/${machineId}`);
    const data = (await res.json()) as { state: string };
    return mapFlyStatus(data.state);
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    return `[Fly.io] Machine ${deploymentId} — use 'fly logs -a <app>' for live logs`;
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const parts = deploymentId.split("/");
    const appName = parts[0] ?? deploymentId;
    const machineId = parts[1] ?? deploymentId;

    await this.api(`/apps/${appName}/machines/${machineId}/stop`, "POST");
    return {
      deploymentId: machineId,
      url: `https://${appName}.fly.dev`,
      status: "deploying",
    };
  }

  async provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult> {
    const appName = config?.["app_name"] as string;
    if (!appName) throw new Error("Fly.io: app_name required in config");

    if (type === "storage") {
      const res = await this.api(`/apps/${appName}/volumes`, "POST", {
        name,
        size_gb: Number(config?.["size_gb"] ?? 1),
        region: (config?.["region"] as string) ?? "iad",
      });
      const data = (await res.json()) as { id: string };
      return { resourceId: data.id, type, name, config: config ?? {} };
    }

    if (type === "database") {
      const pgApp = `${appName}-db`;
      await this.api("/apps", "POST", {
        app_name: pgApp,
        org_slug: this.org,
      });
      return {
        resourceId: pgApp,
        type,
        name,
        config: config ?? {},
        connectionString: `postgres://postgres:@${pgApp}.internal:5432`,
      };
    }

    throw new Error(`Fly.io: unsupported resource type: ${type}`);
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.api(`/apps/${resourceId}`, "DELETE");
  }

  async listResources(): Promise<ProvisionResult[]> {
    return [];
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    const machines = await this.api(`/apps/${projectId}/machines`);
    const data = (await machines.json()) as { id: string; config: { env: Record<string, string> } }[];

    for (const machine of data) {
      const merged = { ...machine.config.env, ...vars };
      await this.api(`/apps/${projectId}/machines/${machine.id}`, "PATCH", {
        config: { ...machine.config, env: merged },
      });
    }
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.api(`/apps/${projectId}/machines`);
    const data = (await res.json()) as { config: { env: Record<string, string> } }[];
    return data[0]?.config?.env ?? {};
  }

  async getDomains(projectId: string): Promise<string[]> {
    return [`${projectId}.fly.dev`];
  }

  async addDomain(projectId: string, domain: string): Promise<void> {
    await this.api(`/apps/${projectId}/certificates`, "POST", { hostname: domain });
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    await this.api(`/apps/${projectId}/certificates/${domain}`, "DELETE");
  }

  private async api(path: string, method = "GET", body?: unknown): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok && method !== "DELETE") {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Fly.io API ${method} ${path}: ${res.status} — ${text}`);
    }

    return res;
  }
}

function mapFlyStatus(state: string): DeploymentStatus {
  switch (state) {
    case "created":
    case "stopped":
      return "pending";
    case "starting":
      return "deploying";
    case "started":
    case "running":
      return "live";
    case "failed":
    case "destroyed":
      return "failed";
    default:
      return "pending";
  }
}
