import { Prisma, PrismaClient } from "@prisma/client";
import type { EventEnvelope, FillPayload, MarketTick, OrderView, PositionView } from "@stratium/shared";
import type { TradingEngineState } from "@stratium/trading-core";

const prisma = new PrismaClient();

const toNumber = (value: { toString(): string } | number): number => Number(value.toString());
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const isFillEvent = (eventType: string): boolean =>
  eventType === "OrderFilled" || eventType === "OrderPartiallyFilled";

export class TradingRepository {
  async connect(): Promise<void> {
    await prisma.$connect();
  }

  async close(): Promise<void> {
    await prisma.$disconnect();
  }

  async loadEvents(sessionId: string): Promise<EventEnvelope<unknown>[]> {
    const events = await prisma.simulationEvent.findMany({
      where: {
        simulationSessionId: sessionId
      },
      orderBy: {
        sequence: "asc"
      }
    });

    return events.map((event) => ({
      eventId: event.id,
      eventType: event.eventType as EventEnvelope["eventType"],
      occurredAt: event.occurredAt.toISOString(),
      sequence: event.sequence,
      simulationSessionId: event.simulationSessionId,
      accountId: event.accountId,
      symbol: event.symbol,
      source: event.source as EventEnvelope["source"],
      payload: event.payload as EventEnvelope["payload"]
    }));
  }

  async persistState(state: TradingEngineState, events: EventEnvelope<unknown>[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      for (const event of events) {
        await tx.simulationEvent.upsert({
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
            id: event.eventId,
            sequence: event.sequence,
            simulationSessionId: event.simulationSessionId,
            accountId: event.accountId,
            symbol: event.symbol,
            source: event.source,
            eventType: event.eventType,
            payload: toJson(event.payload),
            occurredAt: new Date(event.occurredAt)
          }
        });

        if (event.eventType === "MarketTickReceived") {
          const payload = event.payload as MarketTick;

          await tx.marketTick.create({
            data: {
              id: event.eventId,
              symbol: event.symbol,
              bid: payload.bid,
              ask: payload.ask,
              last: payload.last,
              spread: payload.spread,
              volatilityTag: payload.volatilityTag,
              tickTime: new Date(payload.tickTime)
            }
          }).catch(() => undefined);
        }

        if (isFillEvent(event.eventType)) {
          const payload = event.payload as FillPayload;

          await tx.fill.upsert({
            where: {
              id: payload.fillId
            },
            update: {
              price: payload.fillPrice,
              quantity: payload.fillQuantity,
              slippage: payload.slippage,
              fee: payload.fee
            },
            create: {
              id: payload.fillId,
              orderId: payload.orderId,
              accountId: event.accountId,
              symbol: event.symbol,
              price: payload.fillPrice,
              quantity: payload.fillQuantity,
              slippage: payload.slippage,
              fee: payload.fee
            }
          });
        }
      }

      await tx.account.upsert({
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
      });

      await tx.position.upsert({
        where: {
          id: "position_1"
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
          id: "position_1",
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
      });

      for (const order of state.orders) {
        await tx.order.upsert({
          where: {
            id: order.id
          },
          update: this.mapOrder(order),
          create: {
            id: order.id,
            ...this.mapOrder(order)
          }
        });
      }
    });
  }

  async loadSnapshot(accountId: string): Promise<{
    account: TradingEngineState["account"] | null;
    position: TradingEngineState["position"] | null;
  }> {
    const [account, position] = await Promise.all([
      prisma.account.findUnique({ where: { id: accountId } }),
      prisma.position.findUnique({ where: { id: "position_1" } })
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
