PNPM ?= corepack pnpm
COMPOSE ?= docker-compose
COMPOSE_BATCH ?= $(COMPOSE) --env-file .env -f docker-compose.batch.yml
DOCKER_BATCH_RUN ?= $(COMPOSE_BATCH) run --rm batch
DOCKER_BATCH_ROOT_RUN ?= $(COMPOSE_BATCH) run --rm --workdir /workspace batch
MIGRATION_NAME ?= schema-update

.PHONY: help install dev lint test build check prisma-generate db-push db-migrate db-seed db-bootstrap seed-symbol-configs \
	up up-build down down-volumes restart logs logs-api logs-web logs-db logs-adminer \
	config batch-build batch-run-collector batch-import batch-import-hl-day batch-refresh-hl-day batch-clear-kline

COIN ?= BTC
DATE ?=

help:
	@echo Stratium make targets
	@echo.
	@echo Setup
	@echo   make install              Install workspace dependencies
	@echo   make prisma-generate      Run Prisma client generation
	@echo   make db-migrate           Run Prisma migrate dev inside the batch container, pass MIGRATION_NAME="..."
	@echo   make db-push              Push Prisma schema inside the batch container
	@echo   make db-seed              Seed default app accounts and platform settings inside the batch container
	@echo   make db-bootstrap         Run db push, db seed, and symbol config seed inside the batch container
	@echo   make seed-symbol-configs  Seed default symbol configs inside the batch container
	@echo.
	@echo Local development
	@echo   make dev                  Run api + web in local dev mode
	@echo   make lint                 Run TypeScript lint checks across workspace
	@echo   make test                 Run workspace tests
	@echo   make build                Build all workspace packages/apps
	@echo   make check                Run lint, test, build, and compose config
	@echo.
	@echo Docker compose
	@echo   make up                   Start main stack
	@echo   make up-build             Rebuild and start main stack
	@echo   make down                 Stop main stack
	@echo   make down-volumes         Stop main stack and remove volumes
	@echo   make restart              Restart api and web containers
	@echo   make config               Validate docker-compose.yml
	@echo   make logs                 Tail all compose logs
	@echo   make logs-api             Tail api logs
	@echo   make logs-web             Tail web logs
	@echo   make logs-db              Tail db logs
	@echo   make logs-adminer         Tail adminer logs
	@echo.
	@echo Batch
	@echo   make batch-build          Build the batch job image
	@echo   make batch-run-collector  Run the collector as an explicit Docker job
	@echo   make batch-import         Import batch data from S3
	@echo   make batch-import-hl-day  Download and import today's Hyperliquid 1m candles, pass ARGS="..."
	@echo   make batch-refresh-hl-day Reload one coin's Hyperliquid 1m candles into DB and restart api
	@echo   make batch-clear-kline    Clear persisted K-line history, pass ARGS="..."

install:
	$(PNPM) install

dev:
	$(PNPM) dev

lint:
	$(PNPM) lint

test:
	$(PNPM) test

build:
	$(PNPM) build

check: lint test build config

prisma-generate:
	$(PNPM) prisma:generate

db-migrate:
	$(DOCKER_BATCH_ROOT_RUN) sh -lc "pnpm exec prisma migrate dev --name $(MIGRATION_NAME)"

db-push:
	$(DOCKER_BATCH_ROOT_RUN) sh -lc "pnpm exec prisma db push"

db-seed:
	$(DOCKER_BATCH_ROOT_RUN) sh -lc "pnpm exec prisma db seed"

db-bootstrap: db-push db-seed seed-symbol-configs

seed-symbol-configs:
	$(DOCKER_BATCH_ROOT_RUN) sh -lc "node prisma/seed-symbol-configs.mjs"

up:
	$(COMPOSE) up

up-build:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down

down-volumes:
	$(COMPOSE) down -v

restart:
	$(COMPOSE) restart api web

logs:
	$(COMPOSE) logs -f

logs-api:
	$(COMPOSE) logs -f api

logs-web:
	$(COMPOSE) logs -f web

logs-db:
	$(COMPOSE) logs -f db

logs-adminer:
	$(COMPOSE) logs -f adminer

config:
	$(COMPOSE) config

batch-build:
	$(COMPOSE_BATCH) build batch

batch-import:
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/jobs/import-from-s3.js $(ARGS)

batch-import-hl-day:
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/jobs/import-hyperliquid-day.js $(ARGS)

batch-refresh-hl-day:
	$(COMPOSE) stop api
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/jobs/clear-market-history.js --coin $(COIN) --interval 1m --source hyperliquid
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/jobs/import-hyperliquid-day.js --coin $(COIN) $(if $(DATE),--date $(DATE),)
	$(COMPOSE) up -d api

batch-clear-kline:
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/jobs/clear-market-history.js $(ARGS)

batch-run-collector:
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/collector/run-collector.js
