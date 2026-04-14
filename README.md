# Stratium

![Stratium UI](docs/stratium.png)

Stratium 是一个本地交易模拟平台。

如果你是第一次接触这个项目，可以把它理解成：

- 一个可以在本地打开的交易演示站
- 一个带默认账号的模拟环境
- 一个适合测试下单、看账户变化、熟悉流程的工具

## 你只需要先安装两个东西

### 1. 安装 Docker

官方安装说明：

- Docker / Docker Compose: https://docs.docker.com/get-started/get-docker/

安装完成后，请先打开 Docker，让它保持运行状态。

### 2. 安装 make

官方说明：

- make: https://www.gnu.org/software/make/

## 第一次使用

第一次使用只要执行 2 条命令。

### 第 1 条：初始化

先进入项目目录，然后执行：

```bash
make init
```

这一步会自动帮你完成：

- 创建本地配置文件
- 准备项目运行需要的环境
- 启动数据库和初始化工具
- 等待初始化工具准备完成
- 导入默认账号和基础数据
- 导入最近一段 Hyperliquid 市场数据

第一次执行会比较慢，这是正常的。

### 第 2 条：启动

初始化完成后，执行：

```bash
make up
```

看到服务启动后，就可以打开浏览器使用了。

## 以后每次启动

第一次初始化成功之后，以后每次只需要执行这一条：

```bash
make up
```

如果你要停止项目：

```bash
make down
```

## 打开哪个地址

- 普通用户页面：http://localhost:3000
- 管理员页面：http://localhost:3000/admin
- 数据库查看页面：http://localhost:8080

大多数用户只需要打开第一个地址。

## 默认账号

```text
普通用户
username: demo
password: demo123456

交易所管理员
username: admin
password: admin123456
```

## 在线体验

- https://stratium.weget.jp/

## 用 Codex 连接 Trader MCP 并下单

如果你希望让 Codex 直接通过 MCP 调用 Stratium 下单，可以按下面的顺序来。

### 1. 先启动本地服务

先确保项目已经初始化完成，然后启动：

```bash
make up
```

Trader MCP 默认地址是：

```text
http://localhost:4600/mcp
```

如果你只想单独启动 trader-mcp，也可以执行：

```bash
docker compose up trader-mcp
```

### 2. 把 Trader MCP 加到 Codex

Codex 支持通过 CLI 把一个远端 MCP server 加进配置里。

```bash
codex mcp add stratiumTrader --url http://localhost:4600/mcp
codex mcp list
```

你也可以直接写到 `~/.codex/config.toml`：

```toml
[mcp_servers.stratiumTrader]
url = "http://localhost:4600/mcp"
bearer_token_env_var = "STRATIUM_FRONTEND_TOKEN"
```

### 3. 给 Trader MCP 带上 Stratium 登录态

Trader MCP 当前推荐的认证方式不是直接把 bot 密钥交给 Codex，而是：

1. 先通过 Stratium 正常登录，拿到 frontend token
2. 让 Codex 连接 Trader MCP 时附带：

```text
export STRATIUM_FRONTEND_TOKEN='你的 token'
```

这样 trader-mcp 会自动去后端读取当前用户绑定的 bot 凭证，并代为完成签名和 nonce 管理。

### 4. 如果你想让 Codex 直接下一个最小示例单

你也可以把目标说得更直接一些：

```text
 通过 stratiumTrader 下一个普通市价BTC买单 size是1
```