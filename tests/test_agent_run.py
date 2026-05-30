from __future__ import annotations

import json
import zipfile
from pathlib import Path

from exergy_analyst.agent_run import run_workspace_agent
from exergy_analyst.cli import main


def test_workspace_agent_returns_structured_physics_run(tmp_path: Path) -> None:
    upload = tmp_path / "waste_heat.csv"
    upload.write_text(
        "\n".join(
            [
                "stream,waste_heat_mwh,exhaust_temp_c,ambient_temp_c,operating_hours",
                "Kiln exhaust,1200,310,25,4100",
                "Compressor cooling loop,2600,48,25,6200",
                "Dryer stack,850,180,25,3900",
                "Low-grade wash water,3400,38,25,5000",
            ]
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Where is the useful waste heat?", [upload])

    assert run.confidence in {"screening_grade", "useful_but_bounded"}
    assert "industrial-waste-heat" in run.detected_use_cases
    assert run.physics_screens[0].family == "thermal_exergy"
    assert run.physics_screens[0].key_metrics["top_stream"] == "Kiln exhaust"
    assert "MWh_ex" in run.memo_markdown
    assert any(stage.name == "Review" for stage in run.stages)


def test_workspace_agent_answers_simple_no_file_question() -> None:
    run = run_workspace_agent("What is exergy?", [])

    assert run.confidence == "advisory"
    assert "thermal-exergy" in run.detected_use_cases
    assert "Exergy is useful-work potential" in run.memo_markdown
    assert "No source files were provided yet" not in run.executive_answer


def test_workspace_agent_computes_no_file_exergy_when_numbers_are_present() -> None:
    run = run_workspace_agent("Estimate exergy for 100 MWh heat at 150 C and 25 C ambient.", [])

    assert run.confidence == "advisory"
    assert "thermal-exergy" in run.detected_use_cases
    assert "29.540 MWh_ex" in run.memo_markdown
    assert "does not prove recoverable heat" in run.memo_markdown


def test_agent_run_cli_outputs_json(tmp_path: Path, capsys) -> None:
    upload = tmp_path / "district.csv"
    upload.write_text(
        "\n".join(
            [
                "timestamp,substation,delivered_kwh,supply_temp_c,return_temp_c,ambient_temp_c",
                "2025-02-20T06:00:00,L4,845,92,48,-8",
                "2025-02-20T06:15:00,L12,620,85,42,-8",
            ]
        ),
        encoding="utf-8",
    )

    assert main(["agent-run", "--prompt", "Which branch matters?", str(upload)]) == 0
    payload = json.loads(capsys.readouterr().out)

    assert payload["detected_use_cases"]
    assert payload["physics_screens"][0]["family"] == "thermal_exergy"
    assert payload["memo_markdown"].startswith("# Client Analysis Memo")


def test_workspace_agent_screens_wind_scada(tmp_path: Path) -> None:
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

    run = run_workspace_agent("This turbine seems off.", [upload])

    assert "wind-turbine-scada" in run.detected_use_cases
    assert run.physics_screens[0].family == "wind_power_curve"
    assert run.physics_screens[0].key_metrics["capture_ratio"] is not None


def test_workspace_agent_screens_pv_modules(tmp_path: Path) -> None:
    upload = tmp_path / "modules.csv"
    upload.write_text(
        "\n".join(
            [
                "Name,Manufacturer,Technology,Bifacial,STC,PTC,A_c",
                "Module A,Maker One,Mono-c-Si,0,400,360,2.0",
                "Module B,Maker Two,TOPCon,1,450,410,2.1",
            ]
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Which modules should we shortlist?", [upload])

    assert "solar-pv-module-analysis" in run.detected_use_cases
    assert run.physics_screens[0].family == "pv_module"
    assert run.physics_screens[0].key_metrics["median_w_per_m2"] is not None


def test_workspace_agent_simulates_pv_module_pdf_production(tmp_path: Path) -> None:
    upload = tmp_path / "Canadian_Solar-Datasheet-HiKu_CS3W-MS_EN.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Canadian Solar HiKu CS3W-MS",
                        "Nominal Max. Power (Pmax) W 380 385 390 395 400",
                        "Module Efficiency % 19.16 19.41 19.66 19.91 20.16",
                        "Open Circuit Voltage (Voc) V 46.4 46.6 46.8 47.0 47.2",
                        "Short Circuit Current (Isc) A 10.88 10.91 10.94 10.97 11.00",
                        "Temperature Coefficient (Pmax) -0.37 % / C",
                        "Cell Type Mono-crystalline 144 cells",
                        "Dimensions 2000 x 992 x 35 mm",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent(
        "Simulate the production of this module located at 24.1456 N, 54.5318 E. Provide output in peak power, average daily generation, and exergy factor.",
        [upload],
    )

    assert "solar-pv" in run.detected_use_cases
    assert run.physics_screens[0].family == "pv_module_site_production"
    assert run.physics_screens[0].key_metrics["peak_power_stc_w"] == 400
    assert run.physics_screens[0].key_metrics["site_peak_power_w"] == 363
    assert run.physics_screens[0].key_metrics["average_daily_generation_kwh"] == 1.903
    assert run.physics_screens[0].key_metrics["solar_exergy_factor"] == 0.9312
    assert "COP/HSPF" not in run.memo_markdown


def test_workspace_agent_reviews_prior_export_json(tmp_path: Path) -> None:
    upload = tmp_path / "export.json"
    upload.write_text(
        json.dumps(
            {
                "project": {"name": "district heating sample", "domain": "district_energy"},
                "artifacts": [
                    {
                        "type": "evaluation",
                        "title": "Exergy Analyst Assessment",
                        "summary": "L4 is the highest useful-work opportunity.",
                        "content": {
                            "limitations": [
                                "This analysis does not prove project ROI without installed-cost, operating-hours, and integration constraints.",
                            ],
                            "physics_screens": [
                                {
                                    "title": "Thermal useful-work screen",
                                    "family": "thermal_exergy",
                                    "status": "computed",
                                    "confidence": "ready_to_act",
                                    "key_metrics": {
                                        "top_stream": "L4",
                                        "total_energy_mwh": 2.825,
                                        "accessible_exergy_mwh": 0.734,
                                        "weighted_exergy_factor": 0.2599,
                                    },
                                    "recommendation": "Start detailed review with: L4, L22, L12.",
                                }
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Audit this exported package.", [upload])

    assert "district-heating" in run.detected_use_cases
    assert "thermal-exergy" in run.detected_use_cases
    assert "platform-export-review" in run.detected_use_cases
    assert run.physics_screens[0].family == "thermal_exergy"
    assert run.physics_screens[0].key_metrics["top_stream"] == "L4"
    assert "flow rate, pump power, valve position" in run.memo_markdown


def test_workspace_agent_extracts_heat_pump_pdf_with_mineru_cache(tmp_path: Path) -> None:
    upload = tmp_path / "bosch_heat_pump.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Bosch BOVA 1.0 Split System Heat Pump",
                        "AHRI 210/240 Performance Data",
                        "Outdoor Unit Model",
                        "Indoor Air Handler Model",
                        "Cooling Capacity (BTU/h)",
                        "Heating Capacity (BTU/h)",
                        "EER SEER HSPF",
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
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Calculate exergy for this heat pump spec sheet.", [upload])

    assert "heat-pump-hvac" in run.detected_use_cases
    assert "thermal-exergy" in run.detected_use_cases
    assert "MinerU2.5 Pro" in run.files[0].parser_status
    assert run.physics_screens[0].family == "heat_pump_exergy"
    assert run.physics_screens[0].key_metrics["second_law_efficiency_pct"] is not None
    assert "heat-pump exergy estimate" in run.memo_markdown


def test_workspace_agent_summarizes_fischer_tropsch_pdf(tmp_path: Path) -> None:
    upload = tmp_path / "Fischer Tropsch information sheet.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Information Sheet",
                        "Fischer Tropsch Technology",
                        "Fischer Tropsch synthesis converts carbon monoxide and hydrogen or syngas into liquid hydrocarbons.",
                        "The compact transportable fixed bed FT process has been proven at laboratory scale (~5 GPD).",
                        "A 2 BPD system operated on syngas from a gasifier.",
                        "Typical operation is ~300 psi synthesis gas input and about 230 C bed temperature.",
                        "A typical operating alpha is about .84 with iron, cobalt, and hybrid catalysts.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Can you tell me what this is?", [upload])

    assert "syngas-to-liquids" in run.detected_use_cases
    assert "synthetic-fuels" in run.detected_use_cases
    assert "This is an FT/syngas-to-liquids technology information sheet" in run.memo_markdown
    assert "carbon monoxide and hydrogen" in run.memo_markdown
    assert "heat-pump" not in run.memo_markdown.lower()
    assert not run.physics_screens


def test_workspace_agent_summarizes_soec_pdf_without_fischer_tropsch_fallback(tmp_path: Path) -> None:
    upload = tmp_path / "oxeon SOEC info sheet rev2.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "High temperature electrolysis / co-electrolysis",
                        "SOEC and HTCE technology",
                        "Solid oxide electrolysis (SOEC) and high temperature co-electrolysis (HTCE) use electricity to generate hydrogen from steam or synthesis gas from steam plus CO2.",
                        "SOEC produces about 28 metric tons of H2 per GWh compared with about 21 metric tons for a low temperature system.",
                        "OxEon has shown resultant synthesis gas from HTCE can be fed to a Fischer Tropsch reactor to make synthetic fuel.",
                        "The largest SOEC unit produced to date was the 18 kWe unit and at full capacity produced about 5000 lph of H2.",
                        "It ran roughly 1000 hours in electrolysis mode and roughly 1000 hours in co-electrolysis mode.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Can you please analyze this file for me?", [upload])

    assert "solid-oxide-electrolysis" in run.detected_use_cases
    assert "electrolysis" in run.detected_use_cases
    assert "syngas-to-liquids" not in run.detected_use_cases
    assert "This is an SOEC and high-temperature co-electrolysis information sheet" in run.memo_markdown
    assert "28 metric tons" in run.memo_markdown
    assert "The extract has about" not in run.memo_markdown
    assert "Detected signals" not in run.memo_markdown
    assert "Use this as a content-grounded summary" not in run.memo_markdown
    assert "This is an FT/syngas-to-liquids technology information sheet" not in run.memo_markdown
    assert "liquid hydrocarbons" not in run.memo_markdown
    assert not run.physics_screens


def test_workspace_agent_uses_generic_pdf_identity_without_ft_false_positive(tmp_path: Path) -> None:
    upload = tmp_path / "alkaline electrolyzer datasheet.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Alkaline Electrolyzer Product Datasheet",
                        "The electrolyzer produces green hydrogen from water using renewable electricity.",
                        "The stack operates at 30 bar and 80 C with rated power of 5 MW.",
                        "Hydrogen can serve refineries, ammonia synthesis, storage, or Fischer Tropsch fuel projects.",
                        "The datasheet lists balance-of-plant power, water treatment, oxygen venting, and maintenance intervals.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("What is this document about?", [upload])

    assert "electrolysis" in run.detected_use_cases
    assert "hydrogen" in run.detected_use_cases
    assert "syngas-to-liquids" not in run.detected_use_cases
    assert "hydrogen/electrolyzer" in run.memo_markdown
    assert "5 MW" in run.memo_markdown
    assert "This is an FT/syngas-to-liquids technology information sheet" not in run.memo_markdown


def test_workspace_agent_answers_requested_analysis_for_unknown_project_deck(tmp_path: Path) -> None:
    upload = tmp_path / "ceramic membrane water reuse project deck.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Ceramic Membrane Water Reuse Project Deck",
                        "The project treats industrial rinse water using ceramic membrane filtration and low-temperature cleaning cycles.",
                        "The deck claims 8,000 m3/day treatment capacity, 82% water recovery, 0.42 kWh/m3 electrical intensity, and 15 year membrane life.",
                        "Commercial assumptions include 64 million USD installed cost, 5.5 million USD annual operating cost, and a 14 year service agreement.",
                        "Environmental claims include avoided freshwater withdrawal, concentrated brine disposal, chemical cleaning waste, and reduced trucked wastewater.",
                        "Open risks include membrane fouling, brine permit approval, cleaning chemical consumption, feed variability, and replacement-part lead times.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("Conduct an environmental and economic analysis of this project deck.", [upload])

    assert run.confidence == "screening_grade"
    assert "Requested economic and environmental analysis can start from the extracted evidence" in run.memo_markdown
    assert "64 million USD" in run.memo_markdown
    assert "avoided freshwater withdrawal" in run.memo_markdown
    assert "bounded by the available evidence" in run.memo_markdown
    assert "Ask a concrete follow-up" not in run.memo_markdown


def test_workspace_agent_runs_recovery_loop_for_parser_limited_upload(tmp_path: Path) -> None:
    upload = tmp_path / "unusual equipment package.bin"
    upload.write_bytes(b"\x00\x01not a supported parser format")

    run = run_workspace_agent("Can you analyze this file and give me a useful plain-English answer?", [upload])

    assert any(call.tool == "plan_tool_loop" for call in run.tool_calls)
    assert any(call.tool == "recover_from_partial_analysis" for call in run.tool_calls)
    assert any(stage.name == "Recovery" for stage in run.stages)
    assert "The request can still be advanced despite the parser limit" in run.memo_markdown
    assert "parser-ready export" in run.memo_markdown
    assert "This recovery step is advisory" in run.memo_markdown


def test_workspace_agent_recovers_use_case_from_client_summary_only_export(tmp_path: Path) -> None:
    upload = tmp_path / "district_heating_summary_export.json"
    upload.write_text(
        json.dumps(
            {
                "project": {"name": "district heating sample", "domain": "district_energy"},
                "artifacts": [
                    {
                        "type": "evaluation",
                        "title": "Exergy Analyst Assessment",
                        "summary": "L4 is the highest useful-work opportunity.",
                        "content": {
                            "client_summary": {
                                "confidence": "screening_grade",
                                "conclusion": "L4 is the highest useful-work opportunity.",
                                "use_case_label": "District Heating, Thermal Exergy",
                                "computed_metrics": [
                                    {"label": "First Place To Inspect", "value": "L4"},
                                    {"label": "Accessible Exergy", "value": "0.734 MWh_ex"},
                                    {"label": "Total Energy", "value": "2.825 MWh"},
                                    {"label": "Quality Factor", "value": "0.260"},
                                ],
                                "supported_claims": [
                                    {
                                        "claim": "L4 is the highest useful-work opportunity",
                                        "evidence": "It contributes 0.23 MWh_ex.",
                                    }
                                ],
                                "not_proven": ["This analysis does not prove project ROI."],
                                "data_requests": [
                                    {
                                        "request": "Collect branch-level flow rate, pump power, valve position, and supply/return temperature time series for L4.",
                                        "why_it_matters": "Shows whether the signal is controllable.",
                                    }
                                ],
                            },
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    run = run_workspace_agent("What should I do with this file?", [upload])

    assert "district-heating" in run.detected_use_cases
    assert run.physics_screens[0].family == "thermal_exergy"
    assert run.physics_screens[0].key_metrics["top_stream"] == "L4"
    assert "L4 is the strongest actionable signal" in run.memo_markdown
    assert "flow rate, pump power, valve position" in run.memo_markdown


def test_workspace_agent_labels_supported_archive_analysis_as_screening_grade(tmp_path: Path) -> None:
    upload = tmp_path / "gas_turbine.zip"
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
        archive.writestr("gt.csv", csv_text)

    run = run_workspace_agent("Assess gas turbine emissions.", [upload])

    assert run.confidence == "screening_grade"
    assert "gas-turbine-emissions" in run.detected_use_cases
    assert "operating-regime analysis" in run.memo_markdown
