/**
 * PostgreSQL migrations for open-deployment cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL DEFAULT 'git',
    source_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 2: providers table
  `CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    credentials_key TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 3: environments table
  `CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'dev',
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    region TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, name)
  )`,

  // Migration 4: deployments table
  `CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    url TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    commit_sha TEXT NOT NULL DEFAULT '',
    logs TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,

  // Migration 5: resources table
  `CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_resource_id TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'provisioning',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 6: blueprints table
  `CREATE TABLE IF NOT EXISTS blueprints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    provider_type TEXT NOT NULL,
    template TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Migration 7: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT,
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )`,

  // Migration 8: indexes
  `CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_env ON deployments(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_env ON resources(environment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type)`,
  `CREATE INDEX IF NOT EXISTS idx_providers_type ON providers(type)`,
  `CREATE INDEX IF NOT EXISTS idx_blueprints_provider ON blueprints(provider_type)`,

  // Migration 9: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
