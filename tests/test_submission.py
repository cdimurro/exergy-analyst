from __future__ import annotations

import zipfile
from pathlib import Path

from exergy_analyst.submission import analyze_submission, render_submission_brief


def test_submission_brief_turns_steel_csv_into_client_actions(tmp_path: Path) -> None:
    upload = tmp_path / "steel.csv"
    upload.write_text(
        "\n".join(
            [
                "date,Usage_kWh,Lagging_Current_Power_Factor,Load_Type",
                "01/01/2018 00:15,3.17,73.21,Light_Load",
                "01/01/2018 00:30,90.00,91.00,Maximum_Load",
                "01/01/2018 00:45,80.00,85.00,Maximum_Load",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Can you find anything useful in this plant energy data?", [upload])
    brief = render_submission_brief(result)

    assert "steel site has a clear load-management target" in brief
    assert "## Analysis" in brief
    assert "## What I Would Not Claim Yet" in brief
    assert "kWh per tonne" in brief
    assert "metadata" not in brief.lower()


def test_submission_brief_handles_wind_scada_underperformance(tmp_path: Path) -> None:
    upload = tmp_path / "wind.csv"
    upload.write_text(
        "\n".join(
            [
                "Date/Time,LV ActivePower (kW),Wind Speed (m/s),Theoretical_Power_Curve (KWh),Wind Direction (°)",
                "01 01 2018 00:00,100,9,1200,250",
                "01 01 2018 00:10,0,10,1500,255",
                "01 01 2018 00:20,1500,11,1600,260",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("This turbine seems off. What should we check?", [upload])
    brief = render_submission_brief(result)

    assert "not capturing its theoretical curve" in brief
    assert "curtailment" in brief
    assert "alarm logs" in brief


def test_submission_brief_reads_gas_turbine_csvs_inside_zip(tmp_path: Path) -> None:
    upload = tmp_path / "gas.zip"
    csv_text = "\n".join(
        [
            "AT,AP,AH,AFDP,GTEP,TIT,TAT,TEY,CDP,CO,NOX",
            "5,1010,80,3,20,1060,550,110,10,4.0,70",
            "8,1012,70,4,30,1100,540,160,12,0.5,95",
            "9,1012,70,4,31,1105,540,170,12,0.4,98",
            "4,1010,80,3,19,1058,550,105,10,4.5,68",
        ]
    )
    with zipfile.ZipFile(upload, "w") as archive:
        archive.writestr("gt_2011.csv", csv_text)

    result = analyze_submission("Are emissions telling us anything operationally?", [upload])
    brief = render_submission_brief(result)

    assert "operating-regime analysis" in brief
    assert "CO and NOx move differently" in brief
    assert "permit thresholds" in brief
    assert "high firing" not in brief


def test_submission_brief_analyzes_solar_module_specs(tmp_path: Path) -> None:
    upload = tmp_path / "modules.csv"
    upload.write_text(
        "\n".join(
            [
                "Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c",
                "Units,,,,,,m2",
                "[0],lib,cec,0,,,",
                "Module A,Maker One,Mono-c-Si,0,400,360,2.0",
                "Module B,Maker Two,TOPCon,1,450,410,2.1",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Which solar panels should we care about?", [upload])
    brief = render_submission_brief(result)

    assert "PV module file is useful for screening" in brief
    assert "Power density" in brief
    assert "warranty" in brief


def test_submission_brief_analyzes_battery_aging(tmp_path: Path) -> None:
    upload = tmp_path / "battery.csv"
    upload.write_text(
        "\n".join(
            [
                "Voltage_measured,Current_measured,Temperature_measured,Capacity,id_cycle,Battery",
                "4.0,-2.0,25.0,2.0,1,B0001",
                "3.9,-2.0,26.0,2.0,1,B0001",
                "3.8,-2.0,29.0,1.5,2,B0001",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Is this battery aging data useful?", [upload])
    brief = render_submission_brief(result)

    assert "cell/cycle level" in brief
    assert "Ah" in brief
    assert "pack warranty" in brief


def test_submission_brief_analyzes_wide_cement_emissions(tmp_path: Path) -> None:
    upload = tmp_path / "cement.csv"
    upload.write_text(
        "\n".join(
            [
                "Year,Global," + ",".join(f"Country {index}" for index in range(60)),
                "2020,0," + ",".join("0" for _ in range(60)),
                "2021,240,100,80,60," + ",".join("0" for _ in range(57)),
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Where should we focus cement decarbonization?", [upload])
    brief = render_submission_brief(result)

    assert "Cement process emissions are concentrated" in brief
    assert "do not add Global back into the country sum" in brief
    assert "plant-level clinker ratio" in brief
    assert len(brief.split()) > 150
