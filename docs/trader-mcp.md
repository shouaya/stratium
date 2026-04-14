# Trader MCP

Last updated: 2026-04-14

## Goal

Trader MCP provides an AI-agent-friendly execution layer on top of Stratium's Hyperliquid-compatible API.

This MCP is execution-first:

- it does not expose signer secrets to the model
- it manages nonce generation internally
- it exposes typed tools instead of making the model construct raw `/info` and `/exchange` payloads itself

## Runtime Model

The current implementation lives in:

- `apps/trader-mcp/src/index.ts`
- `apps/trader-mcp/src/client.ts`
- `apps/trader-mcp/src/http-server.ts`
- `apps/trader-mcp/src/tools.ts`

Current transport model:

- uses a streamable HTTP MCP server by default
- keeps `stdio` only as a local development fallback

Current backend target:

- Stratium Fastify API

Current authentication bootstrap modes:

1. Recommended: pass through the platform bearer token
   - the MCP client sends `Authorization: Bearer <platform-token>`
   - `trader-mcp` reuses the existing Stratium session and bot/account binding via `GET /api/bot-credentials`
2. Fallback: frontend account login bootstrap
   - `STRATIUM_FRONTEND_USERNAME`
   - `STRATIUM_FRONTEND_PASSWORD`
   - then request `GET /api/bot-credentials`
3. Fallback: inject bot credentials directly
   - `STRATIUM_BOT_ACCOUNT_ID`
   - `STRATIUM_BOT_VAULT_ADDRESS`
   - `STRATIUM_BOT_SIGNER_ADDRESS`
   - `STRATIUM_BOT_API_SECRET`

Common backend base URL:

- `STRATIUM_API_BASE_URL`
  default: `http://api:4000` inside Docker Compose
  required explicitly when running `trader-mcp` outside Docker Compose, including remote standalone deployments

Default MCP endpoint:

- `http://127.0.0.1:4600/mcp`

## Security Model

The model never touches:

- bot `apiSecret`
- the raw signer bootstrap flow
- nonce control

The MCP service itself is responsible for:

- loading bot credentials
- HMAC signing
- nonce generation
- sending requests to Stratium

This matches the roadmap requirement that signer usage and nonce strategy must be managed by the MCP layer, not by the model.

## Deployment Model

The primary deployment model is a remote MCP service.

In practice, a bot or AI client only needs:

1. an MCP URL
2. a Stratium platform bearer token

The client does not need to handle:

- bot signer secrets
- nonce management
- direct `/api/auth/login` bootstrap logic

For local development, `docker compose up` exposes:

- Web UI: `http://localhost:5000`
- API: `http://localhost:6100`
- Trader MCP: `http://localhost:4600/mcp`

Remote MCP deployments should use the same model with an explicit `STRATIUM_API_BASE_URL`.

## Client Integration Model

Recommended client flow:

1. log in through the normal Stratium flow and obtain a standard frontend token
2. connect to the MCP URL: `http://<host>:4600/mcp`
3. attach `Authorization: Bearer <token>` to MCP HTTP requests
4. call the trader tools normally

Inside the MCP service:

1. it reuses the existing Stratium API authentication model
2. it fetches the bot credentials bound to the current session via `GET /api/bot-credentials`
3. it signs private `/info` and `/exchange` requests on behalf of the session account

This keeps MCP authentication aligned with the existing `web -> api` user and account model.

## Tool List

### Market Tools

- `stratium_get_meta`
  returns Hyperliquid-compatible `meta`
- `stratium_get_meta_and_asset_ctxs`
  returns Hyperliquid-compatible `metaAndAssetCtxs`
- `stratium_get_all_mids`
  returns Hyperliquid-compatible `allMids`
- `stratium_get_l2_book`
  input:
  `coin`
- `stratium_get_candles`
  input:
  `coin`, `interval`, `startTime`, `endTime`
- `stratium_get_recent_trades`
  input:
  `coin`

### Account Tools

- `stratium_get_clearinghouse_state`
  returns the private account state for the currently authenticated MCP account
- `stratium_get_open_orders`
  returns open orders for the currently authenticated MCP account
- `stratium_get_frontend_open_orders`
  returns open orders with trigger/group metadata, useful for frontend trading UIs
- `stratium_get_order_status`
  input:
  `oid`
  supports either numeric `oid` or string `cloid`
- `stratium_get_exchange_status`
  returns exchange health / availability status

### Trading Tools

- `stratium_place_order`
  input:
  `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `grouping?`, `trigger?`
- `stratium_place_orders`
  input:
  `grouping`, `orders[]`
  supports grouped submission under `normalTpsl` and `positionTpsl`
- `stratium_cancel_order`
  input:
  `oid`, `asset?`
- `stratium_cancel_order_by_cloid`
  input:
  `cloid`, `asset?`
- `stratium_modify_order`
  input:
  `oid`, `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `trigger?`
- `stratium_batch_modify`
  input:
  `modifies[]`
- `stratium_schedule_cancel`
  input:
  `time`

Currently supported `grouping` values:

- `na`
- `normalTpsl`
- `positionTpsl`

## Output Shape

Each tool returns:

1. `structuredContent`
   a structured result for programmatic consumption, containing:
   - `operation`
   - `summary`
   - `raw`
2. `content`
   a textual mirror of the same result for broader MCP client compatibility

Meaning of `summary`:

- query tools usually mirror the raw API response directly
- trading tools normalize Hyperliquid-style `statuses[]` into a more model-friendly summary, such as:
  - accepted / rejected
  - resting / filled
  - `oid`
  - `cloid`
  - error string

## Nonce Behavior

Nonce is not a tool input.

Current strategy:

- the MCP client maintains an internally increasing millisecond-based nonce cursor
- every signed private request gets a new nonce
- the MCP process avoids nonce reuse within the process

This matches current Stratium API behavior because Stratium rejects replayed nonces.

## Recommended AI Agent Call Pattern

Recommended sequence:

1. inspect the market first:
   - `stratium_get_meta`
   - `stratium_get_meta_and_asset_ctxs`
   - `stratium_get_all_mids`
   - `stratium_get_l2_book`
2. inspect the account next:
   - `stratium_get_clearinghouse_state`
   - `stratium_get_frontend_open_orders`
3. execute trading actions:
   - `stratium_place_order` or `stratium_place_orders`
   - `stratium_modify_order`
   - `stratium_cancel_order`
4. confirm the result:
   - `stratium_get_order_status`
   - `stratium_get_frontend_open_orders`

Suggested reasoning rules for the model:

- prefer typed tools instead of deriving raw `/exchange` payloads manually
- inspect `summary` first
- only inspect `raw` when `summary` is not sufficient

## Security Boundaries

The current implementation protects secrets, but it does not yet include higher-level control layers such as:

- maximum order size limits
- maximum leverage limits
- instrument allowlists
- strategy approval flow
- dry-run vs. live-execute separation

If broader AI trading autonomy is planned, those controls should be added first.

## Current Verification Status

The following have been completed:

- `pnpm --filter @stratium/trader-mcp lint`
- `pnpm --filter @stratium/trader-mcp test`
- `pnpm --filter @stratium/trader-mcp build`

Current test coverage includes:

- streamable HTTP MCP server startup
- bearer-token pass-through authentication
- frontend login bootstrap to bot credentials
- private request signature generation
- direct bot credential mode
- normalized trading status summaries
- MCP client integration against the HTTP endpoint
- real end-to-end tool execution against a mocked Stratium API

## Current Limitations

1. The current MCP is still request/response oriented.
   It does not yet expose WebSocket subscription capability.
2. It follows Stratium's current local signer model.
   It does not yet implement real Hyperliquid signature recovery logic.
3. The focus of this version is execution.
   Replay, PnL analysis, and strategy feedback tools are not included yet.

## Local Startup Example

Example environment variables:

```bash
# Browser-facing API URL used by the web app.
NEXT_PUBLIC_API_BASE_URL=http://localhost:6100
# Internal service URL used by Docker Compose services.
STRATIUM_API_BASE_URL=http://api:4000
STRATIUM_MCP_DEBUG_LOG_PATH=logs/trader-mcp-http.ndjson
```

If you run `trader-mcp` as a standalone process on a remote server instead of inside Docker Compose, you must set `STRATIUM_API_BASE_URL` explicitly to a server-reachable API address such as an internal load balancer URL or a loopback listener on that same server.

Startup command:

```bash
docker compose up trader-mcp
```

Then connect your MCP client to:

```text
http://localhost:4600/mcp
```

With:

```text
Authorization: Bearer <your Stratium frontend token>
```

If you need to debug connectivity between Codex and MCP or between MCP and Stratium API, inspect:

```text
logs/trader-mcp-http.ndjson
```

That file appends JSON Lines containing:

- inbound MCP HTTP request / response
- outbound HTTP request / response from `trader-mcp` to Stratium API
- request / response headers
- raw bodies

## Minimal Integration Summary

Any MCP client that supports streamable HTTP can connect directly to this service.

The client only needs to provide:

1. an MCP URL
2. a Stratium bearer token

The MCP service handles:

- bot credential loading
- request signing
- nonce generation
- request normalization
