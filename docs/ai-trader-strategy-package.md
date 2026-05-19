# AI Trader Strategy Package

Last updated: 2026-05-19

## Goal

Stratium is the closed-loop simulation, validation, simulated trading, and packaging environment.

`ai.weget.jp` is one optional downstream live bot runtime environment.

This document defines how Stratium should export an AI trader strategy so it can be imported and executed by an external live runner such as `ai.weget.jp`.

The package must include both:

1. the strategy data produced and validated in Stratium
2. an executable runner program that can be launched through npm, following the same general pattern as the Witchworks bot runner

## Boundary Decision

Stratium owns:

- the full native simulation loop
- simulated trading
- strategy creation
- shadow runs
- simulated paper execution
- backtests
- reward scoring
- memory condensation
- strategy promotion
- export package creation
- package hash, signature, and approval metadata

An optional downstream live runner such as `ai.weget.jp` owns:

- live bot hosting
- live broker credentials
- local Codex runtime
- skill loading
- live execution guard
- broker adapter
- live execution logs
- live result callbacks

The exported package must never contain:

- broker API keys
- Stratium admin tokens
- `ai.weget.jp` runtime tokens
- raw signer secrets
- unrestricted order execution permission

Strategy package export is an integration feature. It is not required for Stratium's native closed loop.

## Package Concept

The exported artifact should be called a Strategy Package.

It should be versioned, immutable after export, and reproducible.

Recommended package states:

```text
draft
  -> validated
  -> promoted
  -> exported
  -> imported
  -> deployed
  -> revoked
```

Only promoted packages should be exportable for live use.

## Artifact Formats

Stratium should support two related artifact formats.

### Data Package

A data-only package contains the strategy, policies, memories, and validation reports.

Suggested file extension:

```text
.stratium-strategy.json
```

Use this for:

- review
- archive
- import into another Stratium environment
- import into an existing `ai.weget.jp` runtime that already has a generic Stratium strategy runner

### Executable NPM Package

An executable package contains the data package plus a runner program.

Suggested file extension:

```text
.tgz
```

Use this for:

- `npm install`
- `npx`
- `npm start`
- local `ai.weget.jp` bot-host execution
- deployment through a package registry or artifact upload

The executable package should behave like the Witchworks bot runner:

```text
src/index.ts
  loads config
  loads strategy package
  builds context
  wakes planner
  parses plan
  applies local execution guard
  executes approved live actions through ai.weget.jp skills
  reports results

src/runtime/wakeCycle.ts
  performs one live wake

src/planner/*
  builds prompt and calls Codex or host planner

src/mcp/server.ts
  optional local MCP bridge for Codex
```

## Executable Package Shape

Suggested package layout:

```text
stratium-strategy-<strategy-id>-<version>/
  package.json
  README.md
  dist/
    index.js
    mcp/server.js
    runtime/wakeCycle.js
    planner/promptBuilder.js
    planner/planParser.js
  strategy/
    strategy.package.json
    prompt-bundle.json
    memory-digest.json
    wake-policy.json
    signal-policy.json
    risk-policy.json
    reward-policy.json
    backtest-report.json
  bin/
    stratium-strategy-runner.cjs
```

Suggested `package.json`:

```json
{
  "name": "@stratium/strategy-example-1",
  "version": "1.0.0",
  "private": false,
  "type": "module",
  "bin": {
    "stratium-strategy-runner": "bin/stratium-strategy-runner.cjs"
  },
  "files": [
    "dist",
    "strategy",
    "bin",
    "README.md",
    "package.json"
  ],
  "scripts": {
    "start": "node dist/index.js",
    "once": "node dist/index.js --once",
    "shadow": "node dist/index.js --mode shadow",
    "mcp": "node dist/mcp/server.js",
    "check": "node dist/index.js --check"
  },
  "dependencies": {
    "@ai.weget.jp/skill-sdk": ">=0.1.3 <1"
  }
}
```

The exact package scope can be changed later. The important requirements are:

- it can be installed by npm
- it can run with `npm start`
- it can run one wake with `npm run once`
- it can validate its bundled strategy with `npm run check`
- it can expose an optional MCP bridge if the live planner needs it

## Strategy Package Schema

Suggested top-level data shape:

```json
{
  "schemaVersion": "stratium.strategy-package.v1",
  "strategyId": "btc-rsi-breakout-v1",
  "strategyVersion": "1.0.0",
  "createdAt": "2026-05-19T00:00:00.000Z",
  "createdBy": "admin-user-id",
  "source": {
    "stratiumEnvironment": "local",
    "simulationRunIds": ["sim-run-1"],
    "backtestRunIds": ["backtest-1"],
    "promotedFromBotProfileId": "bot-profile-1"
  },
  "marketScope": {
    "symbols": ["BTC-USD"],
    "timeframes": ["1m", "5m"],
    "exchangeProfile": "stratium-simulation"
  },
  "runtime": {
    "target": "ai.weget.jp",
    "runnerKind": "npm",
    "entrypoint": "stratium-strategy-runner",
    "requiresCodex": true,
    "requiredSkills": [
      {
        "name": "@ai.weget.jp/skill-gmo-coin",
        "versionRange": ">=0.1.4 <1",
        "permissions": ["trade:read", "trade:write"]
      }
    ]
  },
  "wakePolicy": {},
  "signalPolicy": {},
  "riskPolicy": {},
  "allowedActions": [],
  "promptBundle": {},
  "memoryDigest": {},
  "rewardPolicy": {},
  "validation": {},
  "artifact": {
    "packageHash": "sha256:...",
    "strategyHash": "sha256:...",
    "signature": null
  }
}
```

The package should use runtime schema validation when imported.

## Strategy Data

### Prompt Bundle

The prompt bundle should include:

- system rules
- trading behavior constraints
- strategy summary
- JSON output schema
- allowed action schema
- forbidden actions
- risk policy summary
- memory digest summary

It should not include raw secrets or private environment values.

### Memory Digest

The memory digest should be condensed and structured.

Do not export every raw wake log into the live package.

Recommended memory sections:

- market regimes where the strategy worked
- market regimes where the strategy failed
- signal combinations with positive reward
- signal combinations with negative reward
- execution mistakes
- risk mistakes
- cooldown lessons
- position management lessons
- current operating thesis

Example:

```json
{
  "summary": "RSI reset plus range breakout worked better than entering while RSI was already extended.",
  "lessons": [
    {
      "type": "failure",
      "condition": "RSI stayed above 70 for more than 5 candles",
      "lesson": "Avoid new long entries until reset or consolidation.",
      "evidenceWakeIds": ["wake-1", "wake-2"]
    }
  ]
}
```

### Risk Policy

The exported risk policy should represent Stratium's validated recommendation.

`ai.weget.jp` must still enforce a local live execution guard.

The live guard may be stricter than the exported policy, but must not be weaker.

Recommended risk fields:

- symbol allowlist
- max order notional
- max position notional
- max leverage
- max daily loss
- max drawdown
- max open orders
- max actions per wake
- mandatory stop-loss
- reduce-only triggers
- kill switch triggers

### Validation Report

Every live-exportable package should include:

- simulated PnL
- max drawdown
- win rate
- average win
- average loss
- expectancy
- number of trades
- risk rejection count
- liquidation events
- largest adverse excursion
- backtest date range
- reward formula version
- known limitations

## Runtime Modes

The exported runner should support at least these modes:

### `check`

Validate the package schema, required skills, and local runtime configuration.

No AI call.

No trading.

### `observe`

Read live market/account state and produce context.

No planning.

No trading.

### `shadow`

Run the planner and produce a TradePlan.

Apply execution guard.

Do not send broker orders.

### `approval`

Run planner and execution guard.

Submit proposed actions to `ai.weget.jp` control plane for human approval.

### `live`

Run planner, execution guard, and live broker execution.

Only allowed when:

- package is imported and trusted
- required skills are installed
- live credentials are configured locally
- live execution guard passes
- bot is enabled in `ai.weget.jp`

Default imported mode should be `shadow`, not `live`.

## Execution Flow In ai.weget.jp

Recommended live flow:

```text
ai.weget.jp imports package
  -> validates package schema and hash
  -> checks required skills and permissions
  -> operator chooses bot/channel/account
  -> runner starts in shadow mode
  -> wake scheduler triggers runner
  -> runner builds live context through ai.weget skills
  -> Codex generates TradePlan
  -> local execution guard approves/rejects actions
  -> approved actions execute through broker skill
  -> result callback is sent to ai.weget control plane
  -> optional result callback is sent back to Stratium
```

Live broker credentials stay in `ai.weget.jp` or the local bot-host environment.

## Result Callback Back To Stratium

Stratium should be able to receive live performance data so the strategy can be evaluated against real outcomes.

Suggested callback events:

- package imported
- package deployed
- wake started
- wake finished
- plan parsed
- risk decision
- live order submitted
- live order rejected
- live fill received
- live position changed
- reward evaluated
- package disabled
- package revoked

Stratium should store these separately from simulation events.

Do not mix live broker fills into canonical simulation event replay.

## Stratium Export API

Suggested admin endpoints:

```text
GET  /api/admin/ai-trader/strategy-packages
POST /api/admin/ai-trader/strategy-packages
GET  /api/admin/ai-trader/strategy-packages/:packageId
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-json
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-npm
POST /api/admin/ai-trader/strategy-packages/:packageId/promote
POST /api/admin/ai-trader/strategy-packages/:packageId/revoke
POST /api/admin/ai-trader/strategy-packages/import
```

MVP export can start with:

```text
POST /api/admin/ai-trader/strategy-packages
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-json
GET  /api/admin/ai-trader/strategy-packages/:packageId/download-npm
```

## ai.weget.jp Import Surface

Suggested import options:

```bash
npm install ./stratium-strategy-btc-rsi-breakout-v1-1.0.0.tgz
npm run check
npm run shadow
npm run once
```

Or through the bot-host UI:

```text
Import Strategy Package
  -> select .tgz or package name
  -> validate package
  -> map required skills
  -> map live account/broker config
  -> start in shadow mode
```

## Security Requirements

- exported packages contain no secrets
- package hash is stored in Stratium
- imported package hash is verified by `ai.weget.jp`
- live mode requires explicit operator approval
- live execution guard is mandatory
- imported risk policy cannot weaken local guard limits
- package revoke event should disable future wakes
- every live action must carry package id and version

## Recommended Build Order

### P0: Package Schema

- define strategy package schema
- define memory digest schema
- define wake, signal, and risk policy schemas
- define package validation

### P1: Stratium JSON Export

- export data-only package
- include validation report
- include package hash
- import JSON package back into Stratium for review

### P2: Executable NPM Export

- generate npm package layout
- include bundled strategy data
- include runner entrypoint
- include `check`, `once`, `shadow`, and `start` scripts
- generate `.tgz`

### P3: ai.weget.jp Import

- import generated npm package
- validate schema and hash
- run in shadow mode
- connect required skills
- report logs

### P4: Live Execution

- enable approval mode
- enable live mode with local execution guard
- report live results back to Stratium
- support revoke and disable

## Decision

Stratium should export both:

1. a strategy data package
2. an executable npm runner package

The executable package should follow the Witchworks bot-runner style:

```text
npm run check
npm run once
npm run shadow
npm start
```

An optional downstream live runner such as `ai.weget.jp` can import and execute the package for live trading, while Stratium remains a complete closed-loop simulation, validation, simulated trading, packaging, and post-trade analysis system.
