import type { AnyEventEnvelope } from "@stratium/shared";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market";
import type { MarketSimulatorState, SocketLike, SymbolConfigState } from "./market-runtime";

interface BroadcastPayload {
  type: "bootstrap" | "events";
  state: unknown;
  events: AnyEventEnvelope[];
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  symbolConfig?: SymbolConfigState;
}

export class WebSocketHub {
  private readonly sockets = new Set<SocketLike>();

  addSocket(socket: SocketLike, payload: BroadcastPayload): void {
    this.sockets.add(socket);
    socket.send(JSON.stringify(payload));
    socket.on?.("close", () => {
      this.removeSocket(socket);
    });
  }

  removeSocket(socket: SocketLike): void {
    this.sockets.delete(socket);
  }

  broadcast(payload: BroadcastPayload): void {
    const message = JSON.stringify(payload);

    for (const socket of this.sockets) {
      socket.send(message);
    }
  }
}
