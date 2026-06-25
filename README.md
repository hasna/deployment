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

## REST API

```bash
deployment-serve
```

## Storage Sync

Deployment stores data locally in `~/.hasna/deployment/deployment.db` by default. Set one of these environment variables to sync with a remote PostgreSQL storage database:

```bash
export HASNA_DEPLOYMENT_DATABASE_URL="postgres://..."

deployment storage status
deployment storage push
deployment storage pull
deployment storage sync
```

## Data Directory

Data is stored in `~/.hasna/deployment/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
