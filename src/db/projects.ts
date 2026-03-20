import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type {
  Project,
  ProjectRow,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectFilter,
} from "../types/index.js";
import { ProjectNotFoundError } from "../types/index.js";

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    source_type: row.source_type as Project["source_type"],
    source_url: row.source_url,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const id = uuid();
  const ts = now();

  db.query(
    `INSERT INTO projects (id, name, source_type, source_url, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.source_type, input.source_url, input.description ?? "", ts, ts);

  return getProject(id);
}

export function getProject(id: string): Project {
  const db = getDatabase();
  let row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | null;

  if (!row) {
    row = db.query("SELECT * FROM projects WHERE name = ?").get(id) as ProjectRow | null;
  }

  if (!row) {
    const resolved = resolvePartialId("projects", id);
    if (resolved) {
      row = db.query("SELECT * FROM projects WHERE id = ?").get(resolved) as ProjectRow | null;
    }
  }

  if (!row) throw new ProjectNotFoundError(id);
  return rowToProject(row);
}

export function listProjects(filters?: ProjectFilter): Project[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  let sql = "SELECT * FROM projects";
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

  const rows = db.query(sql).all(...params) as ProjectRow[];
  return rows.map(rowToProject);
}

export function updateProject(id: string, updates: UpdateProjectInput): Project {
  const db = getDatabase();
  const project = getProject(id);
  const ts = now();

  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [ts];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    params.push(updates.name);
  }
  if (updates.source_type !== undefined) {
    fields.push("source_type = ?");
    params.push(updates.source_type);
  }
  if (updates.source_url !== undefined) {
    fields.push("source_url = ?");
    params.push(updates.source_url);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    params.push(updates.description);
  }

  params.push(project.id);
  db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  return getProject(project.id);
}

export function deleteProject(id: string): void {
  const db = getDatabase();
  const project = getProject(id);
  db.query("DELETE FROM projects WHERE id = ?").run(project.id);
}
