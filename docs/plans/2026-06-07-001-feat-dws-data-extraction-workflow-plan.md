---
title: "feat: data_extractor + query_extraction tools (DWS Data Extraction API) and a workflow example"
status: active
date: 2026-06-07
type: feat
target_repo: nutrient-dws-mcp-server
base_branch: main
---

# feat: `data_extractor` + `query_extraction` + a dynamic-workflow example

## Summary

Add the **Data Extraction workflow primitive** to the Nutrient DWS MCP server, targeting the **new standalone DWS Data Extraction API** (`POST https://api.nutrient.io/extraction/parse`) — a separate product with its own key, **not** a `json-content` output of the Processor `/build` endpoint.

- **`data_extractor`** — calls `/extraction/parse` with a `mode` (`text`/`structure`/`understand`/`agentic`) and output `format` (`spatial` elements or `markdown`). Spatial output (typed elements with `bounds`, `confidence`, `readingOrder`, `page`) can be large, so it is written to a file with a decision-grade summary returned inline; markdown is returned inline.
- **`query_extraction`** — reads a saved spatial-extraction file and returns **filtered element slices inline** (by page, region/bbox, minimum confidence, element type), so an agent can pull actionable coordinates into context on demand.
- **A dynamic-workflow example** — extract → query low-confidence elements → act with the existing `ai_redactor` / `document_signer`.

Architecture fit: main already has a `DwsApiClient` abstraction (`baseUrl` + `tokenResolver`, `.post(endpoint, data)`). `data_extractor` uses a **second client instance** authenticated with the Data Extraction key (`pdf_live_…`) — no new HTTP plumbing.

**Deferred to their own PRs:** `accessibility_tagger` (the DWS **Accessibility API** is also now standalone and includes auto-tag *and* validation), Viewer.

---

## Problem Frame

DWS is now four separate APIs, each with its own key: **Processor** (`/build`, `NUTRIENT_DWS_API_KEY`), **Data Extraction** (`/extraction/parse`, `pdf_live_…`), **Accessibility**, **Viewer**. The MCP server today only speaks Processor `/build`. Extraction was *previously* reachable as a `json-content` Build output; the dedicated Data Extraction API supersedes that with richer typed elements, confidence, coordinates, and four cost/quality modes.

Authoritative spec (verified on disk at `~/projects/nutrient-website/src/content/guides/dws-data-extraction/`):

- **Endpoint:** `POST https://api.nutrient.io/extraction/parse`. Auth: `Authorization: Bearer pdf_live_…` (separate dashboard key; `pdf_test_…` for testing).
- **Request:** multipart `file` + `instructions={"mode":…,"output":{"format":…,"includeWords":…}}` (also supports JSON-body-with-URL and raw-binary).
- **Modes:** `text` (1 cr/pg, markdown only, no OCR), `structure` (1.5 cr/pg, OCR spatial), `understand` (default, 9 cr/pg, AI-augmented), `agentic` (18 cr/pg, VLM).
- **Output:** `spatial` → `output.elements[]`; `markdown` → `output.markdown`. `text` mode defaults to markdown; others default to spatial.
- **Spatial element:** `{id, type, role, text, confidence, readingOrder, bounds:{x,y,width,height}, page:{pageIndex,pageNumber,width,height}}`. Types: `paragraph`, `table` (rows/cols/cells w/ per-cell bounds), `formula` (LaTeX), `picture` (alt text), `keyValueRegion`, `handwriting`. Optional `includeWords` adds word-level bounds.
- **Coordinates:** top-left origin, render-space pixels, `0 ≤ x+width ≤ page.width`.
- **Response envelope:** `{status, requestId, output:{elements|markdown}, metrics:{processingTimeMs,pagesProcessed}, configuration:{mode,outputFormat}}` — returned as JSON (the client streams it; the handler parses).

Because the schema is fully documented, the build proceeds against it directly; one live call (U0) is **confirmation**, not discovery.

---

## Requirements

- **R1.** `data_extractor` calls `/extraction/parse` exposing `mode`, `output.format`, `includeWords`, `language`, and page selection.
- **R2.** Spatial results are written to `outputPath`; the inline response is a decision-grade summary with **no extracted document content**. Markdown results return inline. `format: spatial` requires `outputPath`.
- **R3.** `query_extraction` reads a saved spatial-extraction file and returns filtered element slices inline (page, region/bbox, minConfidence, elementTypes).
- **R4.** Reuse main's `DwsApiClient`; add a Data Extraction client authenticated by `NUTRIENT_EXTRACTION_API_KEY`. Reuse sandbox path resolution and response/error helpers.
- **R5.** Respect the sandbox vs. non-sandbox registration model in `addToolsToServer`.
- **R6.** Any `outputPath`/`filePath` is validated through the sandbox resolver before the API call or file read.
- **R7.** Surface per-mode **credit cost** in the `data_extractor` description (`understand` = 9 cr/pg) so agents/users don't run up cost unknowingly.
- **R8.** Ship one runnable dynamic-workflow example (extract → query → act).
- **R9.** Update README (Available Tools + Features + the new env var) and amend `document_processor`'s description so it no longer advertises standalone extraction.
- **R10.** Tests cover request construction, spatial→file vs markdown→inline routing, query filtering, sandbox rejection, and key/PII safety — mocked against the documented response shape.

---

## Key Technical Decisions

- **KTD1 — Target the Data Extraction API via a second `DwsApiClient`.** `data_extractor` builds a multipart form (`file` + `instructions`) and calls `extractionClient.post('extraction/parse', form)`, where `extractionClient = createApiClientFromApiKey(getExtractionApiKey())`. Same `baseUrl` (`https://api.nutrient.io`), different token. *(Supersedes the original "wrap /build" decision — Data Extraction is a separate API.)*
- **KTD2 — Spatial → file + summary; markdown → inline; query for slices.** Spatial `elements[]` can be large; write the parsed JSON to `outputPath`, return a decision-grade summary, and let the agent retrieve slices via `query_extraction`. Markdown is a single blob → inline.
- **KTD3 — Decision-grade summary, never content.** Inline summary = per-page counts by element `type`/`role`, low-confidence element count (e.g. `confidence < 0.6`), bbox coverage, page count, output path, byte size. No `text` values. (PII boundary; the field names are now known, so counts are reliable.)
- **KTD4 — Mode + format surface with cost transparency.** Expose all four modes and both formats; default `mode: understand`, `format: spatial`. Validate `text`-mode ⇒ markdown-only. Put credit costs in the tool description (R7).
- **KTD5 — Separate key + env var.** `getExtractionApiKey()` reads `NUTRIENT_EXTRACTION_API_KEY` (distinct from Processor `NUTRIENT_DWS_API_KEY`); fail with a clear message if unset. Document both keys.
- **KTD6 — Inline data is transcript-visible.** `data_extractor` markdown/inline output and all `query_extraction` results enter the agent transcript (host/provider may log). Tool descriptions say so; recommend `outputPath` + scoped queries for sensitive docs.
- **KTD7 — Response is streamed then parsed.** `DwsApiClient.post` uses `responseType: 'stream'`; the extraction handler pipes to a string (`pipeToString`) and `JSON.parse`s, since extraction returns JSON (unlike Build's file streams).

---

## High-Level Technical Design

```mermaid
flowchart TD
    A[Agent: data_extractor\nfile + mode + format] --> V[validate outputPath via\nresolveWriteFilePath FIRST]
    V --> B[multipart form: file + instructions\n mode/output.format/includeWords]
    B --> C[extractionClient.post\n'extraction/parse']
    C --> P[pipe stream -> string -> JSON.parse]
    P --> D{format}
    D -- markdown --> E[output.markdown inline]
    D -- spatial --> F[write output.elements to outputPath\n-> decision-grade summary inline\n(per-page type counts, low-conf, page dims; NO text)]
    F -.-> G[Agent: query_extraction\nfile + page/region/minConfidence/type]
    G --> H[resolveReadFilePath -> parse -> filter\n-> matching elements inline]
    H -.-> I[Agent branches -> ai_redactor / document_signer]
```

*Directional — routing gates and the extract→query→act loop are the design intent; field shapes follow the documented schema and are confirmed in U0.*

---

## Implementation Units

### U0. Verify `/extraction/parse` against the documented schema + capture fixture

**Goal:** Confirm the documented response shape with one live call and record a fixture for tests.
**Requirements:** KTD7 (de-risks U3/U4).
**Dependencies:** none for building; the live call needs `NUTRIENT_EXTRACTION_API_KEY`. **Deferred until the user confirms a key** — building proceeds against the documented schema meanwhile.
**Files:** `tests/fixtures/extraction-spatial-sample.json`, `tests/fixtures/extraction-markdown-sample.json`
**Approach:** `text` mode (1 credit) for the markdown fixture and `structure` mode (1.5 cr) for a small spatial fixture against `tests/assets/example.pdf`. Save responses verbatim. Confirm field names match `bounds/confidence/page/readingOrder/type/role`.
**Test scenarios:** none — produces fixtures.
**Verification:** Fixtures saved; field names match the docs (if any drift, adjust U1/U3/U4).

### U1. Arg schemas

**Goal:** `DataExtractorArgsSchema` + `QueryExtractionArgsSchema`.
**Requirements:** R1, R2, R3, R6.
**Dependencies:** none (documented schema).
**Files:** `src/schemas.ts`
**Approach:** `DataExtractorArgsSchema`: `filePath` (sandbox read), `mode` enum (default `understand`), `format` enum `spatial|markdown` (default by mode), `includeWords` bool, `language` (string|string[]), `pages` (`PageRangeSchema`), `outputPath` — required when `format: spatial` (`.superRefine`); also refine `text` mode ⇒ `format` must be `markdown`. `QueryExtractionArgsSchema`: `filePath` (the saved spatial JSON), optional `pages`, `region` (`{x,y,width,height}` all required together), `minConfidence` (0–1), `elementTypes` (enum array), `limit` (default cap).
**Patterns to follow:** `BuildAPIArgsSchema`, `AiRedactArgsSchema` (`.superRefine`), `PageRangeSchema`.
**Test scenarios:**
- spatial without `outputPath` → rejected.
- `text` mode with `format: spatial` → rejected.
- `language` accepts string and array.
- query: `minConfidence` outside 0–1 → rejected; partial `region` → rejected.
**Verification:** `pnpm pretest`; schema unit tests green.

### U2. Data Extraction API client wiring

**Goal:** Provide a `DwsApiClient` authenticated with the Data Extraction key.
**Requirements:** R4, KTD1, KTD5.
**Dependencies:** none.
**Files:** `src/dws/utils.ts` or `src/utils/environment.ts` (add `getExtractionApiKey()`), `src/index.ts` (build the extraction client and thread it into `addToolsToServer` options alongside `apiClient`)
**Approach:** `getExtractionApiKey()` reads `NUTRIENT_EXTRACTION_API_KEY`, throws a clear error if unset. In the server bootstrap, `const extractionApiClient = createApiClientFromApiKey(getExtractionApiKey())`. Extend the `addToolsToServer`/`createMcpServer` options type with `extractionApiClient: DwsApiClient`. Only construct it lazily/when the key exists so the Processor-only path still boots (extraction tools can surface a clear "set NUTRIENT_EXTRACTION_API_KEY" error if missing).
**Patterns to follow:** `createStdioApiClient`, `createApiClientFromApiKey`, the existing `apiClient` threading in `src/index.ts`.
**Test scenarios:**
- `getExtractionApiKey()` throws when env unset; returns the key when set.
**Verification:** `pnpm pretest`; server boots with and without the extraction key (tools register; calling without key errors clearly).

### U3. `data_extractor` handler

**Goal:** Call `/extraction/parse`, route spatial→file / markdown→inline, summarize safely.
**Requirements:** R1, R2, R6, R7, KTD2, KTD3, KTD7.
**Dependencies:** U1, U2 (and U0 fixture for tests).
**Files:** `src/dws/extract.ts` (new; module-private `summarizeSpatial` helper), reuse `pipeToString` from `src/dws/utils.ts`
**Approach:** `performExtractCall(args, extractionApiClient)`. If `format: spatial`, validate `outputPath` via `resolveWriteFilePath` **first**. Resolve `filePath` via `resolveReadFilePath`, read buffer, build `FormData` (`file` + `instructions` JSON). `await extractionApiClient.post('extraction/parse', form)`; `pipeToString` → `JSON.parse`. Markdown → return `output.markdown` inline. Spatial → write `output` (or `output.elements`) to the resolved path; return `summarizeSpatial(output)` (KTD3 fields only). Errors → `createErrorResponse`; ensure no `Authorization`/key leaks (axios error `config` stripped).
**Patterns to follow:** `performBuildCall` structure, `processFileReference` file-read approach, `handleApiError`, `createSuccessResponse`/`createErrorResponse`.
**Test scenarios:**
- markdown mode → inline string from `output.markdown` (mocked).
- spatial mode + `outputPath` → file written; summary string has counts + path, and asserts a known text value from the fixture is **absent** inline.
- `outputPath` outside sandbox → rejected before any network call.
- API error → `createErrorResponse`; assert no `Bearer`/key in the message.
- missing extraction key → clear "set NUTRIENT_EXTRACTION_API_KEY" error.
**Verification:** `pnpm test` green.

### U4. `query_extraction` handler

**Goal:** Return filtered element slices inline from a saved spatial file.
**Requirements:** R3, R6, KTD6.
**Dependencies:** U0 fixture, U1.
**Files:** `src/dws/extract.ts` (or `src/dws/query.ts`)
**Approach:** `performQueryCall(args)`. `resolveReadFilePath(filePath)`, read + parse. Filter `output.elements` by `pages` (`element.page.pageIndex`), `region` (bbox intersection with `element.bounds`), `minConfidence` (`element.confidence`), `elementTypes` (`element.type`). Return up to `limit` matches inline; if more matched, note the truncation and suggest narrowing. Defensive field access with a clear error if the file isn't a recognized extraction document.
**Patterns to follow:** `resolveReadFilePath`, `createSuccessResponse`/`createErrorResponse`.
**Test scenarios:**
- `minConfidence: 0.9` → only high-confidence elements (against fixture).
- `region` bbox → only intersecting elements.
- `pages: [0]` → only page-0 elements.
- `elementTypes: ['table']` → only tables.
- malformed/non-extraction file → `createErrorResponse`.
- match set > `limit` → truncated with guidance.
- file outside sandbox → rejected.
**Verification:** `pnpm test` green.

### U5. Register tools + de-advertise extraction on `document_processor`

**Goal:** Wire both tools into the server.
**Requirements:** R1, R3, R5, R7, R9.
**Dependencies:** U3, U4.
**Files:** `src/index.ts`
**Approach:** Two `server.tool(...)` registrations passing `extractionApiClient` (data_extractor) and none (query_extraction reads files). Descriptions note: spatial output → file + `query_extraction`; per-mode credit cost; transcript caveat (KTD6). Amend `document_processor`'s description to drop standalone "JSON extraction" and point to `data_extractor`.
**Patterns to follow:** existing `server.tool` blocks and the `addToolsToServer` options threading.
**Test scenarios:**
- Test expectation: none beyond handler tests — registration is wiring.
**Verification:** `pnpm build`; server registers both tools; `document_processor` no longer double-advertises extraction.

### U6. Dynamic-workflow example

**Goal:** One runnable artifact: extract → query → act.
**Requirements:** R8.
**Dependencies:** U5.
**Files:** `examples/invoice-extraction-workflow/` (script + notes), `README.md` ("Dynamic workflows" section)
**Approach:** `data_extractor` (spatial → file) → `query_extraction` (`minConfidence` to find shaky fields) → branch → act via `ai_redactor`/`document_signer`. Live "act" steps use the **Processor** key; gate the runnable script behind both keys and exclude from `pnpm test`.
**Test scenarios:** none — example/doc.
**Verification:** Walkthrough runs once end-to-end against live keys.

### U7. Tests

**Goal:** Cover both handlers against the documented/fixture schema.
**Requirements:** R10.
**Dependencies:** U3, U4 (U0 fixtures).
**Files:** `tests/extract.test.ts`, `tests/query.test.ts`; reuse `tests/fixtures/extraction-*-sample.json`, `tests/assets/example.pdf`. Inline example objects.
**Approach:** Mock `DwsApiClient.post` to return a stream of the fixture; assert routing, summary-without-content, key-redaction, sandbox rejection, and query filters.
**Execution note:** Start from a failing test asserting the spatial→file summary contains no element `text` (security-critical).
**Verification:** `pnpm test`, `pnpm lint`, `pnpm format` clean.

### U8. Docs

**Goal:** Document tools, the new env var, and costs.
**Requirements:** R7, R9.
**Dependencies:** U5, U6.
**Files:** `README.md`, `.env.example`
**Approach:** Add `data_extractor` + `query_extraction` to Available Tools; add a Data Extraction feature row (modes, spatial/markdown, coords+confidence, file+query); add `NUTRIENT_EXTRACTION_API_KEY` to the env table + `.env.example`; note per-mode credits; ensure `document_processor` row no longer implies it's the extraction path.
**Test scenarios:** none — docs.
**Verification:** Tool names/descriptions match registrations (grep parity).

---

## Scope Boundaries

**In scope:** `data_extractor`, `query_extraction`, the Data Extraction client wiring, one workflow example, tests, README/.env updates, `document_processor` description fix.

### Deferred to Follow-Up Work
- **`accessibility_tagger`** — DWS **Accessibility API** is now standalone (auto-tag *and* validation, own key); own PR.
- **Viewer tool** — own key; low value for headless workflows.
- **JSON-body-with-URL / raw-binary inputs** to `/extraction/parse` — start with multipart file upload; add URL input if needed.
- **`agentic` cost guardrails** beyond surfacing cost in the description.

---

## System-Wide Impact

- **New env var** `NUTRIENT_EXTRACTION_API_KEY` (separate from `NUTRIENT_DWS_API_KEY`). Documented; extraction tools error clearly if unset, Processor tools unaffected.
- **Additive** — no breaking change; `document_processor` keeps capability (description-only change).
- **Sandbox** covers the new file read (`query_extraction`, source PDF) and write (`data_extractor` spatial output).
- **Transcript exposure** (KTD6) documented.
- **Cost:** `understand` (default) = 9 credits/page; surfaced in the description (R7).

---

## Risks & Dependencies

- **R-A (low, mitigated): live response drift from docs.** *Mitigation:* U0 fixture confirms before relying on it; defensive field access.
- **R-B (medium): default mode cost.** `understand` at 9 cr/pg can surprise. *Mitigation:* cost in description (R7); consider defaulting to `structure` — open question below.
- **R-C (medium): PII in transcript** via markdown/inline and query results. *Mitigation:* KTD3 (no content in summaries) + KTD6 warning + a test asserting no element `text` leaks in the spatial summary.
- **R-D (low): two keys confuse setup.** *Mitigation:* clear env table, `.env.example`, and unset-key errors.

## Open Questions (resolve during execution)

- Default mode: `understand` (richest, 9 cr/pg, matches API default) vs `structure` (1.5 cr/pg) for a cheaper default? Leaning toward honoring the API default (`understand`) but surfacing cost.

---

## Verification Strategy

Local (no GitHub Actions in this repo):
- `pnpm pretest`, `pnpm test`, `pnpm lint`, `pnpm format`.
- U0: one live `text`/`structure` call to capture fixtures (needs key; deferred to user).
- U6: full extract→query→act once against live Extraction + Processor keys.
- Per project AGENTS rules: branch off `main` → Conventional Commits → PR into `main`; never push to `main`; report exact command + exit 0 before claiming done.

---

## Sources & Research

- **Authoritative, on disk:** `~/projects/nutrient-website/src/content/guides/dws-data-extraction/` — `getting-started.mdoc`, `api-overview.mdoc`, `parsing/processing-modes.mdoc`, `parsing/coordinate-spaces.mdoc`, `llms.txt`. Endpoint `POST /extraction/parse`, Bearer `pdf_live_…`, modes/formats, element schema, coordinate system.
- Repo (authoritative for wiring): `src/dws/client.ts` (`DwsApiClient`, `createApiClientFromApiKey`, `.post`), `src/index.ts` (`createMcpServer`/`addToolsToServer` apiClient threading), `src/dws/build.ts`, `src/dws/utils.ts` (`pipeToString`, `handleApiError`), `src/fs/sandbox.ts`.
- Plan review (2026-06-07, 6 personas) + two user corrections establishing the separate-API/separate-key reality.
