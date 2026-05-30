/**
 * Interactive Rerun API — deterministic what-if analysis.
 *
 * POST /api/projects/:id/rerun
 *
 * Takes baseline candidate_params + validated edits, reruns the real
 * evaluation via the breakthrough engine, and returns a modified
 * result with what-if provenance.
 *
 * The baseline result is never modified. The response includes the
 * modified result plus provenance for comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const PYTHON = process.env.PYTHON_PATH || join(REPO_ROOT, ".venv", "bin", "python");

async function runPython(args: string[], timeout = 60_000): Promise<string> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const env: Record<string, string> = {
    ...(process.env as unknown as Record<string, string>),
    PYTHONPATH: REPO_ROOT,
  };

  const { stdout } = await execFileAsync(PYTHON, args, {
    cwd: REPO_ROOT,
    env: env as NodeJS.ProcessEnv,
    maxBuffer: 10 * 1024 * 1024,
    timeout,
  });
  return stdout;
}

interface RerunRequest {
  domain: string;
  baseline_params: Record<string, unknown>;
  edits: Record<string, number>;
  device_id?: string;
  description?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;

  let body: RerunRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { domain, baseline_params, edits, device_id, description } = body;

  if (!domain || !baseline_params || !edits) {
    return NextResponse.json(
      { error: "Missing required fields: domain, baseline_params, edits" },
      { status: 400 },
    );
  }

  if (Object.keys(edits).length === 0) {
    return NextResponse.json(
      { error: "No edits provided" },
      { status: 400 },
    );
  }

  // Merge baseline + edits
  const modifiedParams = { ...baseline_params, ...edits };
  const deviceId = device_id || `whatif-${Date.now()}`;

  // Build inline Python script that runs the evaluation and outputs JSON
  const script = [
    "import json, sys",
    "from breakthrough_engine.evaluate_reference_device import evaluate_reference_device_generic",
    `device = json.loads(sys.argv[1])`,
    "result = evaluate_reference_device_generic(device)",
    "print(json.dumps(result))",
  ].join("; ");

  const deviceDict = JSON.stringify({
    device_id: deviceId,
    domain,
    commercial_name: description || `What-if: ${domain}`,
    technology_family: "",
    description: description || `Interactive what-if rerun for ${domain}`,
    candidate_params: modifiedParams,
    baseline_metrics: {},
    robustness_profile: {},
  });

  try {
    const stdout = await runPython(["-c", script, deviceDict]);

    // Parse the last JSON line (skip any logging to stderr/stdout preamble)
    const lines = stdout.trim().split("\n");
    let result: Record<string, unknown> | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        result = JSON.parse(lines[i]);
        break;
      } catch { continue; }
    }

    if (!result) {
      return NextResponse.json(
        { error: "Evaluation produced no parseable output" },
        { status: 500 },
      );
    }

    // Add what-if provenance
    (result as Record<string, unknown>)._whatif = {
      is_whatif: true,
      baseline_params,
      edits,
      edited_keys: Object.keys(edits),
      timestamp: new Date().toISOString(),
      project_id: projectId,
    };

    return NextResponse.json({
      success: true,
      result,
      edits,
      domain,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Rerun failed: ${message.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
