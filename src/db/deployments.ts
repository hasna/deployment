import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Deployment,
  DeploymentRow,
  CreateDeploymentInput,
  UpdateDeploymentInput,
  DeploymentFilter,
  DeploymentStatus,
} from "../types/index.js";
import { DeploymentNotFoundError } from "../types/index.js";

function rowToDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    project_id: row.project_id,
    environment_id: row.environment_id,
    version: row.version,
    status: row.status as DeploymentStatus,
    url: row.url,
    image: row.image,
    commit_sha: row.commit_sha,
    logs: row.logs,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
  };
}

export function createDeployment(input: CreateDeploymentInput): Deployment {
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO deployments (id, project_id, environment_id, version, status, image, commit_sha, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    input.project_id,
    input.environment_id,
    input.version ?? "",
    input.image ?? "",
    input.commit_sha ?? "",
    ts
  );

  return getDeployment(id);
}

export function getDeployment(id: string): Deployment {
  const db = getDatabase();
  let row = db.query("SELECT * FROM deployments WHERE id = ?").get(id) as DeploymentRow | null;

  if (!row) {
    const resolved = resolvePartialId("deployments", id);
    if (resolved) {
      row = db.query("SELECT * FROM deployments WHERE id = ?").get(resolved) as DeploymentRow | null;
    }
  }

  if (!row) throw new DeploymentNotFoundError(id);
  return rowToDeployment(row);
}

export function listDeployments(filters?: DeploymentFilter): Deployment[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.project_id) {
    conditions.push("project_id = ?");
    params.push(filters.project_id);
  }
  if (filters?.environment_id) {
    conditions.push("environment_id = ?");
    params.push(filters.environment_id);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  let sql = "SELECT * FROM deployments";
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

  const rows = db.query(sql).all(...params) as DeploymentRow[];
  return rows.map(rowToDeployment);
}

export function updateDeployment(id: string, updates: UpdateDeploymentInput): Deployment {
  const db = getDatabase();
  const deployment = getDeployment(id);

  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    params.push(updates.status);
  }
  if (updates.url !== undefined) {
    fields.push("url = ?");
    params.push(updates.url);
  }
  if (updates.logs !== undefined) {
    fields.push("logs = ?");
    params.push(updates.logs);
  }
  if (updates.started_at !== undefined) {
    fields.push("started_at = ?");
    params.push(updates.started_at);
  }
  if (updates.completed_at !== undefined) {
    fields.push("completed_at = ?");
    params.push(updates.completed_at);
  }

  if (fields.length > 0) {
    params.push(deployment.id);
    db.query(`UPDATE deployments SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  }

  return getDeployment(deployment.id);
}

export function getLatestDeployment(environmentId: string): Deployment | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM deployments WHERE environment_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(environmentId) as DeploymentRow | null;

  return row ? rowToDeployment(row) : null;
}

export function getDeploymentsByStatus(status: DeploymentStatus): Deployment[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT * FROM deployments WHERE status = ? ORDER BY created_at DESC")
    .all(status) as DeploymentRow[];

  return rows.map(rowToDeployment);
}

export function deleteDeployment(id: string): void {
  const db = getDatabase();
  const deployment = getDeployment(id);
  db.query("DELETE FROM deployments WHERE id = ?").run(deployment.id);
}
