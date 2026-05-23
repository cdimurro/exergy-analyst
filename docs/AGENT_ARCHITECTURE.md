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
- deterministic domain analyzers
- corpus manifest lookup
- report rendering

Planned tool families:

- spreadsheet extraction through LibreOffice/calamine/openpyxl
- PDF table/text extraction and OCR fallback
- GDAL-backed geospatial inspection
- HDF5/NetCDF/Parquet schema and summary extraction
- CAD/BIM inspection through IfcOpenShell, ezdxf, and Open Cascade bindings
- code execution and reproducible notebook generation

## Accuracy System

The agent should not emit naked claims. Every substantive claim should be one of:

- `computed`: derived directly from uploaded data
- `observed`: directly read from an uploaded file
- `inferred`: reasonable interpretation from computed/observed evidence
- `blocked`: a claim the client may want, but the uploaded data cannot support

The client memo can stay readable, but the internal run record must preserve
file profiles, evidence, parse warnings, limitations, and recommended next
actions.
