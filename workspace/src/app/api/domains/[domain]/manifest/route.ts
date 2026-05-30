/**
 * GET /api/domains/[domain]/manifest — Auto-generate interactive manifest from YAML schema.
 *
 * Reads config/domain_schemas/{domain}.yaml and returns an InteractiveManifest
 * with the top 3-5 most decision-relevant parameters. Cached in-memory after
 * first parse. Works for any of the 107 domain schemas.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const SCHEMAS_DIR = join(REPO_ROOT, "config", "domain_schemas");

// Module-level cache (parsed once per cold start)
const manifestCache = new Map<string, object>();

interface ParsedParam {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  description: string;
  group: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  const { domain } = await params;

  // Check cache
  if (manifestCache.has(domain)) {
    return NextResponse.json(manifestCache.get(domain));
  }

  const schemaPath = join(SCHEMAS_DIR, `${domain}.yaml`);
  if (!existsSync(schemaPath)) {
    return NextResponse.json(
      { error: `No schema found for domain '${domain}'` },
      { status: 404 },
    );
  }

  try {
    const yaml = readFileSync(schemaPath, "utf-8");
    const parsedParams = parseParameters(yaml);
    const summaryKeys = parseSummaryKeys(yaml);
    const displayName = parseField(yaml, "display_name") || domain.replace(/_/g, " ");

    // Select top 5 parameters
    const selected = selectTopParams(parsedParams, summaryKeys, 5);

    const manifest = {
      domain,
      displayName,
      hasSolver: true,
      hasEconomics: true,
      params: selected.map(p => ({
        key: p.key,
        label: p.label,
        unit: p.unit,
        min: p.min,
        max: p.max,
        step: p.step,
        default: p.default,
        affects: inferAffects(p.group),
        tooltip: p.description,
      })),
    };

    manifestCache.set(domain, manifest);
    return NextResponse.json(manifest);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse schema for '${domain}'` },
      { status: 500 },
    );
  }
}

// ── YAML parsing (regex-based, no dependency) ──────────────

function parseParameters(yaml: string): ParsedParam[] {
  const params: ParsedParam[] = [];

  // Split into parameter blocks
  const paramSection = yaml.split(/^parameters:/m)[1];
  if (!paramSection) return params;

  // Find each "- key:" block
  const blocks = paramSection.split(/\n  - key: /);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const key = block.split("\n")[0].trim();
    const label = extractField(block, "label") || key.replace(/_/g, " ");
    const unit = extractField(block, "unit") || "";
    const min = parseFloat(extractField(block, "min_value") || "0");
    const max = parseFloat(extractField(block, "max_value") || "100");
    const step = parseFloat(extractField(block, "step") || "1");
    const def = parseFloat(extractField(block, "default") || String((min + max) / 2));
    const desc = extractField(block, "description") || "";
    const group = extractField(block, "group") || "general";

    if (key && !isNaN(min) && !isNaN(max) && max > min) {
      params.push({ key, label, unit, min, max, step, default: def, description: desc, group });
    }
  }

  return params;
}

function extractField(block: string, field: string): string {
  const match = block.match(new RegExp(`${field}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return "";
  return match[1].replace(/^["']|["']$/g, "").trim();
}

function parseField(yaml: string, field: string): string {
  const match = yaml.match(new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match ? match[1].trim() : "";
}

function parseSummaryKeys(yaml: string): string[] {
  const match = yaml.match(/summary_metric_keys:\s*\n((?:\s+-\s+.+\n?)+)/);
  if (!match) return [];
  return match[1].split("\n")
    .map(line => line.replace(/^\s+-\s+/, "").trim())
    .filter(Boolean);
}

function selectTopParams(params: ParsedParam[], summaryKeys: string[], max: number): ParsedParam[] {
  if (params.length <= max) return params;

  const selected: ParsedParam[] = [];
  const used = new Set<string>();

  // Priority 1: summary_metric_keys
  for (const key of summaryKeys) {
    const p = params.find(p => p.key === key);
    if (p && !used.has(p.key)) {
      selected.push(p);
      used.add(p.key);
      if (selected.length >= max) return selected;
    }
  }

  // Priority 2: performance group
  for (const p of params) {
    if (!used.has(p.key) && p.group === "performance") {
      selected.push(p);
      used.add(p.key);
      if (selected.length >= max) return selected;
    }
  }

  // Priority 3: remaining (skip metadata-like params)
  const skipGroups = new Set(["process_config", "metadata"]);
  for (const p of params) {
    if (!used.has(p.key) && !skipGroups.has(p.group)) {
      selected.push(p);
      used.add(p.key);
      if (selected.length >= max) return selected;
    }
  }

  return selected;
}

function inferAffects(group: string): string[] {
  if (group === "economics" || group === "cost") return ["economics"];
  if (group === "performance" || group === "operating" || group === "electrical") return ["both"];
  return ["simulation"];
}
