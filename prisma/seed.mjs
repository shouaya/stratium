import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANALYST_BOT_ID = "__analyst__";
const ANALYST_ACCOUNT_ID = "__global__";
const TRADER_ACCOUNT_PASSWORD = "demo123456";

const DEFAULT_FRONTEND = {
  username: "demo",
  password: TRADER_ACCOUNT_PASSWORD,
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
  allowManualTicks: true
};

const TRADER_ACCOUNTS = [
  DEFAULT_FRONTEND,
  {
    username: "balanced",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Balanced Trader",
    tradingAccountId: "paper-balanced-trader",
    botId: "balanced-btc-trader",
    strategyMemo:
      "Act as a balanced simulation trader. Require a clear setup, prefer smaller size while learning, and avoid trading only to create activity."
  },
  {
    username: "trend",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Trend-Following Trader",
    tradingAccountId: "paper-trend-trader",
    botId: "trend-btc-trader",
    strategyMemo:
      "Prefer trend-following setups only. Look for breakout continuation or pullback-to-support/resistance. Avoid counter-trend trades and do not enter during range chop."
  },
  {
    username: "mean",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Mean-Reversion Trader",
    tradingAccountId: "paper-mean-trader",
    botId: "mean-btc-trader",
    strategyMemo:
      "Prefer mean-reversion only when price is extended, RSI is near an extreme, spread is normal, and there is a clear invalidation. Avoid breakout chasing."
  },
  {
    username: "breakout",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Breakout Trader",
    tradingAccountId: "paper-breakout-trader",
    botId: "breakout-btc-trader",
    strategyMemo:
      "Prefer volatility expansion and confirmed level breaks. Avoid entering after the move is already extended; use controlled entries near the breakout level and define invalidation before opening risk."
  },
  {
    username: "riskoff",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Risk-Off Trader",
    tradingAccountId: "paper-riskoff-trader",
    botId: "risk-off-btc-trader",
    strategyMemo:
      "Act as the conservative risk-off trader. Trade rarely, prioritize capital preservation, close invalidated exposure quickly, and require excellent reward-to-risk before opening a new position."
  },
  {
    username: "probe",
    password: TRADER_ACCOUNT_PASSWORD,
    displayName: "Baseline Probe Trader",
    tradingAccountId: "paper-probe-trader",
    botId: "baseline-probe-btc-trader",
    strategyMemo:
      "Use this account for execution-path probing and diagnostics. Keep sizes tiny, prefer simple testable actions, and write clear feedback for simulator validation."
  }
];

const derivePasswordHash = (password, salt = randomBytes(16).toString("hex")) => {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
};

async function seedFrontendUser(user) {
  await prisma.appUser.upsert({
    where: { username: user.username },
    update: {
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: true
    },
    create: {
      username: user.username,
      passwordHash: derivePasswordHash(user.password),
      role: "frontend",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: true
    }
  });
}

async function seedTraderAccounts() {
  for (const account of TRADER_ACCOUNTS) {
    await seedFrontendUser(account);
  }
}

async function seedTraderStrategyMemos() {
  const now = new Date();
  const accountsWithMemos = TRADER_ACCOUNTS.filter((account) => account.botId && account.strategyMemo);

  for (const account of accountsWithMemos) {
    await prisma.aiTraderMemory.upsert({
      where: {
        botId_memoryKey: {
          botId: ANALYST_BOT_ID,
          memoryKey: `strategy_memo/${account.botId}/latest`
        }
      },
      update: {},
      create: {
        botId: ANALYST_BOT_ID,
        accountId: ANALYST_ACCOUNT_ID,
        memoryKey: `strategy_memo/${account.botId}/latest`,
        value: account.strategyMemo,
        importance: 0.9,
        source: "strategy_package",
        lastSeenAt: now
      }
    });
  }
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
      allowManualTicks: DEFAULT_PLATFORM_SETTINGS.allowManualTicks
    },
    create: DEFAULT_PLATFORM_SETTINGS
  });
}

async function main() {
  await seedTraderAccounts();
  await seedAdminUser();
  await seedPlatformSettings();
  await seedTraderStrategyMemos();

  console.log("Seeded default access:");
  for (const account of TRADER_ACCOUNTS) {
    console.log(`- frontend: ${account.username} / ${account.password} (${account.tradingAccountId})`);
  }
  console.log(`- admin: ${DEFAULT_ADMIN.username} / ${DEFAULT_ADMIN.password}`);
  console.log(`- trader strategy memos: ${TRADER_ACCOUNTS.filter((account) => account.botId).length}`);
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
