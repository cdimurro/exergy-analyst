"""Structured workspace-agent run pipeline.

This module turns the existing deterministic analyzers into an agent-like run
record: intake, tool calls, physics screens, claims, limits, and final memo.
It is intentionally deterministic so the UI can be tested without an LLM.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from statistics import mean, median
from typing import Any

from .analysis import analyze_records
from .claims import ClaimSupport
from .file_inventory import format_bytes, profile_file
from .general_advice import analyze_general_prompt, detect_use_cases_from_prompt
from .heat_pump_spec import (
    best_heat_pump_rating,
    extract_heat_pump_ratings,
    heat_pump_exergy_caveat,
    heat_pump_exergy_estimate,
)
from .ingest import normalize_records
from .models import UseCase
from .pdf_extract import extract_pdf_document
from .power_plant_spec import estimate_power_plant_performance, extract_power_plant_spec
from .solar_pv_spec import estimate_pv_production, extract_location, extract_pv_module_spec
from .submission import ClientInsight, SubmissionResult, analyze_submission, render_submission_brief
from .submission import _detect_document_use_cases
from .submission import _number as _submission_number
from .submission import _read_csv_path


@dataclass(frozen=True)
class AgentStage:
    name: str
    status: str
    summary: str
    detail: str = ""


@dataclass(frozen=True)
class AgentToolCall:
    tool: str
    input: str
    output: str
    status: str = "completed"


@dataclass(frozen=True)
class AgentFileProfile:
    filename: str
    file_type: str
    size_bytes: int
    size_label: str
    parser_status: str
    summary: str
    detected_use_cases: tuple[str, ...] = ()


@dataclass(frozen=True)
class PhysicsScreen:
    title: str
    family: str
    status: str
    confidence: str
    key_metrics: dict[str, float | int | str | None]
    recommendation: str
    caveats: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentRun:
    prompt: str
    executive_answer: str
    memo_markdown: str
    detected_use_cases: tuple[str, ...]
    files: tuple[AgentFileProfile, ...]
    stages: tuple[AgentStage, ...]
    tool_calls: tuple[AgentToolCall, ...]
    physics_screens: tuple[PhysicsScreen, ...]
    top_insights: tuple[dict[str, str], ...]
    limitations: tuple[str, ...]
    next_actions: tuple[str, ...]
    confidence: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)


def run_workspace_agent(prompt: str, paths: list[Path]) -> AgentRun:
    """Run the deterministic workspace agent pipeline."""

    file_profiles: list[AgentFileProfile] = []
    tool_calls: list[AgentToolCall] = [
        AgentToolCall(
            tool="plan_tool_loop",
            input=f"{len(paths)} file(s), prompt length {len(prompt)}",
            output=(
                "Planned bounded run: inspect uploads, extract readable content, run deterministic screens, "
                "recover from partial evidence if needed, then synthesize."
            ),
        )
    ]
    physics_screens: list[PhysicsScreen] = []
    detected: list[str] = []

    for path in paths:
        profile = profile_file(path)
        parser_status = profile.parser_status
        readable_summary = profile.summary
        if path.suffix.lower() == ".pdf":
            pdf_extraction = extract_pdf_document(path)
            if pdf_extraction.text:
                parser_status = f"{pdf_extraction.parser} extracted {len(pdf_extraction.text):,} characters"
                readable_summary = "PDF text/tables extracted for downstream analysis"
            elif pdf_extraction.error:
                parser_status = f"{profile.parser_status}; extraction error: {pdf_extraction.error}"
        use_cases = tuple(_detect_file_use_cases(path))
        detected.extend(use_cases)
        file_profiles.append(
            AgentFileProfile(
                filename=path.name,
                file_type=profile.file_type,
                size_bytes=profile.size_bytes,
                size_label=format_bytes(profile.size_bytes),
                parser_status=parser_status,
                summary=readable_summary,
                detected_use_cases=use_cases,
            )
        )
        tool_calls.append(
            AgentToolCall(
                tool="inspect_upload",
                input=path.name,
                output=f"{profile.file_type}; {parser_status}",
            )
        )
        file_screens = _physics_screens_for_file(path, prompt)
        physics_screens.extend(file_screens)
        if file_screens:
            tool_calls.append(
                AgentToolCall(
                    tool="physics_screen",
                    input=path.name,
                    output=f"{len(file_screens)} screen(s): {', '.join(screen.family for screen in file_screens)}",
                )
            )

    submission = analyze_submission(prompt, paths)
    submission, recovery_note = _recover_submission_if_needed(prompt, submission)
    if recovery_note:
        tool_calls.append(
            AgentToolCall(
                tool="recover_from_partial_analysis",
                input=recovery_note["input"],
                output=recovery_note["output"],
            )
        )
    memo = render_submission_brief(submission)
    tool_calls.append(
        AgentToolCall(
            tool="synthesize_client_memo",
            input=f"{len(paths)} file(s), prompt length {len(prompt)}",
            output=f"{len(submission.insights)} insight(s), {len(submission.next_steps)} next action(s)",
        )
    )

    top_insights = tuple(
        {
            "title": insight.title,
            "evidence": insight.evidence,
            "recommendation": insight.recommendation,
            "support": insight.support.value,
        }
        for insight in submission.insights[:6]
    )
    unique_use_cases = tuple(_dedupe(detected)) or detect_use_cases_from_prompt(prompt)
    confidence = _confidence_label(submission, physics_screens)
    stages: list[AgentStage] = [
        AgentStage(
            name="Loop Planning",
            status="completed",
            summary="Selected a bounded multi-step analysis loop for the request.",
            detail="Inspect uploads, extract content, run matched tools, recover from partial evidence, synthesize.",
        ),
        AgentStage(
            name="Intake",
            status="completed",
            summary=f"Reviewed {len(paths)} uploaded file(s).",
            detail=", ".join(profile.filename for profile in file_profiles),
        ),
        AgentStage(
            name="Parser Selection",
            status="completed",
            summary=f"Matched {sum(1 for profile in file_profiles if _parser_ready(profile.parser_status))} parser-ready file(s).",
            detail="; ".join(f"{profile.filename}: {profile.parser_status}" for profile in file_profiles),
        ),
        AgentStage(
            name="Physics And Data Screens",
            status="completed" if physics_screens else "partial",
            summary=f"Produced {len(physics_screens)} deterministic screen(s).",
            detail=", ".join(screen.family for screen in physics_screens) if physics_screens else "No supported physics screen matched this upload yet.",
        ),
    ]
    if recovery_note:
        stages.append(
            AgentStage(
                name="Recovery",
                status="completed",
                summary="First-pass tools were not enough, so the agent produced a bounded recovery answer.",
                detail=recovery_note["output"],
            )
        )
    stages.extend(
        [
        AgentStage(
            name="Synthesis",
            status="completed",
            summary=f"Wrote a client memo with {len(submission.insights)} insight(s).",
            detail="Statements needing more evidence were moved into the important boundaries section.",
        ),
        AgentStage(
            name="Review",
            status="completed",
            summary=f"Final confidence: {confidence}.",
            detail="The response separates computed facts, assumptions, and missing data.",
        ),
        ]
    )
    return AgentRun(
        prompt=prompt,
        executive_answer=_executive_answer_from_memo(memo),
        memo_markdown=memo,
        detected_use_cases=unique_use_cases,
        files=tuple(file_profiles),
        stages=tuple(stages),
        tool_calls=tuple(tool_calls),
        physics_screens=tuple(physics_screens),
        top_insights=top_insights,
        limitations=submission.limits,
        next_actions=submission.next_steps,
        confidence=confidence,
    )


def _submission_needs_recovery(submission: SubmissionResult) -> bool:
    if not submission.files:
        return False
    titles = " ".join(insight.title for insight in submission.insights).lower()
    limits = " ".join(submission.limits).lower()
    return (
        "inventoried, but not yet deeply analyzed" in titles
        or "only identified file types and sizes" in limits
        or "did not produce usable text or tables" in limits
    )


def _recover_submission_if_needed(
    prompt: str,
    submission: SubmissionResult,
) -> tuple[SubmissionResult, dict[str, str] | None]:
    """Add an advisory recovery step when first-pass tools stop at intake."""

    if not _submission_needs_recovery(submission):
        return submission, None

    file_names = ", ".join(file.path.name for file in submission.files) or "the uploaded file"
    general = analyze_general_prompt(prompt)
    fallback_recommendation = (
        general.insights[0].recommendation
        if general.insights
        else "Define the decision, request the smallest source table, and rerun with a parser-ready export."
    )
    recovery = ClientInsight(
        title="The request can still be advanced despite the parser limit",
        evidence=(
            f"The current upload was received ({file_names}), but the first-pass tools did not extract enough "
            "source content for a decision-grade analysis."
        ),
        recommendation=fallback_recommendation,
        support=ClaimSupport.INFERRED,
    )
    limits = tuple(
        _dedupe(
            [
                *submission.limits,
                "This recovery step is advisory; it does not validate source-file claims without readable extracted content.",
            ]
        )
    )
    next_steps = tuple(
        _dedupe(
            [
                *submission.next_steps,
                "Retry with a text-searchable PDF, Markdown, CSV, JSON, XLSX, or another parser-ready export.",
                "If the source is a complex PDF, configure MinerU2.5 Pro extraction before rerunning.",
            ]
        )
    )
    return (
        replace(
            submission,
            insights=(recovery, *submission.insights),
            limits=limits,
            next_steps=next_steps,
        ),
        {
            "input": f"{len(submission.files)} file(s) reached intake-only or parser-limited state.",
            "output": "Added advisory recovery guidance without upgrading confidence.",
        },
    )


def _detect_file_use_cases(path: Path) -> list[str]:
    if path.suffix.lower() == ".zip":
        return ["gas-turbine-emissions"] if "gas" in path.name.lower() or "turbine" in path.name.lower() else ["archive-intake"]
    if path.suffix.lower() == ".json":
        payload = _read_json_dict(path)
        if _is_platform_export_payload(payload):
            return _detect_platform_export_use_cases(payload, path)
        return ["structured-data-review"]
    if path.suffix.lower() == ".pdf":
        extraction = extract_pdf_document(path)
        text = extraction.text.lower()
        cases = [_use_case_from_suffix(path.suffix.lower())]
        if extract_pv_module_spec(extraction.text):
            cases.extend(["solar-pv", "photovoltaic"])
        if extract_power_plant_spec(extraction.text):
            cases.extend(["power-plant", "thermal-generation", "plant-performance"])
        if "heat pump" in text or "hspf" in text or "ahri 210/240" in text:
            cases.extend(["heat-pump-hvac", "thermal-exergy"])
        cases.extend(_detect_document_use_cases(extraction.text))
        if "district heating" in text:
            cases.extend(["district-heating", "thermal-exergy"])
        if "waste heat" in text:
            cases.extend(["industrial-waste-heat", "thermal-exergy"])
        return _dedupe(cases)
    if path.suffix.lower() != ".csv":
        return [_use_case_from_suffix(path.suffix.lower())]
    rows = _safe_rows(path)
    headers = set(rows[0].keys()) if rows else set()
    normalized = {_normalize_header(header) for header in headers}
    if {"waste_heat_mwh", "exhaust_temp_c"} <= normalized:
        return ["industrial-waste-heat", "thermal-exergy"]
    if {"delivered_kwh", "supply_temp_c", "return_temp_c"} <= normalized:
        return ["district-heating", "thermal-exergy"]
    if "usage_kwh" in normalized:
        return ["steel", "industrial-load-management"]
    if "lv_activepower_(kw)" in normalized:
        return ["wind-turbine-scada"]
    if {"stc", "ptc", "a_c"} <= {header.lower() for header in headers}:
        return ["solar-pv-module-analysis"]
    if {"voltage_measured", "capacity", "id_cycle"} <= normalized:
        return ["battery-aging"]
    if {"z_real", "z_img", "applied_voltage"} <= normalized:
        return ["fuel-cell-impedance"]
    if "year" in normalized and len(headers) > 50:
        return ["cement-process-emissions"]
    if {"city", "total_chargers", "avg_power"} <= normalized or len(headers) > 100:
        return ["ev-charging-utilization"]
    return ["csv-intake"]


def _parser_ready(parser_status: str) -> bool:
    lower = parser_status.lower()
    return (
        "available" in lower
        or "extracted" in lower
        or "parser-ready" in lower
        or "parser installed" in lower
    )


def _physics_screens_for_file(path: Path, prompt: str = "") -> list[PhysicsScreen]:
    if path.suffix.lower() == ".zip":
        return []
    if path.suffix.lower() == ".json":
        return _physics_screens_from_platform_export(path)
    if path.suffix.lower() == ".pdf":
        return [
            *_pv_module_screens_from_pdf(path, prompt),
            *_power_plant_screens_from_pdf(path),
            *_heat_pump_screens_from_pdf(path),
        ]
    if path.suffix.lower() != ".csv":
        return []
    rows = _safe_rows(path)
    if not rows:
        return []
    headers = set(rows[0].keys())
    normalized = {_normalize_header(header) for header in headers}
    if {"waste_heat_mwh", "exhaust_temp_c"} <= normalized or {"delivered_kwh", "supply_temp_c"} <= normalized:
        return [_thermal_exergy_screen(rows, headers)]
    if "usage_kwh" in normalized:
        return [_industrial_load_screen(rows)]
    if "lv_activepower_(kw)" in normalized:
        return [_wind_power_curve_screen(rows)]
    if {"stc", "ptc", "a_c"} <= {header.lower() for header in headers}:
        return [_pv_module_screen(rows)]
    if {"voltage_measured", "capacity", "id_cycle"} <= normalized:
        return [_battery_aging_screen(rows)]
    if {"z_real", "z_img", "applied_voltage"} <= normalized:
        return [_fuel_cell_impedance_screen(rows)]
    if "year" in normalized and len(headers) > 50:
        return [_cement_emissions_screen(rows)]
    if {"city", "total_chargers", "avg_power"} <= normalized or len(headers) > 100:
        return [_ev_charging_screen(rows)]
    return []


def _pv_module_screens_from_pdf(path: Path, prompt: str) -> list[PhysicsScreen]:
    extraction = extract_pdf_document(path)
    if not extraction.text:
        return []
    spec = extract_pv_module_spec(extraction.text)
    if not spec:
        return []
    lat, lon = extract_location(prompt)
    estimate = estimate_pv_production(spec, latitude=lat, longitude=lon)
    location = (
        f"{estimate.latitude:g} N, {estimate.longitude:g} E"
        if estimate.latitude is not None and estimate.longitude is not None
        else "requested site"
    )
    return [
        PhysicsScreen(
            title="PV module site-production estimate",
            family="pv_module_site_production",
            status="computed",
            confidence="screening_grade",
            key_metrics={
                "model_family": spec.model_family,
                "peak_power_stc_w": estimate.peak_power_stc_w,
                "site_peak_power_w": estimate.site_peak_power_w,
                "average_daily_generation_kwh": estimate.average_daily_generation_kwh,
                "annual_generation_kwh": estimate.annual_generation_kwh,
                "solar_exergy_factor": estimate.solar_exergy_factor,
                "electricity_exergy_factor": estimate.electricity_exergy_factor,
                "plane_of_array_sun_hours": estimate.plane_of_array_sun_hours,
                "performance_ratio": estimate.performance_ratio,
                "latitude": estimate.latitude,
                "longitude": estimate.longitude,
                "module_efficiency_pct": spec.efficiency_pct,
                "temp_coeff_pmax_pct_per_c": spec.temp_coeff_pmax_pct_per_c,
            },
            recommendation=f"Use this one-module estimate for {location}; multiply by module count for array-scale DC energy before inverter losses.",
            caveats=("The estimate uses fixed-tilt sun-hours and generic performance-ratio assumptions, not a site weather file.",),
        )
    ]


def _heat_pump_screens_from_pdf(path: Path) -> list[PhysicsScreen]:
    extraction = extract_pdf_document(path)
    if not extraction.text:
        return []
    ratings = extract_heat_pump_ratings(extraction.text)
    best = best_heat_pump_rating(ratings)
    if not best:
        return []
    estimate = heat_pump_exergy_estimate(best)
    if not estimate:
        return []
    return [
        PhysicsScreen(
            title="Heat-pump exergy screen from PDF rating data",
            family="heat_pump_exergy",
            status="computed",
            confidence="screening_grade",
            key_metrics={
                "outdoor_model": estimate.get("outdoor_model"),
                "indoor_model": estimate.get("indoor_model"),
                "heating_capacity_kw": estimate.get("heating_capacity_kw"),
                "hspf": estimate.get("hspf"),
                "seasonal_cop_proxy": estimate.get("seasonal_cop_proxy"),
                "carnot_exergy_factor": estimate.get("carnot_exergy_factor"),
                "useful_heat_exergy_kw": estimate.get("useful_heat_exergy_kw"),
                "second_law_efficiency_pct": estimate.get("second_law_efficiency_pct"),
            },
            recommendation="Rerun with measured input power and actual supply/return temperatures before making an installed-performance claim.",
            caveats=(heat_pump_exergy_caveat(),),
        )
    ]


def _power_plant_screens_from_pdf(path: Path) -> list[PhysicsScreen]:
    extraction = extract_pdf_document(path)
    if not extraction.text:
        return []
    spec = extract_power_plant_spec(extraction.text)
    if not spec:
        return []
    estimate = estimate_power_plant_performance(spec)
    return [
        PhysicsScreen(
            title="Power-plant operating and economics screen",
            family="power_plant_performance",
            status="computed",
            confidence="screening_grade",
            key_metrics={
                "plant_type": estimate.plant_type,
                "fuel_type": estimate.fuel_type,
                "net_capacity_mw": estimate.net_capacity_mw,
                "gross_capacity_mw": estimate.gross_capacity_mw,
                "heat_rate_btu_per_kwh": estimate.heat_rate_btu_per_kwh,
                "net_efficiency_pct": estimate.net_efficiency_pct,
                "capacity_factor_pct": estimate.capacity_factor_pct,
                "annual_generation_gwh": estimate.annual_generation_gwh,
                "annual_fuel_mmbtu": estimate.annual_fuel_mmbtu,
                "gas_price_per_mmbtu": estimate.gas_price_per_mmbtu,
                "fuel_cost_per_mwh": estimate.fuel_cost_per_mwh,
                "power_price_per_mwh": estimate.power_price_per_mwh,
                "spark_spread_per_mwh": estimate.spark_spread_per_mwh,
                "co2_intensity_t_per_mwh": estimate.co2_intensity_t_per_mwh,
                "annual_co2_t": estimate.annual_co2_t,
                "electricity_exergy_factor": estimate.electricity_exergy_factor,
                "fuel_chemical_exergy_factor": estimate.fuel_chemical_exergy_factor,
                "exergy_efficiency_proxy_pct": estimate.exergy_efficiency_proxy_pct,
            },
            recommendation="Use this as a plant-level calculation basis; rerun with hourly dispatch, ambient correction, outages, and actual contracts for project-grade economics.",
            caveats=(
                "This calculation does not include ambient derate, part-load heat rate, startup fuel, outages, curtailment, or full project finance assumptions.",
            ),
        )
    ]


def _looks_like_platform_export(path: Path) -> bool:
    return _is_platform_export_payload(_read_json_dict(path))


def _physics_screens_from_platform_export(path: Path) -> list[PhysicsScreen]:
    payload = _read_json_dict(path)
    if payload is None:
        return []
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list):
        return []
    screens: list[PhysicsScreen] = []
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        content = artifact.get("content")
        if not isinstance(content, dict):
            continue
        for item in content.get("physics_screens", []):
            if not isinstance(item, dict):
                continue
            metrics = item.get("key_metrics")
            screens.append(
                PhysicsScreen(
                    title=str(item.get("title") or "Prior exported physics screen"),
                    family=str(item.get("family") or "exported_screen"),
                    status=str(item.get("status") or "imported"),
                    confidence=str(item.get("confidence") or "screening_grade"),
                    key_metrics=metrics if isinstance(metrics, dict) else {},
                    recommendation=str(item.get("recommendation") or "Use the exported screen as prior evidence only."),
                    caveats=tuple(str(caveat) for caveat in item.get("caveats", []) if isinstance(caveat, str))
                    if isinstance(item.get("caveats"), list)
                    else (),
                )
            )
        if not screens and isinstance(content.get("client_summary"), dict):
            summary_screen = _physics_screen_from_client_summary(content["client_summary"])
            if summary_screen:
                screens.append(summary_screen)
    return screens


def _read_json_dict(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, OSError):
        return None
    return payload if isinstance(payload, dict) else None


def _is_platform_export_payload(payload: dict[str, Any] | None) -> bool:
    return bool(payload and isinstance(payload.get("project"), dict) and isinstance(payload.get("artifacts"), list))


def _detect_platform_export_use_cases(payload: dict[str, Any], path: Path) -> list[str]:
    signals: list[str] = []
    project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
    artifacts = payload.get("artifacts") if isinstance(payload.get("artifacts"), list) else []
    text_parts = [
        path.name,
        str(project.get("name") or ""),
        str(project.get("domain") or ""),
        str(project.get("description") or ""),
    ]
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            continue
        content = artifact.get("content")
        if not isinstance(content, dict):
            continue
        detected = content.get("detected_use_cases")
        if isinstance(detected, list):
            signals.extend(str(item) for item in detected if isinstance(item, str))
        summary = content.get("client_summary")
        if isinstance(summary, dict):
            text_parts.append(str(summary.get("use_case_label") or ""))
        screens = content.get("physics_screens")
        if isinstance(screens, list):
            for screen in screens:
                if isinstance(screen, dict):
                    family = str(screen.get("family") or "")
                    if family:
                        signals.append(family.replace("_", "-"))
    fused_text = " ".join([*signals, *text_parts]).lower()
    inferred: list[str] = []
    if "district" in fused_text or "substation" in fused_text:
        inferred.append("district-heating")
    if "waste heat" in fused_text or "waste-heat" in fused_text or "industrial-waste" in fused_text:
        inferred.append("industrial-waste-heat")
    if "thermal" in fused_text or "exergy" in fused_text:
        inferred.append("thermal-exergy")
    inferred.extend(signal for signal in signals if signal and signal not in inferred)
    inferred.extend(["platform-export-review", "prior-analysis-audit"])
    return _dedupe(inferred)


def _physics_screen_from_client_summary(client_summary: dict[str, Any]) -> PhysicsScreen | None:
    metric_cards = client_summary.get("computed_metrics")
    if not isinstance(metric_cards, list):
        return None
    metrics: dict[str, float | int | str | None] = {}
    for card in metric_cards:
        if not isinstance(card, dict):
            continue
        label = str(card.get("label") or "").strip().lower()
        value = card.get("value")
        if "first place" in label or "top" in label:
            metrics["top_stream"] = str(value)
        elif "accessible exergy" in label:
            number = _submission_number(str(value).replace("MWh_ex", ""))
            if number is not None:
                metrics["accessible_exergy_mwh"] = number
        elif "total energy" in label:
            number = _submission_number(str(value).replace("MWh", ""))
            if number is not None:
                metrics["total_energy_mwh"] = number
        elif "quality" in label or "exergy factor" in label:
            number = _submission_number(str(value))
            if number is not None:
                metrics["weighted_exergy_factor"] = number
    if not metrics:
        return None
    return PhysicsScreen(
        title="Imported useful-work screen",
        family="thermal_exergy",
        status="imported",
        confidence=str(client_summary.get("confidence") or "screening_grade"),
        key_metrics=metrics,
        recommendation=str(client_summary.get("conclusion") or "Use this as prior evidence."),
        caveats=tuple(str(item) for item in client_summary.get("not_proven", []) if isinstance(item, str))
        if isinstance(client_summary.get("not_proven"), list)
        else (),
    )


def _thermal_exergy_screen(rows: list[dict[str, str]], headers: set[str]) -> PhysicsScreen:
    normalized_headers = {_normalize_header(header) for header in headers}
    use_case = UseCase.DISTRICT_HEATING if {"delivered_kwh", "return_temp_c"} & normalized_headers else UseCase.INDUSTRIAL_WASTE_HEAT
    result = analyze_records(normalize_records(rows), use_case)
    metrics = result.summary_metrics
    top_record = max(result.records, key=lambda item: item.exergy_mwh or 0.0, default=None)
    return PhysicsScreen(
        title="Thermal useful-work screen",
        family="thermal_exergy",
        status="computed",
        confidence=result.confidence.value,
        key_metrics={
            "total_energy_mwh": metrics.get("total_energy_mwh"),
            "accessible_exergy_mwh": metrics.get("total_accessible_exergy_mwh"),
            "weighted_exergy_factor": metrics.get("weighted_exergy_factor"),
            "top_stream": top_record.clean.label if top_record else None,
        },
        recommendation=result.recommended_actions[-1] if result.recommended_actions else "Use exergy ranking before deeper engineering.",
        caveats=tuple(result.cannot_prove[:3]),
    )


def _industrial_load_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    usage = [_submission_number(row.get("Usage_kWh")) for row in rows]
    usage = [value for value in usage if value is not None]
    pf = [_submission_number(row.get("Lagging_Current_Power_Factor")) for row in rows]
    pf = [value for value in pf if value is not None]
    low_pf_share = sum(1 for value in pf if value < 80.0) / len(pf) if pf else 0.0
    return PhysicsScreen(
        title="Industrial load and power-factor screen",
        family="industrial_load",
        status="computed",
        confidence="useful_but_bounded",
        key_metrics={
            "intervals": len(rows),
            "total_kwh": round(sum(usage), 3),
            "peak_interval_kwh": round(max(usage), 3) if usage else None,
            "average_lagging_pf": round(mean(pf), 3) if pf else None,
            "low_pf_interval_share": round(low_pf_share, 4),
        },
        recommendation="Check tariff penalties and dominant operating periods before expensive process changes.",
        caveats=("No production tonnage or tariff data was uploaded.",),
    )


def _wind_power_curve_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    actual_total = sum(max(0.0, _submission_number(row.get("LV ActivePower (kW)")) or 0.0) for row in rows)
    theoretical_total = sum(max(0.0, _submission_number(row.get("Theoretical_Power_Curve (KWh)")) or 0.0) for row in rows)
    capture = actual_total / theoretical_total if theoretical_total else 0.0
    return PhysicsScreen(
        title="Wind power-curve capture screen",
        family="wind_power_curve",
        status="computed",
        confidence="useful_but_bounded",
        key_metrics={
            "intervals": len(rows),
            "actual_total": round(actual_total, 3),
            "theoretical_total": round(theoretical_total, 3),
            "capture_ratio": round(capture, 4),
        },
        recommendation="Join alarm, curtailment, yaw, and maintenance logs before assigning root cause.",
        caveats=("SCADA power-curve comparison does not by itself distinguish faults from curtailment or wake effects.",),
    )


def _pv_module_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    densities = []
    ratios = []
    for row in rows:
        stc = _submission_number(row.get("STC")) or 0.0
        ptc = _submission_number(row.get("PTC")) or 0.0
        area = _submission_number(row.get("A_c")) or 0.0
        if stc > 0 and area > 0:
            densities.append(stc / area)
        if stc > 0 and ptc > 0:
            ratios.append(ptc / stc)
    return PhysicsScreen(
        title="PV module density and field-rating screen",
        family="pv_module",
        status="computed",
        confidence="screening_grade",
        key_metrics={
            "usable_modules": len(densities),
            "median_w_per_m2": round(median(densities), 3) if densities else None,
            "median_ptc_stc_ratio": round(median(ratios), 4) if ratios else None,
        },
        recommendation="Use these filters to shortlist modules, then require current datasheets and warranty/bankability evidence.",
        caveats=("Library values do not prove commercial availability, price, degradation, or site-specific yield.",),
    )


def _battery_aging_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    capacities = [_submission_number(row.get("Capacity")) for row in rows]
    capacities = [value for value in capacities if value is not None]
    temps = [_submission_number(row.get("Temperature_measured")) for row in rows]
    temps = [value for value in temps if value is not None]
    fade = None
    if len(capacities) >= 2 and capacities[0] > 0:
        fade = (capacities[0] - capacities[-1]) / capacities[0]
    return PhysicsScreen(
        title="Battery capacity-fade screen",
        family="battery_aging",
        status="computed",
        confidence="screening_grade",
        key_metrics={
            "measurements": len(rows),
            "first_capacity_ah": round(capacities[0], 4) if capacities else None,
            "last_capacity_ah": round(capacities[-1], 4) if capacities else None,
            "simple_capacity_fade": round(fade, 4) if fade is not None else None,
            "max_measured_temp_c": round(max(temps), 3) if temps else None,
        },
        recommendation="Segment by cycle, current, and temperature before making lifetime claims.",
        caveats=("Cell-level aging data does not directly prove pack warranty or vehicle duty-cycle life.",),
    )


def _fuel_cell_impedance_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    real = [_submission_number(row.get("z_real")) for row in rows]
    real = [value for value in real if value is not None]
    imag = [_submission_number(row.get("z_img")) for row in rows]
    imag = [value for value in imag if value is not None]
    voltages = sorted({value for value in (_submission_number(row.get("applied_voltage")) for row in rows) if value is not None})
    return PhysicsScreen(
        title="Electrochemical impedance screen",
        family="electrochemical_impedance",
        status="computed",
        confidence="screening_grade",
        key_metrics={
            "points": len(rows),
            "voltage_settings": len(voltages),
            "min_z_real": round(min(real), 6) if real else None,
            "max_z_real": round(max(real), 6) if real else None,
            "max_abs_z_img": round(max((abs(value) for value in imag), default=0.0), 6),
        },
        recommendation="Use this for quality-control comparison; add gas, humidity, pressure, and polarization curves before efficiency claims.",
        caveats=("Impedance without protocol metadata is not enough to diagnose degradation mechanism.",),
    )


def _cement_emissions_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    latest = max(rows, key=lambda row: _submission_number(row.get("Year")) or -1)
    values = [
        _submission_number(value)
        for key, value in latest.items()
        if key not in {"Year", "Global"}
    ]
    values = [value for value in values if value is not None and value > 0]
    total = sum(values)
    top = max(values) if values else 0.0
    return PhysicsScreen(
        title="Cement process-emissions concentration screen",
        family="process_emissions",
        status="computed",
        confidence="screening_grade",
        key_metrics={
            "latest_year": latest.get("Year"),
            "positive_entries": len(values),
            "country_sum": round(total, 3),
            "largest_entry_share": round(top / total, 4) if total else None,
        },
        recommendation="Use this for geography prioritization, then add plant-level clinker ratio, fuel, and retrofit data.",
        caveats=("Country process-emissions data is not a plant-level project pipeline.",),
    )


def _ev_charging_screen(rows: list[dict[str, str]]) -> PhysicsScreen:
    row = rows[0] if rows else {}
    chargers = _submission_number(row.get("total_chargers")) or 0.0
    sites = _submission_number(row.get("total_sites")) or 0.0
    volume = _submission_number(row.get("total_volume")) or 0.0
    return PhysicsScreen(
        title="EV charging utilization screen",
        family="ev_charging",
        status="computed",
        confidence="screening_grade",
        key_metrics={
            "chargers": round(chargers, 3),
            "sites": round(sites, 3),
            "chargers_per_site": round(chargers / sites, 4) if sites else None,
            "volume_per_charger": round(volume / chargers, 4) if chargers else None,
        },
        recommendation="Join station-hour volume, failed sessions, price, and grid constraints before expansion recommendations.",
        caveats=("Portfolio metadata alone does not show congestion, reliability, or interconnection limits.",),
    )


def _safe_rows(path: Path) -> list[dict[str, str]]:
    try:
        return _read_csv_path(path)
    except Exception:
        return []


def _normalize_header(header: str) -> str:
    return header.strip().lower().replace(" ", "_").replace("-", "_")


def _use_case_from_suffix(suffix: str) -> str:
    mapping = {
        ".pdf": "document-review",
        ".xlsx": "spreadsheet-review",
        ".xls": "spreadsheet-review",
        ".docx": "technical-document-review",
        ".json": "structured-data-review",
        ".parquet": "columnar-data-review",
        ".h5": "scientific-data-review",
        ".nc": "scientific-data-review",
        ".dwg": "cad-review",
        ".dxf": "cad-review",
        ".ifc": "bim-review",
    }
    return mapping.get(suffix, "file-intake")


def _confidence_label(submission: Any, screens: list[PhysicsScreen]) -> str:
    if not submission.insights:
        return "not_enough_evidence"
    if screens and len(submission.limits) <= 2:
        return "useful_but_bounded"
    if screens:
        return "screening_grade"
    if not submission.files:
        return "advisory"
    first_titles = " ".join(getattr(insight, "title", "") for insight in submission.insights).lower()
    if "could not be parsed" in first_titles or "not a recognized" in first_titles or "inventoried" in first_titles:
        return "intake_only"
    supports = {getattr(getattr(insight, "support", ""), "value", getattr(insight, "support", "")) for insight in submission.insights}
    if supports & {"computed", "observed"}:
        return "screening_grade"
    if "inferred" in supports:
        return "advisory"
    return "intake_only"


def _executive_answer_from_memo(memo: str) -> str:
    lines = memo.splitlines()
    for index, line in enumerate(lines):
        if line.strip() == "## Bottom Line" and index + 1 < len(lines):
            return lines[index + 1].strip()
    return "Analysis complete."


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    output = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            output.append(item)
    return output
