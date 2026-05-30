from __future__ import annotations

from exergy_analyst.quality import evaluate_memo


GOOD_MEMO = """# Client Analysis Memo

## Question Received
Can this file support a useful decision?

## Bottom Line
Yes. The upload contains a signal worth acting on, but only as an initial result.

## Analysis
1. **Useful signal**
   The file has 250 rows and the dominant category contributes 63% of the measured total. This supports a first-pass ranking, not a final investment decision.

## Data Reviewed
- `upload.csv` (csv, 12 KB): CSV with useful operating fields.

## Important Boundaries
- This does not prove ROI, compliance, warranty status, or equipment failure.

## Recommended Next Actions
- Add cost and operating context before making the decision.
- Re-run the analysis after the missing measurement is added.
"""


def test_quality_accepts_substantive_memo() -> None:
    result = evaluate_memo(GOOD_MEMO, min_words=70)

    assert result.passed
    assert result.word_count >= 70


def test_quality_rejects_short_metadata_only_output() -> None:
    result = evaluate_memo("This CSV is structurally readable.", min_words=70)

    assert not result.passed
    assert any("missing required section" in issue.message for issue in result.issues)
    assert any("memo is too short" in issue.message for issue in result.issues)
