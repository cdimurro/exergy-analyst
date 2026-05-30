import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { promisify } from "util";

import { evaluateAgentQuality } from "@/lib/agent-quality-evaluator";
import { callDeepSeekV3, callGeminiPdfVision, getEnvVar, RUNTIME_DIR } from "@/lib/backend";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_FILE_PREVIEW_BYTES = 80_000;
const MAX_FILES_IN_MANIFEST = 80;
const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

const DEFAULT_ALLOWED_PACKAGES = new Set([
  "beautifulsoup4",
  "coolprop",
  "duckdb",
  "ezdxf",
  "h5py",
  "netcdf4",
  "lxml",
  "matplotlib",
  "networkx",
  "numpy",
  "openpyxl",
  "pandas",
  "pillow",
  "polars",
  "pvlib",
  "pyarrow",
  "pymupdf",
  "pypdf",
  "pyyaml",
  "reportlab",
  "requests",
  "scikit-learn",
  "scipy",
  "seaborn",
  "statsmodels",
  "sympy",
  "tabulate",
  "thermo",
  "xlsxwriter",
]);

const DEFAULT_AGENT_CONTAINER_IMAGE = "exergy-agent-workspace:2026-05-24";
const PDF_TEXT_SIDECAR_SUFFIXES = [".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json"];

export interface AgentWorkspaceRunInput {
  projectId: string;
  actionId: string;
  task: string;
  context?: string;
  uploadPaths?: string[];
  currentAttachments?: string[];
  requestedOutputs?: string[];
  allowNetwork?: boolean;
  allowDependencyInstall?: boolean;
  timeoutMs?: number;
}

export interface AgentWorkspaceRunResult {
  workDir: string;
  outputDir: string;
  reportMarkdown: string;
  summary: string;
  generatedCode: string;
  requirements: string[];
  installedRequirements: string[];
  installLog: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  files: Array<{
    path: string;
    filename: string;
    bytes: number;
    kind: string;
    preview?: string;
  }>;
  results: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  sandbox: SandboxPolicy;
  securityFindings: string[];
  executionAttempts: Array<Record<string, unknown>>;
}

export interface SandboxPolicy {
  mode: "container" | "local_restricted";
  containerRuntime?: "docker" | "podman";
  containerImage?: string;
  network: boolean;
  dependencyInstall: boolean;
  timeoutMs: number;
  memoryMb: number;
  cpuSeconds: number;
  maxFileBytes: number;
  maxFiles: number;
  maxInputFiles: number;
}

function pythonPath(): string {
  const configured = getEnvVar("PYTHON_PATH");
  if (configured) return configured;
  try {
    const resolved = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    }).trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch {
    // Fall back to common interpreter names below.
  }
  const venvPython = process.env.VIRTUAL_ENV ? join(process.env.VIRTUAL_ENV, "bin", "python") : "";
  for (const candidate of [venvPython, "python3", "/usr/bin/python3", "/usr/local/bin/python3"]) {
    if (!candidate) continue;
    if (existsSync(candidate)) return candidate;
  }
  return "python3";
}

function safeSlug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "agent_run";
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseProjectLifeYears(task: string): number | null {
  const text = task || "";
  const direct = text.match(/\bproject\s+life\D{0,24}(\d{1,3})\s*(?:years?|yr)\b/i);
  if (direct) return Number(direct[1]);
  const reversed = text.match(/\b(\d{1,3})\s*(?:years?|yr)\s+(?:project\s+)?life\b/i);
  if (reversed) return Number(reversed[1]);
  return null;
}

function scenarioRecords(results: Record<string, unknown>): Array<{ name: string; record: Record<string, unknown> }> {
  const out: Array<{ name: string; record: Record<string, unknown> }> = [];
  const addRecord = (fallbackName: string, value: unknown) => {
    if (!isRecord(value)) return;
    const name = String(
      value.scenario
      || value.case
      || value.case_name
      || value.name
      || value.label
      || fallbackName,
    );
    out.push({ name, record: value });
  };

  for (const [name, value] of Object.entries(results)) {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        addRecord(`${name} ${index + 1}`, value[index]);
      }
      continue;
    }
    addRecord(name, value);
  }
  return out;
}

function numericEntries(record: Record<string, unknown>, prefix = ""): Array<{ key: string; value: number }> {
  const out: Array<{ key: string; value: number }> = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push({ key: path, value });
    } else if (isRecord(value)) {
      out.push(...numericEntries(value, path));
    }
  }
  return out;
}

function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(digits, 2),
  });
}

function searchableMetricKey(key: string): string {
  return key.replace(/[^a-z0-9]+/gi, " ").trim();
}

function displayMetricKey(key: string): string {
  return searchableMetricKey(key).replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function reportSentences(report: string): string[] {
  return report
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function sentenceMentionsScenario(sentence: string, scenarioName: string): boolean {
  const scenario = searchableMetricKey(scenarioName).toLowerCase();
  if (!scenario) return false;
  const normalized = searchableMetricKey(sentence).toLowerCase();
  return new RegExp(`\\b${escapeRegExp(scenario)}\\b`, "i").test(normalized);
}

function comparatorTokens(keys: string[]): string[] {
  const tokens = new Set<string>();
  for (const key of keys) {
    const parts = searchableMetricKey(key).toLowerCase().split(/\s+/).filter(Boolean);
    const vsIndex = parts.indexOf("vs");
    if (vsIndex < 0) continue;
    for (const token of parts.slice(vsIndex + 1)) {
      if (token.length > 2 && !["year", "years"].includes(token)) tokens.add(token);
    }
  }
  return Array.from(tokens);
}

function sentenceAppliesToMetric(sentence: string, key: string, allComparatorTokens: string[]): boolean {
  const sentenceKey = searchableMetricKey(sentence).toLowerCase();
  const keyTokens = searchableMetricKey(key).toLowerCase().split(/\s+/);
  const mentionedComparators = allComparatorTokens.filter((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(sentenceKey),
  );
  return mentionedComparators.length === 0 || mentionedComparators.some((token) => keyTokens.includes(token));
}

export function workspaceConsistencyFindings(
  reportMarkdown: string,
  results: Record<string, unknown>,
  task = "",
): string[] {
  const findings: string[] = [];
  const report = reportMarkdown || "";
  if (/\[[^\]\n]*(?:check|verify|todo|fix|confirm|\?)[^\]\n]*\]/i.test(report) || /\bActually\b/i.test(report)) {
    findings.push(
      "The report contains unresolved self-review language or bracketed check notes. Treat the affected conclusion as unverified until the calculation and narrative are reconciled.",
    );
  }
  if (/\{[a-zA-Z_][a-zA-Z0-9_]{2,}\}/.test(report) || /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(report)) {
    findings.push(
      "The report contains an unresolved template placeholder. Treat the affected section as incomplete until the placeholder is replaced with the computed table or value.",
    );
  }
  const scenarios = scenarioRecords(results);
  if (scenarios.length === 0) return findings;

  for (const scenario of scenarios) {
    for (const entry of numericEntries(scenario.record)) {
      const key = searchableMetricKey(entry.key).toLowerCase();
      if (!/\befficiency\b|\beff\b/.test(key)) continue;
      const percentLike = /\b(percent|pct|percentage)\b|%/.test(key) || entry.value > 10;
      if ((percentLike && entry.value > 100) || (!percentLike && entry.value > 1.05)) {
        findings.push(
          `${scenario.name} ${displayMetricKey(entry.key)} is ${formatNumber(entry.value)}${percentLike ? "%" : ""}, which is above the usual physical bound for an efficiency metric. Check the numerator, denominator, and units before relying on this conclusion.`,
        );
      }
    }
  }

  const positiveNpvSentences = reportSentences(report).filter((sentence) =>
    /\bpositive\s+NPV\b|\bNPV\s+(?:is|was|would be)\s+positive\b/i.test(sentence),
  );
  if (positiveNpvSentences.length > 0) {
    const negativeNpvKeys = scenarios.flatMap((scenario) =>
      numericEntries(scenario.record)
        .filter((entry) => /\bnpv\b/i.test(searchableMetricKey(entry.key)) && entry.value < 0)
        .map((entry) => entry.key),
    );
    const allComparatorTokens = comparatorTokens(negativeNpvKeys);
    const hasScenarioSpecificClaim = positiveNpvSentences.some((sentence) =>
      scenarios.some((scenario) => sentenceMentionsScenario(sentence, scenario.name)),
    );
    for (const scenario of scenarios) {
      for (const entry of numericEntries(scenario.record)) {
        if (/\bnpv\b/i.test(searchableMetricKey(entry.key)) && entry.value < 0) {
          const applies = positiveNpvSentences.some((sentence) =>
            (!hasScenarioSpecificClaim || sentenceMentionsScenario(sentence, scenario.name)) &&
            sentenceAppliesToMetric(sentence, entry.key, allComparatorTokens),
          );
          if (!applies) continue;
          findings.push(
            `${scenario.name} ${displayMetricKey(entry.key)} is ${formatCurrency(entry.value)}. Treat any narrative that describes this NPV as positive as incorrect.`,
          );
        }
      }
    }
  }

  const lcoeEntries = scenarios.flatMap((scenario) =>
    numericEntries(scenario.record)
      .filter((entry) => /\blcoe\b|levelized.*cost/i.test(searchableMetricKey(entry.key)))
      .map((entry) => ({ scenario: scenario.name, ...entry })),
  );
  if (lcoeEntries.length > 1 && /\bLCOE\s+ranges?\b|\branges?\s+from\b/i.test(report)) {
    const sorted = [...lcoeEntries].sort((a, b) => a.value - b.value);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    findings.push(
      `Computed LCOE range across scenarios is ${formatNumber(low.value)}/MWh (${low.scenario}) to ${formatNumber(high.value)}/MWh (${high.scenario}). Use this range if it differs from the narrative summary.`,
    );
  }

  const base = scenarios.find((scenario) => /^base$/i.test(scenario.name)) || scenarios[0];
  const baseEntries = numericEntries(base.record);
  const baseByKey = new Map(baseEntries.map((entry) => [entry.key.toLowerCase(), entry.value]));
  for (const scenario of scenarios) {
    if (scenario.name === base.name) continue;
    const name = scenario.name.toLowerCase();
    const shouldHoldProductionConstant =
      /\b(cost|capex|opex|o&m|wacc|fuel|price|finance|financial)\b/i.test(name) &&
      !/\b(cf|capacity|generation|production|output|utili[sz]ation)\b/i.test(name);
    if (!shouldHoldProductionConstant) continue;
    for (const entry of numericEntries(scenario.record)) {
      if (!/\b(annual generation|generation mwh|production|output|capacity factor|cf)\b/i.test(searchableMetricKey(entry.key))) continue;
      const baseValue = baseByKey.get(entry.key.toLowerCase());
      if (!baseValue) continue;
      const delta = Math.abs(entry.value - baseValue) / Math.max(Math.abs(baseValue), 1);
      if (delta > 0.01) {
        findings.push(
          `${scenario.name} changes ${displayMetricKey(entry.key)} from ${formatNumber(baseValue, 0)} to ${formatNumber(entry.value, 0)}. That scenario is not an isolated cost/finance sensitivity unless the production change was intentional.`,
        );
      }
    }
  }

  const projectLife = parseProjectLifeYears(task);
  if (projectLife) {
    for (const scenario of scenarios) {
      for (const entry of numericEntries(scenario.record)) {
        if (/\bpayback\b/i.test(searchableMetricKey(entry.key)) && entry.value > projectLife) {
          findings.push(
            `${scenario.name} ${displayMetricKey(entry.key)} is ${formatNumber(entry.value)} years, which exceeds the ${projectLife}-year project life. Present this as beyond project life, not as an acceptable payback.`,
          );
        }
      }
    }
  }

  return Array.from(new Set(findings));
}

export function appendWorkspaceConsistencyChecks(
  reportMarkdown: string,
  results: Record<string, unknown>,
  task = "",
): string {
  const findings = workspaceConsistencyFindings(reportMarkdown, results, task);
  if (findings.length === 0 || /\n## Consistency Check\b/i.test(reportMarkdown)) return reportMarkdown;
  return [
    reportMarkdown.trimEnd(),
    "",
    "## Consistency Check",
    "",
    ...findings.map((finding) => `- ${finding}`),
  ].join("\n");
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function wrapLongTableCell(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length <= 180) return cell;
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    return ` ${sentences.slice(0, 5).join("<br>")} `;
  }
  const chunks = trimmed.match(/.{1,95}(?:\s|$)/g)?.map((part) => part.trim()).filter(Boolean) || [trimmed];
  return ` ${chunks.slice(0, 6).join("<br>")} `;
}

export function normalizeLongMarkdownTableCells(reportMarkdown: string): string {
  return reportMarkdown
    .split(/\r?\n/)
    .map((line) => {
      if (!/^\s*\|.*\|\s*$/.test(line) || isMarkdownTableSeparator(line)) return line;
      const parts = line.split("|");
      if (parts.length < 4) return line;
      const normalized = parts.map((part, index) =>
        index === 0 || index === parts.length - 1 ? part : wrapLongTableCell(part)
      );
      return normalized.join("|");
    })
    .join("\n");
}

function hasSupportLimitsLanguage(text: string): boolean {
  return /\b(can(?:not|'t)?\s+(?:support|prove|show|confirm)|not\s+(?:prove|supported|validated)|cannot\s+prove|support and limits|important limit|uncertain|assumption|missing|gap|would improve confidence)\b/i.test(text);
}

export function isGenericWorkspaceMissingReport(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  return clean.length < 900 && /\bworkspace completed, but the generated script did not create a written report\b/i.test(clean);
}

export function scoreWorkspaceMarkdownReport(text: string): number {
  const clean = text.trim();
  if (!clean) return -10_000;
  let score = Math.min(clean.length, 6000) / 10;
  if (isGenericWorkspaceMissingReport(clean)) score -= 1_000;
  const headingCount = (clean.match(/^#{1,3}\s+\S/gm) || []).length;
  score += Math.min(headingCount, 8) * 35;
  if (/^\s*\|.*\|\s*$/m.test(clean)) score += 160;
  if (hasSupportLimitsLanguage(clean)) score += 120;
  if (/\b(source-backed|assumption|not proven|cannot prove|next engineering|recommended next)\b/i.test(clean)) score += 100;
  if (/^\s*[-*]\s+/m.test(clean)) score += 40;
  return score;
}

function scenarioTask(task: string): boolean {
  return /\b(re-?run|scenario|sensitivity|case|compare|all other|hold(?:ing)?|constant|lower|higher|increase|decrease|reduce|change|changed)\b/i.test(task);
}

export function requestedWorkspaceOutputExtensions(input: AgentWorkspaceRunInput): string[] {
  const text = `${input.task}\n${input.requestedOutputs?.join(" ") || ""}`;
  const out = new Set<string>(["md", "json"]);
  if (/\bcsv\b/i.test(text)) out.add("csv");
  if (/\b(pdf|brief|report|memo)\b/i.test(text)) out.add("pdf");
  if (/\b(xlsx|excel|spreadsheet|workbook)\b/i.test(text)) out.add("xlsx");
  if (/\b(png|chart|plot|figure|graph)\b/i.test(text)) out.add("png");
  return Array.from(out);
}

export function workspaceOutputContractFindings(args: {
  input: AgentWorkspaceRunInput;
  files: AgentWorkspaceRunResult["files"];
  reportMarkdown: string;
  results: Record<string, unknown>;
}): string[] {
  const findings: string[] = [];
  const filenames = new Set(args.files.map((file) => file.filename.toLowerCase()));
  if (!filenames.has("report.md")) {
    findings.push("report.md was missing or renamed; the workspace must always publish a primary Markdown report.");
  }
  if (!filenames.has("results.json")) {
    findings.push("results.json was missing or renamed; the workspace must always publish machine-readable results.");
  }
  for (const ext of requestedWorkspaceOutputExtensions(args.input)) {
    if (ext === "md" || ext === "json") continue;
    if (!args.files.some((file) => file.filename.toLowerCase().endsWith(`.${ext}`))) {
      findings.push(`The user requested ${ext.toUpperCase()} output, but no .${ext} file was created.`);
    }
  }
  if (/\b(simulat|model|economic|environmental|safety|decision|recommend|physics|thermal|finance)\b/i.test(args.input.task) && !hasSupportLimitsLanguage(args.reportMarkdown)) {
    findings.push("High-stakes workspace output is missing a Support and limits section.");
  }
  if (scenarioTask(args.input.task)) {
    if (!/\b(changed input|changed variable|only change|all other|unchanged|held constant|constant)\b/i.test(args.reportMarkdown)) {
      findings.push("Scenario output does not clearly state changed inputs and held-constant assumptions.");
    }
    if (!/\|.*(?:scenario|case|base|input|output|result).*\|/i.test(args.reportMarkdown)) {
      findings.push("Scenario output does not include a visible comparison table.");
    }
  }
  if (/^\s*\|.*\|\s*$/m.test(args.reportMarkdown)) {
    const longCells = args.reportMarkdown
      .split(/\r?\n/)
      .filter((line) => /^\s*\|.*\|\s*$/.test(line) && !isMarkdownTableSeparator(line))
      .flatMap((line) => line.split("|").map((cell) => cell.trim()))
      .filter((cell) => cell.length > 260);
    if (longCells.length > 0) {
      findings.push("One or more Markdown table cells are long paragraphs; table cells should be concise with details moved into narrative text.");
    }
  }
  return Array.from(new Set(findings));
}

function flattenResultsRows(value: unknown, prefix = ""): string[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenResultsRows(item, `${prefix}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      return flattenResultsRows(item, next);
    });
  }
  return [[prefix || "value", String(value ?? "")]];
}

function simpleWorkspacePdfBytes(lines: string[]): Buffer {
  const escapePdf = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 10 Tf",
    "50 760 Td",
    ...lines
      .flatMap((line, index) => [`(${escapePdf(line.slice(0, 95))}) Tj`, index === lines.length - 1 ? "" : "0 -14 Td"])
      .filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output);
}

async function ensureRequestedWorkspaceFiles(args: {
  input: AgentWorkspaceRunInput;
  outputDir: string;
  reportMarkdown: string;
  results: Record<string, unknown>;
  files: AgentWorkspaceRunResult["files"];
}): Promise<void> {
  const filenames = new Set(args.files.map((file) => file.filename.toLowerCase()));
  if (!filenames.has("results.json")) {
    await writeFile(join(args.outputDir, "results.json"), JSON.stringify(args.results, null, 2), "utf-8");
  }
  if (!filenames.has("report.md")) {
    await writeFile(join(args.outputDir, "report.md"), args.reportMarkdown, "utf-8");
  }
  const requested = requestedWorkspaceOutputExtensions(args.input);
  if (requested.includes("csv") && !args.files.some((file) => file.filename.toLowerCase().endsWith(".csv"))) {
    const rows = [["field", "value"], ...flattenResultsRows(args.results).slice(0, 500)];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    await writeFile(join(args.outputDir, "results_export.csv"), csv, "utf-8");
  }
  if (requested.includes("pdf") && !args.files.some((file) => file.filename.toLowerCase().endsWith(".pdf"))) {
    const lines = args.reportMarkdown.replace(/\s+/g, " ").match(/.{1,90}(?:\s|$)/g)?.slice(0, 48) || [args.reportMarkdown.slice(0, 1800)];
    await writeFile(join(args.outputDir, "report.pdf"), simpleWorkspacePdfBytes(lines));
  }
}

function extractGeneratedPython(raw: string, parsed?: Record<string, unknown> | null): string {
  const direct = findGeneratedPythonInValue(parsed, true);
  if (direct) return direct;
  for (const key of ["code", "python", "script", "source", "python_code", "executable_python", "analysis_code", "main_py"]) {
    const value = parsed?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const fenced = raw.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const trimmed = raw.trim();
  if (/^\s*(?:import|from|#|OUTPUT_DIR|WORK_DIR|INPUT_DIR)\b/m.test(trimmed) && /\bwrite_(?:markdown|json|csv|xlsx|pdf)\b/.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function looksLikeExecutablePython(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const hasPythonStart = /^\s*(?:import|from|def|class|#|OUTPUT_DIR|WORK_DIR|INPUT_DIR|docs?\s*=|data\s*=|rows?\s*=)\b/m.test(text);
  const hasWorkspaceOutput = /\bwrite_(?:markdown|json|csv|xlsx|pdf)\s*\(|\bopen\s*\([^)]*OUTPUT_DIR|\bFPDF\s*\(/.test(text);
  return hasPythonStart && hasWorkspaceOutput;
}

function findGeneratedPythonInValue(value: unknown, trustedKey = false, depth = 0): string {
  if (depth > 4 || value == null) return "";
  if (typeof value === "string") {
    const text = value.trim();
    return text && (trustedKey || looksLikeExecutablePython(text)) ? text : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGeneratedPythonInValue(item, false, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["code", "python", "script", "source", "content", "text", "python_code", "executable_python", "analysis_code", "main_py"]) {
    const found = findGeneratedPythonInValue(record[key], key !== "content" && key !== "text", depth + 1);
    if (found) return found;
  }
  for (const item of Object.values(record)) {
    const found = findGeneratedPythonInValue(item, false, depth + 1);
    if (found) return found;
  }
  return "";
}

export function repairGeneratedPython(code: string): string {
  let repaired = (code || "").trim()
    .replace(/^```(?:python)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!/^\s*import\s+os\b/m.test(repaired)) {
    repaired = `import os\n${repaired}`;
  }
  const outputAssignment = /^(OUTPUT_DIR|OUTPUTDIR)\s*=\s*['"][^'"]*['"].*$/m;
  const outputLine = 'OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "outputs")\nos.makedirs(OUTPUT_DIR, exist_ok=True)';
  if (outputAssignment.test(repaired)) {
    repaired = repaired.replace(outputAssignment, outputLine);
  } else {
    repaired = repaired.replace(/^(\s*import\s+os\b.*)$/m, `$1\n${outputLine}`);
  }
  repaired = repaired
    .replace(/^(INPUT_DIR|INPUTDIR)\s*=\s*['"][^'"]*['"].*$/m, 'INPUT_DIR = os.environ.get("INPUT_DIR", "inputs")')
    .replace(/^(WORK_DIR|WORKDIR)\s*=\s*['"][^'"]*['"].*$/m, 'WORK_DIR = os.environ.get("WORK_DIR", os.getcwd())');
  repaired = repaired
    .replace(/\btemperature\.pvwatts_cell\s*\(/g, "pvlib_cell_temperature(")
    .replace(/\btemperature\.sapm_celltemp\s*\(/g, "pvlib_cell_temperature(")
    .replace(/\btemperature\.sapm_cell\(\s*([A-Za-z_][\w.]*)\s*,\s*([A-Za-z_][\w.]*)\s*,\s*([A-Za-z_][\w.]*)\s*\)/g, "pvlib_cell_temperature($1, $2, $3)");
  if (/\bpvlib_cell_temperature\s*\(/.test(repaired) && !/\bfrom\s+agent_workspace_helpers\s+import\b[^\n]*\bpvlib_cell_temperature\b/.test(repaired)) {
    if (/\bfrom\s+agent_workspace_helpers\s+import\s+/.test(repaired)) {
      repaired = repaired.replace(/^(from\s+agent_workspace_helpers\s+import\s+[^\n]+)$/m, "$1, pvlib_cell_temperature");
    } else {
      repaired = `from agent_workspace_helpers import pvlib_cell_temperature\n${repaired}`;
    }
  }
  return repaired;
}

export function sanitizePythonRequirements(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const configured = (getEnvVar("EXERGY_AGENT_ALLOWED_PIP_PACKAGES") || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const allowed = configured.length > 0 ? new Set(configured) : DEFAULT_ALLOWED_PACKAGES;
  const clean: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const req = value.trim().toLowerCase();
    if (!/^[a-z0-9_.-]+([<>=!~]=?[a-z0-9*_.+-]+)?$/.test(req)) continue;
    const packageName = req.split(/[<>=!~]/)[0];
    if (!allowed.has(packageName)) continue;
    if (!clean.includes(req)) clean.push(req);
    if (clean.length >= 12) break;
  }
  return clean;
}

function dependencyInstallAllowed(input?: boolean): boolean {
  if (input === false) return false;
  const env = getEnvVar("EXERGY_AGENT_ALLOW_DEPENDENCY_INSTALL");
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  return !process.env.VERCEL;
}

function networkAllowed(input?: boolean): boolean {
  if (input === false) return false;
  const env = getEnvVar("EXERGY_AGENT_ALLOW_NETWORK");
  if (env === "0" || env === "false") return false;
  return input === true || env === "1" || env === "true";
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 3000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function containerImageAvailable(runtime: "docker" | "podman", image: string): Promise<boolean> {
  try {
    await execFileAsync(runtime, ["image", "inspect", image], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function containerPullPolicy(): string {
  return getEnvVar("EXERGY_AGENT_CONTAINER_PULL_POLICY") || "never";
}

function numericEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = getEnvVar(name);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function isPdfTextSidecarName(filename: string): boolean {
  return PDF_TEXT_SIDECAR_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}

function displayFilename(filename: string): string {
  for (const suffix of PDF_TEXT_SIDECAR_SUFFIXES) {
    if (filename.endsWith(suffix)) return filename.slice(0, -suffix.length);
  }
  return filename;
}

async function buildSandboxPolicy(input: AgentWorkspaceRunInput): Promise<SandboxPolicy> {
  const requestedMode = (getEnvVar("EXERGY_AGENT_SANDBOX_MODE") || "auto").toLowerCase();
  const preferPodman = (getEnvVar("EXERGY_AGENT_CONTAINER_RUNTIME") || "").toLowerCase() === "podman";
  const runtimes: Array<"docker" | "podman"> = preferPodman ? ["podman", "docker"] : ["docker", "podman"];
  const image = getEnvVar("EXERGY_AGENT_CONTAINER_IMAGE") || DEFAULT_AGENT_CONTAINER_IMAGE;
  const pullPolicy = containerPullPolicy();
  let containerRuntime: "docker" | "podman" | undefined;
  if (requestedMode !== "local") {
    for (const runtime of runtimes) {
      if (!await commandAvailable(runtime)) continue;
      const imageUsable = pullPolicy !== "never" || await containerImageAvailable(runtime, image);
      if (imageUsable) {
        containerRuntime = runtime;
        break;
      }
    }
  }
  const mode = (requestedMode === "container" && containerRuntime) || (requestedMode === "auto" && containerRuntime)
    ? "container"
    : "local_restricted";
  return {
    mode,
    containerRuntime: mode === "container" ? containerRuntime : undefined,
    containerImage: image,
    network: networkAllowed(input.allowNetwork),
    dependencyInstall: dependencyInstallAllowed(input.allowDependencyInstall),
    timeoutMs: Math.max(30_000, Math.min(input.timeoutMs || DEFAULT_TIMEOUT_MS, 15 * 60_000)),
    memoryMb: numericEnv("EXERGY_AGENT_MEMORY_MB", 2048, 512, 8192),
    cpuSeconds: numericEnv("EXERGY_AGENT_CPU_SECONDS", 300, 15, 900),
    maxFileBytes: numericEnv("EXERGY_AGENT_MAX_FILE_MB", 100, 1, 1024) * 1024 * 1024,
    maxFiles: numericEnv("EXERGY_AGENT_MAX_OUTPUT_FILES", MAX_FILES_IN_MANIFEST, 5, 500),
    maxInputFiles: numericEnv("EXERGY_AGENT_MAX_INPUT_FILES", 20, 1, 100),
  };
}

async function writeHelperModule(workDir: string) {
  await writeFile(join(workDir, "agent_workspace_helpers.py"), String.raw`
import csv
import html
import json
import os
import re
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", ".")).resolve()
INPUT_DIR = Path(os.environ.get("INPUT_DIR", ".")).resolve()
WORK_DIR = Path(os.environ.get("WORK_DIR", ".")).resolve()
MAX_OUTPUT_FILE_BYTES = int(os.environ.get("MAX_OUTPUT_FILE_BYTES", str(100 * 1024 * 1024)))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def safe_output_path(name):
    if not isinstance(name, (str, os.PathLike)):
        raise TypeError("output filename must be a string or path-like value")
    path = Path(str(name)).expanduser()
    if not path.is_absolute():
        path = OUTPUT_DIR / path
    path = path.resolve()
    if not str(path).startswith(str(OUTPUT_DIR)):
        raise ValueError("output path escapes OUTPUT_DIR")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path

def _with_default_suffix(name, suffix):
    path = Path(str(name))
    if path.suffix:
        return name
    return str(path.with_name(path.name + suffix))

def _is_output_dir_arg(value):
    try:
        return Path(str(value)).resolve() == OUTPUT_DIR
    except Exception:
        return False

def _looks_like_output_name(value):
    if isinstance(value, os.PathLike):
        return True
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not text or len(text) > 260:
        return False
    if _is_output_dir_arg(text):
        return True
    lower = text.lower()
    return "/" in text or "\\" in text or lower.endswith((".json", ".md", ".markdown", ".csv", ".xlsx", ".xls", ".pdf", ".png", ".txt", ".tsv"))

def _output_args(args, count, fn_name):
    values = list(args)
    if len(values) == count + 1 and _is_output_dir_arg(values[0]):
        values = values[1:]
    if count == 2 and len(values) == 2 and not _looks_like_output_name(values[0]) and _looks_like_output_name(values[1]):
        values = [values[1], values[0]]
    if len(values) != count:
        raise TypeError(f"{fn_name} expected {count} arguments, or OUTPUT_DIR plus {count} arguments")
    return values

def _check_output_size(path):
    if path.exists() and path.stat().st_size > MAX_OUTPUT_FILE_BYTES:
        raise ValueError(f"output file exceeds size limit: {path.name}")

def write_json(*args):
    name, data = _output_args(args, 2, "write_json")
    name = _with_default_suffix(name, ".json")
    path = safe_output_path(name)
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    _check_output_size(path)
    return str(path)

def write_markdown(*args):
    name, text = _output_args(args, 2, "write_markdown")
    name = _with_default_suffix(name, ".md")
    path = safe_output_path(name)
    path.write_text(str(text), encoding="utf-8")
    _check_output_size(path)
    return str(path)

def write_csv(*args):
    values = list(args)
    if len(values) == 4 and _is_output_dir_arg(values[0]):
        values = values[1:]
    if len(values) == 3 and not _looks_like_output_name(values[0]) and _looks_like_output_name(values[1]):
        name, headers, rows = values[1], values[0], values[2]
    elif len(values) == 3:
        name, headers, rows = values
    else:
        name, rows = _output_args(values, 2, "write_csv")
        headers = None
    name = _with_default_suffix(name, ".csv")
    path = safe_output_path(name)
    rows = list(rows or [])
    header_list = list(headers or []) if headers is not None and not isinstance(headers, str) else ([headers] if isinstance(headers, str) and headers else [])
    fieldnames = header_list or sorted({k for row in rows if isinstance(row, dict) for k in row.keys()})
    with path.open("w", newline="", encoding="utf-8") as f:
        if fieldnames:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                if isinstance(row, dict):
                    writer.writerow({field: row.get(field, "") for field in fieldnames})
                else:
                    values = list(row) if isinstance(row, (list, tuple)) else [row]
                    writer.writerow({field: values[index] if index < len(values) else "" for index, field in enumerate(fieldnames)})
        else:
            writer = csv.writer(f)
            writer.writerows(rows)
    _check_output_size(path)
    return str(path)

def _xml(text):
    return html.escape("" if text is None else str(text))

def write_xlsx(*args, sheet_name="Sheet1"):
    values = list(args)
    if len(values) >= 3 and _is_output_dir_arg(values[0]):
        values = values[1:]
    if len(values) in (2, 3) and not _looks_like_output_name(values[0]) and _looks_like_output_name(values[1]):
        values = [values[1], values[0], *values[2:]]
    headers = None
    if len(values) == 4:
        name, headers, rows, sheet_name = values
    elif len(values) == 3 and isinstance(values[2], (list, tuple)):
        name, headers, rows = values
    elif len(values) == 3 and _looks_like_output_name(values[0]) and isinstance(values[1], (list, tuple)) and values[1] and not isinstance(values[1][0], (dict, list, tuple)):
        name, headers, rows = values
    elif len(values) == 3:
        name, rows, sheet_name = values
    elif len(values) == 2:
        name, rows = values
    else:
        raise TypeError("write_xlsx expected name and rows, optionally with headers, sheet_name, or OUTPUT_DIR")
    name = _with_default_suffix(name, ".xlsx")
    path = safe_output_path(name)
    rows = list(rows or [])
    if headers is not None:
        headers = list(headers)
        matrix = [headers]
        for row in rows:
            if isinstance(row, dict):
                matrix.append([row.get(h, "") for h in headers])
            else:
                values = list(row) if isinstance(row, (list, tuple)) else [row]
                matrix.append(values)
    elif rows and isinstance(rows[0], dict):
        headers = sorted({k for row in rows for k in row.keys()})
        matrix = [headers] + [[row.get(h, "") for h in headers] for row in rows]
    else:
        matrix = rows
    cells = []
    for r_idx, row in enumerate(matrix, start=1):
        cell_xml = []
        for c_idx, value in enumerate(row, start=1):
            col = ""
            n = c_idx
            while n:
                n, rem = divmod(n - 1, 26)
                col = chr(65 + rem) + col
            ref = f"{col}{r_idx}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                cell_xml.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cell_xml.append(f'<c r="{ref}" t="inlineStr"><is><t>{_xml(value)}</t></is></c>')
        cells.append(f'<row r="{r_idx}">{"".join(cell_xml)}</row>')
    sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(cells) + "</sheetData></worksheet>"
    workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + _xml(sheet_name)[:31] + '" sheetId="1" r:id="rId1"/></sheets></workbook>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    _check_output_size(path)
    return str(path)

def write_pdf(*args):
    name, text = _output_args(args, 2, "write_pdf")
    name = _with_default_suffix(name, ".pdf")
    path = safe_output_path(name)
    lines = []
    for raw in str(text).splitlines():
        line = raw.strip()
        while len(line) > 92:
            lines.append(line[:92])
            line = line[92:]
        lines.append(line)
    lines = lines[:65]
    content_lines = ["BT", "/F1 10 Tf", "50 760 Td", "14 TL"]
    for line in lines:
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content_lines.append(f"({escaped}) Tj")
        content_lines.append("T*")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1", "replace")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
        b"5 0 obj << /Length " + str(len(stream)).encode() + b" >> stream\n" + stream + b"\nendstream endobj\n",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode())
    pdf.extend(f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(bytes(pdf))
    _check_output_size(path)
    return str(path)

writejson = write_json
writemarkdown = write_markdown
writecsv = write_csv
writexlsx = write_xlsx
writepdf = write_pdf

def fetch_url(url, timeout=20):
    if os.environ.get("AGENT_ALLOW_NETWORK") != "1":
        raise RuntimeError("network access is disabled for this run")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("only http and https URLs are allowed")
    with urllib.request.urlopen(url, timeout=timeout) as res:
        return res.read(1000000).decode("utf-8", "replace")

def search_github_repositories(query, limit=5):
    q = urllib.parse.quote(query)
    url = f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page={int(limit)}"
    data = json.loads(fetch_url(url))
    return [{"name": item.get("full_name"), "url": item.get("html_url"), "stars": item.get("stargazers_count"), "description": item.get("description")} for item in data.get("items", [])]

def search_huggingface_models(query, limit=5):
    q = urllib.parse.quote(query)
    url = f"https://huggingface.co/api/models?search={q}&limit={int(limit)}"
    data = json.loads(fetch_url(url))
    return [{"id": item.get("modelId") or item.get("id"), "downloads": item.get("downloads"), "likes": item.get("likes"), "pipeline_tag": item.get("pipeline_tag")} for item in data]

def extract_text(path):
    path = Path(path)
    path_suffix = path.suffix.lower()
    candidates = []
    for sidecar_suffix in (".gemini.md", ".mineru.md"):
        sidecar_md = Path(str(path) + sidecar_suffix)
        if sidecar_md.exists():
            text = sidecar_md.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                candidates.append(text)
    for sidecar_suffix in (".gemini.json", ".mineru.json"):
        sidecar_json = Path(str(path) + sidecar_suffix)
        if sidecar_json.exists():
            try:
                data = json.loads(sidecar_json.read_text(encoding="utf-8", errors="replace"))
                for key in ("markdown", "text", "content", "raw_output"):
                    if isinstance(data.get(key), str) and data.get(key).strip():
                        candidates.append(data.get(key).strip())
            except Exception:
                pass
    if path_suffix == ".pdf":
        try:
            import fitz
            parts = []
            with fitz.open(str(path)) as doc:
                for page in doc:
                    parts.append(page.get_text("text"))
            text = "\n".join(parts).strip()
            if text:
                candidates.append(text)
        except Exception:
            pass
        try:
            from pypdf import PdfReader
            reader = PdfReader(str(path))
            text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
            if text:
                candidates.append(text)
        except Exception:
            pass
        if candidates:
            return max(candidates, key=len)
        return ""
    if candidates:
        return max(candidates, key=len)
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""

def extract_all_input_documents():
    files = json.loads(os.environ.get("INPUT_FILES", "[]"))
    docs = []
    for item in files:
        filename = item.get("filename") or ""
        path = item.get("path") or ""
        if not path or filename.endswith((".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json")):
            continue
        text = extract_text(path)
        docs.append({"filename": filename, "path": path, "text": text, "characters": len(text)})
    return docs

def extract_all_input_texts():
    return [doc.get("text", "") for doc in extract_all_input_documents() if doc.get("text")]

extract_all_input_records = extract_all_input_documents

class _AttrDict(dict):
    """Dict with attribute access for generated workspace code compatibility."""
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    @staticmethod
    def wrap(value):
        if isinstance(value, dict) and not isinstance(value, _AttrDict):
            return _AttrDict({key: _AttrDict.wrap(item) for key, item in value.items()})
        if isinstance(value, list):
            return [_AttrDict.wrap(item) for item in value]
        return value

def extract_numeric_evidence(text, limit=160):
    """Return numbers with nearby context. This is intentionally domain-neutral."""
    text = "" if text is None else str(text)
    unit = r"(?:%|percent|W|Wh|kW|MW|GW|kWh|MWh|GWh|Btu/kWh|MMBtu|kg|g|t|tonne|tonnes|tons|tpy|tpd|bpd|gpd|L|lpm|m3|m3/day|m3/d|bar|psi|Pa|kPa|MPa|°C|degC|C|K|V|A|mA/cm2|USD|\\$|/year|per year|/MWh|/kg|/bbl|/kW|/kWh)"
    pattern = re.compile(rf"(?P<value>\\$?\\b-?\\d+(?:\\.\\d+)?(?:,\\d{{3}})*\\b)\\s*(?P<unit>{unit})?", re.I)
    rows = []
    for match in pattern.finditer(text):
        start = max(0, match.start() - 120)
        end = min(len(text), match.end() + 140)
        rows.append({
            "value": match.group("value"),
            "unit": match.group("unit") or "",
            "context": re.sub(r"\\s+", " ", text[start:end]).strip(),
        })
        if len(rows) >= limit:
            break
    return rows

def extract_markdown_tables(text):
    text = "" if text is None else str(text)
    tables = []
    current = []
    for line in text.splitlines():
        if "|" in line:
            current.append(line)
            continue
        if current:
            if len(current) >= 2:
                tables.append(current)
            current = []
    if current and len(current) >= 2:
        tables.append(current)

    parsed = []
    for lines in tables:
        matrix = []
        for line in lines:
            cells = [re.sub(r"\\s+", " ", cell.strip()) for cell in line.strip().strip("|").split("|")]
            if cells and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells if cell):
                continue
            if any(cells):
                matrix.append(cells)
        if len(matrix) < 2:
            continue
        headers = matrix[0]
        rows = []
        for row in matrix[1:]:
            padded = row + [""] * max(0, len(headers) - len(row))
            rows.append({headers[i] or f"Column {i + 1}": padded[i] if i < len(padded) else "" for i in range(len(headers))})
        parsed.append({"headers": headers, "rows": rows, "raw": "\\n".join(lines)})
    return parsed

def load_tabular_inputs(max_rows=5000):
    """Read CSV/TSV/JSON/YAML inputs into records without requiring pandas."""
    records = []
    for item in json.loads(os.environ.get("INPUT_FILES", "[]")):
        filename = item.get("filename") or ""
        path = Path(item.get("path") or "")
        if not path.exists() or filename.endswith((".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json")):
            continue
        lower = filename.lower()
        try:
            if lower.endswith(".csv") or lower.endswith(".tsv"):
                dialect = "excel-tab" if lower.endswith(".tsv") else "excel"
                with path.open(newline="", encoding="utf-8", errors="replace") as f:
                    for idx, row in enumerate(csv.DictReader(f, dialect=dialect)):
                        if idx >= max_rows:
                            break
                        records.append({"filename": filename, **dict(row)})
            elif lower.endswith(".json"):
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
                values = data if isinstance(data, list) else data.get("rows", []) if isinstance(data, dict) else []
                for row in values[:max_rows]:
                    records.append({"filename": filename, **row} if isinstance(row, dict) else {"filename": filename, "value": row})
            elif lower.endswith((".yaml", ".yml")):
                try:
                    import yaml
                except Exception as exc:
                    records.append({"filename": filename, "error": f"PyYAML is not installed: {exc}"})
                    continue
                data = yaml.safe_load(path.read_text(encoding="utf-8", errors="replace"))
                values = data if isinstance(data, list) else []
                if isinstance(data, dict):
                    for candidate in data.values():
                        if isinstance(candidate, list):
                            values = candidate
                            break
                for row in values[:max_rows]:
                    records.append({"filename": filename, **row} if isinstance(row, dict) else {"filename": filename, "value": row})
        except Exception as exc:
            records.append({"filename": filename, "error": str(exc)})
    return records

def summarize_documents(docs=None, max_chars_per_doc=1200):
    docs = docs if docs is not None else extract_all_input_documents()
    summary = []
    for doc in docs:
        text = re.sub(r"\\s+", " ", doc.get("text", "")).strip()
        summary.append({
            "filename": doc.get("filename", ""),
            "characters": doc.get("characters", len(text)),
            "preview": text[:max_chars_per_doc],
            "numeric_evidence": extract_numeric_evidence(text, limit=30),
            "table_count": len(extract_markdown_tables(text)),
        })
    return summary

def capital_recovery_factor(rate, years):
    rate = float(rate)
    years = float(years)
    if years <= 0:
        return 0
    if abs(rate) < 1e-9:
        return 1 / years
    return rate * (1 + rate) ** years / ((1 + rate) ** years - 1)

def npv(rate, cashflows):
    return sum(float(value) / ((1 + float(rate)) ** index) for index, value in enumerate(cashflows))

def irr(cashflows, low=-0.95, high=1.0):
    def value(rate):
        return npv(rate, cashflows)
    try:
        if value(low) * value(high) > 0:
            return None
        for _ in range(100):
            mid = (low + high) / 2
            if value(low) * value(mid) <= 0:
                high = mid
            else:
                low = mid
        return (low + high) / 2
    except Exception:
        return None

def financial_metrics(initial_capex, annual_revenue, annual_opex, discount_rate=0.08, life_years=20, construction_years=0):
    initial_capex = float(initial_capex)
    annual_cash = float(annual_revenue) - float(annual_opex)
    cashflows = [-initial_capex] + [0.0] * int(construction_years) + [annual_cash] * int(life_years)
    project_irr = irr(cashflows)
    payback = None if annual_cash <= 0 else initial_capex / annual_cash + float(construction_years)
    return {
        "annual_cashflow": annual_cash,
        "npv": npv(float(discount_rate), cashflows),
        "irr": project_irr,
        "payback_years": payback,
        "crf": capital_recovery_factor(float(discount_rate), int(life_years)),
    }

def _pvlib_timezone_from_longitude(lon):
    try:
        offset = int(round(float(lon) / 15.0))
        offset = max(-12, min(14, offset))
        if offset == 0:
            return "UTC"
        return f"Etc/GMT{-offset:+d}"
    except Exception:
        return "UTC"

def pvlib_cell_temperature(poa_global, temp_air=25.0, wind_speed=1.0, module_efficiency=0.18):
    """Version-stable pvlib cell-temperature helper.

    Generated code should use this instead of calling pvlib.temperature.pvwatts_cell
    or older sapm_celltemp APIs directly. It returns a scalar or pandas Series
    matching poa_global.
    """
    try:
        from pvlib import temperature
        params = getattr(temperature, "TEMPERATURE_MODEL_PARAMETERS", {}).get("sapm", {}).get("open_rack_glass_glass")
        if params:
            return temperature.sapm_cell(poa_global, temp_air, wind_speed, **params)
        return temperature.pvsyst_cell(
            poa_global,
            temp_air,
            wind_speed,
            module_efficiency=float(module_efficiency or 0.18),
            alpha_absorption=0.9,
        )
    except Exception:
        try:
            from pvlib import temperature
            return temperature.pvsyst_cell(
                poa_global,
                temp_air,
                wind_speed,
                u_c=29.0,
                u_v=0.0,
                module_efficiency=float(module_efficiency or 0.18),
                alpha_absorption=0.9,
            )
        except Exception:
            return temp_air + (poa_global / 800.0) * (45.0 - 20.0) * (1.0 - float(module_efficiency or 0.18) / 0.9)

def pvlib_fixed_tilt_day(
    latitude,
    longitude,
    pdc0_w,
    gamma_pdc_per_c=-0.0037,
    date="2023-03-20",
    tz=None,
    tilt_deg=None,
    azimuth_deg=180,
    albedo=0.2,
    temp_air_c=25.0,
    wind_speed_mps=1.0,
    inverter_efficiency=0.96,
    system_losses=0.14,
    module_efficiency=0.18,
    linke_turbidity=3,
):
    """Run a compact clear-sky fixed-tilt PV day with stable pvlib calls."""
    latitude = float(latitude)
    longitude = float(longitude)
    pdc0_w = float(pdc0_w)
    gamma_pdc_per_c = float(gamma_pdc_per_c)
    if abs(gamma_pdc_per_c) > 0.05:
        gamma_pdc_per_c = gamma_pdc_per_c / 100.0
    tz = tz or _pvlib_timezone_from_longitude(longitude)
    tilt_deg = float(latitude if tilt_deg is None else tilt_deg)
    azimuth_deg = float(azimuth_deg)
    try:
        import pandas as pd
        from pvlib import irradiance, location, pvsystem

        loc = location.Location(latitude, longitude, tz=tz)
        times = pd.date_range(f"{date} 00:00:00", f"{date} 23:00:00", freq="1h", tz=tz)
        solar_position = loc.get_solarposition(times)
        clearsky = loc.get_clearsky(times, model="ineichen", linke_turbidity=linke_turbidity)
        poa = irradiance.get_total_irradiance(
            tilt_deg,
            azimuth_deg,
            solar_position["apparent_zenith"],
            solar_position["azimuth"],
            clearsky["dni"],
            clearsky["ghi"],
            clearsky["dhi"],
            albedo=float(albedo),
        )
        poa_global = poa["poa_global"].clip(lower=0)
        cell_temp = pvlib_cell_temperature(
            poa_global,
            temp_air=float(temp_air_c),
            wind_speed=float(wind_speed_mps),
            module_efficiency=float(module_efficiency or 0.18),
        )
        dc_power = pvsystem.pvwatts_dc(poa_global, cell_temp, pdc0_w, gamma_pdc_per_c).clip(lower=0)
        ac_power = dc_power * float(inverter_efficiency) * (1.0 - float(system_losses))
        hourly = []
        for timestamp, poa_value, temp_value, dc_value, ac_value in zip(times, poa_global, cell_temp, dc_power, ac_power):
            hourly.append({
                "time": timestamp.isoformat(),
                "poa_irradiance_w_m2": round(float(poa_value), 2),
                "poa": round(float(poa_value), 2),
                "cell_temperature_c": round(float(temp_value), 2),
                "cell_temp": round(float(temp_value), 2),
                "dc_power_w": round(float(dc_value), 2),
                "dc_power": round(float(dc_value), 2),
                "ac_power_w": round(float(ac_value), 2),
                "ac_power": round(float(ac_value), 2),
            })
        summary = {
            "latitude": latitude,
            "longitude": longitude,
            "date": str(date),
            "timezone": tz,
            "tilt_deg": tilt_deg,
            "azimuth_deg": azimuth_deg,
            "stc_peak_power_w": round(pdc0_w, 2),
            "peak_dc_power_w": round(float(dc_power.max()), 2),
            "peak_ac_power_w": round(float(ac_power.max()), 2),
            "daily_dc_energy_kwh": round(float(dc_power.sum()) / 1000.0, 4),
            "daily_ac_energy_kwh": round(float(ac_power.sum()) / 1000.0, 4),
            "max_cell_temperature_c": round(float(cell_temp.max()), 2),
            "total_poa_irradiation_kwh_m2": round(float(poa_global.sum()) / 1000.0, 4),
            "model": "pvlib clear-sky fixed-tilt hourly model",
        }
        return _AttrDict.wrap({
            "summary": summary,
            "hourly": hourly,
            "peak_power_w": summary["peak_dc_power_w"],
            "peak_dc_power_w": summary["peak_dc_power_w"],
            "peak_ac_power_w": summary["peak_ac_power_w"],
            "daily_energy_wh": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_energy": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_ac_energy_wh": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_ac_energy_kwh": summary["daily_ac_energy_kwh"],
            "daily_dc_energy_kwh": summary["daily_dc_energy_kwh"],
        })
    except Exception:
        import math
        try:
            day = int(str(date)) if str(date).isdigit() else int(str(date).split("-")[1]) * 30
        except Exception:
            day = 172
        decl = math.radians(23.45 * math.sin(math.radians(360 * (284 + day) / 365.0)))
        lat_rad = math.radians(latitude)
        tilt_rad = math.radians(tilt_deg)
        hourly = []
        poa_values = []
        cell_values = []
        dc_values = []
        ac_values = []
        for hour in range(24):
            ha = math.radians((hour - 12) * 15)
            cos_zen = math.sin(lat_rad) * math.sin(decl) + math.cos(lat_rad) * math.cos(decl) * math.cos(ha)
            cos_zen = max(0.0, min(1.0, cos_zen))
            # South-facing fixed-tilt approximation for northern hemisphere.
            cos_inc = math.sin(decl) * math.sin(lat_rad - tilt_rad) + math.cos(decl) * math.cos(lat_rad - tilt_rad) * math.cos(ha)
            cos_inc = max(0.0, min(1.0, cos_inc))
            dni = 900.0 * (cos_zen ** 0.25) if cos_zen > 0 else 0.0
            diffuse = 100.0 * cos_zen
            reflected = 1000.0 * float(albedo) * (1 - math.cos(tilt_rad)) / 2.0 * cos_zen
            poa_value = max(0.0, dni * cos_inc + diffuse * (1 + math.cos(tilt_rad)) / 2.0 + reflected)
            temp_value = float(temp_air_c) + (poa_value / 800.0) * (45.0 - 20.0) * (1.0 - float(module_efficiency or 0.18) / 0.9)
            dc_value = max(0.0, pdc0_w * (poa_value / 1000.0) * (1 + gamma_pdc_per_c * (temp_value - 25.0)))
            ac_value = dc_value * float(inverter_efficiency) * (1.0 - float(system_losses))
            poa_values.append(poa_value)
            cell_values.append(temp_value)
            dc_values.append(dc_value)
            ac_values.append(ac_value)
            hourly.append({
                "time": f"{hour:02d}:00",
                "poa_irradiance_w_m2": round(float(poa_value), 2),
                "poa": round(float(poa_value), 2),
                "cell_temperature_c": round(float(temp_value), 2),
                "cell_temp": round(float(temp_value), 2),
                "dc_power_w": round(float(dc_value), 2),
                "dc_power": round(float(dc_value), 2),
                "ac_power_w": round(float(ac_value), 2),
                "ac_power": round(float(ac_value), 2),
            })
        summary = {
            "latitude": latitude,
            "longitude": longitude,
            "date": str(date),
            "timezone": tz,
            "tilt_deg": tilt_deg,
            "azimuth_deg": azimuth_deg,
            "stc_peak_power_w": round(pdc0_w, 2),
            "peak_dc_power_w": round(max(dc_values) if dc_values else 0.0, 2),
            "peak_ac_power_w": round(max(ac_values) if ac_values else 0.0, 2),
            "daily_dc_energy_kwh": round(sum(dc_values) / 1000.0, 4),
            "daily_ac_energy_kwh": round(sum(ac_values) / 1000.0, 4),
            "max_cell_temperature_c": round(max(cell_values) if cell_values else float(temp_air_c), 2),
            "total_poa_irradiation_kwh_m2": round(sum(poa_values) / 1000.0, 4),
            "model": "standard-library clear-sky fixed-tilt approximation",
        }
        return _AttrDict.wrap({
            "summary": summary,
            "hourly": hourly,
            "peak_power_w": summary["peak_dc_power_w"],
            "peak_dc_power_w": summary["peak_dc_power_w"],
            "peak_ac_power_w": summary["peak_ac_power_w"],
            "daily_energy_wh": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_energy": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_ac_energy_wh": round(summary["daily_ac_energy_kwh"] * 1000.0, 2),
            "daily_ac_energy_kwh": summary["daily_ac_energy_kwh"],
            "daily_dc_energy_kwh": summary["daily_dc_energy_kwh"],
        })
`, "utf-8");
  await writeFile(join(workDir, "fpdf.py"), String.raw`
from agent_workspace_helpers import write_pdf

class FPDF:
    def __init__(self, *args, **kwargs):
        self._lines = []

    def add_page(self, *args, **kwargs):
        return None

    def set_font(self, *args, **kwargs):
        return None

    def cell(self, *args, **kwargs):
        text = kwargs.get("txt", "")
        if len(args) >= 3:
            text = args[2]
        if text is not None:
            self._lines.append(str(text))

    def multi_cell(self, *args, **kwargs):
        text = kwargs.get("txt", "")
        if len(args) >= 3:
            text = args[2]
        if text is not None:
            self._lines.extend(str(text).splitlines() or [str(text)])

    def ln(self, *args, **kwargs):
        self._lines.append("")

    def output(self, name="output.pdf", *args, **kwargs):
        return write_pdf(name or "output.pdf", "\n".join(self._lines))
`, "utf-8");
}

export function fallbackPython(task: string): string {
  return `
import json
import os
import re
from agent_workspace_helpers import extract_all_input_documents, write_csv, write_json, write_markdown, write_pdf, write_xlsx

task = ${JSON.stringify(task)}
input_files = json.loads(os.environ.get("INPUT_FILES", "[]"))
SIDECARE_SUFFIXES = (".gemini.md", ".gemini.json", ".mineru.md", ".mineru.json")

def _visible_inputs():
    return [
        {"filename": item.get("filename"), "path": item.get("path"), "bytes": item.get("bytes")}
        for item in input_files
        if not str(item.get("filename", "")).endswith(SIDECARE_SUFFIXES)
    ]

def _clean_cell(value):
    value = re.sub(r"<[^>]+>", "", str(value or ""))
    value = value.replace("**", "").replace(chr(96), "").strip()
    return re.sub(r"\\s+", " ", value)

def _is_separator_row(cells):
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells if cell)

def _markdown_tables(text):
    tables = []
    current = []
    before = []
    for line in text.splitlines():
        if "|" in line and not re.match(r"^\\s*(TASK|CONTEXT|USER|ASSISTANT):\\s*$", line, flags=re.I):
            current.append(line)
            continue
        if current:
            if len(current) >= 2 and any("---" in row for row in current[:3]):
                tables.append({"before": "\\n".join(before[-4:]), "lines": current[:]})
            current = []
        if line.strip():
            before.append(line.strip())
            before = before[-8:]
    if current and len(current) >= 2 and any("---" in row for row in current[:3]):
        tables.append({"before": "\\n".join(before[-4:]), "lines": current[:]})
    return tables

def _parse_markdown_table(lines):
    matrix = []
    for line in lines:
        if "|" not in line:
            continue
        cells = [_clean_cell(cell) for cell in line.strip().strip("|").split("|")]
        if _is_separator_row(cells):
            continue
        if any(cells):
            matrix.append(cells)
    if len(matrix) < 2:
        return [], ""
    headers = matrix[0]
    rows = []
    for row in matrix[1:]:
        padded = row + [""] * max(0, len(headers) - len(row))
        rows.append({headers[i] or f"Column {i + 1}": padded[i] if i < len(padded) else "" for i in range(len(headers))})
    return rows, "\\n".join(lines)

def _choose_prior_table(task_text):
    request_head = task_text.split("Recent conversation and prior results:")[0]
    requested_terms = set(re.findall(r"\\b(lcoe|npv|irr|payback|sensitivity|scenario|assumption|cost|price|production|output|capacity|table|comparison)\\b", request_head, flags=re.I))
    best = None
    for table in _markdown_tables(task_text):
        rows, markdown = _parse_markdown_table(table["lines"])
        if not rows:
            continue
        context = f"{table.get('before', '')}\\n{markdown}"
        score = len(rows)
        for term in requested_terms:
            if re.search(rf"\\b{re.escape(term)}\\b", context, flags=re.I):
                score += 4
        candidate = {"score": score, "rows": rows, "markdown": markdown, "context": table.get("before", "")}
        if best is None or candidate["score"] >= best["score"]:
            best = candidate
    return best

def _is_export_or_table_followup(task_text):
    request_head = re.split(r"\\n\\s*CONTEXT:\\s*\\n|Recent conversation and prior results", task_text, flags=re.I)[0]
    asks_to_run_changed_scenario = bool(
        re.search(r"\\b(re-?run|rerun|run|simulate|calculate|recalculate|model|scenario\\s+analysis)\\b", request_head, flags=re.I)
        and re.search(r"\\b(lower|reduce|decrease|increase|raise|change|changed|scenario|sensitivity|hold(?:ing)?\\s+all\\s+other|all\\s+other[\\s\\S]{0,80}constant)\\b", request_head, flags=re.I)
        and re.search(r"\\b(price|cost|capex|opex|efficiency|capacity\\s+factor|throughput|yield|production|utilization|degradation)\\b", request_head, flags=re.I)
    )
    if asks_to_run_changed_scenario:
        return False
    asks_for_prior_thing = bool(
        re.search(r"\\b(previous|prior|last|above|same)\\b[\\s\\S]{0,80}\\b(table|comparison|result|analysis|scenario|case|run|artifact|output|numbers?)\\b", request_head, flags=re.I)
        or re.search(r"\\b(that|this)\\b[\\s\\S]{0,40}\\b(table|comparison|result|analysis|scenario|case|run|artifact|output|numbers?)\\b", request_head, flags=re.I)
        or re.search(r"\\b(export|download|save|convert|recreate|extract)\\b[\\s\\S]{0,80}\\b(previous|prior|last|above|same)\\b", request_head, flags=re.I)
    )
    return bool(
        re.search(r"\\b(export|download|save|convert)\\b[\\s\\S]{0,100}\\b(csv|xlsx|excel|spreadsheet|pdf|report|markdown|md|json|file|download)\\b", request_head, flags=re.I)
        or re.search(r"\\b(create|generate|turn|make|write)\\b[\\s\\S]{0,100}\\b(csv|xlsx|excel|spreadsheet|pdf|markdown|md|json|downloadable\\s+file|file\\s+download)\\b", request_head, flags=re.I)
        or re.search(r"\\b(as|into|to)\\s+(?:a\\s+)?(?:csv|xlsx|excel|spreadsheet|pdf|markdown|md|json)\\b", request_head, flags=re.I)
        or (asks_for_prior_thing and re.search(r"\\b(show|give|extract|display|list|recreate)\\b", request_head, flags=re.I) and re.search(r"\\b(table|comparison|npv|irr|payback|sensitivity|assumptions?)\\b", request_head, flags=re.I))
    )

if _is_export_or_table_followup(task):
    chosen_table = _choose_prior_table(task)
    if chosen_table:
        stem = "exported_table"
        generated_files = []
        if re.search(r"\\bcsv\\b|comma[-\\s]?separated", task, flags=re.I):
            write_csv(f"{stem}.csv", chosen_table["rows"])
            generated_files.append(f"{stem}.csv")
        if re.search(r"\\bxlsx\\b|\\bexcel\\b|spreadsheet|workbook", task, flags=re.I):
            write_xlsx(f"{stem}.xlsx", chosen_table["rows"])
            generated_files.append(f"{stem}.xlsx")
        report = "# Exported Result\\n\\n"
        report += "I used the most recent matching table from the saved run context and preserved its values.\\n\\n"
        report += chosen_table["markdown"].strip() + "\\n"
        if re.search(r"\\bpdf\\b|report|memo|brief", task, flags=re.I):
            write_pdf(f"{stem}_report.pdf", report)
            generated_files.append(f"{stem}_report.pdf")
        if not generated_files:
            generated_files.append("report.md")
        write_markdown("report.md", report)
        write_json("results.json", {
            "summary": "Exported the requested prior table from saved run context.",
            "exported_files": generated_files,
            "rows": chosen_table["rows"],
            "model_not_run": True,
        })
        print(json.dumps({"status": "completed", "summary": "exported prior table", "files": generated_files}))
        raise SystemExit(0)

documents = extract_all_input_documents()
visible_inputs = _visible_inputs()
combined_text = "\\n\\n".join(f"## {doc.get('filename', 'input')}\\n{str(doc.get('text', ''))[:7000]}" for doc in documents if doc.get("text"))
numbers = []
for match in re.finditer(r"(?P<value>\\$?\\b\\d+(?:\\.\\d+)?(?:,\\d{3})*\\b)\\s*(?P<unit>kW|MW|GW|kWh|MWh|GWh|kg/h|kg|tonnes?|tons?|tpy|bpd|gpd|lpm|lph|psi|bar|C|K|USD|\\$|%|per year|/year)?", combined_text, flags=re.I):
    start = max(0, match.start() - 80)
    end = min(len(combined_text), match.end() + 120)
    numbers.append({
        "value": match.group("value"),
        "unit": match.group("unit") or "",
        "context": re.sub(r"\\s+", " ", combined_text[start:end]).strip(),
    })
numbers = numbers[:40]
signals = sorted(set(
    item.strip()
    for item in re.findall(r"\\b[A-Z][A-Z0-9]{2,}\\b|\\b(?:CAPEX|OPEX|NPV|IRR|LCOE|LCOH|efficiency|yield|conversion|selectivity|capacity|throughput|temperature|pressure|utilization|degradation|breakeven)\\b", combined_text, flags=re.I)
    if item.strip()
))[:24]

manifest_rows = [
    {"filename": item.get("filename"), "bytes": item.get("bytes"), "path": item.get("path")}
    for item in visible_inputs
]
write_csv("input_manifest.csv", manifest_rows)
write_xlsx("input_manifest.xlsx", manifest_rows)

report_lines = [
    "# Workspace Diagnostic",
    "",
    "The executable model did not run, so I am not presenting calculated results as completed analysis. This fallback preserves the source evidence, extracted numeric inputs, and the model structure that the next workspace tool run should execute.",
    "",
    "## Received Inputs",
]
if manifest_rows:
    report_lines.extend([f"- {row['filename']} ({max(1, round(float(row.get('bytes') or 0) / 1024))} KB)" for row in manifest_rows])
else:
    report_lines.append("- No uploaded files were available to the workspace.")
report_lines.extend([
    "",
    "## Extracted Numeric Inputs",
])
if numbers:
    report_lines.extend(["| Value | Unit | Context |", "|---:|---|---|"])
    for item in numbers[:20]:
        context = item["context"].replace("|", "/")[:180]
        report_lines.append(f"| {item['value']} | {item['unit'] or '-'} | {context} |")
else:
    report_lines.append("No reliable numeric operating table was available in the readable preview.")
report_lines.extend([
    "",
    "## Detected Technical Signals",
    ", ".join(signals) if signals else "No strong technical keywords were detected in the readable preview.",
    "",
    "## Model Structure To Run",
    "- Define the decision question, system boundary, unit basis, and time basis.",
    "- Convert uploaded evidence into a parameter table with source, value, unit, and confidence.",
    "- Build task-specific performance, physics, economics, or risk equations from those parameters.",
    "- Separate source-backed values from assumptions and run low/base/high cases where important values are missing.",
    "- Report final outputs with units, uncertainty drivers, and what the data cannot prove.",
    "",
    "## Why No Final Calculation Is Claimed",
    "A valid agent answer must come from a completed tool run or a direct model answer grounded in supplied context. This diagnostic exists so the UI can still show what was received and why the run needs another pass, without fabricating domain-specific results.",
])
report = "\\n".join(report_lines)
write_markdown("report.md", report)
write_json("results.json", {
    "summary": "Generic workspace diagnostic fallback. No domain-specific model was executed.",
    "model_not_run": True,
    "input_files": manifest_rows,
    "numeric_evidence": numbers,
    "technical_signals": signals,
})
print(json.dumps({"status": "completed", "summary": "generic diagnostic fallback", "model_not_run": True}))
`;
}


function extractNumericEvidence(text: string): Array<{ value: string; unit: string; context: string }> {
  const values: Array<{ value: string; unit: string; context: string }> = [];
  const pattern = /(\$?\b\d+(?:\.\d+)?(?:,\d{3})*\b)\s*(W|Wh|kW|MW|GW|kWh|MWh|GWh|kg\/h|kg|tonnes?|tpy|bpd|gpd|lpm|lph|m3\/day|m3\/d|m3|psi|bar|°C|degC|C|K|USD|\$|%|percent|per year|\/year)?/gi;
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, (match.index || 0) - 90);
    const end = Math.min(text.length, (match.index || 0) + match[0].length + 120);
    values.push({
      value: match[1] || match[0],
      unit: match[2] || "",
      context: text.slice(start, end).replace(/\s+/g, " ").trim(),
    });
    if (values.length >= 30) break;
  }
  return values;
}

async function readablePreviewFromCopiedFile(file: Record<string, unknown>): Promise<string> {
  const filename = typeof file.filename === "string" ? file.filename : "";
  const path = typeof file.path === "string" ? file.path : "";
  if (!path || !existsSync(path)) return "";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".gemini.md") || lower.endsWith(".mineru.md") || /\.(txt|md|csv|tsv|json|xml|yaml|yml)$/i.test(lower)) {
    const raw = await readFile(path, "utf-8").catch(() => "");
    if (!raw) return "";
    if (lower.endsWith(".json") || lower.endsWith(".gemini.json") || lower.endsWith(".mineru.json")) {
      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        for (const key of ["markdown", "text", "content", "raw_output"]) {
          if (typeof data[key] === "string" && data[key].trim()) return data[key].slice(0, 6000);
        }
      } catch {
        // Keep raw JSON preview below.
      }
    }
    return raw.slice(0, 6000);
  }
  return "";
}

async function buildExecutionFallbackReport(input: AgentWorkspaceRunInput, copiedFiles: Array<Record<string, unknown>>): Promise<string> {
  const previews: Array<{ filename: string; text: string }> = [];
  for (const file of copiedFiles) {
    const filename = typeof file.filename === "string" ? file.filename : "uploaded file";
    const text = await readablePreviewFromCopiedFile(file);
    if (text.trim()) previews.push({ filename: displayFilename(filename), text: text.trim() });
    if (previews.length >= 8) break;
  }
  const combined = previews.map((item) => item.text).join("\n\n");
  const numbers = extractNumericEvidence(combined);
  const keywords = Array.from(new Set((combined.match(/\b[A-Z][A-Z0-9]{2,}|FT|syngas|hydrogen|reactor|CAPEX|OPEX|breakeven|efficiency|conversion|selectivity|uptime|capacity\b/gi) || [])
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 2)))
    .slice(0, 16);
  const visibleFiles = copiedFiles
    .filter((file) => typeof file.filename === "string" && !isPdfTextSidecarName(String(file.filename)))
    .slice(0, 12)
    .map((file) => `- ${file.filename} (${Math.max(1, Math.round(Number(file.bytes || 0) / 1024))} KB)`);
  const lines = [
    "# Analysis Result",
    "",
    "I could not complete the executable workspace model, so I am not treating the requested calculation as successfully run. I preserved the readable source evidence below, extracted the usable numeric inputs, and separated what the file can support from what still needs data.",
    "",
    "## Requested analysis",
    input.task,
    input.context ? `\nRelevant run context:\n${input.context}` : "",
    "",
    "## What the package appears to cover",
    previews.length
      ? previews.map((item) => `- ${item.filename}: ${item.text.replace(/\s+/g, " ").slice(0, 260)}${item.text.length > 260 ? "..." : ""}`).join("\n")
      : "- The files were received, but no parser-ready text preview was available inside the execution workspace.",
    "",
    keywords.length ? `Key technical signals detected: ${keywords.join(", ")}.` : "",
    "",
    "## Extracted numeric inputs",
    numbers.length
      ? ["| Value | Unit | Context |", "|---:|---|---|", ...numbers.slice(0, 18).map((item) => `| ${item.value} | ${item.unit || "-"} | ${item.context.replace(/\|/g, "/").slice(0, 180)} |`)].join("\n")
      : "No reliable numeric operating table was available in the readable preview. The next pass should extract the governing performance, cost, boundary-condition, capacity, utilization, and price inputs for the user's requested analysis.",
    "",
    "## Model structure to run",
    "- Define the system boundary, operating basis, units, capacity basis, and reference environment.",
    "- Convert the uploaded evidence into a parameter table with source, value, unit, and confidence.",
    "- Build the requested physics, performance, environmental, or economic equations from those parameters.",
    "- Normalize outputs to the user's requested basis, such as hourly, daily, annual, per-unit, per-tonne, per-MWh, or per-dollar metrics.",
    "- Run low/base/high cases and sensitivities for the variables that control the result.",
    "",
    "## Economics model",
    "Generic breakeven form: required output = (annualized CAPEX + fixed OPEX) / ((realized value per unit - variable cost per unit) x utilization). Use the user's actual unit basis: MWh, kg, tonne, barrel, module, batch, operating hour, or project year.",
    "",
    "The correct scale or recommendation depends on what risk the user is trying to retire: technical feasibility, operations, permitting, financeability, product qualification, emissions, reliability, or commercial margin.",
    "",
    "## Recommendation",
    "Use this as a diagnostic package for the failed run: the next successful model should compute from the extracted parameter table and explicitly cite which values came from the upload versus which values are assumptions.",
    "",
    "## Inputs that usually control accuracy",
    "- System boundary and operating basis",
    "- Capacity, utilization, efficiency, yield, conversion, or throughput",
    "- Energy, material, water, emissions, labor, maintenance, and replacement inputs",
    "- CAPEX, fixed OPEX, variable OPEX, price or revenue basis, discount rate, and project life",
    "- Site constraints, permitting assumptions, degradation, uptime, reliability, and uncertainty range",
  ].filter((line) => line !== "").join("\n");

  return lines;
}

function workspaceFallbackTask(input: AgentWorkspaceRunInput, note?: string): string {
  return [
    input.task,
    input.context ? `CONTEXT:\n${input.context}` : "",
    input.requestedOutputs?.length ? `REQUESTED OUTPUTS: ${input.requestedOutputs.join(", ")}` : "",
    note || "",
  ].filter(Boolean).join("\n\n");
}

function isExportOrTableWorkspaceTask(text: string): boolean {
  const requestHead = text
    .split(/\n\s*CONTEXT:\s*\n/i)[0]
    .split(/\bRecent conversation and prior results\b/i)[0];
  const asksToRunChangedScenario =
    /\b(re-?run|rerun|run|simulate|calculate|recalculate|model|scenario\s+analysis)\b/i.test(requestHead) &&
    /\b(lower|reduce|decrease|increase|raise|change|changed|scenario|sensitivity|hold(?:ing)?\s+all\s+other|all\s+other[\s\S]{0,80}constant)\b/i.test(requestHead) &&
    /\b(electricity|power|price|cost|capex|opex|efficiency|capacity\s+factor|bop|balance-of-plant|product\s+value|product\s+price|stack|degradation)\b/i.test(requestHead);
  if (asksToRunChangedScenario) return false;
  const asksForPriorThing =
    /\b(previous|prior|last|above|same)\b[\s\S]{0,80}\b(table|comparison|result|analysis|scenario|case|run|artifact|output|numbers?)\b/i.test(requestHead) ||
    /\b(that|this)\b[\s\S]{0,40}\b(table|comparison|result|analysis|scenario|case|run|artifact|output|numbers?)\b/i.test(requestHead) ||
    /\b(export|download|save|convert|recreate|extract)\b[\s\S]{0,80}\b(previous|prior|last|above|same)\b/i.test(requestHead);
  return (
    /\b(export|download|save|convert)\b[\s\S]{0,100}\b(csv|xlsx|excel|spreadsheet|pdf|report|markdown|md|json|file|download)\b/i.test(requestHead) ||
    /\b(create|generate|turn|make|write)\b[\s\S]{0,100}\b(csv|xlsx|excel|spreadsheet|pdf|markdown|md|json|downloadable\s+file|file\s+download)\b/i.test(requestHead) ||
    /\b(as|into|to)\s+(?:a\s+)?(?:csv|xlsx|excel|spreadsheet|pdf|markdown|md|json)\b/i.test(requestHead) ||
    (asksForPriorThing && /\b(show|give|extract|display|list|recreate)\b/i.test(requestHead) && /\b(table|comparison|lcoe|npv|irr|payback|sensitivity|assumptions?)\b/i.test(requestHead))
  );
}

async function generatePythonForTask(input: AgentWorkspaceRunInput, copiedFiles: Array<Record<string, unknown>>): Promise<{ code: string; requirements: string[] }> {
  const apiAvailable = !!(getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY"));
  if (!apiAvailable) {
    throw new Error("The Exergy Lab Agent model is not configured, so the workspace tool cannot generate executable analysis code.");
  }
  const timeoutRaw = Number(getEnvVar("EXERGY_AGENT_CODEGEN_TIMEOUT_MS") || process.env.EXERGY_AGENT_CODEGEN_TIMEOUT_MS || 45_000);
  const codegenTimeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(10_000, Math.min(90_000, Math.trunc(timeoutRaw)))
    : 45_000;
  const sourcePreview = await sourcePreviewForSynthesis(copiedFiles);

  const prompt = [
    "Write a Python 3 script for a project-local agent workspace run. You are the planner and analyst for any technical, scientific, economic, or research domain the user requests.",
    "The script will run in WORK_DIR. It must write all outputs under OUTPUT_DIR.",
    "Available helper functions from agent_workspace_helpers: write_json, write_markdown, write_csv, write_xlsx, write_pdf, fetch_url, search_github_repositories, search_huggingface_models, extract_text, extract_all_input_texts, extract_all_input_documents, summarize_documents, extract_numeric_evidence, extract_markdown_tables, load_tabular_inputs, capital_recovery_factor, npv, irr, financial_metrics, pvlib_cell_temperature, pvlib_fixed_tilt_day.",
    "Output helper signatures: write_json(name, data); write_markdown(name, text); write_csv(name, rows) or write_csv(name, headers, rows); write_xlsx(name, rows) or write_xlsx(name, headers, rows); write_pdf(name, text). Underscore-free aliases such as writecsv and writepdf are also available.",
    "PV helper signatures: pvlib_fixed_tilt_day(latitude, longitude, pdc0_w, gamma_pdc_per_c=-0.0037, date=\"2023-03-20\", tz=None, tilt_deg=None, azimuth_deg=180, albedo=0.2, temp_air_c=25.0, wind_speed_mps=1.0, inverter_efficiency=0.96, system_losses=0.14, module_efficiency=0.18) and pvlib_cell_temperature(poa_global, temp_air=25.0, wind_speed=1.0, module_efficiency=0.18). The third argument is module STC power in W, not a day number. pvlib_fixed_tilt_day returns summary, hourly, and top-level aliases including peak_power_w, daily_energy_wh, daily_ac_energy_kwh, poa, cell_temp, dc_power, and ac_power.",
    "Always create report.md and results.json. Create CSV/XLSX/PDF/PNG outputs when useful or requested.",
    "If the user requested a specific output type, create that file type when feasible. If it is not feasible, write a Completion Notes section explaining exactly which requested output is missing and why.",
    "Do not read outside the input file paths provided in INPUT_FILES. Do not write outside OUTPUT_DIR.",
    input.allowNetwork ? "Network is allowed for public URLs/APIs if relevant." : "Network is not allowed; do not fetch internet resources.",
    "If inputs include PDFs, first use extract_all_input_texts() so Gemini/MinerU extraction sidecars are used when present and PyMuPDF/pypdf are used otherwise. extract_all_input_texts() returns a list of strings suitable for '\\n'.join(...). Use extract_all_input_documents() only when you need filename/path/text metadata records. Sidecar .gemini.json files usually contain text/markdown fields, not a normalized parameter schema; parse their text/markdown content unless you have verified specific structured keys exist.",
    "Use a domain-agnostic tool workflow: inspect documents, extract tables and numeric evidence, infer the task-specific physics/economics equations from the prompt and evidence, run calculations, and synthesize a direct answer. Do not assume the platform only supports a fixed list of domains.",
    "Do not use canned application templates or domain-specific shortcuts. Treat the prompt and uploaded files as the source of truth, then write task-specific code with the helper tools.",
    "Never substitute generic placeholder inputs when source previews or uploaded files contain specific values. The first section of report.md must show the source-backed inputs actually used; any invented or assumed value must be labeled as an assumption and kept separate.",
    "Before modeling, parse extract_all_input_texts() and extract_numeric_evidence(...) for the uploaded files. If source-backed values conflict with generic examples or prior defaults, use the source-backed values. Use permissive context regexes that capture forms like '<label> ... 440 W' or '<label> ... -0.37 percent', not only colon-separated fields.",
    "For simulation/economics requests in any domain, build a transparent calculation model from extracted numeric values. If key values are missing, use clearly named assumption variables, run at least low/base/high cases, and state which assumptions control the result.",
    "For physics or conceptual simulation requests, prefer a lightweight standard-library or numpy script, bounded sample counts, and tabular numeric outputs. Avoid slow dependency installs or heavy plotting unless the user explicitly asked for plots.",
    "For PV module/site simulations, prefer pvlib_fixed_tilt_day(...) and pvlib_cell_temperature(...) from the helper module. Do not call deprecated/missing pvlib temperature APIs such as temperature.pvwatts_cell or temperature.sapm_celltemp. If you call temperature.sapm_cell directly, pass a, b, and deltaT from pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS.",
    "For Monte Carlo or stochastic simulations, cap runtime intentionally: set a fixed seed, use enough trajectories for a stable directional result, and write a convergence or sensitivity note instead of running an open-ended simulation.",
    "Keep scenario definitions isolated and explicit. A scenario named low-cost should not also change production, capacity factor, output, or utilization unless the user explicitly asked for a combined low-cost/high-output case. State every changed variable in the scenario table.",
    "Before writing the final narrative, compare every conclusion against computed result signs and ranges. Do not say positive NPV, viable, lower cost, within payback, or best case unless the computed table supports that exact claim.",
    "Before exiting, run a self-check in code: verify source-backed inputs against extracted text, verify simple derived values with independent formulas where possible, and write those checks into results.json under quality_checks or independent_checks.",
    "Check physical bounds before writing the narrative. Efficiency metrics should not exceed 100% unless explicitly defined as a ratio outside ordinary efficiency; if a computed efficiency exceeds its bound, flag it as a calculation/unit issue instead of treating it as valid.",
    "Never leave unresolved self-review language such as '[check]', '[verify]', TODO, or 'Actually check' in report.md. Resolve the inconsistency or state the result as uncertain.",
    "For unfamiliar domains, still proceed: identify governing variables, construct a first-pass model with equations and assumptions, show ranges/sensitivities, and explain which measured inputs would improve the result.",
    "For breakeven or scale recommendations, compute the formula used, daily/annual production required, utilization sensitivity, and the scale that best balances CAPEX, OPEX, and revenue under the stated assumptions.",
    "For export, convert, download, or follow-up table requests, do not rebuild a new model if prior chat/result context is provided. Extract the requested table/report from TASK or CONTEXT, preserve values and units exactly, and write the requested output file(s).",
    "The report must include the final answer directly, not just an inventory or links to files. Include the key result table inline in valid Markdown, with a separator row like |---|---| immediately after the header.",
    "The final report must clearly state which outputs/calculations were executable-verified and which are best-effort. Never describe a failed executable verification as normal success.",
    "Keep Markdown table cells short and scannable. If an explanation needs more than one sentence, put it below the table as bullets instead of stuffing paragraphs into table cells.",
    "Every report.md for simulation, economics, safety, environmental, or other high-stakes work must include a brief Support and limits section explaining what the supplied data supports and what it cannot prove.",
    "Prefer the Python standard library. If a common package is essential, list it in requirements.",
    "Return strict JSON with keys: requirements (array of pip package names), code (string), expected_outputs (array).",
    "",
    `TASK:\n${input.task}`,
    input.context ? `\nCONTEXT:\n${input.context}` : "",
    input.requestedOutputs?.length ? `\nREQUESTED OUTPUTS: ${input.requestedOutputs.join(", ")}` : "",
    sourcePreview ? `\nSOURCE_PREVIEWS:\n${sourcePreview}` : "\nSOURCE_PREVIEWS:\nNo parser-readable source preview was available. Parse the files at runtime before using defaults.",
    `\nINPUT_FILES:\n${JSON.stringify(copiedFiles, null, 2)}`,
  ].filter(Boolean).join("\n");

  const requestCode = async (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, maxTokens = 12_000) => {
    const raw = await callDeepSeekV3(
      messages,
      { jsonMode: true, temperature: 0.1, maxTokens, timeoutMs: codegenTimeoutMs },
    );
    const parsed = parseJsonObject(raw);
    return {
      raw,
      parsed,
      code: extractGeneratedPython(raw, parsed),
    };
  };

  const baseMessages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: "You generate executable Python scripts for engineering analysis workspaces. Return only strict JSON with a code string. Do not answer the user's analysis request in prose." },
    { role: "user", content: prompt },
  ];
  let generated = await requestCode(baseMessages);
  if (!generated.code.trim()) {
    generated = await requestCode([
      ...baseMessages,
      {
        role: "assistant",
        content: generated.raw.slice(0, 6000),
      },
      {
        role: "user",
        content: [
          "The previous response did not include executable Python code.",
          "Return only strict JSON now: {\"requirements\": [], \"code\": \"...\", \"expected_outputs\": []}.",
          "The code must be a complete Python script that imports agent_workspace_helpers, writes report.md and results.json, and creates any requested CSV/PDF/XLSX files. CSV helpers accept write_csv(name, rows) or write_csv(name, headers, rows).",
          "Do not provide analysis prose outside the code string.",
        ].join("\n"),
      },
    ]);
  }
  if (!generated.code.trim()) {
    throw new Error("Workspace code generation did not return executable Python after retry.");
  }
  return {
    code: repairGeneratedPython(generated.code),
    requirements: sanitizePythonRequirements(generated.parsed?.requirements),
  };
}

async function repairPythonAfterExecutionFailure(args: {
  input: AgentWorkspaceRunInput;
  copiedFiles: Array<Record<string, unknown>>;
  code: string;
  execution: { stdout: string; stderr: string; exitCode: number };
  attempt: number;
}): Promise<{ code: string; requirements: string[] } | null> {
  if (!getEnvVar("DEEPSEEK_API_KEY") && !getEnvVar("DEEPSEEK_V3_API_KEY")) return null;
  const prompt = [
    "Repair this generated Python workspace script so it completes successfully.",
    "Return only strict JSON with keys: requirements (array), code (string), expected_outputs (array).",
    "Do not answer the analysis request in prose. Return a full replacement script.",
    "",
    "Helper contract:",
    "- from agent_workspace_helpers import write_json, write_markdown, write_csv, write_xlsx, write_pdf, extract_all_input_texts, extract_all_input_documents, summarize_documents, extract_numeric_evidence, extract_markdown_tables, load_tabular_inputs, capital_recovery_factor, npv, irr, financial_metrics, pvlib_cell_temperature, pvlib_fixed_tilt_day",
    "- write_json(name, data)",
    "- write_markdown(name, text)",
    "- write_csv(name, rows) or write_csv(name, headers, rows)",
    "- write_xlsx(name, rows) or write_xlsx(name, headers, rows)",
    "- write_pdf(name, text)",
    "- for PV simulations use pvlib_fixed_tilt_day(latitude, longitude, pdc0_w, gamma_pdc_per_c, date=..., tilt_deg=..., azimuth_deg=..., temp_air_c=..., inverter_efficiency=..., system_losses=...) and pvlib_cell_temperature(...) instead of deprecated pvlib temperature calls",
    "- underscore-free aliases writejson, writemarkdown, writecsv, writexlsx, writepdf are available",
    "The script must always create report.md and results.json before exiting.",
    "report.md must include inline key result tables in valid Markdown and a Support and limits section for high-stakes work.",
    "If a requested export is missing, repair the script to create it before returning. If executable verification cannot pass, label the report best-effort and do not claim normal success.",
    "Remove unresolved self-review language such as '[check]', TODO, or 'Actually check' before writing outputs.",
    "Keep all file writes under OUTPUT_DIR. Prefer standard library.",
    "",
    `TASK:\n${args.input.task}`,
    args.input.context ? `\nCONTEXT:\n${args.input.context}` : "",
    args.input.requestedOutputs?.length ? `\nREQUESTED OUTPUTS: ${args.input.requestedOutputs.join(", ")}` : "",
    `\nINPUT_FILES:\n${JSON.stringify(args.copiedFiles, null, 2).slice(0, 12000)}`,
    "",
    `FAILED ATTEMPT ${args.attempt}: exit code ${args.execution.exitCode}`,
    `STDERR:\n${args.execution.stderr.slice(-5000) || "(none)"}`,
    `STDOUT:\n${args.execution.stdout.slice(-3000) || "(none)"}`,
    "",
    `BROKEN CODE:\n${args.code.slice(0, 20000)}`,
  ].join("\n");

  const raw = await callDeepSeekV3(
    [
      { role: "system", content: "You repair Python scripts for a constrained analysis workspace. Return only strict JSON." },
      { role: "user", content: prompt },
    ],
    { jsonMode: true, temperature: 0.05, maxTokens: 12_000 },
  );
  const parsed = parseJsonObject(raw);
  const code = extractGeneratedPython(raw, parsed);
  if (!code.trim()) return null;
  return {
    code: repairGeneratedPython(code),
    requirements: sanitizePythonRequirements(parsed?.requirements),
  };
}

async function sourcePreviewForSynthesis(copiedFiles: Array<Record<string, unknown>>): Promise<string> {
  const previews: string[] = [];
  for (const file of copiedFiles) {
    const filename = typeof file.filename === "string" ? displayFilename(file.filename) : "uploaded file";
    if (isPdfTextSidecarName(filename)) continue;
    const text = await readablePreviewFromCopiedFile(file);
    if (text.trim()) {
      previews.push(`## ${filename}\n${text.trim().slice(0, 5000)}`);
    }
    if (previews.length >= 8) break;
  }
  return previews.join("\n\n").slice(0, 30000);
}

async function synthesizeBestEffortWorkspaceReport(args: {
  input: AgentWorkspaceRunInput;
  copiedFiles: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  outputDir: string;
}): Promise<{ reportMarkdown: string; results: Record<string, unknown> }> {
  const sourcePreview = await sourcePreviewForSynthesis(args.copiedFiles);
  const prompt = [
    "You are Exergy Analyst. The workspace tool could not complete after repair attempts.",
    "Write the best useful final answer anyway, in polished Markdown, using the user's request, project context, source previews, and attempt diagnostics.",
    "Do not claim that a failed calculation, simulation, export, or code run succeeded.",
    "If attempted stdout/stderr contains usable computed numbers, you may present them only as attempted intermediate outputs and say they need verification because the tool run failed.",
    "Give the user a valuable answer with clear sections: Executive Summary, What I Could Use, Best-Effort Analysis, What Is Not Proven, Recommended Next Steps.",
    "For high-stakes outputs, clearly separate source-backed facts from assumptions or attempted calculations.",
    "Do not mention internal route names, evidence cards, View Details, or schema fields.",
    "",
    `USER REQUEST:\n${args.input.task}`,
    args.input.context ? `\nPROJECT/RUN CONTEXT:\n${args.input.context}` : "",
    sourcePreview ? `\nSOURCE PREVIEWS:\n${sourcePreview}` : "\nSOURCE PREVIEWS:\nNo parser-readable source preview was available.",
    `\nFAILED ATTEMPTS:\n${JSON.stringify(args.attempts, null, 2).slice(0, 12000)}`,
  ].join("\n");

  let reportMarkdown = "";
  if (getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY")) {
    const text = await callDeepSeekV3(
      [{ role: "user", content: prompt }],
      { temperature: 0.2, maxTokens: 4500, timeoutMs: 15_000 },
    ).catch(() => "");
    reportMarkdown = typeof text === "string" ? text.trim() : "";
  }

  if (!reportMarkdown) {
    reportMarkdown = await buildExecutionFallbackReport(args.input, args.copiedFiles);
  }
  const results = {
    summary: reportMarkdown.split(/\n+/).find((line) => line.trim() && !line.startsWith("#"))?.trim()
      || "Best-effort answer produced after workspace execution could not complete.",
    completed_with_limitations: true,
    tool_execution_completed: false,
    attempts: args.attempts,
  };
  await writeFile(join(args.outputDir, "report.md"), reportMarkdown, "utf-8");
  await writeFile(join(args.outputDir, "results.json"), JSON.stringify(results, null, 2), "utf-8");
  return { reportMarkdown, results };
}

async function copyInputs(workDir: string, uploadPaths: string[] = [], maxInputFiles = 20) {
  const inputDir = join(workDir, "inputs");
  await mkdir(inputDir, { recursive: true });
  const copied: Array<Record<string, unknown>> = [];
  for (const source of uploadPaths.slice(0, maxInputFiles)) {
    if (!source || !existsSync(source)) continue;
    await ensurePdfTextSidecars(source);
    const target = join(inputDir, basename(source));
    await copyFile(source, target).catch(async () => {
      await writeFile(target, await readFile(source));
    });
    const info = await stat(target);
    copied.push({ filename: basename(source), path: target, bytes: info.size });
    for (const suffix of PDF_TEXT_SIDECAR_SUFFIXES) {
      const sidecar = `${source}${suffix}`;
      if (!existsSync(sidecar)) continue;
      const sidecarTarget = join(inputDir, `${basename(source)}${suffix}`);
      await copyFile(sidecar, sidecarTarget).catch(async () => {
        await writeFile(sidecarTarget, await readFile(sidecar));
      });
      const sidecarInfo = await stat(sidecarTarget);
      copied.push({ filename: `${basename(source)}${suffix}`, path: sidecarTarget, bytes: sidecarInfo.size });
    }
  }
  return copied;
}

function repoRootForPython(): string {
  const cwd = process.cwd();
  return cwd.endsWith("/workspace") ? join(cwd, "..") : cwd;
}

function pdfExtractionProvider(): "auto" | "gemini" | "mineru" | "off" {
  const raw = (getEnvVar("EXERGY_PDF_VISION_PROVIDER") || "auto").toLowerCase();
  if (raw === "gemini" || raw === "mineru" || raw === "off") return raw;
  return "auto";
}

function anyPdfTextSidecarExists(source: string): boolean {
  return PDF_TEXT_SIDECAR_SUFFIXES.some((suffix) => existsSync(`${source}${suffix}`));
}

function geminiPdfVisionPrompt(filename: string): string {
  return [
    "You are the fast PDF vision extraction assistant for Exergy Lab.",
    "Extract the document into clean Markdown for the downstream engineering agent.",
    "Preserve technical meaning, table values, units, equations, figure captions, headings, footnotes, and operating conditions.",
    "When a table is visible, recreate it as a Markdown table with row/column labels and units.",
    "Capture product names, process descriptions, performance claims, scale references, CAPEX/OPEX clues, test conditions, materials, yields, efficiencies, conversion, selectivity, voltages, pressures, temperatures, flow rates, and production rates when present.",
    "Do not invent values. If a field is unreadable, write 'unreadable' and continue.",
    "Return Markdown only. Do not include meta commentary about being an AI or about the extraction process.",
    `PDF filename: ${filename}`,
  ].join("\n");
}

async function ensureGeminiPdfTextSidecars(source: string): Promise<boolean> {
  if ((getEnvVar("EXERGY_DISABLE_GEMINI_PDF_VISION") || "").toLowerCase() === "true") return false;
  if ((getEnvVar("EXERGY_DISABLE_GEMINI_PDF_VISION") || "") === "1") return false;
  if (!getEnvVar("GEMINI_API_KEY")) return false;

  const maxMb = numericEnv("EXERGY_GEMINI_PDF_MAX_MB", 20, 1, 100);
  const info = await stat(source).catch(() => null);
  if (!info || info.size > maxMb * 1024 * 1024) return false;

  const model = getEnvVar("GEMINI_VISION_MODEL") || getEnvVar("GEMINI_MODEL") || undefined;
  try {
    const result = await callGeminiPdfVision(
      source,
      geminiPdfVisionPrompt(basename(source)),
      {
        ...(model ? { model } : {}),
        temperature: 0,
        maxTokens: numericEnv("EXERGY_GEMINI_PDF_MAX_OUTPUT_TOKENS", 12000, 1000, 60000),
        timeoutMs: numericEnv("EXERGY_GEMINI_PDF_TIMEOUT_SECONDS", 120, 15, 600) * 1000,
      },
    );
    if (!result.text.trim()) return false;
    const metadata = {
      source,
      filename: basename(source),
      bytes: result.bytes,
      model: result.model,
      provider: "gemini",
    };
    await writeFile(`${source}.gemini.md`, result.text, "utf-8");
    await writeFile(`${source}.gemini.json`, JSON.stringify({
      markdown: result.text,
      text: result.text,
      parser: "Gemini Flash vision",
      engine: "gemini",
      status: "extracted",
      metadata,
    }, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function ensurePdfTextSidecars(source: string): Promise<void> {
  if (!source.toLowerCase().endsWith(".pdf")) return;
  if (anyPdfTextSidecarExists(source)) return;
  const provider = pdfExtractionProvider();
  if (provider === "off") return;
  if (provider === "gemini" || provider === "auto") {
    const ok = await ensureGeminiPdfTextSidecars(source);
    if (ok || provider === "gemini") return;
  }
  const root = repoRootForPython();
  const script = String.raw`
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
pdf = Path(sys.argv[2])
sys.path.insert(0, str(root))

from src.exergy_analyst.pdf_extract import extract_pdf_document

result = extract_pdf_document(pdf)
if result.text.strip():
    Path(str(pdf) + ".mineru.md").write_text(result.text, encoding="utf-8")
    Path(str(pdf) + ".mineru.json").write_text(json.dumps({
        "text": result.text,
        "markdown": result.text,
        "parser": result.parser,
        "status": result.status,
        "metadata": result.metadata,
    }, ensure_ascii=False), encoding="utf-8")
`;
  await execFileAsync(
    pythonPath(),
    ["-c", script, root, source],
    {
      cwd: root,
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(":"),
      },
    },
  ).catch(() => {
    // Keep the run moving; the original PDF is still copied and the sandbox
    // helper can use any parser available in that environment.
  });
}

export function containerBaseArgs(policy: SandboxPolicy, workDir: string, env: Record<string, string> = {}): string[] {
  const containerEnv = { MPLCONFIGDIR: "/tmp/matplotlib", ...env };
  const envArgs = Object.entries(containerEnv)
    .filter(([key, value]) => /^[A-Z0-9_]+$/.test(key) && typeof value === "string")
    .flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const userArgs = typeof process.getuid === "function" && typeof process.getgid === "function"
    ? ["--user", `${process.getuid()}:${process.getgid()}`]
    : [];
  const pullPolicy = containerPullPolicy();
  return [
    "run",
    "--rm",
    "--pull", pullPolicy,
    "--network", policy.network ? "bridge" : "none",
    "--memory", `${policy.memoryMb}m`,
    "--cpus", "1",
    "--pids-limit", "128",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--ulimit", `cpu=${policy.cpuSeconds}:${policy.cpuSeconds}`,
    "--ulimit", `fsize=${Math.ceil(policy.maxFileBytes / 512)}:${Math.ceil(policy.maxFileBytes / 512)}`,
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
    ...userArgs,
    "-v", `${workDir}:/workspace:rw`,
    "-w", "/workspace",
    ...envArgs,
    policy.containerImage || "python:3.11-slim",
  ];
}

async function runContainer(policy: SandboxPolicy, workDir: string, command: string[], timeout: number, env: Record<string, string> = {}) {
  if (!policy.containerRuntime) throw new Error("Container runtime unavailable");
  return execFileAsync(
    policy.containerRuntime,
    [...containerBaseArgs(policy, workDir, env), ...command],
    { cwd: workDir, timeout, maxBuffer: MAX_OUTPUT_BYTES },
  );
}

async function installRequirements(workDir: string, requirements: string[], policy: SandboxPolicy): Promise<{ installed: string[]; log: string; sitePackages?: string }> {
  if (!policy.dependencyInstall || requirements.length === 0) {
    return { installed: [], log: requirements.length ? "Dependency install disabled; running with existing environment." : "" };
  }
  const target = join(workDir, "site-packages");
  await mkdir(target, { recursive: true });
  try {
    const result = policy.mode === "container"
      ? await runContainer(policy, workDir, ["python", "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--target", "/workspace/site-packages", ...requirements], 180_000)
      : await execFileAsync(
        pythonPath(),
        ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--target", target, ...requirements],
        { cwd: workDir, timeout: 180_000, maxBuffer: MAX_OUTPUT_BYTES },
      );
    return { installed: requirements, log: `${result.stdout || ""}\n${result.stderr || ""}`.trim(), sitePackages: target };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { installed: [], log: `${e.message || "pip install failed"}\n${e.stdout || ""}\n${e.stderr || ""}`.trim(), sitePackages: target };
  }
}

async function listFiles(dir: string, root = dir, policy?: Pick<SandboxPolicy, "maxFiles" | "maxFileBytes">): Promise<AgentWorkspaceRunResult["files"]> {
  const out: AgentWorkspaceRunResult["files"] = [];
  if (!existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await listFiles(abs, root, policy));
      continue;
    }
    const info = await stat(abs);
    if (policy?.maxFileBytes && info.size > policy.maxFileBytes) continue;
    const ext = extname(entry.name).replace(/^\./, "").toLowerCase();
    const rel = abs.slice(root.length + 1);
    const file = { path: abs, filename: rel, bytes: info.size, kind: ext || "file" };
    const extensionlessCanonical = !ext && /^(report|results)$/i.test(entry.name);
    if ((["md", "txt", "csv", "json"].includes(ext) || extensionlessCanonical) && info.size <= MAX_FILE_PREVIEW_BYTES) {
      (file as typeof file & { preview?: string }).preview = await readFile(abs, "utf-8").catch(() => "");
    }
    out.push(file);
    if (out.length >= (policy?.maxFiles || MAX_FILES_IN_MANIFEST)) break;
  }
  return out;
}

function outputFileByName(
  files: AgentWorkspaceRunResult["files"],
  names: string[],
): AgentWorkspaceRunResult["files"][number] | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return files.find((file) => wanted.has(file.filename.toLowerCase()));
}

async function outputFileText(
  file: AgentWorkspaceRunResult["files"][number] | undefined,
): Promise<string> {
  if (!file) return "";
  if (typeof file.preview === "string") return file.preview;
  if (file.path && file.bytes <= DEFAULT_MAX_FILE_BYTES) {
    return readFile(file.path, "utf-8").catch(() => "");
  }
  return "";
}

async function selectPrimaryWorkspaceMarkdown(
  files: AgentWorkspaceRunResult["files"],
  currentReportMarkdown: string,
): Promise<string> {
  let best = currentReportMarkdown;
  let bestScore = scoreWorkspaceMarkdownReport(best);
  for (const file of files) {
    if (!/\.md$|\.markdown$/i.test(file.filename)) continue;
    const text = await outputFileText(file);
    const score = scoreWorkspaceMarkdownReport(text);
    if (score > bestScore + 50) {
      best = text;
      bestScore = score;
    }
  }
  return best;
}

async function executePythonScript(args: {
  policy: SandboxPolicy;
  workDir: string;
  outputDir: string;
  inputDir: string;
  copiedFiles: Array<Record<string, unknown>>;
  task: string;
  scriptPath: string;
  sitePackages?: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = {
    ...(process.env as NodeJS.ProcessEnv),
    WORK_DIR: args.workDir,
    OUTPUT_DIR: args.outputDir,
    INPUT_DIR: args.inputDir,
    INPUT_FILES: JSON.stringify(args.copiedFiles),
    AGENT_TASK: args.task,
    AGENT_ALLOW_NETWORK: args.policy.network ? "1" : "0",
    MAX_OUTPUT_FILE_BYTES: String(args.policy.maxFileBytes),
    OPENBLAS_NUM_THREADS: "1",
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
    NUMEXPR_NUM_THREADS: "1",
    VECLIB_MAXIMUM_THREADS: "1",
    PYTHONPATH: [args.workDir, args.sitePackages, process.env.PYTHONPATH].filter(Boolean).join(":"),
  };
  try {
    const result = args.policy.mode === "container"
      ? await runContainer(
        args.policy,
        args.workDir,
        ["python", "-B", "/workspace/run.py"],
        args.policy.timeoutMs,
        {
          WORK_DIR: "/workspace",
          OUTPUT_DIR: "/workspace/outputs",
          INPUT_DIR: "/workspace/inputs",
          INPUT_FILES: JSON.stringify(args.copiedFiles.map((file) => ({
            ...file,
            path: typeof file.path === "string" ? file.path.replace(args.workDir, "/workspace") : file.path,
          }))),
          AGENT_TASK: args.task,
          AGENT_ALLOW_NETWORK: args.policy.network ? "1" : "0",
          MAX_OUTPUT_FILE_BYTES: String(args.policy.maxFileBytes),
          MPLCONFIGDIR: "/tmp/matplotlib",
          OPENBLAS_NUM_THREADS: "1",
          OMP_NUM_THREADS: "1",
          MKL_NUM_THREADS: "1",
          NUMEXPR_NUM_THREADS: "1",
          VECLIB_MAXIMUM_THREADS: "1",
          PYTHONPATH: "/workspace:/workspace/site-packages",
        },
      )
      : await execFileAsync(
        "bash",
        [
          "-lc",
          [
            `ulimit -t ${args.policy.cpuSeconds}`,
            `ulimit -f ${Math.ceil(args.policy.maxFileBytes / 512)}`,
            `ulimit -v ${args.policy.memoryMb * 1024}`,
            "ulimit -u 128",
            "exec \"$PYTHON_BIN\" \"$SCRIPT_PATH\"",
          ].join("; "),
        ],
        {
          cwd: args.workDir,
          timeout: args.policy.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          env: {
            ...env,
            PYTHON_BIN: pythonPath(),
            SCRIPT_PATH: args.scriptPath,
          },
        },
      );
    return { stdout: result.stdout || "", stderr: result.stderr || "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout || "",
      stderr: [e.message, e.stderr].filter(Boolean).join("\n"),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

export async function runAgentWorkspaceTask(input: AgentWorkspaceRunInput): Promise<AgentWorkspaceRunResult> {
  const policy = await buildSandboxPolicy(input);
  const runId = `${Date.now()}_${safeSlug(input.actionId || input.task)}`;
  const workDir = join(RUNTIME_DIR, "agent_workspaces", `proj_${safeSlug(input.projectId)}`, runId);
  const outputDir = join(workDir, "outputs");
  const inputDir = join(workDir, "inputs");
  await mkdir(outputDir, { recursive: true });
  await writeHelperModule(workDir);

  const copiedFiles = await copyInputs(workDir, input.uploadPaths, policy.maxInputFiles);
  const attempts: Array<Record<string, unknown>> = [];
  let generated: { code: string; requirements: string[] };
  try {
    generated = await generatePythonForTask({ ...input, allowNetwork: policy.network }, copiedFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attempts.push({ stage: "code_generation", status: "failed", error: message });
    const bestEffort = await synthesizeBestEffortWorkspaceReport({
      input,
      copiedFiles,
      attempts,
      outputDir,
    });
    const finalFiles = await listFiles(outputDir, outputDir, policy);
    return {
      workDir,
      outputDir,
      reportMarkdown: bestEffort.reportMarkdown,
      summary: String(bestEffort.results.summary || "Best-effort answer produced after workspace code generation failed."),
      generatedCode: "",
      requirements: [],
      installedRequirements: [],
      installLog: "",
      stdout: "",
      stderr: message,
      exitCode: 1,
      files: finalFiles,
      results: bestEffort.results,
      sandbox: policy,
      securityFindings: [],
      executionAttempts: attempts,
      steps: [
        { title: "Sandbox selected", status: policy.mode === "container" ? "done" : "info", detail: policy.mode === "container" ? `${policy.containerRuntime} / ${policy.containerImage}` : "local restricted limits" },
        { title: "Workspace prepared", status: "done", detail: workDir },
        { title: "Inputs copied", status: "done", detail: `${copiedFiles.length} file(s)` },
        { title: "Code generation", status: "failed", detail: message },
        { title: "Best-effort answer", status: "done", detail: "Produced a grounded answer from available context and diagnostics" },
      ],
    };
  }
  let requirements = sanitizePythonRequirements(generated.requirements);
  const securityFindings: string[] = [];
  let codeToRun = generated.code;
  let install = await installRequirements(workDir, requirements, policy);
  const scriptPath = join(workDir, "run.py");

  let execution: { stdout: string; stderr: string; exitCode: number } = { stdout: "", stderr: "", exitCode: 1 };
  const maxAttempts = Math.max(1, Math.min(Number(getEnvVar("EXERGY_AGENT_CODE_REPAIR_ATTEMPTS") || 2) + 1, 4));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await rm(outputDir, { recursive: true, force: true });
      await mkdir(outputDir, { recursive: true });
    }
    await writeFile(scriptPath, codeToRun, "utf-8");
    execution = await executePythonScript({
      policy,
      workDir,
      outputDir,
      inputDir,
      copiedFiles,
      task: input.task,
      scriptPath,
      sitePackages: install.sitePackages,
    });
    attempts.push({
      stage: "execution",
      attempt,
      status: execution.exitCode === 0 ? "completed" : "failed",
      exit_code: execution.exitCode,
      stdout_tail: execution.stdout.slice(-2000),
      stderr_tail: execution.stderr.slice(-3000),
      code_characters: codeToRun.length,
    });
    if (execution.exitCode === 0) {
      const contractFiles = await listFiles(outputDir, outputDir, policy);
      const contractReport = await outputFileText(outputFileByName(contractFiles, ["report.md", "report.markdown", "report", "memo.md", "decision_brief.md", "brief.md", "analysis.md"]));
      const contractResultsText = await outputFileText(outputFileByName(contractFiles, ["results.json", "results"]));
      const contractResults = contractResultsText ? parseJsonObject(contractResultsText) || {} : {};
      const contractFindings = workspaceOutputContractFindings({
        input,
        files: contractFiles,
        reportMarkdown: contractReport,
        results: contractResults,
      });
      if (contractFindings.length === 0) break;
      attempts.push({
        stage: "output_contract",
        attempt,
        status: "failed",
        findings: contractFindings,
      });
      if (attempt >= maxAttempts) break;
      const repaired = await repairPythonAfterExecutionFailure({
        input,
        copiedFiles,
        code: codeToRun,
        execution: {
          stdout: execution.stdout,
          stderr: `Output contract repair required before final answer:\n${contractFindings.join("\n")}`,
          exitCode: 1,
        },
        attempt,
      }).catch(() => null);
      if (!repaired?.code.trim()) {
        attempts.push({ stage: "output_contract_repair", attempt, status: "failed", error: "The workspace agent did not return repaired Python that satisfied the output contract." });
        break;
      }
      attempts.push({ stage: "output_contract_repair", attempt, status: "completed", code_characters: repaired.code.length });
      codeToRun = repaired.code;
      const mergedRequirements = Array.from(new Set([...requirements, ...sanitizePythonRequirements(repaired.requirements)]));
      requirements = mergedRequirements;
      install = await installRequirements(workDir, requirements, policy);
      continue;
    }
    if (attempt >= maxAttempts) break;
    const repaired = await repairPythonAfterExecutionFailure({
      input,
      copiedFiles,
      code: codeToRun,
      execution,
      attempt,
    }).catch(() => null);
    if (!repaired?.code.trim()) {
      attempts.push({ stage: "code_repair", attempt, status: "failed", error: "The workspace agent did not return repaired executable Python." });
      break;
    }
    attempts.push({ stage: "code_repair", attempt, status: "completed", code_characters: repaired.code.length });
    codeToRun = repaired.code;
    const mergedRequirements = Array.from(new Set([...requirements, ...sanitizePythonRequirements(repaired.requirements)]));
    requirements = mergedRequirements;
    install = await installRequirements(workDir, requirements, policy);
  }

  if (execution.exitCode !== 0) {
    await synthesizeBestEffortWorkspaceReport({
      input,
      copiedFiles,
      attempts,
      outputDir,
    });
  }

  const files = await listFiles(outputDir, outputDir, policy);
  let reportMarkdown = await outputFileText(outputFileByName(files, ["report.md", "report.markdown", "report", "memo.md", "decision_brief.md", "brief.md", "analysis.md"]));
  if (!reportMarkdown) {
    reportMarkdown = execution.exitCode === 0
      ? [
        "# Analysis Result",
        "",
        `Task: ${input.task}`,
        "",
        "The workspace completed, but the generated script did not create a written report.",
      ].join("\n")
      : [
        "# Workspace Run Failed",
        "",
        "The generated script did not complete successfully, so no diagnostic report was substituted.",
        "",
        execution.stderr || execution.stdout || "No execution output was captured.",
      ].join("\n");
    await writeFile(join(outputDir, "report.md"), reportMarkdown, "utf-8");
  }

  const resultsFile = outputFileByName(files, ["results.json", "results"]);
  const resultsText = await outputFileText(resultsFile);
  const results = resultsText ? parseJsonObject(resultsText) || {} : {};
  const consistencyChecks = workspaceConsistencyFindings(reportMarkdown, results, input.task);
  if (consistencyChecks.length > 0) {
    results.consistency_checks = consistencyChecks;
    await writeFile(join(outputDir, "results.json"), JSON.stringify(results, null, 2), "utf-8");
    reportMarkdown = appendWorkspaceConsistencyChecks(reportMarkdown, results, input.task);
    await writeFile(join(outputDir, "report.md"), reportMarkdown, "utf-8");
  }
  reportMarkdown = normalizeLongMarkdownTableCells(reportMarkdown);
  await writeFile(join(outputDir, "report.md"), reportMarkdown, "utf-8");
  let finalFiles = await listFiles(outputDir, outputDir, policy);
  const sourcePreviewForQuality = await sourcePreviewForSynthesis(copiedFiles);
  const qualityEvaluation = evaluateAgentQuality({
    prompt: input.task,
    finalAnswer: reportMarkdown,
    sourceTexts: sourcePreviewForQuality ? [sourcePreviewForQuality] : [],
    files: finalFiles.map((file) => ({
      filename: file.filename,
      url: file.path,
      preview: file.preview,
    })),
    requiresTool: true,
    requiresFiles: Boolean(input.requestedOutputs?.length) || /\b(export|download|save|convert|csv|xlsx|excel|pdf|json|markdown|md|file)\b/i.test(input.task),
  });
  results.quality_evaluation = qualityEvaluation;
  const outputContractFindings = workspaceOutputContractFindings({
    input,
    files: finalFiles,
    reportMarkdown,
    results,
  });
  const qualityBlockers = qualityEvaluation.findings.filter((finding) => finding.severity === "blocker");
  if ((qualityBlockers.length > 0 || outputContractFindings.length > 0) && !/\n## Completion Notes\b/i.test(reportMarkdown)) {
    reportMarkdown = [
      reportMarkdown.trimEnd(),
      "",
      "## Completion Notes",
      "",
      ...qualityBlockers.map((finding) => `- ${finding.detail}`),
      ...outputContractFindings.map((finding) => `- ${finding}`),
    ].join("\n");
    await writeFile(join(outputDir, "report.md"), reportMarkdown, "utf-8");
  }
  await ensureRequestedWorkspaceFiles({ input, outputDir, reportMarkdown, results, files: finalFiles });
  finalFiles = await listFiles(outputDir, outputDir, policy);
  const selectedReportMarkdown = await selectPrimaryWorkspaceMarkdown(finalFiles, reportMarkdown);
  if (selectedReportMarkdown && selectedReportMarkdown !== reportMarkdown) {
    reportMarkdown = normalizeLongMarkdownTableCells(selectedReportMarkdown);
    await writeFile(join(outputDir, "report.md"), reportMarkdown, "utf-8");
    finalFiles = await listFiles(outputDir, outputDir, policy);
  }
  results.output_contract = {
    required_outputs: requestedWorkspaceOutputExtensions(input),
    initial_findings: outputContractFindings,
    remaining_findings: workspaceOutputContractFindings({
      input,
      files: finalFiles,
      reportMarkdown,
      results,
    }),
  };
  await writeFile(join(outputDir, "results.json"), JSON.stringify(results, null, 2), "utf-8");
  finalFiles = await listFiles(outputDir, outputDir, policy);
  const summary = typeof results.summary === "string"
    ? results.summary
    : reportMarkdown.split(/\n+/).find((line) => line.trim() && !line.startsWith("#"))?.trim() || "Agent workspace run complete.";

  return {
    workDir,
    outputDir,
    reportMarkdown,
    summary,
    generatedCode: codeToRun,
    requirements,
    installedRequirements: install.installed,
    installLog: install.log.slice(0, 8000),
    stdout: execution.stdout.slice(-12000),
    stderr: execution.stderr.slice(-12000),
    exitCode: execution.exitCode,
    files: finalFiles,
    results,
    sandbox: policy,
    securityFindings,
    executionAttempts: attempts,
    steps: [
      { title: "Sandbox selected", status: policy.mode === "container" ? "done" : "info", detail: policy.mode === "container" ? `${policy.containerRuntime} / ${policy.containerImage}` : "local restricted limits" },
      { title: "Workspace prepared", status: "done", detail: workDir },
      { title: "Inputs copied", status: "done", detail: `${copiedFiles.length} file(s)` },
      { title: "Code generated", status: "done", detail: `${generated.code.length} characters` },
      { title: "Dependencies", status: install.installed.length ? "done" : "info", detail: install.installed.length ? install.installed.join(", ") : "No new dependencies installed" },
      { title: "Code executed", status: execution.exitCode === 0 ? "done" : "failed", detail: `exit code ${execution.exitCode}` },
      { title: "Outputs collected", status: "done", detail: `${finalFiles.length} file(s)` },
    ],
  };
}
