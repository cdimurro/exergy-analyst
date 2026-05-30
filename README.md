# Exergy Analyst

Exergy Analyst is a practical AI analyst foundation for messy energy,
industrial, and deep-tech operating data.

The product goal is simple:

> Upload messy energy or engineering data. Get back the hidden operational,
> financial, and thermodynamic insights that normal analytics miss.

The production interface is an agent built around Deep Agents and LangGraph,
with `deepseek-v4-flash` as the target model. The deterministic CLI remains the
test harness that proves parser coverage, calculations, claim discipline, and
memo quality before those capabilities are exposed to the agent.

## First Use Cases

- Industrial waste-heat screening
- District heating and cooling optimization
- Building retrofit and heat-pump performance review
- Energy project diligence
- Scientific or engineering dataset triage

## Current Prototype

The repo now has two surfaces:

- `src/exergy_analyst`: deterministic Python analyzers and the agent tool
  foundation.
- `workspace/`: migrated Next.js product shell for upload, project storage,
  chat-style analysis, artifacts, and local run history.

The CLI supports two paths:

- `analyze`: deterministic exergy screening for CSVs with energy and temperature
  fields.
- `submit`: client-style prompt plus one or more uploaded files, returning a
  one-page memo with evidence, limits, and next actions.
- `agent-run`: structured workspace-agent run with stages, tool trace, detected
  use cases, physics screens, memo, limitations, and next actions.

```bash
PYTHONPATH=src python -m exergy_analyst analyze examples/district_heating_sample.csv \
  --use-case district-heating
```

```bash
PYTHONPATH=src python -m exergy_analyst submit \
  --prompt "This turbine looks like it is underperforming. What should we check?" \
  corpus/raw/wind_turbines/wind_turbine_T1_scada.csv
```

```bash
PYTHONPATH=src python -m exergy_analyst agent-run \
  --prompt "Find the useful waste heat insight and next action." \
  examples/industrial_waste_heat_sample.csv
```

The production agent factory is lazy so local development does not require an
API key:

```bash
pip install -e ".[agent]"
export DEEPSEEK_API_KEY=...
export EXERGY_AGENT_MODEL=deepseek-v4-flash
```

Current structured tool surface:

- `inspect_upload`
- `analyze_uploads`
- `run_workspace_analysis`

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

See:

- [Product Goal](docs/PRODUCT.md)
- [Agent Architecture](docs/AGENT_ARCHITECTURE.md)
- [Analysis Quality Bar](docs/QUALITY_BAR.md)

## Development

```bash
python -m pytest
```

Workspace checks:

```bash
cd workspace
npm install
npm run typecheck
npm run build
npm run dev
```
