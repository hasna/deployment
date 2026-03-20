import type {
  DeploymentProviderInterface,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  ResourceType,
  ProvisionResult,
} from "../types/index.js";

export class AwsProvider implements DeploymentProviderInterface {
  type = "aws" as const;
  private region = "us-east-1";
  private accessKeyId = "";
  private secretAccessKey = "";

  async connect(credentials: Record<string, string>): Promise<void> {
    this.accessKeyId = credentials["access_key_id"] ?? "";
    this.secretAccessKey = credentials["secret_access_key"] ?? "";
    this.region = credentials["region"] ?? "us-east-1";

    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error("AWS: access_key_id and secret_access_key are required");
    }

    const res = await this.awsApi("sts", "GetCallerIdentity", {});
    if (!res.ok) throw new Error(`AWS: authentication failed (${res.status})`);
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
    const cluster = opts.config?.["cluster"] as string ?? opts.projectId;
    const service = opts.config?.["service"] as string ?? "app";

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
      const data = (await res.json()) as { DBInstance: { DBInstanceIdentifier: string; Endpoint: { Address: string; Port: number } } };
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
        CreateBucketConfiguration: { LocationConstraint: this.region },
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
    // AWS domain management via Route53 is complex — defer to direct API
  }

  async removeDomain(_projectId: string, _domain: string): Promise<void> {
    // AWS domain management via Route53 is complex — defer to direct API
  }

  private async awsApi(
    service: string,
    action: string,
    params: Record<string, unknown>
  ): Promise<Response> {
    const endpoint = `https://${service}.${this.region}.amazonaws.com`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `${getServiceTarget(service)}.${action}`,
        Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}`,
      },
      body: JSON.stringify(params),
    });

    return res;
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
