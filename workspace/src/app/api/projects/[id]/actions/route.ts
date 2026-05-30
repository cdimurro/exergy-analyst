export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { runSimulation as runBatterySimulation, type CellParams } from "@/lib/battery-sim";
import { runPVSimulation, defaultPVParams } from "@/lib/pv-sim";
import { runInverterSimulation, defaultInverterParams } from "@/lib/inverter-sim";
import type { SimDomain } from "@/lib/sim-types";
import { join } from "path";
import { getEnvVar, RUNTIME_DIR, DEEPSEEK_API_URL, callDeepSeekV3 } from "@/lib/backend";
import { logDebug } from "@/lib/debug-log";
import type { ActionType, ArtifactType, Artifact, ProjectDocument, Action } from "@/lib/storage/types";
import { executeDeepResearch, type DeepResearchSourceDocument } from "@/lib/deep-research";
import {
  executeDeepAgent,
  type DeepAgentPlanStep,
} from "@/lib/deep-agent";
import { runDeepDiligence, estimateDeepDiligenceCost } from "@/lib/deep-diligence";
import type { DiligenceDocInput } from "@/lib/deep-diligence";
import { classifyWorkspaceIntent } from "@/lib/intent-guardrail";
import { callQwen36Plus, callGLM51 } from "@/lib/backend";
import { validateParams, validateEvaluation, validateBrief } from "@/lib/validation";
import {
  renderMethodology,
  renderNoBackingCaveat,
  allowsPositiveReadinessLanguage,
  type SolverStatusInput,
} from "@/lib/solver-status";
import {
  selectRationalizations,
  formatRationalizationsForPrompt,
} from "@/lib/prompts/rationalizations";
import {
  selectRedFlags,
  formatRedFlagsForPrompt,
} from "@/lib/prompts/red-flags";
import {
  catalogDomainFromProjectDomain,
  countUnresolved,
  countUnresolvedBlockers,
} from "@/lib/prompts/policy";
import { resolveDatasheetDispatch } from "@/lib/datasheet-dispatch";
import { resolveMockSidecar } from "@/lib/mock-sidecar";
import { evaluateIntakeGate } from "@/lib/evidence-intake-gate";
import {
  buildExergyArtifactInput,
  getProjectUploadPaths,
  runExergyWorkspaceAgent,
} from "@/lib/exergy-agent";
import { buildActionResultSummary } from "@/lib/action-result-summary";
import { collectEnvironmentalSiteData } from "@/lib/environmental-site-data";
import {
  runEconomicsSolver,
  runPhysicsSolver,
  type EngineeringSolverResult,
} from "@/lib/engineering-solvers";
import { ensurePdfTextSidecars, runAgentWorkspaceTask } from "@/lib/agent-workspace-runner";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const PYTHON = getEnvVar("PYTHON_PATH") || join(REPO_ROOT, ".venv", "bin", "python");

// ── Helpers ────────────────────────────────────────────────────────

function normalizeUploadName(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractReferencedUploadNames(input: Record<string, unknown>): string[] {
  const chunks = Object.values(input)
    .flatMap((value) => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
      return [];
    })
    .join("\n");
  const names: string[] = [];
  for (const match of chunks.matchAll(/\[Attached:\s*([^\]]+)\]/gi)) {
    const listed = match[1] || "";
    for (const name of listed.split(/\s*,\s*/)) {
      const clean = normalizeUploadName(name);
      if (clean) names.push(clean);
    }
  }
  const explicit = input.filename || input.file_name || input.document || input.source_filename;
  if (typeof explicit === "string") names.push(normalizeUploadName(explicit));
  return Array.from(new Set(names.filter(Boolean)));
}

function filterReferencedDocs<T extends { filename?: string }>(docs: T[], referencedNames: string[]): T[] {
  const validDocs = docs.filter((doc) => typeof doc.filename === "string" && doc.filename.trim().length > 0);
  if (referencedNames.length === 0) return validDocs;
  const normalizedRefs = referencedNames.map((name) => normalizeUploadName(name).toLowerCase());
  const selected = validDocs.filter((doc) => {
    const filename = normalizeUploadName(doc.filename || "").toLowerCase();
    if (!filename) return false;
    return normalizedRefs.some((ref) => filename === ref || filename.includes(ref) || ref.includes(filename));
  });
  return selected.length > 0 ? selected : validDocs;
}

function shouldUseWorkspaceForDocumentRequest(prompt: string, selectedDocs: ProjectDocument[]): boolean {
  if (selectedDocs.length < 2) return false;
  const lower = prompt.toLowerCase();
  return /\b(simulat|model|economics?|economic|financial|breakeven|break even|capex|opex|exergy|pilot|scale|recommend|report|sensitivity|optimi[sz]e)\b/.test(lower);
}

async function resolveEvidenceCollectionDocumentPath(docPath: string): Promise<string> {
  if (!/\.pdf$/i.test(docPath)) return docPath;
  await ensurePdfTextSidecars(docPath);
  for (const suffix of [".gemini.md", ".mineru.md"]) {
    const sidecar = `${docPath}${suffix}`;
    const { existsSync } = await import("fs");
    if (existsSync(sidecar)) return sidecar;
  }
  return docPath;
}

function docTypeLabel(doc: ProjectDocument): string {
  const fromMime = doc.mime_type ? doc.mime_type.split("/").pop() || doc.mime_type : "";
  const fromName = doc.filename.includes(".") ? doc.filename.split(".").pop() || "" : "";
  return (fromMime || fromName || "uploaded file").replace(/[-_]+/g, " ");
}

function buildAgentRuntimeFallbackRun(args: {
  prompt: string;
  docs: ProjectDocument[];
  uploadPaths: string[];
  error: unknown;
}): Record<string, unknown> {
  const errorText = args.error instanceof Error ? args.error.message : String(args.error || "Unknown analysis runtime error");
  const files = args.docs.map((doc) => ({
    filename: doc.filename,
    file_type: docTypeLabel(doc),
    size_bytes: doc.size_bytes,
    size_label: `${Math.max(1, Math.round(doc.size_bytes / 1024))} KB`,
    parser_status: "uploaded; analysis runtime fallback used",
    summary: "The file was uploaded and retained, but the full analysis runtime could not complete this run.",
    detected_use_cases: ["file-intake"],
  }));
  const filenames = args.docs.map((doc) => doc.filename).join(", ") || "the current upload";
  return {
    prompt: args.prompt,
    executive_answer: `I could not complete the full tool run, but I can still confirm the current evidence package was received: ${filenames}. Treat this as a recovery response, not a completed analysis.`,
    memo_markdown: [
      "# Client Analysis Memo",
      "",
      "## Bottom Line",
      `I could not complete the full tool run, but I can still confirm the current evidence package was received: ${filenames}. Treat this as a recovery response, not a completed analysis.`,
      "",
      "## What I Could Verify",
      `- Uploaded file(s): ${filenames}.`,
      `- Runtime file path(s) available: ${args.uploadPaths.length}.`,
      "",
      "## What This Cannot Prove Yet",
      "- The document contents were not fully analyzed in this run.",
      "- No performance, economics, environmental, safety, or investment conclusion should be treated as supported yet.",
      "",
      "## Next Step",
      "- Retry the analysis after checking the analysis runtime, or provide a text-searchable export so the answer can be grounded directly in the source content.",
    ].join("\n"),
    detected_use_cases: ["file-intake", "general-analysis"],
    files,
    stages: [
      {
        name: "Intake",
        status: "completed",
        summary: `Received ${args.docs.length} uploaded file(s).`,
        detail: filenames,
      },
      {
        name: "Tool Execution",
        status: "failed",
        summary: "The full analysis runtime did not complete.",
        detail: errorText.slice(0, 500),
      },
      {
        name: "Recovery Synthesis",
        status: "completed",
        summary: "Returned a bounded recovery response instead of failing the chat turn.",
        detail: "The response preserves current-file context and states what is not supported.",
      },
    ],
    tool_calls: [
      {
        tool: "inspect_upload",
        input: filenames,
        output: `${args.docs.length} current upload(s) available to the action route.`,
        status: "completed",
      },
      {
        tool: "run_workspace_agent",
        input: `${args.uploadPaths.length} runtime path(s), prompt length ${args.prompt.length}`,
        output: errorText.slice(0, 500),
        status: "failed",
      },
      {
        tool: "recover_client_response",
        input: "failed tool run",
        output: "bounded recovery artifact returned",
        status: "completed",
      },
    ],
    physics_screens: [],
    top_insights: [
      {
        title: "The current upload was preserved for analysis",
        evidence: `The request references ${filenames}.`,
        recommendation: "Retry the analysis after runtime recovery, or upload a text/table export if the source is a complex PDF.",
        support: "observed",
      },
    ],
    limitations: [
      "The full analysis runtime failed before producing source-grounded findings.",
      "This fallback does not validate technical, economic, environmental, safety, or deployment claims.",
    ],
    next_actions: [
      "Retry the current analysis after checking the analysis runtime logs.",
      "If the file is a complex PDF, confirm local MinerU 2.5 Pro is installed/configured or upload a searchable text/table export.",
    ],
    confidence: "not_enough_evidence",
    recovery: {
      used: true,
      reason: errorText.slice(0, 1000),
    },
  };
}

function workspaceAgentTimeoutMs(uploadPaths: string[]): number {
  const pdfCount = uploadPaths.filter((path) => /\.pdf$/i.test(path)).length;
  const base = 4 * 60_000;
  const perFile = 90_000;
  const perPdf = 90_000;
  return Math.min(10 * 60_000, base + uploadPaths.length * perFile + pdfCount * perPdf);
}

async function runPython(args: string[], timeout = 120_000): Promise<{ stdout: string; stderr: string; code: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const envVars: Record<string, string> = {
    ...(process.env as unknown as Record<string, string>),
    PYTHONPATH: process.env.ENGINE_ROOT || REPO_ROOT,
  };
  for (const key of [
    "BT_EMBEDDING_MODEL", "OLLAMA_MODEL", "DEEPSEEK_API_KEY",
    "INTERN_S1_PRO_API_KEY", "GEMINI_API_KEY", "MINIMAX_API_KEY",
    "EXERGY_MINERU_COMMAND", "MINERU_COMMAND", "BT_MINERU_OCR_COMMAND", "MINERU_OCR_COMMAND",
    "EXERGY_MINERU_PYTHON", "EXERGY_BREAKTHROUGH_ENGINE_ROOT", "BREAKTHROUGH_ENGINE_ROOT",
    "EXERGY_MINERU_BACKEND", "BT_MINERU_BACKEND", "MINERU_BACKEND",
    "EXERGY_MINERU_TIMEOUT_SECONDS", "BT_MINERU_TIMEOUT_S", "EXERGY_DISABLE_MINERU",
    "MINERU_LANGUAGE", "MINERU_LANG", "MINERU_USE_OCR",
    "MINERU_ENABLE_TABLE", "MINERU_ENABLE_FORMULA",
    "MINERU_TIMEOUT_SECONDS",
  ]) {
    const val = getEnvVar(key);
    if (val) envVars[key] = val;
  }

  try {
    const { stdout, stderr } = await execFileAsync(PYTHON, args, {
      cwd: REPO_ROOT,
      env: envVars as NodeJS.ProcessEnv,
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", code: e.code || 1 };
  }
}

async function evidenceCollectionHasUsableContent(path: string): Promise<boolean> {
  try {
    const { readFile } = await import("fs/promises");
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const nParams = Number(data.n_parameters_extracted || 0);
    const nClaims = Number(data.n_claims_extracted || 0);
    const params = data.parameters;
    const claims = data.claims;
    const hasParams =
      params && typeof params === "object" && !Array.isArray(params)
        ? Object.keys(params).length > 0
        : Array.isArray(params) && params.length > 0;
    const hasClaims = Array.isArray(claims) && claims.length > 0;
    return nParams > 0 || nClaims > 0 || !!hasParams || hasClaims;
  } catch {
    return false;
  }
}

async function summarizeEvidenceLayout(paths: string[]): Promise<Record<string, unknown>> {
  const { readFile } = await import("fs/promises");
  const documents: Record<string, unknown>[] = [];
  let nTables = 0;
  let nImages = 0;
  const parsers = new Set<string>();

  for (const path of paths) {
    try {
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const tables = Array.isArray(data.tables) ? data.tables : [];
      const images = Array.isArray(data.images) ? data.images : [];
      const metadata = data.parse_metadata && typeof data.parse_metadata === "object"
        ? data.parse_metadata as Record<string, unknown>
        : {};
      const parser = typeof metadata.parser === "string" ? metadata.parser : "";
      if (parser) parsers.add(parser);
      nTables += tables.length;
      nImages += images.length;
      documents.push({
        source_filename: data.source_filename || path,
        parser: parser || "unknown",
        n_tables: tables.length,
        n_images: images.length,
      });
    } catch {
      documents.push({ source_filename: path, parser: "unreadable", n_tables: 0, n_images: 0 });
    }
  }

  return {
    n_documents: paths.length,
    n_tables: nTables,
    n_images: nImages,
    parsers: Array.from(parsers),
    documents,
  };
}

async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  return callDeepSeekV3(messages, { temperature: 0.2, maxTokens: 4000, jsonMode: true });
}

// ── Variant Parameter Extraction ──────────────────────────────────
// When the description mentions a process variant (e.g. "with HDC"),
// extract parameter overrides so the evaluation produces different results.

function extractVariantParams(description: string): Record<string, number> {
  const params: Record<string, number> = {};
  const d = description.toLowerCase();

  // Hydrodechlorination / HDC
  if (d.includes("hydrodechlorin") || / hdc\b/.test(d)) {
    params.dechlorination_efficiency = 0.95;
    params.hdc_capex_adder_pct = 20;
    params.hdc_opex_adder_per_ton = 15;
  }

  // Hydrotreatment / upgrading
  if (d.includes("hydrotreat") || d.includes("upgrading")) {
    params.include_upgrading = 1;
    params.upgrading_capex_adder_pct = 25;
  }

  // Throughput override (e.g. "100 tpd")
  const tpd = d.match(/(\d+)\s*(?:tpd|tonnes?\s*per\s*day)/);
  if (tpd) params.throughput_tpd = parseInt(tpd[1]);

  return params;
}

function looksLikeUserInstruction(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return /\b(can you|please|conduct|evaluate|assessment|analy[sz]e|run|tell me|what is|why|how)\b/.test(t);
}

function buildEvaluationDescription(actionDesc: string, projectDesc: string): string {
  const action = actionDesc.trim();
  const projectText = projectDesc.trim();
  if (!action) return projectText;
  if (!projectText || looksLikeUserInstruction(projectText)) return action;
  if (action.toLowerCase().includes(projectText.toLowerCase())) return action;
  return `${action} ${projectText}`.trim();
}

function buildProjectResearchQuery(project: { name?: string | null; description?: string | null; domain?: string | null } | null | undefined, docs: Array<{ filename?: string }>): string {
  const parts = [
    project?.name,
    looksLikeUserInstruction(project?.description || "") ? "" : project?.description,
    project?.domain ? String(project.domain).replace(/_/g, " ") : "",
    ...docs.map((d) => d.filename || "").map((name) => name.replace(/\.[^.]+$/, "")),
    "published benchmarks performance economics safety regulatory deployment",
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
  return parts.replace(/\s+/g, " ").trim();
}

/**
 * Project.domain is authoritative when the user explicitly set it (i.e.
 * it's not "general" and not empty).  The LLM action runner may include
 * a ``domain`` field in its action config, but that is only a SUGGESTION —
 * if it conflicts with the project's domain, the project wins.  Before
 * this helper, ``cfg.domain || project.domain`` let a misclassified
 * action ("waste_to_fuels" suggested by the LLM for a question about
 * solar panels) override the project's canonical ``photovoltaic``
 * domain and contaminate every downstream step (evidence collection,
 * evaluation, brief, TRL inference).  See CC-BE-WS-0034 batch B.
 *
 * Fallback chain:
 *   1. project.domain if set and !== "general"      — user's explicit choice wins
 *   2. agentSuggested if provided                   — LLM guess accepted when no user choice
 *   3. fallback (caller-provided, typically "general")
 */
function resolveAuthoritativeDomain(
  agentSuggested: string | undefined | null,
  project: { domain?: string | null } | null | undefined,
  fallback = "general",
): string {
  const pd = project?.domain;
  if (pd && typeof pd === "string" && pd !== "general") return pd;
  if (agentSuggested && typeof agentSuggested === "string") return agentSuggested;
  return fallback;
}

// ── Action Handlers ────────────────────────────────────────────────

async function handleExergyAgentAnalysis(
  projectId: string,
  input: Record<string, unknown>,
  actionId: string,
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  const docs = await storage.listDocuments(projectId);
  const referencedNames = extractReferencedUploadNames(input);
  const scopedDocs = filterReferencedDocs(docs, referencedNames);
  const uploadPaths = await getProjectUploadPaths(projectId, referencedNames);
  const promptParts = [
    typeof input.question === "string" ? input.question : "",
    typeof input.description === "string" ? input.description : "",
    typeof input.query === "string" ? input.query : "",
    typeof input.prompt === "string" ? input.prompt : "",
    project?.name ? `Project: ${project.name}` : "",
    project?.description ? `Project description: ${project.description}` : "",
    project?.goal ? `Goal: ${project.goal}` : "",
    scopedDocs.length > 0 ? `Uploaded files: ${scopedDocs.map((doc) => doc.filename).join(", ")}` : "",
  ].filter(Boolean);
  const prompt = promptParts.join("\n\n") || "Analyze the uploaded evidence and provide a practical engineering assessment.";
  if (shouldUseWorkspaceForDocumentRequest(prompt, scopedDocs)) {
    return handleAgentWorkspace(projectId, {
      ...input,
      task: prompt,
      question: prompt,
      current_attachments: scopedDocs.map((doc) => doc.filename),
      requested_outputs: ["direct chat report", "tables", "downloadable report files"],
      allow_dependency_install: input.allow_dependency_install !== false,
      timeout_ms: typeof input.timeout_ms === "number" ? input.timeout_ms : 15 * 60_000,
    }, actionId, parentArtifactId);
  }
  let run: Record<string, unknown>;
  run = await runExergyWorkspaceAgent(prompt, uploadPaths, workspaceAgentTimeoutMs(uploadPaths));
  const artifactInput = buildExergyArtifactInput({
    run,
    prompt,
    actionId,
    parentArtifactId,
    title: "Exergy Analyst Assessment",
  });
  return storage.createArtifact(projectId, artifactInput as any) as Promise<Artifact>;
}

async function handleSimulation(
  projectId: string,
  input: Record<string, unknown>,
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  // Map project.domain aliases to simulator domains so a 'photovoltaic'
  // project doesn't fall through to the battery simulator.
  const projectSimDomain =
    project?.domain === "photovoltaic" || project?.domain === "pv" || project?.domain === "pv_iv"
      ? "pv"
      : project?.domain === "inverter_dc_ac" || project?.domain === "inverter"
        ? "inverter"
        : project?.domain === "battery_ecm" || project?.domain === "battery"
          ? "battery"
          : undefined;
  const domain = (resolveAuthoritativeDomain(
    input.domain as string | undefined,
    projectSimDomain ? { domain: projectSimDomain } : project,
    "battery",
  )) as SimDomain;

  if (domain === "pv") {
    const pvParams = { ...defaultPVParams((input.technology as string) || "mono_perc"), ...input, _domain: "pv" as const };
    const result = runPVSimulation(pvParams);
    const tech = pvParams.technology || "mono_perc";
    return storage.createArtifact(projectId, {
      schema_version: 1, type: "simulation",
      title: `${tech.toUpperCase()} @ ${pvParams.irradiance}W/m², ${pvParams.cell_temp}°C`,
      summary: `Pmax ${result.summary.Pmax}W | η ${result.summary.efficiency}% | FF ${result.summary.fill_factor} | Grade: ${result.summary.overall_grade}`,
      content: result as unknown as Record<string, unknown>,
      source: "preview_engine",
      raw: result as unknown as Record<string, unknown>,
      metadata: { domain: "pv", tier: 0, model_version: "pv-sim-ts-1.0" },
      parent_id: parentArtifactId, action_id: "",
      provenance: { source: "preview_engine", deterministic: true, engine_version: "pv-sim-ts-1.0" },
      pinned: false,
    });
  }

  if (domain === "inverter") {
    const invParams = { ...defaultInverterParams((input.topology as string) || "string_1ph"), ...input, _domain: "inverter" as const };
    const result = runInverterSimulation(invParams);
    const topo = invParams.topology || "string_1ph";
    return storage.createArtifact(projectId, {
      schema_version: 1, type: "simulation",
      title: `${topo} ${(invParams.rated_power_w / 1000).toFixed(1)}kW @ ${invParams.t_ambient}°C`,
      summary: `Peak ${result.summary.peak_efficiency}% | CEC ${result.summary.cec_weighted}% | Grade: ${result.summary.overall_grade}`,
      content: result as unknown as Record<string, unknown>,
      source: "preview_engine",
      raw: result as unknown as Record<string, unknown>,
      metadata: { domain: "inverter", tier: 0, model_version: "inverter-sim-ts-1.0" },
      parent_id: parentArtifactId, action_id: "",
      provenance: { source: "preview_engine", deterministic: true, engine_version: "inverter-sim-ts-1.0" },
      pinned: false,
    });
  }

  // Default: battery
  const simParams = input as unknown as CellParams;
  const result = runBatterySimulation(simParams);
  return storage.createArtifact(projectId, {
    schema_version: 1, type: "simulation",
    title: `${(simParams.chemistry || "Battery").toUpperCase()} ${simParams.capacity_mAh || "?"}mAh @ ${simParams.ambient_temp_C ?? 25}°C, R0=${simParams.impedance_mOhm ?? "?"}mΩ`,
    summary: `${result.summary.energy_density_Wh_kg} Wh/kg | ${result.summary.cycle_life_80pct} cycles to 80% | Grade: ${result.summary.overall_grade}`,
    content: { params: simParams, discharge_curves: result.discharge_curves, thermal_profiles: result.thermal_profiles, cycle_life: result.cycle_life, crate_metrics: result.crate_metrics, grades: result.grades, summary: result.summary },
    source: "preview_engine",
    raw: result as unknown as Record<string, unknown>,
    metadata: { domain: "battery", tier: 0, model_version: "battery-sim-ts-1.0" },
    parent_id: parentArtifactId, action_id: "",
    provenance: { source: "preview_engine", deterministic: true, engine_version: "battery-sim-ts-1.0" },
    pinned: false,
  });
}

async function handlePhysicsSimulation(
  projectId: string,
  input: Record<string, unknown>,
  actionId = "",
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const domain = (input.domain as string) || "general";
  const params = (input.params as Record<string, unknown>) || input;

  // Build CLI command: python -m breakthrough_engine evidence evaluate
  // with explicit params that get passed to the physics solver
  const paramPairs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string") {
      paramPairs.push(`${k}=${v}`);
    }
  }

  const description = (input.description as string) || `${domain} physics simulation`;

  const args = [
    "-m", "breakthrough_engine", "evidence", "evaluate",
    "--description", description,
    "--domain", domain,
    "--brief",
  ];

  // Add explicit params — single --params flag with all pairs
  if (paramPairs.length > 0) {
    args.push("--params", ...paramPairs);
  }

  const { stdout, stderr, code } = await runPython(args, 120_000);

  let evalResult: Record<string, unknown> = {};
  if (code === 0 && stdout.trim()) {
    try {
      evalResult = JSON.parse(stdout);
    } catch {
      evalResult = { raw_output: stdout.slice(0, 2000) };
    }
  }

  const physicsSolver = (evalResult.physics_solver as Record<string, unknown>) || {};
  const solverFamily = (physicsSolver.family as string) || "none";
  const solverVersion = (physicsSolver.solver_version as string) || "tier0";
  const nMetrics = (physicsSolver.n_output_metrics as number) || 0;

  // If no real solver ran (tier0/none with 0 metrics), redirect to evidence_evaluation
  // through the general engineering solver kit before falling back to prose.
  // This keeps physics requests useful even when legacy Breakthrough Engine
  // solver modules are not installed in the current Python environment.
  if (solverFamily === "none" && nMetrics === 0) {
    const solverResult = runPhysicsSolver(input);
    if (solverResult.status !== "needs_inputs") {
      return createEngineeringSolverArtifact(projectId, solverResult, input, actionId, parentArtifactId);
    }
    return handleExergyAgentAnalysis(projectId, input, actionId, parentArtifactId);
  }

  // CC-BE-GOV-0110: derive the public methodology label from the
  // solver status telemetry wired by CC-BE-GOV-0107. Physics
  // simulations have no mock / promotion concept, so only the
  // physics_solver block contributes.
  const physSimInput: SolverStatusInput = {
    physics_solver: physicsSolver as SolverStatusInput["physics_solver"],
  };
  const physSimMethodology = renderMethodology(physSimInput);
  const physSimNoBacking = renderNoBackingCaveat(physSimInput);

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "simulation",
    title: `${domain} Physics Simulation`,
    summary:
      `Solver: ${solverVersion} | ${nMetrics} metrics | Family: ${solverFamily}`
      + ` — Methodology: ${physSimMethodology}`,
    content: {
      ...evalResult,
      methodology: physSimMethodology,
      solver_backed: physSimMethodology === "calibrated simulation",
      not_solver_backed_caveat: physSimNoBacking,
    },
    source: "physics_engine",
    raw: evalResult,
    metadata: {
      domain,
      solver_family: solverFamily,
      solver_version: solverVersion,
      tier: solverFamily === "none" ? 0 : 1,
      methodology: physSimMethodology,
    },
    parent_id: undefined,
    action_id: "",
    provenance: {
      source: "physics_engine",
      deterministic: true,
      engine_version: solverVersion,
    },
    pinned: false,
  });
}

async function createEngineeringSolverArtifact(
  projectId: string,
  result: EngineeringSolverResult,
  input: Record<string, unknown>,
  actionId = "",
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const useCase = result.solver_type === "economics"
    ? "Economics Solver"
    : "Physics and Exergy Solver";
  const notProven = result.limitations.length > 0
    ? result.limitations
    : ["This calculation is not independent validation unless the inputs came from measured, source-backed operating data."];
  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: result.solver_type === "physics" ? "simulation" : "evaluation",
    title: result.title,
    summary: result.executive_summary,
    content: {
      analysis_type: "exergy_agent_assessment",
      solver_result: result,
      input,
      client_summary: {
        decision: result.status === "ran"
          ? `${useCase} complete`
          : `${useCase} partially complete`,
        conclusion: result.executive_summary,
        confidence: result.confidence,
        evidence_label: result.confidence === "computed"
          ? "Computed result"
          : result.confidence === "needs_inputs"
            ? "Needs more inputs"
            : "Engineering estimate",
        use_case_label: useCase,
        computed_metrics: result.computed_metrics,
        supported_claims: result.computed_metrics.slice(0, 4).map((metric) => ({
          claim: `${metric.label}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`,
          evidence: "Computed from supplied numeric parameters.",
        })),
        not_proven: notProven,
        recommended_actions: result.missing_inputs.slice(0, 5).map((item) => ({
          action: `Provide ${item}.`,
        })),
        data_requests: result.missing_inputs.map((item) => ({
          request: item,
          why_it_matters: result.solver_type === "economics"
            ? "Improves the finance model and reduces sensitivity-driven uncertainty."
            : "Improves the physics boundary conditions and reduces unsupported inference.",
        })),
        priority_recommendation: {
          title: result.missing_inputs[0]
            ? `Tighten ${result.missing_inputs[0]} next`
            : "Compare the computed result with measured data",
          rationale: result.missing_inputs[0]
            ? "This is the highest-value missing input for making the result more decision-grade."
            : "Solver outputs become much more valuable when checked against operating data or a published benchmark.",
        },
      },
    },
    source: result.solver_type === "physics" ? "physics_engine" : "canonical_engine",
    raw: result as unknown as Record<string, unknown>,
    metadata: {
      action_type: result.solver_type === "physics" ? "physics_simulation" : "economics_analysis",
      solver_type: result.solver_type,
      status: result.status,
      metric_count: result.computed_metrics.length,
    },
    parent_id: parentArtifactId,
    action_id: actionId,
    provenance: {
      source: result.solver_type === "physics" ? "physics_engine" : "canonical_engine",
      deterministic: true,
      engine_version: "engineering-solvers-v2",
    },
    pinned: false,
  });
}

async function handleEconomicsAnalysis(
  projectId: string,
  input: Record<string, unknown>,
  actionId = "",
  parentArtifactId?: string,
): Promise<Artifact> {
  const result = runEconomicsSolver(input);
  if (result.status !== "needs_inputs") {
    return createEngineeringSolverArtifact(projectId, result, input, actionId, parentArtifactId);
  }
  return handleExergyAgentAnalysis(projectId, input, actionId, parentArtifactId);
}

async function handleDocumentAnalysis(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const documentId = input.document_id as string;
  const inputProductType = (input.product_type as string) || "";

  // Resolve dispatch: mature productType wins, otherwise treat productType
  // or project.domain as a kernel id and route through `--type generic`.
  const project = await storage.getProject(projectId);
  const dispatch = resolveDatasheetDispatch(inputProductType, project?.domain ?? null);
  const productType = dispatch.kernelId ?? dispatch.dispatchType ?? inputProductType ?? "";

  // Find the document file path
  const docs = await storage.listDocuments(projectId);
  const doc = docs.find((d) => d.id === documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const projDir = join(RUNTIME_DIR, "projects", `proj_${projectId}`);
  // Find the actual file (stored as {id}_{filename})
  const docDir = join(projDir, "documents");
  const { readdir } = await import("fs/promises");
  const files = await readdir(docDir);
  const docFile = files.find((f) => f.startsWith(documentId) && !f.endsWith(".json"));
  if (!docFile) throw new Error("Document file not found on disk");
  const docPath = join(docDir, docFile);

  // Run Python extraction
  const args = ["-m", "breakthrough_engine", "datasheet", "extract", docPath, ...dispatch.extraArgs];

  const { stdout, stderr, code } = await runPython(args);

  if (code !== 0) {
    throw new Error(`Extraction failed: ${stderr.slice(0, 500)}`);
  }

  let extractionResult: Record<string, unknown> = {};
  try {
    extractionResult = JSON.parse(stdout);
  } catch {
    extractionResult = { raw_output: stdout.slice(0, 2000), parse_error: true };
  }

  // Also try to derive simulation params if extraction succeeded
  let derivedParams: Record<string, unknown> | null = null;
  const dsId = extractionResult.datasheet_id as string;
  if (dsId && extractionResult.quality_verdict !== "rejected") {
    try {
      const deriveResult = await runPython(["-m", "breakthrough_engine", "datasheet", "derive", dsId]);
      if (deriveResult.code === 0) {
        derivedParams = JSON.parse(deriveResult.stdout);
      }
    } catch { /* derive is optional */ }
  }

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "document_extraction",
    title: `Extraction: ${doc.filename}`,
    summary: extractionResult.quality_verdict
      ? `${extractionResult.quality_verdict} — completeness ${Math.round((extractionResult.completeness_score as number || 0) * 100)}%`
      : "Extraction complete",
    content: {
      extraction: extractionResult,
      derived_params: derivedParams,
      document_id: documentId,
      filename: doc.filename,
    },
    source: "canonical_engine",
    raw: { extraction: extractionResult, derived: derivedParams, stderr: stderr.slice(0, 1000) },
    metadata: {
      product_type: productType,
      dispatch_type: dispatch.dispatchType,
      kernel_id: dispatch.kernelId,
      kernel_source: dispatch.kernelSource,
    },
    action_id: "",
    provenance: {
      source: "canonical_engine",
      deterministic: false,  // LLM extraction is non-deterministic
      engine_version: "datasheet-extractor-v1",
    },
    pinned: false,
  });
}

async function handleEvaluation(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const seed = (input.seed as number) || 42;
  const mockSidecar = resolveMockSidecar(input);

  const args = ["-m", "breakthrough_engine", "battery", "benchmark",
    "--seed", String(seed), "--candidates", "6"];
  if (mockSidecar) args.push("--mock-sidecar");

  const { stdout, stderr, code } = await runPython(args);

  if (code !== 0) {
    throw new Error(`Evaluation failed: ${stderr.slice(0, 500)}`);
  }

  // The benchmark saves a JSON report file — read it directly
  const { readFile: rf } = await import("fs/promises");
  const reportPath = join(RUNTIME_DIR, "battery_loop", `battery_benchmark_${seed}.json`);
  let report: Record<string, unknown> = {};
  try {
    const reportContent = await rf(reportPath, "utf-8");
    report = JSON.parse(reportContent);
  } catch {
    // Fallback: try to parse from stdout
    try {
      const lines = stdout.trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        try { report = JSON.parse(lines[i]); break; } catch { continue; }
      }
    } catch {
      report = { raw_output: stdout.slice(0, 3000) };
    }
  }

  // Extract module evaluations
  const moduleEvals = report.module_evaluations as Record<string, unknown> || {};
  const promotionDecision = report.promotion_decision as string || "unknown";
  const bestCandidate = report.best_candidate as Record<string, unknown> || {};

  // CC-BE-GOV-0110: derive the public methodology label from the
  // engine-side telemetry wired by CC-BE-GOV-0105..0107. This is the
  // single source of truth for "is this run solver-backed?" —
  // downstream UI must not re-derive it from individual fields.
  const solverStatusInput: SolverStatusInput = {
    physics_solver: (report.physics_solver as SolverStatusInput["physics_solver"]) ?? null,
    hard_fail: (report.hard_fail as boolean) === true,
    promotion_blocked: (report.promotion_blocked as boolean) === true,
    solver_veto_reason: (report.solver_veto_reason as string) || undefined,
    mock_sidecar: mockSidecar,
  };
  const methodology = renderMethodology(solverStatusInput);
  const noBackingCaveat = renderNoBackingCaveat(solverStatusInput);
  const readinessAllowed = allowsPositiveReadinessLanguage(solverStatusInput);

  // CC-BE-GOV-0109: when mock sidecar was used, label the artifact
  // visibly at every user-facing surface (title, summary, caveats,
  // metadata). CC-BE-GOV-0110 extends this: any non-solver-backed run
  // (hard_fail / promotion_blocked / non-ran status) also gets a
  // "not solver-backed" caveat and a methodology tag.
  const titlePrefix = mockSidecar ? "[MOCK/DEMO] " : "";
  const summarySuffix = mockSidecar
    ? " — MOCK/DEMO validation (not production-grade)"
    : "";
  const existingCaveats = Array.isArray(
    (report as { caveats?: unknown }).caveats,
  )
    ? ((report as { caveats: unknown[] }).caveats as string[])
    : [];
  const mockCaveatPrefix: string[] = mockSidecar
    ? [
      "Mock/demo validation: battery sidecar ran with --mock-sidecar. "
        + "Results are NOT solver-backed; use only for UI demonstration or testing.",
    ]
    : [];
  const backingCaveatList: string[] =
    noBackingCaveat && !mockSidecar ? [noBackingCaveat] : [];
  const caveats = [
    ...mockCaveatPrefix,
    ...backingCaveatList,
    ...existingCaveats,
  ];

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "evaluation",
    title: `${titlePrefix}Battery Assessment (seed ${seed})`,
    summary:
      `${promotionDecision} — ${Object.keys(moduleEvals).length} modules evaluated`
      + ` — Methodology: ${methodology}`
      + summarySuffix,
    content: {
      report,
      module_evaluations: moduleEvals,
      promotion_decision: promotionDecision,
      best_candidate: bestCandidate,
      seed,
      mock_sidecar: mockSidecar,
      caveats,
      methodology,
      solver_backed: methodology === "calibrated simulation",
      readiness_allowed: readinessAllowed,
    },
    source: "canonical_engine",
    raw: { report, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 1000) },
    metadata: {
      seed,
      mock_sidecar: mockSidecar,
      validation_mode: mockSidecar ? "mock_demo" : "real_sidecar",
      methodology,
    },
    action_id: "",
    provenance: {
      source: "canonical_engine",
      deterministic: true,
      engine_version: "battery-benchmark-v4",
    },
    pinned: false,
  });
}

async function handleResearch(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  // Build context from project
  const project = await storage.getProject(projectId);
  const artifacts = await storage.listArtifacts(projectId);
  const docs = await storage.listDocuments(projectId);
  const domain = project?.domain || "general";
  const inputQuery = typeof input.query === "string" ? input.query.trim() : "";
  const query = inputQuery || buildProjectResearchQuery(project, docs);
  if (!query) throw new Error("Research query is required");
  const recentEvaluationSummaries = artifacts
    .filter((artifact: { type: string }) => artifact.type === "evaluation")
    .sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))
    .slice(0, 2);
  const recentEvaluations: Record<string, unknown>[] = [];
  for (const summary of recentEvaluationSummaries) {
    const full = await storage.getArtifact(projectId, summary.id);
    const content = full?.content as Record<string, unknown> | undefined;
    if (content) recentEvaluations.push(content);
  }

  // ── Phase 1: Real literature search via Python retrieval pipeline ──
  let literatureResults: Record<string, unknown> | null = null;
  let paperFindings: Array<Record<string, unknown>> = [];

  try {
    const litResult = await runPython([
      "-m", "breakthrough_engine", "literature", "search",
      "--query", query, "--domain", domain, "--limit", "15", "--json",
    ]);
    if (litResult.code === 0 && litResult.stdout.trim()) {
      literatureResults = JSON.parse(litResult.stdout);
      paperFindings = (literatureResults?.results as Array<Record<string, unknown>>) || [];
    }
  } catch {
    // Literature search is best-effort — fall through to DeepSeek V4-Flash-only
  }

  // ── Phase 2: DeepSeek V4-Flash synthesis (grounded in real papers if available) ──
  const contextParts = [
    `Project: ${project?.name || "Unknown"}`,
    `Description: ${project?.description || "None"}`,
    `Goal: ${project?.goal || "None"}`,
    `Domain: ${domain}`,
    `Existing artifacts: ${artifacts.map((a) => `${a.type}: ${a.title}`).join("; ")}`,
    `Documents: ${docs.map((d) => d.filename).join(", ") || "none"}`,
  ];

  for (const evaluation of recentEvaluations) {
    const brief = evaluation.brief as Record<string, unknown> | undefined;
    const physicsSolver = evaluation.physics_solver as Record<string, unknown> | undefined;
    const topExergy = evaluation.exergy_metrics as Record<string, unknown> | undefined;
    const solverExergy = physicsSolver?.exergy_metrics as Record<string, unknown> | undefined;
    const exergyMetrics = topExergy || solverExergy;
    const thermodynamicQuality =
      (brief?.thermodynamic_quality as Record<string, unknown> | undefined)
      || (evaluation.thermodynamic_quality as Record<string, unknown> | undefined);
    contextParts.push("\nAUTHORITATIVE PRIOR EVALUATION RESULT:");
    contextParts.push(`- Evaluated subject: ${String(brief?.commercial_name || evaluation.commercial_name || project?.name || "unknown")}`);
    contextParts.push(`- Evidence level: ${String(evaluation.evidence_level || brief?.evidence_level || "unknown")}`);
    if (typeof evaluation.score === "number") {
      contextParts.push(`- Composite score: ${evaluation.score.toFixed(3)}`);
    }
    if (exergyMetrics && typeof exergyMetrics.exergetic_efficiency === "number") {
      const etaII = (exergyMetrics.exergetic_efficiency * 100).toFixed(1);
      const etaI = typeof exergyMetrics.first_law_efficiency === "number"
        ? `; first-law efficiency ${(exergyMetrics.first_law_efficiency * 100).toFixed(1)}%`
        : "";
      const qf = typeof exergyMetrics.quality_factor === "number"
        ? `; quality factor ${exergyMetrics.quality_factor.toFixed(2)}`
        : "";
      contextParts.push(`- Computed exergy simulation: second-law/exergetic efficiency ${etaII}%${etaI}${qf}.`);
    }
    if (thermodynamicQuality?.verdict || thermodynamicQuality?.basis) {
      contextParts.push(`- Thermodynamic-quality axis: ${String(thermodynamicQuality.verdict || "unknown")} — ${String(thermodynamicQuality.basis || "")}`);
    }
    if (typeof brief?.exergy_summary_plain === "string") {
      contextParts.push(`- Exergy summary: ${brief.exergy_summary_plain}`);
    }
    const digest = evaluation.evidence_digest as Record<string, unknown> | undefined;
    const facts = Array.isArray(digest?.headline_facts) ? digest.headline_facts.slice(0, 5) : [];
    if (facts.length > 0) {
      contextParts.push(`- Extracted headline facts: ${facts.join("; ")}`);
    }
  }

  // Add real papers to context for DeepSeek V4-Flash grounding
  if (paperFindings.length > 0) {
    contextParts.push(`\nREAL PAPERS FOUND (${paperFindings.length} results from academic databases):`);
    for (const paper of paperFindings.slice(0, 10)) {
      contextParts.push(
        `- "${paper.title}" (${paper.citation}) [${paper.source_type}] relevance=${paper.relevance_score}`
      );
      if (paper.quote && paper.quote !== paper.title) {
        contextParts.push(`  Abstract: ${(paper.quote as string).slice(0, 200)}`);
      }
    }
    contextParts.push("\nGround your synthesis in these real papers. Cite them by title.");
  }

  let parsed: Record<string, unknown> = {};
  let synthesisSource: "ai_synthesis" | "canonical_engine" = "ai_synthesis";

  let exergyBlock = "";
  try {
    const { buildExergyPromptBlock } = require("@/lib/domain-physics");
    if (domain !== "general") exergyBlock = buildExergyPromptBlock(domain);
  } catch { exergyBlock = ""; }

  // Catalog-driven rationalization and red-flag injection (discovery stage, research brief).
  const catalogDomain = catalogDomainFromProjectDomain(domain);
  const selectionCtx = {
    domain: catalogDomain,
    stage: "discovery" as const,
    brief_type: "research" as const,
  };
  const rationalizations = selectRationalizations(selectionCtx);
  const redFlags = selectRedFlags(selectionCtx);
  const rationalizationsBlock = rationalizations.length > 0
    ? `\nRATIONALIZATIONS TO INTERROGATE (claims often used to argue readiness — you MUST evaluate each one against the evidence):\n${formatRationalizationsForPrompt(rationalizations)}\n`
    : "";
  const redFlagsBlock = redFlags.length > 0
    ? `\nRED FLAGS TO SCAN FOR (observable signals in the evidence record — you MUST report any triggered):\n${formatRedFlagsForPrompt(redFlags)}\n`
    : "";

  const apiKey = getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY");
  if (apiKey) {
    const systemPrompt = `You are a technical research analyst for Exergy Lab, an energy technology evaluation platform.
Your role is to provide structured, evidence-based research findings grounded in real published literature.

PROJECT CONTEXT:
${contextParts.join("\n")}
${exergyBlock}
${rationalizationsBlock}${redFlagsBlock}
RULES:
- Every finding must cite a specific source (paper, report, or dataset)
- If you don't know the source, say "Source needed" — do not fabricate citations
- Distinguish between established facts, recent findings, and unvalidated claims
- Identify gaps in existing research
- Suggest concrete follow-up actions
- Follow the EXERGY GUIDANCE above when discussing thermodynamic performance — do not apply exergy analysis where it adds no discriminative value, and do not omit it where it is required
- For each RATIONALIZATION above, decide status ("refuted" | "supported" | "inconclusive") and populate rationalization_checks[] with the catalog key verbatim. Do not invent keys.
- For each RED FLAG above that is triggered by the evidence, populate red_flags_triggered[] with the catalog key verbatim. If unsure, include it with status "unresolved" and notes explaining the uncertainty.
- Keep rationalization_checks[] and red_flags_triggered[] as separate arrays — do not merge.

Respond in JSON format:
{
  "executive_summary": "2-3 sentence overview",
  "findings": [
    {
      "statement": "The key finding",
      "source": "Author, Journal, Year (or 'Source needed')",
      "evidence_strength": "strong|moderate|weak|unverified",
      "relevance": "high|medium|low",
      "challenges_assumption": null or "description of challenged assumption"
    }
  ],
  "competitive_landscape": [
    {"approach": "name", "best_result": "metric", "maturity": "TRL 1-9", "key_risk": "description"}
  ],
  "identified_gaps": ["gap 1", "gap 2"],
  "suggested_followups": ["action 1", "action 2"],
  "rationalization_checks": [
    {
      "key": "<catalog key, exact match>",
      "module_owner": "<module from catalog>",
      "stage": "discovery",
      "pattern": "<pattern text from catalog>",
      "status": "refuted | supported | inconclusive",
      "evidence_refs": ["source citation or paper id"],
      "trigger_basis": "one or two sentences on what drove the status",
      "disconfirming_checks_run": ["which required_disconfirming_checks were addressed"],
      "notes": ""
    }
  ],
  "red_flags_triggered": [
    {
      "key": "<catalog key, exact match>",
      "module_owner": "<module from catalog>",
      "stage": "discovery",
      "severity": "caution | blocker",
      "evidence_refs": ["source citation or paper id"],
      "trigger_basis": "one or two sentences on what in the evidence triggered this",
      "confidence_cap_applied": 0.6,
      "verdict_ceiling_applied": "none | conditional | blocked",
      "status": "unresolved",
      "clearing_evidence_refs": [],
      "notes": ""
    }
  ]
}`;

    try {
      const response = await callDeepSeek([
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ]);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // Synthesis failed — fall back to raw paper data
      parsed = {
        executive_summary: `Found ${paperFindings.length} papers matching "${query}". AI synthesis was unavailable — showing raw results.`,
        findings: paperFindings.slice(0, 5).map((p) => ({
          statement: p.title || "Untitled paper",
          source: p.citation || p.source_id || "Unknown source",
          evidence_strength: (p.relevance_score as number) >= 0.8 ? "strong" : "moderate",
        })),
        identified_gaps: ["AI synthesis failed — manual review of the papers below is recommended."],
      };
    }
  } else if (paperFindings.length > 0) {
    // No API key — return structured paper results directly
    synthesisSource = "canonical_engine";
    parsed = {
      executive_summary: `Found ${paperFindings.length} papers matching "${query}" from ${literatureResults?.n_sources || 0} academic databases.`,
      findings: paperFindings.map((p) => ({
        statement: p.title,
        source: p.citation,
        evidence_strength: (p.relevance_score as number) >= 0.8 ? "strong" : (p.relevance_score as number) >= 0.6 ? "moderate" : "weak",
        relevance: (p.relevance_score as number) >= 0.7 ? "high" : "medium",
      })),
      competitive_landscape: [],
      identified_gaps: [],
      suggested_followups: ["Run evidence evaluation with key findings as input parameters"],
    };
  } else {
    synthesisSource = "canonical_engine";
    parsed = {
      executive_summary:
        `No literature results were available for "${query}" from the configured retrieval sources, and AI synthesis is not configured. Try a narrower query, add the company or technology family, or upload source documents for evidence evaluation.`,
      findings: [],
      competitive_landscape: [],
      identified_gaps: [
        "No papers or benchmark sources were returned by the configured retrieval pipeline.",
        "No AI synthesis key was available to broaden or interpret the search.",
      ],
      suggested_followups: [
        "Try a narrower query with the company, material, process, or device family.",
        "Upload source documents so the platform can evaluate the evidence directly.",
      ],
    };
  }

  const findings = (parsed.findings as Array<Record<string, unknown>>) || [];

  // Derive audit counts from the catalog-driven arrays the model returned.
  // These are authoritative: downstream consumers (brief, UI, PDF) must read
  // them from the artifact, not recompute.
  const rawTriggered = (parsed.red_flags_triggered as Array<Record<string, unknown>>) || [];
  const triggeredNormalized = rawTriggered
    .filter((f) => typeof f.key === "string")
    .map((f) => ({
      key: f.key as string,
      status: (f.status === "cleared" ? "cleared" : "unresolved") as "unresolved" | "cleared",
      severity: (f.severity === "blocker" ? "blocker" : "caution") as "caution" | "blocker",
    }));
  const unresolvedRedFlagCount = countUnresolved(triggeredNormalized);
  const blockerRedFlagCount = countUnresolvedBlockers(triggeredNormalized);

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "research",
    title: `Research: ${query.slice(0, 60)}${query.length > 60 ? "..." : ""}`,
    summary: (parsed.executive_summary as string) || "Research synthesis complete",
    content: {
      query,
      ...parsed,
      unresolved_red_flag_count: unresolvedRedFlagCount,
      blocker_red_flag_count: blockerRedFlagCount,
      literature_results: literatureResults,
    },
    source: synthesisSource,
    raw: { literatureResults, parsed },
    metadata: {
      model: apiKey ? "deepseek-v4-flash" : "literature-only",
      query,
      n_papers_found: paperFindings.length,
      sources_used: literatureResults?.sources_used || [],
    },
    action_id: "",
    provenance: {
      source: synthesisSource,
      deterministic: false,
      model: apiKey ? "deepseek-v4-flash" : undefined,
      grounding_refs: paperFindings.length > 0
        ? paperFindings.map((p) => (p.source_id as string) || "unknown")
        : findings.map((f) => (f.source as string) || "unknown"),
    },
    pinned: false,
  });
}

// ── Deep Research Handler ─────────────────────────────────────────

function firstDeepResearchText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = value
        .map((item) => typeof item === "string" ? item : typeof item === "number" ? String(item) : "")
        .filter(Boolean)
        .join("\n");
      if (text.trim()) return text.trim();
    }
  }
  return "";
}

async function sourceDocumentFromPath(doc: ProjectDocument, docPath: string): Promise<DeepResearchSourceDocument | null> {
  const { readFile } = await import("fs/promises");
  const { existsSync } = await import("fs");
  const lower = docPath.toLowerCase();
  if (/\.pdf$/i.test(docPath)) {
    await ensurePdfTextSidecars(docPath);
    for (const suffix of [".gemini.json", ".gemini.md", ".mineru.json", ".mineru.md"]) {
      const sidecar = `${docPath}${suffix}`;
      if (!existsSync(sidecar)) continue;
      const raw = await readFile(sidecar, "utf-8").catch(() => "");
      if (!raw.trim()) continue;
      if (suffix.endsWith(".json")) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const text = firstDeepResearchText(parsed.markdown, parsed.text, parsed.content, parsed.raw_output);
          if (text) {
            return {
              document_id: doc.id,
              filename: doc.filename,
              source_type: suffix.includes("gemini") ? "multimodal_pdf" : "text_sidecar",
              text: text.slice(0, 80_000),
              parser: firstDeepResearchText(parsed.parser, parsed.engine) || (suffix.includes("gemini") ? "Gemini vision" : "PDF extraction"),
            };
          }
        } catch {
          continue;
        }
      } else {
        return {
          document_id: doc.id,
          filename: doc.filename,
          source_type: suffix.includes("gemini") ? "multimodal_pdf" : "text_sidecar",
          text: raw.slice(0, 80_000),
          parser: suffix.includes("gemini") ? "Gemini vision" : "PDF extraction",
        };
      }
    }
    return null;
  }
  if (/\.(txt|md|csv|json|xml|yaml|yml|tsv)$/i.test(lower)) {
    const raw = await readFile(docPath, "utf-8").catch(() => "");
    if (raw.trim()) {
      return {
        document_id: doc.id,
        filename: doc.filename,
        source_type: "uploaded_document",
        text: raw.slice(0, 80_000),
        parser: "uploaded text",
      };
    }
  }
  return null;
}

async function buildDeepResearchSourceDocuments(
  projectId: string,
  input: Record<string, unknown>,
): Promise<DeepResearchSourceDocument[]> {
  const storage = getStorage();
  const docs = await storage.listDocuments(projectId);
  const referencedNames = extractReferencedUploadNames(input);
  const explicitAttachments = Array.isArray(input.current_attachments)
    ? input.current_attachments.filter((item): item is string => typeof item === "string")
    : [];
  const scopedDocs = filterReferencedDocs(docs, Array.from(new Set([...referencedNames, ...explicitAttachments])));
  const uploadPaths = await getProjectUploadPaths(projectId, scopedDocs.map((doc) => doc.filename));
  const sourceDocuments: DeepResearchSourceDocument[] = [];

  for (const doc of scopedDocs) {
    const extracted = doc.extraction_result || {};
    const extractedText = firstDeepResearchText(
      extracted.markdown,
      extracted.text,
      extracted.content,
      extracted.summary,
      extracted.raw_output,
    );
    if (extractedText) {
      sourceDocuments.push({
        document_id: doc.id,
        filename: doc.filename,
        source_type: "uploaded_document",
        text: extractedText.slice(0, 80_000),
        parser: "stored extraction",
      });
    }
  }

  for (const path of uploadPaths) {
    const lowerBase = normalizeUploadName(path.split("/").pop() || "").toLowerCase();
    const doc = scopedDocs.find((candidate) => lowerBase.includes(normalizeUploadName(candidate.filename).toLowerCase()));
    if (!doc) continue;
    const sourceDoc = await sourceDocumentFromPath(doc, path).catch(() => null);
    if (sourceDoc) sourceDocuments.push(sourceDoc);
  }

  const seen = new Set<string>();
  return sourceDocuments.filter((doc) => {
    const key = `${doc.document_id || doc.filename}:${doc.source_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !!doc.text.trim();
  }).slice(0, 8);
}

async function handleDeepResearch(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const question = input.query as string;
  if (!question) throw new Error("Research question is required");

  const project = await storage.getProject(projectId);
  const domain = project?.domain || "general";

  const sourceDocuments = await buildDeepResearchSourceDocuments(projectId, input);
  const result = await executeDeepResearch(projectId, question, domain, runPython, { sourceDocuments });

  const allPaperIds = result.papers.map((p) => p.source_id || "unknown");

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "deep_research" as ArtifactType,
    title: `Deep Research: ${question.slice(0, 55)}${question.length > 55 ? "..." : ""}`,
    summary: (result.synthesis.executive_summary as string) || "Deep research complete",
    content: {
      query: question,
      ...result.synthesis,
      plan: result.plan,
      review: result.review,
      iterations: result.iterations,
      total_papers: result.papers.length,
      source_documents: result.source_documents.map((doc) => ({
        document_id: doc.document_id,
        filename: doc.filename,
        source_type: doc.source_type,
        parser: doc.parser,
        preview: doc.text.slice(0, 1200),
      })),
    },
    source: "ai_synthesis",
    raw: {
      plan: result.plan,
      papers: result.papers,
      source_documents: result.source_documents,
      synthesis: result.synthesis,
      review: result.review,
    },
    metadata: {
      model: "deepseek-v4-flash",
      question,
      n_papers_found: result.papers.length,
      n_source_documents: result.source_documents.length,
      iterations: result.iterations,
      review_verdict: result.review.verdict,
      n_subtopics: result.plan.subtopics.length,
    },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: "deepseek-v4-flash",
      grounding_refs: allPaperIds,
    },
    pinned: false,
  });
}

// ── Deep Diligence Handler (Batch C — premium tier) ────────────────

function _extractDocText(extraction: Record<string, unknown> | undefined | null): string {
  if (!extraction) return "";
  for (const key of ["text", "markdown", "content", "raw_output"]) {
    const val = extraction[key];
    if (typeof val === "string" && val.trim()) return val;
  }
  // Fallback: serialize the whole extraction payload so the LLM has
  // *something* to work with. This is verbose but ensures Deep DD does
  // not silently lose information.
  try {
    return JSON.stringify(extraction);
  } catch {
    return "";
  }
}

async function handleDeepDiligence(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const question = (input.question as string) || (input.query as string);
  if (!question) throw new Error("Deep Diligence requires a question");

  const docIds = Array.isArray(input.document_ids) ? (input.document_ids as string[]) : [];
  if (docIds.length === 0) throw new Error("Deep Diligence requires at least one document_id");

  const allDocs = await storage.listDocuments(projectId);
  const selected = docIds
    .map((id) => allDocs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d);
  if (selected.length === 0) throw new Error("None of the supplied document_ids resolved");

  const ddInput: DiligenceDocInput[] = selected.map((d) => ({
    name: d.filename,
    text: _extractDocText(d.extraction_result) || "",
  })).filter((d) => d.text.trim().length > 0);
  if (ddInput.length === 0) {
    throw new Error(
      "Selected documents have no extracted text. Run extraction before Deep Diligence.",
    );
  }

  const maxUsd = typeof input.max_usd === "number" ? input.max_usd : Number(getEnvVar("RLM_DEEP_DD_MAX_USD") || "0.25");
  const maxDepth = typeof input.max_depth === "number" ? input.max_depth : 3;

  const project = await storage.getProject(projectId);
  const ctx = project ? `Project: ${project.name} — ${project.goal || project.description || ""}` : "";
  const estimatedCost = estimateDeepDiligenceCost(ddInput);

  logDebug(
    "action",
    `Deep DD starting: ${ddInput.length} docs, estimated $${estimatedCost.toFixed(3)}, budget $${maxUsd.toFixed(3)}`,
    { action_type: "deep_diligence", project_id: projectId, n_docs: ddInput.length, estimated_usd: estimatedCost, budget_usd: maxUsd },
  );

  const result = await runDeepDiligence(
    { question, context: ctx, docs: ddInput },
    { maxUsdBudget: maxUsd, maxDepth },
  );

  const fallbackNote = result.fallback_used
    ? ` [partial — ${result.fallback_used}]`
    : "";

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "diligence_deep" as ArtifactType,
    title: `Deep Diligence: ${question.slice(0, 55)}${question.length > 55 ? "..." : ""}${fallbackNote}`,
    summary:
      result.executive_summary.slice(0, 200) ||
      `Deep Diligence across ${result.n_docs} document(s), ${result.n_leaf_calls} section pass(es)`,
    content: {
      question,
      executive_summary: result.executive_summary,
      findings: result.findings,
      contradictions: result.contradictions,
      risks: result.risks,
      gaps: result.gaps,
      recommended_next_steps: result.recommended_next_steps,
      source_docs: selected.map((d) => ({ id: d.id, filename: d.filename })),
      n_docs: result.n_docs,
      n_sections: result.n_sections,
      n_leaf_calls: result.n_leaf_calls,
      n_synth_calls: result.n_synth_calls,
      n_final_calls: result.n_final_calls,
      model_cost_usd: result.model_cost_usd,
      fallback_used: result.fallback_used,
      partial_at_stage: result.partial_at_stage,
    },
    source: "ai_synthesis",
    raw: {
      question,
      trajectory: result.trajectory,
      estimated_cost_usd: estimatedCost,
      budget_usd: maxUsd,
      max_depth: maxDepth,
    },
    metadata: {
      tier: "premium",
      pipeline: "rlm_deep_diligence",
      model_cost_usd: result.model_cost_usd,
      budget_usd: maxUsd,
      n_docs: result.n_docs,
      n_sections: result.n_sections,
      fallback_used: result.fallback_used,
    },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: "rlm(leaf=deepseek-v4-flash,synth=qwen3.6-plus,final=glm-5.1)",
      grounding_refs: selected.map((d) => d.id),
      lane: "official",
    },
    pinned: false,
  });
}

// ── Evidence Evaluation Handler ────────────────────────────────────

async function handleEvidenceEvaluation(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const { existsSync, statSync } = await import("fs");
  const { readdir } = await import("fs/promises");

  // Unwrap nested config if present (chat agent may send {type, config: {...}})
  const cfg = (input.config && typeof input.config === "object")
    ? input.config as Record<string, unknown>
    : input;

  // Resolve the authoritative domain FIRST so both dedup and evaluation
  // see the same value.  Project domain wins over any LLM-suggested
  // ``cfg.domain`` — otherwise a misclassification contaminates the
  // entire evaluation pipeline.
  const project = await storage.getProject(projectId);
  const domain = resolveAuthoritativeDomain(cfg.domain as string | undefined, project, "");

  // Deduplication: skip if identical evaluation already exists for this
  // project within the dedup window.
  //
  // Window extended from 60s → 30 min (1_800_000 ms): the Canadian-Solar
  // workspace export showed three near-identical evaluations within ~20
  // minutes (the LLM agent kept re-firing evidence_evaluation as it
  // worked through followup questions).  60s caught zero of them; 30
  // minutes catches all reasonable accidental reruns while still letting
  // the user trigger a fresh evaluation if they explicitly wait or
  // change parameters.
  //
  // Same-domain + same-description match is the dedup key — different
  // parameters on the same domain still produce a fresh evaluation.
  const DEDUP_WINDOW_MS = 30 * 60 * 1000;
  const existingArtifacts = await storage.listArtifacts(projectId);
  const dedupDomain = domain || "general";
  const dedupDescription = ((cfg.description as string) || "").toLowerCase().trim();
  const recentDupe = existingArtifacts.find(
    (a: { type: string; title: string; created_at: string; summary: string }) => {
      if (a.type !== "evaluation") return false;
      if (Date.now() - new Date(a.created_at).getTime() >= DEDUP_WINDOW_MS) return false;
      if (!a.title.toLowerCase().includes(dedupDomain.replace(/_/g, " "))) return false;
      // If a description was provided, also check that the title contains it
      // (title format is "Evidence Evaluation: <description>")
      if (dedupDescription && !a.title.toLowerCase().includes(dedupDescription.slice(0, 50).toLowerCase())) return false;
      return true;
    }
  );
  if (recentDupe) {
    const full = await storage.getArtifact(projectId, recentDupe.id);
    if (full) return full;
  }

  // ── Phase 1: Auto-collect evidence from uploaded documents ──────
  const docs = await storage.listDocuments(projectId);
  const evidencePaths: string[] = [];
  const intakeFailures: Array<{ filename: string; error: string }> = [];
  const projDir = join(RUNTIME_DIR, "projects", `proj_${projectId}`);
  const docDir = join(projDir, "documents");
  const evidenceDir = join(RUNTIME_DIR, "evidence");

  // Collect evidence from all documents IN PARALLEL (not sequentially)
  const evidenceT0 = Date.now();
  logDebug("evidence", "Starting parallel evidence collection", { n_documents: docs.length, domain });
  const collectionPromises = docs.map(async (doc) => {
    const stem = doc.filename.replace(/\.[^.]+$/, "");
    const safeStem = `${doc.id}_${stem}`.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 160);
    const evidencePath = join(evidenceDir, `${safeStem}_evidence.json`);
    let docPath = "";
    if (existsSync(docDir)) {
      const files = await readdir(docDir);
      const docFile = files.find((f: string) => f.startsWith(`${doc.id}_`));
      if (docFile) docPath = join(docDir, docFile);
    }

    // Re-extract if evidence file doesn't exist OR if it's stale (older than
    // the document upload). This prevents reusing thin/incomplete evidence
    // from earlier runs. Also re-extract if cached file is very small (<500B),
    // which indicates a failed extraction.
    let needsExtraction = !existsSync(evidencePath);
    if (!needsExtraction && existsSync(evidencePath)) {
      try {
        const { statSync } = await import("fs");
        const evidenceStat = statSync(evidencePath);
        // Re-extract if evidence is tiny (likely failed) or older than 1 hour
        // and this is a new evaluation run
        if (evidenceStat.size < 500) {
          needsExtraction = true;
          console.log(`[evidence_collection] Re-extracting ${doc.filename} — cached evidence too small (${evidenceStat.size}B)`);
        } else if (/\.pdf$/i.test(docPath) && getEnvVar("GEMINI_API_KEY") && ![".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json"].some((suffix) => existsSync(`${docPath}${suffix}`))) {
          needsExtraction = true;
          console.log(`[evidence_collection] Re-extracting ${doc.filename} — fast PDF vision sidecar is not cached yet`);
        } else if (docPath && [".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json"].some((suffix) => {
          try {
            const sidecarStat = statSync(`${docPath}${suffix}`);
            return sidecarStat.mtimeMs > evidenceStat.mtimeMs;
          } catch {
            return false;
          }
        })) {
          needsExtraction = true;
          console.log(`[evidence_collection] Re-extracting ${doc.filename} — PDF extraction sidecar is newer than cached evidence`);
        } else if (!(await evidenceCollectionHasUsableContent(evidencePath))) {
          needsExtraction = true;
          console.log(`[evidence_collection] Re-extracting ${doc.filename} — cached evidence has no usable parameters or claims`);
        }
      } catch { /* stat failed — re-extract */ needsExtraction = true; }
    }

    if (needsExtraction) {
      try {
        if (docPath) {
          const collectionDocPath = await resolveEvidenceCollectionDocumentPath(docPath);
          const collectArgs = [
            "-m", "breakthrough_engine", "evidence", "collect",
            collectionDocPath, "--output", evidencePath,
          ];
          if (domain) collectArgs.push("--domain", domain);
          const filenameLower = doc.filename.toLowerCase();
          const collectionUsesOriginalPdf = collectionDocPath === docPath && /\.pdf$/i.test(docPath);
          const layoutRequestedByUser =
            /(?:table|diagram|figure|image|ocr|scan|scanned|layout)/.test(dedupDescription);
          const shouldUseLayoutOcr =
            collectionUsesOriginalPdf && (
              layoutRequestedByUser
              || /(?:datasheet|data\s*sheet|info(?:rmation)?\s*sheet|spec|technical|report|whitepaper|brochure)/.test(filenameLower)
            );
          const shouldUseFastTextLayer =
            collectionUsesOriginalPdf && /(?:investor|presentation|pitch|deck)/.test(filenameLower);
          if (shouldUseLayoutOcr) {
            collectArgs.push("--layout-ocr");
          }
          if (shouldUseFastTextLayer) {
            collectArgs.push("--text-layer-only");
          }

          const collectResult = await runPython(collectArgs, 120_000);
          if (collectResult.code !== 0) {
            const retryArgs = collectArgs.includes("--text-layer-only")
              ? collectArgs
              : [...collectArgs, "--text-layer-only"];
            const retryResult = retryArgs === collectArgs
              ? collectResult
              : await runPython(retryArgs, 45_000);
            if (retryResult.code !== 0 || !existsSync(evidencePath) || !(await evidenceCollectionHasUsableContent(evidencePath))) {
              intakeFailures.push({
                filename: doc.filename,
                error: "Could not extract parameters from this document.",
              });
            }
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Collection process error";
        intakeFailures.push({ filename: doc.filename, error: reason });
      }
    }

    if (existsSync(evidencePath) && await evidenceCollectionHasUsableContent(evidencePath)) {
      evidencePaths.push(evidencePath);
    } else if (existsSync(evidencePath) && !intakeFailures.some((failure) => failure.filename === doc.filename)) {
      intakeFailures.push({
        filename: doc.filename,
        error: "No usable parameters or claims were extracted from this document.",
      });
    }
  });

  await Promise.all(collectionPromises);
  const evidenceLayoutSummary = await summarizeEvidenceLayout(evidencePaths);
  const evidenceFileSizesBytes = evidencePaths.map((path) => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  });
  logDebug("evidence", "Evidence collection complete", {
    n_documents: docs.length,
    n_collected: evidencePaths.length,
    n_failures: intakeFailures.length,
    failures: intakeFailures.map(f => f.filename),
    n_tables: evidenceLayoutSummary.n_tables,
    n_images: evidenceLayoutSummary.n_images,
  }, Date.now() - evidenceT0);

  // ── Phase 2: Run evaluation with collected evidence ─────────────
  const evalT0 = Date.now();
  logDebug("evaluation", "Starting evaluation", { domain, n_evidence: evidencePaths.length });
  const args: string[] = ["-m", "breakthrough_engine", "evidence", "evaluate"];
  if (evidencePaths.length > 0) {
    args.push("--docs", ...evidencePaths);
  }

  // ── Variant parameter extraction ─────────────────────────────────
  // When the description mentions a process variant (e.g. "with HDC"),
  // extract the corresponding parameter overrides so the evaluation
  // actually produces different results (not just a different title).
  const variantParams = extractVariantParams(
    (cfg.description as string) || "",
  );

  // Add explicit params from input — must be a single --params with all pairs
  // Gate 1: Validate params before sending to Python CLI
  const rawParams = {
    ...(cfg.params as Record<string, unknown> || {}),
    ...variantParams,
  } as Record<string, unknown> | undefined;
  const explicitParamCount = rawParams ? Object.keys(rawParams).filter(k =>
    rawParams[k] !== null && rawParams[k] !== undefined).length : 0;

  const paramValidation = rawParams ? validateParams(rawParams) : null;
  const params = paramValidation?.sanitized_params;
  if (params) {
    const paramPairs: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) {
        paramPairs.push(`${k}=${v}`);
      }
    }
    if (paramPairs.length > 0) {
      args.push("--params", ...paramPairs);
    }
  }

  // Combine action description + project description only when the project
  // description is actual subject context. User prompts like "Can you please
  // conduct an assessment..." must not leak into commercial_name/report titles.
  const actionDesc = (cfg.description as string) || "";
  const projectDesc = project?.description || "";
  const description = buildEvaluationDescription(actionDesc, projectDesc);
  if (description) {
    args.push("--description", description);
  }

  if (domain) {
    args.push("--domain", domain);
  }

  // ── Subject Resolution: generic keyword inference > default ──
  // Keep this route domain-generic. Do not branch on named stress fixtures or
  // company identities; infer only from technology and process terms.
  const inferredKeys: string[] = [];
  if (domain === "waste_to_fuels" && !rawParams?.technology_family) {
    const descLower = (description + " " + (project?.description || "")).toLowerCase();
    let inferredFamily = "";

    // Regime-appropriate default params keyed by inferred technology family.
    if (!inferredFamily) {
      const familyDefaults: Record<string, Record<string, string>> = {
        htl_cracking: {
          feedstock_type: /\b(food|organic|sludge|manure|bio)\b/.test(descLower)
            ? "food_processing" : "hydrocarbon_waste",
          htl_temperature_c: "350",
          htl_pressure_bar: "200",
          moisture_content_pct: "60",
          n_process_stages: "4",
        },
        pyrolysis_to_oil: {
          feedstock_type: "mixed_plastics",
          htl_temperature_c: "500",
          htl_pressure_bar: "1",
          moisture_content_pct: "1",
          n_process_stages: "3",
        },
        gasification_synfuels: {
          feedstock_type: "msw",
          htl_temperature_c: "800",
          htl_pressure_bar: "1",
          moisture_content_pct: "20",
          n_process_stages: "5",
        },
        biochar_focused: {
          feedstock_type: "wood_residues",
          htl_temperature_c: "400",
          htl_pressure_bar: "1",
          moisture_content_pct: "20",
          n_process_stages: "2",
        },
      };
      if (/\b(htl|hydrothermal|liquefaction)\b/.test(descLower)) inferredFamily = "htl_cracking";
      else if (/\b(pyrolysis|pyrolytic)\b/.test(descLower)) inferredFamily = "pyrolysis_to_oil";
      else if (/\b(gasification|syngas|ft\s+synthesis|catalytic\s+fuel\s+synthesis)\b/.test(descLower)) inferredFamily = "gasification_synfuels";
      else if (/\b(biochar|slow.?pyrolysis|carbon.?credit)\b/.test(descLower)) inferredFamily = "biochar_focused";
      if (inferredFamily) {
        const defaults = familyDefaults[inferredFamily] || {};
        for (const [k, v] of Object.entries(defaults)) {
          if (!rawParams?.[k]) {
            args.push("--params", `${k}=${v}`);
            inferredKeys.push(k);
          }
        }
        console.log(`[evidence_evaluation] Inferred technology_family=${inferredFamily} with regime defaults from description`);
      }
    }

    if (inferredFamily) {
      args.push("--params", `technology_family=${inferredFamily}`);
      inferredKeys.push("technology_family");
    }
  }

  // Pass provenance: tell Python which params came from keyword inference vs explicit user input.
  // This prevents the evaluator from treating inferred defaults as "user claims".
  if (inferredKeys.length > 0) {
    args.push("--params", `__inferred_keys=${inferredKeys.join(",")}`);
  }

  // GUARDRAIL: Check effective param count AFTER family inference.
  // If user provided no explicit params AND no family could be inferred,
  // this is a true baseline-only run.
  let paramWarning: string | null = null;
  const effectiveParamCount = explicitParamCount + inferredKeys.length;
  if (effectiveParamCount === 0 && evidencePaths.length === 0) {
    paramWarning = "No technology-specific parameters provided and no documents uploaded — this evaluation uses baseline defaults only. Provide key parameters or upload technical documents for a product-specific assessment.";
    console.warn(`[evidence_evaluation] BASELINE-ONLY RUN: domain=${domain}, params=0, docs=0`);
  } else if (explicitParamCount === 0 && inferredKeys.length > 0) {
    // Inferred from description keywords — note this but don't warn as strongly
    console.log(`[evidence_evaluation] INFERRED RUN: domain=${domain}, explicit_params=0, inferred=${inferredKeys.length}, docs=${evidencePaths.length}`);
  } else {
    console.log(`[evidence_evaluation] domain=${domain}, explicit_params=${explicitParamCount}, inferred=${inferredKeys.length}, docs=${evidencePaths.length}`);
  }

  // Extract and pass URLs from project description for evidence intake
  const urlPattern = /https?:\/\/[^\s"<>]+/g;
  const allText = (description + " " + (project?.description || "")).trim();
  const extractedUrls = allText.match(urlPattern) || [];
  if (extractedUrls.length > 0) {
    args.push("--urls", ...extractedUrls.slice(0, 5));  // Cap at 5 URLs
    args.push("--augmented");  // Enable augmented mode for URL intake
    console.log(`[evidence_evaluation] Extracted ${extractedUrls.length} URLs from description, enabling augmented mode`);
  }

  const deviceId = (cfg.device_id as string) || `project_${projectId}`;
  args.push("--device-id", deviceId);

  // Always request brief generation for workspace evaluations
  args.push("--brief");

  const result = await runPython(args);

  // Try to parse the saved JSON output (evaluation dict without brief — brief saved separately)
  let evalResult: Record<string, unknown> = {};
  try {
    const fs = await import("fs/promises");
    const evalPath = join(evidenceDir, `${deviceId}_evaluation.json`);
    const content = await fs.readFile(evalPath, "utf-8");
    evalResult = JSON.parse(content);
    // Gate 2: Validate evaluation results (never modifies, only adds validation_issues)
    const evalValidation = validateEvaluation(evalResult);
    if (!evalValidation.validation_valid) {
      evalResult.validation_valid = false;
      evalResult.validation_issues = evalValidation.validation_issues;
    }
  } catch (parseErr) {
    console.error(`[evidence_evaluation] Failed to read evaluation JSON for ${deviceId}:`, parseErr instanceof Error ? parseErr.message : parseErr);
    // Fallback: try to extract score and modules from stdout
    evalResult = { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }

  // Inject comprehensive context if available from prior extraction
  const comprehensiveCtx = cfg.comprehensive_context as Record<string, unknown> | undefined;
  if (comprehensiveCtx) {
    evalResult.comprehensive_context = comprehensiveCtx;
  }

  // Try to load the generated brief
  let briefData: Record<string, unknown> | null = null;
  try {
    const fs = await import("fs/promises");
    const { readdirSync } = await import("fs");
    const briefsDir = join(RUNTIME_DIR, "device_briefs");
    const files = readdirSync(briefsDir).filter(f => f.startsWith(`brief-${deviceId}`) && f.endsWith(".json"));
    if (files.length > 0) {
      // Take the most recent
      files.sort().reverse();
      const briefContent = await fs.readFile(join(briefsDir, files[0]), "utf-8");
      briefData = JSON.parse(briefContent);
      // Gate 3: Validate brief (never modifies, only adds validation_issues)
      if (briefData) {
        const briefValidation = validateBrief(briefData);
        if (!briefValidation.validation_valid) {
          briefData.validation_valid = false;
          briefData.validation_issues = briefValidation.validation_issues;
        }
      }
    }
  } catch {
    // Brief loading is optional — evaluation still works without it
  }

  const intakeGate = evaluateIntakeGate({
    uploadedDocCount: docs.length,
    intakeFailures,
    evidencePathsUsed: evidencePaths,
    evidenceFileSizesBytes,
    evalResultRunState: evalResult.run_state as string | undefined,
    evalResultVerdict: evalResult.verdict as string | undefined,
    evalResultSolverConfirmed: evalResult.solver_confirmed as boolean | undefined,
  });
  const intakeFailuresForArtifact =
    intakeGate.failClosed && intakeFailures.length === 0
      ? [{
        filename: "uploaded documents",
        error: intakeGate.reason || "No usable extracted evidence was produced.",
      }]
      : intakeFailures;

  // ── Merge Gate 1 blocked params into caveats ─────────────────────
  const paramBlocks = paramValidation && !paramValidation.valid
    ? paramValidation.decisions.filter(d => d.tier === "hard_block")
    : [];

  // ── Merge intake failure caveats with engine caveats ────────────
  const engineCaveats = (evalResult.caveats as string[]) || [];
  const allCaveats = [...engineCaveats];
  // Add param guardrail warning as first caveat if applicable
  if (paramWarning) allCaveats.unshift(paramWarning);
  for (const block of paramBlocks) {
    allCaveats.push(`Parameter blocked by validation: ${block.field}=${block.value} — ${block.message}`);
  }
  for (const failure of intakeFailures) {
    allCaveats.push(`Document extraction failed for ${failure.filename}: ${failure.error}`);
  }
  if (intakeGate.intakeFailureCaveat) allCaveats.unshift(intakeGate.intakeFailureCaveat);

  // ── Consolidate validation issues from all gates ────────────────
  const allValidationIssues: string[] = [];
  if (intakeGate.gate0ValidationIssue) {
    allValidationIssues.unshift(intakeGate.gate0ValidationIssue);
  }
  // Gate 1: param blocks
  for (const block of paramBlocks) {
    allValidationIssues.push(`[Gate 1] ${block.field}=${block.value}: ${block.message}`);
  }
  // Gate 2: eval validation issues
  const evalIssues = evalResult.validation_issues as string[] | undefined;
  if (evalIssues) {
    for (const issue of evalIssues) {
      allValidationIssues.push(`[Gate 2] ${issue}`);
    }
  }
  // Gate 3: brief validation issues
  const briefIssues = briefData?.validation_issues as string[] | undefined;
  if (briefIssues) {
    for (const issue of briefIssues) {
      allValidationIssues.push(`[Gate 3] ${issue}`);
    }
  }

  const validationValid = allValidationIssues.length === 0;

  const score = (evalResult.score as number) || 0;
  const nModules = Object.keys((evalResult.module_evaluations as Record<string, unknown>) || {}).length;
  const econDetails = ((evalResult.module_evaluations as Record<string, any>)?.economics?.details) || {};
  const physicsSolver = evalResult.physics_solver as Record<string, unknown> | undefined;
  const solverExergyMetrics =
    physicsSolver && typeof physicsSolver === "object" && physicsSolver.exergy_metrics && typeof physicsSolver.exergy_metrics === "object"
      ? physicsSolver.exergy_metrics as Record<string, unknown>
      : undefined;
  const exergyMetrics =
    evalResult.exergy_metrics && typeof evalResult.exergy_metrics === "object"
      ? evalResult.exergy_metrics as Record<string, unknown>
      : solverExergyMetrics;
  const briefCommercialName = typeof briefData?.commercial_name === "string" ? briefData.commercial_name : "";
  const displayName = briefCommercialName || (evalResult.commercial_name as string | undefined) || description || deviceId;

  logDebug("evaluation", "Evaluation complete", {
    domain,
    score,
    n_modules: nModules,
    n_params: effectiveParamCount,
    n_evidence_docs: evidencePaths.length,
    n_intake_failures: intakeFailuresForArtifact.length,
    intake_gate_fail_closed: intakeGate.failClosed,
    economics_mode: econDetails.provenance?.economics_mode || "unknown",
    economics_metric: econDetails.economic_metric || "none",
    brief_available: briefData !== null,
    n_caveats: allCaveats.length,
    n_validation_issues: allValidationIssues.length,
    evidence_level: evalResult.evidence_level,
  }, Date.now() - evalT0);

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "evaluation",
    title: `Evidence Evaluation: ${displayName.slice(0, 50)}`,
    summary: `Score: ${score.toFixed(3)} across ${nModules} modules. ${allCaveats.length} caveats.`,
    content: {
      score,
      domain: evalResult.domain || domain,
      evidence_level: evalResult.evidence_level || "unknown",
      evidence_level_metadata: evalResult.evidence_level_metadata || {},
      module_evaluations: evalResult.module_evaluations || {},
      fusion_metadata: evalResult.fusion_metadata || {},
      system_boundary: evalResult.system_boundary || "unknown",
      caveats: allCaveats,
      evidence_digest: evalResult.evidence_digest || undefined,
      evidence_layout_summary: evidenceLayoutSummary,
      exergy_metrics: exergyMetrics || undefined,
      exergy_status: evalResult.exergy_status || physicsSolver?.exergy_status || undefined,
      exergy_reason: evalResult.exergy_reason || physicsSolver?.exergy_reason || undefined,
      intake_failures: intakeFailuresForArtifact.length > 0 ? intakeFailuresForArtifact : undefined,
      brief: briefData,
      // Include physics solver output when available
      physics_solver: evalResult.physics_solver || undefined,
      // Structured insights from insight engine
      structured_insights: evalResult.structured_insights || [],
      // Schema info for Compare Results panel
      schema_info: evalResult.schema_info || undefined,
      // Technology family with provenance
      technology_family: evalResult.technology_family || "",
      family_provenance: evalResult.family_provenance || undefined,
      // Run state (debug / provisional / client_grade)
      run_state: intakeGate.downgradedRunState || evalResult.run_state || "debug",
      // Resolved subject identity (CC-BE-11089)
      resolved_subject: evalResult.resolved_subject || undefined,
      // Truth-state reconciliation from engine
      truth_reconciliation: evalResult.truth_reconciliation || undefined,
      // WtF-specific fields: verdict, solver, founder surface, process chain
      // These are computed by evaluate_reference_device_wtf and must flow
      // through to the artifact for InlineResultCard and PDF rendering.
      verdict: intakeGate.downgradedVerdict || evalResult.verdict || undefined,
      solver_confirmed: intakeGate.downgradedSolverConfirmed ?? evalResult.solver_confirmed ?? undefined,
      solver_surface_status: evalResult.solver_surface_status || undefined,
      solver_validation: evalResult.solver_validation || undefined,
      founder_surface: evalResult.founder_surface || undefined,
      process_chain: evalResult.process_chain || undefined,
      benchmark_comparisons: evalResult.benchmark_comparisons || undefined,
      experiment_metrics: evalResult.experiment_metrics || undefined,
      spec_compliance: evalResult.spec_compliance || undefined,
      chain_validation: evalResult.chain_validation || undefined,
      investor_outputs: evalResult.investor_outputs || undefined,
      commercial_name: displayName,
      trl_estimate: evalResult.trl_estimate ?? undefined,
      trl_band: evalResult.trl_band || undefined,
      validation_valid: validationValid,
      validation_issues: allValidationIssues.length > 0 ? allValidationIssues : undefined,
      blocked_params: paramBlocks.length > 0
        ? paramBlocks.map(b => ({ field: b.field, value: b.value, rule: b.rule_id, message: b.message }))
        : undefined,
      // Comparison metadata for what-if reruns (agent sends compare_to with previous artifact ID)
      ...(cfg.compare_to ? (() => {
        try {
          const prevArtifact = existingArtifacts.find(a => a.id === cfg.compare_to);
          if (prevArtifact) {
            return {
              _comparison: {
                baseline_artifact_id: cfg.compare_to,
                baseline_score: (prevArtifact as any).content?.score,
                is_whatif: true,
                edits: cfg.params || {},
                timestamp: new Date().toISOString(),
              },
            };
          }
        } catch {}
        return {};
      })() : {}),
    },
    source: "canonical_engine",
    raw: evalResult,
    metadata: {
      device_id: deviceId,
      n_documents: evidencePaths.length,
      n_intake_failures: intakeFailuresForArtifact.length,
      evaluation_profile: "offline",
      brief_available: briefData !== null,
      n_validation_issues: allValidationIssues.length,
    },
    action_id: "",
    provenance: {
      source: "canonical_engine",
      deterministic: true,
      engine_version: "batch6",
    },
    pinned: false,
  });
}

// ── Evidence Interview Handler ────────────────────────────────────

async function handleEvidenceInterview(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);

  const args: string[] = ["-m", "breakthrough_engine", "evidence", "interview"];

  const domain = resolveAuthoritativeDomain(input.domain as string | undefined, project, "");
  if (domain) args.push("--domain", domain);

  const description = (input.description as string) || "";
  if (description) args.push("--description", description);

  const params = input.params as Record<string, unknown> | undefined;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      args.push("--params", `${k}=${v}`);
    }
  }

  const step = (input.step as string) || "";
  if (step) args.push("--step", step);

  // Resume from state file if provided
  const stateFile = (input.state_file as string) || "";
  if (stateFile) args.push("--state-file", stateFile);

  // Auto-evaluate if requested
  if (input.evaluate) args.push("--evaluate");

  const result = await runPython(args);

  // Parse structured interview output from stdout
  let content: Record<string, unknown> = {};
  try {
    if (result.code === 0 && result.stdout.trim()) {
      // Try to parse as JSON (interview CLI outputs structured JSON)
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = JSON.parse(jsonMatch[0]);
      } else {
        content = { response: result.stdout.trim() };
      }
    }
  } catch {
    content = { response: result.stdout.trim() };
  }
  content.domain = domain;
  content.step = step;
  if (result.code !== 0) {
    content.error = result.stderr?.slice(0, 500) || "Interview step failed";
  }

  const summaryText = (content.question as string) || (content.response as string) || `Domain: ${domain || "pending"}`;

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "evaluation",
    title: `Interview: ${description.slice(0, 50) || domain || "Technology Assessment"}`,
    summary: `Interview step${step ? ` ${step}` : ""}: ${summaryText.slice(0, 80)}`,
    content,
    source: "canonical_engine",
    raw: { stdout: result.stdout, stderr: result.stderr, code: result.code },
    metadata: { domain, step },
    action_id: "",
    provenance: {
      source: "canonical_engine",
      deterministic: true,
      engine_version: "batch6",
    },
    pinned: false,
  });
}

// ── Lane 2: Exploratory (Custom Charts + Derived Analysis) ───────────

async function handleCustomChart(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();

  // The agent sends a declarative chart spec — we validate and store it
  const spec = input.spec as Record<string, unknown> || input;
  const chartType = (spec.chart_type as string) || "bar";
  const title = (spec.title as string) || "Custom Chart";
  const data = spec.data as Array<Record<string, unknown>> || [];

  if (!data.length) {
    throw new Error("Chart spec must include non-empty data array");
  }

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "report",
    title: `Chart: ${title}`,
    summary: `${chartType} chart with ${data.length} data points`,
    content: {
      artifact_lane: "exploratory",
      chart_spec: spec,
    },
    source: "ai_synthesis",
    raw: spec,
    metadata: { chart_type: chartType, data_points: data.length },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      lane: "exploratory",
    },
    pinned: false,
  });
}

async function handleExploratoryAnalysis(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const question = (input.question as string) || "";
  const analysisType = (input.analysis_type as string) || "derived_metrics";

  // Gather source artifacts for analysis
  const artifacts = await storage.listArtifacts(projectId);
  const sourceData: Record<string, unknown>[] = [];
  for (const a of artifacts.slice(0, 8)) {
    const full = await storage.getArtifact(projectId, a.id);
    if (full?.content) {
      sourceData.push({ id: a.id, type: a.type, title: a.title, summary: a.summary, content: full.content });
    }
  }

  // Use DeepSeek V4-Pro for deeper analytical reasoning, V4-Flash fallback

  // Analysis-type-specific methodology
  const methodologyByType: Record<string, string> = {
    comparison: `METHODOLOGY (Comparison Analysis):
- Compare metrics across artifacts using consistent units and normalization
- For each metric, show: value, baseline reference, relative position
- Identify which technology/configuration performs best on each dimension
- Highlight tradeoffs: where one option wins on X but loses on Y
- Use radar charts for multi-dimensional comparison, bar charts for single metrics`,
    sensitivity: `METHODOLOGY (Sensitivity Analysis):
- Identify the 3-5 most influential parameters from the evaluation data
- Show how the composite score or key metrics change when each parameter varies by ±20%
- Use waterfall charts to show parameter importance ranking
- Identify which parameters the result is most sensitive to
- Flag any parameters where small changes cause large score swings`,
    tradeoff: `METHODOLOGY (Tradeoff Analysis):
- Identify the fundamental tradeoffs in the technology (e.g., cost vs performance, efficiency vs durability)
- Map tradeoff frontiers: what's achievable vs what's aspirational
- Use scatter plots with Pareto frontiers where applicable
- Reference published state-of-the-art to show where this technology sits`,
    gap_analysis: `METHODOLOGY (Gap Analysis):
- Use the ranked_gap_guidance from evaluation briefs to identify highest-impact missing data
- For each gap: what's missing, why it matters, what would provide it, estimated impact on score
- Prioritize gaps that block multiple modules
- Create a table showing: parameter, impact level, affected modules, typical range, evidence type needed`,
    trend: `METHODOLOGY (Trend Analysis):
- If multiple evaluations exist for the same domain, show metric progression over time
- Identify improving vs degrading metrics
- Project simple trends (linear extrapolation) with explicit uncertainty bands
- Use line charts with clear time axes`,
  };

  const methodology = methodologyByType[analysisType] || methodologyByType.comparison;

  const systemPrompt = `You are an energy technology data analyst for Exergy Lab. You produce derived analyses and visualization specifications from existing evaluation data.

RULES:
- You analyze EXISTING evaluation/simulation/research data. You do not produce new scores or verdicts.
- All outputs are exploratory — useful for insight, but not authoritative evaluation results.
- For charts, produce declarative specs (JSON) with: chart_type, title, subtitle, data, x_key, y_keys, colors, reference_lines.
- Supported chart_type values: bar, line, radar, scatter, waterfall, table
- For analysis, identify patterns, tradeoffs, and insights from the structured data.
- Always cite which artifact(s) your analysis is derived from.
- Validate data before charting: if a value seems wrong (efficiency > 100%, negative power), flag it as suspicious rather than charting it.

${methodology}

Respond in JSON:
{
  "analysis_summary": "1-2 paragraph analysis grounded in the source data",
  "key_insights": ["insight 1 (with specific numbers)", "insight 2"],
  "chart_specs": [
    {
      "chart_type": "bar|line|radar|scatter|waterfall|table",
      "title": "Chart Title",
      "subtitle": "What this shows",
      "data": [{"label": "...", "value": 123}, ...],
      "x_key": "label",
      "y_keys": ["value"],
      "y_labels": {"value": "Display Name"},
      "source_description": "Derived from [artifact title]"
    }
  ],
  "assumptions": ["assumption 1"],
  "limitations": ["limitation 1"]
}`;

  const userPrompt = `QUESTION: ${question}\n\nANALYSIS TYPE: ${analysisType}\n\nSOURCE DATA (from project artifacts):\n${JSON.stringify(sourceData, null, 2).slice(0, 15000)}`;

  // Use Qwen 3.6 Plus for analytical reasoning (best reasoning model), DeepSeek V4-Flash fallback
  let analysis: Record<string, unknown> = {};
  try {
    const raw = await callQwen36Plus(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.2, maxTokens: 6000, jsonMode: true },
    );
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    else analysis = { analysis_summary: raw };
    // callQwen36Plus logs which model was actually used (Qwen or DeepSeek fallback)
    analysis.model_used = getEnvVar("DASHSCOPE_API_KEY") ? "qwen3.6-plus" : "deepseek-v4-flash";
  } catch { /* Analysis failed — proceed with empty */ }

  const hasChartSpecs =
    Array.isArray(analysis.chart_specs) && (analysis.chart_specs as unknown[]).length > 0;
  if (!analysis.analysis_summary || !hasChartSpecs) {
    const deterministicAnalysis = buildDeterministicExploratoryAnalysis(input, sourceData, analysisType);
    analysis = {
      ...deterministicAnalysis,
      ...analysis,
    };
    if (!hasChartSpecs) {
      analysis.chart_specs = deterministicAnalysis.chart_specs;
    }
  }

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "report",
    title: `Analysis: ${question.slice(0, 50) || analysisType}`,
    summary: (analysis.analysis_summary as string)?.slice(0, 150) || "Analysis complete",
    content: {
      artifact_lane: "exploratory",
      analysis_type: analysisType,
      question,
      ...analysis,
      source_artifact_count: sourceData.length,
    },
    source: "ai_synthesis",
    raw: analysis,
    metadata: { analysis_type: analysisType, model: (analysis.model_used as string) || "deepseek-v4-flash" },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: (analysis.model_used as string) || "deepseek-v4-flash",
      lane: "exploratory",
    },
    pinned: false,
  });
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildDeterministicExploratoryAnalysis(
  input: Record<string, unknown>,
  sourceData: Record<string, unknown>[],
  analysisType: string,
): Record<string, unknown> {
  const chartSpecs: Record<string, unknown>[] = [];
  const keyInsights: string[] = [];
  const limitations: string[] = [];

  for (const source of sourceData) {
    const content = recordFrom(source.content);
    const title = String(source.title || "source artifact");
    const modules = recordFrom(content.module_evaluations);
    const moduleRows = Object.entries(modules)
      .map(([moduleName, moduleValue]): Record<string, unknown> | null => {
        const module = recordFrom(moduleValue);
        const score = numberFrom(module.score_0_100);
        if (score === null) return null;
        return {
          module: moduleName.replace(/_/g, " "),
          score,
          verdict: String(module.verdict || "unknown"),
          confidence: numberFrom(module.confidence_0_1),
        };
      })
      .filter((row): row is Record<string, unknown> => row !== null);
    if (moduleRows.length > 0) {
      chartSpecs.push({
        chart_type: "bar",
        title: "Module Scorecard",
        subtitle: "Scores by evaluation module",
        data: moduleRows,
        x_key: "module",
        y_keys: ["score"],
        y_labels: { score: "Score (0-100)" },
        source_description: `Derived from ${title}`,
      });
      keyInsights.push(`Module scorecard available across ${moduleRows.length} modules from ${title}.`);
    }

    const exergyMetrics = recordFrom(content.exergy_metrics);
    const exergyRows = [
      ["Second-law efficiency", numberFrom(exergyMetrics.exergetic_efficiency)],
      ["First-law efficiency", numberFrom(exergyMetrics.first_law_efficiency)],
      ["Quality factor", numberFrom(exergyMetrics.quality_factor)],
    ]
      .filter(([, value]) => value !== null)
      .map(([metric, value]) => ({
        metric,
        value: metric === "Quality factor" ? value : Number(value) * 100,
      }));
    if (exergyRows.length > 0) {
      chartSpecs.push({
        chart_type: "bar",
        title: "Thermodynamic Quality Metrics",
        subtitle: "Computed exergy and first-law metrics",
        data: exergyRows,
        x_key: "metric",
        y_keys: ["value"],
        y_labels: { value: "Percent or factor" },
        source_description: `Derived from ${title}`,
      });
      keyInsights.push("Computed thermodynamic-quality metrics are available for charting.");
    }

    const brief = recordFrom(content.brief);
    const gaps = Array.isArray(brief.ranked_gap_guidance)
      ? brief.ranked_gap_guidance as Record<string, unknown>[]
      : [];
    if (gaps.length > 0) {
      chartSpecs.push({
        chart_type: "table",
        title: "Highest-Impact Evidence Gaps",
        subtitle: "Data requests that would most improve assessment quality",
        data: gaps.slice(0, 8).map((gap, idx) => ({
          rank: idx + 1,
          parameter: gap.parameter || "unspecified",
          impact: gap.impact || "unknown",
          rationale: gap.why_it_matters || gap.reason || "",
        })),
        x_key: "parameter",
        y_keys: ["impact"],
        source_description: `Derived from ${title}`,
      });
      keyInsights.push(`Ranked evidence-gap guidance is available from ${title}.`);
    }
  }

  if (chartSpecs.length === 0) {
    limitations.push("No numeric evaluation, simulation, economics, or gap data was available to chart.");
    const question = String(input.question || "");
    chartSpecs.push({
      chart_type: "table",
      title: "Targeted Data-Gathering Plan for Charting",
      subtitle: "Minimum source data needed before a numeric chart should be generated",
      data: buildChartDataGatheringPlan(question, analysisType),
      x_key: "metric_family",
      y_keys: ["evidence_request"],
      source_description:
        sourceData.length > 0
          ? "Derived from the absence of chartable numeric fields in current project artifacts"
          : "No project artifacts available",
    });
  }

  return {
    analysis_summary:
      chartSpecs.length > 0 && limitations.length > 0
        ? "No chartable numeric data was found in the current project artifacts; this output is a targeted data-gathering plan, not a computed chart."
        : sourceData.length > 0
        ? `Generated chart-ready views from ${sourceData.length} existing project artifact(s).`
        : "No project artifacts are available yet; run research, evaluation, or simulation first to create chartable data.",
    key_insights: keyInsights.length > 0 ? keyInsights : ["Chart output is limited by the structured data currently available."],
    chart_specs: chartSpecs,
    assumptions: [
      "Only values already present in project artifacts are charted.",
      "No missing economics, performance, or exergy values are inferred for chart generation.",
    ],
    limitations,
    analysis_type: analysisType,
    question: String(input.question || ""),
  };
}

function buildChartDataGatheringPlan(question: string, analysisType: string): Record<string, string>[] {
  const text = `${question} ${analysisType}`.toLowerCase();
  const rows: Record<string, string>[] = [];
  const add = (
    metricFamily: string,
    evidenceRequest: string,
    chartUnlocked: string,
    whyItMatters: string,
  ) => {
    rows.push({
      metric_family: metricFamily,
      evidence_request: evidenceRequest,
      chart_unlocked: chartUnlocked,
      why_it_matters: whyItMatters,
    });
  };

  if (/\b(cost|capex|opex|lcoe|lcof|price|economics|bankability)\b/.test(text)) {
    add(
      "Economics",
      "Provide sourced CAPEX, OPEX, energy/feedstock price, utilization, product price, and financing assumptions.",
      "Cost stack, sensitivity tornado, or breakeven table",
      "Cost and bankability charts are misleading without explicit assumptions and units.",
    );
  }

  if (/\b(exergy|efficiency|performance|yield|throughput|conversion|temperature|pressure)\b/.test(text)) {
    add(
      "Performance and exergy",
      "Provide measured efficiency, yield/conversion, throughput, operating temperature/pressure, and test duration with source context.",
      "Performance benchmark or thermodynamic quality chart",
      "Physics charts need measured or computed numeric values rather than qualitative claims.",
    );
  }

  if (/\b(risk|safety|regulatory|deployment|readiness|gap|diligence)\b/.test(text)) {
    add(
      "Risk and readiness",
      "Provide incident history, certification status, permitting requirements, unresolved hazards, and mitigation evidence.",
      "Risk matrix or evidence-gap table",
      "Risk visuals should distinguish documented blockers from generic diligence questions.",
    );
  }

  if (/\b(compare|comparison|benchmark|versus|vs|alternative)\b/.test(text)) {
    add(
      "Benchmark comparison",
      "Provide at least two comparable reference cases with matched metric definitions, units, source dates, and operating context.",
      "Benchmark bar chart or comparison table",
      "Comparison charts require like-for-like metrics to avoid false precision.",
    );
  }

  if (rows.length === 0) {
    add(
      "Core chart data",
      "Provide numeric metrics with units, source documents, date/context, and whether each value is measured, simulated, or estimated.",
      "Source-backed table or metric chart",
      "The platform should not infer missing numeric values just to satisfy a chart request.",
    );
  }

  return rows;
}

// ── Sub-Agent Handlers (R1 Deep Analysis + S1 Pro Scientific Review) ──

async function handleDeepAnalysis(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const artifactId = input.artifact_id as string;
  const question = (input.question as string) || "Analyze these evaluation results in depth. What are the key implications, tradeoffs, and risks?";

  // Load the target artifact to analyze
  let artifactData: Record<string, unknown> = {};
  if (artifactId) {
    const art = await storage.getArtifact(projectId, artifactId);
    if (art?.content) artifactData = art.content as Record<string, unknown>;
  }

  // If no specific artifact found (bad ID or not provided), gather ALL recent artifacts.
  // Load in parallel to avoid serial await latency.
  if (Object.keys(artifactData).length === 0) {
    const artifacts = await storage.listArtifacts(projectId);
    const recent5 = artifacts.slice(0, 5);
    const fullArts = await Promise.all(
      recent5.map((a) => storage.getArtifact(projectId, a.id))
    );
    for (let i = 0; i < recent5.length; i++) {
      const a = recent5[i];
      const full = fullArts[i];
      if (full?.content) {
        artifactData[`${a.type}_${a.id.slice(0, 8)}`] = { type: a.type, title: a.title, summary: a.summary, content: full.content };
      }
    }
  }

  // Extract enrichment context from evaluation brief (if available)
  const briefData = artifactData.brief as Record<string, unknown> | undefined;
  const enrichment: Record<string, unknown> = {};
  if (briefData) {
    enrichment.credibility_tier = briefData.credibility_tier;
    enrichment.readiness_tier = briefData.readiness_tier;
    enrichment.composite_score = briefData.composite_score;
    enrichment.evidence_level = artifactData.evidence_level;
    enrichment.baseline_comparisons = (briefData.baseline_comparisons as unknown[] || []).slice(0, 6);
    enrichment.evidence_coverage = briefData.evidence_coverage_summary;
    enrichment.ranked_gaps = (briefData.ranked_gap_guidance as unknown[] || []).slice(0, 5);
    enrichment.caveats = (briefData.caveats as string[] || []).slice(0, 3);
    enrichment.methodology = briefData.methodology_note;
  }

  // Accumulate prior step findings so each deep_analysis step has full context
  const priorFindings = (input.prior_step_findings as string) || "";

  // Call scientific oracle via the sidecar CLI (S1 Pro primary, R1 fallback)
  const prompt = JSON.stringify({
    task: "deep_analysis",
    question,
    domain: (artifactData.domain as string) || "",
    evaluation_data: artifactData,
    enrichment,
    ...(priorFindings ? { prior_step_findings: priorFindings.slice(0, 6000) } : {}),
  });

  const args = [
    "-m", "breakthrough_engine", "oracle", "analyze",
    "--prompt", prompt,
  ];

  const result = await runPython(args, 200_000);

  let analysis: Record<string, unknown> = {};
  try {
    if (result.code === 0 && result.stdout.trim()) {
      analysis = JSON.parse(result.stdout);
    }
  } catch {
    analysis = { raw_response: result.stdout, error: result.stderr };
  }

  // Clean up oracle assessment — strip leaked <tool_call> markup from intern-s1-pro
  if (analysis.assessment) {
    const rawAssessment = typeof analysis.assessment === "string"
      ? analysis.assessment
      : (analysis.assessment as Record<string, unknown>)?.raw as string || "";
    const cleaned = rawAssessment.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    if (!cleaned || cleaned.length < 20) {
      // Assessment was just tool_call markup with no real content — force fallback
      delete analysis.assessment;
    } else if (typeof analysis.assessment === "string") {
      analysis.assessment = cleaned;
    } else if (typeof analysis.assessment === "object") {
      (analysis.assessment as Record<string, unknown>).raw = cleaned;
    }
  }

  // If Python oracle CLI not available or assessment empty, fall back to calling R1 directly via API
  if (result.code !== 0 || !analysis.assessment) {
    const deepseekKey = getEnvVar("DEEPSEEK_API_KEY");
    if (deepseekKey) {
      try {
        const r1Resp = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
          body: JSON.stringify({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: `You are a senior energy technology analyst. Analyze the following evaluation results and provide a structured assessment.\n\nQUESTION: ${question}\n\n${priorFindings ? `FINDINGS FROM PRIOR ANALYSIS STEPS (build on these, do not repeat):\n${priorFindings.slice(0, 4000)}\n\n` : ""}DATA:\n${JSON.stringify(artifactData, null, 2).slice(0, 10000)}\n\nProvide your analysis as JSON with these TOP-LEVEL keys (keep values concise — each finding/risk/action should be 1-2 sentences max):\n{"key_findings": ["finding 1", "finding 2", ...], "risks": ["risk 1", "risk 2", ...], "opportunities": ["opp 1", ...], "tradeoffs": ["tradeoff 1", ...], "confidence_assessment": "one paragraph", "recommended_actions": ["action 1", ...]}` }],
            max_tokens: 8192,
          }),
        });
        if (r1Resp.ok) {
          const r1Data = await r1Resp.json();
          const raw = r1Data.choices?.[0]?.message?.content || "";
          const reasoning = r1Data.choices?.[0]?.message?.reasoning_content || "";
          try {
            analysis = { ...JSON.parse(raw), reasoning_trace: reasoning.slice(0, 2000) };
          } catch {
            try {
              const stripped = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
              const jsonMatch = stripped.match(/\{[\s\S]*\}/);
              if (jsonMatch) analysis = { ...JSON.parse(jsonMatch[0]), reasoning_trace: reasoning.slice(0, 2000) };
              else analysis = { raw_response: raw, reasoning_trace: reasoning.slice(0, 2000) };
            } catch {
              // JSON is likely truncated (max_tokens hit). Extract what we can.
              const stripped = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
              analysis = { raw_response: raw, reasoning_trace: reasoning.slice(0, 2000) };
              // Salvage key_findings from truncated JSON via regex
              const findingsMatch = stripped.match(/"key_findings"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
              if (findingsMatch) {
                const items = findingsMatch[1].match(/"([^"]{10,})"/g);
                if (items) analysis.key_findings = items.map((s: string) => s.replace(/^"|"$/g, ""));
              }
              const risksMatch = stripped.match(/"risks"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
              if (risksMatch) {
                const items = risksMatch[1].match(/"([^"]{10,})"/g);
                if (items) analysis.risks = items.map((s: string) => s.replace(/^"|"$/g, ""));
              }
              const actionsMatch = stripped.match(/"recommended_actions"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
              if (actionsMatch) {
                const items = actionsMatch[1].match(/"([^"]{10,})"/g);
                if (items) analysis.recommended_actions = items.map((s: string) => s.replace(/^"|"$/g, ""));
              }
            }
          }
          analysis.model_used = "deepseek-v4-pro";
        }
      } catch (e) {
        analysis = { error: `DeepSeek V4-Pro API call failed: ${e instanceof Error ? e.message : "unknown"}` };
      }
    }
  }

  // Extract nested findings from assessment.raw JSON (V4-Pro/S1Pro often nest data inside assessment)
  if (!analysis.key_findings || (analysis.key_findings as unknown[]).length === 0) {
    try {
      const rawAssessment = typeof analysis.assessment === "string"
        ? analysis.assessment
        : (analysis.assessment as Record<string, unknown>)?.raw as string || "";
      if (rawAssessment) {
        const stripped = rawAssessment.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
        const jsonMatch = stripped.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const nested = JSON.parse(jsonMatch[0]);
          // Lift key fields to top level where the card widget expects them
          const inner = nested.assessment || nested;
          if (inner.key_findings) analysis.key_findings = inner.key_findings;
          if (inner.risks) analysis.risks = inner.risks;
          if (inner.opportunities) analysis.opportunities = inner.opportunities;
          if (inner.tradeoffs) analysis.tradeoffs = inner.tradeoffs;
          if (inner.confidence_assessment) analysis.confidence_assessment = inner.confidence_assessment;
          if (inner.recommended_actions) analysis.recommended_actions = inner.recommended_actions;
          if (nested.disagreements) analysis.disagreements = nested.disagreements;
          if (nested.confidence) analysis.confidence = nested.confidence;
          if (nested.deployment_readiness || inner.deployment_readiness) analysis.deployment_readiness = nested.deployment_readiness || inner.deployment_readiness;
        }
      }
    } catch { /* nested parse failed — keep whatever we have */ }
  }

  // Salvage from raw_response if key_findings still empty (truncated JSON case)
  if ((!analysis.key_findings || (analysis.key_findings as unknown[]).length === 0) && analysis.raw_response) {
    const rawStr = String(analysis.raw_response);
    const stripped = rawStr.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const findingsMatch = stripped.match(/"key_findings"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
    if (findingsMatch) {
      const items = findingsMatch[1].match(/"([^"]{10,})"/g);
      if (items) analysis.key_findings = items.map((s: string) => s.replace(/^"|"$/g, ""));
    }
    if (!analysis.risks || (analysis.risks as unknown[]).length === 0) {
      const risksMatch = stripped.match(/"risks"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
      if (risksMatch) {
        const items = risksMatch[1].match(/"([^"]{10,})"/g);
        if (items) analysis.risks = items.map((s: string) => s.replace(/^"|"$/g, ""));
      }
    }
    if (!analysis.recommended_actions || (analysis.recommended_actions as unknown[]).length === 0) {
      const actionsMatch = stripped.match(/"recommended_actions"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
      if (actionsMatch) {
        const items = actionsMatch[1].match(/"([^"]{10,})"/g);
        if (items) analysis.recommended_actions = items.map((s: string) => s.replace(/^"|"$/g, ""));
      }
    }
  }

  // Ensure key fields are never empty — fallback generation from available data
  if (!analysis.key_findings || (analysis.key_findings as unknown[]).length === 0) {
    const fallbackFindings: Array<{finding: string; support?: string}> = [];
    // Pull from any available text in the analysis
    if (analysis.summary) fallbackFindings.push({ finding: String(analysis.summary), support: "analysis summary" });
    if (analysis.recommendation) fallbackFindings.push({ finding: String(analysis.recommendation), support: "model recommendation" });
    if (analysis.assessment && typeof analysis.assessment === "string")
      fallbackFindings.push({ finding: analysis.assessment.slice(0, 300), support: "raw assessment" });
    // Pull from artifact context if available
    const briefData = (artifactData as Record<string, unknown>)?.brief as Record<string, unknown> | undefined;
    if (briefData?.key_strengths) {
      for (const s of (briefData.key_strengths as string[]).slice(0, 2)) {
        fallbackFindings.push({ finding: s, support: "evaluation strengths" });
      }
    }
    if (briefData?.key_concerns) {
      for (const c of (briefData.key_concerns as string[]).slice(0, 2)) {
        fallbackFindings.push({ finding: c, support: "evaluation concerns" });
      }
    }
    if (fallbackFindings.length > 0) analysis.key_findings = fallbackFindings;
  }
  if (!analysis.risks || (analysis.risks as unknown[]).length === 0) {
    // Build risks from evaluation caveats/concerns
    const fallbackRisks: Array<{risk: string; severity?: string}> = [];
    const adCaveats = (artifactData as Record<string, unknown>)?.caveats as string[] | undefined;
    if (adCaveats) {
      for (const cav of adCaveats.slice(0, 3)) {
        if (cav && !cav.includes("builtin domain")) fallbackRisks.push({ risk: cav, severity: "medium" });
      }
    }
    const adBrief = (artifactData as Record<string, unknown>)?.brief as Record<string, unknown> | undefined;
    if (adBrief?.key_concerns) {
      for (const c of (adBrief.key_concerns as string[]).slice(0, 2)) {
        fallbackRisks.push({ risk: c, severity: "high" });
      }
    }
    if (fallbackRisks.length > 0) analysis.risks = fallbackRisks;
  }
  if (!analysis.recommended_actions || (analysis.recommended_actions as unknown[]).length === 0) {
    const fallbackActions: Array<{action: string; priority?: string}> = [];
    const adBrief2 = (artifactData as Record<string, unknown>)?.brief as Record<string, unknown> | undefined;
    if (adBrief2?.next_actions) {
      for (const a of (adBrief2.next_actions as string[]).slice(0, 3)) {
        fallbackActions.push({ action: a, priority: "high" });
      }
    }
    if (fallbackActions.length > 0) analysis.recommended_actions = fallbackActions;
  }

  // Extract oracle metadata for transparency
  const oracleToolCalls = analysis.tool_calls as unknown[] || [];
  const oracleRecommendation = analysis.recommendation as string || "";
  const oracleConcordance = analysis.concordance_score as number || 0;

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "deep_analysis",
    title: `Deep Analysis: ${question.slice(0, 50)}`,
    summary: (analysis.key_findings as Array<{finding?: string}>)?.[0]?.finding || (analysis.key_findings as string[])?.[0] || "Analysis complete",
    content: {
      analysis_type: "deep_analysis",
      question,
      ...analysis,
      oracle_metadata: {
        n_tool_calls: oracleToolCalls.length,
        tool_calls: oracleToolCalls.slice(0, 10),
        recommendation: oracleRecommendation,
        concordance_score: oracleConcordance,
      },
    },
    source: "ai_synthesis",
    raw: analysis,
    metadata: {
      model: (analysis.model_used as string) || (result.code === 0 ? "intern-s1-pro" : "deepseek-v4-pro"),
      question,
      oracle_tool_calls: oracleToolCalls.length,
      oracle_recommendation: oracleRecommendation,
    },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: (analysis.model_used as string) || (result.code === 0 ? "intern-s1-pro" : "deepseek-v4-pro"),
    },
    pinned: false,
  });
}

async function handleScientificReview(
  projectId: string,
  input: Record<string, unknown>,
): Promise<Artifact> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  const claims = input.claims as Record<string, unknown> || {};
  const domain = resolveAuthoritativeDomain(input.domain as string | undefined, project, "");
  const description = (input.description as string) || "";

  // Build enriched review prompt for S1 Pro / R1 fallback
  // The oracle's tool harness will use domain to look up schemas, run physics, etc.
  const reviewData = JSON.stringify({
    task: "scientific_plausibility_review",
    domain,
    description,
    claimed_parameters: claims,
    instructions: "Use your tools: (1) get_domain_schema to check typical parameter ranges, (2) validate_params to catch physics violations, (3) run_physics to compute expected values from the claimed parameters, (4) get_reference_cases to compare against real commercial devices, (5) compute_concordance between claimed and computed values. Ground every assessment in tool results.",
  });

  // Try Python oracle sidecar first
  const args = ["-m", "breakthrough_engine", "oracle", "review", "--prompt", reviewData];
  const result = await runPython(args, 200_000);

  let review: Record<string, unknown> = {};
  try {
    if (result.code === 0 && result.stdout.trim()) {
      review = JSON.parse(result.stdout);
    }
  } catch {
    review = {};
  }

  // Fallback: call R1 directly (S1 Pro would be primary in oracle sidecar)
  if (!review.plausibility_assessment) {
    const deepseekKey = getEnvVar("DEEPSEEK_API_KEY");
    if (deepseekKey) {
      try {
        const r1Resp = await fetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
          body: JSON.stringify({
            model: "deepseek-v4-pro",
            messages: [{ role: "user", content: `You are a scientific reviewer specializing in energy technology. Review the following parameter claims for physical plausibility.\n\nDOMAIN: ${domain}\nDESCRIPTION: ${description}\nCLAIMED PARAMETERS:\n${JSON.stringify(claims, null, 2)}\n\nFor each parameter, assess:\n1. Is this value physically possible?\n2. Is it within typical published ranges for this technology class?\n3. What would make this claim more or less credible?\n\nRespond as JSON: {"plausibility_assessment": "plausible|questionable|implausible", "parameter_reviews": [{"param": "...", "value": ..., "assessment": "plausible|questionable|implausible", "typical_range": "...", "reasoning": "..."}], "overall_confidence": "high|medium|low", "concerns": [...], "suggestions": [...]}` }],
            max_tokens: 4096,
          }),
        });
        if (r1Resp.ok) {
          const r1Data = await r1Resp.json();
          const raw = r1Data.choices?.[0]?.message?.content || "";
          const reasoning = r1Data.choices?.[0]?.message?.reasoning_content || "";
          try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) review = { ...JSON.parse(jsonMatch[0]), reasoning_trace: reasoning.slice(0, 2000) };
            else review = { raw_response: raw, reasoning_trace: reasoning.slice(0, 2000) };
          } catch {
            review = { raw_response: raw, reasoning_trace: reasoning.slice(0, 2000) };
          }
          review.model_used = "deepseek-v4-pro";
        }
      } catch (e) {
        review = { error: `DeepSeek V4-Pro API call failed: ${e instanceof Error ? e.message : "unknown"}` };
      }
    }
  }

  // Ensure key fields are never empty — fallback from claimed parameters
  if (!review.plausibility_assessment) {
    review.plausibility_assessment = "questionable";
  }
  if (!review.parameter_reviews || (review.parameter_reviews as unknown[]).length === 0) {
    const fallbackReviews: Array<Record<string, unknown>> = [];
    for (const [param, value] of Object.entries(claims || {})) {
      if (typeof value === "number" || typeof value === "string") {
        fallbackReviews.push({
          parameter: param.replace(/_/g, " "),
          claimed_value: value,
          assessment: "needs_verification",
          reasoning: "Automated plausibility check did not return structured data for this parameter. Independent verification recommended.",
        });
      }
    }
    if (fallbackReviews.length > 0) review.parameter_reviews = fallbackReviews;
  }
  if (!review.concerns || (review.concerns as unknown[]).length === 0) {
    review.concerns = ["Automated scientific review did not produce structured concerns. Manual expert review recommended for critical parameters."];
  }
  if (!review.suggestions || (review.suggestions as unknown[]).length === 0) {
    review.suggestions = ["Provide independent test data to validate claimed performance values."];
  }

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "scientific_review",
    title: `Scientific Review: ${domain || description.slice(0, 40)}`,
    summary: `Plausibility: ${(review.plausibility_assessment as string) || "questionable"}`,
    content: {
      analysis_type: "scientific_review",
      domain,
      description,
      claimed_parameters: claims,
      ...review,
    },
    source: "ai_synthesis",
    raw: review,
    metadata: { model: (review.model_used as string) || (result.code === 0 ? "intern-s1-pro" : "deepseek-v4-pro"), domain },
    action_id: "",
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: (review.model_used as string) || (result.code === 0 ? "intern-s1-pro" : "deepseek-v4-pro"),
    },
    pinned: false,
  });
}

async function handleEnvironmentalSiteAnalysis(
  projectId: string,
  input: Record<string, unknown>,
  actionId: string,
): Promise<Artifact> {
  const storage = getStorage();
  const result = await collectEnvironmentalSiteData({
    question: typeof input.question === "string" ? input.question : undefined,
    description: typeof input.description === "string" ? input.description : undefined,
    location: typeof input.location === "string" ? input.location : undefined,
    latitude: input.latitude as number | string | undefined,
    longitude: input.longitude as number | string | undefined,
    radius_km: input.radius_km as number | string | undefined,
  });

  const locationLabel = result.location
    ? `${result.location.label} (${result.location.lat.toFixed(4)}, ${result.location.lon.toFixed(4)})`
    : "location needed";
  const notProven = result.limitations.slice(0, 4);
  const dataRequests = result.recommended_actions.map((action) => ({
    request: action,
    why_it_matters: "Turns remote environmental context into decision-grade evidence.",
  }));

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "evaluation",
    title: result.status === "complete"
      ? `Environmental Site Context: ${locationLabel}`
      : "Environmental Site Context Needs Location",
    summary: result.executive_summary,
    content: {
      analysis_type: "exergy_agent_assessment",
      environmental_site_data: result,
      client_summary: {
        decision: result.status === "complete"
          ? "Environmental site data collected"
          : "Environmental site data blocked",
        conclusion: result.executive_summary,
        confidence: result.confidence,
        evidence_label: result.confidence,
        use_case_label: "Environmental site context",
        computed_metrics: result.computed_metrics,
        supported_claims: result.supported_claims,
        not_proven: notProven,
        recommended_actions: result.recommended_actions.map((action) => ({ action })),
        data_requests: dataRequests,
        priority_recommendation: {
          title: result.status === "complete"
            ? "Use this as site context, not final permitting evidence"
            : "Provide a site location",
          rationale: result.status === "complete"
            ? "Remote layers are useful for early environmental risk review, but local permits, monitoring, and field data control the final assessment."
            : "The tool needs coordinates, an address, or a named location before remote environmental data can be collected.",
        },
      },
    },
    source: "canonical_engine",
    raw: result as unknown as Record<string, unknown>,
    metadata: {
      action_type: "environmental_site_analysis",
      provider_count: result.provider_results.length,
      available_provider_count: result.provider_results.filter((provider) => provider.status === "available").length,
    },
    action_id: actionId,
    provenance: {
      source: "canonical_engine",
      deterministic: true,
      engine_version: "environmental-site-data-v1",
    },
    pinned: false,
  });
}

async function handleAgentWorkspace(
  projectId: string,
  input: Record<string, unknown>,
  actionId: string,
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  const docs = await storage.listDocuments(projectId);
  const explicitAttachments = Array.isArray(input.current_attachments)
    ? input.current_attachments.filter((item): item is string => typeof item === "string")
    : [];
  const referenced = Array.from(new Set([...explicitAttachments, ...extractReferencedUploadNames(input)]));
  const selectedDocs = filterReferencedDocs(docs, referenced);
  const uploadPaths = await getProjectUploadPaths(projectId, selectedDocs.map((doc) => doc.filename));
  const requestedOutputs = Array.isArray(input.requested_outputs)
    ? input.requested_outputs.filter((item): item is string => typeof item === "string")
    : [];
  const task = String(input.task || input.question || input.description || "Run a project workspace analysis");
  const context = [
    input.context ? String(input.context) : "",
    Array.isArray(input.plan_outline) && input.plan_outline.length > 0
      ? [
        "Approved execution plan:",
        ...input.plan_outline
          .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
          .slice(0, 12)
          .map((item, index) => {
            const title = typeof item.title === "string" ? item.title : `Step ${index + 1}`;
            const description = typeof item.description === "string" ? item.description : "";
            return `${index + 1}. ${title}${description ? `: ${description}` : ""}`;
          }),
      ].join("\n")
      : "",
    project?.name ? `Project: ${project.name}` : "",
    project?.description ? `Description: ${project.description}` : "",
    project?.goal ? `Goal: ${project.goal}` : "",
    project?.domain ? `Domain: ${project.domain}` : "",
    selectedDocs.length ? `Uploaded files: ${selectedDocs.map((doc) => doc.filename).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const run = await runAgentWorkspaceTask({
    projectId,
    actionId,
    task,
    context,
    uploadPaths,
    currentAttachments: selectedDocs.map((doc) => doc.filename),
    requestedOutputs,
    allowNetwork: input.allow_network === true,
    allowDependencyInstall: input.allow_dependency_install !== false,
    timeoutMs: typeof input.timeout_ms === "number" ? input.timeout_ms : undefined,
  });

  const outputSummary = run.files
    .slice(0, 8)
    .map((file) => `${file.filename} (${Math.max(1, Math.round(file.bytes / 1024))} KB)`);

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "workspace_run",
    title: `Workspace Run: ${task.slice(0, 70)}${task.length > 70 ? "..." : ""}`,
    summary: run.summary,
    content: {
      analysis_type: "agent_workspace",
      task,
      report_markdown: run.reportMarkdown,
      results: run.results,
      files: run.files,
      output_summary: outputSummary,
      process_steps: run.steps,
      execution: {
        exit_code: run.exitCode,
        stdout: run.stdout,
        stderr: run.stderr,
        requirements: run.requirements,
        installed_requirements: run.installedRequirements,
        install_log: run.installLog,
        attempts: run.executionAttempts,
        work_dir: run.workDir,
        output_dir: run.outputDir,
      },
      sandbox: run.sandbox,
      security_findings: run.securityFindings,
      generated_code: run.generatedCode,
      client_summary: {
        decision: run.exitCode === 0 ? "Workspace run complete" : "Workspace run completed with limitations",
        conclusion: run.summary,
        supported_claims: [
          {
            claim: run.summary,
            evidence: run.files.length > 0
              ? `Generated ${run.files.length} output file${run.files.length === 1 ? "" : "s"} for the detailed workspace result.`
              : "Generated a written workspace result.",
          },
        ],
        not_proven: run.exitCode === 0
          ? []
          : ["The executable workspace tool could not complete cleanly; the answer is a best-effort synthesis from available context and diagnostics."],
        recommended_actions: run.exitCode === 0
          ? []
          : [{ action: "Provide the missing source values or ask the agent to rerun the calculation with narrower assumptions." }],
      },
    },
    source: "ai_synthesis",
    raw: run as unknown as Record<string, unknown>,
    metadata: {
      action_type: "agent_workspace",
      n_outputs: run.files.length,
      exit_code: run.exitCode,
      sandbox_mode: run.sandbox.mode,
      network_enabled: run.sandbox.network,
      current_attachments: selectedDocs.map((doc) => doc.filename),
    },
    parent_id: parentArtifactId,
    action_id: actionId,
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: "deepseek-v4-flash",
      lane: "exploratory",
    },
    pinned: false,
  });
}

async function executeDeepAgentToolStep(args: {
  projectId: string;
  step: DeepAgentPlanStep;
  actionId: string;
  parentArtifactId?: string;
}): Promise<{ status: "completed" | "failed"; summary: string; action_id?: string; artifact?: Artifact | null; error?: string }> {
  const { projectId, step, actionId, parentArtifactId } = args;
  const input = { ...step.input };
  let artifact: Artifact;
  switch (step.tool_type) {
    case "literature_search":
      artifact = await handleResearch(projectId, input);
      break;
    case "deep_research":
      artifact = await handleDeepResearch(projectId, input);
      break;
    case "physics_simulation":
      artifact = await handlePhysicsSimulation(projectId, input, actionId, parentArtifactId);
      break;
    case "economics_analysis":
      artifact = await handleEconomicsAnalysis(projectId, input, actionId, parentArtifactId);
      break;
    case "environmental_site_analysis":
      artifact = await handleEnvironmentalSiteAnalysis(projectId, input, actionId);
      break;
    case "agent_workspace":
      artifact = await handleAgentWorkspace(projectId, input, actionId, parentArtifactId);
      break;
    case "custom_chart":
      artifact = await handleCustomChart(projectId, input);
      break;
    case "exploratory_analysis":
      artifact = await handleExploratoryAnalysis(projectId, input);
      break;
    case "scientific_review":
      artifact = await handleScientificReview(projectId, input);
      break;
    case "document_analysis":
      if (typeof input.document_id === "string" && input.document_id.trim()) {
        artifact = await handleDocumentAnalysis(projectId, input);
      } else {
        artifact = await handleExergyAgentAnalysis(projectId, input, actionId, parentArtifactId);
      }
      break;
    case "comprehensive_analysis":
    case "deep_analysis":
    case "evidence_evaluation":
    case "module_evaluation":
    case "simulation_run":
      artifact = step.tool_type === "simulation_run"
        ? await handleSimulation(projectId, input, parentArtifactId)
        : await handleExergyAgentAnalysis(projectId, input, actionId, parentArtifactId);
      break;
    default:
      throw new Error(`Deep agent tool '${step.tool_type}' is not available`);
  }
  return {
    status: "completed",
    summary: buildActionResultSummary({ actionType: step.tool_type, artifact }),
    action_id: actionId,
    artifact,
  };
}

function deepAgentFilesFromToolRuns(toolRuns: Array<{ artifact?: Artifact | null }>): Array<Record<string, unknown>> {
  const files: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const run of toolRuns) {
    const artifact = run.artifact;
    const content = artifact?.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const listed: unknown[] = Array.isArray((content as Record<string, unknown>).files)
      ? (content as Record<string, unknown>).files as unknown[]
      : [];
    for (const file of listed) {
      if (!file || typeof file !== "object" || Array.isArray(file)) continue;
      const record = file as Record<string, unknown>;
      const filename = typeof record.filename === "string" ? record.filename : "";
      const path = typeof record.path === "string" ? record.path : "";
      if (!filename || !path) continue;
      const key = `${artifact?.id || "artifact"}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({
        ...record,
        filename,
        path,
        source_artifact_id: artifact?.id,
      });
    }
  }
  return files.slice(0, 20);
}

async function handleDeepAgent(
  projectId: string,
  input: Record<string, unknown>,
  actionId: string,
  parentArtifactId?: string,
): Promise<Artifact> {
  const storage = getStorage();
  const [project, docs, artifactSummaries] = await Promise.all([
    storage.getProject(projectId),
    storage.listDocuments(projectId),
    storage.listArtifacts(projectId),
  ]);
  const artifacts = (await Promise.all(
    artifactSummaries.slice(-12).map((summary) => storage.getArtifact(projectId, summary.id)),
  )).filter((artifact): artifact is Artifact => !!artifact);
  const explicitAttachments = Array.isArray(input.current_attachments)
    ? input.current_attachments.filter((item): item is string => typeof item === "string")
    : [];
  const selectedDocs = filterReferencedDocs(docs, Array.from(new Set([...explicitAttachments, ...extractReferencedUploadNames(input)])));
  const question = String(input.question || input.query || input.task || input.description || "Run a deep workspace analysis");
  const domain = String(input.domain || project?.domain || "general");
  const requiredOutputs = Array.isArray(input.required_outputs)
    ? input.required_outputs.filter((item): item is string => typeof item === "string")
    : Array.isArray(input.requested_outputs)
      ? input.requested_outputs.filter((item): item is string => typeof item === "string")
      : [];

  const result = await executeDeepAgent({
    project,
    question,
    domain,
    documents: selectedDocs,
    artifacts,
    context: typeof input.context === "string" ? input.context : "",
    requiredOutputs,
    maxSteps: typeof input.max_steps === "number" ? input.max_steps : 6,
    executeTool: (step) => executeDeepAgentToolStep({ projectId, step, actionId, parentArtifactId }),
  });
  const files = deepAgentFilesFromToolRuns(result.tool_runs);

  return storage.createArtifact(projectId, {
    schema_version: 1,
    type: "deep_agent" as ArtifactType,
    title: `Deep Agent Run: ${question.slice(0, 65)}${question.length > 65 ? "..." : ""}`,
    summary: result.final_answer.replace(/\s+/g, " ").slice(0, 300) || "Deep agent run complete.",
    content: {
      analysis_type: "deep_agent",
      question,
      final_answer: result.final_answer,
      plan: result.plan,
      tool_runs: result.tool_runs.map((run) => ({
        step_id: run.step_id,
        tool_type: run.tool_type,
        status: run.status,
        summary: run.summary,
        action_id: run.action_id,
        artifact_id: run.artifact?.id,
        artifact_type: run.artifact?.type,
        error: run.error,
      })),
      evidence_ledger: result.evidence_ledger,
      verification: result.verification,
      quality_evaluation: result.quality_evaluation,
      files,
      source_artifact_ids: result.tool_runs.map((run) => run.artifact?.id).filter(Boolean),
    },
    source: "ai_synthesis",
    raw: result as unknown as Record<string, unknown>,
    metadata: {
      action_type: "deep_agent",
      domain,
      n_steps: result.plan.length,
      n_completed_tools: result.tool_runs.filter((run) => run.status === "completed").length,
      n_failed_tools: result.tool_runs.filter((run) => run.status === "failed").length,
      quality_score: result.quality_evaluation.score,
      current_attachments: selectedDocs.map((doc) => doc.filename),
    },
    parent_id: parentArtifactId,
    action_id: actionId,
    provenance: {
      source: "ai_synthesis",
      deterministic: false,
      model: "deepseek-v4-flash",
      lane: "exploratory",
    },
    pinned: false,
  });
}

async function executeActionRecord(args: {
  projectId: string;
  action: Action;
  actionType: ActionType;
  input: Record<string, unknown>;
  parentArtifactId?: string;
  quotaAction?: string;
  actionsUserId?: string;
}): Promise<Artifact | null> {
  const { projectId, action, actionType, input, parentArtifactId, quotaAction, actionsUserId } = args;
  const storage = getStorage();
  try {
    let artifact: Artifact;
    let resolvedActionType = actionType;
    if (actionType === "simulation_run") {
      const docs = await storage.listDocuments(projectId);
      const hasDocuments = docs.length > 0;
      const numericParamKeys = [
        "capacity_mAh", "impedance_mOhm", "weight_g", "ambient_temp_C", "cycle_count",
        "I_L_ref", "I_o_ref", "R_s", "R_sh_ref", "a_ref", "N_s", "irradiance", "cell_temp",
        "rated_power_w", "r_on_mohm", "f_sw_khz", "e_sw_uj", "p_aux_w", "v_dc_nom",
      ];
      const hasExplicitNumericParams = numericParamKeys.some(
        k => typeof input[k] === "number" || (typeof input[k] === "string" && !isNaN(Number(input[k]))),
      );
      if (hasDocuments && !hasExplicitNumericParams) {
        resolvedActionType = "evidence_evaluation" as ActionType;
      }
    }

    const actionT0 = Date.now();
    logDebug("action", `Starting ${resolvedActionType}`, { action_type: resolvedActionType, project_id: projectId });
    switch (resolvedActionType) {
      case "simulation_run":
        artifact = await handleSimulation(projectId, input, parentArtifactId);
        break;
      case "physics_simulation":
        artifact = await handlePhysicsSimulation(projectId, input, action.id, parentArtifactId);
        break;
      case "economics_analysis":
        artifact = await handleEconomicsAnalysis(projectId, input, action.id, parentArtifactId);
        break;
      case "document_analysis":
      case "module_evaluation":
      case "evidence_evaluation":
      case "deep_analysis":
      case "scientific_review":
      case "comprehensive_analysis":
        artifact = await handleExergyAgentAnalysis(projectId, input, action.id, parentArtifactId);
        break;
      case "literature_search":
        artifact = await handleResearch(projectId, input);
        break;
      case "deep_research":
        artifact = await handleDeepResearch(projectId, input);
        break;
      case "deep_agent":
        artifact = await handleDeepAgent(projectId, input, action.id, parentArtifactId);
        break;
      case "deep_diligence":
        artifact = await handleDeepDiligence(projectId, input);
        break;
      case "evidence_interview":
        artifact = await handleEvidenceInterview(projectId, input);
        break;
      case "custom_chart":
        artifact = await handleCustomChart(projectId, input);
        break;
      case "exploratory_analysis":
        artifact = await handleExploratoryAnalysis(projectId, input);
        break;
      case "environmental_site_analysis":
        artifact = await handleEnvironmentalSiteAnalysis(projectId, input, action.id);
        break;
      case "agent_workspace":
        artifact = await handleAgentWorkspace(projectId, input, action.id, parentArtifactId);
        break;
      case "update_project": {
        const updates: Record<string, unknown> = {};
        if (input.domain && typeof input.domain === "string") updates.domain = input.domain;
        if (input.description && typeof input.description === "string") updates.description = input.description;
        if (input.goal && typeof input.goal === "string") updates.goal = input.goal;
        if (Object.keys(updates).length > 0) {
          await storage.updateProject(projectId, updates as any);
        }
        artifact = await storage.createArtifact(projectId, {
          schema_version: 1, type: "evaluation" as any,
          title: `Project Updated: ${Object.keys(updates).join(", ")}`,
          summary: `Updated ${Object.keys(updates).join(", ")} — ${JSON.stringify(updates).slice(0, 100)}`,
          content: { update_type: "project_settings", updates },
          source: "canonical_engine", raw: updates, metadata: {},
          action_id: action.id, provenance: { source: "canonical_engine", deterministic: true },
          pinned: false,
        });
        break;
      }
      case "generate_pdf":
        artifact = await storage.createArtifact(projectId, {
          schema_version: 1, type: "evaluation" as any,
          title: "Report Export Requires Completed Evaluation",
          summary: "A PDF report can be exported after a completed evaluation artifact exists. Ordinary chat answers do not create a separate downloadable report.",
          content: {
            report_ready: false,
            instruction: "Run or open a completed evaluation first, then use the report export flow for that evaluation.",
            generated_at: new Date().toISOString(),
          },
          source: "canonical_engine", raw: {}, metadata: {},
          action_id: action.id, provenance: { source: "canonical_engine", deterministic: true },
          pinned: false,
        });
        break;
      default:
        throw new Error(`Action type '${actionType}' not yet implemented`);
    }

    logDebug("action", `Completed ${resolvedActionType}`, {
      action_type: resolvedActionType,
      artifact_type: artifact.type,
      success: true,
    }, Date.now() - actionT0);

    if (artifact.content && typeof artifact.content === "object") {
      const c = artifact.content as Record<string, unknown>;
      delete c.model_used;
      delete c.oracle_metadata;
    }

    await storage.updateAction(projectId, action.id, {
      status: "completed",
      artifact_id: artifact.id,
      completed_at: new Date().toISOString(),
    });

    if (quotaAction && actionsUserId) {
      try {
        const { trackUsage } = await import("@/lib/usage");
        await trackUsage(actionsUserId, quotaAction, projectId);
      } catch { /* non-fatal */ }
    }
    return artifact;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await storage.updateAction(projectId, action.id, {
      status: "failed",
      error: errorMsg,
      completed_at: new Date().toISOString(),
    });
    return null;
  }
}

interface ProjectActionExecutionResult {
  action: Action;
  artifact: Artifact | null;
  result_summary: string | null;
  recovered_from_error?: boolean;
}

async function executeProjectAction(args: {
  projectId: string;
  actionType: ActionType;
  input: Record<string, unknown>;
  parentArtifactId?: string;
  trigger?: Action["trigger"];
  quotaAction?: string;
  actionsUserId?: string;
  background?: boolean;
}): Promise<ProjectActionExecutionResult> {
  const {
    projectId,
    actionType,
    input,
    parentArtifactId,
    trigger = "user",
    quotaAction,
    actionsUserId,
    background = false,
  } = args;
  const storage = getStorage();
  const project = await storage.getProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  const action = await storage.createAction(projectId, {
    project_id: projectId,
    type: actionType,
    status: "running",
    trigger,
    parent_artifact_id: parentArtifactId,
    input,
  });

  if (background) {
    void executeActionRecord({
      projectId,
      action,
      actionType,
      input,
      parentArtifactId,
      quotaAction,
      actionsUserId,
    }).catch((err) => {
      logDebug("action", "Background action worker failed", {
        action_id: action.id,
        action_type: actionType,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return { action, artifact: null, result_summary: null };
  }

  const directArtifact = await executeActionRecord({
    projectId,
    action,
    actionType,
    input,
    parentArtifactId,
    quotaAction,
    actionsUserId,
  });

  const canReadAction = typeof (storage as unknown as { getAction?: unknown }).getAction === "function";
  const savedAction = canReadAction
    ? await storage.getAction(projectId, action.id) || action
    : {
      ...action,
      status: directArtifact ? "completed" as const : action.status,
      artifact_id: directArtifact?.id,
      completed_at: directArtifact ? new Date().toISOString() : action.completed_at,
    };
  const artifact = directArtifact || (
    savedAction.artifact_id
      ? await storage.getArtifact(projectId, savedAction.artifact_id)
      : null
  );
  if (savedAction.status === "failed") {
    throw new Error(savedAction.error || "Action could not complete");
  }
  return {
    action: savedAction,
    artifact,
    result_summary: artifact ? buildActionResultSummary({ actionType: savedAction.type, artifact }) : null,
  };
}

// ── Main Route Handler ─────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const storage = getStorage();

  const project = await storage.getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
  const actionType: ActionType = body.type;
  // Accept both `input` (frontend format) and `config` (LLM action format)
  const input = body.input || body.config || {};
  const parentArtifactId = body.parent_artifact_id;
  const intentText = [
    input.question,
    input.query,
    input.description,
    input.spec && typeof input.spec === "object" ? (input.spec as Record<string, unknown>).title : "",
    actionType,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const [intentDocs, intentArtifacts] = await Promise.all([
    storage.listDocuments(projectId),
    storage.listArtifacts(projectId),
  ]);
  const workspaceIntent = classifyWorkspaceIntent(intentText, {
    has_uploaded_doc: intentDocs.length > 0,
    has_prior_evaluation: intentArtifacts.some((artifact) => artifact.type === "evaluation"),
    prior_artifacts: intentArtifacts.length,
  });
  logDebug("action", "Workspace action intent classified", {
    action_type: actionType,
    workspace_intent: workspaceIntent.label,
    matched_keywords: workspaceIntent.matched_keywords,
    prior_artifacts: intentArtifacts.length,
    has_uploaded_doc: intentDocs.length > 0,
  });

  // Quota enforcement for analysis/brief actions — applies to all users
  const quotaActionMap: Record<string, string> = {
    simulate: "analysis", evaluate: "analysis", deep_analysis: "analysis",
    generate_brief: "brief", research: "analysis", due_diligence: "analysis",
    simulation_run: "analysis", physics_simulation: "analysis",
    environmental_site_analysis: "analysis", economics_analysis: "analysis",
    agent_workspace: "analysis", deep_agent: "analysis",
  };
  const quotaAction = quotaActionMap[actionType];
  let _actionsUserId = "";
  if (quotaAction) {
    try {
      const { auth: getAuth } = await import("@/lib/auth");
      const { checkQuota } = await import("@/lib/quota");
      const { getUsageToday } = await import("@/lib/usage");
      const sess = await getAuth();
      const tier = ((sess?.user as Record<string, unknown>)?.tier as string || "anonymous") as "anonymous" | "free" | "plus" | "pro";
      _actionsUserId = (sess?.user as Record<string, unknown>)?.id as string || "";
      const usage = _actionsUserId ? await getUsageToday(_actionsUserId) : {};
      const usedCount = _actionsUserId ? (usage[quotaAction] || 0) : 0;
      const qr = checkQuota(tier, quotaAction as "analysis" | "brief", usedCount);
      if (!qr.allowed) {
        return NextResponse.json({ error: qr.upgradeMessage }, { status: 429 });
      }
    } catch { /* non-fatal */ }
  }
  const trigger = (body.trigger === "plan_step" || body.trigger === "branch") ? body.trigger : "user";

  try {
    const execution = await executeProjectAction({
      projectId,
      actionType,
      input,
      parentArtifactId,
      trigger,
      quotaAction,
      actionsUserId: _actionsUserId,
      background: body.async === true || body.background === true,
    });
    if (body.async === true || body.background === true) {
      return NextResponse.json({
        job: { id: execution.action.id, status: execution.action.status },
        action: execution.action,
      }, { status: 202 });
    }
    return NextResponse.json({
      action: execution.action,
      artifact: execution.artifact,
      result_summary: execution.result_summary,
      recovered_from_error: execution.recovered_from_error,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Action could not complete", detail: errorMsg },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storage = getStorage();
  const actionId = request.nextUrl.searchParams.get("action_id");
  if (actionId) {
    const action = await storage.getAction(id, actionId);
    if (!action) return NextResponse.json({ error: "Action not found" }, { status: 404 });
    const artifact = action.artifact_id ? await storage.getArtifact(id, action.artifact_id) : null;
    return NextResponse.json({
      action,
      artifact,
      result_summary: artifact ? buildActionResultSummary({ actionType: action.type, artifact }) : null,
    });
  }
  const actions = await storage.listActions(id);
  return NextResponse.json(actions);
}
