import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerRoutes } from "./routes.js";
import { ApiRuntime } from "../runtime/runtime.js";

const parseAllowedOrigins = (): string[] => {
  const configured = process.env.ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  return [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:6100",
    "http://127.0.0.1:6100"
  ];
};

const app = Fastify({
  logger: true
});
const runtime = new ApiRuntime(app.log);
const allowedOrigins = new Set(parseAllowedOrigins());

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Stratium-Locale"]
});

await app.register(rateLimit, {
  max: Number(process.env.API_RATE_LIMIT_MAX ?? 240),
  timeWindow: process.env.API_RATE_LIMIT_WINDOW ?? "1 minute"
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
