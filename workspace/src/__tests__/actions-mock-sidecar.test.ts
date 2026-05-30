/**
 * Mock-sidecar-off-by-default regression tests (CC-BE-GOV-0109).
 *
 * Before this contract, workspace-triggered battery assessments ran
 * with ``--mock-sidecar`` UNLESS the caller explicitly passed
 * ``mock_sidecar: false``, which made UI-initiated runs look
 * production-grade while using mock solver validation. The fix flips
 * the default and adds visible labeling at every surface.
 *
 * These tests pin the flag-resolution contract (pure function on the
 * action input) and grep the route source for the surfacing strings.
 * Deep route invocation isn't exercised here because it spawns a real
 * Python subprocess — out of scope for a unit-level lock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveMockSidecar } from "@/lib/mock-sidecar";

const ACTIONS_ROUTE_PATH = join(
  __dirname,
  "..",
  "app",
  "api",
  "projects",
  "[id]",
  "actions",
  "route.ts",
);

const actionsRouteSource = readFileSync(ACTIONS_ROUTE_PATH, "utf-8");

describe("resolveMockSidecar (CC-BE-GOV-0109)", () => {
  it("defaults to false when mock_sidecar is omitted", () => {
    expect(resolveMockSidecar({})).toBe(false);
  });

  it("defaults to false when only seed is provided (UI happy path)", () => {
    expect(resolveMockSidecar({ seed: 42 })).toBe(false);
  });

  it("returns true when mock_sidecar=true is explicit", () => {
    expect(resolveMockSidecar({ mock_sidecar: true })).toBe(true);
  });

  it("returns true when demo=true is explicit (alias)", () => {
    expect(resolveMockSidecar({ demo: true })).toBe(true);
  });

  it("returns false when mock_sidecar is explicitly false", () => {
    expect(resolveMockSidecar({ mock_sidecar: false })).toBe(false);
  });

  it("only trips on strict booleans, not truthy strings/numbers", () => {
    // ``?? true`` used to also trip on any non-null value — the new
    // contract opts in on ``=== true`` only.
    expect(resolveMockSidecar({ mock_sidecar: "yes" })).toBe(false);
    expect(resolveMockSidecar({ mock_sidecar: 1 })).toBe(false);
    expect(resolveMockSidecar({ demo: "true" })).toBe(false);
  });
});

describe("actions route source: mock-sidecar off by default (CC-BE-GOV-0109)", () => {
  it("no longer defaults mock_sidecar to true via ?? true", () => {
    // This is the exact Codex-flagged pattern; if it ever returns,
    // fail immediately.
    expect(actionsRouteSource).not.toMatch(
      /input\.mock_sidecar as boolean\)\s*\?\?\s*true/,
    );
  });

  it("resolves mock sidecar via explicit opt-in helper", () => {
    expect(actionsRouteSource).toMatch(
      /resolveMockSidecar\(input\)/,
    );
  });

  it("passes --mock-sidecar to the CLI only when mockSidecar is true", () => {
    // Structural check: the CLI flag is only appended inside an
    // ``if (mockSidecar) args.push(...)`` guard, not unconditionally.
    expect(actionsRouteSource).toMatch(
      /if\s*\(mockSidecar\)\s*args\.push\(\s*["']--mock-sidecar["']\s*\)/,
    );
  });

  it("records validation_mode in artifact metadata", () => {
    // Mock-backed artifacts must be discoverable by metadata scan.
    expect(actionsRouteSource).toMatch(
      /validation_mode:\s*mockSidecar\s*\?\s*["']mock_demo["']\s*:\s*["']real_sidecar["']/,
    );
  });

  it("prefixes artifact title with [MOCK/DEMO] when mock sidecar is used", () => {
    expect(actionsRouteSource).toMatch(/\[MOCK\/DEMO\]/);
    expect(actionsRouteSource).toMatch(
      /titlePrefix\s*=\s*mockSidecar\s*\?\s*["']\[MOCK\/DEMO\]/,
    );
  });

  it("appends a mock/demo validation caveat when mock sidecar is used", () => {
    expect(actionsRouteSource).toMatch(
      /Mock\/demo validation: battery sidecar ran with --mock-sidecar/,
    );
    expect(actionsRouteSource).toMatch(/not production-grade/i);
  });
});

// ── CC-BE-CLEAN-0005: useProject hook mock default ───────────────────
//
// The API route's resolveMockSidecar() is already fail-closed against
// silent mock runs, but the hook layer shipped ``mockSidecar ?? true``,
// which silently opted every UI-triggered battery evaluation into
// mock/demo validation before the route could apply its default. This
// test pins the hook-side contract so a future refactor cannot
// reintroduce the Codex-flagged pattern.

const USE_PROJECT_HOOK_PATH = join(
  __dirname, "..", "hooks", "useProject.ts",
);
const useProjectHookSource = readFileSync(USE_PROJECT_HOOK_PATH, "utf-8");

describe("useProject hook: mock_sidecar default is false (CC-BE-CLEAN-0005)", () => {
  it("runEvaluation no longer defaults mock_sidecar to true", () => {
    // The exact pre-batch pattern that silently forced mock runs.
    expect(useProjectHookSource).not.toMatch(
      /mock_sidecar:\s*mockSidecar\s*\?\?\s*true/,
    );
  });

  it("runEvaluation passes mockSidecar ?? false to the API route", () => {
    expect(useProjectHookSource).toMatch(
      /mock_sidecar:\s*mockSidecar\s*\?\?\s*false/,
    );
  });

  it("references CC-BE-CLEAN-0005 so future readers find the contract", () => {
    expect(useProjectHookSource).toMatch(/CC-BE-CLEAN-0005/);
  });
});
