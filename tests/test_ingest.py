from exergy_analyst.ingest import normalize_record


def test_normalize_record_accepts_messy_waste_heat_aliases():
    record = normalize_record(
        {
            "stream": "Kiln exhaust",
            "waste_heat_mwh": "1,200",
            "exhaust_temp_c": "310",
            "ambient_temp_c": "25",
        }
    )

    assert record.label == "Kiln exhaust"
    assert record.energy_mwh == 1200.0
    assert record.source_temp_c == 310.0
    assert record.sink_temp_c == 25.0
    assert record.issues == ()


def test_normalize_record_accepts_operating_context_fields():
    record = normalize_record(
        {
            "stream": "Dryer stack",
            "waste_heat_mwh": 850,
            "exhaust_temp_c": 180,
            "ambient_temp_c": 25,
            "operating_hours": 3900,
            "mass_flow_rate": 12.5,
        }
    )

    assert record.operating_hours == 3900.0
    assert record.flow_rate == 12.5


def test_normalize_record_marks_missing_temperature():
    record = normalize_record({"asset": "Unknown stream", "energy_kwh": "500"})

    assert record.energy_mwh == 0.5
    assert "missing_source_temperature" in record.issues
    assert "missing_sink_or_reference_temperature" in record.issues
