# Breakthrough Engine Migration Blueprint

This document maps the real `/home/chris/breakthrough-engine` architecture into
the clean `exergy-analyst` product goal: an agent-first workspace for energy,
science, and engineering analysis.

The migration should not copy the old repo wholesale. Breakthrough Engine is a
large research platform with useful reusable subsystems, legacy campaign code,
runtime artifacts, and local environment state. Exergy Analyst should become a
clean product repo that imports the durable parts and deletes the confusion.

## Product Target

The final product is a workspace agent that behaves like Claude Code or Codex
for energy, science, and engineering tasks:

- the user uploads messy files or points the agent at a project folder;
- the agent inventories the material, chooses tools, parses files, and runs
  calculations;
- the agent runs physics screens, economic analysis, environmental assessment,
  evidence checks, and literature/project diligence when relevant;
- the agent writes clear client-facing memos with numbers, caveats, and next
  actions;
- the internal run record preserves provenance, parser warnings, confidence,
  unsupported claims, assumptions, and reproducibility metadata.

The core user experience is not a metadata dashboard. Metadata, claim ledgers,
and machine-readable packets exist to support better answers.

## Source Repo Findings

Breakthrough Engine has several platform layers worth migrating:

- `workspace/`: Next.js workspace UI, project storage, upload routes, chat
  orchestration, reports, dashboards, DeepSeek integration, auth/billing
  scaffolding, and artifact rendering.
- `breakthrough_engine/ingestion/`: multi-format extraction for PDF, text,
  CSV/TSV, Excel, Word, JSON, OCR, Gemini vision fallback, and reviewable
  ingestion packets.
- `breakthrough_engine/langgraph_harness/`: LangGraph supervised multi-agent
  runtime with planner/coder/tester/reviewer/UI-polisher roles and sandboxed
  tools.
- `breakthrough_engine/reasoning/`: structured LLM harness with plan search,
  JSON repair, self-verification, sandbox checks, and metacognitive hooks.
- `breakthrough_engine/physics/`: solver-family registry, capability catalog,
  sidecar protocol, normalized physics evaluation spine, and broad domain to
  solver-family mapping.
- `breakthrough_engine/modules/`: canonical module evaluators for physics,
  performance, economics, safety, regulatory, manufacturing, environmental,
  scalability, system integration, and novelty/strategic value.
- `breakthrough_engine/exergy/`: deterministic exergy spine, reference
  environment handling, quality factors, domain adapters, and exergy gates.
- `breakthrough_engine/cost_models/`: cost-engine protocol, registry, LCOF,
  WACC, sensitivity, exergy-normalized costs, and domain adapters.
- `breakthrough_engine/evidence/`, `claim_validation.py`,
  `device_decision_brief.py`, `brief_truthfulness.py`: evidence models, source
  trust ranking, decision brief contracts, and no-silent-pass claim discipline.
- `breakthrough_engine/memory_manager.py`, `memory_query.py`,
  `hybrid_retrieval.py`, `kg_*`, `embeddings.py`, `db.py`: memory, retrieval,
  SQLite persistence, KG diversification, FTS/vector retrieval, and audit hash
  infrastructure.
- `scripts/impl_session.py`, `scripts/worktree_bootstrap.sh`,
  `scripts/codex_opus_triad.py`, `.githooks/pre-commit`: implementation safety
  harness for scoped work, tests, review artifacts, and commit gates.

## Do Not Migrate

These should stay out of `exergy-analyst` unless deliberately archived in a
separate reference folder:

- `.venv*`, `node_modules`, `.next`, `__pycache__`, `.pytest_cache`, generated
  caches, compiled bytecode, and local build artifacts.
- `runtime/` except for small intentional fixtures.
- local reports, one-off generated campaign outputs, and temporary PDFs/CSVs.
- API key values or local `.env.local` files. Migrate variable names and
  examples only.
- CO2-methanol B200 campaign-specific modules as product code. Keep them as
  historical reference only if needed; they should not define the new product.
- old landing-page/blog/product-marketing routes unless they are rewritten
  around the agent workspace.

## Secret And Env Migration

Source env discovery shows the operational DeepSeek key is in:

- `/home/chris/breakthrough-engine/workspace/.env.local`

Do not copy this into git. The migration should create examples and local
loaders only:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_V3_API_KEY` if backward compatibility is needed
- `EXERGY_AGENT_MODEL=deepseek-v4-flash`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `GEMINI_API_KEY` for OCR/vision fallback
- `OLLAMA_MODEL` and `BT_EMBEDDING_MODEL` or renamed equivalents for local
  embeddings/search
- optional production variables: database URL, auth secret, billing keys,
  email keys

Target rule: secrets live in local `.env` / `workspace/.env.local`, never in
tracked files.

## Target Repo Shape

Recommended package layout:

```text
exergy-analyst/
  workspace/                       # Next.js product workspace
  src/exergy_analyst/
    agent_runtime/                 # Deep Agents + LangGraph orchestration
    tools/                         # sandboxed file, command, parser, solver tools
    ingestion/                     # document/file parsing and extraction packets
    evidence/                      # evidence models, fusion, claim ledgers
    reports/                       # decision memo and technical appendix renderers
    physics/                       # solver registry, capability catalog, sidecars
    economics/                     # cost models, forecasts, sensitivity
    environmental/                 # lifecycle/circularity assessment
    exergy/                        # exergy spine and quality-factor analysis
    evaluators/                    # canonical module evaluators
    memory/                        # project memory, retrieval, KG, embeddings
    domains/                       # optional domain tool packs
      heat_pump/
      district_energy/
      hydrogen/
      ptl/
      wtf/
      pv/
      battery/
      inverter/
      wind/
      nuclear/
    harness/                       # implementation/session/test harness
  tests/
  scripts/
  corpus/
  runtime/                         # ignored local run state
```

The old `breakthrough_engine` imports should be renamed during migration. New
code should import from `exergy_analyst`.

## Migration Priorities

### 1. Workspace UI And Project Shell

Migrate first:

- `workspace/package.json`, Next/Tailwind/TypeScript config, and UI primitives.
- `workspace/src/app/projects/*`, `workspace/src/app/api/projects/*`,
  `workspace/src/app/api/analyze/route.ts`, and ingestion/chat/report routes.
- `workspace/src/lib/storage/*` for local project/document/artifact storage.
- `workspace/src/lib/backend.ts` for DeepSeek API wiring, env loading, Python
  subprocess calls, and model routing.
- components under `workspace/src/components/artifacts`,
  `workspace/src/components/brief`, `workspace/src/components/ingest`,
  `workspace/src/components/dashboard`, `workspace/src/components/interactive`,
  and `workspace/src/components/ui`.

Rewrite or defer:

- old domain-specific simulation controls that assume battery/PV/inverter are
  the main product.
- marketing/blog pages.
- billing/auth until the agent workspace is useful locally.

The new first screen should be a project workspace with upload, chat, artifacts,
memo output, and run history.

### 2. Upload, Parsing, And Evidence Intake

Migrate:

- `breakthrough_engine/ingestion/models.py`
- `breakthrough_engine/ingestion/formats.py`
- `breakthrough_engine/ingestion/pipeline.py`
- `breakthrough_engine/ingestion/cli.py`
- `breakthrough_engine/ingestion/comprehensive.py`
- `breakthrough_engine/ingestion/document_ocr.py`
- `breakthrough_engine/ingestion/gemini_vision.py`
- `breakthrough_engine/ingestion/mineru_sidecar.py`
- `breakthrough_engine/ingestion/validators.py`
- `breakthrough_engine/evidence/models.py`
- `breakthrough_engine/evidence/fusion.py`
- `breakthrough_engine/evidence/digest.py`
- `breakthrough_engine/evidence/triage.py`

Immediate product requirement: any upload should produce a useful result even
when extraction is partial. The memo should say what was extracted, what was not
extracted, why it matters, and what single file or measurement would most
improve the answer.

### 3. Agent Runtime

Migrate and adapt:

- `breakthrough_engine/langgraph_harness/graph.py`
- `breakthrough_engine/langgraph_harness/state.py`
- `breakthrough_engine/langgraph_harness/tools.py`
- `breakthrough_engine/langgraph_harness/llm.py`
- `breakthrough_engine/langgraph_harness/nodes/*`
- `breakthrough_engine/reasoning/*`
- `workspace/src/lib/deep-research.ts`
- `workspace/src/lib/deep-diligence.ts`
- `workspace/src/lib/rlm-router.ts`

Retarget the roles from software implementation only to analysis work:

- supervisor: chooses analysis path and stops unsupported work;
- intake analyst: inventories files and extracts facts;
- physics analyst: runs screens and checks feasibility;
- economics analyst: cost, value, sensitivity, forecast;
- environmental analyst: lifecycle and burden-shift checks;
- research analyst: literature/project context;
- report writer: one-page client memo plus optional appendix;
- reviewer: checks unsupported claims, missing evidence, and plain-language
  usefulness.

The agent should use Deep Agents/LangGraph as the main runtime and DeepSeek
V4-Flash as the default model.

### 4. Physics, Exergy, Economics, And Environmental Core

Migrate the shared contracts first:

- `breakthrough_engine/domain_models.py`
- `breakthrough_engine/domain_base.py`
- `breakthrough_engine/modules/base.py`
- `breakthrough_engine/modules/reference_contract.py`
- `breakthrough_engine/device_decision_brief.py`

Then migrate physics:

- `breakthrough_engine/physics/adapter_schema.py`
- `breakthrough_engine/physics/base.py`
- `breakthrough_engine/physics/capability_catalog.py`
- `breakthrough_engine/physics/capability_spec.py`
- `breakthrough_engine/physics/evaluation_contracts.py`
- `breakthrough_engine/physics/evaluation_spine.py`
- `breakthrough_engine/physics/registry.py`
- `breakthrough_engine/physics/registration.py`
- `breakthrough_engine/physics/sidecar_protocol.py`
- `breakthrough_engine/physics/families/*.py`

Then migrate exergy/cost/environment:

- `breakthrough_engine/exergy/*`
- `breakthrough_engine/cost_models/*`
- `breakthrough_engine/modules/economics_bankability/*`
- `breakthrough_engine/modules/environmental_impact/*`
- `breakthrough_engine/modules/performance_durability/*`
- `breakthrough_engine/modules/manufacturing_readiness/*`
- `breakthrough_engine/modules/regulatory_readiness/*`
- `breakthrough_engine/modules/safety_readiness/*`
- `breakthrough_engine/modules/scalability_readiness/*`
- `breakthrough_engine/modules/system_integration_operability/*`
- `breakthrough_engine/modules/novelty_strategic_value/*`

The most important preservation rule is confidence discipline. The physics
spine already distinguishes solver-backed, parametric-only, unavailable,
not-applicable, blocked, and missing-input states. That is exactly the product
behavior needed for messy client data.

### 5. First Domain Tool Packs

Start with the domains that match the initial product tests:

- industrial waste heat / district energy:
  - `breakthrough_engine/heat_pump/*`
  - `breakthrough_engine/physics/families/vcc_solver.py`
  - `breakthrough_engine/physics/families/thermal_cycle_solver.py`
  - `breakthrough_engine/physics/families/hx_solver.py`
  - relevant exergy and cost adapters
- deep-tech energy project analyst:
  - `breakthrough_engine/device_decision_brief.py`
  - canonical module evaluators
  - evidence/diligence/research pipelines
- hydrogen and PtL:
  - `breakthrough_engine/hydrogen/*`
  - `breakthrough_engine/ptl/*`
  - hydrogen/PtL exergy and cost adapters
- waste-to-fuels:
  - `breakthrough_engine/wtf/*`
  - `breakthrough_engine/wte/*` only where it helps distinguish fuels vs
    electricity/heat

Later packs:

- PV, battery, inverter
- wind
- nuclear
- carbon capture
- fuel cell
- bio systems

### 6. Memory, Retrieval, And Persistence

Migrate selectively:

- `breakthrough_engine/db.py`, but split it into smaller migrations for
  projects, artifacts, evidence, memories, and agent runs.
- `breakthrough_engine/memory_manager.py`
- `breakthrough_engine/memory_query.py`
- `breakthrough_engine/hybrid_retrieval.py`
- `breakthrough_engine/embeddings.py`
- `breakthrough_engine/kg_writer.py`, `kg_retrieval.py`, `kg_grounding.py`,
  `kg_segment_scorer.py`
- `breakthrough_engine/corpus_manager.py`

The product memory should answer practical questions:

- Have we seen this client, project, equipment family, or claim before?
- What previous analyses failed because the data was missing or misleading?
- What benchmark or reference case is most relevant to this upload?
- What should the agent avoid repeating?

### 7. Implementation Harness

Migrate:

- `scripts/worktree_bootstrap.sh`
- `scripts/impl_session.py`
- `scripts/codex_opus_triad.py`
- `.githooks/pre-commit`
- focused test-manifest logic from `tests/test_breakthrough/suite_manifest.py`

Adapt names and paths to `exergy-analyst`. Keep the concept of scoped sessions,
risk-aware tests, visible foreground failures, and pre-commit gates. This matters
because the final agent will be allowed to run tools and modify its workspace.

## Initial Build Sequence

1. Add workspace scaffold and env examples.
2. Port local project storage, upload routes, and Python subprocess bridge.
3. Port ingestion formats and evidence packets.
4. Port memo/report contracts and claim-status validation.
5. Port LangGraph/Deep Agents runtime with the analysis roles above.
6. Port heat-pump / district-energy / waste-heat physics first.
7. Port economics, exergy, and environmental evaluators.
8. Run client-style tests against the public messy corpus.
9. Only then port broader domain packs and advanced sidecars.

## First Acceptance Tests

The first useful product tests should be client-style, not metadata-style:

- Upload a sparse district-heating CSV and ask: "Where are we wasting the most
  useful heat, and what should we change first?"
- Upload industrial waste-heat data plus a messy equipment spec and ask:
  "Is this worth a heat-pump retrofit, and what data is missing before we spend
  engineering money?"
- Upload a hydrogen/PtL report and a cost spreadsheet and ask:
  "Which assumptions drive the project economics, and which claims are not
  supported by the uploaded files?"
- Upload mixed wind, battery, turbine, and environmental documents and ask:
  "Give me the diligence memo an investor would actually need."

Passing means the answer is useful in plain language, backed by extracted or
computed values, and explicit about uncertainty. Passing does not mean every
metadata field is populated.

## Migration Rule Of Thumb

When deciding whether to migrate a file, ask:

1. Does this help the agent understand messy user material?
2. Does this help the agent run a calculation or check a claim?
3. Does this improve confidence, provenance, memory, reproducibility, or user
   experience?
4. Can this be explained to a real client as part of a better answer?

If the answer is no, leave it behind.
