---
name: nutrient-dws
description: Process, convert, OCR, sign, redact, parse, or extract data from documents with Nutrient DWS through its zero-install CLI. Use when a shell-capable agent needs DWS without configuring MCP.
---

# Nutrient DWS

Use the DWS CLI through `npx`; no package installation or MCP configuration is required.

```bash
npx -y @nutrient-sdk/dws-mcp-server <command> [options]
```

On a desktop, run `login` once to complete browser OAuth. In headless or CI environments, use the documented DWS API-key environment variables instead. Never print or expose credentials.

## Commands

- `login` — Authenticate with browser OAuth and cache the credentials locally.
- `process` — Convert documents, run OCR, add watermarks, rotate or rearrange pages, flatten annotations, and perform other Processor operations.
- `sign` — Apply a digital signature to a PDF.
- `redact` — Detect and permanently remove sensitive content with AI redaction.
- `parse` — Convert a PDF or Office document to Markdown or structured spatial JSON.
- `extract` — Extract named fields into a requested JSON schema with citations.
- `credits` — Check the signed-in account and remaining Processor credits.
- `files` — Inspect available local files without uploading them.

Use `--sandbox <directory>` whenever working with local documents. Pass a command payload with `--json`, `--input <file>`, or stdin; request machine-readable results with `--format json`.

```bash
npx -y @nutrient-sdk/dws-mcp-server login
npx -y @nutrient-sdk/dws-mcp-server files --sandbox ./documents
npx -y @nutrient-sdk/dws-mcp-server parse --sandbox ./documents \
  --json '{"filePath":"invoice.pdf","mode":"text","format":"markdown"}'
```

Run `npx -y @nutrient-sdk/dws-mcp-server --help` for CLI usage. For operation payloads, consult the package README and use the same JSON shape as the corresponding MCP tool.
