---
title: "feat: data_extractor + query_extraction tools and a dynamic-workflow example"
status: active
date: 2026-06-07
type: feat
target_repo: nutrient-dws-mcp-server
base_branch: main
supersedes: 2026-06-07-001-feat-dws-extraction-accessibility-plan.md
---

# feat: `data_extractor` + `query_extraction` + a dynamic-workflow example

## Summary

Ship the **data-extraction workflow primitive** for the Nutrient DWS MCP server — the single highest-leverage move toward the "AI agents using documents" keystone — plus a runnable example that demonstrates it end to end.

- **`data_extractor`** — typed JSON / Markdown extraction (text, key-value pairs, tables, and structured/positional text with **coordinates + confidence**). Because structured output is large, it is written to a file; the inline response is a *decision-grade summary* (per-page element/table/KVP counts, low-confidence flags, bbox ranges) — never raw document content.
- **`query_extraction`** — reads that extraction file back and returns **filtered slices inline** (by page, region, or minimum confidence), so the agent can pull *actionable* coordinates into context on demand instead of being handed a file it cannot read. This is what makes the primitive genuinely agent-native rather than a context-problem relocation.
- **A worked dynamic-workflow example** (`examples/` + README walkthrough): extract → branch on low confidence → act with the existing `ai_redactor` / `document_signer` tools. This is the GTM-legible artifact a keystone needs.

Both tools are thin wrappers over the existing `/build` path, reusing the current auth, sandbox, and response patterns ("copy what exists").

**Deferred to their own PRs:** `accessibility_tagger` (PDF/UA auto-tagging — breadth, a one-shot transform, weak fit for the workflow narrative; ready to lift from this plan's history when wanted), Viewer, and accessibility validation.

> **Scope change from the original plan** (`…-extraction-accessibility-plan.md`, superseded): accessibility was dropped in favor of the `query_extraction` affordance + example, on the product judgment that a demonstrable workflow beats tool-count growth.

---

## Problem Frame

The DWS Processor API already returns *"typed JSON or Markdown … with tables, key-value pairs, coordinates, and confidence scores"* where *"each document element … includes bounding-box coordinates, reading order index, element type, and confidence scores."* Today an agent can only reach this by hand-constructing a full Build `instructions` object with the right `output` block on the generic `document_processor` tool — poor ergonomics for the one operation a dynamic workflow leans on most.

Three in-repo realities shape the design — each surfaced by the plan review and verified against code:

1. **Coordinates overflow context.** `src/schemas.ts` disables `structuredText` with: *"Structure text uses many chars, and often overflows the context length of an LLM. We will not support this for now."* Writing it to a file solves overflow but, on its own, just **moves** the problem — an agent cannot branch on coordinates it cannot read. Hence `query_extraction`: the agent retrieves only the slices it needs.
2. **`performBuildCall` cannot serve the inline case.** `performBuildCall(instructions, outputFilePath)` requires `outputFilePath` and calls `resolveWriteFilePath` *before* the API call (`src/dws/build.ts:24`). The reusable core is the currently-**private** `processInstructions` + `makeApiBuildCall`. These must be exported, not wrapped.
3. **One endpoint.** Everything goes through `callNutrientApi('build', …)` → `https://api.nutrient.io/build`. No new endpoint plumbing.

---

## Requirements

- **R1.** `data_extractor` exposes text / key-value-pair / table / structured (coordinate+confidence) extraction, output as JSON or Markdown.
- **R2.** Structured/positional results are written to `outputPath`; the inline response is a decision-grade summary containing **no extracted document content**. `structuredText: true` requires `outputPath`.
- **R3.** `query_extraction` reads an extraction JSON file and returns filtered element slices inline, filterable by page, region (bbox), and minimum confidence.
- **R4.** Both tools reuse existing patterns: `getApiKey()` auth, sandbox path resolution (`resolveReadFilePath`/`resolveWriteFilePath`), the shared build core, and the `createErrorResponse`/`handleFileResponse` helpers.
- **R5.** Both tools respect the sandbox vs. non-sandbox registration model in `addToolsToServer`.
- **R6.** `outputPath`/file paths, when supplied, are **always** validated through the sandbox resolver before any routing branch or API call.
- **R7.** Ship one runnable dynamic-workflow example demonstrating extract → branch → act.
- **R8.** Update README (Available Tools + Features) and amend `document_processor`'s description to point extraction users at `data_extractor` (remove the duplicate affordance).
- **R9.** Tests cover instruction construction, inline-vs-file routing, query filtering, and error/PII paths.

---

## Key Technical Decisions

- **KTD1 — Compose the shared build core, don't wrap `performBuildCall`.** Export `processInstructions` and `makeApiBuildCall` (package-internal) from `src/dws/build.ts`; `data_extractor` calls them directly so the inline path needs no `outputPath`. *(Review: Feasibility + Scope-guardian, 0.9 — `performBuildCall` resolves a write path before the call and cannot serve inline extraction.)*
- **KTD2 — Structured output to file; summary inline; query for slices.** `structuredText` (or an explicit `outputPath`) ⇒ write JSON to the resolved path, return a decision-grade summary. **No size-threshold branch** in v1 — route purely on the boolean. The agent uses `query_extraction` to pull actionable elements back. *(Review: 4 reviewers — the size threshold had no defined value, was unmeasurable pre-stream, and created a "needs a file but has no path" hole.)*
- **KTD3 — Decision-grade summary, not content.** The inline summary is restricted to: per-page element-type counts (`{tables, keyValuePairs, textBlocks}`), low-confidence element counts/flags, bbox ranges, page count, output path, byte size. It must **never** include extracted text/values (PII boundary). If expected fields aren't derivable from the live response, degrade gracefully to page-count + path + bytes and say so inline. *(Review: Security 0.75 + Feasibility 0.7.)*
- **KTD4 — Markdown is a plain string, routed separately.** `format: markdown` returns inline text (it's a single small blob, not `{pages}`); the count-summary logic applies only to `json-content`. *(Review: Feasibility 0.85 — existing code routes non-`json-content` to a file; markdown has no `{pages}` to summarize.)*
- **KTD5 — Verify the API contract in a spike BEFORE committing the schema (U0).** Public docs confirm confidence+coordinates exist but don't pin: (a) whether `structuredText` is a `json-content` sub-option vs. a separate output type/endpoint, (b) the confidence/coordinate field names, (c) whether `plainText`/`keyValuePairs`/`tables`/`structuredText` combine or are mutually exclusive (the existing schema says *"use one at a time"* yet defaults two on). One live `/build` call resolves all three and produces a recorded fixture that `query_extraction` and tests build on. If `structuredText` is *not* a `json-content` sub-option, U1/U3 schema shape changes — which is exactly why this is blocking. *(Review: Adversarial 0.75, Feasibility 0.7.)*
- **KTD6 — Inline data is transcript-visible; treat as sensitive.** Both the `data_extractor` inline path (when no `outputPath`) and every `query_extraction` result place extracted content into the agent transcript, which the MCP host / LLM provider may log. Tool descriptions must state this plainly; recommend `outputPath` + scoped queries for sensitive documents. *(Review: Security 0.88.)*

---

## High-Level Technical Design

```mermaid
flowchart TD
    A[Agent: data_extractor\nfile + toggles + format] --> V[validate outputPath via\nresolveWriteFilePath FIRST]
    V --> B[build Instructions\noutput=json-content or markdown]
    B --> C[shared build core:\nprocessInstructions → makeApiBuildCall → /build]
    C --> D{structuredText set?}
    D -- no, json --> E[handleJsonContentResponse\n→ JSON inline]
    D -- no, markdown --> M[markdown string inline]
    D -- yes --> F[write JSON to outputPath\n→ decision-grade summary inline\n(counts, low-conf flags, bbox ranges; NO content)]
    F -.-> G[Agent: query_extraction\nfile + page/region/minConfidence]
    G --> H[resolveReadFilePath → parse → filter\n→ matching elements inline]
    H -.-> I[Agent branches → ai_redactor / document_signer]
```

*Directional — routing gates and the extract→query→act loop are the design intent; field-level shapes are settled by the U0 spike and in code.*

---

## Implementation Units

### U0. Spike: verify the `/build` extraction contract + capture a fixture

**Goal:** Resolve the unconfirmed API shape before any schema is committed.
**Requirements:** KTD5 (enables R1–R3).
**Dependencies:** none. **Blocking** for U1, U3, U4.
**Files:** `tests/fixtures/extraction-sample.json` (new, recorded response); a throwaway script (not committed) or a documented `curl`/node snippet.
**Approach:** With a real `NUTRIENT_DWS_API_KEY`, call `/build` against `tests/assets/example.pdf` requesting `json-content` with `plainText`, `keyValuePairs`, `tables`, and structured/positional text. Record: (a) is `structuredText` a `json-content` sub-option or separate? (b) exact field names for elements, bbox/coordinates, confidence, page, reading order; (c) whether multiple toggles can combine. Save the response as a fixture for U4/U7. Document findings in the U0 commit message / a short note in `docs/`.
**Test scenarios:** none — investigation. Output is the fixture + recorded findings.
**Verification:** Fixture exists; the three KTD5 questions are answered in writing. If `structuredText` is not a `json-content` sub-option, update U1/U3 before proceeding.

### U1. Arg schemas for both tools

**Goal:** Define `DataExtractorArgsSchema` and `QueryExtractionArgsSchema`.
**Requirements:** R1, R2, R3, R6.
**Dependencies:** U0.
**Files:** `src/schemas.ts`
**Approach:** `DataExtractorArgsSchema`: `filePath`, optional `password`/`pages`, extraction toggles, `language` (string|string[]), `format` (`json`|`markdown`, default `json`), optional `outputPath` — required when `structuredText` is true (`.superRefine`, mirroring `AiRedactArgsSchema`'s stage/apply precedent). If U0 finds the toggles are mutually exclusive, model them as an enum + refine and drop the misleading "use one at a time" wording; if combinable, keep booleans and fix the inherited descriptions. `QueryExtractionArgsSchema`: `filePath` (the extraction JSON, sandbox-resolved read), optional `pages`, optional `region` (bbox: x/y/width/height), optional `minConfidence` (0–1), optional `elementTypes` (filter to tables/kv/text). Reuse `PageRangeSchema`.
**Patterns to follow:** `BuildAPIArgsSchema`, `JSONContentOutputSchema`, `AiRedactArgsSchema`.
**Test scenarios:**
- `data_extractor`: valid `plainText`-only parses, `format` defaults `json`.
- `structuredText: true` without `outputPath` → rejected with a clear message.
- `language` accepts string and array.
- (if U0 ⇒ exclusive) two toggles set → rejected.
- `query_extraction`: `minConfidence` out of 0–1 → rejected; `region` requires all four bbox fields.
**Verification:** `pnpm pretest` passes; schema unit tests green.

### U2. Export the shared build core

**Goal:** Make the inline extraction path possible without a write path.
**Requirements:** R4, KTD1.
**Dependencies:** none (independent enabling refactor).
**Files:** `src/dws/build.ts`
**Approach:** Export `processInstructions` and `makeApiBuildCall` as package-internal symbols (no public/tool surface change). Leave `performBuildCall` intact and refactor it to consume the now-exported core so behavior is unchanged. No signature change to `performBuildCall`.
**Patterns to follow:** existing `build.ts` structure.
**Test scenarios:**
- Existing `tests/build-api-examples.test.ts` still green (regression — the refactor is behavior-preserving).
- Exported `processInstructions` returns the same `{instructions, fileReferences}` shape for a sample input.
**Execution note:** Characterization-first — confirm the existing build tests pass before and after the extract, since this refactors a shipped path.
**Verification:** `pnpm test` green; no diff in `document_processor` behavior.

### U3. `data_extractor` handler

**Goal:** Build instructions, call the core, route inline vs. file, summarize safely.
**Requirements:** R1, R2, R4, R6, KTD2, KTD3, KTD4, KTD6.
**Dependencies:** U0, U1, U2.
**Files:** `src/dws/extract.ts` (new; includes a module-private `summarizeExtraction` helper — not exported to `utils.ts`)
**Approach:** `performExtractCall(args)`. Validate `outputPath` via `resolveWriteFilePath` **first** (R6), before building instructions or calling the API — fail early on sandbox escape regardless of branch. Construct `Instructions` with `output: json-content` (toggles + language) or `markdown`. Call the exported core. Routing: `structuredText` set ⇒ write JSON to resolved path + return `summarizeExtraction` output (KTD3 fields only, no content); `format: markdown` ⇒ inline string; else ⇒ `handleJsonContentResponse` inline. `summarizeExtraction` parses the JSON using field names confirmed in U0; on missing fields, degrade to page-count + path + bytes. Audit the error path: ensure `handleApiError` never serializes the `Authorization` header (strip `e.config` if needed).
**Patterns to follow:** `src/dws/build.ts`, `handleJsonContentResponse`/`handleFileResponse`/`pipeToBuffer`, `createErrorResponse`.
**Test scenarios:**
- `plainText` only → JSON inline (mocked stream).
- `structuredText: true` + `outputPath` → file written; response is a summary string with counts/flags/path and **no document text** (assert a known PII token from the fixture is absent inline).
- `format: markdown` → `output.type: 'markdown'`, inline string, no count-summary.
- `outputPath` outside sandbox → rejected before the API call (assert no network call).
- API error → `createErrorResponse`; assert the returned text contains no `Bearer`/key.
**Verification:** `pnpm test` green.

### U4. `query_extraction` handler

**Goal:** Return actionable filtered slices inline from an extraction file.
**Requirements:** R3, R6, KTD6.
**Dependencies:** U0 (fixture/field shape), U1.
**Files:** `src/dws/extract.ts` (or `src/dws/query.ts`)
**Approach:** `performQueryCall(args)`. Resolve `filePath` via `resolveReadFilePath` (sandbox), read + `JSON.parse`. Filter elements by `pages`, `region` (bbox intersection), `minConfidence`, `elementTypes`. Return matched elements inline (bounded count; if a query still matches a very large set, return the first N + a note to narrow). Field access uses the U0-confirmed names with a defensive fallback. Tool description states results enter the transcript (KTD6).
**Patterns to follow:** `resolveReadFilePath`, `createSuccessResponse`/`createErrorResponse`.
**Test scenarios:**
- `minConfidence: 0.9` → only high-confidence elements returned (against the U0 fixture).
- `region` bbox → only intersecting elements.
- `pages: [0]` → only page-0 elements.
- Missing/малformed file → `createErrorResponse`.
- Oversized match set → truncated with a "narrow your query" note.
- File outside sandbox → rejected.
**Verification:** `pnpm test` green.

### U5. Register both tools

**Goal:** Wire `data_extractor` + `query_extraction` into the server.
**Requirements:** R1, R3, R5, R8.
**Dependencies:** U3, U4.
**Files:** `src/index.ts`
**Approach:** Two `server.tool(...)` registrations mirroring `document_processor`, with descriptions that (a) note structured output goes to a file and is queried via `query_extraction`, and (b) carry the KTD6 transcript warning. Confirm both work in sandbox and non-sandbox modes. Also amend `document_processor`'s description to drop the standalone "JSON extraction" affordance and point to `data_extractor` (R8).
**Patterns to follow:** existing `server.tool` blocks.
**Test scenarios:**
- Test expectation: none beyond handler tests — registration is wiring; behavior covered by U3/U4.
**Verification:** `pnpm build`; launch server; both tools register and the `document_processor` description no longer double-advertises extraction.

### U6. Dynamic-workflow example

**Goal:** One runnable artifact demonstrating extract → branch → act.
**Requirements:** R7.
**Dependencies:** U5.
**Files:** `examples/invoice-extraction-workflow/` (a documented script + sample doc reference), `README.md` (a "Dynamic workflows" walkthrough section)
**Approach:** Show an agent calling `data_extractor` (structured → file) → `query_extraction` with `minConfidence` to find low-confidence fields → branching (e.g., flag for human review) and acting via the existing `ai_redactor` / `document_signer`. Keep it copy-pasteable; reference `tests/assets/example.pdf`.
**Test scenarios:**
- Test expectation: none — documentation/example. If a smoke script is included, gate it behind a real key and exclude from `pnpm test`.
**Verification:** Walkthrough steps run end-to-end manually against a live key once.

### U7. Tests

**Goal:** Cover both handlers per the repo convention.
**Requirements:** R9.
**Dependencies:** U3, U4.
**Files:** `tests/extract.test.ts` (new), `tests/query.test.ts` (new), reuse `tests/fixtures/extraction-sample.json` (from U0) and `tests/assets/example.pdf`. Inline example objects (the feature has few cases — no separate `*-api-examples.ts` data file).
**Approach:** Follow `tests/unit.test.ts`/`tests/build-api-examples.test.ts` conventions; mock API streams; assert routing, summary-without-content, query filtering, sandbox rejection, and key-redaction in errors.
**Execution note:** Start from a failing test asserting the structured→file summary contains no document content (the riskiest + security-critical path).
**Test scenarios:** the scenarios enumerated in U1/U3/U4 live here.
**Verification:** `pnpm test`, `pnpm lint`, `pnpm format` clean.

### U8. Docs

**Goal:** Document the new tools and workflow.
**Requirements:** R8.
**Dependencies:** U5, U6.
**Files:** `README.md`
**Approach:** Add `data_extractor` + `query_extraction` rows to "Available Tools"; update the "Data Extraction" feature row (coordinates/confidence, file output + query). Ensure the `document_processor` row no longer implies it's the extraction path. Note the transcript-visibility caveat for extracted content.
**Test scenarios:** Test expectation: none — documentation only.
**Verification:** Tool names/descriptions match the registered tools exactly (grep parity).

---

## Scope Boundaries

**In scope:** `data_extractor`, `query_extraction`, one dynamic-workflow example, tests, README + `document_processor` description fix.

### Deferred to Follow-Up Work
- **`accessibility_tagger` (PDF/UA auto-tagging)** — own PR; design is ready in this plan's git history (maps to `output.type: 'pdfua'` + `metadata`). Dropped here to keep the workflow narrative sharp.
- **Accessibility validation / compliance reporting** — not a confirmed DWS capability.
- **Viewer tool** — low value for headless workflows.
- **Re-enabling `structuredText` on `document_processor`** — kept off there; only `data_extractor` exposes it (behind file output).
- **Extension-allowlist / hardened non-sandbox output paths** — see System-Wide Impact; revisit if needed.
- **npm publish / version bump** — separate release step.

---

## System-Wide Impact

- **No auth/transport change** — reuses `NUTRIENT_DWS_API_KEY` and stdio. No new env vars.
- **Additive** — no breaking change to existing tools; `document_processor` keeps full capability (only its description changes to reduce extraction overlap).
- **Sandbox** covers all new reads/writes via `resolveReadFilePath`/`resolveWriteFilePath`. **Known limitation (pre-existing):** in non-sandbox mode, any absolute `outputPath` is writable — call this out in the tool descriptions; an extension allowlist is deferred.
- **Transcript exposure:** `data_extractor` inline results and all `query_extraction` results place extracted content in the agent transcript (KTD6) — documented, not silently introduced.
- **Credits:** extraction is a billable Build op; existing `check_credits` applies.

---

## Risks & Dependencies

- **R-A (high → mitigated): API contract unconfirmed.** *Mitigation:* U0 spike is blocking and produces a fixture before schemas are committed (KTD5).
- **R-B (medium): structured field names drive both the summary and the query.** If U0 reveals an unexpected shape, `summarizeExtraction` + `query_extraction` field access change. *Mitigation:* single source of truth = U0 fixture; defensive fallbacks; both consume the same confirmed names.
- **R-C (medium): PII in transcript.** *Mitigation:* KTD3 (no content in summaries) + KTD6 (documented warning) + a test asserting no document content leaks inline on the structured path.
- **R-D (low): shared-core refactor regresses `document_processor`.** *Mitigation:* U2 is characterization-first; existing build tests gate it.
- **R-E (low): query returns too much.** *Mitigation:* bounded result count + "narrow your query" guidance.

---

## Verification Strategy

No GitHub Actions in this repo — verification is local:
- `pnpm pretest` (tsc), `pnpm test` (vitest), `pnpm lint`, `pnpm format`.
- `pnpm build`, launch the server, run the U6 walkthrough once against a live key (extract → query → act).
- Per project AGENTS rules: branch off `main` → Conventional Commits → PR into `main`; never push to `main`; report the exact command + exit 0 before claiming done.

---

## Sources & Research

- Existing code (authoritative): `src/index.ts`, `src/schemas.ts` (`JSONContentOutputSchema`, disabled `structuredText` at the bottom of that schema, `PDFUAOutputSchema`), `src/dws/build.ts` (`performBuildCall` write-path-before-call; private `processInstructions`/`makeApiBuildCall`), `src/dws/utils.ts` (`handleJsonContentResponse`/`handleFileResponse`/`handleApiError`), `src/dws/api.ts`, `src/fs/sandbox.ts`.
- DWS Processor API — *"typed JSON or Markdown … tables, key-value pairs, coordinates, and confidence scores"*; *"each document element … bounding-box coordinates, reading order index, element type, and confidence scores."* ([nutrient.io/api](https://www.nutrient.io/api/), [processor-api](https://www.nutrient.io/api/processor-api/))
- Plan review (2026-06-07): 6 personas; this revision applies the high-confidence Feasibility/Scope/Security/Adversarial findings (shared-core composition, drop size-threshold, markdown routing, U0 spike, PII-safe summaries, sandbox-validate-first, de-advertise overlap) and the product decision (re-focus on extraction + add the query affordance + example).
