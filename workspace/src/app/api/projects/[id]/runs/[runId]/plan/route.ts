import { NextRequest, NextResponse } from "next/server";

import { updateAgentRunPlan } from "@/lib/agent-runner";
import { getStorage } from "@/lib/storage";
import type { AgentPlanStep } from "@/lib/storage/types";

function cleanSteps(value: unknown): AgentPlanStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const steps = value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    .map((item, index) => ({
      step: index + 1,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Step ${index + 1}`,
      description: typeof item.description === "string" ? item.description.trim() : "",
      action_type: typeof item.action_type === "string" ? item.action_type as AgentPlanStep["action_type"] : "planning_detail",
      config: item.config && typeof item.config === "object" && !Array.isArray(item.config)
        ? item.config as Record<string, unknown>
        : {},
      display_only: item.display_only === true,
      status: "pending" as const,
    }));
  return steps.length > 0 ? steps : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const run = await updateAgentRunPlan(id, runId, {
      steps: cleanSteps(body.steps),
      feedback: typeof body.feedback === "string" ? body.feedback : undefined,
    });
    const events = await getStorage().listAgentEvents(id, runId);
    return NextResponse.json({ run, events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update plan" },
      { status: 400 },
    );
  }
}
