export const maxDuration = 600;

import { NextRequest, NextResponse } from "next/server";

import { enqueueAgentRun } from "@/lib/agent-run-queue";
import { getStorage } from "@/lib/storage";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RUNNABLE = new Set(["queued"]);

function encodeSse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const storage = getStorage();
  const run = await storage.getAgentRun(id, runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (RUNNABLE.has(run.status)) {
    enqueueAgentRun(id, runId);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastSequence = 0;
      let closed = false;

      const send = (payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSse(payload)));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const pump = async () => {
        try {
          const events = await storage.listAgentEvents(id, runId);
          for (const event of events) {
            if (event.sequence <= lastSequence) continue;
            lastSequence = event.sequence;
            send(event);
          }
          const latest = await storage.getAgentRun(id, runId);
          if (!latest || TERMINAL.has(latest.status)) {
            close();
            return;
          }
          if (request.signal.aborted) {
            close();
            return;
          }
          setTimeout(pump, 1000);
        } catch (error) {
          send({
            type: "run.failed",
            message: error instanceof Error ? error.message : "Event stream failed",
          });
          close();
        }
      };

      request.signal.addEventListener("abort", close);
      await pump();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
