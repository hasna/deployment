import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";
import {
  resolveCredentials,
  signRequest,
  type AwsCredentials,
} from "./aws-auth.js";

export class AwsProvider implements DeploymentProviderInterface {
  type = "aws" as const;
  private credentials: AwsCredentials | null = null;

  /**
   * Connect using the credential chain.
   * Accepts explicit creds or falls through to env → OIDC → shared file → IMDS.
   */
  async connect(credentials: Record<string, string>): Promise<void> {
    this.credentials = await resolveCredentials(credentials);

    // Validate by calling STS GetCallerIdentity
    const res = await this.awsApi("sts", "GetCallerIdentity", {});
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWS: authentication failed (${res.status}): ${text}`);
    }
  }

  /**
   * Get the current caller identity (account, ARN, user ID).
   */
  async getCallerIdentity(): Promise<{ account: string; arn: string; userId: string }> {
    const res = await this.awsApi("sts", "GetCallerIdentity", {});
    const data = (await res.json()) as {
      GetCallerIdentityResponse?: {
        GetCallerIdentityResult?: {
          Account: string;
          Arn: string;
          UserId: string;
        };
      };
    };
    const result = data.GetCallerIdentityResponse?.GetCallerIdentityResult;
    return {
      account: result?.Account ?? "",
      arn: result?.Arn ?? "",
      userId: result?.UserId ?? "",
    };
  }

  async createProject(name: string, config?: Record<string, unknown>): Promise<string> {
    const serviceType = (config?.["service_type"] as string) ?? "ecs";

    if (serviceType === "lambda") {
      const res = await this.awsApi("lambda", "CreateFunction", {
        FunctionName: name,
        Runtime: (config?.["runtime"] as string) ?? "nodejs20.x",
        Handler: (config?.["handler"] as string) ?? "index.handler",
        Role: config?.["role"] as string,
      });
      const data = (await res.json()) as { FunctionArn: string };
      return data.FunctionArn ?? name;
    }

    const res = await this.awsApi("ecs", "CreateCluster", { clusterName: name });
    const data = (await res.json()) as { cluster: { clusterArn: string } };
    return data.cluster?.clusterArn ?? name;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.awsApi("ecs", "DeleteCluster", { cluster: projectId });
  }

  async deploy(opts: DeployOptions): Promise<DeployResult> {
    const taskDef = opts.config?.["task_definition"] as string;
    const cluster = (opts.config?.["cluster"] as string) ?? opts.projectId;
    const service = (opts.config?.["service"] as string) ?? "app";

    if (taskDef) {
      await this.awsApi("ecs", "UpdateService", {
        cluster,
        service,
        taskDefinition: taskDef,
        forceNewDeployment: true,
      });

      return {
        deploymentId: `${cluster}/${service}`,
        url: "",
        status: "deploying",
      };
    }

    if (opts.image) {
      const registerRes = await this.awsApi("ecs", "RegisterTaskDefinition", {
        family: service,
        containerDefinitions: [
          {
            name: service,
            image: opts.image,
            essential: true,
            portMappings: [
              { containerPort: Number(opts.config?.["port"] ?? 8080), protocol: "tcp" },
            ],
            environment: Object.entries(opts.envVars ?? {}).map(([name, value]) => ({
              name,
              value,
            })),
          },
        ],
        requiresCompatibilities: ["FARGATE"],
        networkMode: "awsvpc",
        cpu: String(opts.config?.["cpu"] ?? "256"),
        memory: String(opts.config?.["memory"] ?? "512"),
      });

      const taskDefData = (await registerRes.json()) as {
        taskDefinition: { taskDefinitionArn: string };
      };
      const newTaskDef = taskDefData.taskDefinition.taskDefinitionArn;

      await this.awsApi("ecs", "UpdateService", {
        cluster,
        service,
        taskDefinition: newTaskDef,
        forceNewDeployment: true,
      });

      return {
        deploymentId: `${cluster}/${service}`,
        url: "",
        status: "deploying",
      };
    }

    throw new Error("AWS: image or task_definition required for deploy");
  }

  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus> {
    const [cluster, service] = deploymentId.split("/");
    const res = await this.awsApi("ecs", "DescribeServices", {
      cluster,
      services: [service],
    });
    const data = (await res.json()) as {
      services: { deployments: { status: string; rolloutState: string }[] }[];
    };
    const deployment = data.services?.[0]?.deployments?.[0];
    if (!deployment) return "failed";

    return mapAwsStatus(deployment.rolloutState ?? deployment.status);
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const [cluster, service] = deploymentId.split("/");
    const logGroup = `/ecs/${cluster}-${service}`;

    const res = await this.awsApi("logs", "GetLogEvents", {
      logGroupName: logGroup,
      logStreamName: "latest",
      limit: 100,
    });
    const data = (await res.json()) as { events: { message: string }[] };
    return (data.events ?? []).map((e) => e.message).join("\n");
  }

  async rollback(deploymentId: string): Promise<DeployResult> {
    const [cluster, service] = deploymentId.split("/");

    const res = await this.awsApi("ecs", "DescribeServices", {
      cluster,
      services: [service],
    });
    const data = (await res.json()) as {
      services: { taskDefinition: string; deployments: { taskDefinition: string }[] }[];
    };

    const previousTaskDef = data.services?.[0]?.deployments?.[1]?.taskDefinition;
    if (!previousTaskDef) throw new Error("AWS: no previous deployment to rollback to");

    await this.awsApi("ecs", "UpdateService", {
      cluster,
      service,
      taskDefinition: previousTaskDef,
      forceNewDeployment: true,
    });

    return {
      deploymentId: `${cluster}/${service}`,
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
      const res = await this.awsApi("rds", "CreateDBInstance", {
        DBInstanceIdentifier: name,
        DBInstanceClass: (config?.["instance_class"] as string) ?? "db.t3.micro",
        Engine: (config?.["engine"] as string) ?? "postgres",
        MasterUsername: (config?.["username"] as string) ?? "postgres",
        MasterUserPassword: (config?.["password"] as string) ?? "",
        AllocatedStorage: Number(config?.["storage_gb"] ?? 20),
        PubliclyAccessible: false,
      });
      const data = (await res.json()) as {
        DBInstance: {
          DBInstanceIdentifier: string;
          Endpoint: { Address: string; Port: number };
        };
      };
      const endpoint = data.DBInstance?.Endpoint;
      return {
        resourceId: data.DBInstance?.DBInstanceIdentifier ?? name,
        type,
        name,
        config: config ?? {},
        connectionString: endpoint
          ? `postgres://${config?.["username"] ?? "postgres"}@${endpoint.Address}:${endpoint.Port}/${name}`
          : undefined,
      };
    }

    if (type === "cache") {
      await this.awsApi("elasticache", "CreateCacheCluster", {
        CacheClusterId: name,
        Engine: "redis",
        CacheNodeType: (config?.["node_type"] as string) ?? "cache.t3.micro",
        NumCacheNodes: 1,
      });
      return { resourceId: name, type, name, config: config ?? {} };
    }

    if (type === "storage") {
      await this.awsApi("s3", "CreateBucket", {
        Bucket: name,
        CreateBucketConfiguration: { LocationConstraint: this.getRegion() },
      });
      return { resourceId: name, type, name, config: config ?? {} };
    }

    if (type === "queue") {
      const res = await this.awsApi("sqs", "CreateQueue", {
        QueueName: name,
      });
      const data = (await res.json()) as { QueueUrl: string };
      return { resourceId: data.QueueUrl ?? name, type, name, config: config ?? {} };
    }

    throw new Error(`AWS: unsupported resource type: ${type}`);
  }

  async destroyResource(resourceId: string): Promise<void> {
    await this.awsApi("rds", "DeleteDBInstance", {
      DBInstanceIdentifier: resourceId,
      SkipFinalSnapshot: true,
    });
  }

  async listResources(): Promise<ProvisionResult[]> {
    return [];
  }

  async setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(vars)) {
      await this.awsApi("ssm", "PutParameter", {
        Name: `/deployment/${projectId}/${key}`,
        Value: value,
        Type: "SecureString",
        Overwrite: true,
      });
    }
  }

  async getEnvVars(projectId: string): Promise<Record<string, string>> {
    const res = await this.awsApi("ssm", "GetParametersByPath", {
      Path: `/deployment/${projectId}/`,
      WithDecryption: true,
    });
    const data = (await res.json()) as {
      Parameters: { Name: string; Value: string }[];
    };
    const result: Record<string, string> = {};
    for (const param of data.Parameters ?? []) {
      const key = param.Name.split("/").pop() ?? param.Name;
      result[key] = param.Value;
    }
    return result;
  }

  async getDomains(_projectId: string): Promise<string[]> {
    return [];
  }

  async addDomain(_projectId: string, _domain: string): Promise<void> {
    // AWS domain management via Route53 — defer to direct API
  }

  async removeDomain(_projectId: string, _domain: string): Promise<void> {
    // AWS domain management via Route53 — defer to direct API
  }

  // ── Secrets Manager Operations ───────────────────────────────────────────

  /**
   * List secrets by prefix from AWS Secrets Manager.
   */
  async listSecrets(prefix?: string): Promise<{ name: string; arn: string; lastChanged: string }[]> {
    const params: Record<string, unknown> = { MaxResults: 100 };
    if (prefix) {
      params["Filters"] = [{ Key: "name", Values: [prefix] }];
    }

    const res = await this.awsApi("secretsmanager", "ListSecrets", params);
    const data = (await res.json()) as {
      SecretList: { Name: string; ARN: string; LastChangedDate: number }[];
    };

    return (data.SecretList ?? []).map((s) => ({
      name: s.Name,
      arn: s.ARN,
      lastChanged: new Date((s.LastChangedDate ?? 0) * 1000).toISOString(),
    }));
  }

  /**
   * Get a secret value from AWS Secrets Manager.
   */
  async getSecret(secretId: string): Promise<{ name: string; value: string; arn: string }> {
    const res = await this.awsApi("secretsmanager", "GetSecretValue", {
      SecretId: secretId,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWS: GetSecretValue failed for ${secretId}: ${text}`);
    }
    const data = (await res.json()) as {
      Name: string;
      SecretString: string;
      ARN: string;
    };
    return { name: data.Name, value: data.SecretString, arn: data.ARN };
  }

  /**
   * Set/update a secret value in AWS Secrets Manager.
   */
  async putSecret(secretId: string, value: string): Promise<void> {
    const res = await this.awsApi("secretsmanager", "PutSecretValue", {
      SecretId: secretId,
      SecretString: value,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AWS: PutSecretValue failed for ${secretId}: ${text}`);
    }
  }

  /**
   * Describe ECS services — returns running/desired task counts and deployment status.
   */
  async describeEcsServices(
    cluster: string,
    services: string[]
  ): Promise<
    {
      name: string;
      status: string;
      runningCount: number;
      desiredCount: number;
      pendingCount: number;
      deployments: { status: string; rolloutState: string; taskDefinition: string }[];
    }[]
  > {
    const res = await this.awsApi("ecs", "DescribeServices", { cluster, services });
    const data = (await res.json()) as {
      services: {
        serviceName: string;
        status: string;
        runningCount: number;
        desiredCount: number;
        pendingCount: number;
        deployments: { status: string; rolloutState: string; taskDefinition: string }[];
      }[];
    };
    return (data.services ?? []).map((s) => ({
      name: s.serviceName,
      status: s.status,
      runningCount: s.runningCount,
      desiredCount: s.desiredCount,
      pendingCount: s.pendingCount,
      deployments: s.deployments ?? [],
    }));
  }

  /**
   * Tail CloudWatch logs for an ECS service.
   */
  async tailLogs(
    logGroup: string,
    options?: { filterPattern?: string; startTime?: number; limit?: number }
  ): Promise<{ timestamp: string; message: string }[]> {
    const params: Record<string, unknown> = {
      logGroupName: logGroup,
      limit: options?.limit ?? 50,
      interleaved: true,
    };
    if (options?.filterPattern) params["filterPattern"] = options.filterPattern;
    if (options?.startTime) params["startTime"] = options.startTime;

    const res = await this.awsApi("logs", "FilterLogEvents", params);
    const data = (await res.json()) as {
      events: { timestamp: number; message: string }[];
    };

    return (data.events ?? []).map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      message: e.message.trim(),
    }));
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private getRegion(): string {
    return this.credentials?.region ?? "us-east-1";
  }

  private ensureConnected(): AwsCredentials {
    if (!this.credentials) {
      throw new Error("AWS: not connected. Call connect() first.");
    }
    return this.credentials;
  }

  private async awsApi(
    service: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<Response> {
    const creds = this.ensureConnected();
    const endpoint = `https://${service}.${creds.region}.amazonaws.com`;
    const body = JSON.stringify(params);

    const signed = signRequest("POST", endpoint, service, body, creds, {
      "X-Amz-Target": `${getServiceTarget(service)}.${action}`,
    });

    return fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    });
  }
}

function getServiceTarget(service: string): string {
  const targets: Record<string, string> = {
    ecs: "AmazonEC2ContainerServiceV20141113",
    rds: "AmazonRDSv19",
    elasticache: "AmazonElastiCache",
    s3: "AmazonS3",
    sqs: "AmazonSQS",
    ssm: "AmazonSSM",
    sts: "AWSSecurityTokenServiceV20110615",
    logs: "Logs_20140328",
    lambda: "AWSLambda",
    secretsmanager: "secretsmanager",
  };
  return targets[service] ?? service;
}

function mapAwsStatus(status: string): DeploymentStatus {
  switch (status) {
    case "IN_PROGRESS":
      return "deploying";
    case "COMPLETED":
      return "live";
    case "FAILED":
      return "failed";
    case "PRIMARY":
    case "ACTIVE":
      return "live";
    default:
      return "pending";
  }
}
