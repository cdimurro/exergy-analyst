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
