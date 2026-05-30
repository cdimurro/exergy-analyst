import { hasChartableContent, summarizeChartability } from "@/lib/chartable-artifact";
import type { Artifact } from "@/lib/storage/types";

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: overrides.id || "art_1",
    schema_version: 1,
    type: overrides.type || "research",
    title: overrides.title || "Artifact",
    summary: overrides.summary || "Summary",
    content: overrides.content || {},
    source: overrides.source || "ai_synthesis",
    raw: overrides.raw || {},
    metadata: overrides.metadata || {},
    action_id: overrides.action_id || "act_1",
    provenance: overrides.provenance || { source: "ai_synthesis", deterministic: false },
    created_at: overrides.created_at || "2026-04-29T00:00:00.000Z",
    pinned: overrides.pinned ?? false,
  };
}

describe("chartable-artifact", () => {
  it("does not treat failed or empty evaluation artifacts as chartable", () => {
    expect(hasChartableContent(artifact({
      type: "evaluation",
      content: {
        verdict: "not_ready",
        evidence_level_metadata: { n_parameters_fused: 0 },
      },
    }))).toBe(false);
  });

  it("treats evaluation artifacts with module scores as chartable", () => {
    expect(hasChartableContent(artifact({
      type: "evaluation",
      content: {
        module_evaluations: {
          physics: { score_0_100: 74, verdict: "conditional" },
        },
      },
    }))).toBe(true);
  });

  it("treats simulation artifacts with computed numeric summaries as chartable", () => {
    expect(hasChartableContent(artifact({
      type: "simulation",
      content: { summary: { peak_efficiency: 97.2, cec_weighted: 96.8 } },
    }))).toBe(true);
  });

  it("does not treat pure-text research as chartable", () => {
    expect(
      hasChartableContent(artifact({
        type: "research",
        content: { analysis_summary: "Several papers discuss durability, but no values were extracted." },
      })),
    ).toBe(false);
  });

  it("treats research findings with numeric values as chartable", () => {
    expect(
      hasChartableContent(artifact({
        type: "research",
        content: { findings: [{ label: "SOEC degradation", value: 0.4, unit: "%/kh" }] },
      })),
    ).toBe(true);
  });

  it("does not treat prose-only exploratory reports as chartable", () => {
    expect(
      hasChartableContent(artifact({
        type: "report",
        content: {
          artifact_lane: "exploratory",
          analysis_type: "comparison",
          analysis_summary: "The result needs more evidence before charting.",
        },
      })),
    ).toBe(false);
  });

  it("treats exploratory chart specs with numeric data as chartable", () => {
    expect(
      hasChartableContent(artifact({
        type: "report",
        content: {
          artifact_lane: "exploratory",
          chart_specs: [
            {
              chart_type: "bar",
              title: "Scorecard",
              data: [{ label: "Physics", value: 74 }],
            },
          ],
        },
      })),
    ).toBe(true);
  });

  it("does not treat document extraction prose as chartable", () => {
    expect(
      hasChartableContent(artifact({
        type: "document_extraction",
        content: { extracted_text: "Vendor presentation with qualitative claims." },
      })),
    ).toBe(false);
  });

  it("summarizes chartable artifacts", () => {
    const summary = summarizeChartability([
      artifact({ id: "text", type: "research", content: { findings: [{ text: "No numeric data." }] } }),
      artifact({ id: "numeric", type: "research", content: { score: 0.71 } }),
    ]);

    expect(summary).toEqual({
      hasChartableArtifact: true,
      chartableArtifactCount: 1,
      chartableArtifactIds: ["numeric"],
    });
  });
});
