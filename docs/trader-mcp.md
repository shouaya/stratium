# Trader MCP

最后更新：2026-04-14

## 目标

在 Stratium 的 Hyperliquid 兼容 API 之上，提供一个适合 AI Agent 调用的 Trader MCP。

这个 MCP 以执行为中心：

- 不把 signer 密钥暴露给模型
- 由 MCP 自己管理 nonce
- 对模型暴露 typed tools，而不是要求模型自己拼原始 `/info` 和 `/exchange` 请求

## 运行模型

当前实现位于：

- `apps/trader-mcp/src/index.ts`
- `apps/trader-mcp/src/client.ts`
- `apps/trader-mcp/src/http-server.ts`
- `apps/trader-mcp/src/tools.ts`

当前传输方式：

- 默认使用 streamable HTTP MCP server
- `stdio` 仅作为本地开发回退模式保留

当前后端目标：

- Stratium Fastify API

当前认证引导方式：

1. 推荐方式：平台 Bearer Token 透传
   - MCP 客户端直接发送 `Authorization: Bearer <platform-token>`
   - trader-mcp 通过 `GET /api/bot-credentials` 复用现有 Stratium 登录态与 bot/account 绑定
2. 回退方式：前端账号登录引导
   - `STRATIUM_FRONTEND_USERNAME`
   - `STRATIUM_FRONTEND_PASSWORD`
   - 然后请求 `GET /api/bot-credentials`
3. 回退方式：直接注入 bot 凭证
   - `STRATIUM_BOT_ACCOUNT_ID`
   - `STRATIUM_BOT_VAULT_ADDRESS`
   - `STRATIUM_BOT_SIGNER_ADDRESS`
   - `STRATIUM_BOT_API_SECRET`

通用后端地址：

- `STRATIUM_API_BASE_URL`
  默认值为 `http://127.0.0.1:4000`

默认 MCP 地址：

- `http://127.0.0.1:4600/mcp`

## 安全模型

模型不会接触到以下内容：

- bot `apiSecret`
- 原始 signer 引导流程
- nonce 控制权

MCP 服务自己负责：

- 加载 bot 凭证
- HMAC 签名
- nonce 生成
- 请求发送到 Stratium

这与路线图要求一致，也就是 signer 使用和 nonce 策略必须由 MCP 管理，而不是由模型管理。

## 部署模型

当前主形态是远端 MCP 服务。

也就是说，一个 bot 或 AI 客户端理论上只需要：

1. 一个 MCP URL
2. 一个 Stratium 平台 Bearer Token

客户端不需要自己处理：

- bot signer 密钥
- nonce 管理
- 直接调用 `/api/auth/login` 做引导

本地开发时，`docker compose up` 会暴露：

- Web UI：`http://localhost:3000`
- API：`http://localhost:4000`
- Trader MCP：`http://localhost:4600/mcp`

生产环境 compose 也采用同样的远端 MCP 形态。

## 客户端接入模型

推荐客户端流程：

1. 先通过现有登录流程拿到普通 Stratium frontend token
2. 连接 MCP URL：`http://<host>:4600/mcp`
3. 在 MCP HTTP 请求上附带 `Authorization: Bearer <token>`
4. 正常调用 trader tools

MCP 服务内部会：

1. 复用 Stratium API 的现有认证判断访问权限
2. 通过 `GET /api/bot-credentials` 拉取当前 session 绑定的 bot 凭证
3. 代表该 session 所属账户对私有 `/info` 与 `/exchange` 请求进行签名

这样 MCP 的认证方式就和现在的 `web -> api` 用户与账户体系保持一致。

## 工具列表

### 市场工具

- `stratium_get_meta`
  返回 Hyperliquid 兼容的 `meta`
- `stratium_get_meta_and_asset_ctxs`
  返回 Hyperliquid 兼容的 `metaAndAssetCtxs`
- `stratium_get_all_mids`
  返回 Hyperliquid 兼容的 `allMids`
- `stratium_get_l2_book`
  输入：
  `coin`
- `stratium_get_candles`
  输入：
  `coin`, `interval`, `startTime`, `endTime`
- `stratium_get_recent_trades`
  输入：
  `coin`

### 账户工具

- `stratium_get_clearinghouse_state`
  返回当前 MCP 认证账户的私有账户状态
- `stratium_get_open_orders`
  返回当前 MCP 认证账户的开放订单
- `stratium_get_frontend_open_orders`
  返回带 trigger/group 元信息的开放订单，适合交易前端使用
- `stratium_get_order_status`
  输入：
  `oid`
  支持数值 oid 或字符串 cloid
- `stratium_get_exchange_status`
  返回交易所健康状态 / 可用状态

### 交易工具

- `stratium_place_order`
  输入：
  `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `grouping?`, `trigger?`
- `stratium_place_orders`
  输入：
  `grouping`, `orders[]`
  支持 `normalTpsl` 和 `positionTpsl` 分组下单
- `stratium_cancel_order`
  输入：
  `oid`, `asset?`
- `stratium_cancel_order_by_cloid`
  输入：
  `cloid`, `asset?`
- `stratium_modify_order`
  输入：
  `oid`, `asset?`, `isBuy`, `price`, `size`, `reduceOnly?`, `tif?`, `cloid?`, `trigger?`
- `stratium_batch_modify`
  输入：
  `modifies[]`
- `stratium_schedule_cancel`
  输入：
  `time`

当前支持的 grouping 值：

- `na`
- `normalTpsl`
- `positionTpsl`

## 输出结构

每个工具都会返回：

1. `structuredContent`
   给程序消费的结构化结果，包含：
   - `operation`
   - `summary`
   - `raw`
2. `content`
   对同一份结果的文本化拷贝，便于更广泛的 MCP 客户端兼容

`summary` 的语义：

- 查询类工具通常直接镜像原始 API 响应
- 交易类工具会把 Hyperliquid 风格的 `statuses[]` 归一化成更适合模型理解的摘要，例如：
  - accepted / rejected
  - resting / filled
  - `oid`
  - `cloid`
  - error string

## Nonce 行为

Nonce 不是工具输入项。

当前策略：

- MCP client 内部维护一个按毫秒递增的 nonce 游标
- 每次私有签名请求都会分配新的 nonce
- MCP 进程内部会避免 nonce 重复

这与当前 Stratium API 的行为一致，因为 Stratium 会拒绝 replay nonce。

## AI Agent 调用建议

推荐调用顺序：

1. 先查看市场：
   - `stratium_get_meta`
   - `stratium_get_meta_and_asset_ctxs`
   - `stratium_get_all_mids`
   - `stratium_get_l2_book`
2. 再查看账户：
   - `stratium_get_clearinghouse_state`
   - `stratium_get_frontend_open_orders`
3. 再执行交易：
   - `stratium_place_order` 或 `stratium_place_orders`
   - `stratium_modify_order`
   - `stratium_cancel_order`
4. 最后确认结果：
   - `stratium_get_order_status`
   - `stratium_get_frontend_open_orders`

给模型的推荐推理规则：

- 优先调用 typed tools，不要让模型自己推导底层 `/exchange` payload
- 先看 `summary`
- 只有在 `summary` 不够时再看 `raw`

## 安全边界

当前实现已经保护了密钥，但还没有加入更高层的策略控制，例如：

- 最大下单数量限制
- 最大杠杆限制
- 交易品种白名单
- 策略审批流程
- dry-run 与 live-execute 的策略隔离

如果要对 AI 做更广泛的自动化放权，这些控制建议在前面先补齐。

## 当前验证状态

当前已经完成：

- `pnpm --filter @stratium/trader-mcp lint`
- `pnpm --filter @stratium/trader-mcp test`
- `pnpm --filter @stratium/trader-mcp build`

当前测试覆盖包括：

- streamable HTTP MCP server 启动
- bearer token 透传认证
- frontend 登录引导到 bot 凭证
- 私有请求签名生成
- 直接 bot 凭证模式
- 交易状态摘要归一化
- MCP client 对 HTTP endpoint 的集成调用
- MCP tool 对 mocked Stratium API 的真实链路执行

## 当前限制

1. 当前 MCP 还是以 request/response 工具为主。
   还没有暴露 websocket 订阅能力。
2. 它遵循的是 Stratium 当前本地 signer 模型。
   还没有实现真实 Hyperliquid 签名恢复逻辑。
3. 当前重点是执行。
   replay、PnL 分析、策略反馈工具还不在这一版里。

## 本地启动示例

示例环境变量：

```bash
STRATIUM_MCP_API_BASE_URL=http://localhost:4000
TRADER_MCP_PORT=4600
STRATIUM_MCP_DEBUG_LOG_PATH=logs/trader-mcp-http.ndjson
```

启动命令：

```bash
docker compose up trader-mcp
```

然后让 MCP 客户端连接：

```text
http://localhost:4600/mcp
```

并附带：

```text
Authorization: Bearer <你的 Stratium frontend token>
```

如果你要排查 Codex 到 MCP 或 MCP 到 Stratium API 的连通性，可以直接看日志文件：

```text
logs/trader-mcp-http.ndjson
```

该文件会按 JSON Lines 追加记录：

- 入站 MCP HTTP request / response
- trader-mcp 发往 Stratium API 的 HTTP request / response
- request / response headers
- 原始 body

## 最小接入结论

任何支持 streamable HTTP 的 MCP 客户端，都可以直接接这个服务。

客户端真正需要提供的只有：

1. MCP URL
2. Stratium bearer token

MCP 服务会自己处理：

- bot 凭证读取
- 请求签名
- nonce 生成
- 请求归一化
