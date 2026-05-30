/**
 * Domain listing API.
 *
 * Returns all available domain schemas from the Python engine's registry
 * (config/domain_schemas/*.yaml). Falls back to the hardcoded builtin list
 * if the Python registry is not available.
 */

import { NextResponse } from "next/server";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = process.env.ENGINE_ROOT || join(process.cwd(), "..");
const SCHEMAS_DIR = join(REPO_ROOT, "config", "domain_schemas");

// Feature flag: FF_MULTI_DOMAIN (default: true)
const FF_MULTI_DOMAIN = process.env.FF_MULTI_DOMAIN !== "false";

interface DomainSummary {
  name: string;
  display_name: string;
  description: string;
  maturity: string;
  energy_kernel: string;
  metric_count: number;
  parameter_count: number;
  preset_count: number;
}

export async function GET() {
  try {
    const files = readdirSync(SCHEMAS_DIR).filter(f => f.endsWith(".yaml"));
    const domains: DomainSummary[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(SCHEMAS_DIR, file), "utf-8");
        // Simple YAML parsing for the key fields we need
        const name = extractYamlField(content, "name") || file.replace(".yaml", "");
        const display_name = extractYamlField(content, "display_name") || name;
        const description = extractYamlField(content, "description") || "";
        const maturity = extractYamlField(content, "maturity") || "builtin_calibrated";
        const energy_kernel = extractYamlField(content, "energy_kernel") || "";

        // Count metrics, parameters, presets by counting list items
        const metric_count = (content.match(/^  - name:/gm) || []).length;
        const parameter_count = (content.match(/^  - key:/gm) || []).length;
        const preset_count = countYamlSection(content, "technology_presets");

        domains.push({
          name, display_name, description, maturity,
          energy_kernel, metric_count, parameter_count, preset_count,
        });
      } catch {
        // Skip malformed files
      }
    }

    return NextResponse.json(domains);
  } catch {
    // Fallback: return hardcoded builtins
    return NextResponse.json([
      { name: "battery_ecm", display_name: "Battery ECM", description: "Li-ion battery simulation", maturity: "builtin_calibrated", energy_kernel: "electrochemical_storage", metric_count: 9, parameter_count: 9, preset_count: 4 },
      { name: "pv_iv", display_name: "PV I-V", description: "Photovoltaic module simulation", maturity: "builtin_calibrated", energy_kernel: "photovoltaic", metric_count: 5, parameter_count: 9, preset_count: 4 },
      { name: "inverter_dc_ac", display_name: "DC-AC Inverter", description: "Inverter efficiency simulation", maturity: "builtin_calibrated", energy_kernel: "power_electronics", metric_count: 6, parameter_count: 8, preset_count: 5 },
    ]);
  }
}

/** Extract a simple top-level YAML scalar field value */
function extractYamlField(content: string, field: string): string {
  const match = content.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, "m"));
  return match?.[1]?.trim() || "";
}

/** Count items in a YAML list section */
function countYamlSection(content: string, section: string): number {
  const sectionMatch = content.match(new RegExp(`^${section}:\\s*\\n((?:  - [\\s\\S]*?)?)(?=^[a-z]|$)`, "m"));
  if (!sectionMatch) return 0;
  return (sectionMatch[1].match(/^  - /gm) || []).length;
}
