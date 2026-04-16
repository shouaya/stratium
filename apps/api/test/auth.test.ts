import { describe, expect, it, vi } from "vitest";
import { AuthRuntime, DEFAULT_CREDENTIALS } from "../src/auth/auth";

describe("AuthRuntime", () => {
  const makeRepository = () => ({
    getPlatformSettings: vi.fn(async () => ({
      platformName: "Stratium Demo",
      platformAnnouncement: "",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: true,
      allowManualTicks: true
    })),
    findUserByUsername: vi.fn(),
    listFrontendUsers: vi.fn(async () => []),
    createFrontendUser: vi.fn(),
    updateFrontendUser: vi.fn(),
    updatePlatformSettings: vi.fn(async (input) => input)
  });

  it("bootstraps settings, logs in valid users, tracks sessions, and logs out", async () => {
    const repository = makeRepository();
    const runtime = new AuthRuntime(repository as never);
    const createdUser = {
      id: "user-1",
      username: "demo",
      role: "frontend" as const,
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true,
      passwordHash: ""
    };

    repository.createFrontendUser.mockImplementation(async (input) => {
      createdUser.passwordHash = input.passwordHash;
      return { ...createdUser, ...input };
    });
    repository.findUserByUsername.mockImplementation(async () => createdUser);

    expect(await runtime.bootstrap()).toMatchObject({ platformName: "Stratium Demo" });
    expect(DEFAULT_CREDENTIALS.frontend.username).toBe("demo");
    expect(DEFAULT_CREDENTIALS.admin.username).toBe("admin");

    const user = await runtime.createFrontendUser({
      username: " Demo ",
      password: "demo123456",
      displayName: " Demo Trader ",
      tradingAccountId: " paper-demo "
    });
    expect(user).toMatchObject({
      username: "demo",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo"
    });

    const session = await runtime.login("demo", "demo123456", "frontend");
    expect(session.user).toMatchObject({
      username: "demo",
      tradingAccountId: "paper-demo"
    });
    expect(runtime.getSession(session.token)?.user.username).toBe("demo");

    runtime.logout(session.token);
    expect(runtime.getSession(session.token)).toBeNull();
    runtime.logout(undefined);
  });

  it("rejects invalid login cases and generates account ids for blank inputs", async () => {
    const repository = makeRepository();
    const runtime = new AuthRuntime(repository as never);
    repository.createFrontendUser.mockImplementation(async (input) => ({
      id: "user-2",
      username: input.username,
      role: "frontend" as const,
      displayName: input.displayName,
      tradingAccountId: input.tradingAccountId,
      isActive: true,
      passwordHash: input.passwordHash
    }));

    const blankUser = await runtime.createFrontendUser({
      username: " !!! ",
      password: "demo123456",
      displayName: "Blank User",
      tradingAccountId: "   "
    });
    expect(blankUser.username).toBe("!!!");
    expect(blankUser.tradingAccountId?.startsWith("paper-")).toBe(true);

    const validUser = {
      id: "user-3",
      username: "demo",
      role: "frontend" as const,
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true,
      passwordHash: repository.createFrontendUser.mock.calls[0]?.[0]?.passwordHash ?? "bad"
    };

    repository.findUserByUsername.mockResolvedValue(null);
    await expect(runtime.login("demo", "demo123456", "frontend")).rejects.toThrow("Invalid credentials.");

    repository.findUserByUsername.mockResolvedValue({ ...validUser, role: "admin" });
    await expect(runtime.login("demo", "demo123456", "frontend")).rejects.toThrow("Invalid credentials.");

    repository.findUserByUsername.mockResolvedValue({ ...validUser, isActive: false });
    await expect(runtime.login("demo", "demo123456", "frontend")).rejects.toThrow("Invalid credentials.");

    repository.findUserByUsername.mockResolvedValue({ ...validUser, passwordHash: "broken" });
    await expect(runtime.login("demo", "demo123456", "frontend")).rejects.toThrow("Invalid credentials.");

    repository.findUserByUsername.mockResolvedValue({ ...validUser, tradingAccountId: null });
    await expect(runtime.login("demo", "demo123456", "frontend")).rejects.toThrow("Trading account is not assigned.");
  });

  it("returns null for missing sessions and preserves undefined optional update fields", async () => {
    const repository = makeRepository();
    const runtime = new AuthRuntime(repository as never);

    repository.updateFrontendUser.mockResolvedValue({
      id: "user-5",
      username: "bob",
      role: "frontend" as const,
      displayName: "Bob",
      tradingAccountId: "paper-bob",
      isActive: true,
      passwordHash: "hash"
    });

    expect(runtime.getSession(undefined)).toBeNull();

    await runtime.updateFrontendUser("user-5", {
      isActive: true
    });

    expect(repository.updateFrontendUser).toHaveBeenCalledWith("user-5", {
      passwordHash: undefined,
      displayName: undefined,
      tradingAccountId: undefined,
      isActive: true
    });
  });

  it("expires sessions after the configured ttl", async () => {
    const repository = makeRepository();
    let now = 1_700_000_000_000;
    const runtime = new AuthRuntime(repository as never, {
      sessionTtlMs: 1_000,
      now: () => now
    });
    const createdUser = {
      id: "user-6",
      username: "demo",
      role: "frontend" as const,
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo",
      isActive: true,
      passwordHash: ""
    };

    repository.createFrontendUser.mockImplementation(async (input) => {
      createdUser.passwordHash = input.passwordHash;
      return { ...createdUser, ...input };
    });
    repository.findUserByUsername.mockResolvedValue(createdUser);

    await runtime.createFrontendUser({
      username: "demo",
      password: "demo123456",
      displayName: "Demo Trader",
      tradingAccountId: "paper-demo"
    });

    const session = await runtime.login("demo", "demo123456", "frontend");
    expect(runtime.getSession(session.token)?.user.username).toBe("demo");

    now += 1_001;

    expect(runtime.getSession(session.token)).toBeNull();
  });

  it("lists and updates frontend users and platform settings", async () => {
    const repository = makeRepository();
    const runtime = new AuthRuntime(repository as never);
    repository.listFrontendUsers.mockResolvedValue([{
      id: "user-4",
      username: "alice",
      role: "frontend",
      displayName: "Alice",
      tradingAccountId: "paper-alice",
      isActive: true,
      passwordHash: "hash"
    }]);
    repository.updateFrontendUser.mockImplementation(async (userId, input) => ({
      id: userId,
      username: "alice",
      role: "frontend" as const,
      displayName: input.displayName ?? "Alice",
      tradingAccountId: input.tradingAccountId === undefined ? "paper-alice" : input.tradingAccountId,
      isActive: input.isActive ?? true,
      passwordHash: input.passwordHash ?? "hash"
    }));

    expect(await runtime.listFrontendUsers()).toEqual([{
      id: "user-4",
      username: "alice",
      role: "frontend",
      displayName: "Alice",
      tradingAccountId: "paper-alice",
      isActive: true
    }]);

    const updated = await runtime.updateFrontendUser("user-4", {
      password: "nextpass",
      displayName: " Alice 2 ",
      tradingAccountId: "  ",
      isActive: false
    });
    expect(updated).toMatchObject({
      id: "user-4",
      displayName: "Alice 2",
      tradingAccountId: null,
      isActive: false
    });

    expect(await runtime.updatePlatformSettings({
      platformName: "Desk",
      platformAnnouncement: "Notice",
      activeExchange: "hyperliquid",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false,
      allowManualTicks: false
    })).toMatchObject({
      platformName: "Desk",
      activeSymbol: "BTC-USD",
      maintenanceMode: false,
      allowFrontendTrading: false
    });
  });
});
