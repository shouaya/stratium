# Stratium

![Stratium UI](docs/stratium.png)

Stratium is a local trading simulation platform.

If this is your first time using the project, you can think of it as:

- a trading demo site you can run locally
- a simulation environment with default accounts
- a practical sandbox for testing orders, checking account changes, and learning the workflow

## Prerequisites

You only need to install two things before getting started.

### 1. Install Docker

Official installation guide:

- Docker / Docker Compose: https://docs.docker.com/get-started/get-docker/

After installation, make sure Docker is open and running.

### 2. Install `make`

Official guide:

- make: https://www.gnu.org/software/make/

## First-Time Setup

For a fresh setup, you only need two commands.

### Step 1: Initialize

Enter the project directory and run:

```bash
make init
```

This step will automatically:

- create local configuration files
- prepare the runtime environment
- clear stale runtime events, orders, positions, fills, and trigger data
- start the database and initialization tools
- wait for the initialization tools to become ready
- seed default accounts and base data
- import a recent slice of Hyperliquid market data

The first run can take a while. That is expected.

### Step 2: Start

Once initialization is complete, run:

```bash
make up
```

After the services start, open the site in your browser.

## Daily Start and Stop

After the first successful initialization, you usually only need:

```bash
make up
```

To stop the project:

```bash
make down
```

## Local URLs

- Trader UI: `http://localhost:5000`
- Admin UI: `http://localhost:5000/admin`
- Database viewer: `http://localhost:8080`

Most users only need the first URL.

Inside Docker Compose, services should call each other through internal service DNS names and container ports, for example `http://api:4000`.
`http://localhost:6100` is only for the browser or host-side tools.

For same-origin deployments behind a reverse proxy, leave `NEXT_PUBLIC_API_BASE_URL` empty so the web app uses the current site's `/api` and `/ws`.


## Default Accounts

```text
Trader
username: demo
password: demo123456

Exchange admin
username: admin
password: admin123456
```

## Online Demo

- https://stratium.weget.jp/

## Connect Codex to Trader MCP

If you want Codex to place orders through Stratium using MCP, follow this flow.

### 1. Start the local stack

Make sure the project has already been initialized, then run:

```bash
make up
```

The default Trader MCP endpoint is:

```text
http://localhost:4600/mcp
```

If you only want to start `trader-mcp`, you can also run:

```bash
docker compose up trader-mcp
```

### 2. Add Trader MCP to Codex

Codex can add a remote MCP server through the CLI:

```bash
codex mcp add stratiumTrader --url http://localhost:4600/mcp
codex mcp list
```

You can also add it directly to `~/.codex/config.toml`:

```toml
[mcp_servers.stratiumTrader]
url = "http://localhost:4600/mcp"
bearer_token_env_var = "STRATIUM_FRONTEND_TOKEN"
```

### 3. Pass Stratium authentication to Trader MCP

The recommended authentication model is not to give bot secrets directly to Codex.
Instead:

1. Log in to Stratium normally and get a frontend token.
2. Expose that token to Codex when it connects to Trader MCP:

```bash
export STRATIUM_FRONTEND_TOKEN='your token'
```

`trader-mcp` will then fetch the bot credentials for the currently authenticated user and handle signing and nonce management on behalf of the model.

### 4. Minimal Codex prompt example

You can ask Codex directly like this:

```text
Use the stratiumTrader MCP:
1. Call stratium_get_meta_and_asset_ctxs to inspect the current BTC market state.
2. Call stratium_get_clearinghouse_state to check my available margin.
3. If margin is sufficient, place a BTC order.
```

### 5. Minimal direct order example

If you want a very direct prompt:

```text
Use stratiumTrader to place a normal BTC market buy order with size 1.
```

## Useful Trader MCP Tools

- Market data:
  `stratium_get_meta`
  `stratium_get_meta_and_asset_ctxs`
  `stratium_get_all_mids`
  `stratium_get_l2_book`
- Account queries:
  `stratium_get_clearinghouse_state`
  `stratium_get_open_orders`
  `stratium_get_frontend_open_orders`
  `stratium_get_order_status`
- Trading:
  `stratium_place_order`
  `stratium_place_orders`
  `stratium_modify_order`
  `stratium_cancel_order`
  `stratium_cancel_order_by_cloid`

## FAQ

- The first startup is slow because the environment and seed data need to be prepared.
- If the UI does not load, first check that Docker is still running.
- If ports `5000`, `6100`, or `8080` are occupied, the pages may not open.
- If you close the terminal that started `make up`, the services will stop with it.

## Further Reading

If everything is running and you want more detail, continue with:

- [PH1 architecture](docs/ph1-architecture.md)
- [Data flow](docs/data-flow.md)
- [Event spec](docs/event-spec.md)
- [Order rules](docs/order-rules.md)
- [Margin rules](docs/margin-rules.md)
- [Hyperliquid API compatibility](docs/hyperliquid-api-compatibility.md)
- [Hyperliquid WebSocket compatibility](docs/hyperliquid-websocket-compatibility.md)
- [Trader MCP guide](docs/trader-mcp.md)
