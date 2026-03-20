import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Environment,
  EnvironmentRow,
  CreateEnvironmentInput,
  UpdateEnvironmentInput,
  EnvironmentFilter,
} from "../types/index.js";
import { EnvironmentNotFoundError } from "../types/index.js";

function rowToEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    type: row.type as Environment["type"],
    provider_id: row.provider_id,
    region: row.region,
    config: JSON.parse(row.config) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createEnvironment(input: CreateEnvironmentInput): Environment {
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO environments (id, project_id, name, type, provider_id, region, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.name,
    input.type,
    input.provider_id,
    input.region ?? "",
    JSON.stringify(input.config ?? {}),
    ts,
    ts
  );

  return getEnvironment(id);
}

export function getEnvironment(id: string): Environment {
  const db = getDatabase();
  let row = db.query("SELECT * FROM environments WHERE id = ?").get(id) as EnvironmentRow | null;

  if (!row) {
    const resolved = resolvePartialId("environments", id);
    if (resolved) {
      row = db.query("SELECT * FROM environments WHERE id = ?").get(resolved) as EnvironmentRow | null;
    }
  }

  if (!row) throw new EnvironmentNotFoundError(id);
  return rowToEnvironment(row);
}

export function listEnvironments(filters?: EnvironmentFilter): Environment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.project_id) {
    conditions.push("project_id = ?");
    params.push(filters.project_id);
  }
  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }

  let sql = "SELECT * FROM environments";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  if (filters?.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  const rows = db.query(sql).all(...params) as EnvironmentRow[];
  return rows.map(rowToEnvironment);
}

export function updateEnvironment(id: string, updates: UpdateEnvironmentInput): Environment {
  const db = getDatabase();
  const env = getEnvironment(id);
  const ts = now();

  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    fields.push("type = ?");
    params.push(updates.type);
  }
  if (updates.provider_id !== undefined) {
    fields.push("provider_id = ?");
    params.push(updates.provider_id);
  }
  if (updates.region !== undefined) {
    fields.push("region = ?");
    params.push(updates.region);
  }
  if (updates.config !== undefined) {
    fields.push("config = ?");
    params.push(JSON.stringify(updates.config));
  }

  params.push(env.id);
  db.query(`UPDATE environments SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getEnvironment(env.id);
}

export function deleteEnvironment(id: string): void {
  const db = getDatabase();
  const env = getEnvironment(id);
  db.query("DELETE FROM environments WHERE id = ?").run(env.id);
}
