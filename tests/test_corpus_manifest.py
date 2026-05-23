from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = REPO_ROOT / "corpus" / "public_upload_corpus_manifest.json"


def test_public_corpus_manifest_is_well_formed() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert manifest["schema_version"] == 1
    assert manifest["download_root"] == "corpus/raw"
    assert manifest["items"]

    ids = [item["id"] for item in manifest["items"]]
    filenames = [item["filename"] for item in manifest["items"]]

    assert len(ids) == len(set(ids))
    assert len(filenames) == len(set(filenames))

    required = {
        "id",
        "filename",
        "url",
        "mode",
        "application",
        "file_type",
        "why_it_matters",
        "expected_agent_tasks",
        "source_page",
        "license_note",
    }
    allowed_modes = {"download", "head_lines"}

    for item in manifest["items"]:
        assert required <= set(item), item["id"]
        assert item["mode"] in allowed_modes
        assert item["url"].startswith("https://")
        assert item["source_page"].startswith("https://")
        assert ".." not in Path(item["filename"]).parts
        assert len(item["expected_agent_tasks"]) >= 2
        if item["mode"] == "head_lines":
            assert isinstance(item["line_limit"], int)
            assert item["line_limit"] > 1


def test_raw_corpus_files_are_gitignored() -> None:
    gitignore = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "corpus/raw/" in gitignore
