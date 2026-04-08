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
make batch-build
make batch-run-collector
make batch-clear-kline ARGS="--coin BTC --interval 1m"
make batch-import-hl-day ARGS="--coin BTC --date 2026-04-08"
make batch-refresh-hl-day COIN=BTC DATE=2026-04-08
```

Batch is docker-job only:

- it is not part of the main `api/web/db` compose stack
- it does not auto-start
- run every batch task through `make` or `docker compose -f docker-compose.batch.yml run --rm ...`

## Main Docs

- [PH1 Architecture](docs/ph1-architecture.md)
- [Data Flow](docs/data-flow.md)
- [Event Spec](docs/event-spec.md)
- [Order Rules](docs/order-rules.md)
- [Margin Rules](docs/margin-rules.md)
