# AI Trader Admin Dashboard And Wake Plan

Last updated: 2026-05-19

## Goal

This document defines the proposed admin dashboard and wake mechanism for the AI self-learning trader.

The feasibility review accepted the direction in `docs/ai-trader-feasibility.md`. This follow-up document answers two implementation questions:

1. what the admin should be able to see and control
2. how the trader should wake up: fixed interval, signal trigger, or a hybrid model

## Recommendation

Use a hybrid wake model.

The first execution target is native Stratium simulated trading.

Stratium is a closed loop and does not depend on `ai.weget.jp`.

The Stratium admin dashboard and wake scheduler should first support a bot that wakes, plans, paper-trades, scores rewards, writes memories, and promotes/export strategies inside Stratium simulation.

`ai.weget.jp` is an optional downstream live runner for exported strategy packages. If that integration is enabled, Stratium can also show package export/import status and live callbacks.

Do not choose only one of:

- fixed interval wake, like the Witchworks game bot
- indicator trigger wake, such as RSI threshold

The recommended model is:

```text
deterministic market/risk monitors run continuously or on candle close
  -> create wake requests with explicit reasons
  -> scheduler coalesces, prioritizes, and rate-limits requests
  -> AI planner wakes only when allowed by mode, budget, and risk policy
  -> deterministic risk gate approves or rejects any proposed action
```

In short:

- periodic wake keeps the bot coherent
- signal wake makes the bot responsive
- risk wake protects the account
- cooldown and budgets prevent overtrading

## Why Not Pure Fixed Interval

Pure interval wake is simple and works well for a game bot because the game world changes slowly and actions are cheap.

For trading, pure interval wake has problems:

- it may miss fast market transitions between wakes
- it may wake too often during quiet markets
- it wastes tokens and execution budget
- it encourages periodic overtrading
- it does not distinguish opportunity wakes from risk-management wakes

Fixed interval should remain as a heartbeat, not the whole strategy.

## Why Not Pure Indicator Trigger

Pure indicator trigger is also risky.

Examples:

- RSI can stay above 70 or below 30 for a long time.
- Repeated threshold checks can trigger duplicate wakes.
- A single indicator does not understand account state, open orders, drawdown, or existing position thesis.
- Indicator-only wake can ignore reflection and memory maintenance.
- Different strategies need different signals.

Indicators should create wake requests, not directly execute trades.

## Wake Architecture

The wake architecture should separate signal detection, scheduling, planning, and execution.

```text
market data / account events
  -> feature builder
  -> trigger engine
  -> wake request queue
  -> wake scheduler
  -> planner context builder
  -> AI planner
  -> plan parser
  -> candidate selector
  -> risk gate
  -> executor
  -> reward and reflection
```

## Wake Types

### Heartbeat Wake

Purpose:

- refresh state
- update memories
- evaluate stale plans
- produce a plan when no stronger trigger exists

Suggested default:

- every 5 minutes in shadow mode
- every 10 to 15 minutes in observe mode
- configurable per bot profile

Allowed behavior:

- observe
- update thesis
- propose candidate plans
- write reflection
- place orders only in paper-execute mode and only after risk approval

### Candle Close Signal Wake

Purpose:

- react to deterministic technical signals based on closed candles

Suggested cadence:

- evaluate on 1m or 5m candle close
- do not wake on every tick for normal strategy signals

Example triggers:

- RSI crosses above 70
- RSI crosses below 30
- RSI crosses back through 50
- price breaks recent high or low
- volume spike
- ATR expansion
- spread returns to acceptable range after being wide
- moving average cross

Important:

- trigger on transitions, not static values
- use hysteresis where possible
- include cooldown per trigger type

Example:

```text
Bad:
  wake every candle while RSI > 70

Good:
  wake when RSI crosses from <= 70 to > 70
  do not wake again for the same RSI regime until it resets below 65
```

### Position Management Wake

Purpose:

- let the bot reassess an existing position after material changes

Example triggers:

- order filled
- partial fill
- take-profit order filled
- stop order filled
- position changed by manual action
- unrealized PnL crosses configured threshold
- price reaches thesis invalidation zone
- position age exceeds configured review interval

Important:

- emergency stop-loss execution should not wait for AI
- deterministic risk controls should handle hard exits
- AI position management is for reassessment, not last-line safety

### Risk Wake

Purpose:

- alert, disable, or force reduce-only behavior after risk conditions

Example triggers:

- liquidation risk ratio above threshold
- daily loss limit reached
- max drawdown reached
- margin usage too high
- repeated order rejection
- market data stale
- execution service unhealthy
- persistence error

Risk wakes should have the highest priority.

For severe cases, the system should not wait for the AI planner. It should switch the bot to reduce-only or disabled mode and log the reason.

### Manual Admin Wake

Purpose:

- let an admin force a wake for debugging or review

Admin controls:

- wake now
- wake in observe mode
- wake in shadow mode
- run risk check only
- run reflection only

Manual wakes should be logged with the admin user id.

### Reflection Wake

Purpose:

- evaluate outcomes from older plans after the configured reward window
- write lessons without asking for new trades

Example:

- a plan was created at 10:00 with a 30-minute reward window
- at 10:30, reflection wake computes outcome and writes memory

This can be run as a lower-cost deterministic job when possible.

## Scheduler Policy

The scheduler should process wake requests with priority and budgets.

### Priority Order

1. risk wake
2. position management wake
3. manual admin wake
4. candle close signal wake
5. heartbeat wake
6. reflection wake

### Coalescing

Multiple wake requests for the same bot should be merged when they happen close together.

Example:

```text
10:00:00 RSI cross wake requested
10:00:05 price breakout wake requested
10:00:10 heartbeat wake due

Result:
  one wake runs with reasons:
    - rsi_cross_up
    - breakout_high
    - heartbeat_due
```

### Cooldowns

Recommended minimums:

- same signal type: 5 to 15 minutes
- same symbol planning wake: 1 to 5 minutes
- opening new position after close: configurable, default 5 minutes
- after risk rejection: 5 minutes before another opening attempt
- after repeated model parse failures: exponential backoff

### Budgets

Each bot should have explicit budgets:

- max wakes per hour
- max AI planner wakes per day
- max approved trading actions per wake
- max opened positions per day
- max order submissions per day
- max token or prompt size budget

Risk wakes and reduce-only wakes may bypass some planning budgets, but should still be audited.

## Trigger Engine

The trigger engine should be deterministic and testable.

It should not ask the model whether RSI has crossed a threshold. The platform should compute indicators and pass them into the planner context.

Minimum first indicators:

- RSI
- ATR
- recent return percentage
- candle range
- spread
- volume if available
- distance to liquidation price
- margin usage
- position unrealized PnL

First implementation can evaluate indicators on closed candles only.

Avoid tick-level AI wake triggers in the first version.

## Recommended MVP Wake Policy

For the first shadow runner:

```text
mode: shadow
heartbeat: every 5 minutes
signal evaluation: every 1m candle close
AI wake cooldown: 3 minutes
same signal cooldown: 15 minutes
max AI wakes per hour: 12
max actions per proposed plan: 3
execution: disabled
reflection: every wake plus delayed evaluation when configured
```

Signal triggers:

- RSI cross above 70
- RSI cross below 30
- RSI reset through 50
- price change over 0.75% in 5 minutes
- ATR expansion over configured baseline
- spread below max threshold after being too wide

For the first paper-execute runner:

```text
mode: paper_execute
heartbeat: every 5 minutes
position review: every 1 minute while position is open
signal evaluation: every 1m or 5m candle close
AI wake cooldown: 3 minutes
same signal cooldown: 15 minutes
max AI wakes per hour: 12
max approved opening actions per day: 5
max approved actions per wake: 3
risk wake: immediate
hard stop-loss: deterministic, not AI-dependent
```

## Wake Request Shape

Suggested internal type:

```ts
type AiTraderWakeReason =
  | "heartbeat_due"
  | "manual_admin"
  | "rsi_cross_up"
  | "rsi_cross_down"
  | "rsi_reset"
  | "price_breakout"
  | "price_breakdown"
  | "volatility_expansion"
  | "spread_normalized"
  | "order_filled"
  | "position_changed"
  | "position_review_due"
  | "risk_limit_hit"
  | "market_data_stale"
  | "execution_error"
  | "reflection_due";

type AiTraderWakeRequest = {
  id: string;
  botId: string;
  symbol: string;
  priority: "risk" | "position" | "manual" | "signal" | "heartbeat" | "reflection";
  reasons: AiTraderWakeReason[];
  requestedAt: string;
  notBefore?: string;
  expiresAt?: string;
  source:
    | "scheduler"
    | "market_trigger"
    | "account_event"
    | "risk_monitor"
    | "admin"
    | "reflection_job";
  payload?: Record<string, unknown>;
};
```

## Admin Dashboard Goals

The admin dashboard should answer these questions quickly:

1. Is the bot enabled?
2. What mode is it in?
3. Where is it running: native Stratium or external runner?
4. Is it healthy?
5. Why did it wake last time?
6. What did it decide?
7. Did risk gate approve or reject it?
8. What is the current PnL and drawdown?
9. What position and open orders exist now?
10. What signal conditions are currently active?
11. What did the bot learn recently?
12. What can the admin safely control right now?

## Admin Navigation

Add a new admin section:

```text
/admin/bots
```

Suggested menu item:

```text
Bot Dashboard
Monitor AI traders, wake reasons, risk gates, and performance
```

The existing admin console currently has:

- dashboard
- users
- platform
- market
- batch

The bot dashboard should be a peer section, not hidden inside the general dashboard.

## Implementation Status

Current Stratium MVP implementation:

- `/admin/bots` is available as a peer admin section.
- Trader Bot wake summaries are reported through Trader MCP via `stratium_report_trader_bot_wake`.
- Admin APIs expose fleet overview, bot profiles, and wake history for the dashboard.
- Bot wake reports include current strategy snapshot, validated plan, memory summaries, and score breakdown.
- Trading operations remain routed through Trader MCP tools; dashboard reporting is observability only.

Current limitation:

- wake history is held by the running API process. Persisting bot wake reports to PostgreSQL should be added before treating wake history as audit-grade data.

## Dashboard Layout

### Fleet Overview

Top-level cards:

- total bots
- enabled bots
- bots in shadow mode
- bots in paper-execute mode
- bots in reduce-only mode
- exported strategy packages
- deployed live packages
- active wakes
- failed wakes in last 24h
- risk rejections in last 24h
- total simulated PnL
- max drawdown

### Bot List

Each row should show:

- bot name
- mode
- runtime target
- export status
- enabled status
- account id
- active symbol
- current position
- equity
- daily PnL
- drawdown
- last wake time
- last wake status
- last wake reasons
- next scheduled wake
- risk state

Useful row actions:

- open detail
- wake now
- switch to observe
- switch to shadow
- switch to reduce-only
- disable

### Bot Detail Header

Show:

- bot name
- current mode
- runtime target
- package export status
- health
- enabled status
- current account
- active symbol
- planner provider
- execution target
- prompt version
- reward version
- last wake
- next wake

Primary controls:

- enable or disable
- wake now
- pause
- reduce-only
- kill switch
- change mode

### Current State Panel

Show:

- equity
- available margin
- margin usage
- realized PnL
- unrealized PnL
- daily PnL
- drawdown
- position side
- position size
- average entry
- mark price
- liquidation price or risk threshold
- open orders

### Market And Signal Panel

Show:

- active symbol
- bid, ask, mid, spread
- last candle close
- RSI
- ATR
- 5m return
- 1h return
- volatility state
- active trigger states
- current wake cooldowns

This panel lets an admin see why the bot may wake soon.

### Wake Timeline

Show recent wake logs:

- wake id
- started at
- finished at
- duration
- status
- mode
- reasons
- planner result
- selected candidate
- risk decision
- execution count
- reward score
- error summary

Each wake should be expandable.

### Plan Review Panel

For the selected wake:

- raw model output
- parsed plan
- candidate list
- selected candidate
- rejected candidates
- thesis
- invalidation price
- expected reward notes
- proposed actions
- approved actions
- rejected actions
- risk rule results

For admin approval mode:

- approve selected action
- reject selected action
- approve reduce-only action
- add admin note

### Performance Panel

Show:

- equity curve
- realized PnL
- unrealized PnL
- reward score over time
- win rate
- average win
- average loss
- expectancy
- max drawdown
- fees
- slippage estimate
- order fill rate
- risk rejection rate

For MVP, a simple table and compact line chart are enough.

### Memory And Lessons Panel

Show:

- latest reflection
- next priority
- recent success lessons
- recent failure lessons
- current strategy memory
- risk mistake memories

Controls:

- disable memory key
- pin memory
- add admin memory note

Avoid letting the model directly edit protected system rules or risk policies.

### Risk Policy Panel

Show:

- symbol allowlist
- max order notional
- max order size
- max position size
- max leverage
- max daily loss
- max drawdown
- max open orders
- max wakes per hour
- max actions per wake
- cooldowns
- mandatory stop-loss setting

Editing risk policy should be audited.

For MVP, risk policy can be read-only in the dashboard if editing adds too much scope.

### Strategy Package Panel

Show:

- latest promoted strategy package
- package id
- package version
- package hash
- exported at
- export artifact type: JSON, npm, or both
- ai.weget.jp import status
- live deployment status
- live callback status
- revoke status

Controls:

- export JSON package
- export executable npm package
- copy package id
- download package
- revoke package

Live deployment controls should remain in the downstream live runner, such as `ai.weget.jp`. Stratium should display deployment state and receive callbacks when configured, but should not store live broker credentials.

## Admin API Surface

Suggested endpoints:

```text
GET  /api/admin/ai-trader/overview
GET  /api/admin/ai-trader/profiles
GET  /api/admin/ai-trader/profiles/:profileId
GET  /api/admin/ai-trader/profiles/:profileId/wakes
GET  /api/admin/ai-trader/wakes/:wakeId
GET  /api/admin/ai-trader/profiles/:profileId/memories
GET  /api/admin/ai-trader/profiles/:profileId/rewards
GET  /api/admin/ai-trader/profiles/:profileId/risk-policy
GET  /api/admin/ai-trader/strategy-packages
GET  /api/admin/ai-trader/strategy-packages/:packageId
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-json
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-npm
POST /api/admin/ai-trader/profiles/:profileId/wake-now
POST /api/admin/ai-trader/profiles/:profileId/mode
POST /api/admin/ai-trader/profiles/:profileId/disable
POST /api/admin/ai-trader/profiles/:profileId/reduce-only
POST /api/admin/ai-trader/profiles/:profileId/kill-switch
POST /api/admin/ai-trader/strategy-packages
POST /api/admin/ai-trader/strategy-packages/:packageId/promote
POST /api/admin/ai-trader/strategy-packages/:packageId/revoke
POST /api/admin/ai-trader/wakes/:wakeId/approve-action
POST /api/admin/ai-trader/wakes/:wakeId/reject-action
```

MVP can start with:

```text
GET  /api/admin/ai-trader/overview
GET  /api/admin/ai-trader/profiles
GET  /api/admin/ai-trader/profiles/:profileId/wakes
GET  /api/admin/ai-trader/wakes/:wakeId
POST /api/admin/ai-trader/profiles/:profileId/wake-now
POST /api/admin/ai-trader/profiles/:profileId/mode
POST /api/admin/ai-trader/profiles/:profileId/disable
```

The first API version should assume:

```text
runtimeTarget = "stratium_native"
executionTarget = "stratium_simulation"
```

Later versions may add:

```text
runtimeTarget = "ai_weget_external"
executionTarget = "external_broker"
```

## Realtime Updates

The dashboard should receive updates when:

- a wake starts
- a wake finishes
- a wake fails
- a risk gate rejects actions
- a bot mode changes
- a bot is disabled
- an admin requests a manual wake
- a new reward is computed
- a strategy package is exported
- a strategy package is revoked
- a downstream runner imports a package
- a downstream runner sends live execution callbacks

Suggested websocket event names:

```text
ai_trader_overview
ai_trader_wake_started
ai_trader_wake_finished
ai_trader_wake_failed
ai_trader_risk_decision
ai_trader_mode_changed
ai_trader_reward_recorded
ai_trader_strategy_package_exported
ai_trader_strategy_package_revoked
ai_trader_live_callback_received
```

Polling can be used for MVP if websocket scope is too large.

## Implementation Priority

### P0: Backend Data And Status API

- add profile, wake, decision, risk, reward, and memory read models
- add admin overview endpoint
- add profile list endpoint
- add wake detail endpoint
- add mode and disable control endpoints

### P1: Admin Bot Dashboard MVP

- add `/admin/bots`
- add bot list
- add fleet metrics
- add selected bot detail
- add wake timeline
- add current state and latest risk decision
- add manual wake and disable controls

### P2: Wake Scheduler MVP

- implement heartbeat wake
- implement manual admin wake
- implement wake request coalescing
- implement cooldowns
- log all wake reasons

### P3: Signal Trigger Engine

- compute RSI and basic candle features
- trigger only on candle close transitions
- add same-signal cooldown
- show active triggers in dashboard

### P4: Paper Execution Controls

- add admin approval mode
- add approve and reject action UI
- add reduce-only and kill switch UI
- show execution results and reward attribution

### P5: Strategy Package Export

- export data-only strategy package
- export executable npm runner package
- show package hash and validation report
- support revoke
- receive downstream import/deployment callbacks

## Recommended First Slice

Build these together first:

1. `/admin/bots` route
2. read-only bot fleet overview
3. bot detail with runtime target, current mode, last wake, next wake, and latest risk decision
4. heartbeat wake only
5. manual wake button
6. wake timeline
7. no order execution

Then add signal triggers.

This gives reviewable operational visibility before adding RSI or price-breakout based AI wakes.

## Open Questions

1. Should the first dashboard show all bot profiles, or only enabled profiles?
2. Should `wake now` run in the bot's current mode or force shadow mode by default?
3. Should signal thresholds be global defaults or per-bot settings?
4. Should RSI use 1m, 5m, or both for the first version?
5. Should admin approval mode be required before paper-execute mode?
6. Should reduce-only mode close only AI-opened positions or any account position?
7. Should dashboard controls be available to every admin or only a higher-privilege admin role?

## Decision

Use a hybrid wake system:

```text
heartbeat + candle-close signal triggers + account/risk event triggers + manual admin wake
```

For MVP, start with:

```text
heartbeat + manual wake + shadow mode
```

Then add:

```text
candle-close RSI/price/volatility triggers
```

Then add:

```text
controlled paper execution inside Stratium
```

Then add:

```text
strategy package export for optional downstream live import
```

Keep emergency risk handling deterministic and independent from the AI planner.
