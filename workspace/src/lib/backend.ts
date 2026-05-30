// @ts-nocheck — Legacy backend module. Only getEnvVar and RUNTIME_DIR are actively used by the project system.
/**
 * Backend integration layer.
 *
 * Reads from the filesystem (runtime/ directory) and spawns Python CLI
 * processes for job execution. Research and diligence workflows use the
 * DeepSeek API to generate structured briefs grounded in engine data.
 *
 * This keeps the frontend thin — all source of truth remains in the
 * Python backend for science workflows.
 */

import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
// Types imported from the old types.ts — kept as local stubs for backward compat
// Only getEnvVar and RUNTIME_DIR are actively used by the project system
type Job = Record<string, unknown>;
type JobType = string;
type ProductArea = string;
type ReviewState = string;
type ResearchBrief = Record<string, unknown>;
type DiligenceBrief = Record<string, unknown>;
type WorkspaceBrief = Record<string, unknown>;
type NotebookEntry = Record<string, unknown>;
type NotebookEntryType = string;
type AssistantThread = Record<string, unknown>;
type ThreadMessage = Record<string, unknown>;
type ThreadStatus = string;

// Path to the repo root — ENGINE_ROOT is set in Docker (start.sh), otherwise workspace/ is one level deep
const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const ROOT_ENV_PATH = join(REPO_ROOT, ".env");
const DEFAULT_EXTRA_ENV_PATHS = [
  join(REPO_ROOT, ".env.local"),
  join(REPO_ROOT, "workspace", ".env.local"),
  "/mnt/c/Users/Chris/nature-engine/config/.env",
  "/home/chris/nature-engine/config/.env",
  "/home/chris/breakthrough-engine/.env",
  "/home/chris/breakthrough-engine/.env.local",
  "/home/chris/breakthrough-engine/workspace/.env.local",
];

function parseEnvValueFromFile(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const content = require("fs").readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      let k = trimmed.slice(0, eqIdx).trim();
      if (k.startsWith("export ")) k = k.slice(7).trim();
      if (k !== key) continue;
      let val = trimmed.slice(eqIdx + 1).trim();
      const commentIdx = val.search(/\s+#/);
      if (commentIdx >= 0) val = val.slice(0, commentIdx).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      return val;
    }
  } catch {
    // Parse failure
  }
  return undefined;
}

/**
 * Read a key from the repo root .env file.
 * Falls back to process.env (which includes workspace/.env.local via Next.js).
 */
export function getEnvVar(key: string): string | undefined {
  // Next.js .env.local takes priority
  if (process.env[key]) return process.env[key];
  // Fallback: read from repo root .env
  const extraEnvPaths = (process.env.EXERGY_EXTRA_ENV_FILES || "")
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const envPath of [ROOT_ENV_PATH, ...extraEnvPaths, ...DEFAULT_EXTRA_ENV_PATHS]) {
    const value = parseEnvValueFromFile(envPath, key);
    if (value) return value;
  }
  return undefined;
}

// Key directories — use /tmp on Vercel (read-only filesystem)
export const RUNTIME_DIR = process.env.VERCEL ? join("/tmp", "runtime") : join(REPO_ROOT, "runtime");
export const BRIEFS_DIR = join(RUNTIME_DIR, "battery_briefs");
export const EXPORTS_DIR = join(RUNTIME_DIR, "battery_exports");
export const EVAL_DIR = join(RUNTIME_DIR, "battery_eval");
export const LOOP_DIR = join(RUNTIME_DIR, "battery_loop");
export const PV_LOOP_DIR = join(RUNTIME_DIR, "pv_loop");
export const PV_BRIEFS_DIR = join(RUNTIME_DIR, "pv_briefs");
export const INVERTER_BRIEFS_DIR = join(RUNTIME_DIR, "inverter_briefs");
export const INVERTER_LOOP_DIR = join(RUNTIME_DIR, "inverter_loop");
export const PTL_BRIEFS_DIR = join(RUNTIME_DIR, "ptl_briefs");
export const JOBS_DIR = join(RUNTIME_DIR, "workspace_jobs");
export const WORKSPACE_BRIEFS_DIR = join(RUNTIME_DIR, "workspace_briefs");
export const NOTEBOOK_DIR = join(RUNTIME_DIR, "workspace_notebook");
export const THREADS_DIR = join(RUNTIME_DIR, "workspace_threads");
// Cross-platform python path — uses PYTHON_PATH env var in Docker, .venv locally
import { platform } from "os";
const DEFAULT_REPO_PYTHON = platform() === "win32"
  ? join(REPO_ROOT, ".venv", "Scripts", "python.exe")
  : join(REPO_ROOT, ".venv", "bin", "python");
const PYTHON = getEnvVar("PYTHON_PATH") || (existsSync(DEFAULT_REPO_PYTHON) ? DEFAULT_REPO_PYTHON : "python3");

// DeepSeek API
export const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";

import { logDebug } from "./debug-log";

function _logLLM(model: string, status: number, durationMs: number, inputTokens: number, fallback: boolean, error?: string) {
  logDebug("llm", error ? `${model} failed (${status})` : `${model} ok`, {
    model, status, input_tokens_est: inputTokens, fallback, ...(error ? { error } : {}),
  }, durationMs);
}

// Gemini is used as a fast multimodal assistant for document vision/OCR.
// DeepSeek remains the primary reasoning and orchestration model. Keep Gemini
// model IDs configurable and fall back across current multimodal Flash/Pro IDs
// because preview names can change independently of this application.
const DEFAULT_GEMINI_FLASH_MODEL = "gemini-3.5-flash";
const GEMINI_FLASH_MODEL = getEnvVar("GEMINI_MODEL") || DEFAULT_GEMINI_FLASH_MODEL;
const GEMINI_VISION_MODEL = getEnvVar("GEMINI_VISION_MODEL") || getEnvVar("GEMINI_MODEL") || DEFAULT_GEMINI_FLASH_MODEL;
const GEMINI_MODEL_FALLBACKS = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-pro"];
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiModelCandidates(primary?: string): string[] {
  const configured = primary || GEMINI_VISION_MODEL || GEMINI_FLASH_MODEL || DEFAULT_GEMINI_FLASH_MODEL;
  return Array.from(new Set([configured, DEFAULT_GEMINI_FLASH_MODEL, ...GEMINI_MODEL_FALLBACKS].filter(Boolean)));
}

function geminiShouldTryFallback(status: number): boolean {
  return status === 400 || status === 404 || status === 429 || status >= 500;
}

/**
 * Call DeepSeek V4-Flash — primary text reasoning and orchestration model.
 *
 * OpenAI-compatible messages format. Reliable structured JSON output,
 * strong orchestration, low cost ($0.30/$0.50 per 1M tokens, 1M-token context).
 *
 * Thinking mode (V4 surface):
 *   - "disabled": 0 reasoning tokens, fastest. Use for routine chat turns.
 *   - "enabled":  reasoning_content populated, deeper analysis. Pair with
 *                 reasoningEffort for budget control (default "high").
 *   - "adaptive": model decides per-query. This is the upstream default if
 *                 the param is omitted; we force a choice explicitly so
 *                 routine turns don't silently burn reasoning tokens.
 */
export async function callDeepSeekV3(
  messages: Array<{ role: string; content: string }>,
  opts: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    thinking?: "disabled" | "enabled" | "adaptive";
    reasoningEffort?: "low" | "medium" | "high" | "max" | "xhigh";
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const apiKey = getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY");
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set — required for DeepSeek V4-Flash agent");

  // Only set the thinking field when the caller explicitly chose a mode.
  // Omitting it preserves V4-Flash's upstream default (adaptive) so existing
  // callers that don't opt in don't see a silent behavior change.
  const explicitThinking = opts.thinking !== undefined;
  const isThinking = opts.thinking === "enabled";

  const model = opts.model || getEnvVar("BT_DEEPSEEK_TEXT_MODEL") || DEEPSEEK_FLASH_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages,
    // Reasoning mode wants a hotter temperature per the V4 paper (§5.3.1);
    // non-think stays cool for deterministic JSON orchestration.
    temperature: opts.temperature ?? (isThinking ? 1.0 : 0.2),
    // Reasoning burns output tokens on the hidden trace — need a larger
    // budget or the visible content gets truncated (finish_reason=length).
    max_tokens: opts.maxTokens ?? (isThinking ? 24_000 : 8_000),
    ...(explicitThinking ? { thinking: { type: opts.thinking } } : {}),
    ...(isThinking ? { reasoning_effort: opts.reasoningEffort ?? "high" } : {}),
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const requestBody = JSON.stringify(body);
  const inputTokenEstimate = Math.round(requestBody.length / 4);
  const t0 = Date.now();

  let res: Response;
  try {
    const controller = new AbortController();
    // Thinking mode generates many more tokens; give it headroom.
    const timeoutMs = opts.timeoutMs ?? (isThinking ? 180_000 : 75_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    res = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _logLLM(model, 0, Date.now() - t0, inputTokenEstimate, false, msg);
    throw new Error(`DeepSeek V4-Flash network error: ${msg}`);
  }

  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _logLLM(model, res.status, elapsed, inputTokenEstimate, false, errText.slice(0, 200));
    throw new Error(`DeepSeek V4-Flash API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  _logLLM(model, 200, elapsed, inputTokenEstimate, false);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("DeepSeek V4-Flash returned empty response");
  return text;
}

// Benchmark-tuned (CC-BE-INFRA-0109): below this, non-think dispatches
// action/response schema correctly and ~40% faster; above it, reasoning
// starts to add net value on multi-clause prompts.
const LONG_PROMPT_WORD_THRESHOLD = 40;

/**
 * Classify whether a chat turn should escalate to V4-Flash thinking mode.
 *
 * Empirically tuned against the chat's JSON-dispatch task
 * (CC-BE-INFRA-0109 benchmark). Thinking helps on multi-perspective
 * comparison and explanation questions, but hurts crisp action-verb
 * dispatch ("analyze X", "evaluate Y") — the non-think path routes those
 * more decisively. So we trigger thinking only on the categories where
 * benchmark data shows a net win:
 *   - Comparison / tradeoff questions (thinking unique-wins)
 *   - Open "why/how/what-if" explanations (content depth)
 *   - Explicit depth requests ("deep dive", "due diligence")
 *   - Long, multi-clause prompts (>LONG_PROMPT_WORD_THRESHOLD words)
 *
 * Action verbs ("analyze", "evaluate", "simulate", "run") are
 * intentionally NOT triggers — the non-think path dispatches them faster
 * and more accurately. The chat retry path unconditionally escalates to
 * thinking, so a missed classification is self-correcting if non-think
 * emits a wrong JSON type.
 */
export function shouldEscalateToThinking(
  message: string,
  opts: { canvasContext?: boolean } = {},
): boolean {
  if (opts.canvasContext) return true;
  const lower = message.toLowerCase();
  const triggers = [
    /\bcompare\b/,
    /\bvs\.?\b/,
    /\btradeoffs?\b/,
    /\bimplications?\b/,
    /\bwhy\s+(does|is|would|are|should|can|can't)/,
    /\bhow\s+does\b/,
    /\bwhat\s+if\b/,
    /\bdeep\s+(dive|analysis|research)/,
    /\bdue\s+diligence\b/,
    /\bthoroughly\b/,
    /\bcomprehensiv/,
  ];
  if (triggers.some(re => re.test(lower))) return true;
  return message.trim().split(/\s+/).length > LONG_PROMPT_WORD_THRESHOLD;
}

// ── Tiered model routing ──────────────────────────────────────────
//
// Mirrors the Python harness 3-tier architecture (langgraph_harness/llm.py):
//   - Routing/orchestration: DeepSeek V4-Flash (cheap, high volume)
//   - Planning/Review:       GLM-5.1 via OpenRouter (agentic SOTA, Terminal-Bench 63.5)
//   - Reasoning/Synthesis:   Qwen 3.6 Plus via DashScope (LiveCodeBench 87.1, SWE-Bench 78.8)
//   - Vision fallback:       provider-specific opt-in only
//
// Both callQwen36Plus and callGLM51 fall back to DeepSeek V4-Flash automatically
// when their API keys are not set, so callers never need to handle fallback.

const QWEN_MODEL = "qwen3.6-plus";
const QWEN_API_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const GLM_MODEL = "z-ai/glm-5.1";
const GLM_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Call Qwen 3.6 Plus — reasoning and synthesis model.
 *
 * Best-in-class for long-form reasoning, synthesis, and code generation.
 * $0.50/$3.00 per 1M tokens via DashScope. Falls back to DeepSeek V4-Flash
 * if DASHSCOPE_API_KEY is not set.
 *
 * Use for: research synthesis, deep analysis, revision, exploratory analysis.
 */
export async function callQwen36Plus(
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const apiKey = getEnvVar("DASHSCOPE_API_KEY");
  if (!apiKey) {
    // Transparent fallback to DeepSeek V4-Flash
    return callDeepSeekV3(messages, opts);
  }

  const model = QWEN_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 8000,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const requestBody = JSON.stringify(body);
  const inputTokenEstimate = Math.round(requestBody.length / 4);
  const t0 = Date.now();

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 120s — Qwen can be slower
    res = await fetch(QWEN_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _logLLM(model, 0, Date.now() - t0, inputTokenEstimate, true, msg);
    // Fall back to DeepSeek V4-Flash on network error
    return callDeepSeekV3(messages, opts);
  }

  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _logLLM(model, res.status, elapsed, inputTokenEstimate, true, errText.slice(0, 200));
    // Fall back to DeepSeek V4-Flash on API error
    return callDeepSeekV3(messages, opts);
  }

  _logLLM(model, 200, elapsed, inputTokenEstimate, false);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) {
    // Fall back on empty response
    return callDeepSeekV3(messages, opts);
  }
  return text;
}

/**
 * Call GLM-5.1 — agentic planning and review model.
 *
 * SOTA for agentic tasks (SWE-Bench Pro 58.4, Terminal-Bench 63.5).
 * $0.95/$3.15 per 1M tokens via OpenRouter. Falls back to Qwen 3.6 Plus,
 * then DeepSeek V4-Flash if neither key is set.
 *
 * Use for: research planning, fact-checking, scientific review, diligence.
 */
export async function callGLM51(
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {},
): Promise<string> {
  const apiKey = getEnvVar("OPENROUTER_API_KEY");
  if (!apiKey) {
    // Fall back to Qwen 3.6 Plus (which itself falls back to DeepSeek V4-Flash)
    return callQwen36Plus(messages, opts);
  }

  const model = GLM_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 8000,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const requestBody = JSON.stringify(body);
  const inputTokenEstimate = Math.round(requestBody.length / 4);
  const t0 = Date.now();

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    res = await fetch(GLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _logLLM(model, 0, Date.now() - t0, inputTokenEstimate, true, msg);
    // Fall back to Qwen → DeepSeek
    return callQwen36Plus(messages, opts);
  }

  const elapsed = Date.now() - t0;

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    _logLLM(model, res.status, elapsed, inputTokenEstimate, true, errText.slice(0, 200));
    return callQwen36Plus(messages, opts);
  }

  _logLLM(model, 200, elapsed, inputTokenEstimate, false);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) {
    return callQwen36Plus(messages, opts);
  }
  return text;
}

/**
 * Call Gemini Flash — legacy opt-in vision fallback.
 *
 * Retained for: PDF narrative generation, vision extraction, and any
 * multi-modal tasks. NOT used for primary text reasoning (use callDeepSeekV3).
 */
export async function callGeminiFlash(
  messages: Array<{ role: string; content: string }>,
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; model?: string } = {},
): Promise<string> {
  const apiKey = getEnvVar("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set — required for Gemini Flash");

  // Convert OpenAI message format to Gemini format
  const systemParts = messages.filter(m => m.role === "system").map(m => ({ text: m.content }));
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxTokens ?? 8000,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: systemParts };
  }

  const requestBody = JSON.stringify(body);
  const inputTokenEstimate = Math.round(requestBody.length / 4);
  let lastError: Error | null = null;
  const candidates = geminiModelCandidates(opts.model || GEMINI_FLASH_MODEL);

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const t0 = Date.now();
    let res: Response;
    try {
      const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _logLLM(model, 0, Date.now() - t0, inputTokenEstimate, index > 0, msg);
      lastError = new Error(`Gemini Flash network error: ${msg}`);
      continue;
    }

    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      _logLLM(model, res.status, elapsed, inputTokenEstimate, index > 0, errText.slice(0, 200));
      lastError = new Error(`Gemini Flash API error (${res.status}): ${errText.slice(0, 200)}`);
      if (index < candidates.length - 1 && geminiShouldTryFallback(res.status)) continue;
      throw lastError;
    }

    _logLLM(model, 200, elapsed, inputTokenEstimate, index > 0);
    const data = await res.json();

    // Gemini thinking models may return multiple parts — skip thought parts.
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      lastError = new Error("Gemini Flash returned empty response");
      continue;
    }

    let text: string | undefined;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (!parts[i].thought && parts[i].text) {
        text = parts[i].text;
        break;
      }
    }
    if (text) return text;
    lastError = new Error("Gemini Flash returned no text content");
  }

  throw lastError || new Error("Gemini Flash returned no usable response");
}

export function geminiVisionConfigured(): boolean {
  return Boolean(getEnvVar("GEMINI_API_KEY"));
}

function geminiResponseText(data: Record<string, unknown>): string {
  const parts = (data as any)?.candidates?.[0]?.content?.parts;
  if (!parts || !Array.isArray(parts) || parts.length === 0) {
    throw new Error("Gemini Flash returned empty response");
  }

  const chunks: string[] = [];
  for (const part of parts) {
    if (part && !part.thought && typeof part.text === "string" && part.text.trim()) {
      chunks.push(part.text);
    }
  }
  if (chunks.length === 0) throw new Error("Gemini Flash returned no text content");
  return chunks.join("\n").trim();
}

/**
 * Extract PDF contents with Gemini Flash vision.
 *
 * This is intentionally a document-understanding helper, not the main agent
 * brain. The caller should cache the returned Markdown beside the PDF and let
 * DeepSeek consume that grounded text in the normal routing/workspace path.
 */
export async function callGeminiPdfVision(
  pdfPath: string,
  prompt: string,
  opts: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    mimeType?: string;
    systemInstruction?: string;
  } = {},
): Promise<{ text: string; model: string; bytes: number }> {
  const apiKey = getEnvVar("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set — required for Gemini PDF vision");

  const bytes = await readFile(pdfPath);
  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: opts.mimeType || "application/pdf",
              data: bytes.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      maxOutputTokens: opts.maxTokens ?? 12000,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const requestBody = JSON.stringify(body);
  const inputTokenEstimate = Math.round(requestBody.length / 4);
  let lastError: Error | null = null;
  const candidates = geminiModelCandidates(opts.model || GEMINI_VISION_MODEL);

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const t0 = Date.now();
    let res: Response;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
      const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      _logLLM(model, 0, Date.now() - t0, inputTokenEstimate, index > 0, msg);
      lastError = new Error(`Gemini PDF vision network error: ${msg}`);
      continue;
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const elapsed = Date.now() - t0;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      _logLLM(model, res.status, elapsed, inputTokenEstimate, index > 0, errText.slice(0, 200));
      lastError = new Error(`Gemini PDF vision API error (${res.status}): ${errText.slice(0, 200)}`);
      if (index < candidates.length - 1 && geminiShouldTryFallback(res.status)) continue;
      throw lastError;
    }

    _logLLM(model, 200, elapsed, inputTokenEstimate, index > 0);
    const data = await res.json();
    return { text: geminiResponseText(data), model, bytes: bytes.length };
  }

  throw lastError || new Error("Gemini PDF vision returned no usable response");
}

/** @deprecated Use callDeepSeekV3 for text reasoning. */
export const callGemma4 = callDeepSeekV3;

// ── Job management ──────────────────────────────────────────────────────

export async function ensureJobsDir(): Promise<void> {
  if (!existsSync(JOBS_DIR)) {
    await mkdir(JOBS_DIR, { recursive: true });
  }
}

async function ensureWorkspaceBriefsDir(): Promise<void> {
  if (!existsSync(WORKSPACE_BRIEFS_DIR)) {
    await mkdir(WORKSPACE_BRIEFS_DIR, { recursive: true });
  }
}

export async function createJob(
  type: JobType,
  productArea: ProductArea,
  domain: "battery" | "pv" | "general",
  config: Record<string, unknown>,
  genealogy?: { source_brief_id?: string; derived_from_action?: string }
): Promise<Job> {
  await ensureJobsDir();
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    type,
    product_area: productArea,
    status: "queued",
    domain,
    config,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    error: null,
    result_id: null,
    source_brief_id: genealogy?.source_brief_id,
    derived_from_action: genealogy?.derived_from_action,
  };
  await writeFile(
    join(JOBS_DIR, `${id}.json`),
    JSON.stringify(job, null, 2) + "\n"
  );
  return job;
}

export async function updateJob(
  id: string,
  updates: Partial<Job>
): Promise<Job> {
  const path = join(JOBS_DIR, `${id}.json`);
  const job: Job = JSON.parse(await readFile(path, "utf-8"));
  const updated = { ...job, ...updates };
  await writeFile(path, JSON.stringify(updated, null, 2) + "\n");
  return updated;
}

export async function getJob(id: string): Promise<Job | null> {
  const path = join(JOBS_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8"));
}

export async function listJobs(): Promise<Job[]> {
  await ensureJobsDir();
  const files = await readdir(JOBS_DIR);
  const jobs: Job[] = [];
  for (const f of files) {
    if (f.startsWith("job_") && f.endsWith(".json")) {
      try {
        const data = await readFile(join(JOBS_DIR, f), "utf-8");
        jobs.push(JSON.parse(data));
      } catch {
        // Skip malformed job files
      }
    }
  }
  // Sort newest first
  jobs.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return jobs;
}

// ── Job execution (spawn Python CLI or AI workflow) ─────────────────────

function buildCommand(job: Job): { args: string[]; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: REPO_ROOT,
  };

  // Load .env vars if present
  const envPath = join(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    try {
      const envContent = require("fs").readFileSync(envPath, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip surrounding quotes
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            env[key] = val;
          }
        }
      }
    } catch {
      // .env parse failure — continue with process env
    }
  }

  const seed = job.config.seed as number | undefined;
  const mockSidecar = job.config.mock_sidecar as boolean | undefined;

  switch (job.type) {
    case "battery_benchmark": {
      const args = ["-m", "breakthrough_engine", "battery", "benchmark"];
      if (seed !== undefined) args.push("--seed", String(seed));
      if (mockSidecar) args.push("--mock-sidecar");
      return { args, env };
    }
    case "pv_benchmark": {
      const args = ["-m", "breakthrough_engine", "pv", "benchmark"];
      if (seed !== undefined) args.push("--seed", String(seed));
      return { args, env };
    }
    default:
      return { args: ["--version"], env };
  }
}

export async function executeJob(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;

  // Research and diligence jobs use AI workflow, not Python CLI
  if (job.type === "research") {
    return executeResearchJob(jobId, job);
  }
  if (job.type === "diligence") {
    return executeDiligenceJob(jobId, job);
  }

  await updateJob(jobId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  const { args, env } = buildCommand(job);

  return new Promise<void>((resolve) => {
    const proc = spawn(PYTHON, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", async (code) => {
      if (code === 0) {
        await updateJob(jobId, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
        await addNotebookEntry("job_completed", `${job.type} completed successfully`, {
          linked_job_id: jobId,
          metadata: { domain: job.domain, type: job.type },
        });
        // Post-processing: generate decision brief from battery benchmark
        if (job.type === "battery_benchmark") {
          try {
            await generateBriefFromBenchmark(job);
          } catch {
            // Non-critical: brief generation failure doesn't fail the job
          }
        }
      } else {
        await updateJob(jobId, {
          status: "failed",
          completed_at: new Date().toISOString(),
          error: stderr || `Process exited with code ${code}`,
        });
        await addNotebookEntry("job_failed", `${job.type} failed: ${(stderr || "unknown error").slice(0, 100)}`, {
          linked_job_id: jobId,
          metadata: { domain: job.domain, type: job.type },
        });
      }
      // Save output log
      try {
        await writeFile(
          join(JOBS_DIR, `${jobId}_output.log`),
          `=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}\n`
        );
      } catch {
        // Non-critical
      }
      resolve();
    });

    proc.on("error", async (err) => {
      await updateJob(jobId, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error: `Spawn error: ${err.message}`,
      });
      resolve();
    });
  });
}

// ── Research job execution ──────────────────────────────────────────────

async function executeResearchJob(jobId: string, job: Job): Promise<void> {
  await updateJob(jobId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  const topic = (job.config.topic as string) || "general energy research";
  const domain = (job.config.domain as string) || "general";

  const apiKey =
    getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY");
  if (!apiKey) {
    await updateJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error:
        "AI service not configured. Set DEEPSEEK_API_KEY in workspace/.env.local",
    });
    return;
  }

  try {
    // Gather grounding context from existing briefs
    const context = await buildGroundingContext(domain);

    // CC-BE-C202: Build genealogy context from source brief lineage
    const ancestors = await buildGenealogyChain(job.source_brief_id);
    const genealogyContext = formatGenealogyContext(ancestors);

    const systemPrompt = `You are the Exergy Lab research analyst — a specialist in energy technology assessment.
You produce structured research briefs grounded in real data and physics.

RULES:
- Base analysis on the provided context data when available.
- If lineage context is provided, acknowledge what prior analysis found and build on it.
- If evidence is weak or unavailable, say so explicitly.
- Generate 3-5 promising research directions with honest confidence levels.
- Generate 1-3 rejected or unpromising directions with clear reasons.
- Be specific about what makes each direction promising or not.
- Recommend a concrete next action.
- Rate overall evidence quality honestly.
- Include caveats about limitations of the analysis.

CONFIDENCE ASSIGNMENT:
- "high" = 3+ consistent published sources from 2020+, quantitative data available
- "medium" = 1-2 sources or older data, some quantitative support
- "low" = theoretical basis only, no published experimental validation

PARAMETER EXTRACTION:
When you identify quantitative performance data in your analysis, extract it as structured parameters that could feed into an evaluation. For each finding, note the specific metric, value, unit, and source. This helps downstream evaluation tools use your research.

PHYSICS CONTEXT:
The platform has physics solvers for 107 energy domains across 12 solver families (VCC/heat pumps, thermal cycles, electrochemical, reactors, grid, motors, heat exchangers, thermal storage, PV, structural materials, thermoelectric, system energy balance). When analyzing a technology, consider what physics validation is available and recommend running physics_simulation for specific claims.

OUTPUT FORMAT: Respond with valid JSON matching this exact schema:
{
  "headline": "one-line summary of findings",
  "summary": "2-3 sentence overview",
  "promising_directions": [
    {"title": "...", "description": "...", "confidence": "high|medium|low", "rationale": "..."}
  ],
  "rejected_directions": [
    {"title": "...", "description": "...", "reason": "..."}
  ],
  "recommended_next": "specific next action",
  "evidence_quality": "strong|moderate|weak|insufficient",
  "caveats": ["caveat 1", "caveat 2"],
  "grounding_sources": ["source description 1"]
}

Respond ONLY with the JSON object. No markdown, no code fences.`;

    const lineageSection = genealogyContext
      ? `\n\n${genealogyContext}\n\nThis research was triggered by the above prior analysis. Build on what was found and extend the investigation.`
      : "";

    const userPrompt = `Research topic: ${topic}
Domain focus: ${domain}

${context}${lineageSection}

Generate a structured research brief for this topic. Be honest about confidence levels and evidence quality.`;

    // Research synthesis → Qwen 3.6 Plus (best reasoning), falls back to DeepSeek V4-Flash
    const rawContent = await callQwen36Plus(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.25, maxTokens: 4096, jsonMode: true },
    );
    const parsed = parseJsonResponse(rawContent);

    const briefId = `research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const brief: ResearchBrief = {
      id: briefId,
      brief_type: "research",
      created_at: new Date().toISOString(),
      topic,
      domain,
      headline: parsed.headline || "Research analysis complete",
      summary: parsed.summary || "",
      promising_directions: parsed.promising_directions || [],
      rejected_directions: parsed.rejected_directions || [],
      recommended_next: parsed.recommended_next || "",
      evidence_quality: parsed.evidence_quality || "insufficient",
      caveats: parsed.caveats || [],
      grounding_sources: parsed.grounding_sources || [],
      raw_analysis: rawContent,
      review_state: "awaiting_review",
      review_notes: "",
    };

    // Add genealogy from job if present + ancestor chain for traceability
    const briefWithLineage: Record<string, unknown> = { ...brief };
    if (job.source_brief_id) briefWithLineage.source_brief_id = job.source_brief_id;
    if (job.derived_from_action) briefWithLineage.derived_from_action = job.derived_from_action;
    if (ancestors.length > 0) {
      briefWithLineage.lineage_chain = ancestors.map((a) => ({
        id: a.id, title: a.title, family: a.family, hop: a.hop,
      }));
      briefWithLineage.lineage_note = `Built on prior ${ancestors[0].brief_type}: ${ancestors[0].title}`;
    }

    await ensureWorkspaceBriefsDir();
    await writeFile(
      join(WORKSPACE_BRIEFS_DIR, `brief_${briefId}.json`),
      JSON.stringify(briefWithLineage, null, 2) + "\n"
    );

    await addNotebookEntry("brief_created", `Research brief: ${brief.headline}`, {
      linked_job_id: jobId,
      linked_brief_id: briefId,
      metadata: { topic, domain, evidence_quality: brief.evidence_quality },
    });

    await updateJob(jobId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      result_id: briefId,
    });
  } catch (err) {
    await updateJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Research job failed",
    });
    await addNotebookEntry("job_failed", `Research job failed: ${err instanceof Error ? err.message : "unknown"}`, {
      linked_job_id: jobId,
    });
  }
}

// ── Diligence job execution ─────────────────────────────────────────────

async function executeDiligenceJob(jobId: string, job: Job): Promise<void> {
  await updateJob(jobId, {
    status: "running",
    started_at: new Date().toISOString(),
  });

  const subject = (job.config.subject as string) || "energy technology";
  const focusAreas = (job.config.focus_areas as string[]) || [];
  const additionalContext = (job.config.additional_context as string) || "";

  const apiKey =
    getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY");
  if (!apiKey) {
    await updateJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error:
        "AI service not configured. Set DEEPSEEK_API_KEY in workspace/.env.local",
    });
    return;
  }

  try {
    const context = await buildGroundingContext("general");

    // CC-BE-C202: Build genealogy context from source brief lineage
    const ancestors = await buildGenealogyChain(job.source_brief_id);
    const genealogyContext = formatGenealogyContext(ancestors);

    const systemPrompt = `You are the Exergy Lab due diligence analyst — a specialist in energy technology investment assessment.
You produce structured diligence briefs that help founders, investors, and engineers make deployment decisions.

RULES:
- If technical validation data exists in the context, reference it explicitly with specific metrics.
- If lineage context is provided, acknowledge what prior analysis found and assess it critically.
  - If ancestor confidence is "high", treat prior findings as strong signals to build on.
  - If ancestor confidence is "uncertain" or "weak", note that this assessment rebuilds the analysis.
- Honestly assess what can and cannot be determined from available evidence.
- Identify strongest signals (positive, negative, or neutral) with supporting rationale.
- Identify risks with severity ratings using this framework:
  - "high" = affects >50% of deployment scenarios OR could cause project failure
  - "medium" = affects specific scenarios OR requires mitigation before deployment
  - "low" = manageable with standard engineering practice
- List open questions that need further investigation.
- Provide a structured recommendation: proceed | proceed_with_conditions | wait_for_data | do_not_proceed
- Include a confidence note explaining the basis and limitations of the assessment.

PHYSICS CONTEXT:
Physics evaluations surface through one of a fixed public vocabulary, and you MUST mirror that vocabulary exactly — never invent solver-family counts, domain counts, credibility tiers, or "C0/C1/C2/C3" / "IRIS-N" labels in user-facing text.

- "calibrated simulation" — a solver ran and concordance was confirmed. Reference these findings as strong technical evidence.
- "engineering estimate"  — a solver ran with partial / caveat concordance, or a mock/demo validation was used. Reference these findings as directional and explain which inputs would strengthen the result.
- "not computed"          — no solver backing available. Treat the result as unverified.
- "blocked"               — hard_fail, promotion_blocked, or a solver veto fired. Do NOT use positive readiness language for blocked results.
- "unavailable"           — the platform has no applicable physics path for this technology. Say so plainly rather than implying coverage.

If the context does not mark a result with one of these labels, assume "not computed" — do not infer solver coverage. Do not claim universal solver coverage or reference internal tier codes in prose.

COMPETITIVE LANDSCAPE:
When competitive data is not directly available, you should:
1. Identify the technology class and its main competitors from your knowledge
2. State clearly which competitive claims are from your training data vs from the provided context
3. Flag any competitive comparisons as "requires independent verification"

OUTPUT FORMAT: Respond with valid JSON matching this exact schema:
{
  "headline": "one-line assessment summary",
  "summary": "2-3 sentence overview",
  "strongest_signals": [
    {"title": "...", "description": "...", "signal_type": "positive|negative|neutral"}
  ],
  "risks": [
    {"title": "...", "description": "...", "severity": "high|medium|low"}
  ],
  "open_questions": ["question 1", "question 2"],
  "recommendation": "specific recommendation",
  "confidence_note": "explanation of assessment confidence and limitations",
  "caveats": ["caveat 1"],
  "grounding_sources": ["source description 1"]
}

Respond ONLY with the JSON object. No markdown, no code fences.`;

    const focusStr = focusAreas.length > 0 ? focusAreas.join(", ") : "general assessment";
    const diligenceLineage = genealogyContext
      ? `\n\n${genealogyContext}\n\nThis diligence assessment follows from the above prior analysis. Critically evaluate the prior findings.`
      : "";

    const userPrompt = `Due diligence subject: ${subject}
Focus areas: ${focusStr}
${additionalContext ? `Additional context: ${additionalContext}` : ""}

${context}${diligenceLineage}

Generate a structured diligence brief. Be honest about confidence levels and what cannot be assessed with available data.`;

    // Due diligence → GLM-5.1 (agentic SOTA for assessment/planning), falls back to Qwen → DeepSeek V4-Flash
    const rawContent = await callGLM51(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.3, maxTokens: 6000, jsonMode: true },
    );
    const parsed = parseJsonResponse(rawContent);

    const briefId = `diligence_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const brief: DiligenceBrief = {
      id: briefId,
      brief_type: "diligence",
      created_at: new Date().toISOString(),
      subject,
      focus_areas: focusAreas,
      headline: parsed.headline || "Diligence assessment complete",
      summary: parsed.summary || "",
      strongest_signals: parsed.strongest_signals || [],
      risks: parsed.risks || [],
      open_questions: parsed.open_questions || [],
      recommendation: parsed.recommendation || "",
      confidence_note: parsed.confidence_note || "",
      caveats: parsed.caveats || [],
      grounding_sources: parsed.grounding_sources || [],
      raw_analysis: rawContent,
      review_state: "awaiting_review",
      review_notes: "",
    };

    // Add genealogy from job if present + ancestor chain for traceability
    const briefWithLineage: Record<string, unknown> = { ...brief };
    if (job.source_brief_id) briefWithLineage.source_brief_id = job.source_brief_id;
    if (job.derived_from_action) briefWithLineage.derived_from_action = job.derived_from_action;
    if (ancestors.length > 0) {
      briefWithLineage.lineage_chain = ancestors.map((a) => ({
        id: a.id, title: a.title, family: a.family, hop: a.hop,
      }));
      briefWithLineage.lineage_note = `Built on prior ${ancestors[0].brief_type}: ${ancestors[0].title}`;
    }

    await ensureWorkspaceBriefsDir();
    await writeFile(
      join(WORKSPACE_BRIEFS_DIR, `brief_${briefId}.json`),
      JSON.stringify(briefWithLineage, null, 2) + "\n"
    );

    await addNotebookEntry("brief_created", `Diligence brief: ${brief.headline}`, {
      linked_job_id: jobId,
      linked_brief_id: briefId,
      metadata: { subject, focus_areas: focusAreas },
    });

    await updateJob(jobId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      result_id: briefId,
    });
  } catch (err) {
    await updateJob(jobId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Diligence job failed",
    });
    await addNotebookEntry("job_failed", `Diligence job failed: ${err instanceof Error ? err.message : "unknown"}`, {
      linked_job_id: jobId,
    });
  }
}

// ── AI grounding context ────────────────────────────────────────────────

async function buildGroundingContext(domain: string): Promise<string> {
  const briefs = await listDecisionBriefs();
  if (briefs.length === 0) {
    return "AVAILABLE ENGINE DATA: No decision briefs or benchmark results available yet.";
  }

  const relevantBriefs = domain === "general"
    ? briefs.slice(0, 5)
    : briefs.filter((b) => {
        const bt = b.brief_type ?? "decision";
        if (bt === "decision") return domain === "battery" || domain === "pv";
        return true;
      }).slice(0, 5);

  if (relevantBriefs.length === 0) {
    return `AVAILABLE ENGINE DATA: No ${domain}-relevant results available.`;
  }

  const summaries = relevantBriefs.map((b) => {
    return `- ${b.title || b.headline}: Score ${b.final_score}, Family: ${b.candidate_family}, Confidence: ${b.confidence_tier}, Caveats: ${(b.caveats as string[])?.join("; ") || "none"}`;
  });

  return `AVAILABLE ENGINE DATA (${briefs.length} total decision briefs, showing ${summaries.length} relevant):
${summaries.join("\n")}`;
}

// ── JSON response parsing ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonResponse(content: string): any {
  // Try direct parse first
  try {
    return JSON.parse(content);
  } catch {
    // Try extracting JSON from markdown code fences
    const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch {
        // Fall through
      }
    }
    // Try finding first { ... } block
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        // Fall through
      }
    }
    return {};
  }
}

// ── Post-job processing ─────────────────────────────────────────────────

async function generateBriefFromBenchmark(job: Job): Promise<void> {
  const seed = job.config.seed ?? 42;
  const reportPath = join(LOOP_DIR, `battery_benchmark_${seed}.json`);
  if (!existsSync(reportPath)) return;

  // Call Python to generate and save the decision brief
  const script = `
import json, sys
sys.path.insert(0, "${REPO_ROOT}")
from breakthrough_engine.battery_decision_brief import generate_decision_brief, save_decision_brief
with open("${reportPath.replace(/\\/g, "/")}") as f:
    report = json.load(f)
brief = generate_decision_brief(report)
if brief:
    path = save_decision_brief(brief)
    print(f"Brief saved: {path}")
else:
    print("No candidate promoted — no brief generated")
`;

  return new Promise<void>((resolve) => {
    const proc = spawn(PYTHON, ["-c", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}

// ── Brief/artifact reading ──────────────────────────────────────────────

/** List decision briefs from all domain brief directories.
 *
 * Battery / PV / Inverter briefs use the `brief_<id>.json` filename
 * pattern. PtL briefs (schema `ptl_decision_brief_v1`) use `<id>.json`
 * directly — see ``breakthrough_engine.ptl.decision_brief.save_ptl_brief``.
 * Both patterns are scanned here and deduped by id.
 */
export async function listDecisionBriefs(): Promise<Record<string, unknown>[]> {
  const briefs: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const scan = async (dir: string, ptlStyle: boolean) => {
    if (!existsSync(dir)) return;
    const files = await readdir(dir);
    for (const f of files) {
      const fileMatches = ptlStyle
        ? f.endsWith(".json")
        : f.startsWith("brief_") && f.endsWith(".json") && !f.includes("review");
      if (!fileMatches) continue;
      try {
        const data = await readFile(join(dir, f), "utf-8");
        const brief = JSON.parse(data);
        const briefId = brief.id as string;
        if (!briefId || seen.has(briefId)) continue;
        seen.add(briefId);
        if (!brief.brief_type) {
          brief.brief_type = ptlStyle ? "ptl_decision" : "decision";
        }
        briefs.push(brief);
      } catch {
        // Skip malformed
      }
    }
  };

  for (const dir of [BRIEFS_DIR, EXPORTS_DIR, PV_BRIEFS_DIR, INVERTER_BRIEFS_DIR]) {
    await scan(dir, false);
  }
  await scan(PTL_BRIEFS_DIR, true);

  briefs.sort((a, b) => {
    const ta = new Date(a.created_at as string).getTime();
    const tb = new Date(b.created_at as string).getTime();
    return tb - ta;
  });
  return briefs;
}

/** List research and diligence briefs from workspace_briefs/. */
export async function listWorkspaceBriefs(): Promise<Record<string, unknown>[]> {
  const briefs: Record<string, unknown>[] = [];
  if (!existsSync(WORKSPACE_BRIEFS_DIR)) return briefs;

  const files = await readdir(WORKSPACE_BRIEFS_DIR);
  for (const f of files) {
    if (f.startsWith("brief_") && f.endsWith(".json")) {
      try {
        const data = await readFile(join(WORKSPACE_BRIEFS_DIR, f), "utf-8");
        briefs.push(JSON.parse(data));
      } catch {
        // Skip malformed
      }
    }
  }

  briefs.sort((a, b) => {
    const ta = new Date(a.created_at as string).getTime();
    const tb = new Date(b.created_at as string).getTime();
    return tb - ta;
  });
  return briefs;
}

/** List all briefs across all types, sorted by creation date. */
export async function listAllBriefs(): Promise<Record<string, unknown>[]> {
  const [decision, workspace] = await Promise.all([
    listDecisionBriefs(),
    listWorkspaceBriefs(),
  ]);
  const all = [...decision, ...workspace];
  all.sort((a, b) => {
    const ta = new Date(a.created_at as string).getTime();
    const tb = new Date(b.created_at as string).getTime();
    return tb - ta;
  });
  return all;
}

/** Legacy alias for backward compatibility */
export const listBriefs = listDecisionBriefs;

export async function getBrief(
  briefId: string
): Promise<Record<string, unknown> | null> {
  // Check domain brief directories using the legacy `brief_<id>.json` pattern
  for (const dir of [BRIEFS_DIR, PV_BRIEFS_DIR, INVERTER_BRIEFS_DIR, WORKSPACE_BRIEFS_DIR]) {
    const p = join(dir, `brief_${briefId}.json`);
    if (existsSync(p)) {
      return JSON.parse(await readFile(p, "utf-8"));
    }
  }
  // PtL briefs use `<id>.json` directly (no `brief_` prefix)
  const ptlPath = join(PTL_BRIEFS_DIR, `${briefId}.json`);
  if (existsSync(ptlPath)) {
    return JSON.parse(await readFile(ptlPath, "utf-8"));
  }
  return null;
}

// ── CC-BE-C201: Genealogy-aware brief context builder ──────────────────

/** Compact ancestor summary for genealogy context. */
export interface AncestorSummary {
  id: string;
  brief_type: string;
  title: string;
  family: string;
  domain: string;
  score: number | null;
  confidence: string;
  recommendation: string;
  key_caveats: string[];
  derived_from_action: string;
  hop: number; // 0 = direct parent, 1 = grandparent, etc.
}

/**
 * Build genealogy context by traversing source_brief_id chain.
 * Cycle-safe, bounded to maxHops (default 3).
 * Returns empty array when no genealogy exists.
 */
export async function buildGenealogyChain(
  sourceBriefId: string | undefined,
  maxHops: number = 3,
): Promise<AncestorSummary[]> {
  if (!sourceBriefId) return [];

  const ancestors: AncestorSummary[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = sourceBriefId;

  for (let hop = 0; hop < maxHops && currentId; hop++) {
    if (visited.has(currentId)) break; // cycle guard
    visited.add(currentId);

    const brief = await getBrief(currentId);
    if (!brief) break; // missing link — stop traversal

    ancestors.push({
      id: currentId,
      brief_type: (brief.brief_type as string) || "decision",
      title: (brief.title as string) || (brief.headline as string) || "",
      family: (brief.candidate_family as string) || "",
      domain: (brief.domain as string) || "battery",
      score: typeof brief.final_score === "number" ? brief.final_score : null,
      confidence: (brief.confidence_tier as string) || "",
      recommendation: (brief.recommended_action as string) || (brief.recommended_next as string) || "",
      key_caveats: Array.isArray(brief.caveats)
        ? (brief.caveats as string[]).slice(0, 3)
        : [],
      derived_from_action: (brief.derived_from_action as string) || "",
      hop,
    });

    // Follow the chain
    currentId = brief.source_brief_id as string | undefined;
  }

  return ancestors;
}

/**
 * Format genealogy chain into a compact text block for AI prompt grounding.
 * Returns empty string when no ancestors exist.
 */
export function formatGenealogyContext(ancestors: AncestorSummary[]): string {
  if (ancestors.length === 0) return "";

  const lines = ancestors.map((a) => {
    const scorePart = a.score !== null ? `, Score: ${a.score}` : "";
    const caveatPart = a.key_caveats.length > 0
      ? `, Caveats: ${a.key_caveats.join("; ")}`
      : "";
    const derivedPart = a.derived_from_action
      ? ` (via ${a.derived_from_action})`
      : "";
    return `  [Hop ${a.hop}${derivedPart}] ${a.title} — Family: ${a.family}${scorePart}, Confidence: ${a.confidence}${caveatPart}`;
  });

  return `LINEAGE CONTEXT (${ancestors.length} ancestor${ancestors.length > 1 ? "s" : ""}):\n${lines.join("\n")}`;
}

export async function listArtifacts(): Promise<
  Array<{ name: string; path: string; size: number; modified_at: string }>
> {
  const artifacts: Array<{
    name: string;
    path: string;
    size: number;
    modified_at: string;
  }> = [];

  const dirs = [BRIEFS_DIR, EXPORTS_DIR, EVAL_DIR, LOOP_DIR, PV_LOOP_DIR, PV_BRIEFS_DIR, INVERTER_BRIEFS_DIR, INVERTER_LOOP_DIR, WORKSPACE_BRIEFS_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = await readdir(dir);
    for (const f of files) {
      if (f.endsWith(".json")) {
        try {
          const fpath = join(dir, f);
          const s = await stat(fpath);
          artifacts.push({
            name: f,
            path: fpath,
            size: s.size,
            modified_at: s.mtime.toISOString(),
          });
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }

  artifacts.sort(
    (a, b) =>
      new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  );
  return artifacts;
}

// ── Brief review state updates ──────────────────────────────────────────

export async function updateBriefReview(
  briefId: string,
  reviewState: ReviewState,
  reviewNotes: string
): Promise<Record<string, unknown> | null> {
  // Try workspace briefs first (research/diligence)
  const wsPath = join(WORKSPACE_BRIEFS_DIR, `brief_${briefId}.json`);
  if (existsSync(wsPath)) {
    const brief = JSON.parse(await readFile(wsPath, "utf-8"));
    brief.review_state = reviewState;
    brief.review_notes = reviewNotes;
    await writeFile(wsPath, JSON.stringify(brief, null, 2) + "\n");
    return brief;
  }

  // For decision briefs, write a sidecar review file (don't modify Python-generated briefs)
  const batteryPath = join(BRIEFS_DIR, `brief_${briefId}.json`);
  if (existsSync(batteryPath)) {
    const brief = JSON.parse(await readFile(batteryPath, "utf-8"));
    brief.review_state = reviewState;
    brief.review_notes = reviewNotes;
    // Write updated brief back (decision briefs already have review_state)
    await writeFile(batteryPath, JSON.stringify(brief, null, 2) + "\n");
    return brief;
  }

  return null;
}

// ── Job log reading ─────────────────────────────────────────────────────

export async function getJobLog(jobId: string): Promise<string | null> {
  const logPath = join(JOBS_DIR, `${jobId}_output.log`);
  if (!existsSync(logPath)) return null;
  return readFile(logPath, "utf-8");
}

export async function readArtifact(
  artifactPath: string
): Promise<string | null> {
  // Security: only allow reading from runtime/ directory
  const resolved = require("path").resolve(artifactPath);
  if (!resolved.startsWith(RUNTIME_DIR)) return null;
  if (!existsSync(resolved)) return null;
  return readFile(resolved, "utf-8");
}

// ── Corpus summary ──────────────────────────────────────────────────────

export async function getCorpusSummary(): Promise<Record<string, unknown>> {
  const briefs = await listDecisionBriefs();

  const domainCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  const scores: number[] = [];
  const recentFamilies: string[] = [];

  for (const b of briefs) {
    const domain = (b.domain as string) || (b.benchmark_domain as string) || "battery";
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;

    const family = (b.candidate_family as string) || "unknown";
    familyCounts[family] = (familyCounts[family] || 0) + 1;

    if (typeof b.final_score === "number") scores.push(b.final_score);
  }

  // Recent top families (from last 10 briefs)
  for (const b of briefs.slice(0, 10)) {
    const family = (b.candidate_family as string);
    if (family && !recentFamilies.includes(family)) {
      recentFamilies.push(family);
    }
  }

  const topFamilies = Object.entries(familyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    total_briefs: briefs.length,
    domain_breakdown: domainCounts,
    top_families: topFamilies,
    recent_families: recentFamilies.slice(0, 5),
    score_range: scores.length > 0
      ? { min: Math.min(...scores), max: Math.max(...scores), mean: scores.reduce((a, b) => a + b, 0) / scores.length }
      : null,
  };
}

// ── Lab Notebook ────────────────────────────────────────────────────────

async function ensureNotebookDir(): Promise<void> {
  if (!existsSync(NOTEBOOK_DIR)) {
    await mkdir(NOTEBOOK_DIR, { recursive: true });
  }
}

export async function addNotebookEntry(
  type: NotebookEntryType,
  summary: string,
  opts?: {
    linked_job_id?: string;
    linked_brief_id?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<NotebookEntry> {
  await ensureNotebookDir();
  const id = `nb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const entry: NotebookEntry = {
    id,
    type,
    timestamp: new Date().toISOString(),
    summary,
    linked_job_id: opts?.linked_job_id,
    linked_brief_id: opts?.linked_brief_id,
    metadata: opts?.metadata,
  };
  await writeFile(
    join(NOTEBOOK_DIR, `${id}.json`),
    JSON.stringify(entry, null, 2) + "\n"
  );
  return entry;
}

export async function listNotebookEntries(limit = 30): Promise<NotebookEntry[]> {
  await ensureNotebookDir();
  const files = await readdir(NOTEBOOK_DIR);
  const entries: NotebookEntry[] = [];
  for (const f of files) {
    if (f.startsWith("nb_") && f.endsWith(".json")) {
      try {
        const data = await readFile(join(NOTEBOOK_DIR, f), "utf-8");
        entries.push(JSON.parse(data));
      } catch {
        // Skip malformed entries
      }
    }
  }
  entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return entries.slice(0, limit);
}

// ── Assistant Threads ───────────────────────────────────────────────────

async function ensureThreadsDir(): Promise<void> {
  if (!existsSync(THREADS_DIR)) {
    await mkdir(THREADS_DIR, { recursive: true });
  }
}

export async function createThread(opts: {
  title: string;
  page_context: string;
  linked_brief_ids?: string[];
  linked_job_ids?: string[];
  metadata?: Record<string, unknown>;
}): Promise<AssistantThread> {
  await ensureThreadsDir();
  const id = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const thread: AssistantThread = {
    id,
    title: opts.title,
    status: "active",
    created_at: now,
    updated_at: now,
    page_context: opts.page_context,
    linked_brief_ids: opts.linked_brief_ids || [],
    linked_job_ids: opts.linked_job_ids || [],
    messages: [],
    metadata: opts.metadata,
  };
  await writeFile(
    join(THREADS_DIR, `${id}.json`),
    JSON.stringify(thread, null, 2) + "\n"
  );
  return thread;
}

export async function getThread(threadId: string): Promise<AssistantThread | null> {
  await ensureThreadsDir();
  const path = join(THREADS_DIR, `${threadId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8"));
}

export async function appendThreadMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string
): Promise<AssistantThread | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;
  const msg: ThreadMessage = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  thread.messages.push(msg);
  thread.updated_at = new Date().toISOString();
  await writeFile(
    join(THREADS_DIR, `${threadId}.json`),
    JSON.stringify(thread, null, 2) + "\n"
  );
  return thread;
}

export async function updateThread(
  threadId: string,
  updates: Partial<Pick<AssistantThread, "title" | "status" | "linked_brief_ids" | "linked_job_ids" | "metadata">>
): Promise<AssistantThread | null> {
  const thread = await getThread(threadId);
  if (!thread) return null;
  if (updates.title !== undefined) thread.title = updates.title;
  if (updates.status !== undefined) thread.status = updates.status;
  if (updates.linked_brief_ids !== undefined) thread.linked_brief_ids = updates.linked_brief_ids;
  if (updates.linked_job_ids !== undefined) thread.linked_job_ids = updates.linked_job_ids;
  if (updates.metadata !== undefined) thread.metadata = updates.metadata;
  thread.updated_at = new Date().toISOString();
  await writeFile(
    join(THREADS_DIR, `${threadId}.json`),
    JSON.stringify(thread, null, 2) + "\n"
  );
  return thread;
}

export async function listThreads(
  status?: ThreadStatus,
  limit = 20
): Promise<AssistantThread[]> {
  await ensureThreadsDir();
  const files = await readdir(THREADS_DIR);
  const threads: AssistantThread[] = [];
  for (const f of files) {
    if (f.startsWith("thread_") && f.endsWith(".json")) {
      try {
        const data = await readFile(join(THREADS_DIR, f), "utf-8");
        const thread: AssistantThread = JSON.parse(data);
        if (!status || thread.status === status) {
          threads.push(thread);
        }
      } catch {
        // Skip malformed
      }
    }
  }
  threads.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  return threads.slice(0, limit);
}
