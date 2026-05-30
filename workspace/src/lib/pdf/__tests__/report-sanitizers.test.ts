import {
  clientFacingFinding,
  hasStructuredSolverBacking,
  isClientFacingGateResult,
  removeContradictoryUnavailableMetricPhrases,
  sanitizeUnsupportedMaturityClaims,
} from "@/lib/pdf/report-sanitizers";
import {
  type ReportNarratives,
  sanitizeNarrativeEvidencePosture,
  sanitizeNarrativesEvidencePosture,
} from "@/lib/pdf/generate-narratives";
import type { DeviceDecisionBrief } from "@/lib/brief-types";

describe("PDF report sanitizers", () => {
  it("hides internal claim-hygiene gates from customer-facing scorecards", () => {
    expect(isClientFacingGateResult({
      gate_name: "Banned claims",
      detail: "6 banned claims registered",
    })).toBe(false);
    expect(isClientFacingGateResult({
      gate_name: "Thermal efficiency minimum",
      detail: "Thermal efficiency is within the benchmark envelope",
    })).toBe(true);
  });

  it("removes banned-claim copy from module findings", () => {
    expect(clientFacingFinding(
      "Physics: all plausibility gates pass. Banned claims: 6 banned claims registered.",
    )).toBe("Physics: all plausibility gates pass.");
  });

  it("does not let generated narratives contradict strong evidence posture", () => {
    const brief = {
      evidence_strength: "strong",
      evidence_level: "strong",
    } as DeviceDecisionBrief;

    const text = "The evidence base for this assessment is rated as strong for physics but weak overall due to limited source references. The next sentence remains.";

    expect(sanitizeNarrativeEvidencePosture(text, brief)).toBe(
      "The evidence base is strong for the available document set; remaining limitations are specific gaps in independent operational, cost, regulatory, or long-duration performance data. The next sentence remains.",
    );
  });

  it("removes unavailable exergy phrasing when the metric is present", () => {
    const text = "Second-law exergy efficiency is unavailable from the provided documents. The system uses a high-temperature conversion step.";
    const brief = { second_law_efficiency: 0.5368 };

    expect(removeContradictoryUnavailableMetricPhrases(text, brief)).toBe(
      "The system uses a high-temperature conversion step.",
    );
  });

  it("preserves unavailable exergy phrasing when the metric is absent", () => {
    const text = "Second-law exergy efficiency is unavailable from the provided documents. The system uses a high-temperature conversion step.";

    expect(removeContradictoryUnavailableMetricPhrases(text, {})).toBe(text);
  });

  it("is idempotent for already clean metric narratives", () => {
    const text = "Second-law exergy efficiency is 53.7%, with quality factor 0.95.";
    const brief = { thermodynamic_quality: { second_law_efficiency: 0.5368 } };
    const once = removeContradictoryUnavailableMetricPhrases(text, brief);

    expect(removeContradictoryUnavailableMetricPhrases(once, brief)).toBe(once);
  });

  it("removes unsupported bankability and decision-grade claims from generated narratives", () => {
    const text = "The technology is bankable today. The package is decision-grade for deployment. Evidence gaps remain.";
    expect(sanitizeUnsupportedMaturityClaims(text, {})).toBe(
      "The current evidence does not establish bankability; finance readiness depends on sourced CAPEX, OPEX, utilization, revenue, financing, and operating-history inputs. The current evidence supports a bounded diligence view, not a final external-readiness conclusion. Evidence gaps remain.",
    );
  });

  it("preserves caveated bankability language", () => {
    const text = "The technology is not bankable without utilization and WACC evidence.";
    expect(sanitizeUnsupportedMaturityClaims(text, {})).toBe(text);
  });

  it("removes unsupported solver-backed and exergy-validated claims", () => {
    const text = "The result is solver-backed and validated by simulation. Computed exergy confirms the mechanism.";
    expect(sanitizeUnsupportedMaturityClaims(text, {})).toBe(
      "Solver-backed validation is not established in the structured artifacts; treat the result as a bounded assessment until durable solver evidence exists. Exergy validation is not established without computed exergy status plus durable solver-backed artifact support.",
    );
  });

  it("allows solver-backed and exergy language only with structured artifact support", () => {
    const brief = {
      physics_evaluation: {
        solver_status: "solver_backed",
        exergy_status: "computed",
        solver_artifacts: [{
          solver_name: "pysam",
          solver_version: "1.0",
          artifact_uri: "runtime/solver/pysam-run.json",
        }],
      },
    };
    const text = "The result is solver-backed. Computed exergy confirms the mechanism.";
    expect(hasStructuredSolverBacking(brief)).toBe(true);
    expect(sanitizeUnsupportedMaturityClaims(text, brief)).toBe(text);
  });

  it("is idempotent for unsupported and artifact-supported maturity claims", () => {
    const unsupported = "The technology is bankable today. The package is decision-grade for deployment.";
    const unsupportedOnce = sanitizeUnsupportedMaturityClaims(unsupported, {});
    expect(sanitizeUnsupportedMaturityClaims(unsupportedOnce, {})).toBe(unsupportedOnce);

    const supportedBrief = {
      physics_evaluation: {
        solver_status: "solver_backed",
        exergy_status: "computed",
        solver_artifacts: [{
          solver_name: "pysam",
          solver_version: "1.0",
          artifact_uri: "runtime/solver/pysam-run.json",
        }],
      },
    };
    const supported = "The result is solver-backed. Computed exergy confirms the mechanism.";
    const supportedOnce = sanitizeUnsupportedMaturityClaims(supported, supportedBrief);
    expect(sanitizeUnsupportedMaturityClaims(supportedOnce, supportedBrief)).toBe(supportedOnce);
  });

  it("sanitizes a report-shaped narrative payload before PDF rendering", () => {
    const narratives: ReportNarratives = {
      executive_summary: "The technology is bankable today.",
      technology_profile: "The device remains under review.",
      technical_analysis: "The result is solver-backed and validated by simulation.",
      thermodynamic_assessment: "Computed exergy confirms the mechanism.",
      economic_assessment: "The package is decision-grade for deployment.",
      commercial_positioning: "The technology is not bankable without WACC evidence.",
      manufacturing_and_scale: "Manufacturing data is pending.",
      regulatory_and_compliance: "Permitting data is pending.",
      safety_and_risk: "Safety data is pending.",
      environmental_impact: "Lifecycle data is pending.",
      system_integration: "Integration data is pending.",
      strategic_value: "Strategic data is pending.",
      recommendations: "Collect missing evidence.",
      evidence_quality_narrative: "The evidence base is unknown.",
      module_narratives: {},
      module_deep_dives: {},
    };

    const sanitized = sanitizeNarrativesEvidencePosture(narratives, {} as DeviceDecisionBrief);
    expect(sanitized.executive_summary).toContain("does not establish bankability");
    expect(sanitized.technical_analysis).toContain("Solver-backed validation is not established");
    expect(sanitized.thermodynamic_assessment).toContain("Exergy validation is not established");
    expect(sanitized.economic_assessment).toContain("bounded diligence view");
    expect(sanitized.commercial_positioning).toBe("The technology is not bankable without WACC evidence.");
  });
});
