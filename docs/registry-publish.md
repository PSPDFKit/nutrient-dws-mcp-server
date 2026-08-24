# Publish version 0.1.1

Run these steps only after the release changes have merged into `main`.

## 1. Verify the merged release

Start from a clean checkout of the merged commit:

```sh
git switch main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm mcpb:validate
```

Confirm that `package.json`, `manifest.json`, and both version fields in `server.json` report `0.1.1`. Also confirm that `package.json#mcpName` and `server.json#name` both report `io.github.PSPDFKit/nutrient-dws-mcp-server`.

## 2. Publish the npm package

If npm provenance is configured for the package and publishing environment, publish with provenance:

```sh
npm publish --access public --provenance
```

Otherwise, publish without the provenance flag:

```sh
npm publish --access public
```

The npm publish must finish before the MCP Registry submission because the registry validates `mcpName` in the published package.

## 3. Publish to the official MCP Registry

The namespace `io.github.PSPDFKit` requires GitHub authentication that can verify the `PSPDFKit` organization. The GitHub account used for login must have the organization Owner role; ordinary organization membership is insufficient.

```sh
# PSPDFKit enforces SAML SSO: the device flow (`mcp-publisher login github`) grants only your
# personal namespace. Use a classic PAT with the read:org scope, SSO-authorized for PSPDFKit:
mcp-publisher login github -token <PAT>
mcp-publisher publish
```

The package transport remains `stdio`.

The registry metadata intentionally omits these runtime variables:

- `DWS_API_BASE_URL` is an internal and development endpoint override.
- `AUTH_SERVER_URL` and `CLIENT_ID` are OAuth implementation internals.

## 4. Build and attach the MCPB bundle

Build the bundle, then create the GitHub Release and attach the generated `.mcpb` file:

```sh
pnpm mcpb:pack
gh release create v0.1.1 dist/nutrient-dws.mcpb \
  --repo PSPDFKit/nutrient-dws-mcp-server \
  --title "v0.1.1" \
  --generate-notes
```

`pnpm mcpb:pack` validates the staged manifest and writes `dist/nutrient-dws.mcpb` before the release command uploads it.
