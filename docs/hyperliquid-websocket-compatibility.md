# Hyperliquid WebSocket Compatibility

Last updated: 2026-04-10

## Goal

Expose a private websocket stream close enough to Hyperliquid's user-stream model that bots can subscribe to order, fill, and user-event updates without depending on Stratium's internal UI websocket.

This stream is additive. The existing internal `/ws` remains in place for the Web UI.

## Endpoint

- `GET /ws-hyperliquid`

Current auth modes:

1. frontend session token through query `token`
2. bot signer query parameters:
   - `nonce`
   - `vaultAddress`
   - `signer`
   - `sig`

Current signer query mapping:

- `signer` maps to `signature.r`
- `sig` maps to `signature.s`
- `v` is fixed internally to `27`

## Subscription Model

Current supported subscribe message:

```json
{
  "method": "subscribe",
  "subscription": {
    "type": "orderUpdates",
    "user": "0xpaper"
  }
}
```

Supported subscription types:

- `orderUpdates`
- `userFills`
- `userEvents`

Current behavior:

- each successful subscribe immediately returns a snapshot for that channel
- later runtime events are pushed as incremental updates
- subscriptions are scoped to the authenticated local account, not to the raw `subscription.user` string

The `user` field is currently shape-compatible input only. Stratium authenticates by session or signer and then binds the socket to the resolved local account.

## Snapshot Payloads

### `orderUpdates`

Example snapshot:

```json
{
  "channel": "orderUpdates",
  "data": [
    {
      "order": {
        "coin": "BTC",
        "side": "B",
        "limitPx": "70000",
        "sz": "2",
        "oid": 1,
        "timestamp": 1760054400000,
        "origSz": "2",
        "cloid": "0xabc"
      },
      "status": "ACCEPTED",
      "statusTimestamp": 1760054400000
    }
  ]
}
```

Current snapshot contents:

- active local orders only
- statuses currently reflect Stratium local order statuses such as `NEW`, `ACCEPTED`, `PARTIALLY_FILLED`

### `userFills`

Example snapshot:

```json
{
  "channel": "userFills",
  "data": [
    {
      "coin": "BTC",
      "px": "70001",
      "sz": "1",
      "time": 1760054401000,
      "startPosition": "0",
      "dir": "unknown",
      "closedPnl": "0",
      "hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "oid": 1,
      "crossed": false,
      "fee": "0.5",
      "tid": 1
    }
  ]
}
```

Current notes:

- filled trade details are derived from local fill events
- `hash` is placeholder data
- direction and pnl details are currently approximated

### `userEvents`

Example snapshot:

```json
{
  "channel": "userEvents",
  "data": [
    {
      "eventType": "OrderRequested",
      "eventId": "evt-req-1",
      "symbol": "BTC-USD",
      "occurredAt": "2026-04-10T00:00:00.000Z",
      "payload": {
        "orderId": "ord_1"
      }
    }
  ]
}
```

Current notes:

- events come from Stratium's local event store
- `MarketTickReceived` is filtered out of this stream
- payloads are local event payloads, not exact Hyperliquid-native event objects

## Incremental Delivery Behavior

When the runtime broadcasts account events:

- `orderUpdates` pushes touched local orders for the authenticated account
- `userFills` pushes events derived from `OrderFilled` and `OrderPartiallyFilled`
- `userEvents` pushes the full filtered local event batch

Current implementation sends one payload per subscribed channel per broadcast batch.

## Differences From Real Hyperliquid

1. Endpoint path differs
   Stratium uses `/ws-hyperliquid`, not Hyperliquid's production websocket URL.
2. Authentication differs
   Stratium supports local session token and local HMAC signer query auth.
3. User binding differs
   `subscription.user` is not the source of truth for authorization.
4. Event payloads are simulation-backed
   Payloads are mapped from local runtime state and events.
5. No websocket-post requests
   Current websocket support is subscribe-and-stream only.
6. No market-stream parity in this channel
   This endpoint is focused on private user updates only.

## Validation Status

Current verification completed:

- TypeScript lint passed with `pnpm --filter @stratium/api lint`
- API and websocket tests passed with `pnpm --filter @stratium/api test`
- dedicated private websocket unit coverage exists in `apps/api/test/hyperliquid-private-ws.test.ts`

## Recommended Client Usage

For strategy and AI clients:

1. use `POST /exchange` for mutations
2. use private `POST /info` for queries
3. use `GET /ws-hyperliquid` for push updates
4. treat this websocket as compatibility-oriented, not exact real-Hyperliquid parity

For the current Web UI:

- keep using internal `/ws` until a deliberate migration is planned
