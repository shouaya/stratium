# AGENTS.md

## Purpose
- This repo is for a chain-extensible trading simulation platform focused on a usable trading core and a basic Web prototype in PH1.
- Agents are responsible for keeping the trading rules explicit, the core deterministic, and the PH1 scope controlled.

## Working Agreements
- Language and runtime: TypeScript + Node.js.
- Orchestration: `docker-compose` for local development in PH1.
- Frontend: Next.js.
- Backend API: Fastify.
- Database: PostgreSQL.
- Realtime: WebSocket.
- Testing: Vitest.
- Package manager: `pnpm`.
- Keep the trading core framework-agnostic. Domain logic must not depend on HTTP, React, or Prisma.
- Prefer event-driven design. Persist business events and derive query state from them when practical.
- Do not add chain-specific implementation in PH1. Keep extension points only.
- Do not introduce unnecessary infrastructure such as Kubernetes, Redis, or message brokers unless the repo already requires them.
- PowerShell: when using `Get-Content`, always include `-Encoding utf8`.

## Project Context
- Current repo stage: documentation and architecture definition; implementation will start from the PH1 docs.
- Planned structure:
  - `apps/web`: Next.js prototype UI
  - `apps/api`: Fastify API + WebSocket layer
  - `packages/trading-core`: deterministic simulation core
  - `packages/shared`: shared types, events, DTOs
  - `docs`: specs and architecture notes
- Key documents:
  - `chain-trading-platform-prd.md`
  - `docs/ph1-architecture.md`

## Data & Integrations
- Market data: real market feed adapter in PH1, but keep provider-specific details behind an interface.
- Database: PostgreSQL for events, orders, fills, positions, account state, and replay data.
- AI and chain integration are not part of PH1 implementation scope.
- Secrets must live in local `.env` files and never be committed. Add new env vars to `.env.example` when the repo contains one.

## Testing & Validation
- Core validation priorities:
  - order state transitions
  - fill rules
  - position and PnL calculations
  - margin and liquidation calculations
  - replay determinism
- Expected commands before PRs once the scaffold exists:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - `docker-compose config`

## Release / Deploy
- PH1 targets local development via `docker-compose`.
- Production deployment is out of scope until the trading core and Web prototype are stable.

## Contact / Ownership
- Product and rule clarifications should come from the repo owner before changing core trading formulas or liquidation behavior.
- If a document and implementation diverge, update the document in the same change when possible.
