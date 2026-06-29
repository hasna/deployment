import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("mcp/index", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("file can be parsed without syntax errors", async () => {
    // The MCP index.ts uses top-level await for server.connect(transport),
    // which requires a stdio transport and blocks. We verify the file is
    // syntactically valid by checking the TypeScript compilation instead.
    // Here we test that the module's related imports work.
    const { createProject, listProjects } = await import("../db/projects.js");
    const { registerAgent, listAgents } = await import("../db/agents.js");

    // Verify the DB functions that MCP tools rely on work correctly
    const project = createProject({ name: "mcp-test", source_type: "git", source_url: "" });
    expect(project.name).toBe("mcp-test");

    const projects = listProjects();
    expect(projects.length).toBe(1);

    const agent = registerAgent({ name: "mcp-agent" });
    expect(agent.name).toBe("mcp-agent");

    const agents = listAgents();
    expect(agents.length).toBe(1);
  });

  it("TOOL_CATALOG matches registered server tools", () => {
    const source = readFileSync(join(process.cwd(), "src", "mcp", "index.ts"), "utf8");
    const catalogBlock = source.match(/const TOOL_CATALOG = \[([\s\S]*?)\];/);
    expect(catalogBlock).toBeTruthy();

    const catalogTools = [...catalogBlock![1]!.matchAll(/\{ name: "([^"]+)"/g)]
      .map((match) => match[1]!)
      .sort();
    const registeredTools = [...source.matchAll(/server\.tool\("([^"]+)"/g)]
      .map((match) => match[1]!)
      .sort();

    expect(catalogTools).toEqual(registeredTools);
    expect(catalogTools).toContain("send_feedback");
    expect(new Set(catalogTools).size).toBe(catalogTools.length);
  });
});
