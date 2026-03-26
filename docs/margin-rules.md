# Margin Rules

## Purpose

This document defines PH1 account, margin, PnL, and liquidation rules.

PH1 favors a narrow and deterministic model over realism breadth.

## Scope

PH1 assumptions:

- single account
- single symbol
- isolated margin
- one-way position mode

No cross margin and no hedge mode in PH1.

## Account Fields

The account model should track at least:

- `walletBalance`
- `availableBalance`
- `positionMargin`
- `orderMargin`
- `equity`
- `realizedPnl`
- `unrealizedPnl`
- `riskRatio`

## Position Fields

The position model should track at least:

- `side`
- `quantity`
- `averageEntryPrice`
- `markPrice`
- `realizedPnl`
- `unrealizedPnl`
- `initialMargin`
- `maintenanceMargin`
- `liquidationPrice`

## Mark Price

PH1 should use a simple mark price model.

Recommended approach:

- `markPrice = last`

If needed later, this can be upgraded to a fair-price or index-based model.

## Notional

Position notional:

- `positionNotional = abs(quantity) * markPrice`

Fill notional:

- `fillNotional = abs(fillQuantity) * fillPrice`

## Realized and Unrealized PnL

### Unrealized PnL

For a long position:

- `unrealizedPnl = (markPrice - averageEntryPrice) * quantity`

For a short position:

- `unrealizedPnl = (averageEntryPrice - markPrice) * abs(quantity)`

### Realized PnL

Realized PnL is recognized only when position size is reduced or closed.

For a long position reduction:

- `realizedPnl = (exitPrice - averageEntryPrice) * closedQuantity`

For a short position reduction:

- `realizedPnl = (averageEntryPrice - exitPrice) * closedQuantity`

Trading fees reduce realized PnL or wallet balance according to implementation choice, but the chosen rule must be consistent everywhere.

## Average Entry Price

If a position increases in the same direction, recompute weighted average:

- `newAverageEntryPrice = ((oldQty * oldAvg) + (fillQty * fillPrice)) / newQty`

If a fill reduces the existing position:

- do not recalculate average entry for the reduced portion
- if position flips direction, the remaining open quantity starts a new average entry price at the flip fill price

## Initial Margin

Recommended PH1 formula:

- `initialMargin = positionNotional / leverage`

For pending orders, reserve order margin using the same principle on estimated executable notional.

## Maintenance Margin

Recommended PH1 formula:

- `maintenanceMargin = positionNotional * maintenanceMarginRate`

Keep `maintenanceMarginRate` configurable per symbol.

## Equity

Recommended PH1 formula:

- `equity = walletBalance + unrealizedPnl`

## Available Balance

Recommended PH1 formula:

- `availableBalance = walletBalance - positionMargin - orderMargin + unrealizedPnl`

If implementation chooses a different formula, the same formula must be used for validation, UI display, and tests.

## Risk Ratio

Recommended PH1 formula:

- `riskRatio = maintenanceMargin / equity`

If `equity <= 0`, treat risk ratio as liquidation state.

## Liquidation Trigger

Recommended PH1 condition:

- liquidate when `equity <= maintenanceMargin`

Equivalent condition:

- liquidate when `riskRatio >= 1`

Choose one trigger condition in code and tests. Do not mix both informally.

## Liquidation Price

PH1 does not need a perfect exchange-grade liquidation price formula, but it must be deterministic and aligned with the margin model.

Recommended approach:

- derive the price where `equity == maintenanceMargin`
- calculate separately for long and short positions
- store the computed value with every risk recalculation

### Long position example

Using:

- `equity = walletBalance + (markPrice - averageEntryPrice) * quantity`
- `maintenanceMargin = markPrice * quantity * maintenanceMarginRate`

Solve for `markPrice` at liquidation threshold.

### Short position example

Using:

- `equity = walletBalance + (averageEntryPrice - markPrice) * abs(quantity)`
- `maintenanceMargin = markPrice * abs(quantity) * maintenanceMarginRate`

Solve for `markPrice` at liquidation threshold.

The exact implementation formula should be copied into tests once selected.

## Liquidation Execution

When liquidation triggers:

1. emit `LiquidationTriggered`
2. generate a system liquidation order
3. execute the liquidation order against the current market rule
4. update position and account state
5. emit ledger, margin, and balance events

PH1 can liquidate the full remaining position in one step.

## Fee Model

Recommended PH1 fee assumptions:

- one fee rate per fill
- one optional liquidation surcharge rate

Suggested fields:

- `takerFeeRate`
- `liquidationFeeRate`

## Required Configuration

Each symbol should provide at least:

- `leverage`
- `maintenanceMarginRate`
- `takerFeeRate`
- `baseSlippageBps`
- `partialFillEnabled`

## Test Cases Required

At minimum, PH1 should test:

1. unrealized PnL for long position
2. unrealized PnL for short position
3. realized PnL after partial close
4. average entry after add-to-position
5. initial margin calculation
6. maintenance margin calculation
7. available balance calculation
8. liquidation trigger at threshold
9. liquidation closes remaining position
10. replay reproduces the same margin and liquidation results
