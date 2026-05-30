"""Client-style multi-file submission analysis."""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path
from statistics import mean, median

from .analysis import analyze_records
from .claims import ClaimSupport
from .file_inventory import format_bytes, profile_file
from .general_advice import analyze_general_prompt
from .heat_pump_spec import (
    best_heat_pump_rating,
    extract_heat_pump_ratings,
    heat_pump_exergy_caveat,
    heat_pump_exergy_estimate,
)
from .ingest import normalize_records
from .models import UseCase
from .pdf_extract import extract_pdf_document
from .power_plant_spec import (
    PowerPlantEstimate,
    PowerPlantSpec,
    estimate_power_plant_performance,
    extract_power_plant_spec,
)
from .solar_pv_spec import (
    PVModuleSpec,
    PVProductionEstimate,
    estimate_pv_production,
    extract_location,
    extract_pv_module_spec,
)


@dataclass(frozen=True)
class SubmissionFile:
    """Basic inventory for one uploaded file."""

    path: Path
    file_type: str
    size_bytes: int
    readable_summary: str
    parser_status: str


@dataclass(frozen=True)
class ClientInsight:
    """Plain-language insight backed by a computed fact."""

    title: str
    evidence: str
    recommendation: str
    support: ClaimSupport = ClaimSupport.COMPUTED


@dataclass(frozen=True)
class DocumentIdentity:
    """Weighted document identity inferred from content, not one keyword hit."""

    label: str
    use_cases: tuple[str, ...]
    score: float
    evidence_terms: tuple[str, ...]


@dataclass(frozen=True)
class RequestProfile:
    """User intent inferred from the prompt independently of domain."""

    intents: tuple[str, ...]
    dimensions: tuple[str, ...]
    wants_task_synthesis: bool


@dataclass(frozen=True)
class SubmissionResult:
    """Result of a vague prompt plus one or more uploaded files."""

    prompt: str
    files: tuple[SubmissionFile, ...]
    insights: tuple[ClientInsight, ...]
    limits: tuple[str, ...]
    next_steps: tuple[str, ...]


def analyze_submission(prompt: str, paths: list[Path]) -> SubmissionResult:
    """Analyze a client-style upload bundle."""

    if not paths:
        general = analyze_general_prompt(prompt)
        return SubmissionResult(
            prompt=prompt,
            files=(),
            insights=tuple(
                ClientInsight(
                    title=insight.title,
                    evidence=insight.evidence,
                    recommendation=insight.recommendation,
                    support=ClaimSupport(insight.support),
                )
                for insight in general.insights
            ),
            limits=general.limits,
            next_steps=general.next_steps,
        )

    files: list[SubmissionFile] = []
    insights: list[ClientInsight] = []
    limits: list[str] = []
    next_steps: list[str] = []

    for path in paths:
        files.append(_summarize_file(path))
        lower_name = path.name.lower()
        suffix = path.suffix.lower()

        if suffix == ".zip":
            zip_insights, zip_limits, zip_steps = _analyze_zip(path)
            insights.extend(zip_insights)
            limits.extend(zip_limits)
            next_steps.extend(zip_steps)
            continue

        if suffix == ".pdf":
            pdf_insights, pdf_limits, pdf_steps = _analyze_pdf(path, prompt)
            insights.extend(pdf_insights)
            limits.extend(pdf_limits)
            next_steps.extend(pdf_steps)
            continue

        if suffix in {".txt", ".md", ".markdown"}:
            text_insights, text_limits, text_steps = _analyze_text_document(path, prompt)
            insights.extend(text_insights)
            limits.extend(text_limits)
            next_steps.extend(text_steps)
            continue

        if suffix in {".csv", ".tsv", ".tab"}:
            rows = _read_delimited_path(path)
            headers = set(rows[0].keys()) if rows else set()
            if "Usage_kWh" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_steel_energy(rows)
            elif "LV ActivePower (kW)" in headers and "Theoretical_Power_Curve (KWh)" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_wind_scada(rows)
            elif "Year" in headers and len(headers) > 50:
                csv_insights, csv_limits, csv_steps = _analyze_cement_emissions(rows)
            elif {"Name", "Manufacturer", "Technology", "STC", "PTC", "A_c"} <= headers:
                csv_insights, csv_limits, csv_steps = _analyze_solar_modules(rows)
            elif {"Voltage_measured", "Temperature_measured", "Capacity", "id_cycle", "Battery"} <= headers:
                csv_insights, csv_limits, csv_steps = _analyze_battery_aging(rows)
            elif {"z_real", "z_img", "applied_voltage", "set"} <= headers:
                csv_insights, csv_limits, csv_steps = _analyze_fuel_cell_impedance(rows)
            elif {"city", "total_chargers", "total_sites", "total_volume", "avg_power"} <= headers:
                csv_insights, csv_limits, csv_steps = _analyze_ev_charging_info(rows)
            elif len(headers) > 100 and "" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_ev_charging_volume(rows)
            elif _looks_like_exergy_csv(headers):
                csv_insights, csv_limits, csv_steps = _analyze_exergy_csv(rows, headers)
            else:
                csv_insights, csv_limits, csv_steps = _analyze_generic_csv(rows, lower_name)
            insights.extend(csv_insights)
            limits.extend(csv_limits)
            next_steps.extend(csv_steps)
            continue

        if suffix == ".json":
            json_insights, json_limits, json_steps = _analyze_json(path)
            insights.extend(json_insights)
            limits.extend(json_limits)
            next_steps.extend(json_steps)
            continue

        if suffix in {".yaml", ".yml"}:
            yaml_insights, yaml_limits, yaml_steps = _analyze_yaml(path)
            insights.extend(yaml_insights)
            limits.extend(yaml_limits)
            next_steps.extend(yaml_steps)
            continue

        if suffix == ".xlsx":
            xlsx_insights, xlsx_limits, xlsx_steps = _analyze_xlsx(path)
            insights.extend(xlsx_insights)
            limits.extend(xlsx_limits)
            next_steps.extend(xlsx_steps)

    bundle = _synthesize_multi_document_bundle(prompt, paths)
    if bundle:
        bundle_insights, bundle_limits, bundle_steps = bundle
        insights = [*bundle_insights, *insights]
        limits.extend(bundle_limits)
        next_steps.extend(bundle_steps)

    if not insights:
        if files:
            first = files[0]
            parser_note = first.parser_status
            recommendation = (
                "Install or connect the required parser, or ask the client for a neutral export such as CSV, JSON, IFC, STEP, PDF text, or XLSX."
                if "requires" in parser_note or "no parser" in parser_note
                else "Use the file inventory to choose the next parser or domain analyzer to add."
            )
            next_step = (
                f"Convert `{first.path.name}` to a parser-ready format or install the missing parser noted by the inventory: {parser_note}."
            )
        else:
            recommendation = "Upload source evidence before requesting a grounded technical assessment."
            next_step = "Upload the raw source file and rerun the analysis."
        insights.append(
            ClientInsight(
                title="The upload was inventoried, but not yet deeply analyzed",
                evidence="No uploaded file matched one of the first supported domain analyzers.",
                recommendation=recommendation,
                support=ClaimSupport.OBSERVED,
            )
        )
        limits.append("This run only identified file types and sizes; it did not extract domain-specific values.")
        next_steps.append(next_step)

    return SubmissionResult(
        prompt=prompt,
        files=tuple(files),
        insights=tuple(insights),
        limits=tuple(_dedupe(limits)),
        next_steps=tuple(_dedupe(next_steps)),
    )


def _analyze_pdf(path: Path, prompt: str) -> tuple[list[ClientInsight], list[str], list[str]]:
    extraction = extract_pdf_document(path)
    insights: list[ClientInsight] = []
    limits: list[str] = []
    next_steps: list[str] = []

    if not extraction.text.strip():
        limits.append(extraction.error or "PDF extraction did not produce usable text or tables.")
        next_steps.append(
            "Install or configure local MinerU 2.5 Pro extraction, or upload a searchable text/table export with the rating data."
        )
        return insights, limits, next_steps

    pv_spec = extract_pv_module_spec(extraction.text)
    if pv_spec:
        return _analyze_pv_module_pdf(path, prompt, pv_spec)

    plant_spec = extract_power_plant_spec(f"{extraction.text}\n{prompt}")
    if plant_spec:
        return _analyze_power_plant_document(path, prompt, plant_spec)

    ratings = extract_heat_pump_ratings(extraction.text)
    if ratings:
        best = best_heat_pump_rating(ratings)
        parser = extraction.parser
        insights.append(
            ClientInsight(
                title="Heat-pump performance data was extracted from the PDF",
                evidence=(
                    f"{parser} extracted text/tables from `{path.name}` and found "
                    f"{len(ratings)} AHRI-style heat-pump performance row(s)."
                ),
                recommendation=(
                    "Use the exact outdoor/indoor pairing that matches the installed unit before relying on a single row."
                ),
                support=ClaimSupport.OBSERVED,
            )
        )
        if best:
            estimate = heat_pump_exergy_estimate(best)
            if estimate:
                insights.append(
                    ClientInsight(
                        title="A heat-pump exergy estimate is now possible",
                        evidence=(
                            f"For {best.outdoor_model} with {best.indoor_model}, extracted heating capacity is "
                            f"{estimate['heating_capacity_btu_h']} BTU/h ({estimate['heating_capacity_kw']} kW) "
                            f"and HSPF is {estimate['hspf']}. Using 47F outdoor and 70F indoor as rating-condition reservoirs, "
                            f"the heat-exergy factor is {estimate['carnot_exergy_factor']}, useful heat exergy is "
                            f"{estimate['useful_heat_exergy_kw']} kW_ex, and second-law efficiency is about "
                            f"{estimate['second_law_efficiency_pct']}%."
                        ),
                        recommendation=(
                            "Treat this as a first-pass calculation, then rerun with measured power input and actual supply/return temperatures."
                        ),
                        support=ClaimSupport.COMPUTED,
                    )
                )
            else:
                next_steps.append(
                    "Provide the HSPF/COP or measured electrical input for the selected heat-pump pairing so exergy efficiency can be computed."
                )
        limits.append(heat_pump_exergy_caveat())
        limits.append(
            "The PDF rating table does not prove installed seasonal performance, field COP, defrost losses, or comfort impact."
        )
        next_steps.append(
            "Confirm the installed outdoor model, indoor coil/air-handler pairing, operating point, delivered heating rate, electrical input, and indoor/outdoor temperatures."
        )
        next_steps.append(
            "For a defensible exergy balance, provide supply-air or hydronic supply/return temperatures instead of only AHRI rating conditions."
        )
        return insights, limits, next_steps

    if _looks_like_heat_pump_request_or_document(prompt, extraction.text):
        insights.append(
            ClientInsight(
                title="The PDF text was readable, but the heat-pump rating table was not found",
                evidence=(
                    f"{extraction.parser} extracted {len(extraction.text):,} characters from `{path.name}`, "
                    "but I could not identify a complete AHRI/HSPF heat-pump rating table."
                ),
                recommendation=(
                    "Upload or point to the table with capacity, COP/HSPF, power input, and temperature conditions so I can calculate the exergy balance."
                ),
                support=ClaimSupport.OBSERVED,
            )
        )
        limits.append(
            "The current PDF extract does not identify enough heat-pump capacity, power, and temperature values to compute heat-pump exergy."
        )
        next_steps.append(
            "Provide heating capacity, power input or COP/HSPF, source temperature, sink/delivery temperature, and ambient/reference temperature."
        )
        return insights, limits, next_steps

    request = _profile_request(prompt)
    simple_document_question = (
        not request.dimensions
        and not any(intent in {"calculate", "compare", "chart", "research"} for intent in request.intents)
    )
    document_overview_question = simple_document_question or _is_document_overview_request(prompt, request)

    if _looks_like_soec_document(extraction.text) and document_overview_question:
        return _analyze_soec_document(path, extraction.text, extraction.parser)

    if _looks_like_fischer_tropsch_document(extraction.text) and document_overview_question:
        return _analyze_fischer_tropsch_document(path, extraction.text, extraction.parser)

    if request.wants_task_synthesis:
        return _analyze_generic_extracted_document(path, prompt, extraction.text, extraction.parser)

    if _looks_like_soec_document(extraction.text):
        return _analyze_soec_document(path, extraction.text, extraction.parser)

    if _looks_like_fischer_tropsch_document(extraction.text):
        return _analyze_fischer_tropsch_document(path, extraction.text, extraction.parser)

    if "pdf" in prompt.lower() or len(extraction.text) > 300:
        return _analyze_generic_extracted_document(path, prompt, extraction.text, extraction.parser)

    return insights, limits, next_steps


def _analyze_text_document(path: Path, prompt: str) -> tuple[list[ClientInsight], list[str], list[str]]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return (
            [
                ClientInsight(
                    title="The text document could not be read",
                    evidence=f"The file read failed with {exc.__class__.__name__}: {str(exc)[:120]}.",
                    recommendation="Re-upload the document or export it as UTF-8 text, Markdown, CSV, or PDF text.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No content claims should be made from an unreadable text document."],
            ["Re-export the document as UTF-8 text or upload the original source file."],
        )

    ratings = extract_heat_pump_ratings(text)
    if ratings:
        best = best_heat_pump_rating(ratings)
        insights = [
            ClientInsight(
                title="Heat-pump performance data was extracted from the text document",
                evidence=f"`{path.name}` contains {len(ratings)} AHRI-style heat-pump performance row(s).",
                recommendation="Use the exact installed outdoor/indoor pairing before relying on a single row.",
                support=ClaimSupport.OBSERVED,
            )
        ]
        if best:
            estimate = heat_pump_exergy_estimate(best)
            if estimate:
                insights.append(
                    ClientInsight(
                        title="A heat-pump exergy estimate is now possible",
                        evidence=(
                            f"For {best.outdoor_model} with {best.indoor_model}, extracted heating capacity is "
                            f"{estimate['heating_capacity_btu_h']} BTU/h ({estimate['heating_capacity_kw']} kW), "
                            f"HSPF is {estimate['hspf']}, useful heat exergy is {estimate['useful_heat_exergy_kw']} kW_ex, "
                            f"and second-law efficiency is about {estimate['second_law_efficiency_pct']}% under these assumptions."
                        ),
                        recommendation="Rerun with measured input power and actual source/sink temperatures before making installed-performance claims.",
                        support=ClaimSupport.COMPUTED,
                    )
                )
        return (
            insights,
            [
                heat_pump_exergy_caveat(),
                "The text extract does not prove installed seasonal performance, field COP, defrost losses, or comfort impact.",
            ],
            [
                "Confirm the exact outdoor model, indoor pairing, delivered heating rate, electrical input, and source/sink temperatures.",
                "Provide measured operating data if the goal is installed-system exergy rather than rating-table assumptions.",
            ],
        )

    plant_spec = extract_power_plant_spec(f"{text}\n{prompt}")
    if plant_spec:
        return _analyze_power_plant_document(path, prompt, plant_spec)

    request = _profile_request(prompt)
    simple_document_question = (
        not request.dimensions
        and not any(intent in {"calculate", "compare", "chart", "research"} for intent in request.intents)
    )
    document_overview_question = simple_document_question or _is_document_overview_request(prompt, request)

    if _looks_like_soec_document(text) and document_overview_question:
        return _analyze_soec_document(path, text, "local text reader")

    if _looks_like_fischer_tropsch_document(text) and document_overview_question:
        return _analyze_fischer_tropsch_document(path, text, "local text reader")

    if request.wants_task_synthesis or len(text) > 300:
        return _analyze_generic_extracted_document(path, prompt, text, "local text reader")

    profile = _profile_text(text)
    domain_signals = _domain_signals(text + "\n" + prompt)
    numbers = re.findall(r"[-+]?\d+(?:\.\d+)?", text)
    first_headings = _first_headings(text)
    signal_line = ", ".join(domain_signals) if domain_signals else "general technical/business context"
    heading_line = f" Notable headings: {', '.join(first_headings[:4])}." if first_headings else ""
    return (
        [
            ClientInsight(
                title="The document provides analyzable context",
                evidence=(
                    f"`{path.name}` has about {profile['words']:,} words, {profile['lines']:,} non-empty lines, "
                    f"and {len(numbers):,} numeric value(s). Detected signals: {signal_line}.{heading_line}"
                ),
                recommendation="Use it to build an evidence map, then extract any embedded tables into CSV for calculation-heavy work.",
                support=ClaimSupport.OBSERVED,
            ),
            ClientInsight(
                title="The safest next output is a claim-and-data checklist",
                evidence="The document is readable, but free text does not by itself identify system boundaries, units, and measurement provenance for every claim.",
                recommendation="Separate supported facts, assumptions, missing measurements, and decisions that still need quantitative backing.",
                support=ClaimSupport.INFERRED,
            ),
        ],
        [
            "This pass does not validate embedded claims against original instruments, invoices, meter data, or third-party sources.",
            "Any calculations require explicit units, timestamps, boundaries, and reference conditions.",
        ],
        [
            "Extract tables or repeated measurements into CSV/XLSX with units in the headers.",
            "Identify the decision the document should support: ranking, calculation, diligence memo, chart, or evidence request.",
        ],
    )


def _looks_like_heat_pump_request_or_document(prompt: str, text: str) -> bool:
    prompt_lower = prompt.lower()
    identity = _primary_document_identity(text)
    if identity and identity.label != "heat pump/HVAC" and identity.score >= 4:
        return False
    if _prompt_negates_heat_pump(prompt_lower):
        return False
    if any(term in prompt_lower for term in ("heat pump", "hspf", "ahri", "seer", "eer", "cop ")):
        return True
    return bool(identity and identity.label == "heat pump/HVAC" and identity.score >= 5)


def _prompt_negates_heat_pump(prompt_lower: str) -> bool:
    return bool(
        re.search(r"\bnot\s+(?:a\s+)?heat[\s-]?pumps?\b", prompt_lower)
        or re.search(r"\bnothing\s+to\s+do\s+with\s+heat[\s-]?pumps?\b", prompt_lower)
        or re.search(r"\bhas\s+nothing\s+to\s+do\s+with\s+heat[\s-]?pumps?\b", prompt_lower)
        or re.search(r"\bno\s+heat[\s-]?pump\s+(?:system|document|data|analysis)\b", prompt_lower)
    )


def _analyze_pv_module_pdf(
    path: Path,
    prompt: str,
    spec: PVModuleSpec,
) -> tuple[list[ClientInsight], list[str], list[str]]:
    lat, lon = extract_location(prompt)
    production = estimate_pv_production(spec, latitude=lat, longitude=lon)
    wants_production = bool(
        re.search(r"\b(simulat|production|generation|yield|peak power|exergy factor|kwh|output)\b", prompt, flags=re.IGNORECASE)
    )

    spec_bits = [
        f"selected module power {spec.pmax_w:g} W",
        f"efficiency {spec.efficiency_pct:g}%" if spec.efficiency_pct is not None else "",
        f"Pmax temperature coefficient {spec.temp_coeff_pmax_pct_per_c:g}%/C" if spec.temp_coeff_pmax_pct_per_c is not None else "",
        f"Voc {spec.voc_v:g} V" if spec.voc_v is not None else "",
        f"Isc {spec.isc_a:g} A" if spec.isc_a is not None else "",
        f"area {spec.module_area_m2:.3f} m2" if spec.module_area_m2 is not None else "",
        f"{spec.cells} cells" if spec.cells is not None else "",
    ]
    spec_line = "; ".join(part for part in spec_bits if part)
    location = (
        f"{production.latitude:g} N, {production.longitude:g} E"
        if production.latitude is not None and production.longitude is not None
        else "the requested site"
    )
    production_line = (
        f"At {location}, the estimate is peak module rating {production.peak_power_stc_w:g} W DC, "
        f"heat-adjusted site peak about {production.site_peak_power_w:g} W at {production.assumed_cell_temp_c:g} C cell temperature, "
        f"average daily generation about {production.average_daily_generation_kwh:g} kWh per module-day "
        f"({production.annual_generation_kwh:g} kWh/year), and solar-radiation exergy factor {production.solar_exergy_factor:g}."
    )

    insights = [
        ClientInsight(
            title=f"{spec.model_family} PV module specifications were extracted from the datasheet",
            evidence=spec_line,
            recommendation=(
                "Use these module values as the basis for the one-module production estimate."
                if wants_production
                else "Use these values for module comparison, string sizing, and site-yield analysis."
            ),
            support=ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="PV production estimate for the requested location",
            evidence=production_line,
            recommendation=(
                f"The estimate uses {production.plane_of_array_sun_hours:g} equivalent sun-hours/day, "
                f"performance ratio {production.performance_ratio:g}, and fixed-tilt desert operating assumptions."
            ),
            support=ClaimSupport.COMPUTED,
        ),
    ]
    limits = [
        "This estimate does not use a TMY weather file, horizon shading, exact tilt/azimuth, inverter clipping, or measured soiling history.",
    ]
    next_steps = [
        "For a project-grade yield estimate, provide tilt, azimuth, array layout, inverter model, DC/AC ratio, albedo, soiling schedule, and a weather file for the site.",
    ]
    return insights, limits, next_steps


def _analyze_power_plant_document(
    path: Path,
    prompt: str,
    spec: PowerPlantSpec,
) -> tuple[list[ClientInsight], list[str], list[str]]:
    estimate = estimate_power_plant_performance(spec)
    request = _profile_request(prompt)
    spec_line = _power_plant_spec_line(spec)
    estimate_line = _power_plant_estimate_line(estimate)
    economics_requested = "economic" in request.dimensions or any(
        term in prompt.lower()
        for term in ("economics", "financial", "spark spread", "fuel cost", "lcoe", "npv", "irr", "revenue")
    )
    environmental_requested = "environmental" in request.dimensions or any(
        term in prompt.lower() for term in ("environmental", "emissions", "co2", "carbon", "nox", "water")
    )

    insights = [
        ClientInsight(
            title=f"A {spec.plant_type} performance basis was extracted",
            evidence=spec_line,
            recommendation=(
                "Use this as the plant-level basis for first-pass generation, fuel, emissions, and spark-spread questions."
            ),
            support=ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="A plant-performance calculation is now available",
            evidence=estimate_line,
            recommendation=(
                "Use these outputs for an initial answer, then rerun with hourly dispatch, ambient correction, outage schedule, and actual fuel and power contracts for a project-grade case."
            ),
            support=ClaimSupport.COMPUTED,
        ),
    ]
    if economics_requested and estimate.fuel_cost_per_mwh is None:
        insights.append(
            ClientInsight(
                title="The economic model needs a fuel-price and revenue basis",
                evidence="The document/prompt did not expose a calculation-ready gas price and power price pair.",
                recommendation="Provide gas price in $/MMBtu, power/PPA price in $/MWh, fixed and variable O&M, CAPEX, utilization, financing, and project life.",
                support=ClaimSupport.INFERRED,
            )
        )
    if environmental_requested and estimate.co2_intensity_t_per_mwh is None:
        insights.append(
            ClientInsight(
                title="The environmental model needs an emissions factor or fuel basis",
                evidence="The document/prompt did not expose a calculation-ready CO2 intensity, heat rate, or fuel-specific emissions factor.",
                recommendation="Provide fuel composition/HHV-LHV basis, measured stack emissions, permit limits, annual operating hours, water use, and any CO2 capture or offsets.",
                support=ClaimSupport.INFERRED,
            )
        )

    limits = [
        "This calculation does not model ambient temperature derate, duct firing, part-load heat-rate curves, start/stop fuel, outages, auxiliary load detail, degradation, curtailment, or grid interconnection constraints.",
        "It does not prove project economics without CAPEX, fixed and variable O&M, fuel contract, power/PPA price, financing, taxes, incentives, dispatch profile, and availability assumptions.",
    ]
    if estimate.assumed_capacity_factor:
        limits.append(
            f"Capacity factor was not extracted, so the annual generation screen uses a generic {estimate.capacity_factor_pct:g}% plant-type assumption."
        )
    if estimate.assumed_co2_intensity:
        limits.append(
            "CO2 intensity was estimated from natural-gas combustion and heat rate, not measured stack emissions or a full lifecycle boundary."
        )
    next_steps = [
        "Provide hourly or monthly dispatch, ambient conditions, planned and forced outage assumptions, auxiliary load, and any duct-firing or part-load operating curve.",
        "Provide fuel contract price, HHV/LHV basis, fuel composition, transport fees, power/PPA price, ancillary revenue, O&M, CAPEX, financing, tax, incentive, and project-life assumptions.",
        "Provide measured or permitted CO2, NOx, CO, water withdrawal/consumption, startup/shutdown emissions, and the environmental reporting boundary.",
    ]
    return insights, _dedupe(limits), _dedupe(next_steps)


def _power_plant_spec_line(spec: PowerPlantSpec) -> str:
    parts = [
        f"plant type {spec.plant_type}",
        f"fuel {spec.fuel_type}" if spec.fuel_type else "",
        f"net capacity {spec.net_capacity_mw:g} MW" if spec.net_capacity_mw is not None else "",
        f"gross capacity {spec.gross_capacity_mw:g} MW" if spec.gross_capacity_mw is not None else "",
        f"net heat rate {spec.heat_rate_btu_per_kwh:g} Btu/kWh" if spec.heat_rate_btu_per_kwh is not None else "",
        f"net efficiency {spec.efficiency_pct:g}%" if spec.efficiency_pct is not None else "",
        f"capacity factor {spec.capacity_factor_pct:g}%" if spec.capacity_factor_pct is not None else "",
        f"gas price ${spec.gas_price_per_mmbtu:g}/MMBtu" if spec.gas_price_per_mmbtu is not None else "",
        f"power price ${spec.power_price_per_mwh:g}/MWh" if spec.power_price_per_mwh is not None else "",
        f"CO2 intensity {spec.co2_intensity_t_per_mwh:g} t/MWh" if spec.co2_intensity_t_per_mwh is not None else "",
        f"NOx {spec.nox_ppm:g} ppm" if spec.nox_ppm is not None else "",
    ]
    extracted = "; ".join(part for part in parts if part)
    signals = f" Matched signals: {', '.join(spec.evidence_terms[:6])}." if spec.evidence_terms else ""
    return f"`{path_name_safe(spec.plant_type)}` basis: {extracted or 'plant-level signals were found, but only partial numeric values were extractable'}.{signals}"


def _power_plant_estimate_line(estimate: PowerPlantEstimate) -> str:
    parts = [
        f"annual generation {estimate.annual_generation_gwh:g} GWh/year at {estimate.capacity_factor_pct:g}% capacity factor"
        if estimate.annual_generation_gwh is not None and estimate.capacity_factor_pct is not None
        else "",
        f"annual fuel use {estimate.annual_fuel_mmbtu:,.0f} MMBtu/year" if estimate.annual_fuel_mmbtu is not None else "",
        f"fuel cost ${estimate.fuel_cost_per_mwh:g}/MWh" if estimate.fuel_cost_per_mwh is not None else "",
        f"spark spread ${estimate.spark_spread_per_mwh:g}/MWh" if estimate.spark_spread_per_mwh is not None else "",
        f"CO2 intensity {estimate.co2_intensity_t_per_mwh:g} t/MWh" if estimate.co2_intensity_t_per_mwh is not None else "",
        f"annual CO2 {estimate.annual_co2_t:,.0f} t/year" if estimate.annual_co2_t is not None else "",
        f"electricity exergy factor {estimate.electricity_exergy_factor:g}",
        f"fuel-to-electric exergy-efficiency proxy {estimate.exergy_efficiency_proxy_pct:g}%"
        if estimate.exergy_efficiency_proxy_pct is not None
        else "",
    ]
    line = "; ".join(part for part in parts if part)
    return line or "The extracted values identify the plant type, but not enough capacity, heat-rate, utilization, or price data to compute operating economics."


def path_name_safe(value: str) -> str:
    return value.replace("`", "'")


def _profile_request(prompt: str) -> RequestProfile:
    lower = prompt.lower()
    dimensions: list[str] = []
    dimension_terms: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("economic", ("economic", "financial", "investment", "cost", "capex", "opex", "revenue", "price", "npv", "irr", "payback", "margin", "unit cost", "business case")),
        ("environmental", ("environmental", "emissions", "carbon", "co2", "pollution", "water", "waste", "lifecycle", "life cycle", "permitting", "impact")),
        ("technical", ("technical", "performance", "efficiency", "yield", "capacity", "throughput", "reliability", "availability", "degradation", "operating", "process")),
        ("risk", ("risk", "risks", "diligence", "validate", "validation", "concerns", "feasibility", "bankability", "red flag", "red flags", "prove", "claims")),
        ("operations", ("operations", "operational", "maintenance", "uptime", "downtime", "labor", "staffing", "schedule", "commissioning")),
        ("supply chain", ("supply chain", "supplier", "procurement", "materials", "logistics", "lead time", "manufacturing", "construction")),
        ("market", ("market", "customer", "competitor", "competition", "demand", "pricing", "adoption", "sales")),
        ("safety", ("safety", "hazard", "hazards", "failure mode", "regulatory", "compliance", "permit", "permitting")),
    )
    for label, terms in dimension_terms:
        if any(term in lower for term in terms):
            dimensions.append(label)

    intents: list[str] = []
    intent_terms: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("summarize", ("summarize", "summary", "explain", "what is", "what this is", "what do you find", "tell me what")),
        ("analyze", ("analyze", "analysis", "assess", "assessment", "evaluate", "review", "critique", "what do you think")),
        ("calculate", ("calculate", "compute", "estimate", "model", "quantify", "how much", "what is the value")),
        ("extract", ("extract", "pull out", "find the numbers", "key parameters", "table", "values")),
        ("compare", ("compare", "benchmark", "versus", "vs", "rank", "better", "worse")),
        ("recommend", ("recommend", "next step", "what should", "prioritize", "decision", "focus on")),
        ("chart", ("chart", "plot", "graph", "visualize", "dashboard")),
        ("research", ("research", "literature", "papers", "sources", "latest", "web")),
    )
    for label, terms in intent_terms:
        if any(term in lower for term in terms):
            intents.append(label)

    wants_task_synthesis = bool(
        dimensions
        or any(intent in {"analyze", "calculate", "extract", "compare", "recommend", "chart", "research"} for intent in intents)
    )
    return RequestProfile(
        intents=tuple(_dedupe(intents)) or ("summarize",),
        dimensions=tuple(_dedupe(dimensions)),
        wants_task_synthesis=wants_task_synthesis,
    )


def _is_document_overview_request(prompt: str, request: RequestProfile) -> bool:
    """Detect document-understanding prompts that should preserve rich identity summaries."""

    lower = prompt.lower()
    has_document_cue = bool(
        re.search(r"\b(pdf|file|document|upload|uploaded|attached|info sheet|deck|datasheet|spec sheet)\b", lower)
    )
    has_overview_cue = bool(
        re.search(
            r"\b(analy[sz]e|summari[sz]e|explain|review|extract|key (?:information|specifications|specs|features|parameters)|what (?:is|are|does)|what do you find|tell me)\b",
            lower,
        )
    )
    if not (has_document_cue and has_overview_cue):
        return False

    if any(intent in {"calculate", "compare", "chart", "research"} for intent in request.intents):
        return False

    if re.search(
        r"\b(simulat|model|optimi[sz]e|size|design|npv|irr|lcoe|lcoh|cash flow|sensitivity|scenario|web|latest|literature)\b",
        lower,
    ):
        return False
    if re.search(r"\b(risk|risks|red flags?|diligence|feasibility|bankability|failure modes?|what should we invest|should we invest)\b", lower):
        return False

    complex_dimensions = {"economic", "environmental", "operations", "supply chain", "market", "safety"}
    return not any(dimension in complex_dimensions for dimension in request.dimensions)


def _looks_like_soec_document(text: str) -> bool:
    identity = _primary_document_identity(text)
    return bool(identity and identity.label == "SOEC/high-temperature electrolysis" and identity.score >= 4)


def _looks_like_fischer_tropsch_document(text: str) -> bool:
    identity = _primary_document_identity(text)
    return bool(identity and identity.label == "FT/syngas-to-liquids" and identity.score >= 4)


def _primary_document_identity(text: str) -> DocumentIdentity | None:
    identities = _rank_document_identities(text)
    return identities[0] if identities else None


def _detect_document_use_cases(text: str) -> list[str]:
    use_cases: list[str] = []
    for identity in _dominant_document_identities(text):
        if identity.score >= 4:
            use_cases.extend(identity.use_cases)
    return _dedupe(use_cases)


def _dominant_document_identities(text: str) -> list[DocumentIdentity]:
    identities = _rank_document_identities(text)
    if not identities:
        return []
    primary = identities[0]
    dominant = [primary] if primary.score >= 4 else []
    for identity in identities[1:]:
        if identity.score >= 6 and identity.score >= primary.score * 0.7:
            dominant.append(identity)
    return dominant[:3]


def _rank_document_identities(text: str) -> list[DocumentIdentity]:
    lower = text.lower()
    early = lower[:3000]
    headings_text = " ".join(_first_headings(text)[:6]).lower()
    title_zone = f"{headings_text}\n{early}"
    profiles: tuple[tuple[str, tuple[str, ...], tuple[str, ...], tuple[str, ...]], ...] = (
        (
            "SOEC/high-temperature electrolysis",
            ("solid-oxide-electrolysis", "electrolysis", "synthetic-fuels"),
            ("solid oxide electrolysis", "high temperature electrolysis", "high temperature co-electrolysis", "soec", "htce"),
            ("steam", "co2", "oxygen", "hydrogen", "synthesis gas", "co-electrolysis", "solid oxide fuel cell"),
        ),
        (
            "FT/syngas-to-liquids",
            ("syngas-to-liquids", "synthetic-fuels", "reactor-catalysis"),
            ("fischer tropsch", "fischer-tropsch", "ft synthesis", "ft technology", "syngas-to-liquids"),
            ("fixed bed", "anderson-schulz", "asf", "alpha", "liquid hydrocarbons", "waxes", "catalyst", "reactor"),
        ),
        (
            "heat pump/HVAC",
            ("heat-pump-hvac", "thermal-exergy"),
            ("heat pump", "air handler", "outdoor unit", "ahri 210/240", "hspf"),
            ("seer", "eer", "cop", "heating capacity", "cooling capacity", "btu/h", "defrost"),
        ),
        (
            "hydrogen/electrolyzer",
            ("electrolysis", "hydrogen", "thermal-exergy"),
            ("electrolyzer", "electrolyser", "electrolysis", "green hydrogen", "hydrogen production"),
            ("current density", "cell voltage", "stack", "membrane", "faradaic", "oxygen", "water"),
        ),
        (
            "carbon capture/DAC",
            ("carbon-capture", "direct-air-capture", "thermal-exergy"),
            ("direct air capture", "carbon capture", "dac", "co2 capture", "amine"),
            ("sorbent", "regeneration", "capture rate", "co2", "adsorption", "desorption", "energy penalty"),
        ),
        (
            "battery/storage",
            ("battery-storage", "electrochemical-storage"),
            ("battery", "lithium-ion", "cell", "module", "pack", "bess"),
            ("cycle life", "capacity", "soc", "soh", "c-rate", "voltage", "degradation"),
        ),
        (
            "solar PV",
            ("solar-pv", "photovoltaic"),
            ("solar module", "photovoltaic", "pv module", "solar panel", "canadian solar", "hiku", "nominal max. power", "module efficiency"),
            ("stc", "ptc", "pmax", "open circuit voltage", "short circuit current", "temperature coefficient", "irradiance", "bifacial", "warranty"),
        ),
        (
            "wind turbine",
            ("wind-turbine", "renewable-power"),
            ("wind turbine", "wind farm", "power curve", "nacelle"),
            ("wind speed", "rotor", "blade", "yaw", "capacity factor", "curtailment"),
        ),
        (
            "power plant/thermal generation",
            ("power-plant", "thermal-generation", "plant-performance"),
            ("combined cycle", "ccgt", "ngcc", "gas turbine", "steam turbine", "power plant", "power station", "net heat rate"),
            ("hrsg", "heat recovery steam generator", "net output", "gross output", "capacity factor", "btu/kwh", "mmbtu/mwh", "spark spread"),
        ),
        (
            "steel/metals production",
            ("steel", "metals-production", "industrial-decarbonization"),
            ("steel plant", "green steel", "direct reduced iron", "dri", "hbi", "electric arc furnace", "blast furnace"),
            ("metallization", "iron ore", "pellet", "scrap", "shaft furnace", "eaf", "reduction", "hydrogen", "natural gas"),
        ),
        (
            "cement/concrete",
            ("cement", "concrete", "industrial-decarbonization"),
            ("cement kiln", "clinker", "calcination", "portland cement", "low-carbon cement", "carbon mineralization", "concrete"),
            ("limestone", "kiln", "calciner", "clinker factor", "scm", "supplementary cementitious", "process emissions"),
        ),
        (
            "water/desalination",
            ("water-treatment", "desalination", "industrial-water"),
            ("desalination", "reverse osmosis", "water reuse", "wastewater", "brine", "membrane filtration", "ceramic membrane"),
            ("recovery", "salinity", "pretreatment", "fouling", "cleaning", "m3/day", "m³/day", "kwh/m3", "discharge"),
        ),
        (
            "mining/critical minerals",
            ("mining", "critical-minerals", "materials-processing"),
            ("direct lithium extraction", "lithium brine", "critical minerals", "rare earth", "copper mine", "nickel mine", "tailings"),
            ("ore", "grade", "recovery", "beneficiation", "leaching", "solvent extraction", "spodumene", "brine", "lce"),
        ),
        (
            "geothermal",
            ("geothermal", "renewable-power", "thermal-exergy"),
            ("geothermal", "enhanced geothermal", "egs", "closed-loop geothermal", "geothermal brine"),
            ("reservoir", "well", "injection", "production temperature", "binary cycle", "orc", "drilling", "flow rate"),
        ),
        (
            "biofuels/SAF",
            ("biofuels", "sustainable-aviation-fuel", "low-carbon-fuels"),
            ("sustainable aviation fuel", "saf", "renewable diesel", "biofuel", "hefa", "ethanol", "anaerobic digestion", "biogas"),
            ("feedstock", "hydrotreating", "pyrolysis", "gasification", "carbon intensity", "gco2e/mj", "astm", "blend"),
        ),
        (
            "chemical/process plant",
            ("chemical-processing", "process-plant", "industrial-decarbonization"),
            ("chemical plant", "process plant", "ammonia plant", "green ammonia", "haber bosch", "methanol plant", "ethylene"),
            ("reactor", "distillation", "separation", "conversion", "selectivity", "yield", "heat duty", "feedstock"),
        ),
        (
            "data center/compute infrastructure",
            ("data-center", "compute-infrastructure", "power-and-cooling"),
            ("data center", "datacenter", "ai compute", "gpu cluster", "server rack", "colocation"),
            ("pue", "rack density", "cooling", "immersion cooling", "wue", "ups", "waste heat", "district heating"),
        ),
        (
            "grid/transmission",
            ("grid-infrastructure", "transmission", "power-systems"),
            ("transmission line", "substation", "interconnection", "grid upgrade", "transformer", "switchyard"),
            ("curtailment", "queue", "mwac", "mva", "voltage", "breaker", "reactive power", "protection"),
        ),
        (
            "fuel cell/power system",
            ("fuel-cell", "electrochemical-power", "hydrogen"),
            ("fuel cell", "pemfc", "sofc", "solid oxide fuel cell", "fuel-cell stack"),
            ("stack voltage", "current density", "hydrogen utilization", "degradation", "balance of plant", "waste heat"),
        ),
        (
            "district heating",
            ("district-heating", "thermal-exergy"),
            ("district heating", "heat network", "substation"),
            ("supply temperature", "return temperature", "flow rate", "thermal demand", "branch"),
        ),
        (
            "industrial waste heat",
            ("industrial-waste-heat", "thermal-exergy"),
            ("waste heat", "heat recovery", "exhaust heat", "process heat"),
            ("kiln", "oven", "dryer", "compressor", "exhaust", "temperature", "operating hours"),
        ),
        (
            "nuclear/SMR",
            ("nuclear-fission", "small-modular-reactor"),
            ("small modular reactor", "smr", "nuclear reactor", "pressurized water reactor"),
            ("thermal power", "fuel assembly", "enrichment", "coolant", "dnbr", "decay heat"),
        ),
        (
            "techno-economics",
            ("techno-economics", "financial-analysis"),
            ("capex", "opex", "npv", "irr", "payback", "lcoe", "financial model"),
            ("discount rate", "utilization", "price", "cost", "revenue", "sensitivity"),
        ),
    )
    identities: list[DocumentIdentity] = []
    for label, use_cases, identity_terms, support_terms in profiles:
        score = 0.0
        evidence_terms: list[str] = []
        for term in identity_terms:
            early_count = title_zone.count(term)
            full_count = lower.count(term)
            if early_count:
                score += 4.0 + min(early_count - 1, 2) * 1.5
                evidence_terms.append(term)
            elif full_count:
                score += min(full_count, 3) * 0.75
                evidence_terms.append(term)
        for term in support_terms:
            early_count = title_zone.count(term)
            full_count = lower.count(term)
            if early_count:
                score += 1.0
                evidence_terms.append(term)
            elif full_count:
                score += min(full_count, 2) * 0.35
                evidence_terms.append(term)
        if score >= 2.5:
            identities.append(
                DocumentIdentity(
                    label=label,
                    use_cases=use_cases,
                    score=round(score, 2),
                    evidence_terms=tuple(_dedupe(evidence_terms)[:8]),
                )
            )
    identities.sort(key=lambda item: item.score, reverse=True)
    return identities


def _analyze_soec_document(
    path: Path,
    text: str,
    _parser: str,
) -> tuple[list[ClientInsight], list[str], list[str]]:
    facts = _soec_visible_facts(text)
    fact_line = "; ".join(facts)
    insights = [
        ClientInsight(
            title="This is an SOEC and high-temperature co-electrolysis information sheet",
            evidence=(
                "The document describes OxEon solid oxide electrolysis cells operating like a solid oxide fuel cell in reverse: electricity is used to convert steam to hydrogen, or steam plus CO2 to synthesis gas."
            ),
            recommendation=(
                "Use it as a technology overview and diligence checklist for SOEC/HTCE; do not treat it as validated stack performance, durability, or economics by itself."
            ),
            support=ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="The useful extracted parameters are SOEC operating and scale-up claims",
            evidence=(
                f"{fact_line}."
                if fact_line
                else "The extract describes electrolysis, co-electrolysis, stack hardware, syngas production, and scale-up context, but it does not provide a complete mass, heat, or electrical balance."
            ),
            recommendation=(
                "Turn these into a stack-test checklist: feed composition, current, voltage, temperature, pressure, product composition, conversion, heat input, degradation, and runtime."
            ),
            support=ClaimSupport.OBSERVED,
        ),
    ]
    limits = [
        "The information sheet does not prove cell voltage, stack efficiency, Faradaic efficiency, CO2 conversion, product purity, degradation rate, thermal balance, uptime, safety, scale-up readiness, or economics.",
        "It is not enough by itself to compute exergy, system efficiency, hydrogen cost, syngas cost, NPV, IRR, CAPEX, OPEX, or bankability.",
    ]
    next_steps = [
        "Request the source stack test report with feed composition, steam/CO2 utilization, current density, cell voltage, temperature, pressure, product composition, electrical input, heat input, runtime, and degradation rate.",
        "Request system boundary data: stack area, balance-of-plant power, heat recovery assumptions, water and CO2 conditioning loads, oxygen handling, compression, controls, and shutdown/startup behavior.",
        "For economics, request stack lifetime, stack replacement cost, manufacturing scale basis, CAPEX/OPEX, electricity price, heat integration basis, utilization, and target product value.",
    ]
    return insights, limits, next_steps


def _soec_visible_facts(text: str) -> list[str]:
    lower = text.lower()
    facts: list[str] = []
    if "solid oxide fuel cells" in lower or "sofc" in lower:
        facts.append("It frames SOEC/HTCE as solid oxide fuel cell technology operated in reverse")
    if ("h2o" in lower and "electric" in lower and "o2" in lower) or (
        "electricity" in lower and "hydrogen from steam" in lower
    ):
        facts.append("It states that steam electrolysis uses electricity to produce hydrogen")
    if "co2" in lower and "synthesis gas" in lower:
        facts.append("It states that co-electrolysis of steam and CO2 can produce synthesis gas")
    if "21 metric tons" in lower and "28 metric tons" in lower and "gwh" in lower:
        facts.append("It claims about 28 metric tons of H2 per GWh for SOEC versus about 21 metric tons per GWh for a low-temperature system")
    if "90% steam" in lower and "90% co2" in lower:
        facts.append("It describes inlet feeds near 90% steam/10% H2 and 90% CO2/10% CO with outlet compositions approximately inverted")
    if "18 kwe" in lower:
        facts.append("It says the largest unit built at the time was an 18 kWe SOEC unit")
    if "5000 lph" in lower or "5,000 lph" in lower:
        facts.append("It reports about 5000 lph hydrogen production at full capacity for that 18 kWe unit")
    if "1000 hours" in lower or "1,000 hours" in lower:
        facts.append("It reports roughly 1,000 hours in electrolysis mode and roughly 1,000 hours in co-electrolysis mode")
    if "twelve (12)" in lower and "sixty (60)" in lower:
        facts.append("It describes twelve stacks, with sixty cells per stack, in the laboratory unit")
    if "twenty-one (21) liters per minute" in lower or "21 liters per minute" in lower:
        facts.append("It states each 60-cell stack would generate about 21 lpm of H2 under current operating parameters")
    if "eighteen thousand (18,000)" in lower or "18,000" in lower and "stacks" in lower:
        facts.append("It mentions a manufacturing study for about 18,000 stacks per year")
    if "nasa" in lower or "jet propulsion laboratory" in lower or "mars" in lower:
        facts.append("It references a NASA/JPL Mars oxygen-production project as development context")
    return facts[:10]


def _analyze_fischer_tropsch_document(
    path: Path,
    text: str,
    _parser: str,
) -> tuple[list[ClientInsight], list[str], list[str]]:
    facts = _fischer_tropsch_visible_facts(text)
    fact_line = "; ".join(facts)
    insights = [
        ClientInsight(
            title="This is an FT/syngas-to-liquids technology information sheet",
            evidence=(
                "The document describes catalytic syngas-to-liquids synthesis: converting carbon monoxide and hydrogen or syngas into liquid hydrocarbons and waxes over catalysts."
            ),
            recommendation=(
                "Use it to understand the process, claims, and next evidence requests; do not treat it as a validated performance or economics report."
            ),
            support=ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="The useful extracted parameters are process-flow and reactor inputs",
            evidence=(
                fact_line
                if fact_line
                else "The extract discusses reactor configuration, catalysts, product distribution, and operating conditions, but does not provide a full mass or energy balance."
            ),
            recommendation=(
                "Turn these into a process-flow checklist: syngas feed, recycle, reactor, catalyst, heat removal, product separation, wax/upgrading, and light-gas handling."
            ),
            support=ClaimSupport.OBSERVED,
        ),
    ]
    limits = [
        "The information sheet does not prove conversion, selectivity, product yield, catalyst life, heat balance, uptime, emissions, scale-up readiness, or plant economics.",
        "It is not enough by itself to compute exergy, NPV, IRR, payback, CAPEX, OPEX, or bankability.",
    ]
    next_steps = [
        "Request the source test report with syngas composition, flow rate, CO conversion, H2/CO ratio, product selectivity, product distribution, runtime, and uncertainty.",
        "Request reactor operating data: temperature profile, pressure, catalyst identity/loading, heat-removal duty, recycle ratio, and deactivation or regeneration history.",
        "For economics, request scale basis, CAPEX/OPEX, feedstock cost, utilities, product slate/prices, upgrading requirements, and uptime assumptions.",
    ]
    return insights, limits, next_steps


def _fischer_tropsch_visible_facts(text: str) -> list[str]:
    lower = text.lower()
    facts: list[str] = []
    if "compact" in lower and "fixed bed" in lower:
        facts.append("It describes a compact, transportable fixed-bed FT process")
    if "heat transfer insert" in lower:
        facts.append("It claims a proprietary reactor heat-transfer insert for larger reactor tubes")
    if "~5 gpd" in lower or "5 gallons per day" in lower or "5 gpd" in lower:
        facts.append("It reports laboratory-scale production around 5 GPD")
    if "2 bpd" in lower:
        facts.append("It mentions a 2 BPD system operated on gasifier syngas")
    if "300 psi" in lower:
        facts.append("It lists typical synthesis-gas inlet pressure around 300 psi")
    if "230" in lower and ("bed temperature" in lower or "230o c" in lower or "230 c" in lower):
        facts.append("It lists typical reactor bed temperature around 230 C")
    if "alpha" in lower and ".84" in lower:
        facts.append("It lists a typical Anderson-Schulz-Flory alpha around 0.84")
    if "iron" in lower and "cobalt" in lower and "catalyst" in lower:
        facts.append("It discusses iron, cobalt, and hybrid catalyst options")
    if "hybrid catalyst" in lower and ("zeolite" in lower or "cracking" in lower):
        facts.append("It says hybrid zeolite/cracking catalysts can shift product distribution and reduce post-processing")
    return facts[:8]


def _analyze_generic_extracted_document(
    path: Path,
    prompt: str,
    text: str,
    parser: str,
) -> tuple[list[ClientInsight], list[str], list[str]]:
    request = _profile_request(prompt)
    identities = _dominant_document_identities(text + "\n" + prompt)
    identity = identities[0] if identities else None
    domain_signals = [item.label for item in identities[:4]] or _domain_signals(text + "\n" + prompt)
    numbers = _notable_quantities(text)
    first_headings = _first_headings(text)
    key_points = _key_document_points(text, prompt, identities)
    parameter_candidates = _parameter_candidates(text, request, identities)
    dimension_findings = _dimension_findings(text, request.dimensions)
    subject = _document_subject(path, text, identity, first_headings)
    signal_line = ", ".join(domain_signals[:3]) if domain_signals else "general technical/business context"
    points_line = f"Key points from the document: {'; '.join(key_points[:4])}." if key_points else ""
    quantity_line = f"Notable quantities include {', '.join(numbers[:8])}." if numbers else "I did not find a calculation-ready table in the readable text."
    if points_line:
        overview_evidence = f"{points_line} {quantity_line}"
    elif first_headings:
        overview_evidence = f"The readable text is organized around headings such as {', '.join(first_headings[:4])}. {quantity_line}"
    else:
        overview_evidence = f"The readable text points to {signal_line}. {quantity_line}"
    insights = [
        ClientInsight(
                title=f"This appears to be {subject}",
                evidence=overview_evidence,
                recommendation=_initial_generic_recommendation(request),
                support=ClaimSupport.OBSERVED,
        )
    ]
    if dimension_findings:
        insights.append(
            ClientInsight(
                title=f"Requested {' and '.join(request.dimensions)} analysis can start from the extracted evidence",
                evidence=" ".join(f"{label.capitalize()}: {finding}" for label, finding in dimension_findings),
                recommendation=_dimension_recommendation(request.dimensions),
                support=ClaimSupport.INFERRED,
            )
        )
    if parameter_candidates:
        insights.append(
            ClientInsight(
                title="The extracted numbers can be organized into a first parameter table",
                evidence="; ".join(parameter_candidates[:8]) + ".",
                recommendation=(
                    "Use these as parameter candidates with source-line provenance, then normalize units and mark any missing boundary conditions before calculating."
                ),
                support=ClaimSupport.OBSERVED,
            )
        )
    insights.append(
        ClientInsight(
            title="The useful next step is to turn claims and numbers into a decision-ready evidence map",
            evidence=(
                f"{quantity_line} The document text can support a plain-language explanation and first-pass analysis, "
                "but it does not automatically prove performance, economics, reliability, compliance, or safety."
            ),
            recommendation=_next_tool_recommendation(request),
            support=ClaimSupport.INFERRED,
        )
    )
    return (
        insights,
        [
            "This is a summary of the readable document text; it does not independently validate embedded claims against instruments, invoices, meter data, test records, or third-party sources.",
            _generic_limit_for_request(request),
        ],
        _generic_next_steps_for_request(request, identity),
    )


def _initial_generic_recommendation(request: RequestProfile) -> str:
    if request.dimensions:
        return (
            "Treat this as a first-pass, evidence-grounded response to the requested analysis; separate document claims from verified facts before making a decision."
        )
    if "extract" in request.intents:
        return "Use the extracted text to build a parameter list, then request table exports for repeated values and units."
    if "calculate" in request.intents:
        return "Use the extracted quantities to identify possible calculations, but only compute results where units, boundaries, and formulas are explicit."
    if "compare" in request.intents:
        return "Use this as the source profile for comparison, then compare against a named benchmark or reference case."
    return "The document can support a plain-language summary; calculations need explicit units, boundaries, and source data."


def _dimension_findings(text: str, dimensions: tuple[str, ...]) -> list[tuple[str, str]]:
    findings: list[tuple[str, str]] = []
    for dimension in dimensions:
        sentences = _sentences_for_dimension(text, dimension)
        if sentences:
            findings.append((dimension, "; ".join(sentences[:3]) + "."))
        else:
            findings.append((dimension, "the document does not expose enough clear evidence for this dimension in the extracted text."))
    return findings


def _sentences_for_dimension(text: str, dimension: str) -> list[str]:
    terms_by_dimension: dict[str, tuple[str, ...]] = {
        "economic": ("economic", "commercial", "financial", "capex", "opex", "cost", "price", "revenue", "margin", "payback", "npv", "irr", "credit", "tariff", "utilization", "lifetime", "investment"),
        "environmental": ("environmental", "emission", "carbon", "co2", "pollution", "water", "freshwater", "brine", "waste", "permit", "permitting", "lifecycle", "life cycle", "abatement", "discharge"),
        "technical": ("efficiency", "performance", "capacity", "throughput", "yield", "temperature", "pressure", "power", "energy", "reliability", "degradation", "conversion"),
        "risk": ("risk", "uncertain", "open item", "gap", "validate", "validation", "assumption", "liability", "failure", "degradation", "unproven"),
        "operations": ("maintenance", "uptime", "downtime", "labor", "commissioning", "startup", "shutdown", "availability", "schedule", "operating"),
        "supply chain": ("supplier", "procurement", "material", "logistics", "lead time", "manufacturing", "construction", "contract", "delivery"),
        "market": ("market", "customer", "demand", "pricing", "sales", "competitor", "offtake", "contract", "adoption"),
        "safety": ("safety", "hazard", "regulatory", "compliance", "permit", "failure mode", "toxic", "flammable", "pressure", "emergency"),
    }
    terms = terms_by_dimension.get(dimension, ())
    scored: list[tuple[float, int, str]] = []
    for index, sentence in enumerate(_candidate_sentences(text)[:220]):
        lower = sentence.lower()
        if _looks_like_noise_line(sentence):
            continue
        hits = sum(1 for term in terms if term in lower)
        if hits == 0:
            continue
        score = float(hits)
        if _notable_quantities(sentence):
            score += 1.0
        if index < 60:
            score += 0.5
        scored.append((score, index, _truncate_sentence(sentence, 240)))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return _dedupe([item[2] for item in sorted(scored[:4], key=lambda item: item[1])])[:3]


def _dimension_recommendation(dimensions: tuple[str, ...]) -> str:
    requests = []
    if "economic" in dimensions:
        requests.append("dated cost basis, operating hours/utilization, revenue or avoided-cost basis, incentives, project life, and discount rate")
    if "environmental" in dimensions:
        requests.append("baseline, boundary, measured emissions or resource flows, abatement method, and monitoring/verification basis")
    if "technical" in dimensions:
        requests.append("test conditions, measured inputs/outputs, rated versus actual performance, uptime, and degradation basis")
    if "risk" in dimensions:
        requests.append("assumption log, unresolved evidence gaps, counterparty dependencies, and failure modes")
    if "operations" in dimensions:
        requests.append("staffing, maintenance plan, downtime assumptions, commissioning plan, and control constraints")
    if "supply chain" in dimensions:
        requests.append("supplier list, long-lead items, material constraints, logistics assumptions, and contract status")
    if "market" in dimensions:
        requests.append("customer/offtake evidence, competitor benchmark, price basis, and adoption constraints")
    if "safety" in dimensions:
        requests.append("hazard analysis, compliance basis, permits, operating limits, and emergency controls")
    if not requests:
        return "Convert the extracted claims into an evidence table with source, value, unit, basis, confidence, and unresolved gaps."
    return "To strengthen the analysis, request " + "; ".join(_dedupe(requests)[:4]) + "."


def _next_tool_recommendation(request: RequestProfile) -> str:
    if "calculate" in request.intents:
        return "Run a calculation only for values with explicit units and boundaries; otherwise return the missing inputs required for the calculation."
    if "extract" in request.intents:
        return "Convert the extracted claims into a structured parameter table with value, unit, source line, and confidence."
    if "compare" in request.intents:
        return "Ask for or select a reference case, then compare only normalized metrics with matching units and boundaries."
    if "chart" in request.intents:
        return "Create charts only from repeated numeric series or tables; otherwise first extract the chart-ready data."
    if "research" in request.intents:
        return "Use literature or web research to benchmark the claims against independent sources, then reconcile differences."
    if request.dimensions:
        return "Build a concise brief for the requested dimensions now, then request the missing evidence needed for decision-grade confidence."
    return "Ask a concrete follow-up such as compare, calculate, chart, diligence review, or extract parameters; the agent should then choose the appropriate tool path."


def _generic_limit_for_request(request: RequestProfile) -> str:
    if request.dimensions:
        return (
            "The requested analysis is bounded by the available evidence until source-backed units, operating boundaries, baseline/reference case, and independent validation are available."
        )
    if "calculate" in request.intents:
        return "Any calculation still requires explicit units, formulas, timestamps or operating points, system boundaries, and reference conditions."
    return "Any calculation or investment conclusion still requires explicit units, timestamps, operating boundaries, and reference conditions."


def _generic_next_steps_for_request(request: RequestProfile, identity: DocumentIdentity | None = None) -> list[str]:
    steps: list[str] = []
    if identity:
        steps.extend(_domain_specific_next_steps(identity))
    if request.dimensions:
        steps.append(_dimension_recommendation(request.dimensions))
    if "calculate" in request.intents:
        steps.append("List the target formula or metric, then map each required input to an extracted value or a missing-input request.")
    if "extract" in request.intents or request.dimensions:
        steps.append("Create a parameter/evidence table with columns for claim, value, unit, source text, basis, and confidence.")
    if "compare" in request.intents:
        steps.append("Provide the comparison target or benchmark dataset and normalize units before ranking.")
    if "chart" in request.intents:
        steps.append("Extract repeated numeric series into CSV/XLSX before generating a chart.")
    if not steps:
        steps.extend(
            [
                "If the document contains tables or charted values, extract them into CSV/XLSX with units in the headers.",
                "State the next decision: quick explanation, parameter extraction, exergy calculation, techno-economic screen, chart, comparison, or diligence memo.",
            ]
        )
    return _dedupe(steps)


def _domain_specific_next_steps(identity: DocumentIdentity) -> list[str]:
    label = identity.label
    use_cases = set(identity.use_cases)
    if "water-treatment" in use_cases or "desalination" in use_cases:
        return [
            "For water projects, request feed-water quality, product-water target, brine/discharge boundary, recovery, pressure, membrane area, cleaning schedule, energy intensity, uptime, and disposal/permit basis.",
        ]
    if "critical-minerals" in use_cases or "mining" in use_cases:
        return [
            "For mining or critical-minerals projects, request ore/brine grade distribution, recovery by stage, reagent and water balance, tailings/reinjection plan, product specification, ramp schedule, and reserve/resource basis.",
        ]
    if "geothermal" in use_cases:
        return [
            "For geothermal projects, request well count/depth, production and injection temperature, flow rate, reservoir model, pump load, drilling cost, capacity factor, decline curve, and interconnection basis.",
        ]
    if "sustainable-aviation-fuel" in use_cases or "biofuels" in use_cases:
        return [
            "For fuel projects, request feedstock source/price, conversion yield, hydrogen and utility use, product slate, carbon-intensity method, certification pathway, offtake, uptime, and upgrading requirements.",
        ]
    if "chemical-processing" in use_cases or "process-plant" in use_cases:
        return [
            "For process plants, request mass and energy balance, feed composition, conversion/selectivity/yield, heat duties, recycle/purge streams, utility prices, catalyst life, product specs, and operating envelope.",
        ]
    if "data-center" in use_cases:
        return [
            "For data centers, request IT load, PUE/WUE basis, rack density, cooling design, uptime tier, power contract, backup generation, interconnection limits, heat-reuse temperatures, and water constraints.",
        ]
    if "steel" in use_cases or "metals-production" in use_cases:
        return [
            "For metals projects, request feedstock grade, production route, energy and reductant intensity, yield, product spec, emissions boundary, furnace/load profile, utilization, and retrofit or greenfield cost basis.",
        ]
    if "cement" in use_cases or "concrete" in use_cases:
        return [
            "For cement or concrete projects, request clinker factor, kiln fuel, limestone/process emissions, SCM availability, capture/mineralization boundary, product performance, certification, and plant-level production data.",
        ]
    if "grid-infrastructure" in use_cases:
        return [
            "For grid projects, request one-line diagram, voltage/MVA ratings, interconnection queue status, load-flow limits, protection requirements, curtailment basis, outage constraints, and EPC/interconnection cost scope.",
        ]
    if "fuel-cell" in use_cases:
        return [
            "For fuel-cell systems, request stack voltage/current-density maps, fuel utilization, degradation rate, balance-of-plant parasitics, thermal integration, fuel supply purity, availability, and replacement schedule.",
        ]
    if "carbon-capture" in use_cases or "direct-air-capture" in use_cases:
        return [
            "For carbon-capture projects, request capture rate, inlet/outlet CO2 basis, regeneration energy, compression duty, sorbent lifetime, water balance, monitoring/verification plan, and storage/offtake route.",
        ]
    if "hydrogen" in use_cases or "electrolysis" in use_cases:
        return [
            "For hydrogen projects, request stack power, production rate, specific energy, water quality, operating pressure, utilization, degradation, balance-of-plant loads, electricity price, and compression/storage boundary.",
        ]
    return [f"For {label}, request source-backed values, units, operating basis, measured versus claimed status, and the missing assumptions needed for a decision-grade calculation."]


def _document_subject(
    path: Path,
    text: str,
    identity: DocumentIdentity | None,
    headings: list[str],
) -> str:
    if identity and identity.score >= 4:
        return f"a technical document about {identity.label}"
    for heading in headings:
        clean = _clean_sentence(heading)
        if 8 <= len(clean) <= 90 and not _looks_like_noise_line(clean):
            return f"a document about {clean}"
    stem = path.stem.replace("_", " ").replace("-", " ").strip()
    if stem:
        return f"a document related to {stem}"
    return "a readable technical document"


def _key_document_points(text: str, prompt: str, identities: list[DocumentIdentity]) -> list[str]:
    identity_terms = {
        term
        for identity in identities[:3]
        for term in identity.evidence_terms
    }
    prompt_terms = {
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9+-]{3,}", prompt.lower())
        if token not in {"please", "analyze", "document", "uploaded", "attached", "file"}
    }
    candidates: list[tuple[float, int, str]] = []
    chunks = _candidate_sentences(text)
    for index, sentence in enumerate(chunks[:180]):
        lower = sentence.lower()
        if _looks_like_noise_line(sentence):
            continue
        score = 0.0
        if index < 18:
            score += 2.0
        if index < 45:
            score += 1.0
        if any(term in lower for term in identity_terms):
            score += 2.5
        if any(term in lower for term in prompt_terms):
            score += 1.0
        if _notable_quantities(sentence):
            score += 1.5
        if re.search(r"\b(describes|uses|produces|converts|generates|reports|claims|shows|includes|requires|operates|provides|based on)\b", lower):
            score += 1.0
        if len(sentence) < 35 or len(sentence) > 320:
            score -= 1.5
        if score >= 2.0:
            candidates.append((score, index, _truncate_sentence(sentence, 240)))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    selected = sorted(candidates[:6], key=lambda item: item[1])
    return _dedupe([item[2] for item in selected])[:5]


def _parameter_candidates(text: str, request: RequestProfile, identities: list[DocumentIdentity]) -> list[str]:
    identity_terms = {
        term
        for identity in identities[:3]
        for term in identity.evidence_terms
    }
    rows: list[tuple[float, int, str]] = []
    for index, sentence in enumerate(_candidate_sentences(text)[:240]):
        quantities = _notable_quantities(sentence)
        if not quantities:
            continue
        label = _parameter_label(sentence)
        score = 1.0
        lower = sentence.lower()
        if any(term in lower for term in identity_terms):
            score += 1.5
        if any(dimension in {"economic", "environmental", "technical", "operations"} for dimension in request.dimensions):
            score += 0.5
        if label != "parameter":
            score += 0.75
        if index < 80:
            score += 0.5
        value_text = ", ".join(quantities[:4])
        context = _truncate_sentence(sentence, 170)
        rows.append((score, index, f"{label}: {value_text} ({context})"))
    rows.sort(key=lambda item: (-item[0], item[1]))
    selected = sorted(rows[:10], key=lambda item: item[1])
    return _dedupe([item[2] for item in selected])[:8]


def _parameter_label(sentence: str) -> str:
    lower = sentence.lower()
    label_terms: tuple[tuple[str, tuple[str, ...]], ...] = (
        ("capacity/throughput", ("capacity", "throughput", "output", "production", "treats", "captures", "generates", "load", "it load")),
        ("energy intensity", ("energy intensity", "specific energy", "specific power", "electricity intensity", "kwh/", "mwh/", "gj/")),
        ("temperature/pressure", ("temperature", "pressure", "bar", "psi", "reservoir", "steam", "heat", "cooling")),
        ("financial basis", ("capex", "installed cost", "opex", "operating cost", "revenue", "price", "payback", "service agreement", "$", "usd")),
        ("environmental basis", ("co2", "carbon", "emission", "water", "brine", "waste", "ci score", "carbon intensity", "freshwater")),
        ("efficiency/recovery", ("efficiency", "recovery", "yield", "conversion", "selectivity", "metallization", "capacity factor", "pue", "wue")),
        ("lifetime/reliability", ("life", "lifetime", "degradation", "availability", "uptime", "runtime", "warranty", "replacement")),
        ("feedstock/material", ("feedstock", "ore", "brine", "grade", "lithium", "hydrogen consumption", "reagent", "scrap")),
    )
    for label, terms in label_terms:
        if any(term in lower for term in terms):
            return label
    return "parameter"


def _candidate_sentences(text: str) -> list[str]:
    normalized = re.sub(r"[ \t]+", " ", text.replace("\r", "\n"))
    raw_chunks: list[str] = []
    for line in normalized.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if len(stripped) <= 120:
            raw_chunks.append(stripped)
            continue
        raw_chunks.extend(re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])", stripped))
    return [_clean_sentence(chunk) for chunk in raw_chunks if _clean_sentence(chunk)]


def _notable_quantities(text: str) -> list[str]:
    unit_pattern = (
        r"(?:kWh/[a-zA-Z0-9.]+|MWh/[a-zA-Z0-9.]+|GJ/[a-zA-Z0-9.]+|MMBtu/[a-zA-Z0-9.]+|"
        r"m3/[a-zA-Z0-9.]+|m³/[a-zA-Z0-9.]+|kg/[a-zA-Z0-9.]+|t/[a-zA-Z0-9.]+|"
        r"tonnes?/year|tonnes?/day|tons?/year|tons?/day|million gallons?/year|million tonnes?/year|"
        r"tpa|ktpa|mtpa|MTPA|LCE|mg/L|ppm|gCO2e/MJ|kgCO2e/[a-zA-Z0-9.]+|"
        r"%|kW(?:e|h)?|MW(?:e|h)?|GW(?:e|h)?|MVA|MWac|MWdc|BTU/h|Btu/h|psi|bar|°C|C\b|K\b|"
        r"lph|lpm|gpd|bpd|gallons?/year|hours?|hrs?|years?|metric tons?|tonnes?|tons?|kg|g|A/cm2|A/cm²|V\b|"
        r"million USD|USD/[a-zA-Z0-9.]+|USD|\$/[a-zA-Z0-9.]+|\$)"
    )
    pattern = re.compile(
        rf"(?:\$?\s*[-+]?\d[\d,]*(?:\.\d+)?\s*(?:~\s*)?{unit_pattern}|~\s*\d[\d,]*(?:\.\d+)?\s*{unit_pattern})",
        re.IGNORECASE,
    )
    values = []
    for match in pattern.finditer(text):
        value = re.sub(r"\s+", " ", match.group(0)).strip()
        if value and value not in values:
            values.append(value)
        if len(values) >= 12:
            break
    return values


def _looks_like_noise_line(text: str) -> bool:
    lower = text.lower().strip()
    if not lower:
        return True
    if lower.startswith("figure ") or lower.startswith("table "):
        return True
    if "contact information" in lower or "@" in lower or "www." in lower:
        return True
    if re.fullmatch(r"[.\-_/\\\s\d]+", lower):
        return True
    return False


def _clean_sentence(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(" -•\t")


def _truncate_sentence(text: str, max_len: int) -> str:
    clean = _clean_sentence(text)
    if len(clean) <= max_len:
        return clean
    return clean[: max_len - 1].rsplit(" ", 1)[0].rstrip(" ,;:") + "."


def _analyze_xlsx(path: Path) -> tuple[list[ClientInsight], list[str], list[str]]:
    try:
        import openpyxl  # type: ignore[import-not-found]
    except Exception:
        return (
            [
                ClientInsight(
                    title="The spreadsheet needs the optional XLSX parser",
                    evidence="The upload is an XLSX workbook, but openpyxl is not installed in this runtime.",
                    recommendation="Install openpyxl or export the relevant sheet as CSV.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No spreadsheet calculations were performed because the workbook could not be opened."],
            ["Install openpyxl or upload the target worksheet as CSV with units in the headers."],
        )

    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:
        return (
            [
                ClientInsight(
                    title="The spreadsheet could not be opened cleanly",
                    evidence=f"The XLSX parser raised {exc.__class__.__name__}: {str(exc)[:120]}.",
                    recommendation="Re-export the workbook or upload the relevant sheet as CSV.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No calculations should be made from a workbook that failed to parse."],
            ["Upload a clean XLSX or neutral CSV export of the target sheet."],
        )

    sheet_profiles = []
    first_rows: list[dict[str, str]] = []
    for sheet in workbook.worksheets:
        rows_iter = sheet.iter_rows(values_only=True)
        header_values = next(rows_iter, None)
        headers = [str(value).strip() if value is not None else "" for value in (header_values or ())]
        non_empty_headers = [header for header in headers if header]
        row_count = 0
        for values in rows_iter:
            if any(value is not None and str(value).strip() for value in values):
                row_count += 1
                if not first_rows and non_empty_headers:
                    first_rows.append(
                        {
                            non_empty_headers[index]: "" if values[index] is None else str(values[index])
                            for index in range(min(len(non_empty_headers), len(values)))
                        }
                    )
        sheet_profiles.append((sheet.title, row_count, len(non_empty_headers), non_empty_headers[:8]))

    if first_rows:
        headers = set(first_rows[0].keys())
        if _looks_like_exergy_csv(headers):
            return _analyze_exergy_csv(first_rows, headers)

    profile_lines = "; ".join(
        f"{name}: {rows:,} data row(s), {cols} header column(s)"
        for name, rows, cols, _headers in sheet_profiles[:5]
    )
    first_headers = next((headers for _name, _rows, _cols, headers in sheet_profiles if headers), [])
    return (
        [
            ClientInsight(
                title="The workbook was opened and sheet structure was extracted",
                evidence=f"`{path.name}` contains {len(sheet_profiles)} sheet(s). {profile_lines}.",
                recommendation="Use the sheet inventory to choose the calculation sheet instead of treating the whole workbook as one table.",
                support=ClaimSupport.OBSERVED,
            ),
            ClientInsight(
                title="The first calculation depends on header meaning and units",
                evidence=f"First available headers include: {', '.join(first_headers) if first_headers else 'no clean header row detected'}.",
                recommendation="Confirm the target sheet, units, and decision question before computing economics or exergy from workbook values.",
                support=ClaimSupport.INFERRED,
            ),
        ],
        [
            "Workbook formulas, hidden sheets, merged headers, and units were not audited in this first pass.",
            "This sheet inventory does not prove data quality, provenance, or calculation correctness.",
        ],
        [
            "Identify the target sheet and export it as CSV if it contains the core measurements.",
            "Add units to headers and include timestamps or operating conditions for any time-series calculations.",
        ],
    )


def render_submission_brief(result: SubmissionResult) -> str:
    """Render a client-facing one-page memo."""

    lines = [
        "# Client Analysis Memo",
        "",
        "## Question Received",
        result.prompt.strip() or "No prompt provided.",
        "",
        "## Bottom Line",
        _direct_answer(result),
        "",
        "## Analysis",
    ]
    for index, insight in enumerate(result.insights, start=1):
        lines.extend(
            [
                f"{index}. **{insight.title}**",
                f"   {insight.evidence} {insight.recommendation}",
            ]
        )
    lines.extend(["", "## Data Reviewed"])
    if result.files:
        for file in result.files:
            lines.append(
                f"- `{file.path.name}` ({file.file_type}, {format_bytes(file.size_bytes)}): "
                f"{file.readable_summary} Parser status: {file.parser_status}."
            )
    else:
        lines.append("- No files uploaded; this response is advisory and based only on the prompt.")
    lines.extend(["", "## Important Boundaries"])
    lines.extend(f"- {item}" for item in result.limits)
    lines.extend(["", "## Recommended Next Actions"])
    lines.extend(f"- {item}" for item in result.next_steps)
    return "\n".join(lines) + "\n"


def _direct_answer(result: SubmissionResult) -> str:
    first = result.insights[0]
    recommendation = first.recommendation.strip()
    if result.files and _is_summary_style_recommendation(recommendation):
        return first.title.rstrip(".") + "."
    return f"{first.title}. {recommendation}" if recommendation else first.title.rstrip(".") + "."


def _is_summary_style_recommendation(text: str) -> bool:
    lower = text.lower()
    return (
        lower.startswith("use ")
        or lower.startswith("treat this ")
        or lower.startswith("the document can support")
        or "do not treat it as" in lower
        or "first-pass" in lower
    )


def _summarize_file(path: Path) -> SubmissionFile:
    profile = profile_file(path)
    suffix = path.suffix.lower().lstrip(".") or "unknown"
    if profile.file_type in {"zip", "geojson_zip", "shapefile_zip"}:
        summary = profile.summary
    elif suffix == "zip":
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            summary = f"archive containing {len(names)} entries; first entries: {', '.join(names[:3])}"
        except zipfile.BadZipFile:
            summary = "archive extension present, but file is not a readable zip"
    elif suffix in {"csv", "tsv", "tab"}:
        try:
            rows = _read_delimited_path(path, limit=2)
            columns = list(rows[0].keys()) if rows else []
            summary = f"Delimited table with {len(columns)} columns; first columns: {', '.join(columns[:6])}"
        except Exception as exc:
            summary = f"Delimited table, but initial parsing failed: {exc}"
    elif suffix in {"txt", "md", "markdown"}:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
            profile_text = _profile_text(text)
            summary = f"text document with about {profile_text['words']:,} words and {profile_text['lines']:,} non-empty lines"
        except OSError as exc:
            summary = f"text-like file, but initial reading failed: {exc}"
    elif suffix in {"yaml", "yml"}:
        summary = "YAML configuration or structured data queued for schema profiling"
    elif suffix == "xlsx":
        summary = "spreadsheet workbook queued for sheet inventory"
    elif suffix == "pdf":
        extraction = extract_pdf_document(path)
        if extraction.text:
            summary = "PDF text/tables extracted for downstream analysis"
            profile = replace(
                profile,
                summary=summary,
                parser_status=f"{extraction.parser} extracted {len(extraction.text):,} characters",
            )
        elif extraction.error:
            summary = profile.summary
            profile = replace(
                profile,
                summary=profile.summary,
                parser_status=f"{profile.parser_status}; extraction error: {extraction.error}",
            )
        else:
            summary = profile.summary
    else:
        summary = profile.summary
    return SubmissionFile(
        path=path,
        file_type=profile.file_type,
        size_bytes=profile.size_bytes,
        readable_summary=summary,
        parser_status=profile.parser_status,
    )


def _synthesize_multi_document_bundle(
    prompt: str,
    paths: list[Path],
) -> tuple[list[ClientInsight], list[str], list[str]] | None:
    if len(paths) < 2:
        return None
    request = _profile_request(prompt)
    prompt_lower = prompt.lower()
    if not request.wants_task_synthesis and "exergy" not in prompt_lower:
        return None

    texts: list[str] = []
    for path in paths[:8]:
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            extraction = extract_pdf_document(path)
            if extraction.text.strip():
                texts.append(extraction.text)
        elif suffix in {".txt", ".md", ".markdown"}:
            try:
                texts.append(path.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
    combined = "\n\n".join(texts)
    if not combined.strip():
        return None

    identities = _rank_document_identities(combined + "\n" + prompt)
    labels = {identity.label for identity in identities}
    use_cases = {case for identity in identities for case in identity.use_cases}
    quantities = _notable_quantities(combined)[:10]

    if (
        ("SOEC/high-temperature electrolysis" in labels or "electrolysis" in use_cases)
        and ("FT/syngas-to-liquids" in labels or "syngas-to-liquids" in use_cases)
        and any(term in prompt_lower for term in ("exergy", "simulate", "simulation", "economic", "breakeven", "performance", "pilot"))
    ):
        quantity_line = f" Extracted anchors include {', '.join(quantities)}." if quantities else ""
        return (
            [
                ClientInsight(
                    title="The uploaded package should be treated as one integrated SOEC/HTCE plus Fischer-Tropsch system",
                    evidence=(
                        "Across the documents, the process chain is electricity plus steam/CO2 to hydrogen or syngas in SOEC/HTCE, followed by FT conversion of H2/CO into liquid hydrocarbons, wax, water, purge gas, and reject heat."
                        + quantity_line
                    ),
                    recommendation=(
                        "Model the system as connected blocks rather than as separate PDFs: SOEC/HTCE electrical input, heat input/recovery, syngas compression and conditioning, FT conversion/selectivity, product separation, recycle/purge, and product upgrading."
                    ),
                    support=ClaimSupport.OBSERVED,
                ),
                ClientInsight(
                    title="A useful exergy analysis can be started from the current evidence",
                    evidence=(
                        "The main exergy input is electricity to the SOEC/HTCE stack, with additional thermal, compression, and balance-of-plant loads. The useful exergy output is the chemical exergy of the liquid fuel product; major destruction/loss locations are cell overpotential, high-temperature heat transfer, syngas compression, FT reaction heat rejection, incomplete CO/CO2 conversion, light-gas purge, and upgrading losses."
                    ),
                    recommendation=(
                        "For a first-pass model, calculate kWh per barrel, syngas utilization, FT liquid yield, recycle/purge loss, recoverable FT heat, and product chemical exergy. The most credible efficiency improvements are lowering stack voltage, improving heat integration between FT heat and steam/HTCE needs, raising conversion/selectivity, minimizing purge/compression losses, and extending stack/catalyst life."
                    ),
                    support=ClaimSupport.INFERRED,
                ),
            ],
            [
                "The bundle supports an engineering model structure and preliminary exergy-loss map, but not a final exergy efficiency without measured electrical input, heat input, syngas composition/flow, conversion, product slate, recycle, purge, and upgrading data.",
            ],
            [
                "Build the next model around explicit block boundaries: SOEC/HTCE stack, heat supply/recovery, compression, FT reactor, recycle/purge, product recovery, and upgrading.",
                "Request or extract measured values for stack voltage/current, feed composition, syngas rate, H2/CO ratio, CO/CO2 conversion, FT selectivity, liquid/wax/gas split, heat-removal duty, capacity factor, CAPEX, OPEX, electricity price, and product value.",
            ],
        )

    if request.wants_task_synthesis and len(identities) >= 2:
        signal_line = ", ".join(identity.label for identity in identities[:4])
        quantity_line = f" Notable quantities include {', '.join(quantities)}." if quantities else ""
        return (
            [
                ClientInsight(
                    title="The uploaded files form a multi-document technical package",
                    evidence=f"The dominant document signals are {signal_line}.{quantity_line}",
                    recommendation="Analyze the package as a joined evidence set: extract parameter candidates once, align units and boundaries, then build the requested technical/economic/environmental model from the combined basis.",
                    support=ClaimSupport.OBSERVED,
                )
            ],
            [
                "The combined package still needs source-backed units, boundaries, and measured operating values before high-stakes decisions are made.",
            ],
            [
                "Create a package-level evidence table with document, claim, value, unit, source text, assumption status, and missing boundary conditions.",
            ],
        )

    return None


def _analyze_zip(path: Path) -> tuple[list[ClientInsight], list[str], list[str]]:
    insights: list[ClientInsight] = []
    limits: list[str] = []
    next_steps: list[str] = []
    with zipfile.ZipFile(path) as archive:
        csv_names = [name for name in archive.namelist() if name.lower().endswith(".csv")]
        gas_rows: list[dict[str, str]] = []
        for name in csv_names:
            with archive.open(name) as handle:
                rows = _read_csv_bytes(handle.read())
            if rows and {"TEY", "CO", "NOX"} <= set(rows[0].keys()):
                gas_rows.extend(rows)
        if gas_rows:
            gas_insights, gas_limits, gas_steps = _analyze_gas_turbine(gas_rows, len(csv_names))
            insights.extend(gas_insights)
            limits.extend(gas_limits)
            next_steps.extend(gas_steps)
        else:
            insights.append(
                ClientInsight(
                    title="The archive is readable but no supported domain table was detected",
                    evidence=f"The zip contains {len(csv_names)} CSV file(s).",
                    recommendation="Inspect the archive manifest and add the most relevant parser next.",
                )
            )
    return insights, limits, next_steps


def _looks_like_exergy_csv(headers: set[str]) -> bool:
    normalized = {_normalize_header(header) for header in headers}
    energy_fields = {
        "energy_mwh",
        "mwh",
        "waste_heat_mwh",
        "thermal_mwh",
        "energy_kwh",
        "kwh",
        "delivered_kwh",
    }
    source_fields = {
        "source_temp_c",
        "supply_temp_c",
        "exhaust_temp_c",
        "stream_temp_c",
        "hot_temp_c",
    }
    sink_fields = {
        "sink_temp_c",
        "ambient_temp_c",
        "return_temp_c",
        "reference_temp_c",
        "t0_c",
    }
    return bool(normalized & energy_fields) and bool(normalized & source_fields) and bool(normalized & sink_fields)


def _analyze_exergy_csv(
    rows: list[dict[str, str]],
    headers: set[str],
) -> tuple[list[ClientInsight], list[str], list[str]]:
    normalized_headers = {_normalize_header(header) for header in headers}
    use_case = (
        UseCase.DISTRICT_HEATING
        if {"substation", "return_temp_c", "delivered_kwh"} & normalized_headers
        else UseCase.INDUSTRIAL_WASTE_HEAT
    )
    result = analyze_records(normalize_records(rows), use_case)
    metrics = result.summary_metrics
    metric_line = (
        f"{metrics.get('usable_record_count')} of {metrics.get('record_count')} rows support exergy calculation; "
        f"total energy is {metrics.get('total_energy_mwh')} MWh and accessible exergy is "
        f"{metrics.get('total_accessible_exergy_mwh')} MWh_ex "
        f"(weighted f_X={metrics.get('weighted_exergy_factor')})."
    )
    insights = [
        ClientInsight(
            title=insight.title,
            evidence=f"{insight.detail} {metric_line if index == 0 else ''}".strip(),
            recommendation=insight.action,
        )
        for index, insight in enumerate(result.insights)
    ]
    if len(insights) == 1:
        insights.append(
            ClientInsight(
                title="The upload supports a first thermodynamic screen",
                evidence=metric_line,
                recommendation=(
                    "Use this as an initial result, then add cost and integration constraints "
                    "before making a capital decision."
                ),
            )
        )
    return (
        insights,
        list(result.cannot_prove),
        list(result.recommended_actions) + list(result.next_measurements),
    )


def _analyze_steel_energy(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    usage = [_number(row.get("Usage_kWh")) for row in rows]
    usage = [value for value in usage if value is not None]
    load_totals: dict[str, float] = {}
    pf_values: list[float] = []
    low_pf_count = 0
    for row in rows:
        load_type = row.get("Load_Type") or "Unknown"
        load_totals[load_type] = load_totals.get(load_type, 0.0) + (_number(row.get("Usage_kWh")) or 0.0)
        pf = _number(row.get("Lagging_Current_Power_Factor"))
        if pf is not None:
            pf_values.append(pf)
            if pf < 80.0:
                low_pf_count += 1

    total = sum(usage)
    peak = max(usage) if usage else 0.0
    top_load = max(load_totals.items(), key=lambda item: item[1]) if load_totals else ("Unknown", 0.0)
    top_load_share = top_load[1] / total if total > 0.0 else 0.0
    avg_pf = mean(pf_values) if pf_values else 0.0
    low_pf_share = low_pf_count / len(pf_values) if pf_values else 0.0

    return (
        [
            ClientInsight(
                title="The steel site has a clear load-management target",
                evidence=(
                    f"The file contains {len(rows):,} intervals, {total:,.0f} kWh total use, "
                    f"and a peak 15-minute interval of {peak:,.1f} kWh. "
                    f"`{top_load[0]}` periods account for {top_load_share:.0%} of recorded energy."
                ),
                recommendation=(
                    "Start with the operating periods labeled as the dominant load type; those intervals drive the "
                    "largest controllable energy block."
                ),
            ),
            ClientInsight(
                title="Reactive-power behavior may be costing the facility",
                evidence=(
                    f"Average lagging power factor is {avg_pf:.1f}, and {low_pf_share:.0%} of intervals are below 80."
                ),
                recommendation=(
                    "Check utility tariff penalties and capacitor-bank/control settings before pursuing expensive "
                    "process changes."
                ),
            ),
        ],
        [
            "This steel dataset is electrical interval data; it does not include furnace temperatures, production tonnage, or product mix.",
        ],
        [
            "Add production output by interval so energy intensity can be reported as kWh per tonne, not just total kWh.",
            "Add tariff demand charges and power-factor penalties to convert the operational signal into dollar impact.",
        ],
    )


def _analyze_wind_scada(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    actual_total = 0.0
    theoretical_total = 0.0
    high_wind_count = 0
    underperforming_high_wind = 0
    zero_power_good_wind = 0
    for row in rows:
        actual = _number(row.get("LV ActivePower (kW)")) or 0.0
        theoretical = _number(row.get("Theoretical_Power_Curve (KWh)")) or 0.0
        wind_speed = _number(row.get("Wind Speed (m/s)")) or 0.0
        actual_total += max(0.0, actual)
        theoretical_total += max(0.0, theoretical)
        if wind_speed >= 8.0 and theoretical > 1000.0:
            high_wind_count += 1
            if actual < 0.8 * theoretical:
                underperforming_high_wind += 1
            if actual <= 1.0:
                zero_power_good_wind += 1
    capture = actual_total / theoretical_total if theoretical_total else 0.0
    under_share = underperforming_high_wind / high_wind_count if high_wind_count else 0.0
    zero_share = zero_power_good_wind / high_wind_count if high_wind_count else 0.0

    return (
        [
            ClientInsight(
                title="The turbine is not capturing its theoretical curve",
                evidence=(
                    f"Across {len(rows):,} SCADA intervals, actual generation is {capture:.0%} of the theoretical "
                    f"power-curve total."
                ),
                recommendation=(
                    "Separate normal wake/resource effects from controllable losses by reviewing high-wind intervals first."
                ),
            ),
            ClientInsight(
                title="High-wind underperformance deserves a maintenance review",
                evidence=(
                    f"During high-wind/high-expected-output intervals, {under_share:.0%} fall below 80% of theoretical output; "
                    f"{zero_share:.0%} show near-zero power."
                ),
                recommendation=(
                    "Pull alarm logs, curtailment records, and pitch/yaw status for those timestamps before assuming blade or drivetrain degradation."
                ),
            ),
        ],
        [
            "The SCADA file does not include alarms, curtailment flags, turbine availability, maintenance history, or neighboring turbine wake context.",
        ],
        [
            "Join this SCADA file to curtailment and fault logs for the same timestamps.",
            "Add turbine availability and maintenance events before estimating lost revenue.",
        ],
    )


def _analyze_gas_turbine(rows: list[dict[str, str]], file_count: int) -> tuple[list[ClientInsight], list[str], list[str]]:
    co = [_number(row.get("CO")) for row in rows]
    nox = [_number(row.get("NOX")) for row in rows]
    tey = [_number(row.get("TEY")) for row in rows]
    triples = [
        (tey_value, co_value, nox_value)
        for tey_value, co_value, nox_value in zip(tey, co, nox, strict=False)
        if tey_value is not None and co_value is not None and nox_value is not None
    ]
    if not triples:
        return [], ["Gas turbine rows were present but lacked TEY, CO, or NOX values."], []

    sorted_by_load = sorted(triples, key=lambda item: item[0])
    split = max(1, len(sorted_by_load) // 4)
    low_load = sorted_by_load[:split]
    high_load = sorted_by_load[-split:]
    avg_co = mean(item[1] for item in triples)
    avg_nox = mean(item[2] for item in triples)
    low_co = mean(item[1] for item in low_load)
    high_co = mean(item[1] for item in high_load)
    low_nox = mean(item[2] for item in low_load)
    high_nox = mean(item[2] for item in high_load)

    return (
        [
            ClientInsight(
                title="The gas turbine emissions file is immediately usable for operating-regime analysis",
                evidence=(
                    f"Parsed {len(rows):,} rows from {file_count} CSV files. Average CO is {avg_co:.2f}, "
                    f"and average NOx is {avg_nox:.1f} in the dataset units."
                ),
                recommendation=(
                    "Build the first emissions screen around load bands, then check whether ambient conditions explain the remaining spread."
                ),
            ),
            ClientInsight(
                title="CO and NOx move differently across load",
                evidence=(
                    f"Lowest-load quartile: CO {low_co:.2f}, NOx {low_nox:.1f}. "
                    f"Highest-load quartile: CO {high_co:.2f}, NOx {high_nox:.1f}."
                ),
                recommendation=(
                    "Do not optimize to a single fleet-average emissions number; build separate low-load and high-load operating envelopes, then compare each against permit limits."
                ),
            ),
        ],
        [
            "The dataset does not include permit limits, fuel composition, startup/shutdown flags, or maintenance state.",
        ],
        [
            "Add fuel gas composition, startup flags, and permit thresholds before making a compliance recommendation.",
            "Segment results by operating mode rather than averaging the entire fleet-year together.",
        ],
    )


def _analyze_cement_emissions(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    latest = max(rows, key=lambda row: _number(row.get("Year")) or -1)
    countries = [key for key in latest if key not in {"Year", "Global"}]
    latest_values = [(country, _number(latest.get(country))) for country in countries]
    latest_values = [(country, value) for country, value in latest_values if value is not None and value > 0]
    top = sorted(latest_values, key=lambda item: item[1], reverse=True)[:5]
    total_latest = sum(value for _, value in latest_values)
    global_latest = _number(latest.get("Global"))
    top_text = ", ".join(f"{country}: {value:,.0f}" for country, value in top)
    return (
        [
            ClientInsight(
                title="Cement process emissions are concentrated enough to prioritize by country",
                evidence=(
                    f"The latest year in the file is {latest.get('Year')}. The top five positive entries are {top_text}; "
                    f"positive country entries sum to {total_latest:,.0f} in the dataset units."
                ),
                recommendation=(
                    "Use this file for country-level prioritization, then pair it with plant-level clinker ratio, kiln fuel, and capture-readiness data."
                ),
            )
            if global_latest is None
            else ClientInsight(
                title="Cement process emissions are concentrated enough to prioritize by country",
                evidence=(
                    f"The latest year in the file is {latest.get('Year')}. The file lists a separate Global aggregate "
                    f"of {global_latest:,.0f}; excluding that aggregate, the top country entries are {top_text}."
                ),
                recommendation=(
                    "Use the country rows for prioritization and keep the Global row as a check total; do not add Global back into the country sum. "
                    "Then pair priority countries with plant-level clinker ratio, kiln fuel, and capture-readiness data."
                ),
            ),
            ClientInsight(
                title="This file is a country-level map, not a project pipeline",
                evidence=(
                    f"Positive country rows sum to {total_latest:,.0f} in the dataset units, but the file has no plant IDs, kiln types, clinker ratios, fuels, or retrofit costs."
                ),
                recommendation=(
                    "Pair the country view with plant-level data before ranking capture, fuel-switching, or clinker-substitution projects."
                ),
            ),
        ],
        [
            "This is process-emissions data; it does not include fuel-combustion emissions, plant retrofit cost, or product-level EPD values.",
        ],
        [
            "Join country-level cement emissions to plant locations and production volumes before ranking project sites.",
        ],
    )


def _analyze_solar_modules(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    modules = [
        row
        for row in rows
        if _number(row.get("STC")) is not None and _number(row.get("PTC")) is not None and _number(row.get("A_c")) is not None
    ]
    manufacturers = {row.get("Manufacturer") for row in modules if row.get("Manufacturer")}
    technologies: dict[str, int] = {}
    scored: list[tuple[float, float, float, str, str]] = []
    bifacial_count = 0
    for row in modules:
        stc = _number(row.get("STC")) or 0.0
        ptc = _number(row.get("PTC")) or 0.0
        area = _number(row.get("A_c")) or 0.0
        technology = row.get("Technology") or "Unknown"
        technologies[technology] = technologies.get(technology, 0) + 1
        if row.get("Bifacial") in {"1", "true", "True"}:
            bifacial_count += 1
        if area > 0.0 and stc > 0.0:
            scored.append((stc / area, ptc / stc if stc > 0 else 0.0, stc, row.get("Name") or "Unknown module", technology))

    best = max(scored, key=lambda item: item[0]) if scored else (0.0, 0.0, 0.0, "Unknown module", "Unknown")
    median_density = median(item[0] for item in scored) if scored else 0.0
    median_ptc_stc = median(item[1] for item in scored) if scored else 0.0
    top_technologies = sorted(technologies.items(), key=lambda item: item[1], reverse=True)[:3]
    technology_text = ", ".join(f"{name} ({count:,})" for name, count in top_technologies)

    return (
        [
            ClientInsight(
                title="The PV module file is useful for narrowing options, not procurement by itself",
                evidence=(
                    f"After skipping header/unit rows, {len(modules):,} module records were usable across "
                    f"{len(manufacturers):,} manufacturers. The largest technology groups are {technology_text}."
                ),
                recommendation=(
                    "Use it to narrow module families by technology and power density, then require current datasheets, warranty terms, and bankability checks before vendor selection."
                ),
            ),
            ClientInsight(
                title="Power density and field-rating ratio are the first useful filters",
                evidence=(
                    f"Median STC power density is {median_density:.0f} W/m2 and median PTC/STC ratio is {median_ptc_stc:.2f}. "
                    f"The highest-density listed module is `{best[3]}` at {best[0]:.0f} W/m2."
                ),
                recommendation=(
                    "Filter modules against roof/land area constraints first, then compare PTC/STC ratio for expected field performance."
                ),
            ),
        ],
        [
            "The CEC library does not prove current commercial availability, delivered price, warranty strength, degradation rate, or site-specific energy yield.",
        ],
        [
            "Join candidate modules to current vendor quotes, warranty documents, degradation assumptions, and site irradiance before making a procurement recommendation.",
            f"Review bifacial assumptions separately; {bifacial_count:,} usable records are marked bifacial in this library.",
        ],
    )


def _analyze_battery_aging(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    cycle_capacity: dict[tuple[str, int], float] = {}
    cycle_temp: dict[tuple[str, int], list[float]] = {}
    for row in rows:
        battery = row.get("Battery") or "Unknown"
        cycle_float = _number(row.get("id_cycle"))
        capacity = _number(row.get("Capacity"))
        temp = _number(row.get("Temperature_measured"))
        if cycle_float is None:
            continue
        key = (battery, int(cycle_float))
        if capacity is not None:
            cycle_capacity[key] = capacity
        if temp is not None:
            cycle_temp.setdefault(key, []).append(temp)

    batteries = sorted({battery for battery, _ in cycle_capacity})
    fade_summaries: list[tuple[str, float, float, float, int]] = []
    for battery in batteries:
        cycles = sorted(cycle for b, cycle in cycle_capacity if b == battery)
        if len(cycles) < 2:
            continue
        first = cycle_capacity[(battery, cycles[0])]
        last = cycle_capacity[(battery, cycles[-1])]
        if first > 0.0:
            fade_summaries.append((battery, first, last, (first - last) / first, len(cycles)))
    worst = max(fade_summaries, key=lambda item: item[3]) if fade_summaries else ("Unknown", 0.0, 0.0, 0.0, 0)
    avg_temps = [mean(values) for values in cycle_temp.values() if values]
    max_avg_temp = max(avg_temps) if avg_temps else 0.0

    return (
        [
            ClientInsight(
                title="The battery file supports degradation triage at the cell/cycle level",
                evidence=(
                    f"Parsed {len(rows):,} discharge measurements across {len(batteries)} battery label(s). "
                    f"The strongest fade signal is `{worst[0]}`: {worst[1]:.2f} Ah to {worst[2]:.2f} Ah across {worst[4]} cycles, a {worst[3]:.0%} drop."
                ),
                recommendation=(
                    "Use this as a cell-aging diagnostic first; do not extrapolate directly to pack warranty without pack thermal, balancing, and duty-cycle data."
                ),
            ),
            ClientInsight(
                title="Temperature context is present but not enough to explain fade alone",
                evidence=(
                    f"The highest cycle-average measured temperature in the parsed data is {max_avg_temp:.1f} C."
                ),
                recommendation=(
                    "Segment capacity fade by temperature and current profile before blaming chemistry, controls, or cooling design."
                ),
            ),
        ],
        [
            "This converted discharge dataset does not include full pack configuration, cell manufacturing variation, real vehicle duty cycle, or warranty thresholds.",
        ],
        [
            "Create per-battery capacity-vs-cycle curves and flag cycles where voltage or temperature behavior changes abruptly.",
            "Add charge data and ambient/thermal-control metadata before making a product-life claim.",
        ],
    )


def _analyze_fuel_cell_impedance(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    z_real = [_number(row.get("z_real")) for row in rows]
    z_img = [_number(row.get("z_img")) for row in rows]
    voltages = sorted({value for value in (_number(row.get("applied_voltage")) for row in rows) if value is not None})
    valid_real = [value for value in z_real if value is not None]
    valid_img = [value for value in z_img if value is not None]
    min_real = min(valid_real) if valid_real else 0.0
    max_real = max(valid_real) if valid_real else 0.0
    max_abs_img = max((abs(value) for value in valid_img), default=0.0)

    return (
        [
            ClientInsight(
                title="The fuel-cell file is an impedance experiment, not a system performance report",
                evidence=(
                    f"Parsed {len(rows):,} impedance points at {len(voltages)} applied-voltage setting(s): "
                    f"{', '.join(f'{value:.2f} V' for value in voltages[:8])}. z_real spans {min_real:.4f} to {max_real:.4f}."
                ),
                recommendation=(
                    "Use this to compare electrochemical condition across test settings; request polarization curves and gas/humidity conditions before estimating stack efficiency."
                ),
            ),
            ClientInsight(
                title="The impedance range is measurable enough for quality-control comparisons",
                evidence=f"The largest absolute imaginary impedance value is {max_abs_img:.4f} in the file units.",
                recommendation=(
                    "Compare repeated tests or MEA variants on the same instrument before interpreting the curve as degradation."
                ),
            ),
        ],
        [
            "The file does not include full operating context such as membrane condition, gas stoichiometry, humidity, pressure, or calibration traceability.",
        ],
        [
            "Use the companion `.names` metadata and test protocol so the curve can be interpreted against the actual MEA and operating conditions.",
            "Add polarization and durability data before making an efficiency or lifetime claim.",
        ],
    )


def _analyze_ev_charging_info(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    row = rows[0] if rows else {}
    chargers = _number(row.get("total_chargers")) or 0.0
    sites = _number(row.get("total_sites")) or 0.0
    volume = _number(row.get("total_volume")) or 0.0
    duration = _number(row.get("total_duration")) or 0.0
    avg_power = _number(row.get("avg_power")) or 0.0
    chargers_per_site = chargers / sites if sites else 0.0
    volume_per_charger = volume / chargers if chargers else 0.0
    return (
        [
            ClientInsight(
                title="The EV charging metadata gives a useful city-scale baseline",
                evidence=(
                    f"{row.get('city', 'The city')} has {chargers:,.0f} chargers across {sites:,.0f} sites, "
                    f"or {chargers_per_site:.2f} chargers per site. Average power is listed as {avg_power:.2f}."
                ),
                recommendation=(
                    "Use this as the portfolio-level denominator, then analyze hourly volume by station before recommending new chargers."
                ),
            ),
            ClientInsight(
                title="Energy-throughput intensity can be screened before siting work",
                evidence=(
                    f"Total recorded volume is {volume:,.0f}; that is {volume_per_charger:,.0f} per charger in the dataset units."
                ),
                recommendation=(
                    "Rank stations by utilization and dwell behavior before choosing between pricing changes, reliability fixes, or expansion."
                ),
            ),
        ],
        [
            "The metadata file alone does not identify congestion, failed sessions, charger power class, or grid interconnection constraints.",
        ],
        [
            "Pair this file with station-level hourly volume, site metadata, reliability events, and local tariff data.",
        ],
    )


def _analyze_ev_charging_volume(rows: list[dict[str, str]]) -> tuple[list[ClientInsight], list[str], list[str]]:
    totals_by_station: dict[str, float] = {}
    total = 0.0
    nonzero_intervals = 0
    interval_count = len(rows)
    for row in rows:
        row_total = 0.0
        for key, value in row.items():
            if key == "":
                continue
            numeric = _number(value) or 0.0
            totals_by_station[key] = totals_by_station.get(key, 0.0) + numeric
            row_total += numeric
        total += row_total
        if row_total > 0.0:
            nonzero_intervals += 1
    active_stations = sum(1 for value in totals_by_station.values() if value > 0.0)
    top_station = max(totals_by_station.items(), key=lambda item: item[1]) if totals_by_station else ("Unknown", 0.0)
    active_share = active_stations / len(totals_by_station) if totals_by_station else 0.0
    return (
        [
            ClientInsight(
                title="The EV charging volume table is sparse and wide",
                evidence=(
                    f"The sample contains {interval_count:,} hourly rows and {len(totals_by_station):,} station columns. "
                    f"Only {active_stations:,} stations show nonzero volume in this sample ({active_share:.0%})."
                ),
                recommendation=(
                    "Convert this table from wide format to station-hour records before modeling utilization or forecasting load."
                ),
            ),
            ClientInsight(
                title="Utilization is concentrated in a small part of the sample",
                evidence=(
                    f"The highest-volume station column is `{top_station[0]}` with {top_station[1]:,.1f}; "
                    f"{nonzero_intervals:,} of {interval_count:,} hours have any recorded charging volume."
                ),
                recommendation=(
                    "Start with the active station subset; treating all station columns as equally informative will dilute the operational signal."
                ),
            ),
        ],
        [
            "This is only the first sampled block of the larger volume table, so it should not be used for annual utilization or investment sizing.",
        ],
        [
            "Load the full table or a statistically valid time window, then join station metadata, prices, weather, and failed-session logs.",
        ],
    )


def _analyze_generic_csv(rows: list[dict[str, str]], name: str) -> tuple[list[ClientInsight], list[str], list[str]]:
    columns = list(rows[0].keys()) if rows else []
    if not rows:
        return (
            [
                ClientInsight(
                    title="The table has headers but no analyzable rows",
                    evidence=f"`{name}` exposes {len(columns)} column(s): {', '.join(columns[:8])}.",
                    recommendation="Upload rows with measured values or export the sheet range that contains the actual data.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No trend, ranking, calculation, or business claim can be supported from an empty table."],
            ["Re-export the data table with at least one populated row and units in the headers."],
        )

    stats = _table_profile(rows)
    numeric_summaries = stats["numeric_summaries"]
    strongest = numeric_summaries[0] if numeric_summaries else None
    missing_line = (
        f"{stats['rows_with_missing']:,} row(s) have at least one missing value."
        if stats["rows_with_missing"]
        else "The sampled rows do not show missing cells."
    )
    insights = [
        ClientInsight(
            title="The table can support first-pass profiling",
            evidence=(
                f"`{name}` has {len(rows):,} row(s), {len(columns)} column(s), "
                f"{len(numeric_summaries)} numeric column(s), and {stats['date_like_columns']} date/time-like column(s). {missing_line} "
                f"First columns: {', '.join(columns[:8])}."
            ),
            recommendation="Use this profile to choose a decision question and avoid treating every column as equally important.",
            support=ClaimSupport.OBSERVED,
        )
    ]
    if strongest:
        insights.append(
            ClientInsight(
                title=f"`{strongest['column']}` is the strongest numeric signal in the first pass",
                evidence=(
                    f"It has {strongest['count']:,} numeric value(s), median {strongest['median']:.3g}, "
                    f"range {strongest['min']:.3g} to {strongest['max']:.3g}, and spread {strongest['spread']:.3g}."
                ),
                recommendation="Plot or group this column against time, asset, stream, or operating mode before drawing conclusions.",
                support=ClaimSupport.COMPUTED,
            )
        )
    else:
        insights.append(
            ClientInsight(
                title="The table appears categorical or text-heavy",
                evidence="No robust numeric columns were found in the sampled table.",
                recommendation="Map categories to the business question, or add measured quantities before requesting calculations.",
                support=ClaimSupport.OBSERVED,
            )
        )
    insights.append(
        ClientInsight(
            title="The next analysis should tie columns to a decision",
            evidence="The file is readable, but the domain meaning of the columns is not explicit enough for a technical or commercial claim.",
            recommendation="Name the target decision, identify units for numeric columns, and specify whether the output should be a ranking, chart, forecast, audit, or memo.",
            support=ClaimSupport.INFERRED,
        )
    )
    return (
        insights,
        [
            "This profile does not prove causality, forecast accuracy, ROI, compliance, or equipment condition.",
            "Column names without units or boundary definitions limit confidence in calculations.",
        ],
        [
            "Add units, timestamps, asset/stream identifiers, and the decision question for the table.",
            "Ask for a chart, ranking, anomaly scan, exergy calculation, or economics screen once the target outcome is clear.",
        ],
    )


def _analyze_json(path: Path) -> tuple[list[ClientInsight], list[str], list[str]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return (
            [
                ClientInsight(
                    title="The JSON file could not be parsed cleanly",
                    evidence=f"The parser raised {exc.__class__.__name__}: {str(exc)[:120]}.",
                    recommendation="Ask for a valid JSON export or the original source file that produced it.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No technical claims should be drawn from an unreadable JSON file."],
            ["Re-export the package as valid JSON or upload the original CSV/PDF source evidence."],
        )

    if isinstance(payload, dict) and "artifacts" in payload and "project" in payload:
        return _analyze_platform_export(payload)

    json_profile = _profile_json(payload)
    keys = list(payload.keys()) if isinstance(payload, dict) else []
    return (
        [
            ClientInsight(
                title="The JSON is readable and can be profiled",
                evidence=(
                    f"Top-level shape: {json_profile['shape']}. Top-level keys: {', '.join(keys[:8]) or type(payload).__name__}. "
                    f"Detected {json_profile['numeric_values']} numeric value(s), {json_profile['string_values']} string value(s), "
                    f"and {json_profile['array_values']} array(s) in the sampled structure."
                ),
                recommendation="Use this schema profile to identify the fields that map to the decision before computing claims.",
                support=ClaimSupport.OBSERVED,
            ),
            ClientInsight(
                title="The next step is schema-to-decision mapping",
                evidence="Readable JSON can still mix metadata, configuration, model output, and measured data in the same object.",
                recommendation="Identify which fields are source measurements, assumptions, outputs, and caveats, then run the relevant calculation.",
                support=ClaimSupport.INFERRED,
            ),
        ],
        [
            "This pass profiles the JSON structure; it does not validate schema semantics, units, provenance, or domain-specific values.",
            "No technical or commercial claim should be made until measured fields and assumptions are separated from derived fields.",
        ],
        [
            "Provide the schema owner or field definitions, especially units and whether each value is measured, assumed, or calculated.",
            "If the JSON contains repeated records, export the record array to CSV for profiling, charts, and calculations.",
        ],
    )


def _analyze_yaml(path: Path) -> tuple[list[ClientInsight], list[str], list[str]]:
    try:
        import yaml  # type: ignore[import-not-found]
    except Exception:
        return (
            [
                ClientInsight(
                    title="The YAML file needs the optional YAML parser",
                    evidence="The upload is a YAML file, but PyYAML is not installed in this runtime.",
                    recommendation="Install PyYAML or export the source as JSON/CSV.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No structured claims should be made from YAML until the file is parsed."],
            ["Install PyYAML with `pip install -e .[parsers]` or upload a JSON/CSV export."],
        )

    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        return (
            [
                ClientInsight(
                    title="The YAML file could not be parsed cleanly",
                    evidence=f"The parser raised {exc.__class__.__name__}: {str(exc)[:120]}.",
                    recommendation="Ask for a valid YAML export or a neutral JSON/CSV export from the same source system.",
                    support=ClaimSupport.BLOCKED,
                )
            ],
            ["No technical claims should be drawn from an unreadable YAML file."],
            ["Re-export the package as valid YAML, JSON, or CSV and preserve units in field names or metadata."],
        )

    table_name, rows = _first_record_table(payload)
    if rows:
        headers = set(rows[0].keys()) if rows else set()
        if _looks_like_exergy_csv(headers):
            insights, limits, next_steps = _analyze_exergy_csv(rows, headers)
            return (
                [
                    ClientInsight(
                        title="The YAML contains an exergy-ready record table",
                        evidence=f"`{path.name}` exposes `{table_name}` with {len(rows):,} record(s) and fields: {', '.join(list(headers)[:8])}.",
                        recommendation="Use the YAML records for a first thermodynamic screen, then confirm units and source provenance.",
                        support=ClaimSupport.OBSERVED,
                    ),
                    *insights,
                ],
                [
                    "YAML field names were treated as table headers; nested metadata, formulas, anchors, and comments were not audited.",
                    *limits,
                ],
                [
                    "Confirm that YAML numeric fields use the units implied by their names before relying on calculations.",
                    *next_steps,
                ],
            )
        insights, limits, next_steps = _analyze_generic_csv(rows, f"{path.name}:{table_name}")
        return (
            [
                ClientInsight(
                    title="The YAML contains a record table that can be profiled",
                    evidence=f"`{path.name}` exposes `{table_name}` with {len(rows):,} record(s).",
                    recommendation="Use this table profile to choose the target calculation or chart.",
                    support=ClaimSupport.OBSERVED,
                ),
                *insights,
            ],
            [
                "YAML field names were treated as table headers; nested metadata, formulas, anchors, and comments were not audited.",
                *limits,
            ],
            next_steps,
        )

    yaml_profile = _profile_json(payload)
    keys = list(payload.keys()) if isinstance(payload, dict) else []
    return (
        [
            ClientInsight(
                title="The YAML is readable and can be profiled",
                evidence=(
                    f"Top-level shape: {yaml_profile['shape']}. Top-level keys: {', '.join(keys[:8]) or type(payload).__name__}. "
                    f"Detected {yaml_profile['numeric_values']} numeric value(s), {yaml_profile['string_values']} string value(s), "
                    f"and {yaml_profile['array_values']} array(s) in the sampled structure."
                ),
                recommendation="Use this schema profile to identify measured fields, assumptions, and outputs before computing claims.",
                support=ClaimSupport.OBSERVED,
            ),
            ClientInsight(
                title="The next step is YAML schema-to-decision mapping",
                evidence="Readable YAML often mixes configuration, units, source metadata, assumptions, and generated outputs.",
                recommendation="Identify which fields are source measurements, assumptions, outputs, and caveats, then run the relevant calculation.",
                support=ClaimSupport.INFERRED,
            ),
        ],
        [
            "This pass profiles the YAML structure; it does not validate schema semantics, units, provenance, anchors, comments, or domain-specific values.",
            "No technical or commercial claim should be made until measured fields and assumptions are separated from derived fields.",
        ],
        [
            "Provide the schema owner or field definitions, especially units and whether each value is measured, assumed, or calculated.",
            "If the YAML contains repeated records, keep them under a named list such as streams, assets, scenarios, or measurements for table profiling.",
        ],
    )


def _analyze_platform_export(payload: dict) -> tuple[list[ClientInsight], list[str], list[str]]:
    project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
    artifacts = payload.get("artifacts") if isinstance(payload.get("artifacts"), list) else []
    evaluation = next((artifact for artifact in artifacts if isinstance(artifact, dict) and artifact.get("type") == "evaluation"), None)
    content = evaluation.get("content") if isinstance(evaluation, dict) and isinstance(evaluation.get("content"), dict) else {}
    client_summary = content.get("client_summary") if isinstance(content.get("client_summary"), dict) else {}
    brief = content.get("brief") if isinstance(content.get("brief"), dict) else {}
    screens = content.get("physics_screens") if isinstance(content.get("physics_screens"), list) else []
    screen = next((item for item in screens if isinstance(item, dict)), {})
    metrics = screen.get("key_metrics") if isinstance(screen.get("key_metrics"), dict) else {}
    if not metrics:
        metrics = _metrics_from_client_summary(client_summary)
    structured = content.get("structured_insights") if isinstance(content.get("structured_insights"), list) else []
    supported_items = structured or (client_summary.get("supported_claims") if isinstance(client_summary.get("supported_claims"), list) else [])
    content_limits = content.get("limitations") if isinstance(content.get("limitations"), list) else []
    summary_limits = client_summary.get("not_proven") if isinstance(client_summary.get("not_proven"), list) else []
    limitations = [item for item in [*content_limits, *summary_limits] if isinstance(item, str)]
    summary = _first_text(
        client_summary.get("conclusion"),
        evaluation.get("summary") if isinstance(evaluation, dict) else "",
        content.get("executive_summary"),
        brief.get("headline"),
    )
    top_stream = metrics.get("top_stream")
    total_energy = metrics.get("total_energy_mwh")
    accessible = metrics.get("accessible_exergy_mwh")
    fx = metrics.get("weighted_exergy_factor")

    metric_line = _platform_metric_line(metrics)
    supported_claims = _platform_supported_claims(supported_items)
    caveat_text = "; ".join(limitations[:3]) if limitations else "The export does not include enough caveats to separate early results from decision-grade evidence."
    source_line = _platform_source_line(payload, content, client_summary)
    priority = client_summary.get("priority_recommendation") if isinstance(client_summary.get("priority_recommendation"), dict) else {}
    priority_title = _first_text(priority.get("title"))
    priority_rationale = _first_text(priority.get("rationale"))
    data_requests = _platform_data_requests(client_summary)
    if not data_requests:
        data_requests = _default_platform_data_requests(top_stream)
    recommended_actions = _platform_recommended_actions(client_summary)
    first_request = data_requests[0] if data_requests else _default_platform_data_request(top_stream)

    insights = [
        ClientInsight(
            title=(
                f"{top_stream} is the strongest actionable signal"
                if top_stream
                else "The uploaded package contains a usable prior analysis result"
            ),
            evidence=(
                f"{summary or 'No executive summary was present.'} "
                f"{metric_line}"
                f"{source_line}"
            ).strip(),
            recommendation=(
                f"{priority_title}. {priority_rationale}".strip()
                if priority_title
                else f"Treat {top_stream} as the first engineering branch to inspect, with prioritization refined after more evidence."
                if top_stream
                else "Use the uploaded conclusion as an initial result, not as a capital-decision result."
            ),
            support=ClaimSupport.COMPUTED if metrics else ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="The result is strong enough for prioritization, not commitment",
            evidence=(
                f"Computed fields in the export include total energy {total_energy} MWh, accessible exergy "
                f"{accessible} MWh_ex, and weighted Exergy Factor {fx}. "
                f"Source-backed statements include: {supported_claims}."
            ),
            recommendation=(
                "Use the computed exergy ranking to decide where to look first; do not use it by itself to approve ROI, retrofit scope, or customer-impact decisions."
            ),
            support=ClaimSupport.COMPUTED if metrics else ClaimSupport.OBSERVED,
        ),
        ClientInsight(
            title="The blocking gaps are operating data, economics, and service impact",
            evidence=f"{caveat_text} The highest-value next evidence request is: {first_request}",
            recommendation=(
                "Use the package to launch a targeted evidence request before spending engineering budget."
            ),
            support=ClaimSupport.INFERRED,
        ),
    ]

    project_name = project.get("name") if isinstance(project, dict) else ""
    limits = limitations or [
        "The export does not prove project ROI, hydraulic feasibility, customer comfort, or implementation cost.",
    ]
    if project_name:
        limits.append(f"The project name `{project_name}` identifies the workspace, not independent validation evidence.")
    limits.append("A prior analysis package is useful evidence, but the original raw measurements should still be retained for recomputation and audit.")

    next_steps = _dedupe(data_requests + recommended_actions)

    return insights, limits, next_steps


def _platform_metric_line(metrics: dict) -> str:
    if not metrics:
        return ""
    parts = []
    if metrics.get("top_stream") is not None:
        parts.append(f"top stream {metrics.get('top_stream')}")
    if metrics.get("total_energy_mwh") is not None:
        parts.append(f"total energy {metrics.get('total_energy_mwh')} MWh")
    if metrics.get("accessible_exergy_mwh") is not None:
        parts.append(f"accessible exergy {metrics.get('accessible_exergy_mwh')} MWh_ex")
    if metrics.get("weighted_exergy_factor") is not None:
        parts.append(f"weighted Exergy Factor {metrics.get('weighted_exergy_factor')}")
    return "Computed metrics: " + ", ".join(parts) + "." if parts else ""


def _metrics_from_client_summary(client_summary: dict) -> dict:
    metrics: dict[str, float | str] = {}
    metric_cards = client_summary.get("computed_metrics") if isinstance(client_summary.get("computed_metrics"), list) else []
    for item in metric_cards:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip().lower()
        value = item.get("value")
        if "first place" in label or "top" in label:
            metrics["top_stream"] = str(value)
        elif "accessible exergy" in label:
            number = _number(str(value).replace("MWh_ex", ""))
            if number is not None:
                metrics["accessible_exergy_mwh"] = number
        elif "total energy" in label:
            number = _number(str(value).replace("MWh", ""))
            if number is not None:
                metrics["total_energy_mwh"] = number
        elif "quality" in label or "exergy factor" in label:
            number = _number(str(value))
            if number is not None:
                metrics["weighted_exergy_factor"] = number
    return metrics


def _platform_source_line(payload: dict, content: dict, client_summary: dict) -> str:
    names: list[str] = []
    documents = payload.get("documents") if isinstance(payload.get("documents"), list) else []
    for document in documents:
        if isinstance(document, dict):
            name = _first_text(document.get("filename"), document.get("name"))
            if name:
                names.append(name)
    files = content.get("files") if isinstance(content.get("files"), list) else []
    reviewed = client_summary.get("reviewed_files") if isinstance(client_summary.get("reviewed_files"), list) else []
    for item in [*files, *reviewed]:
        if isinstance(item, dict):
            name = _first_text(item.get("filename"), item.get("name"))
            if name:
                names.append(name)
    names = _dedupe(names)
    return f" Source evidence referenced by the package: {', '.join(names[:4])}." if names else ""


def _platform_data_requests(client_summary: dict) -> list[str]:
    items = client_summary.get("data_requests") if isinstance(client_summary.get("data_requests"), list) else []
    requests = []
    for item in items:
        if isinstance(item, dict):
            request = _first_text(item.get("request"))
            why = _first_text(item.get("why_it_matters"))
            if request:
                requests.append(f"{request} Why it matters: {why}" if why else request)
        elif isinstance(item, str):
            requests.append(item)
    return requests


def _platform_recommended_actions(client_summary: dict) -> list[str]:
    items = client_summary.get("recommended_actions") if isinstance(client_summary.get("recommended_actions"), list) else []
    actions = []
    for item in items:
        if isinstance(item, dict):
            action = _first_text(item.get("action"))
            if action:
                actions.append(action)
        elif isinstance(item, str):
            actions.append(item)
    return actions


def _default_platform_data_request(top_stream: object) -> str:
    target = str(top_stream) if top_stream is not None else "the top-ranked branch or stream"
    return (
        f"Collect measured operating time series for {target}: flow rate, control position, supply/return "
        "or source/sink temperatures, operating schedule, cost basis, and service or production constraints."
    )


def _default_platform_data_requests(top_stream: object) -> list[str]:
    target = str(top_stream) if top_stream is not None else "the top-ranked branch or stream"
    return [
        f"Collect branch-level flow rate, pump power, valve position, and supply/return temperature time series for {target} and the next ranked branches.",
        "Provide installed-cost, controls scope, maintenance/OPEX, operating-hours, tariff or heat-value assumptions, and expected intervention life.",
        "Provide customer comfort or service-quality data, including indoor temperature complaints, unmet load events, and return-temperature constraints.",
    ]


def _platform_supported_claims(items: list) -> str:
    claims = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("claim") or "").strip()
        evidence = str(item.get("evidence") or "").strip()
        if title:
            claims.append(f"{title} ({evidence[:120]})" if evidence else title)
    return "; ".join(claims[:3]) if claims else "no structured computed claims were found"


def _first_text(*values: object) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _read_delimited_path(path: Path, limit: int | None = None) -> list[dict[str, str]]:
    raw = path.read_bytes()
    delimiter = "\t" if path.suffix.lower() in {".tsv", ".tab"} else ","
    return _read_delimited_bytes(raw, delimiter=delimiter, limit=limit)


def _read_csv_path(path: Path, limit: int | None = None) -> list[dict[str, str]]:
    return _read_delimited_path(path, limit=limit)


def _read_csv_bytes(raw: bytes, limit: int | None = None) -> list[dict[str, str]]:
    return _read_delimited_bytes(raw, delimiter=",", limit=limit)


def _read_delimited_bytes(raw: bytes, *, delimiter: str, limit: int | None = None) -> list[dict[str, str]]:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = raw.decode(encoding)
            reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
            rows = []
            for index, row in enumerate(reader):
                if limit is not None and index >= limit:
                    break
                rows.append({str(key): str(value) if value is not None else "" for key, value in row.items()})
            return rows
        except UnicodeError as exc:
            last_error = exc
    if last_error:
        raise last_error
    return []


def _profile_text(text: str) -> dict[str, int]:
    non_empty_lines = [line for line in text.splitlines() if line.strip()]
    words = re.findall(r"\b[\w./%-]+\b", text)
    return {"lines": len(non_empty_lines), "words": len(words), "chars": len(text)}


def _first_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        stripped = line.strip().strip("#").strip()
        if not stripped:
            continue
        if line.lstrip().startswith("#") or (len(stripped) <= 80 and stripped[:1].isupper() and not stripped.endswith(".")):
            headings.append(stripped)
        if len(headings) >= 6:
            break
    return headings


def _domain_signals(text: str) -> list[str]:
    lower = text.lower()
    signals = [identity.label for identity in _dominant_document_identities(text) if identity.score >= 4]
    patterns = (
        ("industrial waste heat", ("waste heat", "kiln", "oven", "dryer", "compressor")),
        ("district heating", ("district heating", "substation", "supply temperature", "return temperature")),
        ("heat pump/HVAC", ("heat pump", "cop", "hspf", "eer", "seer")),
        ("SOEC/high-temperature electrolysis", ("soec", "solid oxide electrolysis", "high temperature electrolysis", "co-electrolysis", "htce")),
        ("FT/synthetic fuels", ("fischer", "tropsch", "syngas", "synthesis gas", "asf distribution")),
        ("reactor/catalysis", ("reactor", "catalyst", "catalysts", "fixed bed", "product distribution")),
        ("steel/metals production", ("direct reduced iron", "electric arc furnace", "green steel", "blast furnace", "metallization")),
        ("cement/concrete", ("cement kiln", "clinker", "calcination", "portland cement", "carbon mineralization")),
        ("water/desalination", ("desalination", "reverse osmosis", "water reuse", "brine", "membrane filtration")),
        ("mining/critical minerals", ("direct lithium extraction", "lithium brine", "critical minerals", "tailings", "ore grade")),
        ("geothermal", ("geothermal", "enhanced geothermal", "reservoir", "binary cycle", "injection well")),
        ("biofuels/SAF", ("sustainable aviation fuel", "renewable diesel", "hefa", "biofuel", "carbon intensity")),
        ("chemical/process plant", ("chemical plant", "ammonia plant", "haber bosch", "methanol plant", "process plant")),
        ("data center/compute infrastructure", ("data center", "ai compute", "gpu cluster", "pue", "rack density")),
        ("grid/transmission", ("interconnection", "transmission line", "substation", "transformer", "switchyard")),
        ("techno-economics", ("capex", "opex", "roi", "payback", "npv", "irr", "lcoe")),
        ("emissions", ("co2", "carbon", "emissions", "fuel displacement")),
        ("operations", ("downtime", "maintenance", "load", "schedule", "throughput")),
    )
    for label, terms in patterns:
        if label not in signals and any(term in lower for term in terms):
            signals.append(label)
    return signals


def _table_profile(rows: list[dict[str, str]]) -> dict[str, object]:
    columns = list(rows[0].keys()) if rows else []
    numeric_summaries = []
    rows_with_missing = 0
    date_like_columns = 0
    for row in rows:
        if any(value is None or str(value).strip() == "" for value in row.values()):
            rows_with_missing += 1
    for column in columns:
        values = [_number(row.get(column)) for row in rows]
        numeric_values = [value for value in values if value is not None]
        if len(numeric_values) >= max(1, min(3, len(rows) // 4)):
            sorted_values = sorted(numeric_values)
            low = sorted_values[0]
            high = sorted_values[-1]
            numeric_summaries.append(
                {
                    "column": column,
                    "count": len(numeric_values),
                    "min": low,
                    "max": high,
                    "median": median(sorted_values),
                    "spread": high - low,
                }
            )
        sample = " ".join(str(row.get(column, "")) for row in rows[:10])
        if re.search(r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}:\d{2}", sample):
            date_like_columns += 1
    numeric_summaries.sort(key=lambda item: (item["spread"], item["count"]), reverse=True)
    return {
        "numeric_summaries": numeric_summaries,
        "rows_with_missing": rows_with_missing,
        "date_like_columns": date_like_columns,
    }


def _first_record_table(payload: object) -> tuple[str, list[dict[str, str]]]:
    def rows_from(value: object) -> list[dict[str, str]]:
        if not isinstance(value, list):
            return []
        mapping_items = [item for item in value if isinstance(item, dict)]
        if not mapping_items:
            return []
        rows: list[dict[str, str]] = []
        for item in mapping_items[:500]:
            row: dict[str, str] = {}
            for key, raw_value in item.items():
                if isinstance(raw_value, (dict, list)):
                    continue
                row[str(key)] = "" if raw_value is None else str(raw_value)
            if row:
                rows.append(row)
        return rows

    direct = rows_from(payload)
    if direct:
        return "top_level", direct

    if isinstance(payload, dict):
        for key, value in payload.items():
            rows = rows_from(value)
            if rows:
                return str(key), rows
        for parent_key, value in payload.items():
            if not isinstance(value, dict):
                continue
            for key, nested_value in value.items():
                rows = rows_from(nested_value)
                if rows:
                    return f"{parent_key}.{key}", rows

    return "", []


def _profile_json(payload: object) -> dict[str, object]:
    counts = {"numeric_values": 0, "string_values": 0, "array_values": 0}

    def walk(value: object, depth: int = 0) -> None:
        if depth > 5:
            return
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, (int, float)):
            counts["numeric_values"] += 1
            return
        if isinstance(value, str):
            counts["string_values"] += 1
            return
        if isinstance(value, list):
            counts["array_values"] += 1
            for item in value[:50]:
                walk(item, depth + 1)
            return
        if isinstance(value, dict):
            for item in list(value.values())[:80]:
                walk(item, depth + 1)

    walk(payload)
    if isinstance(payload, dict):
        shape = f"object with {len(payload)} top-level key(s)"
    elif isinstance(payload, list):
        shape = f"array with {len(payload)} item(s)"
    else:
        shape = type(payload).__name__
    return {"shape": shape, **counts}


def _normalize_header(header: str) -> str:
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def _number(value: str | None) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text or text == "-9999":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped
