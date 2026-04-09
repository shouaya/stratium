import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

const packageChecks = [
  {
    name: "@stratium/shared",
    packageJsonPath: path.join(repoRoot, "packages/shared/package.json")
  },
  {
    name: "@stratium/trading-core",
    packageJsonPath: path.join(repoRoot, "packages/trading-core/package.json")
  },
  {
    name: "@stratium/api",
    packageJsonPath: path.join(repoRoot, "apps/api/package.json")
  },
  {
    name: "@stratium/job-runner",
    packageJsonPath: path.join(repoRoot, "apps/job-runner/package.json")
  }
];

const distRoots = [
  path.join(repoRoot, "packages/shared/dist"),
  path.join(repoRoot, "packages/trading-core/dist"),
  path.join(repoRoot, "apps/api/dist"),
  path.join(repoRoot, "apps/job-runner/dist")
];

const errors = [];

const exists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const collectJsFiles = async (rootPath) => {
  if (!await exists(rootPath)) {
    errors.push(`Missing dist directory: ${path.relative(repoRoot, rootPath)}`);
    return [];
  }

  const results = [];

  const visit = async (currentPath) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(nextPath);
        continue;
      }

      if (entry.isFile() && nextPath.endsWith(".js")) {
        results.push(nextPath);
      }
    }
  };

  await visit(rootPath);
  return results;
};

const extractSpecifiers = (source) => {
  const patterns = [
    /\bimport\s+(?:type\s+)?[^"'`]*?\sfrom\s+["'`]([^"'`]+)["'`]/g,
    /\bexport\s+[^"'`]*?\sfrom\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  ];

  const specifiers = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
};

const hasRuntimeExtension = (specifier) =>
  specifier.endsWith(".js") || specifier.endsWith(".mjs") || specifier.endsWith(".cjs") || specifier.endsWith(".json") || specifier.endsWith(".node");

const resolveRelativeSpecifier = (sourceFilePath, specifier) => {
  const resolvedBase = path.resolve(path.dirname(sourceFilePath), specifier);
  return [
    resolvedBase,
    `${resolvedBase}.js`,
    `${resolvedBase}.mjs`,
    `${resolvedBase}.cjs`,
    path.join(resolvedBase, "index.js")
  ];
};

const checkPackageEntries = async () => {
  for (const pkg of packageChecks) {
    const raw = await fs.readFile(pkg.packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const packageDir = path.dirname(pkg.packageJsonPath);

    const targets = [];

    if (typeof parsed.main === "string") {
      targets.push({ label: "main", value: parsed.main });
    }
    if (typeof parsed.types === "string") {
      targets.push({ label: "types", value: parsed.types });
    }
    if (parsed.exports && typeof parsed.exports === "object") {
      for (const [key, value] of Object.entries(parsed.exports)) {
        if (typeof value === "string") {
          targets.push({ label: `exports.${key}`, value });
          continue;
        }
        if (value && typeof value === "object") {
          for (const [subKey, subValue] of Object.entries(value)) {
            if (typeof subValue === "string") {
              targets.push({ label: `exports.${key}.${subKey}`, value: subValue });
            }
          }
        }
      }
    }

    for (const target of targets) {
      const targetPath = path.resolve(packageDir, target.value);
      if (!await exists(targetPath)) {
        errors.push(`${pkg.name} ${target.label} points to missing file: ${path.relative(repoRoot, targetPath)}`);
      }
    }
  }
};

const checkCompiledImports = async () => {
  for (const rootPath of distRoots) {
    const files = await collectJsFiles(rootPath);
    for (const filePath of files) {
      const source = await fs.readFile(filePath, "utf8");
      const specifiers = extractSpecifiers(source);

      for (const specifier of specifiers) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          continue;
        }

        if (!hasRuntimeExtension(specifier)) {
          errors.push(`Missing ESM extension in ${path.relative(repoRoot, filePath)} -> ${specifier}`);
          continue;
        }

        const candidates = resolveRelativeSpecifier(filePath, specifier);
        const resolved = await Promise.any(
          candidates.map(async (candidate) => {
            if (await exists(candidate)) {
              return candidate;
            }
            throw new Error(candidate);
          })
        ).catch(() => null);

        if (!resolved) {
          errors.push(`Broken relative import in ${path.relative(repoRoot, filePath)} -> ${specifier}`);
        }
      }
    }
  }
};

await checkPackageEntries();
await checkCompiledImports();

if (errors.length > 0) {
  console.error("Production ESM check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Production ESM check passed.");
