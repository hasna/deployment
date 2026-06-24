import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";
import {
  MCP_SERVER_NAME,
  resetMcpHttpStateForTests,
  startHttpServer,
} from "./http.js";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";
import { createProvider } from "../db/providers.js";
import { createEnvironment } from "../db/environments.js";
import { createDeployment, updateDeployment } from "../db/deployments.js";

const servers: Array<{ stop: () => void }> = [];

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  resetMcpHttpStateForTests();
  resetDatabase();
  closeDatabase();
  delete process.env["OPEN_DEPLOYMENT_DB"];
});

describe("MCP HTTP transport", () => {
  it("GET /health returns 200 with service name", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  });

  it("supports MCP initialize and tool call over streamable HTTP", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    for (let i = 0; i < 22; i++) {
      createProject({
        name: `mcp-project-${i}`,
        source_type: "git",
        source_url: `https://github.com/example/mcp-project-${i}?secret=this-part-should-be-summarized`,
      });
    }
    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));

    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const projects = JSON.parse(text) as {
      total: number;
      count: number;
      next_cursor: number | null;
      items: Array<{ source: string }>;
      hint: string;
    };
    expect(projects.total).toBe(22);
    expect(projects.count).toBe(20);
    expect(projects.next_cursor).toBe(20);
    expect(projects.hint).toContain("get_project");
    expect(projects.items.some((project) => project.source.includes("this-part-should-be-summarized"))).toBe(false);

    await client.close();
  });

  it("serves three concurrent MCP clients from one process", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
        return client;
      }),
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "describe_tools", arguments: {} })),
    );

    for (const result of results) {
      expect(result.isError).not.toBe(true);
    }

    await Promise.all(clients.map((client) => client.close()));
  });
});

describe("stdio mode", () => {
  it("buildServer registers tools for in-memory transport", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "list_projects")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "describe_tools")).toBe(true);

    await client.close();
  });

  it("keeps MCP hook list IDs usable for remove_hook", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({
      name: "add_hook",
      arguments: { event: "post-deploy", command: "echo this-command-is-long-enough-to-be-summarized" },
    });
    const listed = await client.callTool({ name: "list_hooks", arguments: {} });
    const text = (listed.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const hooks = JSON.parse(text) as { total: number; items: Array<{ id: string; command: string }> };
    expect(hooks.total).toBe(1);
    expect(hooks.items[0]?.id).toHaveLength(36);
    expect(hooks.items[0]?.command).toContain("echo");

    await client.callTool({ name: "remove_hook", arguments: { id: hooks.items[0]!.id } });
    const after = await client.callTool({ name: "list_hooks", arguments: {} });
    const afterText = (after.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const remaining = JSON.parse(afterText) as { total: number; items: unknown[] };
    expect(remaining.total).toBe(0);
    expect(remaining.items).toEqual([]);

    await client.close();
  });

  it("compacts MCP deployment status unless verbose is passed", async () => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
    const project = createProject({ name: "status-test", source_type: "git", source_url: "" });
    const provider = createProvider({ name: "status-provider", type: "vercel", credentials_key: "" });
    const environment = createEnvironment({ project_id: project.id, name: "prod", type: "prod", provider_id: provider.id });
    const deployment = createDeployment({ project_id: project.id, environment_id: environment.id, version: "v".repeat(80) });
    updateDeployment(deployment.id, {
      status: "live",
      url: `https://example.com/${"long-path/".repeat(20)}`,
      logs: Array.from({ length: 130 }, (_, index) => `line-${index}`).join("\n"),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const statusResult = await client.callTool({
      name: "get_deployment_status",
      arguments: { project_id: project.id, environment_id: environment.id },
    });
    const statusText = (statusResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const status = JSON.parse(statusText) as { deployment: { id: string; version: string; url: string }; provider_status: string | null; hint: string };
    expect(status.deployment.id).toBe(deployment.id);
    expect(status.deployment.version.length).toBeLessThanOrEqual(40);
    expect(status.deployment.url.length).toBeLessThanOrEqual(80);
    expect(status.hint).toContain("verbose:true");

    await client.close();
  });
});
