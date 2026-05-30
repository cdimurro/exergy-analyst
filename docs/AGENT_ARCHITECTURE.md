# Agent Architecture

The production agent is organized around a small set of durable capabilities.

## Runtime

Deep Agents provides the agent harness and is built on LangGraph. The agent
factory in `exergy_analyst.agent` is intentionally lazy: core tests and local
deterministic analysis do not require Deep Agents, LangGraph, or an API key.

Environment defaults:

- `EXERGY_AGENT_MODEL=deepseek-v4-flash`
- `DEEPSEEK_API_KEY=<secret>`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`

## Tool Families

Initial tools exposed to the agent:

- upload inventory and parser readiness
- client-style submission analysis
- structured workspace analysis with stages, tool trace, physics screens,
  detected use cases, confidence, and limitations
- deterministic domain analyzers
- corpus manifest lookup
- report rendering

## Current Structured Run

The deterministic `agent-run` pipeline is the production UI contract until the
LLM-controlled agent is enabled. It returns:

- intake and parser-selection stages
- tool calls
- file profiles
- detected use cases
- physics/data screens for industrial waste heat, district heating, steel load
  data, wind SCADA, PV module libraries, battery aging, fuel-cell impedance,
  cement emissions, and EV charging utilization
- client memo Markdown
- top insights, limitations, and next actions

The UI consumes this structured object and renders both the client answer and
the internal analysis path.

Planned tool families:

- spreadsheet extraction through LibreOffice/calamine/openpyxl
- PDF table/text extraction and OCR fallback
- GDAL-backed geospatial inspection
- HDF5/NetCDF/Parquet schema and summary extraction
- CAD/BIM inspection through IfcOpenShell, ezdxf, and Open Cascade bindings
- code execution and reproducible notebook generation

## Client Workload Sandbox

Long-running custom analysis runs through the workspace `agent_workspace`
action. Real client workloads must use the Docker/Podman sandbox rather than
host-local Python execution.

Workspace defaults for client deployments:

- `EXERGY_AGENT_SANDBOX_MODE=container`
- `EXERGY_AGENT_CONTAINER_RUNTIME=docker`
- `EXERGY_AGENT_CONTAINER_IMAGE=exergy-agent-workspace:2026-05-24`
- `EXERGY_AGENT_CONTAINER_PULL_POLICY=never`
- `EXERGY_AGENT_ALLOW_NETWORK=false`

Build and verify the sandbox image from `workspace/`:

```bash
npm run sandbox:build
npm run sandbox:check
```

The runtime mounts only the per-run workspace at `/workspace`, drops Linux
capabilities, disables privilege escalation, uses a read-only root filesystem,
sets CPU/memory/process/file-size limits, and disables networking unless a run
is explicitly allowed to use public web/API data. Production readiness fails if
container mode is required but Docker/Podman or the pinned image is missing.

## Accuracy System

The agent should not emit naked claims. Every substantive claim should be one of:

- `computed`: derived directly from uploaded data
- `observed`: directly read from an uploaded file
- `inferred`: reasonable interpretation from computed/observed evidence
- `blocked`: a claim the client may want, but the uploaded data cannot support

The client memo can stay readable, but the internal run record must preserve
file profiles, evidence, parse warnings, limitations, and recommended next
actions.
