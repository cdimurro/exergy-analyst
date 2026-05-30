import {
  FIRST_PRINCIPLES_SOLVER_FAMILIES,
  collectSolverParams,
  extractWasteHeatStreams,
  runEconomicsSolver,
  runHeatRecoveryRankingSolver,
  runPhysicsSolver,
} from "@/lib/engineering-solvers";

describe("engineering-solvers", () => {
  it("extracts common economics values from natural language", () => {
    const params = collectSolverParams({
      question: "620 MW CCGT, heat rate 6600 Btu/kWh, capacity factor 65%, gas price $4.25/MMBtu, merchant power price $62/MWh.",
    });

    expect(params.capacity_mw).toBe(620);
    expect(params.capacity_kw).toBe(620000);
    expect(params.heat_rate_btu_per_kwh).toBe(6600);
    expect(params.capacity_factor_pct).toBe(65);
    expect(params.fuel_price_per_mmbtu).toBe(4.25);
    expect(params.electricity_price_per_mwh).toBe(62);
  });

  it("computes plant economics from supplied values", () => {
    const result = runEconomicsSolver({
      question: "620 MW plant, heat rate 6600 Btu/kWh, capacity factor 65%, gas price $4.25/MMBtu, merchant power price $62/MWh, CAPEX $700 million, OPEX $15/kW-year, WACC 8%, lifetime 25 years.",
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "Annual generation",
      "Fuel cost",
      "Spark spread",
      "Levelized cost",
      "NPV",
      "IRR",
    ]));
    expect(result.computed_metrics.find((metric) => metric.label === "Fuel cost")?.raw_value).toBeCloseTo(28.05, 2);
    expect(result.computed_metrics.find((metric) => metric.label === "Annual generation")?.raw_value).toBeCloseTo(3530.28, 2);
  });

  it("flags non-physical physics inputs but accepts unusual-but-valid ones", () => {
    const bad = runPhysicsSolver({ params: { heat_kw: -50, hot_temp_c: 200, efficiency_pct: 140 } });
    expect(bad.limitations.join(" ")).toMatch(/heat .* is negative/i);
    expect(bad.limitations.join(" ")).toMatch(/efficiency .* outside the admissible 0 to 100/i);
    // A poor-but-valid COP must not be flagged as non-physical.
    const cop = runPhysicsSolver({ params: { heat_kw: 100, cop: 0.4, hot_temp_c: 50, cold_temp_c: 5 } });
    expect(cop.limitations.some((l) => /not physical|outside the admissible/i.test(l))).toBe(false);
  });

  it("computes general thermal exergy and heat-pump second-law metrics", () => {
    const result = runPhysicsSolver({
      question: "Heat pump delivers heat 120 kW with COP 3.5, hot temperature 60 C, cold temperature 10 C, reference temperature 25 C.",
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "Thermal exergy",
      "Electric input",
      "Second-law efficiency",
      "Carnot COP",
    ]));
  });

  it("advertises broad first-principles solver family coverage", () => {
    expect(FIRST_PRINCIPLES_SOLVER_FAMILIES).toEqual(expect.arrayContaining([
      "heat-exchanger LMTD/UA sizing",
      "electrolysis Faraday and specific-energy balances",
      "carbon capture energy and net-avoidance balances",
      "reactor conversion/selectivity/yield mass balance",
      "wind rotor power",
    ]));
  });

  it("computes electrolysis production from first-principles energy balance", () => {
    const result = runPhysicsSolver({
      params: {
        electric_power_kw: 1000,
        specific_energy_kwh_per_kg_h2: 50,
      },
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "Hydrogen production",
      "Electrolyzer LHV efficiency",
      "Water feed consumption",
      "Oxygen byproduct",
    ]));
    expect(result.computed_metrics.find((metric) => metric.label === "Hydrogen production")?.raw_value).toBeCloseTo(20, 3);
  });

  it("computes heat-exchanger LMTD and required area", () => {
    const result = runPhysicsSolver({
      params: {
        heat_kw: 500,
        hot_in_temp_c: 180,
        hot_out_temp_c: 100,
        cold_in_temp_c: 25,
        cold_out_temp_c: 80,
        overall_u_w_m2_k: 600,
      },
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "Heat-exchanger LMTD",
      "Required heat-transfer area",
      "Heat-exchanger effectiveness",
    ]));
    expect(result.computed_metrics.find((metric) => metric.label === "Required heat-transfer area")?.raw_value).toBeGreaterThan(5);
  });

  it("computes carbon capture energy and net avoidance", () => {
    const result = runPhysicsSolver({
      params: {
        co2_capture_t_day: 1000,
        energy_kwh_per_tco2: 120,
        grid_emissions_kg_per_mwh: 400,
      },
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "CO2 captured",
      "Capture electricity use",
      "Average capture electric load",
      "Net CO2 avoided",
    ]));
    expect(result.computed_metrics.find((metric) => metric.label === "Net CO2 avoided")?.raw_value).toBeCloseTo(347480, 0);
  });

  it("computes reactor yield and desalination recovery balances", () => {
    const reactor = runPhysicsSolver({
      params: {
        feed_flow_kg_h: 1000,
        conversion_pct: 70,
        selectivity_pct: 80,
      },
    });
    expect(reactor.computed_metrics.find((metric) => metric.label === "Target product rate")?.raw_value).toBeCloseTo(560, 3);

    const desal = runPhysicsSolver({
      params: {
        feed_flow_m3_day: 10000,
        recovery_pct: 45,
        specific_energy_kwh_m3: 3.2,
      },
    });
    expect(desal.computed_metrics.find((metric) => metric.label === "Permeate production")?.raw_value).toBeCloseTo(4500, 3);
    expect(desal.computed_metrics.find((metric) => metric.label === "Desalination electric load")?.raw_value).toBeCloseTo(600, 1);
  });

  it("computes wind, hydro, and storage metrics", () => {
    const result = runPhysicsSolver({
      params: {
        rotor_diameter_m: 120,
        wind_speed_m_s: 9,
        power_coefficient: 0.45,
        flow_m3_s: 20,
        head_m: 80,
        storage_capacity_mwh: 400,
        capacity_mw: 100,
        round_trip_efficiency_pct: 82,
      },
    });

    expect(result.status).toBe("ran");
    expect(result.computed_metrics.map((metric) => metric.label)).toEqual(expect.arrayContaining([
      "Wind rotor power",
      "Hydro/turbine power",
      "Storage duration",
      "Delivered storage energy",
    ]));
  });
});

describe("waste-heat recovery ranking solver", () => {
  const streams = [
    { stream: "Cooling-water loop", waste_heat_mwh: 9000, source_temp_c: 38, ambient_temp_c: 15, mass_flow_kg_s: 220 },
    { stream: "Kiln exhaust", waste_heat_mwh: 1200, source_temp_c: 720, ambient_temp_c: 15, mass_flow_kg_s: 4.1 },
    { stream: "Dryer vent", waste_heat_mwh: 3000, source_temp_c: 95, ambient_temp_c: 15, mass_flow_kg_s: 18 },
    { stream: "Compressor aftercooler", waste_heat_mwh: 800, source_temp_c: 60, ambient_temp_c: 15, mass_flow_kg_s: 9 },
  ];

  it("extracts streams from a table-shaped input", () => {
    const extracted = extractWasteHeatStreams({ streams });
    expect(extracted).toHaveLength(4);
    expect(extracted[0]).toMatchObject({ label: "Cooling-water loop", energy_mwh: 9000, source_temp_c: 38 });
  });

  it("does not read an ambient column as the source temperature", () => {
    const extracted = extractWasteHeatStreams({ streams: [
      { stream: "Only ambient", waste_heat_mwh: 1000, ambient_temp_c: 20 },
      { stream: "Proper", waste_heat_mwh: 1000, source_temp_c: 300, ambient_temp_c: 20 },
      { stream: "Proper2", waste_heat_mwh: 800, source_temp_c: 250, ambient_temp_c: 20 },
    ]});
    // "Only ambient" has no real source temperature, so it is not a usable stream.
    expect(extracted.map((s) => s.label)).toEqual(["Proper", "Proper2"]);
    expect(extracted[0].source_temp_c).toBe(300);
    expect(extracted[0].ambient_temp_c).toBe(20);
  });

  it("ranks by exergy, not energy, and funds the high-grade stream first", () => {
    const result = runHeatRecoveryRankingSolver({ streams });
    expect(result.status).toBe("ran");
    const ranked = result.ranking!.ranked_streams;
    expect(ranked.map((r) => r.label)).toEqual([
      "Kiln exhaust", // highest exergy despite middling energy
      "Cooling-water loop",
      "Dryer vent",
      "Compressor aftercooler",
    ]);
    expect(result.ranking!.fund_first).toBe("Kiln exhaust");
    // Kiln exergy ~ 1200 * (1 - 288.15/993.15) = ~851.8 MWh_ex.
    expect(ranked[0].exergy_mwh).toBeCloseTo(851.8, 0);
    expect(ranked[0].grade).toBe("high");
  });

  it("flags the high-energy / low-exergy trap on the cooling-water loop", () => {
    const result = runHeatRecoveryRankingSolver({ streams });
    const cooling = result.ranking!.ranked_streams.find((r) => r.label === "Cooling-water loop")!;
    expect(cooling.energy_rank).toBe(1); // biggest by raw energy
    expect(cooling.grade).toBe("low");
    expect(cooling.flags.join(" ")).toMatch(/high energy, low exergy/i);
  });

  it("flags reference-state fragility for low-grade streams", () => {
    const result = runHeatRecoveryRankingSolver({ streams });
    const cooling = result.ranking!.reference_state_sensitivity.find((s) => s.label === "Cooling-water loop")!;
    expect(cooling.fragile).toBe(true);
    expect(Math.abs(cooling.pct_change)).toBeGreaterThanOrEqual(30);
    expect(result.limitations.join(" ")).toMatch(/reference-state sensitivity/i);
  });

  it("surfaces an unresolved consistency issue instead of rationalizing it", () => {
    const result = runHeatRecoveryRankingSolver({ streams });
    const flagged = result.ranking!.consistency_checks.filter(
      (c) => c.status === "unresolved" || c.status === "low_duty" || c.status === "impossible",
    );
    expect(flagged.length).toBeGreaterThan(0);
    expect(result.limitations.join(" ")).toMatch(/unresolved consistency check/i);
    expect(result.limitations.join(" ")).toMatch(/do not (?:explain the gap away|attribute the gap)/i);
  });

  it("needs at least two streams", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [streams[0]] });
    expect(result.status).toBe("needs_inputs");
  });

  it("notes when adjacent streams are within ~10% on exergy (effective tie)", () => {
    // Cooling-water (~665 MWh_ex) and dryer (~652 MWh_ex) are within 10%.
    const result = runHeatRecoveryRankingSolver({ streams });
    expect(result.limitations.join(" ")).toMatch(/within about 10%.*effectively a tie/i);
  });

  it("does not fund a stream whose energy is flagged physically impossible", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [
      { stream: "Overclaimed", waste_heat_mwh: 50000, source_temp_c: 80, ambient_temp_c: 20, mass_flow_kg_s: 5 },
      { stream: "Sane", waste_heat_mwh: 2000, source_temp_c: 300, ambient_temp_c: 20, mass_flow_kg_s: 6 },
    ]});
    expect(result.ranking!.consistency_checks.find((c) => c.label === "Overclaimed")!.status).toBe("impossible");
    // Largest nominal exergy, but disqualified -> not the recommendation.
    expect(result.ranking!.fund_first).toBe("Sane");
  });

  it("returns no fund-first when no stream has recoverable useful work", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [
      { stream: "Cold A", waste_heat_mwh: 3000, source_temp_c: 10, ambient_temp_c: 25 },
      { stream: "Cold B", waste_heat_mwh: 2000, source_temp_c: 18, ambient_temp_c: 25 },
    ]});
    expect(result.ranking!.fund_first).toBeNull();
    expect(result.executive_summary).toMatch(/no stream has physically valid/i);
  });

  it("surfaces rows that could not be read as streams", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [
      { stream: "Junk row", description: "no usable numbers" },
      { stream: "Good A", waste_heat_mwh: 1000, source_temp_c: 300, ambient_temp_c: 15 },
      { stream: "Good B", waste_heat_mwh: 800, source_temp_c: 250, ambient_temp_c: 15 },
    ]});
    expect(result.ranking!.ranked_streams).toHaveLength(2);
    expect(result.limitations.join(" ")).toMatch(/1 supplied row could not be read/i);
  });

  it("does not manufacture spurious sensitivity from excluded streams", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [
      { stream: "Unit error", waste_heat_mwh: 1000, source_temp_c: 99999, ambient_temp_c: 15 },
      { stream: "Good", waste_heat_mwh: 1000, source_temp_c: 300, ambient_temp_c: 15 },
    ]});
    expect(result.ranking!.fund_first).toBe("Good");
    expect(result.ranking!.reference_state_sensitivity.every((s) => !s.fragile)).toBe(true);
    expect(result.limitations.join(" ")).not.toMatch(/within about 10%/i);
  });

  it("rejects non-physical streams without crashing and excludes them", () => {
    const result = runHeatRecoveryRankingSolver({ streams: [
      { stream: "Impossible", waste_heat_mwh: 1000, source_temp_c: -300, ambient_temp_c: 15 },
      { stream: "Bad meter", waste_heat_mwh: -500, source_temp_c: 300, ambient_temp_c: 15 },
      { stream: "Good", waste_heat_mwh: 1000, source_temp_c: 300, ambient_temp_c: 15 },
    ]});
    expect(result.ranking!.fund_first).toBe("Good");
    const impossible = result.ranking!.ranked_streams.find((r) => r.label === "Impossible")!;
    expect(impossible.exergy_mwh).toBe(0);
    expect(impossible.carnot_factor).toBeLessThanOrEqual(1);
    expect(result.limitations.join(" ")).toMatch(/absolute zero/i);
    expect(result.limitations.join(" ")).toMatch(/negative/i);
  });
});
