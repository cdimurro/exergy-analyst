from __future__ import annotations

import pytest

from exergy_analyst.power_plant_spec import (
    estimate_power_plant_performance,
    extract_power_plant_spec,
)


CCGT_TEXT = """
Blue Mesa Energy Center
Natural gas combined cycle power plant
Configuration: 2 x F-class gas turbine, HRSG, and one steam turbine.
Net plant output 620 MW
Gross output 655 MW
Net heat rate 6,600 Btu/kWh HHV
Expected capacity factor 65%
Base gas price $4.25/MMBtu
Merchant power price $62/MWh
NOx emissions 9 ppm
"""


def test_extracts_generic_ccgt_plant_basis() -> None:
    spec = extract_power_plant_spec(CCGT_TEXT)

    assert spec is not None
    assert spec.plant_type == "natural-gas combined-cycle plant"
    assert spec.fuel_type == "natural gas"
    assert spec.net_capacity_mw == 620
    assert spec.gross_capacity_mw == 655
    assert spec.heat_rate_btu_per_kwh == 6600
    assert spec.efficiency_pct == pytest.approx(51.7, abs=0.05)
    assert spec.capacity_factor_pct == 65
    assert spec.gas_price_per_mmbtu == 4.25
    assert spec.power_price_per_mwh == 62
    assert spec.nox_ppm == 9


def test_estimates_generation_fuel_cost_emissions_and_exergy() -> None:
    spec = extract_power_plant_spec(CCGT_TEXT)
    assert spec is not None

    estimate = estimate_power_plant_performance(spec)

    assert estimate.annual_generation_gwh == pytest.approx(3530.28, abs=0.01)
    assert estimate.annual_fuel_mmbtu == pytest.approx(23299848, abs=1)
    assert estimate.fuel_cost_per_mwh == pytest.approx(28.05, abs=0.01)
    assert estimate.spark_spread_per_mwh == pytest.approx(33.95, abs=0.01)
    assert estimate.co2_intensity_t_per_mwh == pytest.approx(0.3502, abs=0.0001)
    assert estimate.annual_co2_t == pytest.approx(1236290, abs=10)
    assert estimate.electricity_exergy_factor == 1.0
    assert estimate.exergy_efficiency_proxy_pct == pytest.approx(49.72, abs=0.05)
    assert estimate.assumed_co2_intensity is True


def test_does_not_misclassify_generic_non_plant_text() -> None:
    text = "This industrial oven has 620 kW of thermal output and 65% uptime, but it is not a power plant or heat-rate document."

    assert extract_power_plant_spec(text) is None


def test_does_not_misclassify_rsoc_brochure_as_natural_gas_power_plant() -> None:
    text = """
    OxEon reversible solid oxide cell systems are designed for power output in the
    range of 20-150 kW and operate in high-temperature electrolysis and fuel-cell
    modes. Installations of multiple parallel systems can form an on-site power
    plant capable of producing 1MW for critical loads. Fuel flexibility includes
    natural gas, biogas, ammonia, methane, and syngas.
    """

    assert extract_power_plant_spec(text) is None


def test_extracts_capacity_factor_from_mineru_markdown_math() -> None:
    spec = extract_power_plant_spec(CCGT_TEXT.replace("Expected capacity factor 65%", "Expected capacity factor $65\\%$"))

    assert spec is not None
    assert spec.capacity_factor_pct == 65
