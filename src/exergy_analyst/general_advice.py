"""General-purpose advisory fallback for prompts without usable source files."""

from __future__ import annotations

import re
from dataclasses import dataclass

from .exergy import accessible_exergy_mwh, thermal_exergy_factor


@dataclass(frozen=True)
class GeneralInsight:
    title: str
    evidence: str
    recommendation: str
    support: str


@dataclass(frozen=True)
class GeneralPromptAnalysis:
    insights: tuple[GeneralInsight, ...]
    limits: tuple[str, ...]
    next_steps: tuple[str, ...]
    detected_use_cases: tuple[str, ...]
    confidence: str


def analyze_general_prompt(prompt: str) -> GeneralPromptAnalysis:
    """Return a useful bounded response when no source files are available."""

    clean_prompt = " ".join(prompt.split())
    lower = clean_prompt.lower()
    calculation = _thermal_exergy_from_prompt(clean_prompt)
    if calculation:
        return calculation
    if _is_exergy_definition_question(lower):
        return _exergy_definition_answer()
    if _is_economics_prompt(lower):
        return _economics_advisory(clean_prompt)
    if _is_thermal_project_prompt(lower):
        return _thermal_project_advisory(clean_prompt)
    return _general_advisory(clean_prompt)


def detect_use_cases_from_prompt(prompt: str) -> tuple[str, ...]:
    lower = prompt.lower()
    cases: list[str] = []
    if "district heat" in lower or "district heating" in lower or "substation" in lower:
        cases.extend(["district-heating", "thermal-exergy"])
    if "waste heat" in lower or "oven" in lower or "kiln" in lower or "compressor" in lower:
        cases.extend(["industrial-waste-heat", "thermal-exergy"])
    if "heat pump" in lower or "cop" in lower or "hspf" in lower:
        cases.extend(["heat-pump-hvac", "thermal-exergy"])
    if "exergy" in lower:
        cases.append("thermal-exergy")
    if "roi" in lower or "payback" in lower or "lcoe" in lower or "economics" in lower:
        cases.append("techno-economic-analysis")
    return tuple(_dedupe(cases)) or ("general-engineering-analysis",)


def _thermal_exergy_from_prompt(prompt: str) -> GeneralPromptAnalysis | None:
    energy = _extract_energy(prompt)
    temperatures = _extract_temperatures(prompt)
    if not energy or len(temperatures) < 2:
        return None
    source_c, sink_c = _ordered_thermal_pair(temperatures)
    try:
        factor = thermal_exergy_factor(source_c, sink_c)
    except ValueError:
        return None
    amount, unit = energy
    converted_amount = amount / 1000.0 if unit == "kwh" else amount
    exergy_mwh = accessible_exergy_mwh(converted_amount, factor)
    unit_label = "MWh" if unit in {"mwh", "kwh"} else "MW"
    exergy_unit = "MWh_ex" if unit in {"mwh", "kwh"} else "MW_ex"
    return GeneralPromptAnalysis(
        insights=(
            GeneralInsight(
                title="A thermal exergy calculation is possible",
                evidence=(
                    f"Using {amount:g} {unit.upper()} of heat, source temperature {source_c:g} C, "
                    f"and reference/sink temperature {sink_c:g} C, the Carnot exergy factor is {factor:.3f}. "
                    f"That corresponds to about {exergy_mwh:.3f} {exergy_unit} from {converted_amount:.3f} {unit_label}."
                ),
                recommendation=(
                    "Use this as a first-pass useful-work calculation, then rerun with measured flow, duty cycle, "
                    "delivery temperature, and boundary conditions."
                ),
                support="computed",
            ),
        ),
        limits=(
            "This calculation assumes a single constant-temperature heat source and one sink/reference temperature.",
            "It does not prove recoverable heat, project ROI, heat-exchanger feasibility, contamination risk, or operational availability.",
        ),
        next_steps=(
            "Add measured mass flow or energy rate, source/sink temperatures over time, operating hours, and the intended heat user.",
            "If this is a project decision, add installed-cost range, avoided-fuel value, maintenance cost, and integration constraints.",
        ),
        detected_use_cases=("thermal-exergy", "industrial-waste-heat"),
        confidence="screening_grade",
    )


def _exergy_definition_answer() -> GeneralPromptAnalysis:
    return GeneralPromptAnalysis(
        insights=(
            GeneralInsight(
                title="Exergy is useful-work potential, not just energy quantity",
                evidence=(
                    "Energy is conserved, but not all energy can do useful work. Exergy measures the maximum useful work "
                    "available as a system comes into equilibrium with a reference environment."
                ),
                recommendation=(
                    "Use exergy when comparing energy streams with different temperatures, pressures, chemical states, "
                    "or electrical/mechanical usefulness."
                ),
                support="observed",
            ),
            GeneralInsight(
                title="Temperature quality is the practical lever in heat projects",
                evidence=(
                    "For heat, the first-pass useful-work fraction is approximately 1 - T0/T_hot using absolute temperatures. "
                    "High-temperature heat has more exergy than the same MWh at low temperature."
                ),
                recommendation=(
                    "For a real asset, collect heat quantity plus source and sink/reference temperatures before ranking opportunities."
                ),
                support="inferred",
            ),
        ),
        limits=(
            "This is a conceptual answer; it does not compute project-specific efficiency or recoverable value.",
            "A defensible exergy balance needs system boundaries, reference environment, measured flows, temperatures, and work inputs/outputs.",
        ),
        next_steps=(
            "For any stream you want analyzed, provide energy or flow rate, source temperature, sink/reference temperature, operating hours, and intended use.",
            "For equipment such as a heat pump, provide delivered heat, electrical input or COP/HSPF, outdoor/source temperature, and indoor/sink temperature.",
        ),
        detected_use_cases=("thermal-exergy",),
        confidence="advisory",
    )


def _thermal_project_advisory(prompt: str) -> GeneralPromptAnalysis:
    use_cases = detect_use_cases_from_prompt(prompt)
    target = "district-heating branch" if "district-heating" in use_cases else "thermal stream"
    return GeneralPromptAnalysis(
        insights=(
            GeneralInsight(
                title="Start with a useful-work inventory before designing hardware",
                evidence=(
                    "The request describes a thermal opportunity, but no measured source temperatures, sink temperatures, "
                    "flow rates, or duty cycles were supplied yet."
                ),
                recommendation=(
                    f"Build a one-row-per-{target.replace('-', ' ')} table with MWh or kW, source temperature, sink/reference temperature, "
                    "operating hours, and nearest heat demand."
                ),
                support="inferred",
            ),
            GeneralInsight(
                title="Rank by MWh_ex before economics",
                evidence=(
                    "A high-MWh low-temperature stream can be less valuable than a smaller high-temperature stream once useful-work quality is included."
                ),
                recommendation=(
                    "Compute Exergy Factor and MWh_ex first, then shortlist the top streams for heat-exchanger, heat-pump, or cascade-use analysis."
                ),
                support="inferred",
            ),
            GeneralInsight(
                title="The first client-facing deliverable should be a bounded decision brief",
                evidence=(
                    "The current prompt supports a plan and data request, not a validated savings or ROI claim."
                ),
                recommendation=(
                    "Deliver a brief with ranked opportunities, missing measurements, confidence, caveats, and the next field-data request."
                ),
                support="observed",
            ),
        ),
        limits=(
            "No uploaded measurements were provided, so savings, recovered energy, installed cost, ROI, and emissions reduction are not validated.",
            "The answer does not prove recoverability, hydraulic feasibility, process compatibility, comfort impact, or maintenance cost.",
        ),
        next_steps=(
            "Collect source temperature, sink or ambient temperature, energy rate, flow rate, and operating hours for each candidate stream.",
            "Add constraints: contamination/fouling, minimum process temperature, distance to heat users, downtime windows, and control limitations.",
            "After the first table is available, run an exergy ranking and only then request vendor sizing or cost estimates.",
        ),
        detected_use_cases=use_cases,
        confidence="advisory",
    )


def _economics_advisory(prompt: str) -> GeneralPromptAnalysis:
    return GeneralPromptAnalysis(
        insights=(
            GeneralInsight(
                title="Economics needs a dated technical and cost basis",
                evidence=(
                    "The request asks for economic judgment, but no capex, opex, energy price, baseline, incentive, operating-hours, or lifetime inputs were supplied."
                ),
                recommendation=(
                    "Build a small economics table before computing ROI: avoided energy, installed cost, maintenance delta, incentives, discount rate, and project life."
                ),
                support="observed",
            ),
            GeneralInsight(
                title="Use sensitivity ranges before a single payback claim",
                evidence=(
                    "For early energy projects, energy price, run hours, capex, and capacity factor usually dominate the result."
                ),
                recommendation=(
                    "Report base, low, and high cases with payback/NPV only after the technical stream ranking is complete."
                ),
                support="inferred",
            ),
        ),
        limits=(
            "No investment, procurement, or bankability conclusion is supported without dated cost and revenue evidence.",
            "This does not validate equipment performance, utility tariffs, incentives, tax treatment, or implementation schedule.",
        ),
        next_steps=(
            "Collect capex, installation scope, energy price or heat value, operating hours, maintenance delta, incentives, project life, and discount rate.",
            "Tie each economic case to a technical case with measured energy/exergy, not nameplate capacity alone.",
        ),
        detected_use_cases=("techno-economic-analysis",),
        confidence="advisory",
    )


def _general_advisory(prompt: str) -> GeneralPromptAnalysis:
    return GeneralPromptAnalysis(
        insights=(
            GeneralInsight(
                title="The request can be turned into a bounded analysis workflow",
                evidence=(
                    "No source files were provided yet. No measured values were provided either, so the current response should define the decision, evidence, and first calculation rather than inventing results."
                ),
                recommendation=(
                    "Use a three-step workflow: clarify the decision, collect the smallest evidence table, then produce a decision brief with supported claims and caveats."
                ),
                support="observed",
            ),
            GeneralInsight(
                title="The first useful output is an evidence request, not a refusal",
                evidence=(
                    "A vague prompt can still produce a concrete data checklist, analysis sequence, and confidence boundary."
                ),
                recommendation=(
                    "Ask for raw measurements, assumptions, costs, and operating constraints in a neutral format such as CSV, JSON, PDF text, XLSX, or Markdown."
                ),
                support="inferred",
            ),
        ),
        limits=(
            "No technical, economic, or environmental claim can be validated without source evidence.",
            "Any recommendation at this stage is advisory and should not be treated as a design, procurement, compliance, or investment decision.",
        ),
        next_steps=(
            "State the decision you need to make, the asset/process involved, and the time horizon.",
            "Upload the raw operating data, datasheet, model export, or prior analysis package containing measured values, assumptions, or claims.",
            "Identify what output you want: ranking, calculation, chart, evidence gap list, client memo, or implementation plan.",
        ),
        detected_use_cases=detect_use_cases_from_prompt(prompt),
        confidence="advisory",
    )


def _is_exergy_definition_question(lower: str) -> bool:
    return bool(
        re.search(r"\bwhat\s+is\s+exergy\b", lower)
        or re.search(r"\bdefine\s+exergy\b", lower)
        or re.search(r"\bexplain\s+exergy\b", lower)
    )


def _is_thermal_project_prompt(lower: str) -> bool:
    return any(
        term in lower
        for term in (
            "waste heat",
            "district heating",
            "heat pump",
            "thermal",
            "oven",
            "kiln",
            "compressor",
            "boiler",
            "chiller",
            "heat recovery",
        )
    )


def _is_economics_prompt(lower: str) -> bool:
    return any(term in lower for term in ("economics", "roi", "payback", "npv", "irr", "lcoe", "cost", "bankable"))


def _extract_energy(prompt: str) -> tuple[float, str] | None:
    match = re.search(r"([-+]?\d+(?:\.\d+)?)\s*(mwh|kwh|mw|kw)\b", prompt, flags=re.IGNORECASE)
    if not match:
        return None
    amount = float(match.group(1))
    unit = match.group(2).lower()
    if amount < 0:
        return None
    if unit == "kw":
        return amount / 1000.0, "mw"
    return amount, unit


def _extract_temperatures(prompt: str) -> list[float]:
    temperatures: list[float] = []
    for match in re.finditer(r"([-+]?\d+(?:\.\d+)?)\s*(?:deg(?:ree)?s?\s*)?(c|f|k)\b", prompt, flags=re.IGNORECASE):
        value = float(match.group(1))
        unit = match.group(2).lower()
        if unit == "f":
            temperatures.append((value - 32.0) * 5.0 / 9.0)
        elif unit == "k":
            temperatures.append(value - 273.15)
        else:
            temperatures.append(value)
    return temperatures


def _ordered_thermal_pair(temperatures_c: list[float]) -> tuple[float, float]:
    first, second = temperatures_c[0], temperatures_c[1]
    return (first, second) if first >= second else (second, first)


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            output.append(item)
    return output
