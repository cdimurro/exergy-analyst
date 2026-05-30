import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const sourceRoot = join(process.cwd(), "src");

const forbiddenPatterns = [
  /OxEon/,
  /X-energy/,
  /EDEN/,
  /Eden Energy/,
  /Fischer/,
  /Fischer-Tropsch/,
];

const skippedPathFragments = [
  "__tests__",
  "product-stress-corpus.ts",
];

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const rel = relative(sourceRoot, path);
    if (skippedPathFragments.some((fragment) => rel.includes(fragment))) {
      continue;
    }
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...productionFiles(path));
    } else if (/\.(ts|tsx|js|jsx|json)$/.test(path)) {
      files.push(path);
    }
  }
  return files;
}

describe("production fixture leakage guard", () => {
  it("keeps product-stress fixture identities out of workspace production code", () => {
    const leaks: string[] = [];
    for (const file of productionFiles(sourceRoot)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(text)) {
          leaks.push(`${relative(process.cwd(), file)} matched ${pattern.source}`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });
});
