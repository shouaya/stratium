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
  batch/             Hyperliquid websocket collector + S3 uploader
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
- `make` if you want a single command entrypoint

If you want to run checks outside containers:

- Node.js 22
- `pnpm` 10

## Make Targets

The repo now includes a root `Makefile` so common commands can be run with `make`.

Examples:

```powershell
make help
make install
make dev
make up-build
make check
make batch-compose-up
```

The `Makefile` wraps the existing `pnpm` and `docker-compose` commands. You can still run the original commands directly if you prefer.

## Environment

Copy `.env.example` to `.env` if you need custom values. The default `docker-compose` setup works without changes.

Important defaults:

- PostgreSQL database: `stratium`
- PostgreSQL user: `postgres`
- PostgreSQL password: `postgres`
- API port: `4000`
- Web port: `3000`
- Adminer port: `8080`
- Batch spool dir: `logs/hyperliquid-batch`

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

## Hyperliquid Batch

The repo now includes a long-running batch collector in `apps/batch`.

What it does:

- keeps a persistent websocket connection to Hyperliquid
- subscribes to `l2Book`, `trades`, `candle`, and `activeAssetCtx`
- writes normalized raw events into rolling `.ndjson` files
- compresses closed files as `.gz`
- uploads them to `s3://<BATCH_S3_BUCKET>/<BATCH_S3_PREFIX>/...`
- sends an SQS message after each successful upload
- sends an email-task SQS message when S3 or SQS delivery fails

Required env vars for the batch:

- `BATCH_S3_BUCKET`
- `BATCH_S3_PREFIX`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `BATCH_SQS_QUEUE_URL`
- `BATCH_ALERT_SQS_QUEUE_URL`
- `BATCH_ALERT_EMAIL_TO`

Failure alerts are not sent directly by the batch. Instead, the batch pushes an email task into a dedicated SQS queue with this shape:

```json
{
  "to": "alert@example.com",
  "subject": "[stratium-batch] delivery failed for ...",
  "html": "<p>...</p>"
}
```

That means:

- the configured AWS credentials must have `sqs:SendMessage`
- `BATCH_SQS_QUEUE_URL` is for successful upload events
- `BATCH_ALERT_SQS_QUEUE_URL` is for email-task messages consumed by your mail worker

Useful optional env vars:

- `HYPERLIQUID_COINS=BTC,ETH`
- `HYPERLIQUID_CANDLE_INTERVAL=1m`
- `BATCH_FILE_ROLL_MINUTES=5`
- `BATCH_UPLOAD_INTERVAL_SECONDS=60`
- `BATCH_SPOOL_DIR=logs/hyperliquid-batch`

Run it directly:

```powershell
pnpm --filter @stratium/batch dev
```

Import batch data back from S3 into PostgreSQL:

```powershell
pnpm --filter @stratium/batch import:s3
```

Run the import as a one-off Docker command without starting the long-running websocket collector:

```powershell
docker-compose --env-file .env -f docker-compose.batch.yml run --rm batch pnpm import:s3
```

The import command requires `DATABASE_URL` in the env file because it writes directly into PostgreSQL.

Import behavior:

- reads `.ndjson.gz` files from `s3://<BATCH_S3_BUCKET>/<BATCH_S3_PREFIX>/...`
- writes into the existing market tables in PostgreSQL
- if some minutes are missing in S3, the importer leaves those minutes empty in the database
- by default it imports everything under `BATCH_S3_PREFIX`
- you can optionally narrow the import with command-line args `--year`, `--month`, and `--day`

Examples:

```powershell
pnpm --filter @stratium/batch import:s3 -- --year 2026
```

```powershell
docker-compose --env-file .env -f docker-compose.batch.yml run --rm batch pnpm import:s3 -- --year 2026
```

```powershell
pnpm --filter @stratium/batch import:s3 -- --year 2026 --month 3
```

```powershell
docker-compose --env-file .env -f docker-compose.batch.yml run --rm batch pnpm import:s3 -- --year 2026 --month 3
```

```powershell
pnpm --filter @stratium/batch import:s3 -- --year 2026 --month 3 --day 27
```

```powershell
docker-compose --env-file .env -f docker-compose.batch.yml run --rm batch pnpm import:s3 -- --year 2026 --month 3 --day 27
```

Build and run in production:

```powershell
pnpm batch:build
pnpm batch:start
```

Run it in an isolated Docker environment:

```powershell
docker-compose --env-file .env.batch -f docker-compose.batch.yml up --build -d
```

Stop the isolated batch container:

```powershell
docker-compose --env-file .env.batch -f docker-compose.batch.yml down
```

Example with PM2 on an EC2 host that already has Node.js and `pnpm`:

```powershell
pnpm batch:build
pm2 start pnpm --name stratium-hyperliquid-batch -- batch:start
pm2 save
```

The standalone Docker runtime uses [docker-compose.batch.yml](/d:/git/stratium/docker-compose.batch.yml) and [apps/batch/Dockerfile](/d:/git/stratium/apps/batch/Dockerfile). It only starts the batch collector and persists local spool files in a dedicated Docker volume. Use a dedicated env file such as `.env.batch` on the target server.

For Docker deployment on EC2, put `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env.batch` so the container can authenticate to S3 and SQS. If you are using temporary credentials, also set `AWS_SESSION_TOKEN`.

The standalone batch container joins an external Docker network, defaulting to `stratium_default`, so it can reach the main stack services such as PostgreSQL by hostname. Override this with `BATCH_DOCKER_NETWORK` if your main compose project uses a different network name.

For EC2 auto-start behavior:

- the batch container uses `restart: always`
- the standalone batch container keeps only a small rotated Docker log with `json-file`, `max-size: 5m`, and `max-file: 2`
- Docker itself must be enabled on boot on the EC2 host, for example `sudo systemctl enable docker`
- after the first `docker-compose --env-file .env.batch -f docker-compose.batch.yml up -d`, the container will come back automatically after instance reboot as long as the Docker service starts

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
