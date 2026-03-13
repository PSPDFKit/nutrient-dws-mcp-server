# DWS MCP Server Local Testing

This guide covers local testing only. Docker/deployment steps are intentionally omitted.

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

## Runtime Modes

### Transport mode (`MCP_TRANSPORT`)

- `stdio` (default): MCP over stdin/stdout
- `http`: MCP Streamable HTTP server (`/mcp`)

### Auth mode (`AUTH_MODE`, HTTP only)

- `static` (default): bearer token(s) configured via environment variables
- `jwt`: validates OAuth/JWT access tokens via JWKS and exchanges runtime tokens

## Environment Variables

### Common

- `MCP_TRANSPORT`: `stdio` or `http` (default `stdio`)
- `PORT`: HTTP port (default `3000`)
- `MCP_HOST`: bind host (default `127.0.0.1`)
- `MCP_ALLOWED_HOSTS`: comma/space separated allowed hostnames
- `DWS_API_BASE_URL`: DWS API base URL (default `https://api.nutrient.io`)
- `MCP_DEBUG_LOGGING`: request/response logging (`true`/`1`/`on`)
- `LOG_LEVEL`: logger level (default `debug`)
- `SANDBOX_PATH`: optional filesystem sandbox root

### Static auth (`AUTH_MODE=static`)

Required in HTTP static mode:

- `NUTRIENT_DWS_API_KEY`
- One of:
  - `MCP_BEARER_TOKEN`
  - `MCP_BEARER_TOKEN_*` (multiple named tokens)
  - `MCP_BEARER_TOKENS_JSON` (JSON object/array)

Optional token metadata:

- `MCP_BEARER_CLIENT_ID`
- `MCP_BEARER_SCOPES`
- `MCP_BEARER_ALLOWED_TOOLS`
- `MCP_BEARER_SCOPES_*`
- `MCP_BEARER_ALLOWED_TOOLS_*`

### JWT auth (`AUTH_MODE=jwt`)

Required:

- `AUTH_MODE=jwt`

Optional (all have production defaults):

- `JWKS_URL` (default `https://api.nutrient.io/.well-known/jwks.json`)
- `AUTH_SERVER_URL` (default `https://api.nutrient.io`)
- `RESOURCE_URL` (default `https://mcp.nutrient.io/mcp`, set to your public MCP URL)
- `ISSUER` (defaults to `AUTH_SERVER_URL`)

Notes:

- `NUTRIENT_DWS_API_KEY` is not required in JWT mode — the user's OAuth access token is forwarded directly to the DWS API.
- `CLIENT_ID`, `CLIENT_SECRET`, and `CLIENT_ASSERTION_*` are no longer needed.
- Audience matching accepts `dws-mcp` plus `RESOURCE_URL` variants (origin/path and trailing slash variants).

## Local Run: HTTP + Static Auth

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=static
export PORT=3000
export MCP_HOST=127.0.0.1
export DWS_API_BASE_URL=https://api.nutrient.io
export NUTRIENT_DWS_API_KEY=your_dws_api_key
export MCP_BEARER_TOKEN=local-dev-token
export MCP_DEBUG_LOGGING=true
export LOG_LEVEL=debug

pnpm run dev
```

Verify:

```bash
curl http://127.0.0.1:3000/health

curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer local-dev-token" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Local Run: HTTP + JWT Auth (production DWS)

All auth/JWKS settings default to `api.nutrient.io`, so minimal config is:

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=jwt
export RESOURCE_URL=http://localhost:3000/mcp
export MCP_DEBUG_LOGGING=true

pnpm run dev
```

The MCP client (Claude Code, MCP Inspector) will discover the auth server via `/.well-known/oauth-protected-resource`, register itself via DCR, and redirect the user to sign in at `api.nutrient.io`. The user's OAuth access token is forwarded directly to the DWS API.

Quick checks:

```bash
curl http://127.0.0.1:3000/.well-known/oauth-protected-resource

curl -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# Expected: 401 + WWW-Authenticate
```

Authenticated check (use a valid JWT from your auth server):

```bash
export ACCESS_TOKEN=eyJ...

curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Local Run: stdio

Required:

- `MCP_TRANSPORT=stdio` (or omit, it is default)
- `NUTRIENT_DWS_API_KEY`

Run:

```bash
export MCP_TRANSPORT=stdio
export NUTRIENT_DWS_API_KEY=your_dws_api_key
pnpm run dev
```

## MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser-based tool for interactively testing and debugging MCP servers. It connects to your running server and lets you inspect available tools, send requests, and view responses in real time.

```bash
npx @modelcontextprotocol/inspector
```

The inspector UI opens at `http://localhost:6274`. Point it at your running server (e.g. `http://localhost:3000/mcp`) to start testing.

## Local Run: HTTP + JWT Auth (localhost DWS debug build)

For testing against a local DWS instance (e.g. the Louisville `hosted` app running on port 4000):

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=jwt
export PORT=3000
export MCP_HOST=127.0.0.1

export DWS_API_BASE_URL=http://localhost:4000
export RESOURCE_URL=http://localhost:3000/mcp
export AUTH_SERVER_URL=http://localhost:4000
export JWKS_URL=http://localhost:4000/.well-known/jwks.json
export ISSUER=http://localhost:4000

export MCP_DEBUG_LOGGING=true

pnpm run dev
```

This requires the DWS auth server to be running locally with:
- OAuth authorization server metadata at `/.well-known/oauth-authorization-server`
- JWKS at `/.well-known/jwks.json`
- DCR at `/oauth/register`
- Token endpoint at `/oauth/token`

The DWS `hosted` app seeds a default MCP client (`dws-mcp-server`) but in JWT-forward mode no server-side client credentials are needed — the user's OAuth token is passed through directly.

## Common Failures

- `Cannot POST /`: client points to `/` instead of `/mcp`.
- `401 invalid_token`: missing/invalid bearer or JWT.
- `unexpected "aud" claim value`: token audience does not match expected resource/audience set. Check `RESOURCE_URL`.
- `401` from DWS API on tool calls: the forwarded OAuth token is not accepted by the DWS API. Ensure the auth server issues tokens that the DWS API recognizes.
- `Static HTTP auth requires bearer tokens`: set one of the bearer token env formats.
- `Protected resource does not match`: `RESOURCE_URL` must match the URL the client connects to (e.g. ngrok URL, not localhost).
