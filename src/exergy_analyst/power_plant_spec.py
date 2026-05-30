"""Generic power-plant document extraction and calculations."""

from __future__ import annotations

import re
from dataclasses import dataclass


NATURAL_GAS_CO2_T_PER_MMBTU = 0.05306
NATURAL_GAS_CHEMICAL_EXERGY_FACTOR = 1.04
BTU_PER_KWH = 3412.142


@dataclass(frozen=True)
class PowerPlantSpec:
    """Key plant-level values extracted from a readable document."""

    plant_type: str
    fuel_type: str | None = None
    net_capacity_mw: float | None = None
    gross_capacity_mw: float | None = None
    heat_rate_btu_per_kwh: float | None = None
    efficiency_pct: float | None = None
    capacity_factor_pct: float | None = None
    gas_price_per_mmbtu: float | None = None
    power_price_per_mwh: float | None = None
    co2_intensity_t_per_mwh: float | None = None
    nox_ppm: float | None = None
    water_rate_gal_per_mwh: float | None = None
    evidence_terms: tuple[str, ...] = ()


@dataclass(frozen=True)
class PowerPlantEstimate:
    """Operating, economics, emissions, and exergy metrics."""

    plant_type: str
    fuel_type: str | None
    net_capacity_mw: float | None
    gross_capacity_mw: float | None
    heat_rate_btu_per_kwh: float | None
    net_efficiency_pct: float | None
    capacity_factor_pct: float | None
    annual_generation_gwh: float | None
    annual_fuel_mmbtu: float | None
    gas_price_per_mmbtu: float | None
    fuel_cost_per_mwh: float | None
    power_price_per_mwh: float | None
    spark_spread_per_mwh: float | None
    co2_intensity_t_per_mwh: float | None
    annual_co2_t: float | None
    electricity_exergy_factor: float
    fuel_chemical_exergy_factor: float | None
    exergy_efficiency_proxy_pct: float | None
    assumed_capacity_factor: bool
    assumed_co2_intensity: bool


def extract_power_plant_spec(text: str) -> PowerPlantSpec | None:
    """Extract a compact power-plant basis from a technical PDF/text deck."""

    normalized = _normalize(text)
    if not _looks_like_power_plant_text(normalized):
        return None

    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    plant_type = _plant_type(normalized)
    fuel_type = _fuel_type(normalized)
    heat_rate = _heat_rate(normalized, lines)
    efficiency = _efficiency(lines)
    if heat_rate is None and efficiency:
        heat_rate = BTU_PER_KWH / (efficiency / 100.0)
    if efficiency is None and heat_rate:
        efficiency = (BTU_PER_KWH / heat_rate) * 100.0

    net_capacity = _capacity_mw(lines, ("net", "export", "deliver", "rated", "nominal", "plant"), ("gross",))
    gross_capacity = _capacity_mw(lines, ("gross",), ("net",))
    if net_capacity is None:
        net_capacity = _capacity_mw(lines, ("capacity", "output", "power", "facility", "plant"), ("stack", "module", "cell"))

    evidence_terms = _evidence_terms(normalized)
    spec = PowerPlantSpec(
        plant_type=plant_type,
        fuel_type=fuel_type,
        net_capacity_mw=_round(net_capacity, 3),
        gross_capacity_mw=_round(gross_capacity, 3),
        heat_rate_btu_per_kwh=_round(heat_rate, 1),
        efficiency_pct=_round(efficiency, 2),
        capacity_factor_pct=_capacity_factor(normalized, lines),
        gas_price_per_mmbtu=_gas_price(normalized),
        power_price_per_mwh=_power_price(normalized),
        co2_intensity_t_per_mwh=_co2_intensity(normalized),
        nox_ppm=_nox_ppm(lines),
        water_rate_gal_per_mwh=_water_rate(normalized),
        evidence_terms=tuple(evidence_terms[:10]),
    )
    if not _has_useful_plant_values(spec):
        return None
    return spec


def estimate_power_plant_performance(
    spec: PowerPlantSpec,
    *,
    capacity_factor_pct: float | None = None,
    gas_price_per_mmbtu: float | None = None,
    power_price_per_mwh: float | None = None,
) -> PowerPlantEstimate:
    """Compute first-pass energy, fuel, economics, emissions, and exergy metrics."""

    cf = capacity_factor_pct if capacity_factor_pct is not None else spec.capacity_factor_pct
    assumed_cf = False
    if cf is None and spec.net_capacity_mw is not None:
        cf = _default_capacity_factor(spec)
        assumed_cf = True
    cf_fraction = cf / 100.0 if cf is not None else None

    heat_rate = spec.heat_rate_btu_per_kwh
    efficiency = spec.efficiency_pct
    if heat_rate is None and efficiency:
        heat_rate = BTU_PER_KWH / (efficiency / 100.0)
    if efficiency is None and heat_rate:
        efficiency = (BTU_PER_KWH / heat_rate) * 100.0

    annual_generation_gwh = None
    annual_fuel_mmbtu = None
    annual_co2_t = None
    if spec.net_capacity_mw is not None and cf_fraction is not None:
        annual_generation_gwh = spec.net_capacity_mw * cf_fraction * 8760.0 / 1000.0
        if heat_rate is not None:
            annual_fuel_mmbtu = annual_generation_gwh * heat_rate

    gas_price = gas_price_per_mmbtu if gas_price_per_mmbtu is not None else spec.gas_price_per_mmbtu
    fuel_cost = heat_rate / 1000.0 * gas_price if heat_rate is not None and gas_price is not None else None
    power_price = power_price_per_mwh if power_price_per_mwh is not None else spec.power_price_per_mwh
    spark_spread = power_price - fuel_cost if power_price is not None and fuel_cost is not None else None

    assumed_co2 = False
    co2_intensity = spec.co2_intensity_t_per_mwh
    if co2_intensity is None and heat_rate is not None and spec.fuel_type == "natural gas":
        co2_intensity = (heat_rate / 1000.0) * NATURAL_GAS_CO2_T_PER_MMBTU
        assumed_co2 = True
    if annual_generation_gwh is not None and co2_intensity is not None:
        annual_co2_t = annual_generation_gwh * 1000.0 * co2_intensity

    fuel_exergy_factor = NATURAL_GAS_CHEMICAL_EXERGY_FACTOR if spec.fuel_type == "natural gas" else None
    exergy_efficiency = efficiency / fuel_exergy_factor if efficiency is not None and fuel_exergy_factor else efficiency

    return PowerPlantEstimate(
        plant_type=spec.plant_type,
        fuel_type=spec.fuel_type,
        net_capacity_mw=_round(spec.net_capacity_mw, 3),
        gross_capacity_mw=_round(spec.gross_capacity_mw, 3),
        heat_rate_btu_per_kwh=_round(heat_rate, 1),
        net_efficiency_pct=_round(efficiency, 2),
        capacity_factor_pct=_round(cf, 2),
        annual_generation_gwh=_round(annual_generation_gwh, 3),
        annual_fuel_mmbtu=_round(annual_fuel_mmbtu, 0),
        gas_price_per_mmbtu=_round(gas_price, 3),
        fuel_cost_per_mwh=_round(fuel_cost, 2),
        power_price_per_mwh=_round(power_price, 2),
        spark_spread_per_mwh=_round(spark_spread, 2),
        co2_intensity_t_per_mwh=_round(co2_intensity, 4),
        annual_co2_t=_round(annual_co2_t, 0),
        electricity_exergy_factor=1.0,
        fuel_chemical_exergy_factor=fuel_exergy_factor,
        exergy_efficiency_proxy_pct=_round(exergy_efficiency, 2),
        assumed_capacity_factor=assumed_cf,
        assumed_co2_intensity=assumed_co2,
    )


def _looks_like_power_plant_text(text: str) -> bool:
    lower = text.lower()
    strong_identity_terms = (
        "combined cycle",
        "ccgt",
        "ngcc",
        "gas turbine",
        "steam turbine",
        "heat recovery steam generator",
        "hrsg",
        "net heat rate",
        "gross heat rate",
    )
    generic_identity_terms = (
        "power plant",
        "power station",
        "generation facility",
        "thermal power",
    )
    metric_terms = (
        "heat rate",
        "btu/kwh",
        "mmbtu/mwh",
        "net output",
        "gross output",
        "net capacity",
        "plant capacity",
        "capacity factor",
        "dispatch",
        "spark spread",
    )
    strong_identity_hits = sum(1 for term in strong_identity_terms if term in lower)
    generic_identity_hits = sum(1 for term in generic_identity_terms if term in lower)
    metric_hits = sum(1 for term in metric_terms if term in lower)
    if strong_identity_hits >= 1 and metric_hits >= 1:
        return True
    plant_specific_metrics = (
        "heat rate",
        "btu/kwh",
        "mmbtu/mwh",
        "spark spread",
        "gross output",
        "net output",
    )
    plant_specific_hits = sum(1 for term in plant_specific_metrics if term in lower)
    return generic_identity_hits >= 1 and plant_specific_hits >= 1


def _normalize(text: str) -> str:
    replacements = {
        "\u00a0": " ",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00d7": "x",
        "\u00b0": " deg ",
        "\\%": "%",
        "\\times": "x",
        "MMBtu": "MMBtu",
        "mmbtu": "MMBtu",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"[ \t]+", " ", text)


def _plant_type(text: str) -> str:
    lower = text.lower()
    if "combined cycle" in lower or "ccgt" in lower or "ngcc" in lower:
        return "natural-gas combined-cycle plant"
    if "gas turbine" in lower and "steam turbine" in lower:
        return "gas-turbine combined-cycle plant"
    if "simple cycle" in lower or "peaker" in lower:
        return "simple-cycle gas-turbine plant"
    if "gas turbine" in lower:
        return "gas-turbine power plant"
    if "steam turbine" in lower:
        return "steam-turbine power plant"
    return "power plant"


def _fuel_type(text: str) -> str | None:
    lower = text.lower()
    if "natural gas" in lower or "fuel gas" in lower or "gas turbine" in lower or "ccgt" in lower or "ngcc" in lower:
        return "natural gas"
    if "hydrogen" in lower and "turbine" in lower:
        return "hydrogen"
    if "coal" in lower:
        return "coal"
    if "biomass" in lower:
        return "biomass"
    return None


def _evidence_terms(text: str) -> list[str]:
    terms = (
        "combined cycle",
        "ccgt",
        "ngcc",
        "gas turbine",
        "steam turbine",
        "hrsg",
        "heat rate",
        "capacity factor",
        "spark spread",
        "co2",
        "nox",
        "mmbtu",
    )
    return [term for term in terms if term in text.lower()]


def _has_useful_plant_values(spec: PowerPlantSpec) -> bool:
    values = (
        spec.net_capacity_mw,
        spec.gross_capacity_mw,
        spec.heat_rate_btu_per_kwh,
        spec.efficiency_pct,
        spec.capacity_factor_pct,
        spec.gas_price_per_mmbtu,
        spec.power_price_per_mwh,
        spec.co2_intensity_t_per_mwh,
        spec.nox_ppm,
    )
    return any(value is not None for value in values)


def _capacity_mw(lines: list[str], include_terms: tuple[str, ...], exclude_terms: tuple[str, ...] = ()) -> float | None:
    candidates: list[float] = []
    for index, line in enumerate(lines):
        window = " ".join(lines[max(0, index - 1): index + 2])
        lower_line = line.lower()
        lower = window.lower()
        if not any(term in lower_line for term in include_terms):
            continue
        if any(term in lower_line for term in exclude_terms):
            continue
        if not re.search(r"\b(capacity|output|power|rating|mw|kw|gw|generation)\b", lower_line):
            continue
        values = _power_values_mw(line) or _power_values_mw(window)
        candidates.extend(value for value in values if 1.0 <= value <= 5000.0)
    if not candidates:
        return None
    return max(candidates)


def _power_values_mw(text: str) -> list[float]:
    values: list[float] = []
    pattern = re.compile(
        r"(?:(\d+(?:\.\d+)?)\s*(?:x|by)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(kW|MW|GW)\b",
        flags=re.IGNORECASE,
    )
    for multiplier, raw_value, unit in pattern.findall(text):
        value = _float(raw_value)
        if value is None:
            continue
        if multiplier:
            mult = _float(multiplier) or 1.0
            value *= mult
        unit_lower = unit.lower()
        if unit_lower == "kw":
            value /= 1000.0
        elif unit_lower == "gw":
            value *= 1000.0
        values.append(value)
    return values


def _heat_rate(text: str, lines: list[str]) -> float | None:
    candidates: list[float] = []
    for source in [text, *lines]:
        lower = source.lower()
        if "heat rate" not in lower and "btu/kwh" not in lower and "mmbtu/mwh" not in lower:
            continue
        for raw in re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*(?:btu|btu)\s*/?\s*kwh", source, flags=re.IGNORECASE):
            value = _float(raw)
            if value is not None and 3500 <= value <= 20000:
                candidates.append(value)
        for raw in re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*MMBtu\s*/?\s*MWh", source, flags=re.IGNORECASE):
            value = _float(raw)
            if value is not None and 3.5 <= value <= 20.0:
                candidates.append(value * 1000.0)
        for raw in re.findall(r"(\d[\d,]*(?:\.\d+)?)\s*GJ\s*/?\s*MWh", source, flags=re.IGNORECASE):
            value = _float(raw)
            if value is not None and 3.5 <= value <= 20.0:
                candidates.append(value * 947.817)
    return min(candidates) if candidates else None


def _efficiency(lines: list[str]) -> float | None:
    candidates: list[float] = []
    for index, line in enumerate(lines):
        lower = line.lower()
        if "efficiency" not in lower and "thermal efficiency" not in lower:
            continue
        window = " ".join(lines[index:index + 2])
        for value in _percent_values(window):
            if 15.0 <= value <= 70.0:
                candidates.append(value)
    if not candidates:
        return None
    return max(candidates)


def _capacity_factor(text: str, lines: list[str]) -> float | None:
    for pattern in (
        r"capacity factor\D{0,80}(\d+(?:\.\d+)?)\s*%",
        r"(\d+(?:\.\d+)?)\s*%\D{0,80}capacity factor",
    ):
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = _float(match.group(1))
            if value is not None and 0.0 <= value <= 100.0:
                return _round(value, 2)
    for index, line in enumerate(lines):
        if "capacity factor" not in line.lower() and "plant factor" not in line.lower():
            continue
        window = " ".join(lines[index:index + 2])
        for value in _percent_values(window):
            if 0.0 <= value <= 100.0:
                return _round(value, 2)
    return None


def _gas_price(text: str) -> float | None:
    patterns = (
        r"(?:gas|fuel)[^\n$]{0,80}\$?\s*(\d+(?:\.\d+)?)\s*/\s*MMBtu",
        r"\$?\s*(\d+(?:\.\d+)?)\s*/\s*MMBtu[^\n]{0,80}(?:gas|fuel)",
        r"(?:gas|fuel)[^\n]{0,80}\$?\s*(\d+(?:\.\d+)?)\s*(?:per|/)\s*(?:MMBtu|MMBTU)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = _float(match.group(1))
            if value is not None and 0.1 <= value <= 50.0:
                return _round(value, 3)
    return None


def _power_price(text: str) -> float | None:
    patterns = (
        r"(?:power|electricity|energy|ppa|merchant)[^\n$]{0,80}\$?\s*(\d+(?:\.\d+)?)\s*/\s*MWh",
        r"\$?\s*(\d+(?:\.\d+)?)\s*/\s*MWh[^\n]{0,80}(?:power|electricity|energy|ppa|merchant)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = _float(match.group(1))
            if value is not None and 1.0 <= value <= 1000.0:
                return _round(value, 2)
    return None


def _co2_intensity(text: str) -> float | None:
    unit_patterns = (
        (r"(\d[\d,]*(?:\.\d+)?)\s*(?:t|tonne|tonnes|metric ton|metric tons)\s*(?:CO2e?|carbon dioxide)?\s*/\s*MWh", 1.0),
        (r"(\d[\d,]*(?:\.\d+)?)\s*kg\s*(?:CO2e?|carbon dioxide)?\s*/\s*MWh", 0.001),
        (r"(\d[\d,]*(?:\.\d+)?)\s*lb\s*(?:CO2e?|carbon dioxide)?\s*/\s*MWh", 0.000453592),
    )
    candidates: list[float] = []
    for pattern, multiplier in unit_patterns:
        for raw in re.findall(pattern, text, flags=re.IGNORECASE):
            value = _float(raw)
            if value is None:
                continue
            converted = value * multiplier
            if 0.05 <= converted <= 2.0:
                candidates.append(converted)
    return _round(min(candidates), 4) if candidates else None


def _nox_ppm(lines: list[str]) -> float | None:
    for index, line in enumerate(lines):
        if "nox" not in line.lower():
            continue
        window = " ".join(lines[index:index + 2])
        match = re.search(r"(\d+(?:\.\d+)?)\s*ppm", window, flags=re.IGNORECASE)
        if match:
            value = _float(match.group(1))
            if value is not None and 0 <= value <= 500:
                return _round(value, 2)
    return None


def _water_rate(text: str) -> float | None:
    patterns = (
        r"(\d[\d,]*(?:\.\d+)?)\s*gal\s*/\s*MWh",
        r"water[^\n]{0,80}(\d[\d,]*(?:\.\d+)?)\s*(?:gal|gallons)\s*/\s*MWh",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = _float(match.group(1))
            if value is not None and 0 <= value <= 1000:
                return _round(value, 2)
    return None


def _default_capacity_factor(spec: PowerPlantSpec) -> float:
    lower = spec.plant_type.lower()
    if "simple-cycle" in lower or "peaker" in lower:
        return 20.0
    if "combined-cycle" in lower:
        return 85.0
    return 70.0


def _percent_values(text: str) -> list[float]:
    values: list[float] = []
    for raw in re.findall(r"(\d+(?:\.\d+)?)\s*%", text):
        value = _float(raw)
        if value is not None:
            values.append(value)
    return values


def _float(value: str) -> float | None:
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def _round(value: float | None, places: int) -> float | None:
    if value is None:
        return None
    return round(value, places)
