/**
 * Deep Research Pipeline
 *
 * GREP-inspired iterative research: plan -> search loop -> synthesize -> review.
 * Single module — types, prompts, and orchestration all in one file.
 *
 * Model routing per phase (mirrors Python harness 3-tier architecture):
 *   Plan/Review → GLM-5.1 (agentic SOTA)
 *   Synthesize/Revise → Qwen 3.6 Plus (best reasoning)
 *   Gap queries → DeepSeek V4-Flash (cheap, low stakes)
 * All models fall back gracefully: GLM → Qwen → DeepSeek V4-Flash.
 *
 * Requires at least DEEPSEEK_API_KEY. Offline users should use the existing
 * "literature_search" action instead.
 */

import { callDeepSeekV3, callQwen36Plus, callGLM51, getEnvVar, listDecisionBriefs } from "@/lib/backend";
import { getStorage } from "@/lib/storage";
import { logDebug } from "@/lib/debug-log";

// ── Types ─────────────────────────────────────────────────────────

interface Subtopic {
  id: string;
  title: string;
  queries: string[];
}

interface ResearchPlan {
  subtopics: Subtopic[];
  domain: string;
}

interface PaperResult {
  title: string;
  citation: string;
  source_id: string;
  source_type: string;
  relevance_score: number;
  quote: string;
  subtopic_id: string;
}

export interface DeepResearchSourceDocument {
  document_id?: string;
  filename: string;
  source_type: "uploaded_document" | "multimodal_pdf" | "text_sidecar" | "project_artifact";
  text: string;
  parser?: string;
}

interface ReviewResult {
  claims_with_issues: Array<{
    claim: string;
    issue: "unsupported" | "contradicted" | "overstated";
    note: string;
  }>;
  coverage_gaps: string[];
  verdict: "pass" | "revise";
  revision_guidance: string;
}

export interface DeepResearchResult {
  plan: ResearchPlan;
  papers: PaperResult[];
  source_documents: DeepResearchSourceDocument[];
  synthesis: Record<string, unknown>;
  review: ReviewResult;
  iterations: number;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Model routing per research role (mirrors Python harness tiers):
 *   - Planning/Review → GLM-5.1 (agentic SOTA, best at planning & fact-checking)
 *   - Synthesis/Revision → Qwen 3.6 Plus (best reasoning & long-form generation)
 *   - Gap queries → DeepSeek V4-Flash (low stakes, keep cheap)
 *
 * All functions fall back automatically: GLM → Qwen → DeepSeek V4-Flash
 */

function parseJSON(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Deep research: LLM returned no JSON object");
  return JSON.parse(match[0]);
}

/** Planning & review calls → GLM-5.1 (agentic SOTA). */
async function callPlanningLLM(
  system: string,
  user: string,
  maxTokens = 6000,
): Promise<Record<string, unknown>> {
  const raw = await callGLM51(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { temperature: 0.2, maxTokens, jsonMode: true },
  );
  return parseJSON(raw);
}

/** Synthesis & revision calls → Qwen 3.6 Plus (best reasoning). */
async function callSynthesisLLM(
  system: string,
  user: string,
  maxTokens = 6000,
): Promise<Record<string, unknown>> {
  const raw = await callQwen36Plus(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { temperature: 0.2, maxTokens, jsonMode: true },
  );
  return parseJSON(raw);
}

/** Low-stakes utility calls → DeepSeek V4-Flash (cheapest). */
async function callUtilityLLM(
  system: string,
  user: string,
  maxTokens = 2000,
): Promise<Record<string, unknown>> {
  const raw = await callDeepSeekV3(
    [{ role: "system", content: system }, { role: "user", content: user }],
    { temperature: 0.2, maxTokens, jsonMode: true },
  );
  return parseJSON(raw);
}

/**
 * Run the Python literature search CLI for a single query.
 * Accepts runPython as a dependency so this module stays decoupled from route.ts.
 */
async function searchLiterature(
  runPython: RunPythonFn,
  query: string,
  domain: string,
  limit = 10,
): Promise<PaperResult[]> {
  try {
    const result = await runPython([
      "-m", "breakthrough_engine", "literature", "search",
      "--query", query, "--domain", domain, "--limit", String(limit), "--json",
    ]);
    if (result.code !== 0 || !result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout);
    const results = (parsed?.results as Array<Record<string, unknown>>) || [];
    return results.map((r) => ({
      title: (r.title as string) || "",
      citation: (r.citation as string) || "",
      source_id: (r.source_id as string) || "",
      source_type: (r.source_type as string) || "",
      relevance_score: (r.relevance_score as number) || 0,
      quote: ((r.quote as string) || "").slice(0, 300),
      subtopic_id: "",
    }));
  } catch {
    return [];
  }
}

/** Deduplicate papers by title (case-insensitive). */
function deduplicatePapers(papers: PaperResult[]): PaperResult[] {
  const seen = new Set<string>();
  return papers.filter((p) => {
    const key = p.title.toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Build grounding context from existing decision briefs. */
async function buildContext(domain: string): Promise<string> {
  const briefs = await listDecisionBriefs();
  if (briefs.length === 0) return "";
  const relevant = domain === "general"
    ? briefs.slice(0, 5)
    : briefs.filter((b) => {
        const bt = b.brief_type ?? "decision";
        return bt === "decision" ? (domain === "battery" || domain === "pv") : true;
      }).slice(0, 5);
  if (relevant.length === 0) return "";
  const lines = relevant.map(
    (b) => `- ${b.title || b.headline}: Score ${b.final_score}, Family: ${b.candidate_family}`,
  );
  return `EXISTING ENGINE DATA (${briefs.length} briefs, showing ${lines.length}):\n${lines.join("\n")}`;
}

// ── Type for the runPython dependency ─────────────────────────────

type RunPythonFn = (
  args: string[],
  timeout?: number,
) => Promise<{ stdout: string; stderr: string; code: number }>;

// ── Phase 1: Planning ─────────────────────────────────────────────

async function createPlan(
  question: string,
  domain: string,
  projectContext: string,
): Promise<ResearchPlan> {
  logDebug("action", "Planning research", { domain });

  const system = `You are a research planner for Exergy Lab, an energy technology evaluation platform.
Your job is to decompose a research question into 3-5 independent subtopics that can be searched separately.

For each subtopic, provide 2-3 targeted academic search queries that would find relevant papers.
Queries should be specific enough to return useful results from OpenAlex and Semantic Scholar.

${projectContext}

Respond in JSON:
{
  "subtopics": [
    {
      "id": "st_01",
      "title": "Short descriptive title",
      "queries": ["search query 1", "search query 2"]
    }
  ]
}`;

  const result = await callPlanningLLM(system, question);
  const subtopics = (result.subtopics as Subtopic[]) || [];
  if (subtopics.length === 0) {
    throw new Error("Planner returned no subtopics");
  }
  // Ensure IDs exist
  for (let i = 0; i < subtopics.length; i++) {
    if (!subtopics[i].id) subtopics[i].id = `st_${String(i + 1).padStart(2, "0")}`;
  }

  logDebug("action", `Plan: ${subtopics.length} subtopics`, {
    subtopics: subtopics.map((s) => s.title),
  });

  return { subtopics, domain };
}

// ── Phase 2: Iterative Search ─────────────────────────────────────

async function searchIteration(
  runPython: RunPythonFn,
  plan: ResearchPlan,
  existingPapers: PaperResult[],
): Promise<{ papers: PaperResult[]; gapSubtopics: Subtopic[] }> {
  const allPapers = [...existingPapers];

  for (const subtopic of plan.subtopics) {
    // Skip subtopics that already have papers
    const existing = allPapers.filter((p) => p.subtopic_id === subtopic.id);
    if (existing.length >= 3) continue;

    for (const query of subtopic.queries) {
      const results = await searchLiterature(runPython, query, plan.domain);
      for (const paper of results) {
        paper.subtopic_id = subtopic.id;
      }
      allPapers.push(...results);
    }
  }

  const deduped = deduplicatePapers(allPapers);

  // Identify gap subtopics (0 papers found)
  const gapSubtopics = plan.subtopics.filter(
    (st) => deduped.filter((p) => p.subtopic_id === st.id).length === 0,
  );

  return { papers: deduped, gapSubtopics };
}

/** Ask DeepSeek for alternative queries for subtopics that returned no papers. */
async function generateGapQueries(
  gapSubtopics: Subtopic[],
  originalQuestion: string,
): Promise<Subtopic[]> {
  if (gapSubtopics.length === 0) return [];

  logDebug("action", `Generating alternative queries for ${gapSubtopics.length} gap subtopics`);

  const system = `You are helping find academic papers. The following research subtopics returned zero results
from academic databases. Suggest 2-3 alternative search queries for each, using different terminology,
synonyms, or broader/narrower framing.

Respond in JSON:
{
  "subtopics": [
    { "id": "st_XX", "title": "...", "queries": ["alt query 1", "alt query 2"] }
  ]
}`;

  const user = `Original question: ${originalQuestion}

Subtopics with no results:
${gapSubtopics.map((s) => `- ${s.id}: ${s.title} (tried: ${s.queries.join(", ")})`).join("\n")}`;

  const result = await callUtilityLLM(system, user, 2000);
  return (result.subtopics as Subtopic[]) || [];
}

// ── Phase 3: Synthesis ────────────────────────────────────────────

async function synthesize(
  question: string,
  plan: ResearchPlan,
  papers: PaperResult[],
  domain: string,
  projectContext: string,
  sourceDocuments: DeepResearchSourceDocument[] = [],
): Promise<Record<string, unknown>> {
  logDebug("action", `Synthesizing ${papers.length} papers across ${plan.subtopics.length} subtopics`);

  // Organize papers by subtopic for the prompt
  const papersBySubtopic = plan.subtopics.map((st) => {
    const stPapers = papers.filter((p) => p.subtopic_id === st.id);
    if (stPapers.length === 0) return `\n## ${st.title}\nNo papers found for this subtopic.`;
    const paperList = stPapers
      .slice(0, 8)
      .map((p) => `- "${p.title}" (${p.citation}) [relevance=${p.relevance_score}]\n  ${p.quote}`)
      .join("\n");
    return `\n## ${st.title}\n${paperList}`;
  });

  let exergyBlock = "";
  try {
    const { buildExergyPromptBlock } = require("@/lib/domain-physics");
    if (domain !== "general") exergyBlock = buildExergyPromptBlock(domain);
  } catch { exergyBlock = ""; }

  const system = `You are a technical research analyst for Exergy Lab, an energy technology evaluation platform.
You have been given papers and, when available, uploaded or multimodal source documents organized by research subtopic. Synthesize them into a structured research report.

${projectContext}
${exergyBlock}

RULES:
- Every finding must cite a specific paper by title
- Uploaded or multimodal source documents can support document-specific findings; cite them by filename
- If a subtopic had no papers, note it as a gap — do not fabricate findings
- Distinguish between established facts, recent findings, and unvalidated claims
- Be specific about numbers, metrics, and experimental conditions
- Identify contradictions between sources

Respond in JSON:
{
  "executive_summary": "2-3 sentence overview of findings across all subtopics",
  "findings": [
    {
      "statement": "The key finding with specific data",
      "source": "Author, Journal, Year",
      "evidence_strength": "strong|moderate|weak|unverified",
      "relevance": "high|medium|low",
      "challenges_assumption": null
    }
  ],
  "competitive_landscape": [
    {"approach": "name", "best_result": "metric", "maturity": "TRL 1-9", "key_risk": "description"}
  ],
  "identified_gaps": ["gap 1", "gap 2"],
  "suggested_followups": ["action 1", "action 2"]
}`;

  const sourceDocBlock = sourceDocuments.length > 0
    ? `\n\nUPLOADED / MULTIMODAL SOURCE DOCUMENTS:\n${sourceDocuments.map((doc) => [
        `## ${doc.filename} (${doc.source_type}${doc.parser ? `, ${doc.parser}` : ""})`,
        doc.text.slice(0, 12000),
      ].join("\n")).join("\n\n")}`
    : "";

  const user = `Research question: ${question}\n\nPAPERS BY SUBTOPIC:${papersBySubtopic.join("\n")}${sourceDocBlock}`;

  return callSynthesisLLM(system, user, 6000);
}

// ── Phase 4: Review ───────────────────────────────────────────────

async function review(
  synthesis: Record<string, unknown>,
  papers: PaperResult[],
): Promise<ReviewResult> {
  logDebug("action", "Reviewing synthesis against sources");

  const findings = (synthesis.findings as Array<Record<string, unknown>>) || [];
  const findingsSummary = findings
    .slice(0, 15)
    .map((f, i) => `${i + 1}. "${f.statement}" — cited source: ${f.source}`)
    .join("\n");

  const paperSummary = papers
    .slice(0, 20)
    .map((p) => `- "${p.title}" (${p.citation}): ${p.quote}`)
    .join("\n");

  const system = `You are a research fact-checker. Compare the synthesis findings against the actual source papers.
Flag any claim that is not supported by the papers, contradicted by them, or overstated beyond what the evidence shows.

Respond in JSON:
{
  "claims_with_issues": [
    {
      "claim": "the problematic claim text",
      "issue": "unsupported|contradicted|overstated",
      "note": "brief explanation"
    }
  ],
  "coverage_gaps": ["topics that needed more research"],
  "verdict": "pass|revise",
  "revision_guidance": "if verdict is revise, what specifically needs fixing"
}

If all claims are well-supported, return verdict "pass" with empty claims_with_issues.`;

  const user = `SYNTHESIS FINDINGS:\n${findingsSummary}\n\nSOURCE PAPERS:\n${paperSummary}`;

  const result = await callPlanningLLM(system, user, 3000);

  return {
    claims_with_issues: (result.claims_with_issues as ReviewResult["claims_with_issues"]) || [],
    coverage_gaps: (result.coverage_gaps as string[]) || [],
    verdict: result.verdict === "revise" ? "revise" : "pass",
    revision_guidance: (result.revision_guidance as string) || "",
  };
}

// ── Revision pass ─────────────────────────────────────────────────

async function revise(
  synthesis: Record<string, unknown>,
  reviewResult: ReviewResult,
  papers: PaperResult[],
  question: string,
): Promise<Record<string, unknown>> {
  logDebug("action", "Revising synthesis based on review feedback");

  const paperSummary = papers
    .slice(0, 15)
    .map((p) => `- "${p.title}" (${p.citation}): ${p.quote}`)
    .join("\n");

  const system = `You are revising a research synthesis based on fact-checker feedback.
Fix the issues identified. Remove or correct unsupported claims. Do not add new claims
that are not grounded in the source papers.

Respond in the same JSON format as the original synthesis:
{
  "executive_summary": "...",
  "findings": [...],
  "competitive_landscape": [...],
  "identified_gaps": [...],
  "suggested_followups": [...]
}`;

  const issues = reviewResult.claims_with_issues
    .map((c) => `- ${c.issue}: "${c.claim}" — ${c.note}`)
    .join("\n");

  const user = `Original question: ${question}

REVIEW FEEDBACK:
${reviewResult.revision_guidance}

SPECIFIC ISSUES:
${issues}

ORIGINAL SYNTHESIS:
${JSON.stringify(synthesis, null, 2).slice(0, 4000)}

SOURCE PAPERS:
${paperSummary}`;

  return callSynthesisLLM(system, user, 6000);
}

// ── Main Entry Point ──────────────────────────────────────────────

/**
 * Execute the full deep research pipeline.
 *
 * @param runPython — the subprocess helper from route.ts (passed as dependency)
 */
export async function executeDeepResearch(
  projectId: string,
  question: string,
  domain: string,
  runPython: RunPythonFn,
  options: { sourceDocuments?: DeepResearchSourceDocument[] } = {},
): Promise<DeepResearchResult> {
  // Fail fast if no API key
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) {
    throw new Error(
      "Deep research requires DEEPSEEK_API_KEY. Use literature_search for offline paper retrieval.",
    );
  }

  logDebug("action", `Starting deep research: "${question.slice(0, 80)}"`, { domain });

  // 1. Gather context
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  const artifacts = await storage.listArtifacts(projectId);
  const engineContext = await buildContext(domain);
  const sourceDocuments = (options.sourceDocuments || [])
    .filter((doc) => doc.text && doc.text.trim())
    .slice(0, 8);

  const projectContext = [
    project ? `Project: ${project.name} — ${project.description}` : "",
    project?.goal ? `Goal: ${project.goal}` : "",
    `Domain: ${domain}`,
    artifacts.length > 0
      ? `Existing work: ${artifacts.slice(0, 5).map((a) => `${a.type}: ${a.title}`).join("; ")}`
      : "",
    sourceDocuments.length > 0
      ? `Uploaded or multimodal source documents available: ${sourceDocuments.map((doc) => doc.filename).join("; ")}`
      : "",
    engineContext,
  ].filter(Boolean).join("\n");

  // 2. Plan
  const plan = await createPlan(question, domain, projectContext);

  // 3. Search — iteration 1
  let { papers, gapSubtopics } = await searchIteration(runPython, plan, []);
  let iterations = 1;

  if (sourceDocuments.length > 0) {
    const sourceTopic: Subtopic = {
      id: "uploaded_sources",
      title: "Uploaded and multimodal source documents",
      queries: [],
    };
    plan.subtopics = [sourceTopic, ...plan.subtopics.filter((subtopic) => subtopic.id !== sourceTopic.id)];
    papers = [
      ...sourceDocuments.map((doc, index) => ({
        title: doc.filename,
        citation: `${doc.filename}${doc.parser ? `, parsed by ${doc.parser}` : ""}`,
        source_id: doc.document_id || `source_doc_${index + 1}`,
        source_type: doc.source_type,
        relevance_score: 1,
        quote: doc.text.slice(0, 300),
        subtopic_id: sourceTopic.id,
      })),
      ...papers,
    ];
  }

  logDebug("action", `Iteration 1: ${papers.length} papers, ${gapSubtopics.length} gaps`);

  // 3b. Search — iteration 2 (only if gaps exist)
  if (gapSubtopics.length > 0) {
    const altSubtopics = await generateGapQueries(gapSubtopics, question);
    if (altSubtopics.length > 0) {
      // Replace queries for gap subtopics and re-search
      const augmentedPlan: ResearchPlan = {
        ...plan,
        subtopics: altSubtopics, // only search the gap subtopics
      };
      const iter2 = await searchIteration(runPython, augmentedPlan, papers);
      papers = iter2.papers;
      iterations = 2;
      logDebug("action", `Iteration 2: ${papers.length} papers total`);
    }
  }

  // 4. Synthesize
  let synthesis = await synthesize(question, plan, papers, domain, projectContext, sourceDocuments);

  // 5. Review
  const reviewResult = await review(synthesis, papers);
  logDebug("action", `Review verdict: ${reviewResult.verdict}`, {
    issues: reviewResult.claims_with_issues.length,
  });

  // 5b. Revise if needed (one pass only)
  if (reviewResult.verdict === "revise" && reviewResult.claims_with_issues.length > 0) {
    synthesis = await revise(synthesis, reviewResult, papers, question);
  }

  logDebug("action", `Complete: ${papers.length} papers, ${iterations} iterations`);

  return { plan, papers, source_documents: sourceDocuments, synthesis, review: reviewResult, iterations };
}
