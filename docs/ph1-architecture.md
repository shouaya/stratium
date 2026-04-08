# PH1 Architecture

## Goal

PH1 delivers a usable trading simulation core and a basic Web prototype.

The goal is not feature breadth. The goal is a deterministic, testable trading loop:

1. ingest market data
2. accept orders
3. simulate fills
4. update position and account state
5. compute liquidation thresholds explicitly
6. persist events
7. replay the same event stream to the same final state

Current implementation note:

- liquidation calculation is present
- full liquidation trigger and execution workflow is not finished yet

## Scope

### Included
- single symbol
- single account
- market orders
- limit orders
- cancel order
- position tracking
- realized and unrealized PnL
- initial and maintenance margin
- liquidation threshold calculation
- event persistence
- replay API
- basic Web page for order entry and state inspection

### Excluded
- multi-strategy orchestration
- shared capital pool
- AI analysis
- on-chain login or settlement
- multi-symbol support
- advanced order types
- production-grade compliance and security hardening

## Architecture

```text
apps/
  web/               Next.js prototype
  api/               Fastify REST + WebSocket
packages/
  trading-core/      deterministic domain engine
  shared/            shared event types, DTOs, schemas
docs/
  ph1-architecture.md
  event-spec.md
  order-rules.md
  margin-rules.md
prisma/
  schema.prisma
docker-compose.yml
```

## Service Boundaries

### `packages/trading-core`
- pure TypeScript domain logic
- no dependency on Next.js, Fastify, Prisma, or PostgreSQL
- consumes commands and market ticks
- emits domain events and derived state changes
- is split into domain state, command handlers, replay reducers, and pure rule modules

Current internal structure:

```text
packages/trading-core/src/
  domain/
    state.ts
  engine/
    trading-engine.ts
    handle-submit-order.ts
    handle-cancel-order.ts
    handle-market-tick.ts
    handle-fill-order.ts
    handle-post-fill.ts
    handle-refresh-account.ts
  replay/
    apply-event.ts
    replay-events.ts
  rules/
    order-validation.ts
    pricing.ts
    position-math.ts
    account-math.ts
```

The intended flow is:

1. command handler derives events from current state
2. event application updates canonical state
3. replay uses the same event application path to rebuild state

### `apps/api`
- validates requests
- invokes `trading-core`
- persists events and read models
- publishes WebSocket updates
- exposes replay and query APIs
- is split into coordinator, trading runtime, market runtime, websocket hub, bootstrap loader, and repository adapter

Current internal structure:

```text
apps/api/src/
  index.ts
  routes.ts
  runtime.ts
  trading-runtime.ts
  market-runtime.ts
  websocket-hub.ts
  bootstrap.ts
  payloads.ts
  repository.ts
  hyperliquid-market.ts
```

Current API runtime responsibilities:

- `runtime.ts`
  facade that coordinates bootstrap, route-facing methods, and broadcast flow
- `trading-runtime.ts`
  owns `TradingEngine`, event store, replay state, and trading persistence
- `market-runtime.ts`
  owns live market memory, simulator state, Hyperliquid integration, and historical market reads
- `websocket-hub.ts`
  manages socket lifecycle and broadcasts prepared payloads
- `bootstrap.ts`
  loads persisted symbol config, events, and market snapshot
- `payloads.ts`
  centralizes HTTP and websocket payload shape assembly
- `repository.ts`
  owns PostgreSQL read/write details

### `apps/web`
- renders market, orders, positions, account, and replay views
- submits commands through HTTP
- consumes realtime updates through WebSocket

### `postgres`
- stores event log and query tables

## Core Domain Modules

### Market Feed
- tracks `bid`, `ask`, `last`, `timestamp`

### Order Engine
- validates order requests
- manages order lifecycle

### Fill Engine
- decides whether and how an order fills
- computes fill price, fill quantity, slippage

### Position Engine
- updates quantity, average entry, realized PnL, unrealized PnL

### Margin Engine
- computes initial margin, maintenance margin, available balance, risk ratio

### Liquidation Logic
- computes liquidation price and risk ratio
- liquidation execution flow is reserved for a later PH1 follow-up

### Ledger Engine
- records fee and balance changes

### Replay Engine
- rebuilds state from persisted events
- shares event application logic with the live engine path where possible

## Data Strategy

PH1 should treat the event log as the source of truth for simulation history.

Minimum persisted entities:

- `simulation_events`
- `orders`
- `fills`
- `positions`
- `accounts`
- `ledger_entries`
- `market_ticks`

Query tables may be updated transactionally from domain events.

## Core Rules for PH1

### Order types
- market order
- limit order

### Matching assumptions
- buy market orders execute from `ask`
- sell market orders execute from `bid`
- buy limit orders execute when `ask <= limitPrice`
- sell limit orders execute when `bid >= limitPrice`

### Margin mode
- only one margin mode in PH1
- prefer isolated margin first to reduce complexity

### Determinism
- every state mutation must be attributable to an event
- replaying the same event sequence must produce the same final state

## API Surface

### REST
- `POST /api/orders`
- `POST /api/orders/:id/cancel`
- `GET /api/orders`
- `GET /api/positions`
- `GET /api/account`
- `GET /api/replay/:sessionId`

### WebSocket events
- runtime currently broadcasts bootstrap and incremental state payloads over `/ws`
- payloads include trading state, event tape, simulator state, market snapshot, and symbol config
- client-side views derive order, fill, and market updates from that payload stream

## Local Runtime

PH1 runs with `docker-compose`:

- `web`
- `api`
- `db`

Optional local service:

- `pgadmin`

## Validation Targets

The PH1 implementation is acceptable only if all of the following are true:

1. a full order-to-close workflow can be executed from the Web UI
2. order state transitions are consistent
3. position and account state stay consistent
4. liquidation calculations are test-covered
5. replay reproduces the original result
