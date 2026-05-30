"""Command-line interface for Exergy Analyst."""

from __future__ import annotations

import argparse
from pathlib import Path

from .agent_run import run_workspace_agent
from .analysis import analyze_records
from .agent import SYSTEM_PROMPT
from .brief import render_decision_brief
from .config import load_agent_settings
from .ingest import load_csv_records
from .models import UseCase
from .quality import evaluate_memo, render_quality_result
from .submission import analyze_submission, render_submission_brief


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

    submit = subparsers.add_parser("submit", help="Analyze a client-style prompt plus one or more uploaded files.")
    submit.add_argument("--prompt", required=True, help="Vague client question or request.")
    submit.add_argument("files", nargs="+", type=Path, help="Uploaded file paths.")
    submit.add_argument("--output", type=Path, help="Optional Markdown output path.")

    agent_run = subparsers.add_parser("agent-run", help="Run the structured workspace agent pipeline.")
    agent_run.add_argument("--prompt", required=True, help="Client question or request.")
    agent_run.add_argument("files", nargs="*", type=Path, help="Uploaded file paths.")
    agent_run.add_argument("--output", type=Path, help="Optional JSON output path.")

    review_memo = subparsers.add_parser("review-memo", help="Evaluate a generated client memo.")
    review_memo.add_argument("memo_path", type=Path)
    review_memo.add_argument("--min-words", type=int, default=180)

    subparsers.add_parser("agent-info", help="Print production agent configuration and tool surface.")

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
    if args.command == "submit":
        result = analyze_submission(args.prompt, args.files)
        brief = render_submission_brief(result)
        if args.output:
            args.output.write_text(brief, encoding="utf-8")
        else:
            print(brief, end="")
        return 0
    if args.command == "agent-run":
        result = run_workspace_agent(args.prompt, args.files)
        payload = result.to_json() + "\n"
        if args.output:
            args.output.write_text(payload, encoding="utf-8")
        else:
            print(payload, end="")
        return 0
    if args.command == "review-memo":
        result = evaluate_memo(args.memo_path.read_text(encoding="utf-8"), min_words=args.min_words)
        print(render_quality_result(result), end="")
        return 0 if result.passed else 2
    if args.command == "agent-info":
        settings = load_agent_settings()
        print(f"model: {settings.model}")
        print(f"base_url: {settings.base_url}")
        print("tools: inspect_upload, analyze_uploads, run_workspace_analysis")
        print(f"system_prompt_words: {len(SYSTEM_PROMPT.split())}")
        print(f"api_key_env: {settings.api_key_env}")
        print(f"api_key_present: {settings.api_key is not None}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
