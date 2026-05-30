/**
 * Resolves how a datasheet upload dispatches to the Python extractor.
 *
 * The workspace passes a single `productType` (from the agent or hook) plus
 * the project's stored `domain`. The Python CLI accepts:
 *   - `--type pv|bess|inverter`         (mature schemas)
 *   - `--type generic --kernel-id <id>` (any of the other 100 kernels)
 *
 * Resolution rules (CC-BE-SCHEMA-0010):
 *   1. Mature productType (pv/bess/inverter) → `--type productType`.
 *   2. Otherwise, prefer productType if it looks like a kernel id;
 *      else fall back to projectDomain if it does.
 *   3. If neither yields a kernel id and no mature type → no `--type`,
 *      let the Python triage decide (today: only succeeds for mature
 *      schemas).
 */

const MATURE_PRODUCT_TYPES = new Set(["pv", "bess", "inverter"]);

// Python kernel-id regex: ^[a-z][a-z0-9_]*$ (extractor.py:433).
// Hyphens normalize to underscores so the workspace catalog's
// hyphenated forms (if any) survive.
const KERNEL_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

const PLACEHOLDER_DOMAINS = new Set(["", "general", "generic", "unknown"]);

export interface DatasheetDispatch {
  /** What to put after `--type` on the Python CLI. */
  dispatchType: "pv" | "bess" | "inverter" | "generic" | null;
  /** What to put after `--kernel-id` (only set when dispatchType === "generic"). */
  kernelId: string | null;
  /** Resolved args to append to `["-m", "breakthrough_engine", "datasheet", "extract", path]`. */
  extraArgs: string[];
  /**
   * Where the kernel id came from when dispatchType === "generic":
   *   "product_type" | "project_domain" | null
   * Useful for telemetry and unit-test assertions.
   */
  kernelSource: "product_type" | "project_domain" | null;
}

function normalizeKernelId(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase().replace(/-/g, "_");
  if (PLACEHOLDER_DOMAINS.has(trimmed)) return null;
  if (!KERNEL_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function resolveDatasheetDispatch(
  productType: string | null | undefined,
  projectDomain: string | null | undefined,
): DatasheetDispatch {
  const ptRaw = (productType ?? "").trim().toLowerCase();

  if (MATURE_PRODUCT_TYPES.has(ptRaw)) {
    return {
      dispatchType: ptRaw as "pv" | "bess" | "inverter",
      kernelId: null,
      extraArgs: ["--type", ptRaw],
      kernelSource: null,
    };
  }

  const fromProductType = normalizeKernelId(productType);
  if (fromProductType) {
    return {
      dispatchType: "generic",
      kernelId: fromProductType,
      extraArgs: ["--type", "generic", "--kernel-id", fromProductType],
      kernelSource: "product_type",
    };
  }

  const fromProjectDomain = normalizeKernelId(projectDomain);
  if (fromProjectDomain) {
    return {
      dispatchType: "generic",
      kernelId: fromProjectDomain,
      extraArgs: ["--type", "generic", "--kernel-id", fromProjectDomain],
      kernelSource: "project_domain",
    };
  }

  return {
    dispatchType: null,
    kernelId: null,
    extraArgs: [],
    kernelSource: null,
  };
}
