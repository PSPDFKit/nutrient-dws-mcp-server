# Dynamic workflow: extract → query → act

This example shows how an AI agent chains the Data Extraction tools with the
existing document tools to process an invoice **without ever loading the full
extraction into context**. It is the pattern dynamic workflows are built on:
extract structured data, branch on it, then act.

**Prerequisites**

- Credentials for every step below. OAuth (no `NUTRIENT_DWS_API_KEY` set) covers
  the whole walkthrough with one token. With a static key you need two:
  `NUTRIENT_DWS_API_KEY` for the redact/sign steps, plus
  `NUTRIENT_DWS_EXTRACT_API_KEY` for `data_extractor` — Data Extraction is a
  separate product and the Processor key cannot authenticate it.
- `SANDBOX_PATH` set to a directory containing `invoice.pdf`.

## Step 1 — Extract structured elements to a file

The agent calls `data_extractor` in `understand` mode with spatial output. The
element list (with coordinates and confidence) is written to a file; only a
compact summary comes back.

```jsonc
// tool: data_extractor
{ "filePath": "invoice.pdf", "mode": "understand", "format": "spatial", "outputPath": "invoice.elements.json" }
```

```
Extracted 142 elements across 2 page(s) and wrote the full spatial JSON to invoice.elements.json (38217 bytes).
Element types: paragraph: 96, table: 2, keyValueRegion: 18, picture: 1.
Low-confidence elements (confidence < 0.6): 7.
Retrieve specific elements with query_extraction ...
```

The agent now knows the shape of the document — and that **7 fields are
low-confidence** — without 142 elements entering the conversation.

## Step 2 — Branch on the result with `query_extraction`

The summary flagged low-confidence elements, so the agent pulls just those to
decide whether the document needs human review:

```jsonc
// tool: query_extraction
{ "filePath": "invoice.elements.json", "minConfidence": 0, "elementTypes": ["keyValueRegion"], "limit": 50 }
```

It can also grab a specific region — e.g. the totals box in the bottom-right of
page 2 — to read the amount due:

```jsonc
// tool: query_extraction
{ "filePath": "invoice.elements.json", "pages": [1], "region": { "x": 1200, "y": 2000, "width": 600, "height": 400 } }
```

Only the handful of elements the agent actually needs — with their text and
coordinates — enter context.

## Step 3 — Act with the existing tools

Branching on what it found, the agent acts:

- **Low-confidence or sensitive fields →** redact before sharing:

  ```jsonc
  // tool: ai_redactor
  { "filePath": "invoice.pdf", "criteria": "Bank account and routing numbers", "outputPath": "invoice-redacted.pdf" }
  ```

- **Clean and approved →** sign it:

  ```jsonc
  // tool: document_signer
  { "filePath": "invoice.pdf", "outputPath": "invoice-signed.pdf", "signatureOptions": { "signatureType": "cms" } }
  ```

## Why this is the workflow primitive

The agent reasons over **structure and coordinates** (counts, confidence,
regions) rather than a wall of text, retrieves only the slices it needs, and
hands off to deterministic document operations. The large, sensitive payload
stays on disk; the conversation stays small and auditable.
