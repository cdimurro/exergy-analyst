import { NextRequest } from "next/server";

import { POST as postAction } from "@/app/api/projects/[id]/actions/route";
import type { Action, ActionTrigger, ActionType, Artifact } from "@/lib/storage/types";

export interface ProjectActionExecutionResult {
  action: Action | Record<string, unknown>;
  artifact: Artifact | null;
  result_summary: string | null;
  recovered_from_error?: boolean;
}

export async function executeProjectAction(args: {
  projectId: string;
  actionType: ActionType;
  input: Record<string, unknown>;
  parentArtifactId?: string;
  trigger?: ActionTrigger;
  background?: boolean;
}): Promise<ProjectActionExecutionResult> {
  const req = new NextRequest(`http://localhost/api/projects/${encodeURIComponent(args.projectId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: args.actionType,
      input: args.input,
      parent_artifact_id: args.parentArtifactId,
      trigger: args.trigger || "user",
      async: args.background === true,
    }),
  });
  const res = await postAction(req, { params: Promise.resolve({ id: args.projectId }) });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.error === "string"
          ? payload.error
          : "Action could not complete",
    );
  }
  return {
    action: payload.action || {},
    artifact: payload.artifact || null,
    result_summary: typeof payload.result_summary === "string" ? payload.result_summary : null,
    recovered_from_error: payload.recovered_from_error === true,
  };
}
