/**
 * Deep Due Diligence pipeline — the premium Deep DD path.
 *
 * Pattern mirrors `breakthrough_engine/rlm/extractor.py`:
 *
 *   1. Each document is sectioned (header-aware with paragraph fallback).
 *   2. Each section dispatches a **leaf** call (DeepSeek V4-Flash) that
 *      extracts question-relevant claims, evidence, and risks.
 *   3. All leaves for one doc feed a **synth** call (Qwen 3.6 Plus)
 *      that reconciles within the doc and flags internal contradictions.
 *   4. All per-doc synths feed a **final** call (GLM-5.1) that produces
 *      the cross-document Deep DD brief with inter-doc contradiction
 *      detection.
 *
 * Budget is enforced by the {@link RLMRouter}. If the router throws
 * `BudgetExceededError` at any step, the pipeline returns a partial
 * brief with `fallback_used: "budget_exceeded"` so the caller can
 * degrade gracefully to the existing Deep Research path rather than
 * failing the request outright.
 *
 * The standard Deep Research path stays untouched. This is an opt-in
 * premium tier.
 */

import type { RLMCompletionMetadata } from "./rlm-router";
import { BudgetExceededError, DepthExceededError, RLMRouter } from "./rlm-router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiligenceSeverity = "informational" | "notable" | "critical";
export type DiligenceConfidence = "low" | "medium" | "high";

export interface DiligenceFinding {
  claim: string;
  evidence: string;
  source_doc: string;
  section_path: string;
  confidence: DiligenceConfidence;
  severity: DiligenceSeverity;
}

export interface DiligenceContradiction {
  topic: string;
  positions: Array<{ doc: string; section_path: string; claim: string }>;
  analysis: string;
}

export interface DiligenceDocInput {
  /** Filename or ID — shown to users as the "source" of a finding. */
  name: string;
  /** Already-extracted text (e.g., from the project's document
   *  extraction pipeline). Long docs are sectioned inside this module. */
  text: string;
}

export interface DeepDiligenceInput {
  question: string;
  /** Optional short project/domain context injected into prompts. */
  context?: string;
  docs: DiligenceDocInput[];
}

export interface DeepDiligenceOptions {
  maxUsdBudget?: number;
  maxDepth?: number;
  /** Section length target (characters). 8000 mirrors the Python
   *  sectioner default. */
  sectionMaxChars?: number;
  /** Dependency-injectable router, for tests. */
  router?: RLMRouter;
}

export interface DeepDiligenceResult {
  question: string;
  executive_summary: string;
  /** Curated findings from the final cross-doc synthesis model. This is
   *  the brief the user reads first. */
  findings: DiligenceFinding[];
  contradictions: DiligenceContradiction[];
  risks: string[];
  gaps: string[];
  recommended_next_steps: string[];

  /** Full per-document aggregated findings from the synth pass. Preserved
   *  separately from `findings` so that items the final model omitted are
   *  still available in the premium audit trail — the final model curates
   *  but does not silently discard. */
  per_doc_findings: DiligenceFinding[];
  /** Per-doc contradictions and risks too, for audit parity. */
  per_doc_contradictions: DiligenceContradiction[];
  per_doc_risks: string[];
  per_doc_gaps: string[];

  // Premium-audit fields
  n_docs: number;
  n_sections: number;
  n_leaf_calls: number;
  n_synth_calls: number;
  n_final_calls: number;
  model_cost_usd: number;
  trajectory: RLMCompletionMetadata[];
  fallback_used: "budget_exceeded" | "depth_exceeded" | null;
  partial_at_stage?: "leaf" | "synth" | "final";
}

// ---------------------------------------------------------------------------
// Sectioner (TS re-implementation of the Python markdown sectioner)
// ---------------------------------------------------------------------------

export interface Section {
  heading: string;
  headingPath: string[];
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/gm;

export function sectionDocument(text: string, maxChars = 8000): Section[] {
  if (!text || !text.trim()) {
    return [{ heading: "(empty)", headingPath: [], body: "" }];
  }

  const matches = [...text.matchAll(HEADING_RE)];
  if (matches.length === 0) {
    // No headings — split on paragraph breaks to keep sections bounded.
    return chunkByParagraph(text.trim(), "(no headings)", [], maxChars);
  }

  const sections: Section[] = [];
  const stack: Array<{ level: number; heading: string }> = [];

  // Preamble before the first heading
  const first = matches[0];
  if (first.index && first.index > 0) {
    const preamble = text.slice(0, first.index).trim();
    if (preamble) {
      sections.push(...chunkByParagraph(preamble, "(preamble)", [], maxChars));
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const level = m[1].length;
    const heading = m[2].trim();
    const bodyStart = (m.index ?? 0) + m[0].length;
    const bodyEnd = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();

    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const headingPath = [...stack.map((s) => s.heading), heading];
    stack.push({ level, heading });

    if (!body) continue;
    sections.push(...chunkByParagraph(body, heading, headingPath, maxChars));
  }
  return sections.length > 0 ? sections : [{ heading: "(empty)", headingPath: [], body: "" }];
}

function chunkByParagraph(
  body: string,
  heading: string,
  headingPath: string[],
  maxChars: number,
): Section[] {
  if (body.length <= maxChars) {
    return [{ heading, headingPath, body }];
  }
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (p.length > maxChars) {
      if (current) chunks.push(current);
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      current = "";
      continue;
    }
    if (current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, idx) => ({
    heading: chunks.length > 1 ? `${heading} [part ${idx + 1}/${chunks.length}]` : heading,
    headingPath: [...headingPath],
    body: chunk,
  }));
}

// ---------------------------------------------------------------------------
// Cost estimation (caller-facing pre-flight)
// ---------------------------------------------------------------------------

/**
 * Compute the cost estimate shown to users before they opt in to Deep
 * DD. Assumes every section drives one leaf call, every doc drives one
 * synth call, and one final call runs across all docs. Matches the
 * structure implemented by `runDeepDiligence` below.
 */
export function estimateDeepDiligenceCost(
  docs: DiligenceDocInput[],
  sectionMaxChars = 8000,
): number {
  const sections = docs.flatMap((d) => sectionDocument(d.text, sectionMaxChars));
  const leafCalls = sections.map((s) => ({
    role: "leaf" as const,
    promptChars: s.body.length + 2000, // + template overhead
    maxOutputTokens: 2000,
  }));
  const synthCalls = docs.map(() => ({
    role: "synth" as const,
    promptChars: 20_000, // leaves roll up here
    maxOutputTokens: 3000,
  }));
  const finalCall = {
    role: "final" as const,
    promptChars: Math.min(40_000, docs.length * 3000 + 2000),
    maxOutputTokens: 4000,
  };
  return RLMRouter.estimateCost([...leafCalls, ...synthCalls, finalCall]);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const LEAF_SYSTEM = `You are a senior energy-technology analyst performing due diligence.
Extract every claim, number, risk, dependency, contradiction, or commitment
from THIS SECTION that is relevant to the question below. Do NOT infer from
general knowledge — stay grounded in the section text.

Return strict JSON:
{
  "claims": [
    {
      "claim": "<one-sentence claim>",
      "evidence": "<exact quote or tight paraphrase, <=200 chars>",
      "confidence": "low" | "medium" | "high",
      "severity": "informational" | "notable" | "critical"
    }
  ],
  "risks": ["<risk 1>", "<risk 2>", ...],
  "open_questions": ["<question 1>", ...]
}`;

const SYNTH_SYSTEM = `You are a senior energy-technology analyst reconciling leaf extractions
from a single document. Consolidate claims, deduplicate, and flag
contradictions within this document. Preserve the source evidence quotes.

Return strict JSON:
{
  "doc_summary": "<2-3 sentence summary of this doc's position>",
  "findings": [
    {
      "claim": "<claim>",
      "evidence": "<quote>",
      "section_path": "<section heading path>",
      "confidence": "low" | "medium" | "high",
      "severity": "informational" | "notable" | "critical"
    }
  ],
  "internal_contradictions": [
    {
      "topic": "<what's in conflict>",
      "positions": [
        {"section_path": "<path>", "claim": "<claim>"}
      ],
      "analysis": "<which position is better supported and why>"
    }
  ],
  "risks": ["<risk 1>", ...],
  "open_questions": ["<q 1>", ...]
}`;

const FINAL_SYSTEM = `You are the lead analyst producing a Deep Due Diligence brief.
You have per-document syntheses from multiple sources. Produce a final
brief that (a) highlights material findings with severity and confidence,
(b) flags INTER-DOCUMENT contradictions where sources disagree, (c) lists
concrete risks and gaps, and (d) recommends next diligence steps.

Every finding must cite a specific source document. Contradictions must
cite both sides. Do NOT invent claims — if something isn't in the
per-document syntheses, put it under "gaps" instead.

Return strict JSON:
{
  "executive_summary": "<3-5 sentences>",
  "findings": [
    {
      "claim": "<claim>",
      "evidence": "<quote>",
      "source_doc": "<doc name>",
      "section_path": "<section path>",
      "confidence": "low" | "medium" | "high",
      "severity": "informational" | "notable" | "critical"
    }
  ],
  "contradictions": [
    {
      "topic": "<what's in conflict>",
      "positions": [
        {"doc": "<doc name>", "section_path": "<path>", "claim": "<claim>"}
      ],
      "analysis": "<which side is stronger; what would resolve it>"
    }
  ],
  "risks": ["<risk 1>", ...],
  "gaps": ["<gap 1>", ...],
  "recommended_next_steps": ["<step 1>", ...]
}`;

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface LeafOutput {
  claims?: Array<{ claim: string; evidence: string; confidence: DiligenceConfidence; severity: DiligenceSeverity }>;
  risks?: string[];
  open_questions?: string[];
}

interface SynthOutput {
  doc_summary?: string;
  findings?: DiligenceFinding[];
  internal_contradictions?: DiligenceContradiction[];
  risks?: string[];
  open_questions?: string[];
}

function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export async function runDeepDiligence(
  input: DeepDiligenceInput,
  opts: DeepDiligenceOptions = {},
): Promise<DeepDiligenceResult> {
  const router = opts.router ?? new RLMRouter({
    maxUsdBudget: opts.maxUsdBudget,
    maxDepth: opts.maxDepth,
  });
  const sectionMaxChars = opts.sectionMaxChars ?? 8000;

  const context = input.context || "(no additional context)";

  // Section every document up front so we can compute totals + trace.
  const docSections = input.docs.map((doc) => ({
    name: doc.name,
    sections: sectionDocument(doc.text, sectionMaxChars),
  }));
  const totalSections = docSections.reduce((a, d) => a + d.sections.length, 0);

  const findings: DiligenceFinding[] = [];
  const contradictions: DiligenceContradiction[] = [];
  const risks: string[] = [];
  const gaps: string[] = [];

  let fallback: DeepDiligenceResult["fallback_used"] = null;
  let partialAt: DeepDiligenceResult["partial_at_stage"] | undefined;
  let leafCalls = 0;
  let synthCalls = 0;
  let finalCalls = 0;

  const perDocSynth: Array<{ doc: string; synth: SynthOutput }> = [];

  try {
    // ── Leaf pass ────────────────────────────────────────────────
    for (const doc of docSections) {
      const perDocLeaves: Array<{ section: Section; leaf: LeafOutput | null }> = [];
      for (const section of doc.sections) {
        const user = [
          `Question: ${input.question}`,
          `Project context: ${context}`,
          `Document: ${doc.name}`,
          `Section path: ${section.headingPath.join(" > ") || "(root)"}`,
          ``,
          `SECTION TEXT:`,
          section.body,
        ].join("\n");
        const { text } = await router.complete("leaf", LEAF_SYSTEM, user, { maxTokens: 2000 });
        leafCalls += 1;
        const parsed = parseJsonLoose<LeafOutput>(text);
        perDocLeaves.push({ section, leaf: parsed });
      }

      // ── Synth per doc ─────────────────────────────────────────
      partialAt = "synth";
      const leavesBlock = perDocLeaves
        .map(({ section, leaf }) => {
          const path = section.headingPath.join(" > ") || "(root)";
          return (
            `### Section: ${path}\n` +
            `Heading: ${section.heading}\n` +
            `Leaf JSON:\n${leaf ? JSON.stringify(leaf) : '{"claims": []}'}\n`
          );
        })
        .join("\n");
      const synthUser = [
        `Question: ${input.question}`,
        `Project context: ${context}`,
        `Document: ${doc.name}`,
        ``,
        `LEAF EXTRACTIONS FROM ALL SECTIONS:`,
        leavesBlock,
      ].join("\n");
      const { text: synthText } = await router.complete("synth", SYNTH_SYSTEM, synthUser, {
        maxTokens: 3500,
      });
      synthCalls += 1;
      const synth = parseJsonLoose<SynthOutput>(synthText) ?? {};
      perDocSynth.push({ doc: doc.name, synth });

      // Fold per-doc findings into the running aggregate (used both for
      // the final prompt and for the fallback partial brief).
      (synth.findings ?? []).forEach((f) => {
        findings.push({ ...f, source_doc: doc.name });
      });
      (synth.internal_contradictions ?? []).forEach((c) => {
        contradictions.push({
          topic: c.topic,
          positions: c.positions.map((p) => ({
            doc: doc.name,
            section_path: p.section_path,
            claim: p.claim,
          })),
          analysis: c.analysis,
        });
      });
      asStringArray(synth.risks).forEach((r) => risks.push(r));
      asStringArray(synth.open_questions).forEach((q) => gaps.push(q));
      partialAt = "leaf"; // reset marker to leaf for the next doc iteration
    }

    // ── Final cross-doc synthesis ─────────────────────────────────
    partialAt = "final";
    const synthBlock = perDocSynth
      .map(({ doc, synth }) => `### ${doc}\n${JSON.stringify(synth)}\n`)
      .join("\n");
    const finalUser = [
      `Question: ${input.question}`,
      `Project context: ${context}`,
      ``,
      `PER-DOCUMENT SYNTHESES:`,
      synthBlock,
    ].join("\n");
    const { text: finalText } = await router.complete("final", FINAL_SYSTEM, finalUser, {
      maxTokens: 4000,
    });
    finalCalls += 1;
    const finalParsed = parseJsonLoose<Partial<DeepDiligenceResult>>(finalText);
    if (finalParsed) {
      return {
        question: input.question,
        executive_summary: (finalParsed.executive_summary as string) || "",
        findings: (finalParsed.findings as DiligenceFinding[]) || findings,
        contradictions:
          (finalParsed.contradictions as DiligenceContradiction[]) || contradictions,
        risks: asStringArray(finalParsed.risks).length ? asStringArray(finalParsed.risks) : risks,
        gaps: asStringArray(finalParsed.gaps).length ? asStringArray(finalParsed.gaps) : gaps,
        recommended_next_steps: asStringArray(finalParsed.recommended_next_steps),
        // Preserve the full per-doc aggregate so the final model's curation
        // never silently drops earlier-stage findings.
        per_doc_findings: findings,
        per_doc_contradictions: contradictions,
        per_doc_risks: risks,
        per_doc_gaps: gaps,
        n_docs: input.docs.length,
        n_sections: totalSections,
        n_leaf_calls: leafCalls,
        n_synth_calls: synthCalls,
        n_final_calls: finalCalls,
        model_cost_usd: router.spentUsd,
        trajectory: router.fullTrajectory,
        fallback_used: null,
      };
    }
    // Final model returned unparseable output — fall through to the
    // aggregated-partial brief path below. `partialAt` is already set to
    // "final" above; no reassignment needed.
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      fallback = "budget_exceeded";
    } else if (err instanceof DepthExceededError) {
      fallback = "depth_exceeded";
    } else {
      throw err;
    }
  }

  return {
    question: input.question,
    executive_summary:
      fallback === "budget_exceeded"
        ? "Budget ceiling reached before final synthesis. Returning partial findings from completed stages."
        : fallback === "depth_exceeded"
          ? "Depth cap reached. Returning partial findings from completed stages."
          : "Final synthesis produced no parseable output. Returning aggregated per-doc findings.",
    findings,
    contradictions,
    risks,
    gaps,
    recommended_next_steps: [],
    // In fallback paths, the "curated" findings ARE the per-doc aggregate,
    // so we expose the same values under both fields for API stability.
    per_doc_findings: findings,
    per_doc_contradictions: contradictions,
    per_doc_risks: risks,
    per_doc_gaps: gaps,
    n_docs: input.docs.length,
    n_sections: totalSections,
    n_leaf_calls: leafCalls,
    n_synth_calls: synthCalls,
    n_final_calls: finalCalls,
    model_cost_usd: router.spentUsd,
    trajectory: router.fullTrajectory,
    fallback_used: fallback,
    partial_at_stage: partialAt,
  };
}
