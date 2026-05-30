import type { Artifact } from "@/lib/storage/types";

export interface ChartabilitySummary {
  hasChartableArtifact: boolean;
  chartableArtifactCount: number;
  chartableArtifactIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function containsFiniteNumber(value: unknown): boolean {
  if (finiteNumber(value) !== null) return true;
  if (Array.isArray(value)) return value.some(containsFiniteNumber);
  if (isRecord(value)) return Object.values(value).some(containsFiniteNumber);
  return false;
}

function nonEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function numericArrayField(content: Record<string, unknown>, field: string): boolean {
  const value = content[field];
  return Array.isArray(value) && value.length > 0 && containsFiniteNumber(value);
}

export function hasChartableContent(artifact: Pick<Artifact, "type" | "content"> | null | undefined): boolean {
  if (!artifact) return false;

  const content = isRecord(artifact.content) ? artifact.content : {};
  const brief = isRecord(content.brief) ? content.brief : {};
  const physicsSolver = isRecord(content.physics_solver) ? content.physics_solver : {};

  if (artifact.type === "evaluation") {
    if (content.verdict === "not_ready" || content.run_state === "debug") {
      return false;
    }
    if (finiteNumber(content.score) !== null) return true;
    if (nonEmptyRecord(content.module_evaluations)) return true;
    if (containsFiniteNumber(content.exergy_metrics)) return true;
    if (containsFiniteNumber(physicsSolver.output_metrics)) return true;
    if (finiteNumber(brief.composite_score) !== null) return true;
    if (nonEmptyArray(brief.ranked_gap_guidance)) return true;
    return false;
  }

  if (artifact.type === "simulation") {
    if (containsFiniteNumber(content.summary)) return true;
    if (containsFiniteNumber(physicsSolver.output_metrics)) return true;
  }

  if (finiteNumber(content.score) !== null) return true;
  if (nonEmptyRecord(content.module_evaluations)) return true;
  if (containsFiniteNumber(content.exergy_metrics)) return true;
  if (containsFiniteNumber(content.summary)) return true;
  if (nonEmptyArray(brief.ranked_gap_guidance)) return true;

  for (const field of [
    "chart_specs",
    "numeric_series",
    "data_series",
    "comparisons",
    "sensitivity_tornado",
    "value_deltas",
  ]) {
    if (numericArrayField(content, field)) return true;
  }

  const findings = content.findings;
  if (Array.isArray(findings)) {
    return findings.some((finding) => isRecord(finding) && finiteNumber(finding.value) !== null);
  }

  return false;
}

export function summarizeChartability(
  artifacts: Array<Pick<Artifact, "id" | "type" | "content"> | null | undefined>,
): ChartabilitySummary {
  const chartableArtifactIds = artifacts
    .filter((artifact): artifact is Pick<Artifact, "id" | "type" | "content"> => !!artifact)
    .filter(hasChartableContent)
    .map((artifact) => artifact.id);

  return {
    hasChartableArtifact: chartableArtifactIds.length > 0,
    chartableArtifactCount: chartableArtifactIds.length,
    chartableArtifactIds,
  };
}
