// @ts-nocheck
"use client";

/**
 * PtlBriefDetail — screening-grade PtL candidate report.
 *
 * Bounded framing: verdicts are screening_* only. The investment_warning
 * banner is always rendered. IRIS grade is capped at 3 until an
 * integrated-peer fixture is registered (data-driven via
 * compute_iris_ceiling(family)).
 *
 * Sections:
 *   1. HEADER          — Headline, verdict, IRIS grade, family, product
 *   2. WARNING         — Investment warning banner (always visible)
 *   3. SCORE           — Composite score + component breakdown
 *   4. PHYSICS         — SOEC + FT snapshot
 *   5. LCOF            — Levelized cost of fuel + cost stack
 *   6. EXERGY          — First-law / exergetic efficiency + hotspots
 *   7. SENSITIVITY     — Tornado rows (top drivers first)
 *   8. WEAKNESSES      — Caveats, conditionals, hard-fails
 *   9. EVIDENCE        — Resolved research sources (Batch 24)
 *  10. ACTIONS         — Calibration gap + recommended next steps
 */

import type { PtlDecisionBrief } from "@/lib/ptl-brief-types";
import {
  PTL_FAMILY_HUMAN,
  PTL_PRODUCT_HUMAN,
  PTL_VERDICT_HUMAN,
  formatOptional,
  verdictBadgeVariant,
} from "@/lib/ptl-brief-types";
import { cn } from "@/lib/utils";
import { formatCompositeScore } from "@/lib/canonical-score";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Beaker,
  DollarSign,
  FileText,
  Flame,
  Gauge,
  Info,
  Lightbulb,
  Target,
  TrendingUp,
} from "lucide-react";

interface PtlBriefDetailProps {
  brief: PtlDecisionBrief;
  projectId?: string;
}

export function PtlBriefDetail({ brief }: PtlBriefDetailProps) {
  const familyLabel =
    (brief.candidate_family && PTL_FAMILY_HUMAN[brief.candidate_family]) ||
    brief.candidate_family ||
    "(family undeclared)";

  const productLabel =
    (brief.product_type && PTL_PRODUCT_HUMAN[brief.product_type]) ||
    brief.product_type ||
    "(product undeclared)";

  const verdictVariant = verdictBadgeVariant(brief.verdict);
  const humanVerdict =
    PTL_VERDICT_HUMAN[brief.verdict] || brief.headline || brief.verdict;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ── 1. HEADER ───────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{familyLabel} · {productLabel}</p>
            <h1 className="text-2xl font-bold leading-tight mt-1">
              {brief.title || `PtL Decision Brief — ${brief.candidate_family}`}
            </h1>
            <p className="text-base text-foreground/80 mt-2">{brief.headline}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Badge variant={verdictVariant}>{brief.verdict_qualifier}</Badge>
            <Badge variant="outline">
              IRIS {brief.iris_grade}/3
              <span className="ml-1 text-muted-foreground">
                (cap)
              </span>
            </Badge>
          </div>
        </div>
      </section>

      {/* ── 2. WARNING ───────────────────────────────────────── */}
      <div className="rounded-md border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/40 dark:bg-[var(--accent-amber)]/20 p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--accent-amber)] mt-0.5 flex-shrink-0" />
        <p className="text-sm">{brief.investment_warning}</p>
      </div>

      {/* ── 3. SCORE ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Composite Score
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <div className="text-4xl font-bold tabular-nums">
              {formatCompositeScore(brief.composite_score, "inline")}
            </div>
            <div className="text-muted-foreground">/100</div>
            <div className="ml-4 text-sm text-foreground/80">{humanVerdict}</div>
          </div>
          <div className="space-y-3">
            {brief.score_components.map((c) => (
              <div key={c.name} className="space-y-1">
                <div className="flex justify-between items-baseline text-sm">
                  <span className="font-medium">{c.name.replaceAll("_", " ")}</span>
                  <span className="tabular-nums">
                    {(c.raw_value * 100).toFixed(0)}% · w{c.weight.toFixed(2)}{" "}
                    → +{c.contribution.toFixed(1)}
                  </span>
                </div>
                <Progress value={c.raw_value * 100} className="h-1.5" />
                {c.rationale ? (
                  <p className="text-xs text-muted-foreground">{c.rationale}</p>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 4. PHYSICS ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4" />
            Physics snapshot
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <Stat label="SOEC T / P" value={`${formatOptional(brief.soec_temperature_c, "°C", 0)} · ${formatOptional(brief.soec_pressure_bar, "bar", 1)}`} />
          <Stat label="SOEC efficiency (HHV)" value={formatOptional(brief.soec_efficiency_hhv_pct, "%", 1)} />
          <Stat label="SOEC degraded efficiency" value={formatOptional(brief.soec_degraded_efficiency_pct, "%", 1)} />
          <Stat label="Syngas H2:CO ratio" value={formatOptional(brief.soec_outlet_h2_co_ratio, "", 2)} />
          <Stat label="CO2 slip" value={formatOptional(brief.soec_outlet_co2_slip_pct, "%", 1)} />
          <Stat label="Thermal uplift" value={`${brief.thermal_uplift_pct.toFixed(1)} pp`} />
          <Stat label="FT oil / gas / char" value={`${brief.ft_oil_pct.toFixed(1)}% / ${brief.ft_gas_pct.toFixed(1)}% / ${brief.ft_char_pct.toFixed(1)}%`} />
          <Stat label="Integrated C-efficiency" value={`${brief.integrated_carbon_efficiency_pct.toFixed(1)}%`} />
          <Stat label="Overall efficiency" value={`${(brief.overall_efficiency * 100).toFixed(1)}%`} />
          <Stat label="Electricity → liquid" value={brief.electricity_to_liquid_ratio.toFixed(3)} />
        </CardContent>
      </Card>

      {/* ── 5. LCOF ──────────────────────────────────────────── */}
      {brief.lcof_usd_per_liter !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Levelized Cost of Fuel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label="LCOF (after credits)"
                value={`$${brief.lcof_usd_per_liter?.toFixed(3)}/L`}
                emphasis
              />
              <Stat
                label="LCOF (before credits)"
                value={formatOptional(brief.lcof_before_credits_usd_per_liter, "$/L", 3)}
              />
              <Stat
                label="Incumbent price"
                value={formatOptional(brief.lcof_incumbent_price_usd_per_liter, "$/L", 3)}
              />
              <Stat
                label="Gap to incumbent"
                value={formatOptional(brief.lcof_gap_to_incumbent_usd_per_liter, "$/L", 3)}
              />
              <Stat
                label="Annual output"
                value={
                  brief.lcof_annual_output_liters !== null
                    ? `${(brief.lcof_annual_output_liters / 1000).toFixed(0)} kL`
                    : "—"
                }
              />
              <Stat
                label="In unsubsidized band?"
                value={brief.lcof_in_unsubsidized_ptl_band ? "Yes" : "No"}
              />
            </div>
            {brief.lcof_cost_stack.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="font-medium">Cost stack</p>
                  {brief.lcof_cost_stack.map((line) => (
                    <div
                      key={line.label}
                      className="flex justify-between items-baseline"
                    >
                      <span className="text-muted-foreground">{line.label}</span>
                      <span className="tabular-nums">
                        ${line.usd_per_liter.toFixed(3)}/L (
                        {(line.fraction_of_lcof * 100).toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 6. EXERGY ────────────────────────────────────────── */}
      {brief.exergetic_efficiency !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-4 w-4" />
              Exergy analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="First-law efficiency"
                value={formatOptional(
                  brief.first_law_efficiency !== null
                    ? brief.first_law_efficiency * 100
                    : null,
                  "%",
                  1,
                )}
              />
              <Stat
                label="Exergetic efficiency"
                value={formatOptional(
                  brief.exergetic_efficiency !== null
                    ? brief.exergetic_efficiency * 100
                    : null,
                  "%",
                  1,
                )}
              />
              <Stat
                label="Quality gap"
                value={formatOptional(
                  brief.quality_gap !== null ? brief.quality_gap * 100 : null,
                  "pp",
                  1,
                )}
              />
            </div>
            {brief.exergy_hotspots.length > 0 && (
              <div>
                <p className="font-medium mb-1">Hotspots</p>
                <div className="flex flex-wrap gap-2">
                  {brief.exergy_hotspots.map((h) => (
                    <Badge key={h} variant="warning">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {brief.exergy_stages.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Per-stage destruction</p>
                {brief.exergy_stages.map((s) => (
                  <div
                    key={s.stage}
                    className="flex justify-between text-muted-foreground"
                  >
                    <span>{s.stage}</span>
                    <span className="tabular-nums">
                      {(s.destruction_share_overall * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 7. SENSITIVITY ───────────────────────────────────── */}
      {brief.sensitivity_rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Sensitivity tornado
              {brief.sensitivity_top_driver ? (
                <Badge variant="outline" className="ml-2">
                  Top: {brief.sensitivity_top_driver}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {brief.sensitivity_rows.map((r) => (
              <div key={r.label} className="flex justify-between items-baseline">
                <span className="font-medium">{r.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  ±${(r.lcof_swing_usd_per_liter / 2).toFixed(3)} swing
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 8. WEAKNESSES ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Caveats & blockers ({brief.n_caveats} caveats, {brief.n_conditionals} conditionals, {brief.n_hard_fails} hard-fails)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {brief.hard_fails.length > 0 && (
            <div>
              <p className="font-medium text-[var(--accent-red)] dark:text-[var(--accent-red)]">Hard-fails</p>
              <ul className="list-disc list-inside text-muted-foreground">
                {brief.hard_fails.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.conditional_blockers.length > 0 && (
            <div>
              <p className="font-medium">Conditional blockers</p>
              <ul className="list-disc list-inside text-muted-foreground">
                {brief.conditional_blockers.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.caveats.length > 0 && (
            <div>
              <p className="font-medium">Caveats</p>
              <ul className="list-disc list-inside text-muted-foreground">
                {brief.caveats.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {brief.hard_fails.length === 0 &&
            brief.conditional_blockers.length === 0 &&
            brief.caveats.length === 0 && (
              <p className="text-muted-foreground">
                No active caveats or blockers.
              </p>
            )}
        </CardContent>
      </Card>

      {/* ── 9. EVIDENCE ──────────────────────────────────────── */}
      {brief.evidence_sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Evidence sources ({brief.evidence_sources.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {brief.evidence_sources.map((s) => (
              <div key={s.source_id} className="border-l-2 pl-3 border-muted">
                <p className="font-medium">
                  {s.title}
                  <span className="ml-2 text-muted-foreground font-normal">
                    {s.year ? `(${s.year})` : ""}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  {s.authors ? `${s.authors} · ` : ""}
                  {s.source_type} · {s.data_quality}
                </p>
                {s.key_findings.length > 0 && (
                  <ul className="list-disc list-inside text-muted-foreground mt-1">
                    {s.key_findings.slice(0, 3).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {brief.unresolved_source_refs.length > 0 && (
              <div className="pt-2 border-t text-xs text-muted-foreground">
                <span className="font-medium">Unresolved refs:</span>{" "}
                {brief.unresolved_source_refs.join(", ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 10. ACTIONS ──────────────────────────────────────── */}
      {(brief.recommended_next_actions.length > 0 || brief.calibration_gap_summary) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Recommended next actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {brief.recommended_next_actions.length > 0 && (
              <ul className="list-disc list-inside text-foreground/90">
                {brief.recommended_next_actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
            {brief.calibration_gap_summary && (
              <div className="text-muted-foreground text-xs border-l-2 pl-3 border-muted">
                <span className="font-medium">Calibration gap:</span>{" "}
                {brief.calibration_gap_summary}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-xs text-muted-foreground pt-2 border-t">
        Research report: {brief.research_report_cited} ·{" "}
        Schema: {brief.schema_version} · Brief {brief.id}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", emphasis ? "text-lg font-bold" : "font-medium")}>
        {value}
      </p>
    </div>
  );
}
