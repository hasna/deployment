# @hasna/deployment

General-purpose deployment orchestration for AI agents — provision infrastructure, deploy apps, manage environments. CLI + MCP + REST + SDK.

[![npm](https://img.shields.io/npm/v/@hasna/deployment)](https://www.npmjs.com/package/@hasna/deployment)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/deployment
```

## CLI Usage

```bash
deployment --help
```

- `deployment project create`
- `deployment project list`
- `deployment env create`
- `deployment env list`
- `deployment provider add`
- `deployment provider list`

## MCP Server

```bash
deployment-mcp
```

40 tools available.

## HTTP mode

Long-lived Streamable HTTP transport for shared agent sessions (binds `127.0.0.1` only):

```bash
deployment-mcp --http              # default port 8858
deployment-mcp --http --port 8858
MCP_HTTP=1 MCP_HTTP_PORT=8858 deployment-mcp
```

- `GET /health` → `{"status":"ok","name":"deployment"}`
- `POST /mcp` — Streamable HTTP MCP endpoint (also mounted on `deployment-serve`)

Stdio remains the default transport for gradual rollout.

## REST API

```bash
deployment-serve
```

## Data Directory

Runtime data is stored locally in `~/.hasna/deployment/`.

Storage is explicitly local-only today. `DATABASE_URL` and other database URL
variables do not switch the runtime store. Use `HASNA_DEPLOYMENT_DB_PATH` or
`OPEN_DEPLOYMENT_DB` to override the SQLite path, and keep
`HASNA_DEPLOYMENT_STORAGE_MODE=local` when setting a mode explicitly.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
