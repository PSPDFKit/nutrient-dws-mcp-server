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
- `CLIENT_ID`
- `TOKEN_ENDPOINT_AUTH_METHOD` (optional, default `client_secret_basic`)
- One of:
  - `CLIENT_SECRET` (when `TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic`)
  - `CLIENT_ASSERTION_PRIVATE_KEY` (when `TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt`)

Recommended/usually required:

- `RESOURCE_URL` (public MCP resource URL, usually `http://localhost:3000/mcp`)
- `AUTH_SERVER_URL`
- `ISSUER` (defaults to `AUTH_SERVER_URL` if omitted)
- `CLIENT_ASSERTION_ALG` (default `RS256`)
- `CLIENT_ASSERTION_KID` (optional)

Notes:

- `NUTRIENT_DWS_API_KEY` is not required in JWT mode.
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

export DWS_API_BASE_URL=http://localhost:4000
export RESOURCE_URL=http://127.0.0.1:3000/mcp
export AUTH_SERVER_URL=http://localhost:4000
export JWKS_URL=http://localhost:4000/.well-known/jwks.json
export ISSUER=http://localhost:4000

export CLIENT_ID=dws-mcp-server
export CLIENT_SECRET=dev-dws-mcp-secret

export MCP_DEBUG_LOGGING=true
export LOG_LEVEL=debug

pnpm run dev
```

`private_key_jwt` variant:

```bash
export TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt
export CLIENT_ID=dws-mcp-server
export CLIENT_ASSERTION_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
export CLIENT_ASSERTION_ALG=RS256
export CLIENT_ASSERTION_KID=runtime-kid-1
```

Generate a keypair (RSA, for `RS256`):

```bash
mkdir -p .keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out .keys/mcp-runtime-private.pem
openssl rsa -in .keys/mcp-runtime-private.pem -pubout -out .keys/mcp-runtime-public.pem
```

Load private key into env var:

```bash
# Option A: one-line escaped value (great for .env files)
export CLIENT_ASSERTION_PRIVATE_KEY="$(awk '{printf "%s\\\\n", $0}' .keys/mcp-runtime-private.pem)"

# Option B: raw multiline value (works for direct shell export)
export CLIENT_ASSERTION_PRIVATE_KEY="$(cat .keys/mcp-runtime-private.pem)"
```

Set a `kid` and use the same `kid` in your runtime client's registered JWKS:

```bash
export CLIENT_ASSERTION_KID=runtime-kid-1
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

## Common Failures

- `Cannot POST /`: client points to `/` instead of `/mcp`.
- `401 invalid_token`: missing/invalid bearer or JWT.
- `unexpected "aud" claim value`: token audience does not match expected resource/audience set.
- `AUTH_MODE=jwt requires JWKS_URL`: missing JWT config.
- `TOKEN_ENDPOINT_AUTH_METHOD=private_key_jwt requires CLIENT_ASSERTION_PRIVATE_KEY`: missing signing key for client assertion.
- `Static HTTP auth requires bearer tokens`: set one of the bearer token env formats.
