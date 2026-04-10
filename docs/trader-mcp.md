# Trader MCP

Last updated: 2026-04-10

## Goal

Provide an AI-friendly trader MCP on top of Stratium's Hyperliquid-compatible API surface.

This MCP is execution-oriented. It hides signer credentials, owns nonce generation, and exposes typed tools instead of forcing the model to build raw `/info` and `/exchange` envelopes.

## Runtime Model

Current implementation lives in:

- `apps/trader-mcp/src/index.ts`
- `apps/trader-mcp/src/client.ts`

Current transport:

- stdio MCP server

Current backend target:

- Stratium Fastify API

Current auth bootstrap modes:

1. frontend login bootstrap
   - `STRATIUM_FRONTEND_USERNAME`
   - `STRATIUM_FRONTEND_PASSWORD`
   - then fetch `GET /api/bot-credentials`
2. direct bot credentials
   - `STRATIUM_BOT_ACCOUNT_ID`
   - `STRATIUM_BOT_VAULT_ADDRESS`
   - `STRATIUM_BOT_SIGNER_ADDRESS`
   - `STRATIUM_BOT_API_SECRET`

Common base URL:

- `STRATIUM_API_BASE_URL`
  defaults to `http://127.0.0.1:4000`

## Security Model

The model never receives:

- bot `apiSecret`
- raw signer bootstrap flow
- nonce control

The MCP server owns:

- bot credential loading
- HMAC signing
- nonce generation
- request submission to Stratium

This matches the roadmap requirement that the MCP, not the model, manages signer usage and nonce policy.

## Tool List

### Market tools

- `stratium_get_meta`
  returns Hyperliquid-compatible `meta`
- `stratium_get_all_mids`
  returns Hyperliquid-compatible `allMids`
- `stratium_get_l2_book`
  inputs:
  `coin`
- `stratium_get_candles`
  inputs:
  `coin`, `interval`, `startTime`, `endTime`
- `stratium_get_recent_trades`
  inputs:
  `coin`

### Account tools

- `stratium_get_clearinghouse_state`
  returns private account state for the MCP-authenticated account
- `stratium_get_open_orders`
  returns private open orders for the MCP-authenticated account
- `stratium_get_order_status`
  inputs:
  `oid`
  accepts either numeric oid or string cloid

### Trading tools

- `stratium_place_order`
  inputs:
  `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `trigger?`
- `stratium_cancel_order`
  inputs:
  `oid`, `asset?`
- `stratium_cancel_order_by_cloid`
  inputs:
  `cloid`, `asset?`
- `stratium_modify_order`
  inputs:
  `oid`, `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `trigger?`
- `stratium_batch_modify`
  inputs:
  `modifies[]`
- `stratium_schedule_cancel`
  inputs:
  `time`

## Output Shape

Each tool returns:

1. `structuredContent`
   machine-friendly payload containing:
   - `operation`
   - `summary`
   - `raw`
2. `content`
   text copy of the same payload for broad MCP client compatibility

Summary behavior:

- read tools usually mirror the raw API response
- trading tools normalize Hyperliquid-style `statuses[]` into simpler model-readable summaries such as:
  - accepted / rejected
  - resting / filled
  - `oid`
  - `cloid`
  - error string

## Nonce Behavior

Nonce is not a tool input.

Current policy:

- the MCP client keeps an internal monotonically increasing millisecond-based nonce cursor
- each signed private request gets a fresh nonce
- nonce reuse is prevented inside the MCP process

This is aligned with the current Stratium API behavior, which rejects replayed nonces.

## Tool Calling Guidance For AI Agents

Recommended usage pattern:

1. inspect market with:
   - `stratium_get_meta`
   - `stratium_get_all_mids`
   - `stratium_get_l2_book`
2. inspect account with:
   - `stratium_get_clearinghouse_state`
   - `stratium_get_open_orders`
3. execute with:
   - `stratium_place_order`
   - `stratium_modify_order`
   - `stratium_cancel_order`
4. confirm with:
   - `stratium_get_order_status`
   - `stratium_get_open_orders`

Recommended reasoning rule for the model:

- prefer typed tools over reasoning about raw `/exchange` payloads
- use `summary` first
- inspect `raw` only when the summary is insufficient

## Safety Boundaries

Current implementation protects secrets, but it does not yet enforce higher-level policy controls such as:

- max order size guardrails
- max leverage guardrails
- symbol allowlists
- strategy approval workflow
- dry-run vs live-execute policy split

For AI-facing deployment, these should be added before broad autonomous use.

## Validation Status

Current validation completed:

- `pnpm --filter @stratium/trader-mcp lint`
- `pnpm --filter @stratium/trader-mcp test`

Test coverage currently includes:

- frontend-login bootstrap to bot credentials
- signed private request generation
- direct bot-credential mode
- normalized exchange status summarization

## Known Limits

1. This MCP currently targets request/response tools only.
   It does not expose websocket subscriptions yet.
2. It follows Stratium's current local signer model.
   It does not implement real Hyperliquid signature recovery.
3. It is execution-oriented.
   Replay, PnL analysis, and strategy feedback tools are not in this first version yet.

## Minimal Launch Example

Example environment:

```bash
STRATIUM_API_BASE_URL=http://127.0.0.1:4000
STRATIUM_FRONTEND_USERNAME=demo
STRATIUM_FRONTEND_PASSWORD=demo123456
```

Example run:

```bash
pnpm --filter @stratium/trader-mcp dev
```
