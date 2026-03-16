# DWS MCP Server — Local Testing

This guide covers local testing against both production DWS (`api.nutrient.io`) and local DWS debug builds. Docker/deployment steps are intentionally omitted.

## Prerequisites

- Node.js 18+
- pnpm
- Project dependencies installed:

```bash
pnpm install
```

## Run Commands

- `pnpm run dev`: hot reload for local development (recommended)
- `pnpm run build && pnpm start`: production-like local run from `dist/`

---

## stdio Transport

### With API key

```bash
export NUTRIENT_DWS_API_KEY=your_dws_api_key
pnpm run dev
```

### With OAuth browser flow

When no API key is set, the server opens a browser for Nutrient OAuth consent on the first tool call. Tokens are cached at `~/.nutrient/credentials.json`.

```bash
pnpm run dev
```

To test against a local DWS auth server instead of production:

```bash
export AUTH_SERVER_URL=http://localhost:4000
export DWS_API_BASE_URL=http://localhost:4000
pnpm run dev
```

The OAuth flow will use `{AUTH_SERVER_URL}/oauth/authorize` and `{AUTH_SERVER_URL}/oauth/token`. The `CLIENT_ID` env var can override the default client ID (`nutrient-dws-mcp-server`).

---

## Environment Variable Reference

| Variable               | Default                    | Description                                      |
|------------------------|----------------------------|--------------------------------------------------|
| `DWS_API_BASE_URL`    | `https://api.nutrient.io`  | DWS API base URL                                 |
| `NUTRIENT_DWS_API_KEY`| —                          | DWS API key (optional in OAuth mode)             |
| `AUTH_SERVER_URL`      | `https://api.nutrient.io`  | Authorization server base URL (for OAuth)        |
| `CLIENT_ID`           | —                          | OAuth client ID (stdio OAuth flow)               |
| `SANDBOX_PATH`        | —                          | Filesystem sandbox root                          |
| `LOG_LEVEL`           | `debug`                    | Winston logger level                             |
| `MCP_LOG_FILE`        | auto (tmpdir)              | Override log file path                           |

---

## MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser-based tool for interactively testing and debugging MCP servers.

```bash
npx @modelcontextprotocol/inspector
```

Opens at `http://localhost:6274`. Point it at `http://localhost:3000/mcp`.

---

## Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| Browser doesn't open (stdio OAuth) | Running in headless/CI | Set `NUTRIENT_DWS_API_KEY` instead |
| Token exchange fails | Auth server misconfigured | Check `AUTH_SERVER_URL` and OAuth endpoints |
| `NUTRIENT_DWS_API_KEY` errors | API key invalid or expired | Verify at [dashboard.nutrient.io](https://dashboard.nutrient.io) |
