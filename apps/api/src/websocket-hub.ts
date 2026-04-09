import type { AnyEventEnvelope } from "@stratium/shared";
import type { BatchJobPayload } from "./payloads.js";
import type { HyperliquidMarketSnapshot } from "./hyperliquid-market.js";
import type { MarketSimulatorState, SocketLike, SymbolConfigState } from "./market-runtime.js";

interface BroadcastPayload {
  type: "bootstrap" | "events";
  state: unknown;
  events: AnyEventEnvelope[];
  simulator: MarketSimulatorState;
  market: HyperliquidMarketSnapshot;
  symbolConfig?: SymbolConfigState;
  batch?: BatchJobPayload;
  platform?: unknown;
}

type PayloadFactory = (events?: AnyEventEnvelope[]) => BroadcastPayload;

interface SocketRegistration {
  socket: SocketLike;
  createPayload: PayloadFactory;
}

export class WebSocketHub {
  private readonly sockets = new Map<SocketLike, SocketRegistration>();

  addSocket(socket: SocketLike, createPayload: PayloadFactory): void {
    this.sockets.set(socket, { socket, createPayload });
    try {
      socket.send(JSON.stringify(createPayload([])));
    } catch {
      this.removeSocket(socket);
      return;
    }
    socket.on?.("close", () => {
      this.removeSocket(socket);
    });
  }

  removeSocket(socket: SocketLike): void {
    this.sockets.delete(socket);
  }

  broadcast(events: AnyEventEnvelope[] = []): void {
    for (const registration of this.sockets.values()) {
      try {
        registration.socket.send(JSON.stringify(registration.createPayload(events)));
      } catch {
        this.removeSocket(registration.socket);
      }
    }
  }
}
