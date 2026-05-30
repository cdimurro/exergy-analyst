/**
 * Domain Schema Generation API.
 *
 * POST /api/domains/generate
 * Body: { "description": "PEM hydrogen electrolyzer for green H2 production" }
 * Returns: Generated DomainSchema summary + registration confirmation
 *
 * Calls the Python DomainSchemaGenerator to bootstrap a new domain
 * from a natural language description + energy kernel matching.
 */

import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const PYTHON = process.env.PYTHON_PATH || join(REPO_ROOT, ".venv", "bin", "python");

// Feature flag: FF_MULTI_DOMAIN (default: true)
const FF_MULTI_DOMAIN = process.env.FF_MULTI_DOMAIN !== "false";

export async function POST(request: NextRequest) {
  if (!FF_MULTI_DOMAIN) {
    return NextResponse.json(
      { error: "Multi-domain features are disabled (FF_MULTI_DOMAIN=false)" },
      { status: 404 },
    );
  }
  const body = await request.json();
  const description = body.description as string;

  if (!description || description.trim().length < 5) {
    return NextResponse.json(
      { error: "Description must be at least 5 characters" },
      { status: 400 },
    );
  }

  const domainName = body.domain_name as string | undefined;

  try {
    // Call Python generator
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const script = `
import json, sys
sys.path.insert(0, '${REPO_ROOT}')
from breakthrough_engine.domain_schema_generator import DomainSchemaGenerator
from breakthrough_engine.domain_registry import DomainRegistry

gen = DomainSchemaGenerator()
schema = gen.generate(
    description=${JSON.stringify(description)},
    domain_name=${domainName ? JSON.stringify(domainName) : "None"},
)

# Register in the runtime registry
DomainRegistry.register(schema)

# Return summary
result = {
    "name": schema.name,
    "display_name": schema.display_name,
    "energy_kernel": schema.energy_kernel,
    "maturity": schema.maturity.value,
    "confidence": schema.confidence,
    "metric_count": len(schema.metrics),
    "parameter_count": len(schema.parameters),
    "preset_count": len(schema.technology_presets),
    "physics_check_count": len(schema.physics_checks),
    "stress_condition_count": len(schema.stress_conditions),
    "metrics": [{"name": m.name, "unit": m.unit} for m in schema.metrics],
    "module_applicability": schema.module_applicability,
}
print(json.dumps(result))
`;

    const { stdout, stderr } = await execFileAsync(PYTHON, ["-c", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT } as NodeJS.ProcessEnv,
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    if (stderr) {
      console.error("[domains/generate] Python stderr:", stderr.slice(0, 500));
    }

    const result = JSON.parse(stdout.trim());
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[domains/generate] Error:", message);
    return NextResponse.json(
      { error: "Failed to generate domain schema", detail: message },
      { status: 500 },
    );
  }
}
