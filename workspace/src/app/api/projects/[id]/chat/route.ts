/**
 * Project Chat — DeepSeek V4-Flash orchestration agent.
 */

export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { getStorage } from "@/lib/storage";
import { getEnvVar, callDeepSeekV3 } from "@/lib/backend";
import { formatCompositeScore } from "@/lib/canonical-score";
import {
  type InitialEvaluationProjectState,
} from "@/lib/initial-evaluation-guardrail";
import { summarizeChartability } from "@/lib/chartable-artifact";
import {
  renderDocumentEvidenceForPrompt,
  summarizeDocumentEvidence,
} from "@/lib/document-evidence";
import {
  buildPlatformOwnedActionResponse,
  buildPlatformOwnedPlanResponse,
  messageHasPlanRequest,
  reportEvidenceRequestsForStatus,
} from "@/lib/chat-evidence-fallback";
import { buildModelRoutedResponse } from "@/lib/model-router";
import { buildAgentOrchestratedResponse, buildAgentSafetyResponse } from "@/lib/agent-orchestrator";
import { buildGeneralDialogueResponse } from "@/lib/general-dialogue";
import { buildGroundedWorkspaceResponse } from "@/lib/grounded-dialogue";
import { buildWorkspaceAgentResponse } from "@/lib/workspace-agent";
import { sanitizeUserFacingAgentText } from "@/lib/agent-output";
import { appendAgentTrace } from "@/lib/agent-trace";
import { currentTurnAttachmentNames as currentTurnAttachmentNamesFromHistory } from "@/lib/agent-context-hygiene";
import type { Artifact, Project } from "@/lib/storage/types";

const TRUTHFULNESS_PROMPT_GUARDRAILS = [
  "Route each evaluation to the strongest available governed analysis path.",
  "Use bounded physics findings and solver status, not universal solver claims.",
  'Only the status of "ran" is solver-backed; render unavailable, validation_failed, dispatch_error, and not_registered as not computed.',
  "Use public vocabulary: calibrated simulation, engineering estimate, not computed, blocked, unavailable.",
  "Frame plans as an evidence-bounded diligence thesis unless source artifacts support stronger language.",
  "Never reference internal credibility tiers (C0-C3) in user-facing responses.",
].join(" ");

interface ProjectContextBundle {
  context: string;
  initialEvaluationState: InitialEvaluationProjectState;
}

function buildCurrentMarketPriceResponse(message: string): Record<string, unknown> | null {
  const text = message.toLowerCase();
  const asksSolarPanelPrice =
    /\bsolar\s+(?:panel|module)s?\b/.test(text) &&
    /\b(cheapest|lowest|best\s+price|price|cost|per\s*watt|\$\/w|buy\s+online|online|currently|current)\b/.test(text);
  if (!asksSolarPanelPrice) return null;

  return appendAgentTrace({
    type: "response",
    content: [
      "I should not name a single \"current cheapest\" SKU unless the system has live retailer price search connected, because panel listings, freight, minimum order quantity, and stock status change constantly.",
      "",
      "The useful rule of thumb is:",
      "- Lowest advertised module-only prices are usually large-format 400-600 W mono panels, surplus pallets, or clearance lots.",
      "- Before shipping, the low end is often roughly USD 0.20-0.35/W for new or surplus large modules.",
      "- For one or two panels shipped by parcel freight, the all-in delivered cost can be much higher, often closer to USD 0.40-0.80/W or more.",
      "- Used/refurbished panels can be cheaper per watt, but warranty, degradation, and compatibility risk matter.",
      "",
      "For a real purchasing answer, compare delivered USD/W, not list USD/W:",
      "`delivered USD/W = (panel price + freight + tax + required accessories) / rated watts`.",
      "",
      "If you give me links or screenshots from the retailers you are considering, I can rank the panels by delivered USD/W, efficiency, warranty, size, voltage/current compatibility, and availability.",
    ].join("\n"),
    suggested_followups: [
      "Rank these panel links by delivered USD/W",
      "What specs matter besides USD/W?",
      "Compare used vs new solar panels",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "current_retail_price_requires_live_inventory",
    },
  }, {
    stage: "chat_route",
    decision: "response",
    reason: "current_retail_price_requires_live_inventory",
    type: "response",
    action: null,
  });
}

function hasGate0ValidationIssue(content: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  if (metadata.gate0_validation_issue === true) {
    return true;
  }
  const issues = content.validation_issues;
  return Array.isArray(issues) && issues.some(
    (issue) => typeof issue === "string" && issue.startsWith("[Gate 0]"),
  );
}

function hasSuccessfulEvaluationContent(artifact: Artifact | null): boolean {
  if (!artifact || artifact.type !== "evaluation") {
    return false;
  }

  const content = artifact.content || {};
  const metadata = artifact.metadata || {};
  if (hasGate0ValidationIssue(content, metadata)) {
    return false;
  }
  if (
    content.run_state === "debug" &&
    content.verdict === "not_ready"
  ) {
    return false;
  }

  const brief = content.brief;
  const readinessTier =
    brief && typeof brief === "object" && !Array.isArray(brief)
      ? (brief as Record<string, unknown>).readiness_tier
      : undefined;
  const moduleEvaluations = content.module_evaluations;
  const hasModuleEvaluations =
    moduleEvaluations &&
    typeof moduleEvaluations === "object" &&
    !Array.isArray(moduleEvaluations) &&
    Object.keys(moduleEvaluations).length > 0;

  return typeof readinessTier === "string" || !!hasModuleEvaluations;
}

function artifactExtractionStatus(artifact: Artifact | null): InitialEvaluationProjectState["extractionStatus"] {
  if (!artifact || artifact.type !== "evaluation") {
    return "unknown";
  }

  const content = artifact.content || {};
  const metadata = artifact.metadata || {};
  const contentStatus = typeof content.extraction_status === "string" ? content.extraction_status : "";
  const metadataStatus = typeof metadata.extraction_status === "string" ? metadata.extraction_status : "";
  const evidenceMetadata =
    content.evidence_level_metadata &&
    typeof content.evidence_level_metadata === "object" &&
    !Array.isArray(content.evidence_level_metadata)
      ? content.evidence_level_metadata as Record<string, unknown>
      : {};
  const fused = Number(evidenceMetadata.n_parameters_fused ?? evidenceMetadata.n_parameters_extracted ?? NaN);
  const expected = Number(evidenceMetadata.n_parameters_expected ?? NaN);

  if (
    hasGate0ValidationIssue(content, metadata) ||
    contentStatus === "failed" ||
    metadataStatus === "failed" ||
    (
      content.run_state === "debug" &&
      content.verdict === "not_ready"
    )
  ) {
    return "failed";
  }

  if (
    contentStatus === "partial" ||
    metadataStatus === "partial" ||
    content.evidence_level === "partial" ||
    (Number.isFinite(fused) && Number.isFinite(expected) && fused < expected)
  ) {
    return "partial";
  }

  if (contentStatus === "complete" || metadataStatus === "complete") {
    return "complete";
  }

  return "unknown";
}

function mergeExtractionStatus(
  current: InitialEvaluationProjectState["extractionStatus"],
  next: InitialEvaluationProjectState["extractionStatus"],
): InitialEvaluationProjectState["extractionStatus"] {
  const rank = { failed: 4, partial: 3, unknown: 2, complete: 1, none: 0 };
  return rank[next || "unknown"] > rank[current || "none"] ? next : current;
}

function summarizeExportReadiness(args: {
  artifacts: Artifact[];
  evaluationArtifacts: Array<Artifact | null>;
  hasSuccessfulEvaluationArtifact: boolean;
  hasChartableArtifact: boolean;
  hasIndependentChartableArtifact: boolean;
}): Pick<InitialEvaluationProjectState, "extractionStatus" | "exportReadiness" | "reportEvidenceRequests"> {
  let extractionStatus: InitialEvaluationProjectState["extractionStatus"] = args.evaluationArtifacts.length > 0 ? "unknown" : "none";
  for (const artifact of args.evaluationArtifacts) {
    extractionStatus = mergeExtractionStatus(extractionStatus, artifactExtractionStatus(artifact));
  }

  if (extractionStatus === "failed") {
    return {
      extractionStatus,
      exportReadiness: args.hasIndependentChartableArtifact ? "conditionally_ready" : "blocked",
      reportEvidenceRequests: reportEvidenceRequestsForStatus("failed"),
    };
  }

  if (!args.hasSuccessfulEvaluationArtifact) {
    return {
      extractionStatus,
      exportReadiness: args.artifacts.length > 0 ? "conditionally_ready" : "blocked",
      reportEvidenceRequests: reportEvidenceRequestsForStatus(extractionStatus),
    };
  }

  if (extractionStatus === "partial" || !args.hasChartableArtifact) {
    return {
      extractionStatus,
      exportReadiness: "conditionally_ready",
      reportEvidenceRequests: reportEvidenceRequestsForStatus(extractionStatus),
    };
  }

  return {
    extractionStatus,
    exportReadiness: "ready",
    reportEvidenceRequests: [],
  };
}

async function buildProjectContext(projectId: string): Promise<ProjectContextBundle> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  if (!project) {
    return {
      context: "Project not found.",
      initialEvaluationState: {
        hasUploadedDocuments: false,
        hasSuccessfulEvaluationArtifact: false,
        hasChartableArtifact: false,
      },
    };
  }

  const artifacts = await storage.listArtifacts(projectId);
  const documents = await storage.listDocuments(projectId);
  const documentEvidence = summarizeDocumentEvidence(documents);

  const parts: string[] = [
    `PROJECT: "${project.name}"`,
    `DOMAIN: ${project.domain}`,
    `DESCRIPTION: ${project.description || "Not provided"}`,
    `GOAL: ${project.goal || "Not specified"}`,
    `DOCUMENTS: ${documents.length === 0 ? "None" : documents.map((d) => d.filename).join(", ")}`,
    `ARTIFACTS (${artifacts.length}):`,
    ...artifacts.map((a) => `  - [${a.type}] "${a.title}" (${a.source})`),
  ];

  const documentEvidenceLines = renderDocumentEvidenceForPrompt(documents);
  if (documentEvidenceLines.length > 0) {
    parts.push(
      "",
      "UPLOADED DOCUMENT EVIDENCE DIGEST (use these facts only with their source labels; do not invent missing values):",
      ...documentEvidenceLines,
    );
  }

  if (artifacts.filter(a => a.type === "simulation").length > 0) {
    parts.push("", "COMPLETED SIMULATIONS (do NOT duplicate these exact conditions):");
    for (const a of artifacts.filter(a => a.type === "simulation")) {
      parts.push(`  DONE: ${a.title}`);
    }
    parts.push("When asked 'what next', suggest NEW conditions not already tested.");
  }

  // Include detailed results for recent artifacts so agent can reference them.
  // First 12 get full detail, remaining get one-line summaries.
  // Load in parallel to avoid serial await latency (~400-800ms → ~100ms).
  const recentArts = artifacts.slice(0, 12);
  const fullArts = await Promise.all(
    recentArts.map((art) => storage.getArtifact(projectId, art.id))
  );
  const recentFullArtById = new Map(
    recentArts.map((art, idx) => [art.id, fullArts[idx]]),
  );
  const evaluationFullArts = await Promise.all(
    artifacts
      .filter((art) => art.type === "evaluation")
      .map((art) => recentFullArtById.get(art.id) || storage.getArtifact(projectId, art.id)),
  );
  const loadedFullArtifactsById = new Map<string, Artifact>();
  for (const artifact of [...fullArts, ...evaluationFullArts]) {
    if (artifact) loadedFullArtifactsById.set(artifact.id, artifact);
  }
  const chartability = summarizeChartability([...loadedFullArtifactsById.values()]);
  const independentChartability = summarizeChartability(
    [...loadedFullArtifactsById.values()].filter((artifact) => artifact.type !== "evaluation"),
  );
  const hasSuccessfulEvaluationArtifact = evaluationFullArts.some(hasSuccessfulEvaluationContent);
  const exportReadiness = summarizeExportReadiness({
    artifacts: [...loadedFullArtifactsById.values()],
    evaluationArtifacts: evaluationFullArts,
    hasSuccessfulEvaluationArtifact,
    hasChartableArtifact: chartability.hasChartableArtifact,
    hasIndependentChartableArtifact: independentChartability.hasChartableArtifact,
  });
  const initialEvaluationState: InitialEvaluationProjectState = {
    hasUploadedDocuments: documents.length > 0,
    hasSuccessfulEvaluationArtifact,
    hasChartableArtifact: chartability.hasChartableArtifact,
    hasAnyArtifact: artifacts.length > 0,
    domain: project.domain,
    documentEvidence,
    ...exportReadiness,
  };
  // One-line summaries for older artifacts (13+)
  if (artifacts.length > 12) {
    parts.push(`\nOLDER ARTIFACTS (${artifacts.length - 12} more — ask to see details):`);
    for (const a of artifacts.slice(12, 20)) {
      parts.push(`  - [${a.type}] "${a.title}" — ${a.summary?.slice(0, 80) || "no summary"}`);
    }
  }
  for (let idx = 0; idx < recentArts.length; idx++) {
    const art = recentArts[idx];
    const full = fullArts[idx];
    if (!full?.content) continue;
    parts.push(`\n[${art.type.toUpperCase()}] "${art.title}"`);
    // Lineage tracking
    if (full.parent_id) parts.push(`  Derived from: artifact ${full.parent_id}`);
    if (full.lineage_note) parts.push(`  Lineage: ${full.lineage_note}`);

    if (art.type === "simulation") {
      const domain = (full.metadata?.domain as string) || "battery";
      const s = full.content.summary as Record<string, unknown> | undefined;
      const p = full.content.params as Record<string, unknown> | undefined;
      if (s) {
        const metrics = Object.entries(s)
          .filter(([, v]) => typeof v === "number" || typeof v === "string")
          .slice(0, 10)
          .map(([k, v]) => `${k}=${typeof v === "number" ? Number(v).toFixed(2) : v}`);
        parts.push(`  Results: ${metrics.join(", ")}`);
      }
      if (p) {
        const params = Object.entries(p)
          .filter(([, v]) => v !== null && v !== undefined)
          .slice(0, 8)
          .map(([k, v]) => `${k}=${v}`);
        parts.push(`  Params: ${params.join(", ")}`);
      }
      const grades = full.content.grades as Array<Record<string, unknown>> | undefined;
      if (grades) {
        parts.push(`  Grades: ${grades.slice(0, 5).map(g => `${g.category}=${g.grade}`).join(", ")}`);
      }
      // CRITICAL: Include physics solver output metrics directly in agent context.
      // Without this, the agent hallucinates physics claims it never computed.
      const ps = full.content.physics_solver as Record<string, unknown> | undefined;
      if (ps) {
        const om = ps.output_metrics as Record<string, unknown> | undefined;
        if (om) {
          const solverMetrics = Object.entries(om)
            .filter(([, v]) => typeof v === "number")
            .slice(0, 25)
            .map(([k, v]) => `${k}=${(v as number).toFixed(4)}`);
          parts.push(`  PHYSICS SOLVER OUTPUT (computed, not estimated):`);
          parts.push(`    ${solverMetrics.join(", ")}`);
        }
        const assumptions = ps.solver_assumptions as string[] | undefined;
        if (assumptions) {
          parts.push(`  SOLVER ASSUMPTIONS: ${assumptions.slice(0, 5).join("; ")}`);
        }
        const unmodeled = ps.unmodeled_phenomena as string[] | undefined;
        if (unmodeled) {
          parts.push(`  UNMODELED PHENOMENA (${unmodeled.length} items): ${unmodeled.slice(0, 4).join(", ")}...`);
        }
        parts.push(`  SOLVER: family=${ps.family || "unknown"}, version=${ps.solver_version || "unknown"}, uncertainty_tier=${(om as Record<string, unknown>)?.uncertainty_tier || "unknown"}`);
      }
    }
    if (art.type === "research") {
      const exec = full.content.executive_summary as string;
      if (exec) parts.push(`  Summary: ${exec.slice(0, 300)}`);
      const findings = full.content.findings as Array<Record<string, unknown>> | undefined;
      if (findings) {
        parts.push(`  ${findings.length} findings:`);
        for (const f of findings.slice(0, 3)) {
          parts.push(`    - ${(f.statement as string || "").slice(0, 100)} [${f.source || "?"}]`);
        }
      }
    }
    if (art.type === "evaluation") {
      const mods = full.content.module_evaluations as Record<string, Record<string, unknown>> | undefined;
      const brief = full.content.brief as Record<string, unknown> | undefined;
      const evidenceLevel = full.content.evidence_level as string;
      if (evidenceLevel) parts.push(`  Evidence level: ${evidenceLevel}`);
      if (mods) {
        parts.push(`  Modules:`);
        for (const [n, m] of Object.entries(mods)) {
          const details = m.details as Record<string, unknown> | undefined;
          const ec = details?.evidence_coverage as number | undefined;
          const ecm = details?.evidence_params_matched as number | undefined;
          const ece = details?.evidence_params_expected as number | undefined;
          const conf = m.confidence_0_1 as number | undefined;
          const covStr = (ecm !== undefined && ece !== undefined) ? ` [${ecm}/${ece} params]` : "";
          const confStr = (conf && typeof conf === "number") ? ` conf=${Math.round(conf * 100)}%` : "";
          parts.push(`    ${n}: ${m.verdict}${covStr}${confStr}`);
          const deltas = details?.value_deltas as Array<Record<string, unknown>> | undefined;
          if (deltas && deltas.length > 0) {
            for (const d of deltas.slice(0, 2)) {
              parts.push(`      ${d.param}: ${d.user} vs baseline ${d.baseline} (${d.quality})`);
            }
          }
        }
      }
      if (brief) {
        const strengths = (brief.key_strengths as string[]) || [];
        const concerns = (brief.key_concerns as string[]) || [];
        const credTier = brief.credibility_tier as string;
        const methNote = brief.methodology_note as string;
        const readiness = brief.readiness_tier as string;
        const compScore = brief.composite_score as number;
        // CC-BE-0113b: composite_score is on 0-100 scale at the schema
        // boundary; use the canonical formatter so the chat prompt
        // sees the same value the PDF / gauge / JSON present.
        if (readiness) parts.push(`  Readiness: ${readiness} (score ${typeof compScore === "number" ? formatCompositeScore(compScore, "inline") : "?"})`);
        // CC-BE-GOV-0108: emit the public methodology vocabulary only
        // ("calibrated simulation" / "engineering estimate" / "not computed" /
        // "blocked" / "unavailable"); internal tier labels stay internal.
        if (credTier) {
          const methodology =
            credTier === "C3" ? "calibrated simulation"
              : credTier === "C2" ? "calibrated simulation (provisional)"
                : credTier === "C1" ? "engineering estimate"
                  : "not solver-backed";
          parts.push(`  Methodology: ${methodology}`);
        }
        if (strengths.length) parts.push(`  Strengths: ${strengths.slice(0, 3).join("; ")}`);
        if (concerns.length) parts.push(`  Concerns: ${concerns.slice(0, 3).join("; ")}`);
        // Baseline comparisons — user values vs published baselines
        const baselines = (brief.baseline_comparisons as Array<Record<string, unknown>>) || [];
        if (baselines.length > 0) {
          parts.push(`  Baseline comparisons (${baselines.length}):`);
          for (const bc of baselines.slice(0, 6)) {
            parts.push(`    ${bc.parameter}: your value ${bc.your_value} vs baseline ${bc.baseline_value} → ${bc.position} (${bc.assessment})`);
          }
        }
        // Evidence coverage per module
        const coverage = (brief.evidence_coverage_summary as Record<string, Record<string, unknown>>) || {};
        const covEntries = Object.entries(coverage);
        if (covEntries.length > 0) {
          const covParts = covEntries.map(([mod, c]) => `${mod}:${c.params_matched}/${c.params_expected}`);
          parts.push(`  Evidence coverage: ${covParts.join(", ")}`);
          // Extraction completeness summary for agent awareness
          const totalMatched = covEntries.reduce((sum, [, c]) => sum + (Number(c.params_matched) || 0), 0);
          const totalExpected = covEntries.reduce((sum, [, c]) => sum + (Number(c.params_expected) || 0), 0);
          if (totalExpected > 0) {
            parts.push(`  EXTRACTION COMPLETENESS: ${totalMatched} of ${totalExpected} parameters assessed (${Math.round(totalMatched / totalExpected * 100)}%)`);
            if (totalMatched < 3) {
              parts.push(`  ⚠ WEAK EXTRACTION — fewer than 3 parameters assessed. Suggest the user provide key values manually.`);
            }
          }
        }
        // Ranked gap guidance — what to provide next
        const gaps = (brief.ranked_gap_guidance as Array<Record<string, unknown>>) || [];
        if (gaps.length > 0) {
          parts.push(`  Top gaps to address:`);
          for (const g of gaps.slice(0, 5)) {
            const range = g.typical_range ? ` (${g.typical_range})` : "";
            parts.push(`    [${g.impact}] ${g.parameter}${range}: ${g.why_it_matters}`);
          }
        }
        if (methNote) parts.push(`  Methodology: ${(methNote as string).slice(0, 150)}`);
      }
      // Literature context and evidence claims (from academic search + web intake)
      const litCtx = full.content.literature_context as Array<Record<string, unknown>> | undefined;
      if (litCtx && litCtx.length > 0) {
        parts.push(`  Academic literature (${litCtx.length} papers):`);
        for (const p of litCtx.slice(0, 4)) {
          parts.push(`    - ${(p.title as string)?.slice(0, 80)} (${p.year}, cited: ${p.cited_by})`);
        }
      }
      const allClaims = full.content.all_claims as Array<Record<string, unknown>> | undefined;
      if (allClaims && allClaims.length > 0) {
        const highConf = allClaims.filter(cl => (cl.confidence as number) >= 0.5);
        parts.push(`  Evidence claims: ${allClaims.length} total (${highConf.length} high-confidence)`);
        for (const cl of highConf.slice(0, 3)) {
          parts.push(`    - [${cl.claim_type}] ${(cl.statement as string)?.slice(0, 100)}`);
        }
      }
      const evMeta = full.content.evidence_level_metadata as Record<string, unknown> | undefined;
      if (evMeta) {
        const nFused = evMeta.n_parameters_fused as number;
        const nPapers = evMeta.n_academic_papers as number;
        const nClaims = evMeta.n_claims_aggregated as number;
        if (nFused || nPapers || nClaims) {
          parts.push(`  Evidence pipeline: ${nFused || 0} params fused, ${nPapers || 0} academic papers, ${nClaims || 0} claims gathered`);
        }
      }
    }
  }

  return {
    context: parts.join("\n"),
    initialEvaluationState,
  };
}

function hasUnsupportedSparseStateClaims(content: string, state: InitialEvaluationProjectState): boolean {
  if (state.hasUploadedDocuments || state.hasAnyArtifact) return false;
  const text = content.toLowerCase();
  return [
    /\b(?:we|i)\s+(?:could\s+only\s+)?(?:extracted?|found|measured|computed|modeled|calculated|validated|assessed)\b/,
    /\bwe\s+have\s+strong\s+(?:physics|performance|technical|economics?|manufacturing|safety)\b/,
    /\byour\s+(?:document|file|upload|uploaded|claim|claimed|provided)\b/,
    /\byour\s+\d+(?:\.\d+)?\s*%/,
    /\b(?:extracted|assessed)\s+\d+\s+of\s+\d+\b/,
    /\bclaimed\s+\d+(?:\.\d+)?\s*%/,
    /\b(?:physics|safety|economics|manufacturing|module)\s+(?:module\s+)?(?:passed|failed)\b/,
  ].some((pattern) => pattern.test(text));
}

function buildSparseStateRepairResponse(): string {
  return [
    "I cannot make project-specific evidence claims from the current workspace because there are no uploaded documents and no saved artifacts to cite.",
    "",
    "What is known: only the project description is available. Solver results, extracted parameters, module pass/fail status, benchmark deltas, and numeric performance claims are not computed.",
    "",
    "To make this client-readable without inventing facts, provide source documents or measured values with units, operating basis, validation/test results, and benchmark sources. I can then separate verified facts, assumptions, and open evidence gaps.",
  ].join("\n");
}

function caveatsEntireUnsupportedMaturitySentence(sentence: string): boolean {
  if (/^\s*(?:(?:we|i|the team|the authors?|the report|this report|this document)\s+(?:do not|don't|cannot|can't|will not|won't|do not yet)\s+claim\b|(?:do not|don't|must not|should not|cannot|can't|not yet|without|until|pending|required|requires?|blocked|unavailable|unsupported)\b)/i.test(sentence)) {
    return true;
  }
  return false;
}

function hasLocalMaturityCaveat(sentence: string, matchOffset: number): boolean {
  if (caveatsEntireUnsupportedMaturitySentence(sentence)) return true;
  const prefix = sentence.slice(0, matchOffset).toLowerCase();
  const boundaryTokens = [",", ";", ".", " but ", " and "];
  let start = Math.max(0, matchOffset - 60);
  for (const token of boundaryTokens) {
    const idx = prefix.lastIndexOf(token);
    if (idx >= 0) start = Math.max(start, idx + token.length);
  }
  const local = prefix.slice(start);
  return /\b(?:do not claim|don't claim|cannot be called|cannot yet be called|not yet|must not be called|should not be called|do not call|we cannot call|will not be claimed)\b/.test(local);
}

const UNSUPPORTED_PROVIDER_CLAIM_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /(?:\b(?:bankable|bankability|project[-\s]?finance[-\s]?ready|lender[-\s]?ready|finance[-\s]?ready|investment[-\s]?grade|investor[-\s]?grade returns?|guaranteed ROI)\b|IRR\s+(?:of|above|over|greater than)\s+\d+(?:\.\d+)?\s*%)/gi,
    replacement: "Bankability and finance readiness are not established without sourced CAPEX, OPEX, utilization, revenue, financing, offtake, and operating-history evidence.",
  },
  {
    pattern: /\b(?:decision[-\s]?grade|customer[-\s]?ready|deployment[-\s]?ready|investment[-\s]?ready|production[-\s]?grade|commercially ready|commercial readiness|external[-\s]?ready)\b/gi,
    replacement: "The current workspace supports bounded diligence only; it does not establish decision-grade, deployment-ready, or external-ready status.",
  },
  {
    pattern: /\b(?:solver[-\s]?backed|solver[-\s]?validated|physics[-\s]?solver confirmed|exergy[-\s]?solver validated|calibrated simulation|validated by simulation|simulation[-\s]?validated|physics proven)\b/gi,
    replacement: "Solver-backed validation is not established unless a structured solver run completed successfully and durable solver artifacts are present.",
  },
  {
    pattern: /\b(?:exergy[-\s]?validated|validated exergy|computed exergy|exergy computation confirms|exergy[-\s]?optimal|second[-\s]?law[-\s]?optimal|thermodynamically optimal)\b/gi,
    replacement: "Exergy validation is not established unless computed exergy status and durable solver-backed artifact support are present.",
  },
  {
    pattern: /\b(?:lifecycle[-\s]?(?:positive|benefit|validated|ready|certified)|cradle[-\s]?to[-\s]?grave validated|fully recyclable|(?:validated|proven)\s+lifecycle\s+benefit|carbon[-\s]?negative)\b/gi,
    replacement: "Lifecycle benefit is not established without sourced boundary conditions, baseline assumptions, emissions factors, allocation method, and uncertainty treatment.",
  },
  {
    pattern: /\b(?:regulatory[-\s]?(?:ready|cleared|approved)|NRC[-\s]?approved|FAA[-\s]?certified|CE[-\s]?marked|UL[-\s]?listed|GRAS|FDA[-\s]?approved|permit[-\s]?ready|permitting[-\s]?ready|certified(?:\s+for\s+deployment)?)\b/gi,
    replacement: "Regulatory readiness is not established without jurisdiction, applicable codes, permitting pathway, required approvals, and compliance evidence.",
  },
  {
    pattern: /\b(?:manufacturing[-\s]?(?:ready|scalable|validated)|mass[-\s]?produced|commercial[-\s]?scale manufacturing|production[-\s]?ready|TRL\s*9|factory[-\s]?ready|supply[-\s]?chain[-\s]?ready|scale[-\s]?ready)\b/gi,
    replacement: "Manufacturing scalability is not established without bill of materials, process route, yield, capacity, supplier, QA, and scale-up evidence.",
  },
];

function sanitizeUnsupportedProviderMaturityClaims(content: string): {
  content: string;
  sanitized: boolean;
} {
  const sentencePattern = /(?:^|(?<=[.!?]\s))[^.!?\n]*(?:[.!?]|$)/g;
  let rewroteClaim = false;
  const sanitized = content.replace(sentencePattern, (sentence) => {
    for (const repair of UNSUPPORTED_PROVIDER_CLAIM_REPAIRS) {
      repair.pattern.lastIndex = 0;
      const match = repair.pattern.exec(sentence);
      if (match) {
        if (hasLocalMaturityCaveat(sentence, match.index)) return sentence;
        rewroteClaim = true;
        return repair.replacement;
      }
    }
    return sentence;
  });
  if (!rewroteClaim) {
    return { content, sanitized: false };
  }
  return { content: sanitized, sanitized: sanitized !== content };
}

function unwrapProviderText(raw: string): { text: string; providerReturnedBlankContent: boolean } {
  let text = raw.trim();
  let providerReturnedBlankContent = false;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { content?: unknown; response?: { content?: unknown } };
      const unwrapped: unknown =
        typeof parsed.content === "string"
          ? parsed.content
          : typeof parsed.response?.content === "string"
            ? parsed.response.content
            : undefined;
      if (typeof unwrapped === "string") {
        text = unwrapped.trim();
        providerReturnedBlankContent = text.length === 0;
      }
    } catch {
      // Keep raw text when it only looks like JSON.
    }
  }
  return { text, providerReturnedBlankContent };
}

function repairPlainTextResponse(args: {
  response: Record<string, unknown>;
  state: InitialEvaluationProjectState;
  fallback: { message: string; project: Project | null | undefined; projectDomain: string; history?: Array<{ role: string; content: string }> };
}): Record<string, unknown> {
  const response = { ...args.response };
  const raw = typeof response.content === "string" ? response.content : "";
  const normalized = unwrapProviderText(raw);
  let content = normalized.text;
  let responseRepair = response.response_repair && typeof response.response_repair === "object"
    ? response.response_repair as Record<string, unknown>
    : null;

  if (!content.trim() && normalized.providerReturnedBlankContent) {
    content = buildProviderFailureAdvisoryResponse(args.fallback).content as string;
    responseRepair = {
      ...(responseRepair || {}),
      reason: "blank_model_content",
    };
  }

  if (hasUnsupportedSparseStateClaims(content, args.state)) {
    content = buildSparseStateRepairResponse();
    responseRepair = {
      ...(responseRepair || {}),
      reason: "sparse_state_unsupported_claims",
    };
  }

  const claimRepair = sanitizeUnsupportedProviderMaturityClaims(content);
  if (claimRepair.sanitized) {
    content = claimRepair.content;
    responseRepair = {
      ...(responseRepair || {}),
      unsupported_maturity_claims: true,
    };
  }

  response.content = sanitizeUserFacingAgentText(content);
  if (responseRepair) {
    response.response_repair = responseRepair;
  }
  return response;
}

function clientSubjectForProviderFallback(project: Project | null | undefined, domain: string): string {
  const description = typeof project?.description === "string" ? project.description.trim() : "";
  if (description) {
    const firstSentence = description.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 260) return firstSentence;
    return description.slice(0, 260).trim().replace(/\s+\S*$/, "");
  }
  const name = typeof project?.name === "string" ? project.name.trim() : "";
  if (name) return name;
  return (domain || "the technology").replace(/_/g, " ");
}

function audienceForProviderFallback(message: string, history: Array<{ role: string; content: string }> | undefined): string {
  const text = [message, ...(history || []).slice(-6).map((entry) => entry.content)].join(" ");
  if (/\b(customer|client|buyer|counterparty)\b/i.test(text)) return "customer-safe diligence";
  if (/\b(lender|bank|debt|project\s+finance|bankability|bankable)\b/i.test(text)) return "lender or bankability diligence";
  if (/\b(investor|investment|memo|fundraise|board)\b/i.test(text)) return "investor diligence";
  if (/\b(ceo|executive|leadership)\b/i.test(text)) return "executive decision support";
  if (/\b(chart|graph|plot|visuali[sz]ation|dashboard)\b/i.test(text)) return "chart planning";
  if (/\b(report|export|brief|packet|deck)\b/i.test(text)) return "report planning";
  return "diligence";
}

function buildProviderFailureAdvisoryResponse(args: {
  message: string;
  project: Project | null | undefined;
  projectDomain: string;
  history?: Array<{ role: string; content: string }>;
}): Record<string, unknown> {
  const subject = clientSubjectForProviderFallback(args.project, args.projectDomain).replace(/[.!?]\s*$/, "");
  const audience = audienceForProviderFallback(args.message, args.history);
  const request = args.message.trim();
  return {
    type: "response",
    content: [
      `Useful takeaway: I can still move the ${audience} forward from the information currently available.`,
      `Current context: ${subject}.`,
      `Your request: ${request}`,
      "What can be said now: treat the current material as a diligence framing point. It can define the question, the intended audience, and the evidence needed next, but it should not be treated as a new calculation, benchmark comparison, or externally shareable conclusion.",
      "What I would avoid claiming yet: verified performance, computed economics, financing readiness, physics validation, numeric charts, benchmark advantage, or customer proof unless those claims already appear in source evidence.",
      "Highest-value next evidence: measured values from test logs with units and operating conditions; source tables for cost, utilization, revenue, and incumbent baseline; system-boundary and thermodynamic state data for physics or exergy claims; validation reports; and customer or lender requirements tied to the target use case.",
      "Recommended next action: use this as a short data-room request, add the source evidence, then run the analysis again so the next answer can cite extracted values instead of inferring missing facts.",
    ].join("\n"),
    plan_steps: null,
    action: null,
    suggested_followups: [
      "Turn this into a data request",
      "Draft a client-readable diligence note",
      "List what should not be claimed yet",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "provider_failure_advisory_fallback",
      starts_with_evidence_intake: false,
    },
  };
}

function defaultBlankActionContent(actionType: string | null | undefined): string {
  const label = actionType ? actionType.replace(/_/g, " ") : "workspace analysis";
  return `I’ll run the ${label} path and return the useful result with limits, assumptions, and next evidence clearly separated.`;
}

function shouldRunUploadedEvidenceEvaluation(
  message: string,
  state: InitialEvaluationProjectState,
): boolean {
  if (!state.hasUploadedDocuments || state.hasSuccessfulEvaluationArtifact) return false;
  if (state.documentEvidence) return false;
  if (/\b(?:model|provider)(?:-backed)?\s+(?:call|response)?\s*(?:fails?|failed|unavailable)|\beven if the model\b/i.test(message)) return false;
  return /\b(analy[sz]e|assess|evaluate|review|screen|process|conduct|calculate|attached|uploaded|file|data|what matters|what should|insights?|investable|bankable|bankability|commercial(?:ly)?\s+ready|commercial\s+readiness|readiness|diligence)\b/i.test(message);
}

function parseAttachmentNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/\[Attached:\s*([^\]]+)\]/gi)) {
    for (const name of (match[1] || "").split(/\s*,\s*/)) {
      const clean = name.trim();
      if (clean) names.push(clean);
    }
  }
  return Array.from(new Set(names));
}

function currentAttachmentNames(
  history: Array<{ role?: string; content?: string }> | undefined,
  message = "",
): string[] {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== "user") continue;
    const names = parseAttachmentNames(entry.content || "");
    if (names.length > 0) return names;
  }
  return parseAttachmentNames(message);
}

function shouldRunCurrentUploadUniversalAnalysis(args: {
  message: string;
  history?: Array<{ role: string; content: string }>;
  state: InitialEvaluationProjectState;
}): boolean {
  const messageAttachments = parseAttachmentNames(args.message);
  const attachments = currentAttachmentNames(args.history, args.message);
  if (!args.state.hasUploadedDocuments && attachments.length === 0) return false;
  if (args.state.hasSuccessfulEvaluationArtifact && messageAttachments.length === 0) return false;
  if (messageHasPlanRequest(args.message)) return false;
  if (/\b(?:model|provider)(?:-backed)?\s+(?:call|response)?\s*(?:fails?|failed|unavailable)|\beven if the model\b/i.test(args.message)) return false;

  const text = args.message || "";
  const currentUploadIntent =
    /\b(analy[sz]e|assess|evaluate|review|screen|summari[sz]e|explain|extract|conduct|calculate|simulate|model|run|compare|what\s+(?:is|are|does|do|can|should)|tell me|find|look at|useful|insights?|environmental|economic|financial|technical|risk|safety|operations?|supply chain|market|investable|bankable|bankability|commercial(?:ly)?\s+ready|commercial\s+readiness|readiness|diligence)\b/i.test(text);
  const followOnFileIntent =
    /\b(analy[sz]e|assess|evaluate|review|screen|summari[sz]e|extract|conduct|calculate|simulate|model|run|process|compare|investable|bankable|bankability|commercial(?:ly)?\s+ready|readiness|diligence)\b/i.test(text) &&
    /\b(this|that|it|file|document|pdf|upload|uploaded|attached|module|datasheet|deck|sheet|data)\b/i.test(text);

  if (args.state.documentEvidence && currentUploadIntent) return true;
  return attachments.length > 0 ? currentUploadIntent : followOnFileIntent;
}

function requestedWorkspaceOutputs(message: string): string[] {
  const outputs = new Set(["markdown", "json"]);
  if (/\b(csv|comma[-\s]?separated)\b/i.test(message)) outputs.add("csv");
  if (/\b(spreadsheet|excel|xlsx|workbook|table|model)\b/i.test(message)) outputs.add("xlsx");
  if (/\b(pdf|report|memo|brief)\b/i.test(message)) outputs.add("pdf");
  if (/\b(chart|plot|graph|figure)\b/i.test(message)) outputs.add("png");
  return Array.from(outputs);
}

function stripLeadingChatChrome(message: unknown): string {
  const raw = typeof message === "string" ? message : "";
  if (!raw.trim()) return "";
  const lines = raw.split(/\r?\n/);
  const chromeLine = /^(?:export\s+json|view\s+details|export\s+report|detailed\s+view|message\s+exergy\s+lab\.{0,3})$/i;
  let changed = true;
  while (changed && lines.length > 1) {
    changed = false;
    while (lines.length > 1 && !lines[0].trim()) {
      lines.shift();
      changed = true;
    }
    if (lines.length > 1 && chromeLine.test(lines[0].trim())) {
      lines.shift();
      changed = true;
    }
  }
  const cleaned = lines.join("\n").trim();
  return cleaned || raw.trim();
}

function isWorkspaceExportRequest(message: string | null | undefined): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const text = message;
  const explicitExport =
    /\b(export|download|save|convert)\b[\s\S]{0,100}\b(csv|xlsx|excel|spreadsheet|pdf|report|markdown|md|json|file|download)\b/i.test(text);
  const createFile =
    /\b(create|generate|turn|make|write)\b[\s\S]{0,100}\b(csv|xlsx|excel|spreadsheet|pdf|markdown|md|json|downloadable\s+file|file\s+download)\b/i.test(text);
  const asFile =
    /\b(as|into|to)\s+(?:a\s+)?(?:csv|xlsx|excel|spreadsheet|pdf|markdown|md|json)\b/i.test(text);
  return explicitExport || createFile || asFile;
}

function isWorkspaceTableFollowupRequest(message: string | null | undefined): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const text = message;
  const asksForPriorThing = /\b(that|this|the|previous|above|same|it)\b/i.test(text);
  const asksForTableOrMetric =
    /\b(show|give|extract|display|list|summari[sz]e|compare|recreate)\b/i.test(text) &&
    /\b(table|comparison|results?|scenario|sensitivity|lcoe|npv|irr|payback|breakeven|assumptions?)\b/i.test(text);
  return asksForPriorThing && asksForTableOrMetric;
}

function hasPriorWorkspaceResult(history: Array<{ role?: string; content?: string }> | undefined): boolean {
  return (history || []).some((entry) => {
    const content = typeof entry.content === "string" ? entry.content : "";
    return /\[Workspace result\]|#\s+Analysis Run|Base Case Results|Low\s*\/\s*Base\s*\/\s*High|Sensitivity Analysis|LCOE|NPV|IRR/i.test(content);
  });
}

interface WorkspacePlanOutlineStep {
  step: number;
  title: string;
  description: string;
}

function planOutlineText(steps: WorkspacePlanOutlineStep[]): string {
  return steps.map((step) => `${step.step}. ${step.title}: ${step.description}`).join("\n");
}

function buildWorkspacePlanOutline(args: {
  message: string;
  attachments: string[];
  exportRequest?: boolean;
  tableFollowupRequest?: boolean;
}): WorkspacePlanOutlineStep[] {
  if (args.exportRequest) {
    return [
      { step: 1, title: "Locate Prior Result", description: "Find the most recent relevant table or report in the conversation context and preserve its values exactly." },
      { step: 2, title: "Create Requested File", description: "Convert the selected result into the requested CSV, XLSX, PDF, Markdown, or JSON output without recomputing assumptions." },
      { step: 3, title: "Return Download Link", description: "Attach the generated file to the workspace artifact so the chat response can include a clickable download link." },
    ];
  }
  if (args.tableFollowupRequest) {
    return [
      { step: 1, title: "Identify Requested Result", description: "Use the latest relevant workspace result, table, or metric from the conversation context." },
      { step: 2, title: "Preserve Values And Units", description: "Recreate the requested table or comparison without changing prior assumptions, units, or numeric values." },
      { step: 3, title: "Answer Directly", description: "Return the table and a concise interpretation in chat." },
    ];
  }

  const text = args.message || "";
  const hasFiles = args.attachments.length > 0;
  const wantsSensitivity = /\bsensitivit|scenario|low\s*\/\s*base\s*\/\s*high|low,\s*base,\s*high|case\s+analysis|tornado\b/i.test(text);
  const wantsEconomics = /\btechno[-\s]?economic|economics?|financial|capex|opex|wacc|npv|irr|payback|breakeven|lco[a-z]+|revenue|ebitda\b/i.test(text);
  const wantsProcess = /\bprocess|mass balance|energy balance|exergy|yield|conversion|selectivity|production|throughput|hydrogen|utilities|feedstock|product slate\b/i.test(text);
  const wantsRisks = /\brisk|commercial|technical|environmental|carbon intensity|permitting|recommend|attractive|decision\b/i.test(text);

  const steps: WorkspacePlanOutlineStep[] = [];
  const add = (title: string, description: string) => steps.push({ step: steps.length + 1, title, description });

  add("Frame Objective And Boundaries", "Define the system boundary, production basis, units, time basis, included process blocks, product slate, and decision question before calculating.");
  add(
    hasFiles ? "Extract Evidence And Assumptions" : "Parse Stated Inputs",
    hasFiles
      ? "Read uploaded files and the prompt, extract parameter tables, numeric evidence, source labels, and missing inputs."
      : "Parse every numeric assumption in the prompt into a structured parameter table with units and default/base-case labels.",
  );
  add("Normalize Units And Validate Inputs", "Convert rates, yields, prices, CAPEX, OPEX, utilization, and product fractions onto a consistent annual and per-unit basis; flag inconsistent or underspecified inputs.");
  if (wantsProcess) {
    add("Build Process-Performance Model", "Compute mass balance, product rates, feed and utility consumption, yields, energy intensity, exergy-relevant loss points, and throughput-normalized metrics.");
  }
  if (wantsEconomics) {
    add("Build Economic Model", "Calculate revenues, variable costs, fixed O&M, annualized CAPEX, EBITDA, total annual cost, LCOx, breakeven price/output, NPV, IRR, and payback.");
  }
  if (wantsSensitivity) {
    add("Run Sensitivities", "Sweep the requested low/base/high values and rank the variables that control economics and performance.");
  }
  if (wantsRisks) {
    add("Assess Risks And Constraints", "Evaluate technical, commercial, environmental, permitting, feedstock, reliability, and scale-up risks tied to the model outputs.");
  }
  add("Generate Deliverables", "Return a detailed report directly in chat with tables and create structured output files when useful or requested.");

  return steps.slice(0, 9).map((step, index) => ({ ...step, step: index + 1 }));
}

function mergeChatHistories(
  savedHistory: Array<{ role?: string; content?: string }> | undefined,
  requestHistory: Array<{ role?: string; content?: string }> | undefined,
): Array<{ role: string; content: string }> {
  const seen = new Set<string>();
  const merged: Array<{ role: string; content: string }> = [];
  for (const entry of [...(savedHistory || []), ...(requestHistory || [])]) {
    const role = typeof entry.role === "string" && entry.role ? entry.role : "assistant";
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) continue;
    const key = `${role}:${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ role, content });
  }
  return merged.slice(-30);
}

function recentWorkspaceContextForPrompt(history: Array<{ role?: string; content?: string }> | undefined): string {
  const entries = (history || [])
    .filter((entry) => typeof entry.content === "string" && entry.content.trim())
    .slice(-12)
    .map((entry) => {
      const role = typeof entry.role === "string" && entry.role ? entry.role : "assistant";
      const content = String(entry.content || "").trim();
      return `${role.toUpperCase()}:\n${content.slice(0, 6000)}`;
    });
  return entries.join("\n\n").slice(-20000);
}

function countRegexSignals(text: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function messageNeedsTextOnlyQuantitativeWorkspace(message: string | null | undefined): boolean {
  if (typeof message !== "string" || !message.trim()) return false;
  const text = message;
  const hasSelfContainedNumericBasis =
    /\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:mw|mwe|kw|kwe|gw|mwh|gwh|modules?|years?|yr|%|\/kw|\/mwh|bpd|kg|metric\s+tons?(?:\/day)?|tonnes?(?:\/day)?|tons?(?:\/day)?|tpy|tpd|mt\/day)\b/i.test(text) ||
    /\b(?:\$|usd)\s*\d|\b\d+(?:\.\d+)?\s*(?:million|billion|mm|bn)\b/i.test(text);
  if (!hasSelfContainedNumericBasis) return false;

  const financeModelSignals = countRegexSignals(text, [
    /\btechno[-\s]?economic|economic\s+model|financial\s+model|project\s+finance|full\s+(?:model|assessment|report)\b/i,
    /\blcoe|lcoh|lcof|lcos|npv|irr|payback|ebitda|breakeven|break[- ]?even\b/i,
    /\bcapex|opex|wacc|fixed\s+o\s*&?\s*m|variable\s+o\s*&?\s*m|fuel\s+cost|power\s+price|revenue\b/i,
    /\bconstruction\s+duration|plant\s+life|decommissioning|capacity\s+factor\b/i,
  ]);
  if (financeModelSignals < 2) return false;

  const executionSignals = countRegexSignals(text, [
    /\b(build|calculate|compute|simulate|model|estimate|compare|run)\b/i,
    /\blow\s*\/\s*base\s*\/\s*high|low,\s*base,\s*high|base\s+case|high\s+case|low\s+case\b/i,
    /\bsensitivit(?:y|ies)|scenario|case\s+analysis|tornado\b/i,
    /\bfor\s+each\s+scale|compare\s+(?:four|three|two|\d+)|deployment\s+scales?|modules?|cases?\b/i,
    /\btables?|detailed\s+report|recommend(?:ation)?|risk\s+assessment\b/i,
  ]);

  if (executionSignals >= 2) return true;
  return financeModelSignals >= 2 && /\b(calculate|compute|model|estimate|economics?|financial|lcoe|lcoh|lcof|npv|irr|payback|breakeven|break[- ]?even)\b/i.test(text);
}

function shouldRunProgrammaticWorkspaceAction(args: {
  message: string;
  history?: Array<{ role?: string; content?: string }>;
  state: InitialEvaluationProjectState;
}): boolean {
  const attachments = currentAttachmentNames(args.history, args.message);
  const text = args.message || "";
  const textOnlyQuantitativeModel = attachments.length === 0 && messageNeedsTextOnlyQuantitativeWorkspace(text);
  const priorWorkspaceContext = hasPriorWorkspaceResult(args.history) || args.state.hasAnyArtifact;
  const followupWorkspaceRequest = priorWorkspaceContext && !textOnlyQuantitativeModel && (
    isWorkspaceExportRequest(text) ||
    isWorkspaceTableFollowupRequest(text)
  );
  if (!args.state.hasUploadedDocuments && attachments.length === 0 && !textOnlyQuantitativeModel && !followupWorkspaceRequest) return false;
  if (followupWorkspaceRequest) return true;

  const programmaticIntent =
    /\b(simulat(?:e|ion)|model(?:ing)?|calculate|compute|optimi[sz]e|breakeven|break[- ]?even|economic|financial|capex|opex|npv|irr|payback|lco[a-z]+|daily production|production needed|pilot[- ]?scale|plant performance|scenario|sensitivity|custom code|spreadsheet|xlsx|excel)\b/i.test(text);
  const decisionIntent =
    /\b(recommend|right scale|best scale|minimi[sz]e|maximi[sz]e|profitability|profitable|operational|operations?|from that analysis|explain why|in detail)\b/i.test(text);
  const multiDocumentOrBroad =
    attachments.length >= 2 ||
    /\b(multiple|all (?:of )?(?:these|the) (?:files|documents|pdfs)|end[- ]to[- ]end|pilot[- ]scale plant)\b/i.test(text);
  const scaleOrBreakevenIntent =
    /\b(breakeven|break[- ]?even|right scale|best scale|minimi[sz]e|maximi[sz]e|daily production|production needed|profitability|profitable)\b/i.test(text);

  return programmaticIntent && (
    textOnlyQuantitativeModel ||
    (attachments.length >= 2 && (decisionIntent || multiDocumentOrBroad)) ||
    (decisionIntent && scaleOrBreakevenIntent)
  );
}

function buildSourceDataNeededResponse(args: {
  message: string;
  state: InitialEvaluationProjectState;
  project: Project | null | undefined;
  projectDomain: string;
}): Record<string, unknown> | null {
  if (args.state.hasUploadedDocuments || args.state.hasAnyArtifact) return null;
  if (messageNeedsTextOnlyQuantitativeWorkspace(args.message)) return null;
  const text = args.message || "";
  const asksForProjectSpecificWork =
    /\b(simulat(?:e|ion)|calculate|compute|model|validate|prove|bankable|bankability|investment[-\s]?ready|commercially\s+ready|performance|economics?|financial|capex|opex|npv|irr|payback|lcoe|lcoh|lcof)\b/i.test(text) &&
    /\b(this|that|the\s+(?:module|plant|facility|technology|project|system|design|claim)|my|our)\b/i.test(text);
  if (!asksForProjectSpecificWork) return null;

  const subject = clientSubjectForProviderFallback(args.project, args.projectDomain).replace(/[.!?]\s*$/, "");
  return appendAgentTrace({
    type: "response",
    content: [
      `I can explain the method, but I cannot compute or validate this specific case from the current chat alone because no source data is available for ${subject}.`,
      "",
      "For a useful project-specific answer, provide the relevant datasheet, operating table, cost model, test log, or the key numeric assumptions with units and boundary conditions.",
      "",
      "The minimum useful inputs are usually: capacity or rated output, operating conditions, efficiency or conversion/yield, utilization or capacity factor, CAPEX, fixed OPEX, variable OPEX, feedstock or electricity price, product price, and any constraints that define the site or duty cycle.",
    ].join("\n"),
    plan_steps: null,
    questions: null,
    action: null,
    continue_with: null,
    suggested_followups: [
      "List the exact inputs needed",
      "Give me a template table to fill in",
      "Explain the calculation method generally",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "source_data_required_for_project_specific_analysis",
      starts_with_evidence_intake: false,
    },
  }, {
    stage: "chat_route",
    decision: "response",
    reason: "source_data_required_for_project_specific_analysis",
    type: "response",
    action: null,
  });
}

function buildProgrammaticWorkspaceAction(args: {
  message: string;
  history?: Array<{ role?: string; content?: string }>;
  projectDomain: string;
  project: Project | null | undefined;
  reason?: string;
}): Record<string, unknown> {
  const attachments = currentAttachmentNames(args.history, args.message);
  const recentContext = recentWorkspaceContextForPrompt(args.history);
  const textOnlyQuantitativeModel = attachments.length === 0 && messageNeedsTextOnlyQuantitativeWorkspace(args.message);
  const exportRequest = !textOnlyQuantitativeModel && isWorkspaceExportRequest(args.message);
  const tableFollowupRequest = !textOnlyQuantitativeModel && isWorkspaceTableFollowupRequest(args.message);
  const planOutline = buildWorkspacePlanOutline({
    message: args.message,
    attachments,
    exportRequest,
    tableFollowupRequest,
  });
  const messageWithAttachments = attachments.length > 0
    ? `${args.message}\n\n[Attached: ${attachments.join(", ")}]`
    : args.message;
  const context = [
    args.project?.name ? `Project: ${args.project.name}` : "",
    args.project?.description ? `Description: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
    args.projectDomain && args.projectDomain !== "general" ? `Detected domain: ${args.projectDomain}` : "",
    recentContext
      ? [
        "Recent conversation and prior results:",
        recentContext,
        "",
        "For follow-up requests that say this, that, the table, export, convert, or download, use the most recent relevant result above. Preserve prior assumptions, units, module sizes, and numeric values. Do not recompute a new model unless the user explicitly asks to change the assumptions.",
      ].join("\n")
      : "",
  ].filter(Boolean).join("\n");
  const content = exportRequest
    ? "I’ll create the requested export from the latest analysis and include a download link when it is ready."
    : tableFollowupRequest
      ? "I’ll pull the requested table from the latest analysis and keep the numbers consistent with the prior result."
      : attachments.length > 0
    ? `I’ll run this as a workspace analysis and follow a detailed ${planOutline.length}-step modeling plan: extract the evidence, normalize inputs, build the performance and economics model, run sensitivities, assess risks, and return the report directly in chat.`
    : `I’ll run this as a workspace model and follow a detailed ${planOutline.length}-step plan: structure the assumptions, calculate the process and economics metrics, run sensitivities, assess risks, and return the report directly in chat.`;
  const task = [
    messageWithAttachments,
    exportRequest || tableFollowupRequest
      ? ""
      : [
        "Execution plan to follow:",
        planOutlineText(planOutline),
        "",
        "Implement this plan in the workspace run. Produce the requested calculations and tables directly in report.md. Create structured output files when useful or requested.",
      ].join("\n"),
    exportRequest || tableFollowupRequest
      ? "Use the recent conversation context to answer this follow-up. If an export is requested, create the requested file(s) in OUTPUT_DIR using the prior table/report values exactly and mention the file names in report.md."
      : "",
  ].filter(Boolean).join("\n\n");

  return appendAgentTrace({
    type: "action",
    content,
    plan_steps: null,
    questions: null,
    action: {
      type: "agent_workspace",
      config: {
        task,
        question: task,
        context,
        current_attachments: attachments,
        requested_outputs: requestedWorkspaceOutputs(args.message),
        plan_outline: planOutline,
        allow_dependency_install: true,
        allow_network: /\b(latest|current|online|web|internet|github|hugging\s*face|literature|papers?|sources?)\b/i.test(args.message),
        timeout_ms: 15 * 60_000,
      },
    },
    continue_with: null,
    suggested_followups: [
      "Show the assumptions driving the recommendation",
      "Run a sensitivity case on product price and utilization",
      "Turn this into a client-ready memo",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: args.reason || (exportRequest
        ? "workspace_export_followup"
        : tableFollowupRequest
          ? "workspace_table_followup"
          : textOnlyQuantitativeModel
        ? "text_only_quantitative_model_workspace"
        : "complex_uploaded_files_programmatic_workspace"),
      starts_with_evidence_intake: false,
      routed_tool: "agent_workspace",
    },
  }, {
    stage: "chat_route",
    decision: "action",
    reason: args.reason || (exportRequest
      ? "workspace_export_followup"
      : tableFollowupRequest
        ? "workspace_table_followup"
        : textOnlyQuantitativeModel
      ? "text_only_quantitative_model_workspace"
      : "complex_uploaded_files_programmatic_workspace"),
    action: "agent_workspace",
    type: "action",
    attachments,
  });
}

function shouldRunEnvironmentalSiteAction(message: string): boolean {
  const environmentalIntent = /\b(environmental|permitting|site\s+risk|cooling\s+water|wetland|flood|protected\s+area|air\s+quality|water\s+stress|ecological|biodiversity)\b/i.test(message);
  if (!environmentalIntent) return false;
  const explicitLocationLanguage = /\b(?:lat(?:itude)?|lon(?:gitude)?|coordinates?|address|located\s+at|site\s+at|facility\s+at|plant\s+at|project\s+site|site\s+location)\b/i.test(message);
  const decimalCoordinatePair = /\b[-+]?\d{1,2}\.\d+\s*[NS]?\s*[,;]\s*[-+]?\d{1,3}\.\d+\s*[EW]?\b/i.test(message);
  return explicitLocationLanguage || decimalCoordinatePair;
}

function buildEnvironmentalSiteAction(args: {
  message: string;
  projectDomain: string;
}): Record<string, unknown> {
  return appendAgentTrace({
    type: "action",
    content: "I’ll collect environmental site context from the available data layers, then return the useful risks and constraints in plain language.",
    plan_steps: null,
    questions: null,
    action: {
      type: "environmental_site_analysis",
      config: {
        domain: args.projectDomain,
        question: args.message,
        description: args.message,
      },
    },
    continue_with: null,
    suggested_followups: [
      "Summarize the permitting risks",
      "What data should I verify locally?",
      "Turn this into a site due-diligence note",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "unified_environmental_site_route",
      starts_with_evidence_intake: false,
      routed_tool: "environmental_site_analysis",
    },
  }, {
    stage: "chat_route",
    decision: "action",
    reason: "unified_environmental_site_route",
    action: "environmental_site_analysis",
    type: "action",
    attachments: [],
  });
}

function actionContentForUploadedEvidence(message: string): string {
  if (/\b(simulate|model|calculate|compute|production|generation|output|yield|exergy|power)\b/i.test(message)) {
    return "I’ll extract the usable specs from the uploaded file and run the available calculation path, then return the requested numbers in plain language.";
  }
  if (/\b(summari[sz]e|explain|what\s+(?:is|are)|tell me|analy[sz]e)\b/i.test(message)) {
    return "I’ll analyze the uploaded file now and explain what it contains in plain language.";
  }
  return "I’ll analyze the uploaded file now and return the most useful supported findings from the available evidence.";
}

function buildUploadedEvidenceEvaluationAction(args: {
  message: string;
  history?: Array<{ role: string; content: string }>;
  projectDomain: string;
  project: Project | null | undefined;
}): Record<string, unknown> {
  const attachments = currentAttachmentNames(args.history, args.message);
  const messageWithAttachments = attachments.length > 0
    ? `${args.message}\n\n[Attached: ${attachments.join(", ")}]`
    : args.message;
  const description = [
    messageWithAttachments,
    args.project?.description ? `Project context: ${args.project.description}` : "",
    args.project?.goal ? `Goal: ${args.project.goal}` : "",
  ].filter(Boolean).join("\n\n");
  return appendAgentTrace({
    type: "action",
    content: actionContentForUploadedEvidence(args.message),
    plan_steps: null,
    questions: null,
    action: {
      type: "evidence_evaluation",
      config: {
        domain: args.projectDomain,
        question: messageWithAttachments,
        description,
        current_attachments: attachments,
      },
    },
    continue_with: null,
    suggested_followups: [
      "What are the biggest gaps in the evidence?",
      "Which result is strongest enough to act on?",
      "Turn this into a client-ready memo",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "uploaded_evidence_requires_grounded_run",
    },
    initial_evaluation_guardrail: {
      reason: "pre_evaluation_response_blocked",
    },
  }, {
    stage: "chat_route",
    decision: "action",
    reason: "uploaded_evidence_requires_grounded_run",
    action: "evidence_evaluation",
    type: "action",
    attachments,
  });
}

function responsePromisesUnrunWork(parsed: Record<string, unknown>): boolean {
  if (parsed.type !== "response") return false;
  if (parsed.action || (Array.isArray(parsed.plan_steps) && parsed.plan_steps.length > 0)) return false;
  const content = typeof parsed.content === "string" ? parsed.content : "";
  return (
    /\b(?:i(?:['’]ll| will| need to| should| am going to)|let me)\s+(?:work on|run|search|look up|recalculate|recompute|calculate|compute|simulate|extract|analy[sz]e|evaluate|process|pull|check)\b/i.test(content) ||
    /^\s*(?:searching|looking up|checking|recalculating|recomputing|calculating|computing|running|analy[sz]ing|evaluating)\b/i.test(content) ||
    /\b(?:best|next|first)\s+step\s+is\s+to\s+(?:run|perform|do|start)\s+(?:an?\s+)?(?:evidence[_ -]?evaluation|document analysis|evaluation)\b/i.test(content) ||
    /\b(?:documents?|files?)\s+(?:have|has)\s+not\s+been\s+fully\s+evaluated\b/i.test(content) ||
    /\brun\s+evidence[_ -]?evaluation\b/i.test(content)
  );
}

function isAttachmentFollowupQuestion(message: string): boolean {
  if (parseAttachmentNames(message).length > 0) return false;
  return /\b(now|scale|scaled|what if|capacity factor|gas price|fuel cost|spark spread|inverter|recommend|compare|from (?:that|this)|these modules|these units)\b/i.test(message);
}

function modelActionRerunsEvaluatedUpload(
  parsed: Record<string, unknown>,
  state: InitialEvaluationProjectState,
  message: string,
  history?: Array<{ role: string; content: string }>,
): boolean {
  if (parseAttachmentNames(message).length > 0) return false;
  if (currentTurnAttachmentNamesFromHistory(history, message).length > 0) return false;
  if (!state.hasSuccessfulEvaluationArtifact && !state.hasAnyArtifact && !isAttachmentFollowupQuestion(message)) return false;
  const actionType = (parsed.action as { type?: string } | null | undefined)?.type;
  return parsed.type === "action" && ["evidence_evaluation", "document_analysis"].includes(actionType || "");
}

function modelPlanDefersCurrentUploadWork(
  parsed: Record<string, unknown>,
  message: string,
  history: Array<{ role: string; content: string }> | undefined,
  state: InitialEvaluationProjectState,
): boolean {
  return (
    parsed.type === "plan" &&
    Array.isArray(parsed.plan_steps) &&
    parsed.plan_steps.length > 0 &&
    !messageHasPlanRequest(message) &&
    shouldRunCurrentUploadUniversalAnalysis({ message, history, state })
  );
}

async function loadSavedChatHistory(projectId: string): Promise<Array<{ role?: string; content?: string }>> {
  const path = join(process.cwd(), "..", "runtime", "projects", `proj_${projectId}`, "messages.json");
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const record = parsed as Record<string, unknown>;
    const storedHistory = Array.isArray(record.history) ? record.history : [];
    const storedMessages = Array.isArray(record.messages) ? record.messages : [];
    return [...storedHistory, ...storedMessages]
      .filter((entry): entry is { role?: string; content?: string } => !!entry && typeof entry === "object" && !Array.isArray(entry));
  } catch {
    return [];
  }
}

async function finalizeModelFirstResponse(args: {
  parsed: Record<string, unknown>;
  message: string;
  projectDomain: string;
  initialEvaluationState: InitialEvaluationProjectState;
}): Promise<Record<string, unknown>> {
  const parsed = { ...args.parsed };
  if (typeof parsed.content === "string") {
    const normalized = unwrapProviderText(parsed.content);
    parsed.content = normalized.text;
    if (normalized.providerReturnedBlankContent) {
      parsed.response_repair = {
        ...((parsed.response_repair && typeof parsed.response_repair === "object")
          ? parsed.response_repair as Record<string, unknown>
          : {}),
        reason: "blank_model_content",
      };
    }
  }
  if (typeof parsed.content === "string" && hasUnsupportedSparseStateClaims(parsed.content, args.initialEvaluationState)) {
    parsed.type = "response";
    parsed.content = buildSparseStateRepairResponse();
    parsed.action = null;
    parsed.plan_steps = null;
    parsed.response_repair = { reason: "sparse_state_unsupported_claims" };
  }

  if (typeof parsed.content === "string") {
    const claimRepair = sanitizeUnsupportedProviderMaturityClaims(parsed.content);
    if (claimRepair.sanitized) {
      parsed.content = claimRepair.content;
      parsed.response_repair = {
        ...((parsed.response_repair && typeof parsed.response_repair === "object")
          ? parsed.response_repair as Record<string, unknown>
          : {}),
        unsupported_maturity_claims: true,
      };
    }
  }

  if (typeof parsed.content === "string") {
    parsed.content = sanitizeUserFacingAgentText(parsed.content);
  }

  const followups = Array.isArray(parsed.suggested_followups)
    ? parsed.suggested_followups.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3)
    : [];
  while (followups.length < 3) {
    followups.push(
      ["What are the key risks?", "How does this compare to alternatives?", "What data would improve this assessment?"][
        followups.length
      ] || "Tell me more",
    );
  }
  parsed.suggested_followups = followups;

  return parsed;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }
  const { message: rawMessage, history, toolUseEnabled, thinkingMode } = body as {
    message: string;
    history: Array<{ role: string; content: string }>;
    toolUseEnabled?: boolean;
    thinkingMode?: "instant" | "expert";
  };
  const message = stripLeadingChatChrome(rawMessage);
  const toolsEnabled = toolUseEnabled !== false;
  const responseThinkingMode = thinkingMode === "instant" ? "instant" : "expert";

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Quota enforcement — applies to all users (auth or anonymous)
  let _quotaUserId = "";
  let _quotaTier: "anonymous" | "free" | "plus" | "pro" = "anonymous";
  try {
    const { auth: getAuth } = await import("@/lib/auth");
    const { checkQuota } = await import("@/lib/quota");
    const { getUsageToday } = await import("@/lib/usage");
    const sess = await getAuth();
    _quotaTier = ((sess?.user as Record<string, unknown>)?.tier as string || "anonymous") as typeof _quotaTier;
    _quotaUserId = (sess?.user as Record<string, unknown>)?.id as string || "";
    // For authenticated users: DB-backed usage tracking
    // For anonymous users: enforce anonymous tier limits (3 messages) using project-scoped counting
    const usageKey = _quotaUserId || `anon_${projectId}`;
    const usage = _quotaUserId ? await getUsageToday(_quotaUserId) : {};
    const usedCount = _quotaUserId ? (usage.chat_message || 0) : 0;
    const quota = checkQuota(_quotaTier, "chat_message", usedCount);
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.upgradeMessage }, { status: 429 });
    }
  } catch {
    // Quota check failure is non-fatal — allow the request
  }

  const storage2 = getStorage();
  const proj = await storage2.getProject(projectId);
  let projectDomain = proj?.domain || "general";

  // Auto-detect domain from description and document names when domain is "general".
  // Uses scored matching against all 101 catalog domains instead of a hardcoded list.
  // Three-level tie-break: most keyword hits → lowest priority → catalog order.
  if (projectDomain === "general" && proj) {
    const docs = await storage2.listDocuments(projectId);
    // Include the user's current message in detection — project description alone may lack keywords
    const contextText = [proj.description, proj.name, message, ...docs.map(d => d.filename)].join(" ").toLowerCase();

    const { default: domainCatalog } = await import("@/lib/domain-catalog.generated.json");
    const catalogDomains = (domainCatalog as any).domains as Array<{
      id: string; keywords: string[]; priority: number;
    }>;

    const scores: { id: string; hits: number; priority: number; idx: number }[] = [];
    for (let i = 0; i < catalogDomains.length; i++) {
      const d = catalogDomains[i];
      let hits = 0;
      for (const kw of d.keywords) {
        if (contextText.includes(kw.toLowerCase())) hits++;
      }
      if (hits > 0) scores.push({ id: d.id, hits, priority: d.priority, idx: i });
    }
    // Three-level sort: most hits, then lowest priority, then lowest catalog index
    scores.sort((a, b) => b.hits - a.hits || a.priority - b.priority || a.idx - b.idx);
    if (scores.length > 0) projectDomain = scores[0].id;
  }

  const projectContextBundle = await buildProjectContext(projectId);
  const projectContext = projectContextBundle.context;
  const initialEvaluationState: InitialEvaluationProjectState = {
    ...projectContextBundle.initialEvaluationState,
    domain: projectDomain,
  };

  const savedHistory = await loadSavedChatHistory(projectId);
  const mergedHistory = mergeChatHistories(savedHistory, history);
  const returnChatResponse = async (response: Record<string, unknown>) => {
    if (_quotaUserId) {
      try {
        const { trackUsage } = await import("@/lib/usage");
        await trackUsage(_quotaUserId, "chat_message", projectId);
      } catch { /* non-fatal */ }
    }
    return NextResponse.json({ response, usage: null });
  };

  const hasModelKey = !!(getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY"));

  if (toolsEnabled && hasModelKey) {
    const modelRoutedResponse = await buildModelRoutedResponse({
      projectId,
      message,
      history: mergedHistory,
      project: proj,
      projectDomain,
      state: initialEvaluationState,
      storage: storage2,
    });
    if (modelRoutedResponse) {
      const finalizedModelRoutedResponse = await finalizeModelFirstResponse({
        parsed: modelRoutedResponse,
        message,
        projectDomain,
        initialEvaluationState,
      });
      const actionType = (finalizedModelRoutedResponse.action as { type?: string } | null | undefined)?.type;
      if (!String(finalizedModelRoutedResponse.content || "").trim() && actionType) {
        finalizedModelRoutedResponse.content = defaultBlankActionContent(actionType);
      }
      return returnChatResponse(finalizedModelRoutedResponse);
    }
  }

  const safetyResponse = buildAgentSafetyResponse(message);
  if (safetyResponse && !hasModelKey) {
    return returnChatResponse(safetyResponse);
  }

  const currentMarketPriceResponse = buildCurrentMarketPriceResponse(message);
  if (currentMarketPriceResponse) {
    return returnChatResponse(currentMarketPriceResponse);
  }

  const sourceDataNeededResponse = buildSourceDataNeededResponse({
    message,
    state: initialEvaluationState,
    project: proj,
    projectDomain,
  });
  if (sourceDataNeededResponse) {
    return returnChatResponse(sourceDataNeededResponse);
  }

  const platformPlanResponse = buildPlatformOwnedPlanResponse({
    message,
    history: mergedHistory,
    state: initialEvaluationState,
    project: proj || {},
  });
  if (platformPlanResponse) {
    return returnChatResponse(platformPlanResponse as unknown as Record<string, unknown>);
  }

  const platformActionResponse = buildPlatformOwnedActionResponse({
    message,
    history: mergedHistory,
    state: initialEvaluationState,
    project: proj || {},
  });
  if (platformActionResponse) {
    return returnChatResponse(platformActionResponse as unknown as Record<string, unknown>);
  }

  if (toolsEnabled && shouldRunProgrammaticWorkspaceAction({ message, history: mergedHistory, state: initialEvaluationState })) {
    return returnChatResponse(buildProgrammaticWorkspaceAction({
      message,
      history: mergedHistory,
      projectDomain,
      project: proj,
    }));
  }

  if (toolsEnabled && shouldRunEnvironmentalSiteAction(message)) {
    return returnChatResponse(buildEnvironmentalSiteAction({ message, projectDomain }));
  }

  if (toolsEnabled) {
    if (shouldRunCurrentUploadUniversalAnalysis({ message, history: mergedHistory, state: initialEvaluationState })) {
      return returnChatResponse(buildUploadedEvidenceEvaluationAction({
        message,
        history: mergedHistory,
        projectDomain,
        project: proj,
      }));
    }
  }

  if (toolsEnabled) {
    const orchestratedResponse = await buildAgentOrchestratedResponse({
      projectId,
      message,
      history: mergedHistory,
      project: proj,
      projectDomain,
      state: initialEvaluationState,
      storage: storage2,
    });
    if (orchestratedResponse) {
      return returnChatResponse(orchestratedResponse);
    }

    const groundedResponse = await buildGroundedWorkspaceResponse({
      projectId,
      message,
      project: proj,
      storage: storage2,
    });
    if (groundedResponse) {
      return returnChatResponse(groundedResponse);
    }

    const workspaceAgentResponse = await buildWorkspaceAgentResponse({
      projectId,
      message,
      history: mergedHistory,
      project: proj,
      storage: storage2,
    });
    if (workspaceAgentResponse) {
      return returnChatResponse(workspaceAgentResponse);
    }
  }

  if (!hasModelKey) {
    const generalDialogueResponse = await buildGeneralDialogueResponse({
      message,
      projectName: proj?.name,
      projectDomain,
    });
    if (generalDialogueResponse) {
      return returnChatResponse(generalDialogueResponse);
    }

    return returnChatResponse(buildProviderFailureAdvisoryResponse({
      message,
      project: proj,
      projectDomain,
      history: mergedHistory,
    }));
  }

  const directPrompt = [
    "You are Exergy Analyst, a practical AI agent for energy, science, engineering, environmental, and techno-economic work.",
    "Answer directly in normal chat language. Do not mention router failures, artifacts, evidence cards, View Details, Export Report, internal model names, or workflow labels.",
    "If the answer is high-stakes, state what the supplied data supports and what it cannot prove.",
    TRUTHFULNESS_PROMPT_GUARDRAILS,
    toolsEnabled
      ? "Tool routing did not produce a usable tool decision, so answer from the full context without claiming that tools were run."
      : "The user disabled tool use, so answer from the full context without claiming that tools were run.",
    responseThinkingMode === "expert"
      ? "Use clear structure and tables when they improve readability."
      : "Keep the answer concise.",
    `Project: ${proj?.name || "Untitled"} (${projectDomain})`,
    proj?.description ? `Project description: ${proj.description}` : "",
    projectContext ? `Project context:\n${projectContext}` : "",
    mergedHistory.length
      ? `Conversation and saved context:\n${mergedHistory.map((entry) => `${entry.role}: ${entry.content}`).join("\n")}`
      : "",
    `User request:\n${message}`,
  ].filter(Boolean).join("\n\n");

  try {
    const directContent = await callDeepSeekV3(
      [{ role: "user", content: directPrompt }],
      { temperature: 0.2, maxTokens: responseThinkingMode === "expert" ? 3200 : 1200 },
    );
    const directText = typeof directContent === "string" ? directContent.trim() : "";
    if (!directText) {
      return NextResponse.json(
        { error: "DeepSeek returned an empty response." },
        { status: 502 },
      );
    }
    return returnChatResponse({
      type: "response",
      content: sanitizeUserFacingAgentText(directText),
      plan_steps: null,
      questions: null,
      action: null,
      continue_with: null,
      suggested_followups: [
        "Run a deeper analysis",
        "What assumptions matter most?",
        "Turn this into a client-ready memo",
      ],
      workflow_orchestration: {
        source: "deepseek",
        reason: toolsEnabled ? "deepseek_direct_after_no_tool_decision" : "deepseek_direct_tools_disabled",
        starts_with_evidence_intake: false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "DeepSeek request failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

}
