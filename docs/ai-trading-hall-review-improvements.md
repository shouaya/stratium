# AI Trading Hall 设计 Review 与改善意见

> 版本：Review Draft Improvement Notes  
> 适用对象：Stratium 模拟交易团队训练系统  
> 建议结论：**Revise and approve MVP**  
> 核心判断：设计方向正确，但第一版应收敛为“单 bot 自总结 + 外部监督 + Manager Decision Queue”，不要一开始实现完整多角色自动交易大厅。

---

## 1. 总体评价

当前 AI Trading Hall 设计的方向是合理的。它试图把现有偏向 bot debugging 的 dashboard，升级为 manager-facing cockpit，让最终管理者能够快速判断：

- 当前 desk 是否安全；
- 哪些 bot 正在贡献或拖累收益；
- 最新亏损属于策略问题、执行问题、风控问题还是数据问题；
- 风控和执行质量是否发现异常；
- analyst 是否完成了交易复盘；
- 当前是否有需要 manager 审批的动作；
- 推荐动作背后的证据是什么。

这比单纯展示 bot wake log、orders、memory、PnL 更有管理价值。

不过，当前设计稿的完整版本更像是一个成熟交易运营系统。对于当前阶段，首版不应该一次性实现完整 Trading Hall，而应该先做一个可审计、可验证、可渐进扩展的 MVP。

推荐路线是：

```text
现有单 bot 自交易 / 自总结
        ↓
标准化 Trade Postmortem
        ↓
外部 Risk Monitor + Execution Monitor
        ↓
Manager Brief + Decision Queue
        ↓
Strategy Leaderboard
        ↓
Portfolio Manager Bot
        ↓
完整 Trading Hall Dashboard
```

---

## 2. 最重要的设计原则

### 2.1 不要让 bot 自己完全评价自己

单个 trader bot 可以继续自己总结交易，但它的总结不应该是唯一事实来源。

原因：

- bot 容易为自己的错误交易找理由；
- bot 很难判断亏损是策略问题还是执行质量问题；
- bot 不知道其他 bot 的表现；
- bot 不适合判断整体 desk exposure；
- bot 可能把污染样本写入 memory，导致后续训练变差。

因此，正确结构应该是：

```text
Trader Bot 自总结：负责局部学习
Risk Monitor：负责风控边界
Execution Monitor：负责成交质量和样本污染判断
Analyst Bot：负责跨 bot 复盘与解释
Portfolio Manager Bot：负责提出 allocation / mode change
Human Manager：负责最终审批
```

### 2.2 Risk 和 Execution 第一版应 deterministic

Risk Monitor 和 Execution Monitor 首版不建议做成 AI agent。

它们更适合作为确定性服务，基于规则扫描：

- exposure 是否超过阈值；
- drawdown 是否超过阈值；
- 是否存在 stale market data with open exposure；
- open order 是否超时；
- limit order 是否出现非法 fill；
- slippage 是否异常；
- fees 是否吞噬大部分 gross PnL；
- order reject / cancel / fill latency 是否异常；
- 某些交易样本是否需要标记为 contaminated。

AI 可以解释这些结果，但不应该负责定义最基础的交易安全事实。

### 2.3 Manager Dashboard 应从“动作”开始，而不是从“日志”开始

首屏不应该让 manager 看大量 bot log。Manager 首屏应该回答：

```text
现在是否安全？
现在是否需要我做决定？
推荐动作是什么？
证据是什么？
如果我不处理，会有什么风险？
```

因此 Decision Queue 应该是核心模块，而不是附属模块。

---

## 3. Top 5 Strengths

### 3.1 角色边界清楚

设计中区分了 trader bots、risk monitor、execution monitor、analyst bot、portfolio manager bot 和 final manager。这个角色拆分是合理的，符合模拟交易团队训练系统的目标。

### 3.2 把 Manager Cockpit 放在第一屏

设计没有继续强化 bot log viewer，而是把目标改成 manager cockpit。这是产品方向上的正确升级。

### 3.3 引入 Decision Queue 是关键

Decision Queue 可以把系统从“展示信息”升级为“支持决策”。这比单纯显示 PnL、drawdown、orders 更有实际价值。

### 3.4 Execution Quality Board 很重要

执行质量监控是训练系统里非常关键的一环。如果模拟器或 broker feedback 有问题，AI 可能会基于错误成交、错误费用、错误滑点学习，导致 memory 被污染。

### 3.5 Trade Postmortem 是后续所有智能层的基础

只要每笔交易都能稳定生成 tradeId、PnL、fees、slippage、root cause、classification 和 lesson，后面的 analyst brief、leaderboard、portfolio recommendation 才有依据。

---

## 4. Top 5 Risks / Gaps

### 4.1 首版范围过大

当前设计包含：

- Desk Overview
- Decision Queue
- Analyst Brief
- Role Health Matrix
- Strategy Leaderboard
- Risk Board
- Execution Quality Board
- Bot Drilldown
- Portfolio Manager Bot
- Manager Workflow

这些都合理，但不适合首版全部做实。否则容易出现 dashboard 很完整，但底层数据不可信、recommendation 不可审计的问题。

### 4.2 tradeId / position lifecycle 是核心依赖

没有稳定 tradeId，就无法可靠完成：

- post-trade review；
- PnL attribution；
- execution issue attribution；
- contaminated sample labeling；
- bot memory update；
- strategy leaderboard；
- manager decision evidence chain。

因此，tradeId 不是后续优化项，而是 MVP 的 P0 基础设施。

### 4.3 Evidence 结构过弱

当前 Manager Decision 中的 `evidence` 是字符串数组，这不够。

例如：

```json
"evidence": [
  "trend-btc-trader closed 2 losing trades",
  "latest analyst memo says BTC-USD is choppy"
]
```

这类文字证据无法被系统稳定追踪和验证。应改成结构化 evidence refs。

推荐：

```json
"evidenceRefs": [
  {
    "type": "trade_postmortem",
    "id": "pm_001",
    "summary": "trend-btc-trader lost in low-vol chop"
  },
  {
    "type": "execution_alert",
    "id": "exec_018",
    "summary": "fees consumed 42% of gross PnL"
  },
  {
    "type": "metric_window",
    "id": "mw_trend_24h",
    "summary": "3 valid losses in last 24h"
  }
]
```

### 4.4 Strategy Leaderboard 容易误导

如果只按 PnL、win rate、drawdown 排序，会出现几个问题：

- 样本量太少时误判策略质量；
- contaminated trades 被计入表现；
- 不同 bot 的 risk budget 不一致导致比较不公平；
- market regime 不同导致短期排名波动很大；
- fees 和 slippage 没有被正确归因。

Leaderboard 必须显示：

- total trades；
- valid trades；
- contaminated trades；
- sample size status；
- confidence level；
- regime breakdown；
- net PnL after fees and slippage；
- max drawdown；
- risk-adjusted return。

### 4.5 Portfolio Manager Bot 不应太早自动执行

Portfolio Manager Bot 第一版只应该提出 decision proposal，不应该直接改 bot mode、risk budget 或 allocation。

正确顺序：

```text
proposal only
    ↓
manager approve / reject / snooze
    ↓
dry-run apply
    ↓
audited apply
    ↓
rollback support
```

---

## 5. 推荐 MVP 范围

建议第一版目标不是完整 AI Trading Hall，而是：

> **让 manager 能在 1 分钟内知道当前 desk 是否安全、哪笔交易出了问题、是否存在执行污染、现在是否有动作要审批。**

### 5.1 MVP 必做模块

| 模块 | MVP 做法 | 优先级 |
| --- | --- | --- |
| Event Ledger | 统一记录 order、fill、position、trade、alert、brief、decision | P0 |
| Stable tradeId | 从 position lifecycle 中稳定生成 tradeId | P0 |
| Trade Postmortem | 每次 position closed 后生成结构化复盘 | P0 |
| Execution Monitor | 检查 fill、slippage、fees、reject、latency、contamination | P0 |
| Risk Monitor | 检查 exposure、drawdown、stale data、loss streak、open order age | P0 |
| Desk Overview | 显示 desk status、PnL、drawdown、exposure、alerts、pending decisions | P1 |
| Decision Queue | 显示 recommendation、evidence、confidence、status | P1 |
| Analyst Brief | 基于 postmortem 和 alert 生成 desk-level summary | P1 |
| Bot Drilldown Entry | 从 manager 页面跳转到现有 bot dashboard | P1 |

### 5.2 MVP 暂缓模块

| 模块 | 暂缓原因 |
| --- | --- |
| Portfolio Manager Bot | 需要稳定 postmortem 和 leaderboard 后才有意义 |
| 自动 apply manager decisions | 风险较高，需要 audit trail 和 rollback |
| 完整 Role Health Matrix | 第一版可以简化为 role freshness / status |
| 高级 Strategy Leaderboard | 需要足够样本量和污染样本过滤 |
| 多 analyst / 多 manager | 当前阶段会增加复杂度，不增加核心价值 |
| 复杂可视化大屏 | 不应优先于数据可信度 |

---

## 6. 推荐实现顺序

### Phase 0: Trading Event Ledger

在做 dashboard 前，先统一事件和状态对象。

必须稳定记录：

- `runId`
- `botId`
- `strategyId`
- `wakeId`
- `orderId`
- `fillId`
- `positionId`
- `tradeId`
- `symbol`
- `side`
- `size`
- `price`
- `fee`
- `slippage`
- `openedAt`
- `closedAt`
- `source`
- `simulatorVersion`
- `dataQuality`

### Phase 1: Trade Postmortem

每次 position close 后生成 postmortem。

最小字段：

```json
{
  "tradeId": "trade_001",
  "positionId": "pos_001",
  "botId": "trend-btc-trader",
  "symbol": "BTC-USD",
  "openedAt": "2026-05-21T00:00:00.000Z",
  "closedAt": "2026-05-21T00:10:00.000Z",
  "grossPnl": -0.07,
  "fees": 0.05,
  "estimatedSlippageCost": 0.02,
  "netPnl": -0.12,
  "classification": "strategy_loss",
  "rootCause": "Entered trend setup during low-volatility chop.",
  "lesson": "Trend bot should wait for volatility expansion.",
  "sampleContaminated": false,
  "sampleEligibleForTraining": true
}
```

### Phase 2: Risk and Execution Monitors

实现确定性 supervisor。

建议实现为一个服务，内部两个模块：

```text
Deterministic Supervisor
  ├── Risk Checks
  └── Execution Checks
```

UI 和数据对象上仍保留 Risk Monitor / Execution Monitor 两个角色，方便问责。

### Phase 3: Manager Dashboard Shell

先做简化页面：

```text
Desk Overview
Decision Queue
Latest Analyst Brief
Active Risk / Execution Alerts
Recent Trade Postmortems
Bot Drilldown Links
```

不要第一版就做完整大屏。

### Phase 4: Analyst Brief

Analyst Brief 应该基于：

- recent postmortems；
- active risk alerts；
- active execution alerts；
- strategy leaderboard snapshot；
- contaminated sample summary。

不要让 analyst 直接自由读取所有日志后生成长篇自然语言结论。

### Phase 5: Strategy Leaderboard

只有在 postmortem 和 contamination labeling 稳定后，再实现 leaderboard。

Leaderboard 第一版必须显示 sample status，而不是只显示 PnL。

### Phase 6: Portfolio Manager Bot

Portfolio Manager Bot 第一版只做 proposal：

- pause bot；
- reduce risk budget；
- promote bot；
- switch mode；
- wait for more data；
- investigate execution issue。

不直接执行。

### Phase 7: Manager Workflow

最后再实现：

- accept；
- reject；
- snooze；
- apply；
- audit trail；
- rollback；
- decision outcome tracking。

---

## 7. 数据模型改善建议

### 7.1 Manager Decision

当前问题：

- evidence 是字符串，无法追溯；
- 缺少 target；
- 缺少 action type；
- 缺少 expiry；
- 缺少 action risk；
- 缺少 applied result；
- 缺少 audit trail。

建议改为：

```json
{
  "schemaVersion": "stratium.manager-decision.v2",
  "decisionId": "dec_001",
  "createdAt": "2026-05-21T00:00:00.000Z",
  "createdBy": "portfolio_manager_bot",
  "severity": "medium",
  "status": "pending",
  "actionType": "pause_bot",
  "target": {
    "scope": "bot",
    "botId": "trend-btc-trader",
    "symbol": "BTC-USD"
  },
  "title": "Pause trend-btc-trader in low-volatility chop",
  "recommendation": "Switch trend-btc-trader to observe mode for 30 minutes or until ATR expands.",
  "whyNow": "Recent valid trades show repeated losses in low-volatility chop.",
  "expectedEffect": "Reduce strategy churn and fee drag.",
  "riskOfAction": "May miss a sudden trend continuation.",
  "confidence": 0.72,
  "evidenceRefs": [
    {
      "type": "trade_postmortem",
      "id": "pm_001"
    },
    {
      "type": "metric_window",
      "id": "mw_trend_24h"
    }
  ],
  "expiresAt": "2026-05-21T00:30:00.000Z",
  "approvedBy": null,
  "appliedAt": null,
  "auditTrailId": "audit_dec_001"
}
```

### 7.2 Trade Postmortem

建议增加：

```json
{
  "schemaVersion": "stratium.trade-postmortem.v2",
  "tradeId": "trade_001",
  "positionId": "pos_001",
  "botId": "trend-btc-trader",
  "strategyId": "trend_v3",
  "symbol": "BTC-USD",
  "entryOrderIds": ["ord_entry_001"],
  "exitOrderIds": ["ord_exit_001"],
  "fillIds": ["fill_001", "fill_002"],
  "openedAt": "2026-05-21T00:00:00.000Z",
  "closedAt": "2026-05-21T00:10:00.000Z",
  "grossPnl": -0.07,
  "fees": 0.05,
  "estimatedSlippageCost": 0.02,
  "netPnl": -0.12,
  "marketRegime": "low_vol_chop",
  "classification": "strategy_loss",
  "executionQuality": "normal",
  "dataQuality": "clean",
  "sampleContaminated": false,
  "sampleEligibleForTraining": true,
  "sampleEligibleForLeaderboard": true,
  "rootCause": "Entered trend setup during low-volatility chop.",
  "lesson": "Trend bot should wait for volatility expansion.",
  "nextRuleCandidate": "Require ATR expansion before trend entries.",
  "modelVersion": "model_name_or_id",
  "promptVersion": "strategy_prompt_v3"
}
```

### 7.3 Execution Alert

建议增加 contamination scope：

```json
{
  "schemaVersion": "stratium.execution-alert.v2",
  "alertId": "exec_001",
  "severity": "critical",
  "type": "limit_price_violation",
  "botId": "breakout-btc-trader",
  "symbol": "BTC-USD",
  "orderId": "ord_001",
  "fillId": "fill_001",
  "expectedLimitPrice": 100.0,
  "actualFillPrice": 101.5,
  "slippageBps": 150,
  "feeAmount": 0.05,
  "sampleContaminated": true,
  "contaminationScope": "single_trade",
  "affectsLeaderboard": true,
  "affectsTrainingMemory": true,
  "message": "Limit buy filled above limit price.",
  "createdAt": "2026-05-21T00:00:00.000Z"
}
```

### 7.4 Role Health

建议增加 freshness、coverage 和 blockedBy：

```json
{
  "schemaVersion": "stratium.role-health.v2",
  "role": "analyst",
  "roleInstanceId": "analyst_bot_v1",
  "status": "yellow",
  "lastInputEventAt": "2026-05-21T00:00:00.000Z",
  "lastOutputEventAt": "2026-05-21T00:04:00.000Z",
  "expectedCadence": "post_trade_or_15m",
  "freshness": "stale",
  "missingDuties": ["post_trade_review"],
  "blockedBy": [],
  "coverage": {
    "requiredReviews": 12,
    "completedReviews": 10,
    "missedReviews": 2
  }
}
```

### 7.5 Desk Brief

建议 Desk Brief 不只是 summary，还要包含 actionability：

```json
{
  "schemaVersion": "stratium.desk-brief.v2",
  "briefId": "brief_001",
  "status": "yellow",
  "summary": "Desk is slightly negative in low-volatility chop; trend and breakout bots show fee drag.",
  "whatChanged": [
    "BTC volatility compressed",
    "Trend bot closed two valid losing trades",
    "No critical execution issue detected"
  ],
  "affectedBots": ["trend-btc-trader", "breakout-btc-trader"],
  "rootCauseSummary": "Strategy mismatch with current market regime.",
  "recommendedActions": ["dec_001", "dec_002"],
  "riskAlerts": [],
  "executionAlerts": [],
  "contaminatedSamples": [],
  "watchNext": [
    "ATR expansion",
    "funding rate changes",
    "repeated fees > 30% of gross PnL"
  ],
  "generatedAt": "2026-05-21T00:00:00.000Z"
}
```

---

## 8. Dashboard UX 改善建议

### 8.1 首页信息层级

建议首页分三层：

```text
Level 1: Immediate Status
- Desk Status
- Risk Status
- Execution Status
- Data Quality
- Pending High-Severity Decisions

Level 2: Manager Actions
- Decision Queue
- Recommendation
- Why now
- Confidence
- Evidence
- Approve / Reject / Snooze

Level 3: Evidence and Investigation
- Analyst Brief
- Role Health
- Strategy Leaderboard
- Risk Board
- Execution Board
- Bot Drilldown
```

### 8.2 Decision Queue 每条建议需要更像交易审批单

每条 decision 建议显示：

```text
Action: Pause trend-btc-trader
Why now: 3 valid losses in low-vol chop, fees > 35% of gross loss
Confidence: 72%
Impact: Medium
Risk of action: May miss breakout continuation
Evidence: 2 postmortems, 1 metric window, 0 execution alerts
Expires: 30 minutes
Buttons: Approve / Reject / Snooze / Inspect Evidence
```

### 8.3 增加 Data Quality 状态

建议在顶部加入 `Data Quality`：

- Clean
- Partial
- Contaminated
- Stale
- Unknown

如果 Data Quality 不是 Clean，dashboard 应该降低 recommendation confidence，甚至禁止自动 apply。

### 8.4 Strategy Leaderboard 不要只按 PnL 排序

建议增加：

```text
Valid Trades
Contaminated Trades
Sample Status
Net PnL
Fee Drag
Max Drawdown
Risk Budget Used
Regime Fit
Recommendation
```

样本不足时显示：

```text
Status: Insufficient data
Recommendation: Continue observing
```

不要显示成“poor strategy”。

### 8.5 Bot Drilldown 应保留现有 bot dashboard 优势

现有 bot 自交易、自总结、自 memory 的页面仍然有价值。不要删除，而是下沉到 Bot Drilldown。

Manager 首屏看结论；调查时再进入 bot 细节。

---

## 9. 对 Open Questions 的建议答案

### Q1: Risk Monitor 和 Execution Monitor 首版分开还是合并？

建议：**实现上合并，角色上分开。**

```text
一个 Deterministic Supervisor Service
  ├── Risk Monitor module
  └── Execution Monitor module
```

这样可以减少工程量，同时 dashboard 仍然显示两个角色，保持问责清晰。

### Q2: Portfolio Manager 应在 post-trade review 前还是后？

建议：**后。**

Portfolio Manager 依赖 postmortem、risk alerts、execution alerts、leaderboard。如果这些不稳定，Portfolio Manager 的建议会缺少可信依据。

### Q3: 创建可靠 tradeId 的最小数据是什么？

建议至少需要：

```text
botId
symbol
positionId or position lifecycle group
entry order ids
exit order ids
fill ids
openedAt
closedAt
side
size
avg entry price
avg exit price
fees
realized PnL
```

如果 positionId 当前不存在，应先从 order/fill lifecycle 中合成。

### Q4: contaminated historical trades 是否默认排除？

建议：**默认从 training、leaderboard、strategy score 中排除。**

但要保留在 audit 和 investigation 页面中。

### Q5: manager decisions 是否直接改变 bot modes？

建议：**第一版不要。**

第一版只写 pending decision 或 strategy memo。第二版支持 dry-run apply。第三版再支持 audited apply。

### Q6: 如何区分样本不足和策略质量差？

建议增加 sample status：

```text
insufficient_data
valid_but_underperforming
valid_and_outperforming
contaminated
mixed_quality
```

Leaderboard 应显示有效样本数和置信度。

### Q7: green / yellow / red desk status 阈值如何定义？

建议第一版用确定性规则：

```text
Green:
- no active critical risk alert
- no active critical execution alert
- data quality clean
- analyst brief fresh
- drawdown within threshold

Yellow:
- non-critical risk alert
- stale analyst brief
- repeated small losses
- minor execution degradation
- insufficient but non-dangerous data

Red:
- hard risk breach
- invalid fill affecting active evaluation
- stale market data while holding exposure
- severe drawdown
- open order risk breach
- contaminated data used in training or leaderboard

Gray:
- module not implemented
- insufficient data
- role not yet producing outputs
```

---

## 10. Revised MVP Page Structure

建议第一版 manager page 改为：

```text
┌────────────────────────────────────────────────────────────────────┐
│ Header: Stratium Trading Hall                                      │
│ Desk: YELLOW | Risk: GREEN | Execution: GREEN | Data: CLEAN        │
├────────────────────────────────────────────────────────────────────┤
│ Desk Overview                                                      │
│ Net PnL | Drawdown | Exposure | Active Alerts | Pending Decisions  │
├────────────────────────────────────┬───────────────────────────────┤
│ Decision Queue                     │ Latest Analyst Brief          │
│ - action                           │ - summary                     │
│ - why now                          │ - root cause                  │
│ - confidence                       │ - watch next                  │
│ - evidence refs                    │ - affected bots               │
├────────────────────────────────────┴───────────────────────────────┤
│ Active Alerts                                                       │
│ Risk Alerts | Execution Alerts | Data Quality Issues               │
├────────────────────────────────────────────────────────────────────┤
│ Recent Trade Postmortems                                            │
│ Bot | Trade | Net PnL | Classification | Quality | Lesson          │
├────────────────────────────────────────────────────────────────────┤
│ Bot Summary                                                         │
│ Bot | Mode | Valid Trades | Net PnL | Sample Status | Recommendation│
└────────────────────────────────────────────────────────────────────┘
```

完整 Role Health Matrix、Strategy Leaderboard、Risk Board、Execution Board 可以作为第二版展开。

---

## 11. 修改后的验收标准

第一版成功标准建议改为：

manager 能在 1 分钟内回答：

1. 当前 desk 是 green、yellow、red 还是 gray？
2. 当前是否有 data quality 或 execution contamination？
3. 最近一笔关闭交易的亏损原因是什么？
4. 亏损属于 strategy、execution、risk、data 还是 unknown？
5. 哪个 bot 当前最需要关注？
6. 是否有 pending decision？
7. 推荐动作是什么？
8. 支持证据能否追溯到 postmortem、alert 或 metric window？
9. 是否有样本被排除出 training 或 leaderboard？
10. manager 的 approve / reject / snooze 是否被记录到 audit trail？

---

## 12. 建议修改 PR Checklist

### P0 Checklist

- [ ] 定义 `tradeId` 生成规则
- [ ] 定义 position lifecycle
- [ ] 定义 order / fill / trade 归因关系
- [ ] 实现 trade postmortem persistence
- [ ] 实现 execution contamination labeling
- [ ] 实现 risk check deterministic rules
- [ ] 实现 execution check deterministic rules
- [ ] Manager Decision 改为结构化 `evidenceRefs`
- [ ] Dashboard 顶部增加 `Data Quality`
- [ ] contaminated samples 默认排除 training / leaderboard

### P1 Checklist

- [ ] 实现 simplified Desk Overview
- [ ] 实现 Decision Queue
- [ ] 实现 Latest Analyst Brief
- [ ] 实现 Active Alerts panel
- [ ] 实现 Recent Postmortems table
- [ ] 实现 Bot Drilldown links
- [ ] Role Health 先显示 freshness / missing duties
- [ ] Leaderboard 增加 sample size status

### P2 Checklist

- [ ] Portfolio Manager Bot 只生成 proposal
- [ ] Manager approve / reject / snooze audit trail
- [ ] Apply recommendation dry-run
- [ ] Decision outcome tracking
- [ ] Full Role Health Matrix
- [ ] Full Strategy Leaderboard
- [ ] Full Risk Board
- [ ] Full Execution Quality Board

---

## 13. 最终建议

建议对当前设计做 **Revise and approve MVP**。

保留的方向：

- manager-facing cockpit；
- clear role accountability；
- decision queue；
- risk monitor；
- execution monitor；
- analyst brief；
- trade postmortem；
- strategy leaderboard；
- bot drilldown。

需要调整的方向：

- 不要第一版实现完整 Trading Hall；
- 不要过早实现 Portfolio Manager 自动调仓；
- 不要让 manager decision 缺少结构化 evidence；
- 不要让 contaminated samples 进入 bot scoring 或 memory；
- 不要只用 PnL 排名判断 bot 好坏；
- 不要把 dashboard 做成漂亮但不可审计的大屏。

推荐第一版聚焦：

```text
Trade lifecycle correctness
+ Post-trade review
+ Execution quality validation
+ Risk checks
+ Decision Queue
+ Manager summary
```

这样能在保留现有单 bot 自交易 / 自总结价值的同时，逐步升级到真正有运营价值的 Trading Hall。
