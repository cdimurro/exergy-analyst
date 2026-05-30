import type { AttachmentEvidenceSummary } from "@/lib/initial-evaluation-guardrail";
import type { ProjectDocument } from "@/lib/storage/types";

export interface DocumentEvidenceDigest {
  source_label: string;
  source_labels?: string[];
  filename: string;
  content_type: "text" | "csv" | "unknown";
  facts: string[];
  assumptions: string[];
  unsupported_claims: string[];
  contradicted_claims: string[];
  missing_inputs: string[];
  next_actions: string[];
  chartable_fields: string[];
  non_chartable_fields: string[];
  failed_extraction: boolean;
  preview: string;
}

export interface SalientSourceValue {
  label: string;
  value: number;
  raw: string;
  unit: string;
  source: string;
  filename: string;
  context: string;
}

const TEXT_EXTENSIONS = /\.(md|txt|csv|tsv|json|yaml|yml)$/i;
const CSV_EXTENSIONS = /\.(csv|tsv)$/i;
const VALUE_RE =
  /(\$?\b-?\d+(?:,\d{3})*(?:\.\d+)?\b)\s*(mA\/cm2|m3\/day|m3\/d|kg\/h|\/MWh|\/kWh|\/kg|\/bbl|\/kW|GWh|MWh|kWh|Wh|GW|MW|kW|W|percent|%|tonnes?|tpy|bpd|gpd|lpm|lph|m3|psi|bar|degC|°C|C|K|V|A|USD|years?|yr|hours?|h|ppm)?/gi;
const DECISION_VALUE_RE =
  /\b(capacity|power|temperature|cop|capex|opex|wacc|price|cost|emission|efficiency|factor|flow|demand|availability|hours?|recovery|energy|pressure|voltage|current|mass|production|yield|rate|life|tds|water|fuel|co2|h2|heat|thermal|pump|compressor|refrigeration|charger|battery|permit|interconnection|hosting|load)\b/i;

function decodePdfLiteralString(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_match, char: string) => {
      if (char === "n" || char === "r") return "\n";
      if (char === "t") return "\t";
      if (char === "b" || char === "f") return " ";
      return char;
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function extractSimplePdfText(data: Buffer): string {
  const raw = data.toString("latin1");
  if (!/%PDF-/.test(raw)) return "";
  const chunks: string[] = [];
  const streams = Array.from(raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)).map((match) => match[1] || "");
  for (const stream of streams.length ? streams : [raw]) {
    for (const match of stream.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g)) {
      chunks.push(decodePdfLiteralString(match[1] || ""));
    }
    for (const arrayMatch of stream.matchAll(/\[((?:\s*\([^()]*(?:\\.[^()]*)*\)\s*)+)\]\s*TJ/g)) {
      const arrayText = Array.from((arrayMatch[1] || "").matchAll(/\(([^()]*(?:\\.[^()]*)*)\)/g))
        .map((match) => decodePdfLiteralString(match[1] || ""))
        .join("");
      if (arrayText) chunks.push(arrayText);
    }
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function compactLine(line: string): string {
  return line.replace(/\s+/g, " ").replace(/^\s*[-*]\s*/, "").trim();
}

function parseSourceNumber(raw: string): number | null {
  const parsed = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = compactLine(value);
    if (!trimmed || seen.has(trimmed)) continue;
    if (/:\s*$/.test(trimmed)) continue;
    if (/^\|.*\|$/.test(trimmed) && !/\d/.test(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

function sourceLabelFromText(filename: string, text: string): string {
  const labels = sourceLabelsFromText(filename, text);
  if (labels.length > 0) return labels[0];
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return stem ? stem.toUpperCase() : "UPLOADED-DOCUMENT";
}

function sourceLabelsFromText(filename: string, text: string): string[] {
  const match = text.match(/\bsource[_\s-]*labels?\s*[:=]\s*([^\n]+)/i);
  if (!match?.[1]) return [];
  const labels = Array.from(match[1].matchAll(/[A-Z][A-Z0-9_-]{2,}/g))
    .map((item) => item[0])
    .filter((label) => !/SOURCE|LABELS?/i.test(label));
  return unique(labels, 12);
}

function sourceLabelFromRows(filename: string, rows: string[][]): string {
  const header = rows[0] || [];
  const sourceIdx = header.findIndex((h) => /^source[_\s-]*label$/i.test(h.trim()));
  if (sourceIdx >= 0) {
    const first = rows.slice(1).map((row) => row[sourceIdx]).find((value) => value?.trim());
    if (first) return first.trim();
  }
  return sourceLabelFromText(filename, "");
}

function labelsForDigest(digest: DocumentEvidenceDigest): string[] {
  return digest.source_labels?.length ? digest.source_labels : [digest.source_label];
}

function displayLabelForDigest(digest: DocumentEvidenceDigest): string {
  return labelsForDigest(digest).join("/");
}

function sourceValueLabel(line: string): string {
  const beforeColon = line.split(":")[0]?.trim();
  if (beforeColon && beforeColon.length <= 70 && /[a-z]/i.test(beforeColon)) {
    return beforeColon.replace(/\s+/g, " ");
  }
  const words = line
    .replace(VALUE_RE, "")
    .replace(/[^a-z0-9/% -]+/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .join(" ");
  return words || "source value";
}

function extractSalientValuesFromLine(line: string, digest: DocumentEvidenceDigest, out: SalientSourceValue[]): void {
  const context = compactLine(line);
  if (/^source[_\s-]*labels?\s*[:=]/i.test(context)) return;
  if (!context || (!DECISION_VALUE_RE.test(context) && !/[A-Za-z].*\d|\d.*[A-Za-z]/.test(context))) return;
  for (const match of context.matchAll(VALUE_RE)) {
    const raw = match[1] || match[0];
    const value = parseSourceNumber(raw);
    if (value === null) continue;
    const unit = match[2] || "";
    if (!unit && !DECISION_VALUE_RE.test(context)) continue;
    if (/^\d{4}$/.test(raw.replace(/[$,]/g, "")) && /\b(date|year|version|rev|copyright)\b/i.test(context)) continue;
    out.push({
      label: sourceValueLabel(context),
      value,
      raw,
      unit,
      source: displayLabelForDigest(digest),
      filename: digest.filename,
      context: context.slice(0, 240),
    });
  }
}

function sourceValueCandidateLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map(compactLine).filter(Boolean);
  return lines.flatMap((line) => {
    if (line.length <= 220) return [line];
    const sentenceChunks = line
      .split(/(?<=[.;])\s+(?=[A-Z][A-Za-z0-9%/$ -]{2,}:?)/)
      .map(compactLine)
      .filter(Boolean);
    return sentenceChunks.length > 1 ? sentenceChunks : [line];
  });
}

function factPriority(value: string): number {
  const text = value.toLowerCase();
  let score = 0;
  if (/\[test-report/.test(text)) score -= 20;
  if (/\bmeasured\b|\brecorded\b|\bsupported by\b|\bliquid output\b|\boperated\b|\boperating conditions?/.test(text)) score -= 25;
  if (/\btest date\b/.test(text)) score += 5;
  if (/\[customer-summary/.test(text)) score -= 10;
  if (/\[cost-model|capex|opex|usd|cost/.test(text)) score -= 5;
  if (/\bnote:/.test(text)) score += 25;
  if (/\[investor-deck/.test(text)) score += 10;
  return score;
}

function rankFacts(values: string[]): string[] {
  return values
    .map((value, index) => ({ value, index, priority: factPriority(value) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.value);
}

function isChartableEvidenceField(digest: DocumentEvidenceDigest, item: string): boolean {
  const text = `${item} ${digest.filename} ${displayLabelForDigest(digest)}`.toLowerCase();
  if (/\bclaim(?:ed|s)?\b/.test(text)) return false;
  if (/\bdeck\b/.test(text) && !/\b(table|csv|dataset|operating data|cost model)\b/.test(text)) return false;
  return true;
}

function chartableFieldPriority(value: string): number {
  const text = value.toLowerCase();
  let score = 0;
  if (/\[ops-data|operating[_\s-]*data/.test(text)) score -= 40;
  if (/\bliquid[_\s-]*output|\boutput\b|\befficiency|\benergy/.test(text)) score -= 25;
  if (/\btemperature|\bpressure|\bflow|\bfeed|\bheater/.test(text)) score -= 15;
  if (/\[test-report/.test(text)) score -= 10;
  if (/\[cost-model|\bcost\b|\bcapex\b|\bopex\b/.test(text)) score += 15;
  return score;
}

function rankChartableFields(values: string[]): string[] {
  return values
    .map((value, index) => ({ value, index, priority: chartableFieldPriority(value) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.value);
}

function splitDelimited(text: string, delimiter: "," | "\t"): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

function parseMarkdownSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let current = "body";
  for (const raw of lines) {
    const line = compactLine(raw);
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/) || line.match(/^([A-Za-z][A-Za-z\s/-]+):$/);
    if (heading?.[1]) {
      current = heading[1].toLowerCase();
      sections[current] ||= [];
      continue;
    }
    sections[current] ||= [];
    sections[current].push(line);
  }
  return sections;
}

function sectionItems(sections: Record<string, string[]>, pattern: RegExp): string[] {
  return Object.entries(sections)
    .filter(([name]) => pattern.test(name))
    .flatMap(([, values]) => values)
    .filter((line) => !/^\|?\s*-+\s*\|/.test(line));
}

function evidenceLinesByKeyword(lines: string[], pattern: RegExp): string[] {
  return lines.map(compactLine).filter((line) => pattern.test(line));
}

function markdownTableCells(line: string): string[] | null {
  const text = compactLine(line);
  if (!/^\|.*\|$/.test(text)) return null;
  const cells = text.replace(/^\|/, "").replace(/\|$/, "").split("|").map(compactLine);
  if (cells.length < 2) return null;
  if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return cells;
}

function statusTableItems(lines: string[], statusPattern: RegExp, statusLabel: string): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const cells = markdownTableCells(line);
    if (!cells || cells.length < 3) continue;
    const status = cells[cells.length - 1] || "";
    const claim = cells[0] || "";
    if (!statusPattern.test(status)) continue;
    if (/^claim$/i.test(claim) || /^status$/i.test(status)) continue;
    const basis = cells.slice(1, -1).filter((cell) => cell && !/^not emphasized$/i.test(cell)).join("; ");
    items.push(`${claim} is ${statusLabel}${basis ? `: ${basis}` : ""}.`);
  }
  return items;
}

function isEvidenceExpectationAnnotation(line: string): boolean {
  return /^Evidence expectation\s*:/i.test(compactLine(line));
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cleanEvidenceExpectationAnnotation(line: string): string {
  const text = compactLine(line);
  const match = text.match(/^Evidence expectation\s*:\s*(supported|unsupported|contradicted|missing|blocked)?\s*;?\s*(.+)$/i);
  if (!match?.[2]) return text;
  const status = match[1]?.toLowerCase() || "";
  const detail = compactLine(match[2]);
  if (!detail) return "";
  if (status === "contradicted") {
    const withoutBy = detail.replace(/^by\s+/i, "");
    return sentenceCase(`contradicted by ${withoutBy}`);
  }
  return sentenceCase(detail);
}

function ownerForMissingInput(value: string, context = ""): string {
  const text = `${value} ${context}`.toLowerCase();
  if (/\b(wacc|discount|finance|financing|npv|irr|payback|revenue|price|margin|capex|opex|cost|utilization|lifetime|feedstock)\b/.test(text)) {
    return "finance owner";
  }
  if (/\b(customer|qualification|acceptance|outreach|sales)\b/.test(text)) {
    return "commercial owner";
  }
  if (/\b(permit|regulatory|emissions|environmental)\b/.test(text)) {
    return "regulatory or EHS owner";
  }
  if (/\b(scale|capacity|module|integration|commercial\s+module)\b/.test(text)) {
    return "engineering owner";
  }
  if (/\b(assay|durability|repeatability|run|test|temperature|pressure|feed|output|sensor|flow|heater|mass-balance|quality|uptime|availability|maintenance|catalyst)\b/.test(text)) {
    return "technical test owner";
  }
  return "data owner";
}

function sentenceWithOwner(value: string, owner: string): string {
  const text = compactLine(value).replace(/\.$/, "");
  if (!text) return "";
  if (/\bowner\s*:/i.test(text)) return `${text}.`;
  return `${text}. Owner: ${owner}.`;
}

function digestText(filename: string, text: string): DocumentEvidenceDigest {
  const lines = text.split(/\r?\n/).map(compactLine).filter(Boolean);
  const sections = parseMarkdownSections(lines);
  const label = sourceLabelFromText(filename, text);
  const labels = sourceLabelsFromText(filename, text);
  const failed = /\bextraction\s+status\s*:\s*failed\b/i.test(text) || /\bfailed extraction\b/i.test(filename);

  const facts = [
    ...evidenceLinesByKeyword(lines, /\bsupported by\b|\bmeasured\b|\brecorded\b|\boperated\b|\btest date\b|\bvalue\b|\bunit\b/i),
    ...sectionItems(sections, /key measured claims?|operating conditions?/i),
    ...statusTableItems(lines, /^supported$/i, "supported"),
  ].filter((line) => !isEvidenceExpectationAnnotation(line));
  const unsupported = [
    ...evidenceLinesByKeyword(lines, /\bunsupported\b|\bnot supported\b|\bno\b.*\bincluded\b|\bdo not claim\b|\bdo not say\b/i),
    ...sectionItems(sections, /unsupported|internal-only|what should not|limits of test/i),
    ...statusTableItems(lines, /^unsupported$/i, "unsupported"),
  ].map(cleanEvidenceExpectationAnnotation);
  const contradicted = evidenceLinesByKeyword(lines, /\bcontradicted\b|\bconflict\b|\bbench-scale only\b|\bno pilot/i)
    .filter((line) => !/^source\s+labels?\s*:/i.test(compactLine(line)))
    .concat(statusTableItems(lines, /^contradicted$/i, "contradicted"))
    .map(cleanEvidenceExpectationAnnotation);
  const missing = [
    ...evidenceLinesByKeyword(lines, /\bmissing\b|\brequired before\b|\bnot recorded\b|\bno\b.*\bprovided\b|\bno\b.*\bincluded\b/i)
      .filter((line) => !/^#{1,6}\s+/.test(line))
      .filter((line) => !markdownTableCells(line)),
    ...sectionItems(sections, /missing|recovery request|limits of test/i),
  ]
    .map(cleanEvidenceExpectationAnnotation)
    .map((item) => sentenceWithOwner(item, ownerForMissingInput(item, filename)));
  const chartable = [
    ...sectionItems(sections, /^chartable/i),
  ];
  const nonChartable = sectionItems(sections, /non-chartable/i);
  const nextActions = [
    ...sectionItems(sections, /recovery request|missing evidence|next/i),
    ...evidenceLinesByKeyword(lines, /\b(recollect|provide|upload|ask|confirm)\b/i),
  ];

  return {
    source_label: label,
    source_labels: labels.length > 0 ? labels : [label],
    filename,
    content_type: "text",
    facts: unique(facts),
    assumptions: [],
    unsupported_claims: unique(unsupported),
    contradicted_claims: unique(contradicted),
    missing_inputs: unique(missing),
    next_actions: unique(nextActions.map((item) => sentenceWithOwner(item, ownerForMissingInput(item, filename)))),
    chartable_fields: unique(chartable),
    non_chartable_fields: unique(nonChartable),
    failed_extraction: failed,
    preview: lines.slice(0, 20).join("\n").slice(0, 3000),
  };
}

function digestCsv(filename: string, text: string): DocumentEvidenceDigest {
  const delimiter = filename.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const rows = splitDelimited(text, delimiter);
  const header = rows[0] || [];
  const sourceLabel = sourceLabelFromRows(filename, rows);
  const lowerHeader = header.map((h) => h.toLowerCase());
  const numericFields = new Set<string>();
  const missingInputs: string[] = [];
  const facts: string[] = [];
  const notes: string[] = [];

  for (const row of rows.slice(1)) {
    const category = row[lowerHeader.indexOf("category")] || "";
    const lineItem = row[lowerHeader.indexOf("line_item")] || row[lowerHeader.indexOf("run_id")] || "";
    const value = row[lowerHeader.indexOf("value")] || "";
    const unit = row[lowerHeader.indexOf("unit")] || "";
    const basis = row[lowerHeader.indexOf("basis")] || "";
    const note = row[lowerHeader.indexOf("notes")] || "";
    const hasValueColumn = lowerHeader.indexOf("value") >= 0;
    if (hasValueColumn && (/missing/i.test(category) || value === "")) {
      const missingName = lineItem || row.find(Boolean) || "unnamed input";
      const owner = ownerForMissingInput(missingName, `${category} ${basis} ${note} ${filename}`);
      missingInputs.push(sentenceWithOwner(
        `${missingName}${unit ? ` (${unit})` : ""}${basis ? ` on ${basis}` : ""} is missing`,
        owner,
      ));
    } else if (hasValueColumn && lineItem && value) {
      facts.push(`${lineItem}: ${value}${unit ? ` ${unit}` : ""}${basis ? ` on ${basis}` : ""}.`);
    }
    if (note) notes.push(`${lineItem || "row"} note: ${note}`);

    header.forEach((field, idx) => {
      if (idx === 0) return;
      const cell = row[idx];
      if (cell && /^-?\d+(\.\d+)?$/.test(cell)) numericFields.add(field);
    });
  }

  const valueIdx = lowerHeader.indexOf("value");
  const categoryIdx = lowerHeader.indexOf("category");
  const rowLabelIdx = lowerHeader.indexOf("run_id") >= 0 ? lowerHeader.indexOf("run_id") : lowerHeader.indexOf("line_item");
  const numericColumnIndexes = header
    .map((field, idx) => ({ field, idx }))
    .filter(({ field, idx }) =>
      idx > 0 &&
      !/^source[_\s-]*label$/i.test(field) &&
      rows.slice(1).some((row) => {
        const cell = row[idx];
        return cell && /^-?\d+(\.\d+)?$/.test(cell);
      }),
    );

  for (const row of rows.slice(1)) {
    const rowLabel = rowLabelIdx >= 0 ? row[rowLabelIdx] : "";
    const category = categoryIdx >= 0 ? row[categoryIdx] : "";
    for (const { field, idx } of numericColumnIndexes) {
      if (idx === valueIdx && /missing/i.test(category)) continue;
      if (row[idx] !== "") continue;
      const owner = ownerForMissingInput(field, `${category} ${rowLabel} ${filename}`);
      const subject = rowLabel ? `${field} for ${rowLabel}` : field;
      missingInputs.push(sentenceWithOwner(`${subject} is missing`, owner));
    }
  }

  return {
    source_label: sourceLabel,
    source_labels: [sourceLabel],
    filename,
    content_type: "csv",
    facts: unique([...facts, ...notes], 18),
    assumptions: [],
    unsupported_claims: [],
    contradicted_claims: [],
    missing_inputs: unique(missingInputs, 18),
    next_actions: unique(missingInputs.map((item) => `Provide ${item.replace(/\.$/, "")} with source basis.`), 10),
    chartable_fields: unique(Array.from(numericFields).map((field) => `${field} from ${sourceLabel}`), 18),
    non_chartable_fields: unique(header.filter((field) => !numericFields.has(field)).map((field) => `${field} from ${sourceLabel}`), 18),
    failed_extraction: false,
    preview: rows.slice(0, 8).map((row) => row.join(delimiter)).join("\n").slice(0, 3000),
  };
}

export function buildDocumentEvidenceDigest(filename: string, data: Buffer, mimeType = ""): DocumentEvidenceDigest | null {
  if (/\.pdf$/i.test(filename) || /^application\/pdf\b/i.test(mimeType)) {
    const text = extractSimplePdfText(data);
    return text ? digestText(filename, text) : null;
  }
  if (!TEXT_EXTENSIONS.test(filename) && !/^text\//i.test(mimeType) && !/csv|json|yaml|markdown/i.test(mimeType)) {
    return null;
  }
  const text = data.toString("utf-8").replace(/\0/g, "").trim();
  if (!text) return null;
  if (CSV_EXTENSIONS.test(filename) || /csv|tsv/i.test(mimeType)) {
    return digestCsv(filename, text);
  }
  return digestText(filename, text);
}

export function isDocumentEvidenceDigest(value: unknown): value is DocumentEvidenceDigest {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as DocumentEvidenceDigest).source_label === "string";
}

export function summarizeDocumentEvidence(documents: ProjectDocument[]): AttachmentEvidenceSummary | undefined {
  const digests = documents
    .map((doc) => doc.extraction_result?.document_evidence)
    .filter(isDocumentEvidenceDigest);
  if (digests.length === 0) return undefined;
  return {
    sourceLabels: unique(digests.flatMap((digest) => labelsForDigest(digest).map((label) => `${label} (${digest.filename})`)), 20),
    facts: rankFacts(unique(digests.flatMap((digest) => digest.facts.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 100)).slice(0, 24),
    assumptions: unique(digests.flatMap((digest) => digest.assumptions.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 12),
    unsupportedClaims: unique(digests.flatMap((digest) => digest.unsupported_claims.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 24),
    contradictedClaims: unique(digests.flatMap((digest) => digest.contradicted_claims.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 18),
    missingInputs: unique(digests.flatMap((digest) => digest.missing_inputs.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 60),
    nextActions: unique(digests.flatMap((digest) => digest.next_actions.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 18),
    chartableFields: rankChartableFields(unique(
      digests.flatMap((digest) =>
        digest.chartable_fields
          .filter((item) => isChartableEvidenceField(digest, item))
          .map((item) => `[${displayLabelForDigest(digest)}] ${item}`),
      ),
      24,
    )),
    nonChartableFields: unique(digests.flatMap((digest) => digest.non_chartable_fields.map((item) => `[${displayLabelForDigest(digest)}] ${item}`)), 18),
    failedExtractions: unique(digests.filter((digest) => digest.failed_extraction).map((digest) => `[${displayLabelForDigest(digest)}] ${digest.filename}`), 12),
  };
}

export function salientSourceValuesFromDigest(digest: DocumentEvidenceDigest, limit = 18): SalientSourceValue[] {
  const values: SalientSourceValue[] = [];
  const lines = [
    ...digest.facts,
    ...digest.chartable_fields,
    ...digest.assumptions,
    digest.preview,
  ].filter(Boolean).flatMap(sourceValueCandidateLines);
  for (const line of lines) {
    extractSalientValuesFromLine(line, digest, values);
    if (values.length >= limit * 2) break;
  }
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.source}:${item.label.toLowerCase()}:${item.value}:${item.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function buildSalientSourceValues(documents: ProjectDocument[], limit = 24): SalientSourceValue[] {
  const values = documents.flatMap((doc) => {
    const digest = doc.extraction_result?.document_evidence;
    return isDocumentEvidenceDigest(digest) ? salientSourceValuesFromDigest(digest, limit) : [];
  });
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.filename}:${item.label.toLowerCase()}:${item.value}:${item.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

export function renderSalientSourceValuesTable(values: SalientSourceValue[], limit = 12): string {
  const rows = values.slice(0, limit);
  if (rows.length === 0) return "";
  return [
    "| Source value | Value | Unit | Source |",
    "|---|---:|---|---|",
    ...rows.map((item) =>
      `| ${item.label.replace(/\|/g, "/").slice(0, 80)} | ${item.raw.replace(/\|/g, "/")} | ${item.unit || "-"} | ${item.source.replace(/\|/g, "/")} (${item.filename.replace(/\|/g, "/")}) |`
    ),
  ].join("\n");
}

export function renderSalientSourceValuesForPrompt(documents: ProjectDocument[], limit = 16): string {
  const values = buildSalientSourceValues(documents, limit);
  if (values.length === 0) return "";
  return [
    "SALIENT SOURCE VALUES",
    "Use these as decision-relevant source values when answering, modeling, and writing input tables. Do not invent replacements for them.",
    renderSalientSourceValuesTable(values, limit),
  ].join("\n");
}

export function renderDocumentEvidenceForPrompt(documents: ProjectDocument[]): string[] {
  const lines: string[] = [];
  for (const doc of documents) {
    const digest = doc.extraction_result?.document_evidence;
    if (!isDocumentEvidenceDigest(digest)) continue;
    lines.push(`DOCUMENT EVIDENCE: ${doc.filename} [${displayLabelForDigest(digest)}]`);
    if (digest.failed_extraction) lines.push("  Extraction status: failed or marked failed by uploaded metadata.");
    if (digest.facts.length) lines.push(`  Facts: ${digest.facts.slice(0, 8).join("; ")}`);
    if (digest.unsupported_claims.length) lines.push(`  Unsupported or limited claims: ${digest.unsupported_claims.slice(0, 8).join("; ")}`);
    if (digest.contradicted_claims.length) lines.push(`  Contradictions: ${digest.contradicted_claims.slice(0, 6).join("; ")}`);
    if (digest.missing_inputs.length) lines.push(`  Missing inputs: ${digest.missing_inputs.slice(0, 8).join("; ")}`);
    const chartableFields = digest.chartable_fields.filter((item) => isChartableEvidenceField(digest, item));
    if (chartableFields.length) lines.push(`  Chartable fields: ${chartableFields.slice(0, 8).join("; ")}`);
    const sourceValues = salientSourceValuesFromDigest(digest, 8);
    if (sourceValues.length) {
      lines.push(`  Salient source values: ${sourceValues.map((item) => `${item.label}=${item.raw}${item.unit ? ` ${item.unit}` : ""}`).join("; ")}`);
    }
  }
  return lines;
}
