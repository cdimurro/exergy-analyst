export const maxDuration = 60;

/**
 * Ingestion API route — extract parameters from PDF/text for review.
 *
 * POST /api/projects/[id]/ingest
 *   Body: { source_type: "text"|"pdf", text?: string, document_id?: string, domain_hint?: string }
 *   Returns: IngestionPacket JSON
 *
 * This route calls the Python ingestion pipeline and returns a reviewable
 * extraction packet. The packet is NOT evaluated until the user reviews
 * and submits it via the actions route.
 */

import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";
import { join } from "path";
import { getEnvVar, RUNTIME_DIR } from "@/lib/backend";
import { writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const PYTHON = process.env.PYTHON_PATH || join(REPO_ROOT, ".venv", "bin", "python");

async function runPython(
  args: string[],
  timeout = 60_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const envVars: Record<string, string> = {
    ...(process.env as unknown as Record<string, string>),
    PYTHONPATH: REPO_ROOT,
  };
  for (const key of [
    "BT_EMBEDDING_MODEL",
    "OLLAMA_MODEL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_V3_API_KEY",
  ]) {
    const val = getEnvVar(key);
    if (val) envVars[key] = val;
  }

  try {
    const { stdout, stderr } = await execFileAsync(PYTHON, args, {
      cwd: REPO_ROOT,
      env: envVars as NodeJS.ProcessEnv,
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", code: e.code || 1 };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const body = await req.json();
    const sourceType = body.source_type as string;
    const domainHint = (body.domain_hint as string) || "";

    const comprehensive = body.comprehensive === true;

    if (sourceType === "text") {
      // ── Text extraction ──────────────────────────────────────
      const text = body.text as string;
      if (!text || text.trim().length < 10) {
        return NextResponse.json(
          { error: "Text must be at least 10 characters" },
          { status: 400 },
        );
      }

      // Write text to temp file for Python CLI
      const ingestDir = join(RUNTIME_DIR, "ingestion");
      if (!existsSync(ingestDir)) await mkdir(ingestDir, { recursive: true });

      const tempId = `text_${Date.now()}`;
      const tempPath = join(ingestDir, `${tempId}.txt`);
      await writeFile(tempPath, text, "utf-8");

      const args = comprehensive
        ? ["-m", "breakthrough_engine.ingestion.cli", "analyze", tempPath]
        : ["-m", "breakthrough_engine.ingestion.cli", "extract-text", "--input", tempPath];
      if (!comprehensive && domainHint) args.push("--domain", domainHint);

      const result = await runPython(args, comprehensive ? 90_000 : 45_000);

      if (result.code !== 0) {
        return NextResponse.json(
          {
            error: "Extraction failed",
            detail: result.stderr.slice(0, 500),
          },
          { status: 500 },
        );
      }

      try {
        const packet = JSON.parse(result.stdout);

        // Persist the packet
        const packetPath = join(
          ingestDir,
          `${packet.packet_id || tempId}.json`,
        );
        await writeFile(packetPath, JSON.stringify(packet, null, 2));

        return NextResponse.json(packet);
      } catch {
        return NextResponse.json(
          { error: "Failed to parse extraction result", raw: result.stdout.slice(0, 1000) },
          { status: 500 },
        );
      }
    } else if (sourceType === "pdf") {
      // ── PDF extraction ───────────────────────────────────────
      const documentId = body.document_id as string;
      if (!documentId) {
        return NextResponse.json(
          { error: "document_id is required for PDF extraction" },
          { status: 400 },
        );
      }

      const storage = getStorage();
      const docs = await storage.listDocuments(projectId);
      const doc = docs.find((d) => d.id === documentId);
      if (!doc) {
        return NextResponse.json(
          { error: `Document ${documentId} not found` },
          { status: 404 },
        );
      }

      // Find the actual file on disk
      const projDir = join(RUNTIME_DIR, "projects", `proj_${projectId}`);
      const docDir = join(projDir, "documents");
      const files = await readdir(docDir);
      const docFile = files.find(
        (f) => f.startsWith(documentId) && !f.endsWith(".json"),
      );
      if (!docFile) {
        return NextResponse.json(
          { error: "Document file not found on disk" },
          { status: 404 },
        );
      }

      const docPath = join(docDir, docFile);
      const args = comprehensive
        ? ["-m", "breakthrough_engine.ingestion.cli", "analyze", docPath]
        : ["-m", "breakthrough_engine.ingestion.cli", "extract-pdf", "--input", docPath];
      if (!comprehensive && domainHint) args.push("--domain", domainHint);

      const result = await runPython(args, comprehensive ? 120_000 : 120_000);

      if (result.code !== 0) {
        return NextResponse.json(
          {
            error: "PDF extraction failed",
            detail: result.stderr.slice(0, 500),
          },
          { status: 500 },
        );
      }

      try {
        const packet = JSON.parse(result.stdout);

        // Persist
        const ingestDir = join(RUNTIME_DIR, "ingestion");
        if (!existsSync(ingestDir)) await mkdir(ingestDir, { recursive: true });
        const packetPath = join(
          ingestDir,
          `${packet.packet_id || documentId}.json`,
        );
        await writeFile(packetPath, JSON.stringify(packet, null, 2));

        return NextResponse.json(packet);
      } catch {
        return NextResponse.json(
          { error: "Failed to parse extraction result", raw: result.stdout.slice(0, 1000) },
          { status: 500 },
        );
      }
    } else {
      return NextResponse.json(
        { error: `Unsupported source_type: ${sourceType}. Use "text" or "pdf".` },
        { status: 400 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
