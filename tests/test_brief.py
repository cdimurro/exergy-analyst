from exergy_analyst.analysis import analyze_records
from exergy_analyst.brief import render_decision_brief
from exergy_analyst.ingest import normalize_records
from exergy_analyst.models import UseCase


def test_brief_contains_human_sections():
    records = normalize_records(
        [{"substation": "L4", "delivered_kwh": 845, "supply_temp_c": 92, "ambient_temp_c": -8}]
    )
    result = analyze_records(records, UseCase.DISTRICT_HEATING)
    brief = render_decision_brief(result)

    assert "Executive Takeaway" in brief
    assert "What This Data Cannot Prove" in brief
    assert "Best Next Measurements" in brief

