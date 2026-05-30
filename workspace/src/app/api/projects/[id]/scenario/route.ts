/**
 * WtF Scenario API — governed parameter what-if analysis.
 *
 * POST /api/projects/[id]/scenario
 * Body: { base_params: {...}, overrides: { throughput_tpd: 200 } }
 *
 * Returns compact before/after comparison with score, top insight,
 * benchmark gap, and key metric deltas. Labels results as
 * "scenario analysis" not validated outcomes.
 *
 * Security note (fixed in CC-BE-UNBLOCK-0003):
 *   Earlier revisions of this route f-string-interpolated override
 *   values directly into a Python script executed via `exec` with
 *   shell=/bin/bash. A malicious value like `__import__('os').listdir('/')`
 *   or `$(whoami)` would execute as Python/shell code.
 *
 *   This revision uses `spawn` (no shell) with a fixed Python script
 *   that reads `base_params` and `overrides` as JSON from stdin. Override
 *   KEYS are whitelisted (ALLOWED_OVERRIDES) and VALUES are validated to
 *   be primitives (number | string | boolean | null). No caller input is
 *   interpolated into code.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

// Governed WtF scenario controls — only these param keys can be overridden.
// Each listed key must actually produce a measurable change in
// simulate_plant() output; if a key is accepted but ignored by the
// simulator the UI shows misleading zero-deltas. `throughput_tpd` was
// removed because simulate_plant() does not respond to scale at this
// time — economics scaling is applied elsewhere in the pipeline, not
// in the scenario path.
const ALLOWED_OVERRIDES = new Set([
  "feedstock_type",
  "fuel_oil_yield_pct",
  "contaminant_level_ppm",
  "tipping_fee_per_ton",
  "capacity_utilization_pct",
  "moisture_content_pct",
]);

// Values must be primitive scalars — nested objects/arrays are rejected.
// Strings are additionally length-capped to defend against oversized inputs.
const MAX_STRING_VALUE = 128;

function isAcceptableValue(v: unknown): boolean {
  if (v === null) return true;
  const t = typeof v;
  if (t === "number") return Number.isFinite(v as number);
  if (t === "boolean") return true;
  if (t === "string") return (v as string).length <= MAX_STRING_VALUE;
  return false;
}

// Fixed Python runner. Reads a JSON object `{base_params, overrides}` from
// stdin and prints a JSON result. Contains no caller input.
const SCENARIO_SCRIPT = `
import json, sys

sys.path.insert(0, '.')
from breakthrough_engine.wtf.domain import (
    simulate_plant, score_wtf_candidate, DEFAULT_PLANT_PARAMS,
    compute_robustness_profile,
)

def _coerce(v):
    """Best-effort numeric coercion without executing anything."""
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    if isinstance(v, str):
        try:
            f = float(v)
            i = int(f)
            return i if f == i else f
        except ValueError:
            return v
    return v


def run_scenario(params_dict):
    params = dict(DEFAULT_PLANT_PARAMS)
    for k, v in (params_dict or {}).items():
        params[str(k)] = _coerce(v)
    result = simulate_plant(params, {})
    baseline = simulate_plant(DEFAULT_PLANT_PARAMS, {})
    robustness = compute_robustness_profile(params, baseline)
    eval_result = score_wtf_candidate({**params, **result}, baseline, robustness)
    return {
        'score': round(eval_result.final_score, 3),
        'hard_fail': eval_result.hard_fail,
        'hard_fail_reasons': eval_result.hard_fail_reasons[:3],
        'fuel_oil_yield_pct': result.get('fuel_oil_yield_pct'),
        'contaminant_level_ppm': result.get('contaminant_level_ppm'),
        'total_product_value_per_ton': result.get('total_product_value_per_ton'),
        'process_energy_efficiency_pct': result.get('process_energy_efficiency_pct'),
    }


payload = json.loads(sys.stdin.read() or "{}")
base_params = payload.get('base_params') or {}
overrides = payload.get('overrides') or {}
scenario_params = {**base_params, **overrides}

base = run_scenario(base_params)
scenario = run_scenario(scenario_params)
print(json.dumps({'base': base, 'scenario': scenario}))
`;

/**
 * Run the scenario script via spawn (no shell) with stdin-piped JSON.
 * Returns the parsed stdout or throws on exit != 0 / parse failure.
 */
async function runScenarioScript(payload: unknown, timeoutMs: number): Promise<{
  base: Record<string, unknown>;
  scenario: Record<string, unknown>;
}> {
  // workspace/ runs inside the Next.js app directory; the Python venv is
  // one level up at the repo root. Resolve absolutely so we never depend
  // on shell cwd state.
  const repoRoot = path.resolve(process.cwd(), "..");
  const python = path.join(repoRoot, ".venv", "bin", "python3");

  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-c", SCENARIO_SCRIPT], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: repoRoot },
      stdio: ["pipe", "pipe", "pipe"],
      // Critical: no shell. Args are passed as argv entries; payload goes
      // over stdin; nothing is interpolated into a command line.
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Scenario evaluation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().slice(0, 2000);
        reject(new Error(`Scenario runner exited ${code}: ${stderr}`));
        return;
      }
      try {
        const stdout = Buffer.concat(chunks).toString().trim();
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        reject(new Error(`Scenario runner produced invalid JSON: ${msg}`));
      }
    });

    // Write payload to stdin — NOT interpolated into the script source.
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// Minimal structured logger. Prefixes every entry with the route for
// grep-ability; kept synchronous so it never blocks the handler.
// NOTE: when this route moves behind Vercel Workflow (durable execution,
// retries, pause/resume) the subprocess call here should be replaced with
// a queued step. For the current local-dev surface a synchronous spawn
// with a 30s timeout is adequate; tracked as a follow-up.
function logEvent(event: string, fields: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ route: "scenario", event, ...fields }));
  } catch {
    // Logging must never throw.
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id: projectId } = await params;
  const body = await req.json();
  const baseParams = (body && typeof body === "object" ? body.base_params : null) || {};
  const overrides = (body && typeof body === "object" ? body.overrides : null) || {};

  // Validate overrides: allowed key + acceptable primitive value.
  const rejected: string[] = [];
  const accepted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (!ALLOWED_OVERRIDES.has(k)) {
      rejected.push(k);
      continue;
    }
    if (!isAcceptableValue(v)) {
      rejected.push(`${k} (invalid value type)`);
      continue;
    }
    accepted[k] = v;
  }

  if (Object.keys(accepted).length === 0) {
    return NextResponse.json(
      { error: "No valid scenario overrides provided", rejected },
      { status: 400 },
    );
  }

  // Sanitize base_params too — same primitive-value rule applies.
  // We don't whitelist keys here because base_params comes from the
  // server's own evaluation artifact, but an untrusted caller could
  // still supply the request body directly, so we harden it anyway.
  const safeBase: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(baseParams)) {
    if (typeof k === "string" && k.length <= MAX_STRING_VALUE && isAcceptableValue(v)) {
      safeBase[k] = v;
    }
  }

  try {
    const results = await runScenarioScript(
      { base_params: safeBase, overrides: accepted },
      30000,
    );

    return NextResponse.json({
      project_id: projectId,
      overrides: accepted,
      rejected,
      base: results.base,
      scenario: results.scenario,
      deltas: {
        score:
          ((results.scenario.score as number) ?? 0) -
          ((results.base.score as number) ?? 0),
        fuel_oil_yield_pct:
          ((results.scenario.fuel_oil_yield_pct as number) ?? 0) -
          ((results.base.fuel_oil_yield_pct as number) ?? 0),
        contaminant_level_ppm:
          ((results.scenario.contaminant_level_ppm as number) ?? 0) -
          ((results.base.contaminant_level_ppm as number) ?? 0),
      },
      note: "Scenario analysis — not a validated deployment outcome. Governed parameter variation only.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Scenario evaluation failed: ${msg}` },
      { status: 500 },
    );
  }
}
