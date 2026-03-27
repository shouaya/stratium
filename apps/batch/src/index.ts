import { loadConfig } from "./config.js";
import { HyperliquidBatchCollector } from "./hyperliquid-batch.js";

const main = async () => {
  const config = loadConfig();
  const collector = new HyperliquidBatchCollector(config);

  await collector.start();
  console.log(`Hyperliquid batch started in ${config.nodeEnv}`);

  const shutdown = async () => {
    console.log("Shutting down Hyperliquid batch");
    await collector.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
};

void main().catch((error: unknown) => {
  console.error("Hyperliquid batch failed to start", error);
  process.exit(1);
});
