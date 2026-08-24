# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-24

### Fixed

- Excluded the `.mcpb` desktop-extension bundles from the npm tarball. The 0.1.1 tarball accidentally shipped two 4.4 MB bundles (8.1 MB package instead of ~150 KB); 0.1.2 is the slim package.

## [0.1.1] - 2026-08-24

### Added

- Added official MCP Registry metadata through `server.json` and the matching `mcpName` in the published npm package.
- Exposed `NUTRIENT_DWS_EXTRACTION_API_KEY` as an optional secret in registry metadata for `parse_document` and `extract_fields` when using static-key authentication.
- Added the canonical release checklist (`RELEASING.md`) for npm, MCPB, GitHub Releases, the official MCP Registry, Glama, and PulseMCP.

### Fixed

- Exposed the optional Data Extraction API key on the Smithery packaging surface (#35) and guarded all packaging surfaces against runtime environment-variable drift.
- Kept slow sandbox filesystem preparation out of the MCP `initialize` critical path, guarded initialization against token or HTTP work, closed the server if startup preparation fails, and added a stderr hint for interactive stdio launches.

## [0.1.0] - 2026-07-21

### Added

- Added the `parse_document` and `extract_fields` tools for the Nutrient Data Extraction API.

### Changed

- Expanded the existing stdio browser OAuth flow—which already included PKCE, token caching, refresh, and Dynamic Client Registration (DCR) before 0.1.0—so one OAuth token covers the Processor and Data Extraction products.

[0.1.2]: https://github.com/PSPDFKit/nutrient-dws-mcp-server/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PSPDFKit/nutrient-dws-mcp-server/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PSPDFKit/nutrient-dws-mcp-server/releases/tag/v0.1.0
