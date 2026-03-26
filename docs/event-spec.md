# Event Spec

## Purpose

This document defines the PH1 event model for the trading simulation platform.

PH1 requires deterministic replay. That means every meaningful state change must be represented by an event with stable semantics.

## Event Model Principles

- events are append-only
- events are immutable once persisted
- every event has a unique id
- every event has a timestamp in UTC
- replay order is based on persisted event sequence, not client clock
- derived state such as orders, positions, and account summaries must be reconstructable from events

## Event Envelope

Each event should contain at least:

- `eventId`
- `eventType`
- `occurredAt`
- `sequence`
- `simulationSessionId`
- `accountId`
- `symbol`
- `source`
- `payload`

## Source Values

Allowed PH1 `source` values:

- `market`
- `user`
- `system`
- `replay`

## Event Categories

### Market Events

#### `MarketTickReceived`
- produced when the market feed ingests a new tick
- payload fields:
  - `bid`
  - `ask`
  - `last`
  - `spread`
  - `tickTime`
  - `volatilityTag`

### Order Events

#### `OrderRequested`
- user or test harness requested a new order
- payload fields:
  - `orderId`
  - `side`
  - `orderType`
  - `quantity`
  - `limitPrice`
  - `submittedAt`

#### `OrderAccepted`
- order passed validation and entered the active order set
- payload fields:
  - `orderId`
  - `acceptedAt`

#### `OrderRejected`
- order failed validation and will not enter the book
- payload fields:
  - `orderId`
  - `rejectedAt`
  - `reasonCode`
  - `reasonMessage`

#### `OrderCancelRequested`
- cancel was requested for an existing active order
- payload fields:
  - `orderId`
  - `requestedAt`

#### `OrderCanceled`
- order was canceled before full execution
- payload fields:
  - `orderId`
  - `canceledAt`
  - `remainingQuantity`

### Fill Events

#### `OrderPartiallyFilled`
- order received a partial fill
- payload fields:
  - `orderId`
  - `fillId`
  - `fillPrice`
  - `fillQuantity`
  - `filledQuantityTotal`
  - `remainingQuantity`
  - `slippage`
  - `fee`
  - `filledAt`

#### `OrderFilled`
- order reached full execution
- payload fields:
  - `orderId`
  - `fillId`
  - `fillPrice`
  - `fillQuantity`
  - `filledQuantityTotal`
  - `remainingQuantity`
  - `slippage`
  - `fee`
  - `filledAt`

### Position Events

#### `PositionOpened`
- first fill created a non-zero position
- payload fields:
  - `positionId`
  - `side`
  - `quantity`
  - `averageEntryPrice`

#### `PositionUpdated`
- position changed because of a fill, fee, or liquidation
- payload fields:
  - `positionId`
  - `quantity`
  - `averageEntryPrice`
  - `realizedPnl`
  - `unrealizedPnl`
  - `markPrice`

#### `PositionClosed`
- position quantity reached zero
- payload fields:
  - `positionId`
  - `closedAt`
  - `realizedPnl`

### Account and Margin Events

#### `AccountBalanceUpdated`
- account balance or equity changed
- payload fields:
  - `walletBalance`
  - `availableBalance`
  - `positionMargin`
  - `orderMargin`
  - `equity`

#### `MarginUpdated`
- risk metrics recalculated
- payload fields:
  - `initialMargin`
  - `maintenanceMargin`
  - `riskRatio`
  - `liquidationPrice`

#### `FeeCharged`
- trading fee was posted to the ledger
- payload fields:
  - `ledgerEntryId`
  - `orderId`
  - `fillId`
  - `amount`
  - `asset`
  - `chargedAt`

### Liquidation Events

#### `LiquidationTriggered`
- the system determined the account or position crossed the liquidation threshold
- payload fields:
  - `positionId`
  - `triggerPrice`
  - `riskRatio`
  - `triggeredAt`

#### `LiquidationExecuted`
- liquidation order was executed
- payload fields:
  - `positionId`
  - `liquidationOrderId`
  - `executionPrice`
  - `executionQuantity`
  - `executedAt`

### Replay Events

#### `ReplayRequested`
- replay started for a simulation session
- payload fields:
  - `requestedAt`
  - `fromSequence`
  - `toSequence`

#### `ReplayCompleted`
- replay reached the end of the requested sequence
- payload fields:
  - `completedAt`
  - `finalSequence`

## Order of Operations

For a normal accepted order, the expected PH1 event order is:

1. `OrderRequested`
2. `OrderAccepted`
3. zero or more `OrderPartiallyFilled`
4. optional `OrderFilled`
5. position, margin, balance, and ledger events derived from each fill

For a rejected order:

1. `OrderRequested`
2. `OrderRejected`

For a cancel flow:

1. `OrderCancelRequested`
2. `OrderCanceled`

For a liquidation flow:

1. `LiquidationTriggered`
2. `LiquidationExecuted`
3. `PositionUpdated` or `PositionClosed`
4. `AccountBalanceUpdated`
5. `MarginUpdated`

## Replay Requirements

- replay must consume events in persisted sequence order
- replay must not read live market state
- replay must not depend on current wall clock time
- replay must produce the same terminal state for the same event sequence

## Persistence Notes

Recommended storage split:

- `simulation_events` stores the canonical event log
- query tables store current snapshots for fast reads

The event log is the source of truth for history and replay.
