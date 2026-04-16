# Stratium Priority TODO List

Date: 2026-04-16

## Execution Status

Completed on 2026-04-16:

1. P0 liquidation workflow end-to-end.
2. P0 liquidation persistence, replay coverage, and related architecture/data/event docs alignment.
3. P1 session expiration for auth tokens.
4. P1 critical persistence transactions.
5. P1 CORS allowlist and sensitive-route rate limiting.
6. P1 environment-based default password configuration.
7. P2 richer `GET /health` output.
8. P2 structured WebSocket send-failure logging.
9. P2 request-bound validation for market history and market volume endpoints.
10. P2 bounded runtime event-store pruning with active-order context retention.
11. P3 first repository split: extracted `AuthRepository` and narrowed `AuthRuntime` dependency boundaries.
12. P3 second repository split: extracted `TriggerOrderRepository` from the main trading repository.
13. P3 third repository split: extracted `MarketDataRepository` from the main trading repository.
14. P3 fourth repository split: extracted `SymbolConfigRepository` from the main trading repository.
15. P3 fifth repository split: extracted `TradingPersistenceRepository` from the main trading repository.
16. P3 source-tree restructuring for `apps/api` and `apps/trader-mcp`, with compatibility entrypoints to preserve existing imports and tests during the transition.
17. P3 partial `ApiRuntime` composition refactoring: extracted bootstrap orchestration and active-symbol switch guard flows into dedicated runtime helpers.
18. P3 additional `ApiRuntime` composition refactoring: extracted state/replay/socket payload assembly and broadcast event filtering into dedicated runtime helpers.

Still pending:

1. P3 deeper `ApiRuntime` / runtime composition refactoring remains, especially auth/user lifecycle orchestration and final wrapper-thinning across runtime helpers.
2. P4 frontend maintainability work.
3. P5 broader engineering-quality follow-up.

## Purpose

This TODO list combines the most important items from:

- `IMPROVEMENT_PLAN.md`
- `IMPROVEMENTS-2026-04-16.md`

It intentionally keeps only the highest-value work. The goal is to focus on changes that most improve correctness, safety, maintainability, and long-term development speed.

## P0 Core Closure

These items should be treated as the most important product and architecture work.

1. Complete the liquidation workflow end-to-end.
   - define liquidation trigger conditions
   - emit liquidation domain events
   - persist liquidation transitions
   - support replay through the same event path

2. Freeze and document the actual current scope of the project.
   - separate core simulation scope from platform extension scope
   - align current docs with implemented behavior

3. Add end-to-end test coverage for liquidation and replay.
   - stressed market scenarios
   - terminal state transitions
   - persistence and replay consistency

## P1 Security And Consistency

These items reduce immediate operational and correctness risk.

1. Add expiration to login sessions.
   - either add TTL to the current in-memory session store
   - or replace the current scheme with expiring tokens

2. Audit cross-table write paths and add transactions where needed.
   - especially event persistence + snapshot/update flows
   - especially account/order/fill state transitions

3. Restrict CORS configuration.
   - stop allowing arbitrary origins by default
   - move allowed origins to explicit configuration

4. Add rate limiting to sensitive API routes.
   - login
   - order submission
   - exchange/trading proxy endpoints

5. Remove hardcoded default passwords from the main runtime path.
   - replace with explicit bootstrapping or environment-based initialization

## P2 Runtime Stability

These items improve long-running reliability and production readiness.

1. Add structured logging for WebSocket send failures and connection lifecycle.

2. Control in-memory event growth.
   - implement snapshot + pruning strategy for `eventStore`
   - keep replay correctness while limiting memory growth

3. Strengthen request and manual tick validation.
   - route query bounds
   - symbol/interval validation
   - stricter manual tick sanity checks

4. Add minimum observability support.
   - `GET /health`
   - key runtime and adapter status logging
   - broadcast failure visibility

## P3 Architecture Refactoring

These items reduce structural complexity and future change cost.

1. Split `TradingRepository` into smaller domain-oriented modules.
   - auth
   - platform settings
   - trading events/state
   - market data
   - trigger orders

2. Thin `ApiRuntime` so it becomes a composition layer instead of a large workflow container.

3. Update architecture documentation to match the real service layout and feature set.

## P4 Frontend Maintainability

These items make the trading dashboard easier to evolve safely.

1. Introduce an explicit dashboard VM type.

2. Remove `vm: any` from trading dashboard components.

3. Split the large dashboard hook into smaller concern-based hooks.
   - market
   - order entry
   - account history
   - trigger orders

## P5 Engineering Quality

These items improve signal quality and confidence during future iteration.

1. Add tests for `packages/shared`.

2. Add tests for `apps/batch`.

3. Add ESLint in addition to the current TypeScript-only lint flow.

4. Continue reducing unsafe casts and `any` usage across web and MCP layers.

## Suggested Execution Order

1. Finish liquidation design and implementation.
2. Lock project scope and update docs.
3. Fix session expiration, CORS, and rate limiting.
4. Add transactions to critical persistence paths.
5. Control event store growth and improve observability.
6. Refactor API structure.
7. Refactor dashboard typing and hook boundaries.
8. Tighten overall engineering standards.

## Notes

- This list is intentionally shorter than the source documents.
- It favors foundational work over optional feature expansion.
- Optional feature additions should generally wait until P0 to P2 are materially improved.
