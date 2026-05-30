/**
 * Direct Analyze API — no project creation required.
 *
 * POST /api/analyze
 *   Body (text): { source_type: "text", text: string }
 *   Body (file): FormData with "file" field
 *
 * Returns: ComprehensiveExtraction JSON
 *
 * This is the front door API — fastest path from document to analysis.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  buildExergyArtifactInput,
  runExergyWorkspaceAgent,
  saveAnalyzeUpload,
} from "@/lib/exergy-agent";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let filePath: string;
    let originalName = "document";
    let prompt = "Analyze this uploaded evidence package and provide practical engineering insights.";

    if (contentType.includes("multipart/form-data")) {
      // File upload
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      originalName = file.name;
      prompt = String(formData.get("prompt") || prompt);
      filePath = await saveAnalyzeUpload(file, originalName);
    } else {
      // JSON body with text
      const body = await req.json();
      const text = body.text as string;
      if (!text || text.trim().length < 10) {
        return NextResponse.json(
          { error: "Text must be at least 10 characters" },
          { status: 400 },
        );
      }
      prompt = typeof body.prompt === "string" ? body.prompt : prompt;
      originalName = "pasted_text.txt";
      filePath = await saveAnalyzeUpload(text, originalName);
    }

    const run = await runExergyWorkspaceAgent(prompt, [filePath]);
    const artifact = buildExergyArtifactInput({
      run,
      prompt,
      actionId: "direct_analyze",
      title: "Direct Exergy Analysis",
    });
    return NextResponse.json({
      extraction: run,
      artifact,
      source_filename: originalName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
