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

## 常见问题

- 第一次启动比较慢是正常的，因为系统要先把运行环境准备好
- 如果浏览器打不开页面，先确认 Docker 还在运行
- 如果 `3000` 或 `8080` 端口被别的软件占用，页面可能打不开
- 关闭当前终端后，`make up` 启动的服务也会一起停止

## 进一步阅读

如果你已经成功跑起来，后面想再了解更详细的设计和规则，可以继续看这些文档：

- [PH1 架构说明](docs/ph1-architecture.md)
- [数据流](docs/data-flow.md)
- [事件规范](docs/event-spec.md)
- [订单规则](docs/order-rules.md)
- [保证金规则](docs/margin-rules.md)
- [Hyperliquid API 兼容说明](docs/hyperliquid-api-compatibility.md)
- [Hyperliquid WebSocket 兼容说明](docs/hyperliquid-websocket-compatibility.md)
- [Trader MCP 接入说明](docs/trader-mcp.md)
