"""Solar PV module datasheet extraction and production estimates."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class PVModuleSpec:
    """Key module-level values extracted from a PV datasheet."""

    model_family: str
    pmax_w: float
    efficiency_pct: float | None = None
    temp_coeff_pmax_pct_per_c: float | None = None
    voc_v: float | None = None
    isc_a: float | None = None
    vmp_v: float | None = None
    imp_a: float | None = None
    module_area_m2: float | None = None
    cells: int | None = None


@dataclass(frozen=True)
class PVProductionEstimate:
    """Production estimate for one module at one site."""

    latitude: float | None
    longitude: float | None
    peak_power_stc_w: float
    site_peak_power_w: float
    average_daily_generation_kwh: float
    annual_generation_kwh: float
    solar_exergy_factor: float
    electricity_exergy_factor: float
    plane_of_array_sun_hours: float
    performance_ratio: float
    assumed_cell_temp_c: float


def extract_pv_module_spec(text: str) -> PVModuleSpec | None:
    """Extract a compact PV module spec from readable datasheet text."""

    if not _looks_like_pv_text(text):
        return None

    normalized = _normalize(text)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    model_family = _model_family(normalized)
    pmax = _max_power(normalized, lines)
    if pmax is None:
        return None
    area = _module_area(normalized)

    return PVModuleSpec(
        model_family=model_family,
        pmax_w=pmax,
        efficiency_pct=_module_efficiency(lines, pmax, area),
        temp_coeff_pmax_pct_per_c=_temperature_coefficient(normalized, lines),
        voc_v=_row_max(lines, ("open circuit voltage", "voc")),
        isc_a=_row_max(lines, ("short circuit current", "isc")),
        vmp_v=_row_max(lines, ("optimum operating voltage", "vmp", "v mpp")),
        imp_a=_row_max(lines, ("optimum operating current", "imp", "i mpp")),
        module_area_m2=area,
        cells=_cell_count(normalized),
    )


def extract_location(prompt: str) -> tuple[float | None, float | None]:
    """Extract latitude/longitude from common prompt formats."""

    text = prompt.replace("°", " ")
    match = re.search(
        r"([-+]?\d{1,2}(?:\.\d+)?)\s*([NS])?[, ]+\s*([-+]?\d{1,3}(?:\.\d+)?)\s*([EW])?",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None, None
    lat = float(match.group(1))
    lon = float(match.group(3))
    if (match.group(2) or "").upper() == "S":
        lat = -abs(lat)
    if (match.group(4) or "").upper() == "W":
        lon = -abs(lon)
    return lat, lon


def estimate_pv_production(
    spec: PVModuleSpec,
    *,
    latitude: float | None = None,
    longitude: float | None = None,
) -> PVProductionEstimate:
    """Return a deterministic one-module production estimate.

    Uses a location-class peak-sun-hours approximation rather than a weather
    file. Abu Dhabi / Gulf desert coordinates are assigned a high-resource
    fixed-tilt value; other locations fall back to a latitude-based estimate.
    """

    sun_hours = _plane_of_array_sun_hours(latitude, longitude)
    performance_ratio = 0.78
    assumed_cell_temp_c = 50.0 if _hot_desert_site(latitude, longitude) else 45.0
    coeff = spec.temp_coeff_pmax_pct_per_c if spec.temp_coeff_pmax_pct_per_c is not None else -0.37
    site_peak = spec.pmax_w * (1.0 + (coeff / 100.0) * (assumed_cell_temp_c - 25.0))
    site_peak = max(site_peak, 0.0)
    daily_kwh = (spec.pmax_w / 1000.0) * sun_hours * performance_ratio
    return PVProductionEstimate(
        latitude=latitude,
        longitude=longitude,
        peak_power_stc_w=round(spec.pmax_w, 2),
        site_peak_power_w=round(site_peak, 2),
        average_daily_generation_kwh=round(daily_kwh, 3),
        annual_generation_kwh=round(daily_kwh * 365.0, 1),
        solar_exergy_factor=round(_petela_solar_exergy_factor(), 4),
        electricity_exergy_factor=1.0,
        plane_of_array_sun_hours=round(sun_hours, 2),
        performance_ratio=performance_ratio,
        assumed_cell_temp_c=assumed_cell_temp_c,
    )


def _looks_like_pv_text(text: str) -> bool:
    lower = text.lower()
    strong = (
        "solar module",
        "photovoltaic",
        "pv module",
        "pmax",
        "open circuit voltage",
        "short circuit current",
        "module efficiency",
        "temperature coefficient",
    )
    return sum(1 for item in strong if item in lower) >= 2 or bool(re.search(r"\bcs\d+[a-z]?-\d{3}m", lower))


def _normalize(text: str) -> str:
    replacements = {
        "\u00a0": " ",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00d7": "x",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"[ \t]+", " ", text)


def _model_family(text: str) -> str:
    match = re.search(r"\b(CS\d+[A-Z]?-?\d{3,4}M[^\s,/)]*)", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    family = re.search(r"\b(CS\d+[A-Z]?-?MS)\b", text, flags=re.IGNORECASE)
    if family:
        return family.group(1).upper()
    if "hiku" in text.lower():
        return "Canadian Solar HiKu"
    return "PV module"


def _max_power(text: str, lines: list[str]) -> float | None:
    model_powers = [float(value) for value in re.findall(r"\bCS\d+[A-Z]?-?(\d{3,4})M[A-Z]*\b", text, flags=re.IGNORECASE)]
    model_powers = [value for value in model_powers if 50 <= value <= 800]
    if model_powers:
        return max(model_powers)
    for line in lines:
        lower = line.lower()
        if "pmax" in lower or "nominal max" in lower or "maximum power" in lower:
            values = [value for value in _numbers(line) if 50 <= value <= 800]
            if values:
                return max(values)
    return None


def _row_max(lines: list[str], labels: tuple[str, ...]) -> float | None:
    for index, line in enumerate(lines):
        lower = line.lower()
        if not any(label in lower for label in labels):
            continue
        window = " ".join(lines[index:index + 3])
        values = _numbers(window)
        if "efficiency" in labels:
            values = [value for value in values if 5 <= value <= 24.5]
        elif any(label in labels for label in ("voc", "open circuit voltage", "vmp", "v mpp")):
            values = [value for value in values if 10 <= value <= 80]
        elif any(label in labels for label in ("isc", "short circuit current", "imp", "i mpp")):
            values = [value for value in values if 1 <= value <= 25]
        if values:
            return max(values)
    return None


def _module_efficiency(lines: list[str], pmax_w: float, area_m2: float | None) -> float | None:
    area_efficiency = _efficiency_from_area(pmax_w, area_m2)
    row_efficiency = _row_max(lines, ("module efficiency", "efficiency"))
    if row_efficiency is None:
        return area_efficiency
    if area_efficiency is not None and abs(row_efficiency - area_efficiency) > 4.0:
        return area_efficiency
    return row_efficiency


def _temperature_coefficient(text: str, lines: list[str]) -> float | None:
    patterns = (
        r"(?:pmax|power)[^\n%]{0,80}(-0?\.\d+)\s*%?\s*/?\s*(?:[°\s]*c|k)",
        r"(-0?\.\d+)\s*%?\s*/?\s*(?:[°\s]*c|k)[^\n]{0,80}(?:pmax|power)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return float(match.group(1))
    for index, line in enumerate(lines):
        if "temperature coefficient" not in line.lower() and "temp. coefficient" not in line.lower():
            continue
        window = " ".join(lines[index:index + 5])
        values = [value for value in _numbers(window) if -1.0 <= value <= -0.1]
        if values:
            return values[0]
    return None


def _module_area(text: str) -> float | None:
    matches = re.findall(r"\b(\d{3,4})\s*x\s*(\d{3,4})(?:\s*x\s*\d{1,3})?\s*mm\b", text, flags=re.IGNORECASE)
    areas = []
    for width, height in matches:
        a = float(width) * float(height) / 1_000_000.0
        if 0.5 <= a <= 4.0:
            areas.append(a)
    return max(areas) if areas else None


def _cell_count(text: str) -> int | None:
    match = re.search(r"\b(60|72|96|120|132|144|156)\s*(?:mono\s*)?(?:half[-\s]cut\s*)?(?:cell|cells)\b", text, flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def _efficiency_from_area(pmax_w: float, area_m2: float | None) -> float | None:
    if not area_m2 or area_m2 <= 0:
        return None
    return round((pmax_w / (1000.0 * area_m2)) * 100.0, 2)


def _numbers(text: str) -> list[float]:
    values: list[float] = []
    for raw in re.findall(r"[-+]?\d[\d,]*(?:\.\d+)?", text):
        try:
            values.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    return values


def _hot_desert_site(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    return 20 <= latitude <= 30 and 45 <= longitude <= 60


def _plane_of_array_sun_hours(latitude: float | None, longitude: float | None) -> float:
    if _hot_desert_site(latitude, longitude):
        return 6.1
    if latitude is None:
        return 5.0
    abs_lat = abs(latitude)
    if abs_lat < 15:
        return 5.3
    if abs_lat < 35:
        return 5.0
    if abs_lat < 50:
        return 4.2
    return 3.3


def _petela_solar_exergy_factor(reference_temp_k: float = 298.15, sun_temp_k: float = 5778.0) -> float:
    ratio = reference_temp_k / sun_temp_k
    return 1.0 - (4.0 / 3.0) * ratio + (1.0 / 3.0) * ratio**4
