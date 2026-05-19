# Stratium Trader Bot

`@stratium/trader-bot` is the native Stratium AI trader runner.

It follows the same startup style as the Witchworks bot runner:

```bash
make trader-bot-run-once ACCOUNT=demo PASSWORD=demo123456 BOT_ID=local-demo-trader
```

Or directly:

```bash
pnpm --filter @stratium/trader-bot run:once -- \
  --api-url http://localhost:6100 \
  --mcp-url http://localhost:4600/mcp \
  --email demo \
  --password demo123456 \
  --bot-id local-demo-trader \
  --mode paper_execute \
  --planner codex \
  --symbol BTC-USD \
  --codex-bin codex \
  --codex-args "exec --sandbox read-only --ephemeral --ignore-rules --color never" \
  --codex-prompt-mode stdin
```

## Runtime Contract

The bot logs in to the Stratium API as a frontend account and receives the account-scoped platform token.

All market/account reads and trading actions go through Trader MCP:

- market context: `stratium_get_all_mids`, `stratium_get_l2_book`
- account context: `stratium_get_clearinghouse_state`, `stratium_get_open_orders`
- execution: `stratium_place_order`, `stratium_cancel_order`, `stratium_cancel_order_by_cloid`
- admin dashboard telemetry: `stratium_report_trader_bot_wake`

Wake telemetry includes the latest strategy snapshot, validated plan, memory summaries, score breakdown, risk decision counts, and execution results.

The bot does not load signer secrets directly. Trader MCP fetches the bot credentials for the authenticated account and handles signing and nonce generation.

## Modes

- `shadow`
  plans and risk-checks actions, but does not submit trade tools
- `approval`
  marks approved actions as pending approval
- `paper_execute`
  submits approved order/cancel actions through Trader MCP

## Planners

- `codex`
  invokes Codex CLI for a JSON trading plan, validates it locally, and applies a small active-simulation fallback when Codex returns observe-only in `paper_execute`
- `baseline`
  deterministic diagnostic probe for validating execution, scoring, memory, and telemetry paths
- `dry-run`
  observe-only smoke test planner
