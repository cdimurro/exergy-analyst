/**
 * ReportDocument — Institutional-Grade Technology Assessment Report.
 *
 * Structured as a techno-economic evaluation suitable for institutional
 * investors, project finance teams, and technical due-diligence reviewers.
 *
 * Report structure:
 *   Cover Page → Table of Contents → Executive Summary →
 *   Technology Profile → Technical Analysis → Thermodynamic Assessment →
 *   Economic Assessment → Commercial Positioning →
 *   Manufacturing & Scale-Up → Regulatory & Compliance →
 *   Safety & Risk → Environmental Impact →
 *   System Integration & Strategic Value →
 *   Recommendations & De-Risking Pathway →
 *   Appendix A: Module Scorecards → Appendix B: Process Chain →
 *   Appendix C: Methodology → Appendix D: Alternatives →
 *   Appendix E: References
 */

import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Svg,
  Rect,
  Line,
  G,
  Circle,
  Path,
} from "@react-pdf/renderer";
import type {
  DeviceDecisionBrief,
  RecommendationEntry,
  ModuleVerdictSummary,
  StructuredAxis,
} from "@/lib/brief-types";
import type { ReportNarratives } from "./generate-narratives";
import { domainLabel, filterCaveats } from "@/lib/sanitize";
import { formatCompositeScore as canonicalFormatCompositeScore } from "@/lib/canonical-score";
import { clientFacingFinding, isClientFacingGateResult } from "./report-sanitizers";

// ── Props ────────────────────────────────────────────────────

interface ReportDocumentProps {
  brief: DeviceDecisionBrief;
  narratives: ReportNarratives;
  projectName: string;
  generatedDate: string;
  logoSrc: string;
  evaluation?: Record<string, unknown>;
}

// ── Brand colors ─────────────────────────────────────────────

const C = {
  black: "#111111",
  dark: "#333333",
  mid: "#555555",
  light: "#888888",
  vlight: "#aaaaaa",
  border: "#d0d0d0",
  borderLight: "#e8e8e8",
  headerBg: "#f5f5f5",
  pageBg: "#ffffff",
  teal: "#3d9e8c",
  tealDark: "#2d7a6b",
  blue: "#4a7ab8",
  blueDark: "#3a6198",
  green: "#16713a",
  amber: "#92700c",
  red: "#b91c1c",
  purple: "#6b46c1",
  tealBg: "#edf7f5",
  blueBg: "#eef3fa",
  amberBg: "#fdf8ec",
  redBg: "#fef2f2",
  greenBg: "#edf7ed",
  coverAccent: "#2d7a6b",
};

// ── Styles ───────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 65,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: C.dark,
    backgroundColor: C.pageBg,
  },
  coverPage: {
    paddingTop: 0,
    paddingBottom: 40,
    paddingHorizontal: 0,
    fontFamily: "Helvetica",
    backgroundColor: C.pageBg,
    justifyContent: "space-between",
    height: "100%",
  },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 50,
    right: 50,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: C.light,
    borderTopWidth: 0.5,
    borderTopColor: C.borderLight,
    paddingTop: 5,
  },
  sectionNumber: { fontSize: 8, color: C.teal, marginBottom: 1, letterSpacing: 1.5 },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: C.black,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 0.75,
    borderBottomColor: C.teal,
  },
  subsectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.dark,
    marginBottom: 5,
    marginTop: 12,
  },
  subsubTitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: C.mid,
    marginBottom: 4,
    marginTop: 8,
  },
  body: { fontSize: 9.5, lineHeight: 1.7, color: C.dark, marginBottom: 7 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.headerBg,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: C.borderLight,
  },
  tableCell: { fontSize: 8.5, color: C.dark },
  tableCellBold: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.mid },
  numberedRow: { flexDirection: "row", marginBottom: 4, paddingLeft: 4 },
  numberedNum: { width: 18, fontSize: 9.5, fontFamily: "Helvetica-Bold", color: C.teal },
  numberedText: { flex: 1, fontSize: 9.5, lineHeight: 1.6, color: C.dark },
  spacer: { marginBottom: 14 },
  spacerLg: { marginBottom: 24 },
  divider: { borderBottomWidth: 0.5, borderBottomColor: C.border, marginVertical: 12 },
  appendixTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.black, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 0.75, borderBottomColor: C.teal },
  appendixCaption: { fontSize: 8.5, color: C.mid, marginBottom: 12, lineHeight: 1.5 },
  citation: { fontSize: 7.5, color: C.mid, marginBottom: 3, lineHeight: 1.4 },
  callout: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 3, borderLeftWidth: 2.5, marginBottom: 10 },
  metricBox: { flex: 1, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 3, backgroundColor: C.headerBg, borderWidth: 0.5, borderColor: C.borderLight },
  metricLabel: { fontSize: 7, color: C.light, letterSpacing: 0.5 },
  metricValue: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
});

// ── Tier labels (institutional grade) ────────────────────────

const TIER_LABELS: Record<string, string> = {
  deploy: "Deployment Candidate — All Required Gates Cleared",
  strong: "Advanced — Strong Fundamentals Demonstrated",
  promising: "Pre-Commercial — Key Validation Milestones Pending",
  early: "Early-Stage — Technology Thesis Under Evaluation",
  insufficient: "Preliminary — Insufficient Evidence for Full Assessment",
  conditional: "Conditional — Critical Evidence Gaps Remain",
  caution: "Material Concerns — Significant Risk Factors Identified",
  not_ready: "Pre-Deployment — Fundamental Requirements Not Met",
};

const TIER_COLORS: Record<string, string> = {
  deploy: C.teal, strong: C.teal,
  promising: C.blue, early: C.blue,
  conditional: C.amber, caution: C.red, not_ready: C.red,
  insufficient: C.light,
};

const TIER_BG: Record<string, string> = {
  deploy: C.tealBg, strong: C.tealBg,
  promising: C.blueBg, early: C.blueBg,
  conditional: C.amberBg, caution: C.redBg, not_ready: C.redBg,
  insufficient: C.headerBg,
};

// ── Module names ─────────────────────────────────────────────

const MODULE_NAMES: Record<string, string> = {
  "Physics & Causal Validity": "Physics & Causal Validity",
  "Performance & Durability": "Performance & Durability",
  "Economics & Bankability": "Economics & Bankability",
  "Safety & Resilience": "Safety & Resilience",
  "Regulatory & Permitting": "Regulatory & Permitting",
  "Manufacturing & Supply Chain": "Manufacturing & Supply Chain",
  "Environmental & Circularity": "Environmental & Circularity",
  "Scalability & Deployment": "Scalability & Deployment",
  "System Integration": "System Integration",
  "Novelty & Strategic Value": "Novelty & Strategic Value",
};

const MODULE_SHORT: Record<string, string> = {
  "Physics & Causal Validity": "Physics",
  "Performance & Durability": "Performance",
  "Economics & Bankability": "Economics",
  "Safety & Resilience": "Safety",
  "Regulatory & Permitting": "Regulatory",
  "Manufacturing & Supply Chain": "Manufacturing",
  "Environmental & Circularity": "Environmental",
  "Scalability & Deployment": "Scalability",
  "System Integration": "Integration",
  "Novelty & Strategic Value": "Strategic",
};

// ── Verdict colors ───────────────────────────────────────────

const AXIS_VERDICT_COLOR: Record<string, string> = {
  operationally_validated: C.teal, solver_confirmed: C.teal,
  physics_consistent: C.teal, benchmark_aligned: C.teal,
  directionally_plausible: C.amber, unverified: C.light,
  physics_violation: C.red, thermodynamically_infeasible: C.red,
  cost_advantaged: C.teal, cost_parity: C.teal,
  policy_dependent: C.amber, tipping_fee_dependent: C.amber,
  niche_competitive: C.amber, scale_frontier: C.amber,
  structurally_uncompetitive: C.red, unknown_economics: C.light,
  certified: C.teal, meets_spec: C.teal,
  upgradable_gap: C.amber, marginal_gap: C.amber,
  regulatory_pathway_cleared: C.amber,
  structural_gap: C.red, unregulated: C.light, blocks_market: C.red,
  commercial_multiple: C.teal, commercial_single: C.teal,
  demonstration: C.teal, pilot_integrated: C.amber,
  pilot_subsystem: C.amber, bench_validated: C.amber,
  analytical_proven: C.light, concept_only: C.light,
  exergy_optimized: C.teal, exergy_competitive: C.teal,
  exergy_conventional: C.amber, exergy_subordinate: C.red,
  exergy_violation: C.red, exergy_unknown: C.light,
  exergy_identity_domain: C.light, exergy_uncalibrated: C.light,
};

// ── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch { return iso; }
}

function Paragraphs({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split(/\n\n+/).filter(Boolean).map((p, i) => (
        <Text key={i} style={s.body}>{p.trim()}</Text>
      ))}
    </>
  );
}

function Footer({ brief, date }: { brief: DeviceDecisionBrief; date: string }) {
  const name = brief.commercial_name || brief.device_id || "";
  return (
    <View style={s.footer} fixed>
      <Text>Exergy Lab — {name} Assessment</Text>
      <Text style={{ fontSize: 7, color: C.vlight }}>{formatDate(date)}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <View style={s.spacerLg}>
      {number && <Text style={s.sectionNumber}>{number}</Text>}
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function Callout({ color, bgColor, label, text }: { color: string; bgColor: string; label: string; text: string }) {
  return (
    <View style={{ ...s.callout, borderLeftColor: color, backgroundColor: bgColor }} wrap={false}>
      <Text style={{ fontSize: 7.5, color: C.mid, fontFamily: "Helvetica-Bold", marginBottom: 2, letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 9, color: C.black, lineHeight: 1.5 }}>{text}</Text>
    </View>
  );
}

function MetricCard({ label, value, color, bgColor }: { label: string; value: string; color?: string; bgColor?: string }) {
  return (
    <View style={{ ...s.metricBox, ...(bgColor ? { backgroundColor: bgColor } : {}) }}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={{ ...s.metricValue, color: color || C.dark }}>{value}</Text>
    </View>
  );
}

function verdictColor(verdict: string | undefined): string {
  if (!verdict) return C.light;
  if (verdict === "pass") return C.teal;
  if (verdict === "conditional") return C.amber;
  if (verdict === "fail" || verdict === "blocked") return C.red;
  return C.light;
}

function tierLabel(brief: DeviceDecisionBrief): string {
  const trl = (brief as any).trl_assessment || "";
  const isTrlLow = /TRL [1-5]/.test(trl);
  if (isTrlLow && brief.readiness_tier === "not_ready") return "Pre-Deployment — Physics Under Review";
  if (isTrlLow && brief.readiness_tier === "insufficient") return "Preliminary — Pre-Pilot Assessment";
  if (isTrlLow && brief.readiness_tier === "early") return "Early-Stage — Investment Thesis Under Evaluation";
  return TIER_LABELS[brief.readiness_tier] || brief.readiness_tier;
}

// ── SVG Chart Components ────────────────────────────────────

function HBarChart({ data, width, height, maxValue }: {
  data: Array<{ label: string; value: number; color?: string }>;
  width: number;
  height: number;
  maxValue?: number;
}) {
  if (!data.length) return null;
  const max = maxValue || Math.max(...data.map(d => d.value), 1);
  const barHeight = Math.min(14, (height - 10) / data.length - 4);
  const labelWidth = 90;
  const chartWidth = width - labelWidth - 40;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {data.map((d, i) => {
        const y = i * (barHeight + 4) + 4;
        const barW = Math.max(1, (d.value / max) * chartWidth);
        const color = d.color || C.teal;
        return (
          <G key={i}>
            <Rect x={labelWidth} y={y} width={barW} height={barHeight} fill={color} rx={2} ry={2} />
            <Rect x={labelWidth} y={y} width={chartWidth} height={barHeight} fill="none" stroke={C.borderLight} strokeWidth={0.5} rx={2} ry={2} />
          </G>
        );
      })}
    </Svg>
  );
}

function ScoreGaugeSvg({ score, size, color }: { score: number; size: number; color: string }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const progress = Math.max(0.001, Math.min(0.999, score / 100));
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + 2 * Math.PI * progress;
  const largeArc = progress > 0.5 ? 1 : 0;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={C.borderLight} strokeWidth={3} />
      <Path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function ModuleVerdictBar({ modules }: { modules: ModuleVerdictSummary[] }) {
  if (!modules.length) return null;
  const w = 340;
  const h = 20;
  const barW = w / modules.length;

  return (
    <View style={{ marginBottom: 10 }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {modules.map((m, i) => {
          const color = verdictColor(m.verdict);
          return (
            <Rect key={i} x={i * barW + 1} y={2} width={barW - 2} height={h - 4} fill={color} rx={2} ry={2} />
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        {modules.map((m, i) => (
          <Text key={i} style={{ width: barW, fontSize: 5.5, color: C.light, textAlign: "center" }}>
            {MODULE_SHORT[m.module_name] || m.module_name?.slice(0, 6)}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ── Cover Page ──────────────────────────────────────────────

function CoverPage({ brief, logoSrc, date }: {
  brief: DeviceDecisionBrief; logoSrc: string; date: string;
}) {
  const tier = tierLabel(brief);
  const tierColor = TIER_COLORS[brief.readiness_tier] || C.dark;
  const tierBg = TIER_BG[brief.readiness_tier] || C.headerBg;

  return (
    <Page size="A4" style={s.coverPage}>
      <View style={{ height: 8, backgroundColor: C.coverAccent }} />

      <View style={{ paddingHorizontal: 55, paddingTop: 60, flex: 1, justifyContent: "center" }}>
        <Image src={logoSrc} style={{ width: 120, marginBottom: 40 }} />

        <Text style={{ fontSize: 10, color: C.teal, letterSpacing: 2.5, marginBottom: 6 }}>
          TECHNOLOGY ASSESSMENT REPORT
        </Text>
        <Text style={{ fontSize: 26, fontFamily: "Helvetica-Bold", color: C.black, marginBottom: 6, lineHeight: 1.2 }}>
          {brief.commercial_name || brief.device_id}
        </Text>
        {brief.technology_family && (
          <Text style={{ fontSize: 13, color: C.mid, marginBottom: 4 }}>
            {brief.technology_family}
          </Text>
        )}
        <Text style={{ fontSize: 11, color: C.light, marginBottom: 20 }}>
          {domainLabel(brief.domain)}{brief.manufacturer ? ` — ${brief.manufacturer}` : ""}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 30 }}>
          <View style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 4, backgroundColor: tierBg, borderWidth: 0.75, borderColor: tierColor }}>
            <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: tierColor }}>
              {tier}
            </Text>
          </View>
        </View>

        <View style={{ borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 14 }}>
          <View style={{ flexDirection: "row", gap: 30, marginBottom: 8 }}>
            <View>
              <Text style={{ fontSize: 7, color: C.light, letterSpacing: 1 }}>DATE OF ASSESSMENT</Text>
              <Text style={{ fontSize: 9, color: C.dark, marginTop: 2 }}>{formatDate(date)}</Text>
            </View>
            <View>
              <Text style={{ fontSize: 7, color: C.light, letterSpacing: 1 }}>PREPARED BY</Text>
              <Text style={{ fontSize: 9, color: C.dark, marginTop: 2 }}>Exergy Lab</Text>
            </View>
            <View>
              <Text style={{ fontSize: 7, color: C.light, letterSpacing: 1 }}>ASSESSMENT MODE</Text>
              <Text style={{ fontSize: 9, color: C.dark, marginTop: 2 }}>
                {(brief as any).assessment_mode === "screening" ? "Evidence Review" : "Full Evaluation"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: 55, paddingBottom: 10 }}>
        <View style={{ borderTopWidth: 0.5, borderTopColor: C.borderLight, paddingTop: 8 }}>
          <Text style={{ fontSize: 7, color: C.vlight, lineHeight: 1.5 }}>
            CONFIDENTIAL — This report was generated by Exergy Lab's deployment-readiness assessment platform.
            It is intended for the exclusive use of the commissioning party and their authorized advisors.
            This assessment is based on available data as of the date above and should be supplemented with
            domain-specific expert review before making investment or deployment decisions.
          </Text>
        </View>
      </View>
    </Page>
  );
}

// ── Table of Contents ───────────────────────────────────────

function TableOfContents({ brief }: { brief: DeviceDecisionBrief }) {
  const sections = [
    { num: "", title: "Executive Summary" },
    { num: "01", title: "Technology Profile" },
    { num: "02", title: "Technical Analysis" },
    { num: "03", title: "Thermodynamic Assessment" },
    { num: "04", title: "Economic Assessment" },
    { num: "05", title: "Commercial Positioning" },
    { num: "06", title: "Manufacturing & Scale-Up Assessment" },
    { num: "07", title: "Regulatory & Compliance Pathway" },
    { num: "08", title: "Safety & Risk Assessment" },
    { num: "09", title: "Environmental Impact Assessment" },
    { num: "10", title: "System Integration & Strategic Value" },
    { num: "11", title: "Recommendations & De-Risking Pathway" },
  ];
  const appendices = [
    "Appendix A: Detailed Module Scorecards",
    "Appendix B: Process Chain Analysis",
    "Appendix C: Methodology & Evidence Basis",
    "Appendix D: Alternative Technologies",
    "Appendix E: References",
  ];

  return (
    <View>
      <View style={s.spacerLg}>
        <Text style={{ fontSize: 15, fontFamily: "Helvetica-Bold", color: C.black, marginBottom: 16, paddingBottom: 4, borderBottomWidth: 0.75, borderBottomColor: C.teal }}>
          Contents
        </Text>
      </View>
      {sections.map((sec, i) => (
        <View key={i} style={{ flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.25, borderBottomColor: C.borderLight }}>
          <Text style={{ width: 25, fontSize: 8.5, color: C.teal, fontFamily: "Helvetica-Bold" }}>{sec.num}</Text>
          <Text style={{ flex: 1, fontSize: 9.5, color: C.dark }}>{sec.title}</Text>
        </View>
      ))}
      <View style={{ marginTop: 10 }}>
        {appendices.map((a, i) => (
          <View key={i} style={{ paddingVertical: 2 }}>
            <Text style={{ fontSize: 8.5, color: C.mid }}>{a}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Executive Summary ───────────────────────────────────────

/**
 * formatCompositeScore — render the composite score as an integer for
 * the PDF header / MetricCard display. Distinguishes missing data
 * (null/undefined/NaN) from a real zero so "0" in the PDF never
 * silently means "we have no data." CC-BE-0113b: composite_score is
 * now on 0-100 scale at the schema boundary, so there is no ``* 100``
 * upconversion here — the canonical formatter clamps to [0, 100] and
 * rounds. The local wrapper keeps the PDF-specific "N/A" fallback
 * that the canonical helper doesn't expose.
 */
function formatCompositeScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return canonicalFormatCompositeScore(v, "gauge");
}

/**
 * stripScorecardPrefix — removes leading "ModuleName:" labels and bare
 * "N/M gate(s)." counts so strengths/concerns read as insights, not as
 * scorecard line-items. "Performance: 4/5 gates. Cycle life strong at
 * 4,200 cycles." → "Cycle life strong at 4,200 cycles."
 */
function stripScorecardPrefix(line: string): string {
  if (!line) return line;
  let out = line.trim();
  // Drop "Module Name: " prefix (Title-cased words, up to 4 words).
  out = out.replace(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}):\s+/, "");
  // Drop bare gate tallies like "4/5 gates.", "3 of 5 gates pass."
  out = out.replace(/^\d+\s*(?:of|\/)\s*\d+\s*gates?(?:\s+pass(?:ing|ed)?)?\.?\s*/i, "");
  return out.trim() || line;
}

function ExecutiveSummary({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const modules = brief.module_summary || [];
  const fi = (brief as any).founder_insights || {};

  return (
    <View>
      <SectionHeader number="" title="Executive Summary" />

      {brief.headline && (
        <Text style={{ ...s.body, fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.black, marginBottom: 10, lineHeight: 1.5 }}>
          {brief.headline}
        </Text>
      )}

      {/* Narrative synthesis leads — insight first, scorecard after. */}
      <Paragraphs text={narratives.executive_summary} />

      {/* What the data confirms / Where the evidence is thinner — relabeled
          from "KEY STRENGTHS / KEY CONCERNS" and stripped of module prefixes
          so the lines read as findings, not a scorecard. */}
      {(brief.key_strengths?.length > 0 || brief.key_concerns?.length > 0) && (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 12 }}>
          {brief.key_strengths?.length > 0 && (
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.teal, marginBottom: 4, letterSpacing: 0.5 }}>
                WHAT THE DATA CONFIRMS
              </Text>
              {brief.key_strengths.slice(0, 5).map((s2, i) => (
                <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 2, lineHeight: 1.4 }}>
                  + {stripScorecardPrefix(s2)}
                </Text>
              ))}
            </View>
          )}
          {brief.key_concerns?.length > 0 && (
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.red, marginBottom: 4, letterSpacing: 0.5 }}>
                WHERE THE EVIDENCE IS THINNER
              </Text>
              {brief.key_concerns.slice(0, 5).map((c, i) => (
                <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 2, lineHeight: 1.4 }}>
                  — {stripScorecardPrefix(c)}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Critical bottleneck callout */}
      {fi.top_commercial_bottleneck && (
        <Callout color={C.amber} bgColor={C.amberBg} label="CRITICAL BOTTLENECK" text={fi.top_commercial_bottleneck} />
      )}

      {/* Supporting quantitative snapshot — moved below the narrative so the
          reader sees the insight first, then the numbers backing it up. */}
      <View style={{ flexDirection: "row", gap: 6, marginTop: 12, marginBottom: 10 }}>
        <MetricCard label="COMPOSITE SCORE" value={formatCompositeScore(brief.composite_score)} color={C.teal} bgColor={C.tealBg} />
        <MetricCard label="MODULES PASSING" value={`${brief.modules_passing || 0}/${modules.length}`} color={verdictColor(brief.modules_passing >= 7 ? "pass" : brief.modules_passing >= 4 ? "conditional" : "fail")} />
        <MetricCard label="VETO GATES" value={brief.veto_modules_clear ? "Clear" : "Unresolved"} color={brief.veto_modules_clear ? C.teal : C.red} bgColor={brief.veto_modules_clear ? C.tealBg : C.redBg} />
        <MetricCard label="EVIDENCE BASE" value={brief.evidence_strength || "Unknown"} color={brief.evidence_strength === "strong" ? C.teal : brief.evidence_strength === "moderate" ? C.amber : C.light} />
      </View>

      {/* Module verdict bar */}
      {modules.length > 0 && <ModuleVerdictBar modules={modules} />}
    </View>
  );
}

// ── Section 01: Technology Profile ───────────────────────────

function TechnologyProfile({ brief, narratives, evaluation }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives; evaluation?: Record<string, unknown>;
}) {
  const b = brief as any;
  const resolved = b.resolved_subject || {};

  return (
    <View break>
      <SectionHeader number="SECTION 01" title="Technology Profile" />
      <Paragraphs text={narratives.technology_profile} />

      {/* Technology identity table */}
      <View style={{ marginTop: 8, marginBottom: 10 }}>
        {[
          ["Technology", brief.commercial_name || brief.device_id],
          ["Manufacturer / Developer", brief.manufacturer || "—"],
          ["Domain", domainLabel(brief.domain)],
          ["Technology Family", brief.technology_family || "—"],
          ["Process Profile", resolved.process_profile || b.system_description?.slice(0, 120) || "—"],
          ["Assessment Mode", b.assessment_mode === "screening" ? "Evidence Review" : "Full Evaluation"],
        ].map(([label, value], i) => (
          <View key={i} style={{ flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.25, borderBottomColor: C.borderLight }}>
            <Text style={{ width: "35%", fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.mid }}>{label}</Text>
            <Text style={{ flex: 1, fontSize: 8.5, color: C.dark }}>{value}</Text>
          </View>
        ))}
      </View>

      {brief.trl_assessment && (
        <>
          <Text style={s.subsectionTitle}>Technology Readiness Assessment</Text>
          <Paragraphs text={brief.trl_assessment as string} />
        </>
      )}

      {brief.system_description && (
        <>
          <Text style={s.subsectionTitle}>System Description</Text>
          <Paragraphs text={brief.system_description as string} />
        </>
      )}

      {brief.competitive_context && (
        <>
          <Text style={s.subsectionTitle}>Competitive Landscape</Text>
          <Paragraphs text={brief.competitive_context as string} />
        </>
      )}
    </View>
  );
}

// ── Section 02: Technical Analysis ──────────────────────────

function TechnicalAnalysis({ brief, narratives, evaluation }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives; evaluation?: Record<string, unknown>;
}) {
  const b = brief as any;
  const tf = brief.technical_feasibility;
  const sidecar = b.sidecar_concordance_details || {};
  const sidecarStatus = b.sidecar_status || b.solver_surface_status || "";
  const concordance = b.sidecar_concordance;
  const sidecarEntries = Object.entries(sidecar).filter(([_, v]) => v && (v as any).agreement != null);

  return (
    <View break>
      <SectionHeader number="SECTION 02" title="Technical Analysis" />
      <Paragraphs text={narratives.technical_analysis} />

      {/* Technical feasibility axis */}
      {tf && (
        <View style={{ ...s.callout, borderLeftColor: AXIS_VERDICT_COLOR[tf.verdict] || C.light, backgroundColor: C.headerBg, marginTop: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>Technical Feasibility Assessment</Text>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[tf.verdict] || C.dark }}>
              {(tf.verdict || "").replace(/_/g, " ").toUpperCase()}
            </Text>
          </View>
          {tf.basis && <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4 }}>{tf.basis}</Text>}
          {tf.gaps && tf.gaps.length > 0 && (
            <View style={{ marginTop: 4 }}>
              {tf.gaps.map((g, i) => (
                <Text key={i} style={{ fontSize: 7.5, color: C.amber }}>Gap: {g}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Solver validation results */}
      {sidecarEntries.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Solver Validation Results</Text>
          {concordance != null && (
            <Text style={{ fontSize: 9, color: C.dark, marginBottom: 6 }}>
              Overall solver concordance: {(concordance * 100).toFixed(1)}% — Status: {sidecarStatus || "—"}
            </Text>
          )}
          <View style={s.tableHeader}>
            <Text style={{ ...s.tableCellBold, width: "30%" }}>Parameter</Text>
            <Text style={{ ...s.tableCellBold, width: "18%", textAlign: "right" }}>Primary</Text>
            <Text style={{ ...s.tableCellBold, width: "18%", textAlign: "right" }}>Solver</Text>
            <Text style={{ ...s.tableCellBold, width: "18%", textAlign: "right" }}>Agreement</Text>
            <Text style={{ ...s.tableCellBold, width: "16%", textAlign: "right" }}>Weight</Text>
          </View>
          {sidecarEntries.map(([key, val], i) => {
            const v = val as any;
            const agPct = v.agreement != null ? (v.agreement * 100).toFixed(1) : "—";
            const agColor = v.agreement >= 0.95 ? C.teal : v.agreement >= 0.85 ? C.amber : C.red;
            return (
              <View key={i} style={s.tableRow} wrap={false}>
                <Text style={{ ...s.tableCell, width: "30%" }}>{key.replace(/_/g, " ")}</Text>
                <Text style={{ ...s.tableCell, width: "18%", textAlign: "right" }}>{v.ecm != null ? Number(v.ecm).toFixed(2) : "—"}</Text>
                <Text style={{ ...s.tableCell, width: "18%", textAlign: "right" }}>{v.pybamm != null ? Number(v.pybamm).toFixed(2) : "—"}</Text>
                <Text style={{ ...s.tableCell, width: "18%", textAlign: "right", color: agColor }}>{agPct}%</Text>
                <Text style={{ ...s.tableCell, width: "16%", textAlign: "right" }}>{v.weight != null ? (v.weight * 100).toFixed(0) + "%" : "—"}</Text>
              </View>
            );
          })}
        </>
      )}

      {/* Performance claims */}
      {((brief.performance_claims as string[] | undefined)?.length ?? 0) > 0 && (
        <>
          <Text style={s.subsectionTitle}>Performance Notes</Text>
          {(brief.performance_claims as string[]).slice(0, 6).map((c, i) => (
            <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 2, paddingLeft: 6 }}>• {c}</Text>
          ))}
        </>
      )}
    </View>
  );
}

// ── Section 03: Thermodynamic Assessment ────────────────────

function ThermodynamicAssessment({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const eta = brief.second_law_efficiency;
  const etaPct = eta != null ? (eta * 100).toFixed(1) : null;
  const ceilPct = brief.exergy_ceiling != null ? (brief.exergy_ceiling * 100).toFixed(1) : null;
  const headroomRaw = brief.exergy_headroom != null ? brief.exergy_headroom * 100 : null;
  const headroomPct = headroomRaw != null ? headroomRaw.toFixed(1) : null;
  const destMap = brief.exergy_destruction_map || [];
  const tq = brief.thermodynamic_quality;
  const qf = brief.exergy_quality_factor;
  const carrier = brief.exergy_carrier_type;
  const hasData = etaPct || destMap.length > 0 || narratives.thermodynamic_assessment;
  if (!hasData) return null;

  return (
    <View break>
      <SectionHeader number="SECTION 03" title="Thermodynamic Assessment" />
      <Paragraphs text={narratives.thermodynamic_assessment} />

      {/* Exergy metrics cards */}
      {(etaPct || ceilPct || headroomPct) && (
        <View style={{ flexDirection: "row", gap: 6, marginVertical: 10 }}>
          {etaPct && (
            <MetricCard label="SECOND-LAW EFFICIENCY (η_II)" value={`${etaPct}%`} color={C.teal} bgColor={C.tealBg} />
          )}
          {ceilPct && (
            <MetricCard label="FAMILY CEILING" value={`${ceilPct}%`} color={C.dark} />
          )}
          {headroomPct && (
            <MetricCard label="IMPROVEMENT HEADROOM" value={`${headroomRaw! >= 0 ? "+" : ""}${headroomPct}pp`} color={C.blue} bgColor={C.blueBg} />
          )}
          {qf != null && (
            <MetricCard label="QUALITY FACTOR" value={qf.toFixed(3)} color={C.dark} />
          )}
        </View>
      )}

      {/* Thermodynamic quality verdict */}
      {tq && (
        <View style={{ ...s.callout, borderLeftColor: AXIS_VERDICT_COLOR[tq.verdict] || C.light, backgroundColor: C.headerBg, marginTop: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>Thermodynamic Quality Verdict</Text>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[tq.verdict] || C.dark }}>
              {(tq.verdict || "").replace(/_/g, " ").toUpperCase()}
            </Text>
          </View>
          {tq.basis && <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4 }}>{tq.basis}</Text>}
        </View>
      )}

      {/* Exergy plain summary */}
      {brief.exergy_summary_plain && (
        <Text style={{ ...s.body, marginTop: 6 }}>{brief.exergy_summary_plain}</Text>
      )}

      {/* Destruction map table */}
      {destMap.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Exergy Destruction Analysis</Text>
          <Text style={{ fontSize: 8.5, color: C.mid, marginBottom: 6 }}>
            Stage-by-stage identification of thermodynamic losses. Primary improvement targets ranked by fraction of input exergy destroyed.
          </Text>
          <View style={s.tableHeader}>
            <Text style={{ ...s.tableCellBold, width: "50%" }}>Loss Mechanism</Text>
            <Text style={{ ...s.tableCellBold, width: "25%", textAlign: "right" }}>Destruction (Wh)</Text>
            <Text style={{ ...s.tableCellBold, width: "25%", textAlign: "right" }}>Share of Input</Text>
          </View>
          {destMap.map((row, i) => (
            <View key={i} style={s.tableRow} wrap={false}>
              <Text style={{ ...s.tableCell, width: "50%" }}>{(row.mechanism || "").replace(/_/g, " ")}</Text>
              <Text style={{ ...s.tableCell, width: "25%", textAlign: "right" }}>{Math.round(row.destruction_Wh).toLocaleString()}</Text>
              <Text style={{ ...s.tableCell, width: "25%", textAlign: "right", color: row.fraction_of_input > 0.2 ? C.red : C.dark }}>{((row.fraction_of_input || 0) * 100).toFixed(1)}%</Text>
            </View>
          ))}
        </>
      )}

      {carrier && (
        <Text style={{ fontSize: 8.5, color: C.mid, marginTop: 6 }}>
          Energy carrier type: {carrier}
        </Text>
      )}
    </View>
  );
}

// ── Section 04: Economic Assessment ─────────────────────────

function EconomicAssessment({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  const nominal = brief.lcof_nominal_per_gge;
  const exAdj = brief.lcof_exergy_adjusted_per_gge;
  const divergence = brief.lcof_divergence_pct;
  const lcos_base = b.economics_lcos_base;
  const lcos_opt = b.economics_lcos_optimistic;
  const lcos_pess = b.economics_lcos_pessimistic;
  const incumbent = b.economics_incumbent_comparison;
  const cv = brief.commercial_viability;

  return (
    <View break>
      <SectionHeader number="SECTION 04" title="Economic Assessment" />
      <Paragraphs text={narratives.economic_assessment} />

      {/* Levelized cost metrics */}
      {(nominal != null || lcos_base != null) && (
        <>
          <Text style={s.subsectionTitle}>Levelized Cost Analysis</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
            {nominal != null && (
              <MetricCard label="LCOF NOMINAL" value={`$${nominal.toFixed(2)}/GGE`} color={C.dark} />
            )}
            {exAdj != null && (
              <MetricCard label="LCOF EXERGY-ADJUSTED" value={`$${exAdj.toFixed(2)}/GGE`} color={C.blue} bgColor={C.blueBg} />
            )}
            {divergence != null && (
              <MetricCard
                label="EXERGY DIVERGENCE"
                value={`${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}%`}
                color={Math.abs(divergence) < 10 ? C.teal : Math.abs(divergence) < 25 ? C.amber : C.red}
                bgColor={Math.abs(divergence) < 10 ? C.tealBg : Math.abs(divergence) < 25 ? C.amberBg : C.redBg}
              />
            )}
            {lcos_base != null && (
              <MetricCard label="LCOS BASE" value={`$${lcos_base.toFixed(0)}/MWh`} color={C.dark} />
            )}
          </View>
        </>
      )}

      {/* Scenario range */}
      {lcos_opt != null && lcos_pess != null && (
        <>
          <Text style={s.subsectionTitle}>Scenario Analysis</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
            <MetricCard label="OPTIMISTIC" value={`$${lcos_opt.toFixed(0)}/MWh`} color={C.teal} bgColor={C.tealBg} />
            <MetricCard label="BASE CASE" value={`$${(lcos_base || 0).toFixed(0)}/MWh`} color={C.dark} />
            <MetricCard label="PESSIMISTIC" value={`$${lcos_pess.toFixed(0)}/MWh`} color={C.red} bgColor={C.redBg} />
          </View>
        </>
      )}

      {/* Incumbent comparison */}
      {incumbent && (
        <Callout color={C.blue} bgColor={C.blueBg} label="INCUMBENT COMPARISON" text={incumbent} />
      )}

      {/* Exergy adjustment note */}
      {brief.lcof_is_divergent && brief.lcof_exergy_adjustment_note && (
        <Text style={{ fontSize: 8.5, color: C.mid, marginBottom: 8, lineHeight: 1.4 }}>
          Exergy adjustment note: {brief.lcof_exergy_adjustment_note}
        </Text>
      )}

      {/* Economic sensitivities */}
      {brief.economics_sensitivity?.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Sensitivity Factors</Text>
          {brief.economics_sensitivity.slice(0, 8).map((item, i) => (
            <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 3, paddingLeft: 6 }}>
              {i + 1}. {item}
            </Text>
          ))}
        </>
      )}

      {/* Commercial viability axis */}
      {cv && (
        <View style={{ ...s.callout, borderLeftColor: AXIS_VERDICT_COLOR[cv.verdict] || C.light, backgroundColor: C.headerBg, marginTop: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>Commercial Viability Assessment</Text>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[cv.verdict] || C.dark }}>
              {(cv.verdict || "").replace(/_/g, " ").toUpperCase()}
            </Text>
          </View>
          {cv.basis && <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4 }}>{cv.basis}</Text>}
        </View>
      )}
    </View>
  );
}

// ── Section 05: Commercial Positioning ──────────────────────

function CommercialPositioning({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  const fi = b.founder_insights || {};
  const comparisons = (b.baseline_comparisons || []) as Array<Record<string, any>>;
  if (!narratives.commercial_positioning && !comparisons.length) return null;

  return (
    <View break>
      <SectionHeader number="SECTION 05" title="Commercial Positioning" />
      <Paragraphs text={narratives.commercial_positioning} />

      {/* Founder signals */}
      {(fi.sellable_market || fi.strongest_claim) && (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
          {fi.sellable_market && (
            <View style={{ flex: 1 }}>
              <Callout color={C.teal} bgColor={C.tealBg} label="TARGET MARKET" text={fi.sellable_market} />
            </View>
          )}
          {fi.strongest_claim && (
            <View style={{ flex: 1 }}>
              <Callout color={C.blue} bgColor={C.blueBg} label="STRONGEST SIGNAL" text={fi.strongest_claim} />
            </View>
          )}
        </View>
      )}

      {/* Baseline comparisons table */}
      {comparisons.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Published Reference Benchmarking</Text>
          <View style={s.tableHeader}>
            <Text style={{ ...s.tableCellBold, width: "26%" }}>Parameter</Text>
            <Text style={{ ...s.tableCellBold, width: "18%" }}>Assessed Value</Text>
            <Text style={{ ...s.tableCellBold, width: "18%" }}>Reference</Text>
            <Text style={{ ...s.tableCellBold, width: "20%" }}>Position</Text>
            <Text style={{ ...s.tableCellBold, width: "18%" }}>Assessment</Text>
          </View>
          {comparisons.slice(0, 12).map((bc, i) => {
            const assessColor = (bc.assessment || "").toLowerCase().includes("strong") ? C.teal
              : (bc.assessment || "").toLowerCase().includes("below") ? C.red
              : C.mid;
            return (
              <View key={i} style={s.tableRow} wrap={false}>
                <Text style={{ ...s.tableCell, width: "26%" }}>{(bc.parameter || "").replace(/_/g, " ")}</Text>
                <Text style={{ ...s.tableCell, width: "18%", fontFamily: "Helvetica-Bold" }}>{bc.your_value ?? "—"}</Text>
                <Text style={{ ...s.tableCell, width: "18%" }}>{bc.baseline_value ?? "—"}</Text>
                <Text style={{ ...s.tableCell, width: "20%" }}>{bc.position || "—"}</Text>
                <Text style={{ ...s.tableCell, width: "18%", color: assessColor }}>{bc.assessment || "—"}</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

// ── Section 06: Manufacturing & Scale-Up ────────────────────

function ManufacturingAndScale({ brief, narratives, evaluation }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives; evaluation?: Record<string, unknown>;
}) {
  const b = brief as any;
  const pc = (evaluation?.process_chain as Record<string, unknown>) || undefined;
  const stages = (pc?.stages || []) as Array<Record<string, unknown>>;
  const sr = brief.scale_readiness_axis;
  const sc = brief.spec_compliance_axis;

  return (
    <View break>
      <SectionHeader number="SECTION 06" title="Manufacturing & Scale-Up Assessment" />
      <Paragraphs text={narratives.manufacturing_and_scale} />

      {/* Manufacturing summary */}
      {brief.manufacturing_summary && (
        <Callout color={C.blue} bgColor={C.blueBg} label="MANUFACTURING READINESS" text={brief.manufacturing_summary} />
      )}

      {/* Scale readiness axis */}
      {sr && (
        <View style={{ ...s.callout, borderLeftColor: AXIS_VERDICT_COLOR[sr.verdict] || C.light, backgroundColor: C.headerBg, marginTop: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>Scale Readiness</Text>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[sr.verdict] || C.dark }}>
              {(sr.verdict || "").replace(/_/g, " ").toUpperCase()}
            </Text>
          </View>
          {sr.basis && <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4 }}>{sr.basis}</Text>}
        </View>
      )}

      {/* Process chain table */}
      {stages.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Process Chain Analysis</Text>
          <Text style={{ fontSize: 8.5, color: C.mid, marginBottom: 6 }}>
            {stages.length}-stage process. Per-stage efficiency, mass flow, contaminant tracking, and cost allocation.
          </Text>
          <View style={s.tableHeader}>
            <Text style={{ ...s.tableCellBold, width: "28%" }}>Stage</Text>
            <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right" }}>Efficiency</Text>
            <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right" }}>Mass Out</Text>
            <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right" }}>Cl (ppm)</Text>
            <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right" }}>Cost</Text>
            <Text style={{ ...s.tableCellBold, width: "16%" }}>Bottleneck</Text>
          </View>
          {stages.map((st, i) => (
            <View key={i} style={s.tableRow} wrap={false}>
              <Text style={{ ...s.tableCell, width: "28%" }}>{String(st.stage_name || `Stage ${i + 1}`)}</Text>
              <Text style={{ ...s.tableCell, width: "14%", textAlign: "right" }}>{st.stage_efficiency_pct != null ? `${Number(st.stage_efficiency_pct).toFixed(0)}%` : "—"}</Text>
              <Text style={{ ...s.tableCell, width: "14%", textAlign: "right" }}>{st.mass_out_kg != null ? `${Number(st.mass_out_kg).toFixed(0)} kg` : "—"}</Text>
              <Text style={{ ...s.tableCell, width: "14%", textAlign: "right", color: Number(st.cl_out_ppm || 0) > 500 ? C.red : C.dark }}>{st.cl_out_ppm != null ? Number(st.cl_out_ppm).toFixed(0) : "—"}</Text>
              <Text style={{ ...s.tableCell, width: "14%", textAlign: "right" }}>{st.cleanup_cost_usd_per_ton != null ? `$${Number(st.cleanup_cost_usd_per_ton).toFixed(0)}/t` : "—"}</Text>
              <Text style={{ ...s.tableCell, width: "16%", fontSize: 7 }}>{(st.bottleneck as string || "").slice(0, 50)}</Text>
            </View>
          ))}
          {/* Process chain summary row */}
          {pc && (
            <View style={{ flexDirection: "row", paddingVertical: 5, paddingHorizontal: 6, backgroundColor: C.headerBg, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={{ ...s.tableCellBold, width: "28%", color: C.dark }}>Total / Overall</Text>
              <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right", color: C.dark }}>{pc.overall_energy_efficiency_pct ? `${Number(pc.overall_energy_efficiency_pct).toFixed(1)}%` : "—"}</Text>
              <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right", color: C.dark }}>{pc.overall_mass_yield_pct ? `${Number(pc.overall_mass_yield_pct).toFixed(1)}%` : "—"}</Text>
              <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right", color: Number(pc.final_cl_ppm || 0) > 500 ? C.red : C.dark }}>{pc.final_cl_ppm != null ? Number(pc.final_cl_ppm).toFixed(0) : "—"}</Text>
              <Text style={{ ...s.tableCellBold, width: "14%", textAlign: "right" }}>—</Text>
              <Text style={{ ...s.tableCellBold, width: "16%" }}>{stages.length} stages</Text>
            </View>
          )}
        </>
      )}

      {/* Spec compliance axis */}
      {sc && (
        <View style={{ ...s.callout, borderLeftColor: AXIS_VERDICT_COLOR[sc.verdict] || C.light, backgroundColor: C.headerBg, marginTop: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>Product Spec Compliance</Text>
            <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[sc.verdict] || C.dark }}>
              {(sc.verdict || "").replace(/_/g, " ").toUpperCase()}
            </Text>
          </View>
          {sc.basis && <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4 }}>{sc.basis}</Text>}
          {sc.gaps && sc.gaps.length > 0 && sc.gaps.map((g, i) => (
            <Text key={i} style={{ fontSize: 7.5, color: C.amber, marginTop: 2 }}>Gap: {g}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Section 07: Regulatory & Compliance ─────────────────────

function RegulatoryAndCompliance({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  return (
    <View break>
      <SectionHeader number="SECTION 07" title="Regulatory & Compliance Pathway" />
      <Paragraphs text={narratives.regulatory_and_compliance} />

      {brief.regulatory_summary && (
        <Callout color={C.blue} bgColor={C.blueBg} label="REGULATORY SUMMARY" text={brief.regulatory_summary} />
      )}

      {((b.regulatory_key_standards as string[] | undefined)?.length ?? 0) > 0 && (
        <>
          <Text style={s.subsectionTitle}>Applicable Standards & Codes</Text>
          {(b.regulatory_key_standards as string[]).slice(0, 10).map((std, i) => (
            <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 2, paddingLeft: 6 }}>• {std}</Text>
          ))}
        </>
      )}
    </View>
  );
}

// ── Section 08: Safety & Risk ───────────────────────────────

function SafetyAndRisk({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  const redFlags = brief.red_flags_triggered || [];

  return (
    <View break>
      <SectionHeader number="SECTION 08" title="Safety & Risk Assessment" />
      <Paragraphs text={narratives.safety_and_risk} />

      {(b.safety_top_hazard || b.safety_risk_tier) && (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
          {b.safety_risk_tier && (
            <MetricCard label="RISK TIER" value={b.safety_risk_tier} color={b.safety_risk_tier === "low" ? C.teal : b.safety_risk_tier === "medium" ? C.amber : C.red} />
          )}
          {b.safety_top_hazard && (
            <View style={{ flex: 2 }}>
              <Callout color={C.amber} bgColor={C.amberBg} label="PRIMARY HAZARD" text={b.safety_top_hazard} />
            </View>
          )}
        </View>
      )}

      {b.safety_safe_fail_summary && (
        <>
          <Text style={s.subsectionTitle}>Safe-Fail Analysis</Text>
          <Paragraphs text={b.safety_safe_fail_summary} />
        </>
      )}

      {/* Red flags */}
      {redFlags.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Triggered Risk Flags</Text>
          <Text style={{ fontSize: 8.5, color: C.mid, marginBottom: 6 }}>
            {brief.unresolved_red_flag_count ?? redFlags.filter(f => f.status === "unresolved").length} unresolved, {brief.blocker_red_flag_count ?? 0} blocking.
          </Text>
          {redFlags.slice(0, 8).map((flag, i) => {
            const isBlocker = flag.severity === "blocker";
            return (
              <View key={i} style={{ marginBottom: 6, paddingLeft: 6 }} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 1 }}>
                  <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: isBlocker ? C.red : C.amber, width: 55 }}>
                    [{flag.severity.toUpperCase()}]
                  </Text>
                  <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.dark, flex: 1 }}>
                    {flag.key.replace(/_/g, " ")}
                  </Text>
                  <Text style={{ fontSize: 7, color: flag.status === "cleared" ? C.teal : C.light }}>
                    {flag.status}
                  </Text>
                </View>
                {flag.trigger_basis && (
                  <Text style={{ fontSize: 8, color: C.mid, paddingLeft: 55, lineHeight: 1.4 }}>{flag.trigger_basis}</Text>
                )}
              </View>
            );
          })}
        </>
      )}

      {/* Rationalization checks */}
      {(brief.rationalization_checks || []).length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Technical Consistency Checks</Text>
          {brief.rationalization_checks!.slice(0, 6).map((rc, i) => {
            const statusColor = rc.status === "refuted" ? C.red : rc.status === "supported" ? C.teal : C.amber;
            return (
              <View key={i} style={{ marginBottom: 4, paddingLeft: 6 }} wrap={false}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: statusColor, width: 80 }}>
                    Check {i + 1}
                  </Text>
                  <Text style={{ fontSize: 8, color: C.dark, flex: 1 }}>"{rc.pattern}"</Text>
                </View>
                {rc.trigger_basis && (
                  <Text style={{ fontSize: 7.5, color: C.mid, paddingLeft: 80 }}>{rc.trigger_basis}</Text>
                )}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

// ── Section 09: Environmental Impact ────────────────────────

function EnvironmentalImpact({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  if (!narratives.environmental_impact && !b.environmental_ghg_gco2e_per_kwh) return null;

  return (
    <View break>
      <SectionHeader number="SECTION 09" title="Environmental Impact Assessment" />
      <Paragraphs text={narratives.environmental_impact} />

      {(b.environmental_ghg_gco2e_per_kwh != null || b.environmental_incumbent_delta_pct != null) && (
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 10 }}>
          {b.environmental_ghg_gco2e_per_kwh != null && (
            <MetricCard label="GHG INTENSITY" value={`${Number(b.environmental_ghg_gco2e_per_kwh).toFixed(0)} gCO₂e/kWh`} color={C.dark} />
          )}
          {b.environmental_incumbent_delta_pct != null && (
            <MetricCard
              label="VS INCUMBENT"
              value={`${Number(b.environmental_incumbent_delta_pct) > 0 ? "+" : ""}${Number(b.environmental_incumbent_delta_pct).toFixed(0)}%`}
              color={Number(b.environmental_incumbent_delta_pct) <= 0 ? C.teal : C.red}
              bgColor={Number(b.environmental_incumbent_delta_pct) <= 0 ? C.tealBg : C.redBg}
            />
          )}
        </View>
      )}

      {b.environmental_top_burden_shift && (
        <Callout color={C.amber} bgColor={C.amberBg} label="BURDEN SHIFT RISK" text={b.environmental_top_burden_shift} />
      )}
    </View>
  );
}

// ── Section 10: System Integration & Strategic Value ────────

function SystemIntegrationAndStrategy({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const b = brief as any;
  const fi = b.founder_insights || {};
  if (!narratives.system_integration && !narratives.strategic_value) return null;

  return (
    <View break>
      <SectionHeader number="SECTION 10" title="System Integration & Strategic Value" />

      {narratives.system_integration && (
        <>
          <Text style={s.subsectionTitle}>System Integration Assessment</Text>
          <Paragraphs text={narratives.system_integration} />
        </>
      )}

      {narratives.strategic_value && (
        <>
          <Text style={s.subsectionTitle}>Strategic Differentiation & Novelty</Text>
          <Paragraphs text={narratives.strategic_value} />
        </>
      )}

      {fi.technology_identity && (
        <Callout color={C.teal} bgColor={C.tealBg} label="TECHNOLOGY IDENTITY" text={fi.technology_identity} />
      )}

      {fi.weakest_claim && (
        <Callout color={C.red} bgColor={C.redBg} label="WEAKEST SIGNAL" text={fi.weakest_claim} />
      )}
    </View>
  );
}

// ── Section 11: Recommendations ─────────────────────────────

function Recommendations({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  const actions = brief.next_actions || [];
  const fi = (brief as any).founder_insights || {};

  return (
    <View break>
      <SectionHeader number="SECTION 11" title="Recommendations & De-Risking Pathway" />
      <Paragraphs text={narratives.recommendations} />

      {fi.highest_value_next_action && (
        <Callout color={C.teal} bgColor={C.tealBg} label="HIGHEST-VALUE ACTION" text={fi.highest_value_next_action} />
      )}

      {actions.length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Prioritized Action Items</Text>
          {actions.map((item, i) => (
            <View key={i} style={s.numberedRow}>
              <Text style={s.numberedNum}>{i + 1}.</Text>
              <Text style={s.numberedText}>{item}</Text>
            </View>
          ))}
        </>
      )}

      {/* Veto concerns */}
      {brief.veto_modules_clear === false && (brief.veto_concerns || []).length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Callout color={C.red} bgColor={C.redBg} label="VETO-CLASS REQUIREMENTS — MUST BE RESOLVED BEFORE DEPLOYMENT DECISION" text={(brief.veto_concerns || []).join(". ")} />
        </View>
      )}
    </View>
  );
}

// ── Conclusion ──────────────────────────────────────────────

function ConclusionSection({ brief }: {
  brief: DeviceDecisionBrief;
}) {
  const tier = tierLabel(brief);
  const tierColor = TIER_COLORS[brief.readiness_tier] || C.dark;

  return (
    <View style={{ marginTop: 18, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 4, backgroundColor: TIER_BG[brief.readiness_tier] || C.headerBg, borderWidth: 0.75, borderColor: tierColor }}>
      <Text style={{ fontSize: 7.5, color: C.light, letterSpacing: 0.5, marginBottom: 3 }}>OVERALL ASSESSMENT</Text>
      <Text style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: tierColor }}>{tier}</Text>
      <Text style={{ fontSize: 8, color: C.mid, marginTop: 4 }}>
        Composite Score: {formatCompositeScore(brief.composite_score)}/100 — {brief.modules_passing ?? 0} of {(brief.module_summary || []).length} modules passing — {brief.veto_modules_clear ? "No veto concerns" : `${(brief.veto_concerns || []).length} veto concern(s)`}
      </Text>
    </View>
  );
}

// ── Appendix A: Module Scorecards ───────────────────────────

function ModuleScorecardsAppendix({ brief, evaluation }: {
  brief: DeviceDecisionBrief; evaluation?: Record<string, unknown>;
}) {
  const modules = (brief.module_summary || []) as ModuleVerdictSummary[];
  const evalMods = (evaluation?.module_evaluations || {}) as Record<string, Record<string, unknown>>;
  if (!modules.length) return null;

  return (
    <View break>
      <Text style={s.appendixTitle}>Appendix A: Detailed Module Scorecards</Text>
      <Text style={s.appendixCaption}>
        Each of the ten evaluation dimensions is assessed independently. Four dimensions — Physics,
        Safety, Regulatory, and Environmental — operate as veto-class gates. A technology must clear
        each before a deployment recommendation is issued regardless of performance on other dimensions.
      </Text>

      {/* Summary table */}
      <View style={s.tableHeader}>
        <Text style={{ ...s.tableCellBold, width: "25%" }}>Module</Text>
        <Text style={{ ...s.tableCellBold, width: "13%" }}>Verdict</Text>
        <Text style={{ ...s.tableCellBold, width: "12%", textAlign: "right" }}>Confidence</Text>
        <Text style={{ ...s.tableCellBold, width: "12%", textAlign: "right" }}>Coverage</Text>
        <Text style={{ ...s.tableCellBold, width: "8%", textAlign: "center" }}>Veto</Text>
        <Text style={{ ...s.tableCellBold, width: "30%" }}>Key Finding</Text>
      </View>
      {modules.map((m, i) => {
        const dotColor = verdictColor(m.verdict);
        const finding = clientFacingFinding(m.key_detail || "");
        return (
          <View key={i} style={s.tableRow} wrap={false}>
            <View style={{ width: "25%", flexDirection: "row", alignItems: "center" }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: dotColor, marginRight: 4 }} />
              <Text style={{ fontSize: 8, color: C.dark }}>{MODULE_SHORT[m.module_name] || m.module_name}</Text>
            </View>
            <Text style={{ ...s.tableCell, width: "13%", color: dotColor, fontFamily: "Helvetica-Bold" }}>{m.verdict || "—"}</Text>
            <Text style={{ ...s.tableCell, width: "12%", textAlign: "right" }}>{m.confidence != null ? `${(Number(m.confidence) * 100).toFixed(0)}%` : "—"}</Text>
            <Text style={{ ...s.tableCell, width: "12%", textAlign: "right" }}>{m.evidence_coverage || "—"}</Text>
            <Text style={{ ...s.tableCell, width: "8%", textAlign: "center", color: m.is_veto ? C.red : C.light }}>{m.is_veto ? "Yes" : "—"}</Text>
            <Text style={{ ...s.tableCell, width: "30%", fontSize: 7 }}>{finding.slice(0, 80)}</Text>
          </View>
        );
      })}

      {/* Per-module gate results */}
      {modules.map((m, i) => {
        const modKey = (m.module_name || "").toLowerCase().replace(/[^a-z]/g, "_").replace(/__+/g, "_");
        const evalMod = evalMods[modKey] || {};
        const gates = ((evalMod.gate_results || []) as Array<Record<string, unknown>>)
          .filter(isClientFacingGateResult);
        const finding = clientFacingFinding(m.key_detail || "");
        if (!gates.length && !finding) return null;

        return (
          <View key={i} style={{ marginTop: 10, marginBottom: 4 }} wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: verdictColor(m.verdict), marginRight: 4 }} />
              <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark }}>
                {MODULE_NAMES[m.module_name] || m.module_name}
              </Text>
              <Text style={{ fontSize: 7.5, color: C.mid, marginLeft: 8 }}>
                {m.verdict}{m.confidence != null ? ` • ${(Number(m.confidence) * 100).toFixed(0)}% confidence` : ""}
              </Text>
            </View>
            {finding && (
              <Text style={{ fontSize: 8, color: C.mid, paddingLeft: 9, marginBottom: 3, lineHeight: 1.4 }}>{finding}</Text>
            )}
            {gates.length > 0 && (
              <View style={{ paddingLeft: 9 }}>
                {gates.slice(0, 6).map((g, gi) => (
                  <Text key={gi} style={{ fontSize: 7, color: g.passed ? C.teal : C.red, marginBottom: 1 }}>
                    {g.passed ? "\u2713" : "\u2717"} {String(g.gate_name || "")}: {String(g.detail || "").slice(0, 120)}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}

      {/* 5-axis verdicts */}
      {(brief.technical_feasibility || brief.commercial_viability || brief.spec_compliance_axis || brief.scale_readiness_axis || brief.thermodynamic_quality) && (
        <>
          <Text style={{ ...s.subsectionTitle, marginTop: 16 }}>Structured Axis Verdicts</Text>
          {[
            { title: "Technical Feasibility", axis: brief.technical_feasibility },
            { title: "Commercial Viability", axis: brief.commercial_viability },
            { title: "Spec Compliance", axis: brief.spec_compliance_axis },
            { title: "Scale Readiness", axis: brief.scale_readiness_axis },
            { title: "Thermodynamic Quality", axis: brief.thermodynamic_quality },
          ].filter(a => a.axis?.verdict).map((a, i) => (
            <View key={i} style={{ marginBottom: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 3, backgroundColor: C.headerBg, borderLeftWidth: 2, borderLeftColor: AXIS_VERDICT_COLOR[a.axis!.verdict] || C.light }} wrap={false}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                <Text style={{ fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.dark }}>{a.title}</Text>
                <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: AXIS_VERDICT_COLOR[a.axis!.verdict] || C.dark }}>
                  {a.axis!.verdict.replace(/_/g, " ")}
                </Text>
              </View>
              {a.axis!.basis && <Text style={{ fontSize: 7.5, color: C.mid, lineHeight: 1.3 }}>{a.axis!.basis}</Text>}
              {a.axis!.delta_vs_benchmark && (
                <Text style={{ fontSize: 7, color: C.blue, marginTop: 2 }}>Delta: {a.axis!.delta_vs_benchmark}</Text>
              )}
            </View>
          ))}
        </>
      )}

      {/* Combined verdict */}
      {(brief.combined_verdict_label || brief.combined_verdict) && (
        <View style={{ marginTop: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 3, backgroundColor: C.blueBg, borderLeftWidth: 2.5, borderLeftColor: C.blue }}>
          <Text style={{ fontSize: 7.5, color: C.mid, marginBottom: 2, letterSpacing: 0.5 }}>COMBINED VERDICT (5-axis deterministic rule table)</Text>
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.blue }}>
            {brief.combined_verdict_label || brief.combined_verdict}
          </Text>
          {(brief.verdict_modifiers || []).length > 0 && (
            <Text style={{ fontSize: 7.5, color: C.mid, marginTop: 2 }}>
              Modifiers: {brief.verdict_modifiers!.map(m => m.replace(/_/g, " ")).join(", ")}
            </Text>
          )}
        </View>
      )}

      {/* Data gaps */}
      {((brief.ranked_gap_guidance || []) as unknown as Array<Record<string, unknown>>).length > 0 && (
        <>
          <Text style={{ ...s.subsectionTitle, marginTop: 14 }}>Highest-Impact Data Gaps</Text>
          {((brief.ranked_gap_guidance || []) as unknown as Array<Record<string, unknown>>).slice(0, 8).map((g, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 3, paddingLeft: 4 }} wrap={false}>
              <Text style={{ fontSize: 8, color: String(g.impact) === "critical" ? C.red : C.amber, width: 55 }}>[{String(g.impact || "medium")}]</Text>
              <Text style={{ fontSize: 8, color: C.dark, flex: 1, lineHeight: 1.3 }}>
                {String(g.parameter || "")}: {String(g.why_it_matters || "").slice(0, 160)}
                {g.typical_range ? ` (typical: ${g.typical_range})` : ""}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// ── Appendix B: Process Chain (extended) ────────────────────

function ProcessChainAppendix({ evaluation }: { evaluation?: Record<string, unknown> }) {
  const pc = (evaluation?.process_chain as Record<string, unknown>) || undefined;
  const stages = (pc?.stages || []) as Array<Record<string, unknown>>;
  if (!stages.length) return null;

  return (
    <View break>
      <Text style={s.appendixTitle}>Appendix B: Process Chain Analysis</Text>
      <Text style={s.appendixCaption}>
        Detailed stage-by-stage analysis of the conversion process including mass balance,
        energy flows, contaminant tracking, and identified improvement levers.
      </Text>

      {stages.map((st, i) => {
        const desc = st.description ? String(st.description) : "";
        const bottleneck = st.bottleneck ? String(st.bottleneck) : "";
        const lever = st.improvement_lever ? String(st.improvement_lever) : "";
        return (
          <View key={i} style={{ marginBottom: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 3, backgroundColor: C.headerBg, borderLeftWidth: 2, borderLeftColor: C.teal }} wrap={false}>
            <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 3 }}>
              Stage {Number(st.stage_number || i + 1)}: {String(st.stage_name || "")}
            </Text>
            {desc !== "" && (
              <Text style={{ fontSize: 8, color: C.mid, lineHeight: 1.4, marginBottom: 3 }}>{desc}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 3 }}>
              {st.mass_in_kg != null && <Text style={{ fontSize: 7.5, color: C.dark }}>Mass in: {Number(st.mass_in_kg).toFixed(0)} kg</Text>}
              {st.mass_out_kg != null && <Text style={{ fontSize: 7.5, color: C.dark }}>Mass out: {Number(st.mass_out_kg).toFixed(0)} kg</Text>}
              {st.stage_efficiency_pct != null && <Text style={{ fontSize: 7.5, color: C.dark }}>Efficiency: {Number(st.stage_efficiency_pct).toFixed(1)}%</Text>}
              {st.energy_loss_mj != null && <Text style={{ fontSize: 7.5, color: C.dark }}>Energy loss: {Number(st.energy_loss_mj).toFixed(0)} MJ</Text>}
            </View>
            {bottleneck !== "" && <Text style={{ fontSize: 7.5, color: C.amber }}>Bottleneck: {bottleneck}</Text>}
            {lever !== "" && <Text style={{ fontSize: 7.5, color: C.teal }}>Improvement: {lever}</Text>}
          </View>
        );
      })}
    </View>
  );
}

// ── Appendix C: Methodology ─────────────────────────────────

function MethodologyAppendix({ brief, narratives }: {
  brief: DeviceDecisionBrief; narratives: ReportNarratives;
}) {
  return (
    <View break>
      <Text style={s.appendixTitle}>Appendix C: Methodology & Evidence Basis</Text>
      <Text style={s.appendixCaption}>
        This section documents the assessment methodology, simulation credibility tier,
        and evidence basis for transparency and reproducibility.
      </Text>

      <Text style={s.subsectionTitle}>Assessment Framework</Text>
      <Text style={s.body}>
        This assessment was produced by Exergy Lab's deployment-readiness platform. Each technology
        is evaluated across ten independent dimensions: physics and causal validity, performance and
        durability, economics and finance evidence, safety and resilience, regulatory and permitting,
        manufacturing and supply chain, environmental and circularity, scalability and deployment,
        system integration, and novelty and strategic value.
      </Text>
      <Text style={s.body}>
        Four dimensions — physics, safety, regulatory, and environmental — operate as veto-class gates.
        A technology must clear each before a deployment recommendation proceeds, regardless of how
        favorably it scores on the other six. Each dimension includes explicit pass/fail gates,
        anti-gaming provisions, and calibrated confidence ceilings.
      </Text>

      {brief.credibility_tier && (
        <>
          <Text style={s.subsectionTitle}>Simulation Credibility</Text>
          <Text style={s.body}>
            This assessment carries a simulation credibility rating of {brief.credibility_tier}
            {" — "}
            {brief.credibility_tier === "C3" ? "calibrated simulation validated against published reference cases with quantified agreement metrics."
              : brief.credibility_tier === "C2" ? "provisional simulation with limited reference validation. Key parameters are estimated within published ranges but have not been verified against operational data from this specific technology."
              : brief.credibility_tier === "C1" ? "uncalibrated physics model. Results are directionally informative but should not be used for investment decisions without independent validation."
              : "baseline comparison without physics solver. Assessment is based on datasheet parameters and published benchmarks only."}
          </Text>
        </>
      )}

      {brief.evidence_strength && (
        <>
          <Text style={s.subsectionTitle}>Evidence Basis</Text>
          <Text style={s.body}>
            Evidence strength: {brief.evidence_strength}.
            {brief.literature_findings ? ` ${brief.literature_findings} literature sources were reviewed.` : ""}
          </Text>
        </>
      )}

      {brief.methodology_note && <Paragraphs text={brief.methodology_note} />}

      {narratives.evidence_quality_narrative && (
        <>
          <Text style={s.subsectionTitle}>Source Quality</Text>
          <Paragraphs text={narratives.evidence_quality_narrative} />
        </>
      )}

      {filterCaveats(brief.caveats || []).length > 0 && (
        <>
          <Text style={s.subsectionTitle}>Important Boundaries</Text>
          {filterCaveats(brief.caveats || []).map((item, i) => (
            <Text key={i} style={{ fontSize: 8.5, color: C.dark, marginBottom: 3, paddingLeft: 6 }}>
              {i + 1}. {item}
            </Text>
          ))}
        </>
      )}

      <Text style={{ ...s.body, marginTop: 12, fontStyle: "italic", fontSize: 8.5, color: C.light }}>
        This report is intended to supplement, not replace, domain-specific expert review.
        Investment and deployment decisions should incorporate independent technical,
        legal, and financial due diligence appropriate to the stage and scale of commitment.
      </Text>
    </View>
  );
}

// ── Appendix D: Alternatives ────────────────────────────────

function AlternativesAppendix({ recommendations }: { recommendations: RecommendationEntry[] }) {
  if (!recommendations?.length) return null;
  return (
    <View break>
      <Text style={s.appendixTitle}>Appendix D: Alternative Technologies</Text>
      <Text style={s.appendixCaption}>
        Related approaches identified during the assessment that may warrant parallel evaluation.
      </Text>
      {recommendations.map((rec, i) => (
        <View key={i} style={{ marginBottom: 14 }} wrap={false}>
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 4 }}>
            {rec.alternative_name}{rec.technology_family ? ` (${rec.technology_family})` : ""}
          </Text>
          {rec.rationale && <Text style={{ ...s.body, fontSize: 8.5 }}>{rec.rationale}</Text>}
          {rec.comparison_metric && (
            <View style={{ marginBottom: 6 }}>
              <View style={s.tableHeader}>
                <Text style={{ ...s.tableCellBold, width: "34%" }}>Comparison Metric</Text>
                <Text style={{ ...s.tableCellBold, width: "33%" }}>Assessed Technology</Text>
                <Text style={{ ...s.tableCellBold, width: "33%" }}>Alternative</Text>
              </View>
              <View style={s.tableRow}>
                <Text style={{ ...s.tableCell, width: "34%" }}>{rec.comparison_metric}</Text>
                <Text style={{ ...s.tableCell, width: "33%" }}>{rec.evaluated_value || "—"}</Text>
                <Text style={{ ...s.tableCell, width: "33%" }}>{rec.alternative_value || "—"}</Text>
              </View>
            </View>
          )}
          {rec.key_advantages?.length > 0 && (
            <View style={{ marginTop: 4 }}>
              <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: C.teal, marginBottom: 2 }}>Advantages:</Text>
              {rec.key_advantages.map((a, j) => (
                <Text key={j} style={{ fontSize: 8, color: C.dark, marginBottom: 1, paddingLeft: 6 }}>+ {a}</Text>
              ))}
            </View>
          )}
          {rec.key_tradeoffs?.length > 0 && (
            <View style={{ marginTop: 3 }}>
              <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: C.amber, marginBottom: 2 }}>Tradeoffs:</Text>
              {rec.key_tradeoffs.map((t, j) => (
                <Text key={j} style={{ fontSize: 8, color: C.dark, marginBottom: 1, paddingLeft: 6 }}>— {t}</Text>
              ))}
            </View>
          )}
          {rec.suggested_next_step && (
            <Text style={{ fontSize: 8, color: C.mid, marginTop: 3, fontStyle: "italic" }}>
              Suggested next step: {rec.suggested_next_step}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ── Appendix E: References ──────────────────────────────────

function ReferencesAppendix({ recommendations }: { recommendations: RecommendationEntry[] }) {
  const allCitations = (recommendations || []).flatMap((r) => r.citations || []).filter((c) => c.title);
  if (!allCitations.length) return null;
  const seen = new Set<string>();
  const unique = allCitations.filter((c) => {
    const key = c.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <View break>
      <Text style={s.appendixTitle}>Appendix E: References</Text>
      {unique.map((c, i) => (
        <Text key={i} style={s.citation}>
          [{i + 1}] {c.authors ? `${c.authors}. ` : ""}{c.title}{c.journal ? `. ${c.journal}` : ""}{c.year ? ` (${c.year})` : ""}{c.url ? `. ${c.url}` : ""}
        </Text>
      ))}
    </View>
  );
}

// ── Main Document ───────────────────────────────────────────

export function ReportDocument({
  brief,
  narratives,
  projectName: _projectName,
  generatedDate,
  logoSrc,
  evaluation,
}: ReportDocumentProps) {
  const recommendations = (brief.recommendations || []) as RecommendationEntry[];
  const date = generatedDate;

  return (
    <Document
      title={`${brief.commercial_name || brief.device_id} — Technology Assessment Report`}
      author="Exergy Lab"
      subject="Technology Deployment Readiness Assessment"
      creator="Exergy Lab Platform"
    >
      <CoverPage brief={brief} logoSrc={logoSrc} date={date} />

      <Page size="A4" style={s.page} wrap>
        <Footer brief={brief} date={date} />
        <TableOfContents brief={brief} />
      </Page>

      <Page size="A4" style={s.page} wrap>
        <Footer brief={brief} date={date} />

        <ExecutiveSummary brief={brief} narratives={narratives} />
        <TechnologyProfile brief={brief} narratives={narratives} evaluation={evaluation} />
        <TechnicalAnalysis brief={brief} narratives={narratives} evaluation={evaluation} />
        <ThermodynamicAssessment brief={brief} narratives={narratives} />
        <EconomicAssessment brief={brief} narratives={narratives} />
        <CommercialPositioning brief={brief} narratives={narratives} />
        <ManufacturingAndScale brief={brief} narratives={narratives} evaluation={evaluation} />
        <RegulatoryAndCompliance brief={brief} narratives={narratives} />
        <SafetyAndRisk brief={brief} narratives={narratives} />
        <EnvironmentalImpact brief={brief} narratives={narratives} />
        <SystemIntegrationAndStrategy brief={brief} narratives={narratives} />
        <Recommendations brief={brief} narratives={narratives} />
        <ConclusionSection brief={brief} />

        <ModuleScorecardsAppendix brief={brief} evaluation={evaluation} />
        <ProcessChainAppendix evaluation={evaluation} />
        <MethodologyAppendix brief={brief} narratives={narratives} />
        <AlternativesAppendix recommendations={recommendations} />
        <ReferencesAppendix recommendations={recommendations} />
      </Page>
    </Document>
  );
}
