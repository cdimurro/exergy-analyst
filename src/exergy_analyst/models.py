"""Core data models for the first Exergy Analyst workflows."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class UseCase(str, Enum):
    """Supported first-pass analysis workflows."""

    DISTRICT_HEATING = "district-heating"
    INDUSTRIAL_WASTE_HEAT = "industrial-waste-heat"
    ENERGY_PROJECT = "energy-project"
    SCIENTIFIC_DATASET = "scientific-dataset"


class Confidence(str, Enum):
    """Human-readable confidence labels."""

    READY_TO_ACT = "ready_to_act"
    USEFUL_BUT_BOUNDED = "useful_but_bounded"
    NEEDS_ONE_MEASUREMENT = "needs_one_measurement"
    NOT_ENOUGH_EVIDENCE = "not_enough_evidence"
    CONTRADICTORY_OR_UNSAFE = "contradictory_or_unsafe"


@dataclass(frozen=True)
class CleanRecord:
    """Normalized row used by the analysis layer."""

    label: str
    energy_mwh: float | None = None
    source_temp_c: float | None = None
    sink_temp_c: float | None = None
    return_temp_c: float | None = None
    ambient_temp_c: float | None = None
    flow_rate: float | None = None
    operating_hours: float | None = None
    cost_usd: float | None = None
    emissions_tco2: float | None = None
    timestamp: str | None = None
    stream_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
    issues: tuple[str, ...] = ()


@dataclass(frozen=True)
class EnrichedRecord:
    """Clean row plus exergy calculations."""

    clean: CleanRecord
    exergy_factor: float | None
    exergy_mwh: float | None
    fidelity: str
    opportunity_score: float
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class Insight:
    """A user-facing insight for the decision brief."""

    title: str
    detail: str
    action: str
    confidence: Confidence


@dataclass(frozen=True)
class AnalysisResult:
    """Full analysis result consumed by report generation."""

    use_case: UseCase
    records: tuple[EnrichedRecord, ...]
    insights: tuple[Insight, ...]
    recommended_actions: tuple[str, ...]
    cannot_prove: tuple[str, ...]
    next_measurements: tuple[str, ...]
    confidence: Confidence
    summary_metrics: dict[str, float | int | str | None]
