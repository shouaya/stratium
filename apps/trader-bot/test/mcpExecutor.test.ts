import { describe, expect, it, vi } from "vitest";
import { createMcpExecutor } from "../src/runtime/mcpExecutor.js";
import type { TraderMcpClient } from "../src/infra/traderMcpClient.js";

const market = {
  symbol: "BTC-USD",
  bid: 99_000,
  ask: 101_000,
  last: 100_000,
  timestamp: "2026-05-20T00:00:00.000Z"
};

describe("createMcpExecutor", () => {
  it("submits paper execution orders through Trader MCP", async () => {
    const callTool = vi.fn(async () => ({ raw: { ok: true } }));
    const executor = createMcpExecutor({
      market,
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    const results = await executor.execute("paper_execute", [
      {
        type: "place_order",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        quantity: 0.001,
        invalidationPrice: 99_000,
        reason: "test"
      }
    ]);

    expect(callTool).toHaveBeenCalledWith("stratium_place_order", expect.objectContaining({
      isBuy: true,
      price: "101000",
      size: "0.001",
      tif: "Ioc"
    }));
    expect(results[0]).toMatchObject({
      status: "executed",
      message: "order submitted through Trader MCP"
    });
  });

  it("includes bot and wake refs in generated client order ids", async () => {
    const callTool = vi.fn(async () => ({ raw: { ok: true } }));
    const executor = createMcpExecutor({
      market,
      botId: "trend-btc-trader",
      wakeId: "wake-abc-123",
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    await executor.execute("paper_execute", [
      {
        type: "place_order",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        quantity: 0.001,
        invalidationPrice: 99_000,
        reason: "test"
      }
    ]);

    expect(callTool).toHaveBeenCalledWith("stratium_place_order", expect.objectContaining({
      cloid: expect.stringMatching(/^ai-trend-btc-trader-wake-abc-123-0-/)
    }));
  });

  it("does not call trade tools in shadow mode", async () => {
    const callTool = vi.fn();
    const executor = createMcpExecutor({
      market,
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    const results = await executor.execute("shadow", [
      {
        type: "observe",
        reason: "wait"
      }
    ]);

    expect(callTool).not.toHaveBeenCalled();
    expect(results[0].status).toBe("skipped_shadow");
  });

  it("submits close_position as a reduce-only order through Trader MCP", async () => {
    const callTool = vi.fn(async () => ({ raw: { ok: true } }));
    const executor = createMcpExecutor({
      market,
      account: {
        equity: 10_000,
        availableMargin: 9_000,
        currentPositionNotional: 100,
        position: {
          symbol: "BTC-USD",
          side: "long",
          quantity: 0.002,
          notional: 200
        }
      },
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    const results = await executor.execute("paper_execute", [
      {
        type: "close_position",
        symbol: "BTC-USD",
        reason: "exit"
      }
    ]);

    expect(callTool).toHaveBeenCalledWith("stratium_place_order", expect.objectContaining({
      isBuy: false,
      price: "99000",
      size: "0.002",
      reduceOnly: true,
      tif: "Ioc"
    }));
    expect(results[0].status).toBe("executed");
  });

  it("executes close_position in reduce-only mode", async () => {
    const callTool = vi.fn(async () => ({ raw: { ok: true } }));
    const executor = createMcpExecutor({
      market,
      account: {
        equity: 10_000,
        availableMargin: 9_000,
        currentPositionNotional: 100,
        position: {
          symbol: "BTC-USD",
          side: "short",
          quantity: 0.003,
          notional: 300
        }
      },
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    const results = await executor.execute("reduce_only", [
      {
        type: "close_position",
        symbol: "BTC-USD",
        reason: "risk-off exit"
      }
    ]);

    expect(callTool).toHaveBeenCalledWith("stratium_place_order", expect.objectContaining({
      isBuy: true,
      price: "101000",
      size: "0.003",
      reduceOnly: true,
      tif: "Ioc"
    }));
    expect(results[0]).toMatchObject({
      status: "executed",
      message: "close_position submitted as reduce-only order through Trader MCP"
    });
  });

  it("rejects opening place_order in reduce-only mode before calling MCP", async () => {
    const callTool = vi.fn();
    const executor = createMcpExecutor({
      market,
      mcpClient: {
        callTool,
        listToolNames: async () => [],
        close: async () => undefined
      } satisfies TraderMcpClient
    });

    const results = await executor.execute("reduce_only", [
      {
        type: "place_order",
        symbol: "BTC-USD",
        side: "buy",
        orderType: "market",
        quantity: 0.001,
        invalidationPrice: 99_000,
        reason: "not allowed"
      }
    ]);

    expect(callTool).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      status: "rejected",
      message: "reduce-only mode rejects opening orders at execution"
    });
  });
});
