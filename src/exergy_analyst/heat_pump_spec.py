"""Heat-pump spec-sheet extraction and exergy calculations."""

from __future__ import annotations

import re
from dataclasses import dataclass


BTU_PER_HOUR_PER_KW = 3412.142
BTU_PER_WH = 3.412142
KELVIN_OFFSET = 273.15


@dataclass(frozen=True)
class HeatPumpRating:
    """One AHRI-style heat-pump performance row extracted from a spec sheet."""

    outdoor_model: str
    indoor_model: str
    cooling_capacity_btu_h: float | None
    heating_capacity_btu_h: float | None
    eer: float | None
    seer: float | None
    hspf: float | None
    heating_low_btu_h: float | None
    cfm: float | None
    source: str


def extract_heat_pump_ratings(text: str) -> list[HeatPumpRating]:
    """Extract AHRI-style heat-pump performance rows from extracted text."""

    if not _looks_like_heat_pump_text(text):
        return []
    lines = _normalized_lines(text)
    ratings: list[HeatPumpRating] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not _is_outdoor_model(line):
            index += 1
            continue

        outdoor_model = line
        index += 1
        companion_parts: list[str] = []
        while index < len(lines) and len(companion_parts) < 3 and not _numeric_token(lines[index]):
            if _is_outdoor_model(lines[index]) or lines[index].lower().startswith("table "):
                break
            companion_parts.append(lines[index])
            index += 1

        numbers: list[float] = []
        raw_numeric: list[str] = []
        while index < len(lines) and len(numbers) < 7:
            current = lines[index]
            if _is_outdoor_model(current):
                break
            value = _number(current)
            if value is not None:
                numbers.append(value)
                raw_numeric.append(current)
            index += 1

        if len(numbers) >= 6:
            rating = HeatPumpRating(
                outdoor_model=outdoor_model,
                indoor_model=" / ".join(companion_parts).strip() or "unspecified indoor pairing",
                cooling_capacity_btu_h=numbers[0],
                eer=numbers[1],
                seer=numbers[2],
                heating_capacity_btu_h=numbers[3],
                hspf=numbers[4],
                heating_low_btu_h=numbers[5],
                cfm=numbers[6] if len(numbers) >= 7 else None,
                source=f"AHRI row near {outdoor_model}: {', '.join(raw_numeric[:7])}",
            )
            if _valid_heat_pump_rating(rating):
                ratings.append(rating)
    return _dedupe_ratings(ratings)


def best_heat_pump_rating(ratings: list[HeatPumpRating]) -> HeatPumpRating | None:
    """Pick the strongest row for a concise summary."""

    if not ratings:
        return None
    return max(ratings, key=lambda item: item.heating_capacity_btu_h or 0.0)


def heat_pump_exergy_estimate(
    rating: HeatPumpRating,
    *,
    outdoor_temp_f: float = 47.0,
    indoor_temp_f: float = 70.0,
) -> dict[str, float | str | None]:
    """Return an exergy estimate from AHRI heat-pump data.

    Uses HSPF as a seasonal COP proxy and AHRI heating reference temperatures
    as the cold/hot reservoirs. This is useful for first-pass interpretation,
    not a replacement for a full test-point exergy balance.
    """

    if not rating.heating_capacity_btu_h or not rating.hspf:
        return {}
    cold_k = _f_to_c(outdoor_temp_f) + KELVIN_OFFSET
    hot_k = _f_to_c(indoor_temp_f) + KELVIN_OFFSET
    if hot_k <= cold_k:
        return {}

    heat_kw = rating.heating_capacity_btu_h / BTU_PER_HOUR_PER_KW
    seasonal_cop_proxy = rating.hspf / BTU_PER_WH
    electric_kw_proxy = heat_kw / seasonal_cop_proxy if seasonal_cop_proxy > 0 else None
    carnot_factor = 1.0 - cold_k / hot_k
    ideal_cop = hot_k / (hot_k - cold_k)
    useful_heat_exergy_kw = heat_kw * carnot_factor
    second_law_efficiency = (
        useful_heat_exergy_kw / electric_kw_proxy
        if electric_kw_proxy and electric_kw_proxy > 0
        else None
    )
    return {
        "outdoor_model": rating.outdoor_model,
        "indoor_model": rating.indoor_model,
        "heating_capacity_btu_h": round(rating.heating_capacity_btu_h, 3),
        "heating_capacity_kw": round(heat_kw, 3),
        "hspf": round(rating.hspf, 3),
        "seasonal_cop_proxy": round(seasonal_cop_proxy, 3),
        "outdoor_temp_f_assumption": outdoor_temp_f,
        "indoor_temp_f_assumption": indoor_temp_f,
        "carnot_exergy_factor": round(carnot_factor, 4),
        "ideal_heating_cop": round(ideal_cop, 3),
        "useful_heat_exergy_kw": round(useful_heat_exergy_kw, 3),
        "electric_input_kw_proxy": round(electric_kw_proxy, 3) if electric_kw_proxy else None,
        "second_law_efficiency_pct": round(second_law_efficiency * 100.0, 2) if second_law_efficiency is not None else None,
    }


def heat_pump_exergy_caveat() -> str:
    return (
        "This exergy estimate uses AHRI HSPF as a seasonal COP proxy "
        "and assumes 47F outdoor / 70F indoor reservoirs. A defensible exergy balance "
        "needs measured electrical input, delivered heat, supply/return air or water "
        "temperatures, outdoor/source temperature, and operating mode."
    )


def _looks_like_heat_pump_text(text: str) -> bool:
    lower = text.lower()
    return "heat pump" in lower or ("ahri" in lower and "hspf" in lower and "heating capacity" in lower)


def _normalized_lines(text: str) -> list[str]:
    replacements = {
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\u2013": "-",
        "\u2014": "-",
        "\u00a0": " ",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return [line.strip() for line in text.splitlines() if line.strip()]


def _is_outdoor_model(line: str) -> bool:
    return bool(re.match(r"^BOVA-\d{2}[A-Z0-9-]+$", line.strip(), flags=re.IGNORECASE))


def _numeric_token(line: str) -> bool:
    return _number(line) is not None


def _number(value: str) -> float | None:
    text = value.strip().replace(",", "")
    if "/" in text:
        text = text.split("/", 1)[0]
    if not re.fullmatch(r"[-+]?\d+(?:\.\d+)?", text):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _f_to_c(value: float) -> float:
    return (value - 32.0) * 5.0 / 9.0


def _valid_heat_pump_rating(rating: HeatPumpRating) -> bool:
    """Reject model/part-number tables that look like AHRI rows after PDF extraction."""

    return (
        rating.indoor_model != "unspecified indoor pairing"
        and _in_range(rating.cooling_capacity_btu_h, 10_000, 120_000)
        and _in_range(rating.eer, 5, 25)
        and _in_range(rating.seer, 8, 35)
        and _in_range(rating.heating_capacity_btu_h, 10_000, 130_000)
        and _in_range(rating.hspf, 5, 15)
        and _in_range(rating.heating_low_btu_h, 5_000, 120_000)
        and (rating.cfm is None or _in_range(rating.cfm, 200, 4_000))
    )


def _in_range(value: float | None, minimum: float, maximum: float) -> bool:
    return value is not None and minimum <= value <= maximum


def _dedupe_ratings(ratings: list[HeatPumpRating]) -> list[HeatPumpRating]:
    seen: set[tuple[str, str, float | None, float | None]] = set()
    output: list[HeatPumpRating] = []
    for rating in ratings:
        key = (
            rating.outdoor_model,
            rating.indoor_model,
            rating.heating_capacity_btu_h,
            rating.hspf,
        )
        if key in seen:
            continue
        seen.add(key)
        output.append(rating)
    return output
