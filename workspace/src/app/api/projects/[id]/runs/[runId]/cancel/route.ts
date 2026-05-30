import { NextRequest, NextResponse } from "next/server";

import { cancelAgentRun } from "@/lib/agent-runner";
import { getStorage } from "@/lib/storage";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  try {
    const run = await cancelAgentRun(id, runId);
    const events = await getStorage().listAgentEvents(id, runId);
    return NextResponse.json({ run, events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel run" },
      { status: 400 },
    );
  }
}
