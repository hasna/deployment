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

### Compact output and gradual disclosure

CLI output is compact by default so agent terminals and logs stay readable:

- List-style commands show at most 20 rows unless `--limit <n>` is provided.
- Long names, URLs, hook commands, config summaries, blueprint templates, and log text are truncated or summarized in human output.
- When more rows are available, commands print the next cursor, for example `deployment project list --cursor 20`.
- Detail commands such as `project show <id>`, `env show <id>`, `blueprint show <id>`, and `history show <id>` reveal the full record path.
- Use `--verbose` to expand human output where supported.
- Use `--format json` for stable machine-readable records. JSON output stays full on list commands that did not already have a default limit; commands such as `history list` and `ps` keep their existing default limit unless you pass `--limit`/`--cursor`.
- Log commands tail recent lines by default; use `--full` or a larger `--lines <n>` when you need complete logs.

Examples:

```bash
deployment project list
deployment project list --limit 50 --cursor 50
deployment project list --format json
deployment history show <id> --logs --log-lines 80
deployment blueprint show <id> --verbose
```

## MCP Server

```bash
deployment-mcp
```

MCP list/search tools also use compact defaults. They return a paged object with `total`, `count`, `limit`, `next_cursor`, `items`, and a `hint` instead of dumping full arrays. Compact MCP summaries keep full internal IDs so follow-up mutation/detail tools can use them directly. Pass `limit` and `cursor` for pagination, `verbose: true` for full records within a page, or call the matching `get_*`/detail tool for a single record. Log tools tail recent output by default and expose `full` or `verbose` flags where complete text is needed.

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
