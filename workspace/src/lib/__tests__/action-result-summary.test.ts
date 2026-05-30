import { buildActionResultSummary, isChatOnlyArtifact, isSimpleDocumentArtifact } from "@/lib/action-result-summary";
import type { Artifact } from "@/lib/storage/types";

function artifact(
  content: Record<string, unknown>,
  summary = "Artifact summary",
  type: Artifact["type"] = "evaluation",
): Artifact {
  return {
    id: "art_1",
    schema_version: 1,
    type,
    title: "Artifact title",
    summary,
    content,
    source: "canonical_engine",
    raw: {},
    metadata: {},
    action_id: "act_1",
    provenance: { source: "canonical_engine", deterministic: true },
    created_at: "2026-04-28T00:00:00Z",
    pinned: false,
  };
}

describe("buildActionResultSummary", () => {
  it("returns a plain recovery summary when artifact is null", () => {
    const summary = buildActionResultSummary({ actionType: "evidence_evaluation", artifact: null });

    expect(summary).toContain("could not finish the requested tool run");
    expect(summary).toContain("request context is still preserved");
    expect(summary).not.toContain("Action failed");
    expect(summary).not.toContain("did not return a result");
  });

  it("emits Could not complete for evidence_evaluation when n_parameters_fused is zero", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({ evidence_level_metadata: { n_parameters_fused: 0 } }),
    });

    expect(summary).toMatch(/^\*\*Could not complete:\*\*/);
  });

  it("emits Could not complete for evidence_evaluation when verdict is not_ready", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({ verdict: "not_ready" }),
    });

    expect(summary).toMatch(/^\*\*Could not complete:\*\*/);
  });

  it("emits Could not complete when caveats contain Gate 0", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({ caveats: ["[Gate 0] Uploaded documents could not be used"] }),
    });

    expect(summary).toMatch(/^\*\*Could not complete:\*\*/);
  });

  it("emits Could not complete when intakeFailureCaveat is supplied", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({ score: 0.72, evidence_level_metadata: { n_parameters_fused: 14 } }),
      intakeFailureCaveat: "Evidence extraction failed for the uploaded file.",
    });

    expect(summary).toMatch(/^\*\*Could not complete:\*\*/);
  });

  it("emits Result with domain score evidence level and parameter count for successful evidence evaluation", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "small_modular_nuclear",
        evidence_level: "moderate",
        score: 0.72,
        evidence_level_metadata: { n_parameters_fused: 14 },
      }),
    });

    expect(summary).toContain("Evidence evaluation complete (domain small_modular_nuclear, evidence moderate, score 0.72, 14 parameters fused).");
    expect(summary).toContain("The available evidence supports a bounded evidence view with domain small_modular_nuclear");
    expect(summary).toContain("It does not yet establish decision-ready performance");
    expect(summary).toContain("Next, use the fused parameters and evidence gaps");
  });

  it("emits multi-line digest summary with facts and next action and next action", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "small_modular_nuclear",
        evidence_digest: {
          digest_status: "facts_extracted",
          headline_facts: [
            "thermal power mwth: 200 MWth",
            "electric power mwe: 80 MWe",
            "outlet temperature: 750 C",
            "extra fact not shown",
          ],
          confidence_tier_summary: {
            "well-substantiated": 1,
            moderate: 1,
            preliminary: 2,
            unverified: 0,
          },
          actionable_caveats: [
            {
              severity: "warning",
              message: "Investor deck claims require corroboration.",
              suggested_action: "Upload independent test data for the claimed reactor performance.",
            },
          ],
        },
      }),
    });

    expect(summary).toContain("I extracted usable evidence facts for small modular nuclear.");
    expect(summary).toContain("- thermal power mwth: 200 MWth");
    expect(summary).toContain("- electric power mwe: 80 MWe");
    expect(summary).toContain("- outlet temperature: 750 C");
    expect(summary).not.toContain("extra fact not shown");
    expect(summary).not.toContain("Confidence:");
    expect(summary).toContain("Next, Upload independent test data for the claimed reactor performance.");
  });

  it("includes captured table and figure counts when layout evidence is available", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "small_modular_nuclear",
        evidence_digest: {
          digest_status: "facts_extracted",
          headline_facts: ["thermal power mwth: 200 MWth"],
          confidence_tier_summary: { moderate: 1 },
          actionable_caveats: [],
        },
        evidence_layout_summary: {
          n_tables: 3,
          n_images: 2,
        },
      }),
    });

    expect(summary).toContain("Document structure captured: 3 tables, 2 image/figure items.");
  });

  it("surfaces exergy simulation metrics from physics solver output", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "thermochemical_reactor",
        evidence_digest: {
          digest_status: "facts_extracted",
          headline_facts: ["ft reactor temperature: 225 C"],
          confidence_tier_summary: { "well-substantiated": 1 },
          actionable_caveats: [],
        },
        physics_solver: {
          exergy_metrics: {
            exergetic_efficiency: 0.5368,
            first_law_efficiency: 0.51,
            quality_factor: 0.95,
          },
        },
      }),
    });

    expect(summary).toContain("Exergy simulation: exergetic efficiency 53.7%, first-law 51.0%, quality factor 0.95.");
  });

  it("surfaces partial document intake failures without failing the whole result", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "thermochemical_reactor",
        evidence_digest: {
          digest_status: "facts_extracted",
          headline_facts: ["ft reactor temperature: 225 C"],
          confidence_tier_summary: { "well-substantiated": 1 },
          actionable_caveats: [],
        },
        intake_failures: [
          { filename: "oxeon SOEC info sheet rev2.pdf", error: "Could not extract parameters from this document." },
        ],
      }),
    });

    expect(summary).toContain("Partial intake warning: 1 uploaded document could not be used (oxeon SOEC info sheet rev2.pdf).");
  });

  it("turns Exergy Analyst client_summary artifacts into decision-oriented synthesis", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        client_summary: {
          decision: "Act on first-pass prioritization",
          evidence_label: "Useful but bounded",
          confidence: "useful_but_bounded",
          conclusion: "Branch HX-4 has the strongest useful-work signal in the uploaded district-heating data.",
          supported_claims: [
            { claim: "HX-4 is the first branch to inspect.", evidence: "Computed exergy screen" },
          ],
          not_proven: ["The uploaded data does not prove an investment-grade retrofit case."],
          priority_recommendation: {
            title: "Instrument and inspect HX-4 first",
          },
        },
      }),
    });

    expect(summary).toContain("Branch HX-4 has the strongest useful-work signal");
    expect(summary).toContain("Basis: HX-4 is the first branch to inspect.");
    expect(summary).toContain("Important limit: The uploaded data does not prove an investment-grade retrofit case.");
    expect(summary).toContain("Next, Instrument and inspect HX-4 first.");
  });

  it("renders simple document-review summaries without diligence-template labels", () => {
    const docArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      physics_screens: [],
      client_summary: {
        decision: "Use as a triage note",
        evidence_label: "Screening",
        confidence: "screening_grade",
        conclusion: "This is a Fischer-Tropsch technology information sheet.",
        use_case_label: "Document Review, Fischer Tropsch, Synthetic Fuels, Reactor Catalysis",
        computed_metrics: [],
        supported_claims: [
          {
            claim: "This is a Fischer-Tropsch technology information sheet",
            evidence: "local PyMuPDF text extraction extracted 4,648 characters from `Fischer Tropsch information sheet.pdf`. The document describes Fischer-Tropsch synthesis: converting carbon monoxide and hydrogen or syngas into liquid hydrocarbons and waxes over catalysts.",
          },
          {
            claim: "The useful extracted parameters are process-flow and reactor-screening inputs",
            evidence: "It reports laboratory-scale production around 5 GPD; It lists typical synthesis-gas inlet pressure around 300 psi; It lists typical reactor bed temperature around 230 C.",
          },
        ],
        not_proven: [
          "The information sheet does not prove conversion, selectivity, product yield, catalyst life, heat balance, uptime, emissions, scale-up readiness, or plant economics.",
        ],
      },
    });
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: docArtifact,
    });

    expect(isSimpleDocumentArtifact(docArtifact)).toBe(true);
    expect(summary).toContain("This is a Fischer-Tropsch technology information sheet.");
    expect(summary).toContain("What I found:");
    expect(summary).toContain("converting carbon monoxide and hydrogen");
    expect(summary).toContain("5 GPD");
    expect(summary).not.toContain("**Result:**");
    expect(summary).not.toContain("**This is");
    expect(summary).not.toContain("Confidence:");
    expect(summary).not.toContain("What the data can support:");
    expect(summary).not.toContain("Next decision:");
  });

  it("treats SOEC document reviews as simple chat answers", () => {
    const docArtifact = artifact({
        analysis_type: "exergy_agent_assessment",
        physics_screens: [],
        client_summary: {
          decision: "Use as a triage note",
          evidence_label: "Screening",
          confidence: "screening_grade",
          conclusion: "This is an SOEC and high-temperature co-electrolysis information sheet.",
          use_case_label: "Document Review, SOEC, Electrolysis, Synthetic Fuels",
          computed_metrics: [],
          supported_claims: [
            {
              claim: "This is an SOEC and high-temperature co-electrolysis information sheet",
              evidence: "local PyMuPDF text extraction extracted 4,832 characters from `oxeon SOEC info sheet rev2.pdf`. The document describes OxEon solid oxide electrolysis cells operating like a solid oxide fuel cell in reverse.",
            },
            {
              claim: "The useful extracted parameters are SOEC operating and scale-up claims",
              evidence: "It frames SOEC/HTCE as solid oxide fuel cell technology operated in reverse; It states that steam electrolysis uses electricity to produce hydrogen; It states that co-electrolysis of steam and CO2 can produce synthesis gas; It claims about 28 metric tons of H2 per GWh for SOEC; It says the largest unit built at the time was an 18 kWe SOEC unit; It reports about 5000 lph hydrogen production at full capacity for that 18 kWe unit; It reports roughly 1,000 hours in electrolysis mode and roughly 1,000 hours in co-electrolysis mode; It describes twelve stacks, with sixty cells per stack, in the laboratory unit; It states each 60-cell stack would generate about 21 lpm of H2 under current operating parameters.",
            },
          ],
          not_proven: [
            "The information sheet does not prove stack efficiency, degradation rate, thermal balance, scale-up readiness, or economics.",
          ],
        },
    });
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: docArtifact,
    });

    expect(isSimpleDocumentArtifact(docArtifact)).toBe(true);
    expect(summary).toContain("SOEC and high-temperature co-electrolysis information sheet.");
    expect(summary).toContain("What I found:");
    expect(summary).toContain("solid oxide electrolysis cells");
    expect(summary).toContain("steam electrolysis uses electricity");
    expect(summary).toContain("co-electrolysis of steam and CO2");
    expect(summary).toContain("28 metric tons");
    expect(summary).toContain("18 kWe");
    expect(summary).toContain("5000 lph");
    expect(summary).toContain("1,000 hours");
    expect(summary).toContain("twelve stacks");
    expect(summary).toContain("21 lpm");
    expect(summary).not.toContain("**Result:**");
    expect(summary).not.toContain("**This is");
    expect(summary).not.toContain("- This is an SOEC");
    expect(summary).not.toContain("Caveat:");
    expect(summary).not.toContain("Confidence:");
    expect(summary).not.toContain("What the data can support:");
    expect(summary).not.toContain("Next decision:");
  });

  it("treats generic file-intake analysis as a simple chat answer", () => {
    const docArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      physics_screens: [],
      client_summary: {
        decision: "Use as a triage note",
        evidence_label: "Screening",
        confidence: "screening_grade",
        conclusion: "This appears to be a document about an unfamiliar project deck.",
        use_case_label: "File Intake",
        computed_metrics: [],
        supported_claims: [
          {
            claim: "Requested economic and environmental analysis can start from the extracted evidence",
            evidence: "Economic: Commercial assumptions include 64 million USD installed cost. Environmental: Environmental claims include avoided freshwater withdrawal.",
          },
        ],
        not_proven: [
          "The requested analysis is bounded by the available evidence until source-backed units, operating boundaries, baseline/reference case, and independent validation are available.",
        ],
      },
    });
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: docArtifact,
    });

    expect(isSimpleDocumentArtifact(docArtifact)).toBe(true);
    expect(summary).toContain("unfamiliar project deck");
    expect(summary).toContain("64 million USD");
    expect(summary).toContain("avoided freshwater withdrawal");
    expect(summary).not.toContain("Use as a triage note");
    expect(summary).not.toContain("Confidence:");
  });

  it("filters extraction metadata out of simple document chat summaries", () => {
    const docArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      physics_screens: [],
      client_summary: {
        decision: "Use as a triage note",
        evidence_label: "Screening",
        confidence: "screening_grade",
        conclusion: "This appears to be a technical document about SOEC/high-temperature electrolysis.",
        use_case_label: "File Intake, SOEC",
        computed_metrics: [],
        supported_claims: [
          {
            claim: "This appears to be a technical document about SOEC/high-temperature electrolysis",
            evidence: "The extract has about 845 words, 31 non-empty lines, and 5 notable quantitative value(s). Detected signals: SOEC/high-temperature electrolysis. Notable headings: SOEC and HTCE technology. Key extracted points: SOEC produces hydrogen from steam.",
          },
          {
            claim: "The document includes SOEC operating claims",
            evidence: "It claims about 28 metric tons of H2 per GWh for SOEC versus about 21 metric tons per GWh for a low-temperature system.",
          },
        ],
        not_proven: [
          "This is a summary of the readable document text; it does not independently validate embedded claims against test records.",
        ],
      },
    });

    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: docArtifact,
    });

    expect(summary).toContain("technical document about SOEC");
    expect(summary).toContain("28 metric tons");
    // Simple document summaries should not append diligence caveats unless the
    // user asks for validation, economics, or decision-grade analysis.
    expect(summary).not.toContain("Caveat:");
    expect(summary).not.toContain("845 words");
    expect(summary).not.toContain("non-empty lines");
    expect(summary).not.toContain("Detected signals");
    expect(summary).not.toContain("Notable headings");
    expect(summary).not.toContain("Key extracted points");
  });

  it("renders PV production artifacts as plain chat with requested outputs", () => {
    const pvArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      detected_use_cases: ["solar-pv", "photovoltaic"],
      client_summary: {
        decision: "Act on first-pass prioritization",
        evidence_label: "Computed result",
        confidence: "screening_grade",
        conclusion: "At 24.1456 N, 54.5318 E, the engineering estimate is peak module rating 400 W DC, heat-adjusted site peak about 363 W at 50 C cell temperature, average daily generation about 1.903 kWh per module-day, and solar-radiation exergy factor 0.9312.",
        use_case_label: "Solar PV, Photovoltaic",
        computed_metrics: [
          { label: "Peak Power", value: "400 W", note: "Module DC rating from the datasheet." },
          { label: "Site Peak Power", value: "363 W", note: "Temperature-adjusted peak DC output." },
          { label: "Average Daily Generation", value: "1.903 kWh/day", note: "One-module yield estimate." },
          { label: "Exergy Factor", value: "0.931", note: "Petela solar-radiation exergy factor." },
        ],
        supported_claims: [
          {
            claim: "CS3W-MS PV module specifications were extracted from the datasheet",
            evidence: "selected module power 400 W; efficiency 20.16%; Pmax temperature coefficient -0.37%/C; Voc 47.2 V; Isc 11 A; area 1.984 m2; 144 cells",
          },
        ],
        not_proven: ["This engineering estimate does not use a TMY weather file."],
      },
    });

    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: pvArtifact,
    });

    expect(isChatOnlyArtifact(pvArtifact, "evidence_evaluation")).toBe(true);
    expect(summary).toContain("peak module rating 400 W DC");
    expect(summary).toContain("Estimated output per module:");
    expect(summary).toContain("Peak power: 400 W STC; about 363 W");
    expect(summary).toContain("Average daily generation: 1.903 kWh/day");
    expect(summary).toContain("Exergy factor: 0.931");
    expect(summary).toContain("What I used from the datasheet:");
    expect(summary).toContain("efficiency 20.16%");
    expect(summary).not.toContain("**Result:**");
    expect(summary).not.toContain("What it cannot prove");
    expect(summary).not.toContain("Caveat:");
  });

  it("renders power plant artifacts as plain chat with economics and emissions metrics", () => {
    const plantArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      detected_use_cases: ["power-plant", "thermal-generation", "plant-performance"],
      client_summary: {
        decision: "Act on first-pass prioritization",
        evidence_label: "Computed result",
        confidence: "screening_grade",
        conclusion: "A natural-gas combined-cycle plant performance basis was extracted. A plant-performance calculation is now available.",
        use_case_label: "Power Plant, Thermal Generation, Plant Performance",
        computed_metrics: [
          { label: "Net Capacity", value: "620 MW" },
          { label: "Net Heat Rate", value: "6600 Btu/kWh" },
          { label: "Net Efficiency", value: "51.7%" },
          { label: "Capacity Factor", value: "65%" },
          { label: "Annual Generation", value: "3528.78 GWh/year" },
          { label: "Gas Price", value: "$4.25/MMBtu" },
          { label: "Fuel Cost", value: "$28.05/MWh" },
          { label: "Power Price", value: "$62/MWh" },
          { label: "Spark Spread", value: "$33.95/MWh" },
          { label: "CO2 Intensity", value: "0.3502 t/MWh" },
          { label: "Annual CO2", value: "1235696 t/year" },
        ],
      },
    });

    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: plantArtifact,
    });

    expect(isChatOnlyArtifact(plantArtifact, "evidence_evaluation")).toBe(true);
    expect(summary).toContain("Estimated plant output:");
    expect(summary).toContain("Net capacity: 620 MW");
    expect(summary).toContain("Heat rate / efficiency: 6600 Btu/kWh / 51.7%");
    expect(summary).toContain("Fuel cost: USD 28.05/MWh using USD 4.25/MMBtu gas");
    expect(summary).toContain("Spark spread: USD 33.95/MWh against USD 62/MWh power");
    expect(summary).toContain("CO2: 0.3502 t/MWh; annual CO2 1235696 t/year");
    expect(summary).not.toContain("View Details");
    expect(summary).not.toContain("**Result:**");
  });

  it("renders literature search artifacts as plain chat answers without report labels", () => {
    const researchArtifact = artifact({
      executive_summary: "The lowest listed solar panel prices are usually found on large-format surplus or pallet listings, so single-panel delivered cost can differ materially after freight.",
      findings: [
        { statement: "Large 400 W+ monocrystalline modules often have the lowest before-shipping $/W." },
        { statement: "Source needed: Shipping can dominate the economics for one or two panels." },
      ],
      limitations: ["Live inventory and shipping must be checked at checkout."],
    }, "Research complete", "research");

    const summary = buildActionResultSummary({
      actionType: "literature_search",
      artifact: researchArtifact,
    });

    expect(isChatOnlyArtifact(researchArtifact, "literature_search")).toBe(true);
    expect(summary).toContain("lowest listed solar panel prices");
    expect(summary).toContain("Large 400 W+ monocrystalline modules");
    expect(summary).toContain("Shipping can dominate");
    expect(summary).toContain("Note: Live inventory");
    expect(summary).not.toContain("**Result:**");
    expect(summary).not.toContain("Literature search complete");
    expect(summary).not.toContain("Key finding:");
    expect(summary).not.toContain("Source needed");
  });

  it("renders general economics solver artifacts as compact chat output", () => {
    const econArtifact = artifact({
      analysis_type: "exergy_agent_assessment",
      solver_result: {
        solver_type: "economics",
        executive_summary: "I computed an economics case from the supplied values.",
        computed_metrics: [
          { label: "Annual generation", value: "3,530.28", unit: "GWh/year" },
          { label: "Fuel cost", value: "28.05", unit: "USD/MWh" },
          { label: "Spark spread", value: "33.95", unit: "USD/MWh" },
          { label: "NPV", value: "120.5", unit: "USD million" },
        ],
        assumptions: ["Discount rate assumed at 8% because no WACC/discount rate was supplied."],
        missing_inputs: ["debt structure and tax assumptions"],
      },
      client_summary: {
        decision: "Economics Solver complete",
        conclusion: "I computed an economics case from the supplied values.",
      },
    });

    const summary = buildActionResultSummary({
      actionType: "economics_analysis",
      artifact: econArtifact,
    });

    expect(isChatOnlyArtifact(econArtifact, "economics_analysis")).toBe(true);
    expect(summary).toContain("Computed economics:");
    expect(summary).toContain("Fuel cost: 28.05 USD/MWh");
    expect(summary).toContain("Missing inputs that would improve this:");
    expect(summary).not.toContain("View Details");
    expect(summary).not.toContain("**Result:**");
  });

  it("appends blocker suggested action for digest no-extracted-facts failures", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        evidence_digest: {
          digest_status: "no_extracted_facts",
          headline_facts: [],
          confidence_tier_summary: {
            "well-substantiated": 0,
            moderate: 0,
            preliminary: 0,
            unverified: 0,
          },
          actionable_caveats: [
            {
              severity: "blocker",
              message: "No usable technical facts were extracted.",
              suggested_action: "Upload a text-searchable datasheet PDF.",
            },
          ],
        },
      }),
    });

    expect(summary).toMatch(/^\*\*Could not complete:\*\*/);
    expect(summary).toContain("No usable technical facts were extracted.");
    expect(summary).toContain("Upload a text-searchable datasheet PDF.");
  });

  it("adds support and caveat boundaries when evidence digest is absent", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "small_modular_nuclear",
        evidence_level: "moderate",
        score: 0.72,
        evidence_level_metadata: { n_parameters_fused: 14 },
      }),
    });

    expect(summary).toContain("Evidence evaluation complete (domain small_modular_nuclear, evidence moderate, score 0.72, 14 parameters fused).");
    expect(summary).toContain("The available evidence supports a bounded evidence view with domain small_modular_nuclear");
  });

  it("adds layout summary to legacy evidence summary when present", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        domain: "small_modular_nuclear",
        evidence_level: "moderate",
        score: 0.72,
        evidence_level_metadata: { n_parameters_fused: 14 },
        evidence_layout_summary: { n_tables: 1, n_images: 0 },
      }),
    });

    expect(summary).toContain("Evidence evaluation complete");
    expect(summary).toContain("Document structure captured: 1 table.");
  });

  it("sanitizes internal model names from digest summary strings", () => {
    const summary = buildActionResultSummary({
      actionType: "evidence_evaluation",
      artifact: artifact({
        evidence_digest: {
          digest_status: "facts_extracted",
          headline_facts: ["deepseek extracted a reactor claim"],
          confidence_tier_summary: {
            "well-substantiated": 0,
            moderate: 1,
            preliminary: 0,
            unverified: 0,
          },
          actionable_caveats: [
            {
              severity: "info",
              message: "oracle label should not leak",
              suggested_action: "Ask oracle to verify the claim.",
            },
          ],
        },
      }),
    });

    expect(summary).toContain("analysis engine extracted a reactor claim");
    expect(summary).toContain("Ask analysis engine to verify the claim.");
    expect(summary).not.toMatch(/deepseek|oracle|intern|s1\.pro/i);
  });

  it("emits Result line for simulation_run using artifact summary", () => {
    const summary = buildActionResultSummary({
      actionType: "simulation_run",
      artifact: artifact({}, "Pmax 420 W | efficiency 21%"),
    });

    expect(summary).toBe("Pmax 420 W | efficiency 21%");
  });

  it("summarizes physics solver metrics with confidence, caveat, and next decision", () => {
    const summary = buildActionResultSummary({
      actionType: "physics_simulation",
      artifact: artifact({
        physics_solver: {
          output_metrics: {
            pmax_w: 420,
            efficiency_pct: 21.4,
          },
          solver_assumptions: ["Steady-state operation at supplied irradiance and temperature."],
        },
      }, "PV simulation", "simulation"),
    });

    expect(summary).toContain("PMAX W=420; efficiency pct=21.4.");
    expect(summary).toContain("Important limit: Solver assumption: Steady-state operation");
    expect(summary).toContain("Next, Compare the computed outputs against measured operating data");
  });

  it("summarizes deep analysis findings instead of returning artifact title only", () => {
    const summary = buildActionResultSummary({
      actionType: "deep_analysis",
      artifact: artifact({
        key_findings: ["The economics remain utilization-sensitive because feedstock and operating-hour evidence is incomplete."],
        confidence_assessment: "Moderate for direction, low for finance calculations.",
        risks: ["No committed CAPEX, utilization, or product-price basis was supplied."],
        recommended_actions: ["Collect dated CAPEX, OPEX, utilization, and product price assumptions before calculating NPV."],
      }, "Deep analysis artifact", "deep_analysis"),
    });

    expect(summary).toContain("The economics remain utilization-sensitive");
    expect(summary).toContain("Important limit: No committed CAPEX");
    expect(summary).toContain("Next, Collect dated CAPEX");
  });

  it("returns the workspace report markdown as the chat answer", () => {
    const report = [
      "# Pilot Scale Analysis",
      "",
      "The recommended pilot scale is the smallest continuously operated train that closes the mass and energy balance.",
      "",
      "| Case | Daily production |",
      "|---|---:|",
      "| Base | 12 bpd |",
    ].join("\n");
    const art = artifact({
      analysis_type: "agent_workspace",
      report_markdown: report,
      client_summary: {
        decision: "Workspace run complete",
        conclusion: "Short fallback summary that should not replace the full report.",
      },
    }, "Workspace run complete", "workspace_run");

    const summary = buildActionResultSummary({ actionType: "agent_workspace", artifact: art });
    expect(summary).toContain(report);
    expect(summary).toContain("## Important Limits");
    expect(isChatOnlyArtifact(art, "agent_workspace")).toBe(true);
  });

  it("inlines a small CSV preview when a workspace report only links to the table", () => {
    const report = [
      "# Scenario Results",
      "",
      "See scenario_table.csv for the computed scenario comparison.",
    ].join("\n");
    const art = artifact({
      analysis_type: "agent_workspace",
      report_markdown: report,
      files: [
        {
          filename: "scenario_table.csv",
          preview: "Case,Cost,Conclusion\nBase,100,High\nLow power,80,Improved\n",
        },
      ],
    }, "Workspace run complete", "workspace_run");

    const summary = buildActionResultSummary({ actionType: "agent_workspace", artifact: art });

    expect(summary).toContain("## Results Table");
    expect(summary).toContain("| Case | Cost | Conclusion |");
    expect(summary).toContain("| Low power | 80 | Improved |");
  });

  it("replaces unresolved table placeholders with a CSV preview", () => {
    const art = artifact({
      analysis_type: "agent_workspace",
      report_markdown: "# Simulation\n\n## Results\n\n{table_md}",
      files: [
        {
          filename: "simulation_results.csv",
          preview: "Metric,Value,Unit\nPeak DC,407,W\nDaily AC,2.33,kWh\n",
        },
      ],
    }, "Workspace run complete", "workspace_run");

    const summary = buildActionResultSummary({ actionType: "agent_workspace", artifact: art });

    expect(summary).not.toContain("{table_md}");
    expect(summary).toContain("| Metric | Value | Unit |");
    expect(summary).toContain("| Daily AC | 2.33 | kWh |");
  });

  it("strips workspace process and sidecar details from chat-facing reports", () => {
    const report = [
      "# Analysis Run",
      "",
      "## Direct Answer",
      "Use a 10-25 BPD integrated pilot before scaling to qualification volume.",
      "",
      "## Uploaded Files",
      "- doc_177_test_Fischer Tropsch information sheet.pdf (151340 bytes)",
      "- doc_177_test_Fischer Tropsch information sheet.pdf.mineru.md (5019 bytes)",
      "- doc_177_test_Fischer Tropsch information sheet.pdf.gemini.json (5019 bytes)",
      "",
      "## Extracted Numeric Inputs",
      "| Value | Unit | Context |",
      "|---:|---|---|",
      "| 300 | psi | raw parser context |",
      "",
      "## Economics Model",
      "Breakeven daily production depends on annualized fixed cost and contribution margin.",
      "",
      "## Execution Notes",
      "Outputs collected: 4.",
      "- Open the process details to inspect generated code, logs, and output files.",
    ].join("\n");
    const art = artifact({
      analysis_type: "agent_workspace",
      report_markdown: report,
    }, "Workspace run complete", "workspace_run");

    const summary = buildActionResultSummary({ actionType: "agent_workspace", artifact: art });

    expect(summary).toContain("10-25 BPD");
    expect(summary).toContain("Breakeven daily production");
    expect(summary).not.toMatch(/Uploaded Files|Extracted Numeric Inputs|Execution Notes|\.(?:mineru|gemini)|doc_177|Open the process details|Outputs collected/i);
  });

  it("sanitizes internal model names in returned strings", () => {
    const summary = buildActionResultSummary({
      actionType: "simulation_run",
      artifact: artifact({}, "deepseek failed and oracle fallback failed"),
    });

    expect(summary).toContain("analysis engine failed");
    expect(summary).not.toMatch(/deepseek|oracle/i);
  });
});
