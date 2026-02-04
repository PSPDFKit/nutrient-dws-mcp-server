# Nutrient DWS MCP Server

![Document workflows using natural language](https://raw.githubusercontent.com/PSPDFKit/nutrient-dws-mcp-server/main/resources/readme-header.png)

<a href="https://glama.ai/mcp/servers/@PSPDFKit/nutrient-dws-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@PSPDFKit/nutrient-dws-mcp-server/badge" alt="Nutrient DWS Server MCP server" />
</a>

[![npm](https://img.shields.io/npm/v/%40nutrient-sdk/dws-mcp-server)](https://www.npmjs.com/package/@nutrient-sdk/dws-mcp-server)

A Model Context Protocol (MCP) server implementation that integrates with the Nutrient Document Web Service (DWS) Processor API, providing powerful PDF processing capabilities for AI assistants.

This server allows AI assistants to access the tools provided by Nutrient DWS Processor API, enabling operations such as digital signing, document generation, document editing, OCR, watermarking, redaction, and more.

## Table of Contents

- [Features Overview](#features-overview)
- [Usage](#usage)
  - [Getting Started with Claude Desktop](#getting-started-with-claude-desktop--nutrient-dws-mcp-server)
  - [Compatibility](#compatibility)
  - [Further Configuration](#further-configuration)
- [Contributions](#contributions)

### Features overview

| Feature              | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| Document Creation    | Merge PDFs, Office docs, and images                                         |
| Editing              | Watermark (with positioning), rotate, flatten, and more                     |
| Format Conversion    | PDF ⇄ DOCX, images, HTML, Markdown, PDF/A support                          |
| Digital Signing      | Add PAdES standards-compliant digital signatures using trusted certificates |
| Data Extraction      | Extract text, tables, key-value pairs, or structured content                |
| Security             | Pattern-based redaction (presets, regex, text), password protection          |
| **AI Redaction**     | **AI-powered PII detection and permanent removal**                          |
| **Form Filling**     | **Fill PDF form fields and import annotations via Instant JSON**            |
| Advanced OCR         | Multi-language, image and scan recognition                                  |
| Optimization         | Compress files without quality loss                                         |
| HTML-to-PDF          | Generate PDFs from HTML with layout control (orientation, margins, size)    |
| **Credit Tracking**  | **Monitor API credit balance, usage breakdown, and forecast exhaustion**    |

## Usage

### Getting Started with Claude Desktop + Nutrient DWS MCP Server

1. **Get a Nutrient DWS API key:** Sign up at [nutrient.io/api](https://dashboard.nutrient.io/sign_up/).
2. **Install Node.js**:
   1. **macOS users**: Install Node.js with a package manager like brew on the command line. (`brew install node`)
   2. **Windows users**: Download the Node Installer by visiting [Node.js Download Site](https://nodejs.org/en/download) and run the installer
3. **Download Claude Desktop:** If you haven't already, [download Claude Desktop](https://claude.ai/download) and sign in.
4. **Create the `claude_desktop_config.json`**:
   1. **macOS users**: Click on "Claude" next to the Apple icon on top of your mac screen. Go to Settings > Developer and click on Edit Config.
   2. **Windows user**: Click on the hamburger menu on the top left of the Claude Desktop window. Go to File > Settings > Developer and click on Edit Config.
5. **Configure Claude:**: Add `nutrient-dws` to the `claude_desktop_config.json` (example below). Make sure to add your API key and set the sandbox directory:
   1. **macOS users**: The `claude_desktop_config.json` is inside the directory `~/Library/Application\ Support/Claude`.
   2. **Windows users**: The `claude_desktop_config.json` is inside the directory `%APPDATA%\Claude`

> **NOTE**: For the `SANDBOX_PATH`, you can put in the path in either the Unix-style (separated using forward slash `/`) or the Windows-style
> (separated using the backward slash `/`). **And** for the Windows path, you must escape the backward slash (i.e. `\\` instead of `\`)

```json lines
{
  "mcpServers": {
    "nutrient-dws": {
      "command": "npx",
      "args": ["-y", "@nutrient-sdk/dws-mcp-server"],
      "env": {
        "NUTRIENT_DWS_API_KEY": "YOUR_API_KEY_HERE",
        "SANDBOX_PATH": "/your/sandbox/directory" // "C:\\your\\sandbox\\directory" for Windows
      }
    }
  }
}
```

6. **Restart Claude Desktop.**
   > On Windows you might need to go to the Task Manager and kill any processes named Claude to reset the application. On a macOS it will be the Activity Monitor
7. **Add documents for processing:** Use any file manager to copy the documents into the sandbox directory set via the `SANDBOX_PATH` environment variable above.
8. **Process documents:** Instruct Claude (e.g. "redact all PII from secret.pdf", "sign the document contract.pdf", "merge secret.pdf and contract.pdf together", "fill the form fields in application.pdf", etc.).

> **Note:** All operations involve reading from and writing to files on disk. We strongly recommend using the sandboxed directory feature to enhance security and prevent data loss.

### AI Redaction

The server includes an `ai_redactor` tool that uses Nutrient's AI-powered redaction endpoint to automatically detect and permanently remove sensitive information from documents.

```
"Redact all personally identifiable information from tax-form.pdf"
"Remove all email addresses and phone numbers from contacts.pdf"
"Redact protected health information from medical-record.pdf"
```

The AI analyzes the document content and identifies PII including names, addresses, phone numbers, SSNs, credit card numbers, email addresses, and more. You can also specify custom redaction criteria.

> **Note:** AI redaction typically takes 60–120 seconds due to AI analysis. The redaction is permanent and irreversible — the original content is completely removed from the PDF.

### Form Filling & Instant JSON

The `document_processor` tool supports the `applyInstantJson` action for filling PDF form fields, creating form fields, and importing annotations using Nutrient's [Instant JSON](https://www.nutrient.io/guides/web/json/) format.

```
"Fill the form fields in application.pdf using the data in form_data.json"
"Add annotations from annotations.json to report.pdf"
```

### HTML-to-PDF with Layout Options

When converting HTML to PDF, you can control page layout including orientation, page size, and margins:

```
"Convert report.html to a landscape A4 PDF with 20mm margins"
"Generate a PDF from invoice.html in Letter size"
```

### Compatibility

Nutrient DWS MCP Server has been tested with Claude Desktop (Claude 3.7 Sonnet). Other MCP clients may work, but results may vary.

Nutrient DWS MCP Server supports macOS and Windows for now. Feel free to open an issue if you're interested in Linux support.

### Further configuration

#### Sandbox mode (Recommended)

The server supports an optional sandbox mode that restricts file operations to a specific directory. This is useful for security purposes, ensuring that the server can only read from and write to files within the specified directory. You should drop any documents you'd like to work on in this directory.

To enable sandbox mode, set the `SANDBOX_PATH` environment variable:

```bash
export SANDBOX_PATH=/path/to/sandbox/directory
npx @nutrient-sdk/dws-mcp-server
```

When sandbox mode is enabled:

- For relative paths, they are resolved relative to the sandbox directory.
- All input file paths are validated to ensure they exist and reside in the sandbox before performing any file operations

If no sandbox directory is specified, the server will operate without file path restrictions, allowing access to any file on the system that the server process has permission to access. (Not Recommended)

#### Output location

Processed files will be saved to a location determined by the LLM. If sandbox mode is enabled, it will reside inside this directory.

To further guide the LLM on where to place the output file, use natural language such as "please output the result to `output/my_result.pdf`".
Or you may also add an `output` directory in your sandbox to hint to the LLM to use this directory for all resulting files.

### Credit Tracking

The server automatically tracks API credit usage from response headers. Use the `check_credits` tool to monitor your balance:

| Action     | Description                                              |
| ---------- | -------------------------------------------------------- |
| `balance`  | Current credits remaining, daily rate, days until empty  |
| `usage`    | Credit breakdown by operation (OCR, signing, etc.)       |
| `forecast` | Projected exhaustion date with confidence level          |

Usage data is stored locally in SQLite at `~/.local/share/nutrient-dws-mcp/credits.db` (macOS/Linux) or the equivalent platform-specific data directory.

## Contributions

Please see the contribution guidelines in [CONTRIBUTING.md](CONTRIBUTING.md)