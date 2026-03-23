import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Agent,
  AgentRow,
  RegisterAgentInput,
} from "../types/index.js";
import { AgentNotFoundError } from "../types/index.js";

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Agent["type"],
    project_id: row.project_id ?? null,
    registered_at: row.registered_at,
    last_seen: row.last_seen,
  };
}

export function registerAgent(input: RegisterAgentInput): Agent {
  const db = getDatabase();
  const ts = now();

  const existing = db.query("SELECT * FROM agents WHERE name = ?").get(input.name) as AgentRow | null;
  if (existing) {
    db.query("UPDATE agents SET last_seen = ? WHERE id = ?").run(ts, existing.id);
    return getAgent(existing.id);
  }

  const id = uuid();
  db.query(
    `INSERT INTO agents (id, name, type, registered_at, last_seen) VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.name, input.type ?? "agent", ts, ts);

  return getAgent(id);
}

export function getAgent(id: string): Agent {
  const db = getDatabase();
  let row = db.query("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;

  if (!row) {
    row = db.query("SELECT * FROM agents WHERE name = ?").get(id) as AgentRow | null;
  }

  if (!row) {
    const resolved = resolvePartialId("agents", id);
    if (resolved) {
      row = db.query("SELECT * FROM agents WHERE id = ?").get(resolved) as AgentRow | null;
    }
  }

  if (!row) throw new AgentNotFoundError(id);
  return rowToAgent(row);
}

export function listAgents(): Agent[] {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM agents ORDER BY registered_at DESC").all() as AgentRow[];
  return rows.map(rowToAgent);
}

export function updateAgent(id: string, updates: { name?: string; type?: "human" | "agent" }): Agent {
  const db = getDatabase();
  const agent = getAgent(id);
  const ts = now();

  const fields: string[] = ["last_seen = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    fields.push("type = ?");
    params.push(updates.type);
  }

  params.push(agent.id);
  db.query(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getAgent(agent.id);
}

export function deleteAgent(id: string): void {
  const db = getDatabase();
  const agent = getAgent(id);
  db.query("DELETE FROM agents WHERE id = ?").run(agent.id);
}

export function touchAgent(id: string): void {
  const db = getDatabase();
  const agent = getAgent(id);
  db.query("UPDATE agents SET last_seen = ? WHERE id = ?").run(now(), agent.id);
}

export function heartbeat(id: string): Agent {
  const db = getDatabase();
  const agent = getAgent(id);
  db.query("UPDATE agents SET last_seen = ? WHERE id = ?").run(now(), agent.id);
  return getAgent(agent.id);
}

export function setFocus(id: string, projectId: string | null): Agent {
  const db = getDatabase();
  const agent = getAgent(id);
  db.query("UPDATE agents SET project_id = ?, last_seen = ? WHERE id = ?").run(projectId, now(), agent.id);
  return getAgent(agent.id);
}
