# Publishing to Smithery

Smithery lists this server as `nutrient/dws-mcp-server`. Publish a release through the registry HTTP API until [smithery-ai/cli#787](https://github.com/smithery-ai/cli/issues/787) is fixed. The Smithery CLI currently forwards MCPB tool declarations without the required `inputSchema`, while the MCPB manifest does not allow that field. Replace this API procedure with the official CLI path once the issue is resolved.

## Prerequisites

- Use a clean checkout of the release tag. Set `VERSION` to that tag's version without the `v` prefix.
- Run `pnpm install --frozen-lockfile` and `pnpm build` in that checkout.
- Run `pnpm run mcpb:pack` in the same checkout, then run `mv dist/nutrient-dws.mcpb "nutrient-dws-${VERSION}.mcpb"`. The card and bundle must come from the same tagged source.
- Obtain a Smithery API key. On macOS, a Smithery CLI login stores it as `apiKey` in `~/Library/Application Support/smithery/settings.json`; a service token can be used instead. Load the value into `SMITHERY_API_KEY` without echoing it. Never commit the key, the settings file, or a command containing the literal key.
- Run the commands below from the tagged checkout's repository root. Keep `card.json`, its provenance file, and the response files as release evidence; do not commit credentials.

For example, load the macOS CLI credential without printing it:

```sh
export SMITHERY_API_KEY="$(node -p "require(process.env.HOME + '/Library/Application Support/smithery/settings.json').apiKey")"
```

For a service token, enter it without terminal echo:

```sh
read -rs SMITHERY_API_KEY
export SMITHERY_API_KEY
```

## Generate the deploy payload

Generate and validate the server card by probing the built MCP server:

```sh
pnpm smithery:card "$VERSION" card.json
```

The command also writes `card.json.provenance.json` with the version, source commit, generation time, and tool and prompt counts.

## Update the listing metadata

```sh
curl -fsS -X PATCH \
  'https://registry.smithery.ai/servers/nutrient/dws-mcp-server' \
  -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
  -H 'Content-Type: application/json' \
  --data '{"license":"MIT","repositoryUrl":"https://github.com/PSPDFKit/nutrient-dws-mcp-server","homepage":"https://www.nutrient.io/api/"}'
```

## Upload the icon

Confirm `icon.png` is PNG, JPEG, GIF, SVG, or WebP and no larger than 1 MB. Try these requests in order and stop after the first successful response. The first two use the documented `%2F`-encoded qualified name; the third is the registry host's unencoded fallback.

```sh
curl -fsS --path-as-is -X PUT \
  'https://registry.smithery.ai/servers/nutrient%2Fdws-mcp-server/icon' \
  -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
  -F 'file=@icon.png'

curl -fsS --path-as-is -X PUT \
  'https://api.smithery.ai/servers/nutrient%2Fdws-mcp-server/icon' \
  -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
  -F 'file=@icon.png'

curl -fsS -X PUT \
  'https://registry.smithery.ai/servers/nutrient/dws-mcp-server/icon' \
  -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
  -F 'file=@icon.png'
```

## Publish the stdio release

Upload the JSON DeployPayload and the versioned MCPB from the same tagged checkout. A successful submission returns HTTP 202 with a `deploymentId` and `status` of `WORKING`.

```sh
curl -fsS -X PUT \
  'https://registry.smithery.ai/servers/nutrient/dws-mcp-server/releases' \
  -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
  -F 'payload=<card.json' \
  -F "bundle=@nutrient-dws-${VERSION}.mcpb" \
  -o smithery-release.json

DEPLOYMENT_ID="$(node -p "require('./smithery-release.json').deploymentId")"
node -p "require('./smithery-release.json').status"
```

Poll the deployment endpoint until it reports `SUCCESS`. Stop and investigate if it reports `FAILED`, or if it
does not reach a terminal state within five minutes.

```sh
for ATTEMPT in $(seq 1 60); do
  curl -fsS \
    "https://registry.smithery.ai/servers/nutrient/dws-mcp-server/releases/${DEPLOYMENT_ID}" \
    -H "Authorization: Bearer ${SMITHERY_API_KEY}" \
    -o smithery-status.json
  STATUS="$(node -p "require('./smithery-status.json').status")"
  printf '%s\n' "$STATUS"
  case "$STATUS" in
    SUCCESS) break ;;
    FAILED) exit 1 ;;
  esac
  if [ "$ATTEMPT" -eq 60 ]; then
    printf '%s\n' 'Smithery deployment did not finish within five minutes.' >&2
    exit 1
  fi
  sleep 5
done
```

## Verify the public record

Fetch the public record with a browser-like user agent, confirm that it shows all seven tools and five prompts, and inspect its connection, bundle, runtime, configuration schema, metadata, and `iconUrl`.

```sh
curl -fsSL \
  -A 'Mozilla/5.0 (Smithery release verification)' \
  'https://registry.smithery.ai/servers/nutrient/dws-mcp-server' \
  -o smithery-public.json

node -e "const record=require('./smithery-public.json'); console.log('tools', record.tools?.length ?? 0, 'prompts', record.prompts?.length ?? 0, 'iconUrl', record.iconUrl)"
```

After the release succeeds, repeat the public-record request and verify `iconUrl` again. If the icon is missing or stale, retry the three icon endpoints in order and re-check the record.

Remove the API key from the shell when verification is complete:

```sh
unset SMITHERY_API_KEY
```
