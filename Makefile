PNPM ?= corepack pnpm
COMPOSE ?= docker-compose
COMPOSE_BATCH ?= $(COMPOSE) --env-file .env.batch -f docker-compose.batch.yml

.PHONY: help install dev lint test build check prisma-generate db-push seed-symbol-configs \
	up up-build down down-volumes restart logs logs-api logs-web logs-db logs-adminer \
	config batch-dev batch-build batch-start batch-import batch-compose-up batch-compose-down

help:
	@echo Stratium make targets
	@echo.
	@echo Setup
	@echo   make install              Install workspace dependencies
	@echo   make prisma-generate      Run Prisma client generation
	@echo   make db-push              Push Prisma schema to database
	@echo   make seed-symbol-configs  Seed default symbol configs
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
	@echo   make batch-dev            Run batch collector locally
	@echo   make batch-build          Build the batch app
	@echo   make batch-start          Start the built batch app
	@echo   make batch-import         Import batch data from S3
	@echo   make batch-compose-up     Start standalone batch compose stack
	@echo   make batch-compose-down   Stop standalone batch compose stack

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

db-push:
	$(PNPM) db:push

seed-symbol-configs:
	$(PNPM) seed:symbol-configs

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

batch-dev:
	$(PNPM) --filter @stratium/batch dev

batch-build:
	$(PNPM) batch:build

batch-start:
	$(PNPM) batch:start

batch-import:
	$(PNPM) --filter @stratium/batch import:s3

batch-compose-up:
	$(COMPOSE_BATCH) up --build -d

batch-compose-down:
	$(COMPOSE_BATCH) down
