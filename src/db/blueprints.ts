import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Blueprint,
  BlueprintRow,
  BlueprintTemplate,
  CreateBlueprintInput,
  UpdateBlueprintInput,
  BlueprintFilter,
} from "../types/index.js";
import { BlueprintNotFoundError } from "../types/index.js";

function rowToBlueprint(row: BlueprintRow): Blueprint {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider_type: row.provider_type as Blueprint["provider_type"],
    template: JSON.parse(row.template) as BlueprintTemplate,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createBlueprint(input: CreateBlueprintInput): Blueprint {
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO blueprints (id, name, description, provider_type, template, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.description ?? "",
    input.provider_type,
    JSON.stringify(input.template),
    ts,
    ts
  );

  return getBlueprint(id);
}

export function getBlueprint(id: string): Blueprint {
  const db = getDatabase();
  let row = db.query("SELECT * FROM blueprints WHERE id = ?").get(id) as BlueprintRow | null;

  if (!row) {
    row = db.query("SELECT * FROM blueprints WHERE name = ?").get(id) as BlueprintRow | null;
  }

  if (!row) {
    const resolved = resolvePartialId("blueprints", id);
    if (resolved) {
      row = db.query("SELECT * FROM blueprints WHERE id = ?").get(resolved) as BlueprintRow | null;
    }
  }

  if (!row) throw new BlueprintNotFoundError(id);
  return rowToBlueprint(row);
}

export function listBlueprints(filters?: BlueprintFilter): Blueprint[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.provider_type) {
    conditions.push("provider_type = ?");
    params.push(filters.provider_type);
  }

  let sql = "SELECT * FROM blueprints";
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

  const rows = db.query(sql).all(...params) as BlueprintRow[];
  return rows.map(rowToBlueprint);
}

export function updateBlueprint(id: string, updates: UpdateBlueprintInput): Blueprint {
  const db = getDatabase();
  const blueprint = getBlueprint(id);
  const ts = now();

  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    params.push(updates.description);
  }
  if (updates.template !== undefined) {
    fields.push("template = ?");
    params.push(JSON.stringify(updates.template));
  }

  params.push(blueprint.id);
  db.query(`UPDATE blueprints SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getBlueprint(blueprint.id);
}

export function deleteBlueprint(id: string): void {
  const db = getDatabase();
  const blueprint = getBlueprint(id);
  db.query("DELETE FROM blueprints WHERE id = ?").run(blueprint.id);
}
