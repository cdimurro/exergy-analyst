import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

// Feature flag: FF_PROJECTS_ENABLED
const FF_PROJECTS_ENABLED = process.env.FF_PROJECTS_ENABLED !== "false";

export async function GET() {
  if (!FF_PROJECTS_ENABLED) {
    return NextResponse.json({ error: "Projects not enabled" }, { status: 404 });
  }
  const storage = getStorage();
  const projects = await storage.listProjects();
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  if (!FF_PROJECTS_ENABLED) {
    return NextResponse.json({ error: "Projects not enabled" }, { status: 404 });
  }
  const body = await request.json();
  const { name, description, goal, domain } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const storage = getStorage();
  const project = await storage.createProject({
    name,
    description: description || "",
    goal: goal || "",
    domain: domain || "battery",
  });

  return NextResponse.json(project, { status: 201 });
}
