import { readFile } from "fs/promises";
import { basename, resolve } from "path";
import { NextRequest, NextResponse } from "next/server";

import { RUNTIME_DIR } from "@/lib/backend";
import { getStorage } from "@/lib/storage";

function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function listedOutputPath(files: unknown, requested: string): string | null {
  if (!Array.isArray(files)) return null;
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const record = file as Record<string, unknown>;
    if (record.path === requested && typeof record.path === "string") return record.path;
    if (record.filename === requested && typeof record.path === "string") return record.path;
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  const storage = getStorage();
  const artifact = await storage.getArtifact(id, artifactId);
  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const requested = request.nextUrl.searchParams.get("path") || "";
  const listed = listedOutputPath((artifact.content as Record<string, unknown>)?.files, requested);
  if (!listed) {
    return NextResponse.json({ error: "File not found on this artifact" }, { status: 404 });
  }

  const resolved = resolve(listed);
  const runtimeRoot = resolve(RUNTIME_DIR);
  if (!resolved.startsWith(runtimeRoot)) {
    return NextResponse.json({ error: "File is outside the runtime workspace" }, { status: 403 });
  }

  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: "File no longer exists" }, { status: 404 });
  }

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentTypeFor(resolved),
      "Content-Disposition": `attachment; filename="${basename(resolved).replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
