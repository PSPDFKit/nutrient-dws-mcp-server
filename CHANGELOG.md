# Changelog

## Unreleased

- Expose the optional Data Extraction API key on the Smithery packaging surface and guard all packaging surfaces against runtime environment-variable drift.
- Keep slow sandbox filesystem preparation out of the MCP initialize critical path, guard initialization against token or HTTP work, and provide a stderr hint for interactive stdio launches.
- Add the canonical release checklist for npm, MCPB, GitHub Releases, the official MCP Registry, Glama, and PulseMCP.
