from __future__ import annotations

from exergy_analyst.heat_pump_spec import extract_heat_pump_ratings


def test_heat_pump_parser_ignores_part_number_tables() -> None:
    text = "\n".join(
        [
            "Bosch IDS BOVA 1.0",
            "3 Product Specifications",
            "BOVA1.0 60",
            "Cooling Capacity",
            "Nominal Cooling (BTU/h)",
            "57,000",
            "Nominal Heating (BTU/h)",
            "55,000",
            "5 Model & Part Numbers",
            "Model Number",
            "Part Number",
            "Description",
            "BOVA-60HDN1-M18M",
            "7739832070",
            "60 kBTU/hr (5 ton), Inverter Condensing Unit",
            "BVA-60WN1-M18",
            "7739832074",
            "60 kBTU/hr (5 ton), Air Handler Unit",
            "6 AHRI 210/240 Performance Data",
            "Outdoor Unit Model",
            "Indoor Air Handler Model",
            "Cooling Capacity (BTU/h)",
            "Heating Capacity (BTU/h)",
            "CFM",
            "Total",
            "EER",
            "SEER",
            "Hi",
            "HSPF",
            "Low",
            "BOVA-60HDN1-M18M",
            "BVA-60WN1-M18",
            "57000",
            "11.2",
            "17.5",
            "55000",
            "9.5",
            "40000",
            "1700",
        ]
    )

    ratings = extract_heat_pump_ratings(text)

    assert len(ratings) == 1
    assert ratings[0].outdoor_model == "BOVA-60HDN1-M18M"
    assert ratings[0].indoor_model == "BVA-60WN1-M18"
    assert ratings[0].heating_capacity_btu_h == 55000
    assert ratings[0].hspf == 9.5


def test_heat_pump_parser_accepts_cased_coil_furnace_rows() -> None:
    text = "\n".join(
        [
            "Inverter Ducted Split + Cased Coil + 96% Furnace AHRI 210/240 Performance Data",
            "Outdoor Unit Model",
            "Cased Coil Model",
            "Pairing Furnaces",
            "HP Cooling Capacity (BTU/h)",
            "HP Heating Capacity (BTU/h)",
            "CFM",
            "Total",
            "EER",
            "SEER",
            "Hi",
            "HSPF",
            "Low",
            "BOVA-60HDN1-M18M",
            "BMAC4860DNTF",
            "BGH96M120D5A",
            "53000",
            "10.5",
            "17.5",
            "54000",
            "9.5",
            "38000",
            "1500/1200",
        ]
    )

    ratings = extract_heat_pump_ratings(text)

    assert len(ratings) == 1
    assert ratings[0].indoor_model == "BMAC4860DNTF / BGH96M120D5A"
    assert ratings[0].cfm == 1500
