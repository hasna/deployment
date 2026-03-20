import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

const API = "https://api.cloudflare.com/client/v4";

export class CloudflareProvider implements DeploymentProviderInterface {
  type = "cloudflare" as const;
  private token = "";
  private accountId = "";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.token = credentials["token"] ?? "";
    this.accountId = credentials["account_id"] ?? "";
    if (!this.token) throw new Error("Cloudflare: token is required");
    if (!this.accountId) throw new Error("Cloudflare: account_id is required");

    const res = await this.api("/user/tokens/verify");
    const data = (await res.json()) as { success: boolean };
    if (!data.success) throw new Error("Cloudflare: authentication failed");
  }

  async createProject(name: string, config?: Record<string, unknown>): Promise<string> {
    const isWorker = config?.["type"] === "worker";

    if (isWorker) {
      await this.api(`/accounts/${this.accountId}/workers/scripts/${name}`, "PUT", "export default { fetch() { return new Response('ok'); } }", "application/javascript");
      return name;
    }

    const res = await this.api(`/accounts/${this.accountId}/pages/projects`, "POST", {
      name,
      production_branch: config?.["branch"] ?? "main",
    });
    const data = (await res.json()) as { result: { name: string } };
    return data.result.name;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.api(`/accounts/${this.accountId}/pages/projects/${projectId}`, "DELETE");
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const isWorker = opts.config?.["type"] === "worker";

    if (isWorker) {
      const script = opts.config?.["script"] as string ?? "";
      await this.api(
        `/accounts/${this.accountId}/workers/scripts/${opts.projectId}`,
        "PUT",
        script,
        "application/javascript"
      );
      return {
        deploymentId: `${opts.projectId}-${Date.now()}`,
        url: `https://${opts.projectId}.${this.accountId}.workers.dev`,
        status: "live",
      };
    }

    const res = await this.api(
      `/accounts/${this.accountId}/pages/projects/${opts.projectId}/deployments`,
      "POST",
      { branch: opts.commitSha ?? "main" }
    );
    const data = (await res.json()) as { result: { id: string; url: string } };
    return {
      deploymentId: data.result.id,
      url: data.result.url,
      status: "deploying",
    };
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const [projectName] = deploymentId.split("/");
    const res = await this.api(
      `/accounts/${this.accountId}/pages/projects/${projectName}/deployments/${deploymentId}`
    );
    const data = (await res.json()) as { result: { latest_stage: { status: string } } };
    return mapCloudflareStatus(data.result?.latest_stage?.status ?? "active");
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    return `[Cloudflare] Deployment ${deploymentId} — logs available via Cloudflare dashboard`;
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const res = await this.api(
      `/accounts/${this.accountId}/pages/projects/${deploymentId}/deployments`,
      "POST",
      { rollback: true }
    );
    const data = (await res.json()) as { result: { id: string; url: string } };
    return {
      deploymentId: data.result.id,
      url: data.result.url,
      status: "deploying",
    };
  }

  async provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult> {
    if (type === "cache") {
      const res = await this.api(`/accounts/${this.accountId}/storage/kv/namespaces`, "POST", {
        title: name,
      });
      const data = (await res.json()) as { result: { id: string } };
      return { resourceId: data.result.id, type, name, config: config ?? {} };
    }
    if (type === "storage") {
      const res = await this.api(`/accounts/${this.accountId}/r2/buckets`, "POST", { name });
      const data = (await res.json()) as { result: { name: string } };
      return { resourceId: data.result.name, type, name, config: config ?? {} };
    }
    if (type === "database") {
      const res = await this.api(`/accounts/${this.accountId}/d1/database`, "POST", { name });
      const data = (await res.json()) as { result: { uuid: string } };
      return { resourceId: data.result.uuid, type, name, config: config ?? {} };
    }
    throw new Error(`Cloudflare: unsupported resource type: ${type}`);
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.api(`/accounts/${this.accountId}/storage/kv/namespaces/${resourceId}`, "DELETE");
  }

  async listResources(): Promise<ProvisionResult[]> {
    const [kvRes, r2Res] = await Promise.all([
      this.api(`/accounts/${this.accountId}/storage/kv/namespaces`),
      this.api(`/accounts/${this.accountId}/r2/buckets`),
    ]);
    const kvData = (await kvRes.json()) as { result: { id: string; title: string }[] };
    const r2Data = (await r2Res.json()) as { result: { buckets: { name: string }[] } };

    const resources: ProvisionResult[] = [];
    for (const kv of kvData.result ?? []) {
      resources.push({ resourceId: kv.id, type: "cache", name: kv.title, config: {} });
    }
    for (const bucket of r2Data.result?.buckets ?? []) {
      resources.push({ resourceId: bucket.name, type: "storage", name: bucket.name, config: {} });
    }
    return resources;
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    const envVars: Record<string, { value: string; type: string }> = {};
    for (const [key, value] of Object.entries(vars)) {
      envVars[key] = { value, type: "secret_text" };
    }
    await this.api(
      `/accounts/${this.accountId}/pages/projects/${projectId}`,
      "PATCH",
      { deployment_configs: { production: { env_vars: envVars } } }
    );
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.api(`/accounts/${this.accountId}/pages/projects/${projectId}`);
    const data = (await res.json()) as {
      result: { deployment_configs: { production: { env_vars: Record<string, { value: string }> } } };
    };
    const result: Record<string, string> = {};
    const envVars = data.result?.deployment_configs?.production?.env_vars ?? {};
    for (const [key, val] of Object.entries(envVars)) {
      result[key] = val.value;
    }
    return result;
  }

  async getDomains(projectId: string): Promise<string[]> {
    const res = await this.api(`/accounts/${this.accountId}/pages/projects/${projectId}/domains`);
    const data = (await res.json()) as { result: { name: string }[] };
    return (data.result ?? []).map((d) => d.name);
  }

  async addDomain(projectId: string, domain: string): Promise<void> {
    await this.api(`/accounts/${this.accountId}/pages/projects/${projectId}/domains`, "POST", {
      name: domain,
    });
  }

  async removeDomain(projectId: string, domain: string): Promise<void> {
    await this.api(
      `/accounts/${this.accountId}/pages/projects/${projectId}/domains/${domain}`,
      "DELETE"
    );
  }

  private async api(
    path: string,
    method = "GET",
    body?: unknown,
    contentType = "application/json"
  ): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": contentType,
      },
      body: body
        ? typeof body === "string"
          ? body
          : JSON.stringify(body)
        : undefined,
    });

    if (!res.ok && method !== "DELETE") {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Cloudflare API ${method} ${path}: ${res.status} — ${text}`);
    }

    return res;
  }
}

function mapCloudflareStatus(status: string): DeploymentStatus {
  switch (status) {
    case "idle":
    case "queued":
      return "pending";
    case "active":
      return "deploying";
    case "success":
      return "live";
    case "failure":
      return "failed";
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}
