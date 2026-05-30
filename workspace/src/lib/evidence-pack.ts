export type EvidenceWorkflow = "report" | "chart" | "bankability" | "physics" | "external_sharing";
export type EvidencePriority = "critical" | "high" | "medium";

export interface EvidencePackItem {
  evidenceItem: string;
  whyItMatters: string;
  decisionUnlocked: string;
  sourceOrOwner: string;
  minimumRequiredDetail: string;
  priority: EvidencePriority;
  workflowContext: EvidenceWorkflow;
}

const PRIORITY_WEIGHT: Record<EvidencePriority, number> = {
  critical: 3,
  high: 2,
  medium: 1,
};

export function rankEvidenceItems(items: EvidencePackItem[]): EvidencePackItem[] {
  return [...items].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]);
}

export function buildEvidencePack(workflow: EvidenceWorkflow): EvidencePackItem[] {
  const shared: EvidencePackItem[] = [
    {
      evidenceItem: "Source-backed performance measurements",
      whyItMatters: "They separate demonstrated behavior from claims and prevent unsupported external language.",
      decisionUnlocked: "Initial go/no-go screen and claim boundary",
      sourceOrOwner: "Technical lead or test owner",
      minimumRequiredDetail: "Metric, unit, operating regime, duration, uncertainty, source document, page or table, and test owner",
      priority: "critical",
      workflowContext: workflow,
    },
    {
      evidenceItem: "System boundary and operating basis",
      whyItMatters: "It defines whether economics, charts, and physics claims refer to the same operating case.",
      decisionUnlocked: "Comparable diligence view across performance, finance, and physics",
      sourceOrOwner: "Engineering owner",
      minimumRequiredDetail: "Boundary diagram or description, duty cycle, inputs, outputs, ambient/reference basis, and scenario label",
      priority: "high",
      workflowContext: workflow,
    },
  ];

  const workflowItems: Record<EvidenceWorkflow, EvidencePackItem[]> = {
    report: [
      {
        evidenceItem: "Evidence provenance map",
        whyItMatters: "A client-ready report needs every material statement tied to a source.",
        decisionUnlocked: "Internal memo now; external report after source-backed claims are visible",
        sourceOrOwner: "Diligence lead",
        minimumRequiredDetail: "Document name, page or section, table label, date, source owner, and which claim each source supports",
        priority: "critical",
        workflowContext: "report",
      },
      {
        evidenceItem: "Unsupported-claim list",
        whyItMatters: "It keeps investor, customer, and lender packages from overstating readiness.",
        decisionUnlocked: "External sharing boundary",
        sourceOrOwner: "Diligence lead with technical and finance review",
        minimumRequiredDetail: "Claim text, missing proof, allowed safer wording, and owner for proof",
        priority: "high",
        workflowContext: "report",
      },
    ],
    chart: [
      {
        evidenceItem: "Chart data table",
        whyItMatters: "Charts require real values; missing values should become requests, not invented series.",
        decisionUnlocked: "Chart package generation from grounded artifacts",
        sourceOrOwner: "Data owner for each metric",
        minimumRequiredDetail: "Metric, unit, value, scenario, time basis, source artifact, and owner",
        priority: "critical",
        workflowContext: "chart",
      },
      {
        evidenceItem: "Chart decision relevance",
        whyItMatters: "Each chart should explain the diligence decision it helps answer.",
        decisionUnlocked: "CEO or investor chart package plan",
        sourceOrOwner: "Diligence lead",
        minimumRequiredDetail: "Audience, decision question, supported summary today, and blocked chart inputs",
        priority: "high",
        workflowContext: "chart",
      },
    ],
    bankability: [
      {
        evidenceItem: "Finance model inputs",
        whyItMatters: "NPV, IRR, payback, and lender readiness cannot be computed without a dated cost and revenue basis.",
        decisionUnlocked: "Bankability screen and finance calculation readiness",
        sourceOrOwner: "Finance owner",
        minimumRequiredDetail: "CAPEX, OPEX, utilization, lifetime, replacement cadence, WACC or discount rate, revenue or price stack, incentives, tax treatment, and currency year",
        priority: "critical",
        workflowContext: "bankability",
      },
      {
        evidenceItem: "Offtake and incumbent baseline",
        whyItMatters: "A lender will ask whether revenue is contracted and whether the comparison case is real.",
        decisionUnlocked: "Investor outreach with financing-risk caveats",
        sourceOrOwner: "Commercial or finance owner",
        minimumRequiredDetail: "Counterparty, tenor, volume, pricing basis, credit quality, incumbent benchmark, and source basis",
        priority: "high",
        workflowContext: "bankability",
      },
    ],
    physics: [
      {
        evidenceItem: "Thermodynamic state table",
        whyItMatters: "Exergy and solver-status claims need complete state variables and a defined reference environment.",
        decisionUnlocked: "Physics or exergy validation readiness",
        sourceOrOwner: "Technical lead or modeling owner",
        minimumRequiredDetail: "Temperature, pressure, flow, composition, phase, heat, work, losses, reference environment, and uncertainty for each stream",
        priority: "critical",
        workflowContext: "physics",
      },
      {
        evidenceItem: "Solver or validation artifact",
        whyItMatters: "Solver confidence cannot be claimed from a description alone.",
        decisionUnlocked: "Solver-evidence claim boundary",
        sourceOrOwner: "Modeling owner or independent test owner",
        minimumRequiredDetail: "Model version, scenario labels, assumptions, inputs, outputs, calibration basis, and validation status",
        priority: "high",
        workflowContext: "physics",
      },
    ],
    external_sharing: [
      {
        evidenceItem: "External-claim approval list",
        whyItMatters: "It identifies exactly which statements can leave the diligence team.",
        decisionUnlocked: "Customer-safe or investor-safe summary",
        sourceOrOwner: "Diligence lead with technical and commercial owners",
        minimumRequiredDetail: "Claim, source, allowed wording, caveat, prohibited stronger wording, and owner approval",
        priority: "critical",
        workflowContext: "external_sharing",
      },
      {
        evidenceItem: "Private-holdback list",
        whyItMatters: "It prevents internal assumptions from becoming customer or investor claims.",
        decisionUnlocked: "Safe external package boundary",
        sourceOrOwner: "Diligence lead",
        minimumRequiredDetail: "Internal-only assumption, missing proof, risk if shared, and evidence needed to release it",
        priority: "high",
        workflowContext: "external_sharing",
      },
    ],
  };

  return rankEvidenceItems([...workflowItems[workflow], ...shared]);
}

export function renderEvidencePackItems(items: EvidencePackItem[]): string[] {
  return rankEvidenceItems(items).map(
    (item) =>
      `${item.evidenceItem}: ${item.whyItMatters} Decision unlocked: ${item.decisionUnlocked}. Owner/source: ${item.sourceOrOwner}. Minimum detail: ${item.minimumRequiredDetail}`,
  );
}
