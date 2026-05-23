"""Client-style multi-file submission analysis."""

from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from statistics import mean


@dataclass(frozen=True)
class SubmissionFile:
    """Basic inventory for one uploaded file."""

    path: Path
    file_type: str
    size_bytes: int
    readable_summary: str


@dataclass(frozen=True)
class ClientInsight:
    """Plain-language insight backed by a computed fact."""

    title: str
    evidence: str
    recommendation: str


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

        if suffix == ".csv":
            rows = _read_csv_path(path)
            headers = set(rows[0].keys()) if rows else set()
            if "Usage_kWh" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_steel_energy(rows)
            elif "LV ActivePower (kW)" in headers and "Theoretical_Power_Curve (KWh)" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_wind_scada(rows)
            elif "Year" in headers and len(headers) > 50 and "United States of America" in headers:
                csv_insights, csv_limits, csv_steps = _analyze_cement_emissions(rows)
            else:
                csv_insights, csv_limits, csv_steps = _analyze_generic_csv(rows, lower_name)
            insights.extend(csv_insights)
            limits.extend(csv_limits)
            next_steps.extend(csv_steps)

    if not insights:
        insights.append(
            ClientInsight(
                title="The upload was inventoried, but not yet deeply analyzed",
                evidence="No uploaded file matched one of the first supported analyzers.",
                recommendation="Use the file inventory to choose the next parser or domain analyzer to add.",
            )
        )
        limits.append("This run only identified file types and sizes; it did not extract domain-specific values.")
        next_steps.append("Add a parser for the most important uploaded file type and rerun the same prompt.")

    return SubmissionResult(
        prompt=prompt,
        files=tuple(files),
        insights=tuple(insights),
        limits=tuple(_dedupe(limits)),
        next_steps=tuple(_dedupe(next_steps)),
    )


def render_submission_brief(result: SubmissionResult) -> str:
    """Render a client-facing submission brief."""

    lines = [
        "# Client Submission Brief",
        "",
        "## Client Question",
        result.prompt.strip() or "No prompt provided.",
        "",
        "## Direct Answer",
        _direct_answer(result),
        "",
        "## What I Found",
    ]
    for index, insight in enumerate(result.insights, start=1):
        lines.extend(
            [
                f"{index}. **{insight.title}**",
                f"   Evidence: {insight.evidence}",
                f"   Recommendation: {insight.recommendation}",
            ]
        )
    lines.extend(["", "## Uploaded Files"])
    for file in result.files:
        lines.append(
            f"- `{file.path.name}` ({file.file_type}, {_format_bytes(file.size_bytes)}): {file.readable_summary}"
        )
    lines.extend(["", "## What This Does Not Prove"])
    lines.extend(f"- {item}" for item in result.limits)
    lines.extend(["", "## Next Actions"])
    lines.extend(f"- {item}" for item in result.next_steps)
    return "\n".join(lines) + "\n"


def _direct_answer(result: SubmissionResult) -> str:
    first = result.insights[0]
    return f"{first.title}. {first.recommendation}"


def _summarize_file(path: Path) -> SubmissionFile:
    suffix = path.suffix.lower().lstrip(".") or "unknown"
    size = path.stat().st_size
    if suffix == "zip":
        try:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            summary = f"archive containing {len(names)} entries; first entries: {', '.join(names[:3])}"
        except zipfile.BadZipFile:
            summary = "archive extension present, but file is not a readable zip"
    elif suffix == "csv":
        try:
            rows = _read_csv_path(path, limit=2)
            columns = list(rows[0].keys()) if rows else []
            summary = f"CSV with {len(columns)} columns; first columns: {', '.join(columns[:6])}"
        except Exception as exc:
            summary = f"CSV-like file, but initial parsing failed: {exc}"
    else:
        summary = "file inventoried for parser selection"
    return SubmissionFile(path=path, file_type=suffix, size_bytes=size, readable_summary=summary)


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
    recent = [row for row in rows if _number(row.get("Year")) is not None and _number(row.get("Year")) >= 2000]
    latest = max(rows, key=lambda row: _number(row.get("Year")) or -1)
    countries = [key for key in latest if key != "Year"]
    latest_values = [(country, _number(latest.get(country))) for country in countries]
    latest_values = [(country, value) for country, value in latest_values if value is not None and value > 0]
    top = sorted(latest_values, key=lambda item: item[1], reverse=True)[:5]
    total_latest = sum(value for _, value in latest_values)
    top_text = ", ".join(f"{country}: {value:,.0f}" for country, value in top)
    return (
        [
            ClientInsight(
                title="Cement process emissions are concentrated enough to prioritize by country",
                evidence=(
                    f"The latest year in the file is {latest.get('Year')}. The top five positive entries are {top_text}; "
                    f"all positive country entries sum to {total_latest:,.0f} in the dataset units."
                ),
                recommendation=(
                    "Use this file for country-level screening, then pair it with plant-level clinker ratio, kiln fuel, and capture-readiness data."
                ),
            )
        ],
        [
            "This is process-emissions data; it does not include fuel-combustion emissions, plant retrofit cost, or product-level EPD values.",
        ],
        [
            "Join country-level cement emissions to plant locations and production volumes before ranking project sites.",
        ],
    )


def _analyze_generic_csv(rows: list[dict[str, str]], name: str) -> tuple[list[ClientInsight], list[str], list[str]]:
    columns = list(rows[0].keys()) if rows else []
    return (
        [
            ClientInsight(
                title="The CSV is structurally readable",
                evidence=f"`{name}` has {len(rows):,} rows and {len(columns)} columns. First columns: {', '.join(columns[:8])}.",
                recommendation="Add a domain analyzer for these columns once the client question is clear.",
            )
        ],
        ["This pass did not infer business meaning beyond the CSV shape."],
        ["Map the CSV columns to a domain question and add a targeted calculation."],
    )


def _read_csv_path(path: Path, limit: int | None = None) -> list[dict[str, str]]:
    raw = path.read_bytes()
    return _read_csv_bytes(raw, limit=limit)


def _read_csv_bytes(raw: bytes, limit: int | None = None) -> list[dict[str, str]]:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = raw.decode(encoding)
            reader = csv.DictReader(io.StringIO(text))
            rows = []
            for index, row in enumerate(reader):
                if limit is not None and index >= limit:
                    break
                rows.append(dict(row))
            return rows
        except UnicodeError as exc:
            last_error = exc
    if last_error:
        raise last_error
    return []


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


def _format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped
