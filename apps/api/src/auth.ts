import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { TradingRepository } from "./repository";

export type AuthRole = "frontend" | "admin";

export interface AuthUserProfile {
  id: string;
  username: string;
  role: AuthRole;
  displayName: string;
  tradingAccountId: string | null;
  isActive: boolean;
}

export interface PlatformSettingsView {
  platformName: string;
  platformAnnouncement: string;
  allowFrontendTrading: boolean;
  allowManualTicks: boolean;
  allowSimulatorControl: boolean;
}

export interface FrontendUserView extends AuthUserProfile {
  role: "frontend";
}

interface StoredUserRecord extends AuthUserProfile {
  passwordHash: string;
}

export interface AuthSession {
  token: string;
  user: AuthUserProfile;
}

const DEFAULT_FRONTEND_USERNAME = "demo";
const DEFAULT_FRONTEND_PASSWORD = "demo123456";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123456";

const issueTradingAccountId = (username: string): string => {
  const normalized = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

  return `paper-${normalized || randomUUID().slice(0, 8)}`;
};

const derivePasswordHash = (password: string, salt = randomBytes(16).toString("hex")): string => {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
};

const verifyPassword = (password: string, storedHash: string): boolean => {
  const [salt, expected] = storedHash.split(":");

  if (!salt || !expected) {
    return false;
  }

  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");

  if (actual.byteLength !== expectedBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(actual, expectedBuffer);
};

export const DEFAULT_CREDENTIALS = {
  frontend: {
    username: DEFAULT_FRONTEND_USERNAME,
    password: DEFAULT_FRONTEND_PASSWORD
  },
  admin: {
    username: DEFAULT_ADMIN_USERNAME,
    password: DEFAULT_ADMIN_PASSWORD
  }
};

export class AuthRuntime {
  private readonly sessions = new Map<string, AuthSession>();

  constructor(private readonly repository: TradingRepository) {}

  async bootstrap(): Promise<PlatformSettingsView> {
    return this.repository.getPlatformSettings();
  }

  async login(username: string, password: string, expectedRole: AuthRole): Promise<AuthSession> {
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.repository.findUserByUsername(normalizedUsername);

    if (!user || user.role !== expectedRole || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid credentials.");
    }

    if (expectedRole === "frontend" && !user.tradingAccountId) {
      throw new Error("Trading account is not assigned.");
    }

    const session: AuthSession = {
      token: `${randomUUID()}-${randomBytes(16).toString("hex")}`,
      user: this.toProfile(user)
    };

    this.sessions.set(session.token, session);
    return session;
  }

  getSession(token: string | undefined): AuthSession | null {
    if (!token) {
      return null;
    }

    return this.sessions.get(token) ?? null;
  }

  logout(token: string | undefined): void {
    if (!token) {
      return;
    }

    this.sessions.delete(token);
  }

  async listFrontendUsers(): Promise<FrontendUserView[]> {
    const users = await this.repository.listFrontendUsers();
    return users.map((user) => ({ ...this.toProfile(user), role: "frontend" as const }));
  }

  async createFrontendUser(input: {
    username: string;
    password: string;
    displayName: string;
    tradingAccountId?: string | null;
  }): Promise<FrontendUserView> {
    const normalizedUsername = input.username.trim().toLowerCase();
    const user = await this.repository.createFrontendUser({
      username: normalizedUsername,
      passwordHash: derivePasswordHash(input.password),
      displayName: input.displayName.trim(),
      tradingAccountId: input.tradingAccountId?.trim() || issueTradingAccountId(normalizedUsername)
    });

    return { ...this.toProfile(user), role: "frontend" };
  }

  async updateFrontendUser(userId: string, input: {
    password?: string;
    displayName?: string;
    tradingAccountId?: string | null;
    isActive?: boolean;
  }): Promise<FrontendUserView> {
    const user = await this.repository.updateFrontendUser(userId, {
      passwordHash: input.password ? derivePasswordHash(input.password) : undefined,
      displayName: input.displayName?.trim(),
      tradingAccountId: input.tradingAccountId === undefined ? undefined : (input.tradingAccountId?.trim() || null),
      isActive: input.isActive
    });

    return { ...this.toProfile(user), role: "frontend" };
  }

  async updatePlatformSettings(input: PlatformSettingsView): Promise<PlatformSettingsView> {
    return this.repository.updatePlatformSettings(input);
  }

  private toProfile(user: StoredUserRecord): AuthUserProfile {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      tradingAccountId: user.tradingAccountId,
      isActive: user.isActive
    };
  }
}
