import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

const API = "https://backboard.railway.com/graphql/v2";

export class RailwayProvider implements DeploymentProviderInterface {
  type = "railway" as const;
  private token = "";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.token = credentials["token"] ?? "";
    if (!this.token) throw new Error("Railway: token is required");

    const res = await this.gql("query { me { id name } }");
    if (!res.data?.me) throw new Error("Railway: authentication failed");
  }

  async createProject(name: string, _config?: Record<string, unknown>): Promise<string> {
    const res = await this.gql(
      `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }`,
      { input: { name } }
    );
    return res.data.projectCreate.id as string;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.gql(`mutation($id: String!) { projectDelete(id: $id) }`, { id: projectId });
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    if (opts.image) {
      const res = await this.gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        {
          input: {
            projectId: opts.projectId,
            source: { image: opts.image },
            name: opts.config?.["name"] ?? "app",
          },
        }
      );
      const serviceId = res.data.serviceCreate.id as string;
      return {
        deploymentId: serviceId,
        url: "",
        status: "deploying",
      };
    }

    if (opts.source) {
      const res = await this.gql(
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
        {
          input: {
            projectId: opts.projectId,
            source: { repo: opts.source },
            name: opts.config?.["name"] ?? "app",
          },
        }
      );
      const serviceId = res.data.serviceCreate.id as string;
      return {
        deploymentId: serviceId,
        url: "",
        status: "deploying",
      };
    }

    throw new Error("Railway: either image or source is required for deploy");
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const res = await this.gql(
      `query($id: String!) { deployments(serviceId: $id, first: 1) { edges { node { status } } } }`,
      { id: deploymentId }
    );
    const status = res.data?.deployments?.edges?.[0]?.node?.status ?? "UNKNOWN";
    return mapRailwayStatus(status as string);
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const res = await this.gql(
      `query($id: String!) { deploymentLogs(deploymentId: $id) { message } }`,
      { id: deploymentId }
    );
    const logs = res.data?.deploymentLogs ?? [];
    return (logs as { message: string }[]).map((l) => l.message).join("\n");
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const res = await this.gql(
      `mutation($id: String!) { deploymentRollback(id: $id) { id } }`,
      { id: deploymentId }
    );
    return {
      deploymentId: res.data.deploymentRollback.id as string,
      url: "",
      status: "deploying",
    };
  }

  async provisionResource(
    type: ResourceType,
    name: string,
    config?: Record<string, unknown>
  ): Promise<ProvisionResult> {
    const projectId = config?.["project_id"] as string;
    if (!projectId) throw new Error("Railway: project_id required in config for provisioning");

    const pluginMap: Record<string, string> = {
      database: "postgresql",
      cache: "redis",
    };

    const plugin = pluginMap[type];
    if (!plugin) throw new Error(`Railway: unsupported resource type: ${type}`);

    const res = await this.gql(
      `mutation($input: PluginCreateInput!) { pluginCreate(input: $input) { id } }`,
      { input: { projectId, name: plugin } }
    );
    const resourceId = res.data.pluginCreate.id as string;

    return {
      resourceId,
      type,
      name,
      config: config ?? {},
    };
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.gql(`mutation($id: String!) { pluginDelete(id: $id) }`, { id: resourceId });
  }

  async listResources(): Promise<ProvisionResult[]> {
    return [];
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(vars)) {
      await this.gql(
        `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
        { input: { projectId, name: key, value } }
      );
    }
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.gql(
      `query($id: String!) { variables(projectId: $id) { edges { node { name value } } } }`,
      { id: projectId }
    );
    const result: Record<string, string> = {};
    for (const edge of res.data?.variables?.edges ?? []) {
      const node = edge.node as { name: string; value: string };
      result[node.name] = node.value;
    }
    return result;
  }

  async getDomains(projectId: string): Promise<string[]> {
    const res = await this.gql(
      `query($id: String!) { customDomains(projectId: $id) { edges { node { domain } } } }`,
      { id: projectId }
    );
    return (res.data?.customDomains?.edges ?? []).map(
      (e: { node: { domain: string } }) => e.node.domain
    );
  }

  async addDomain(projectId: string, domain: string): Promise<void> {
    await this.gql(
      `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id } }`,
      { input: { projectId, domain } }
    );
  }

  async removeDomain(_projectId: string, domain: string): Promise<void> {
    await this.gql(
      `mutation($id: String!) { customDomainDelete(id: $id) }`,
      { id: domain }
    );
  }

  private async gql(
    query: string,
    variables?: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ data: any }> {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`Railway GraphQL: ${res.status} — ${text}`);
    }

    const json = (await res.json()) as { data: unknown; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`Railway GraphQL: ${json.errors[0]!.message}`);
    }

    return json as { data: unknown };
  }
}

function mapRailwayStatus(status: string): DeploymentStatus {
  switch (status) {
    case "WAITING":
    case "QUEUED":
      return "pending";
    case "BUILDING":
      return "building";
    case "DEPLOYING":
      return "deploying";
    case "SUCCESS":
    case "RUNNING":
      return "live";
    case "FAILED":
    case "CRASHED":
      return "failed";
    case "REMOVED":
    case "CANCELLED":
      return "cancelled";
    default:
      return "pending";
  }
}
