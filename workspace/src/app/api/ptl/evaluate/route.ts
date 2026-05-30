/**
 * POST /api/ptl/evaluate
 *
 * Evaluate a Power-to-Liquid candidate and generate a PtlDecisionBrief
 * via the Python CLI. Brief is persisted to runtime/ptl_briefs/<id>.json
 * (same location that `listDecisionBriefs()` + `getBrief()` scan).
 *
 * Node.js runtime. Spawns the Python harness via execFile, mirroring the
 * pattern in /api/analyze/route.ts. No edge-only APIs.
 *
 * Bounded-framing invariant: this endpoint returns whatever the Python
 * brief generator produces — screening_* verdicts only; IRIS-3 cap
 * preserved data-drivenly via compute_iris_ceiling(family). The client
 * MUST render the investment_warning banner.
 *
 * Body shape:
 *   {
 *     "candidate_params": { ...evaluate_ptl_candidate input... },
 *     "candidate_id"?:   string,
 *     "jurisdiction"?:   string,  // defaults to "US"
 *     "title"?:          string,
 *   }
 *
 * Returns the full PtlDecisionBrief JSON on success, or
 *   { error: string, stderr?: string }   with HTTP 4xx/5xx on failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

import { getEnvVar, PTL_BRIEFS_DIR, RUNTIME_DIR } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const PYTHON = process.env.PYTHON_PATH || join(REPO_ROOT, ".venv", "bin", "python");
const DEFAULT_TIMEOUT_MS = 180_000; // 3 min

async function runPython(
  args: string[],
  timeout = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const envVars: Record<string, string> = {
    ...(process.env as unknown as Record<string, string>),
    PYTHONPATH: REPO_ROOT,
  };
  for (const key of ["BT_EMBEDDING_MODEL", "OLLAMA_MODEL"]) {
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
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || String(err),
      code: e.code || 1,
    };
  }
}

interface PtlEvaluateBody {
  candidate_params?: Record<string, unknown>;
  candidate_id?: string;
  jurisdiction?: string;
  title?: string;
}

export async function POST(req: NextRequest) {
  let body: PtlEvaluateBody;
  try {
    body = (await req.json()) as PtlEvaluateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const params = body.candidate_params;
  if (!params || typeof params !== "object") {
    return NextResponse.json(
      { error: "candidate_params is required (object)" },
      { status: 400 },
    );
  }

  // Stage a temp candidate file — the CLI reads from disk
  const tmpDir = join(RUNTIME_DIR, "ptl_candidates_tmp");
  if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });
  const token = randomBytes(8).toString("hex");
  const candidatePath = join(tmpDir, `candidate_${token}.json`);
  await writeFile(candidatePath, JSON.stringify(params), "utf-8");

  try {
    // --json is a parent-parser flag (must precede the subcommand).
    // Subcommand-specific flags (--candidate-id, --jurisdiction, --title)
    // follow the candidate path.
    const cliArgs = [
      "-m",
      "breakthrough_engine.ptl.cli",
      "--json",
      "brief",
      candidatePath,
    ];
    if (body.candidate_id) cliArgs.push("--candidate-id", body.candidate_id);
    if (body.jurisdiction) cliArgs.push("--jurisdiction", body.jurisdiction);
    if (body.title) cliArgs.push("--title", body.title);

    const { stdout, stderr, code } = await runPython(cliArgs);

    if (code !== 0) {
      return NextResponse.json(
        {
          error: "PtL brief generation failed",
          stderr: stderr.slice(-2000),
          exit_code: code,
        },
        { status: 500 },
      );
    }

    // --json makes the CLI print the full brief JSON to stdout
    let brief: Record<string, unknown>;
    try {
      brief = JSON.parse(stdout);
    } catch {
      return NextResponse.json(
        {
          error: "PtL brief output was not valid JSON",
          stdout_preview: stdout.slice(0, 400),
          stderr: stderr.slice(-800),
        },
        { status: 500 },
      );
    }

    const briefId = typeof brief.id === "string" ? brief.id : null;
    const savedPath = briefId ? join(PTL_BRIEFS_DIR, `${briefId}.json`) : null;

    // Confirm the brief was persisted (CLI always saves to runtime/ptl_briefs/);
    // if not present on disk, write it here so subsequent getBrief() calls
    // succeed. No-op when the CLI already wrote it.
    if (savedPath && !existsSync(savedPath)) {
      if (!existsSync(PTL_BRIEFS_DIR)) {
        await mkdir(PTL_BRIEFS_DIR, { recursive: true });
      }
      await writeFile(savedPath, JSON.stringify(brief, null, 2), "utf-8");
    }

    return NextResponse.json(brief, { status: 200 });
  } finally {
    try {
      await unlink(candidatePath);
    } catch {
      // ignore
    }
  }
}

/** Lightweight GET — report route status for smoke-tests. */
export async function GET() {
  return NextResponse.json({
    route: "ptl/evaluate",
    method: "POST",
    runtime: "nodejs",
    briefs_dir: PTL_BRIEFS_DIR,
  });
}
