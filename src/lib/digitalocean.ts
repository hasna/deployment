import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

const API = "https://api.digitalocean.com/v2";

export class DigitalOceanProvider implements DeploymentProviderInterface {
  type = "digitalocean" as const;
  private token = "";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.token = credentials["token"] ?? "";
    if (!this.token) throw new Error("DigitalOcean: token is required");

    const res = await this.api("/account");
    if (!res.ok) throw new Error(`DigitalOcean: authentication failed (${res.status})`);
  }

  async createProject(name: string, config?: Record<string, unknown>): Promise<string> {
    const useAppPlatform = config?.["type"] !== "droplet";

    if (useAppPlatform) {
      const spec = {
        name,
        region: (config?.["region"] as string) ?? "nyc",
        services: [
          {
            name: "app",
            ...(config?.["image"]
              ? { image: { registry_type: "DOCR", repository: config["image"] } }
              : { github: { repo: config?.["repo"] as string, branch: config?.["branch"] ?? "main" } }),
            instance_count: 1,
            instance_size_slug: (config?.["size"] as string) ?? "apps-s-1vcpu-0.5gb",
            http_port: Number(config?.["port"] ?? 8080),
          },
        ],
      };

      const res = await this.api("/apps", "POST", { spec });
      const data = (await res.json()) as { app: { id: string } };
      return data.app.id;
    }

    const res = await this.api("/droplets", "POST", {
      name,
      region: (config?.["region"] as string) ?? "nyc3",
      size: (config?.["size"] as string) ?? "s-1vcpu-1gb",
      image: (config?.["image"] as string) ?? "ubuntu-24-04-x64",
    });
    const data = (await res.json()) as { droplet: { id: number } };
    return String(data.droplet.id);
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.api(`/apps/${projectId}`, "DELETE");
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const res = await this.api(`/apps/${opts.projectId}/deployments`, "POST", {
      force_build: true,
    });
    const data = (await res.json()) as { deployment: { id: string } };

    return {
      deploymentId: data.deployment.id,
      url: "",
      status: "deploying",
    };
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const [appId, depId] = deploymentId.split("/");
    const res = await this.api(`/apps/${appId}/deployments/${depId}`);
    const data = (await res.json()) as { deployment: { phase: string } };
    return mapDoStatus(data.deployment?.phase ?? "UNKNOWN");
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const [appId, depId] = deploymentId.split("/");
    const res = await this.api(`/apps/${appId}/deployments/${depId}/logs?type=BUILD`);
    const data = (await res.json()) as { historic_urls: string[] };
    return (data.historic_urls ?? []).join("\n");
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const [appId] = deploymentId.split("/");
    const res = await this.api(`/apps/${appId}/rollback`, "POST", {
      deployment_id: deploymentId,
    });
    const data = (await res.json()) as { deployment: { id: string } };
    return {
      deploymentId: data.deployment?.id ?? deploymentId,
      url: "",
      status: "deploying",
    };
  }

  async provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult> {
    if (type === "database") {
      const engine = (config?.["engine"] as string) ?? "pg";
      const res = await this.api("/databases", "POST", {
        name,
        engine,
        size: (config?.["size"] as string) ?? "db-s-1vcpu-1gb",
        region: (config?.["region"] as string) ?? "nyc3",
        num_nodes: 1,
      });
      const data = (await res.json()) as {
        database: { id: string; connection: { uri: string } };
      };
      return {
        resourceId: data.database.id,
        type,
        name,
        config: config ?? {},
        connectionString: data.database.connection?.uri,
      };
    }

    if (type === "cache") {
      const res = await this.api("/databases", "POST", {
        name,
        engine: "redis",
        size: (config?.["size"] as string) ?? "db-s-1vcpu-1gb",
        region: (config?.["region"] as string) ?? "nyc3",
        num_nodes: 1,
      });
      const data = (await res.json()) as {
        database: { id: string; connection: { uri: string } };
      };
      return {
        resourceId: data.database.id,
        type,
        name,
        config: config ?? {},
        connectionString: data.database.connection?.uri,
      };
    }

    if (type === "storage") {
      await this.api("/spaces", "POST", {
        name,
        region: (config?.["region"] as string) ?? "nyc3",
      });
      return { resourceId: name, type, name, config: config ?? {} };
    }

    throw new Error(`DigitalOcean: unsupported resource type: ${type}`);
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.api(`/databases/${resourceId}`, "DELETE");
  }

  async listResources(): Promise<ProvisionResult[]> {
    const res = await this.api("/databases");
    const data = (await res.json()) as {
      databases: { id: string; engine: string; name: string; connection: { uri: string } }[];
    };
    return (data.databases ?? []).map((db) => ({
      resourceId: db.id,
      type: (db.engine === "redis" ? "cache" : "database") as ResourceType,
      name: db.name,
      config: {},
      connectionString: db.connection?.uri,
    }));
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    const res = await this.api(`/apps/${projectId}`);
    const data = (await res.json()) as { app: { spec: Record<string, unknown> } };
    const spec = data.app.spec;

    const envs = Object.entries(vars).map(([key, value]) => ({
      key,
      value,
      scope: "RUN_AND_BUILD_TIME",
      type: "SECRET",
    }));

    const services = (spec["services"] as Record<string, unknown>[]) ?? [];
    if (services[0]) {
      (services[0] as Record<string, unknown>)["envs"] = envs;
    }

    await this.api(`/apps/${projectId}`, "PUT", { spec });
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.api(`/apps/${projectId}`);
    const data = (await res.json()) as {
      app: { spec: { services: { envs: { key: string; value: string }[] }[] } };
    };
    const result: Record<string, string> = {};
    for (const env of data.app?.spec?.services?.[0]?.envs ?? []) {
      result[env.key] = env.value;
    }
    return result;
  }

  async getDomains(projectId: string): Promise<string[]> {
    const res = await this.api(`/apps/${projectId}`);
    const data = (await res.json()) as {
      app: { default_ingress: string; domains: { spec: { domain: string } }[] };
    };
    const domains = (data.app?.domains ?? []).map((d) => d.spec.domain);
    if (data.app?.default_ingress) domains.unshift(data.app.default_ingress);
    return domains;
  }

  async addDomain(projectId: string, domain: string): Promise<void> {
    const res = await this.api(`/apps/${projectId}`);
    const data = (await res.json()) as { app: { spec: Record<string, unknown> } };
    const spec = data.app.spec;
    const domains = (spec["domains"] as { domain: string; type: string }[]) ?? [];
    domains.push({ domain, type: "PRIMARY" });
    spec["domains"] = domains;
    await this.api(`/apps/${projectId}`, "PUT", { spec });
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    const res = await this.api(`/apps/${projectId}`);
    const data = (await res.json()) as { app: { spec: Record<string, unknown> } };
    const spec = data.app.spec;
    spec["domains"] = ((spec["domains"] as { domain: string }[]) ?? []).filter(
      (d) => d.domain !== domain
    );
    await this.api(`/apps/${projectId}`, "PUT", { spec });
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
      throw new Error(`DigitalOcean API ${method} ${path}: ${res.status} — ${text}`);
    }

    return res;
  }
}

function mapDoStatus(phase: string): DeploymentStatus {
  switch (phase) {
    case "PENDING_BUILD":
    case "PENDING_DEPLOY":
      return "pending";
    case "BUILDING":
      return "building";
    case "DEPLOYING":
      return "deploying";
    case "ACTIVE":
      return "live";
    case "ERROR":
    case "FAILED":
      return "failed";
    case "CANCELED":
      return "cancelled";
    default:
      return "pending";
  }
}
