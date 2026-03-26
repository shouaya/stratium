# Stratium

![Stratium UI](docs/stratium.png)

Stratium is a PH1 trading simulation platform built around a deterministic trading core and a basic Web prototype.

Current PH1 focus:

- single symbol
- single account
- market orders
- limit orders
- cancel order
- event persistence
- replay
- basic Web operation panel

## Tech Stack

- TypeScript
- Node.js
- Next.js
- Fastify
- PostgreSQL
- Prisma
- WebSocket
- Vitest
- `docker-compose`

## Repo Layout

```text
apps/
  api/               Fastify API + WebSocket
  web/               Next.js UI
packages/
  shared/            shared types and event models
  trading-core/      deterministic simulation core
docs/
  ph1-architecture.md
  event-spec.md
  order-rules.md
  margin-rules.md
  data-model-reference.md
prisma/
  schema.prisma
docker-compose.yml
```

## Prerequisites

- Docker
- Docker Compose

If you want to run checks outside containers:

- Node.js 22
- `pnpm` 10

## Environment

Copy `.env.example` to `.env` if you need custom values. The default `docker-compose` setup works without changes.

Important defaults:

- PostgreSQL database: `stratium`
- PostgreSQL user: `postgres`
- PostgreSQL password: `postgres`
- API port: `4000`
- Web port: `3000`
- Adminer port: `8080`

## Start

```powershell
docker-compose down -v
docker-compose up --build
```

The first `--build` installs dependencies into the images. After that, plain restarts do not reinstall packages:

```powershell
docker-compose restart api web
```

## Stop

```powershell
docker-compose down
```

If you want to remove named volumes as well:

```powershell
docker-compose down -v
```

## URLs

- Web UI: `http://localhost:3000`
- API: `http://localhost:4000`
- API health: `http://localhost:4000/health`
- API state: `http://localhost:4000/api/state`
- API replay: `http://localhost:4000/api/replay/session-1`
- Adminer: `http://localhost:8080`

## Adminer Login

Use these values inside Adminer:

- System: `PostgreSQL`
- Server: `db`
- Username: `postgres`
- Password: `postgres`
- Database: `stratium`

If you are connecting from outside the Docker network, try `localhost` instead of `db`.

## What PH1 Currently Does

- accepts market ticks
- accepts market and limit orders
- supports canceling active orders
- updates order, position, and account state
- persists events and snapshots in PostgreSQL
- rebuilds state from persisted events
- exposes state and replay through the API
- shows state, event tape, order entry, and tick entry in the Web UI

## Main API Endpoints

- `GET /health`
- `GET /api/state`
- `GET /api/market-volume`
- `GET /api/account`
- `GET /api/orders`
- `GET /api/positions`
- `GET /api/events`
- `GET /api/replay/session-1`
- `POST /api/market-ticks`
- `POST /api/orders`
- `POST /api/orders/cancel`
- `POST /api/orders/:id/cancel`
- `GET /ws`

## Validation Commands

Run these from the repo root:

```powershell
corepack pnpm install
corepack pnpm -r lint
corepack pnpm --filter @stratium/trading-core test
corepack pnpm -r build
docker-compose config
```

Seed Hyperliquid-aligned symbol configs:

```powershell
pnpm seed:symbol-configs
```

Default behavior:

- seeds `BTC` only
- override with `SYMBOL_CONFIG_WHITELIST`, for example:

```powershell
$env:SYMBOL_CONFIG_WHITELIST="BTC,ETH,HYPE"
pnpm seed:symbol-configs
```

## Logs

Container logs:

```powershell
docker-compose logs -f api
docker-compose logs -f web
docker-compose logs -f db
docker-compose logs -f adminer
```

The compose file uses `json-file` logging with rotation.

## Docker Notes

- `apps/api/Dockerfile` and `apps/web/Dockerfile` install `pnpm` dependencies during image build
- `docker-compose restart` only restarts containers; it does not rerun `pnpm install`
- Rebuild images after dependency changes:

```powershell
docker-compose build api web
docker-compose up -d api web
```

Local ad hoc logs, if you create them manually, should go under `logs/`.

## Known PH1 Limits

- one account only
- one symbol only
- no cross margin
- no hedge mode
- no advanced order types
- no chain integration
- no AI analysis
- liquidation logic is not finished yet
- execution model is intentionally simple

## Key Docs

- [chain-trading-platform-prd.md](/d:/git/stratium/chain-trading-platform-prd.md)
- [docs/ph1-architecture.md](/d:/git/stratium/docs/ph1-architecture.md)
- [docs/event-spec.md](/d:/git/stratium/docs/event-spec.md)
- [docs/order-rules.md](/d:/git/stratium/docs/order-rules.md)
- [docs/margin-rules.md](/d:/git/stratium/docs/margin-rules.md)
- [docs/data-model-reference.md](/d:/git/stratium/docs/data-model-reference.md)
