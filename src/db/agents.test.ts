import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  registerAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
  touchAgent,
} from "./agents.js";
import { AgentNotFoundError } from "../types/index.js";

describe("agents", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("registerAgent", () => {
    it("registers a new agent", () => {
      const agent = registerAgent({ name: "maximus" });
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe("maximus");
      expect(agent.type).toBe("agent");
      expect(agent.registered_at).toBeDefined();
      expect(agent.last_seen).toBeDefined();
    });

    it("registers a human agent", () => {
      const agent = registerAgent({ name: "andrei", type: "human" });
      expect(agent.type).toBe("human");
    });

    it("re-registers an existing agent by updating last_seen", () => {
      const first = registerAgent({ name: "cassius" });
      // Wait briefly to get a different timestamp
      const second = registerAgent({ name: "cassius" });
      expect(second.id).toBe(first.id);
      expect(second.name).toBe("cassius");
      // last_seen should be updated (>= first registration)
      expect(new Date(second.last_seen).getTime()).toBeGreaterThanOrEqual(
        new Date(first.last_seen).getTime()
      );
    });
  });

  describe("getAgent", () => {
    it("gets an agent by ID", () => {
      const created = registerAgent({ name: "brutus" });
      const fetched = getAgent(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("brutus");
    });

    it("gets an agent by name", () => {
      registerAgent({ name: "titus" });
      const fetched = getAgent("titus");
      expect(fetched.name).toBe("titus");
    });

    it("throws AgentNotFoundError for missing agent", () => {
      expect(() => getAgent("nonexistent")).toThrow(AgentNotFoundError);
    });
  });

  describe("listAgents", () => {
    it("lists all agents", () => {
      registerAgent({ name: "agent1" });
      registerAgent({ name: "agent2" });
      const agents = listAgents();
      expect(agents.length).toBe(2);
    });

    it("returns empty when no agents exist", () => {
      const agents = listAgents();
      expect(agents.length).toBe(0);
    });
  });

  describe("updateAgent", () => {
    it("updates agent name", () => {
      const agent = registerAgent({ name: "old-agent" });
      const updated = updateAgent(agent.id, { name: "new-agent" });
      expect(updated.name).toBe("new-agent");
    });

    it("updates agent type", () => {
      const agent = registerAgent({ name: "type-agent" });
      const updated = updateAgent(agent.id, { type: "human" });
      expect(updated.type).toBe("human");
    });

    it("updates last_seen on update", () => {
      const agent = registerAgent({ name: "seen-agent" });
      const updated = updateAgent(agent.id, { name: "seen-agent-2" });
      expect(new Date(updated.last_seen).getTime()).toBeGreaterThanOrEqual(
        new Date(agent.last_seen).getTime()
      );
    });

    it("throws AgentNotFoundError for nonexistent agent", () => {
      expect(() => updateAgent("nonexistent", { name: "x" })).toThrow(
        AgentNotFoundError
      );
    });
  });

  describe("deleteAgent", () => {
    it("deletes an agent", () => {
      const agent = registerAgent({ name: "del-agent" });
      deleteAgent(agent.id);
      expect(() => getAgent(agent.id)).toThrow(AgentNotFoundError);
    });

    it("throws AgentNotFoundError for nonexistent agent", () => {
      expect(() => deleteAgent("nonexistent")).toThrow(AgentNotFoundError);
    });
  });

  describe("touchAgent", () => {
    it("updates last_seen timestamp", () => {
      const agent = registerAgent({ name: "touch-agent" });
      const originalLastSeen = agent.last_seen;
      touchAgent(agent.id);
      const refreshed = getAgent(agent.id);
      expect(new Date(refreshed.last_seen).getTime()).toBeGreaterThanOrEqual(
        new Date(originalLastSeen).getTime()
      );
    });

    it("throws AgentNotFoundError for nonexistent agent", () => {
      expect(() => touchAgent("nonexistent")).toThrow(AgentNotFoundError);
    });
  });
});
