import { extractNumericEvidence, type NumericEvidence } from "@/lib/agent-quality-evaluator";
import { buildSalientSourceValues, isDocumentEvidenceDigest, renderSalientSourceValuesTable } from "@/lib/document-evidence";
import { requiresScenarioReproducibilityPrompt } from "@/lib/scenario-reproducibility";
import type { ProjectDocument } from "@/lib/storage/types";

export type ClaimKind = "numeric" | "technical" | "assumption" | "limitation" | "artifact";
export type ClaimSupport = "source" | "tool_output" | "calculation" | "assumption" | "limitation" | "unsupported";

export interface ClaimLedgerItem {
  id: string;
  kind: ClaimKind;
  support: ClaimSupport;
  text: string;
  numeric_values: NumericEvidence[];
  evidence_preview?: string;
  risk: "low" | "medium" | "high";
}

export interface ClaimLedgerSummary {
  total_claims: number;
  numeric_claims: number;
  unsupported_claims: number;
  unsupported_numeric_claims: number;
  support_counts: Record<ClaimSupport, number>;
}

export interface AnomalyFlag {
  text: string;
  reason: string;
}

export interface ClaimLedgerResult {
  summary: ClaimLedgerSummary;
  claims: ClaimLedgerItem[];
  anomaly_flags: AnomalyFlag[];
}

export interface SourceExtractionDiagnostic {
  document_id: string;
  filename: string;
  status: string;
  text_chars: number;
  numeric_value_count: number;
  table_like_line_count: number;
  extraction_keys: string[];
  confidence: "none" | "low" | "medium" | "high";
  issues: string[];
  salient_values?: Array<{ label: string; value: number; raw: string; unit: string; source: string; context: string }>;
}

export interface ScenarioReproducibilityCheck {
  id: string;
  status: "pass" | "warn" | "info";
  message: string;
}

export interface ScenarioReproducibilityResult {
  required: boolean;
  score: number | null;
  checks: ScenarioReproducibilityCheck[];
}

const TECHNICAL_CLAIM_RE =
  /\b(simulat(?:e|ed|ion)|model(?:ed|ling)?|calculate(?:d|s)?|estimate(?:d|s)?|extract(?:ed|s)?|source-backed|from the uploaded|efficiency|temperature|pressure|capacity|capex|opex|npv|irr|payback|lcoe|breakeven|emissions?|co2|risk|failure|thermal|environmental|physics|economics|sensitivity|scenario)\b/i;

const ASSUMPTION_RE = /\b(assum(?:e|ed|ption)|basis|placeholder|proxy|estimated using|modeled as)\b/i;
const LIMIT_RE = /\b(cannot|can't|not prove|not validated|not supported|uncertain|missing|gap|limit|requires|would improve confidence)\b/i;
const TOOL_RE = /\b(I\s+(?:ran|created|generated|simulated|modeled|calculated)|workspace|tool|solver|script|code)\b/i;
function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitCandidateClaims(answer: string): string[] {
  const claims: string[] = [];
  const lines = answer
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^\|.*\|$/.test(line)) {
      claims.push(normalizeText(line));
      continue;
    }
    const pieces = line.split(/(?<=[.!?])\s+(?=[A-Z0-9$])/);
    for (const piece of pieces) {
      const claim = normalizeText(piece.replace(/^[-*]\s+/, ""));
      if (claim.length >= 18) claims.push(claim);
    }
  }

  return claims.slice(0, 120);
}

function closeEnough(actual: number, expected: number): boolean {
  const scale = Math.max(1, Math.abs(expected));
  const rel = Math.abs(actual - expected) / scale;
  const abs = Math.abs(actual - expected);
  return rel <= 0.015 || abs <= 0.05;
}

function matchNumericEvidence(values: NumericEvidence[], evidence: NumericEvidence[]): NumericEvidence | null {
  for (const value of values) {
    const found = evidence.find((item) => closeEnough(item.value, value.value));
    if (found) return found;
  }
  return null;
}

function tokenOverlap(a: string, b: string): number {
  const stop = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "using", "case", "value", "values"]);
  const tokens = new Set(
    a.toLowerCase()
      .replace(/[^a-z0-9%/$.-]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 && !stop.has(token)),
  );
  if (tokens.size === 0) return 0;
  let hits = 0;
  const other = b.toLowerCase();
  for (const token of tokens) {
    if (other.includes(token)) hits += 1;
  }
  return hits / Math.max(tokens.size, 1);
}

function inferKind(text: string, numericValues: NumericEvidence[]): ClaimKind {
  if (ASSUMPTION_RE.test(text)) return "assumption";
  if (LIMIT_RE.test(text)) return "limitation";
  if (TOOL_RE.test(text)) return "artifact";
  if (numericValues.length > 0) return "numeric";
  return "technical";
}

function inferSupport(args: {
  text: string;
  kind: ClaimKind;
  numericValues: NumericEvidence[];
  sourceEvidence: NumericEvidence[];
  artifactEvidence: NumericEvidence[];
  sourceText: string;
  artifactText: string;
}): { support: ClaimSupport; evidence?: string } {
  if (args.kind === "assumption") return { support: "assumption" };
  if (args.kind === "limitation") return { support: "limitation" };

  const sourceMatch = matchNumericEvidence(args.numericValues, args.sourceEvidence);
  if (sourceMatch) return { support: "source", evidence: sourceMatch.context };

  const artifactMatch = matchNumericEvidence(args.numericValues, args.artifactEvidence);
  if (artifactMatch) return { support: "tool_output", evidence: artifactMatch.context };

  if (args.numericValues.length > 0 && /\b(calculat|model|simulat|estimate|breakeven|npv|lcoe|payback|annual|total)\b/i.test(args.text)) {
    return { support: args.artifactText.trim() ? "calculation" : "unsupported" };
  }

  if (tokenOverlap(args.text, args.sourceText) >= 0.55) {
    return { support: "source" };
  }
  if (tokenOverlap(args.text, args.artifactText) >= 0.45) {
    return { support: "tool_output" };
  }
  if (TOOL_RE.test(args.text) && args.artifactText.trim()) {
    return { support: "tool_output" };
  }
  return { support: "unsupported" };
}

function inferRisk(kind: ClaimKind, support: ClaimSupport, numericValues: NumericEvidence[]): ClaimLedgerItem["risk"] {
  if (support === "unsupported" && (kind === "numeric" || numericValues.length > 0)) return "high";
  if (support === "unsupported") return "medium";
  if (support === "assumption" && numericValues.length > 0) return "medium";
  return "low";
}

// Detects the failure mode where the answer runs a consistency / cross-check,
// finds a large discrepancy, then explains it away with an assumed parameter
// (specific heat, varying flow, part-load) instead of surfacing it as an
// unresolved limitation. A detected-then-rationalized anomaly is worse than an
// undetected one: it launders a real data problem into a footnote.
const CHECK_CONTEXT_RE = /\b(quality check|cross[- ]?check|consistency check|sanity check|independent check|expected\b.*\breported|implied|ratio)\b/i;
const RATIONALIZE_RE = /\b(can be explained|explained by|likely (?:due|because|reflect|indicat)|probably (?:due|because)|attribut\w+\s+to|due to (?:the )?(?:higher|lower|different|differing|varying|assumed)|because (?:the )?(?:cp\b|c_p|specific heat)|may (?:indicate|reflect|be (?:due|because)))\b/i;
const PARAM_EXPLANATION_RE = /\b(cp\b|c_p|specific heat|varying flow|part[- ]?load|different (?:flow|cp|specific heat|operating))\b/i;
const LARGE_DEVIATION_RE = /\b(large|significant|order of magnitude|off by|huge|drastically?)\b/i;

function ratioFarFromOne(unit: string): boolean {
  const ratioMatches = unit.matchAll(/\b(?:ratio|factor)\b[^.\n]{0,24}?(\d+(?:\.\d+)?)/gi);
  for (const match of ratioMatches) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && (value < 0.5 || value > 2)) return true;
  }
  const multiple = unit.match(/\b(\d+(?:\.\d+)?)\s*[x×]\b/i);
  if (multiple && Number(multiple[1]) >= 2) return true;
  return false;
}

export function detectRationalizedAnomalies(answer: string): AnomalyFlag[] {
  const lines = (answer || "").replace(/\r\n/g, "\n").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const flags: AnomalyFlag[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    // Examine a line together with the next one so a table row of ratios
    // followed by an explanatory note is read as a single unit.
    const unit = [lines[i], lines[i + 1] || ""].join(" ");
    if (!CHECK_CONTEXT_RE.test(unit)) continue;
    const rationalized = RATIONALIZE_RE.test(unit) && PARAM_EXPLANATION_RE.test(unit);
    if (!rationalized) continue;
    const largeDeviation = LARGE_DEVIATION_RE.test(unit) || ratioFarFromOne(unit);
    if (!largeDeviation) continue;
    const text = normalizeText(lines[i]).slice(0, 280);
    if (seen.has(text)) continue;
    seen.add(text);
    flags.push({
      text,
      reason: "A consistency check shows a large discrepancy that is explained away with an assumed parameter (e.g. specific heat, varying flow, part-load) instead of being reported as an unresolved data-quality issue.",
    });
  }
  return flags.slice(0, 10);
}

export function buildClaimLedger(input: {
  finalAnswer: string;
  sourceTexts?: string[];
  artifactTexts?: string[];
  maxClaims?: number;
}): ClaimLedgerResult {
  const sourceText = normalizeText((input.sourceTexts || []).join("\n\n"));
  const artifactText = normalizeText((input.artifactTexts || []).join("\n\n"));
  const sourceEvidence = extractNumericEvidence(sourceText, 500);
  const artifactEvidence = extractNumericEvidence(artifactText, 500);
  const items: ClaimLedgerItem[] = [];

  for (const claim of splitCandidateClaims(input.finalAnswer || "")) {
    const numericValues = extractNumericEvidence(claim, 20);
    if (numericValues.length === 0 && !TECHNICAL_CLAIM_RE.test(claim) && !ASSUMPTION_RE.test(claim) && !LIMIT_RE.test(claim)) {
      continue;
    }
    const kind = inferKind(claim, numericValues);
    const supportResult = inferSupport({
      text: claim,
      kind,
      numericValues,
      sourceEvidence,
      artifactEvidence,
      sourceText,
      artifactText,
    });
    items.push({
      id: `claim_${items.length + 1}`,
      kind,
      support: supportResult.support,
      text: claim,
      numeric_values: numericValues,
      evidence_preview: supportResult.evidence,
      risk: inferRisk(kind, supportResult.support, numericValues),
    });
    if (items.length >= (input.maxClaims || 80)) break;
  }

  const supportCounts: Record<ClaimSupport, number> = {
    source: 0,
    tool_output: 0,
    calculation: 0,
    assumption: 0,
    limitation: 0,
    unsupported: 0,
  };
  for (const item of items) supportCounts[item.support] += 1;
  return {
    summary: {
      total_claims: items.length,
      numeric_claims: items.filter((item) => item.numeric_values.length > 0).length,
      unsupported_claims: supportCounts.unsupported,
      unsupported_numeric_claims: items.filter((item) => item.support === "unsupported" && item.numeric_values.length > 0).length,
      support_counts: supportCounts,
    },
    claims: items,
    anomaly_flags: detectRationalizedAnomalies(input.finalAnswer || ""),
  };
}

export function documentTextForDiagnostics(doc: ProjectDocument): string {
  const extraction = doc.extraction_result || {};
  const digest = extraction.document_evidence;
  const digestText = isDocumentEvidenceDigest(digest)
    ? [
      digest.preview,
      renderSalientSourceValuesTable(buildSalientSourceValues([doc], 16), 16),
      ...digest.facts,
      ...digest.assumptions,
      ...digest.unsupported_claims,
      ...digest.contradicted_claims,
      ...digest.missing_inputs,
      ...digest.next_actions,
      ...digest.chartable_fields,
      ...digest.non_chartable_fields,
    ].filter(Boolean).join("\n")
    : "";
  return [
    extraction.text,
    extraction.markdown,
    extraction.content,
    extraction.preview,
    extraction.raw_text,
    digestText,
  ].filter((value) => typeof value === "string").join("\n\n");
}

export function buildSourceExtractionConfidence(documents: ProjectDocument[]): SourceExtractionDiagnostic[] {
  return documents.map((doc) => {
    const text = documentTextForDiagnostics(doc);
    const salientValues = buildSalientSourceValues([doc], 12);
    const numericCount = extractNumericEvidence(text, 300).length;
    const tableLikeLineCount = text.split(/\r?\n/).filter((line) => /\|.+\||\t|,{2,}/.test(line)).length;
    const keys = Object.keys(doc.extraction_result || {});
    const issues: string[] = [];
    if (!text.trim()) issues.push("No parser-readable extracted text is stored for this document.");
    if (doc.mime_type === "application/pdf" && text.length < 500) issues.push("PDF extraction text is short; complex tables or scanned content may be missing.");
    if (numericCount === 0 && text.length > 300) issues.push("Extracted text has no numeric evidence, which is unusual for technical/economic documents.");
    const confidence =
      !text.trim() ? "none"
        : text.length >= 4000 || numericCount >= 12 || tableLikeLineCount >= 4 ? "high"
          : text.length >= 800 || numericCount >= 4 ? "medium"
            : "low";
    return {
      document_id: doc.id,
      filename: doc.filename,
      status: doc.status,
      text_chars: text.length,
      numeric_value_count: numericCount,
      table_like_line_count: tableLikeLineCount,
      extraction_keys: keys,
      confidence,
      issues,
      salient_values: salientValues.map((item) => ({
        label: item.label,
        value: item.value,
        raw: item.raw,
        unit: item.unit,
        source: item.source,
        context: item.context,
      })),
    };
  });
}

export function evaluateScenarioReproducibility(input: {
  prompt: string;
  finalAnswer: string;
  artifactTexts?: string[];
}): ScenarioReproducibilityResult {
  const combined = `${input.finalAnswer || ""}\n\n${(input.artifactTexts || []).join("\n\n")}`;
  const required = requiresScenarioReproducibilityPrompt(input.prompt || "");
  const checks: ScenarioReproducibilityCheck[] = [];
  if (!required) {
    return { required: false, score: null, checks: [{ id: "scenario_not_requested", status: "info", message: "The user request did not appear to require scenario reproducibility checks." }] };
  }

  const add = (id: string, pass: boolean, message: string) => {
    checks.push({ id, status: pass ? "pass" : "warn", message });
  };
  add("changed_inputs_visible", /\b(changed input|changed variable|inputs? changed|only change|changed to|changed from|reduced by|reduced to|increased by|increased to|raised by|raised to|lowered by|lowered to)\b/i.test(combined), "Scenario output should state exactly which inputs changed.");
  add("held_constants_visible", /\b(held constant|all other|unchanged|constant)\b/i.test(combined), "Scenario output should state which inputs stayed constant.");
  add("base_reference_visible", /\b(base case|prior run|previous run|original case|reference case|base[- ]case)\b/i.test(combined), "Scenario output should identify the prior/base case used for comparison.");
  add("scenario_table_visible", /\|.*(?:scenario|case|base|input|output|result|changed|constant).*\|/i.test(combined), "Scenario output should include a compact side-by-side comparison table.");
  add("computed_basis_visible", /\b(formula|equation|calculated as|model basis|calculation basis|independent check|quality check)\b/i.test(combined), "Scenario output should expose formulas, model basis, or independent checks.");
  add("assumption_drift_check_visible", /\b(assumption drift|drift check|only changed|no other assumptions|unchanged assumptions)\b/i.test(combined), "Scenario output should include an assumption drift check.");
  add("artifact_or_result_context_visible", (input.artifactTexts || []).join("").trim().length > 0 || /\bI (?:ran|calculated|modeled|simulated)\b/i.test(input.finalAnswer || ""), "Scenario output should be traceable to tool results or explicit calculations.");

  const passed = checks.filter((check) => check.status === "pass").length;
  return {
    required: true,
    score: Math.round((passed / Math.max(checks.length, 1)) * 100),
    checks,
  };
}
