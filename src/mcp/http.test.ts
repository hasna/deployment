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
    const port = randomPort();
    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));

    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const projects = JSON.parse(text) as unknown[];
    expect(Array.isArray(projects)).toBe(true);

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
});
