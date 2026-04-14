import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RUNTIME_TABLES = [
  ["TriggerOrderHistory", () => prisma.triggerOrderHistory.deleteMany({})],
  ["LiquidationEvent", () => prisma.liquidationEvent.deleteMany({})],
  ["LedgerEntry", () => prisma.ledgerEntry.deleteMany({})],
  ["Fill", () => prisma.fill.deleteMany({})],
  ["Order", () => prisma.order.deleteMany({})],
  ["Position", () => prisma.position.deleteMany({})],
  ["Account", () => prisma.account.deleteMany({})],
  ["SimulationSnapshot", () => prisma.simulationSnapshot.deleteMany({})],
  ["SimulationEvent", () => prisma.simulationEvent.deleteMany({})],
  ["MarketTick", () => prisma.marketTick.deleteMany({})]
];

const isMissingTableError = (error) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = typeof error.message === "string" ? error.message : "";
  return error.code === "P2021" || message.includes("does not exist");
};

async function main() {
  const results = [];

  for (const [tableName, runDelete] of RUNTIME_TABLES) {
    try {
      const result = await runDelete();
      results.push([tableName, result.count]);
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }

      results.push([tableName, "skipped (missing table)"]);
    }
  }

  console.log("Cleared runtime data:");
  for (const [tableName, count] of results) {
    console.log(`- ${tableName}: ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
