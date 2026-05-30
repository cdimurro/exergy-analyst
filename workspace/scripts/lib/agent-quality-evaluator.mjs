const NUMBER_WITH_UNIT_RE =
  /(\$?\b-?\d+(?:,\d{3})*(?:\.\d+)?\b)\s*(mA\/cm2|m3\/day|m3\/d|kg\/h|\/MWh|\/kWh|\/kg|\/bbl|\/kW|GWh|MWh|kWh|Wh|GW|MW|kW|W|percent|%|tonnes?|tpy|bpd|gpd|lpm|lph|m3|psi|bar|°C|degC|C|K|V|A|USD|years?|yr|hours?|h)?/gi;

const HIGH_VALUE_CONTEXT_RE =
  /\b(capacity|power|temperature|coefficient|capex|opex|wacc|price|cost|emission|efficiency|factor|flow|demand|availability|hours?|recovery|specific energy|energy|pressure|voltage|current|mass|threshold|production|yield|rate|life|lifetime|density|tds|water|brine|fuel|co2|h2|hydrogen|electricity|heat|thermal|pump|module|location|latitude|longitude)\b/i;

function parseNumber(value) {
  const parsed = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function extractNumericEvidence(text, limit = 200) {
  const out = [];
  const source = String(text || "");
  for (const match of source.matchAll(NUMBER_WITH_UNIT_RE)) {
    const raw = match[1] || match[0];
    const value = parseNumber(raw);
    if (value === null) continue;
    const unit = match[2] || "";
    const index = match.index || 0;
    const context = normalizeText(source.slice(Math.max(0, index - 90), Math.min(source.length, index + match[0].length + 110)));
    out.push({ value, raw, unit, context });
    if (out.length >= limit) break;
  }
  return out;
}

function significantSourceNumbers(texts) {
  const seen = new Set();
  return texts
    .flatMap((text) => extractNumericEvidence(text))
    .filter((item) => {
      if (!item.unit && !HIGH_VALUE_CONTEXT_RE.test(item.context)) return false;
      if (!item.unit && Math.abs(item.value) < 1) return false;
      if (/^\d{4}$/.test(item.raw) && /\b(?:date|year|copyright|rev|version)\b/i.test(item.context)) return false;
      const key = `${item.value}:${item.unit}:${item.context.slice(0, 60).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
}

function closeEnough(actual, expected) {
  const scale = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) / scale <= 0.015 || Math.abs(actual - expected) <= 0.05;
}

function answerContainsValue(answerNumbers, value) {
  return answerNumbers.some((item) => closeEnough(item.value, value));
}

function answerContainsEquivalentValue(answerNumbers, value) {
  return answerContainsValue(answerNumbers, value) ||
    answerContainsValue(answerNumbers, value / 1000) ||
    answerContainsValue(answerNumbers, value * 1000);
}

function sourceValueCoverage(sourceValues, answer) {
  if (sourceValues.length === 0) return { retained: 0, missing: [], coverage: null };
  const answerNumbers = extractNumericEvidence(answer, 500);
  const missing = sourceValues.filter((source) => !answerContainsValue(answerNumbers, source.value));
  return {
    retained: sourceValues.length - missing.length,
    missing,
    coverage: (sourceValues.length - missing.length) / sourceValues.length,
  };
}

function scalar(text, patterns) {
  const clean = String(text || "").replace(/,/g, "");
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match?.[1]) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function deriveCalculationProbes(sourceText, answer) {
  const probes = [];
  const answerNumbers = extractNumericEvidence(answer, 600);
  const add = (type, expected, unit, inputs) => {
    if (!Number.isFinite(expected) || expected <= 0) return;
    probes.push({ type, expected, unit, inputs, found: answerContainsEquivalentValue(answerNumbers, expected) });
  };

  const heatMw = scalar(sourceText, [
    /\b(?:available\s+)?(?:waste\s+)?heat(?:\s+thermal\s+capacity)?\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*MW/i,
    /\b(\d+(?:\.\d+)?)\s*MW(?:th)?\b[\s\S]{0,60}\bheat\b/i,
  ]);
  const hours = scalar(sourceText, [
    /\b(?:annual\s+)?availability\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*hours?/i,
    /\b(\d+(?:\.\d+)?)\s*h(?:ours?)?\s+per\s+year\b/i,
  ]);
  if (heatMw !== null && hours !== null) add("heat_mw_times_hours_mwh", heatMw * hours, "MWh/yr", { heat_mw: heatMw, hours_per_year: hours });

  const pumpKw = scalar(sourceText, [/\b(?:pump|circulation\s+pump)\s+(?:electrical\s+)?(?:load|power)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*kW/i]);
  if (pumpKw !== null && hours !== null) add("pump_kw_times_hours_mwh", pumpKw * hours / 1000, "MWh/yr", { pump_kw: pumpKw, hours_per_year: hours });

  const productFlow = scalar(sourceText, [
    /\b(?:plant\s+)?product\s+water\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*m3\s*\/\s*day/i,
    /\bproduct\s+flow\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*m3\s*\/\s*d/i,
  ]);
  const sec = scalar(sourceText, [/\b(?:specific\s+energy\s+consumption|SEC)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*kWh\s*\/\s*m3/i]);
  if (productFlow !== null && sec !== null) add("flow_times_specific_energy_kwh_day", productFlow * sec, "kWh/day", { product_flow_m3_day: productFlow, sec_kwh_m3: sec });

  const capacityMw = scalar(sourceText, [/\b(?:net\s+electrical\s+capacity|net\s+capacity|capacity)\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*MWe?\b/i]);
  const cfPct = scalar(sourceText, [
    /\bcapacity\s+factor(?:\s+target)?\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*percent/i,
    /\bcapacity\s+factor(?:\s+target)?\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i,
  ]);
  if (capacityMw !== null && cfPct !== null) add("capacity_factor_generation_mwh_year", capacityMw * 8760 * cfPct / 100, "MWh/yr", { capacity_mw: capacityMw, capacity_factor_pct: cfPct });

  return probes;
}

function malformedMarkdownTables(answer) {
  const lines = String(answer || "").split(/\r?\n/);
  const isPipe = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const count = (line) => line.split("|").filter((cell) => cell.trim()).length;
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (isPipe(lines[i]) && isSep(lines[i + 1]) && count(lines[i]) !== count(lines[i + 1])) return true;
  }
  return false;
}

function artifactIntegrityFindings(input) {
  const findings = [];
  const files = input.files || [];
  if (input.requiresFiles && files.length === 0) {
    findings.push({
      severity: "blocker",
      type: "quality_missing_requested_artifact",
      detail: "The request required a downloadable artifact, but no file was attached to the run.",
      broad_fix: "Quality gate export requests on actual file.created events with stable URLs.",
    });
  }
  for (const file of files) {
    if (!file.filename || !file.url) {
      findings.push({
        severity: "warning",
        type: "quality_incomplete_file_artifact",
        detail: `A generated file artifact is missing ${!file.filename ? "filename" : "download URL"}.`,
        broad_fix: "Make generated artifacts first-class files with filename, MIME type, run_id, artifact_id, and stable download URL.",
        evidence: { file },
      });
    }
  }
  return findings;
}

export function evaluateAgentQuality(input) {
  const answer = input.finalAnswer || "";
  const sourceTexts = input.sourceTexts || [];
  const sourceText = sourceTexts.join("\n\n");
  const sourceValues = significantSourceNumbers(sourceTexts);
  const coverage = sourceValueCoverage(sourceValues, answer);
  const probes = deriveCalculationProbes(sourceText, answer);
  const findings = [];

  if (sourceValues.length >= 3 && coverage.coverage !== null && coverage.coverage < 0.45) {
    findings.push({
      severity: "warning",
      type: "quality_low_source_value_coverage",
      detail: `Only ${coverage.retained} of ${sourceValues.length} salient source values appeared in the final answer.`,
      broad_fix: "Inject source previews and numeric evidence into tool prompts and require source-backed input tables before conclusions.",
      evidence: { missing_values: coverage.missing.slice(0, 8) },
    });
  }

  if (/\b(?:extracted from|from the uploaded|from document|from datasheet)\b/i.test(answer)) {
    const sourceLabeledText = answer
      .split(/\r?\n/)
      .filter((line) => /\b(?:extracted from|from the uploaded|from document|from datasheet)\b/i.test(line))
      .join("\n");
    const unsupportedSourceNumbers = extractNumericEvidence(sourceLabeledText, 80)
      .filter((item) => !sourceValues.some((source) => closeEnough(source.value, item.value)));
    if (unsupportedSourceNumbers.length > 0) {
      findings.push({
        severity: "warning",
        type: "quality_unsupported_source_number",
        detail: "The answer labeled at least one number as source-backed, but that number was not found in the source preview.",
        broad_fix: "Require source-backed input tables to quote values from parsed source text, not generic defaults or model memory.",
        evidence: { numbers: unsupportedSourceNumbers.slice(0, 6) },
      });
    }
  }

  const failedProbes = probes.filter((probe) => !probe.found);
  if (failedProbes.length > 0 && input.requiresTool) {
    findings.push({
      severity: "info",
      type: "quality_independent_calculation_not_visible",
      detail: "One or more simple independent calculation probes could not find the expected derived value in the final answer.",
      broad_fix: "Use deterministic calculation probes as a second-pass critic for generated solver outputs.",
      evidence: { probes: failedProbes.slice(0, 6) },
    });
  }

  if (/\{[a-zA-Z_][a-zA-Z0-9_]*(?::[^{}\n]+)?\}/.test(answer) || /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(answer)) {
    findings.push({
      severity: "blocker",
      type: "quality_unresolved_template_placeholder",
      detail: "The final answer contains an unresolved template placeholder.",
      broad_fix: "Reject or repair generated reports with unresolved placeholders before chat synthesis.",
    });
  }

  if (malformedMarkdownTables(answer)) {
    findings.push({
      severity: "warning",
      type: "quality_malformed_markdown_table",
      detail: "A Markdown table has a separator row with a different column count than its header.",
      broad_fix: "Normalize generated Markdown tables before storing the final answer.",
    });
  }

  if (input.requiresTool && /\b(?:rough|manual|hand[- ]calculated|best[- ]effort)\b/i.test(answer) && !/\b(?:tool|workspace|simulation|model)\s+(?:completed|ran|created|generated)\b/i.test(answer)) {
    findings.push({
      severity: "warning",
      type: "quality_tool_fallback_answer",
      detail: "A tool-backed request appears to have fallen back to a manual estimate rather than completed tool results.",
      broad_fix: "Keep trying alternative bounded tool paths or clearly separate failed-tool diagnostics from computed results.",
    });
  }

  findings.push(...artifactIntegrityFindings(input));

  const severityPenalty = findings.reduce((sum, finding) => {
    if (finding.severity === "blocker") return sum + 35;
    if (finding.severity === "warning") return sum + 12;
    return sum + 4;
  }, 0);
  const coveragePenalty = coverage.coverage === null ? 0 : Math.max(0, (0.7 - coverage.coverage) * 20);
  return {
    score: Math.max(0, Math.round(100 - severityPenalty - coveragePenalty)),
    source_value_coverage: coverage.coverage,
    retained_source_values: coverage.retained,
    source_values_checked: sourceValues.length,
    calculation_probes: probes,
    findings,
  };
}
