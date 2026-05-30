import {
  FIRST_PRINCIPLES_SOLVER_FAMILIES,
  collectSolverParams,
  runEconomicsSolver,
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
