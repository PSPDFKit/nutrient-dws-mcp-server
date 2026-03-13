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
- `JWKS_URL`

Optional:

- `RESOURCE_URL` (public MCP resource URL, usually `http://localhost:3000/mcp`)
- `AUTH_SERVER_URL` (OAuth server URL)
- `ISSUER` (JWT issuer claim validation, defaults to `AUTH_SERVER_URL` if omitted)

Notes:

- `NUTRIENT_DWS_API_KEY` is not required in JWT mode.
- `CLIENT_ID`, `CLIENT_SECRET`, and `CLIENT_ASSERTION_*` are no longer needed since the access token is forwarded directly to the DWS API.
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

## Local Run: HTTP + JWT Auth

```bash
export MCP_TRANSPORT=http
export AUTH_MODE=jwt
export PORT=3000
export MCP_HOST=127.0.0.1

export DWS_API_BASE_URL=https://api.nutrient.io
export RESOURCE_URL=http://localhost:3000/mcp
export AUTH_SERVER_URL=https://api.nutrient.io
export JWKS_URL=https://api.nutrient.io/.well-known/jwks.json
export ISSUER=https://api.nutrient.io

export MCP_DEBUG_LOGGING=true
export LOG_LEVEL=debug

pnpm run dev
```

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

## Common Failures

- `Cannot POST /`: client points to `/` instead of `/mcp`.
- `401 invalid_token`: missing/invalid bearer or JWT.
- `unexpected "aud" claim value`: token audience does not match expected resource/audience set.
- `AUTH_MODE=jwt requires JWKS_URL`: missing JWT config.
- `TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt requires CLIENT_ASSERTION_PRIVATE_KEY`: missing signing key for client assertion.
- `Static HTTP auth requires bearer tokens`: set one of the bearer token env formats.
