from __future__ import annotations

from exergy_analyst.solar_pv_spec import (
    estimate_pv_production,
    extract_location,
    extract_pv_module_spec,
)


CANADIAN_SOLAR_TEXT = "\n".join(
    [
        "Canadian Solar HiKu CS3W-MS",
        "Nominal Max. Power (Pmax) W 380 385 390 395 400",
        "Module Efficiency % 19.16 19.41 19.66 19.91 20.16",
        "Open Circuit Voltage (Voc) V 46.4 46.6 46.8 47.0 47.2",
        "Short Circuit Current (Isc) A 10.88 10.91 10.94 10.97 11.00",
        "Optimum Operating Voltage (Vmp) V 38.5 38.7 38.9 39.1 39.3",
        "Optimum Operating Current (Imp) A 9.87 9.95 10.03 10.11 10.18",
        "Temperature Coefficient (Pmax) -0.37 % / C",
        "Cell Type Mono-crystalline 144 cells",
        "Dimensions 2000 x 992 x 35 mm",
    ]
)


def test_extracts_canadian_solar_hiku_module_values() -> None:
    spec = extract_pv_module_spec(CANADIAN_SOLAR_TEXT)

    assert spec is not None
    assert spec.model_family == "CS3W-MS"
    assert spec.pmax_w == 400
    assert spec.efficiency_pct == 20.16
    assert spec.temp_coeff_pmax_pct_per_c == -0.37
    assert spec.voc_v == 47.2
    assert spec.isc_a == 11.0
    assert spec.module_area_m2 == 1.984
    assert spec.cells == 144


def test_does_not_confuse_warranty_years_for_module_efficiency() -> None:
    text = "\n".join(
        [
            "Canadian Solar HiKu CS3W-435MS",
            "Nominal Max. Power (Pmax) W 435",
            "Module Efficiency %",
            "25 year linear power output warranty",
            "Temperature Coefficient (Pmax) -0.35 % / C",
            "Open Circuit Voltage (Voc) V 49.3",
            "Dimensions 2108 x 1048 x 35 mm",
        ]
    )

    spec = extract_pv_module_spec(text)

    assert spec is not None
    assert spec.pmax_w == 435
    assert spec.efficiency_pct == 19.69


def test_estimates_one_module_production_for_abu_dhabi_coordinates() -> None:
    spec = extract_pv_module_spec(CANADIAN_SOLAR_TEXT)
    lat, lon = extract_location("located at 24.1456 N, 54.5318 E")

    estimate = estimate_pv_production(spec, latitude=lat, longitude=lon)  # type: ignore[arg-type]

    assert estimate.peak_power_stc_w == 400
    assert estimate.site_peak_power_w == 363
    assert estimate.average_daily_generation_kwh == 1.903
    assert estimate.solar_exergy_factor == 0.9312
    assert estimate.electricity_exergy_factor == 1.0
