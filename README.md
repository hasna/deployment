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
deployment-mcp --http              # default port 8813
deployment-mcp --http --port 8813
MCP_HTTP=1 MCP_HTTP_PORT=8813 deployment-mcp
```

- `GET /health` → `{"status":"ok","name":"deployment"}`
- `POST /mcp` — Streamable HTTP MCP endpoint (also mounted on `deployment-serve`)

Stdio remains the default transport for gradual rollout.

## REST API

```bash
deployment-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service deployment
cloud sync pull --service deployment
```

## Data Directory

Data is stored in `~/.hasna/deployment/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
