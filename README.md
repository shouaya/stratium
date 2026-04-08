# Stratium

![Stratium UI](docs/stratium.png)

Stratium is a PH1 trading simulation platform focused on a deterministic trading core, a Fastify API, and a basic Web trading UI.

## What It Does

- simulates a single-account, single-symbol trading session
- accepts manual ticks, market orders, limit orders, and cancel requests
- updates orders, position, account, margin, and replayable event history
- exposes state through REST and WebSocket
- supports simulator market data and Hyperliquid-backed market data
- stores trading state and market snapshots in PostgreSQL

## Architecture

```text
                    +----------------------+
                    |   Hyperliquid /      |
                    |   Simulator Feed     |
                    +----------+-----------+
                               |
                               v
                    +----------+-----------+
                    |   apps/api           |
                    | runtime coordinator  |
                    | trading-runtime      |
                    | market-runtime       |
                    | websocket-hub        |
                    +----+------------+----+
                         |            |
             REST / WS   |            | persist / load
                         v            v
                  +------+----+   +---+----------------+
                  | apps/web  |   | PostgreSQL         |
                  | Next.js UI|   | events + snapshots |
                  +-----------+   +---+----------------+
                                       ^
                                       |
                            +----------+-----------+
                            | packages/trading-core|
                            | deterministic engine |
                            +----------------------+
```

## Key Make Commands

```bash
make help
make install
make dev
make up
make up-build
make down
make logs
make check
```

### Batch / Market Data

```bash
make batch-compose-up
make batch-clear-kline ARGS="--coin BTC --interval 1m"
make batch-import-hl-day ARGS="--coin BTC --date 2026-04-08"
make batch-refresh-hl-day COIN=BTC DATE=2026-04-08
```

## Main Docs

- [PH1 Architecture](/d:/git/stratium/docs/ph1-architecture.md)
- [Data Flow](/d:/git/stratium/docs/data-flow.md)
- [Event Spec](/d:/git/stratium/docs/event-spec.md)
- [Order Rules](/d:/git/stratium/docs/order-rules.md)
- [Margin Rules](/d:/git/stratium/docs/margin-rules.md)
