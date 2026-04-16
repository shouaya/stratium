import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startTraderMcpHttpServer } from "../../apps/trader-mcp/src/server/server";
import {
  allocateFeatureTestPort,
  loadFeatureTableRows,
  resetFeatureTestDatabase,
  seedFeatureTestDatabase,
  startFeatureTestApiServer,
  type FeatureDbInit,
  type FeatureTableName
} from "./feature-test-helpers";

type ScenarioStep =
  | {
    id: string;
    type: "api";
    actor?: "admin" | "frontend";
    method?: string;
    url?: string;
    requestFile?: string;
    responseFile: string;
    captureAs?: string;
  }
  | {
    id: string;
    type: "mcp";
    tool?: string;
    requestFile?: string;
    responseFile: string;
    captureAs?: string;
  }
  | {
    id: string;
    type: "wait";
    durationMs: number;
  };

type ScenarioConfig = {
  name: string;
  accountId?: string;
  symbol?: string;
};

type ApiExpectation = {
  statusCode: number;
  bodyMatchObject?: unknown;
  bodyExact?: unknown;
};

type McpExpectation = {
  isError?: boolean;
  structuredContentMatchObject?: unknown;
  structuredContentExact?: unknown;
};

const readJson = <T>(filename: string): T => JSON.parse(readFileSync(filename, "utf8")) as T;

const readScenarioJson = <T>(scenarioDir: string, relativePath: string): T =>
  readJson<T>(path.join(scenarioDir, relativePath));

const loadScenarioDbInit = (scenarioDir: string, relativePath: string): FeatureDbInit => {
  const absolutePath = path.join(scenarioDir, relativePath);
  const fixture = readJson<FeatureDbInit & { extends?: string }>(absolutePath);

  if (!fixture.extends) {
    return fixture;
  }

  const baseFixture = loadScenarioDbInit(path.dirname(absolutePath), fixture.extends);
  const { extends: _ignored, ...rest } = fixture;

  return {
    ...baseFixture,
    ...rest
  };
};

const getValueAtPath = (source: unknown, dottedPath: string): unknown =>
  dottedPath.split(".").reduce<unknown>((current, segment) => {
    if (current == null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }

    if (typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);

const resolveTemplateString = (value: string, captures: Record<string, unknown>): string =>
  value.replace(/{{\s*([^}]+)\s*}}/g, (_match, capturePath: string) => {
    const resolved = getValueAtPath(captures, capturePath.trim());
    return resolved == null ? "" : String(resolved);
  });

const resolveTemplates = (value: unknown, captures: Record<string, unknown>): unknown => {
  if (typeof value === "string") {
    return resolveTemplateString(value, captures);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplates(entry, captures));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, resolveTemplates(entry, captures)])
    );
  }

  return value;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const raw = await response.text();
  return raw ? JSON.parse(raw) as unknown : undefined;
};

const parseCsv = (input: string): { headers: string[]; rows: Array<Record<string, string>> } => {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      headers: [],
      rows: []
    };
  }

  const headers = lines[0]?.split(",").map((entry) => entry.trim()) ?? [];
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((entry) => entry.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });

  return {
    headers,
    rows
  };
};

const projectRows = (rows: Array<Record<string, string>>, headers: string[]): Array<Record<string, string>> =>
  rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""])));

const compareExpectedCsvTables = async (
  scenarioDir: string,
  options: { accountId: string; symbol: string }
) => {
  const expectedDbDir = path.join(scenarioDir, "expected-db");
  const entries = readdirSync(expectedDbDir).filter((entry) => entry.endsWith(".csv")).sort();

  for (const entry of entries) {
    const table = entry.replace(/\.csv$/i, "") as FeatureTableName;
    const expected = parseCsv(readFileSync(path.join(expectedDbDir, entry), "utf8"));
    const actual = await loadFeatureTableRows(table, options);
    expect(projectRows(actual, expected.headers)).toEqual(expected.rows);
  }
};

const loginDefaultUsers = async (apiBaseUrl: string) => {
  const adminResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: "admin",
      password: "admin123456",
      role: "admin"
    })
  });
  const frontendResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: "demo",
      password: "demo123456",
      role: "frontend"
    })
  });

  const adminBody = await readResponseBody(adminResponse) as { token: string };
  const frontendBody = await readResponseBody(frontendResponse) as { token: string };

  expect(adminResponse.status).toBe(200);
  expect(frontendResponse.status).toBe(200);

  return {
    admin: adminBody.token,
    frontend: frontendBody.token
  };
};

export const defineScenarioTest = (metaUrl: string): void => {
  const scenarioDir = path.dirname(fileURLToPath(metaUrl));
  const config = readScenarioJson<ScenarioConfig>(scenarioDir, "scenario.json");
  const dbInit = loadScenarioDbInit(scenarioDir, "db.init.json");
  const steps = readScenarioJson<ScenarioStep[]>(scenarioDir, "steps.json");

  describe(config.name, () => {
    const cleanups: Array<() => Promise<void>> = [];

    beforeEach(async () => {
      await resetFeatureTestDatabase();
      await seedFeatureTestDatabase(dbInit);
    });

    afterEach(async () => {
      await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
    });

    it("runs the scenario from fixture files", async () => {
      const apiServer = await startFeatureTestApiServer();
      cleanups.push(apiServer.close);

      const tokens = await loginDefaultUsers(apiServer.baseUrl);
      const captures: Record<string, unknown> = {};
      let mcpClient: Client | null = null;

      const ensureMcpClient = async () => {
        if (mcpClient) {
          return mcpClient;
        }

        const mcpPort = await allocateFeatureTestPort();
        const mcpRuntime = await startTraderMcpHttpServer({
          apiBaseUrl: apiServer.baseUrl,
          host: "127.0.0.1",
          port: mcpPort,
          frontendUsername: "demo",
          frontendPassword: "demo123456"
        });
        cleanups.push(mcpRuntime.close);

        mcpClient = new Client({
          name: "feature-test-client",
          version: "1.0.0"
        });
        cleanups.push(async () => {
          await mcpClient?.close();
        });

        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`));
        cleanups.push(async () => {
          await transport.close();
        });

        await mcpClient.connect(transport);
        return mcpClient;
      };

      for (const step of steps) {
        if (step.type === "wait") {
          await new Promise((resolve) => setTimeout(resolve, step.durationMs));
          continue;
        }

        if (step.type === "api") {
          const requestPayload = step.requestFile
            ? resolveTemplates(readScenarioJson<Record<string, unknown>>(scenarioDir, step.requestFile), captures)
            : undefined;
          const responseExpectation = readScenarioJson<ApiExpectation>(scenarioDir, step.responseFile);
          const resolvedUrl = resolveTemplateString(step.url ?? "", captures);
          const response = await fetch(`${apiServer.baseUrl}${resolvedUrl}`, {
            method: step.method,
            headers: {
              ...(requestPayload ? { "content-type": "application/json" } : {}),
              ...(step.actor ? { authorization: `Bearer ${tokens[step.actor]}` } : {})
            },
            ...(requestPayload ? { body: JSON.stringify(requestPayload) } : {})
          });
          const responseBody = await readResponseBody(response);

          expect(response.status).toBe(responseExpectation.statusCode);
          if (responseExpectation.bodyMatchObject !== undefined) {
            expect(responseBody).toMatchObject(responseExpectation.bodyMatchObject);
          }
          if (responseExpectation.bodyExact !== undefined) {
            expect(responseBody).toEqual(responseExpectation.bodyExact);
          }
          if (step.captureAs) {
            captures[step.captureAs] = responseBody;
          }

          continue;
        }

        const requestPayload = step.requestFile
          ? resolveTemplates(readScenarioJson<Record<string, unknown>>(scenarioDir, step.requestFile), captures)
          : {};
        const responseExpectation = readScenarioJson<McpExpectation>(scenarioDir, step.responseFile);
        const client = await ensureMcpClient();
        const result = await client.callTool({
          name: step.tool ?? "",
          arguments: requestPayload
        });

        if (responseExpectation.isError !== undefined) {
          expect(result.isError).toBe(responseExpectation.isError);
        }
        if (responseExpectation.structuredContentMatchObject !== undefined) {
          expect(result.structuredContent).toMatchObject(responseExpectation.structuredContentMatchObject);
        }
        if (responseExpectation.structuredContentExact !== undefined) {
          expect(result.structuredContent).toEqual(responseExpectation.structuredContentExact);
        }
        if (step.captureAs) {
          captures[step.captureAs] = result.structuredContent;
        }
      }

      await compareExpectedCsvTables(scenarioDir, {
        accountId: config.accountId ?? "paper-account-1",
        symbol: config.symbol ?? "BTC-USD"
      });
    });
  });
};
