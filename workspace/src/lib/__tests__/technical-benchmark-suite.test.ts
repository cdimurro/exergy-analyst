import { evaluateAgentQuality } from "@/lib/agent-quality-evaluator";
import { buildTechnicalDomainGuidance, detectTechnicalDomainAdapters } from "@/lib/technical-domain-adapters";
import { workspaceConsistencyFindings } from "@/lib/agent-workspace-runner";

describe("technical benchmark suite", () => {
  it("detects relevant lightweight adapters without requiring full domain rewrites", () => {
    const guidance = buildTechnicalDomainGuidance(
      "Evaluate a data center gas turbine transformer architecture, NMC 811 cathode readiness, hydrogen electrolysis, heat pump COP, and LCOE.",
    );

    expect(detectTechnicalDomainAdapters(guidance).length).toBeGreaterThanOrEqual(5);
    expect(guidance).toContain("Universal technical checks");
    expect(guidance).toContain("gas_turbine_derated_capacity");
    expect(guidance).toContain("battery_areal_metrics");
    expect(guidance).toContain("hydrogen_electrolyzer_metrics");
    expect(guidance).toContain("carnot_heat_pump_cop");
    expect(buildTechnicalDomainGuidance("chemical reactor conversion pressure vessel pump carbon capture semiconductor bioreactor aircraft nuclear").length).toBeGreaterThan(2000);
    expect(buildTechnicalDomainGuidance("unknown deep tech field").toLowerCase()).toContain("temporary domain pack");
    expect(buildTechnicalDomainGuidance("unknown deep tech field")).toContain("discover_open_source_tools");
    expect(guidance).toContain("technical_checks");
  });

  it("runs five hard technical benchmark prompts through deterministic quality checks", () => {
    const dataCenterFindings = workspaceConsistencyFindings(
      "N+1 availability is excellent at 97.31%, and the architecture should proceed with conditions.",
      {
        metrics: {
          total_load_mw: 219.6,
          hot_total_mw: 187.1,
          n2_hot_plus_grid_firm_mw: 199.7,
          prob_n_plus_1: 0.9731,
        },
      },
      "Hard prompt 1: data center behind-the-meter gas turbine and transformer architecture with five-nines target.",
    ).join("\n");
    expect(dataCenterFindings).toContain("Hot-day all-unit generation");
    expect(dataCenterFindings).toContain("five-nines-class data-center reliability");

    const battery = evaluateAgentQuality({
      prompt: "Hard prompt 2: NMC 811 cathode readiness. Specs: 245 Wh/kg, 200 mAh/g, 1200 cycles to 80%, 3C charge, 25 mg/cm2 loading, EV and grid storage.",
      finalAnswer: "This NMC 811 cathode is commercially ready and competitive for grid storage. The 200 mAh/g at 1C claim is routine, and the 245 Wh/kg benchmark is favorable.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(battery.findings.map((item) => item.type)).toEqual(expect.arrayContaining([
      "technical_battery_grid_cycle_life_overclaim",
      "technical_battery_high_areal_current_missing",
    ]));

    const hydrogen = evaluateAgentQuality({
      prompt: "Hard prompt 3: green hydrogen electrolyzer with specific energy 28 kWh/kg H2 and 115% efficiency.",
      finalAnswer: "The electrolyzer is feasible, efficient, and ready for deployment at 28 kWh/kg H2 with 115% efficiency.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(hydrogen.findings.map((item) => item.type)).toEqual(expect.arrayContaining([
      "technical_hydrogen_specific_energy_below_lhv",
      "technical_hydrogen_efficiency_above_100",
    ]));

    const heatPump = evaluateAgentQuality({
      prompt: "Hard prompt 4: industrial heat pump with source temperature 5 C, sink temperature 80 C, and COP 7.",
      finalAnswer: "The COP 7 heat pump is feasible and suitable for the stated source and sink temperatures.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(heatPump.findings.map((item) => item.type)).toContain("technical_heat_pump_cop_above_carnot");

    const generation = evaluateAgentQuality({
      prompt: "Hard prompt 5: generation model with 1 MW nameplate capacity and annual generation 10000 MWh per year.",
      finalAnswer: "The 1 MW generator can credibly produce 10,000 MWh per year under this operating plan.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(generation.findings.map((item) => item.type)).toContain("technical_generation_capacity_factor_above_100");
  });

  it("turns failed generated technical checks into repair-blocking findings", () => {
    const findings = workspaceConsistencyFindings(
      "The model result is verified and ready to use.",
      {
        technical_checks: [
          {
            name: "mass balance",
            passed: false,
            observed_value: "outputs exceed inputs by 18%",
            implication: "material conservation failed",
          },
        ],
      },
      "Evaluate a chemical process mass balance.",
    );

    expect(findings.join("\n")).toContain("Generated technical check failed");
    expect(findings.join("\n")).toContain("mass balance");
  });

  it("requires source-first context and universal technical checks for benchmark-sensitive work", () => {
    const sourceFindings = workspaceConsistencyFindings(
      "This is commercially ready and compares well to published benchmarks.",
      { metrics: { readiness_score: 0.8 } },
      "Compare this unfamiliar material to published benchmarks and standards for deployment readiness.",
    ).join("\n");

    expect(sourceFindings).toContain("does not expose a source/domain context");
    expect(sourceFindings).toContain("did not include technical_checks");

    const metaFindings = workspaceConsistencyFindings(
      "The process result is feasible.",
      {
        outputs: {
          capture_efficiency_percent: 125,
        },
        technical_checks: [
          { name: "unit check", passed: true, observed_value: "units reconciled" },
        ],
      },
      "Evaluate carbon capture process performance.",
    ).join("\n");

    expect(metaFindings).toContain("appears above the ordinary 0-100 bound");
  });

  it("catches first-principles failures across process, structural, fluids, and carbon-capture fields", () => {
    const process = evaluateAgentQuality({
      prompt: "Evaluate chemical reactor scale-up with conversion 108% and product yield 103%.",
      finalAnswer: "The reactor is feasible and ready for scale-up with conversion 108% and yield 103%.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(process.findings.map((item) => item.type)).toContain("technical_fraction_metric_above_100");

    const structural = evaluateAgentQuality({
      prompt: "Evaluate a pressure vessel with pressure 80 bar, radius 1.2 m, wall thickness 8 mm, allowable stress 180 MPa. Applied stress 240 MPa and yield strength 200 MPa.",
      finalAnswer: "The mechanical design is acceptable and suitable for deployment.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(structural.findings.map((item) => item.type)).toEqual(expect.arrayContaining([
      "technical_stress_exceeds_allowable",
      "technical_pressure_vessel_hoop_stress_exceeds_allowable",
    ]));

    const fluids = evaluateAgentQuality({
      prompt: "Evaluate pump selection for flow rate 0.5 m3/s, head 80 m, pump power 200 kW.",
      finalAnswer: "The pump is feasible and the motor power is acceptable.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(fluids.findings.map((item) => item.type)).toContain("technical_pump_power_below_hydraulic_minimum");

    const carbonCapture = evaluateAgentQuality({
      prompt: "Evaluate carbon capture with inlet CO2 100 tonnes/day and captured CO2 120 tonnes/day.",
      finalAnswer: "The carbon capture system is viable and ready with captured CO2 exceeding the target.",
      sourceTexts: [],
      requiresTool: true,
    });
    expect(carbonCapture.findings.map((item) => item.type)).toContain("technical_carbon_capture_mass_balance_violation");
  });
});
