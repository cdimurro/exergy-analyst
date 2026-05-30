// @ts-nocheck
"use client";

/**
 * BriefDetail — Premium deployment readiness report.
 *
 * Redesigned with shadcn/ui component system. Clean information hierarchy:
 *   1. HERO        — Identity, verdict, confidence gauge, PDF
 *   2. KEY FINDINGS — Bottleneck, market, strongest/weakest signals
 *   3. PATH FORWARD — Actionable next steps
 *   4. EVIDENCE     — Strengths, concerns, module findings
 *   5. DETAIL       — Economics, regulatory, manufacturing, TRL
 *   6. TECHNICAL    — Score dashboard, radar, baseline comparisons
 *   7. META         — Caveats, methodology, footer
 */

import { useState } from "react";
import type { DeviceDecisionBrief, RecommendationEntry } from "@/lib/brief-types";
import { MODULE_SHORT_NAMES } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";
import { formatCompositeScore } from "@/lib/canonical-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { ScoreGauge } from "./ScoreGauge";
import { ModuleRadar } from "./ModuleRadar";
import { ComparisonBarList } from "./ComparisonBar";
import { TRLGauge } from "./TRLGauge";
import { AxisCard } from "./AxisCard";
import { DualLCOEDisplay } from "./DualLCOEDisplay";
import { ThermodynamicQualitySection } from "./ThermodynamicQualitySection";
import { explainBrief, explainDollarPerExergy } from "@/lib/taxonomy-translations";
import {
  Download,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldCheck,
  AlertTriangle,
  Info,
  ChevronRight,
  Lightbulb,
  DollarSign,
  Scale,
  Factory,
  Gauge,
  Monitor,
  Trophy,
  CircleDot,
  ArrowRight,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";

interface BriefDetailProps {
  brief: DeviceDecisionBrief;
  projectId?: string;
  evidenceDigest?: Record<string, unknown> | null;
}

const TIER_DESC: Record<string, string> = {
  deploy:       "This technology meets deployment criteria across all assessed dimensions.",
  strong:       "Core fundamentals are sound. Minor gaps remain but do not block progress.",
  promising:    "Physics and economics appear viable. Several dimensions need deeper data before full confidence.",
  early:        "Some fundamentals check out, but significant questions remain. Treat as directional, not conclusive.",
  insufficient: "Findings are available but evidence is not sufficient for high-confidence conclusions.",
  conditional:  "Clear strengths alongside areas that warrant closer examination.",
  caution:      "Material risks identified across critical dimensions. Investigate before decisions.",
  not_ready:    "Fundamental issues prevent a positive assessment at this stage.",
};

const TIER_BADGE_VARIANT: Record<string, "success" | "warning" | "destructive" | "default" | "info"> = {
  deploy: "success",
  strong: "success",
  promising: "info",
  early: "default",
  insufficient: "default",
  conditional: "warning",
  caution: "warning",
  not_ready: "destructive",
};

const TRIGGER_LABELS: Record<string, string> = {
  durability_gap: "Durability concern",
  supply_risk: "Supply chain risk",
  cost_barrier: "Economics barrier",
  quality_mismatch: "Thermodynamic quality mismatch",
  efficiency_ceiling: "Approaching efficiency ceiling",
  regulatory_risk: "Regulatory risk",
  environmental_concern: "Environmental concern",
};

const INTERNAL_MODEL_RE = /gemma|deepseek|intern|s1\.pro|oracle/gi;

function sanitizeDigestText(text: string): string {
  return text.replace(INTERNAL_MODEL_RE, "analysis engine");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function digestStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => sanitizeDigestText(v.trim().slice(0, 160)))
    .slice(0, limit);
}

function digestCaveats(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function digestConfidenceLine(summary: unknown): string | null {
  return null;
}

function strongestDigestCaveat(caveats: Record<string, unknown>[]): Record<string, unknown> | null {
  for (const severity of ["blocker", "warning", "info"]) {
    const item = caveats.find((c) =>
      c.severity === severity &&
      typeof c.message === "string" &&
      typeof c.suggested_action === "string" &&
      c.suggested_action.trim().length > 0
    );
    if (item) return item;
  }
  return null;
}

function SourceEvidenceDigest({ digest }: { digest?: Record<string, unknown> | null }) {
  if (!isRecord(digest)) return null;
  const status = digest.digest_status;
  if (status !== "facts_extracted" && status !== "partial_extraction") return null;
  const facts = digestStrings(digest.headline_facts, 5);
  const conf = digestConfidenceLine(digest.confidence_tier_summary);
  const caveat = strongestDigestCaveat(digestCaveats(digest.actionable_caveats));
  if (facts.length === 0 && !conf && !caveat) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="size-4 text-primary" />
          Source Evidence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {facts.length > 0 && (
          <ul className="space-y-2">
            {facts.map((fact, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-secondary-foreground">
                <span className="shrink-0 mt-1 text-primary">-</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        )}
        {conf && <p className="text-sm text-muted-foreground">{conf}</p>}
        {caveat && (
          <div className="rounded-md border border-border/60 px-3 py-2 text-sm text-secondary-foreground">
            <p>{sanitizeDigestText(String(caveat.message))}</p>
            <p className="text-muted-foreground mt-1">Next: {sanitizeDigestText(String(caveat.suggested_action))}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ──────────────────────────────────────────

export function BriefDetail({ brief, projectId, evidenceDigest }: BriefDetailProps) {
  const tierDesc = brief.headline || TIER_DESC[brief.readiness_tier] || TIER_DESC.conditional;
  const evidenceLevel = brief.evidence_level || "unknown";
  const guidance = brief.module_unlock_guidance || {};
  const recommendations = (brief.recommendations || []) as RecommendationEntry[];
  const [pdfLoading, setPdfLoading] = useState(false);
  const fi = brief.founder_insights || {};
  // CC-BE-UX-0033: guard against blank-state panels. An upstream quirk lets
  // `founder_insights` exist as an object whose displayed fields are all empty
  // strings, which previously rendered a grid of zero `FindingCard`s (i.e. an
  // empty panel). Require at least one displayed value to be non-empty.
  const hasFindingCards = Boolean(
    fi.top_commercial_bottleneck || fi.sellable_market ||
    fi.strongest_claim || fi.weakest_claim
  );
  const rs = brief.resolved_subject;
  const reconciliation = brief.truth_reconciliation;
  const renderGate = reconciliation?.render_gate || "pass";

  const handleDownloadPdf = async () => {
    if (!projectId) return;
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/report`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate report");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(brief.commercial_name || "Technology").replace(/[^a-z0-9]/gi, "_")}_Assessment_Report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ } finally { setPdfLoading(false); }
  };

  // CC-BE-0113b: composite_score is now on 0-100 scale at the schema
  // boundary, so no ``* 100`` multiplication; the gauge renderer gets
  // the integer directly from the canonical formatter.
  const compositeScore = Number(formatCompositeScore(brief.composite_score ?? 0, "gauge"));
  const trlMatch = brief.trl_assessment?.match(/TRL\s*(\d)/i);
  const trlLevel = trlMatch ? parseInt(trlMatch[1], 10) : 0;

  const modulesWithFindings = (brief.module_summary || []).filter(
    (m) => m.verdict === "pass" || m.verdict === "fail" ||
      (m.verdict === "conditional" && m.key_detail && !m.key_detail.includes("No evidence")),
  );
  const modulesNeedingData = (brief.module_summary || []).filter(
    (m) => m.verdict === "blocked" ||
      (m.verdict === "conditional" && (!m.key_detail || m.key_detail.includes("No evidence"))),
  );

  const actionItems: Array<{ text: string; type: "action" | "data"; detail?: string }> = [];
  for (const a of (brief.next_actions || []).slice(0, 4)) {
    actionItems.push({ text: a, type: "action" });
  }
  for (const g of (brief.ranked_gap_guidance || []).slice(0, 3)) {
    const param = g.parameter?.replace(/_/g, " ");
    actionItems.push({
      text: `Provide ${param}${g.typical_range ? ` (typical: ${g.typical_range})` : ""}`,
      type: "data",
      detail: g.why_it_matters,
    });
  }

  const hasDetailSections = brief.economics_summary || brief.regulatory_summary ||
    brief.manufacturing_summary || trlLevel > 0 || brief.system_description || brief.competitive_context;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ═══════════ RENDER GATE WARNINGS ═══════════ */}
      {renderGate === "block" && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <XCircle className="size-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">Unresolved contradictions</p>
            <p className="text-xs text-destructive/80 mt-0.5">{reconciliation?.render_gate_reason}</p>
          </div>
        </div>
      )}
      {renderGate === "warn" && (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/5 px-4 py-3">
          <AlertTriangle className="size-4 text-[var(--accent-amber)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--accent-amber)]">Preliminary assessment</p>
            <p className="text-xs text-[var(--accent-amber)]/80 mt-0.5">{reconciliation?.render_gate_reason}</p>
          </div>
        </div>
      )}

      {/* ═══════════ 1. HERO ═══════════ */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-xl font-bold text-foreground leading-tight truncate">
              {brief.commercial_name || brief.device_id}
            </h2>
            <Badge variant={TIER_BADGE_VARIANT[brief.readiness_tier] || "default"}>
              {brief.readiness_tier?.replace(/_/g, " ") || "Under Review"}
            </Badge>
          </div>
          {fi.technology_identity ? (
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              {fi.technology_identity}
            </p>
          ) : rs?.company ? (
            <p className="text-sm text-muted-foreground">
              {rs.technology}{rs.feedstock ? ` · ${rs.feedstock.replace(/_/g, " ")}` : ""}
            </p>
          ) : brief.technology_family ? (
            <p className="text-sm text-muted-foreground">
              {brief.domain?.replace(/_/g, " ")} · {brief.technology_family}
            </p>
          ) : null}
          <p className="text-sm text-secondary-foreground mt-3 leading-relaxed max-w-2xl">
            {tierDesc}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-center gap-3">
          <ScoreGauge score={compositeScore} size={80} strokeWidth={6} />
          {projectId && (
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} loading={pdfLoading} className="gap-1.5">
              <Download className="size-3.5" />
              PDF
            </Button>
          )}
        </div>
      </div>

      {/* ═══════════ 1.5 CALIBRATION GROUNDING ═══════════
        * CC-BE-SCHEMA-0007: surface the calibration-tier explanation
        * in plain language, never the raw "C0-schema" / "C1-provisional"
        * tokens. The translator computes a domain-specific headline
        * and explanation from the brief metadata.
        */}
      {(() => {
        const explanation = explainBrief({
          calibration_tier: brief.calibration_tier,
          avg_module_confidence: brief.avg_module_confidence,
          hard_fail: brief.hard_fail,
          hard_fail_reasons: brief.hard_fail_reasons,
          domain: brief.domain,
          technology_family: brief.technology_family,
          peer_matching: (brief as any).peer_matching,
        });
        const intentBadge: Record<string, "success" | "warning" | "destructive" | "default" | "info"> = {
          very_high: "success",
          high: "success",
          moderate: "info",
          low: "warning",
        };
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="size-4 text-primary" />
                  How confident is this assessment?
                </CardTitle>
                <Badge variant={intentBadge[explanation.calibration.intent] || "default"}>
                  {explanation.calibration.badgeLabel}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed">
              <p className="font-medium text-foreground">
                {explanation.calibration.headline}
              </p>
              <p className="text-muted-foreground">
                {explanation.calibration.explanation}
              </p>
              {explanation.peerMatch && (
                <div className="pt-2 border-t border-border/40">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Peer comparison
                  </p>
                  <p className="text-foreground font-medium">
                    {explanation.peerMatch.headline}
                  </p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {explanation.peerMatch.explanation}
                  </p>
                </div>
              )}
              {explanation.calibration.upgradePath && (
                <div className="pt-2 border-t border-border/40 flex items-start gap-2">
                  <ArrowRight className="size-4 mt-0.5 shrink-0 text-primary" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                      How to strengthen this assessment
                    </p>
                    <p className="text-foreground">
                      {explanation.calibration.upgradePath}
                    </p>
                  </div>
                </div>
              )}
              {explanation.hardFail && (
                <div className="pt-2 border-t border-border/40 flex items-start gap-2">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0 text-destructive" />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide mb-0.5 text-destructive">
                      Blocker
                    </p>
                    <p className="text-foreground font-medium">
                      {explanation.hardFail.headline}
                    </p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {explanation.hardFail.explanation}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ═══════════ 2. KEY FINDINGS ═══════════ */}
      {hasFindingCards && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fi.top_commercial_bottleneck && (
            <FindingCard icon={Target} label="Top Bottleneck" text={fi.top_commercial_bottleneck} />
          )}
          {fi.sellable_market && (
            <FindingCard icon={DollarSign} label="Market Position" text={fi.sellable_market} />
          )}
          {fi.strongest_claim && (
            <FindingCard icon={TrendingUp} label="Strongest Signal" text={fi.strongest_claim} accent="positive" />
          )}
          {fi.weakest_claim && (
            <FindingCard icon={TrendingDown} label="Weakest Signal" text={fi.weakest_claim} accent="concern" />
          )}
        </div>
      )}

      {/* ═══════════ 2.5 MULTI-AXIS ASSESSMENT ═══════════ */}
      {(brief.combined_verdict || brief.technical_feasibility) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CircleDot className="size-4 text-primary" />
                Multi-Axis Assessment
              </CardTitle>
              {brief.combined_verdict_label && (
                <Badge variant="info">{brief.combined_verdict_label}</Badge>
              )}
            </div>
            {brief.verdict_modifiers && brief.verdict_modifiers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {brief.verdict_modifiers.map((m: string) => (
                  <Badge key={m} variant="warning" className="text-[10px]">
                    {m.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <AxisCard axisKey="technical_feasibility" axis={brief.technical_feasibility} />
              <AxisCard axisKey="commercial_viability" axis={brief.commercial_viability} />
              <AxisCard axisKey="spec_compliance" axis={brief.spec_compliance_axis} />
              <AxisCard axisKey="scale_readiness" axis={brief.scale_readiness_axis} />
              <AxisCard axisKey="thermodynamic_quality" axis={brief.thermodynamic_quality} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ 2.6 DUAL LCOF ═══════════ */}
      {brief.lcof_nominal_per_gge != null && (
        <DualLCOEDisplay
          nominal={brief.lcof_nominal_per_gge}
          exergyAdjusted={brief.lcof_exergy_adjusted_per_gge}
          qualityFactor={brief.quality_factor_applied}
          divergencePct={brief.lcof_divergence_pct}
          note={brief.lcof_exergy_adjustment_note}
          unit="GGE"
          metricLabel="LCOF"
        />
      )}

      {/* ═══════════ 2.7 THERMODYNAMIC QUALITY ═══════════ */}
      {(brief.thermodynamic_quality || brief.exergy_summary_plain) && (
        <ThermodynamicQualitySection
          axis={brief.thermodynamic_quality}
          summaryPlain={brief.exergy_summary_plain}
          secondLawEfficiency={brief.second_law_efficiency}
          exergyCeiling={brief.exergy_ceiling}
          exergyHeadroom={brief.exergy_headroom}
          destructionMap={brief.exergy_destruction_map}
          carrierType={brief.exergy_carrier_type}
          qualityFactor={brief.exergy_quality_factor}
        />
      )}

      {/* ═══════════ 2.8 $/kWh EXERGY — cross-domain cost scalar ═══════════ */}
      {/* CC-BE-EXRG-SURFACE-0044. Renders only when the backend emitted
          a populated scalar (produced=true); hides cleanly when absent
          so briefs without an ExergyProfile keep their current layout. */}
      {brief.economics_dollar_per_exergy_kwh != null &&
        brief.economics_dollar_per_exergy_kwh_provenance?.produced && (() => {
          const prov = brief.economics_dollar_per_exergy_kwh_provenance;
          const ex = explainDollarPerExergy(
            brief.economics_dollar_per_exergy_kwh,
            {
              produced: prov.produced,
              primaryMetricUnits: prov.primary_metric_units,
              exergyKwhPerOutputUnit: prov.exergy_kwh_per_output_unit,
              exergyKwhPerOutputUnitSource:
                prov.exergy_kwh_per_output_unit_source,
              exergyBasis: prov.exergy_basis,
              reasonAbsent: prov.reason_absent,
            },
            { domain: brief.domain },
          );
          return (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="size-4 text-primary" />
                  {ex.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-foreground">
                    {ex.value}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    per kWh of useful exergy
                  </span>
                </div>
                <p className="text-sm text-secondary-foreground leading-relaxed">
                  {ex.explanation}
                </p>
                {ex.sourceNote && (
                  <p className="text-xs text-muted-foreground italic">
                    {ex.sourceNote}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })()}

      {/* ═══════════ 3. PATH FORWARD ═══════════ */}
      {actionItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="size-4 text-primary" />
              Path Forward
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {actionItems.slice(0, 6).map((item, i) => (
                <div key={i} className="flex gap-3 group">
                  <div className={cn(
                    "shrink-0 size-6 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5 transition-colors",
                    item.type === "action"
                      ? "bg-primary/10 text-primary group-hover:bg-primary/20"
                      : "bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20",
                  )}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground leading-snug">{item.text}</p>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ 4. EVIDENCE ═══════════ */}
      {((brief.key_strengths?.length || 0) > 0 || (brief.key_concerns?.length || 0) > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {brief.key_strengths && brief.key_strengths.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-[var(--accent-green)]">
                  <CheckCircle2 className="size-4" />
                  Strengths
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {brief.key_strengths.map((s, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-secondary-foreground">
                      <span className="shrink-0 mt-1 text-[var(--accent-green)]">+</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {brief.key_concerns && brief.key_concerns.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                  <AlertTriangle className="size-4" />
                  Concerns
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {brief.key_concerns.map((c, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-secondary-foreground">
                      <span className="shrink-0 mt-1 text-destructive">-</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <SourceEvidenceDigest digest={evidenceDigest} />

      {/* ── Module findings ── */}
      {modulesWithFindings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Assessment Findings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {modulesWithFindings.map((m, i) => {
                const shortName = MODULE_SHORT_NAMES[m.module_name] || m.module_name;
                const VerdictIcon = m.verdict === "pass" ? CheckCircle2 : m.verdict === "fail" ? XCircle : MinusCircle;
                const verdictColor = m.verdict === "pass" ? "text-[var(--accent-green)]" : m.verdict === "fail" ? "text-destructive" : "text-muted-foreground";
                return (
                  <div key={i} className="py-3 first:pt-0 last:pb-0 flex gap-3">
                    <VerdictIcon className={cn("size-4 mt-0.5 shrink-0", verdictColor)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{shortName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {m.key_detail && !m.key_detail.includes("No evidence")
                          ? m.key_detail
                          : m.verdict === "fail"
                            ? "Material concerns identified — see details below."
                            : "Directional indicators available. More data increases confidence."}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Modules needing data ── */}
      {modulesNeedingData.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <Info className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">
              Not fully assessed with available data:
            </p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {modulesNeedingData.map((m) => MODULE_SHORT_NAMES[m.module_name] || m.module_name).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* ── Evidence guidance (minimal data) ── */}
      {evidenceLevel === "minimal" && Object.keys(guidance).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="size-4 text-[var(--accent-amber)]" />
              What Would Strengthen This Assessment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              {Object.entries(guidance).map(([name, g]) => {
                const desc = (g.description as string) || name;
                const params = ((g.unlock_by_providing || g.strengthen_by_providing) as string[]) || [];
                return (
                  <div key={name} className="pb-2.5 border-b border-border last:border-b-0 last:pb-0">
                    <p className="text-sm text-foreground">{desc}</p>
                    {params.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Provide: {params.slice(0, 4).join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── No findings fallback ── */}
      {modulesWithFindings.length === 0 && !(brief.key_strengths?.length) && !(brief.key_concerns?.length) && (
        <Card>
          <CardContent className="py-8 text-center">
            <Info className="size-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
              Not enough structured evidence for specific findings.
              Provide technical parameters like efficiency, operating temperature, cost, or capacity for better results.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ 5. DETAIL SECTIONS ═══════════ */}
      {hasDetailSections && (
        <Card>
          <Accordion type="multiple" className="w-full">
            {brief.economics_summary && (
              <AccordionItem value="economics">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <DollarSign className="size-4 text-primary" />
                    Economics
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <p className="text-sm text-secondary-foreground leading-relaxed">{brief.economics_summary}</p>
                  {brief.economics_range && (
                    <p className="text-sm font-medium mt-2 text-primary">{brief.economics_range}</p>
                  )}
                </AccordionContent>
              </AccordionItem>
            )}
            {brief.regulatory_summary && (
              <AccordionItem value="regulatory">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Scale className="size-4 text-primary" />
                    Regulatory Pathway
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <p className="text-sm text-secondary-foreground leading-relaxed">{brief.regulatory_summary}</p>
                </AccordionContent>
              </AccordionItem>
            )}
            {brief.manufacturing_summary && (
              <AccordionItem value="manufacturing">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Factory className="size-4 text-primary" />
                    Manufacturing Readiness
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <p className="text-sm text-secondary-foreground leading-relaxed">{brief.manufacturing_summary}</p>
                </AccordionContent>
              </AccordionItem>
            )}
            {(trlLevel > 0 || brief.trl_assessment) && (
              <AccordionItem value="trl">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Gauge className="size-4 text-primary" />
                    Technology Readiness
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  {trlLevel > 0 && <TRLGauge level={trlLevel} className="mb-3" />}
                  {brief.trl_assessment && <p className="text-xs text-muted-foreground">{brief.trl_assessment}</p>}
                </AccordionContent>
              </AccordionItem>
            )}
            {brief.system_description && (
              <AccordionItem value="system">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Monitor className="size-4 text-primary" />
                    System Description
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <p className="text-sm text-secondary-foreground leading-relaxed">{brief.system_description}</p>
                </AccordionContent>
              </AccordionItem>
            )}
            {brief.competitive_context && (
              <AccordionItem value="competitive">
                <AccordionTrigger className="px-6 text-sm">
                  <span className="flex items-center gap-2">
                    <Trophy className="size-4 text-primary" />
                    Competitive Context
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <p className="text-sm text-secondary-foreground leading-relaxed">{brief.competitive_context}</p>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </Card>
      )}

      {/* ═══════════ 6. TECHNICAL ═══════════ */}
      {/* CC-BE-UX-0033: the Technical Assessment card used to render
          unconditionally. With no composite score and no module summary it
          drew a zero gauge plus an "Evaluated 10 dimensions" fallback line
          that looked like a broken/empty panel. Only render when there is
          something real to show. */}
      {(compositeScore > 0 || (brief.module_summary && brief.module_summary.length > 0)) ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <CircleDot className="size-4 text-primary" />
                Technical Assessment
              </CardTitle>
              <span className="text-xs text-muted-foreground font-mono">{compositeScore}/100</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col items-center justify-center">
                <ScoreGauge score={compositeScore} size={120} strokeWidth={8} />
                <p className="text-xs text-muted-foreground mt-3 text-center leading-relaxed">
                  Evaluated {brief.module_summary?.length || 10} dimensions
                  {brief.modules_passing > 0 && ` · ${brief.modules_passing} strong`}
                  {brief.modules_failing > 0 && ` · ${brief.modules_failing} concern${brief.modules_failing > 1 ? "s" : ""}`}
                  {brief.modules_blocked > 0 && ` · ${brief.modules_blocked} unassessed`}
                </p>
              </div>
              {brief.module_summary?.length > 0 && (
                <div>
                  <ModuleRadar modules={brief.module_summary} height={200} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Baseline comparisons ── */}
      {brief.baseline_comparisons && brief.baseline_comparisons.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">How Your Data Compares</CardTitle>
          </CardHeader>
          <CardContent>
            <ComparisonBarList comparisons={brief.baseline_comparisons} max={10} />
          </CardContent>
        </Card>
      )}

      {/* ═══════════ ALTERNATIVES ═══════════ */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Alternative Technologies</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Based on this assessment, these may better suit your requirements.
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {recommendations.map((rec, i) => (
                <RecommendationCard key={i} rec={rec} index={i} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════ 7. META ═══════════ */}
      <div className="space-y-4 pt-2">
        {brief.caveats && brief.caveats.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Limitations</p>
            <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
              {brief.caveats.map((c, i) => <p key={i}>{c}</p>)}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">About This Assessment</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {brief.methodology_note || `Comparative assessment against published baselines for ${brief.domain?.replace(/_/g, " ") || "this domain"}.`}
          </p>
          {brief.credibility_tier && (
            <p className="text-[11px] text-muted-foreground/60 mt-1">
              Credibility: {brief.credibility_tier} ({brief.credibility_tier === "C3" ? "calibrated simulation" : brief.credibility_tier === "C2" ? "provisional simulation" : brief.credibility_tier === "C1" ? "uncalibrated model" : "baseline comparison"})
            </p>
          )}
        </div>

        <Separator />

        <p className="text-[11px] text-muted-foreground/50">
          {brief.domain?.replace(/_/g, " ")} · {brief.created_at?.split("T")[0] || ""} · Exergy Lab
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function FindingCard({ icon: Icon, label, text, accent }: {
  icon: React.ElementType;
  label: string;
  text: string;
  accent?: "positive" | "concern";
}) {
  return (
    <Card className={cn(
      "transition-colors",
      accent === "positive" && "border-[var(--accent-green)]/20 hover:border-[var(--accent-green)]/30",
      accent === "concern" && "border-destructive/20 hover:border-destructive/30",
    )}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn(
            "size-3.5",
            accent === "positive" ? "text-[var(--accent-green)]" : accent === "concern" ? "text-destructive" : "text-muted-foreground",
          )} />
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        </div>
        <p className="text-sm text-foreground leading-snug">{text}</p>
      </CardContent>
    </Card>
  );
}

function RecommendationCard({ rec, index }: { rec: RecommendationEntry; index: number }) {
  const hasComparison = rec.comparison_metric && rec.evaluated_value && rec.alternative_value;
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3 mb-2">
        <span className="text-sm font-semibold text-muted-foreground mt-0.5">{index + 1}.</span>
        <div>
          <p className="text-sm font-medium text-foreground">{rec.alternative_name}</p>
          {rec.technology_family && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{rec.technology_family}</p>
          )}
        </div>
      </div>
      <p className="text-xs text-secondary-foreground leading-relaxed ml-7">{rec.rationale}</p>

      {hasComparison && (
        <div className="ml-7 mt-2 flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">{rec.comparison_metric}:</span>
          <span className="font-mono text-muted-foreground">{rec.evaluated_value}</span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="font-mono text-primary">{rec.alternative_value}</span>
        </div>
      )}

      {(rec.key_advantages?.length > 0 || rec.key_tradeoffs?.length > 0) && (
        <div className="ml-7 mt-2 grid grid-cols-2 gap-3 text-[11px]">
          {rec.key_advantages?.length > 0 && (
            <div className="space-y-0.5">
              {rec.key_advantages.map((a, i) => (
                <p key={i} className="text-secondary-foreground">
                  <span className="text-[var(--accent-green)]">+</span> {a}
                </p>
              ))}
            </div>
          )}
          {rec.key_tradeoffs?.length > 0 && (
            <div className="space-y-0.5">
              {rec.key_tradeoffs.map((t, i) => (
                <p key={i} className="text-secondary-foreground">
                  <span className="text-muted-foreground">~</span> {t}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {rec.suggested_next_step && (
        <p className="text-[11px] text-muted-foreground mt-2 ml-7">
          <span className="text-primary font-medium">Next:</span> {rec.suggested_next_step}
        </p>
      )}
    </div>
  );
}
