export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";

import { createAgentRun } from "@/lib/agent-runner";
import { enqueueAgentRun, resumeRunnableAgentRuns } from "@/lib/agent-run-queue";
import { getStorage } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storage = getStorage();
  const project = await storage.getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  await resumeRunnableAgentRuns(id);
  const runs = await storage.listAgentRuns(id);
  return NextResponse.json({ runs });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const run = await createAgentRun(id, {
      message,
      document_ids: Array.isArray(body.document_ids)
        ? body.document_ids.filter((value): value is string => typeof value === "string")
        : [],
      current_document_ids: Array.isArray(body.current_document_ids)
        ? body.current_document_ids.filter((value): value is string => typeof value === "string")
        : [],
      mode: body.mode === "plan" ? "plan" : "implement",
      thinking_level: body.thinking_level === "instant" ? "instant" : "expert",
      parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : undefined,
    });

    enqueueAgentRun(id, run.id);

    const events = await getStorage().listAgentEvents(id, run.id);
    return NextResponse.json({ run, events }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create run" },
      { status: 500 },
    );
  }
}
