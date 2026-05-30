// @ts-nocheck
// Build: 2026-04-05T02:10 — force cache invalidation
"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useProjectDetail } from "@/hooks/useProject";
import type { Artifact } from "@/lib/storage/types";
import type { SimDomain, AnySimParams, AnySimResult } from "@/lib/sim-types";
import { DOMAIN_REGISTRY } from "@/lib/domain-registry";
import { domainLabel } from "@/lib/sanitize";
import { buildActionResultSummary, isChatOnlyArtifact } from "@/lib/action-result-summary";
import { DomainCharts } from "@/components/simulate/DomainCharts";
import PhysicsResultsView from "@/components/simulate/PhysicsResultsView";
import { PerfReport } from "@/components/simulate/PerfReport";
import { BriefDetail } from "@/components/brief/BriefDetail";
import { PtlBriefDetail } from "@/components/brief/PtlBriefDetail";
import { isPtlBrief } from "@/lib/ptl-brief-types";
import { isBriefPayload } from "@/lib/brief-types";
import type { DeviceDecisionBrief } from "@/lib/brief-types";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { ClientResponseBlock } from "@/lib/client-response-blocks";
import { InteractiveChart } from "@/components/artifacts/InteractiveChart";
import { DeepAnalysisView } from "@/components/artifacts/DeepAnalysisView";
import { ScientificReviewView } from "@/components/artifacts/ScientificReviewView";
import { ResearchDetailView } from "@/components/artifacts/ResearchDetailView";
import { DeepDiligenceView } from "@/components/artifacts/DeepDiligenceView";
import { ExergyResultView } from "@/components/artifacts/ExergyResultView";
import { WorkspaceRunView } from "@/components/artifacts/WorkspaceRunView";
import { CustomChart } from "@/components/artifacts/CustomChart";
import { IngestionReview } from "@/components/ingest/IngestionReview";
import { ComprehensiveView } from "@/components/ingest/ComprehensiveView";
import { isIngestionPacket, isComprehensiveExtraction } from "@/lib/ingestion-types";
import { EconomicsResultView, EconomicsCard } from "@/components/economics/EconomicsResultView";
import type { EconomicsData } from "@/components/economics/EconomicsResultView";
import { UniversalDashboard } from "@/components/dashboard/UniversalDashboard";
import { WhatIfPanel } from "@/components/dashboard/WhatIfPanel";
import { AssessmentCanvas } from "@/components/canvas/AssessmentCanvas";
import { getClientErrorLog, reportClientError } from "@/lib/client-log";
import { buildGapFollowups } from "@/lib/brief-followups";
import { downloadBlob, MAX_PDF_SLUG_LEN } from "@/lib/download";
import { sanitizeUserFacingAgentText } from "@/lib/agent-output";

/* ── Types ────────────────────────────────────────────────── */

interface Msg {
  id: string; role: "user" | "assistant"; content: string; ts: string;
  runId?: string;
  responseBlocks?: ClientResponseBlock[];
  artifact?: Artifact; plan?: PlanStep[]; questions?: string[];
  followups?: string[]; loading?: boolean; loadingText?: string;
  agentActivity?: AgentActivityEntry[];
  autoRunPlan?: boolean;
  failedAction?: { type: string; config: Record<string, unknown> };
  report?: boolean;
  physicsSolver?: Record<string, unknown>;
  artifacts?: Artifact[]; // All artifacts from multi-step plans
  parentId?: string; // Links continuation messages to their parent
}
interface PlanStep {
  step: number; title: string; description: string;
  action_type: string; config: Record<string, unknown>;
  display_only?: boolean;
  status?: "pending" | "running" | "done" | "failed";
}
interface SimRun {
  id: string; name: string; domain: SimDomain; params: AnySimParams;
  result: AnySimResult; runAt: string;
}
interface SavedConfig {
  id: string; name: string; domain: SimDomain; params: AnySimParams; savedAt: string;
}
interface AgentActivityEntry {
  id: string;
  timestamp: string;
  title: string;
  detail?: string;
  status: "running" | "done" | "failed" | "info";
  actionType?: string;
  step?: number;
  durationMs?: number;
  artifactTitle?: string;
}

const DURABLE_RUN_REQUIRED_MESSAGE =
  "This saved plan was created before durable runs were available. Re-send the request so the server can create a durable run before executing it.";

function newActivityEntry(input: Omit<AgentActivityEntry, "id" | "timestamp">): AgentActivityEntry {
  return {
    ...input,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
}

function latestVisibleActivity(message: Pick<Msg, "agentActivity" | "loadingText" | "loading">): string {
  const events = message.agentActivity || [];
  const active = message.loading
    ? [...events].reverse().find((event) => event.status === "running" || event.status === "info")
    : null;
  const latest = active || events[events.length - 1];
  if (latest?.detail) return latest.detail;
  if (latest?.title) return latest.title;
  if (message.loadingText) return formatLoadingText(message.loadingText);
  return message.loading ? "Reading the request and workspace context." : "Process details are available.";
}

function shouldRenderMessageBody(message: Msg): boolean {
  if (!message.content) return false;
  if (message.role === "assistant" && message.loading && !message.responseBlocks?.length) return false;
  return true;
}

function finalPlanFallbackContent(args: {
  initialContent: string;
  stepSummaries: string[];
  planResults: string[];
  bestArtifact?: Artifact | null;
}): string {
  const initialContent = cleanInitialPlanContentForFinal(args.initialContent);
  const artifactSummary = args.bestArtifact
    ? buildActionResultSummary({
        actionType: String((args.bestArtifact.metadata as any)?.action_type || args.bestArtifact.type || "analysis"),
        artifact: args.bestArtifact,
      })
    : "";
  const usefulResults = args.stepSummaries.length > 0
    ? args.stepSummaries
    : artifactSummary
      ? [artifactSummary]
      : args.planResults
          .filter((line) => !/\bFAILED\b/i.test(line))
          .slice(0, 4);
  const parts = [
    initialContent,
    usefulResults.length > 0
      ? usefulResults.join("\n\n")
      : "I completed the available work, but the final synthesis response did not return text. Retry the final synthesis or ask for the specific section you need.",
  ].filter((part) => part && part.trim());
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanInitialPlanContentForFinal(content: string): string {
  const text = (content || "").trim();
  if (!text) return "";
  if (/\b(pull the requested table|latest analysis|prior result|requested export|create the requested export)\b/i.test(text)) {
    return "";
  }
  return text;
}

type RightTab = "results" | "configure" | "compare" | "saved";

function actionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    evidence_evaluation: "Analyze Evidence",
    document_analysis: "Extract Document Data",
    comprehensive_analysis: "Analyze Document",
    physics_simulation: "Run Physics Calculation",
    simulation_run: "Run Simulation",
    economics_analysis: "Run Economics Analysis",
    environmental_site_analysis: "Collect Environmental Site Data",
    agent_workspace: "Run Agent Workspace",
    literature_search: "Search Literature",
    deep_research: "Run Deep Research",
    deep_analysis: "Run Deep Analysis",
    scientific_review: "Review Technical Claims",
    exploratory_analysis: "Explore Project Data",
    custom_chart: "Create Visualization",
    update_project: "Update Project Context",
  };
  return labels[actionType] || actionType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function actionDescription(actionType: string, content?: string): string {
  const text = (content || "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  return `Run ${actionLabel(actionType).toLowerCase()} with the current workspace context.`;
}

function planOutlineFromAction(action: { type: string; config?: Record<string, unknown> }, content: string): PlanStep[] {
  const config = action.config || {};
  const rawOutline = Array.isArray(config.plan_outline) ? config.plan_outline : [];
  const detailSteps = rawOutline
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .slice(0, 10)
    .map((item, index) => ({
      step: index + 1,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Plan Step ${index + 1}`,
      description: typeof item.description === "string" ? item.description.trim() : "",
      action_type: "planning_detail",
      config: {},
      display_only: true,
      status: "pending" as PlanStep["status"],
    }));
  const executableStep: PlanStep = {
    step: detailSteps.length + 1,
    title: action.type === "agent_workspace" && detailSteps.length > 0 ? "Execute Workspace Model" : actionLabel(action.type),
    description: detailSteps.length > 0
      ? "Run the approved plan in the workspace and produce the requested calculations, tables, files, and final answer."
      : actionDescription(action.type, content),
    action_type: action.type,
    config,
    status: "pending",
  };
  const reportStep: PlanStep = {
    step: detailSteps.length + 2,
    title: "Generate Report",
    description: "Synthesize findings into a clear response",
    action_type: "synthesis",
    config: {},
    status: "pending",
  };
  return [...detailSteps, executableStep, reportStep];
}

function holdPlanContent(content: string): string {
  const cleaned = (content || "").trim();
  if (!cleaned) return "Plan mode: I’ll hold execution until you approve the step below.";
  const rewritten = cleaned
    .replace(/\bI am starting\b/i, "Plan mode: I’m drafting")
    .replace(/\bI’ll start\b/i, "Plan mode: I’ll draft")
    .replace(/\bI will start\b/i, "Plan mode: I’ll draft")
    .replace(/\bThe plan will run automatically unless you explicitly ask to review it first\.?/i, "I’ll hold execution until you approve it.");
  return /\bPlan mode\b/i.test(rewritten)
    ? rewritten
    : `Plan mode: I’ll hold execution until you approve it.\n\n${rewritten}`;
}

/* ── Icons ────────────────────────────────────────────────── */

function IconSpinner({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="animate-spin shrink-0"><circle cx="8" cy="8" r="6" stroke="var(--border-mid)" strokeWidth="2"/><path d="M14 8a6 6 0 00-6-6" stroke="var(--accent-blue)" strokeWidth="2" strokeLinecap="round"/></svg>; }
function LoadingPulse() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "0ms" }} />
      <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "150ms" }} />
      <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" style={{ animationDelay: "300ms" }} />
    </div>
  );
}
function formatLoadingText(text: string): string {
  // Clean up raw domain/tech names: "HYDROGEN_AND_SYNTHETIC_FUELS" → "Hydrogen and synthetic fuels"
  return text
    .replace(/_/g, " ")
    .replace(/\b[A-Z]{2,}\b/g, w => w.charAt(0) + w.slice(1).toLowerCase());
}
function IconSend() { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v14M9 2L4 7M9 2l5 5"/></svg>; }
function IconPaperclip({ size = 22 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"><path d="M15.3 8.5l-6.8 6.8a4 4 0 01-5.7-5.7L9.6 2.8a2.66 2.66 0 013.77 3.77L6.6 13.3a1.33 1.33 0 01-1.88-1.88l6.2-6.2"/></svg>; }
function IconDownload() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11v2a2 2 0 002 2h8a2 2 0 002-2v-2M8 2v9M8 11l-3-3M8 11l3-3"/></svg>; }
function IconCheck() { return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5"/></svg>; }
function IconStop() { return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="3" width="8" height="8" rx="1.5"/></svg>; }
function IconCopy() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11"/></svg>; }

const CHAT_INPUT_MIN_HEIGHT = 58;
const CHAT_INPUT_MAX_HEIGHT = 220;

function resizeChatInput(textarea: HTMLTextAreaElement | null, value: string) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const hasText = value.trim().length > 0;
  const nextHeight = hasText
    ? Math.min(Math.max(textarea.scrollHeight, CHAT_INPUT_MIN_HEIGHT), CHAT_INPUT_MAX_HEIGHT)
    : CHAT_INPUT_MIN_HEIGHT;
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
}

const LOW_INFORMATION_STATUS = /^(?:run started|run created|starting run|working on your request|working through the request)\.?$/i;

const LOADING_MESSAGES = [
  "Reading the request and workspace context",
  "Checking attached files and prior results",
  "Choosing whether to answer directly or use a tool",
  "Running the selected analysis path",
  "Checking intermediate outputs for consistency",
  "Writing the final answer and download links",
];
const progressMessages = LOADING_MESSAGES;
const THINKING_MODE_STORAGE_KEY = "exergy_lab_thinking_mode";

function cleanThinkingMode(value: string | null): "instant" | "expert" {
  if (value === "instant") return "instant";
  return "expert";
}

function getStoredThinkingMode(): "instant" | "expert" {
  if (typeof window === "undefined") return "expert";
  return cleanThinkingMode(window.localStorage.getItem(THINKING_MODE_STORAGE_KEY));
}

function useElapsedTime(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    if (!active) { setElapsed(0); start.current = Date.now(); return; }
    start.current = Date.now();
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [active]);
  return elapsed;
}

function useRotatingMessage(active: boolean, messages: string[], intervalMs = 4000) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const iv = setInterval(() => setIdx(prev => (prev + 1) % messages.length), intervalMs);
    return () => clearInterval(iv);
  }, [active, messages.length, intervalMs]);
  return messages[idx];
}

function useAnimatedDots(active: boolean, intervalMs = 500) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const iv = setInterval(() => setIdx(prev => (prev + 1) % 4), intervalMs);
    return () => clearInterval(iv);
  }, [active, intervalMs]);
  return ["", ".", "..", "..."][idx];
}

function useAgentProgressSentence(message: Pick<Msg, "agentActivity" | "loadingText" | "loading">, active: boolean) {
  const fallbacks = useMemo(() => {
    const base = latestVisibleActivity(message);
    const values = [
      LOW_INFORMATION_STATUS.test(base) ? "" : base,
      ...LOADING_MESSAGES,
    ].filter(Boolean);
    return Array.from(new Set(values));
  }, [message.agentActivity, message.loadingText, message.loading]);
  const rotated = useRotatingMessage(active, fallbacks, 10_000);
  return rotated || latestVisibleActivity(message);
}

/** Unwrap double-wrapped JSON content from LLM responses.
 * Models sometimes return {"type":"response","content":"{...}"} where the content
 * field is itself a stringified JSON object. Extract the inner content string. */
function unwrapJsonContent(text: string): string {
  if (!text || !text.trimStart().startsWith("{")) return text;
  try {
    const inner = JSON.parse(text);
    if (inner && typeof inner === "object" && typeof inner.content === "string") return inner.content;
  } catch { /* not JSON */ }
  return text;
}

/** Strip LaTeX notation from agent text. The LLM ignores the no-LaTeX instruction. */
function stripLatex(text: string): string {
  if (!text) return text;
  let t = text;
  // Phase 1: specific known patterns (highest priority)
  t = t.replace(/\$k_\{eff\}\$/g, "k-effective");
  t = t.replace(/\$k_\{\\infty\}\$/g, "k-infinity");
  t = t.replace(/\$k\{\\infty\}\$/g, "k-infinity");
  t = t.replace(/\$k\{eff\}\$/g, "k-effective");
  // Phase 2: strip all $...$ blocks by cleaning the interior
  t = t.replace(/\$([^$]*)\$/g, (_, inner: string) => {
    let s = inner;
    s = s.replace(/\\text\{([^}]*)\}/g, "$1");  // \text{X} → X
    s = s.replace(/\\mathrm\{([^}]*)\}/g, "$1"); // \mathrm{X} → X
    s = s.replace(/\\infty/g, "infinity");
    s = s.replace(/\\alpha/g, "alpha");
    s = s.replace(/\\beta/g, "beta");
    s = s.replace(/\\eta/g, "eta");
    s = s.replace(/\\epsilon/g, "epsilon");
    s = s.replace(/\\geq/g, ">=");
    s = s.replace(/\\leq/g, "<=");
    s = s.replace(/\\approx/g, "~");
    s = s.replace(/\\times/g, "x");
    s = s.replace(/\\cdot/g, ".");
    s = s.replace(/\^\{([^}]*)\}/g, "$1");       // ^{2} → 2
    s = s.replace(/_\{([^}]*)\}/g, "-$1");        // _{eff} → -eff
    s = s.replace(/\\/g, "");                      // remaining backslashes
    return s.trim();
  });
  return t.replace(/  +/g, " ");
}

function LoadingIndicator({ message }: { message: Pick<Msg, "agentActivity" | "loadingText" | "loading"> }) {
  const rotatingMsg = useRotatingMessage(true, LOADING_MESSAGES, 10_000);
  const progressSentence = useAgentProgressSentence(message, true);
  const dots = useAnimatedDots(true);
  const elapsed = useElapsedTime(true);
  const displayText = formatLoadingText(progressSentence || rotatingMsg).replace(/[.。]+$/g, "");
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="py-2">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
          {displayText}{dots}
        </p>
        <span className="text-[12px] text-[var(--text-dim)] font-mono tabular-nums shrink-0 pt-0.5">
          {timeStr}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 max-w-[160px] rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div className="h-full w-[38%] rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-cyan)]"
            style={{ animation: "loading-bar 1.35s linear infinite", willChange: "transform" }} />
        </div>
      </div>
    </div>
  );
}

function LoadingIndicatorCompatibility({ m }: { m: Msg }) {
  return <LoadingIndicator loadingText={m.loadingText} />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-dim)] hover:text-[var(--text-muted)]"
      title="Copy message"
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
function responseBlocksFromPayload(value: unknown): ClientResponseBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.filter((block: any) =>
    block &&
    typeof block === "object" &&
    typeof block.type === "string" &&
    typeof block.title === "string" &&
    (typeof block.body === "string" || Array.isArray(block.bullets))
  );
  return blocks.length > 0 ? blocks : undefined;
}

function ClientResponseBlocksView({ blocks }: { blocks: ClientResponseBlock[] }) {
  if (!blocks?.length) return null;
  return (
    <div className="space-y-2.5 my-1" data-testid="client-response-blocks">
      {blocks.map((block, index) => {
        const title = sanitizeUserFacingAgentText(block.title);
        const body = block.body ? sanitizeUserFacingAgentText(block.body) : "";
        const bullets = block.bullets?.map((bullet) => sanitizeUserFacingAgentText(bullet)).filter(Boolean) || [];
        return (
        <section
          key={`${block.type}-${index}`}
          className="rounded-md border border-[var(--border)]/70 bg-[var(--bg-elevated)]/45 px-4 py-3"
          data-response-block={block.type}
        >
          <div className="text-[13px] font-semibold uppercase tracking-[0] text-[var(--text-muted)]">
            {title}
          </div>
          {body && (
            <p className="mt-1.5 text-[15px] leading-[1.65] text-[var(--text-secondary)]">
              {body}
            </p>
          )}
          {bullets.length ? (
            <ul className="mt-2 space-y-1.5">
              {bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex} className="flex gap-2 text-[15px] leading-[1.6] text-[var(--text-secondary)]">
                  <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-dim)]" />
                  <span>{bullet.replace(/\.$/, "")}.</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      );})}
    </div>
  );
}
function Logo() { return <div className="shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-cyan)] flex items-center justify-center"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1L3 5v6l5 4 5-4V5L8 1z" fill="white" fillOpacity="0.9"/></svg></div>; }

/* ── Utilities ────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`;
}

const SAVED_KEY = "exergy_saved_configs";
function loadSaved(): SavedConfig[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return raw.map((c: any) => ({ ...c, domain: c.domain || "battery" }));
  } catch { return []; }
}
function persistSaved(c: SavedConfig[]) { localStorage.setItem(SAVED_KEY, JSON.stringify(c)); }

const DOMAIN_OPTIONS: { key: SimDomain; label: string }[] = [
  { key: "battery", label: "Battery" },
  { key: "pv", label: "Solar PV" },
  { key: "inverter", label: "Inverter" },
];

/* ── Artifact Feedback Builder ────────────────────────────── */

/**
 * Build a concise summary of artifact results that gets injected into
 * the chat history so the agent can see what happened and reason about
 * next steps. This is the feedback loop that enables hypothesis-driven
 * iteration.
 */
/**
 * Generate an instant acknowledgment message from the user's input.
 * Shown immediately — no LLM call needed. Replaced by the real response
 * once the agent finishes thinking.
 */
function _quickAcknowledge(userMessage: string, numAttachments: number): string {
  const msg = userMessage.toLowerCase();

  if (numAttachments > 0 && (msg.includes("evaluat") || msg.includes("assess") || msg.includes("analyz"))) {
    return `Working on it — extracting parameters from your ${numAttachments > 1 ? "documents" : "document"} and building an evaluation plan.`;
  }
  if (msg.includes("what if") || msg.includes("change") && (msg.includes("to ") || msg.includes("instead"))) {
    return "Re-running the analysis with those changes now.";
  }
  if (msg.includes("compar") || msg.includes("vs ") || msg.includes("versus")) {
    return "Putting together a comparison — gathering the data now.";
  }
  if (msg.includes("report") || msg.includes("pdf") || msg.includes("export")) {
    return "Generating your report now.";
  }
  if (msg.includes("search") || msg.includes("literature") || msg.includes("research") || msg.includes("papers")) {
    return "Searching academic databases for relevant published research.";
  }
  if (msg.includes("simulat") || msg.includes("physics") || msg.includes("model")) {
    return "Setting up the simulation with those parameters now.";
  }
  if (numAttachments > 0) {
    return `Analyzing your ${numAttachments > 1 ? `${numAttachments} files` : "file"} — extracting key technical details.`;
  }
  if (msg.length > 200) {
    return "Working through your request — building an analysis plan now.";
  }
  return "Working on that now.";
}

function _buildArtifactFeedback(art: Artifact): string {
  const parts: string[] = [];
  const c = art.content as Record<string, unknown> | undefined;
  if (!c) return `[${art.type}] ${art.summary || art.title}`;

  if (art.type === "simulation") {
    const s = c.summary as Record<string, unknown> | undefined;
    const p = c.params as Record<string, unknown> | undefined;
    parts.push(`[Simulation result]`);
    if (p) {
      const domain = (p.domain || c.domain || "unknown") as string;
      const chemistry = p.chemistry || p.technology || p.topology || "";
      parts.push(`Domain: ${domain}${chemistry ? `, ${chemistry}` : ""}`);
    }
    if (s) {
      // Include key numeric metrics
      const metrics = Object.entries(s)
        .filter(([, v]) => typeof v === "number" || typeof v === "string")
        .slice(0, 8)
        .map(([k, v]) => `${k}=${typeof v === "number" ? (v as number).toFixed(2) : v}`)
        .join(", ");
      if (metrics) parts.push(`Metrics: ${metrics}`);
    }
    const grades = c.grades as Array<Record<string, unknown>> | undefined;
    if (grades && grades.length > 0) {
      parts.push(`Grades: ${grades.slice(0, 4).map(g => `${g.category}=${g.grade}`).join(", ")}`);
    }
    // Include physics solver output so agent can faithfully report computed values
    const ps = c.physics_solver as Record<string, unknown> | undefined;
    if (ps) {
      const om = ps.output_metrics as Record<string, unknown> | undefined;
      if (om) {
        const solverMetrics = Object.entries(om)
          .filter(([, v]) => typeof v === "number")
          .slice(0, 20)
          .map(([k, v]) => `${k}=${(v as number).toFixed(4)}`);
        parts.push(`PHYSICS SOLVER OUTPUT (authoritative — report these exact values):`);
        parts.push(solverMetrics.join(", "));
      }
      if (ps.solver_assumptions) {
        parts.push(`Solver assumptions: ${(ps.solver_assumptions as string[]).slice(0, 4).join("; ")}`);
      }
      if (ps.unmodeled_phenomena) {
        const up = ps.unmodeled_phenomena as string[];
        parts.push(`Unmodeled (${up.length} items): ${up.slice(0, 3).join(", ")}...`);
      }
    }
  } else if (art.type === "evaluation") {
    parts.push(`[Evaluation result]`);
    const domain = c.domain as string || "unknown";
    const score = c.score as number || 0;
    const mods = c.module_evaluations as Record<string, Record<string, unknown>> | undefined;
    const brief = c.brief as Record<string, unknown> | undefined;
    const evidenceLevel = c.evidence_level as string || (brief as Record<string, unknown> | undefined)?.evidence_level as string || "";
    parts.push(`Domain: ${domain}, Score: ${score.toFixed(3)}${evidenceLevel ? `, Evidence: ${evidenceLevel}` : ""}`);
    if (mods) {
      const modSummary = Object.entries(mods).slice(0, 10)
        .map(([k, v]) => `${k}:${v.verdict || "?"}`)
        .join(", ");
      parts.push(`Modules: ${modSummary}`);
    }
    if (brief) {
      const strengths = (brief.key_strengths as string[]) || [];
      const concerns = (brief.key_concerns as string[]) || [];
      if (strengths.length) parts.push(`Strengths: ${strengths.slice(0, 3).join("; ")}`);
      if (concerns.length) parts.push(`Concerns: ${concerns.slice(0, 3).join("; ")}`);
    }
    const caveats = c.caveats as string[] || [];
    if (caveats.length) parts.push(`Caveats: ${caveats.slice(0, 2).join("; ")}`);
    // Literature and evidence context (from academic search + web intake)
    const litCtx = c.literature_context as Array<Record<string, unknown>> | undefined;
    if (litCtx && litCtx.length > 0) {
      parts.push(`Academic literature: ${litCtx.length} published papers found`);
      for (const p of litCtx.slice(0, 3)) {
        parts.push(`  - ${p.title} (${p.year}, cited: ${p.cited_by})`);
      }
    }
    const allClaims = c.all_claims as Array<Record<string, unknown>> | undefined;
    if (allClaims && allClaims.length > 0) {
      const measured = allClaims.filter(cl => cl.claim_type === "measured" || cl.confidence as number >= 0.6);
      const webClaims = allClaims.filter(cl => cl.claim_type === "web_content" || cl.claim_type === "primary_page_content");
      parts.push(`Evidence: ${allClaims.length} claims gathered (${measured.length} high-confidence, ${webClaims.length} from web)`);
    }
    const evMeta = c.evidence_level_metadata as Record<string, unknown> | undefined;
    if (evMeta) {
      const nParams = evMeta.n_parameters_fused as number || 0;
      const nPapers = evMeta.n_academic_papers as number || 0;
      if (nParams > 0) parts.push(`Parameters fused: ${nParams}${nPapers > 0 ? `, academic papers: ${nPapers}` : ""}`);
    }
    // Include physics solver metrics from evaluation artifacts too
    const ps2 = c.physics_solver as Record<string, unknown> | undefined;
    if (ps2) {
      const om2 = ps2.output_metrics as Record<string, unknown> | undefined;
      if (om2) {
        const solverMetrics2 = Object.entries(om2)
          .filter(([, v]) => typeof v === "number")
          .slice(0, 20)
          .map(([k, v]) => `${k}=${(v as number).toFixed(4)}`);
        parts.push(`PHYSICS SOLVER OUTPUT (authoritative — report these exact values):`);
        parts.push(solverMetrics2.join(", "));
      }
    }
  } else if (art.type === "research") {
    parts.push(`[Research result]`);
    const exec_summary = c.executive_summary as string;
    if (exec_summary) parts.push(exec_summary.slice(0, 200));
    const findings = c.findings as Array<Record<string, unknown>> | undefined;
    if (findings) parts.push(`${findings.length} findings`);
  } else if (art.type === "workspace_run" || c.analysis_type === "agent_workspace") {
    parts.push(`[Workspace result]`);
    const report = typeof c.report_markdown === "string" ? c.report_markdown.trim() : "";
    if (report) {
      parts.push(report.slice(0, 4000));
    } else if (art.summary || art.title) {
      parts.push(art.summary || art.title);
    }
  } else {
    parts.push(`[${art.type}] ${art.summary || art.title}`);
  }

  return parts.join("\n");
}

function workspaceDownloadLinksMarkdown(art: Artifact | null | undefined, projectId: string): string {
  if (!art || !projectId) return "";
  const content = (art.content || {}) as Record<string, unknown>;
  const files = Array.isArray(content.files) ? content.files : [];
  const downloadable = files
    .filter((file): file is Record<string, unknown> => !!file && typeof file === "object" && !Array.isArray(file))
    .filter((file) => {
      const filename = String(file.filename || "");
      const path = String(file.path || "");
      if (!filename || !path) return false;
      if (/^(results\.json|input_manifest\.xlsx)$/i.test(filename)) return false;
      if (/\.py$/i.test(filename)) return false;
      return /\.(csv|xlsx|pdf|md|json|png|jpg|jpeg|txt)$/i.test(filename);
    })
    .slice(0, 8);
  if (downloadable.length === 0) return "";

  const links = downloadable.map((file) => {
    const filename = String(file.filename || "download");
    const path = String(file.path || "");
    const href = `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(art.id)}/files?path=${encodeURIComponent(path)}`;
    return `- [Download ${filename}](${href})`;
  });
  return ["Downloads", ...links].join("\n");
}

function appendWorkspaceDownloadLinks(summary: string, art: Artifact | null | undefined, projectId: string): string {
  const links = workspaceDownloadLinksMarkdown(art, projectId);
  return links ? `${summary.trim()}\n\n${links}` : summary;
}

function serializeMessageForDiagnostics(message: Msg): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    ts: message.ts,
    runId: message.runId,
    content: message.content,
    loading: message.loading === true,
    loadingText: message.loadingText,
    plan: Array.isArray(message.plan)
      ? message.plan.map(step => ({
        step: step.step,
        title: step.title,
        action_type: step.action_type,
        display_only: step.display_only === true,
        status: step.status,
      }))
      : undefined,
    artifact: message.artifact
      ? {
        id: message.artifact.id,
        type: message.artifact.type,
        title: message.artifact.title,
        summary: message.artifact.summary,
        action_id: message.artifact.action_id,
      }
      : undefined,
    artifact_ids: Array.isArray(message.artifacts) ? message.artifacts.map(artifact => artifact.id) : undefined,
    followups: message.followups,
    failedAction: message.failedAction
      ? { type: message.failedAction.type, config_keys: Object.keys(message.failedAction.config || {}) }
      : undefined,
  };
}

function projectSnapshotForDiagnostics(project: any): Record<string, unknown> | null {
  if (!project) return null;
  return {
    id: project.id,
    name: project.name,
    domain: project.domain,
    updated_at: project.updated_at,
    runs: Array.isArray(project.runs)
      ? project.runs.map((run: any) => ({
        id: run.id,
        status: run.status,
        mode: run.mode,
        created_at: run.created_at,
        updated_at: run.updated_at,
        completed_at: run.completed_at,
        has_final_answer: !!run.final_answer,
        plan_count: Array.isArray(run.plan) ? run.plan.length : 0,
        file_count: Array.isArray(run.files) ? run.files.length : 0,
      }))
      : [],
    documents: Array.isArray(project.documents)
      ? project.documents.map((doc: any) => ({
        id: doc.id,
        filename: doc.filename,
        status: doc.status,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
      }))
      : [],
    artifacts: Array.isArray(project.artifacts)
      ? project.artifacts.map((artifact: any) => ({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        created_at: artifact.created_at,
      }))
      : [],
    actions: Array.isArray(project.actions)
      ? project.actions.map((action: any) => ({
        id: action.id,
        type: action.type,
        status: action.status,
        artifact_id: action.artifact_id,
        created_at: action.created_at,
        completed_at: action.completed_at,
      }))
      : [],
  };
}

/* ── Main Component ───────────────────────────────────────── */

export default function WorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { project, loading, error: projectError, refresh: refreshProject, uploadDocument, runSimulation, runResearch, runEvaluation, runAction } = useProjectDetail(id);

  /* Domain state */
  const [activeDomain, setActiveDomain] = useState<SimDomain>("battery");
  const domainConfig = DOMAIN_REGISTRY[activeDomain];

  /* Right panel state */
  // rightTab/compareSet reserved for future compare feature (not yet wired)
  // const [rightTab, setRightTab] = useState<RightTab>("results");
  const [simRuns, setSimRuns] = useState<SimRun[]>([]);
  const [simParams, setSimParams] = useState<AnySimParams>(domainConfig.defaultParams());
  // const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [saveName, setSaveName] = useState("");

  /* Warm up the agent API so the first message is fast */
  useEffect(() => { fetch("/api/warmup").catch(() => {}); }, []);

  /* Chat state */
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hist, setHist] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const autoSentRef = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const runPollersRef = useRef<Map<string, number>>(new Map());
  const activeRunIdsRef = useRef<Set<string>>(new Set());
  const msgsLoadedRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const source of eventSourcesRef.current.values()) source.close();
      eventSourcesRef.current.clear();
      for (const timer of runPollersRef.current.values()) window.clearInterval(timer);
      runPollersRef.current.clear();
      activeRunIdsRef.current.clear();
    };
  }, []);

  /* Milestone state */
  const [activeMilestone, setActiveMilestone] = useState(1);

  /* Load persisted messages on mount */
  useEffect(() => {
    if (!id || msgsLoadedRef.current) return;
    msgsLoadedRef.current = true;
    fetch(`/api/projects/${id}/messages`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.messages?.length > 0) {
          setMsgs(data.messages);
          setHist(data.history || []);
          autoSentRef.current = true; // Prevent re-running initial message
        }
      })
      .catch(() => {}); // Non-fatal — start fresh if load fails
  }, [id]);

  /* Save messages whenever they change (debounced) */
  useEffect(() => {
    if (msgs.length === 0 || !msgsLoadedRef.current) return;
    if (savingRef.current) return;
    const timeout = setTimeout(() => {
      savingRef.current = true;
      // Strip non-serializable fields (React nodes, functions) before saving
      const serializable = msgs.map(m => ({
        ...m,
        physicsSolver: m.physicsSolver || undefined,
        // Keep artifact content but drop React-specific fields
        artifact: m.artifact ? { type: m.artifact.type, title: m.artifact.title, summary: m.artifact.summary, content: m.artifact.content, metadata: m.artifact.metadata } : undefined,
      }));
      fetch(`/api/projects/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: serializable, history: hist }),
      })
        .catch(() => {}) // Non-fatal
        .finally(() => { savingRef.current = false; });
    }, 1000); // 1s debounce
    return () => clearTimeout(timeout);
  }, [msgs, hist, id]);

  /* Initialize domain from project */
  useEffect(() => {
    if (!project) return;
    const d = project.domain as SimDomain;
    if (d && d !== "general" && DOMAIN_REGISTRY[d]) {
      setActiveDomain(d);
      setSimParams(DOMAIN_REGISTRY[d].defaultParams());
    }
  }, [project?.domain]);

  /* Load saved configs on mount */
  useEffect(() => { setSavedConfigs(loadSaved()); }, []);

  /* Milestones from current domain config */
  const MILESTONES = useMemo(() => {
    const mp = domainConfig.milestonePrompts;
    return [
      { id: 1, key: "research", label: "Research", desc: "Literature review and background research", prompt: mp[1] },
      { id: 2, key: "analyze", label: "Analyze", desc: "Review findings and identify key parameters", prompt: mp[2] },
      { id: 3, key: "plan", label: "Plan", desc: "Design a comprehensive experiment plan", prompt: mp[3] },
      { id: 4, key: "simulate", label: "Simulate", desc: "Execute simulations and collect data", prompt: mp[4] },
      { id: 5, key: "report", label: "Report", desc: "Summarize findings and recommendations", prompt: mp[5] },
    ];
  }, [domainConfig]);

  /* Auto-detect milestone progress */
  const milestoneComplete = useMemo(() => {
    const artifacts = project?.artifacts || [];
    const hasResearch = msgs.some(m => m.artifact?.type === "research") || artifacts.some(a => a.type === "research");
    const hasAnalysis = hasResearch && msgs.some(m => !m.loading && m.role === "assistant" && m.content.length > 150);
    const hasPlan = msgs.some(m => m.plan && m.plan.length > 0 && m.plan.some(s => s.status === "done"));
    const hasSims = simRuns.length > 0 || artifacts.some(a => a.type === "simulation");
    const hasReport = msgs.some(m => !m.loading && m.role === "assistant" && m.content.includes("##") && m.content.length > 300);
    return [hasResearch, hasAnalysis, hasPlan, hasSims, hasReport];
  }, [msgs, simRuns, project]);

  useEffect(() => {
    const firstIncomplete = milestoneComplete.findIndex(c => !c);
    if (firstIncomplete >= 0) setActiveMilestone(firstIncomplete + 1);
    else setActiveMilestone(5);
  }, [milestoneComplete]);

  /* ── Chat handlers ────────────────────────────────── */

  const msgCountRef = useRef(0);
  const lastMsgRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll to the START of the newest message so user reads top-down,
    // not to the bottom of the chat (which shows the end of long reports).
    if (msgs.length > msgCountRef.current) {
      // Short delay to let the DOM render the new message
      setTimeout(() => {
        lastMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
    msgCountRef.current = msgs.length;
  }, [msgs]);
  useEffect(() => { if (!busy) inputRef.current?.focus(); }, [busy]);
  useEffect(() => { resizeChatInput(inputRef.current, input); }, [input]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const runId of activeRunIdsRef.current) {
      fetch(`/api/projects/${id}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }).catch(() => {});
    }
    setBusy(false);
    setMsgs(prev => prev.map(m => m.loading ? { ...m, loading: false, content: m.content || "(Stopped by user)" } : m));
    activeRunIdsRef.current.clear();
    for (const source of eventSourcesRef.current.values()) source.close();
    eventSourcesRef.current.clear();
    for (const timer of runPollersRef.current.values()) window.clearInterval(timer);
    runPollersRef.current.clear();
  }, [id]);

  const add = useCallback((m: Omit<Msg, "id" | "ts">): string => {
    const msg = { ...m, id: `m${Date.now()}${Math.random().toString(36).slice(2, 5)}`, ts: new Date().toISOString() };
    setMsgs(p => [...p, msg]); return msg.id;
  }, []);
  const upd = useCallback((mid: string, p: Partial<Msg>) => { setMsgs(prev => prev.map(m => m.id === mid ? { ...m, ...p } : m)); }, []);
  const addActivity = useCallback((mid: string | undefined, entry: Omit<AgentActivityEntry, "id" | "timestamp">) => {
    if (!mid) return;
    const event = newActivityEntry(entry);
    setMsgs(prev => prev.map(m => {
      if (m.id !== mid) return m;
      const current = Array.isArray(m.agentActivity) ? m.agentActivity : [];
      return { ...m, agentActivity: [...current, event].slice(-80) };
    }));
  }, []);
  const updIfLoading = useCallback((mid: string, p: Partial<Msg>) => {
    setMsgs(prev => prev.map(m => m.id === mid && m.loading ? { ...m, ...p } : m));
  }, []);

  const markRunInactive = useCallback((runId: string) => {
    activeRunIdsRef.current.delete(runId);
    eventSourcesRef.current.get(runId)?.close();
    eventSourcesRef.current.delete(runId);
    const timer = runPollersRef.current.get(runId);
    if (timer) window.clearInterval(timer);
    runPollersRef.current.delete(runId);
    setBusy(activeRunIdsRef.current.size > 0);
  }, []);

  const applyRunSnapshot = useCallback((runId: string, mid: string, run: any) => {
    if (!run || !run.status) return;
    if (run.status === "completed") {
      const finalAnswer = typeof run.final_answer === "string"
        ? sanitizeUserFacingAgentText(run.final_answer)
        : "Run complete.";
      upd(mid, {
        content: finalAnswer,
        loading: false,
        loadingText: undefined,
        plan: run.plan,
        followups: ["What data would improve confidence?", "Turn this into a client-ready memo", "Export this result"],
      });
      if (finalAnswer && finalAnswer !== "Run complete.") {
        setHist(prev => [...prev, { role: "assistant", content: finalAnswer }].slice(-50));
      }
      markRunInactive(runId);
    } else if (run.status === "failed" || run.status === "cancelled") {
      const errorText = sanitizeUserFacingAgentText(run.error || (run.status === "cancelled" ? "Run cancelled." : "The run failed."));
      upd(mid, {
        content: errorText,
        loading: false,
        loadingText: undefined,
        plan: run.plan,
      });
      markRunInactive(runId);
    }
  }, [markRunInactive, upd]);

  const applyRunEvent = useCallback((mid: string, event: any) => {
    const type = String(event?.type || "");
    const message = typeof event?.message === "string" ? sanitizeUserFacingAgentText(event.message) : "";
    const data = event?.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
    const steps = Array.isArray(data.steps) ? data.steps as PlanStep[] : undefined;

    if (type === "progress" || type === "tool.started" || type === "tool.completed") {
      upd(mid, {
        loadingText: message || undefined,
      });
    }
    if (type === "plan.created" || type === "plan.updated" || type === "plan.awaiting_approval") {
      upd(mid, {
        content: message || "Plan updated.",
        plan: steps || undefined,
        loading: type !== "plan.awaiting_approval",
        loadingText: type === "plan.awaiting_approval" ? undefined : message || undefined,
      });
    }
    if (type === "assistant.message") {
      upd(mid, {
        content: message,
        loadingText: undefined,
      });
    }
    if (type === "run.completed") {
      const finalAnswer = typeof data.final_answer === "string" ? sanitizeUserFacingAgentText(data.final_answer) : message;
      upd(mid, {
        content: finalAnswer || message || "Run complete.",
        loading: false,
        loadingText: undefined,
        plan: steps || undefined,
        followups: ["What data would improve confidence?", "Turn this into a client-ready memo", "Export this result"],
      });
      if (finalAnswer) {
        setHist(prev => [...prev, { role: "assistant", content: finalAnswer }].slice(-50));
      }
      const runId = String(event?.run_id || "");
      if (runId) markRunInactive(runId);
    }
    if (type === "tool.failed") {
      upd(mid, {
        loading: true,
        loadingText: message || "Tool did not finish; choosing the next recovery step.",
      });
    }
    if (type === "run.failed") {
      upd(mid, {
        content: message || "The run did not finish. Retry the request, or ask a narrower follow-up.",
        loading: false,
        loadingText: undefined,
      });
      const runId = String(event?.run_id || "");
      if (runId) markRunInactive(runId);
    }
    if (type === "run.cancelled") {
      upd(mid, {
        content: message || "Run cancelled.",
        loading: false,
        loadingText: undefined,
      });
      const runId = String(event?.run_id || "");
      if (runId) markRunInactive(runId);
    }
  }, [markRunInactive, upd]);

  const subscribeToRun = useCallback((runId: string, mid: string) => {
    if (!runId || eventSourcesRef.current.has(runId)) return;
    activeRunIdsRef.current.add(runId);
    setBusy(true);
    const source = new EventSource(`/api/projects/${id}/runs/${encodeURIComponent(runId)}/events`);
    eventSourcesRef.current.set(runId, source);
    source.onmessage = (ev) => {
      try {
        applyRunEvent(mid, JSON.parse(ev.data));
      } catch {
        // Ignore malformed SSE frames; the snapshot route remains authoritative.
      }
    };
    source.onerror = () => {
      source.close();
      eventSourcesRef.current.delete(runId);
      fetch(`/api/projects/${id}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          const run = data?.run;
          if (!run) return;
          applyRunSnapshot(runId, mid, run);
        })
        .catch(() => {});
    };
    const poller = window.setInterval(() => {
      if (!activeRunIdsRef.current.has(runId)) return;
      fetch(`/api/projects/${id}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.run) applyRunSnapshot(runId, mid, data.run);
        })
        .catch(() => {});
    }, 2500);
    runPollersRef.current.set(runId, poller);
  }, [applyRunEvent, applyRunSnapshot, id]);

  useEffect(() => {
    for (const msg of msgs) {
      if (msg.role === "assistant" && msg.loading && msg.runId) {
        subscribeToRun(msg.runId, msg.id);
      }
    }
  }, [msgs, subscribeToRun]);

  const pushSimRun = useCallback((domain: SimDomain, params: AnySimParams, result: AnySimResult) => {
    const dc = DOMAIN_REGISTRY[domain];
    const run: SimRun = { id: `sr${Date.now()}`, name: dc.runName(params), domain, params, result, runAt: new Date().toISOString() };
    setSimRuns(prev => [run, ...prev]);
    // setRightTab("results");
  }, []);

  const runLegacyToolAction = useCallback(async (a: { type: string; config: Record<string, unknown> }, mid?: string): Promise<Artifact | null> => {
    const actionStartedAt = Date.now();
    if (mid) {
      addActivity(mid, {
        title: actionLabel(a.type),
        detail: actionDescription(a.type, String(a.config?.description || a.config?.question || "")),
        status: "running",
        actionType: a.type,
      });
    }
    // Timeout wrapper — keep the UI from hanging forever while allowing
    // genuinely long diligence steps to finish. Deep analyses routinely take
    // 4-6 minutes; a 3-minute client timeout caused the UI to mark steps as
    // failed even though the server completed and saved artifacts later.
    const timeoutByType: Record<string, number> = {
      deep_analysis: 10 * 60_000,
      scientific_review: 10 * 60_000,
      evidence_evaluation: 12 * 60_000,
      document_analysis: 12 * 60_000,
      literature_search: 4 * 60_000,
      exploratory_analysis: 6 * 60_000,
      custom_chart: 4 * 60_000,
      environmental_site_analysis: 3 * 60_000,
      economics_analysis: 4 * 60_000,
      agent_workspace: 15 * 60_000,
    };
    const timeoutMs = timeoutByType[a.type] || 3 * 60_000;
    const timeoutMinutes = Math.round(timeoutMs / 60_000);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Action timed out after ${timeoutMinutes} minutes. The server may be busy — try again.`)), timeoutMs));
    const run = async (): Promise<Artifact | null> => {
    if (a.type === "simulation_run") {
      const domain = (a.config.domain as SimDomain) || activeDomain;
      if (mid) upd(mid, { loadingText: `Running ${DOMAIN_REGISTRY[domain].label} simulation...` });
      // Pass domain to server for correct dispatch
      const res = (await runSimulation({ domain, ...a.config } as unknown as Record<string, unknown>))?.artifact || null;
      if (res?.content) {
        const dc = DOMAIN_REGISTRY[domain];
        try {
          const previewResult = dc.runPreview(dc.defaultParams()); // placeholder; server result is authoritative
          pushSimRun(domain, dc.defaultParams(), res.content as unknown as AnySimResult);
        } catch {
          pushSimRun(domain, dc.defaultParams(), res.content as unknown as AnySimResult);
        }
      }
      return res;
    }
    if (a.type === "literature_search") {
      if (mid) upd(mid, { loadingText: "Searching literature..." });
      const query = String(
        a.config.query
        || [
          project?.name,
          project?.description,
          project?.domain,
          "published benchmarks performance economics safety regulatory deployment",
        ].filter(Boolean).join(" "),
      ).trim();
      return (await runResearch(query))?.artifact || null;
    }
    if (a.type === "module_evaluation") { if (mid) upd(mid, { loadingText: "Running 10-module evaluation..." }); return (await runEvaluation(Number(a.config.seed) || 42, true))?.artifact || null; }
    if (a.type === "evidence_evaluation") {
      const hasCurrentAttachment = Array.isArray(a.config.current_attachments) && a.config.current_attachments.length > 0;
      if (mid) upd(mid, { loadingText: hasCurrentAttachment ? "Analyzing uploaded file..." : "Analyzing available evidence..." });
      return (await runAction("evidence_evaluation", a.config))?.artifact || null;
    }
    if (a.type === "document_analysis") {
      if (mid) upd(mid, { loadingText: "Extracting parameters from document..." });
      return (await runAction("document_analysis", a.config))?.artifact || null;
    }
    if (a.type === "deep_analysis") {
      if (mid) upd(mid, { loadingText: "Running deep analysis..." });
      return (await runAction("deep_analysis", a.config))?.artifact || null;
    }
    if (a.type === "economics_analysis") {
      if (mid) upd(mid, { loadingText: "Running economics solver..." });
      return (await runAction("economics_analysis", a.config))?.artifact || null;
    }
    if (a.type === "scientific_review") {
      if (mid) upd(mid, { loadingText: "Running scientific plausibility review..." });
      return (await runAction("scientific_review", a.config))?.artifact || null;
    }
    if (a.type === "custom_chart") {
      if (mid) upd(mid, { loadingText: "Generating visualization..." });
      return (await runAction("custom_chart", a.config))?.artifact || null;
    }
    if (a.type === "exploratory_analysis") {
      if (mid) upd(mid, { loadingText: "Running exploratory analysis..." });
      return (await runAction("exploratory_analysis", a.config))?.artifact || null;
    }
    if (a.type === "environmental_site_analysis") {
      if (mid) upd(mid, { loadingText: "Collecting environmental site data..." });
      return (await runAction("environmental_site_analysis", a.config))?.artifact || null;
    }
    if (a.type === "agent_workspace") {
      if (mid) upd(mid, { loadingText: "Preparing a project workspace and running custom code..." });
      return (await runAction("agent_workspace", a.config))?.artifact || null;
    }
    if (a.type === "physics_simulation") {
      const domain = String(a.config.domain || "unknown");
      if (mid) upd(mid, { loadingText: `Running ${domain} physics solver...` });
      return (await runAction("physics_simulation", a.config))?.artifact || null;
    }
    if (a.type === "update_project") {
      if (mid) upd(mid, { loadingText: "Updating project settings..." });
      return (await runAction("update_project", a.config))?.artifact || null;
    }
    if (a.type === "generate_pdf") {
      if (mid) upd(mid, { loadingText: "Generating PDF report..." });
      let summary = "PDF report generated and downloaded.";
      try {
        const res = await fetch(`/api/projects/${id}/report`, { method: "POST" });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a2 = document.createElement("a");
          a2.href = url;
          a2.download = `${(project?.name || "report").replace(/[^a-z0-9]/gi, "_")}_Assessment_Report.pdf`;
          document.body.appendChild(a2);
          a2.click();
          setTimeout(() => { document.body.removeChild(a2); URL.revokeObjectURL(url); }, 1000);
        } else {
          const detail = await res.json().catch(() => ({}));
          summary = detail?.error || "I could not generate the PDF report from the current artifacts.";
        }
      } catch {
        summary = "I could not generate the PDF report from the current artifacts.";
      }
      return {
        id: `pdf_${Date.now()}`,
        type: "evaluation",
        title: "PDF Report Export",
        summary,
        content: { analysis_type: "pdf_export" },
        source: "ai_synthesis",
        raw: {},
        metadata: {},
        action_id: "",
        provenance: { source: "ai_synthesis", deterministic: false },
        created_at: new Date().toISOString(),
        pinned: false,
        schema_version: 1,
      } as unknown as Artifact;
    }
    if (a.type === "datasheet_ingest") {
      if (mid) upd(mid, { loadingText: "Extracting parameters from datasheet..." });
      try {
        const ingestRes = await fetch(`/api/projects/${id}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a.config),
        });
        if (ingestRes.ok) {
          const packet = await ingestRes.json();
          if (isIngestionPacket(packet)) {
            openCanvas("ingestion", packet);
          }
          // Return a lightweight artifact so downstream export paths can reference the extraction.
          return { id: packet.packet_id || "ing", type: "evaluation", title: "Datasheet Ingestion", summary: `Extracted ${packet.fields?.filter((f: any) => f.value != null).length || 0} parameters — ${packet.extraction_verdict || "complete"}`, content: { ingestion_packet: packet }, source: "ai_synthesis", raw: packet, metadata: {}, action_id: "", provenance: { source: "ai_synthesis", deterministic: false }, created_at: new Date().toISOString(), pinned: false, schema_version: 1 } as unknown as Artifact;
          }
      } catch (e) { reportClientError("ingestion", e); }
      return null;
    }
    if (a.type === "comprehensive_analysis") {
      if (mid) upd(mid, { loadingText: "Running comprehensive document analysis..." });
      try {
        const res = await fetch(`/api/projects/${id}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...a.config, comprehensive: true }),
        });
        if (res.ok) {
          const data = await res.json();
          if (isComprehensiveExtraction(data)) {
            openCanvas("comprehensive", data);
          }
          return { id: "comp", type: "evaluation", title: "Document Analysis", summary: `${data.parameters?.length || 0} parameters, ${data.information_gaps?.length || 0} gaps — ${data.product_name || data.title || "Analysis complete"}`, content: { comprehensive_extraction: data }, source: "ai_synthesis", raw: data, metadata: {}, action_id: "", provenance: { source: "ai_synthesis", deterministic: false }, created_at: new Date().toISOString(), pinned: false, schema_version: 1 } as unknown as Artifact;
        }
      } catch (e) { reportClientError("comprehensive_analysis", e); }
      return null;
    }
    return null;
    };
    try {
      const result = await Promise.race([run(), timeout]);
      if (mid) {
        addActivity(mid, {
          title: `${actionLabel(a.type)} complete`,
          detail: result?.summary || result?.title || "The action completed and returned results.",
          status: "done",
          actionType: a.type,
          durationMs: Date.now() - actionStartedAt,
          artifactTitle: result?.title,
        });
      }
      return result;
    }
    catch (e) {
      if (mid) {
        const safeMsg = e instanceof Error
          ? e.message.replace(/gemma|deepseek|intern|s1.pro|oracle/gi, "analysis engine")
          : "The action could not complete.";
        upd(mid, { loadingText: undefined });
        addActivity(mid, {
          title: `${actionLabel(a.type)} could not complete`,
          detail: safeMsg,
          status: "failed",
          actionType: a.type,
          durationMs: Date.now() - actionStartedAt,
        });
      }
      throw e;
    }
  }, [project, runSimulation, runResearch, runEvaluation, runAction, upd, addActivity, pushSimRun, activeDomain, id]);

  const sendMessage = useCallback(async (text?: string) => {
    const t = (text || input).trim();
    const files = pendingFiles;
    if (!t && files.length === 0) return;
    if (!text) setInput("");
    setPendingFiles([]);

    const uploadedNames: string[] = [];
    const uploadedIds: string[] = [];
    const failedUploads: string[] = [];
    for (const f of files) {
      try {
        const doc = await uploadDocument(f);
        uploadedNames.push(f.name);
        if (doc?.id) uploadedIds.push(doc.id);
      } catch {
        failedUploads.push(f.name);
      }
    }
    if (failedUploads.length > 0) {
      add({ role: "assistant", content: `Failed to upload: ${failedUploads.join(", ")}. The remaining files were processed successfully.` });
    }

    const attachSuffix = uploadedNames.length > 0
      ? `\n\n[Attached: ${uploadedNames.join(", ")}]` : "";
    const fullText = (t || "Please analyze the attached files") + attachSuffix;
    add({ role: "user", content: fullText });
    setHist(prev => [...prev, { role: "user", content: fullText }].slice(-50));

    const lid = add({
      role: "assistant",
      content: "",
      loading: true,
      loadingText: uploadedNames.length > 0
        ? `Reading ${uploadedNames.length} uploaded file${uploadedNames.length === 1 ? "" : "s"} and preparing the run.`
        : "Reading the request and workspace context.",
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/projects/${id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullText,
          document_ids: uploadedIds,
          mode: "implement",
          thinking_level: "expert",
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        upd(lid, {
          content: detail?.error || "The run could not be started.",
          loading: false,
          loadingText: undefined,
        });
        return;
      }
      const data = await res.json();
      const runId = data?.run?.id;
      if (!runId) {
        upd(lid, { content: "The run did not return an id.", loading: false, loadingText: undefined });
        return;
      }
      upd(lid, {
        runId,
        content: "",
        loading: true,
        loadingText: "Reading the request and workspace context.",
      });
      subscribeToRun(runId, lid);
      for (const event of data.events || []) {
        applyRunEvent(lid, event);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      upd(lid, {
        content: "Connection error while starting the run.",
        loading: false,
        loadingText: undefined,
      });
    }
  }, [input, id, add, upd, applyRunEvent, pendingFiles, uploadDocument, subscribeToRun]);

  useEffect(() => {
    if (!project || autoSentRef.current) return;
    const q = searchParams.get("q");
    if (!q || !q.trim()) return;
    autoSentRef.current = true;
    const timer = window.setTimeout(() => sendMessage(q), 400);
    return () => window.clearTimeout(timer);
  }, [project, searchParams, sendMessage]);

  const planRunningRef = useRef(false);
  const planCancelRef = useRef(false);
  const autoStartedPlanIdsRef = useRef<Set<string>>(new Set());
  const runPlan = useCallback(async (mid: string, steps: PlanStep[]) => {
    if (planRunningRef.current) return;
    const normalizedSteps = steps.map((step, index) => ({ ...step, step: index + 1 }));
    const existingSynthesisIndex = normalizedSteps.findIndex(step => step.action_type === "synthesis");
    const reportStep: PlanStep = existingSynthesisIndex >= 0
      ? {
        ...normalizedSteps[existingSynthesisIndex],
        title: normalizedSteps[existingSynthesisIndex].title || "Generate Report",
        description: normalizedSteps[existingSynthesisIndex].description || "Synthesize all findings into a structured technical report",
        status: "pending",
      }
      : {
        step: normalizedSteps.length + 1,
        title: "Generate Report",
        description: "Synthesize all findings into a structured technical report",
        action_type: "synthesis",
        config: {},
        status: "pending",
      };
    const visiblePlan = existingSynthesisIndex >= 0
      ? normalizedSteps.map((step, index) => index === existingSynthesisIndex ? reportStep : step)
      : [...normalizedSteps, reportStep];
    const executableEntries = visiblePlan
      .map((step, visibleIndex) => ({ step, visibleIndex }))
      .filter(({ step }) => step.action_type !== "synthesis" && !step.display_only);
    if (executableEntries.length === 0) return;

    planRunningRef.current = true;
    planCancelRef.current = false;
    setBusy(true);
    addActivity(mid, {
      title: "Plan execution started",
      detail: `Running ${executableEntries.length} workspace step${executableEntries.length === 1 ? "" : "s"} and then synthesizing the result.`,
      status: "running",
    });
    try {
    const planResults: string[] = [];
    let physicsData: Record<string, unknown> | null = null;
    let evalData: Record<string, unknown> | null = null;
    let briefData: Record<string, unknown> | null = null;
    let evalDomain: string | null = null;
    const allArtifacts: any[] = [];  // Accumulate ALL step artifacts
    let evalArtifact: any = null;  // Track evaluation artifact (has module_evaluations → AssessmentCanvas)
    const totalSteps = visiblePlan.length;
    let latestPlan = visiblePlan.map(step => ({ ...step, status: "pending" as PlanStep["status"] }));
    const initialPlanContent = cleanInitialPlanContentForFinal((msgs.find(m => m.id === mid)?.content || "").trim());
    const userVisibleStepSummaries: string[] = [];
    const appendUserVisibleStepSummary = (summary: string) => {
      userVisibleStepSummaries.push(summary);
      upd(mid, { content: [initialPlanContent, ...userVisibleStepSummaries].filter(Boolean).join("\n\n") });
    };
    for (let i = 0; i < executableEntries.length; i++) {
      const { step: currentStep, visibleIndex } = executableEntries[i];
      if (planCancelRef.current) {
        planResults.push(`Steps ${i + 1}-${executableEntries.length} cancelled by user`);
        addActivity(mid, {
          title: "Plan cancelled",
          detail: `Steps ${i + 1}-${executableEntries.length} were not run.`,
          status: "info",
        });
        break;
      }
      const u = latestPlan.map((s, j) => ({
        ...s,
        status: (
          j < visibleIndex
            ? "done"
            : j === visibleIndex
              ? "running"
              : "pending"
        ) as PlanStep["status"],
      }));
      latestPlan = u;
      upd(mid, { plan: u, loadingText: `Step ${visibleIndex + 1}/${totalSteps}: ${currentStep.title}` });
      addActivity(mid, {
        title: `Step ${visibleIndex + 1}: ${currentStep.title}`,
        detail: currentStep.description,
        status: "running",
        actionType: currentStep.action_type,
        step: visibleIndex + 1,
      });
      try {
        // Inject accumulated prior step findings into deep_analysis config
        // so each step has full context from all previous steps.
        const stepConfig = { ...currentStep.config };
        if (currentStep.action_type === "deep_analysis" && planResults.length > 0) {
          stepConfig.prior_step_findings = planResults.join("\n\n");
        }
        const art = await runLegacyToolAction({ type: currentStep.action_type, config: stepConfig }, mid);
        appendUserVisibleStepSummary(buildActionResultSummary({ actionType: currentStep.action_type, artifact: art }));
        u[visibleIndex] = { ...u[visibleIndex], status: "done" };
        latestPlan = [...u];
        upd(mid, { plan: [...u] });
        addActivity(mid, {
          title: `Step ${visibleIndex + 1} complete: ${currentStep.title}`,
          detail: art?.summary || "The step completed successfully.",
          status: "done",
          actionType: currentStep.action_type,
          step: visibleIndex + 1,
          artifactTitle: art?.title,
        });
        if (art) {
          allArtifacts.push(art);
          const fb = _buildArtifactFeedback(art);
          if (fb) planResults.push(`Step ${currentStep.step} (${currentStep.title}): ${fb}`);
          const c = art.content as any;
          // Capture physics solver data
          if (c?.physics_solver?.output_metrics && Object.keys(c.physics_solver.output_metrics).length > 0) {
            physicsData = c.physics_solver;
            evalDomain = c.domain || (art.metadata as any)?.domain || evalDomain;
          }
          // Capture evaluation data (module verdicts, brief)
          if (c?.module_evaluations && Object.keys(c.module_evaluations).length > 0) {
            evalData = c;
            evalArtifact = art;  // Preserve full artifact for AssessmentCanvas routing
            evalDomain = c.domain || evalDomain;
            if (c.brief) briefData = c.brief;
          }
        }
      } catch (err) {
        appendUserVisibleStepSummary(buildActionResultSummary({ actionType: currentStep.action_type, artifact: null }));
        u[visibleIndex] = { ...u[visibleIndex], status: "failed" };
        latestPlan = [...u];
        upd(mid, { plan: [...u] });
        // Record failure with sanitized message — never leak internal names
        const safeMsg = err instanceof Error
          ? err.message.replace(/gemma|deepseek|intern|s1.pro|oracle/gi, "analysis engine")
          : "action could not complete";
        planResults.push(`Step ${currentStep.step} (${currentStep.title}): FAILED — ${safeMsg}`);
        addActivity(mid, {
          title: `Step ${visibleIndex + 1} could not complete: ${currentStep.title}`,
          detail: safeMsg,
          status: "failed",
          actionType: currentStep.action_type,
          step: visibleIndex + 1,
        });
      }
    }
    // Build comprehensive canvas payload for the expanded analysis panel.
    const canvasPayload = (physicsData || evalData || briefData) ? {
      physicsSolver: physicsData,
      evaluation: evalData,
      brief: briefData,
      _domain: evalDomain,
      domain: evalDomain,
    } : null;
    // Feed all plan results back into history so agent can analyze them
    const combinedResults = planResults.join("\n");
    if (planResults.length > 0) {
      setHist(prev => [...prev, { role: "assistant", content: `[Plan results]\n${combinedResults}` }]);
    }

    // Mark the final "Generate Report" step as running
    const reportIndex = latestPlan.findIndex(step => step.action_type === "synthesis");
    const stepsWithReport = latestPlan.map((step, index) => ({
      ...step,
      status: (
        index === reportIndex
          ? "running"
          : step.status === "failed"
            ? "failed"
            : "done"
      ) as PlanStep["status"],
    }));
    upd(mid, { plan: stepsWithReport, loadingText: `Step ${totalSteps}/${totalSteps}: Generating report...` });
    addActivity(mid, {
      title: "Generating final report",
      detail: "Synthesizing the completed tool results into the user-facing answer.",
      status: "running",
      actionType: "synthesis",
      step: totalSteps,
    });
    try {
      const failedEntries = planResults.filter(r => r.includes("FAILED"));
      const failureContext = failedEntries.length > 0
        ? `\n\nIMPORTANT: ${failedEntries.length} of ${executableEntries.length} analysis steps did not complete:\n${failedEntries.join("\n")}\nYou MUST acknowledge these gaps in your report. Do not present the analysis as complete. Explain what could not be assessed and what the user can do to recover (provide different parameters, retry, or skip that dimension).\n`
        : "";
      const synthMsg = `All ${executableEntries.length} workspace execution steps are complete. Write a clear, professional technical report that provides GENUINE VALUE to the user.${failureContext}

RULES:
1. NO LaTeX. Write all math and units in plain text.
2. Lead with the MOST IMPORTANT FINDING — what does the user need to know? Is this technology viable? What are the real risks?
3. Synthesize ALL results — literature findings, evaluation scores, physics data, and deep analysis — into a coherent narrative. Do NOT just report each step separately.
4. If the evaluation engine returned sparse results (low score, few modules), DO NOT lead with "insufficient data." Instead, focus on what the literature search and deep analysis DID find. There is always something useful to say.
5. Include a metrics table ONLY if computed physics data is available. If not, use a comparison table: | Parameter | User's Spec | Published Benchmark | Assessment |
6. Write 3-5 paragraphs of substantive analysis: What works? What are the risks? How does this compare to alternatives? What should the user do next?
7. Reference specific findings from the literature with citations where possible.
8. Be direct and opinionated — the user is paying for expert judgment, not hedging.
9. Use exact numbers from solver output when available. Do NOT invent values.
10. Target 400-800 words depending on complexity. Deliver a complete analysis, not a stub.`;
      // Smart context trimming for synthesis — prioritize high-value data.
      // Instead of hard-cutting at 24KB (which loses literature and claims),
      // build a structured summary: brief data first, then literature, then details.
      const userPrompt = [...(hist || [])].reverse().find((m: { role: string }) => m.role === "user");

      // Build prioritized synthesis context from evaluation data
      let synthContext = combinedResults;
      if (synthContext.length > 28000) {
        // Over limit — build a structured summary instead of hard truncation
        const summaryParts: string[] = [];
        // Always include brief data (most compact, highest value)
        if (briefData) {
          const b = briefData as Record<string, unknown>;
          summaryParts.push(`EVALUATION SUMMARY: Score=${b.composite_score}, Readiness=${b.readiness_tier}, Evidence=${b.evidence_level}`);
          summaryParts.push(`Headline: ${b.headline}`);
          if ((b.key_strengths as string[])?.length) summaryParts.push(`Strengths: ${(b.key_strengths as string[]).join("; ")}`);
          if ((b.key_concerns as string[])?.length) summaryParts.push(`Concerns: ${(b.key_concerns as string[]).join("; ")}`);
          if (b.economics_summary) summaryParts.push(`Economics: ${b.economics_summary}`);
          if ((b.next_actions as string[])?.length) summaryParts.push(`Next actions: ${(b.next_actions as string[]).join("; ")}`);
        }
        // Include literature context if available
        if (evalData) {
          const ed = evalData as Record<string, unknown>;
          const lit = ed.literature_context as Array<Record<string, unknown>> | undefined;
          if (lit?.length) {
            summaryParts.push(`\nACADEMIC LITERATURE (${lit.length} papers):`);
            for (const p of lit.slice(0, 5)) summaryParts.push(`  - ${p.title} (${p.year}, cited: ${p.cited_by})`);
          }
          const claims = ed.all_claims as Array<Record<string, unknown>> | undefined;
          if (claims?.length) {
            summaryParts.push(`\nEVIDENCE CLAIMS (${claims.length} total, top 5):`);
            for (const cl of claims.slice(0, 5)) summaryParts.push(`  - [${cl.claim_type}] ${(cl.statement as string)?.slice(0, 120)}`);
          }
        }
        // Append truncated raw results for additional context
        const summaryHeader = summaryParts.join("\n");
        const remainingBudget = 28000 - summaryHeader.length;
        synthContext = summaryHeader + "\n\nDETAILED RESULTS:\n" + combinedResults.slice(0, Math.max(remainingBudget, 4000));
      }

      const synthHist = [
        ...(userPrompt ? [userPrompt] : []),
        { role: "assistant", content: `[Plan results]\n${synthContext}` },
      ];
      const synthAbort = new AbortController();
      const synthTimeout = setTimeout(() => synthAbort.abort(), 180_000); // long plans can need time to synthesize
      const synthRes = await fetch(`/api/projects/${id}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: synthMsg, history: synthHist }),
        signal: synthAbort.signal,
      });
      clearTimeout(synthTimeout);
      // CC-BE-REFACTOR-0040: shared helper; tests exercise the same path.
      const gapFollowups = buildGapFollowups(briefData as any);
      // Always produce exactly 3 followups — no download actions (those belong in card footer)
      const pool = [...gapFollowups, "Analyze the key risks in more detail", "Compare against competing technologies", "What are the strongest advantages of this technology?"];
      const defaultFollowups = pool.slice(0, 3);
      while (defaultFollowups.length < 3) defaultFollowups.push("Tell me more about this evaluation");

      if (synthRes.ok) {
        const { response: sr } = await synthRes.json();
        const bestArtifact = evalArtifact || allArtifacts[allArtifacts.length - 1] || null;
        const fallbackContent = finalPlanFallbackContent({
          initialContent: initialPlanContent,
          stepSummaries: userVisibleStepSummaries,
          planResults,
          bestArtifact,
        });
        const synthContent = sr.content || fallbackContent;
        const rawFollowups = [...gapFollowups, ...(sr.suggested_followups || []), ...defaultFollowups];
        const finalFollowups = rawFollowups.filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
        while (finalFollowups.length < 3) finalFollowups.push("Tell me more");
        // Prefer evaluation artifact for primary card; include ALL artifacts for multi-artifact display
        addActivity(mid, {
          title: "Final report complete",
          detail: "The final answer was generated from the completed analysis steps.",
          status: "done",
          actionType: "synthesis",
          step: totalSteps,
          artifactTitle: bestArtifact?.title,
        });
        upd(mid, {
          content: synthContent,
          loading: false,
          loadingText: undefined,
          plan: stepsWithReport.map(s => ({ ...s, status: "done" as PlanStep["status"] })),
          physicsSolver: canvasPayload || undefined,
          artifact: bestArtifact || undefined,
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          followups: finalFollowups,
        });
        setHist(prev => [...prev, { role: "assistant", content: synthContent }]);
      } else {
        // Synthesis LLM failed but evaluation succeeded — show results anyway
        const bestArtifact = evalArtifact || allArtifacts[allArtifacts.length - 1] || null;
        const fallbackContent = finalPlanFallbackContent({
          initialContent: initialPlanContent,
          stepSummaries: userVisibleStepSummaries,
          planResults,
          bestArtifact,
        });
        addActivity(mid, {
          title: "Final report fallback used",
          detail: "The synthesis request did not return a response, so the completed results were kept visible.",
          status: "failed",
          actionType: "synthesis",
          step: totalSteps,
          artifactTitle: bestArtifact?.title,
        });
        upd(mid, {
          content: fallbackContent,
          loading: false,
          loadingText: undefined,
          plan: stepsWithReport.map(s => ({ ...s, status: "done" as PlanStep["status"] })),
          physicsSolver: canvasPayload || undefined,
          artifact: bestArtifact || undefined,
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          followups: defaultFollowups,
        });
      }
    } catch {
      // Synthesis crashed but evaluation succeeded — show results anyway
      const bestArtifact = evalArtifact || allArtifacts[allArtifacts.length - 1] || null;
      const fallbackContent = finalPlanFallbackContent({
        initialContent: initialPlanContent,
        stepSummaries: userVisibleStepSummaries,
        planResults,
        bestArtifact,
      });
      addActivity(mid, {
        title: "Final report fallback used",
        detail: "The synthesis step did not complete, so the completed results were kept visible.",
        status: "failed",
        actionType: "synthesis",
        step: totalSteps,
        artifactTitle: bestArtifact?.title,
      });
      upd(mid, {
        content: fallbackContent,
        loading: false,
        loadingText: undefined,
        plan: stepsWithReport.map(s => ({ ...s, status: "done" as PlanStep["status"] })),
        physicsSolver: canvasPayload || undefined,
        artifact: bestArtifact || undefined,
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        followups: defaultFollowups,
      });
    }
    } finally {
      planRunningRef.current = false;
      setBusy(false);
    }
  }, [upd, add, addActivity, runLegacyToolAction, id, hist, msgs]);

  useEffect(() => {
    if (busy || planRunningRef.current) return;
    const target = msgs.find(m =>
      m.autoRunPlan &&
      m.plan &&
      m.plan.length > 0 &&
      m.plan.every((s: PlanStep) => s.status === "pending" || !s.status) &&
      !autoStartedPlanIdsRef.current.has(m.id)
    );
    if (!target?.plan) return;

    autoStartedPlanIdsRef.current.add(target.id);
    upd(target.id, {
      autoRunPlan: false,
      loading: false,
      loadingText: undefined,
      content: target.runId ? target.content || "Plan is waiting for approval." : DURABLE_RUN_REQUIRED_MESSAGE,
    });
  }, [busy, msgs, upd]);

  const addPendingFiles = useCallback((fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const newFiles = Array.from(fl);
    setPendingFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removePendingFile = useCallback((idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  /* ── Simulation handlers ──────────────────────────── */

  function handleRunSim() {
    // Tier 0 preview: instant local result
    const preview = domainConfig.runPreview(simParams);
    pushSimRun(activeDomain, simParams, preview);
    // Persist via server action (authoritative path)
    runSimulation({ domain: activeDomain, ...simParams } as unknown as Record<string, unknown>)
      .catch((e) => reportClientError("runSimulation", e));
  }

  function handleSaveConfig() {
    const name = saveName.trim() || domainConfig.runName(simParams);
    const cfg: SavedConfig = { id: `sc${Date.now()}`, name, domain: activeDomain, params: { ...simParams }, savedAt: new Date().toISOString() };
    const next = [cfg, ...savedConfigs];
    setSavedConfigs(next); persistSaved(next); setSaveName("");
  }

  function handleLoadConfig(cfg: SavedConfig) {
    setActiveDomain(cfg.domain);
    setSimParams({ ...cfg.params });
    // setRightTab("configure");
  }

  function handleDeleteConfig(cfgId: string) {
    const next = savedConfigs.filter(c => c.id !== cfgId);
    setSavedConfigs(next); persistSaved(next);
  }

  function handleDomainSwitch(d: SimDomain) {
    setActiveDomain(d);
    setSimParams(DOMAIN_REGISTRY[d].defaultParams());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Enter sends. Shift+Enter keeps the normal textarea newline behavior.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  /* ── Derived ──────────────────────────────────────── */

  const latestRun = simRuns[0] || null;
  const domainRuns = simRuns.filter(r => r.domain === activeDomain);
  // const compareRuns = simRuns.filter(r => compareSet.has(r.id));

  /* ── Canvas state ─────────────────────────────────── */

  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasTitle, setCanvasTitle] = useState("Detailed View");
  const [canvasContent, setCanvasContent] = useState<React.ReactNode>(null);
  const [canvasInput, setCanvasInput] = useState("");
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [canvasSpecs, setCanvasSpecs] = useState<any[] | null>(null); // chart specs for canvas chat context
  const [chatWidthPct, setChatWidthPct] = useState(45); // % width of chat when canvas open
  const dividerRef = useRef<HTMLDivElement>(null);

  // Last followups from the most recent assistant message (for display above chatbox)
  const lastFollowups = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant" && msgs[i].followups?.length && !msgs[i].loading) {
        return msgs[i].followups!;
      }
    }
    return [];
  }, [msgs]);

  function openCanvas(type: string, data?: any, artifactMeta?: { id?: string; title?: string }) {
    setCanvasTitle(type === "chart" ? "Interactive Chart" : artifactMeta?.title || "Detailed View");
    if (type === "brief" && data) {
      setCanvasContent(
        isPtlBrief(data)
          ? <PtlBriefDetail brief={data as any} projectId={id} />
          : <BriefDetail brief={data} projectId={id} evidenceDigest={(artifactMeta as any)?.evidenceDigest} />
      );
    } else if (type === "simulation" && latestRun) {
      setCanvasContent(
        <div className="space-y-4">
          <DomainCharts domain={latestRun.domain} result={latestRun.result} />
          {(latestRun.result as any).grades && <PerfReport grades={(latestRun.result as any).grades} overall={(latestRun.result as any).summary?.overall_grade || "—"} />}
        </div>
      );
    } else if (type === "chart" && data) {
      const specs = Array.isArray(data) ? data : [data];
      setCanvasSpecs(specs);
      setCanvasContent(
        <InteractiveChart
          specs={specs}
          onRequestChange={(msg: string) => {
            handleCanvasChatSend(msg);
          }}
        />
      );
    } else if (type === "deep_analysis" && data) {
      setCanvasContent(<DeepAnalysisView content={data} />);
    } else if (type === "exergy_result" && data) {
      setCanvasContent(<ExergyResultView content={data} />);
    } else if (type === "workspace_run" && data) {
      setCanvasContent(<WorkspaceRunView content={data} projectId={id} artifactId={artifactMeta?.id} />);
    } else if (type === "scientific_review" && data) {
      setCanvasContent(<ScientificReviewView content={data} />);
    } else if ((type === "research" || type === "deep_research") && data) {
      setCanvasContent(<ResearchDetailView content={data} />);
    } else if (type === "diligence_deep" && data) {
      setCanvasContent(<DeepDiligenceView content={data} />);
    } else if (type === "report" && data) {
      setCanvasContent(<MarkdownRenderer content={data} />);
    } else if (type === "ingestion" && data && isIngestionPacket(data)) {
      setCanvasContent(
        <IngestionReview
          packet={data}
          projectId={id}
          onEvaluated={(brief) => {
            if (isBriefPayload(brief)) {
              setCanvasContent(
                isPtlBrief(brief)
                  ? <PtlBriefDetail brief={brief as any} projectId={id} />
                  : <BriefDetail brief={brief as any} projectId={id} />
              );
            }
          }}
        />
      );
    } else if (type === "economics" && data) {
      setCanvasContent(
        <div className="p-4">
          <EconomicsResultView
            data={data.details || data}
            verdict={data.verdict}
            score={data.score_0_100}
            confidence={data.confidence_0_1}
          />
        </div>
      );
    } else if (type === "physics_results" && data) {
      setCanvasContent(<PhysicsResultsView
        physicsSolver={data.physicsSolver || data}
        evaluation={data.evaluation}
        brief={data.brief}
        domain={data._domain || data.domain}
      />);
    } else if (type === "comprehensive" && data && isComprehensiveExtraction(data)) {
      setCanvasContent(
        <ComprehensiveView
          extraction={data}
          projectId={id}
          onEvaluate={() => {
            // Bridge comprehensive → ingestion packet → evaluation
            fetch(`/api/projects/${id}/ingest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source_type: "text", text: JSON.stringify(data.parameters), domain_hint: data.detected_domain }),
            }).then(r => r.json()).then(packet => {
              if (isIngestionPacket(packet)) openCanvas("ingestion", packet);
            }).catch(() => {});
          }}
        />
      );
    } else if (type === "evaluation_dashboard" && data) {
      const artifactId = artifactMeta?.id;
      const artifactTitle = artifactMeta?.title;
      setCanvasContent(
        <div className="p-4">
          <AssessmentCanvas
            evaluation={data}
            projectId={id}
            sourceTitle={artifactTitle}
            onExportPdf={async () => {
              try {
                const res = await fetch(`/api/projects/${id}/report`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(artifactId ? { artifact_id: artifactId } : {}),
                });
                if (!res.ok) {
                  const detail = await res.text().catch(() => "");
                  reportClientError("export_pdf_http", new Error(`status=${res.status} body=${detail.slice(0, 200)}`));
                  alert("PDF export failed. Please try again.");
                  return;
                }
                const blob = await res.blob();
                const slug = (artifactTitle || "Assessment_Report")
                  .replace(/[^a-z0-9]+/gi, "_")
                  .replace(/^_+|_+$/g, "")
                  .slice(0, MAX_PDF_SLUG_LEN) || "Assessment_Report";
                await downloadBlob(blob, `${slug}.pdf`);
              } catch (err) {
                reportClientError("export_pdf", err);
                alert("PDF export failed. Please try again.");
              }
            }}
          />
        </div>
      );
    } else if (type === "whatif" && data) {
      const domain = data.domain || data.schema_info?.name || "";
      setCanvasContent(
        <div className="p-4 space-y-4">
          <AssessmentCanvas evaluation={data} projectId={id} sourceTitle={artifactMeta?.title} />
          <WhatIfPanel domain={domain} baselineResult={data} projectId={id} />
        </div>
      );
    } else {
      // CC-BE-UX-0032: route through reportClientError so the founder-facing
      // browser console stays quiet in production. The buffered entry remains
      // recoverable via debug-export tooling; dev still logs to console.
      reportClientError("openCanvas", { unhandledType: type, data });
      return;
    }
    setCanvasOpen(true);
  }

  function closeCanvas() { setCanvasOpen(false); setCanvasTitle("Detailed View"); setCanvasContent(null); setCanvasSpecs(null); setCanvasMsgs([]); }

  // Escape key closes canvas
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canvasOpen) { closeCanvas(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canvasOpen]);

  // Canvas chat messages — persistent thread visible in canvas panel
  const [canvasMsgs, setCanvasMsgs] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const canvasInputRef = useRef<HTMLTextAreaElement>(null);
  const canvasMsgsRef = useRef(canvasMsgs);
  canvasMsgsRef.current = canvasMsgs;
  const canvasChatEnd = useRef<HTMLDivElement>(null);

  // Canvas chat uses full chart context and conversation history.
  const handleCanvasChatSend = useCallback(async (msg: string) => {
    if (!msg.trim() || canvasBusy) return;
    const userMsg = msg.trim();
    setCanvasMsgs(prev => [...prev, { role: "user", content: userMsg }]);
    setCanvasBusy(true);
    setTimeout(() => canvasChatEnd.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      const chartContext = canvasSpecs ? JSON.stringify(canvasSpecs.map(s => ({ title: s.title, data: s.data?.slice(0, 8), x_key: s.x_key, y_keys: s.y_keys, chart_type: s.chart_type }))) : "no chart";
      const canvasHistory = canvasMsgsRef.current.slice(-6); // Keep recent context via ref
      const res = await fetch(`/api/projects/${id}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `[Canvas context] The user is viewing a detailed assessment panel. Current chart data: ${chartContext}\n\nUser request: ${userMsg}`,
          history: canvasHistory,
        }),
      });
      if (res.ok) {
        const { response: r } = await res.json();
        // Handle chart modification response
        if (r.action) {
          setCanvasMsgs(prev => [...prev, {
            role: "assistant",
            content: "Chart changes now run through the main workspace agent. Ask for the chart update in the main chat so it can be saved as a durable run.",
          }]);
        } else if (r.content) {
          // Text-only response — show in chat
          setCanvasMsgs(prev => [...prev, { role: "assistant", content: r.content }]);
        } else {
          setCanvasMsgs(prev => [...prev, { role: "assistant", content: "I wasn't able to process that request. Try rephrasing or ask a different question." }]);
        }
      } else {
        const errText = await res.text().catch(() => "");
        setCanvasMsgs(prev => [...prev, { role: "assistant", content: `Connection error (${res.status}). ${errText.slice(0, 100) || "Please try again."}` }]);
      }
    } catch (err) {
      setCanvasMsgs(prev => [...prev, { role: "assistant", content: `Something went wrong: ${err instanceof Error ? err.message : "unknown error"}. Please try again.` }]);
    } finally {
      setCanvasBusy(false);
      setTimeout(() => canvasChatEnd.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps — canvasMsgs excluded to avoid stale closure; we use setCanvasMsgs(prev => ...) pattern
  }, [id, canvasSpecs, canvasBusy]);

  /* ── Render ───────────────────────────────────────── */

  if (projectError && !project) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center max-w-md px-6">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 flex items-center justify-center mx-auto mb-5">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3M8 10.5v.5" /></svg>
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Failed to load project</h2>
          <p className="text-sm text-[#8899aa] mb-6">{projectError}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={refreshProject} className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#2a5580] text-white hover:bg-[#3a6a90] transition-colors">Try Again</button>
            <a href="/projects" className="px-5 py-2.5 rounded-xl text-sm font-medium bg-[#1a2a3e] text-[#8899aa] hover:text-white transition-colors">Back to Projects</a>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !project) {
    return <div className="h-[100dvh] flex items-center justify-center bg-[var(--bg-primary)]"><div className="flex items-center gap-3 text-sm text-[var(--text-muted)]"><IconSpinner /> Loading project...</div></div>;
  }


  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col bg-[var(--bg-primary)]">

      {/* ── Main: Chat + Optional Canvas ────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* ═══ Chat Column ═══ */}
        <div className="flex flex-col h-full min-h-0 transition-all duration-200" style={{ width: canvasOpen ? `${chatWidthPct}%` : "100%", minWidth: canvasOpen ? "300px" : undefined }}>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-5 py-6 relative">
            {/* Export button — top right of chat */}
            {msgs.length > 0 && (
              <div className={`${canvasOpen ? "max-w-full" : "max-w-[960px]"} mx-auto flex justify-end mb-2`}>
                <button onClick={async () => {
                  try {
                    const clientSnapshot = {
                      exported_at: new Date().toISOString(),
                      location: window.location.href,
                      user_agent: navigator.userAgent,
                      busy,
                      active_run_ids: Array.from(activeRunIdsRef.current),
                      event_source_run_ids: Array.from(eventSourcesRef.current.keys()),
                      pending_files: pendingFiles.map(file => ({ name: file.name, type: file.type, size: file.size })),
                      history_count: hist.length,
                      history_preview: hist.slice(-8),
                      project: projectSnapshotForDiagnostics(project),
                      client_errors: getClientErrorLog(),
                    };
                    const res = await fetch(`/api/projects/${id}/export`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        messages: msgs.map(serializeMessageForDiagnostics),
                        history: hist.slice(-50),
                        client_snapshot: clientSnapshot,
                      }),
                    });
                    if (!res.ok) {
                      const body = await res.text().catch(() => "");
                      reportClientError("export", { status: res.status, body });
                      alert(`Export failed (${res.status}). Please try again.`);
                      return;
                    }
                    const text = await res.text();
                    const blob = new Blob([text], { type: "application/json" });
                    const disposition = res.headers.get("Content-Disposition") || "";
                    const headerFilename = disposition.match(/filename="([^"]+)"/)?.[1];
                    const filename = headerFilename || `${(project?.name || "project").replace(/[^a-z0-9]/gi, "_")}_diagnostic_export.json`;
                    await downloadBlob(blob, filename);
                  } catch (err) {
                    reportClientError("export", err);
                    alert("Export failed. Please try again.");
                  }
                }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[15px] font-medium border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] hover:border-[var(--border-mid)] transition-all bg-[var(--bg-secondary)]/90 shadow-sm">
                  <IconDownload /> Export JSON
                </button>
              </div>
            )}
            <div className={`${canvasOpen ? "max-w-full" : "max-w-[960px]"} mx-auto space-y-4`}>

              {/* Messages */}
              {(() => {
                const visibleMsgs = msgs.filter(m => m.loading || m.content || m.artifact || m.plan || (m.questions && m.questions.length > 0) || (m.followups && m.followups.length > 0) || m.failedAction);
                return visibleMsgs.map((m, _mi) => (
                <div key={m.id} ref={_mi === visibleMsgs.length - 1 ? lastMsgRef : undefined} className={`group ${m.role === "user" ? "flex justify-end" : ""}`}>
                  <div className={`relative ${m.role === "user"
                    ? "max-w-[80%] bg-[#151d35] border border-[#2a3358] rounded-2xl rounded-br-md px-5 py-4"
                    : `w-full border border-[var(--border)] rounded-2xl rounded-bl-md px-5 py-4`}`}>
                    {/* Copy button — appears on hover */}
                    {m.content && !m.loading && (
                      <div className="absolute top-2 right-2">
                        <CopyButton text={m.content} />
                      </div>
                    )}

                    {m.loading && (
                      <LoadingIndicator message={m} />
                    )}

                    {/* Text content */}
                    {shouldRenderMessageBody(m) && (() => {
                      // Extract attachment info from message
                      const attachMatch = m.content.match(/\[Attached:\s*(.+?)\]/);
                      const textWithoutAttach = m.content.replace(/\n*\[Attached:\s*.+?\]/, "").trim();
                      const attachedFiles = attachMatch ? attachMatch[1].split(",").map(f => f.trim()) : [];
                      // Show user's original message text (not just files)

                      return (
                        <div className={`${m.role === "user" ? "text-[17px]" : "text-[17px]"} leading-[1.7] space-y-1`}>
                          {/* Attachment badges */}
                          {attachedFiles.length > 0 && m.role === "user" && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {attachedFiles.map((f, i) => (
                                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-[15px] text-white font-medium">
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7 1H3.5A1.5 1.5 0 002 2.5v7A1.5 1.5 0 003.5 11h5A1.5 1.5 0 0010 9.5V4L7 1z" stroke="currentColor" strokeWidth="1"/></svg>
                                  {f}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Message text — direct rendering (with LaTeX stripping + JSON unwrap) */}
                          {textWithoutAttach && textWithoutAttach.length > 0 && (
                            <div className={m.role === "user" ? "user-message" : ""}>
                              {m.role === "assistant" && m.responseBlocks?.length ? (
                                <ClientResponseBlocksView blocks={m.responseBlocks} />
                              ) : (
                                <MarkdownRenderer content={m.role === "assistant" ? stripLatex(unwrapJsonContent(textWithoutAttach)) : textWithoutAttach} />
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Plan */}
                    {m.plan && m.plan.length > 0 && !m.autoRunPlan && !m.plan.every((s: PlanStep) => s.status === "done") && (
                      <PlanCardWidget steps={m.plan}
                        autoRun={!!m.autoRunPlan}
                        onCancel={() => {
                          planCancelRef.current = true;
                          if (m.runId) {
                            fetch(`/api/projects/${id}/runs/${encodeURIComponent(m.runId)}/cancel`, { method: "POST" }).catch(() => {});
                          }
                        }}
                        onRun={m.plan.every(s => s.status === "pending" || !s.status) ? () => {
                          if (m.runId) {
                            upd(m.id, { loading: true, loadingText: "Starting approved plan..." });
                            fetch(`/api/projects/${id}/runs/${encodeURIComponent(m.runId)}/approve`, { method: "POST" })
                              .then(() => subscribeToRun(m.runId!, m.id))
                              .catch(() => upd(m.id, { loading: false, content: "Could not approve the plan. Please try again." }));
                            return;
                          }
                          upd(m.id, {
                            content: DURABLE_RUN_REQUIRED_MESSAGE,
                            loading: false,
                            loadingText: undefined,
                            autoRunPlan: false,
                          });
                        } : undefined}
                        onStepsChange={m.runId && m.plan.every(s => s.status === "pending" || !s.status) ? async (steps: PlanStep[]) => {
                          upd(m.id, { plan: steps, content: "Plan updated." });
                          try {
                            const res = await fetch(`/api/projects/${id}/runs/${encodeURIComponent(m.runId!)}/plan`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ steps }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (res.ok && data?.run?.plan) {
                              upd(m.id, { plan: data.run.plan, content: "Plan updated.", loading: false, loadingText: undefined });
                            }
                          } catch {
                            upd(m.id, { content: "Could not save the plan change. Please try again.", loading: false, loadingText: undefined });
                          }
                        } : undefined}
                        onEditSubmit={m.plan.every(s => s.status === "pending" || !s.status) ? async (feedback: string) => {
                          if (m.runId) {
                            const currentPlan = (m.plan as PlanStep[]);
                            upd(m.id, { loading: true, loadingText: "Updating plan..." });
                            try {
                              const res = await fetch(`/api/projects/${id}/runs/${encodeURIComponent(m.runId)}/plan`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ feedback, steps: currentPlan }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (res.ok && data?.run?.plan) {
                                upd(m.id, {
                                  content: "Plan updated.",
                                  loading: false,
                                  loadingText: undefined,
                                  plan: data.run.plan,
                                });
                              } else {
                                upd(m.id, {
                                  content: data?.error || "Failed to revise plan. Please try again.",
                                  loading: false,
                                  loadingText: undefined,
                                  plan: m.plan,
                                });
                              }
                            } catch {
                              upd(m.id, { content: "Connection error while updating the plan.", loading: false, loadingText: undefined, plan: m.plan });
                            }
                            return;
                          }
                          upd(m.id, {
                            content: DURABLE_RUN_REQUIRED_MESSAGE,
                            loading: false,
                            loadingText: undefined,
                            autoRunPlan: false,
                          });
                        } : undefined}
                        onUploadFiles={async (files: File[]) => {
                          const names: string[] = [];
                          for (const f of files) {
                            try { await uploadDocument(f); names.push(f.name); }
                            catch (e) { reportClientError(`upload:${f.name}`, e); }
                          }
                          return names;
                        }}
                      />
                    )}

                    {/* Chat is text-first. Tool artifacts remain available to the project and export APIs,
                        but legacy evidence/detail cards are no longer injected into the conversation. */}

                    {/* Charts rendered inline with interactive view */}
                    {m.artifact && (m.artifact.content as any)?.chart_spec && (
                      <CustomChartWidget spec={(m.artifact.content as any).chart_spec} onExpand={(s: any) => openCanvas("chart", s)} />
                    )}
                    {m.artifact && (m.artifact.content as any)?.chart_specs && (
                      <div className="space-y-3">
                        {((m.artifact.content as any).chart_specs as any[]).map((spec: any, i: number) => (
                          <CustomChartWidget key={i} spec={spec} onExpand={() => openCanvas("chart", (m.artifact!.content as any).chart_specs)} />
                        ))}
                        {Array.isArray((m.artifact.content as any).key_insights) && (m.artifact.content as any).key_insights.length > 0 && (
                          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--accent-purple)]">Key Insights</span>
                            </div>
                            <ul className="space-y-1">
                              {((m.artifact.content as any).key_insights as string[]).slice(0, 5).map((ins: string, i: number) => (
                                <li key={i} className="text-[15px] text-[var(--text-secondary)] flex gap-2">
                                  <span className="text-[var(--accent-purple)] shrink-0">-</span>
                                  <span>{ins}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <button
                          onClick={() => openCanvas("chart", (m.artifact!.content as any).chart_specs)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 border border-[var(--border)] transition-colors"
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M10 2h4v4M6 14H2v-4M14 2L9 7M2 14l5-5"/></svg>
                          Open Interactive View
                        </button>
                      </div>
                    )}

                    {/* Questions */}
                    {m.questions && m.questions.length > 0 && (
                      <div className="space-y-2 mt-4">
                        {m.questions.map((q, i) => (
                          <button key={i} onClick={() => { setInput(q); inputRef.current?.focus(); }}
                            className="block w-full text-left text-[15px] px-4 py-2.5 rounded-xl border border-[var(--accent-blue)]/20 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 transition-all">
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Tool issue with retry */}
                    {m.failedAction && (
                      <div className="mt-3 rounded-xl border border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[15px] font-semibold text-[var(--accent-red)]">Tool run did not finish</span>
                            <p className="text-[15px] text-[var(--text-muted)] mt-0.5">
                              {(m.failedAction.type || "").replace(/_/g, " ")} needs to be retried or narrowed.
                            </p>
                          </div>
                          <button onClick={() => {
                            const failedType = (m.failedAction?.type || "tool").replace(/_/g, " ");
                            upd(m.id, { failedAction: undefined });
                            sendMessage(`Retry the failed ${failedType} request using the current project files and saved run context.`);
                          }}
                            className="px-4 py-2 rounded-lg text-[15px] font-medium border border-[var(--accent-red)]/30 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10 transition-colors">
                            Retry
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Followups moved to above chatbox — see lastFollowups */}
                  </div>
                </div>
              ));})()}
              <div ref={chatEnd} />
            </div>
          </div>

          {/* ── Suggested Responses (horizontal chips above chatbox) ─── */}
          {lastFollowups.length > 0 && !busy && (
            <div className="shrink-0 border-t border-[var(--border)]">
              <div className="px-5 py-3">
                <div className={`${canvasOpen ? "max-w-full" : "max-w-[960px]"} mx-auto flex gap-2 items-stretch`}>
                  {lastFollowups.slice(0, 3).map((f, i) => (
                    <button key={i} onClick={() => { setBusy(true); sendMessage(f); }} title={f} disabled={busy}
                      className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl text-[14px] leading-snug text-white/90 bg-[#151d35] border border-[#2a3358] hover:text-white hover:bg-[#263163] hover:border-[#6077b8] hover:shadow-[0_0_0_1px_rgba(96,119,184,0.35)] transition-colors duration-150 text-left disabled:opacity-40 disabled:pointer-events-none line-clamp-2 whitespace-normal break-words cursor-pointer">
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Chat Input ─────────────────────── */}
          <div
            className={`chat-input-bar sticky bottom-0 z-20 shrink-0 px-5 pt-1 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-[var(--bg-primary)] transition-colors ${dragOver ? "border-t border-[var(--accent-blue)] bg-[var(--accent-blue)]/5" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addPendingFiles(e.dataTransfer.files); }}
          >
            <div className={`${canvasOpen ? "max-w-full" : "max-w-[960px]"} mx-auto`}>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151d35] border border-[#2a3358] text-[15px] text-white">
                      <IconPaperclip />
                      <span className="truncate max-w-[160px] font-medium">{f.name}</span>
                      <button onClick={() => removePendingFile(i)} className="text-white/60 hover:text-white ml-0.5 text-sm leading-none">&times;</button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.docx,.doc,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.xml,.yaml,.yml,.md,.pptx,.rtf,.tsv,.parquet" style={{ display: "none" }} onChange={e => { addPendingFiles(e.target.files); e.target.value = ""; }} />
              <div className="rounded-2xl border border-[#2a3358] bg-[#151d35] shadow-[0_14px_40px_rgba(0,0,0,0.24)] focus-within:border-[#6077b8] transition-colors">
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={busy ? "Keep typing while I work..." : "Message Exergy Lab..."}
                  rows={1}
                  className="w-full bg-transparent px-4 pt-3.5 pb-1.5 text-[17px] leading-relaxed text-white placeholder:text-white/55 resize-none overflow-hidden focus:outline-none"
                  style={{ height: `${CHAT_INPUT_MIN_HEIGHT}px`, minHeight: `${CHAT_INPUT_MIN_HEIGHT}px`, maxHeight: `${CHAT_INPUT_MAX_HEIGHT}px` }}
                  onInput={e => resizeChatInput(e.target as HTMLTextAreaElement, (e.target as HTMLTextAreaElement).value)} />
                <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button onClick={() => fileRef.current?.click()}
                      className="h-10 w-10 rounded-xl flex items-center justify-center text-white/72 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
                      title="Attach files">
                      <IconPaperclip size={24} />
                    </button>
                  </div>
                  {busy ? (
                    <div className="flex items-center gap-2">
                      <button onClick={stopGeneration}
                        className="h-10 shrink-0 rounded-xl border border-[#7d3f4a] bg-[#4a2730] px-4 text-[14px] font-semibold text-[#f4cbd1] flex items-center gap-2 hover:bg-[#5a303a] hover:text-white transition-colors"
                        title="Stop generation">
                        <IconStop />
                        Stop
                      </button>
                      <button onClick={() => sendMessage()} disabled={!input.trim() && pendingFiles.length === 0}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#4a6a8a] to-[#3a7a6a] hover:from-[#5a7a9a] hover:to-[#4a8a7a] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
                        title="Send another message">
                        <IconSend />
                        Send
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => sendMessage()} disabled={!input.trim() && pendingFiles.length === 0}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-[#4a6a8a] to-[#3a7a6a] hover:from-[#5a7a9a] hover:to-[#4a8a7a] disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
                      title="Send message">
                      <IconSend />
                      Send
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Resizable Divider ═══ */}
        {canvasOpen && (
          <div
            ref={dividerRef}
            role="separator" aria-label="Resize panel" aria-orientation="vertical"
            className="shrink-0 w-1 cursor-col-resize bg-[var(--border)]/50 hover:bg-[var(--accent-blue)]/50 hover:w-1.5 active:bg-[var(--accent-blue)]/70 active:w-2 transition-all group"
            onMouseDown={e => {
              e.preventDefault();
              const startX = e.clientX;
              const startPct = chatWidthPct;
              const containerWidth = (e.target as HTMLElement).parentElement?.clientWidth || 1000;
              const onMove = (ev: MouseEvent) => {
                const delta = ev.clientX - startX;
                const newPct = Math.max(25, Math.min(75, startPct + (delta / containerWidth) * 100));
                setChatWidthPct(newPct);
              };
              const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
          />
        )}

        {/* ═══ Canvas Panel ═══ */}
        {canvasOpen && (
          <div className="flex flex-col min-w-0 bg-[var(--bg-primary)] animate-slide-in" style={{ width: `${100 - chatWidthPct}%` }}>
            {/* Canvas header — matches canvas body background for a seamless surface */}
            <div className="shrink-0 h-14 flex items-center justify-between px-6 border-b border-[var(--border)]/60 bg-[var(--bg-primary)]">
              <span className="text-[20px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">{canvasTitle}</span>
              <button onClick={closeCanvas} aria-label="Close detailed view"
                className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l8 8M10 2L2 10"/></svg>
              </button>
            </div>
            {/* Canvas content + chat thread */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-5">
                {canvasContent}
              </div>
              {/* Canvas chat thread — visible messages */}
              {canvasMsgs.length > 0 && (
                <div className="px-5 pb-3 space-y-3">
                  <div className="h-px bg-[var(--border)] my-2" />
                  {canvasMsgs.map((cm, i) => (
                    <div key={i} className={`flex ${cm.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
                        cm.role === "user"
                          ? "bg-[var(--accent-blue)] text-white rounded-br-md"
                          : "bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] rounded-bl-md"
                      }`}>
                        {cm.content}
                      </div>
                    </div>
                  ))}
                  {canvasBusy && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[15px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-2"><IconSpinner /> Updating the detailed view...</span>
                      </div>
                    </div>
                  )}
                  <div ref={canvasChatEnd} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageContent({ content, isUser }: { content: string; isUser: boolean }) {
  if (!content) return null;
  return <MarkdownRenderer content={content} className={isUser ? "user-message" : ""} />;
}

function FollowupButtons({ followups, onSelect, inputRef }: { followups: string[]; onSelect: (msg: string) => void; inputRef: React.RefObject<HTMLTextAreaElement> }) {
  const [otherText, setOtherText] = useState("");
  // Show first N-1 as buttons, last slot is always "Other" with text input
  const buttons = followups.slice(0, -1);

  return (
    <div className="space-y-2 mt-4 pt-3 border-t border-[var(--border)]">
      {buttons.map((f, i) => (
        <button key={i} onClick={() => onSelect(f)}
          className={`block w-full text-left text-[15px] px-4 py-3 rounded-xl transition-all ${
            i === 0
              ? "bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/25 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/15 font-medium"
              : "border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-mid)] hover:bg-[var(--bg-hover)]"
          }`}>
          {f}
        </button>
      ))}
      {/* Other — inline text input */}
      <div className="flex gap-2 items-center rounded-xl border border-dashed border-[var(--border-mid)] px-4 py-2">
        <span className="text-[15px] text-[var(--text-muted)] shrink-0 font-medium">Other:</span>
        <input
          type="text"
          value={otherText}
          onChange={e => setOtherText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && otherText.trim()) { onSelect(otherText.trim()); setOtherText(""); } }}
          placeholder="Tell me exactly what you want me to do..."
          className="flex-1 bg-transparent text-[15px] text-[var(--text-secondary)] placeholder:text-[var(--text-dim)] outline-none"
        />
        {otherText.trim() && (
          <button onClick={() => { onSelect(otherText.trim()); setOtherText(""); }}
            className="shrink-0 text-[12px] px-2.5 py-1 rounded-lg bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-muted)]">
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function CustomChartWidget({ spec, onExpand }: { spec: any; onExpand?: (spec: any) => void }) {
  if (!spec || !spec.data || spec.data.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <p className="text-[15px] text-[var(--text-muted)]">No data available for this chart.</p>
      </div>
    );
  }
  return <CustomChart spec={spec} onExpand={onExpand} />;
}

function PlanCardWidget({ steps, autoRun = false, onRun, onEditSubmit, onStepsChange, onUploadFiles, onCancel }: { steps: any[]; autoRun?: boolean; onRun?: () => void; onEditSubmit?: (feedback: string, files?: File[]) => void; onStepsChange?: (steps: any[]) => void; onUploadFiles?: (files: File[]) => Promise<string[]>; onCancel?: () => void }) {
  const allPending = steps.every((s: any) => s.status === "pending" || !s.status);
  const allDone = steps.every((s: any) => s.status === "done");
  const running = steps.some((s: any) => s.status === "running");
  const doneCount = steps.filter((s: any) => s.status === "done").length;
  const runningStep = steps.find((s: any) => s.status === "running");
  const elapsed = useElapsedTime(running);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const updateSteps = (next: any[]) => {
    onStepsChange?.(next.map((step, index) => ({ ...step, step: index + 1 })));
  };

  const handleEditSubmit = async () => {
    if (!editText.trim() && editFiles.length === 0) return;
    // Upload files first if any
    let fileNames: string[] = [];
    if (editFiles.length > 0 && onUploadFiles) {
      fileNames = await onUploadFiles(editFiles);
    }
    const feedback = editText.trim() + (fileNames.length > 0 ? `\n\n[Attached: ${fileNames.join(", ")}]` : "");
    onEditSubmit?.(feedback);
    setEditing(false); setEditText(""); setEditFiles([]);
  };

  return (
    <div className="mt-4 mb-2">
      {/* Header — hairline top rule, document-style */}
      <div className="pt-4 pb-2 border-t border-[var(--border)]/60">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="text-[12px] uppercase tracking-[0.18em] text-[var(--text-dim)] font-medium">
              {allDone ? "Analysis Complete" : running ? `Step ${doneCount + 1} of ${steps.length}` : autoRun ? "Starting Analysis" : "Execution Plan"}
            </span>
            {running && runningStep && (
              <span className="text-[15px] text-[var(--text-muted)] truncate">
                {runningStep.title}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {running && onCancel && (
              <button
                onClick={onCancel}
                className="text-[12px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
              >
                Cancel
              </button>
            )}
            <span className="text-[12px] text-[var(--text-dim)] tabular-nums">
              {running ? timeStr : allDone ? `${steps.length} steps` : ""}
            </span>
          </div>
        </div>
        {(running || allDone) && (
          <div className="mt-2 h-[2px] rounded-full bg-[var(--border)]/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(steps.length > 0 ? (doneCount / steps.length) * 100 : 0, running ? 5 : 0)}%`,
                background: allDone ? "var(--accent-green)" : "var(--accent-blue)",
              }}
            />
          </div>
        )}
      </div>
      {/* Steps — hairline-divided rows, numbered tabular */}
      <div className="border-t border-[var(--border)]/50">
        {steps.map((s: any, i: number) => (
          <div key={s.step} className="py-2.5 flex items-baseline gap-4 border-b border-[var(--border)]/40 last:border-b-0">
            <span className="shrink-0 w-6 text-[12px] tabular-nums text-[var(--text-dim)] font-medium">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-medium text-[var(--text-primary)] leading-snug">
                  {s.title}
                </span>
                {s.status === "done" && (
                  <span className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[var(--accent-green)] shrink-0">
                    Done
                  </span>
                )}
                {s.status === "running" && (
                  <span className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[var(--accent-blue)] shrink-0">
                    Running
                  </span>
                )}
                {s.status === "failed" && (
                  <span className="text-[12px] uppercase tracking-[0.14em] font-semibold text-[var(--accent-red)] shrink-0">
                    Failed
                  </span>
                )}
                {s.display_only && (!s.status || s.status === "pending") && (
                  <span className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] shrink-0">
                    Planned
                  </span>
                )}
                {!s.display_only && (!s.status || s.status === "pending") && (
                  <span className="text-[12px] uppercase tracking-[0.14em] text-[var(--text-dim)] shrink-0">
                    Pending
                  </span>
                )}
                {allPending && !editing && onStepsChange && s.action_type !== "synthesis" && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Move step up"
                      disabled={i === 0 || steps[i - 1]?.action_type === "synthesis"}
                      onClick={() => {
                        const next = [...steps];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        updateSteps(next);
                      }}
                      className="h-7 w-7 rounded-md text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-white disabled:opacity-20"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Move step down"
                      disabled={i === steps.length - 1 || steps[i + 1]?.action_type === "synthesis"}
                      onClick={() => {
                        const next = [...steps];
                        [next[i + 1], next[i]] = [next[i], next[i + 1]];
                        updateSteps(next);
                      }}
                      className="h-7 w-7 rounded-md text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-white disabled:opacity-20"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="Remove step"
                      disabled={!(s.display_only || s.action_type === "planning_detail") || steps.length <= 1}
                      onClick={() => updateSteps(steps.filter((_: any, stepIndex: number) => stepIndex !== i))}
                      className="h-7 w-7 rounded-md text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent-red)] disabled:opacity-20"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
              {s.description && (
                <p className="text-[15px] text-[var(--text-muted)] mt-1 leading-relaxed">
                  {s.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Inline edit area with file upload */}
      {editing && allPending && (
        <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <textarea
            ref={editRef}
            value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && editText.trim()) { e.preventDefault(); handleEditSubmit(); } }}
            placeholder="Describe what to change... (Enter to send, Shift+Enter for newline)"
            rows={3}
          className="w-full bg-[#151d35] border border-[#2a3358] rounded-xl px-4 py-3 text-[15px] leading-relaxed text-white placeholder:text-white/55 resize-none focus:border-[#6077b8] focus:outline-none"
            autoFocus
          />
          {editFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {editFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#202940] border border-[#2a3358] text-[12px] text-white">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7 1H3.5A1.5 1.5 0 002 2.5v7A1.5 1.5 0 003.5 11h5A1.5 1.5 0 0010 9.5V4L7 1z" stroke="currentColor" strokeWidth="1"/></svg>
                  {f.name}
                  <button onClick={() => setEditFiles(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-dim)] hover:text-[var(--accent-red)] text-sm leading-none">&times;</button>
                </span>
              ))}
            </div>
          )}
          <input ref={editFileRef} type="file" multiple accept=".pdf,.csv,.xlsx,.xls,.docx,.doc,.txt,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.xml,.yaml,.yml,.md,.pptx,.rtf,.tsv,.parquet" style={{ display: "none" }} onChange={e => { if (e.target.files) setEditFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ""; }} />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditing(false); setEditText(""); setEditFiles([]); }}
                className="px-4 py-2 rounded-lg text-[15px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">
                Cancel
              </button>
              {onUploadFiles && (
                <button onClick={() => editFileRef.current?.click()}
                  className="px-3 py-2 rounded-lg text-[15px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] border border-[var(--border)]"
                  title="Attach documents">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M13.5 7.5l-6 6a3.5 3.5 0 01-5-5l6-5.97a2.33 2.33 0 013.3 3.3l-6 5.97a1.17 1.17 0 01-1.65-1.65l5.5-5.5"/></svg>
                </button>
              )}
            </div>
            <button onClick={handleEditSubmit}
              disabled={!editText.trim() && editFiles.length === 0}
              className="px-4 py-2 rounded-lg text-[15px] font-medium bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue-muted)] disabled:opacity-30">
              Update Plan
            </button>
          </div>
        </div>
      )}
      {/* Action buttons */}
      {allPending && !editing && (onRun || onEditSubmit) && (
        <div className="px-4 py-2.5 border-t border-[var(--border)] flex gap-2">
          {autoRun ? (
            <span className="text-[13px] text-[var(--text-muted)] py-2">Starting automatically...</span>
          ) : (
            <>
              {onRun && <button onClick={onRun} className="px-4 py-2 rounded-lg text-[15px] font-medium bg-[#151d35] border border-[#2a3358] text-white hover:bg-[#1c2542] hover:border-[#3d4874] transition-colors">Approve Plan</button>}
              {onEditSubmit && <button onClick={() => { setEditing(true); setTimeout(() => editRef.current?.focus(), 50); }} className="px-4 py-2 rounded-lg text-[15px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] border border-[var(--border)]">Edit</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
