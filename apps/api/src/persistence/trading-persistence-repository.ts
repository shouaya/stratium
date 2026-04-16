import { Prisma } from "@prisma/client";
import type { AnyEventEnvelope, FillPayload, MarketTick, OrderView, PositionView } from "@stratium/shared";
import type { TradingEngineState } from "@stratium/trading-core";
import { SymbolConfigRepository } from "./symbol-config-repository.js";
import { prisma } from "./prisma-client.js";

const EVENT_LOAD_BATCH_SIZE = 2_000;

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const toStoredJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const isFillEvent = (eventType: string): boolean =>
  eventType === "OrderFilled" || eventType === "OrderPartiallyFilled";
const isLiquidationTriggeredEvent = (eventType: string): boolean =>
  eventType === "LiquidationTriggered";
const isLiquidationExecutedEvent = (eventType: string): boolean =>
  eventType === "LiquidationExecuted";

const positionRowId = (accountId: string, symbol: string): string => `${accountId}:${symbol}`;
const simulationEventRowId = (sessionId: string, eventId: string): string => `${sessionId}:${eventId}`;
const orderRowId = (accountId: string, orderId: string): string => `${accountId}:${orderId}`;
const fillRowId = (accountId: string, fillId: string): string => `${accountId}:${fillId}`;
const liquidationEventRowId = (accountId: string, liquidationOrderId: string): string =>
  `${accountId}:liquidation:${liquidationOrderId}`;

export class TradingPersistenceRepository extends SymbolConfigRepository {
  async loadEvents(sessionId: string, afterSequence?: number): Promise<AnyEventEnvelope[]> {
    const events: Prisma.SimulationEventGetPayload<Record<string, never>>[] = [];
    let lastSequence: number | null = null;

    while (true) {
      const minSequence = Math.max(afterSequence ?? 0, lastSequence ?? 0);
      const batch: Prisma.SimulationEventGetPayload<Record<string, never>>[] = await prisma.simulationEvent.findMany({
        where: {
          simulationSessionId: sessionId,
          ...(minSequence > 0 ? { sequence: { gt: minSequence } } : {})
        },
        orderBy: {
          sequence: "asc"
        },
        take: EVENT_LOAD_BATCH_SIZE
      });

      if (batch.length === 0) {
        break;
      }

      events.push(...batch);
      lastSequence = batch[batch.length - 1]?.sequence ?? null;

      if (batch.length < EVENT_LOAD_BATCH_SIZE) {
        break;
      }
    }

    return events.map((event) => ({
      eventId: event.id,
      eventType: event.eventType as AnyEventEnvelope["eventType"],
      occurredAt: event.occurredAt.toISOString(),
      sequence: event.sequence,
      simulationSessionId: event.simulationSessionId,
      accountId: event.accountId,
      symbol: event.symbol,
      source: event.source as AnyEventEnvelope["source"],
      payload: event.payload as AnyEventEnvelope["payload"]
    }) as AnyEventEnvelope);
  }

  async loadSimulationSnapshot(sessionId: string): Promise<null | {
    lastSequence: number;
    createdAt: string;
    updatedAt: string;
    state: TradingEngineState;
  }> {
    const row = await prisma.simulationSnapshot.findUnique({
      where: { simulationSessionId: sessionId }
    });

    if (!row) {
      return null;
    }

    const state = row.state as unknown as TradingEngineState;

    return {
      lastSequence: row.lastSequence,
      createdAt: row.createdAt?.toISOString?.() ?? row.updatedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      state: {
        ...state,
        simulationSessionId: row.simulationSessionId,
        account: {
          ...state.account,
          accountId: row.accountId
        },
        position: {
          ...state.position,
          symbol: row.symbol
        }
      }
    };
  }

  async listFillHistoryEvents(accountId: string): Promise<AnyEventEnvelope[]> {
    const fills = await prisma.fill.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    if (fills.length === 0) {
      return [];
    }

    const orders = await prisma.order.findMany({
      where: {
        accountId,
        id: {
          in: fills.map((fill) => orderRowId(accountId, fill.orderId))
        }
      }
    });
    const orderMap = new Map(
      orders.map((order) => [order.id, order])
    );
    const fillIdPrefix = `${accountId}:`;

    return fills.map((fill, index) => {
      const order = orderMap.get(orderRowId(accountId, fill.orderId));
      const fillPrice = toNumber(fill.price);
      const fillQuantity = toNumber(fill.quantity);
      const fee = toNumber(fill.fee);
      const notional = fillPrice * fillQuantity;
      const rawFillId = fill.id.startsWith(fillIdPrefix) ? fill.id.slice(fillIdPrefix.length) : fill.id;

      return {
        eventId: `persisted-${fill.id}`,
        eventType: "OrderFilled",
        occurredAt: fill.createdAt.toISOString(),
        sequence: index + 1,
        simulationSessionId: `persisted-${accountId}`,
        accountId,
        symbol: fill.symbol,
        source: "system",
        payload: {
          orderId: fill.orderId,
          fillId: rawFillId,
          fillPrice,
          fillQuantity,
          filledQuantityTotal: fillQuantity,
          remainingQuantity: 0,
          slippage: toNumber(fill.slippage),
          fee,
          feeRate: notional > 0 ? Number((fee / notional).toFixed(8)) : 0,
          liquidityRole: order?.orderType === "limit" ? "maker" : "taker",
          filledAt: fill.createdAt.toISOString()
        }
      } as AnyEventEnvelope;
    });
  }

  async listOrderHistoryViews(accountId: string): Promise<OrderView[]> {
    const rows = await prisma.order.findMany({
      where: { accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id.startsWith(`${accountId}:`) ? row.id.slice(`${accountId}:`.length) : row.id,
      accountId: row.accountId,
      clientOrderId: row.clientOrderId ?? undefined,
      symbol: row.symbol,
      side: row.side as OrderView["side"],
      orderType: row.orderType as OrderView["orderType"],
      status: row.status as OrderView["status"],
      quantity: toNumber(row.quantity),
      limitPrice: row.limitPrice == null ? undefined : toNumber(row.limitPrice),
      filledQuantity: toNumber(row.filledQuantity),
      remainingQuantity: toNumber(row.remainingQuantity),
      averageFillPrice: row.averageFillPrice == null ? undefined : toNumber(row.averageFillPrice),
      rejectionCode: row.rejectionCode == null ? undefined : row.rejectionCode as OrderView["rejectionCode"],
      rejectionMessage: row.rejectionMessage ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  }

  async persistState(state: TradingEngineState, events: AnyEventEnvelope[], persistSnapshot = true): Promise<void> {
    const ancillaryOperations: Promise<unknown>[] = [];
    const snapshotLastSequence = Math.max(0, state.nextSequence - 1);
    const liquidationTriggerByPositionId = new Map<string, { triggerPrice: number }>();

    for (const event of events) {
      if (isLiquidationTriggeredEvent(event.eventType)) {
        const payload = event.payload as {
          positionId: string;
          triggerPrice: number;
        };

        liquidationTriggerByPositionId.set(payload.positionId, {
          triggerPrice: payload.triggerPrice
        });
      }

      if (event.eventType === "MarketTickReceived") {
        const payload = event.payload as MarketTick;

        ancillaryOperations.push(
          prisma.marketTick.upsert({
            where: {
              id: this.marketTickEventRowId(event.symbol, payload.tickTime)
            },
            update: {
              symbol: event.symbol,
              bid: payload.bid,
              ask: payload.ask,
              last: payload.last,
              spread: payload.spread,
              volatilityTag: payload.volatilityTag,
              tickTime: new Date(payload.tickTime)
            },
            create: {
              id: this.marketTickEventRowId(event.symbol, payload.tickTime),
              symbol: event.symbol,
              bid: payload.bid,
              ask: payload.ask,
              last: payload.last,
              spread: payload.spread,
              volatilityTag: payload.volatilityTag,
              tickTime: new Date(payload.tickTime)
            }
          }).catch(() => undefined)
        );
      }
    }

    await prisma.$transaction(async (transactionClient) => {
      const criticalOperations: Promise<unknown>[] = [];

      for (const event of events) {
        criticalOperations.push(
          transactionClient.simulationEvent.upsert({
            where: {
              simulationSessionId_sequence: {
                simulationSessionId: event.simulationSessionId,
                sequence: event.sequence
              }
            },
            update: {
              eventType: event.eventType,
              source: event.source,
              payload: toJson(event.payload),
              occurredAt: new Date(event.occurredAt)
            },
            create: {
              id: simulationEventRowId(event.simulationSessionId, event.eventId),
              sequence: event.sequence,
              simulationSessionId: event.simulationSessionId,
              accountId: event.accountId,
              symbol: event.symbol,
              source: event.source,
              eventType: event.eventType,
              payload: toJson(event.payload),
              occurredAt: new Date(event.occurredAt)
            }
          })
        );

        if (isFillEvent(event.eventType)) {
          const payload = event.payload as FillPayload;

          criticalOperations.push(
            transactionClient.fill.upsert({
              where: {
                id: fillRowId(event.accountId, payload.fillId)
              },
              update: {
                price: payload.fillPrice,
                quantity: payload.fillQuantity,
                slippage: payload.slippage,
                fee: payload.fee
              },
              create: {
                id: fillRowId(event.accountId, payload.fillId),
                orderId: payload.orderId,
                accountId: event.accountId,
                symbol: event.symbol,
                price: payload.fillPrice,
                quantity: payload.fillQuantity,
                slippage: payload.slippage,
                fee: payload.fee
              }
            })
          );
        }

        if (isLiquidationExecutedEvent(event.eventType)) {
          const payload = event.payload as {
            positionId: string;
            liquidationOrderId: string;
            executionPrice: number;
            executionQuantity: number;
          };
          const trigger = liquidationTriggerByPositionId.get(payload.positionId);

          if (trigger) {
            criticalOperations.push(
              transactionClient.liquidationEvent.upsert({
                where: {
                  id: liquidationEventRowId(event.accountId, payload.liquidationOrderId)
                },
                update: {
                  accountId: event.accountId,
                  positionId: payload.positionId,
                  liquidationOrderId: payload.liquidationOrderId,
                  triggerPrice: trigger.triggerPrice,
                  executionPrice: payload.executionPrice,
                  executionQuantity: payload.executionQuantity
                },
                create: {
                  id: liquidationEventRowId(event.accountId, payload.liquidationOrderId),
                  accountId: event.accountId,
                  positionId: payload.positionId,
                  liquidationOrderId: payload.liquidationOrderId,
                  triggerPrice: trigger.triggerPrice,
                  executionPrice: payload.executionPrice,
                  executionQuantity: payload.executionQuantity
                }
              })
            );
          }
        }
      }

      criticalOperations.push(
        transactionClient.account.upsert({
          where: {
            id: state.account.accountId
          },
          update: {
            walletBalance: state.account.walletBalance,
            availableBalance: state.account.availableBalance,
            positionMargin: state.account.positionMargin,
            orderMargin: state.account.orderMargin,
            equity: state.account.equity,
            realizedPnl: state.account.realizedPnl,
            unrealizedPnl: state.account.unrealizedPnl,
            riskRatio: state.account.riskRatio
          },
          create: {
            id: state.account.accountId,
            walletBalance: state.account.walletBalance,
            availableBalance: state.account.availableBalance,
            positionMargin: state.account.positionMargin,
            orderMargin: state.account.orderMargin,
            equity: state.account.equity,
            realizedPnl: state.account.realizedPnl,
            unrealizedPnl: state.account.unrealizedPnl,
            riskRatio: state.account.riskRatio
          }
        })
      );

      criticalOperations.push(
        transactionClient.position.upsert({
          where: {
            id: positionRowId(state.account.accountId, state.position.symbol)
          },
          update: {
            accountId: state.account.accountId,
            symbol: state.position.symbol,
            side: state.position.side,
            quantity: state.position.quantity,
            averageEntryPrice: state.position.averageEntryPrice,
            markPrice: state.position.markPrice,
            realizedPnl: state.position.realizedPnl,
            unrealizedPnl: state.position.unrealizedPnl,
            initialMargin: state.position.initialMargin,
            maintenanceMargin: state.position.maintenanceMargin,
            liquidationPrice: state.position.liquidationPrice
          },
          create: {
            id: positionRowId(state.account.accountId, state.position.symbol),
            accountId: state.account.accountId,
            symbol: state.position.symbol,
            side: state.position.side,
            quantity: state.position.quantity,
            averageEntryPrice: state.position.averageEntryPrice,
            markPrice: state.position.markPrice,
            realizedPnl: state.position.realizedPnl,
            unrealizedPnl: state.position.unrealizedPnl,
            initialMargin: state.position.initialMargin,
            maintenanceMargin: state.position.maintenanceMargin,
            liquidationPrice: state.position.liquidationPrice
          }
        })
      );

      for (const order of state.orders) {
        criticalOperations.push(
          transactionClient.order.upsert({
            where: {
              id: orderRowId(order.accountId, order.id)
            },
            update: this.mapOrder(order),
            create: {
              id: orderRowId(order.accountId, order.id),
              ...this.mapOrder(order)
            }
          })
        );
      }

      if (persistSnapshot) {
        criticalOperations.push(
          transactionClient.simulationSnapshot.upsert({
            where: {
              simulationSessionId: state.simulationSessionId
            },
            update: {
              accountId: state.account.accountId,
              symbol: state.position.symbol,
              lastSequence: snapshotLastSequence,
              state: toStoredJson(state)
            },
            create: {
              simulationSessionId: state.simulationSessionId,
              accountId: state.account.accountId,
              symbol: state.position.symbol,
              lastSequence: snapshotLastSequence,
              state: toStoredJson(state)
            }
          })
        );

        criticalOperations.push(
          transactionClient.simulationEvent.deleteMany({
            where: {
              simulationSessionId: state.simulationSessionId,
              sequence: {
                lte: snapshotLastSequence
              }
            }
          })
        );
      }

      await Promise.all(criticalOperations);
    });
    await Promise.allSettled(ancillaryOperations);
  }

  async loadSnapshot(accountId: string): Promise<{
    account: TradingEngineState["account"] | null;
    position: TradingEngineState["position"] | null;
  }> {
    const [account, position] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId } }),
      prisma.position.findFirst({ where: { accountId }, orderBy: { updatedAt: "desc" } })
    ]);

    return {
      account: account ? {
        accountId: account.id,
        walletBalance: toNumber(account.walletBalance),
        availableBalance: toNumber(account.availableBalance),
        positionMargin: toNumber(account.positionMargin),
        orderMargin: toNumber(account.orderMargin),
        equity: toNumber(account.equity),
        realizedPnl: toNumber(account.realizedPnl),
        unrealizedPnl: toNumber(account.unrealizedPnl),
        riskRatio: toNumber(account.riskRatio)
      } : null,
      position: position ? this.mapPosition(position) : null
    };
  }

  private mapOrder(order: OrderView) {
    return {
      accountId: order.accountId,
      clientOrderId: order.clientOrderId ?? null,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      status: order.status,
      quantity: order.quantity,
      limitPrice: order.limitPrice ?? null,
      filledQuantity: order.filledQuantity,
      remainingQuantity: order.remainingQuantity,
      averageFillPrice: order.averageFillPrice ?? null,
      rejectionCode: order.rejectionCode ?? null,
      rejectionMessage: order.rejectionMessage ?? null,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt)
    };
  }

  private mapPosition(position: {
    symbol: string;
    side: string;
    quantity: { toString(): string };
    averageEntryPrice: { toString(): string };
    markPrice: { toString(): string };
    realizedPnl: { toString(): string };
    unrealizedPnl: { toString(): string };
    initialMargin: { toString(): string };
    maintenanceMargin: { toString(): string };
    liquidationPrice: { toString(): string };
  }): PositionView {
    return {
      symbol: position.symbol,
      side: position.side as PositionView["side"],
      quantity: toNumber(position.quantity),
      averageEntryPrice: toNumber(position.averageEntryPrice),
      markPrice: toNumber(position.markPrice),
      realizedPnl: toNumber(position.realizedPnl),
      unrealizedPnl: toNumber(position.unrealizedPnl),
      initialMargin: toNumber(position.initialMargin),
      maintenanceMargin: toNumber(position.maintenanceMargin),
      liquidationPrice: toNumber(position.liquidationPrice)
    };
  }
}
