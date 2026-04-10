# Hyperliquid Compatibility and MCP Roadmap

Last updated: 2026-04-10

## Goal

Bring Stratium's private bot-facing API and websocket layer close enough to Hyperliquid that:

1. strategy bots can migrate with minimal rewrite
2. an MCP layer can be built on top of the same surface
3. AI agents such as Codex can execute, analyze, adjust, and replay strategies through the MCP layer

## Execution Order

### 1. Align private API and websocket with Hyperliquid

Scope:

- extend private `POST /exchange`
- complete private `POST /info`
- add Hyperliquid-style private websocket/user stream layer
- keep current internal UI endpoints only as internal support surfaces

Target areas:

- order lifecycle
- cancel lifecycle
- modify lifecycle
- trigger order lifecycle
- account state queries
- order state queries
- user events
- user fills
- order updates

Completion criteria:

- bot can use private API without UI-only routes
- user websocket stream exposes Hyperliquid-style events
- Web and bot both have a stable path on the same compatibility model
- signer and nonce model are stable enough for bot execution

Deliverables:

- code changes in `apps/api`
- compatibility tests
- stable private HTTP + WS behavior

### 2. Test and validate item 1

Scope:

- unit tests
- route tests
- websocket tests
- integration-style flow tests

Must cover:

- order
- cancel
- cancel by cloid
- modify
- batch modify
- reduce only
- trigger
- clearinghouse state
- open orders
- order status
- signer auth
- nonce replay rejection
- websocket event delivery

Completion criteria:

- all relevant API tests pass
- websocket compatibility tests pass
- no regression in current Web path

Deliverables:

- passing `pnpm --filter @stratium/api test`
- any additional websocket test fixtures needed

### 3. Produce final API and websocket documentation for item 1

Scope:

- private HTTP API doc
- websocket doc
- auth doc
- nonce doc
- error behavior doc

Must include:

- request schemas
- response schemas
- field definitions
- auth flow
- signer model
- nonce rules
- supported actions
- unsupported / partial behaviors
- websocket subscription model
- example payloads

Completion criteria:

- docs reflect actual implementation, not planned behavior
- docs are sufficient for a bot engineer to integrate without reading source

Deliverables:

- final API compatibility doc
- final websocket compatibility doc

### 4. Turn item 1 into MCP

Scope:

- build MCP server on top of the compatibility surface
- expose AI-friendly tools instead of raw passthrough only

Recommended first tool groups:

- market tools
- account tools
- order tools
- analysis tools
- replay tools

MCP design rules:

- MCP owns signer usage and nonce generation
- MCP should not expose secrets to the model
- MCP should return both structured summary and raw response where useful
- MCP should prefer stable typed tools over generic low-level wrappers

Completion criteria:

- MCP can place, cancel, modify, and query orders
- MCP can query account and market state
- MCP can support AI-readable analysis flows

Deliverables:

- MCP server code
- MCP tool registry
- auth and signing helpers for MCP use

### 5. Test and validate item 4

Scope:

- MCP tool tests
- end-to-end tests from MCP to Stratium API
- failure-path tests

Must cover:

- successful tool execution
- malformed input handling
- auth handling
- nonce handling
- retry safety
- tool output normalization

Completion criteria:

- MCP tools execute reliably against the compatibility layer
- no unsafe secret exposure in tool outputs

Deliverables:

- passing MCP test suite
- any mocks or fixtures needed for stable validation

### 6. Produce final MCP documentation for item 4

Scope:

- final MCP tool documentation only

Must include:

- tool list
- tool purpose
- input schema
- output schema
- auth behavior
- nonce behavior
- recommended calling patterns for AI agents
- safety boundaries

Completion criteria:

- an AI tool consumer or human integrator can use the MCP without reading implementation code

Deliverables:

- final MCP documentation

### 7. Start live AI testing with Codex

Scope:

- connect Codex to the MCP
- execute controlled strategy trials
- measure usability and failure modes

Suggested phases:

1. read-only market and account inspection
2. dry-run / simulated order placement
3. order modification and cancellation
4. replay and post-trade analysis
5. strategy adjustment loop

Completion criteria:

- Codex can inspect state correctly
- Codex can execute a basic trading loop
- Codex can explain and analyze results
- Codex can propose parameter or rule adjustments based on replay/history

Deliverables:

- AI test notes
- observed issues
- next-round improvement backlog

## Current Status Snapshot

Completed:

- `POST /info` public compatibility subset
- `POST /info` private query subset
- `POST /exchange` core action subset
- local signer-based bot auth
- nonce replay rejection
- Web trading path using bot-style signed `/exchange`
- Hyperliquid-style private websocket layer at `/ws-hyperliquid`
- API compatibility documentation
- websocket compatibility documentation
- trader MCP server
- trader MCP tests
- trader MCP documentation

Next active stage:

- item 7: live AI testing with Codex

## Working Rule

Do not write final docs for a stage before that stage's tests are passing.

The order of work should remain:

1. implement
2. validate
3. document
4. integrate upward
