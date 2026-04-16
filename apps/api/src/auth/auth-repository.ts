import { prisma } from "../persistence/prisma-client.js";
import type { PlatformSettingsView } from "./auth.js";

export type AuthSeedInput = {
  username: string;
  passwordHash: string;
  displayName: string;
  tradingAccountId?: string;
};

export interface StoredUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: "frontend" | "admin";
  displayName: string;
  tradingAccountId: string | null;
  isActive: boolean;
}

export interface AuthRepositoryPort {
  getPlatformSettings(): Promise<PlatformSettingsView>;
  findUserByUsername(username: string): Promise<StoredUserRecord | null>;
  listFrontendUsers(): Promise<Array<StoredUserRecord & { role: "frontend" }>>;
  createFrontendUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    tradingAccountId: string;
  }): Promise<StoredUserRecord & { role: "frontend" }>;
  updateFrontendUser(userId: string, input: {
    passwordHash?: string;
    displayName?: string;
    tradingAccountId?: string | null;
    isActive?: boolean;
  }): Promise<StoredUserRecord & { role: "frontend" }>;
  updatePlatformSettings(input: PlatformSettingsView): Promise<PlatformSettingsView>;
}

export class AuthRepository implements AuthRepositoryPort {
  async connect(): Promise<void> {
    await prisma.$connect();
  }

  async close(): Promise<void> {
    await prisma.$disconnect();
  }

  async ensureDefaultAccess(input: {
    frontend: AuthSeedInput;
    admin: AuthSeedInput;
  }): Promise<void> {
    await prisma.appUser.upsert({
      where: { username: input.frontend.username },
      update: {},
      create: {
        username: input.frontend.username,
        passwordHash: input.frontend.passwordHash,
        role: "frontend",
        displayName: input.frontend.displayName,
        tradingAccountId: input.frontend.tradingAccountId ?? input.frontend.username,
        isActive: true
      }
    });

    await prisma.appUser.upsert({
      where: { username: input.admin.username },
      update: {},
      create: {
        username: input.admin.username,
        passwordHash: input.admin.passwordHash,
        role: "admin",
        displayName: input.admin.displayName,
        tradingAccountId: null,
        isActive: true
      }
    });

    await prisma.platformSettings.upsert({
      where: { id: "platform" },
      update: {},
      create: {
        id: "platform",
        platformName: "Stratium Demo",
        platformAnnouncement: "Demo environment. Accounts are issued by admin only.",
        activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
        activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      }
    });
  }

  async findUserByUsername(username: string): Promise<StoredUserRecord | null> {
    const user = await prisma.appUser.findUnique({
      where: { username }
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: user.role as "frontend" | "admin",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async listFrontendUsers(): Promise<Array<StoredUserRecord & { role: "frontend" }>> {
    const users = await prisma.appUser.findMany({
      where: { role: "frontend" },
      orderBy: { username: "asc" }
    });

    return users.map((user) => ({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend" as const,
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    }));
  }

  async createFrontendUser(input: {
    username: string;
    passwordHash: string;
    displayName: string;
    tradingAccountId: string;
  }): Promise<StoredUserRecord & { role: "frontend" }> {
    const user = await prisma.appUser.create({
      data: {
        username: input.username,
        passwordHash: input.passwordHash,
        role: "frontend",
        displayName: input.displayName,
        tradingAccountId: input.tradingAccountId,
        isActive: true
      }
    });

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async updateFrontendUser(userId: string, input: {
    passwordHash?: string;
    displayName?: string;
    tradingAccountId?: string | null;
    isActive?: boolean;
  }): Promise<StoredUserRecord & { role: "frontend" }> {
    const user = await prisma.appUser.update({
      where: { id: userId },
      data: {
        ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.tradingAccountId !== undefined ? { tradingAccountId: input.tradingAccountId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });

    return {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      role: "frontend",
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }

  async getPlatformSettings(): Promise<PlatformSettingsView> {
    const settings = await prisma.platformSettings.findUnique({
      where: { id: "platform" }
    });

    if (!settings) {
      return {
        platformName: "Stratium Demo",
        platformAnnouncement: "",
        activeExchange: process.env.TRADING_EXCHANGE ?? process.env.MARKET_SOURCE ?? "hyperliquid",
        activeSymbol: process.env.TRADING_SYMBOL ?? "BTC-USD",
        maintenanceMode: false,
        allowFrontendTrading: true,
        allowManualTicks: true
      };
    }

    return {
      platformName: settings.platformName,
      platformAnnouncement: settings.platformAnnouncement ?? "",
      activeExchange: settings.activeExchange,
      activeSymbol: settings.activeSymbol,
      maintenanceMode: settings.maintenanceMode,
      allowFrontendTrading: settings.allowFrontendTrading,
      allowManualTicks: settings.allowManualTicks
    };
  }

  async updatePlatformSettings(input: PlatformSettingsView): Promise<PlatformSettingsView> {
    const settings = await prisma.platformSettings.upsert({
      where: { id: "platform" },
      update: {
        platformName: input.platformName,
        platformAnnouncement: input.platformAnnouncement || null,
        activeExchange: input.activeExchange,
        activeSymbol: input.activeSymbol,
        maintenanceMode: input.maintenanceMode,
        allowFrontendTrading: input.allowFrontendTrading,
        allowManualTicks: input.allowManualTicks
      },
      create: {
        id: "platform",
        platformName: input.platformName,
        platformAnnouncement: input.platformAnnouncement || null,
        activeExchange: input.activeExchange,
        activeSymbol: input.activeSymbol,
        maintenanceMode: input.maintenanceMode,
        allowFrontendTrading: input.allowFrontendTrading,
        allowManualTicks: input.allowManualTicks
      }
    });

    return {
      platformName: settings.platformName,
      platformAnnouncement: settings.platformAnnouncement ?? "",
      activeExchange: settings.activeExchange,
      activeSymbol: settings.activeSymbol,
      maintenanceMode: settings.maintenanceMode,
      allowFrontendTrading: settings.allowFrontendTrading,
      allowManualTicks: settings.allowManualTicks
    };
  }
}
