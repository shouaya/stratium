# Hyperliquid API Compatibility

Last updated: 2026-04-10

## Goal

Expose a bot-facing API for Stratium that is as close as practical to Hyperliquid's public and private API surface, so strategy code can be migrated with minimal change and later redirected toward real Hyperliquid trading.

This is a compatibility layer over Stratium's local simulation engine, not a chain-native implementation.

## Official Hyperliquid Surface

Hyperliquid's public developer surface is organized around:

1. `POST /info`
   query API for public and private reads
2. `POST /exchange`
   signed trading and account actions
3. `wss://.../ws`
   realtime market and user streams

Official references:

- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
- https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/api-servers

## Current Stratium Compatibility Surface

Implemented bot-facing endpoints:

- `POST /info`
- `POST /exchange`
- `GET /ws-hyperliquid`
- `GET /api/bot-credentials`

Current frontend state:

- Web trading still uses login session to enter the app
- Web trading actions now sign and submit bot-style `/exchange` requests
- Web reads for UI state still use existing internal endpoints such as `/api/state` and `/ws`

## `POST /info` Support

### Public query types implemented

- `meta`
- `metaAndAssetCtxs`
- `allMids`
- `l2Book`
- `candleSnapshot`
- `recentTrades`
- `exchangeStatus`

### Private query types implemented

- `openOrders`
- `frontendOpenOrders`
- `orderStatus`
- `clearinghouseState`

Private `info` requests can now authenticate through:

1. frontend session mapped to a trading account
2. bot signer credentials plus nonce and signature

## `POST /exchange` Support

Implemented actions:

- `order`
- `cancel`
- `cancelByCloid`
- `scheduleCancel`
- `modify`
- `batchModify`

Implemented trading semantics:

- `cloid` propagation through local order state
- `reduceOnly` validation against current local position
- trigger orders stored as pending local trigger instructions and released into the engine when trigger conditions are met

### Supported action summary

#### `order`

Supported order styles:

- limit order with `t.limit.tif = Gtc`
- limit order with `t.limit.tif = Ioc`
- trigger order with `t.trigger`

Current behavior:

- active resting orders are submitted into Stratium runtime
- market-like immediate behavior is modeled through `Ioc`
- trigger orders are held in the compatibility layer until the local trigger condition is met

#### `cancel`

Supported fields:

- `asset`
- `oid`

Current behavior:

- cancels an active local order by order id
- trigger orders can also be cancelled if their virtual order id is supplied

#### `cancelByCloid`

Supported fields:

- `asset`
- `cloid`

Current behavior:

- resolves local order by client order id
- supports both active and pending trigger orders

#### `scheduleCancel`

Current behavior:

- stores cancel-all deadline for the local account
- on expiry, locally open orders are cancelled

#### `modify`

Current behavior:

- active order modify is implemented as local cancel-and-replace
- trigger order modify updates the stored trigger instruction in place

#### `batchModify`

Current behavior:

- processes multiple local modify requests sequentially
- response shape follows the same status array pattern as Hyperliquid-style order responses

## Authentication Model

### Current local bot credential model

The service now exposes a local bot credential bootstrap endpoint:

- `GET /api/bot-credentials`

It returns:

- `accountId`
- `vaultAddress`
- `signerAddress`
- `apiSecret`

Current signing model:

1. client fetches bot credentials for a local trading account
2. client signs the unsigned request body with HMAC-SHA256 using `apiSecret`
3. client sends:
   - `vaultAddress`
   - `nonce`
   - `signature.r = signerAddress`
   - `signature.s = computed signature`
4. server validates:
   - signer maps to account
   - vault maps to account
   - signature matches request body
   - nonce has not been used in recent history

### Nonce behavior

The server now maintains a per-signer rolling set of the highest recent nonces and rejects replayed nonces.

This is intentionally modeled after Hyperliquid's anti-replay requirement, but it is still a local approximation.

## Private HTTP Request Examples

### `POST /exchange` order

```json
{
  "action": {
    "type": "order",
    "orders": [
      {
        "a": 0,
        "b": true,
        "p": "70000",
        "s": "1",
        "r": false,
        "t": { "limit": { "tif": "Gtc" } },
        "c": "0x1234567890abcdef1234567890abcdef"
      }
    ],
    "grouping": "na"
  },
  "nonce": 101,
  "vaultAddress": "0x...",
  "signature": {
    "r": "0x...",
    "s": "0x...",
    "v": 27
  }
}
```

Example success response:

```json
{
  "status": "ok",
  "response": {
    "type": "order",
    "data": {
      "statuses": [
        {
          "resting": {
            "oid": 1,
            "cloid": "0x1234567890abcdef1234567890abcdef"
          }
        }
      ]
    }
  }
}
```

### `POST /exchange` modify

```json
{
  "action": {
    "type": "modify",
    "oid": 1,
    "order": {
      "a": 0,
      "b": false,
      "p": "70020",
      "s": "1",
      "r": false,
      "t": { "limit": { "tif": "Gtc" } }
    }
  },
  "nonce": 102,
  "vaultAddress": "0x...",
  "signature": {
    "r": "0x...",
    "s": "0x...",
    "v": 27
  }
}
```

### `POST /info` open orders

```json
{
  "type": "openOrders",
  "user": "paper-account-1",
  "nonce": 103,
  "vaultAddress": "0x...",
  "signature": {
    "r": "0x...",
    "s": "0x...",
    "v": 27
  }
}
```

Example response:

```json
[
  {
    "coin": "BTC",
    "side": "B",
    "limitPx": "70000",
    "sz": "1",
    "oid": 1,
    "timestamp": 1760054400000,
    "origSz": "1",
    "cloid": "0x1234567890abcdef1234567890abcdef"
  }
]
```

## Error Behavior

Current private HTTP error behavior:

- auth failure returns `401`
- unsupported `info.type` returns `400`
- unsupported or invalid exchange action returns `400`
- used nonce returns `401`
- invalid signature returns `401`
- reduce-only rejection currently returns HTTP `200` with per-order `statuses[].error`

This matches the current implementation, not a claim of exact Hyperliquid parity.

## Compatibility Matrix

### High compatibility today

- public market reads over `POST /info`
- private order reads over `POST /info`
- bot-facing order placement and cancellation over `POST /exchange`
- `cloid`-based cancellation
- local signer and nonce enforcement

### Shape-compatible but simulation-backed

- `clearinghouseState`
- `openOrders`
- `orderStatus`
- trigger order lifecycle
- `modify`
- `batchModify`

These are driven by Stratium's local engine and local market state, not Hyperliquid chain state or exchange internals.

### Not implemented yet

- websocket post requests
- real signer recovery compatible with Hyperliquid signing rules
- subaccounts / vault hierarchy beyond local compatibility mapping
- full action set beyond currently implemented subset

## Important Deviations From Real Hyperliquid

1. Single-symbol focus
   Current runtime is still centered on one active trading symbol.
2. Synthetic universe metadata
   `meta` and `marginTables` are derived from local symbol configuration.
3. Synthetic trade details
   `recentTrades.hash` and `recentTrades.users` are placeholders.
4. Local signer model
   The current signer implementation is HMAC-based for local bot isolation, not Hyperliquid's real signature recovery flow.
5. Local trigger order handling
   Trigger orders are stored and evaluated in the API compatibility layer, not in an exchange-native matching engine.
6. Modify semantics
   Local modify is effectively cancel-and-replace for active resting orders.
7. Internal UI state endpoints still exist
   The Web app still consumes `/api/state`, `/api/fill-history`, and `/ws` for rich UI state hydration.

## Current Architecture Call

There are now two intentionally separate layers:

1. Hyperliquid-compatible bot layer
   `POST /info`, `POST /exchange`, local signer auth
2. Internal UI layer
   `/api/state`, `/api/fill-history`, `/ws`, admin APIs

This is deliberate. The bot layer optimizes for compatibility with external strategy code. The UI layer optimizes for a low-friction trading interface and pre-aggregated state.

## Recommended Next Steps

1. Decide whether Web should eventually consume the Hyperliquid-style user websocket directly.
2. Replace the local HMAC signer with a signer model closer to Hyperliquid's real signing and verification flow.
3. Add websocket-post request compatibility only if strategy clients require it.
4. Expand `POST /exchange` action support only after signer semantics are stable.
5. Keep this document updated whenever compatibility behavior changes, especially around auth, nonce handling, trigger semantics, and user stream semantics.
