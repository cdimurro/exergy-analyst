import { extractNumericEvidence } from "@/lib/agent-quality-evaluator";
import { buildSalientSourceValues, renderSalientSourceValuesTable } from "@/lib/document-evidence";
import { requiresScenarioReproducibilityPrompt } from "@/lib/scenario-reproducibility";
import type { Artifact, ProjectDocument } from "@/lib/storage/types";

export interface ScenarioMemoryInput {
  prompt: string;
  documents?: ProjectDocument[];
  artifacts?: Artifact[];
  history?: Array<{ role: string; content: string }>;
}

export interface ScenarioMemory {
  required: boolean;
  prompt_changes: string[];
  base_values: Array<{ label: string; value: string; unit: string; source: string }>;
  instructions: string;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function changedInputHints(prompt: string): string[] {
  const hints: string[] = [];
  for (const match of prompt.matchAll(/\b(?:reduce|reduced|lower|lowered|increase|increased|raise|raised|change|changed|set)\b[^.:\n]{0,120}/gi)) {
    hints.push(compact(match[0]).replace(/[,.]$/, ""));
  }
  if (/\b(all other|hold(?:ing)? all other|held constant|unchanged)\b/i.test(prompt)) {
    hints.push("all other inputs held constant unless explicitly listed as changed");
  }
  return Array.from(new Set(hints)).slice(0, 8);
}

function baseValuesFromArtifact(artifact: Artifact): Array<{ label: string; value: string; unit: string; source: string }> {
  const text = JSON.stringify({
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
  });
  return extractNumericEvidence(text, 30).slice(0, 12).map((item) => ({
    label: item.context.replace(/\|/g, "/").slice(0, 70),
    value: item.raw,
    unit: item.unit || "-",
    source: artifact.id,
  }));
}

function renderBaseValues(values: ScenarioMemory["base_values"]): string {
  if (values.length === 0) return "";
  return [
    "| Base value | Value | Unit | Source |",
    "|---|---:|---|---|",
    ...values.slice(0, 12).map((item) => `| ${item.label.replace(/\|/g, "/")} | ${item.value} | ${item.unit} | ${item.source} |`),
  ].join("\n");
}

export function buildScenarioMemory(input: ScenarioMemoryInput): ScenarioMemory {
  const required = requiresScenarioReproducibilityPrompt(input.prompt || "");
  if (!required) {
    return { required: false, prompt_changes: [], base_values: [], instructions: "" };
  }
  const sourceValues = buildSalientSourceValues(input.documents || [], 12).map((item) => ({
    label: item.label,
    value: item.raw,
    unit: item.unit || "-",
    source: `${item.source} (${item.filename})`,
  }));
  const artifactValues = (input.artifacts || []).slice(-4).flatMap(baseValuesFromArtifact);
  const historyText = (input.history || []).slice(-6).map((entry) => entry.content).join("\n\n");
  const historyValues = extractNumericEvidence(historyText, 20).slice(0, 8).map((item) => ({
    label: item.context.replace(/\|/g, "/").slice(0, 70),
    value: item.raw,
    unit: item.unit || "-",
    source: "prior run context",
  }));
  const baseValues = [...sourceValues, ...artifactValues, ...historyValues].slice(0, 18);
  const changes = changedInputHints(input.prompt);
  const instructions = [
    "SCENARIO MEMORY",
    "This follow-up appears to change one or more scenario inputs. Reuse recoverable base-case values rather than inventing a new basis.",
    changes.length ? `Prompt-level changed inputs: ${changes.join("; ")}` : "Prompt-level changed inputs: infer from the user request and state them explicitly.",
    "Required final answer elements: changed inputs, held-constant inputs, base/prior reference, formulas or model basis, side-by-side comparison table, assumption drift check, and artifact/file references when files are created.",
    renderBaseValues(baseValues),
    sourceValues.length ? ["Source-value table:", renderSalientSourceValuesTable(buildSalientSourceValues(input.documents || [], 12), 12)].join("\n") : "",
  ].filter(Boolean).join("\n\n");
  return {
    required,
    prompt_changes: changes,
    base_values: baseValues,
    instructions,
  };
}
