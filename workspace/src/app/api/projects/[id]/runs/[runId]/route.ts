import { NextRequest, NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const storage = getStorage();
  const run = await storage.getAgentRun(id, runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const events = await storage.listAgentEvents(id, runId);
  return NextResponse.json({ run, events });
}
