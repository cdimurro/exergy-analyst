"""Download the sparse public client-upload corpus.

The raw files are intentionally gitignored. The manifest is the reproducible
source of truth; run this script when local fixtures are needed.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST = REPO_ROOT / "corpus" / "public_upload_corpus_manifest.json"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    root = REPO_ROOT / manifest["download_root"]
    root.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    for item in manifest["items"]:
        try:
            target = root / item["filename"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if item.get("mode") == "head_lines":
                _download_head_lines(item, target)
            else:
                _download_file(item, target)
            print(f"ok  {item['id']} -> {target.relative_to(REPO_ROOT)}")
        except Exception as exc:  # pragma: no cover - network failure path
            failures.append(f"{item['id']}: {exc}")
            print(f"ERR {item['id']}: {exc}", file=sys.stderr)
    if failures:
        print("\nFailures:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    return 0


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(
        url,
        headers={
            "User-Agent": "exergy-analyst-corpus/0.1 (+https://github.com/cdimurro/exergy-analyst)"
        },
    )


def _download_file(item: dict[str, Any], target: Path) -> None:
    with urllib.request.urlopen(_request(item["url"]), timeout=60) as response:
        target.write_bytes(response.read())


def _download_head_lines(item: dict[str, Any], target: Path) -> None:
    limit = int(item["line_limit"])
    with urllib.request.urlopen(_request(item["url"]), timeout=60) as response:
        with target.open("wb") as handle:
            for index, line in enumerate(response):
                if index >= limit:
                    break
                handle.write(line)


if __name__ == "__main__":
    raise SystemExit(main())
