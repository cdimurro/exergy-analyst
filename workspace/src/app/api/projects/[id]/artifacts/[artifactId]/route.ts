import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  const storage = getStorage();
  const artifact = await storage.getArtifact(id, artifactId);
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }
  return NextResponse.json(artifact);
}
