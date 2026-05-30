"use client";

/**
 * AxisCard — one of the 5 evaluation axes, rendered as a compact, uniform card.
 *
 * Each axis (technical_feasibility, commercial_viability, spec_compliance,
 * scale_readiness, thermodynamic_quality) has the same structure: a verdict
 * label, a basis (evidence chain), confidence + evidence tier, gaps, and a
 * delta vs benchmark.
 *
 * Displayed in the brief as a row of 5 cards so clients can read the
 * full assessment at a glance.
 */

import type { StructuredAxis } from "@/lib/brief-types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AxisKey =
  | "technical_feasibility"
  | "commercial_viability"
  | "spec_compliance"
  | "scale_readiness"
  | "thermodynamic_quality";

const AXIS_TITLES: Record<AxisKey, string> = {
  technical_feasibility: "Technical Feasibility",
  commercial_viability: "Commercial Viability",
  spec_compliance: "Spec Compliance",
  scale_readiness: "Scale Readiness",
  thermodynamic_quality: "Thermodynamic Quality",
};

// Map verdict strings to human-readable labels
const VERDICT_LABELS: Record<string, string> = {
  // Technical feasibility
  operationally_validated: "Operationally Validated",
  solver_confirmed: "Solver Confirmed",
  physics_consistent: "Physics Consistent",
  benchmark_aligned: "Benchmark Aligned",
  directionally_plausible: "Directionally Plausible",
  unverified: "Unverified",
  physics_violation: "Physics Violation",
  thermodynamically_infeasible: "Thermodynamically Infeasible",
  // Commercial viability
  cost_advantaged: "Cost Advantaged",
  cost_parity: "Cost Parity",
  policy_dependent: "Policy Dependent",
  tipping_fee_dependent: "Tipping-Fee Dependent",
  niche_competitive: "Niche Competitive",
  scale_frontier: "Scale Frontier",
  structurally_uncompetitive: "Structurally Uncompetitive",
  unknown_economics: "Unknown Economics",
  // Spec compliance
  certified: "Certified",
  meets_spec: "Meets Spec",
  upgradable_gap: "Upgradable Gap",
  marginal_gap: "Marginal Gap",
  structural_gap: "Structural Gap",
  unregulated: "Unregulated",
  blocks_market: "Blocks Market",
  // CC-BE-WTF-0002: regulatory-pathway clearance ≠ product spec certification.
  // The previous mapping used "certified" when only the regulatory verdict
  // was available, which let founder-facing PDFs claim spec certification on
  // technologies whose product still failed refinery limits (e.g. nitrogen
  // 7700 ppm vs 100 ppm steam-cracker spec). New verdict surfaces the limit.
  regulatory_pathway_cleared: "Regulatory Pathway Only",
  unknown: "Unknown",
  // Scale readiness
  commercial_multiple: "Commercial (Multiple Plants)",
  commercial_single: "Commercial (Single Plant)",
  demonstration: "Demonstration",
  pilot_integrated: "Pilot (Integrated)",
  pilot_subsystem: "Pilot (Subsystem)",
  bench_validated: "Bench Validated",
  analytical_proven: "Analytical Proven",
  concept_only: "Concept Only",
  // Thermodynamic quality
  exergy_optimized: "Exergy Optimized",
  exergy_competitive: "Exergy Competitive",
  exergy_conventional: "Exergy Conventional",
  exergy_subordinate: "Exergy Subordinate",
  exergy_violation: "Exergy Violation",
  exergy_unknown: "Exergy Unknown",
  exergy_identity_domain: "Identity Domain",
  // CC-BE-WTF-0002: η_II measured but no peer ceiling calibrated for the
  // family — must not be presented as "competitive". Surfaces the missing
  // anchor instead of inferring a verdict from absolute efficiency.
  exergy_uncalibrated: "Exergy Uncalibrated",
};

// Verdict-to-semantic-color mapping (positive / neutral / negative tiers)
const VERDICT_TONE: Record<string, "positive" | "neutral" | "caution" | "negative"> = {
  // Strong positive
  operationally_validated: "positive",
  solver_confirmed: "positive",
  cost_advantaged: "positive",
  certified: "positive",
  meets_spec: "positive",
  commercial_multiple: "positive",
  commercial_single: "positive",
  exergy_optimized: "positive",
  exergy_competitive: "positive",
  // Neutral / aligned
  physics_consistent: "neutral",
  benchmark_aligned: "neutral",
  cost_parity: "neutral",
  demonstration: "neutral",
  pilot_integrated: "neutral",
  exergy_conventional: "neutral",
  exergy_identity_domain: "neutral",
  // Caution
  directionally_plausible: "caution",
  policy_dependent: "caution",
  tipping_fee_dependent: "caution",
  niche_competitive: "caution",
  scale_frontier: "caution",
  upgradable_gap: "caution",
  marginal_gap: "caution",
  regulatory_pathway_cleared: "caution",
  pilot_subsystem: "caution",
  bench_validated: "caution",
  exergy_subordinate: "caution",
  // Negative / blocking
  physics_violation: "negative",
  thermodynamically_infeasible: "negative",
  structurally_uncompetitive: "negative",
  structural_gap: "negative",
  blocks_market: "negative",
  exergy_violation: "negative",
  // Unknown
  unverified: "neutral",
  unknown_economics: "neutral",
  unknown: "neutral",
  unregulated: "neutral",
  concept_only: "neutral",
  analytical_proven: "neutral",
  exergy_unknown: "neutral",
  exergy_uncalibrated: "neutral",
};

function toneBadgeVariant(tone: "positive" | "neutral" | "caution" | "negative") {
  switch (tone) {
    case "positive":
      return "success" as const;
    case "caution":
      return "warning" as const;
    case "negative":
      return "destructive" as const;
    default:
      return "default" as const;
  }
}

export function AxisCard({
  axisKey,
  axis,
}: {
  axisKey: AxisKey;
  axis?: StructuredAxis;
}) {
  if (!axis || !axis.verdict) return null;

  const title = AXIS_TITLES[axisKey];
  const verdictLabel = VERDICT_LABELS[axis.verdict] || axis.verdict.replace(/_/g, " ");
  const tone = VERDICT_TONE[axis.verdict] || "neutral";

  return (
    <Card className={cn("h-full", tone === "negative" && "border-destructive/30")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </p>
          {axis.evidence_tier && (
            <span className="text-[10px] font-mono text-muted-foreground/70">
              {axis.evidence_tier}
            </span>
          )}
        </div>

        <Badge variant={toneBadgeVariant(tone)} className="mb-2">
          {verdictLabel}
        </Badge>

        {axis.basis && (
          <p className="text-xs text-secondary-foreground leading-relaxed mb-2">
            {axis.basis}
          </p>
        )}

        {axis.delta_vs_benchmark && (
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
            <span className="font-medium">Delta vs benchmark:</span> {axis.delta_vs_benchmark}
          </p>
        )}

        {axis.gaps && axis.gaps.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1">
              Gaps
            </p>
            <ul className="space-y-0.5">
              {axis.gaps.slice(0, 3).map((g, i) => (
                <li key={i} className="text-[11px] text-muted-foreground leading-snug">
                  • {g}
                </li>
              ))}
            </ul>
          </div>
        )}

        {typeof axis.confidence === "number" && axis.confidence > 0 && (
          <p className="text-[10px] text-muted-foreground/60 mt-2">
            Confidence: {(axis.confidence * 100).toFixed(0)}%
          </p>
        )}
      </CardContent>
    </Card>
  );
}
