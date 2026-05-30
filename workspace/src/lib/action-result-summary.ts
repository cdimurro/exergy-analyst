import type { Artifact } from "@/lib/storage/types";
import { sanitizeUserFacingAgentText } from "@/lib/agent-output";

function sanitize(text: string): string {
  return sanitizeUserFacingAgentText(text);
}

const CHAT_HIDDEN_WORKSPACE_HEADINGS = [
  /^#{1,6}\s+uploaded files\b/i,
  /^#{1,6}\s+(?:raw\s+)?extracted numeric inputs\b/i,
  /^#{1,6}\s+execution notes\b/i,
  /^#{1,6}\s+input manifest\b/i,
  /^#{1,6}\s+process details\b/i,
];

function cleanWorkspaceReportForChat(report: string): string {
  const lines = report.split(/\r?\n/);
  const out: string[] = [];
  let hidden = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const startsHiddenSection = CHAT_HIDDEN_WORKSPACE_HEADINGS.some((pattern) => pattern.test(trimmed));
    if (/^#{1,6}\s+/.test(trimmed)) {
      hidden = startsHiddenSection;
      if (hidden) continue;
    } else if (startsHiddenSection) {
      hidden = true;
      continue;
    }

    if (hidden) continue;
    if (/\.(?:gemini|mineru)\.(?:md|json)\b/i.test(line)) continue;
    if (/\bdoc_\d+_[a-z0-9]+_[^\s`]+/i.test(line)) continue;
    if (/^[-*]\s+doc\d+[a-z0-9_]*.+\(\d+\s+bytes\)/i.test(trimmed)) continue;
    if (/^[-*]\s+Open the process details/i.test(trimmed)) continue;
    if (/^Outputs collected:/i.test(trimmed)) continue;

    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function hasMarkdownTable(text: string): boolean {
  return /\|[^\n]+\|\n\|[\s:-]+\|/m.test(text);
}

function hasUnresolvedTemplateToken(text: string): boolean {
  return /\{[a-zA-Z_][a-zA-Z0-9_]{2,}\}/.test(text) || /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(text);
}

function parseCsvPreview(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows
    .map((items) => items.map((item) => item.replace(/\s+/g, " ").trim()))
    .filter((items) => items.some(Boolean));
}

function markdownTableFromRows(rows: string[][]): string {
  if (rows.length < 2) return "";
  const width = Math.min(8, Math.max(...rows.map((row) => row.length)));
  const cleanCell = (value: string) => {
    const text = value.replace(/\|/g, "/").trim();
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  };
  const padded = rows.slice(0, 9).map((row) =>
    Array.from({ length: width }, (_, index) => cleanCell(row[index] || "")),
  );
  const header = padded[0];
  const body = padded.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function appendWorkspaceFileTablesForChat(report: string, content: Record<string, unknown>): string {
  const unresolvedTemplate = hasUnresolvedTemplateToken(report);
  if (hasMarkdownTable(report) && !unresolvedTemplate) return report;
  const files = Array.isArray(content.files) ? content.files.filter(isRecord) : [];
  const csv = files.find((file) =>
    typeof file.filename === "string" &&
    /\.csv$/i.test(file.filename) &&
    typeof file.preview === "string" &&
    file.preview.trim()
  );
  if (!csv || typeof csv.preview !== "string") return report;
  const table = markdownTableFromRows(parseCsvPreview(csv.preview));
  if (!table) return report;
  if (unresolvedTemplate) {
    const replaced = report.replace(/\{[a-zA-Z0-9_]*(?:table|rows|results)[a-zA-Z0-9_]*\}/gi, table);
    if (replaced !== report) return replaced;
  }
  return `${report.trim()}\n\n## Results Table\n${table}`;
}

function ensureWorkspaceSupportLimits(report: string): string {
  if (/(cannot prove|does not prove|not supported|limitations|support and limits|important limits|assumptions|uncertain|uncertainty|data gap|would need)/i.test(report)) {
    return report;
  }
  return [
    report.trim(),
    "",
    "## Important Limits",
    "This is a tool-backed engineering analysis from the supplied workspace context. Treat the computed values as decision support, not as validated design, safety, finance, or permitting evidence until the underlying assumptions are checked against source data, measurements, and project-specific boundary conditions.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(text: string, max = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized;
}

function cleanText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  return "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
}

function metricLabel(value: string): string {
  return humanizeToken(value)
    .replace(/\b(pmax|pmp)\b/gi, (match) => match.toUpperCase())
    .replace(/\b(kwh|mwh|kw|mw|w|c|cop|npv|irr|capex|opex)\b/gi, (match) => match.toUpperCase());
}

function ensurePeriod(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return /[.!?)]$/.test(text) ? text : `${text}.`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean)
    : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textArray(value: unknown, keys: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return cleanText(item);
      if (isRecord(item)) {
        for (const key of keys) {
          const text = cleanText(item[key]);
          if (text) return text;
        }
      }
      return "";
    })
    .filter(Boolean);
}

function firstArrayText(value: unknown, keys: string[]): string {
  return textArray(value, keys)[0] || "";
}

function digestActionableCaveats(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function highestSeverityAction(caveats: Record<string, unknown>[]): string | null {
  const order = ["blocker", "warning", "info"];
  for (const severity of order) {
    const item = caveats.find((c) => c.severity === severity && typeof c.suggested_action === "string");
    if (item && typeof item.suggested_action === "string" && item.suggested_action.trim()) {
      return item.suggested_action.trim();
    }
  }
  return null;
}

function firstBlockerAction(caveats: Record<string, unknown>[]): string | null {
  const item = caveats.find((c) => c.severity === "blocker" && typeof c.suggested_action === "string");
  return item && typeof item.suggested_action === "string" && item.suggested_action.trim()
    ? item.suggested_action.trim()
    : null;
}

function summarizeRequiredInputs(brief: Record<string, unknown>): string | null {
  const raw =
    Array.isArray(brief.required_next_inputs) ? brief.required_next_inputs
      : Array.isArray(brief.next_data_requests) ? brief.next_data_requests
        : Array.isArray(brief.information_gaps) ? brief.information_gaps
          : [];
  const inputs = raw
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (isRecord(item)) {
        const value =
          item.parameter || item.metric || item.name || item.data_needed || item.description || item.question;
        return typeof value === "string" ? value.trim() : "";
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 4);
  return inputs.length ? `Highest-value inputs: ${inputs.join("; ")}.` : null;
}

function preliminarySubjectLine(brief: Record<string, unknown>): string | null {
  const headline = typeof brief.headline === "string" ? brief.headline.trim() : "";
  if (!headline) return null;
  const cleaned = headline
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\s+—\s+Domain:.*$/i, "")
    .replace(/\s+Provide key operating parameters.*$/i, "")
    .trim();
  if (!cleaned || cleaned.length < 20) return null;
  return `I could identify the subject, but not enough structured evidence to score it: ${truncate(cleaned, 220)}`;
}

function formatConfidenceCounts(summary: Record<string, unknown>): string | null {
  return null;
}

function metricSummaryLine(value: unknown): string {
  const metrics = recordArray(value)
    .map((metric) => {
      const label = firstText(metric.label, metric.name, metric.metric);
      const metricValue = firstText(metric.value, metric.result);
      if (!label || !metricValue) return "";
      return `${label} ${metricValue}`;
    })
    .filter(Boolean)
    .slice(0, 3);
  return metrics.length ? `Computed metrics include ${metrics.join("; ")}.` : "";
}

function isSimpleDocumentClientSummary(summary: Record<string, unknown>, content: Record<string, unknown>): boolean {
  const useCase = firstText(summary.use_case_label).toLowerCase();
  const metrics = recordArray(summary.computed_metrics);
  const screens = recordArray(content.physics_screens);
  return (
    metrics.length === 0 &&
    screens.length === 0 &&
    (
      useCase.includes("document review") ||
      useCase.includes("technical document") ||
      useCase.includes("file intake") ||
      useCase.includes("structured data") ||
      useCase.includes("fischer") ||
      useCase.includes("synthetic fuels") ||
      useCase.includes("soec") ||
      useCase.includes("solid oxide") ||
      useCase.includes("electrolysis")
    )
  );
}

function isPvProductionClientSummary(summary: Record<string, unknown>, content: Record<string, unknown>): boolean {
  const useCase = [
    firstText(summary.use_case_label),
    stringArray(content.detected_use_cases).join(" "),
  ].join(" ").toLowerCase();
  const metrics = recordArray(summary.computed_metrics);
  const labels = metrics.map((metric) => firstText(metric.label).toLowerCase()).join(" ");
  return (
    (useCase.includes("solar") || useCase.includes("photovoltaic") || useCase.includes("pv")) &&
    (
      labels.includes("peak power") ||
      labels.includes("average daily generation") ||
      labels.includes("exergy factor")
    )
  );
}

function isEnergyPlantClientSummary(summary: Record<string, unknown>, content: Record<string, unknown>): boolean {
  const useCase = [
    firstText(summary.use_case_label),
    stringArray(content.detected_use_cases).join(" "),
  ].join(" ").toLowerCase();
  const labels = recordArray(summary.computed_metrics)
    .map((metric) => firstText(metric.label).toLowerCase())
    .join(" ");
  return (
    /\b(power plant|thermal generation|plant performance|gas turbine|combined cycle|ccgt|ngcc)\b/.test(useCase) ||
    /\b(net capacity|net heat rate|fuel cost|spark spread|co2 intensity|annual co2)\b/.test(labels)
  );
}

export function isSimpleDocumentArtifact(artifact: Artifact | null | undefined): boolean {
  if (!artifact || !isRecord(artifact.content)) return false;
  const content = artifact.content;
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  return isSimpleDocumentClientSummary(summary, content);
}

function isPvProductionArtifact(artifact: Artifact | null | undefined): boolean {
  if (!artifact || !isRecord(artifact.content)) return false;
  const content = artifact.content;
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  return isPvProductionClientSummary(summary, content);
}

function isEnergyPlantArtifact(artifact: Artifact | null | undefined): boolean {
  if (!artifact || !isRecord(artifact.content)) return false;
  const content = artifact.content;
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  return isEnergyPlantClientSummary(summary, content);
}

export function isChatOnlyArtifact(artifact: Artifact | null | undefined, actionType?: string): boolean {
  if (!artifact) return false;
  const content = isRecord(artifact.content) ? artifact.content : {};
  const hasClientSummary = isRecord(content.client_summary);
  const hasEvidenceDigest = isRecord(content.evidence_digest);
  const chatFirstActions = new Set([
    "evidence_evaluation",
    "document_analysis",
    "comprehensive_analysis",
    "physics_simulation",
    "simulation_run",
    "economics_analysis",
    "environmental_site_analysis",
    "literature_search",
    "deep_research",
    "deep_agent",
    "deep_analysis",
    "scientific_review",
    "exploratory_analysis",
    "custom_chart",
    "agent_workspace",
  ]);
  return (
    (actionType && chatFirstActions.has(actionType) && (hasClientSummary || hasEvidenceDigest || artifact.type !== "report")) ||
    isSimpleDocumentArtifact(artifact) ||
    isPvProductionArtifact(artifact) ||
    isEnergyPlantArtifact(artifact) ||
    (isRecord(content.client_summary) && content.analysis_type === "exergy_agent_assessment") ||
    actionType === "literature_search" ||
    actionType === "deep_research" ||
    actionType === "deep_agent" ||
    artifact.type === "research" ||
    artifact.type === "deep_research" ||
    artifact.type === "deep_agent"
  );
}

function metricValueByLabel(summary: Record<string, unknown>, pattern: RegExp): string {
  for (const metric of recordArray(summary.computed_metrics)) {
    const label = firstText(metric.label);
    if (!pattern.test(label)) continue;
    const value = firstText(metric.value);
    return value ? `${value}${firstText(metric.unit) && !value.includes(firstText(metric.unit)) ? ` ${firstText(metric.unit)}` : ""}` : "";
  }
  return "";
}

function displayCurrencyMetric(value: string): string {
  return value
    .replace(/\$/g, "USD ")
    .replace(/\s+/g, " ")
    .replace(/USD\s+/g, "USD ")
    .trim();
}

function stripExtractionProvenance(text: string): string {
  return text
    .replace(/\$?\\text\{CO\}_2\\text\{e\}\$?/gi, "CO2e")
    .replace(/CO₂e/gi, "CO2e")
    .replace(/CO₂/gi, "CO2")
    .replace(/^.*?\bextracted\s+[\d,]+\s+characters\s+from\s+`[^`]+`\.\s*/i, "")
    .replace(/^.*?\bextracted\s+text\/tables\s+from\s+`[^`]+`\s+and\s+/i, "")
    .replace(/\bThe extract has about\s+[\d,]+\s+words,\s+[\d,]+\s+non-empty lines,\s+and\s+[\d,]+\s+notable quantitative value\(s\)\.\s*/gi, "")
    .replace(/\bDetected signals:\s*[^.]+\.?\s*/gi, "")
    .replace(/\bNotable headings:\s*[^.]+\.?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExtractionMetadataText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /extract(?:ed| has about)/i.test(text) &&
    /(characters|words|non-empty lines|detected signals|notable headings|numeric value|quantitative value|parser|pymupdf|mineru|gemini)/i.test(text)
  ) || (
    lower.includes("detected signals:") ||
    lower.includes("notable headings:") ||
    lower.includes("key extracted points:")
  );
}

function sentenceFromClaim(item: Record<string, unknown>): string {
  const claim = firstText(item.claim, item.finding, item.statement);
  const rawEvidence = firstText(item.evidence, item.support, item.description);
  const evidence = stripExtractionProvenance(rawEvidence);
  if (rawEvidence && isExtractionMetadataText(rawEvidence) && (!evidence || isExtractionMetadataText(evidence)) && claim) {
    return claim;
  }
  if (evidence && evidence.toLowerCase() !== claim.toLowerCase()) return evidence;
  return claim;
}

function comparableFact(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\b(this is|this appears to be)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleDocumentBullets(summary: Record<string, unknown>, conclusion = ""): string[] {
  const claims = recordArray(summary.supported_claims);
  const facts: Array<{ text: string; index: number }> = [];
  const conclusionKey = comparableFact(conclusion);
  let index = 0;
  for (const item of claims) {
    const text = sentenceFromClaim(item);
    if (!text) continue;
    for (const part of text.split(/\s*;\s*/)) {
      const clean = ensurePeriod(stripExtractionProvenance(part));
      const cleanKey = comparableFact(clean);
      if (
        !clean ||
        clean.length <= 8 ||
        isExtractionMetadataText(clean) ||
        (conclusionKey && (cleanKey === conclusionKey || cleanKey.includes(conclusionKey) || conclusionKey.includes(cleanKey))) ||
        facts.some((fact) => comparableFact(fact.text) === cleanKey)
      ) {
        index += 1;
        continue;
      }
      facts.push({ text: clean, index });
      index += 1;
    }
  }
  const ordered = facts
    .sort((a, b) => a.index - b.index)
    .map((fact) => fact.text);
  const priority = ordered.filter((fact) =>
    /\b(capex|opex|revenue|cost|financial|tonnes?|co2|co2e|emissions?|landfill|environmental|throughput|capacity)\b/i.test(fact)
  );
  return Array.from(new Set([...priority, ...ordered])).slice(0, 12);
}

function buildSimpleDocumentResultSummary(
  summary: Record<string, unknown>,
  content: Record<string, unknown>,
  artifact: Artifact,
): string | null {
  if (!isSimpleDocumentClientSummary(summary, content)) return null;
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const facts = simpleDocumentBullets(summary, conclusion);
  if (!conclusion && facts.length === 0) return null;

  return [
    conclusion ? ensurePeriod(truncate(stripExtractionProvenance(conclusion), 360)) : null,
    facts.length ? ["", "What I found:", ...facts.slice(0, 10).map((fact) => `- ${truncate(fact, 260)}`)].join("\n") : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function buildPvProductionResultSummary(
  summary: Record<string, unknown>,
  content: Record<string, unknown>,
  artifact: Artifact,
): string | null {
  if (!isPvProductionClientSummary(summary, content)) return null;
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const peak = metricValueByLabel(summary, /peak power/i);
  const sitePeak = metricValueByLabel(summary, /site peak/i);
  const daily = metricValueByLabel(summary, /average daily generation/i);
  const annual = metricValueByLabel(summary, /annual generation/i);
  const exergy = metricValueByLabel(summary, /exergy factor/i);
  const sunHours = metricValueByLabel(summary, /sun hours/i);
  const performanceRatio = metricValueByLabel(summary, /performance ratio/i);
  const supported = simpleDocumentBullets(summary, conclusion).slice(0, 4);
  const lines = [
    conclusion ? ensurePeriod(truncate(stripExtractionProvenance(conclusion), 520)) : "I extracted the PV module specifications and ran a one-module production estimate.",
    "",
    "Estimated output per module:",
    peak ? `- Peak power: ${peak}${sitePeak ? ` STC; about ${sitePeak} temperature-adjusted at the site peak condition` : ""}.` : null,
    daily ? `- Average daily generation: ${daily} per module${annual ? `, or about ${annual}` : ""}.` : null,
    exergy ? `- Exergy factor: ${exergy} for incoming solar radiation; generated DC electricity has exergy factor 1.0.` : null,
    sunHours || performanceRatio
      ? ["", "Calculation basis:", sunHours ? `- Equivalent sun hours: ${sunHours}.` : null, performanceRatio ? `- Performance ratio: ${performanceRatio}.` : null]
        .filter((line): line is string => typeof line === "string")
        .join("\n")
      : null,
    supported.length ? ["", "What I used from the datasheet:", ...supported.map((item) => `- ${truncate(item, 240)}`)].join("\n") : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

function buildEnergyPlantResultSummary(
  summary: Record<string, unknown>,
  content: Record<string, unknown>,
  artifact: Artifact,
): string | null {
  if (!isEnergyPlantClientSummary(summary, content)) return null;
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const netCapacity = metricValueByLabel(summary, /net capacity/i);
  const grossCapacity = metricValueByLabel(summary, /gross capacity/i);
  const heatRate = metricValueByLabel(summary, /net heat rate/i);
  const efficiency = metricValueByLabel(summary, /net efficiency/i);
  const capacityFactor = metricValueByLabel(summary, /capacity factor/i);
  const annualGeneration = metricValueByLabel(summary, /annual generation/i);
  const annualFuel = metricValueByLabel(summary, /annual fuel/i);
  const gasPrice = metricValueByLabel(summary, /gas price/i);
  const fuelCost = metricValueByLabel(summary, /fuel cost/i);
  const powerPrice = metricValueByLabel(summary, /power price/i);
  const sparkSpread = metricValueByLabel(summary, /spark spread/i);
  const co2Intensity = metricValueByLabel(summary, /co2 intensity/i);
  const annualCo2 = metricValueByLabel(summary, /annual co2/i);
  const exergyEfficiency = metricValueByLabel(summary, /exergy efficiency/i);
  const usefulInputs = [
    netCapacity ? `Net capacity: ${netCapacity}${grossCapacity ? `; gross capacity: ${grossCapacity}` : ""}.` : null,
    heatRate || efficiency ? `Heat rate / efficiency: ${heatRate || "not extracted"}${efficiency ? ` / ${efficiency}` : ""}.` : null,
    annualGeneration ? `Annual generation: ${annualGeneration}${capacityFactor ? ` at ${capacityFactor}` : ""}.` : null,
    annualFuel ? `Fuel use: ${annualFuel}.` : null,
    fuelCost ? `Fuel cost: ${displayCurrencyMetric(fuelCost)}${gasPrice ? ` using ${displayCurrencyMetric(gasPrice)} gas` : ""}.` : null,
    sparkSpread ? `Spark spread: ${displayCurrencyMetric(sparkSpread)}${powerPrice ? ` against ${displayCurrencyMetric(powerPrice)} power` : ""}.` : null,
    co2Intensity || annualCo2 ? `CO2: ${co2Intensity || "not extracted"}${annualCo2 ? `; annual CO2 ${annualCo2}` : ""}.` : null,
    exergyEfficiency ? `Exergy view: electricity has exergy factor 1.0; fuel-to-electric exergy-efficiency proxy is ${exergyEfficiency}.` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  if (!conclusion && usefulInputs.length === 0) return null;

  return [
    conclusion ? ensurePeriod(truncate(stripExtractionProvenance(conclusion), 520)) : "I extracted a plant-level performance basis and ran an operating calculation.",
    usefulInputs.length ? ["", "Estimated plant output:", ...usefulInputs.map((line) => `- ${line}`)].join("\n") : null,
    "",
    "Useful follow-ups I can answer from this basis: gas-price sensitivity, capacity-factor changes, annual fuel burn, CO2, spark spread, and what data is needed for a project-grade model.",
  ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function buildEnvironmentalSiteResultSummary(
  summary: Record<string, unknown>,
  content: Record<string, unknown>,
): string | null {
  const siteData = isRecord(content.environmental_site_data) ? content.environmental_site_data : {};
  if (!isRecord(siteData) || !Array.isArray(siteData.provider_results)) return null;
  const conclusion = firstText(summary.conclusion, siteData.executive_summary);
  const metrics = recordArray(summary.computed_metrics)
    .filter((metric) => firstText(metric.label) && firstText(metric.value))
    .slice(0, 8)
    .map((metric) => {
      const value = firstText(metric.value);
      const unit = firstText(metric.unit);
      return `${firstText(metric.label)}: ${value}${unit && !value.includes(unit) ? ` ${unit}` : ""}`;
    });
  const limitations = textArray(summary.not_proven, ["claim", "description", "message", "limitation"]).slice(0, 2);
  const next = firstArrayText(summary.recommended_actions, ["action", "recommendation", "next_step"]);
  if (!conclusion && metrics.length === 0) return null;
  return [
    conclusion ? ensurePeriod(truncate(conclusion, 720)) : "I collected environmental site context from remote data layers.",
    metrics.length ? ["", "Key site data:", ...metrics.map((metric) => `- ${metric}.`)].join("\n") : null,
    limitations.length ? ["", "Use limits:", ...limitations.map((item) => `- ${ensurePeriod(truncate(item, 240))}`)].join("\n") : null,
    next ? `\nNext, ${ensurePeriod(truncate(next, 320))}` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function buildEngineeringSolverResultSummary(content: Record<string, unknown>): string | null {
  const solver = isRecord(content.solver_result) ? content.solver_result : {};
  const solverType = firstText(solver.solver_type);
  if (solverType !== "economics" && solverType !== "physics") return null;
  const finding = firstText(solver.executive_summary, content.summary);
  const metrics = recordArray(solver.computed_metrics)
    .map((metric) => {
      const label = firstText(metric.label);
      const value = firstText(metric.value);
      const unit = firstText(metric.unit);
      if (!label || !value) return "";
      return `${label}: ${value}${unit && !value.includes(unit) ? ` ${unit}` : ""}`;
    })
    .filter(Boolean)
    .slice(0, 10);
  const assumptions = stringArray(solver.assumptions).slice(0, 3);
  const missing = stringArray(solver.missing_inputs).slice(0, 4);
  const sensitivity = recordArray(solver.sensitivity)
    .map((item) => {
      const caseLabel = firstText(item.case);
      const metricLabel = firstText(item.metric);
      const value = firstText(item.value);
      return caseLabel && metricLabel && value ? `${caseLabel}: ${metricLabel} ${value}` : "";
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!finding && metrics.length === 0) return null;
  return [
    finding ? ensurePeriod(truncate(finding, 520)) : `I ran the ${solverType} solver from the supplied inputs.`,
    metrics.length ? ["", solverType === "economics" ? "Computed economics:" : "Computed physics:", ...metrics.map((line) => `- ${ensurePeriod(line)}`)].join("\n") : null,
    sensitivity.length ? ["", "Sensitivity:", ...sensitivity.map((line) => `- ${ensurePeriod(line)}`)].join("\n") : null,
    assumptions.length ? ["", "Assumptions:", ...assumptions.map((line) => `- ${ensurePeriod(truncate(line, 220))}`)].join("\n") : null,
    missing.length ? ["", "Missing inputs that would improve this:", ...missing.map((line) => `- ${ensurePeriod(line)}`)].join("\n") : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function analystLines(input: {
  result: string;
  keyFinding?: string | null;
  confidence?: string | null;
  support?: string | null;
  caveat?: string | null;
  next?: string | null;
}): string {
  const lines = [
    ensurePeriod(input.keyFinding || input.result || "Analysis complete"),
    input.support ? `Basis: ${ensurePeriod(truncate(input.support, 320))}` : null,
    input.caveat ? `Important limit: ${ensurePeriod(truncate(input.caveat, 320))}` : null,
    input.next ? `Next, ${ensurePeriod(truncate(input.next, 320))}` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

function buildDigestResultSummary(digest: Record<string, unknown>, domain?: string): string | null {
  const status = digest.digest_status;
  if (status !== "facts_extracted" && status !== "partial_extraction") return null;

  const headlineFacts = stringArray(digest.headline_facts).slice(0, 3);
  const confidenceSummary = isRecord(digest.confidence_tier_summary) ? digest.confidence_tier_summary : {};
  const confidenceLine = formatConfidenceCounts(confidenceSummary);
  const caveats = digestActionableCaveats(digest.actionable_caveats);
  const nextAction = highestSeverityAction(caveats);
  const caveat = caveats
    .map((item) => cleanText(item.message))
    .find(Boolean) ||
    "extracted facts do not prove performance, economics, safety, or deployment readiness without source-backed validation";
  const headline = `I extracted usable evidence facts${domain ? ` for ${humanizeToken(domain)}` : ""}.`;
  const lines = [
    headline,
    headlineFacts.length ? ["", "Key facts:", ...headlineFacts.map((fact) => `- ${fact}`)].join("\n") : null,
    confidenceLine,
    `Important limit: ${caveat}`,
    nextAction ? `Next, ${nextAction}` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

function layoutSummaryLine(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const nTables = typeof value.n_tables === "number" ? value.n_tables : 0;
  const nImages = typeof value.n_images === "number" ? value.n_images : 0;
  if (nTables <= 0 && nImages <= 0) return null;
  const parts = [
    nTables > 0 ? `${nTables} table${nTables === 1 ? "" : "s"}` : null,
    nImages > 0 ? `${nImages} image/figure item${nImages === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `Document structure captured: ${parts.join(", ")}.`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function exergyMetricsLine(content: Record<string, unknown>): string | null {
  const topLevel = isRecord(content.exergy_metrics) ? content.exergy_metrics : {};
  const physicsSolver = isRecord(content.physics_solver) ? content.physics_solver : {};
  const solverMetrics = isRecord(physicsSolver.exergy_metrics) ? physicsSolver.exergy_metrics : {};
  const brief = isRecord(content.brief) ? content.brief : {};
  const metrics = Object.keys(topLevel).length > 0 ? topLevel : solverMetrics;
  const etaII = num(metrics.exergetic_efficiency) ?? num(brief.second_law_efficiency);
  if (etaII === null) return null;
  const etaI = num(metrics.first_law_efficiency);
  const qf = num(metrics.quality_factor) ?? num(brief.exergy_quality_factor);
  const pieces = [`exergetic efficiency ${(etaII * 100).toFixed(1)}%`];
  if (etaI !== null) pieces.push(`first-law ${(etaI * 100).toFixed(1)}%`);
  if (qf !== null) pieces.push(`quality factor ${qf.toFixed(2)}`);
  return `Exergy simulation: ${pieces.join(", ")}.`;
}

function intakeWarningLine(content: Record<string, unknown>): string | null {
  const failures = Array.isArray(content.intake_failures)
    ? content.intake_failures.filter(isRecord)
    : [];
  if (failures.length === 0) return null;
  const names = failures
    .map((failure) => typeof failure.filename === "string" ? failure.filename : "")
    .filter(Boolean)
    .slice(0, 3);
  const suffix = names.length > 0 ? ` (${names.join("; ")})` : "";
  return `Partial intake warning: ${failures.length} uploaded document${failures.length === 1 ? "" : "s"} could not be used${suffix}.`;
}

function evidenceFailureReason(content: Record<string, unknown>, intakeFailureCaveat?: string | null): string | null {
  if (intakeFailureCaveat) return intakeFailureCaveat;
  if (content.verdict === "not_ready") {
    return "Evidence extraction did not produce usable parameters from the uploaded documents.";
  }
  const metadata = isRecord(content.evidence_level_metadata) ? content.evidence_level_metadata : {};
  if (metadata.n_parameters_fused === 0) {
    return "Evidence extraction did not produce usable parameters from the uploaded documents.";
  }
  const caveat = stringArray(content.caveats).find((c) =>
    /Gate 0|Uploaded documents could not be used|intake failure/i.test(c),
  );
  if (caveat) return caveat;
  return null;
}

function confidenceFromClientSummary(summary: Record<string, unknown>, content: Record<string, unknown>): string {
  const evidenceLabel = firstText(summary.evidence_label);
  const confidence = firstText(summary.confidence);
  const evidenceLevel = firstText(summary.evidence_level, content.evidence_level);
  const humanConfidence = confidence ? humanizeToken(confidence) : "";
  if (evidenceLabel && humanConfidence && evidenceLabel.toLowerCase() !== humanConfidence.toLowerCase()) {
    return `${evidenceLabel}; ${humanConfidence}`;
  }
  return evidenceLabel || humanConfidence || evidenceLevel || "Bounded by the available project evidence";
}

function buildClientSummaryResultSummary(
  summary: Record<string, unknown>,
  content: Record<string, unknown>,
  artifact: Artifact,
): string | null {
  const decision = firstText(summary.decision, artifact.title, "Analysis complete");
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const confidence = confidenceFromClientSummary(summary, content);
  const supported = firstArrayText(summary.supported_claims, [
    "claim",
    "finding",
    "statement",
    "evidence",
    "support",
  ]);
  const metrics = metricSummaryLine(summary.computed_metrics);
  const notProven = firstArrayText(summary.not_proven, [
    "claim",
    "description",
    "message",
    "limitation",
  ]);
  const priority = isRecord(summary.priority_recommendation) ? summary.priority_recommendation : {};
  const next = firstText(
    priority.title,
    firstArrayText(summary.recommended_actions, ["action", "recommendation", "next_step", "request"]),
    firstArrayText(summary.data_requests, ["request", "action", "data_needed", "description"]),
  );
  const warning = firstText(summary.client_warning);
  if (!conclusion && !supported && !metrics && !next) return null;

  return analystLines({
    result: decision,
    keyFinding: conclusion,
    support: supported || metrics || "a bounded view from the uploaded evidence and saved artifacts",
    caveat: notProven || warning || "the result is not a capital decision, validation report, or proof of field performance",
    next,
  });
}

function numericMetricPairs(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const formatMetricValue = (metricValue: string | number): string => {
    if (typeof metricValue === "string") return metricValue;
    const fixed = Number(metricValue).toFixed(4).replace(/\.?0+$/, "");
    return fixed || "0";
  };
  return Object.entries(value)
    .filter(([, metricValue]) =>
      typeof metricValue === "number" ||
      typeof metricValue === "string"
    )
    .slice(0, 5)
    .map(([key, metricValue]) => `${metricLabel(key)}=${formatMetricValue(metricValue as string | number)}`);
}

function buildPhysicsResultSummary(actionType: string, artifact: Artifact, content: Record<string, unknown>): string | null {
  const physicsSolver = isRecord(content.physics_solver) ? content.physics_solver : {};
  const outputMetrics = isRecord(physicsSolver.output_metrics) ? physicsSolver.output_metrics : {};
  const summaryMetrics = isRecord(content.summary) ? content.summary : {};
  const metricPairs = [
    ...numericMetricPairs(outputMetrics),
    ...numericMetricPairs(summaryMetrics),
  ].slice(0, 5);
  if (metricPairs.length === 0) return null;

  const assumptions = textArray(physicsSolver.solver_assumptions, []);
  const unmodeled = textArray(physicsSolver.unmodeled_phenomena, []);
  const caveat =
    assumptions[0] ? `Solver assumption: ${assumptions[0]}`
      : unmodeled[0] ? `Unmodeled phenomenon: ${unmodeled[0]}`
        : firstArrayText(content.limitations, ["limitation", "message", "description"]) ||
          "the calculation is not empirical validation unless the inputs came from measured operating data";

  return analystLines({
    result: actionType === "physics_simulation" ? "Physics simulation complete" : "Simulation complete",
    keyFinding: metricPairs.join("; "),
    caveat,
    next: "Compare the computed outputs against measured operating data or a published benchmark before relying on them as validation",
  });
}

function buildResearchResultSummary(actionType: string, artifact: Artifact, content: Record<string, unknown>): string | null {
  const finding = firstText(
    content.executive_summary,
    content.summary,
    firstArrayText(content.findings, ["statement", "finding", "title", "summary"]),
    artifact.summary,
  );
  if (!finding) return null;
  const findings = textArray(content.findings, ["statement", "finding", "title", "summary"])
    .map((item) => item.replace(/\bSource needed:?\s*/gi, "").trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, 4);
  const caveat = firstText(
    firstArrayText(content.limitations, ["limitation", "message", "description"]),
    firstArrayText(content.caveats, ["limitation", "message", "description"]),
  );
  const lines = [
    ensurePeriod(truncate(finding, 700)),
    findings.length ? ["", ...findings.map((item) => `- ${ensurePeriod(truncate(item, 320))}`)].join("\n") : null,
    caveat ? `\nNote: ${ensurePeriod(truncate(caveat, 260))}` : null,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.join("\n");
}

function buildExploratoryResultSummary(actionType: string, artifact: Artifact, content: Record<string, unknown>): string | null {
  const chartSpecs = Array.isArray(content.chart_specs)
    ? content.chart_specs
    : content.chart_spec ? [content.chart_spec] : [];
  const finding = firstText(content.analysis_summary, content.executive_summary, content.summary, artifact.summary);
  if (!finding && chartSpecs.length === 0) return null;
  return analystLines({
    result: chartSpecs.length > 0
      ? `Generated ${chartSpecs.length} chart-ready view${chartSpecs.length === 1 ? "" : "s"}`
      : actionType === "custom_chart" ? "Chart analysis complete" : "Exploratory analysis complete",
    keyFinding: finding,
    caveat: firstArrayText(content.limitations, ["limitation", "message", "description"]) ||
      "external use still needs metric units, source artifact, and operating basis for every plotted value",
    next: firstArrayText(content.recommended_actions, ["action", "recommendation", "next_step"]) ||
      "Use the result to choose which metric needs source-backed normalization next",
  });
}

function buildDeepAnalysisResultSummary(actionType: string, artifact: Artifact, content: Record<string, unknown>): string | null {
  const finding = firstText(
    firstArrayText(content.key_findings, ["finding", "claim", "statement", "summary"]),
    content.analysis_summary,
    content.executive_summary,
    artifact.summary,
  );
  if (!finding) return null;
  return analystLines({
    result: actionType === "scientific_review" ? "Scientific review complete" : "Analysis complete",
    keyFinding: finding,
    caveat: firstText(
      firstArrayText(content.risks, ["risk", "finding", "message", "description"]),
      firstArrayText(content.limitations, ["limitation", "message", "description"]),
      firstArrayText(content.tradeoffs, ["tradeoff", "message", "description"]),
      firstArrayText(content.assumptions, ["assumption", "message", "description"]),
      "the analysis adds interpretation, not new measured evidence",
    ),
    next: firstArrayText(content.recommended_actions, ["action", "recommendation", "next_step"]) ||
      "Use this to decide the next evidence request or analysis branch",
  });
}

function buildStructuredArtifactResultSummary(actionType: string, artifact: Artifact): string | null {
  const content = isRecord(artifact.content) ? artifact.content : {};

  if (actionType === "deep_agent" || artifact.type === "deep_agent" || content.analysis_type === "deep_agent") {
    const finalAnswer = typeof content.final_answer === "string" ? content.final_answer.trim() : "";
    if (finalAnswer) return finalAnswer;
    const finding = firstText(
      firstArrayText(content.evidence_ledger, ["claim", "summary", "title"]),
      artifact.summary,
      artifact.title,
    );
    if (finding) {
      return analystLines({
        result: "Deep agent run complete",
        keyFinding: finding,
        caveat: firstArrayText(content.verification, ["message", "detail"]) ||
          "client use still requires source-backed assumptions and review of any verification warnings",
        next: "Use the saved evidence ledger and generated files to continue the analysis or request a client-ready brief",
      });
    }
  }

  if (actionType === "agent_workspace" || artifact.type === "workspace_run" || content.analysis_type === "agent_workspace") {
    const report = typeof content.report_markdown === "string" ? content.report_markdown.trim() : "";
    if (report) {
      return ensureWorkspaceSupportLimits(appendWorkspaceFileTablesForChat(cleanWorkspaceReportForChat(report), content));
    }
    const resultSummary = firstText(
      isRecord(content.results) ? content.results.summary : "",
      artifact.summary,
      artifact.title,
    );
    if (resultSummary) return resultSummary;
  }

  const clientSummary = isRecord(content.client_summary) ? content.client_summary : null;
  if (clientSummary) {
    const energyPlantSummary = buildEnergyPlantResultSummary(clientSummary, content, artifact);
    if (energyPlantSummary) return energyPlantSummary;
    const pvSummary = buildPvProductionResultSummary(clientSummary, content, artifact);
    if (pvSummary) return pvSummary;
    const environmentalSiteSummary = buildEnvironmentalSiteResultSummary(clientSummary, content);
    if (environmentalSiteSummary) return environmentalSiteSummary;
    const engineeringSolverSummary = buildEngineeringSolverResultSummary(content);
    if (engineeringSolverSummary) return engineeringSolverSummary;
    const documentSummary = buildSimpleDocumentResultSummary(clientSummary, content, artifact);
    if (documentSummary) return documentSummary;
    const summary = buildClientSummaryResultSummary(clientSummary, content, artifact);
    if (summary) return summary;
  }

  if (
    actionType === "physics_simulation" ||
    actionType === "simulation_run" ||
    artifact.type === "simulation"
  ) {
    const summary = buildPhysicsResultSummary(actionType, artifact, content);
    if (summary) return summary;
  }

  if (
    actionType === "literature_search" ||
    actionType === "deep_research" ||
    artifact.type === "research" ||
    artifact.type === "deep_research"
  ) {
    const summary = buildResearchResultSummary(actionType, artifact, content);
    if (summary) return summary;
  }

  if (
    actionType === "custom_chart" ||
    actionType === "exploratory_analysis" ||
    Array.isArray(content.chart_specs) ||
    content.chart_spec
  ) {
    const summary = buildExploratoryResultSummary(actionType, artifact, content);
    if (summary) return summary;
  }

  if (
    actionType === "deep_analysis" ||
    actionType === "scientific_review" ||
    artifact.type === "deep_analysis" ||
    artifact.type === "scientific_review" ||
    Array.isArray(content.key_findings)
  ) {
    const summary = buildDeepAnalysisResultSummary(actionType, artifact, content);
    if (summary) return summary;
  }

  return null;
}

export function buildActionResultSummary(input: {
  actionType: string;
  artifact: Artifact | null;
  intakeFailureCaveat?: string | null;
}): string {
  const actionType = input.actionType || "action";
  if (!input.artifact) {
    return sanitize([
      "I could not finish the requested tool run in this message, so I do not want to pretend a completed analysis exists.",
      "The request context is still preserved. Retry the run, or ask a narrower follow-up and I can answer from the available chat context while the underlying configuration is checked.",
    ].join("\n"));
  }

  const content = isRecord(input.artifact.content) ? input.artifact.content : {};
  if (actionType === "evidence_evaluation") {
    const digest = isRecord(content.evidence_digest) ? content.evidence_digest : null;
    const digestStatus = digest && typeof digest.digest_status === "string" ? digest.digest_status : null;
    const digestCaveats = digest ? digestActionableCaveats(digest.actionable_caveats) : [];
    const failure = evidenceFailureReason(content, input.intakeFailureCaveat);
    if (failure) {
      const brief = isRecord(content.brief) ? content.brief : {};
      const subjectLine = preliminarySubjectLine(brief);
      const nextInputs = summarizeRequiredInputs(brief);
      const nextAction = digest ? firstBlockerAction(digestCaveats) : null;
      return sanitize([
        `**Could not complete:** ${failure}`,
        subjectLine,
        nextInputs || nextAction || "Next: upload a higher-quality text-searchable source document, or provide the key operating, cost, safety, and deployment data directly.",
      ].filter(Boolean).join("\n"));
    }
    if (digest && (digestStatus === "intake_failed" || digestStatus === "no_extracted_facts")) {
      const blocker = digestCaveats.find((c) => c.severity === "blocker");
      const message = typeof blocker?.message === "string"
        ? blocker.message
        : "Evidence extraction did not produce usable parameters from the uploaded documents.";
      const nextAction = firstBlockerAction(digestCaveats);
      return sanitize(
        `**Could not complete:** ${message} ${nextAction || "Try uploading a higher-quality datasheet PDF or a text-searchable copy."}`,
      );
    }
    const structuredSummary = buildStructuredArtifactResultSummary(actionType, input.artifact);
    if (structuredSummary) return sanitize(structuredSummary);
    if (digest) {
      const digestSummary = buildDigestResultSummary(
        digest,
        typeof content.domain === "string" ? content.domain : undefined,
      );
      if (digestSummary) {
        const layoutLine = layoutSummaryLine(content.evidence_layout_summary);
        const exergyLine = exergyMetricsLine(content);
        const intakeLine = intakeWarningLine(content);
        return sanitize([digestSummary, exergyLine, layoutLine, intakeLine].filter(Boolean).join("\n"));
      }
    }

    const brief = isRecord(content.brief) ? content.brief : {};
    const domain = typeof content.domain === "string" ? content.domain : undefined;
    const evidenceLevel =
      typeof content.evidence_level === "string" ? content.evidence_level
        : typeof brief.evidence_level === "string" ? brief.evidence_level
          : undefined;
    const score = typeof content.score === "number" ? content.score : undefined;
    const metadata = isRecord(content.evidence_level_metadata) ? content.evidence_level_metadata : {};
    const paramCount = typeof metadata.n_parameters_fused === "number" ? metadata.n_parameters_fused : undefined;
    const parts = [
      domain ? `domain ${domain}` : null,
      evidenceLevel ? `evidence ${evidenceLevel}` : null,
      score !== undefined ? `score ${score.toFixed(2)}` : null,
      paramCount !== undefined ? `${paramCount} parameters fused` : null,
    ].filter(Boolean);
    const layoutLine = layoutSummaryLine(content.evidence_layout_summary);
    const exergyLine = exergyMetricsLine(content);
    const intakeLine = intakeWarningLine(content);
    return sanitize([
      `Evidence evaluation complete${parts.length ? ` (${parts.join(", ")})` : ""}.`,
      exergyLine,
      layoutLine,
      intakeLine,
      `The available evidence supports ${parts.length ? `a bounded evidence view with ${parts.join(", ")}` : "a bounded evidence view only"}.`,
      "It does not yet establish decision-ready performance, economics, safety, deployment readiness, or solver-backed validation without source-backed operating, boundary, and reference data.",
      "Next, use the fused parameters and evidence gaps to choose the next measurement or source request.",
    ].filter(Boolean).join("\n"));
  }

  const structuredSummary = buildStructuredArtifactResultSummary(actionType, input.artifact);
  if (structuredSummary) return sanitize(structuredSummary);

  const summary = input.artifact.summary || input.artifact.title || actionType;
  return sanitize(truncate(String(summary)));
}
