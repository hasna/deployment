# @hasna/deployment

General-purpose deployment orchestration for AI agents -- provision infrastructure, deploy apps, manage environments. Ships as a CLI, MCP server, REST API, and TypeScript SDK.

## Install

```bash
bun install -g @hasna/deployment
```

or

```bash
npm install -g @hasna/deployment
```

## Quick Start

```bash
# 1. Initialize -- detect project type and get setup instructions
deployment init

# 2. Add a provider (e.g. Vercel)
deployment provider add my-vercel -t vercel

# 3. Create a project
deployment project create my-app --source https://github.com/me/my-app --type git

# 4. Create an environment
deployment env create my-app prod -t prod --provider <provider-id>

# 5. Deploy
deployment deploy my-app prod --version 1.0.0

# 6. Check status
deployment status my-app prod
```

Use `deployment init -y` for non-interactive setup with auto-detected defaults.

## CLI Reference

### Project Management

```bash
deployment project create <name> [-s <url>] [-t git|docker|local|url] [-d <desc>]
deployment project list [--format json]
deployment project show <id>
deployment project delete <id>
```

### Environment Management

```bash
deployment env create <project> <name> [-t dev|staging|prod] [-p <provider-id>] [-r <region>]
deployment env list [project] [--format json]
deployment env show <id>
deployment env delete <id>
```

### Provider Management

```bash
deployment provider add <name> -t <type> [-c <credentials-key>]
deployment provider list [--format json]
deployment provider show <id>
deployment provider remove <id>
deployment provider test <id>
```

### Deployment Operations

```bash
deployment deploy <project> <environment> [-i <image>] [-c <sha>] [-v <version>] [--dry-run] [--health-check <url>] [--auto-rollback]
deployment status <project> <environment>
deployment logs <project> <environment>
deployment rollback <project> <environment> [--to <deployment-id>]
deployment promote <project> <from-env> <to-env>
deployment watch <project> <environment> [--timeout <seconds>]
```

### Resource Management

```bash
deployment resource list [environment] [--format json]
deployment resource destroy <id>
```

### Blueprint Management

```bash
deployment blueprint list [--format json]
deployment blueprint show <id>
deployment blueprint apply <blueprint> <environment>
```

### Agent Management

```bash
deployment agent register <name> [-t human|agent]
deployment agent list
```

### Secret Management

```bash
deployment secret set <project> <env> <key> <value>
deployment secret list <project> [env]
```

### Deployment History

```bash
deployment history list [project] [-e <env>] [-s <status>] [-n <limit>] [--format json]
deployment history show <id>
```

### Hook Management

```bash
deployment hook list [-e <event>]
deployment hook add <event> <command> [-p <project-id>] [-e <env-id>]
deployment hook remove <id>
deployment hook test <event>
```

### Utility Commands

```bash
deployment init [-y]              # Auto-detect project type and setup
deployment doctor                 # System health check (DB, secrets, providers)
deployment overview               # Dashboard of all projects/envs/deployments
deployment ls [--format json]     # Alias for project list
deployment ps [-n <limit>]        # Alias for history list
deployment mcp [--target claude]  # Install MCP server
```

## MCP Server

Install the MCP server into Claude Code:

```bash
deployment mcp
```

Or manually:

```bash
claude mcp add --transport stdio --scope user deployment -- deployment-mcp
```

### Available Tools (37)

| Tool | Description |
|------|-------------|
| `create_project` | Register a new project for deployment |
| `list_projects` | List all registered projects |
| `get_project` | Get project details by ID or name |
| `delete_project` | Delete a project and all its data |
| `create_environment` | Create a deployment environment (dev/staging/prod) |
| `list_environments` | List environments, optionally filtered by project |
| `get_environment` | Get environment details |
| `delete_environment` | Delete an environment |
| `add_provider` | Add a deployment provider account |
| `list_providers` | List configured providers |
| `get_provider` | Get provider details |
| `remove_provider` | Remove a provider |
| `deploy` | Deploy a project to an environment |
| `get_deployment_status` | Get current deployment status |
| `list_deployments` | List deployment history |
| `get_deployment_logs` | Get deployment logs |
| `rollback` | Rollback to previous deployment |
| `promote` | Promote deployment between environments |
| `list_resources` | List provisioned infrastructure resources |
| `destroy_resource` | Destroy a provisioned resource |
| `list_blueprints` | List infrastructure blueprints |
| `get_blueprint` | Get blueprint details |
| `apply_blueprint` | Apply blueprint to provision infrastructure |
| `set_secret` | Set a deployment secret |
| `list_secrets` | List deployment secrets |
| `register_agent` | Register a deployer agent |
| `list_agents` | List registered agents |
| `detect_project_type` | Detect project type from filesystem path |
| `doctor` | System health check -- DB, secrets, providers |
| `overview` | All projects/environments/deployments summary |
| `deploy_dry_run` | Preview deploy without executing |
| `add_hook` | Add a deployment hook |
| `list_hooks` | List deployment hooks |
| `remove_hook` | Remove a deployment hook |
| `test_hook` | Test hooks for a given event |
| `describe_tools` | List all available tools |
| `search_tools` | Search tools by keyword |

## REST API

Start the server:

```bash
deployment-serve
```

Default port: `3460`. Override with `OPEN_DEPLOYMENT_PORT` environment variable.

Base URL: `http://localhost:3460`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/projects` | List projects (`?search=`) |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id` | Get project |
| `PUT` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/projects/:id/environments` | List environments for project (`?type=`) |
| `POST` | `/api/projects/:id/environments` | Create environment |
| `GET` | `/api/environments/:id` | Get environment |
| `PUT` | `/api/environments/:id` | Update environment |
| `DELETE` | `/api/environments/:id` | Delete environment |
| `GET` | `/api/providers` | List providers (`?type=`) |
| `POST` | `/api/providers` | Add provider |
| `GET` | `/api/providers/:id` | Get provider |
| `DELETE` | `/api/providers/:id` | Remove provider |
| `POST` | `/api/deploy` | Deploy |
| `POST` | `/api/deploy/dry-run` | Dry-run deploy |
| `GET` | `/api/deployments` | List deployments (`?project_id=&environment_id=&status=&limit=`) |
| `GET` | `/api/deployments/:id` | Get deployment |
| `GET` | `/api/deployments/:id/logs` | Get deployment logs |
| `POST` | `/api/rollback/:id` | Rollback deployment |
| `POST` | `/api/promote` | Promote between environments |
| `GET` | `/api/resources` | List resources (`?environment_id=&type=`) |
| `DELETE` | `/api/resources/:id` | Destroy resource |
| `GET` | `/api/blueprints` | List blueprints (`?provider_type=`) |
| `GET` | `/api/blueprints/:id` | Get blueprint |
| `POST` | `/api/blueprints/apply` | Apply blueprint |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agents` | Register agent |
| `GET` | `/api/doctor` | System health check |
| `GET` | `/api/overview` | Full overview |
| `GET` | `/api/detect` | Detect project type (`?path=`) |
| `GET` | `/api/hooks` | List hooks (`?event=&project_id=`) |
| `POST` | `/api/hooks` | Add hook |
| `DELETE` | `/api/hooks/:id` | Remove hook |
| `POST` | `/api/hooks/test/:event` | Test hooks for event |

## Providers

| Provider | Type | What It Deploys |
|----------|------|-----------------|
| Vercel | `vercel` | Next.js, static sites, serverless functions |
| Cloudflare | `cloudflare` | Workers, Pages, static sites |
| Railway | `railway` | Node.js services, databases, Redis |
| Fly.io | `flyio` | Docker containers, VMs |
| AWS | `aws` | ECS Fargate, RDS, ElastiCache, S3 |
| DigitalOcean | `digitalocean` | App Platform, Managed Databases |

### Vercel

```bash
deployment provider add my-vercel -t vercel -c vercel-token
# Token: https://vercel.com/account/tokens
# Store: deployment secret set my-app credentials VERCEL_TOKEN <token>
```

### Cloudflare

```bash
deployment provider add my-cf -t cloudflare -c cloudflare-token
# Token: https://dash.cloudflare.com/profile/api-tokens
# Needs: Workers/Pages edit permissions
```

### Railway

```bash
deployment provider add my-railway -t railway -c railway-token
# Token: https://railway.app/account/tokens
```

### Fly.io

```bash
deployment provider add my-fly -t flyio -c flyio-token
# Token: fly tokens create org
# Or: https://fly.io/user/personal_access_tokens
```

### AWS

```bash
deployment provider add my-aws -t aws -c aws-credentials
# Needs: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
# IAM: ECS, RDS, ElastiCache, S3 permissions
```

### DigitalOcean

```bash
deployment provider add my-do -t digitalocean -c do-token
# Token: https://cloud.digitalocean.com/account/api/tokens
# Needs: Read+Write scope
```

## Blueprints

Blueprints are infrastructure-as-code templates that provision resources automatically.

| Blueprint | Provider | Resources |
|-----------|----------|-----------|
| `nextjs-vercel` | Vercel | Postgres, KV cache |
| `node-railway` | Railway | Postgres, Redis |
| `docker-flyio` | Fly.io | Persistent volume |
| `fullstack-aws` | AWS | RDS Postgres, ElastiCache Redis, S3 |
| `static-cloudflare` | Cloudflare | KV store, R2 storage |
| `app-digitalocean` | DigitalOcean | Managed Postgres |

Apply a blueprint:

```bash
deployment blueprint list
deployment blueprint apply nextjs-vercel <environment-id>
```

## Hooks

Hooks run shell commands at key deployment lifecycle events.

### Events

| Event | When It Fires |
|-------|---------------|
| `pre-deploy` | Before deployment starts |
| `post-deploy` | After successful deployment |
| `deploy-failed` | After a failed deployment |
| `pre-rollback` | Before rollback starts |
| `post-rollback` | After rollback completes |
| `pre-promote` | Before promotion starts |
| `post-promote` | After promotion completes |

### Usage

```bash
# Add a global hook
deployment hook add post-deploy "curl -X POST https://slack.example.com/webhook"

# Add a project-scoped hook
deployment hook add pre-deploy "./scripts/check-migrations.sh" --project <id>

# List all hooks
deployment hook list

# Test hooks for an event (dry run)
deployment hook test post-deploy

# Remove a hook
deployment hook remove <hook-id>
```

### Environment Variables

Hooks receive deployment context via environment variables:

- `DEPLOY_PROJECT_ID`, `DEPLOY_PROJECT_NAME`
- `DEPLOY_ENV_ID`, `DEPLOY_ENV_NAME`, `DEPLOY_ENV_TYPE`
- `DEPLOY_PROVIDER`, `DEPLOY_ID`, `DEPLOY_VERSION`
- `DEPLOY_IMAGE`, `DEPLOY_COMMIT`, `DEPLOY_URL`
- `DEPLOY_STATUS`, `DEPLOY_ERROR`

The full deployment context is also passed as JSON via stdin.

### @hasna/hooks Integration

If `@hasna/hooks` is installed, hooks will be executed through its SDK with full logging and error tracking. Otherwise, hooks fall back to direct shell execution.

## Ecosystem

### @hasna/secrets

Secrets management integration. Store provider credentials and environment variables securely.

```bash
bun install -g @hasna/secrets
deployment secret set my-app prod API_KEY sk-12345
deployment secret list my-app prod
```

Secrets are stored under the namespace `deployment/{project}/{environment}/{key}`.

### @hasna/conversations

Optional deployment announcements. When installed, successful deploys, rollbacks, and failures are announced to the project's conversation space.

```bash
bun install -g @hasna/conversations
```

No configuration needed -- announcements happen automatically when the module is available.

### @hasna/economy

Optional cost tracking for deployments. When installed, each deployment logs its cost to the economy tracker.

```bash
bun install -g @hasna/economy
```

## Database

Data is stored in SQLite at `~/.open-deployment/deployment.db`. Override the path with the `OPEN_DEPLOYMENT_DB` environment variable.

```bash
# Use a custom database path
OPEN_DEPLOYMENT_DB=/path/to/db.sqlite deployment ls

# Use in-memory database (for testing)
OPEN_DEPLOYMENT_DB=:memory: deployment ls
```

## License

MIT
