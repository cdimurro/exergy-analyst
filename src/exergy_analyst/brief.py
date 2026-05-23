"""Human-readable decision brief rendering."""

from __future__ import annotations

from .models import AnalysisResult


def render_decision_brief(result: AnalysisResult) -> str:
    """Render an analysis result as concise Markdown."""

    lines = [
        f"# Exergy Analyst Brief: {result.use_case.value}",
        "",
        "## Executive Takeaway",
        _executive_takeaway(result),
        "",
        "## Top Insights",
    ]
    for index, insight in enumerate(result.insights, start=1):
        lines.extend([
            f"{index}. **{insight.title}**",
            f"   {insight.detail}",
            f"   Action: {insight.action}",
        ])
    lines.extend(["", "## Recommended Actions"])
    lines.extend(f"- {action}" for action in result.recommended_actions)
    lines.extend(["", "## Confidence"])
    lines.append(f"- Overall: `{result.confidence.value}`")
    lines.extend(["", "## What This Data Cannot Prove"])
    lines.extend(f"- {item}" for item in result.cannot_prove)
    lines.extend(["", "## Best Next Measurements"])
    lines.extend(f"- {item}" for item in result.next_measurements)
    lines.extend(["", "## Summary Metrics"])
    for key, value in result.summary_metrics.items():
        lines.append(f"- {key}: {value}")
    return "\n".join(lines) + "\n"


def _executive_takeaway(result: AnalysisResult) -> str:
    top = result.insights[0] if result.insights else None
    if top is None:
        return "The uploaded data does not yet support a useful decision brief."
    return (
        f"{top.title}. The analysis is `{result.confidence.value}` and should be used "
        "with the limits and next measurements listed below."
    )

