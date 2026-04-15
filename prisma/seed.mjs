import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_FRONTEND = {
  username: "demo",
  password: "demo123456",
  displayName: "Demo Trader",
  tradingAccountId: "paper-account-1"
};

const DEFAULT_ADMIN = {
  username: "admin",
  password: "admin123456",
  displayName: "Platform Admin"
};

const DEFAULT_PLATFORM_SETTINGS = {
  id: "platform",
  platformName: "Stratium Demo",
  platformAnnouncement: "Demo environment. Accounts are issued by admin only.",
  activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
  activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
  allowFrontendTrading: true,
  allowManualTicks: true,
  allowSimulatorControl: true
};

const derivePasswordHash = (password, salt = randomBytes(16).toString("hex")) => {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
};

async function seedFrontendUser() {
  await prisma.appUser.upsert({
    where: { username: DEFAULT_FRONTEND.username },
    update: {
      displayName: DEFAULT_FRONTEND.displayName,
      tradingAccountId: DEFAULT_FRONTEND.tradingAccountId,
      isActive: true
    },
    create: {
      username: DEFAULT_FRONTEND.username,
      passwordHash: derivePasswordHash(DEFAULT_FRONTEND.password),
      role: "frontend",
      displayName: DEFAULT_FRONTEND.displayName,
      tradingAccountId: DEFAULT_FRONTEND.tradingAccountId,
      isActive: true
    }
  });
}

async function seedAdminUser() {
  await prisma.appUser.upsert({
    where: { username: DEFAULT_ADMIN.username },
    update: {
      displayName: DEFAULT_ADMIN.displayName,
      isActive: true
    },
    create: {
      username: DEFAULT_ADMIN.username,
      passwordHash: derivePasswordHash(DEFAULT_ADMIN.password),
      role: "admin",
      displayName: DEFAULT_ADMIN.displayName,
      tradingAccountId: null,
      isActive: true
    }
  });
}

async function seedPlatformSettings() {
  await prisma.platformSettings.upsert({
    where: { id: DEFAULT_PLATFORM_SETTINGS.id },
    update: {
      platformName: DEFAULT_PLATFORM_SETTINGS.platformName,
      platformAnnouncement: DEFAULT_PLATFORM_SETTINGS.platformAnnouncement,
      activeExchange: DEFAULT_PLATFORM_SETTINGS.activeExchange,
      activeSymbol: DEFAULT_PLATFORM_SETTINGS.activeSymbol,
      allowFrontendTrading: DEFAULT_PLATFORM_SETTINGS.allowFrontendTrading,
      allowManualTicks: DEFAULT_PLATFORM_SETTINGS.allowManualTicks,
      allowSimulatorControl: DEFAULT_PLATFORM_SETTINGS.allowSimulatorControl
    },
    create: DEFAULT_PLATFORM_SETTINGS
  });
}

async function main() {
  await seedFrontendUser();
  await seedAdminUser();
  await seedPlatformSettings();

  console.log("Seeded default access:");
  console.log(`- frontend: ${DEFAULT_FRONTEND.username} / ${DEFAULT_FRONTEND.password}`);
  console.log(`- admin: ${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
  console.log("- platform settings: platform");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
