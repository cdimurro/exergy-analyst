import { NextRequest, NextResponse } from "next/server";

import { approveAgentRun } from "@/lib/agent-runner";
import { enqueueAgentRun } from "@/lib/agent-run-queue";
import { getStorage } from "@/lib/storage";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  try {
    await approveAgentRun(id, runId, { start: false });
    enqueueAgentRun(id, runId);
    const storage = getStorage();
    const run = await storage.getAgentRun(id, runId);
    const events = await storage.listAgentEvents(id, runId);
    return NextResponse.json({ run, events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve run" },
      { status: 400 },
    );
  }
}
