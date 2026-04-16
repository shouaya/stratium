import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const FEATURE_ENV_PATH = path.resolve(currentDir, "../../.env.test.feature");
export const FEATURE_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/stratium_feature_test?schema=public";

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, "");

export const loadFeatureTestEnv = (): void => {
  const raw = readFileSync(FEATURE_ENV_PATH, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmed.slice(separatorIndex + 1).trim());
    process.env[key] = value;
  }
};
