import { fmtVal } from "../format-metric";

// Temperature: Kelvin → Celsius
test("Kelvin to Celsius for temp keys", () => {
  expect(fmtVal("saturation_temp_k", 602.65)).toBe("330 \u00B0C");
});

test("Kelvin to Celsius for centerline keys", () => {
  expect(fmtVal("fuel_centerline_max_k", 1856.15)).toBe("1583 \u00B0C");
});

test("Kelvin to Celsius for coolant_outlet_temp_k", () => {
  expect(fmtVal("coolant_outlet_temp_k", 594.15)).toBe("321 \u00B0C");
});

test("Kelvin to Celsius for clad_max_temp_k", () => {
  expect(fmtVal("clad_max_temp_k", 623.15)).toBe("350 \u00B0C");
});

test("ZT not converted as temperature", () => {
  expect(fmtVal("figure_of_merit_zt", 1.2)).not.toContain("\u00B0C");
});

// Pressure: Pascals → MPa
test("Pascals to MPa for high pressures", () => {
  expect(fmtVal("system_pressure_pa", 12760000)).toBe("12.76 MPa");
});

test("Low Pascals stay as Pa", () => {
  expect(fmtVal("system_pressure_pa", 50000)).toBe("50000 Pa");
});

// Power: Watts → MW/kW
test("Watts to MW for large values", () => {
  expect(fmtVal("gross_power_w", 84600000)).toBe("84.6 MWt");
});

test("net_power_w gets MWe suffix", () => {
  expect(fmtVal("net_power_w", 77000000)).toBe("77.0 MWe");
});

test("Watts to kW for medium values", () => {
  expect(fmtVal("thermal_input_w", 50000)).toBe("50.0 kW");
});

test("Small Watts stay as W", () => {
  expect(fmtVal("pump_power_w", 500)).toBe("500.0 W");
});

// Bar suffix
test("Bar suffix", () => {
  expect(fmtVal("operating_pressure_bar", 127.6)).toBe("127.6 bar");
});

// Efficiency
test("Efficiency percentage", () => {
  expect(fmtVal("thermal_efficiency", 31.2)).toBe("31.2%");
});

// Decay heat fraction
test("Decay heat fraction to percentage", () => {
  expect(fmtVal("decay_heat_fraction_1h", 0.012)).toBe("1.20%");
});

// PCM coefficient
test("Reactivity coefficient in pcm/K", () => {
  expect(fmtVal("alpha_doppler_pcm_per_k", -2.85)).toBe("-2.85 pcm/K");
});

// Linear heat rate
test("Linear heat rate in kW/m", () => {
  expect(fmtVal("peak_linear_heat_rate_w_per_m", 35000)).toBe("35.0 kW/m");
});

// Exergy metrics
test("Exergetic efficiency as percentage", () => {
  expect(fmtVal("exergetic_efficiency", 0.382)).toBe("38.2%");
});

test("Quality factor to 3 decimals", () => {
  expect(fmtVal("quality_factor", 0.451)).toBe("0.451");
});

test("Quality gap in percentage points", () => {
  expect(fmtVal("quality_gap", 0.468)).toBe("46.8 pp");
});

test("Exergy destruction in Wh", () => {
  expect(fmtVal("exergy_destruction_Wh", 1234.5)).toBe("1234.5 Wh");
});

test("Destruction ratio as percentage", () => {
  expect(fmtVal("destruction_ratio", 0.618)).toBe("61.8%");
});
