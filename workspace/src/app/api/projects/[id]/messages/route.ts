/**
 * Messages API — persist chat messages per project.
 *
 * GET  /api/projects/[id]/messages → load saved messages
 * POST /api/projects/[id]/messages → save messages array
 *
 * Messages are stored as a JSON file alongside the project data.
 * This ensures conversation history survives page refreshes.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { resumeRunnableAgentRuns } from "@/lib/agent-run-queue";
import { sanitizeUserFacingAgentText } from "@/lib/agent-output";
import { getStorage } from "@/lib/storage";
import type { AgentEvent, AgentPlanStep, AgentRun } from "@/lib/storage/types";

const RUNTIME_DIR = join(process.cwd(), "..", "runtime");
const PROJECTS_DIR = join(RUNTIME_DIR, "projects");

function messagesPath(projectId: string): string {
  return join(PROJECTS_DIR, `proj_${projectId}`, "messages.json");
}

function latestProgress(events: AgentEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (
      event.type === "progress" ||
      event.type === "tool.started" ||
      event.type === "tool.completed" ||
      event.type === "plan.updated"
    ) {
      return event.message ? sanitizeUserFacingAgentText(event.message) : undefined;
    }
  }
  return undefined;
}

function userVisibleRunContent(run: AgentRun, events: AgentEvent[]): string {
  if (run.final_answer) return sanitizeUserFacingAgentText(run.final_answer);
  if (run.status === "waiting_approval") {
    return [...events].reverse().find((event) => event.type === "plan.created")?.message
      || "I drafted a plan and will wait for approval before running it.";
  }
  if (run.status === "failed") return sanitizeUserFacingAgentText(run.error || "The run failed.");
  if (run.status === "cancelled") return "Run cancelled.";
  return latestProgress(events) || "Reading the request and workspace context.";
}

async function messagesFromRuns(projectId: string): Promise<{
  messages: unknown[];
  history: Array<{ role: string; content: string }>;
}> {
  await resumeRunnableAgentRuns(projectId);
  const storage = getStorage();
  const runs = await storage.listAgentRuns(projectId);
  const messages: unknown[] = [];
  const history: Array<{ role: string; content: string }> = [];

  for (const run of runs) {
    const events = await storage.listAgentEvents(projectId, run.id);
    messages.push({
      id: `${run.id}_user`,
      role: "user",
      content: run.user_message,
      ts: run.created_at,
      runId: run.id,
    });
    history.push({ role: "user", content: run.user_message });

    const active = run.status === "queued" || run.status === "running";
    const plan = Array.isArray(run.plan)
      ? run.plan.map((step: AgentPlanStep) => ({ ...step }))
      : undefined;
    const content = userVisibleRunContent(run, events);
    messages.push({
      id: `${run.id}_assistant`,
      role: "assistant",
      content: active ? "" : content,
      ts: run.updated_at || run.created_at,
      runId: run.id,
      loading: active,
      loadingText: active ? latestProgress(events) : undefined,
      plan,
      followups: run.status === "completed"
        ? ["What data would improve confidence?", "Turn this into a client-ready memo", "Export this result"]
        : undefined,
    });
    if (run.final_answer) {
      history.push({ role: "assistant", content });
    }
  }
  return { messages, history: history.slice(-50) };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = messagesPath(id);

  try {
    const rendered = await messagesFromRuns(id);
    if (rendered.messages.length > 0) {
      return NextResponse.json(rendered);
    }
    if (!existsSync(path)) {
      return NextResponse.json({ messages: [], history: [] });
    }
    const data = JSON.parse(await readFile(path, "utf-8"));
    const messages = Array.isArray(data.messages)
      ? data.messages.map((message: any) => (
        message?.role === "assistant" && typeof message.content === "string"
          ? { ...message, content: sanitizeUserFacingAgentText(message.content) }
          : message
      ))
      : [];
    const history = Array.isArray(data.history)
      ? data.history.map((entry: any) => (
        entry?.role === "assistant" && typeof entry.content === "string"
          ? { ...entry, content: sanitizeUserFacingAgentText(entry.content) }
          : entry
      ))
      : [];
    return NextResponse.json({ messages, history });
  } catch {
    return NextResponse.json({ messages: [], history: [] });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = messagesPath(id);
  const dir = join(PROJECTS_DIR, `proj_${id}`);

  try {
    const body = await request.json();
    const { messages, history } = body as {
      messages: unknown[];
      history: unknown[];
    };

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
    }

    // Ensure directory exists
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Save messages and LLM history
    await writeFile(path, JSON.stringify({
      messages: messages.slice(-100), // Keep last 100 messages max
      history: (history || []).slice(-50), // Keep last 50 history entries
      updated_at: new Date().toISOString(),
    }, null, 2), "utf-8");

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save messages" },
      { status: 500 },
    );
  }
}
