# AI Self-Learning Trader Feasibility

Last updated: 2026-05-19

## Goal

This document evaluates the feasibility and priority order for adding an AI self-learning trader to Stratium.

The proposed reference architecture is the existing Witchworks bot runner:

- `/Users/shoushoushou/git/witch.weget.jp/bot-runner`

The target for Stratium should not be an unrestricted trading agent. The first useful target is:

> A controlled simulation trader that observes market and account state, proposes structured trading plans, passes every actionable step through deterministic risk gates, executes only approved actions in the simulated trading system, and improves future decisions through reward scoring and memory.

## Feasibility Conclusion

The feature is feasible, but only if it is built in phases.

The current Stratium architecture already has several pieces that make this a good fit:

1. a deterministic trading core
2. explicit order, fill, position, margin, and replay concepts
3. an existing API boundary
4. an existing Trader MCP execution layer
5. event persistence and replay direction already aligned with auditability

The main missing piece is not "AI". The main missing piece is a safe autonomous trading control plane:

1. bot profile and runtime state
2. structured planning schema
3. deterministic risk gate
4. execution audit trail
5. reward and reflection memory
6. backtest or shadow-mode evaluation
7. admin controls and kill switch

The recommended implementation should reuse the Witchworks wake-cycle pattern, but it must not reuse the game bot's direct execution model without a trading-specific safety layer.

## Scope Recommendation

### Execution Placement Decision

Stratium is a closed-loop AI trading simulation system.

Stratium must be able to complete the full AI trader lifecycle without `ai.weget.jp`:

- wake scheduling
- market and account context gathering
- AI planning
- simulated order execution
- risk gating
- reward scoring
- memory and reflection
- admin dashboard review
- strategy promotion
- package export

`ai.weget.jp` is an optional downstream live execution environment.

Stratium should not depend on `ai.weget.jp` for any native AI trader function. If live trading is enabled later, `ai.weget.jp` can import a promoted Stratium strategy package and run it with live broker skills.

Recommended split:

```text
Stratium native runtime
  owns simulation trading, wake scheduling, risk gates, audit logs, reward scoring,
  admin dashboard, simulated paper execution, strategy promotion, and package export

ai.weget.jp optional live runtime
  imports promoted Stratium strategy packages, runs Codex/bot-host tasks,
  uses live broker skills, applies a local execution guard,
  and reports live results back to Stratium
```

The first implementation should therefore prove native Stratium simulation first, then add export:

```text
shadow mode inside Stratium
  -> admin approval inside Stratium
  -> simulated paper execution inside Stratium
  -> strategy promotion inside Stratium
  -> strategy package export
  -> optional ai.weget.jp import
  -> optional ai.weget.jp shadow/live execution
```

### In Scope For First Version

- simulation-only AI trader
- single account
- single symbol at first
- low-frequency wake cycle
- read-only planning mode first
- shadow-mode scoring before execution
- deterministic risk gate before every order action
- structured JSON plans
- memory-based self-learning
- reward scoring based on simulated trading outcomes
- full decision audit logs
- native Stratium simulated execution path
- strategy package export
- executable npm runner package export
- admin enable, disable, and kill switch

### Out Of Scope For First Version

- real-money execution
- model weight training
- reinforcement learning infrastructure
- multi-symbol autonomous portfolio allocation
- high-frequency trading
- external strategy marketplace
- chain settlement or on-chain execution
- unrestricted MCP tool access for the model
- autonomous changes to risk limits
- requiring `ai.weget.jp` to run the first Stratium AI trader
- live broker execution inside Stratium
- depending on `ai.weget.jp` for Stratium's closed loop


## Why The Witchworks Bot Runner Fits

The Witchworks bot runner has the right high-level shape:

```text
load profile
fetch world state
fetch tools
fetch memories
build planner context
ask planner for JSON plan
select candidate
execute plan
score reward
write reflection memories
finish wake log
```

For Stratium, the equivalent shape should be:

```text
load trader profile
fetch market/account/order/position state
fetch risk policy
fetch trading memories
build planner context
ask planner for JSON plan candidates
score candidates
run deterministic risk gate
execute approved actions only
attribute outcome
score reward
write reflection memories
finish wake log
```

The most important architectural difference is the insertion of the risk gate between planning and execution.

## Reusable Parts From Witchworks

The following concepts can be reused with moderate changes:

- `config`
  read CLI and environment configuration
- `runtime/loop`
  run one trader account on an interval
- `runtime/wakeCycle`
  orchestrate one full planning and execution pass
- `planner/promptBuilder`
  assemble state, rules, memory, and output schema into a prompt
- `planner/planParser`
  parse strict JSON output from the model
- `planner/codexPlanner`
  use Codex CLI as a planner implementation
- `candidateSelector`
  choose among multiple model-proposed candidates
- `reward`
  compute deterministic score after a wake
- `reflection`
  write compact memory for the next wake
- `metrics`
  record context, planning, execution, reward, and reflection timings

## Parts That Must Be Reworked

### Plan Executor

The game bot executes player actions directly. A trading bot must not execute model actions directly.

Required execution path:

```text
model plan
  -> schema validation
  -> candidate scoring
  -> risk gate
  -> approved action list
  -> Trader MCP or API executor
  -> execution result log
```

### Reward Model

The game reward model is based on game state progress. Trading reward must be risk-adjusted.

Suggested reward inputs:

- realized PnL
- unrealized PnL change
- fees
- slippage
- max adverse excursion
- max favorable excursion
- drawdown
- liquidation risk
- order rejection count
- risk gate rejection count
- overtrading penalty
- stop-loss discipline
- whether the final action matched the stated thesis

### Memory

Game memories are social and world-state memories. Trading memories should be structured around:

- market regime observations
- setup quality
- plan thesis
- invalidation reason
- execution quality
- risk mistakes
- profitable patterns
- losing patterns
- next priority

### Prompt Context

The trading prompt must include:

- account equity and available margin
- current positions
- open orders
- recent fills
- current bid, ask, mid, spread
- recent candles
- recent volatility
- current risk limits
- recent bot memories
- explicit action schema
- explicit forbidden actions
- current operating mode: observe, shadow, paper-execute, reduce-only, or disabled

## Priority Plan

## P0: Safety And Correctness Before Autonomy

Do this before implementing a trader that can place orders.

### P0.1 API Runtime Validation

Orders and bot-facing API payloads need runtime schema validation before they enter trading-core.

Reason:

- AI-generated payloads will eventually explore invalid edges.
- TypeScript types alone do not protect runtime JSON.
- Invalid enum values, missing fields, or malformed trigger payloads must be rejected before core logic.

### P0.2 Persistence Failure Semantics

The trading runtime should not report success if event persistence fails.

Reason:

- An AI trader depends on replayable audit history.
- If memory or execution logs say an order happened but database state missed it, reward and reflection become untrustworthy.

### P0.3 Order Margin And Idempotency

Pending order margin and client order id idempotency need to be closed before autonomous execution.

Reason:

- A bot may submit repeated or overlapping plans.
- Duplicate client ids should not accidentally create multiple active orders.
- Available margin must account for pending orders if the bot can stage multiple orders.

### P0.4 Trader MCP Risk Boundaries

The current Trader MCP is execution-first. It needs hard limits before it is safe as an AI execution surface.

Minimum risk controls:

- allowed symbols
- max order size
- max order notional
- max position size
- max leverage
- max open orders
- max daily loss
- max drawdown
- cooldown between opening trades
- mandatory reduce-only mode switch
- mandatory stop-loss or invalidation price for opening positions
- kill switch

### P0.5 Decision Audit Schema

Every AI decision must be reconstructable.

Minimum stored data:

- bot id
- wake id
- operating mode
- market snapshot id or embedded summary
- account snapshot
- prompt hash or prompt summary
- model output
- parsed plan
- selected candidate
- risk gate decision
- approved actions
- rejected actions and reasons
- execution results
- reward result
- reflection memory writes

## P1: Read-Only And Shadow Trader

Goal:

Build the AI trader runner without letting it place real simulated orders yet.

Recommended package:

```text
apps/trader-bot/
```

Suggested structure:

```text
apps/trader-bot/src/
  index.ts
  types.ts
  config/
    config.ts
    flags.ts
  infra/
    stratiumApiClient.ts
    traderMcpClient.ts
    processRunner.ts
  planner/
    promptBuilder.ts
    planParser.ts
    codexPlanner.ts
    dryRunPlanner.ts
  runtime/
    loop.ts
    wakeCycle.ts
    candidateSelector.ts
    riskGate.ts
    shadowExecutor.ts
    reward.ts
    reflection.ts
```

P1 behavior:

1. load bot profile
2. fetch market and account state
3. fetch memories
4. build prompt
5. ask planner for JSON plan candidates
6. parse and validate plan
7. score candidate plans
8. run risk gate
9. do not place orders
10. log what would have happened
11. score outcome after a configured horizon if market data exists
12. write reflection memory

This phase proves that context gathering, planning, parsing, scoring, and memory all work before adding execution risk.

## P2: Controlled Simulation Execution

Goal:

Allow the bot to execute approved actions inside the Stratium simulated trading environment.

Execution rules:

- all actions go through risk gate
- all execution uses Trader MCP or API, not direct core imports
- default to one symbol
- default to small size
- default to low leverage
- every opening trade requires an invalidation price
- every opening trade should create or reference a stop-loss plan
- no automatic risk-limit changes by the model
- no direct database writes by the model
- execution remains fully visible in the Stratium admin dashboard
- execution events remain replayable through Stratium state and event history

Suggested action schema:

```json
{
  "type": "place_order",
  "symbol": "BTC-USD",
  "side": "buy",
  "orderType": "limit",
  "price": 65000,
  "quantity": 0.001,
  "reduceOnly": false,
  "timeInForce": "GTC",
  "invalidationPrice": 64200,
  "takeProfitPrice": 66800,
  "reason": "Breakout continuation after consolidation"
}
```

Allowed action types for first execution version:

- `observe`
- `place_order`
- `cancel_order`
- `reduce_position`
- `close_position`

Delay these action types:

- multi-order bracket generation
- leverage changes
- symbol changes
- strategy parameter mutation
- account transfer
- any chain-specific action

## P3: Self-Learning Layer

Goal:

Make the bot improve behavior through memory and deterministic reward feedback.

This should not require model training.

Recommended first mechanism:

1. planner proposes plan candidates
2. runtime selects one candidate
3. runtime records the thesis and invalidation
4. later wake computes reward from outcome
5. reflection writes lessons into memory
6. next prompt includes the most relevant memories

Suggested memory keys:

- `reflection/last_wake`
- `reflection/next_priority`
- `lesson/success/<timestamp>`
- `lesson/failure/<timestamp>`
- `market_regime/<symbol>`
- `strategy/current`
- `risk/mistake/<timestamp>`
- `execution/slippage/<timestamp>`

Reward should be deterministic and versioned.

Example reward components:

```text
score =
  pnl_component
  - drawdown_penalty
  - liquidation_risk_penalty
  - fee_penalty
  - overtrade_penalty
  - risk_rejection_penalty
  + plan_discipline_bonus
```

The reward formula should be documented and stored with a version so old decisions can be replayed under the original scoring model.

## P4: Backtesting And Strategy Evolution

Goal:

Use historical market data and replay to evaluate bot behavior before expanding autonomy.

Recommended capabilities:

- run a bot over historical candles or ticks
- record hypothetical orders and fills
- compare candidate strategies
- compute PnL, drawdown, win rate, expectancy, and liquidation risk
- promote only strategies that pass configured thresholds
- preserve strategy version and prompt version

This is the bridge from memory-based learning to more systematic strategy improvement.

True online learning, RL, or model fine-tuning should be considered only after this layer exists.

## Proposed Operating Modes

The bot should have explicit modes.

### Disabled

The bot does nothing.

### Observe

The bot reads market/account state and writes memories, but does not produce actionable orders.

### Shadow

The bot proposes plans and simulated actions, but does not place orders.

### Paper Execute

The bot places approved orders in the simulation environment.

### Reduce Only

The bot can only cancel orders, reduce positions, or close positions.

### Admin Approval

The bot proposes actions, but execution requires human approval.

For early development, the recommended path is:

```text
Disabled -> Observe -> Shadow -> Admin Approval -> Paper Execute
```

## Data Model Sketch

The exact schema should be designed with the current Prisma model, but the first version likely needs these concepts.

### `ai_trader_profiles`

- id
- name
- enabled
- account id
- symbol allowlist
- operating mode
- planner config
- risk policy id
- wake interval
- created at
- updated at

### `ai_trader_wake_logs`

- id
- profile id
- started at
- finished at
- status
- mode
- market snapshot summary
- account snapshot summary
- selected candidate id
- reward id
- metrics JSON
- error summary

### `ai_trader_plan_candidates`

- id
- wake id
- raw model output
- parsed candidate JSON
- candidate score
- selected
- rejection reason

### `ai_trader_risk_decisions`

- id
- wake id
- candidate id
- approved
- approved actions JSON
- rejected actions JSON
- rule results JSON
- created at

### `ai_trader_memories`

- id
- profile id
- key
- value
- importance
- source wake id
- created at
- updated at

### `ai_trader_rewards`

- id
- wake id
- reward version
- score
- components JSON
- evaluation window
- created at

## Integration Options

### Option A: Native Stratium Bot Runner Calls Trader MCP

The native Stratium bot runner talks to Trader MCP for account, market, and trading tools.

Advantages:

- matches future AI-agent integration model
- keeps signer and nonce logic out of the planner
- exercises the same tool surface external agents will use
- keeps execution inside Stratium while preserving a clean tool boundary

Disadvantages:

- more process and network moving parts
- risk gate location must be explicit

Recommended for native Stratium simulated execution once P0 risk controls exist.

### Option B: Native Stratium Bot Runner Calls Stratium API Directly

The bot runner talks to the Fastify API directly.

Advantages:

- simpler for initial implementation
- easier to develop and test locally
- fewer transport layers

Disadvantages:

- may duplicate MCP client behavior
- less representative of final AI-tool usage

Recommended for P1 shadow mode if it speeds up development.

### Option C: External ai.weget.jp Runtime Imports A Strategy Package

Stratium exports a promoted strategy package, and `ai.weget.jp` imports it as a live bot-host workload.

Advantages:

- reuses the generic AI bot-host and skill runtime
- runs live broker execution outside Stratium
- can support broker skills such as GMO Coin
- keeps real broker credentials out of Stratium

Disadvantages:

- adds cross-system identity, callback, and audit complexity
- execution results must be synchronized back into Stratium
- requires an executable package/import contract

Recommended as an optional export path after native Stratium shadow and simulated paper execution are working.

The package contract is defined in `docs/ai-trader-strategy-package.md`.

### Option D: Bot Runner Imports Trading Runtime Directly

The bot runner imports API/runtime/core modules.

Advantages:

- lowest transport overhead
- easy access to internal state

Disadvantages:

- breaks service boundaries
- increases coupling
- bypasses the bot-facing API and MCP semantics

Not recommended for the autonomous trader runtime.

## Recommended First Milestone

Milestone name:

```text
AI Trader Shadow Runner
```

Deliverables:

1. `apps/trader-bot` scaffold
2. bot profile config
3. read-only Stratium context client
4. prompt builder
5. strict JSON plan parser
6. candidate scorer
7. risk gate in dry mode
8. wake logs
9. memory writes
10. reward scoring in shadow mode
11. tests for plan parsing, risk rejection, reward scoring, and wake-cycle failure handling

The milestone is complete when a bot can run repeatedly, produce plans, get rejected or approved by risk rules, record hypothetical decisions, and write useful reflections without placing orders.

The next milestone after this should be native Stratium simulated paper execution. Strategy package export should follow once the simulated trader produces reviewable, promoted strategies.

## Key Risks

### Risk: Model Hallucinated Orders

Mitigation:

- strict JSON schema
- reject unknown action types
- reject unknown enum values
- risk gate must operate on parsed structured data only

### Risk: Overtrading

Mitigation:

- wake interval
- max actions per wake
- cooldown rules
- daily order count limit
- overtrade reward penalty

### Risk: Reward Hacking

Mitigation:

- versioned deterministic reward formula
- include risk penalties, not only PnL
- include rejected action penalties
- evaluate over a fixed horizon

### Risk: Irreproducible Decisions

Mitigation:

- store wake input summaries
- store model output
- store selected candidate
- store risk decision
- store reward version
- link execution results to wake id

### Risk: Trading Core Bugs Amplified By AI

Mitigation:

- close P0 audit issues first
- run shadow mode before execution
- use small caps in paper execution
- keep kill switch available

### Risk: Prompt Becomes Too Large

Mitigation:

- summarize memories
- cap recent fills/orders
- include compact candle features
- store full logs outside prompt
- rotate or reset Codex sessions periodically

## Review Questions

1. Should the first bot be single-symbol only, or should it support a symbol allowlist from day one?
2. Should P1 call the Stratium API directly, or should it call Trader MCP even in shadow mode?
3. What is the first allowed operating mode after shadow: admin approval or paper execute?
4. Which risk limits should be hardcoded for MVP, and which should be editable from admin UI?
5. What reward window should be used first: next wake, fixed minutes, fixed candles, or position close?
6. Should memories be stored in dedicated AI tables, or as business events in the canonical event log?
7. Should the bot be allowed to cancel existing manual orders?
8. Should the bot be allowed to reduce manually opened positions?
9. What is the acceptable maximum loss in simulation before the bot auto-disables?
10. Should the first implementation use Codex CLI like Witchworks, or a direct model API later?

## Recommended Decision

Proceed with the feature, but approve only the native Stratium shadow-runner milestone first.

Do not approve autonomous order execution until:

1. P0 correctness issues are closed
2. risk gate exists and is tested
3. wake logs are persisted
4. shadow mode has produced reviewable decisions
5. admin kill switch exists

After shadow mode, the next approved direction should be controlled simulated paper execution inside Stratium.

After Stratium has promoted strategy output, the next direction can be strategy package export. `ai.weget.jp` live import is an optional downstream path, not part of the required Stratium closed loop.

This keeps the project moving toward an AI self-learning trader while preserving the core requirement of Stratium: deterministic, auditable, explicit trading behavior.
