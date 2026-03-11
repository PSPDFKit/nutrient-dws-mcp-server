# DWS MCP Server OAuth & Auth Design

## Summary

This design upgrades the Nutrient DWS MCP Server from a local-only stdio tool to a deployable HTTP service with production-grade authentication. Currently the server runs exclusively over stdin/stdout with a static API key — suitable for a single developer's desktop but not for multi-tenant or cloud deployment. The upgrade adds an HTTP transport layer (Streamable HTTP at `/mcp`), replaces the static API key check with JWT validation against a remote JWKS endpoint, and introduces a token exchange step so that each MCP user's access token is exchanged for a short-lived DWS API credential before any document operation is performed.

The core design principle is additive layering: stdio mode is preserved exactly as-is, and all new behavior is opt-in via environment variables (`MCP_TRANSPORT=http`, `AUTH_MODE=jwt`). A strategy-pattern auth middleware factory means JWT and static-bearer code paths converge on a shared `AuthInfo` structure, keeping tool handlers unaware of which auth mode is active. Refactoring the existing module-level `callNutrientApi` function into a session-scoped `DwsApiClient` class is what makes per-user token resolution possible without threading auth context through every call site. Work is broken into six sequential phases so each phase can be reviewed, tested, and merged independently.

## Definition of Done

Upgrade the nutrient-dws-mcp-server from stdio-only with static API key auth to support HTTP transport with OAuth 2.0 JWT-based authentication, token exchange, and MCP auth discovery — while maintaining full backward compatibility with the existing stdio/API-key local dev flow.

**Deliverables:**

1. **HTTP transport** (Streamable HTTP at `/mcp`) incorporated from PR #20, alongside existing stdio mode
2. **Protected Resource Metadata** endpoint (`/.well-known/oauth-protected-resource`) and proper `WWW-Authenticate` headers on 401s for MCP auth discovery (RFC 9728)
3. **JWT validation via JWKS** replacing static bearer auth in production (`jose` library, validating `aud`, `scope`, `exp`, `iss`), with static bearer tokens retained for local dev/testing via `AUTH_MODE=jwt|static`
4. **Token exchange client** (RFC 8693) that obtains short-lived `dws_runtime_token` before each DWS API call, with per-principal caching
5. **`allowed_tools` enforcement** from JWT claims (filter `tools/list`, block unauthorized tool calls)
6. **Session binding** to principal fingerprint `sha256(sub|azp|sid)`
7. **Updated Dockerfile** and environment configuration

**Success criteria:**

- Stdio mode works unchanged (backward compatible)
- HTTP mode with `AUTH_MODE=static` works with bearer tokens
- HTTP mode with `AUTH_MODE=jwt` validates JWTs via JWKS, performs token exchange, enforces `allowed_tools` from claims
- All existing tests pass, new tests cover JWT validation, token exchange, protected resource metadata, and auth mode switching
- Acceptance criteria AC2.1-AC2.9 from the spec are met

**Out of scope:**

- Track A (hosted OAuth provider — consent screen, DCR, token issuance). Track B consumes those endpoints.
- Track C (Helm chart, managed cloud deployment)
- CI/CD pipeline changes (Buildkite, GHCR)

## Acceptance Criteria

### dws-mcp-oauth.AC1: Protected Resource Metadata & Auth Discovery
- **dws-mcp-oauth.AC1.1 Success:** `GET /.well-known/oauth-protected-resource` returns JSON with `resource` and `authorization_servers` fields per RFC 9728
- **dws-mcp-oauth.AC1.2 Success:** `authorization_servers` array contains the configured `AUTH_SERVER_URL`
- **dws-mcp-oauth.AC1.3 Success:** Unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate: Bearer resource_metadata="<url>"` header
- **dws-mcp-oauth.AC1.4 Failure:** `GET /.well-known/oauth-protected-resource` is not served in stdio mode (no HTTP server)

### dws-mcp-oauth.AC2: JWT Validation via JWKS
- **dws-mcp-oauth.AC2.1 Success:** Valid JWT with correct `aud=dws-mcp`, `scope=mcp:invoke`, valid signature, and non-expired `exp` is accepted
- **dws-mcp-oauth.AC2.2 Failure:** JWT with wrong `aud` returns 401 with `invalid_token` error
- **dws-mcp-oauth.AC2.3 Failure:** JWT with missing `mcp:invoke` scope returns 401
- **dws-mcp-oauth.AC2.4 Failure:** Expired JWT returns 401 with `invalid_token` error
- **dws-mcp-oauth.AC2.5 Failure:** JWT with invalid signature (wrong key) returns 401
- **dws-mcp-oauth.AC2.6 Success:** `AuthInfo` populated with `clientId` from `azp`, `scopes` from `scope`, `extra.allowedTools` from `allowed_tools` claim
- **dws-mcp-oauth.AC2.7 Success:** `AUTH_MODE=static` still works with bearer tokens when `AUTH_MODE=jwt` is not set

### dws-mcp-oauth.AC3: Token Exchange
- **dws-mcp-oauth.AC3.1 Success:** Tool invocation in JWT mode exchanges `mcp_access_token` for `dws_runtime_token` before calling DWS API
- **dws-mcp-oauth.AC3.2 Success:** Subsequent tool calls for same principal reuse cached `dws_runtime_token` (no redundant exchange)
- **dws-mcp-oauth.AC3.3 Success:** Expired cached `dws_runtime_token` triggers re-exchange on next call
- **dws-mcp-oauth.AC3.4 Failure:** Token exchange failure (auth server unreachable or rejects) returns MCP tool error, not HTTP error

### dws-mcp-oauth.AC4: DwsApiClient & Backward Compatibility
- **dws-mcp-oauth.AC4.1 Success:** All 4 DWS tools (`document_processor`, `document_signer`, `ai_redactor`, `check_credits`) use `DwsApiClient` for API calls
- **dws-mcp-oauth.AC4.2 Success:** Stdio mode uses `NUTRIENT_DWS_API_KEY` as bearer token via `DwsApiClient` — no behavior change
- **dws-mcp-oauth.AC4.3 Success:** HTTP + static auth mode uses `NUTRIENT_DWS_API_KEY` for DWS API calls

### dws-mcp-oauth.AC5: Environment & Dockerfile
- **dws-mcp-oauth.AC5.1 Success:** `AUTH_MODE=jwt` without `JWKS_URL` fails with clear validation error at startup
- **dws-mcp-oauth.AC5.2 Success:** `AUTH_MODE=jwt` without `CLIENT_ID`/`CLIENT_SECRET` fails with clear validation error
- **dws-mcp-oauth.AC5.3 Success:** Docker image builds and starts in both stdio and HTTP modes

### dws-mcp-oauth.AC6: Session Binding
- **dws-mcp-oauth.AC6.1 Success:** MCP session bound to `sha256(sub|azp|sid)` in JWT mode; subsequent requests from same principal succeed
- **dws-mcp-oauth.AC6.2 Failure:** Request with different principal fingerprint on existing session returns 403
- **dws-mcp-oauth.AC6.3 Success:** Token refresh (new JWT, same `sub|azp|sid`) does not break existing session

### dws-mcp-oauth.AC7: allowed_tools Enforcement
- **dws-mcp-oauth.AC7.1 Success:** `tools/list` response only includes tools in `allowed_tools` JWT claim
- **dws-mcp-oauth.AC7.2 Failure:** Calling a tool not in `allowed_tools` returns permission error
- **dws-mcp-oauth.AC7.3 Success:** Empty/missing `allowed_tools` claim allows all tools (no restriction)

## Glossary

- **MCP (Model Context Protocol)**: An open protocol that lets AI assistants (e.g., Claude) invoke external tools and services. The server in this repo is an MCP server — it exposes document-processing capabilities as callable tools.
- **Streamable HTTP transport**: The MCP transport variant that serves requests over HTTP (`POST /mcp`) instead of stdin/stdout. Defined in the MCP 2025-06-18 spec; enables remote and multi-tenant deployments.
- **DWS (Document Web Services)**: Nutrient's cloud API for document processing (PDF build, signing, AI redaction, credit checks). The MCP server wraps DWS as a set of tools.
- **JWT (JSON Web Token)**: A compact, signed token format (RFC 7519) used here as the bearer credential on HTTP requests. Contains claims like `sub`, `aud`, `exp`, `scope`, and custom fields such as `allowed_tools`.
- **JWKS (JSON Web Key Set)**: A published JSON document (RFC 7517) that lists the public keys used to verify JWT signatures. The MCP server fetches keys from `JWKS_URL` at runtime using the `jose` library.
- **`jose`**: A JavaScript/TypeScript library for JWT operations. Used here for `jwtVerify` (validate a JWT) and `createRemoteJWKSet` (fetch and cache a remote JWKS endpoint).
- **OAuth 2.0 Protected Resource Metadata (RFC 9728)**: A standard that lets a resource server (this MCP server) advertise which authorization server issues tokens for it. Clients discover this via `GET /.well-known/oauth-protected-resource`.
- **Token exchange (RFC 8693)**: An OAuth 2.0 extension that lets a client swap one access token for another. Here the MCP server exchanges a user's `mcp_access_token` for a short-lived `dws_runtime_token` scoped for the DWS API.
- **`mcp_access_token`**: The JWT the MCP client (e.g., Co-work) presents to the MCP server. Issued by the OAuth authorization server (Track A).
- **`dws_runtime_token`**: A short-lived credential returned by the token exchange. Used as the bearer token on DWS API calls; scoped to the individual user's session.
- **`AuthInfo`**: A TypeScript object populated by the auth middleware and attached to each request as `req.auth`. Carries `clientId`, `scopes`, `allowedTools`, and identity data for session binding. Both JWT and static strategies produce the same shape.
- **Strategy pattern**: A design pattern where a factory selects the concrete implementation (JWT vs. static-bearer) and callers only depend on the shared interface. Used here for `createAuthMiddleware`.
- **Principal fingerprint**: A `sha256` hash derived from identity claims (`sub|azp|sid`) that uniquely identifies a user across token refreshes. Used to bind an MCP session to a single principal and to key the token exchange cache.
- **`sub` / `azp` / `sid`**: JWT claims. `sub` = subject (end-user identifier); `azp` = authorized party (the OAuth client that obtained the token); `sid` = session ID (survives token refresh).
- **`allowed_tools` claim**: A custom JWT claim listing the MCP tool names the bearer is permitted to invoke. Enforced both at session setup and at call time.
- **PKCE (Proof Key for Code Exchange)**: An OAuth 2.0 extension (RFC 7636) securing the authorization code flow for public clients. The full PKCE flow is handled by the client and auth server, not by this MCP server.
- **Zod**: A TypeScript schema validation library used in `environment.ts` to parse and validate env vars at startup.
- **Confidential client**: An OAuth client that can keep a secret (runs server-side). The MCP server acts as a confidential client during token exchange, authenticating with `CLIENT_ID` and `CLIENT_SECRET`.
- **DCR (Dynamic Client Registration)**: An OAuth mechanism (RFC 7591) for clients to register programmatically. Out of scope (Track A).
- **`DwsApiClient`**: A session-scoped TypeScript class (Phase 4) replacing the module-level `callNutrientApi` function. Holds auth context for one MCP session.

## Architecture

### Transport Modes

The server supports two transport modes selected at startup via `MCP_TRANSPORT`:

- **stdio** (default) — local desktop usage via stdin/stdout. Auth uses `NUTRIENT_DWS_API_KEY` env var. No HTTP server started. Unchanged from current behavior.
- **http** — remote/deployed usage via Streamable HTTP at `POST /mcp`. Auth mode selected via `AUTH_MODE`:
  - `static` (default) — constant-time bearer token comparison, per PR #20's `MCP_BEARER_TOKEN*` env vars.
  - `jwt` — validate `mcp_access_token` JWT against JWKS, perform RFC 8693 token exchange for DWS API calls.

### Auth Middleware (Strategy Pattern)

A single `createAuthMiddleware(mode, config)` factory returns the appropriate Express middleware:

- **Static strategy:** Constant-time comparison of bearer token against configured principals (from `MCP_BEARER_TOKEN*` or `MCP_BEARER_TOKENS_JSON`). Builds `AuthInfo` with `clientId`, `scopes`, `allowedTools` from env config.
- **JWT strategy:** Validates bearer token as JWT using `jose`'s `jwtVerify` + `createRemoteJWKSet`. Validates `aud` = `dws-mcp`, `scope` includes `mcp:invoke`, checks `exp` and `iss`. Extracts `allowed_tools`, `sub`, `azp`, `sid` from claims to build `AuthInfo`.

Both strategies produce identical `AuthInfo` on `req.auth`, so downstream code (session management, tool handlers) is auth-mode agnostic.

### MCP Auth Discovery (RFC 9728)

In HTTP mode, the server exposes:

- `GET /.well-known/oauth-protected-resource` — returns Protected Resource Metadata document:
  ```json
  {
    "resource": "https://mcp.nutrient.io/mcp",
    "authorization_servers": ["https://api.nutrient.io"]
  }
  ```
  Both `resource` and `authorization_servers[0]` are configurable via `RESOURCE_URL` and `AUTH_SERVER_URL` env vars with production defaults.

- **401 responses** include `WWW-Authenticate: Bearer resource_metadata="<RESOURCE_URL>/.well-known/oauth-protected-resource"` header.

This is the entry point for the MCP 2025-06-18 auth discovery flow: client hits `/mcp`, gets 401, follows `resource_metadata` URL, discovers authorization server, performs OAuth PKCE flow.

### Session-Bound API Client

Each MCP session gets a `DwsApiClient` instance that encapsulates DWS Processor API communication:

```typescript
interface DwsApiClient {
  post(endpoint: string, data: FormData | Record<string, unknown>): Promise<AxiosResponse>
  get(endpoint: string): Promise<AxiosResponse>
}
```

- **stdio mode:** Client uses static `NUTRIENT_DWS_API_KEY` as bearer token.
- **HTTP + static auth:** Client uses static `NUTRIENT_DWS_API_KEY` (same as stdio — static bearer tokens only authenticate the MCP connection, not the DWS API call).
- **HTTP + JWT auth:** Client performs token exchange before each DWS API call. Exchanges the session's `mcp_access_token` for a `dws_runtime_token` via the auth server's token endpoint, using the MCP server's confidential client credentials. The `dws_runtime_token` is cached per-principal.

### Token Exchange (RFC 8693)

Token exchange flow for JWT auth mode:

1. Tool handler invoked → session-bound `DwsApiClient.post()` called
2. Client checks per-principal cache for valid `dws_runtime_token`
3. If cache miss or expired: `POST {AUTH_SERVER_URL}/oauth/token` with:
   - `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`
   - `subject_token=<mcp_access_token>` (from session's `AuthInfo.token`)
   - `subject_token_type=urn:ietf:params:oauth:token-type:access_token`
   - `requested_token_type=urn:ietf:params:oauth:token-type:access_token`
   - Client credentials via HTTP Basic auth (`CLIENT_ID:CLIENT_SECRET`)
4. Cache `dws_runtime_token` keyed by principal fingerprint, TTL = `exp - 10s`
5. Use `dws_runtime_token` as bearer token for DWS Processor API call

### Principal Fingerprint & Session Binding

In JWT mode, the principal fingerprint is `sha256(sub|azp|sid)` derived from JWT claims. This survives token refresh — when Co-work silently refreshes the `mcp_access_token`, the new token has the same `sub`, `azp`, and `sid` claims, so the session remains bound to the same principal.

In static mode, the fingerprint is `sha256(clientId:token)` (PR #20's existing behavior).

Session binding enforces that subsequent requests on an MCP session come from the same principal. A request with a different principal fingerprint on an existing session returns 403.

### allowed_tools Enforcement

The `allowed_tools` claim from the JWT (or from static config) determines which tools are visible and callable:

1. **At session initialization:** `createMcpServer({ allowedTools })` only registers tools in the allowlist.
2. **At tool invocation:** Runtime check via `isToolAllowed(toolName, extra.authInfo)` rejects calls to tools not in `allowed_tools`.

This dual enforcement (registration-time + invocation-time) prevents both tool discovery and execution for unauthorized tools.

## Existing Patterns

### From PR #20

This design builds directly on PR #20's patterns:

- **`createHttpApp()` factory** — creates Express app with session management, returns `{ app, close }`. We extend this to accept auth middleware config.
- **`createMcpServer({ sandboxEnabled, allowedTools })`** — per-session server factory. We add API client binding.
- **`HttpSessionContext`** — tracks `principalFingerprint`, `server`, `transport` per session. We reuse this, changing fingerprint derivation for JWT mode.
- **`getEnvironment()` / `validateEnvironment()`** — memoized env config parsing with Zod. We extend the schema for new auth vars.
- **`createBearerAuthMiddleware(principals)`** — becomes the "static" strategy in our auth middleware factory.

### From Existing Codebase

- **`callNutrientApi(endpoint, data)`** in `src/dws/api.ts` — centralized API call function. We replace this with `DwsApiClient` class methods, adding GET support and token resolution.
- **`getApiKey()`** in `src/dws/utils.ts` — env var validation. Retained for stdio and HTTP+static modes; unused in JWT mode.
- **Tool handler pattern** — `server.tool(name, description, schema, handler)`. PR #20 adds `extra` parameter with `authInfo`. We keep this pattern.

### New Pattern: DwsApiClient

Introducing a session-scoped API client is a new pattern. Justified by: the existing `callNutrientApi` is a stateless module-level function that reads auth from env vars. Token exchange requires per-request auth context, which needs either threading context through call chains or encapsulating it in a client instance. The client approach is cleaner and keeps tool implementations unchanged.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Incorporate HTTP Transport from PR #20

**Goal:** Add Streamable HTTP transport alongside stdio, with static bearer auth, session management, health endpoint, and environment config.

**Components:**
- `src/index.ts` — rewrite to support both transports, per-session McpServer factory, Express app setup
- `src/http/bearerAuth.ts` — static bearer auth middleware, principal fingerprint, allowed tools helpers
- `src/utils/environment.ts` — Zod-validated env config parsing (`MCP_TRANSPORT`, `PORT`, `MCP_HOST`, `MCP_ALLOWED_HOSTS`, bearer token config)
- `package.json` — add `express@^5`, `supertest` (dev), `@types/express`, `@types/supertest`
- `.dockerignore` — exclude `.git`, `node_modules`, `tests`, etc.
- `Dockerfile` — update comment, add `EXPOSE 3000`
- `pnpm-workspace.yaml` — add `linux` to supported architectures
- Tests: `tests/bearerAuth.test.ts`, `tests/environment.test.ts`, `tests/httpTransport.test.ts`

**Dependencies:** None (first phase)

**Done when:** `pnpm build` succeeds, `pnpm test` passes, HTTP mode starts with `MCP_TRANSPORT=http` and accepts bearer-authenticated MCP requests, stdio mode works unchanged, health endpoint responds at `/health`
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Protected Resource Metadata & WWW-Authenticate

**Goal:** Implement MCP auth discovery endpoints per RFC 9728.

**Components:**
- `src/http/protectedResource.ts` — `GET /.well-known/oauth-protected-resource` endpoint handler, `WWW-Authenticate` header helper
- `src/index.ts` — register protected resource endpoint on Express app
- `src/utils/environment.ts` — add `RESOURCE_URL` (default: `https://mcp.nutrient.io/mcp`) and `AUTH_SERVER_URL` (default: `https://api.nutrient.io`) env vars
- Tests: `tests/protectedResource.test.ts` — metadata response format, 401 header format

**Dependencies:** Phase 1 (HTTP transport)

**ACs covered:** `dws-mcp-oauth.AC1.1`, `dws-mcp-oauth.AC1.2`, `dws-mcp-oauth.AC1.3`, `dws-mcp-oauth.AC1.4`

**Done when:** `GET /.well-known/oauth-protected-resource` returns correct JSON, unauthenticated `/mcp` requests return 401 with `WWW-Authenticate` header containing `resource_metadata` URL, tests pass
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: JWT Validation via JWKS

**Goal:** Add JWT auth strategy alongside static bearer auth, selectable via `AUTH_MODE` env var.

**Components:**
- `src/http/jwtAuth.ts` — JWT validation middleware using `jose` (`jwtVerify`, `createRemoteJWKSet`), validates `aud`, `scope`, `exp`, `iss`, extracts claims into `AuthInfo`
- `src/http/authMiddleware.ts` — strategy-pattern factory `createAuthMiddleware(mode, config)` dispatching to JWT or static strategy
- `src/http/bearerAuth.ts` — refactor to be the "static" strategy, conforming to shared `AuthInfo` contract
- `src/utils/environment.ts` — add `AUTH_MODE` (default: `static`), `JWKS_URL`, `ISSUER` env vars
- `package.json` — add `jose` dependency
- Tests: `tests/jwtAuth.test.ts` — valid JWT accepted, expired JWT rejected, wrong audience rejected, wrong scope rejected, missing token rejected, `AuthInfo` correctly populated from claims

**Dependencies:** Phase 1 (HTTP transport, auth middleware mount point)

**ACs covered:** `dws-mcp-oauth.AC2.1`–`dws-mcp-oauth.AC2.5`

**Done when:** `AUTH_MODE=jwt` validates JWTs via JWKS, rejects invalid/expired tokens with appropriate errors, `AUTH_MODE=static` works unchanged, principal fingerprint derived from `sha256(sub|azp|sid)` in JWT mode, tests pass
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: DwsApiClient & credits.ts Unification

**Goal:** Replace module-level `callNutrientApi` with session-scoped `DwsApiClient`, unify `credits.ts` to use it.

**Components:**
- `src/dws/client.ts` — `DwsApiClient` class with `post(endpoint, data)` and `get(endpoint)` methods, accepts auth context (API key or token resolver) at construction
- `src/dws/api.ts` — deprecate/remove `callNutrientApi`, export factory `createApiClient(authContext)`
- `src/dws/credits.ts` — refactor to accept `DwsApiClient` instead of calling `axios.get` directly
- `src/dws/build.ts`, `src/dws/sign.ts`, `src/dws/ai-redact.ts` — refactor to accept `DwsApiClient` parameter
- `src/index.ts` — create `DwsApiClient` per session (stdio: API key client; HTTP: session-bound client), pass to tool handlers
- Tests: update `tests/unit.test.ts` to work with new client injection pattern

**Dependencies:** Phase 1 (session management)

**ACs covered:** `dws-mcp-oauth.AC4.1`

**Done when:** All tools use `DwsApiClient`, `credits.ts` no longer uses direct `axios.get`, existing tests pass with new client pattern, stdio mode works unchanged
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Token Exchange Client

**Goal:** Implement RFC 8693 token exchange so JWT-authenticated sessions obtain `dws_runtime_token` for DWS API calls.

**Components:**
- `src/http/tokenExchange.ts` — `TokenExchangeClient` with per-principal caching, exchanges `mcp_access_token` for `dws_runtime_token` via auth server token endpoint using confidential client credentials
- `src/dws/client.ts` — extend `DwsApiClient` to use token exchange in JWT mode (lazy token resolution before each API call)
- `src/utils/environment.ts` — add `CLIENT_ID`, `CLIENT_SECRET` env vars (required in JWT mode)
- Tests: `tests/tokenExchange.test.ts` — successful exchange, cached token reuse, cache expiry triggers re-exchange, exchange failure returns MCP error, invalid subject token handled

**Dependencies:** Phase 3 (JWT auth — need `mcp_access_token` in session), Phase 4 (`DwsApiClient`)

**ACs covered:** `dws-mcp-oauth.AC3.1`–`dws-mcp-oauth.AC3.4`

**Done when:** JWT-authenticated tool calls exchange tokens before hitting DWS API, tokens cached per-principal with TTL, exchange errors surface as MCP tool errors, tests pass
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Dockerfile & Environment Finalization

**Goal:** Production-ready Dockerfile and complete environment configuration.

**Components:**
- `Dockerfile` — add `EXPOSE 3000`, configurable `MCP_TRANSPORT` default, update entrypoint comment
- `.env.example` — document all env vars with descriptions
- `src/utils/environment.ts` — finalize validation: `AUTH_MODE=jwt` requires `JWKS_URL`, `CLIENT_ID`, `CLIENT_SECRET`; `AUTH_MODE=static` + `MCP_TRANSPORT=http` requires bearer token config
- README updates for HTTP mode, JWT auth mode, env var documentation

**Dependencies:** Phase 5 (all auth features complete)

**ACs covered:** `dws-mcp-oauth.AC5.1`–`dws-mcp-oauth.AC5.3`

**Done when:** `docker build` succeeds, container starts in both stdio and HTTP modes, env validation catches missing required vars with clear error messages
<!-- END_PHASE_6 -->

## Additional Considerations

**Error responses in JWT mode:** Expired JWT returns HTTP 401 with `WWW-Authenticate: Bearer error="invalid_token"`. Invalid signature returns same. Missing token returns 401 with `WWW-Authenticate: Bearer resource_metadata="..."`. Token exchange failure returns MCP tool error (not HTTP error — the MCP connection is valid, the downstream call failed).

**Clock skew:** `jose`'s `jwtVerify` accepts a `clockTolerance` option. Use 30 seconds to handle minor clock drift between auth server and MCP server.

**Token exchange cache eviction:** Simple `Map` with TTL check on access. No background cleanup needed — stale entries are evicted lazily on next access for the same principal. The cache is bounded by the number of active principals (practically small).

**Backward compatibility:** stdio mode is completely unchanged. No new env vars required for stdio. HTTP + static mode only requires the same env vars as PR #20. JWT mode is opt-in via `AUTH_MODE=jwt`.
