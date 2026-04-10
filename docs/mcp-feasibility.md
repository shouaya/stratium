# MCP Feasibility Based On Current Stratium API

Last updated: 2026-04-10

## Conclusion

It is feasible to expose the current Stratium bot API as an MCP server.

Not only is it feasible, it is structurally a good fit because the current API already separates:

1. public market reads
2. private trading actions
3. private account and order queries

That maps naturally onto MCP tools.

## Why MCP Fits This Repo

The current system already has the traits MCP wants:

1. deterministic backend behavior
   the trading core is local and replayable
2. explicit tool-shaped API actions
   `POST /info` and `POST /exchange` already look like machine-oriented tools
3. auth material that can be held server-side
   signer credentials can be managed by the MCP server instead of every LLM client
4. small, structured payloads
   most order and query responses are compact JSON, which is ideal for tools

## What MCP Would Add

Instead of exposing raw HTTP calls to an LLM agent, an MCP server would present higher-level tools such as:

- `market_meta`
- `market_mid`
- `market_orderbook`
- `market_candles`
- `market_recent_trades`
- `account_state`
- `open_orders`
- `order_status`
- `place_order`
- `cancel_order`
- `cancel_order_by_cloid`
- `modify_order`
- `schedule_cancel`

This is easier and safer for model use than asking the model to manually construct raw Hyperliquid-style request envelopes.

## Two Possible MCP Designs

### Option A: Thin MCP wrapper over existing HTTP API

The MCP server calls the existing Fastify endpoints.

Flow:

1. MCP tool receives structured input
2. MCP server signs or forwards auth
3. MCP server calls Stratium HTTP API
4. MCP server returns normalized tool output

Advantages:

- fastest path
- reuses current compatibility layer
- no duplication of trading logic

Disadvantages:

- HTTP payload translation still exists in two places
- more moving parts in production
- internal and MCP error models can drift if not kept synchronized

### Option B: Native MCP server on top of runtime / repository layer

The MCP server imports local runtime modules directly.

Flow:

1. MCP tool receives structured input
2. MCP server calls local runtime methods directly
3. MCP server returns tool-shaped output

Advantages:

- less transport overhead
- tighter type alignment
- easier to expose richer local concepts

Disadvantages:

- stronger coupling to repo internals
- more care needed around process lifecycle and shared state
- less faithful to the external API surface

## Recommended Design

Use Option A first.

Reason:

The current priority is compatibility with the bot-facing API surface, not maximum internal elegance. A thin MCP layer on top of:

- `POST /info`
- `POST /exchange`
- `GET /api/bot-credentials`

lets us:

1. keep one source of truth for compatibility behavior
2. validate the bot surface through real calls
3. switch MCP consumers and non-MCP bot consumers onto the same backend semantics

## Proposed MCP Tool Surface

### Market tools

- `stratium_get_meta`
  wraps `POST /info` with `type=meta`
- `stratium_get_all_mids`
  wraps `POST /info` with `type=allMids`
- `stratium_get_l2_book`
  wraps `POST /info` with `type=l2Book`
- `stratium_get_candles`
  wraps `POST /info` with `type=candleSnapshot`
- `stratium_get_recent_trades`
  wraps `POST /info` with `type=recentTrades`

### Account tools

- `stratium_get_clearinghouse_state`
  wraps `POST /info` with `type=clearinghouseState`
- `stratium_get_open_orders`
  wraps `POST /info` with `type=openOrders`
- `stratium_get_order_status`
  wraps `POST /info` with `type=orderStatus`

### Trading tools

- `stratium_place_order`
  wraps `POST /exchange` with `action.type=order`
- `stratium_cancel_order`
  wraps `POST /exchange` with `action.type=cancel`
- `stratium_cancel_order_by_cloid`
  wraps `POST /exchange` with `action.type=cancelByCloid`
- `stratium_modify_order`
  wraps `POST /exchange` with `action.type=modify`
- `stratium_batch_modify`
  wraps `POST /exchange` with `action.type=batchModify`
- `stratium_schedule_cancel`
  wraps `POST /exchange` with `action.type=scheduleCancel`

## Auth Design For MCP

MCP should not ask the model to manage signer internals directly.

Recommended pattern:

1. MCP server stores Stratium bot credentials securely
2. model calls a tool like `stratium_place_order`
3. MCP server:
   - fetches or loads bot credentials
   - constructs unsigned body
   - signs it
   - sends HTTP request
   - returns parsed response

That keeps:

- `apiSecret`
- nonce generation
- replay prevention

out of model-visible prompts.

## Nonce Strategy In MCP

Do not let the model supply raw nonce values.

Recommended:

1. MCP server owns nonce generation
2. MCP server uses monotonically increasing wall-clock-derived values or a dedicated nonce allocator
3. MCP server retries only when safe and never reuses a consumed nonce

This is critical because current Stratium compatibility already rejects replayed nonces.

## Response Design

The MCP layer should not blindly pass raw HTTP payloads upward in every tool.

Preferred pattern:

1. preserve raw response when useful
2. add a simplified summary for the model

Example for `stratium_place_order`:

- raw:
  Hyperliquid-style `statuses`
- summary:
  `accepted`, `oid`, `cloid`, `filled`, `error`

This reduces prompt waste and makes the model less likely to misread nested exchange payloads.

## Streaming / WebSocket

MCP is a strong fit for request/response tools.

It is a weaker fit for very high-frequency market streams unless the host supports subscriptions well.

Recommended sequence:

1. do request/response MCP tools first
2. add low-frequency subscription tools later if needed
3. keep raw high-frequency websocket streaming outside MCP unless there is a concrete agent use case

## Risks

### Risk 1: Tool granularity too low

If MCP only exposes a generic `call_info` and `call_exchange`, the model still has to understand low-level protocol details.

Mitigation:

Expose typed tools, not just generic passthrough.

### Risk 2: Auth drift

If MCP reimplements signing differently from the Web or external bots, behavior will diverge.

Mitigation:

Share one signing helper and one nonce policy across:

- MCP
- Web signer flow
- any external SDK we later publish

### Risk 3: Over-coupling to current local compatibility

If the MCP surface leaks local quirks, migrating to real Hyperliquid later becomes harder.

Mitigation:

Keep MCP tool names stable, but keep their payload semantics aligned to the Hyperliquid-compatible surface.

## Recommendation

Build an MCP server as a thin wrapper over the current Fastify bot API.

Do it in this order:

1. market read tools
2. account read tools
3. trading action tools
4. optional websocket or polling helpers

This gives the fastest path to usable LLM agent trading integration while preserving a clean migration path toward real Hyperliquid-compatible behavior.
