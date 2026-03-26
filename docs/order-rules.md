# Order Rules

## Purpose

This document defines PH1 order validation, lifecycle, and fill behavior.

PH1 is intentionally narrow. The goal is correctness and reproducibility, not exchange-grade feature breadth.

## Supported Order Types

- market order
- limit order
- cancel order

## Supported Dimensions

### Side
- `buy`
- `sell`

### Time-in-force

PH1 keeps this simple:

- market order: immediate execution attempt
- limit order: remains active until filled or canceled

No IOC, FOK, or post-only support in PH1.

## Validation Rules

An order must be rejected if any of the following is true:

- `symbol` is unsupported
- `quantity <= 0`
- order type is `limit` and `limitPrice <= 0`
- account is missing
- account is not allowed to trade
- estimated required margin exceeds available balance
- order references an unknown session or account context

## Rejection Codes

Recommended PH1 rejection codes:

- `INVALID_SYMBOL`
- `INVALID_QUANTITY`
- `INVALID_PRICE`
- `INSUFFICIENT_MARGIN`
- `ACCOUNT_NOT_FOUND`
- `ACCOUNT_DISABLED`
- `INVALID_ORDER_STATE`

## Order Lifecycle

PH1 order states:

- `NEW`
- `ACCEPTED`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`
- `REJECTED`

## Allowed Transitions

- `NEW -> ACCEPTED`
- `NEW -> REJECTED`
- `ACCEPTED -> PARTIALLY_FILLED`
- `ACCEPTED -> FILLED`
- `ACCEPTED -> CANCELED`
- `PARTIALLY_FILLED -> PARTIALLY_FILLED`
- `PARTIALLY_FILLED -> FILLED`
- `PARTIALLY_FILLED -> CANCELED`

No other transitions are valid.

## Matching Inputs

The matching engine consumes the latest market tick:

- `bid`
- `ask`
- `last`
- `timestamp`

PH1 does not simulate depth-of-book matching.

## Market Order Rules

### Buy market order
- executable price starts from `ask`

### Sell market order
- executable price starts from `bid`

### Fill timing
- PH1 may treat market orders as immediately executable on the latest tick
- if no valid market tick exists, reject the order

## Limit Order Rules

### Buy limit order
- eligible to fill when `ask <= limitPrice`

### Sell limit order
- eligible to fill when `bid >= limitPrice`

### Resting behavior
- if not fillable on the current tick, the order remains active
- each new tick reevaluates fill eligibility

## Partial Fill Rules

PH1 supports partial fill semantics, but the initial implementation may use a simple model.

Recommended PH1 rule:

- if partial fills are enabled for the symbol, use a deterministic ratio model
- otherwise fill the entire eligible quantity at once

If a partial fill occurs:

- order state becomes `PARTIALLY_FILLED`
- `filledQuantityTotal` increases
- `remainingQuantity` decreases

## Slippage Rules

PH1 must use a fixed and deterministic slippage model.

Recommended initial model:

- market order slippage = `baseSlippageBps * referencePrice`
- limit order slippage = `0` by default, unless explicitly configured otherwise

The execution price should be:

- buy: `referencePrice + slippage`
- sell: `referencePrice - slippage`

Where `referencePrice` is:

- buy market: `ask`
- sell market: `bid`
- buy limit: min executable price under the configured rule
- sell limit: max executable price under the configured rule

## Fees

PH1 fee model should be simple and deterministic.

Recommended approach:

- fee charged on every fill
- fee = `fillNotional * takerFeeRate`

If maker/taker differentiation is not implemented, use a single fee rate.

## Cancel Rules

An order can be canceled only if its state is:

- `ACCEPTED`
- `PARTIALLY_FILLED`

An order cannot be canceled if its state is:

- `FILLED`
- `CANCELED`
- `REJECTED`

Cancel behavior:

- remaining quantity becomes non-executable
- already filled quantity remains part of trade history

## Idempotency

PH1 should support idempotent command handling where practical.

Examples:

- duplicate create-order request with same client id should not create multiple active orders
- duplicate cancel request should not create inconsistent state

## Test Cases Required

At minimum, PH1 should test:

1. valid market buy order is accepted and filled from `ask`
2. valid market sell order is accepted and filled from `bid`
3. valid limit buy order rests until `ask <= limitPrice`
4. valid limit sell order rests until `bid >= limitPrice`
5. invalid quantity is rejected
6. insufficient margin is rejected
7. accepted order can be canceled
8. filled order cannot be canceled
9. partial fill updates remaining quantity correctly
10. replay reproduces the same order state sequence
