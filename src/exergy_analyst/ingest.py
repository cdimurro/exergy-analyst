"""Messy CSV ingestion and normalization."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Iterable

from .models import CleanRecord


FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "label": ("label", "name", "asset", "asset_name", "stream", "stream_name", "meter"),
    "energy_mwh": (
        "energy_mwh",
        "mwh",
        "delivered_mwh",
        "heat_mwh",
        "waste_heat_mwh",
        "thermal_mwh",
        "energy",
        "energy_quantity",
    ),
    "energy_kwh": ("energy_kwh", "kwh", "delivered_kwh", "heat_kwh", "thermal_kwh"),
    "source_temp_c": (
        "source_temp_c",
        "source_c",
        "supply_temp_c",
        "supply_temperature_c",
        "hot_temp_c",
        "exhaust_temp_c",
        "stream_temp_c",
    ),
    "sink_temp_c": (
        "sink_temp_c",
        "sink_c",
        "ambient_c",
        "ambient_temp_c",
        "reference_temp_c",
        "t0_c",
    ),
    "return_temp_c": ("return_temp_c", "return_c", "return_temperature_c"),
    "ambient_temp_c": ("ambient_temp_c", "ambient_c", "outdoor_temp_c"),
    "flow_rate": ("flow_rate", "mass_flow", "mass_flow_rate", "volume_flow", "flow"),
    "operating_hours": ("operating_hours", "hours", "annual_hours", "runtime_hours"),
    "cost_usd": ("cost_usd", "cost", "project_cost", "capex_usd"),
    "emissions_tco2": ("emissions_tco2", "co2_tons", "co2_tonnes", "emissions"),
    "timestamp": ("timestamp", "datetime", "date_time", "time"),
    "stream_id": ("stream_id", "tag", "meter_id", "asset_id", "substation"),
}


def load_csv_records(path: str | Path) -> list[CleanRecord]:
    """Load and normalize records from a CSV file."""

    with Path(path).open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return [normalize_record(row) for row in reader]


def normalize_records(rows: Iterable[dict[str, Any]]) -> list[CleanRecord]:
    """Normalize mapping rows already loaded by a caller."""

    return [normalize_record(row) for row in rows]


def normalize_record(row: dict[str, Any]) -> CleanRecord:
    """Normalize one messy row into the internal record shape."""

    normalized = {_normalize_key(key): value for key, value in row.items()}
    issues: list[str] = []
    energy_mwh = _number(_pick(normalized, "energy_mwh"))
    energy_kwh = _number(_pick(normalized, "energy_kwh"))
    if energy_mwh is None and energy_kwh is not None:
        energy_mwh = energy_kwh / 1000.0
    if energy_mwh is None:
        issues.append("missing_energy_quantity")
    elif energy_mwh < 0.0:
        issues.append("negative_energy_quantity")

    source_temp_c = _number(_pick(normalized, "source_temp_c"))
    sink_temp_c = _number(_pick(normalized, "sink_temp_c"))
    ambient_temp_c = _number(_pick(normalized, "ambient_temp_c"))
    if sink_temp_c is None and ambient_temp_c is not None:
        sink_temp_c = ambient_temp_c
    if source_temp_c is None:
        issues.append("missing_source_temperature")
    if sink_temp_c is None:
        issues.append("missing_sink_or_reference_temperature")

    label = _text(_pick(normalized, "label")) or _text(_pick(normalized, "stream_id")) or "Unnamed stream"
    return CleanRecord(
        label=label,
        energy_mwh=energy_mwh,
        source_temp_c=source_temp_c,
        sink_temp_c=sink_temp_c,
        return_temp_c=_number(_pick(normalized, "return_temp_c")),
        ambient_temp_c=ambient_temp_c,
        flow_rate=_number(_pick(normalized, "flow_rate")),
        operating_hours=_number(_pick(normalized, "operating_hours")),
        cost_usd=_number(_pick(normalized, "cost_usd")),
        emissions_tco2=_number(_pick(normalized, "emissions_tco2")),
        timestamp=_text(_pick(normalized, "timestamp")),
        stream_id=_text(_pick(normalized, "stream_id")),
        raw=dict(row),
        issues=tuple(issues),
    )


def _pick(row: dict[str, Any], canonical: str) -> Any:
    for alias in FIELD_ALIASES[canonical]:
        key = _normalize_key(alias)
        if key in row and row[key] not in {"", None}:
            return row[key]
    return None


def _normalize_key(key: str) -> str:
    return key.strip().lower().replace(" ", "_").replace("-", "_")


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None
