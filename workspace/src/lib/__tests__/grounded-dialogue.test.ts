import { buildGroundedHistoryResponse, buildGroundedWorkspaceResponse } from "@/lib/grounded-dialogue";
import type { Artifact, ArtifactSummary, Project, StorageAdapter } from "@/lib/storage/types";

const project: Project = {
  id: "p1",
  name: "PV follow-up",
  description: "",
  goal: "",
  domain: "general",
  created_at: "2026-05-23T00:00:00.000Z",
  updated_at: "2026-05-23T00:00:00.000Z",
};

function artifact(content: Record<string, unknown>): Artifact {
  return {
    id: "a1",
    schema_version: 1,
    type: "evaluation",
    title: "PV module site-production estimate",
    summary: "PV estimate",
    content,
    source: "canonical_engine",
    raw: {},
    metadata: {},
    action_id: "act1",
    provenance: { source: "canonical_engine", deterministic: true },
    created_at: "2026-05-23T00:00:00.000Z",
    pinned: false,
  };
}

function workspaceRunArtifact(report: string): Artifact {
  return {
    ...artifact({
      analysis_type: "agent_workspace",
      report_markdown: report,
      client_summary: {
        decision: "Workspace run complete",
        conclusion: "Pilot scale analysis complete.",
      },
    }),
    type: "workspace_run",
    title: "Workspace run",
    summary: "Pilot scale analysis complete.",
  };
}

function storageFor(fullArtifact: Artifact): StorageAdapter {
  const summary: ArtifactSummary = {
    id: fullArtifact.id,
    type: fullArtifact.type,
    title: fullArtifact.title,
    summary: fullArtifact.summary,
    source: fullArtifact.source,
    created_at: fullArtifact.created_at,
    pinned: false,
  };
  return {
    listArtifacts: jest.fn(async () => [summary]),
    getArtifact: jest.fn(async () => fullArtifact),
    listDocuments: jest.fn(async () => []),
  } as unknown as StorageAdapter;
}

describe("buildGroundedWorkspaceResponse", () => {
  it("scales metrics from recent chat history when artifact indexing lags", () => {
    const response = buildGroundedHistoryResponse({
      message: "Now scale this up to 1,000,000 of these modules. What power output would that get me and what inverter would you recommend?",
      history: [
        {
          role: "assistant",
          content: [
            "CS3W-MS PV module specifications were extracted from the datasheet. Estimated output per module:",
            "- Peak power: 400 W STC; about 363 W temperature-adjusted at the site peak condition.",
            "- Average daily generation: 1.903 kWh/day per module, or about 694.7 kWh/year.",
          ].join("\n"),
        },
      ],
    });

    expect(response?.type).toBe("response");
    expect(response?.workflow_orchestration).toMatchObject({ reason: "grounded_scaled_metric_followup" });
    expect(response?.content).toContain("Scaled to 1,000,000 units");
    expect(response?.content).toContain("400 MW");
    expect(response?.content).toContain("363 MW");
    expect(response?.content).toContain("1.903 GWh/day");
    expect(response?.content).toMatch(/central inverter/i);
  });

  it("scales metrics from internal evaluation history before the UI transcript is saved", () => {
    const response = buildGroundedHistoryResponse({
      message: "Now scale this up to 1,000,000 of these modules. What power output would that get me and what inverter would you recommend?",
      history: [
        {
          role: "assistant",
          content: [
            "[Evaluation result]",
            "Strengths: CS3W-MS PV module specifications were extracted from the datasheet: selected module power 400 W; efficiency 20.16%; Pmax temperature coefficient -0.37%/C; Voc 47.2 V.",
            "PV production estimate for the requested location: At 24.1456 N, 54.5318 E, the engineering estimate is peak module rating 400 W DC, heat-adjusted site peak about 363 W at 50 C cell temperature, average daily generation about 1.903 kWh per module-day (694.7 kWh/year), and solar-radiation exergy factor 0.9312.",
          ].join("\n"),
        },
        {
          role: "assistant",
          content: "I’ll work on this request and use the best available workspace path.",
        },
      ],
    });

    expect(response?.type).toBe("response");
    expect(response?.content).toContain("Scaled to 1,000,000 units");
    expect(response?.content).toContain("Peak Power: 400 MW total");
    expect(response?.content).toContain("Site Peak Power: 363 MW total");
    expect(response?.content).toContain("Average Daily Generation: 1.903 GWh/day total");
  });

  it("scales prior computed metrics instead of rerunning the same document analysis", async () => {
    const pv = artifact({
      client_summary: {
        conclusion: "CS3W-435MS PV module specifications were extracted from the datasheet.",
        use_case_label: "Solar PV, Photovoltaic",
        computed_metrics: [
          { label: "Peak Power", value: "435 W" },
          { label: "Site Peak Power", value: "396.94 W" },
          { label: "Average Daily Generation", value: "2.07 kWh/day" },
          { label: "Exergy Factor", value: "0.931" },
        ],
      },
    });

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "Now can you scale this up to 1,000,000 of these modules? What power output would that get me and what inverter would you recommend for this PV plant?",
      project,
      storage: storageFor(pv),
    });

    expect(response?.type).toBe("response");
    expect(response?.workflow_orchestration).toMatchObject({ reason: "grounded_scaled_metric_followup" });
    expect(response?.content).toContain("435 MW");
    expect(response?.content).toContain("396.94 MW");
    expect(response?.content).toContain("2.07 GWh/day");
    expect(response?.content).toContain("348 MWac");
    expect(response?.content).toMatch(/central inverter/i);
  });

  it("uses the same scaling path for non-PV computed metrics", async () => {
    const processArtifact = artifact({
      client_summary: {
        conclusion: "One-unit process screen.",
        use_case_label: "Industrial process",
        computed_metrics: [
          { label: "Thermal Output", value: "12 kW" },
          { label: "Daily Energy", value: "48 kWh/day" },
          { label: "Efficiency", value: "72%" },
        ],
      },
    });

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "Scale this to 10 units. What output does that get me?",
      project,
      storage: storageFor(processArtifact),
    });

    expect(response?.type).toBe("response");
    expect(response?.content).toContain("120 kW");
    expect(response?.content).toContain("480 kWh/day");
    expect(response?.content).not.toContain("720%");
  });

  it("answers power plant economics follow-ups from the prior artifact", async () => {
    const plant = artifact({
      client_summary: {
        conclusion: "A natural-gas combined-cycle plant performance basis was extracted.",
        use_case_label: "Power Plant, Thermal Generation, Plant Performance",
        computed_metrics: [
          { label: "Net Capacity", value: "620 MW" },
          { label: "Net Heat Rate", value: "6600 Btu/kWh" },
          { label: "Capacity Factor", value: "65%" },
          { label: "Gas Price", value: "$4.25/MMBtu" },
          { label: "Power Price", value: "$62/MWh" },
          { label: "CO2 Intensity", value: "0.3502 t/MWh" },
        ],
      },
    });

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "What if gas is $5/MMBtu and capacity factor is 70%? What does that do to annual generation, fuel cost, spark spread, and CO2?",
      project,
      storage: storageFor(plant),
    });

    expect(response?.type).toBe("response");
    expect(response?.workflow_orchestration).toMatchObject({ reason: "grounded_energy_plant_followup" });
    expect(response?.content).toContain("3,801.8 GWh/year");
    expect(response?.content).toContain("USD 33/MWh");
    expect(response?.content).toContain("USD 29/MWh");
    expect(response?.content).toContain("1,331,");
    expect(response?.content).not.toContain("Scaled to 5 units");
  });

  it("answers workspace-run report follow-ups from the latest report instead of generic exergy ranking language", async () => {
    const report = [
      "# Analysis Result",
      "",
      "## Simulation model to run",
      "- Normalize production to daily output at a defined capacity factor.",
      "- Compute electricity intensity, feedstock intensity, FT conversion, and exergy efficiency.",
      "",
      "## Economics model",
      "Breakeven daily production = (annualized CAPEX + fixed OPEX) / ((product price - variable cost per unit) x operating days).",
      "",
      "## Recommendation",
      "Use the smallest continuously operated pilot train that can prove integrated operation.",
      "",
      "## Inputs needed for the next numeric answer",
      "- Installed CAPEX by subsystem",
      "- Electricity price and capacity factor",
      "- SOEC power draw and FT selectivity",
    ].join("\n");

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "Show the assumptions driving the recommendation",
      project,
      storage: storageFor(workspaceRunArtifact(report)),
    });

    expect(response?.workflow_orchestration).toMatchObject({ reason: "report_followup_from_latest_artifact" });
    expect(response?.content).toContain("Pilot economics are dominated");
    expect(response?.content).toContain("Breakeven daily production");
    expect(response?.content).toContain("SOEC power draw");
    expect(response?.content).not.toMatch(/branch|hydraulic|district/i);
  });

  it("uses domain-specific evidence requests instead of waste-heat fallback requests for non-thermal packages", async () => {
    const processPackage = artifact({
      client_summary: {
        conclusion: "The documents describe an SOEC/HTCE plus Fischer-Tropsch synthetic fuel pathway.",
        use_case_label: "Document Review, Syngas To Liquids, Synthetic Fuels, Solid Oxide Electrolysis, Industrial Waste Heat",
        supported_claims: [
          {
            claim: "The package includes SOEC/HTCE and FT reactor information.",
            evidence: "The files mention syngas, co-electrolysis, FT conversion, and reactor operating conditions.",
          },
        ],
        data_requests: [
          {
            request: "Collect flow rate, duty cycle, operating-hours, contamination/fouling constraints, and temperature stability for the top-ranked stream.",
            why_it_matters: "Determines whether the apparent useful-work source is recoverable in real plant operation.",
          },
        ],
        recommended_actions: [
          {
            action: "Request the source stack test report with feed composition, steam/CO2 utilization, current density, cell voltage, product composition, runtime, and degradation rate.",
          },
          {
            action: "Request the source FT test report with syngas composition, CO conversion, H2/CO ratio, product selectivity, product distribution, runtime, and uncertainty.",
          },
        ],
        not_proven: [
          "The package does not independently prove stack durability or FT catalyst life.",
        ],
      },
    });

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "What are the biggest gaps in the evidence?",
      project,
      storage: storageFor(processPackage),
    });

    expect(response?.workflow_orchestration).toMatchObject({ reason: "grounded_evidence_gap_answer" });
    expect(response?.content).toContain("source stack test report");
    expect(response?.content).toContain("source FT test report");
    expect(response?.content).not.toMatch(/top-ranked stream|nearby heat demands|hydraulic|branch/i);
  });

  it("answers where-is-the-answer follow-ups from the latest workspace report", async () => {
    const report = [
      "# Analysis Result",
      "",
      "## Direct Answer",
      "The recommended first integrated pilot scale is 10-25 BPD because it balances operating learning against first-of-a-kind CAPEX.",
      "",
      "## Pilot-Scale Simulation",
      "The 10 BPD case requires about 1.25 MW average electric load at 3.0 MWh/bbl.",
      "",
      "## Economics Model",
      "The base case contribution margin is about USD 65/bbl.",
      "",
      "## Scale Recommendation",
      "Start with 10-25 BPD, then expand to 50 BPD only after measured uptime and selectivity are stable.",
    ].join("\n");

    const response = await buildGroundedWorkspaceResponse({
      projectId: project.id,
      message: "Okay where's the answer?",
      project,
      storage: storageFor(workspaceRunArtifact(report)),
    });

    expect(response?.workflow_orchestration).toMatchObject({ reason: "report_followup_from_latest_artifact" });
    expect(response?.content).toContain("10-25 BPD");
    expect(response?.content).toContain("1.25 MW");
    expect(response?.content).toContain("USD 65/bbl");
    expect(response?.content).not.toMatch(/I don't see a previous question/i);
  });
});
