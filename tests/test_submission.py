from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest

from exergy_analyst.pdf_extract import extract_pdf_document, mineru_configured, pdf_parser_status
from exergy_analyst.submission import analyze_submission, render_submission_brief


def _write_cached_pdf_text(path: Path, lines: list[str]) -> None:
    path.write_bytes(b"%PDF-1.7 placeholder")
    path.with_suffix(path.suffix + ".mineru.json").write_text(
        json.dumps({"parser": "MinerU2.5 Pro", "status": "cached", "markdown": "\n".join(lines)}),
        encoding="utf-8",
    )


def test_pdf_extract_uses_gemini_vision_cache_when_present(tmp_path: Path) -> None:
    upload = tmp_path / "vision.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".gemini.json").write_text(
        json.dumps({
            "parser": "Gemini Flash vision",
            "status": "extracted",
            "markdown": "SOEC stack table: 1.32 V and 300 mA/cm2.",
        }),
        encoding="utf-8",
    )

    extraction = extract_pdf_document(upload)

    assert extraction.parser == "Gemini Flash vision"
    assert "1.32 V" in extraction.text


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
    assert "## Important Boundaries" in brief
    assert "kWh per tonne" in brief
    assert "metadata" not in brief.lower()


def test_submission_without_files_asks_for_source_evidence() -> None:
    result = analyze_submission("Can you assess this project?", [])
    brief = render_submission_brief(result)

    assert "No source files were provided yet" in brief
    assert "Upload the raw operating data" in brief
    assert "No technical, economic, or environmental claim can be validated" in brief
    assert "bounded analysis workflow" in brief


def test_submission_answers_simple_exergy_question_without_file_blocker() -> None:
    result = analyze_submission("What is exergy?", [])
    brief = render_submission_brief(result)

    assert "Exergy is useful-work potential" in brief
    assert "maximum useful work" in brief
    assert "Upload the raw operating data" not in brief.split("## Bottom Line", 1)[1].split("## Analysis", 1)[0]


def test_submission_computes_prompt_only_exergy_screen() -> None:
    result = analyze_submission("Estimate exergy for 100 MWh of waste heat at 150 C with 25 C ambient.", [])
    brief = render_submission_brief(result)

    assert "thermal exergy calculation" in brief
    assert "Carnot exergy factor is 0.295" in brief
    assert "29.540 MWh_ex" in brief
    assert "does not prove recoverable heat" in brief


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

    assert "PV module file is useful for narrowing options" in brief
    assert "Power density" in brief
    assert "warranty" in brief


def test_submission_simulates_pv_module_datasheet_pdf_without_heat_pump_fallback(tmp_path: Path) -> None:
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
                        "Optimum Operating Voltage (Vmp) V 38.5 38.7 38.9 39.1 39.3",
                        "Optimum Operating Current (Imp) A 9.87 9.95 10.03 10.11 10.18",
                        "Temperature Coefficient (Pmax) -0.37 % / C",
                        "Cell Type Mono-crystalline 144 cells",
                        "Dimensions 2000 x 992 x 35 mm",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission(
        "Simulate the production of this module located at 24.1456 N, 54.5318 E. Provide output in peak power, average daily generation, and exergy factor.",
        [upload],
    )
    brief = render_submission_brief(result)

    assert "CS3W-MS PV module specifications were extracted" in brief
    assert "peak module rating 400 W DC" in brief
    assert "heat-adjusted site peak about 363 W" in brief
    assert "average daily generation about 1.903 kWh" in brief
    assert "solar-radiation exergy factor 0.9312" in brief
    assert "heat-pump" not in brief.lower()
    assert "COP/HSPF" not in brief


def test_submission_analyzes_ccgt_pdf_as_power_plant_screen(tmp_path: Path) -> None:
    upload = tmp_path / "ccgt_investment_deck.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Blue Mesa Energy Center",
                        "Natural gas combined cycle power plant",
                        "Configuration: 2 x F-class gas turbine, HRSG, and one steam turbine.",
                        "Net plant output 620 MW",
                        "Gross output 655 MW",
                        "Net heat rate 6,600 Btu/kWh HHV",
                        "Expected capacity factor 65%",
                        "Base gas price $4.25/MMBtu",
                        "Merchant power price $62/MWh",
                        "NOx emissions 9 ppm",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission(
        "Conduct an environmental and economic analysis for this plant.",
        [upload],
    )
    brief = render_submission_brief(result)

    assert "natural-gas combined-cycle plant performance basis was extracted" in brief
    assert "net capacity 620 MW" in brief
    assert "net heat rate 6600 Btu/kWh" in brief
    assert "annual generation 3530.28 GWh/year" in brief
    assert "fuel cost $28.05/MWh" in brief
    assert "spark spread $33.95/MWh" in brief
    assert "CO2 intensity 0.3502 t/MWh" in brief
    assert "heat-pump" not in brief.lower()


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


def test_submission_brief_analyzes_industrial_waste_heat_shape(tmp_path: Path) -> None:
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

    result = analyze_submission("Where is the useful waste heat?", [upload])
    brief = render_submission_brief(result)

    assert "highest useful-work opportunity" in brief
    assert "MWh_ex" in brief
    assert "heat recovery" in brief
    assert "does not prove project ROI" in brief


def test_submission_brief_analyzes_district_heating_shape(tmp_path: Path) -> None:
    upload = tmp_path / "district.csv"
    upload.write_text(
        "\n".join(
            [
                "timestamp,substation,delivered_kwh,supply_temp_c,return_temp_c,ambient_temp_c",
                "2025-02-20T06:00:00,L4,845,92,48,-8",
                "2025-02-20T06:15:00,L12,620,85,42,-8",
                "2025-02-20T06:30:00,L17,410,98,61,-7",
                "2025-02-20T06:45:00,L22,950,76,40,-7",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Which district heating branch should we inspect?", [upload])
    brief = render_submission_brief(result)

    assert "highest useful-work opportunity" in brief
    assert "return-temperature" in brief
    assert "customer comfort" in brief


def test_submission_brief_analyzes_yaml_exergy_records(tmp_path: Path) -> None:
    upload = tmp_path / "waste_heat_streams.yaml"
    upload.write_text(
        "\n".join(
            [
                "streams:",
                "  - label: Kiln exhaust",
                "    energy_mwh: 1200",
                "    source_temp_c: 260",
                "    sink_temp_c: 25",
                "  - label: Compressor cooling",
                "    energy_mwh: 500",
                "    source_temp_c: 75",
                "    sink_temp_c: 25",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Where is the useful waste heat in this YAML export?", [upload])
    brief = render_submission_brief(result)

    assert "YAML contains an exergy-ready record table" in brief
    assert "highest useful-work opportunity" in brief
    assert "MWh_ex" in brief
    assert "Confirm that YAML numeric fields use the units implied by their names" in brief


def test_submission_brief_guides_unsupported_cad_parser(tmp_path: Path) -> None:
    upload = tmp_path / "layout.dxf"
    upload.write_text("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n", encoding="utf-8")

    result = analyze_submission("Can you inspect this drawing?", [upload])
    brief = render_submission_brief(result)

    assert "requires ezdxf" in brief
    assert "Convert `layout.dxf`" in brief
    assert "parser-ready format" in brief


def test_submission_profiles_unknown_csv_with_actionable_numeric_summary(tmp_path: Path) -> None:
    upload = tmp_path / "operations.csv"
    upload.write_text(
        "\n".join(
            [
                "timestamp,line,energy,cost",
                "2026-01-01T00:00,A,10,200",
                "2026-01-01T01:00,A,22,420",
                "2026-01-01T02:00,B,15,310",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Find anything useful.", [upload])
    brief = render_submission_brief(result)

    assert "first-pass profiling" in brief
    assert "numeric column" in brief
    assert "strongest numeric signal" in brief
    assert "structurally readable" not in brief
    assert "add a domain analyzer" not in brief.lower()


def test_submission_reviews_text_document_instead_of_inventory_only(tmp_path: Path) -> None:
    upload = tmp_path / "site_notes.md"
    upload.write_text(
        "\n".join(
            [
                "# Bakery Heat Recovery Notes",
                "The site has two ovens, one compressor room, and a possible waste heat project.",
                "Operators report 18 hours/day production and a target payback under 3 years.",
                "No measured exhaust temperature or flow rate has been logged yet.",
            ]
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Review these notes and tell me what to do next.", [upload])
    brief = render_submission_brief(result)

    assert "This appears to be a technical document" in brief
    assert "industrial waste heat" in brief
    assert "first-pass analysis" in brief


def test_submission_uses_mineru_pdf_cache_for_heat_pump_exergy(tmp_path: Path) -> None:
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

    result = analyze_submission("Calculate exergy for this heat pump spec sheet.", [upload])
    brief = render_submission_brief(result)

    assert "Heat-pump performance data was extracted from the PDF" in brief
    assert "MinerU2.5 Pro extracted text/tables" in brief
    assert "A heat-pump exergy estimate is now possible" in brief
    assert "useful heat exergy" in brief
    assert "second-law efficiency" in brief
    assert "47F outdoor / 70F indoor" in brief


def test_local_mineru_command_can_be_loaded_from_extra_env_file(tmp_path: Path, monkeypatch) -> None:
    fake_mineru = tmp_path / "fake_mineru.py"
    fake_mineru.write_text(
        "\n".join(
            [
                "from pathlib import Path",
                "import sys",
                "input_path = Path(sys.argv[1])",
                "output_dir = Path(sys.argv[2])",
                "target = output_dir / input_path.stem / 'auto' / 'full.md'",
                "target.parent.mkdir(parents=True, exist_ok=True)",
                "target.write_text('# extracted by fake local mineru\\nUseful table value: 42', encoding='utf-8')",
            ]
        ),
        encoding="utf-8",
    )
    env_file = tmp_path / "breakthrough.env"
    env_file.write_text(f"EXERGY_MINERU_COMMAND={sys.executable} {fake_mineru} {{input}} {{output}}\n", encoding="utf-8")
    monkeypatch.delenv("EXERGY_MINERU_COMMAND", raising=False)
    monkeypatch.delenv("MINERU_COMMAND", raising=False)
    monkeypatch.delenv("EXERGY_DISABLE_MINERU", raising=False)
    monkeypatch.setenv("EXERGY_EXTRA_ENV_FILES", str(env_file))

    assert mineru_configured()
    status = pdf_parser_status()
    assert "local MinerU2.5 Pro" in status
    assert "configured command" in status

    upload = tmp_path / "complex_layout.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    extraction = extract_pdf_document(upload)

    assert extraction.parser == "local MinerU2.5 Pro"
    assert "extracted by fake local mineru" in extraction.text


def test_submission_summarizes_fischer_tropsch_pdf_without_heat_pump_fallback(tmp_path: Path) -> None:
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
                        "Fischer Tropsch (FT) is a process for synthesis of fuels from carbon monoxide and hydrogen.",
                        "OxEon offers a proprietary heat transfer insert for the FT reactor.",
                        "The compact transportable fixed bed FT process has been proven at laboratory scale (~5 GPD).",
                        "Personnel have built a 2 BPD system operated on syngas from a gasifier.",
                        "Typically, the reactor operates at ~300 psi synthesis gas input and about 230 C bed temperature.",
                        "A typical operating alpha is about .84.",
                        "OxEon has produced iron and cobalt catalysts and tested hybrid zeolite cracking catalysts.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Can you tell me what this is?", [upload])
    brief = render_submission_brief(result)

    assert "This is an FT/syngas-to-liquids technology information sheet" in brief
    assert "carbon monoxide and hydrogen" in brief
    assert "5 GPD" in brief
    assert "300 psi" in brief
    assert "230 C" in brief
    assert "catalyst" in brief
    assert "heat-pump" not in brief.lower()
    assert "HSPF" not in brief
    assert "COP/HSPF" not in brief


def test_submission_summarizes_soec_pdf_without_fischer_tropsch_fallback(tmp_path: Path) -> None:
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
                        "The solid oxide electrolysis (SOEC) and high temperature co-electrolysis (HTCE) technologies are based on OxEon's previous experience with solid oxide fuel cells.",
                        "A SOEC uses electricity to generate hydrogen from steam or synthesis gas from steam plus CO2.",
                        "SOEC produces about 28 metric tons of H2 per GWh compared with about 21 metric tons for a low temperature system.",
                        "OxEon has shown resultant synthesis gas from HTCE can be fed to a Fischer Tropsch reactor to make synthetic fuel.",
                        "The largest SOEC unit produced to date was the 18 kWe unit and at full capacity produced about 5000 lph of H2.",
                        "It ran roughly 1000 hours in electrolysis mode and roughly 1000 hours in co-electrolysis mode.",
                        "Each 60 cell stack would generate about twenty-one (21) liters per minute of H2.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Can you please analyze this file for me?", [upload])
    brief = render_submission_brief(result)

    assert "This is an SOEC and high-temperature co-electrolysis information sheet" in brief
    assert "solid oxide electrolysis" in brief
    assert "steam plus CO2" in brief
    assert "28 metric tons" in brief
    assert "18 kWe" in brief
    assert "5000 lph" in brief
    assert "The extract has about" not in brief
    assert "Detected signals" not in brief
    assert "Use this as a content-grounded summary" not in brief
    assert "This is an FT/syngas-to-liquids technology information sheet" not in brief
    assert "liquid hydrocarbons" not in brief
    assert "heat-pump" not in brief.lower()


def test_submission_keeps_soec_summary_when_router_prompt_mentions_performance(tmp_path: Path) -> None:
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
                        "The solid oxide electrolysis (SOEC) and high temperature co-electrolysis (HTCE) technologies are based on OxEon's previous experience with solid oxide fuel cells.",
                        "A SOEC uses electricity to generate hydrogen from steam or synthesis gas from steam plus CO2.",
                        "SOEC produces about 28 metric tons of H2 per GWh compared with about 21 metric tons for a low temperature system.",
                        "OxEon has shown resultant synthesis gas from HTCE can be fed to a Fischer Tropsch reactor to make synthetic fuel.",
                        "The largest SOEC unit produced to date was the 18 kWe unit and at full capacity produced about 5000 lph of H2.",
                        "It ran roughly 1000 hours in electrolysis mode and roughly 1000 hours in co-electrolysis mode.",
                        "Each 60 cell stack would generate about twenty-one (21) liters per minute of H2.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    prompt = "\n\n".join(
        [
            "What are the key specifications, performance metrics, and technical claims in this SOEC info sheet?",
            "Analyze the uploaded SOEC info sheet PDF to extract key parameters, claims, and technical details.",
            "Project: UI SOEC PDF language smoke",
            "Project description: Browser QA for domain-specific PDF summary language.",
            "Goal: Return a natural SOEC summary without extraction metadata.",
            "Uploaded files: oxeon SOEC info sheet rev2.pdf",
        ]
    )
    result = analyze_submission(prompt, [upload])
    brief = render_submission_brief(result)

    assert "This is an SOEC and high-temperature co-electrolysis information sheet" in brief
    assert "steam electrolysis uses electricity" in brief
    assert "co-electrolysis of steam and CO2" in brief
    assert "28 metric tons" in brief
    assert "18 kWe" in brief
    assert "5000 lph" in brief
    assert "The extract has about" not in brief
    assert "Detected signals" not in brief
    assert "This appears to be a technical document" not in brief
    assert "This is an FT/syngas-to-liquids technology information sheet" not in brief


def test_submission_exergy_negation_does_not_trigger_heat_pump_or_power_plant(tmp_path: Path) -> None:
    ft = tmp_path / "ft.pdf"
    _write_cached_pdf_text(
        ft,
        [
            "Fischer Tropsch Technology",
            "The FT reactor converts carbon monoxide and hydrogen into liquid hydrocarbons.",
            "The unit reports 5 GPD lab production, 2 BPD prior system, 300 psi synthesis gas pressure, and 230 C bed temperature.",
            "The process includes syngas recycle, catalyst selection, product separation, and FT heat removal.",
        ],
    )
    soec = tmp_path / "soec.pdf"
    _write_cached_pdf_text(
        soec,
        [
            "SOEC and high temperature co-electrolysis technology",
            "Electricity plus steam produces hydrogen; electricity plus steam and CO2 produces synthesis gas.",
            "The HTCE operating point is about 1.32 V and 300 mA/cm2.",
            "The system is intended to feed synthesis gas to Fischer Tropsch synthesis.",
        ],
    )

    result = analyze_submission(
        "Can you perform an exergy analysis? This technology is SOEC/HTCE plus Fischer-Tropsch synthetic fuels, not heat pumps and not natural gas power plant.",
        [ft, soec],
    )
    brief = render_submission_brief(result)

    assert "integrated SOEC/HTCE plus Fischer-Tropsch system" in brief
    assert "A useful exergy analysis can be started" in brief
    assert "cell overpotential" in brief
    assert "FT reaction heat rejection" in brief
    assert "heat-pump rating table" not in brief
    assert "COP/HSPF" not in brief
    assert "fuel natural gas" not in brief
    assert "net capacity 1 MW" not in brief


def test_submission_generically_summarizes_unknown_technical_pdf(tmp_path: Path) -> None:
    upload = tmp_path / "membrane DAC pilot overview.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Membrane Direct Air Capture Pilot Overview",
                        "The pilot captures CO2 from ambient air using a supported amine membrane contactor.",
                        "The system includes air handling, membrane modules, low-temperature regeneration, water management, and CO2 compression.",
                        "The current skid is designed for 1 tonne CO2 per day with regeneration heat near 85 C and fan power below 75 kW.",
                        "The document mentions that captured CO2 could later be combined with green hydrogen for Fischer Tropsch fuels, but that pathway is outside the pilot boundary.",
                        "Open items include sorbent lifetime, pressure drop, humidity sensitivity, and validated energy consumption.",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Can you analyze this PDF and explain what you find?", [upload])
    brief = render_submission_brief(result)

    assert "This appears to be a technical document about carbon capture/DAC" in brief
    assert "captures CO2 from ambient air" in brief
    assert "1 tonne CO2 per day" in brief
    assert "85 C" in brief
    assert "75 kW" in brief
    assert "The extract has about" not in brief
    assert "Detected signals" not in brief
    assert "Use this as a content-grounded summary" not in brief
    assert "This is an FT/syngas-to-liquids technology information sheet" not in brief


def test_submission_ignores_incidental_fischer_tropsch_reference_in_electrolyzer_pdf(tmp_path: Path) -> None:
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

    result = analyze_submission("What is this document about?", [upload])
    brief = render_submission_brief(result)

    assert "hydrogen/electrolyzer" in brief
    assert "green hydrogen from water" in brief
    assert "30 bar" in brief
    assert "5 MW" in brief
    assert "This is an FT/syngas-to-liquids technology information sheet" not in brief
    assert "liquid hydrocarbons and waxes" not in brief


def test_submission_answers_requested_analysis_for_unknown_project_deck(tmp_path: Path) -> None:
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

    result = analyze_submission("Conduct an environmental and economic analysis of this project deck.", [upload])
    brief = render_submission_brief(result)

    assert "Requested economic and environmental analysis can start from the extracted evidence" in brief
    assert "Economic:" in brief
    assert "64 million USD" in brief
    assert "Environmental:" in brief
    assert "avoided freshwater withdrawal" in brief
    assert "bounded by the available evidence" in brief
    assert "parameter/evidence table" in brief
    assert "Ask a concrete follow-up" not in brief


@pytest.mark.parametrize(
    ("filename", "lines", "expected_identity", "expected_values", "expected_next_step"),
    [
        (
            "enhanced geothermal project deck.pdf",
            [
                "Enhanced Geothermal System Project Deck",
                "The project drills paired production and injection wells into a 185 C reservoir at 4,200 m depth.",
                "The binary cycle is sized for 35 MW net output with brine flow rate of 240 kg/s.",
                "The base case assumes 92% capacity factor and 180 million USD installed cost.",
                "Main risks are drilling cost overrun, reservoir decline, induced seismicity, and interconnection timing.",
            ],
            "geothermal",
            ("185 C", "35 MW", "240 kg/s", "180 million USD"),
            "For geothermal projects",
        ),
        (
            "direct lithium extraction brine project.pdf",
            [
                "Direct Lithium Extraction Brine Project",
                "The resource is a lithium brine with 220 mg/L lithium and elevated magnesium.",
                "The pilot handles 15,000 m3/day brine and reports 82% lithium recovery to eluate.",
                "The deck assumes 310 million USD CAPEX and reagent cost of USD 1,200/t LCE.",
                "Environmental issues include reinjection pressure, freshwater demand, and spent sorbent disposal.",
            ],
            "mining/critical minerals",
            ("220 mg/L", "15,000 m3/day", "82%", "310 million USD"),
            "For mining or critical-minerals projects",
        ),
        (
            "ai data center heat reuse proposal.pdf",
            [
                "AI Data Center Heat Reuse Proposal",
                "The campus has 96 MW IT load, PUE 1.22, and rack density of 80 kW/rack.",
                "Annual water consumption is 420,000 m3/year after adiabatic cooling retrofit.",
                "The project can export 110 GWh/year of low-temperature waste heat at 45 C to a nearby district heating loop.",
                "Open risks include utility interconnection, backup generation emissions, and heat-offtake availability.",
            ],
            "data center/compute infrastructure",
            ("96 MW", "80 kW/rack", "420,000 m3/year", "110 GWh/year"),
            "For data centers",
        ),
        (
            "green ammonia concept note.pdf",
            [
                "Green Ammonia Plant Concept Note",
                "The process combines a 120 MW electrolyzer with an ammonia plant and Haber Bosch loop.",
                "Nominal production is 220,000 tonnes/year NH3 at 9.8 MWh/t NH3 specific power.",
                "The project uses desalinated water, nitrogen separation, compression, and refrigerated storage.",
                "CAPEX is estimated at 690 million USD before grid upgrades and port infrastructure.",
            ],
            "chemical/process plant",
            ("120 MW", "220,000 tonnes/year", "9.8 MWh/t", "690 million USD"),
            "For process plants",
        ),
        (
            "saf hydrotreating project.pdf",
            [
                "Sustainable Aviation Fuel HEFA Project",
                "The plant converts used cooking oil and tallow into SAF and renewable diesel.",
                "Nameplate capacity is 45 million gallons/year with hydrogen consumption of 0.035 kg/kg feed.",
                "The claimed carbon intensity is 28 gCO2e/MJ before airline logistics.",
                "CAPEX is 420 million USD and feedstock availability is the main supply-chain constraint.",
            ],
            "biofuels/SAF",
            ("45 million gallons/year", "0.035 kg/kg", "28 gCO2e/MJ", "420 million USD"),
            "For fuel projects",
        ),
    ],
)
def test_submission_covers_broad_project_deck_domains(
    tmp_path: Path,
    filename: str,
    lines: list[str],
    expected_identity: str,
    expected_values: tuple[str, ...],
    expected_next_step: str,
) -> None:
    upload = tmp_path / filename
    _write_cached_pdf_text(upload, lines)

    result = analyze_submission(
        "Please analyze this deck and give me the technical, economic, environmental, and risk readout.",
        [upload],
    )
    brief = render_submission_brief(result)

    assert expected_identity in brief
    for value in expected_values:
        assert value in brief
    assert "The extracted numbers can be organized into a first parameter table" in brief
    assert expected_next_step in brief
    assert "inventoried, but not yet deeply analyzed" not in brief
    assert "Use as a triage note" not in brief


def test_submission_brief_reviews_platform_export_package(tmp_path: Path) -> None:
    upload = tmp_path / "district_heating_sample_export.json"
    upload.write_text(
        json.dumps(
            {
                "exported_at": "2026-05-23T16:32:15.447Z",
                "project": {"name": "district heating sample", "domain": "district_energy"},
                "artifacts": [
                    {
                        "type": "evaluation",
                        "title": "Exergy Analyst Assessment",
                        "summary": (
                            "L4 is the highest useful-work opportunity. Check this branch for "
                            "avoidable supply-temperature overshoot or return-temperature problems."
                        ),
                        "content": {
                            "executive_summary": (
                                "L4 is the highest useful-work opportunity. Check this branch for "
                                "avoidable supply-temperature overshoot or return-temperature problems."
                            ),
                            "limitations": [
                                "This analysis does not prove project ROI without installed-cost, operating-hours, and integration constraints.",
                                "The current pass does not prove customer comfort or hydraulic feasibility.",
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
                            "structured_insights": [
                                {
                                    "title": "L4 is the highest useful-work opportunity",
                                    "evidence": "It contributes 0.23 MWh_ex with f_X=0.274.",
                                },
                                {
                                    "title": "Largest MWh stream is not the strongest opportunity",
                                    "evidence": "L22 has the largest energy quantity, but L4 has higher useful-work value.",
                                },
                            ],
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = analyze_submission("Review this exported analysis package.", [upload])
    brief = render_submission_brief(result)

    assert "L4 is the strongest actionable signal" in brief
    assert "top stream L4" in brief
    assert "accessible exergy 0.734 MWh_ex" in brief
    assert "ROI" in brief
    assert "flow rate, pump power, valve position" in brief
    assert "customer comfort" in brief
    assert "prior analysis package" in brief
