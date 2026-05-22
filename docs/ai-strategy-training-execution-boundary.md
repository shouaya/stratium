# AI Strategy Training And Execution Boundary

Last updated: 2026-05-22

Status: decision note

Related Stratium docs:

- [AI Self-Learning Trader Feasibility](ai-trader-feasibility.md)
- [AI Trader Admin Dashboard And Wake Plan](ai-trader-admin-dashboard-and-wake-plan.md)
- [AI Trader Memory Governance](ai-trader-memory-governance.md)
- [AI Trading Hall Review Improvements](ai-trading-hall-review-improvements.md)

Related external project:

- `/Users/shoushoushou/git/trade`

## 1. Decision Summary

The recommended direction is not to make Stratium the primary strategy-training system.

Use this split:

```text
trade
  owns strategy learning, feature memory, rolling validation, and strategy artifact export

Stratium
  owns simulation execution, risk gates, execution quality, post-trade review, and Trading Hall supervision

AI agents in Stratium
  explain, review, propose conservative adjustments, and support manager decisions
```

In short:

**`trade` learns what to trade. Stratium proves whether it can be executed safely. AI in Stratium helps operate and supervise the strategy.**

## 2. Compared Options

| Option | Strengths | Weaknesses | Recommendation |
| --- | --- | --- | --- |
| Single AI bot learns by trading inside Stratium | Fastest prototype. Simple loop. Directly tests Trader MCP, wake cycle, risk gate, memory, and post-trade reflection. | Too few samples. Feedback is noisy. AI self-review can rationalize mistakes. Hard to prove long-term edge. | Keep as shadow or paper-execute experiment, not the main strategy training path. |
| Multiple AI agents collaborate inside Stratium | Fits the Trading Hall model. Enables role accountability: trader, analyst, risk, execution, portfolio, manager. Better for review and governance. | More engineering complexity. More AI does not fix weak evidence. Without stable postmortems and contamination labels, it can create more text instead of better decisions. | Use as supervision layer after trade lifecycle, postmortem, risk, and execution data are reliable. |
| Train strategy in `trade`; Stratium supervises execution | Clear project boundary. Better statistical validation. Supports rolling validation, feature memory, strategy artifacts, and golden replay. Stratium can focus on execution truth and audit. | Requires artifact/import boundary and parity tests. Feedback loop is slower than pure live AI. `trade` still needs causal/live feature hardening. | Recommended main direction. |

## 3. Why Stratium-Only AI Training Is Not Enough

AI trading inside Stratium is useful, but it should not be treated as the primary strategy discovery mechanism.

Main reasons:

1. **Sample count is too low.**
   A live or simulated bot may produce only a small number of meaningful closed trades per day. Strategy learning needs many historical windows, regimes, costs, failure cases, and out-of-sample checks.

2. **Feedback is noisy.**
   One loss can come from strategy mismatch, execution slippage, fees, stale data, bad fill logic, position sizing, or random market noise. Without stable attribution, the AI may learn the wrong lesson.

3. **Self-review is not statistical validation.**
   A memory such as "be more careful in chop" can be useful operationally, but it is not the same as proving that a strategy or parameter set survives rolling validation.

4. **Multiple AI agents do not automatically create edge.**
   Analysts and portfolio agents can improve explanation and governance, but they cannot replace feature extraction, backtesting, cost sensitivity, and future-window validation.

Therefore, Stratium AI should learn:

- when to pause
- when to reduce risk
- when execution/data quality is unreliable
- when recent postmortems contradict the current memo
- when to request manager review
- which samples should be sent back to `trade` for further research

Stratium AI should not be expected to discover and prove the core alpha by itself.

## 4. Project Responsibilities

### `trade`

`trade` should act as the strategy lab.

Responsibilities:

- single-symbol strategy research
- feature extraction
- feature memory
- strategy library and parameter-set evolution
- candidate pool training
- rolling validation
- causal/live feature hardening
- cost and slippage sensitivity
- `trade_strategy_artifact.v1` export
- golden replay fixture export

Primary output:

```text
trade_strategy_artifact.v1
golden replay fixture
strategy performance and provenance
```

### Stratium

Stratium should act as the execution lab and Trading Hall.

Responsibilities:

- deterministic simulation execution
- stable order / fill / position / trade lifecycle
- stable `tradeId`
- risk gate
- execution quality checks
- contamination labeling
- post-trade review
- manager decision queue
- bot dashboard and Trading Hall
- paper execution of imported strategies
- audit trail

Primary output:

```text
execution events
trade postmortems
risk alerts
execution alerts
manager decisions
strategy runtime evidence
```

### AI Agents In Stratium

AI agents should operate as reviewers and supervisors.

Responsibilities:

- summarize recent trade outcomes
- classify losses as strategy / execution / risk / data / unknown
- propose conservative adjustments
- write analyst briefs and memos
- identify stale or conflicting memories
- help manager decide whether to pause, reduce, observe, or investigate

AI agents must not:

- bypass deterministic risk gates
- redefine core strategy formulas during execution
- silently change symbols or venue adapters
- increase risk without approval
- treat contaminated samples as valid learning data

## 5. Recommended Near-Term Path

Start with one bot, not a full multi-agent hall.

Recommended first product:

```text
TradeStrategyBot v1
```

It should:

1. load or reference a `trade` strategy artifact
2. execute the strategy deterministically in Stratium paper mode
3. pass every order intent through Stratium risk gates
4. persist wake, order, fill, position, and trade evidence
5. generate a postmortem after each closed position
6. allow AI to propose bounded adjustments
7. show strategy state, adjustment state, evidence, and postmortems in the dashboard

## 6. Bounded AI Adjustment Policy

In the first version, AI can propose small operational adjustments, but it should not change the core strategy.

Allowed adjustments:

- pause temporarily
- switch from `paper_execute` to `observe`
- reduce risk multiplier
- lengthen cooldown
- lower max order notional
- require stronger entry confidence
- mark suspicious samples for review
- recommend manager investigation

Not allowed in the first version:

- change strategy family
- change RSI / ATR / entry / exit formulas freely
- change symbol
- increase max risk
- increase order size
- bypass schedule or hard risk limits
- treat AI approval as a substitute for deterministic validation

Recommended default:

```text
AI may brake automatically within bounded limits.
AI may not accelerate without manager approval.
```

Example adjustment object:

```json
{
  "schemaVersion": "stratium.adjustment-proposal.v1",
  "proposalId": "adj_001",
  "targetBotId": "trade-strategy-bot",
  "actionType": "reduce_risk_multiplier",
  "from": 1.0,
  "to": 0.7,
  "reason": "Recent valid postmortems show repeated losses in low-volatility chop.",
  "evidenceRefs": [
    { "type": "trade_postmortem", "id": "pm_001" },
    { "type": "metric_window", "id": "mw_24h" }
  ],
  "expiresAt": "2026-05-23T00:00:00.000Z",
  "requiresManagerApproval": false
}
```

## 7. Implementation Order

Recommended order:

1. In `trade`, finish `trade_strategy_artifact.v1` exporter and golden replay fixture exporter.
2. In Stratium, finish stable `tradeId`, trade postmortem, execution monitor, risk monitor, and data quality labeling.
3. Add a Stratium strategy runtime path that can execute an imported or referenced `trade` artifact in paper mode.
4. Add bounded AI adjustment proposals, with structured evidence references.
5. Add manager approval, reject, snooze, and audit trail.
6. Only after that, expand toward multiple AI roles and full Trading Hall.

## 8. Decision Rules

Use these rules when future implementation choices conflict:

1. Strategy learning source of truth belongs in `trade`.
2. Execution truth belongs in Stratium.
3. AI summaries are advisory unless backed by structured evidence.
4. Risk and execution monitors are deterministic first.
5. Contaminated samples are excluded from training, leaderboard, and strategy scoring by default.
6. Manager decisions must reference postmortem, alert, metric, or artifact evidence.
7. Multi-agent collaboration is a governance layer, not a replacement for strategy validation.

## 9. Final Recommendation

Focus now on a single bot executing a `trade` strategy inside Stratium.

Keep the strategy direction stable. Let AI make only bounded, conservative operational adjustments based on postmortems, risk alerts, execution alerts, and manager-approved policy.

This keeps the project moving without letting Stratium become an uncontrolled AI strategy lab too early.
