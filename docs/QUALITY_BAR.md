# Analysis Quality Bar

Use this checklist when reviewing generated memos.

## Good Memo

- Opens with a direct answer.
- Uses numbers from uploaded data.
- Names the exact file or field supporting important claims.
- Says what the analysis cannot prove.
- Recommends the cheapest next action that would change the decision.
- Avoids claiming cause when only correlation or screening evidence is present.

## Bad Memo

- Describes the upload without analyzing it.
- Makes a procurement, warranty, compliance, or investment recommendation without
  cost, contract, regulatory, or operating context.
- Treats aggregate rows as independent entities.
- Ignores attached companion files.
- Hides that a parser was unavailable.

## Review Rule

For each memo, ask:

> Would a competent client learn something useful that they could act on this
> week, and would they understand what not to overclaim?

## Automated Gate

Use the CLI quality gate on generated memos:

```bash
PYTHONPATH=src python -m exergy_analyst review-memo outputs/submission_tests/solar_modules_memo.md
```

The gate checks for required memo sections, enough substance, numeric evidence,
and explicit limits. It also warns when generic fallback language appears.
