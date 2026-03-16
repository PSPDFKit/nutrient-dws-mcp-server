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

The OAuth flow will use `{AUTH_SERVER_URL}/oauth2/authorize` and `{AUTH_SERVER_URL}/oauth2/token`. The `CLIENT_ID` env var can override the default client ID (`nutrient-dws-mcp-server`).

---

## HTTP Transport + Static Auth

Static auth uses pre-shared bearer tokens. The server authenticates to DWS with an API key.

### Against production DWS

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=static
export NUTRIENT_DWS_API_KEY=your_dws_api_key
export MCP_BEARER_TOKEN=local-dev-token
export MCP_DEBUG_LOGGING=true

pnpm run dev
```

### Against local DWS debug build

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=static
export DWS_API_BASE_URL=http://localhost:4000
export NUTRIENT_DWS_API_KEY=your_local_dws_api_key
export MCP_BEARER_TOKEN=local-dev-token
export MCP_DEBUG_LOGGING=true

pnpm run dev
```

### Verify

```bash
curl http://127.0.0.1:3000/health

curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer local-dev-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Multiple tokens with scopes

Configure per-token access control via `MCP_BEARER_TOKENS_JSON`:

```bash
export MCP_BEARER_TOKENS_JSON='[
  {"token":"admin-token","clientId":"admin","scopes":["dws:all"]},
  {"token":"readonly-token","clientId":"viewer","scopes":["dws:read"],"allowedTools":["check_credits","directory_tree"]}
]'
```

Or use named token env vars:

```bash
export MCP_BEARER_TOKEN_ADMIN=admin-token
export MCP_BEARER_SCOPES_ADMIN="dws:all"
export MCP_BEARER_TOKEN_VIEWER=readonly-token
export MCP_BEARER_ALLOWED_TOOLS_VIEWER="check_credits,directory_tree"
```

---

## HTTP Transport + JWT/OAuth Auth

JWT mode validates OAuth access tokens via JWKS. The user's token is forwarded directly to the DWS API — no `NUTRIENT_DWS_API_KEY` needed.

### Against production DWS

All auth/JWKS settings default to `api.nutrient.io`, so minimal config is:

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=jwt
export MCP_DEBUG_LOGGING=true

pnpm run dev
```

The MCP client (Claude Code, MCP Inspector) discovers the auth server via `/.well-known/oauth-protected-resource`, registers via DCR, and redirects the user to sign in at `api.nutrient.io`. The user's OAuth access token is forwarded directly to the DWS API.

### Against local DWS debug build

For testing against the Louisville `hosted` app (port 4000):

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=jwt
export PORT=3000
export MCP_HOST=127.0.0.1

export DWS_API_BASE_URL=http://localhost:4000
export AUTH_SERVER_URL=http://localhost:4000
export JWKS_URL=http://localhost:4000/.well-known/jwks.json
export ISSUER=http://localhost:4000

export MCP_DEBUG_LOGGING=true

pnpm run dev
```

This requires the local DWS instance to expose:

- `/.well-known/oauth-authorization-server` — OAuth server metadata
- `/.well-known/jwks.json` — JWKS for token validation
- `/oauth/register` — Dynamic Client Registration (DCR)
- `/oauth/token` — token endpoint

The DWS `hosted` app seeds a default MCP client (`dws-mcp-server`) but in JWT-forward mode no server-side client credentials are needed — the user's OAuth token is passed through directly.

### Verify

```bash
# OAuth discovery
curl http://127.0.0.1:3000/.well-known/oauth-protected-resource

# Unauthenticated (expect 401 + WWW-Authenticate)
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Authenticated (use a valid JWT from your auth server)
export ACCESS_TOKEN=eyJ...
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

---

## Environment Variable Reference

### Common

| Variable             | Default                    | Description                              |
|----------------------|----------------------------|------------------------------------------|
| `MCP_TRANSPORT`      | `stdio`                    | `stdio` or `http`                        |
| `PORT`               | `3000`                     | HTTP port                                |
| `MCP_HOST`           | `127.0.0.1`                | HTTP bind host                           |
| `MCP_ALLOWED_HOSTS`  | —                          | Comma/space-separated allowed hostnames  |
| `DWS_API_BASE_URL`   | `https://api.nutrient.io`  | DWS API base URL                         |
| `NUTRIENT_DWS_API_KEY` | —                        | DWS API key (optional in stdio+OAuth mode) |
| `SANDBOX_PATH`       | —                          | Filesystem sandbox root                  |
| `MCP_DEBUG_LOGGING`  | —                          | Request/response logging (`true`/`1`)    |
| `LOG_LEVEL`          | `debug`                    | Winston logger level                     |

### Static auth (HTTP)

| Variable                    | Description                                |
|-----------------------------|--------------------------------------------|
| `MCP_BEARER_TOKEN`          | Single bearer token                        |
| `MCP_BEARER_TOKEN_*`        | Named bearer tokens (e.g. `_ADMIN`)        |
| `MCP_BEARER_TOKENS_JSON`    | JSON object/array of principals            |
| `MCP_BEARER_CLIENT_ID`      | Client ID for single token                 |
| `MCP_BEARER_SCOPES`         | Scopes for single token                    |
| `MCP_BEARER_ALLOWED_TOOLS`  | Tool allowlist for single token            |
| `MCP_BEARER_SCOPES_*`       | Scopes for named token                     |
| `MCP_BEARER_ALLOWED_TOOLS_*`| Tool allowlist for named token             |

### JWT/OAuth auth (HTTP)

| Variable              | Default                                              | Description                        |
|-----------------------|------------------------------------------------------|------------------------------------|
| `AUTH_MODE`           | `static`                                             | `static` or `jwt`                  |
| `AUTH_SERVER_URL`     | `https://api.nutrient.io`                            | Authorization server base URL      |
| `JWKS_URL`            | `https://api.nutrient.io/.well-known/jwks.json`      | JWKS endpoint                      |
| `RESOURCE_URL`        | `http://localhost:3000/mcp`                          | Protected resource URL             |
| `ISSUER`              | `AUTH_SERVER_URL`                                    | JWT issuer                         |
| `CLIENT_ID`           | `nutrient-dws-mcp-server`                            | OAuth client ID (stdio OAuth flow) |

### Audience matching (JWT mode)

Accepted audience values: `dws-mcp`, plus `RESOURCE_URL` variants (origin, path, with/without trailing slash).

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
| `Cannot POST /` | Client points to `/` instead of `/mcp` | Use `http://localhost:3000/mcp` |
| `401 invalid_token` | Missing/invalid bearer or JWT | Check token value or JWKS config |
| `unexpected "aud" claim value` | Token audience mismatch | Check `RESOURCE_URL` matches your MCP endpoint |
| `401` from DWS on tool calls | Forwarded OAuth token not accepted by DWS | Ensure auth server issues DWS-compatible tokens |
| `Static HTTP auth requires bearer tokens` | No bearer token configured | Set `MCP_BEARER_TOKEN` or `MCP_BEARER_TOKENS_JSON` |
| `Protected resource does not match` | `RESOURCE_URL` doesn't match client's URL | Use public URL (e.g. ngrok), not localhost |
| Browser doesn't open (stdio OAuth) | Running in headless/CI | Set `NUTRIENT_DWS_API_KEY` instead |
