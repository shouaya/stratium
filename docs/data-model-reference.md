# 数据模型说明

这份文档说明当前项目里主要数据表的职责、哪些表是事实源、哪些表是投影，以及市场数据和交易状态是如何流转的。

适用场景：

- 排查 replay 问题
- 做一轮干净的测试前清数据
- 理解为什么删掉某些数据后又会重新出现
- 判断哪些数据适合用来做复盘

## 表的分类

当前项目里的表可以分成三类：

1. 交易事实表
   - 记录“发生过什么”
   - 核心代表：`SimulationEvent`

2. 交易配置表
   - 记录交易品种配置
   - 核心代表：`SymbolConfig`

3. 交易状态投影表
   - 记录“当前状态是什么”
   - 代表：`Account`、`Order`、`Position`、`Fill`

4. 市场历史表
   - 记录 Hyperliquid 公共市场数据，以及本地交易引擎吃进去的价格输入
   - 代表：`MarketTrade`、`MarketCandle`、`MarketVolumeRecord`、`MarketBookSnapshot`、`MarketBookLevel`

## 事实源与投影

对交易引擎来说，主要事实源是：

- `SimulationEvent`

这些表是由交易事实或当前引擎状态投影出来的：

- `Account`
- `Order`
- `Position`
- `Fill`
- `MarketTick`

这件事很重要，因为它直接决定了“删库是否真的清空状态”：

- 只删 `Order` 不等于真正重置
- 只要 `SimulationEvent` 还在，API 启动 replay 或后续持久化时，订单就可能被重新写回

## 数据流转图

```mermaid
flowchart LR
    A[Hyperliquid WS\nl2Book trades candle activeAssetCtx] --> B[apps/api hyperliquid-market.ts]
    B --> C[MarketBookSnapshot]
    B --> D[MarketBookLevel]
    B --> E[MarketTrade]
    B --> F[MarketCandle]
    B --> G[MarketAssetContext]
    B --> H[派生 MarketTick]

    H --> I[Trading Engine]
    J[POST /api/orders] --> I
    K[POST /api/orders/cancel] --> I

    I --> L[SimulationEvent]
    I --> M[Account]
    I --> N[Order]
    I --> O[Position]
    I --> P[Fill]
    I --> Q[MarketTick]

    L --> R[Replay / bootstrapEngine]
    R --> I

    C --> S[Web UI]
    D --> S
    E --> S
    F --> S
    G --> S
    M --> S
    N --> S
    O --> S
    P --> S
    Q --> S
```

## 交易相关表

### `SymbolConfig`

用途：

- 交易品种配置表
- 为本地交易引擎提供 symbol 级别配置
- 作为 Hyperliquid 官方元数据的本地缓存

官方对齐字段：

- `assetIndex`
- `coin`
- `symbol`
- `quoteAsset`
- `contractType`
- `contractMultiplier`
- `szDecimals`
- `maxPriceDecimals`
- `maxLeverage`
- `marginTableId`
- `onlyIsolated`
- `marginMode`
- `isDelisted`
- `isActive`
- `baseTakerFeeRate`
- `baseMakerFeeRate`

本地模拟字段：

- `engineDefaultLeverage`
- `engineMaintenanceMarginRate`
- `engineBaseSlippageBps`
- `enginePartialFillEnabled`

说明：

- 官方字段通过 seeder 从 Hyperliquid `meta` 拉取
- 本地模拟字段用于当前 PH1 引擎，不等同于 Hyperliquid 真实撮合逻辑
- API 启动时会优先从这张表读取当前交易品种配置

### `SimulationEvent`

用途：

- 交易事件总日志
- 交易 replay 的事实源
- API 启动时用它重建内存里的引擎状态

常见内容：

- 下单请求
- 订单接受
- 订单拒绝
- 撤单
- 市场 tick 到达
- 订单成交
- 部分成交
- 账户和保证金更新

为什么重要：

- 它解释了“状态为什么会变成现在这样”
- 如果你想做真正的交易状态重置，这张表通常必须一起清

### `Account`

用途：

- 账户当前状态快照

常见内容：

- 钱包余额
- 可用余额
- 仓位保证金
- 订单保证金
- 权益
- 已实现 / 未实现盈亏
- 风险率

说明：

- 这是当前状态表，不是事实源
- 由引擎当前状态持久化出来

### `Order`

用途：

- 当前订单状态

常见内容：

- 方向
- 订单类型
- 状态
- 数量
- 已成交数量
- 剩余数量
- 限价
- 拒单原因

说明：

- 这张表不是事实源
- 只删它，不会真正消除历史订单

### `Fill`

用途：

- 记录订单实际成交明细

常见内容：

- `orderId`
- 成交价
- 成交数量
- 手续费
- 滑点

说明：

- 一张订单在更完整的执行模型里可以对应多条 `Fill`
- 当前执行模型还比较简化，但这张表仍然是查看真实成交结果的正确位置

### `Position`

用途：

- 当前持仓状态快照

常见内容：

- 方向
- 数量
- 开仓均价
- 标记价
- 已实现 / 未实现盈亏
- 保证金
- 强平价

说明：

- 当前状态表
- 由引擎持仓状态持久化出来

### `LedgerEntry`

用途：

- 计划中的账户资金流水表

典型场景：

- 手续费扣减
- 已实现盈亏入账
- 保证金释放
- 强平相关资金变化

当前状态：

- schema 已有
- 但还没有完整接入当前持久化链路

### `LiquidationEvent`

用途：

- 计划中的强平审计表

典型内容：

- 触发价格
- 执行价格
- 执行数量
- 强平订单 id

当前状态：

- schema 已有
- 但完整强平流程还没有全部做完

## 市场相关表

### `MarketBookSnapshot`

用途：

- 某一时刻订单簿快照的头记录

常见内容：

- 数据源
- coin
- symbol
- best bid
- best ask
- spread
- 抓取时间

适合用来：

- 找某个时点的盘口头部状态
- 关联 `MarketBookLevel`

### `MarketBookLevel`

用途：

- 某次订单簿快照里的逐档深度

常见内容：

- snapshot id
- 买 / 卖方向
- 档位索引
- 价格
- 数量
- 该档订单数

适合用来：

- 重建前端 order book
- 看某段时间的深度结构
- 做盘口复盘

### `MarketTrade`

用途：

- Hyperliquid 公共逐笔成交历史

常见内容：

- 买 / 卖方向
- 成交价
- 成交量
- 成交时间

适合用来：

- trade tape
- 看短时执行节奏
- 判断价格变化是通过真实成交发生的，还是只是盘口变化

### `MarketCandle`

用途：

- K 线历史

常见内容：

- 周期
- 开盘时间
- 收盘时间
- 开高低收
- 成交量
- 成交笔数

适合用来：

- 画图
- 长时间范围复盘
- 快速看趋势和阶段结构

当前建议定位：

- `1m` 是主要历史粒度
- 更细粒度细节靠服务器在线期间持续同步的 WS 数据补足

### `MarketVolumeRecord`

用途：

- 独立的成交量历史记录表
- 让成交量查询和统计不必直接依赖整张 `MarketCandle`

常见内容：

- 周期
- bucket 开始时间
- bucket 结束时间
- volume
- tradeCount

说明：

- 当前这张表的数据来自 Hyperliquid candle 同步
- 它是从 candle 派生出来的成交量视图，不是新的事实源
- 适合单独做 volume 图、成交量复盘和统计查询

适合用来：

- 查某段时间的成交量变化
- 直接给前端 volume 图或 volume API
- 做 volume 异常检测

### `MarketAssetContext`

用途：

- 市场上下文历史快照

常见内容：

- 标记价
- 中间价
- 预言机价
- 资金费率
- 持仓量
- 前一日价格
- 24h 名义成交额
- 抓取时间

说明：

- 之前它更像一张“当前状态表”
- 现在已经改成历史追加表
- 页面如果只要最新值，应按 `capturedAt desc limit 1` 查询

适合用来：

- 看 funding
- 对比 mark 和 oracle
- 观察某笔交易前后的 open interest 和市场状态

### `MarketTick`

用途：

- 本地交易引擎实际使用的价格输入记录

常见内容：

- bid
- ask
- last
- spread
- volatility tag
- tick time

关键区别：

- 这张表记录的是本地引擎实际吃进去的价格点
- 它不等同于交易所逐笔成交历史

适合用来：

- 解释为什么本地模拟单会在某个价格成交
- 对比引擎输入和外部公共市场状态

## 遇到问题时该先看哪张表

如果你要回答的是具体问题，可以从这里开始：

- 为什么删了订单又回来了？
  - 先看 `SimulationEvent`
  - 再看 `Order`

- 为什么这笔单在这个价格成交？
  - `Fill`
  - `MarketTick`
  - `MarketTrade`
  - `MarketBookSnapshot` + `MarketBookLevel`

- 某一时刻市场到底长什么样？
- `MarketCandle`
- `MarketVolumeRecord`
- `MarketTrade`
- `MarketBookSnapshot`
- `MarketBookLevel`
  - `MarketAssetContext`

- 当前账户状态是什么？
  - `Account`
  - `Position`

- 重启后能不能重建交易状态？
  - 可以，主要依赖 `SimulationEvent`

## 重置数据时的建议

如果你想做一次真正的交易状态重置，建议一起清掉：

- `SimulationEvent`
- `Order`
- `Fill`
- `Position`
- `Account`
- `MarketTick`

如果你还想把市场历史也清掉，再一起清：

- `MarketBookSnapshot`
- `MarketBookLevel`
- `MarketTrade`
- `MarketCandle`
- `MarketAssetContext`

不要假设只删 `Order` 就足够。

## 当前未完全闭合的部分

下面两张表 schema 已经存在，但还不能视为完整可依赖的审计来源：

- `LedgerEntry`
- `LiquidationEvent`

原因是：

- 它们还没有完整接入当前交易执行和持久化闭环
- 所以当前复盘时不要把它们当成最终可信来源
