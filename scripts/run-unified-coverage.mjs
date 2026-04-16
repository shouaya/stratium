import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import istanbulCoverage from "../node_modules/.pnpm/node_modules/istanbul-lib-coverage/index.js";
import istanbulReport from "../node_modules/.pnpm/node_modules/istanbul-lib-report/index.js";
import istanbulReports from "../node_modules/.pnpm/node_modules/istanbul-reports/index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..");
const coverageRoot = path.join(repoRoot, "coverage");
const tempCoverageRoot = path.join(coverageRoot, "tmp");
const mergedCoverageRoot = path.join(coverageRoot, "all");
const unifiedReportPath = path.join(repoRoot, "TEST_COVERAGE_REPORT.md");

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv
    }
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }

  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
};

const parseCount = (output, label) => {
  const match = output.match(new RegExp(`${label}\\s+(\\d+)\\s+passed(?:\\s+\\((\\d+)\\))?`));
  if (!match) {
    return 0;
  }

  return Number(match[2] ?? match[1]);
};

const formatDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const formatPercent = (value) => `${value.toFixed(2)}%`;

const suiteResults = [];

const writeUnifiedReport = (summary, results) => {
  const totals = results.reduce(
    (acc, result) => {
      acc.testFiles += result.testFiles;
      acc.tests += result.tests;
      return acc;
    },
    { testFiles: 0, tests: 0 }
  );

  const reportJson = {
    generatedOn: formatDate(),
    totals,
    coverage: {
      lines: summary.lines.pct,
      statements: summary.statements.pct,
      functions: summary.functions.pct,
      branches: summary.branches.pct
    },
    suites: results
  };

  writeFileSync(
    path.join(mergedCoverageRoot, "unified-test-report.json"),
    `${JSON.stringify(reportJson, null, 2)}\n`,
    "utf8"
  );

  const reportMarkdown = `# Test And Coverage Report

Date: ${formatDate()}

## Totals

- Test files: ${totals.testFiles}
- Tests: ${totals.tests}
- Lines: ${formatPercent(summary.lines.pct)}
- Statements: ${formatPercent(summary.statements.pct)}
- Functions: ${formatPercent(summary.functions.pct)}
- Branches: ${formatPercent(summary.branches.pct)}

## Suites

${results
  .map(
    (result) =>
      `- ${result.name}: ${result.testFiles} files, ${result.tests} tests, coverage artifact \`coverage/tmp/${result.name}/coverage-final.json\``
  )
  .join("\n")}

## Artifacts

- HTML coverage: \`coverage/all/index.html\`
- JSON summary: \`coverage/all/coverage-summary.json\`
- LCOV: \`coverage/all/lcov.info\`
- Unified JSON report: \`coverage/all/unified-test-report.json\`
`;

  writeFileSync(unifiedReportPath, reportMarkdown, "utf8");
};

const suites = [
  {
    name: "api",
    command: "pnpm",
    args: ["--filter", "@stratium/api", "exec", "vitest", "run", "--config", "vitest.config.ts", "--coverage"]
  },
  {
    name: "trader-mcp",
    command: "pnpm",
    args: ["--filter", "@stratium/trader-mcp", "exec", "vitest", "run", "--config", "vitest.config.ts", "--coverage"]
  },
  {
    name: "trading-core",
    command: "pnpm",
    args: ["--filter", "@stratium/trading-core", "exec", "vitest", "run", "--config", "vitest.config.ts", "--coverage"]
  },
  {
    name: "job-runner",
    command: "pnpm",
    args: ["--filter", "@stratium/job-runner", "exec", "vitest", "run", "--config", "vitest.config.ts", "--coverage"]
  },
  {
    name: "web",
    command: "pnpm",
    args: ["--filter", "@stratium/web", "exec", "vitest", "run", "--config", "vitest.config.ts", "--coverage"]
  },
  {
    name: "feature",
    command: "pnpm",
    args: ["exec", "vitest", "run", "--config", "vitest.feature.config.ts", "--coverage"]
  }
];

rmSync(tempCoverageRoot, { recursive: true, force: true });
rmSync(mergedCoverageRoot, { recursive: true, force: true });
mkdirSync(tempCoverageRoot, { recursive: true });
mkdirSync(mergedCoverageRoot, { recursive: true });

for (const suite of suites) {
  const reportsDirectory = path.join(tempCoverageRoot, suite.name);
  mkdirSync(reportsDirectory, { recursive: true });

  console.log(`\n== Running coverage for ${suite.name} ==`);
  const output = run(suite.command, suite.args, {
    UNIFIED_VITEST_COVERAGE: "1",
    UNIFIED_VITEST_COVERAGE_DIR: reportsDirectory
  });

  suiteResults.push({
    name: suite.name,
    testFiles: parseCount(output, "Test Files"),
    tests: parseCount(output, "Tests")
  });
}

const coverageMap = istanbulCoverage.createCoverageMap({});

for (const suite of suites) {
  const coverageFile = path.join(tempCoverageRoot, suite.name, "coverage-final.json");
  if (!existsSync(coverageFile)) {
    throw new Error(`Missing coverage artifact: ${coverageFile}`);
  }

  const raw = JSON.parse(readFileSync(coverageFile, "utf8"));
  coverageMap.merge(raw);
}

const context = istanbulReport.createContext({
  dir: mergedCoverageRoot,
  coverageMap
});

for (const reporterName of ["text", "html", "json-summary", "lcovonly"]) {
  istanbulReports.create(reporterName).execute(context);
}

const summary = coverageMap.getCoverageSummary().toJSON();
writeUnifiedReport(summary, suiteResults);
console.log("\n== Unified coverage summary ==");
console.log(JSON.stringify(summary, null, 2));
