"""Command-line interface for Exergy Analyst."""

from __future__ import annotations

import argparse
from pathlib import Path

from .analysis import analyze_records
from .brief import render_decision_brief
from .ingest import load_csv_records
from .models import UseCase


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="exergy-analyst")
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze an energy CSV and emit a decision brief.")
    analyze.add_argument("csv_path", type=Path)
    analyze.add_argument(
        "--use-case",
        choices=[item.value for item in UseCase],
        default=UseCase.INDUSTRIAL_WASTE_HEAT.value,
    )
    analyze.add_argument("--output", type=Path, help="Optional Markdown output path.")

    args = parser.parse_args(argv)
    if args.command == "analyze":
        records = load_csv_records(args.csv_path)
        result = analyze_records(records, UseCase(args.use_case))
        brief = render_decision_brief(result)
        if args.output:
            args.output.write_text(brief, encoding="utf-8")
        else:
            print(brief, end="")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

