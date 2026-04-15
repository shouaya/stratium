import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";
import { ApiRuntime } from "./runtime.js";

const app = Fastify({
  logger: true
});
const runtime = new ApiRuntime(app.log);

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Stratium-Locale"]
});

await app.register(websocket);
await registerRoutes(app, runtime);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

await runtime.bootstrap();
await app.listen({
  port,
  host
});

const shutdown = async () => {
  await runtime.shutdown();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
