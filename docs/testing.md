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

```bash
pnpm run build && pnpm start
```

---

## stdio Transport

### With API key

```bash
export NUTRIENT_DWS_API_KEY=your_dws_api_key
pnpm run build && pnpm start
```

### With OAuth browser flow

When no API key is set, the server opens a browser for Nutrient OAuth consent on the first tool call. Tokens are cached at `~/.nutrient/credentials.json`.

```bash
pnpm run build && pnpm start
```

To test against a local DWS auth server instead of production:

```bash
export AUTH_SERVER_URL=http://localhost:4000
export DWS_API_BASE_URL=http://localhost:4000
pnpm run build && pnpm start
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
| `LOG_LEVEL`           | `info`                     | Winston logger level                             |
| `MCP_LOG_FILE`        | auto (tmpdir)              | Override log file path                           |

---

## MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser-based tool for interactively testing and debugging MCP servers.

For stdio transport, pass the server as a subprocess directly:

```bash
npx @modelcontextprotocol/inspector -- npx @nutrient-sdk/dws-mcp-server
```

Or when developing locally:

```bash
npx @modelcontextprotocol/inspector -- node dist/index.js
```

---

## Common Failures

| Error | Cause | Fix |
|-------|-------|-----|
| Browser doesn't open (stdio OAuth) | Running in headless/CI | Set `NUTRIENT_DWS_API_KEY` instead |
| Token exchange fails | Auth server misconfigured | Check `AUTH_SERVER_URL` and OAuth endpoints |
| `NUTRIENT_DWS_API_KEY` errors | API key invalid or expired | Verify at [dashboard.nutrient.io](https://dashboard.nutrient.io) |
