/**
 * Debug Log — in-memory event collector for diagnostic exports.
 *
 * Captures timestamped events across the entire pipeline:
 * - LLM calls (model, tokens, latency, rate limit fallbacks)
 * - Action execution (type, duration, success/failure)
 * - Evidence collection (per-document timing, extraction counts)
 * - Evaluation pipeline (domain, params, module verdicts, score)
 * - Errors and warnings
 *
 * Events accumulate in memory and are included in the JSON export.
 * This data is for debugging only — remove before launch.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";

export interface DebugEvent {
  ts: string;
  category: "llm" | "action" | "evidence" | "evaluation" | "rerun" | "pdf" | "error" | "warn" | "info";
  event: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
}

// Module-level accumulator — persists across requests within the same server process
const _events: DebugEvent[] = [];
const MAX_EVENTS = 500;
const DEBUG_LOG_PATH = process.env.EXERGY_DEBUG_LOG_PATH ||
  join(process.env.VERCEL ? "/tmp" : join(process.cwd(), "..", "runtime"), "debug-log.jsonl");

function readPersistedEvents(): DebugEvent[] {
  if (!existsSync(DEBUG_LOG_PATH)) return [];
  try {
    return readFileSync(DEBUG_LOG_PATH, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_EVENTS)
      .map((line) => JSON.parse(line) as DebugEvent)
      .filter((event) => event && typeof event.ts === "string" && typeof event.category === "string");
  } catch {
    return [];
  }
}

function appendPersistedEvent(entry: DebugEvent): void {
  try {
    mkdirSync(dirname(DEBUG_LOG_PATH), { recursive: true });
    appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch {
    // Debug logging must never affect product behavior.
  }
}

export function logDebug(
  category: DebugEvent["category"],
  event: string,
  details?: Record<string, unknown>,
  duration_ms?: number,
): void {
  const entry: DebugEvent = {
    ts: new Date().toISOString(),
    category,
    event,
    ...(duration_ms != null ? { duration_ms } : {}),
    ...(details ? { details } : {}),
  };
  _events.push(entry);
  // Cap size to prevent memory leak
  if (_events.length > MAX_EVENTS) {
    _events.splice(0, _events.length - MAX_EVENTS);
  }
  appendPersistedEvent(entry);
}

export function getDebugLog(): DebugEvent[] {
  const persisted = readPersistedEvents();
  if (persisted.length > 0) return persisted;
  return [..._events];
}

export function clearDebugLog(): void {
  _events.length = 0;
  try {
    if (existsSync(DEBUG_LOG_PATH)) unlinkSync(DEBUG_LOG_PATH);
  } catch {
    // Ignore cleanup failures.
  }
}

/** Summary stats from the debug log. */
export function getDebugSummary(): Record<string, unknown> {
  const events = getDebugLog();
  const llmCalls = events.filter(e => e.category === "llm");
  const actions = events.filter(e => e.category === "action");
  const errors = events.filter(e => e.category === "error");
  const fallbacks = llmCalls.filter(e => e.details?.fallback === true);

  return {
    total_events: events.length,
    llm_calls: llmCalls.length,
    llm_fallbacks_to_flash: fallbacks.length,
    llm_avg_latency_ms: llmCalls.length > 0
      ? Math.round(llmCalls.reduce((sum, e) => sum + (e.duration_ms || 0), 0) / llmCalls.length)
      : 0,
    actions_executed: actions.length,
    actions_failed: actions.filter(e => e.details?.success === false).length,
    errors: errors.length,
    first_event: events[0]?.ts || null,
    last_event: events[events.length - 1]?.ts || null,
  };
}
