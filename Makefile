PNPM ?= corepack pnpm
COMPOSE_FLAVOR ?= $(shell if docker compose version >/dev/null 2>&1; then printf plugin; elif docker-compose version >/dev/null 2>&1; then printf legacy; else printf plugin; fi)
COMPOSE ?= $(if $(filter legacy,$(COMPOSE_FLAVOR)),docker-compose,docker compose)
COMPOSE_RUN ?= $(COMPOSE)
COMPOSE_BATCH ?= $(COMPOSE_RUN) --env-file .env -f docker-compose.batch.yml
WORKSPACE_RUN ?= $(COMPOSE_RUN) run --rm --no-deps --workdir /workspace job-runner
JOB_RUNNER_CONTAINER ?= stratium-job-runner
JOB_RUNNER_BASE_URL ?= http://127.0.0.1:4300
JOB_RUNNER_TOKEN ?= stratium-local-runner
JOB_RUNNER_CLIENT ?= docker exec -e JOB_RUNNER_BASE_URL=$(JOB_RUNNER_BASE_URL) -e JOB_RUNNER_TOKEN=$(JOB_RUNNER_TOKEN) $(JOB_RUNNER_CONTAINER) node /workspace/scripts/job-runner-request.mjs

.PHONY: help init bootstrap-services wait-job-runner install dev lint test build check db-push db-seed db-bootstrap seed-symbol-configs \
	up down logs config batch-import-hl-day batch-refresh-hl-day batch-clear-kline

COIN ?= BTC
DATE ?=
INTERVAL ?= 1m

help:
	@echo Stratium make targets
	@echo
	@echo Setup
	@echo   make init                 First-time setup: create .env, prepare container dependencies, start db/job-runner, and import base data
	@echo   make bootstrap-services   Start only db, redis, and job-runner for first-time initialization
	@echo   make wait-job-runner      Wait until the job runner is ready to accept requests
	@echo   make install              Build workspace images and prepare container-side dependencies
	@echo   make db-push              Push Prisma schema via the job runner
	@echo   make db-seed              Seed default app accounts and platform settings via the job runner
	@echo   make db-bootstrap         Run db push, db seed, and symbol config seed via the job runner
	@echo   make seed-symbol-configs  Seed default symbol configs via the job runner
	@echo
	@echo Local development
	@echo   make dev                  Run api + web in local dev mode
	@echo   make lint                 Run TypeScript lint checks across workspace
	@echo   make test                 Run workspace tests
	@echo   make build                Build all workspace packages/apps
	@echo   make check                Run lint, test, build, and compose config
	@echo
	@echo Docker compose
	@echo   detected compose flavor: $(COMPOSE_FLAVOR)
	@echo   using compose command: $(COMPOSE)
	@echo   make up                   Start main stack
	@echo   make down                 Stop main stack
	@echo   make config               Validate docker-compose.yml
	@echo   make logs                 Tail all compose logs
	@echo
	@echo Batch
	@echo   make batch-import-hl-day  Download and import one Hyperliquid day via the job runner
	@echo "  make batch-refresh-hl-day Reload one coin's Hyperliquid 1m candles via the job runner"
	@echo   make batch-clear-kline    Clear persisted K-line history via the job runner

init:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	$(MAKE) install
	$(MAKE) bootstrap-services
	$(MAKE) wait-job-runner
	$(MAKE) db-bootstrap
	$(MAKE) batch-refresh-hl-day

bootstrap-services:
	$(COMPOSE_RUN) up -d db redis job-runner

wait-job-runner:
	@until docker exec $(JOB_RUNNER_CONTAINER) node -e "fetch('http://127.0.0.1:4300/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; do \
		echo "Waiting for job-runner..."; \
		sleep 2; \
	done

install:
	$(COMPOSE_RUN) build job-runner api web
	$(COMPOSE_BATCH) build batch

dev:
	$(COMPOSE_RUN) up db redis job-runner api web adminer

lint:
	$(WORKSPACE_RUN) pnpm lint

test:
	$(WORKSPACE_RUN) pnpm test

build:
	$(WORKSPACE_RUN) pnpm build

check: lint test build config

db-push:
	$(JOB_RUNNER_CLIENT) db-push

db-seed:
	$(JOB_RUNNER_CLIENT) db-seed

db-bootstrap: db-push db-seed seed-symbol-configs

seed-symbol-configs:
	$(JOB_RUNNER_CLIENT) seed-symbol-configs

up:
	$(COMPOSE_RUN) up

down:
	$(COMPOSE_RUN) down

logs:
	$(COMPOSE_RUN) logs -f

config:
	$(COMPOSE_RUN) config

batch-import-hl-day:
	$(JOB_RUNNER_CLIENT) batch-import-hl-day coin=$(COIN) $(if $(DATE),date=$(DATE),)

batch-refresh-hl-day:
	$(JOB_RUNNER_CLIENT) batch-refresh-hl-day coin=$(COIN) $(if $(DATE),date=$(DATE),)

batch-clear-kline:
	$(JOB_RUNNER_CLIENT) batch-clear-kline coin=$(COIN) interval=$(INTERVAL)
