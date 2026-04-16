import type { FastifyBaseLogger } from "fastify";
import type { AnyEventEnvelope } from "@stratium/shared";
import type { BatchJobPayload } from "./payloads.js";
import type { MarketSnapshot } from "../market/market-data.js";
import type { SocketLike, SymbolConfigState } from "../market/market-runtime.js";

interface BroadcastPayload {
  type: "bootstrap" | "events";
  state: unknown;
  events: AnyEventEnvelope[];
  market: MarketSnapshot;
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
  constructor(
    private readonly logger?: Pick<FastifyBaseLogger, "warn">
  ) {}

  private readonly sockets = new Map<SocketLike, SocketRegistration>();

  addSocket(socket: SocketLike, createPayload: PayloadFactory): void {
    this.sockets.set(socket, { socket, createPayload });
    try {
      socket.send(JSON.stringify(createPayload([])));
    } catch (error) {
      this.logger?.warn({ error }, "Failed to send websocket bootstrap payload");
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
      } catch (error) {
        this.logger?.warn({ error }, "Failed to send websocket broadcast payload");
        this.removeSocket(registration.socket);
      }
    }
  }
}
