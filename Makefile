PNPM ?= corepack pnpm
COMPOSE ?= docker-compose
COMPOSE_BATCH ?= $(COMPOSE) --env-file .env -f docker-compose.batch.yml
DOCKER_BATCH_RUN ?= $(COMPOSE_BATCH) run --rm batch
DOCKER_BATCH_ROOT_RUN ?= $(COMPOSE_BATCH) run --rm --workdir /workspace batch
JOB_RUNNER_CLIENT ?= node scripts/job-runner-request.mjs
MIGRATION_NAME ?= schema-update

.PHONY: help install dev lint test build check prisma-generate db-push db-migrate db-seed db-bootstrap seed-symbol-configs job-runner-start job-runner-build \
	up up-build down down-volumes restart logs logs-api logs-web logs-db logs-adminer \
	config batch-build batch-run-collector batch-import batch-import-hl-day batch-refresh-hl-day batch-clear-kline

COIN ?= BTC
DATE ?=
INTERVAL ?= 1m

help:
	@echo Stratium make targets
	@echo.
	@echo Setup
	@echo   make install              Install workspace dependencies
	@echo   make job-runner-start     Start the host-side job runner service
	@echo   make job-runner-build     Build the host-side job runner app
	@echo   make prisma-generate      Run Prisma client generation
	@echo   make db-migrate           Run Prisma migrate dev via the job runner, pass MIGRATION_NAME="..."
	@echo   make db-push              Push Prisma schema via the job runner
	@echo   make db-seed              Seed default app accounts and platform settings via the job runner
	@echo   make db-bootstrap         Run db push, db seed, and symbol config seed via the job runner
	@echo   make seed-symbol-configs  Seed default symbol configs via the job runner
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
	@echo   make batch-import-hl-day  Download and import one Hyperliquid day via the job runner
	@echo   make batch-refresh-hl-day Reload one coin's Hyperliquid 1m candles via the job runner
	@echo   make batch-clear-kline    Clear persisted K-line history via the job runner

install:
	$(PNPM) install

job-runner-start:
	$(PNPM) job-runner:dev

job-runner-build:
	$(PNPM) --filter @stratium/job-runner build

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
	$(JOB_RUNNER_CLIENT) db-migrate migrationName=$(MIGRATION_NAME)

db-push:
	$(JOB_RUNNER_CLIENT) db-push

db-seed:
	$(JOB_RUNNER_CLIENT) db-seed

db-bootstrap: db-push db-seed seed-symbol-configs

seed-symbol-configs:
	$(JOB_RUNNER_CLIENT) seed-symbol-configs

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
	@echo batch-import is not yet exposed through the job runner.
	@exit 1

batch-import-hl-day:
	$(JOB_RUNNER_CLIENT) batch-import-hl-day coin=$(COIN) $(if $(DATE),date=$(DATE),)

batch-refresh-hl-day:
	$(JOB_RUNNER_CLIENT) batch-refresh-hl-day coin=$(COIN) $(if $(DATE),date=$(DATE),)

batch-clear-kline:
	$(JOB_RUNNER_CLIENT) batch-clear-kline coin=$(COIN) interval=$(INTERVAL)

batch-run-collector:
	$(DOCKER_BATCH_RUN) node --experimental-specifier-resolution=node dist/collector/run-collector.js
