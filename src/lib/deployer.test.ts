import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";

describe("deployer", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("exports deploy as a function", async () => {
    const { deploy } = await import("./deployer.js");
    expect(typeof deploy).toBe("function");
  });

  it("exports rollback as a function", async () => {
    const { rollback } = await import("./deployer.js");
    expect(typeof rollback).toBe("function");
  });

  it("exports promote as a function", async () => {
    const { promote } = await import("./deployer.js");
    expect(typeof promote).toBe("function");
  });

  it("exports getStatus as a function", async () => {
    const { getStatus } = await import("./deployer.js");
    expect(typeof getStatus).toBe("function");
  });

  it("exports getLogs as a function", async () => {
    const { getLogs } = await import("./deployer.js");
    expect(typeof getLogs).toBe("function");
  });

  it("returns local failure logs before querying provider logs", async () => {
    const { createProject } = await import("../db/projects.js");
    const { createProvider } = await import("../db/providers.js");
    const { createEnvironment } = await import("../db/environments.js");
    const { createDeployment, updateDeployment } = await import("../db/deployments.js");
    const { getLogs } = await import("./deployer.js");

    const project = createProject({ name: "proj", source_type: "git", source_url: "" });
    const provider = createProvider({ name: "aws", type: "aws", credentials_key: "" });
    const environment = createEnvironment({
      project_id: project.id,
      name: "production",
      type: "prod",
      provider_id: provider.id,
    });
    const deployment = createDeployment({
      project_id: project.id,
      environment_id: environment.id,
      version: "failed",
    });
    updateDeployment(deployment.id, {
      status: "failed",
      logs: "AWS: image or task_definition required for deploy",
    });

    await expect(getLogs(project.id, environment.id)).resolves.toBe(
      "AWS: image or task_definition required for deploy"
    );
  });
});
