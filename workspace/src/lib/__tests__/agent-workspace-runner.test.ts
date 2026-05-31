import {
  appendWorkspaceConsistencyChecks,
  containerBaseArgs,
  isGenericWorkspaceMissingReport,
  repairGeneratedPython,
  requestedWorkspaceOutputExtensions,
  sanitizeWorkspaceReportForSourceDisclosure,
  sanitizePythonRequirements,
  scoreWorkspaceMarkdownReport,
  workspaceOutputContractFindings,
  workspaceConsistencyFindings,
} from "@/lib/agent-workspace-runner";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("agent workspace runner", () => {
  it("documents the helper contract generated code relies on", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("def extract_all_input_documents():");
    expect(source).toContain("def extract_all_input_texts():");
    expect(source).toContain("return [doc.get(\"text\", \"\") for doc in extract_all_input_documents() if doc.get(\"text\")]");
    expect(source).toContain("extract_all_input_texts() returns a list of strings");
    expect(source).toContain("extract_all_input_documents()");
    expect(source).toContain("sidecars and parser-specific extraction paths");
    expect(source).toContain(".gemini.md");
    expect(source).toContain("def write_csv(*args):");
    expect(source).toContain("write_csv(name, headers, rows)");
    expect(source).toContain("def _with_default_suffix");
    expect(source).toContain('name = _with_default_suffix(name, ".md")');
    expect(source).toContain('name = _with_default_suffix(name, ".json")');
    expect(source).toContain('name = _with_default_suffix(name, ".csv")');
    expect(source).toContain('outputFileByName(files, ["report.md", "report.markdown", "report", "memo.md", "decision_brief.md", "brief.md", "analysis.md"])');
    expect(source).toContain('outputFileByName(files, ["results.json", "results"])');
    expect(source).toContain("writecsv = write_csv");
    expect(source).toContain("writepdf = write_pdf");
    expect(source).toContain("def pvlib_cell_temperature");
    expect(source).toContain("def pvlib_fixed_tilt_day");
    expect(source).toContain("class _AttrDict");
    expect(source).toContain("peak_power_w");
    expect(source).toContain("daily_energy_wh");
    expect(source).toContain("cell_temp");
    expect(source).toContain("m3/day");
    expect(source).toContain("Workspace code generation did not return executable Python after retry");
  });

  it("keeps evidence provenance out of workspace reports unless the user asks for it", () => {
    const report = [
      "# Result",
      "According to turbine-study.pdf, the measured capacity is 42 MW.",
      "Source: https://example.com/paper",
      "| Value | Source |",
      "|---|---|",
      "| 42 MW | uploaded file |",
      "This is source-backed.",
    ].join("\n");

    const hidden = sanitizeWorkspaceReportForSourceDisclosure({
      projectId: "project",
      actionId: "action",
      task: "Analyze the turbine capacity.",
    }, report);

    expect(hidden).toContain("42 MW");
    expect(hidden).not.toMatch(/turbine-study\.pdf|https?:\/\/|Source:|source-backed/i);
    expect(hidden).toContain("| Value | Basis |");

    const shown = sanitizeWorkspaceReportForSourceDisclosure({
      projectId: "project",
      actionId: "action",
      task: "Analyze the turbine capacity and cite sources.",
    }, report);
    expect(shown).toContain("turbine-study.pdf");
  });

  it("uses Gemini PDF vision before local MinerU when configured", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("callGeminiPdfVision");
    expect(source).toContain("EXERGY_PDF_VISION_PROVIDER");
    expect(source).toContain("EXERGY_GEMINI_PDF_MAX_MB");
    expect(source).toContain('"python3", "/usr/bin/python3"');
    expect(source).toContain("ensureGeminiPdfTextSidecars");
    expect(source).toContain("GEMINI_VISION_MODEL");
    expect(source).not.toContain("gemini-3.5-flash");
    expect(source).toContain(".gemini.json");
    expect(source).toContain("extract_pdf_document");
    expect(source).toContain("return max(candidates, key=len)");
  });

  it("exposes domain-agnostic workspace tools instead of hard-coded domain routing", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("def extract_numeric_evidence");
    expect(source).toContain("def extract_markdown_tables");
    expect(source).toContain("def load_tabular_inputs");
    expect(source).toContain("CSV/TSV/JSON/YAML inputs");
    expect(source).toContain('lower.endswith((".yaml", ".yml"))');
    expect(source).toContain("def search_literature");
    expect(source).toContain("def source_value_table");
    expect(source).toContain("def run_sensitivity_grid");
    expect(source).toContain("def rank_sensitivity");
    expect(source).toContain('lower.endswith((".xlsx", ".xlsm", ".xltx", ".xltm"))');
    expect(source).toContain('lower.endswith(".parquet")');
    expect(source).toContain('path_suffix in (".docx",)');
    expect(source).toContain('path_suffix in (".pptx",)');
    expect(source).toContain('path_suffix == ".dxf"');
    expect(source).toContain('path_suffix == ".ifc"');
    expect(source).toContain("search_crossref_works");
    expect(source).toContain("search_openalex_works");
    expect(source).toContain("def financial_metrics");
    expect(source).toContain("Use a domain-agnostic tool workflow");
    expect(source).toContain("Do not assume the platform only supports a fixed list of domains");
    expect(source).toContain("Never substitute generic placeholder inputs");
    expect(source).toContain("input-supported values");
    expect(source).toContain("do not tell the user where evidence came from unless they ask");
    expect(source).toContain("Keep provenance internal by default");
    expect(source).toContain("parse their text/markdown content");
    expect(source).toContain("permissive context regexes");
    expect(source).toContain("SOURCE_PREVIEWS");
    expect(source).toContain("independent_checks");
    expect(source).toContain("quality_evaluation");
    expect(source).not.toContain("function shouldUseDeterministicFallback");
    expect(source).not.toContain("if (shouldUseDeterministicFallback");
    expect(source).not.toContain("deterministic_pv_module_fallback");
  });

  it("does not select a missing container image in automatic sandbox mode", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("containerImageAvailable");
    expect(source).toContain('pullPolicy !== "never"');
    expect(source).toContain('requestedMode === "auto" && containerRuntime');
    expect(source).toContain('"local_restricted"');
  });

  it("requires DeepSeek-generated code instead of substituting heuristic fallback scripts", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("callDeepSeekV3");
    expect(source).toContain("Do not use canned application templates or domain-specific shortcuts");
    expect(source).toContain("Exergy Lab Agent model is not configured");
    expect(source).toContain("The previous response did not include executable Python code");
    expect(source).toContain("Workspace code generation did not return executable Python after retry");
    expect(source).not.toContain("legacyDomainFallbackPython");
    expect(source).not.toContain("fallbackExecutionUsed");
    expect(source).not.toContain("Open the process details to inspect generated code");
  });

  it("requires requested workspace exports before normal success", () => {
    const findings = workspaceOutputContractFindings({
      input: {
        projectId: "project",
        actionId: "action",
        task: "Create a client memo as PDF from this engineering model.",
      },
      files: [
        { filename: "report.md", path: "/tmp/report.md", bytes: 100, kind: "md" },
        { filename: "results.json", path: "/tmp/results.json", bytes: 100, kind: "json" },
      ],
      reportMarkdown: "## Support and Limits\nThe data supports screening-level review and does not prove field performance.",
      results: {},
    });

    expect(requestedWorkspaceOutputExtensions({
      projectId: "project",
      actionId: "action",
      task: "Create a client memo as PDF from this engineering model.",
    })).toContain("pdf");
    expect(findings.join("\n")).toContain("requested PDF output");
  });

  it("flags JSON-only output when the requested memo/report is missing", () => {
    const findings = workspaceOutputContractFindings({
      input: {
        projectId: "project",
        actionId: "action",
        task: "Create JSON plus a Markdown memo for this techno-economic screen.",
        requestedOutputs: ["json", "markdown"],
      },
      files: [
        { filename: "results.json", path: "/tmp/results.json", bytes: 100, kind: "json" },
      ],
      reportMarkdown: "",
      results: { assumptions: [] },
    });

    expect(findings.join("\n")).toContain("report.md was missing");
    expect(findings.join("\n")).toContain("support/limits");
  });

  it("contains the repair loop contract for output failures and best-effort preservation", () => {
    const source = readFileSync(join(__dirname, "..", "agent-workspace-runner.ts"), "utf-8");

    expect(source).toContain("workspaceOutputContractFindings");
    expect(source).toContain("Output contract repair required before final answer");
    expect(source).toContain("output_contract");
    expect(source).toContain("best-effort");
    expect(source).toContain("did not complete successfully");
  });

  it("repairs common generated Python output directory placeholders", () => {
    const code = [
      "import os",
      "OUTPUT_DIR = '/path/to/output'  # Will be overridden by workspace",
      "with open(os.path.join(OUTPUT_DIR, 'x.txt'), 'w') as f:",
      "    f.write('ok')",
    ].join("\n");

    const repaired = repairGeneratedPython(code);

    expect(repaired).toContain('OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "outputs")');
    expect(repaired).toContain("os.makedirs(OUTPUT_DIR, exist_ok=True)");
    expect(repaired).not.toContain("/path/to/output");
  });

  it("repairs common pvlib temperature API compatibility mistakes", () => {
    const code = [
      "import os",
      "from agent_workspace_helpers import write_json",
      "from pvlib import temperature",
      "cell_temperature = temperature.pvwatts_cell(poa_global, ambient_temp, wind_speed)",
      "old_temperature = temperature.sapm_celltemp(poa_global, ambient_temp, wind_speed)",
      "write_json('results.json', {'ok': True})",
    ].join("\n");

    const repaired = repairGeneratedPython(code);

    expect(repaired).toContain("from agent_workspace_helpers import write_json, pvlib_cell_temperature");
    expect(repaired).toContain("cell_temperature = pvlib_cell_temperature(poa_global, ambient_temp, wind_speed)");
    expect(repaired).toContain("old_temperature = pvlib_cell_temperature(poa_global, ambient_temp, wind_speed)");
    expect(repaired).not.toContain("pvwatts_cell");
    expect(repaired).not.toContain("sapm_celltemp");
  });

  it("keeps dependency installation constrained to allowed Python packages", () => {
    expect(sanitizePythonRequirements([
      "numpy",
      "pandas>=2.0",
      "requests",
      "python-docx",
      "python-pptx",
      "pdfplumber",
      "evil-package",
      "numpy; rm -rf /",
      "../local",
      42,
    ])).toEqual(["numpy", "pandas>=2.0", "requests", "python-docx", "python-pptx", "pdfplumber"]);
  });

  it("rejects shell-like package strings", () => {
    expect(sanitizePythonRequirements([
      "matplotlib && curl bad",
      "scipy",
      "reportlab | sh",
    ])).toEqual(["scipy"]);
  });

  it("runs containers with client-workload safety boundaries", () => {
    const args = containerBaseArgs({
      mode: "container",
      containerRuntime: "docker",
      containerImage: "exergy-agent-workspace:2026-05-24",
      network: false,
      dependencyInstall: true,
      timeoutMs: 60_000,
      memoryMb: 1024,
      cpuSeconds: 120,
      maxFileBytes: 50 * 1024 * 1024,
      maxFiles: 20,
      maxInputFiles: 5,
    }, "/tmp/exergy-agent-test", { AGENT_ALLOW_NETWORK: "0" });

    expect(args).toEqual(expect.arrayContaining([
      "--pull", "never",
      "--network", "none",
      "--memory", "1024m",
      "--pids-limit", "128",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--read-only",
      "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
      "-v", "/tmp/exergy-agent-test:/workspace:rw",
      "exergy-agent-workspace:2026-05-24",
    ]));
  });

  it("flags narrative claims that contradict computed economics", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# Decision Brief",
        "",
        "The base case supports economic viability with a positive NPV.",
        "The LCOE ranges from about $75/MWh to $155/MWh.",
      ].join("\n"),
      {
        Base: {
          scenario: "Base",
          "npv_vs_diesel_$": -5_964_399,
          "lcoe_$_mwh": 119.78,
        },
        "High-Cost": {
          scenario: "High-Cost",
          "lcoe_$_mwh": 199.55,
        },
      },
      "Evaluate a project with a 40 year project life.",
    );

    expect(findings.join("\n")).toContain("Base npv vs diesel is -$5,964,399");
    expect(findings.join("\n")).toContain("Computed LCOE range across scenarios is 119.78/MWh (Base) to 199.55/MWh (High-Cost)");
  });

  it("flags scenario sensitivities that unintentionally change production basis", () => {
    const findings = workspaceConsistencyFindings(
      "# Scenario Results",
      {
        scenarios: [
          { scenario: "Base", annual_generation_mwh: 620_558, "lcoe_$_mwh": 119.78 },
          { scenario: "Low-Cost", annual_generation_mwh: 640_794, "lcoe_$_mwh": 77.58 },
        ],
      },
    );

    expect(findings.join("\n")).toContain("Low-Cost changes annual generation mwh from 620,558 to 640,794");
    expect(findings.join("\n")).toContain("not an isolated cost/finance sensitivity");
  });

  it("flags payback periods beyond project life", () => {
    const findings = workspaceConsistencyFindings(
      "# Economics",
      {
        Base: { scenario: "Base", payback_vs_diesel_years: 12 },
        "Low-Cost": { scenario: "Low-Cost", payback_vs_gas_years: 100 },
      },
      "Assume a 40 year project life.",
    );

    expect(findings.join("\n")).toContain("Low-Cost payback vs gas years is 100 years");
    expect(findings.join("\n")).toContain("exceeds the 40-year project life");
  });

  it("flags efficiency metrics above physical bounds", () => {
    const findings = workspaceConsistencyFindings(
      "# Exergy\nExergy efficiency is 112.7%.",
      { Base: { scenario: "Base", exergy_efficiency_percent: 112.7 } },
    );

    expect(findings.join("\n")).toContain("above the usual physical bound");
  });

  it("flags unresolved self-review notes in generated reports", () => {
    const findings = workspaceConsistencyFindings(
      "The new case is safer. [check this against the table?]",
      {},
    );

    expect(findings.join("\n")).toContain("unresolved self-review language");
  });

  it("flags unresolved template placeholders in generated reports", () => {
    const findings = workspaceConsistencyFindings(
      "# Results\n\n{table_md}",
      {},
    );

    expect(findings.join("\n")).toContain("unresolved template placeholder");
  });

  it("flags thermal runaway runs that report max integration time as an onset", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# Thermal Runaway Simulation",
        "",
        "| Case | T_critical (°C) | Time to runaway (s) |",
        "|---|---:|---:|",
        "| Base | 40.0 | 10000.0 |",
        "| E_SEI=1.2eV | 40.0 | 10000.0 |",
        "",
        "The most sensitive parameter is E_SEI.",
        "",
        "| Parameter | T Range (°C) | Time Range (s) | Sensitivity (%) |",
        "|---|---:|---:|---:|",
        "| E_SEI | 0.0 | 0.0 | 0.0 |",
        "| H_cath | 0.0 | 0.0 | 0.0 |",
      ].join("\n"),
      {},
      "Run a thermal runaway sensitivity simulation.",
    );

    const text = findings.join("\n");
    expect(text).toContain("maximum integration time as a time-to-runaway");
    expect(text).toContain("reported sensitivity values are zero");
  });

  it("makes thermal runaway consistency findings repair-blocking output contract findings", () => {
    const findings = workspaceOutputContractFindings({
      input: {
        projectId: "project",
        actionId: "action",
        task: "Run a thermal runaway simulation and sensitivity analysis.",
      },
      files: [
        { filename: "report.md", path: "/tmp/report.md", bytes: 100, kind: "md" },
        { filename: "results.json", path: "/tmp/results.json", bytes: 100, kind: "json" },
      ],
      reportMarkdown: [
        "# Thermal Runaway",
        "Support and limits: this is screening only and cannot prove field safety.",
        "| Case | Time to runaway (s) |",
        "|---|---:|",
        "| Base | 10000.0 |",
      ].join("\n"),
      results: {},
    });

    expect(findings.join("\n")).toContain("maximum integration time as a time-to-runaway");
  });

  it("flags data-center turbine capacity and availability overclaims", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# Data Center Power Readiness",
        "",
        "The N+1 availability is excellent at 97.31%, and the project should proceed with conditions.",
      ].join("\n"),
      {
        metrics: {
          total_load_mw: 219.6,
          hot_total_mw: 187.1,
          n1_hot_plus_grid_firm_mw: 230.9,
          n2_hot_plus_grid_firm_mw: 199.7,
          prob_n_plus_1: 0.9731,
        },
      },
      "Evaluate a behind-the-meter gas turbine architecture for a five-nines data center load.",
    );

    const text = findings.join("\n");
    expect(text).toContain("Hot-day all-unit generation is 187.1 MW against 219.6 MW");
    expect(text).toContain("N-1 plus firm grid leaves only 11.3 MW");
    expect(text).toContain("N-2 plus firm grid is 199.7 MW");
    expect(text).toContain("97.31%");
  });

  it("flags invented short-circuit topology and unsupported ride-through claims", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# Electrical Assessment",
        "",
        "The 13.8 kV short-circuit duty is acceptable using an assumed 30 MVA transformer at 7% impedance.",
        "The 10 second ride-through is likely achievable from the available generation capacity.",
      ].join("\n"),
      {},
      "Evaluate 13.8 kV short-circuit duty, switchgear adequacy, and 10 second ride-through for a gas turbine data center.",
    );

    const text = findings.join("\n");
    expect(text).toContain("assumed 30 MVA, 7% transformer");
    expect(text).toContain("10-second voltage sag cannot be verified");
  });

  it("flags transformer loss basis errors at rated loading", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# Transformer Losses",
        "",
        "| Loading | Loss |",
        "|---|---:|",
        "| 100% | 268.2 kW |",
      ].join("\n"),
      {},
      "Evaluate a 55 MVA transformer with no-load loss 45 kW and load loss 310 kW at rated loading for a data center.",
    );

    expect(findings.join("\n")).toContain("below the supplied no-load plus load-loss basis of 355");
  });

  it("flags missing heat-rate penalty when the task asks for it", () => {
    const findings = workspaceConsistencyFindings(
      "Fuel consumption uses a constant heat rate across all turbine loading cases.",
      {},
      "Calculate gas turbine fuel consumption including heat-rate penalty at part load for a data center.",
    );

    expect(findings.join("\n")).toContain("does not compute a load/temperature heat-rate correction");
  });

  it("makes data-center power consistency findings repair-blocking output contract findings", () => {
    const findings = workspaceOutputContractFindings({
      input: {
        projectId: "project",
        actionId: "action",
        task: "Evaluate a gas turbine data center power architecture with five-nines reliability.",
      },
      files: [
        { filename: "report.md", path: "/tmp/report.md", bytes: 100, kind: "md" },
        { filename: "results.json", path: "/tmp/results.json", bytes: 100, kind: "json" },
      ],
      reportMarkdown: [
        "# Readiness",
        "Support and limits: this cannot prove final interconnection approval.",
        "N+1 availability is excellent at 97.31%.",
      ].join("\n"),
      results: { metrics: { prob_n_plus_1: 0.9731 } },
    });

    expect(findings.join("\n")).toContain("not compatible with a five-nines-class data-center reliability claim");
  });

  it("flags battery material readiness claims that skip application and rate constraints", () => {
    const findings = workspaceConsistencyFindings(
      [
        "# NMC 811 Readiness",
        "",
        "The material is competitive for grid storage and commercially ready. The 200 mAh/g capacity at 1C is routine, and the 245 Wh/kg energy density is benchmarked favorably.",
      ].join("\n"),
      {},
      "Evaluate an NMC 811 lithium-ion battery cathode with energy density 245 Wh/kg, specific capacity 200 mAh/g, cycle life of 1200 cycles to 80% retention at 1C, charging rate up to 3C, cathode loading of 25 mg/cm2, and suitability for EV or grid storage applications.",
    );

    const text = findings.join("\n");
    expect(text).toContain("1,200 cycles to 80% retention is below");
    expect(text).toContain("200 mAh/g for NMC-class material at 1C is a high-end claim");
    expect(text).toContain("implies about 15 mA/cm2");
    expect(text).toContain("energy-density claims need an explicit basis");
  });

  it("flags hydrogen, heat-pump, and generation claims that violate physics bounds", () => {
    const hydrogen = workspaceConsistencyFindings(
      "A PEM electrolyzer at 28 kWh/kg H2 is feasible and highly efficient.",
      {},
      "Evaluate green hydrogen production with electrolyzer specific energy of 28 kWh/kg H2.",
    ).join("\n");
    expect(hydrogen).toContain("below the lower-heating-value thermodynamic floor");

    const heatPump = workspaceConsistencyFindings(
      "The heat pump COP 7 is feasible and suitable for this lift.",
      {},
      "Assess a heat pump with source temperature 5 C and sink temperature 80 C.",
    ).join("\n");
    expect(heatPump).toContain("exceeds the Carnot heating limit");

    const generation = workspaceConsistencyFindings(
      "The 1 MW generator can credibly produce 10,000 MWh per year.",
      {},
      "Check annual generation from nameplate capacity 1 MW and annual generation 10000 MWh.",
    ).join("\n");
    expect(generation).toContain("implies a 114.2% capacity factor");
  });

  it("prefers substantive markdown outputs over generic missing-report placeholders", () => {
    const placeholder = [
      "# Analysis Result",
      "",
      "Task: generate_risk_memo_and_ledger",
      "",
      "The workspace completed, but the generated script did not create a written report.",
    ].join("\n");
    const memo = [
      "# Risk Memo",
      "",
      "## Source-Backed Findings",
      "",
      "| Item | Value |",
      "|---|---|",
      "| Peak load | 6.7 MW |",
      "",
      "## Support and Limits",
      "",
      "The data supports a screening estimate, but cannot prove final permitting or interconnection approval.",
    ].join("\n");

    expect(isGenericWorkspaceMissingReport(placeholder)).toBe(true);
    expect(scoreWorkspaceMarkdownReport(memo)).toBeGreaterThan(scoreWorkspaceMarkdownReport(placeholder));
  });

  it("appends consistency findings to the workspace report", () => {
    const report = appendWorkspaceConsistencyChecks(
      "The output has positive NPV.",
      { Base: { scenario: "Base", npv: -10 } },
    );

    expect(report).toContain("## Consistency Check");
    expect(report).toContain("Base npv is -$10");
  });
});
