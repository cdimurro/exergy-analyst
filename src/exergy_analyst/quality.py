"""Quality checks for client-facing memos."""

from __future__ import annotations

import re
from dataclasses import dataclass


REQUIRED_SECTIONS = (
    "## Question Received",
    "## Bottom Line",
    "## Analysis",
    "## Data Reviewed",
    "## What I Would Not Claim Yet",
    "## Recommended Next Actions",
)


@dataclass(frozen=True)
class MemoQualityIssue:
    """One report-quality problem."""

    severity: str
    message: str


@dataclass(frozen=True)
class MemoQualityResult:
    """Quality result for a rendered memo."""

    word_count: int
    issues: tuple[MemoQualityIssue, ...]

    @property
    def passed(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)


def evaluate_memo(text: str, *, min_words: int = 180) -> MemoQualityResult:
    """Evaluate whether a memo meets the product output standard."""

    issues: list[MemoQualityIssue] = []
    words = re.findall(r"\b[\w./%-]+\b", text)
    word_count = len(words)

    for section in REQUIRED_SECTIONS:
        if section not in text:
            issues.append(MemoQualityIssue("error", f"missing required section: {section}"))

    if word_count < min_words:
        issues.append(MemoQualityIssue("error", f"memo is too short: {word_count} words"))

    if not re.search(r"\d", text):
        issues.append(MemoQualityIssue("error", "memo contains no numeric evidence"))

    if "What I Would Not Claim Yet" in text and "Recommended Next Actions" in text:
        limits = text.split("## What I Would Not Claim Yet", 1)[1].split("## Recommended Next Actions", 1)[0]
        if "-" not in limits:
            issues.append(MemoQualityIssue("error", "memo does not list limits or unsupported claims"))

    generic_phrases = (
        "structurally readable",
        "add a domain analyzer",
        "map the csv columns",
    )
    lowered = text.lower()
    for phrase in generic_phrases:
        if phrase in lowered:
            issues.append(MemoQualityIssue("warning", f"generic fallback phrase present: {phrase}"))

    return MemoQualityResult(word_count=word_count, issues=tuple(issues))


def render_quality_result(result: MemoQualityResult) -> str:
    """Render quality result for CLI review."""

    lines = [f"passed: {result.passed}", f"word_count: {result.word_count}"]
    if result.issues:
        lines.append("issues:")
        lines.extend(f"- {issue.severity}: {issue.message}" for issue in result.issues)
    else:
        lines.append("issues: none")
    return "\n".join(lines) + "\n"
