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
    assert "Evidence:" in brief
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
