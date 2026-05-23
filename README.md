# Exergy Analyst

Exergy Analyst is a practical analysis agent foundation for messy energy and
deep-tech operating data.

The product goal is simple:

> Upload messy energy or engineering data. Get back the hidden operational,
> financial, and thermodynamic insights that normal analytics miss.

The first workflow targets industrial waste heat and district heating because
those datasets often contain enough temperatures, energy quantities, and site
labels to reveal useful-work potential without requiring new lab validation.

## First Use Cases

- Industrial waste-heat screening
- District heating and cooling optimization
- Building retrofit and heat-pump performance review
- Energy project diligence
- Scientific or engineering dataset triage

## Current Prototype

The initial CLI analyzes CSV files with messy field names. It normalizes common
columns, computes thermal Exergy Factor values, ranks opportunity streams, and
emits a concise decision brief.

```bash
PYTHONPATH=src python -m exergy_analyst analyze examples/district_heating_sample.csv \
  --use-case district-heating
```

## Output Philosophy

The user-facing output should be understandable by engineers, project teams,
and business operators:

- top insights
- recommended actions
- estimated value
- confidence level
- what the data cannot prove
- best next measurement

The claim-status and observability machinery stays under the hood unless the
user asks for the technical appendix.

## Development

```bash
python -m pytest
```
