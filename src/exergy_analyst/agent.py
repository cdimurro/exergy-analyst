"""DeepAgents/LangGraph product interface.

The deterministic CLI remains the test harness. This module is the production
agent entrypoint and imports optional agent dependencies only when needed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import AgentSettings, load_agent_settings
from .file_inventory import profile_file
from .agent_run import run_workspace_agent
from .submission import analyze_submission, render_submission_brief


SYSTEM_PROMPT = """You are Exergy Analyst, a rigorous energy and deep-tech analysis agent.

Your job is to turn messy uploaded files into useful client memos. Use tools to
inspect files, run deterministic analyzers, and preserve claim discipline.

Rules:
- Answer the client question directly.
- Use computed values from uploaded files whenever possible.
- Run structured physics/data screens when an uploaded file matches a supported domain.
- State what the data cannot prove.
- Never make procurement, warranty, compliance, medical, or investment claims
  without the required supporting context.
- Prefer a useful one-page memo over a metadata inventory.
"""


def inspect_upload(path: str) -> dict[str, Any]:
    """Tool: profile one uploaded file and parser readiness."""

    profile = profile_file(Path(path))
    return {
        "path": str(profile.path),
        "file_type": profile.file_type,
        "size_bytes": profile.size_bytes,
        "parser_status": profile.parser_status,
        "summary": profile.summary,
    }


def analyze_uploads(prompt: str, files: list[str]) -> str:
    """Tool: run deterministic analyzers and return a client memo."""

    result = analyze_submission(prompt, [Path(file) for file in files])
    return render_submission_brief(result)


def run_workspace_analysis(prompt: str, files: list[str]) -> dict[str, Any]:
    """Tool: run the full structured workspace-agent pipeline."""

    result = run_workspace_agent(prompt, [Path(file) for file in files])
    return result.to_dict()


def create_exergy_agent(settings: AgentSettings | None = None) -> Any:
    """Create the production Deep Agent.

    This requires optional dependencies and `DEEPSEEK_API_KEY`. The function is
    intentionally lazy so local tests do not require an LLM provider.
    """

    settings = settings or load_agent_settings()
    if not settings.api_key:
        raise RuntimeError(f"{settings.api_key_env} is required to create the production agent")

    try:
        from deepagents import create_deep_agent
        from langchain_openai import ChatOpenAI
    except ImportError as exc:  # pragma: no cover - optional dependency path
        raise RuntimeError(
            "Install the agent extra first: `pip install -e .[agent]`"
        ) from exc

    model = ChatOpenAI(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.base_url,
        temperature=settings.temperature,
    )
    return create_deep_agent(
        model=model,
        tools=[inspect_upload, analyze_uploads, run_workspace_analysis],
        system_prompt=SYSTEM_PROMPT,
    )
