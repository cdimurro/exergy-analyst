/**
 * Guard: in-house custom components must be imported from
 * `@/components/ui/custom/*`, not the shadcn library surface at
 * `@/components/ui/*`.
 *
 * Background: prior to CC-BE-FIX-0009, the workspace had two coexisting
 * naming conventions at `workspace/src/components/ui/`:
 *   - Uppercase custom components (Avatar.tsx, Button.tsx, ...) — in-house
 *   - Lowercase shadcn components (avatar.tsx, button.tsx, ...) — library
 *
 * These collided under TypeScript's `forceConsistentCasingInFileNames`,
 * breaking the build even on case-sensitive filesystems. The resolution
 * moved the in-house components to `workspace/src/components/ui/custom/`
 * and reserved the root `ui/` surface for shadcn. This test prevents
 * regression by failing any root-level import of a known custom component.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CUSTOM_COMPONENT_NAMES = [
  "Avatar",
  "Badge",
  "Button",
  "Card",
  "ErrorBanner",
  "Input",
  "Skeleton",
  "StatusBadge",
  "UpgradePrompt",
] as const;

// One regex for all names: "@/components/ui/Name" where Name is one of the
// 9 custom components above. Note: intentionally matches the root surface
// only — imports from `@/components/ui/custom/Name` are fine and won't be
// flagged because the pattern does not include `/custom/`.
const FORBIDDEN_ROOT_IMPORT = new RegExp(
  String.raw`from\s+["']@/components/ui/(?:${CUSTOM_COMPONENT_NAMES.join("|")})["']`,
);

const SRC_ROOT = join(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, acc);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("ui/custom namespace guard (CC-BE-FIX-0009)", () => {
  it("no workspace file imports a custom component from the root ui/ surface", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (FORBIDDEN_ROOT_IMPORT.test(content)) {
        offenders.push(relative(SRC_ROOT, file));
      }
    }
    if (offenders.length > 0) {
      const helpful = offenders
        .map((p) => `  - ${p}`)
        .join("\n");
      throw new Error(
        `These files import a custom component from @/components/ui/ instead of @/components/ui/custom/:\n${helpful}\n\n` +
          `Custom components live in workspace/src/components/ui/custom/. ` +
          `Update the import path (e.g., "@/components/ui/Button" → "@/components/ui/custom/Button").`,
      );
    }
    expect(offenders).toEqual([]);
  });
});
