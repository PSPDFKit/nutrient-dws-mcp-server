# Releasing

Use this checklist for every release. Complete it in order from a clean checkout of the reviewed release commit, and stop if any verification fails.

This checklist was added after the v0.0.6 `.mcpb` remained the only GitHub Release bundle for more than two months. npm reached 0.1.0 on 2026-07-21, leaving that extension bundle behind for 34 days as of 2026-08-24. The bundle itself was over two months old; it had not lagged npm 0.1.0 for two months. The release surfaces drifted because there was no single checklist tying them together.

## Canonical metadata

- Name: Nutrient DWS MCP Server
- Repository: `https://github.com/PSPDFKit/nutrient-dws-mcp-server`
- npm package: `@nutrient-sdk/dws-mcp-server`
- npm install command: `npx -y @nutrient-sdk/dws-mcp-server`
- MCP Registry name: `io.github.PSPDFKit/nutrient-dws-mcp-server`
- Homepage: `https://www.nutrient.io/mcp-server-pdf-automation-llm/`
- Documentation: `https://www.nutrient.io/guides/dws-processor/getting-started/mcp-server/`

## 1. Prepare the release

- [ ] Confirm the release commit is reviewed, CI is green, and the working tree is clean.
- [ ] Set the intended semantic version locally: `VERSION=x.y.z`.
- [ ] Update `package.json` to `${VERSION}`. Do not change the package name or `mcpName`.
- [ ] Run `pnpm run manifest:sync-version` and verify `manifest.json` is `${VERSION}`.
- [ ] Update both `version` and `packages[0].version` in `server.json` to `${VERSION}`. If `server.json` is absent, stop: MCP Registry publication is not ready.
- [ ] Add `## [${VERSION}] - YYYY-MM-DD` to `CHANGELOG.md`, covering user-visible changes, configuration changes, and breaking changes. Create the changelog if this is the first release using it.
- [ ] Verify the version is identical in `package.json`, `manifest.json`, `server.json`, and `server.json`'s npm package entry.
- [ ] Commit the release metadata using the repository's normal review process.

## 2. Run release gates

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm test`
- [ ] `pnpm run mcpb:validate`
- [ ] `npm publish --dry-run`
- [ ] Verify `server.json` against the current [official MCP Registry schema and publisher guidance](https://modelcontextprotocol.io/registry/quickstart). The `mcp-publisher publish` command performs registry validation; do not rely on an undocumented `publish --dry-run` flag.

## 3. Tag the reviewed release commit

- [ ] Create a signed tag: `git tag -s "v${VERSION}" -m "DWS MCP v${VERSION}"`. Use an annotated tag only when repository policy permits it and signing is unavailable.
- [ ] Push the reviewed release commit and exact tag through the normal protected-branch process.
- [ ] Verify `git rev-list -n 1 "v${VERSION}"` is the intended release commit and all tag/commit CI checks are green.

## 4. Publish npm

- [ ] Confirm the intended npm identity with `npm whoami`.
- [ ] Run `npm publish --access public`.
- [ ] Verify the published version and tarball: `npm view "@nutrient-sdk/dws-mcp-server@${VERSION}" version dist.tarball --json`.

## 5. Build and attach the MCPB

- [ ] Run `pnpm run mcpb:pack` only after npm publication succeeds.
- [ ] Rename `dist/nutrient-dws.mcpb` to `dist/nutrient-dws-${VERSION}.mcpb` so the release asset identifies its version.
- [ ] Create the GitHub Release and attach the bundle: `gh release create "v${VERSION}" "dist/nutrient-dws-${VERSION}.mcpb" --verify-tag --title "DWS MCP v${VERSION}" --generate-notes`.
- [ ] Verify the tag, publication time, URL, and attached asset: `gh release view "v${VERSION}" --json tagName,publishedAt,url,assets`.

## 6. Publish to the official MCP Registry

- [ ] Confirm npm already serves `${VERSION}` and `server.json` names that same package version.
- [ ] Install or update the official `mcp-publisher` CLI and review its current help output.
- [ ] Authenticate a maintainer who can publish the `io.github.PSPDFKit/*` namespace: `mcp-publisher login github`.
- [ ] From the repository root, run `mcp-publisher publish`.
- [ ] Verify the exact name and version in the Registry response: `curl -fsSL 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.PSPDFKit%2Fnutrient-dws-mcp-server'`.

## 7. Refresh downstream catalogs

Only request downstream refreshes after npm, the GitHub Release, its `.mcpb`, and the official MCP Registry entry are all verified. These are manual maintainer communications; do not automate or send them from release CI.

- [ ] Ask Glama to re-ingest or refresh its listing through its claim/update flow.
- [ ] Ask PulseMCP to refresh `https://www.pulsemcp.com/servers/nutrient-dws` and replace any temporary mirror identity with the official Registry identity.
- [ ] Verify both catalogs show `${VERSION}`, the canonical repository and install command, the current environment-variable schema, and all seven tools.

Use this canonical refresh request:

> Please re-ingest Nutrient DWS MCP Server from the canonical sources: repository `https://github.com/PSPDFKit/nutrient-dws-mcp-server`, npm `@nutrient-sdk/dws-mcp-server@<VERSION>`, and MCP Registry `io.github.PSPDFKit/nutrient-dws-mcp-server`. It is a local stdio server installed with `npx -y @nutrient-sdk/dws-mcp-server`. Static authentication supports `NUTRIENT_DWS_API_KEY` for Processor tools and optional `NUTRIENT_DWS_EXTRACTION_API_KEY` for `parse_document` and `extract_fields`; local desktop users can instead use OAuth, and `SANDBOX_PATH` controls local file access. Please refresh the version, repository and install metadata, environment-variable schema, and seven-tool inventory.

## 8. Final verification

- [ ] Confirm the Git tag, npm package, GitHub Release, `.mcpb`, MCP Registry entry, Glama listing, and PulseMCP listing all show the same version and canonical metadata.
- [ ] Record links to each verified surface in the release issue or pull request.
