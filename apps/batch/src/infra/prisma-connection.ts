import { PrismaClient } from "@prisma/client";

const buildLocalhostFallbackUrl = (): string | null => {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);

    if (parsed.hostname !== "db") {
      return null;
    }

    parsed.hostname = "localhost";
    return parsed.toString();
  } catch {
    return null;
  }
};

export const connectPrismaWithLocalhostFallback = async (): Promise<PrismaClient> => {
  const primary = new PrismaClient();

  try {
    await primary.$connect();
    return primary;
  } catch (error: unknown) {
    const fallbackUrl = buildLocalhostFallbackUrl();

    if (!fallbackUrl) {
      await primary.$disconnect().catch(() => undefined);
      throw error;
    }

    console.warn("Primary DATABASE_URL was unreachable. Retrying with localhost:5432.");
    await primary.$disconnect().catch(() => undefined);

    const fallback = new PrismaClient({
      datasourceUrl: fallbackUrl
    });

    try {
      await fallback.$connect();
      return fallback;
    } catch (fallbackError: unknown) {
      await fallback.$disconnect().catch(() => undefined);
      throw fallbackError;
    }
  }
};
