# Nutrient DWS MCP Server

![Document workflows using natural language](https://raw.githubusercontent.com/PSPDFKit/nutrient-dws-mcp-server/main/resources/readme-header.png)

<a href="https://glama.ai/mcp/servers/@PSPDFKit/nutrient-dws-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@PSPDFKit/nutrient-dws-mcp-server/badge" alt="Nutrient DWS Server MCP server" />
</a>

[![npm](https://img.shields.io/npm/v/%40nutrient-sdk/dws-mcp-server)](https://www.npmjs.com/package/@nutrient-sdk/dws-mcp-server)

**Give AI agents the power to process, sign, and transform documents.**

A Model Context Protocol (MCP) server that connects AI assistants to the [Nutrient Document Web Service (DWS) Processor API](https://www.nutrient.io/api) — enabling document creation, editing, conversion, digital signing, OCR, redaction, and more through natural language.

## What You Can Do

Once configured, you (or your AI agent) can process documents through natural language:

**You:** *"Merge report-q1.pdf and report-q2.pdf into a single document"*
**AI:** *"Done! I've merged both reports into combined-report.pdf (24 pages total)."*

**You:** *"Redact all social security numbers and email addresses from application.pdf"*
**AI:** *"I found and redacted 5 SSNs and 3 email addresses. The redacted version is saved as application-redacted.pdf."*

**You:** *"Digitally sign this contract with a visible signature on page 3"*
**AI:** *"I've applied a PAdES-compliant digital signature to contract.pdf. The signed document is saved as contract-signed.pdf."*

**You:** *"Convert this PDF to markdown"*
**AI:** *"Here's the markdown content extracted from your document..."*

**You:** *"OCR this scanned document in German and extract the text"*
**AI:** *"I've processed the scan with German OCR. Here's the extracted text..."*

## Quick Start

### 1. Get a Nutrient API Key

Sign up for free at [nutrient.io/api](https://dashboard.nutrient.io/sign_up/).

### 2. Configure Your AI Client

Choose your platform and add the configuration:

<details>
<summary><strong>Claude Desktop</strong></summary>

Open Settings → Developer → Edit Config, then add:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "nutrient-dws": {
      "command": "npx",
      "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
      "env": {
        "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY_HERE",
        "SANDBOX_PATH": "/your/sandbox/directory"
        // "C:\\your\\sandbox\\directory" for Windows
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Create `.cursor/mcp.json` in your project root:

```jsonc
{
  "mcpServers": {
    "nutrient-dws": {
      "command": "npx",
      "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
      "env": {
        "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY_HERE",
        "SANDBOX_PATH": "/your/project/documents"
        // "C:\\your\\project\\documents" for Windows
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```jsonc
{
  "mcpServers": {
    "nutrient-dws": {
      "command": "npx",
      "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
      "env": {
        "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY_HERE",
        "SANDBOX_PATH": "/your/sandbox/directory"
        // "C:\\your\\sandbox\\directory" for Windows
      }
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code (GitHub Copilot)</strong></summary>

Add to `.vscode/settings.json` in your project:

```json
{
  "mcp": {
    "servers": {
      "nutrient-dws": {
        "command": "npx",
        "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
        "env": {
          "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY_HERE",
          "SANDBOX_PATH": "${workspaceFolder}"
        }
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Other MCP Clients</strong></summary>

Any MCP-compatible client can connect using stdio transport:

```bash
NUTRIENT_DWS_API_KEY=your_key SANDBOX_PATH=/your/path npx @nutrient-sdk/dws-mcp-server
```
</details>

### Remote HTTP Mode

For hosted or Co-work style deployments, the server also supports Streamable HTTP:

```bash
MCP_TRANSPORT=http \
MCP_HOST=0.0.0.0 \
PORT=5100 \
MCP_ALLOWED_HOSTS=connector.internal.example.com,connector.example.com \
MCP_BEARER_TOKENS_JSON='[{"token":"replace-me","clientId":"claude-cowork-prod","scopes":["mcp"],"allowedTools":["document_processor","document_signer","ai_redactor","check_credits"]}]' \
NUTRIENT_DWS_API_KEY=your_key \
node dist/index.js
```

Remote mode exposes:

- `POST /mcp` for initialize and request traffic
- `GET /mcp` for server-to-client event streams
- `DELETE /mcp` for session teardown
- `GET /health` for load balancer and readiness checks

Security model:

- bearer-token auth is required for every `/mcp` request
- sessions are bound to the authenticated principal
- the advertised MCP tool list is filtered per principal at session initialization
- stdio mode remains unchanged for local desktop clients

### Published Container Image

This repo is the image owner for remote deployments.

- registry: `ghcr.io/pspdfkit/nutrient-dws-mcp-server`
- `latest`: current default-branch image
- `sha-<commit>`: immutable commit image
- `vX.Y.Z`: release tag image

For Hosted-style deployments, use an immutable image tag in `TF_VAR_dws_mcp_docker_image` and keep the bearer-principal policy in environment-injected secrets.

Example:

```bash
docker run --rm -p 5100:5100 \
  -e MCP_TRANSPORT=http \
  -e MCP_HOST=0.0.0.0 \
  -e PORT=5100 \
  -e MCP_ALLOWED_HOSTS=mcp.example.com \
  -e MCP_BEARER_TOKENS_JSON='[{"token":"replace-me","clientId":"claude-cowork-prod","scopes":["mcp"],"allowedTools":["document_processor","document_signer","check_credits"]}]' \
  -e NUTRIENT_DWS_API_KEY=your_key \
  ghcr.io/pspdfkit/nutrient-dws-mcp-server:sha-<commit>
```

### 3. Restart Your AI Client

Restart the application to pick up the new MCP server configuration.

### 4. Start Processing Documents

Drop documents into your sandbox directory and start giving instructions!

## Available Tools

| Tool | Description |
|------|-------------|
| **document_processor** | All-in-one document processing: merge PDFs, convert formats, apply OCR, watermark, rotate, redact, flatten annotations, extract text/tables/key-value pairs, and more |
| **document_signer** | Digitally sign PDFs with PAdES-compliant CMS or CAdES signatures, with customizable visible/invisible signature appearances |
| **sandbox_file_tree** | Browse files in the sandbox directory (when sandbox mode is enabled) |
| **directory_tree** | Browse directory contents (when sandbox mode is disabled) |

### Document Processor Capabilities

| Feature | Description |
|---------|-------------|
| Document Creation | Merge PDFs, Office docs (DOCX, XLSX, PPTX), and images into a single document |
| Format Conversion | PDF ↔ DOCX, images (PNG, JPEG, WebP), PDF/A, PDF/UA, HTML, Markdown |
| Editing | Watermark (text/image), rotate pages, flatten annotations |
| Security | Redact sensitive data (SSNs, credit cards, emails, etc.), password protection, permission control |
| Data Extraction | Extract text, tables, or key-value pairs as structured JSON |
| OCR | Multi-language optical character recognition for scanned documents |
| Optimization | Compress and linearize PDFs without quality loss |
| Annotations | Import XFDF annotations, flatten annotations |
| Digital Signing | PAdES-compliant CMS and CAdES digital signatures (via document_signer tool) |

## Use with AI Agent Frameworks

This MCP server works with any platform that supports the Model Context Protocol:

- **[Claude Desktop](https://claude.ai/download)** — Direct MCP integration
- **[Cursor](https://cursor.com)** — AI-powered IDE with MCP support
- **[Windsurf](https://codeium.com/windsurf)** — AI-powered IDE with MCP support
- **[VS Code + Copilot](https://code.visualstudio.com/)** — GitHub Copilot MCP integration
- **[LangChain](https://langchain.com)** / **[LangGraph](https://langchain.com/langgraph)** — Via MCP tool adapters
- **[OpenAI Agents SDK](https://github.com/openai/openai-agents-python)** — Via MCP server integration
- **Custom agents** — Any MCP-compatible system

## Why Nutrient?

### The Read-Write Gap

AI can read and understand documents — but most tools stop there. Nutrient gives AI agents the ability to actually **manipulate** documents: merge, redact, sign, watermark, convert formats, extract structured data, and more.

- **Beyond PDF reading** — Not just text extraction. Full document creation, editing, and transformation.
- **Production-grade** — Trusted by thousands of companies for mission-critical document processing.
- **Standards-compliant** — PAdES digital signatures, PDF/A archiving, PDF/UA accessibility.
- **Cloud-native** — No infrastructure to manage. Send documents to the API, get results back.
- **Comprehensive redaction** — Built-in presets for SSNs, credit cards, phone numbers, emails, dates, and more.
- **Multi-format** — Process PDFs, Office documents, images, HTML, and Markdown.

## Configuration

### Sandbox Mode (Recommended)

The server supports sandbox mode that restricts file operations to a specific directory. Set the `SANDBOX_PATH` environment variable to enable it:

```bash
export SANDBOX_PATH=/path/to/sandbox/directory
npx @nutrient-sdk/dws-mcp-server
```

When sandbox mode is enabled:
- Relative paths resolve relative to the sandbox directory
- All input file paths are validated to ensure they reside in the sandbox
- Processed files are saved within the sandbox

> **Note:** If no sandbox directory is specified, the server operates without file path restrictions. Sandbox mode is strongly recommended for security.

### Output Location

Processed files are saved to a location determined by the AI. To guide output placement, use natural language (e.g., "save the result to `output/result.pdf`") or create an `output` directory in your sandbox.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NUTRIENT_DWS_API_KEY` | Yes | Your Nutrient DWS API key ([get one free](https://dashboard.nutrient.io/sign_up/)) |
| `SANDBOX_PATH` | Recommended | Directory to restrict file operations to |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `MCP_HOST` | HTTP only | Host to bind the HTTP server to. Defaults to `127.0.0.1` |
| `PORT` | HTTP only | Port for HTTP mode. Defaults to `5100` |
| `MCP_ALLOWED_HOSTS` | Optional | Comma-separated allowed `Host` headers when binding beyond loopback |
| `MCP_BEARER_TOKEN` | HTTP only | Single inbound bearer token for `/mcp` |
| `MCP_BEARER_TOKEN_CLIENT_ID` | Optional | Principal ID paired with `MCP_BEARER_TOKEN` |
| `MCP_BEARER_TOKEN_SCOPES` | Optional | Comma-separated scopes paired with `MCP_BEARER_TOKEN` |
| `MCP_BEARER_TOKEN_ALLOWED_TOOLS` | Optional | Comma-separated tool allowlist paired with `MCP_BEARER_TOKEN` |
| `MCP_BEARER_TOKENS_JSON` | HTTP only | JSON array of principal configs for multi-token remote deployments |

### Secret Management

Do not commit bearer tokens or DWS API keys into repo config.

Recommended pattern:

- local/dev: inject env vars directly, or source them from 1Password CLI / `op://...` references
- hosted environments: inject secrets through the platform secret store into container env vars
- rotate remote bearer tokens by supplying overlapping entries in `MCP_BEARER_TOKENS_JSON`

## Troubleshooting

**Server not appearing in Claude Desktop?**
- Ensure Node.js 18+ is installed (`node --version`)
- Check the config file path is correct for your OS
- Restart Claude Desktop completely (check Task Manager/Activity Monitor)

**"API key invalid" errors?**
- Verify your API key at [dashboard.nutrient.io](https://dashboard.nutrient.io)
- Ensure the key is set correctly in the `env` section (no extra spaces)

**Files not found?**
- Check that `SANDBOX_PATH` points to an existing directory
- Ensure your documents are inside the sandbox directory
- Use the `sandbox_file_tree` tool to verify visible files

**Running tests in CI or local dev?**
- `pnpm test` runs the deterministic local suite
- live DWS example suites are opt-in and require `RUN_LIVE_DWS_EXAMPLE_TESTS=1`

## Contributing

Please see the contribution guidelines in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License — see [LICENSE](LICENSE) for details.
