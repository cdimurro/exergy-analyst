"""Analysis pipeline for energy opportunity briefs."""

from __future__ import annotations

from collections import defaultdict
from statistics import mean

from .exergy import accessible_exergy_mwh, thermal_exergy_factor
from .models import AnalysisResult, CleanRecord, Confidence, EnrichedRecord, Insight, UseCase
from .physical_reasoning import is_physical, robust_weighted_mean


def analyze_records(records: list[CleanRecord], use_case: UseCase) -> AnalysisResult:
    """Analyze clean records and return decision-brief content."""

    enriched = tuple(_enrich_record(record) for record in records)
    usable = [record for record in enriched if record.exergy_mwh is not None]
    # Only physically valid energy contributes to totals and to the
    # delivery-weighted quality factor, so one negative or garbage row cannot
    # corrupt the aggregate.
    contributing = [
        record for record in usable if is_physical("magnitude", record.clean.energy_mwh)
    ]
    total_energy = sum(record.clean.energy_mwh or 0.0 for record in contributing)
    total_exergy = sum(record.exergy_mwh or 0.0 for record in contributing)
    weighted_fx = robust_weighted_mean(
        (record.clean.energy_mwh, record.exergy_factor) for record in contributing
    )
    confidence = _overall_confidence(enriched)
    insights = tuple(_build_insights(usable, use_case, weighted_fx, confidence))
    return AnalysisResult(
        use_case=use_case,
        records=enriched,
        insights=insights,
        recommended_actions=tuple(_recommended_actions(usable, use_case)),
        cannot_prove=tuple(_cannot_prove(enriched, use_case)),
        next_measurements=tuple(_next_measurements(enriched, use_case)),
        confidence=confidence,
        summary_metrics={
            "record_count": len(enriched),
            "usable_record_count": len(usable),
            "total_energy_mwh": round(total_energy, 3),
            "total_accessible_exergy_mwh": round(total_exergy, 3),
            "weighted_exergy_factor": round(weighted_fx, 4) if weighted_fx is not None else None,
        },
    )


def _enrich_record(record: CleanRecord) -> EnrichedRecord:
    notes = list(record.issues)
    fx = None
    exergy_mwh = None
    fidelity = "F0"
    if record.energy_mwh is not None and record.source_temp_c is not None and record.sink_temp_c is not None:
        try:
            fx = thermal_exergy_factor(record.source_temp_c, record.sink_temp_c)
        except ValueError:
            # Non-physical temperature (at or below absolute zero). Do not crash
            # the whole run; flag the row and leave its exergy uncomputed.
            fx = None
            notes.append("non_physical_temperature")
            fidelity = "F1"
        else:
            exergy_mwh = accessible_exergy_mwh(max(0.0, record.energy_mwh), fx)
            fidelity = "F3" if record.timestamp else "F2"
            if fx == 0.0:
                notes.append("source_temperature_not_above_sink")
    elif record.energy_mwh is not None:
        fidelity = "F1"
    score = exergy_mwh or 0.0
    return EnrichedRecord(
        clean=record,
        exergy_factor=fx,
        exergy_mwh=exergy_mwh,
        fidelity=fidelity,
        opportunity_score=score,
        notes=tuple(notes),
    )


def _overall_confidence(records: tuple[EnrichedRecord, ...]) -> Confidence:
    if not records:
        return Confidence.NOT_ENOUGH_EVIDENCE
    usable = sum(1 for record in records if record.exergy_mwh is not None)
    issue_count = sum(len(record.clean.issues) for record in records)
    if usable == 0:
        return Confidence.NOT_ENOUGH_EVIDENCE
    usable_ratio = usable / len(records)
    if usable_ratio >= 0.85 and issue_count == 0:
        return Confidence.READY_TO_ACT
    if usable_ratio >= 0.65:
        return Confidence.USEFUL_BUT_BOUNDED
    return Confidence.NEEDS_ONE_MEASUREMENT


def _build_insights(
    usable: list[EnrichedRecord],
    use_case: UseCase,
    weighted_fx: float | None,
    confidence: Confidence,
) -> list[Insight]:
    if not usable:
        return [
            Insight(
                title="The uploaded data is not yet analyzable",
                detail="No rows include enough energy and temperature context to compute useful-work potential.",
                action="Add energy quantity, source temperature, and sink or ambient temperature for each stream.",
                confidence=Confidence.NOT_ENOUGH_EVIDENCE,
            )
        ]

    ranked = sorted(usable, key=lambda item: item.opportunity_score, reverse=True)
    top = ranked[0]
    insights = [
        Insight(
            title=f"{top.clean.label} is the highest useful-work opportunity",
            detail=(
                f"It contributes {top.exergy_mwh:.2f} MWh_ex with f_X={top.exergy_factor:.3f}. "
                "This ranking uses useful-work potential, not energy quantity alone."
            ),
            action=_top_action(use_case, top),
            confidence=confidence,
        )
    ]
    high_energy = max(usable, key=lambda item: item.clean.energy_mwh or 0.0)
    if high_energy.clean.label != top.clean.label:
        insights.append(
            Insight(
                title="Largest MWh stream is not the strongest opportunity",
                detail=(
                    f"{high_energy.clean.label} has the largest energy quantity, but {top.clean.label} "
                    "has higher useful-work value after temperature quality is included."
                ),
                action="Prioritize opportunities by MWh_ex before spending engineering time on detailed design.",
                confidence=confidence,
            )
        )
    if weighted_fx is not None:
        insights.append(
            Insight(
                title="Portfolio energy quality is now visible",
                detail=f"The delivery-weighted Exergy Factor is {weighted_fx:.3f}.",
                action="Track this as a quality KPI alongside total MWh.",
                confidence=confidence,
            )
        )
    return insights


def _top_action(use_case: UseCase, top: EnrichedRecord) -> str:
    if use_case == UseCase.DISTRICT_HEATING:
        return "Check this branch for avoidable supply-temperature overshoot or return-temperature problems."
    if use_case == UseCase.INDUSTRIAL_WASTE_HEAT:
        return "Screen this stream first for heat recovery, cascade use, or process integration."
    return "Use this item as the first candidate for deeper diligence."


def _recommended_actions(usable: list[EnrichedRecord], use_case: UseCase) -> list[str]:
    ranked = sorted(usable, key=lambda item: item.opportunity_score, reverse=True)
    actions = [
        "Rank opportunities by MWh_ex, not MWh alone.",
        "Separate high-grade recovery targets from low-grade heat that needs a nearby matching demand.",
    ]
    if use_case == UseCase.DISTRICT_HEATING:
        actions.append("Investigate substations with high useful-work loss during cold starts or morning ramps.")
    if use_case == UseCase.INDUSTRIAL_WASTE_HEAT:
        actions.append("Map top streams to nearby heat demands before estimating project economics.")
    if ranked:
        top_labels = ", ".join(record.clean.label for record in ranked[:3])
        actions.append(f"Start detailed review with: {top_labels}.")
    return actions


def _cannot_prove(records: tuple[EnrichedRecord, ...], use_case: UseCase) -> list[str]:
    limits = [
        "This analysis does not prove project ROI without installed-cost, operating-hours, and integration constraints.",
        "This analysis does not replace a full engineering exergy audit.",
    ]
    if any(record.clean.issues for record in records):
        limits.append("Rows with missing energy or temperature fields cannot support stream-specific claims.")
    notes = {note for record in records for note in record.notes}
    if "non_physical_temperature" in notes:
        limits.append("One or more streams have a temperature at or below absolute zero and were left out of the useful-work estimate; correct the data before relying on the ranking.")
    if "source_temperature_not_above_sink" in notes:
        limits.append("One or more streams are at or below the reference temperature, so they carry no directly recoverable useful work without a heat pump.")
    if any(not is_physical("magnitude", record.clean.energy_mwh) for record in records):
        limits.append("One or more streams report a negative or non-physical energy quantity and were excluded from the totals; confirm the metering before use.")
    if use_case == UseCase.DISTRICT_HEATING:
        limits.append("The current pass does not prove customer comfort or hydraulic feasibility.")
    if use_case == UseCase.INDUSTRIAL_WASTE_HEAT:
        limits.append("The current pass does not prove recoverability without flow, contamination, and duty-cycle data.")
    return limits


def _next_measurements(records: tuple[EnrichedRecord, ...], use_case: UseCase) -> list[str]:
    missing: dict[str, int] = defaultdict(int)
    for record in records:
        for issue in record.clean.issues:
            missing[issue] += 1
    measurements = []
    if missing.get("missing_source_temperature"):
        measurements.append("Add source or supply temperature for every material stream.")
    if missing.get("missing_sink_or_reference_temperature"):
        measurements.append("Add ambient, sink, return, or service temperature for each interval.")
    if missing.get("missing_energy_quantity"):
        measurements.append("Add interval energy quantity in kWh or MWh.")
    if use_case == UseCase.INDUSTRIAL_WASTE_HEAT:
        if any(record.clean.flow_rate is None for record in records):
            measurements.append("Add flow rate for the top-ranked stream.")
        if any(record.clean.operating_hours is None for record in records):
            measurements.append("Add operating-hours or duty-cycle data for the top-ranked stream.")
    if use_case == UseCase.DISTRICT_HEATING:
        if any(record.clean.return_temp_c is None for record in records):
            measurements.append("Add return temperature for substation-level diagnosis.")
        measurements.append("Add pump power, valve position, or customer comfort data to separate hydraulic and service-quality effects.")
    return measurements or ["Add project cost or intervention cost to convert thermodynamic ranking into ROI ranking."]
