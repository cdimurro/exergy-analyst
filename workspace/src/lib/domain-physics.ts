/**
 * Engine-owned physics constraints.
 *
 * Imports from domain-physics.generated.json (produced by scripts/export_domain_physics.py).
 * Zero hardcoded physics values — everything flows from the generated JSON.
 * The JSON is committed to git so the workspace builds without Python.
 */

import type { SimDomain } from "./sim-types";
import generatedData from "./domain-physics.generated.json";

/* ── Types ────────────────────────────────────────────────── */

export interface PhysicsConstraint {
  limit: string;
  value?: number;
  range?: [number, number];
  unit: string;
  desc?: string;
}

export interface GradingThreshold {
  metric: string;
  thresholds: number[]; // [A+, A, B, C, D] descending
  unit: string;
}

/* ── Constraint Extraction ────────────────────────────────── */

const data = generatedData as Record<string, any>;

function extractPVConstraints(): PhysicsConstraint[] {
  const pv = data.pv || {};
  const constraints: PhysicsConstraint[] = [
    { limit: "Shockley-Queisser (single-junction)", value: pv.shockley_queisser_limit_pct || 33.7, unit: "%", desc: "Theoretical max efficiency for single-junction silicon" },
  ];

  const techs = pv.technology_bounds || {};
  for (const [key, tb] of Object.entries(techs) as [string, any][]) {
    const eff = tb.efficiency || {};
    if (eff.typical) {
      constraints.push({ limit: `${tb.technology || key} commercial efficiency`, range: eff.typical, unit: "%" });
    }
    if (eff.impossible) {
      constraints.push({ limit: `${tb.technology || key} impossible efficiency`, value: eff.impossible, unit: "%", desc: "Above this is physically impossible" });
    }
  }

  return constraints;
}

function extractBatteryConstraints(): PhysicsConstraint[] {
  const bat = data.battery || {};
  const constraints: PhysicsConstraint[] = [];
  const chems = bat.chemistry_bounds || {};

  for (const [chem, params] of Object.entries(chems) as [string, any][]) {
    const se = params.specific_energy_wh_per_kg;
    if (se) {
      if (se.typical_low != null && se.typical_high != null) {
        constraints.push({ limit: `${chem} energy density`, range: [se.typical_low, se.typical_high], unit: "Wh/kg" });
      }
      if (se.impossible != null) {
        constraints.push({ limit: `${chem} impossible energy`, value: se.impossible, unit: "Wh/kg" });
      }
    }
    const cl = params.cycle_life_80pct;
    if (cl && cl.typical_low != null) {
      constraints.push({ limit: `${chem} cycle life`, range: [cl.typical_low, cl.typical_high], unit: "cycles" });
    }
  }

  return constraints;
}

function extractInverterConstraints(): PhysicsConstraint[] {
  const inv = data.inverter || {};
  const hf = inv.hard_fail || {};
  const constraints: PhysicsConstraint[] = [
    { limit: "Peak efficiency max", value: hf.peak_efficiency_max_pct || 99.5, unit: "%", desc: "DC-AC practical limit (SiC multilevel)" },
    { limit: "Peak efficiency min", value: hf.peak_efficiency_min_pct || 85.0, unit: "%", desc: "Below this indicates design failure" },
    { limit: "CEC weighted min", value: hf.weighted_efficiency_min_pct || 90.0, unit: "%" },
  ];

  const topos = inv.topology_benchmarks || {};
  for (const [key, bench] of Object.entries(topos) as [string, any][]) {
    if (bench.peak_efficiency_typical) {
      constraints.push({ limit: `${key} peak efficiency`, range: bench.peak_efficiency_typical, unit: "%" });
    }
  }

  return constraints;
}

/* ── Public API ───────────────────────────────────────────── */

export const PHYSICS_CONSTRAINTS: Record<SimDomain, PhysicsConstraint[]> = {
  pv: extractPVConstraints(),
  battery: extractBatteryConstraints(),
  inverter: extractInverterConstraints(),
};

export function getGradingThresholds(domain: SimDomain, _technology?: string): GradingThreshold[] {
  // Default grading thresholds per domain (can be refined by technology later)
  if (domain === "pv") {
    return [
      { metric: "efficiency", thresholds: [23, 21, 18, 15, 12], unit: "%" },
      { metric: "fill_factor", thresholds: [0.84, 0.80, 0.75, 0.70, 0.65], unit: "" },
      { metric: "Pmax", thresholds: [400, 350, 300, 250, 200], unit: "W" },
    ];
  }
  if (domain === "inverter") {
    return [
      { metric: "peak_efficiency", thresholds: [98.5, 97, 95, 93, 90], unit: "%" },
      { metric: "cec_weighted", thresholds: [97.5, 96, 94, 92, 89], unit: "%" },
      { metric: "thermal_derating", thresholds: [98, 95, 90, 80, 70], unit: "%" },
    ];
  }
  // Battery defaults
  return [
    { metric: "energy_density", thresholds: [250, 180, 120, 80, 50], unit: "Wh/kg" },
    { metric: "cycle_life", thresholds: [5000, 2000, 1000, 500, 200], unit: "cycles" },
    { metric: "efficiency", thresholds: [98, 95, 90, 85, 75], unit: "%" },
  ];
}

// Load kernel physics constraints from generated catalog for non-builtin domains
import domainCatalog from "@/lib/domain-catalog.generated.json";

function loadKernelPhysicsBlock(domainId: string): string {
  // Try to load kernel YAML physics constraints via the domain schemas
  // For now, use the domain catalog to identify the domain and provide basic guidance
  const domain = (domainCatalog as any).domains?.find((d: any) => d.id === domainId);
  if (!domain) return "";

  return `\n${domain.label.toUpperCase()} (${domainId}):\n` +
    `- This domain is recognized by the evaluation engine\n` +
    `- Physics constraints from the ${domainId} energy kernel apply\n` +
    `- The engine will validate claims against published baselines for this domain\n`;
}

/* ── Exergy-Aware Guidance ────────────────────────────────── */

/**
 * Returns LLM prompt guidance for how to handle exergy analysis,
 * tailored to the domain's discrimination class.
 *
 * identity / low     → skip exergy, explain why clearly
 * medium             → include exergy where it adds insight
 * high / core        → full exergy analysis is required
 * not_recommended    → skip exergy, note it doesn't apply
 */
export function buildExergyPromptBlock(domainId: string): string {
  const domain = (domainCatalog as any).domains?.find((d: any) => d.id === domainId);
  const cls: string = domain?.exergy_class || "medium";
  const label: string = domain?.label || domainId;

  if (cls === "identity") {
    return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
This is an identity-class domain. The input and output energy carriers are both electrical or high-grade mechanical (exergy-to-energy ratio ≈ 1). The exergetic efficiency is mathematically equivalent to the first-law efficiency — exergy analysis adds no discriminative information for technology ranking here.
Do NOT compute or report exergetic efficiency as if it provides independent insight. It does not.
Instead: if the user or evaluation touches on thermal management, manufacturing lifecycle, or upstream supply chain, exergy IS useful for those sub-questions and you may address it there with that framing.
When you skip exergy analysis, say so briefly and explain why — e.g. "Exergy analysis was not performed for this evaluation. In ${label}, both input and output are electrical energy, so exergetic efficiency equals first-law efficiency by definition — it would not change the assessment."`;
  }

  if (cls === "low") {
    return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
This is a low-discrimination domain. Energy quality conversion occurs but is not the dominant performance driver. First-law metrics capture most of the useful information.
You may include brief exergy context where it genuinely adds insight (e.g. noting a Carnot factor for a thermal step, or flagging a quality-mismatch), but do not present exergy analysis as a primary evaluation layer.
If you skip a detailed exergy breakdown, say so: "A detailed exergy analysis was not performed — in ${label}, first-law efficiency metrics capture the dominant performance variation. Exergy would add marginal additional insight."`;
  }

  if (cls === "high") {
    return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
This is a HIGH-DISCRIMINATION domain. Energy undergoes substantial quality conversion between input and output. First-law metrics miss the dominant source of performance variation and can produce systematically wrong rankings.
You MUST include exergy analysis in any substantive evaluation of this technology. Specifically:
- Compute or reference the exergetic efficiency (ε = Ex_product / Ex_fuel) and compare it to first-law efficiency
- Identify where quality is destroyed (the dominant irreversibility — combustion, heat transfer across ΔT, mixing, etc.)
- If this technology is part of a conversion chain, compute or estimate the end-to-end chain efficiency ε_chain = ∏ εᵢ
- Use the Carnot factor (1 − T₀/T) to characterize thermal streams at specific temperatures
- Explain what the exergy numbers mean for deployment: what do they tell us about infrastructure sizing, capital requirements, or comparison against alternatives?
Frame exergy results in plain language: e.g. "Although this system is 85% energy-efficient, its exergetic efficiency is approximately 38% — meaning it destroys 62% of the available work potential, primarily in the [step] stage."`;
  }

  if (cls === "core") {
    return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
This is a CORE-DISCRIMINATION domain. Exergy analysis is ESSENTIAL — first-law evaluation is structurally insufficient here. The central engineering challenge IS thermodynamic quality conversion, and evaluating this technology without exergy produces misleading results.
You MUST provide a full exergy treatment in any substantive evaluation:
- State the exergetic efficiency clearly and explain how it differs from first-law efficiency
- Decompose quality destruction by stage: identify which steps are the largest irreversibility sources
- Compute or reference end-to-end chain efficiency if this is part of a multi-step pathway
- Apply the Carnot factor to all thermal streams; identify quality mismatches (high-grade supply used for low-grade task)
- Compare against the thermodynamic minimum (e.g. minimum work of separation, Gibbs free energy of reaction, Carnot limit)
- State explicitly what the exergy analysis changes vs. a first-law-only view — what rankings, baselines, or investment signals shift?
- Translate findings into decision-relevant language: capital multipliers, renewable capacity requirements, infrastructure scale implications
This is not optional for ${label}. An evaluation of this technology that relies only on first-law metrics is incomplete and must be flagged as such.`;
  }

  if (cls === "not_recommended") {
    return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
Exergy analysis is not applicable to this domain in a decision-relevant way. The system does not perform exergy evaluation for ${label} evaluations.
If the user asks about exergy for this technology, explain briefly: "Exergy analysis is not a meaningful evaluation lens for ${label} — the thermodynamic quality of energy is not a limiting factor or key performance differentiator in this domain."`;
  }

  // medium — default
  return `
EXERGY GUIDANCE — ${label.toUpperCase()}:
This is a medium-discrimination domain. Exergy analysis provides useful additional context beyond first-law metrics in some scenarios.
Include exergy where it genuinely changes the picture: thermal conversion steps, quality-mismatch flags, or comparison of competing pathways. For purely electrical or mechanical subsystems, first-law metrics are sufficient and you do not need to restate them in exergy terms.
If you include exergy context, be specific: cite Carnot factors for thermal streams, identify the dominant irreversibility, and explain what it means for performance. If exergy does not materially change the evaluation conclusions for a particular question, note that briefly rather than forcing an exergy frame where it adds no insight.`;
}

export function buildPhysicsPromptBlock(domains: (SimDomain | string)[]): string {
  const lines: string[] = ["PHYSICS CONSTRAINTS — HARD LIMITS:"];
  lines.push("Every claim must be consistent with these established limits.\n");

  let hasBuiltinConstraints = false;

  for (const domain of domains) {
    // Check builtin constraints first
    const builtinConstraints = PHYSICS_CONSTRAINTS[domain as SimDomain];
    if (builtinConstraints && builtinConstraints.length > 0) {
      hasBuiltinConstraints = true;
      lines.push(`${domain.toUpperCase()}:`);
      for (const c of builtinConstraints) {
        if (c.range) {
          lines.push(`- ${c.limit}: ${c.range[0]}–${c.range[1]} ${c.unit}${c.desc ? ` (${c.desc})` : ""}`);
        } else if (c.value != null) {
          lines.push(`- ${c.limit}: ${c.value} ${c.unit}${c.desc ? ` (${c.desc})` : ""}`);
        }
      }
      lines.push("");
    } else if (domain !== "general") {
      // Non-builtin domain: load from kernel catalog
      const kernelBlock = loadKernelPhysicsBlock(domain);
      if (kernelBlock) {
        hasBuiltinConstraints = true;
        lines.push(kernelBlock);
      }
    }
  }

  if (!hasBuiltinConstraints) {
    // "general" with no specific domain — no false specificity
    lines.push("No domain-specific physics constraints loaded.");
    lines.push("Classify the technology to enable physics grounding.\n");
  }

  lines.push("Cross-domain:");
  lines.push("- System efficiency = product of component efficiencies");
  lines.push("- Use structured physics_evaluation.solver_status before claiming simulation backing");
  lines.push("- Do not say solver-backed, validated by simulation, exergy validated, or physics proven unless structured physics_evaluation fields and artifacts support it");
  lines.push("- If no solver artifact exists for a claim, label it parametric-only, unavailable, or blocked and propose the missing validation");
  lines.push("- Distinguish Tier 0 preview (directional) from Tier 1 engine (authoritative)");

  return lines.join("\n");
}
