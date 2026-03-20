import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Provider,
  ProviderRow,
  CreateProviderInput,
  UpdateProviderInput,
  ProviderFilter,
} from "../types/index.js";
import { ProviderNotFoundError } from "../types/index.js";

const VALID_PROVIDER_TYPES = ["vercel", "cloudflare", "railway", "flyio", "aws", "digitalocean"];

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Provider["type"],
    credentials_key: row.credentials_key,
    config: JSON.parse(row.config) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createProvider(input: CreateProviderInput): Provider {
  if (!VALID_PROVIDER_TYPES.includes(input.type)) {
    throw new Error(`Invalid provider type: ${input.type}. Must be one of: ${VALID_PROVIDER_TYPES.join(", ")}`);
  }

  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO providers (id, name, type, credentials_key, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.type, input.credentials_key, JSON.stringify(input.config ?? {}), ts, ts);

  return getProvider(id);
}

export function getProvider(id: string): Provider {
  const db = getDatabase();
  let row = db.query("SELECT * FROM providers WHERE id = ?").get(id) as ProviderRow | null;

  if (!row) {
    const resolved = resolvePartialId("providers", id);
    if (resolved) {
      row = db.query("SELECT * FROM providers WHERE id = ?").get(resolved) as ProviderRow | null;
    }
  }

  if (!row) throw new ProviderNotFoundError(id);
  return rowToProvider(row);
}

export function listProviders(filters?: ProviderFilter): Provider[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }

  let sql = "SELECT * FROM providers";
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

  const rows = db.query(sql).all(...params) as ProviderRow[];
  return rows.map(rowToProvider);
}

export function updateProvider(id: string, updates: UpdateProviderInput): Provider {
  const db = getDatabase();
  const provider = getProvider(id);
  const ts = now();

  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.credentials_key !== undefined) {
    fields.push("credentials_key = ?");
    params.push(updates.credentials_key);
  }
  if (updates.config !== undefined) {
    fields.push("config = ?");
    params.push(JSON.stringify(updates.config));
  }

  params.push(provider.id);
  db.query(`UPDATE providers SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getProvider(provider.id);
}

export function deleteProvider(id: string): void {
  const db = getDatabase();
  const provider = getProvider(id);
  db.query("DELETE FROM providers WHERE id = ?").run(provider.id);
}
