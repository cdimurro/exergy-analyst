import pytest

from exergy_analyst.analysis import analyze_records
from exergy_analyst.ingest import normalize_records
from exergy_analyst.models import Confidence, UseCase


def test_industrial_waste_heat_ranks_by_exergy_not_energy_quantity():
    records = normalize_records(
        [
            {"stream": "Low-grade wash water", "waste_heat_mwh": 3400, "exhaust_temp_c": 38, "ambient_temp_c": 25},
            {"stream": "Kiln exhaust", "waste_heat_mwh": 1200, "exhaust_temp_c": 310, "ambient_temp_c": 25},
            {"stream": "Dryer stack", "waste_heat_mwh": 850, "exhaust_temp_c": 180, "ambient_temp_c": 25},
        ]
    )

    result = analyze_records(records, UseCase.INDUSTRIAL_WASTE_HEAT)

    assert result.confidence == Confidence.READY_TO_ACT
    assert "Kiln exhaust" in result.insights[0].title
    assert any("Largest MWh stream is not" in insight.title for insight in result.insights)
    assert any("Kiln exhaust" in action for action in result.recommended_actions)


def test_analysis_recommends_missing_measurement_for_sparse_data():
    records = normalize_records([{"stream": "Unknown", "waste_heat_mwh": 10}])

    result = analyze_records(records, UseCase.INDUSTRIAL_WASTE_HEAT)

    assert result.confidence == Confidence.NOT_ENOUGH_EVIDENCE
    assert any("source" in item.lower() for item in result.next_measurements)


def test_negative_energy_excluded_from_weighted_factor_and_flagged():
    records = normalize_records(
        [
            {"stream": "Bad meter", "waste_heat_mwh": -500, "exhaust_temp_c": 300, "ambient_temp_c": 15},
            {"stream": "Good", "waste_heat_mwh": 1000, "exhaust_temp_c": 300, "ambient_temp_c": 15},
        ]
    )

    result = analyze_records(records, UseCase.INDUSTRIAL_WASTE_HEAT)

    # The negative row must not corrupt the delivery-weighted quality factor.
    assert result.summary_metrics["weighted_exergy_factor"] == pytest.approx(0.4973, abs=1e-3)
    assert result.summary_metrics["total_energy_mwh"] == pytest.approx(1000.0)
    assert any("negative or non-physical energy" in item for item in result.cannot_prove)


def test_below_absolute_zero_does_not_crash_and_is_flagged():
    records = normalize_records([{"stream": "Impossible", "waste_heat_mwh": 1000, "exhaust_temp_c": -300, "ambient_temp_c": 15}])

    result = analyze_records(records, UseCase.INDUSTRIAL_WASTE_HEAT)

    assert any("absolute zero" in item for item in result.cannot_prove)


def test_source_below_reference_flags_no_recoverable_work():
    records = normalize_records(
        [
            {"stream": "Chilled return", "waste_heat_mwh": 5000, "exhaust_temp_c": 10, "ambient_temp_c": 25},
            {"stream": "Lukewarm", "waste_heat_mwh": 2000, "exhaust_temp_c": 30, "ambient_temp_c": 25},
        ]
    )

    result = analyze_records(records, UseCase.INDUSTRIAL_WASTE_HEAT)

    assert any("recoverable useful work" in item for item in result.cannot_prove)
