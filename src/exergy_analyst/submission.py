"""Client-style multi-file submission analysis."""

from __future__ import annotations

import csv
import io
import zipfile
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median

from .claims import ClaimSupport
from .file_inventory import format_bytes, profile_file


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
    for file in result.files:
        lines.append(
            f"- `{file.path.name}` ({file.file_type}, {format_bytes(file.size_bytes)}): "
            f"{file.readable_summary} Parser status: {file.parser_status}."
        )
    lines.extend(["", "## What I Would Not Claim Yet"])
    lines.extend(f"- {item}" for item in result.limits)
    lines.extend(["", "## Recommended Next Actions"])
    lines.extend(f"- {item}" for item in result.next_steps)
    return "\n".join(lines) + "\n"


def _direct_answer(result: SubmissionResult) -> str:
    first = result.insights[0]
    return f"{first.title}. {first.recommendation}"


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
    elif suffix == "csv":
        try:
            rows = _read_csv_path(path, limit=2)
            columns = list(rows[0].keys()) if rows else []
            summary = f"CSV with {len(columns)} columns; first columns: {', '.join(columns[:6])}"
        except Exception as exc:
            summary = f"CSV-like file, but initial parsing failed: {exc}"
    else:
        summary = profile.summary
    return SubmissionFile(
        path=path,
        file_type=profile.file_type,
        size_bytes=profile.size_bytes,
        readable_summary=summary,
        parser_status=profile.parser_status,
    )


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
                    "Use this file for country-level screening, then pair it with plant-level clinker ratio, kiln fuel, and capture-readiness data."
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
                title="This file is a screening map, not a project pipeline",
                evidence=(
                    f"Positive country rows sum to {total_latest:,.0f} in the dataset units, but the file has no plant IDs, kiln types, clinker ratios, fuels, or retrofit costs."
                ),
                recommendation=(
                    "Pair the country screen with plant-level data before ranking capture, fuel-switching, or clinker-substitution projects."
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
                title="The PV module file is useful for screening, not procurement by itself",
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


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped
