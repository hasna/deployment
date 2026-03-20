import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Resource,
  ResourceRow,
  CreateResourceInput,
  UpdateResourceInput,
  ResourceFilter,
} from "../types/index.js";
import { ResourceNotFoundError } from "../types/index.js";

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    environment_id: row.environment_id,
    type: row.type as Resource["type"],
    name: row.name,
    provider_resource_id: row.provider_resource_id,
    config: JSON.parse(row.config) as Record<string, unknown>,
    status: row.status as Resource["status"],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createResource(input: CreateResourceInput): Resource {
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO resources (id, environment_id, type, name, provider_resource_id, config, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'provisioning', ?, ?)`
  ).run(
    id,
    input.environment_id,
    input.type,
    input.name,
    input.provider_resource_id ?? "",
    JSON.stringify(input.config ?? {}),
    ts,
    ts
  );

  return getResource(id);
}

export function getResource(id: string): Resource {
  const db = getDatabase();
  let row = db.query("SELECT * FROM resources WHERE id = ?").get(id) as ResourceRow | null;

  if (!row) {
    const resolved = resolvePartialId("resources", id);
    if (resolved) {
      row = db.query("SELECT * FROM resources WHERE id = ?").get(resolved) as ResourceRow | null;
    }
  }

  if (!row) throw new ResourceNotFoundError(id);
  return rowToResource(row);
}

export function listResources(filters?: ResourceFilter): Resource[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.environment_id) {
    conditions.push("environment_id = ?");
    params.push(filters.environment_id);
  }
  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  let sql = "SELECT * FROM resources";
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

  const rows = db.query(sql).all(...params) as ResourceRow[];
  return rows.map(rowToResource);
}

export function updateResource(id: string, updates: UpdateResourceInput): Resource {
  const db = getDatabase();
  const resource = getResource(id);
  const ts = now();

  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.provider_resource_id !== undefined) {
    fields.push("provider_resource_id = ?");
    params.push(updates.provider_resource_id);
  }
  if (updates.config !== undefined) {
    fields.push("config = ?");
    params.push(JSON.stringify(updates.config));
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    params.push(updates.status);
  }

  params.push(resource.id);
  db.query(`UPDATE resources SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getResource(resource.id);
}

export function deleteResource(id: string): void {
  const db = getDatabase();
  const resource = getResource(id);
  db.query("DELETE FROM resources WHERE id = ?").run(resource.id);
}
