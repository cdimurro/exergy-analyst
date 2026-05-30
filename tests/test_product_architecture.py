from __future__ import annotations

import json
from pathlib import Path

import pytest

from exergy_analyst.agent import create_exergy_agent, inspect_upload, run_workspace_analysis
from exergy_analyst.cli import main
from exergy_analyst.config import load_agent_settings
from exergy_analyst.file_inventory import profile_file


def test_file_inventory_reports_parser_status(tmp_path: Path) -> None:
    upload = tmp_path / "sample.parquet"
    upload.write_bytes(b"PAR1")

    profile = profile_file(upload)

    assert profile.file_type == "parquet"
    assert "pyarrow" in profile.parser_status.lower()


def test_agent_inspect_upload_tool_is_deterministic(tmp_path: Path) -> None:
    upload = tmp_path / "sample.csv"
    upload.write_text("a,b\n1,2\n", encoding="utf-8")

    result = inspect_upload(str(upload))

    assert result["file_type"] == "csv"
    assert "native CSV parser" in result["parser_status"]


def test_agent_settings_default_to_deepseek_flash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXERGY_AGENT_MODEL", raising=False)
    monkeypatch.delenv("DEEPSEEK_BASE_URL", raising=False)

    settings = load_agent_settings()

    assert settings.model == "deepseek-v4-flash"
    assert settings.base_url == "https://api.deepseek.com"


def test_create_agent_fails_cleanly_without_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        create_exergy_agent()


def test_agent_info_cli_describes_product_surface(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["agent-info"]) == 0
    output = capsys.readouterr().out

    assert "model: deepseek-v4-flash" in output
    assert "tools: inspect_upload, analyze_uploads, run_workspace_analysis" in output


def test_structured_workspace_analysis_tool_returns_agent_run(tmp_path: Path) -> None:
    upload = tmp_path / "sample.csv"
    upload.write_text(
        "stream,waste_heat_mwh,exhaust_temp_c,ambient_temp_c\nKiln,10,300,25\n",
        encoding="utf-8",
    )

    result = run_workspace_analysis("Find the first useful insight.", [str(upload)])

    assert result["physics_screens"][0]["family"] == "thermal_exergy"
    assert result["memo_markdown"].startswith("# Client Analysis Memo")


def test_structured_workspace_analysis_screens_power_plant_pdf(tmp_path: Path) -> None:
    upload = tmp_path / "ccgt_deck.pdf"
    upload.write_bytes(b"%PDF-1.7 placeholder")
    upload.with_suffix(upload.suffix + ".mineru.json").write_text(
        json.dumps(
            {
                "parser": "MinerU2.5 Pro",
                "status": "cached",
                "markdown": "\n".join(
                    [
                        "Natural gas combined cycle power plant",
                        "Net plant output 620 MW",
                        "Net heat rate 6,600 Btu/kWh",
                        "Capacity factor 65%",
                        "Gas price $4.25/MMBtu",
                        "Power price $62/MWh",
                    ]
                ),
            }
        ),
        encoding="utf-8",
    )

    result = run_workspace_analysis("Analyze economics and emissions.", [str(upload)])
    screen = result["physics_screens"][0]

    assert screen["family"] == "power_plant_performance"
    assert screen["key_metrics"]["net_capacity_mw"] == 620
    assert screen["key_metrics"]["fuel_cost_per_mwh"] == 28.05
    assert screen["key_metrics"]["annual_generation_gwh"] == 3530.28
