/**
 * Tests for resolveDatasheetDispatch (CC-BE-SCHEMA-0010).
 *
 * Verifies the workspace correctly routes a document upload to either:
 *   - the mature `--type pv|bess|inverter` path, or
 *   - the kernel-aware `--type generic --kernel-id <id>` path.
 *
 * Failing this suite means a heat-pump / electrolyzer / DAC project
 * upload silently falls back to the LLM triage and never reaches the
 * generic evaluator.
 */
import { resolveDatasheetDispatch } from "../lib/datasheet-dispatch";

describe("resolveDatasheetDispatch — mature schemas", () => {
  test.each(["pv", "bess", "inverter"])(
    "%s productType routes to --type only",
    (pt) => {
      const r = resolveDatasheetDispatch(pt, "anything");
      expect(r.dispatchType).toBe(pt);
      expect(r.kernelId).toBeNull();
      expect(r.kernelSource).toBeNull();
      expect(r.extraArgs).toEqual(["--type", pt]);
    },
  );

  test("mature productType wins over project.domain", () => {
    const r = resolveDatasheetDispatch("pv", "heat_pump_systems");
    expect(r.dispatchType).toBe("pv");
    expect(r.extraArgs).toEqual(["--type", "pv"]);
  });

  test("uppercase mature productType normalizes", () => {
    const r = resolveDatasheetDispatch("PV", null);
    expect(r.dispatchType).toBe("pv");
    expect(r.extraArgs).toEqual(["--type", "pv"]);
  });
});

describe("resolveDatasheetDispatch — kernel-id from productType", () => {
  test("kernel id in productType routes through generic dispatch", () => {
    const r = resolveDatasheetDispatch("heat_pump_systems", null);
    expect(r.dispatchType).toBe("generic");
    expect(r.kernelId).toBe("heat_pump_systems");
    expect(r.kernelSource).toBe("product_type");
    expect(r.extraArgs).toEqual(["--type", "generic", "--kernel-id", "heat_pump_systems"]);
  });

  test("hyphenated kernel id normalizes to underscores", () => {
    const r = resolveDatasheetDispatch("heat-pump-hvac", null);
    expect(r.kernelId).toBe("heat_pump_hvac");
    expect(r.extraArgs).toEqual(["--type", "generic", "--kernel-id", "heat_pump_hvac"]);
  });

  test("productType wins over project.domain when both are kernel ids", () => {
    const r = resolveDatasheetDispatch("electrolysis_conversion", "heat_pump_systems");
    expect(r.kernelId).toBe("electrolysis_conversion");
    expect(r.kernelSource).toBe("product_type");
  });
});

describe("resolveDatasheetDispatch — fallback to project.domain", () => {
  test.each([
    ["", "heat_pump_systems"],
    [null, "heat_pump_systems"],
    [undefined, "heat_pump_systems"],
    ["general", "heat_pump_systems"],
    ["generic", "heat_pump_systems"],
    ["unknown", "heat_pump_systems"],
  ])(
    "productType=%p with project.domain=%p falls back to project.domain",
    (pt, domain) => {
      const r = resolveDatasheetDispatch(pt as string | null | undefined, domain);
      expect(r.dispatchType).toBe("generic");
      expect(r.kernelId).toBe("heat_pump_systems");
      expect(r.kernelSource).toBe("project_domain");
      expect(r.extraArgs).toEqual(["--type", "generic", "--kernel-id", "heat_pump_systems"]);
    },
  );

  test("hyphenated project.domain normalizes", () => {
    const r = resolveDatasheetDispatch("", "carbon-capture");
    expect(r.kernelId).toBe("carbon_capture");
  });
});

describe("resolveDatasheetDispatch — no resolvable kernel", () => {
  test.each([
    ["", ""],
    [null, null],
    ["general", "general"],
    ["", "unknown"],
    [undefined, undefined],
  ])("productType=%p, domain=%p produces no extraArgs", (pt, domain) => {
    const r = resolveDatasheetDispatch(
      pt as string | null | undefined,
      domain as string | null | undefined,
    );
    expect(r.dispatchType).toBeNull();
    expect(r.kernelId).toBeNull();
    expect(r.kernelSource).toBeNull();
    expect(r.extraArgs).toEqual([]);
  });

  test("invalid kernel id format is rejected (does not reach Python)", () => {
    // Python kernel regex is ^[a-z][a-z0-9_]*$ — leading digit, spaces,
    // path-traversal segments, etc. all fail.
    const r1 = resolveDatasheetDispatch("3M_filter", null);
    expect(r1.kernelId).toBeNull();

    const r2 = resolveDatasheetDispatch("../etc/passwd", null);
    expect(r2.kernelId).toBeNull();

    const r3 = resolveDatasheetDispatch("has spaces", null);
    expect(r3.kernelId).toBeNull();
  });

  test("mature productType still wins even if project.domain is junk", () => {
    const r = resolveDatasheetDispatch("inverter", "../etc/passwd");
    expect(r.dispatchType).toBe("inverter");
    expect(r.extraArgs).toEqual(["--type", "inverter"]);
  });
});
