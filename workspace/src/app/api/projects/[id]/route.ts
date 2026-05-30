import { NextRequest, NextResponse } from "next/server";
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

  const [artifacts, documents, actions, runs] = await Promise.all([
    storage.listArtifacts(id),
    storage.listDocuments(id),
    storage.listActions(id),
    storage.listAgentRuns(id),
  ]);

  return NextResponse.json({ ...project, artifacts, documents, actions, runs });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const storage = getStorage();

  const project = await storage.getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const patch: Record<string, string> = {};
  if (body.name) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.goal !== undefined) patch.goal = body.goal;

  await storage.updateProject(id, patch);
  return NextResponse.json({ ok: true });
}
