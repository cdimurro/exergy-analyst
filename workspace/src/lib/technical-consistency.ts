export type TechnicalFindingSeverity = "blocker" | "warning" | "info";

export interface TechnicalConsistencyFinding {
  type: string;
  severity: TechnicalFindingSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

interface TechnicalConsistencyInput {
  task?: string;
  reportMarkdown?: string;
  results?: Record<string, unknown>;
}

interface NumericResult {
  path: string;
  value: number;
}

interface FailedTechnicalCheck {
  path: string;
  name: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function searchableKey(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numericResults(value: unknown, prefix = ""): NumericResult[] {
  if (typeof value === "number" && Number.isFinite(value)) return [{ path: prefix || "value", value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => numericResults(item, `${prefix}[${index}]`));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return numericResults(item, path);
  });
}

function firstResult(numbers: NumericResult[], patterns: RegExp[]): NumericResult | null {
  return numbers.find((entry) => {
    const key = searchableKey(entry.path);
    return patterns.some((pattern) => pattern.test(key));
  }) || null;
}

function allResults(numbers: NumericResult[], patterns: RegExp[]): NumericResult[] {
  return numbers.filter((entry) => {
    const key = searchableKey(entry.path);
    return patterns.some((pattern) => pattern.test(key));
  });
}

function resultHasKeyOrText(value: unknown, patterns: RegExp[]): boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value);
    return patterns.some((pattern) => pattern.test(text));
  }
  if (Array.isArray(value)) return value.some((item) => resultHasKeyOrText(item, patterns));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    patterns.some((pattern) => pattern.test(key)) || resultHasKeyOrText(item, patterns),
  );
}

function hasAnySubstantiveResults(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.keys(value).some((key) => !/^agent_metadata$/i.test(key));
}

function compactCheckText(value: unknown, max = 260): string {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").slice(0, max);
  } catch {
    return String(value ?? "").slice(0, max);
  }
}

function hasFailedStatus(record: Record<string, unknown>): boolean {
  for (const key of ["passed", "pass", "ok", "valid", "within_bounds", "verified"]) {
    if (record[key] === false) return true;
  }
  for (const key of ["status", "result", "outcome", "severity"]) {
    const value = String(record[key] ?? "").toLowerCase();
    if (/\b(fail|failed|error|invalid|violation|outside|blocked|blocker)\b/.test(value)) return true;
  }
  return false;
}

function failedTechnicalChecks(value: unknown, prefix = "results"): FailedTechnicalCheck[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => failedTechnicalChecks(item, `${prefix}[${index}]`));
  }
  if (!isRecord(value)) return [];
  const localKey = searchableKey(prefix);
  const inCheckSection = /\b(quality checks?|independent checks?|technical checks?|validation|self checks?|sanity checks?)\b/.test(localKey);
  const out: FailedTechnicalCheck[] = [];
  if (inCheckSection && hasFailedStatus(value)) {
    const name = compactCheckText(value.name || value.check || value.label || value.metric || prefix, 120);
    const detail = compactCheckText(
      value.detail || value.message || value.implication || value.reason || value.observed_value || value,
    );
    out.push({ path: prefix, name, detail });
  }
  for (const [key, item] of Object.entries(value)) {
    out.push(...failedTechnicalChecks(item, `${prefix}.${key}`));
  }
  return out;
}

function reportSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizedProbability(value: number): number {
  return value > 1.5 ? value / 100 : value;
}

function formatPercent(value: number): string {
  const pct = normalizedProbability(value) * 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}

function formatMw(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} MW`;
}

function parseNumberNear(text: string, label: RegExp, unit: RegExp): number | null {
  const match = text.replace(/,/g, "").match(new RegExp(`${label.source}[\\s\\S]{0,80}?(-?\\d+(?:\\.\\d+)?)\\s*${unit.source}`, "i"));
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseTransformerLossesKw(text: string): { noLoadLossKw: number | null; loadLossKw: number | null } {
  const clean = text.replace(/,/g, "");
  const noLoadMatch = clean.match(/\b(?:no[- ]?load|core)\s+loss\b[\s\S]{0,60}?(\d+(?:\.\d+)?)\s*kW\b/i);
  const loadMatches = Array.from(clean.matchAll(/\bload\s+loss\b[\s\S]{0,60}?(\d+(?:\.\d+)?)\s*kW\b/gi))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  return {
    noLoadLossKw: noLoadMatch?.[1] ? Number(noLoadMatch[1]) : null,
    loadLossKw: loadMatches.length ? loadMatches[loadMatches.length - 1] : null,
  };
}

function containsUnsupportedPositiveRideThroughClaim(report: string): boolean {
  const sentences = reportSentences(report);
  return sentences.some((sentence) =>
    /\b(?:ride[- ]?through|voltage\s+sag|10\s*s(?:ec|econd)?s?)\b/i.test(sentence) &&
    /\b(?:achievable|adequate|sufficient|acceptable|likely|can\s+ride|will\s+ride|supports?)\b/i.test(sentence) &&
    !/\b(?:UPS|BESS|battery|flywheel|dynamic|transient|EMT|relay|protection|cannot\s+confirm|not\s+prove|needs?\s+(?:study|validation|simulation))\b/i.test(sentence),
  );
}

function hasPositiveAvailabilityNarrative(report: string, value: number): boolean {
  const percent = normalizedProbability(value) * 100;
  const rounded = percent.toLocaleString("en-US", { maximumFractionDigits: 2 }).replace(/\.?0+$/, "");
  const valuePattern = new RegExp(`\\b${escapeRegExp(rounded)}(?:\\.\\d+)?\\s*%?\\b`);
  return reportSentences(report).some((sentence) =>
    (valuePattern.test(sentence) || /\b(?:availability|N\+1|at\s+least\s+5|five\s+turbines?)\b/i.test(sentence)) &&
    /\b(?:excellent|strong|high|robust|sufficient|adequate|meets?|supports?|acceptable)\b/i.test(sentence) &&
    !/\b(?:not|below|short|fails?|does\s+not|insufficient|inadequate|gap)\b/i.test(sentence),
  );
}

function taskRequests(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isDataCenterPowerTask(text: string): boolean {
  return /\b(data\s+cent(?:er|re)|hyperscale|behind[- ]the[- ]meter|gas\s+turbine|turbine|transformer|short[- ]?circuit|ride[- ]?through|34\.5\s*kV|13\.8\s*kV|high\s+voltage)\b/i.test(text);
}

function isBatteryMaterialsTask(text: string): boolean {
  return /\b(NMC\s*811|lithium[- ]ion|battery|cathode|anode|electrolyte|cycle\s+life|specific\s+capacity|mAh\/g|mg\/cm2|mg\/cm²|C[- ]?rate|thermal\s+runaway)\b/i.test(text);
}

function isHydrogenElectrolysisTask(text: string): boolean {
  return /\b(hydrogen|H2|electroly[sz]er|electrolysis|PEM|alkaline\s+electroly[sz]er|SOEC|kWh\s*\/\s*kg)\b/i.test(text);
}

function isHeatPumpTask(text: string): boolean {
  return /\b(heat\s+pump|COP|coefficient\s+of\s+performance|Carnot|evaporator|condenser|source\s+temperature|sink\s+temperature)\b/i.test(text);
}

function isGenerationTask(text: string): boolean {
  return /\b(capacity\s+factor|annual\s+generation|MWh\s*\/\s*yr|MWh\s+per\s+year|nameplate|rated\s+capacity|solar|PV|wind|turbine|generator)\b/i.test(text);
}

function isProcessOrCaptureTask(text: string): boolean {
  return /\b(chemical\s+process|reactor|conversion|selectivity|yield|recovery|capture\s+(?:rate|efficiency)|CO2|carbon\s+capture|desalination|water\s+recovery|mineral|ore|bioreactor|fermentation)\b/i.test(text);
}

function isStructuralMechanicalTask(text: string): boolean {
  return /\b(stress|yield\s+strength|allowable\s+stress|safety\s+factor|factor\s+of\s+safety|pressure\s+vessel|wall\s+thickness|hoop\s+stress|mechanical|structural)\b/i.test(text);
}

function isFluidsPumpTask(text: string): boolean {
  return /\b(pump|hydraulic|flow\s+rate|head|pipeline|pipe|pressure\s+drop|m3\/s|m3\s*\/\s*s)\b/i.test(text);
}

function parseFirstNumber(text: string, patterns: RegExp[]): number | null {
  const clean = text.replace(/,/g, "");
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parsePercentMetrics(text: string): Array<{ label: string; value: number }> {
  const clean = text.replace(/,/g, "");
  const rows: Array<{ label: string; value: number }> = [];
  const pattern = /\b(conversion|selectivity|yield|recovery|capture\s+(?:rate|efficiency)|water\s+recovery|salt\s+rejection|removal\s+efficiency)\b\D{0,50}(\d+(?:\.\d+)?)\s*%/gi;
  for (const match of clean.matchAll(pattern)) {
    const value = Number(match[2]);
    const label = String(match[1] || "fraction metric").toLowerCase();
    if (Number.isFinite(value)) rows.push({ label, value });
  }
  return rows;
}

function hasMissingArealCurrentDiscussion(report: string): boolean {
  return !/\b(?:areal\s+(?:capacity|current)|mAh\/cm(?:2|²)|mA\/cm(?:2|²)|current\s+density|lithium\s+plating|diffusion|transport\s+limit)\b/i.test(report);
}

function isFlaggedAsImpossibleOrUnitIssue(text: string): boolean {
  return /\b(?:impossible|not\s+physically|violates?|unit\s+(?:issue|error|mismatch)|basis\s+(?:issue|error|ambiguous)|cannot\s+support|not\s+credible|below\s+thermodynamic|above\s+Carnot|exceeds?\s+(?:100|Carnot|physical))\b/i.test(text);
}

function hasPositiveTechnicalNarrative(text: string): boolean {
  return /\b(?:viable|feasible|credible|credibly|plausible|competitive|ready|acceptable|suitable|strong|excellent|supports?|meets?|within|efficient)\b/i.test(text) &&
    !/\b(?:not\s+(?:viable|feasible|credible|plausible|competitive|ready|acceptable|suitable)|insufficient|fails?|shortfall|gap)\b/i.test(text);
}

function sourceFirstRequested(text: string): boolean {
  return /\b(benchmark|published|literature|standards?|code(?:s)?|datasheets?|vendor|commercial\s+readiness|deployment\s+readiness|compare(?:d)?\s+to|state[- ]of[- ]the[- ]art|best\s+practice|regulatory|certification)\b/i.test(text);
}

function sourceContextPresent(report: string, results: Record<string, unknown>): boolean {
  return /\b(?:https?:\/\/|doi:|DOI\b|reference(?:s)?\s*[:：]|\[[0-9]{1,2}\]|source(?:s)?\s*[:：]|literature\s+search|benchmark\s+(?:source|range|table)|standard\s+(?:used|source|reference)|datasheet\s+(?:source|value|reference)|vendor\s+(?:datasheet|source))\b/i.test(report) ||
    resultHasKeyOrText(results, [/domain_context/i, /literature/i, /references?/i, /benchmarks?/i, /sources?/i, /doi/i, /https?:\/\//i, /openalex/i, /crossref/i]);
}

function technicalChecksPresent(results: Record<string, unknown>): boolean {
  return resultHasKeyOrText(results, [/technical_checks?/i, /quality_checks?/i, /independent_checks?/i, /validation/i, /sanity_checks?/i]);
}

export function technicalConsistencyFindings(input: TechnicalConsistencyInput): TechnicalConsistencyFinding[] {
  const task = input.task || "";
  const report = input.reportMarkdown || "";
  const combined = `${task}\n${report}`;
  const numbers = numericResults(input.results || {});
  const findings: TechnicalConsistencyFinding[] = [];

  if (sourceFirstRequested(combined) && !sourceContextPresent(report, input.results || {})) {
    findings.push({
      type: "technical_source_first_context_missing",
      severity: "warning",
      message: "The request asks for benchmarks, published evidence, standards, or readiness comparison, but the output does not expose a source/domain context. Build or retrieve domain context first, or clearly state that the comparison is based only on supplied prompt evidence.",
    });
  }

  if (
    hasAnySubstantiveResults(input.results || {}) &&
    /\b(simulat|model|calculate|evaluate|readiness|deployment|safety|engineering|technical|economic|finance|recommend)\b/i.test(combined) &&
    hasPositiveTechnicalNarrative(report) &&
    !technicalChecksPresent(input.results || {})
  ) {
    findings.push({
      type: "technical_checks_missing",
      severity: "warning",
      message: "The run produced substantive technical results but did not include technical_checks, quality_checks, or independent_checks. Add generated checks for units, bounds, conservation/balance, independent arithmetic, and recommendation support before treating the answer as verified.",
    });
  }

  for (const entry of numbers) {
    const key = searchableKey(entry.path);
    const percentLike = /\b(percent|pct|percentage|fraction|rate|efficiency|conversion|selectivity|yield|recovery|capture|availability|utilization|capacity factor)\b/.test(key);
    if (percentLike && entry.value > 100 && !/\btemperature|pressure|voltage|current|power|energy|cost|price|count|year|hour|mass|flow\b/.test(key)) {
      findings.push({
        type: "technical_meta_fraction_above_100",
        severity: "blocker",
        message: `${entry.path} is ${entry.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}, which appears above the ordinary 0-100 bound for a fraction/percent metric. Recheck units and basis before accepting the conclusion.`,
        evidence: { path: entry.path, value: entry.value },
      });
    }
  }

  for (const check of failedTechnicalChecks(input.results || {})) {
    findings.push({
      type: "technical_generated_check_failed",
      severity: "blocker",
      message: `Generated technical check failed (${check.name}): ${check.detail}. The affected conclusion should be repaired before presenting the result as verified.`,
      evidence: { path: check.path },
    });
  }

  if (isBatteryMaterialsTask(combined)) {
    const cycleLife = parseFirstNumber(combined, [
      /\bcycle\s+life\D{0,40}(\d+(?:\.\d+)?)\s*cycles?\b/i,
      /\b(\d+(?:\.\d+)?)\s*cycles?\s+(?:to|at)\s+80\s*%/i,
    ]);
    if (
      cycleLife !== null &&
      cycleLife < 3000 &&
      /\bgrid\s+storage\b/i.test(combined) &&
      /\b(?:competitive|suitable|ready|commercially\s+ready|attractive|viable)\b/i.test(report) &&
      !/\b(?:not\s+competitive|not\s+suitable|too\s+low|insufficient|falls?\s+short)\b/i.test(report)
    ) {
      findings.push({
        type: "technical_battery_grid_cycle_life_overclaim",
        severity: "blocker",
        message: `${cycleLife.toLocaleString("en-US", { maximumFractionDigits: 0 })} cycles to 80% retention is below the multi-thousand-cycle expectation for most grid-storage duty. Do not call it grid-storage competitive without a use-case-specific duty cycle, warranty target, and cost comparison.`,
        evidence: { cycle_life_to_80_pct: cycleLife },
      });
    }

    const specificCapacity = parseFirstNumber(combined, [
      /\bspecific\s+capacity\D{0,40}(\d+(?:\.\d+)?)\s*mAh\s*\/\s*g/i,
      /\b(\d+(?:\.\d+)?)\s*mAh\s*\/\s*g\b/i,
    ]);
    if (
      specificCapacity !== null &&
      specificCapacity > 190 &&
      /\b1\s*C\b/i.test(combined) &&
      /\b(?:routine|typical|conservative|easy|well within|not aggressive)\b/i.test(report) &&
      !/\b(?:upper\s+bound|aggressive|high\s+end|validation|rate\s+dependent)\b/i.test(report)
    ) {
      findings.push({
        type: "technical_battery_capacity_rate_overclaim",
        severity: "warning",
        message: `${specificCapacity.toLocaleString("en-US", { maximumFractionDigits: 0 })} mAh/g for NMC-class material at 1C is a high-end claim. Treat it as rate- and voltage-window-dependent until supported by full-cell data and loading-specific tests.`,
        evidence: { specific_capacity_mah_g: specificCapacity },
      });
    }

    const loading = parseFirstNumber(combined, [
      /\bcathode\s+loading\D{0,40}(\d+(?:\.\d+)?)\s*mg\s*\/\s*cm(?:2|²)/i,
      /\b(\d+(?:\.\d+)?)\s*mg\s*\/\s*cm(?:2|²)\b/i,
    ]);
    const cRate = parseFirstNumber(combined, [
      /\b(?:charge|charging|rate)\D{0,40}(\d+(?:\.\d+)?)\s*C\b/i,
      /\bup\s+to\s+(\d+(?:\.\d+)?)\s*C\b/i,
      /\b(\d+(?:\.\d+)?)\s*C\s+(?:charge|charging|rate)\b/i,
    ]);
    if (loading !== null && specificCapacity !== null && cRate !== null) {
      const arealCapacityMahCm2 = loading / 1000 * specificCapacity;
      const currentDensityMaCm2 = arealCapacityMahCm2 * cRate;
      if (currentDensityMaCm2 >= 8 && hasMissingArealCurrentDiscussion(report)) {
        findings.push({
          type: "technical_battery_high_areal_current_missing",
          severity: "warning",
          message: `The stated loading/rate implies about ${currentDensityMaCm2.toLocaleString("en-US", { maximumFractionDigits: 1 })} mA/cm2 (${arealCapacityMahCm2.toLocaleString("en-US", { maximumFractionDigits: 1 })} mAh/cm2 at ${cRate}C). The answer should discuss transport limits, polarization, heat generation, and lithium-plating risk before accepting fast-charge readiness.`,
          evidence: { cathode_loading_mg_cm2: loading, specific_capacity_mah_g: specificCapacity, c_rate: cRate, areal_capacity_mah_cm2: arealCapacityMahCm2, current_density_ma_cm2: currentDensityMaCm2 },
        });
      }
    }

    const cellEnergyDensity = parseFirstNumber(combined, [
      /\benergy\s+density\D{0,40}(\d+(?:\.\d+)?)\s*Wh\s*\/\s*kg/i,
      /\b(\d+(?:\.\d+)?)\s*Wh\s*\/\s*kg\b/i,
    ]);
    if (
      cellEnergyDensity !== null &&
      specificCapacity !== null &&
      /\b(?:cathode|material)\b/i.test(combined) &&
      !/\b(?:cell[- ]level|pack[- ]level|material[- ]level|active[- ]material|basis|basis\s+ambiguous|not\s+the\s+cathode\s+alone)\b/i.test(report)
    ) {
      findings.push({
        type: "technical_battery_energy_density_basis_missing",
        severity: "warning",
        message: "Battery energy-density claims need an explicit basis. Wh/kg for the full cell, pack, cathode active material, or electrode are not interchangeable, so the answer should label the basis before comparing benchmarks.",
        evidence: { energy_density_wh_kg: cellEnergyDensity, specific_capacity_mah_g: specificCapacity },
      });
    }
  }

  if (isHydrogenElectrolysisTask(combined)) {
    const specificEnergy = parseFirstNumber(combined, [
      /\bspecific\s+energy\D{0,50}(\d+(?:\.\d+)?)\s*kWh\s*\/\s*kg/i,
      /\b(\d+(?:\.\d+)?)\s*kWh\s*\/\s*kg(?:\s*H2|\s*hydrogen)?\b/i,
    ]);
    if (
      specificEnergy !== null &&
      specificEnergy < 33.3 &&
      hasPositiveTechnicalNarrative(report) &&
      !isFlaggedAsImpossibleOrUnitIssue(report)
    ) {
      findings.push({
        type: "technical_hydrogen_specific_energy_below_lhv",
        severity: "blocker",
        message: `${specificEnergy.toLocaleString("en-US", { maximumFractionDigits: 1 })} kWh/kg H2 is below the lower-heating-value thermodynamic floor of about 33.3 kWh/kg. Treat the claim as a unit/basis error unless the report explains a non-electrical energy basis and separates LHV/HHV conventions.`,
        evidence: { specific_energy_kwh_kg: specificEnergy, lhv_floor_kwh_kg: 33.3 },
      });
    }

    const efficiencyPct = parseFirstNumber(combined, [
      /\b(?:electroly[sz]er|hydrogen|system)?\s*efficiency\D{0,50}(\d+(?:\.\d+)?)\s*%/i,
      /\b(\d+(?:\.\d+)?)\s*%\s*(?:LHV|HHV)?\s*efficiency\b/i,
    ]);
    if (
      efficiencyPct !== null &&
      efficiencyPct > 100 &&
      hasPositiveTechnicalNarrative(report) &&
      !isFlaggedAsImpossibleOrUnitIssue(report)
    ) {
      findings.push({
        type: "technical_hydrogen_efficiency_above_100",
        severity: "blocker",
        message: `${efficiencyPct.toLocaleString("en-US", { maximumFractionDigits: 1 })}% electrolyzer efficiency is above the ordinary physical bound. Recheck LHV/HHV basis, auxiliary loads, and whether the metric is being confused with a relative improvement.`,
        evidence: { efficiency_pct: efficiencyPct },
      });
    }
  }

  if (isHeatPumpTask(combined)) {
    const sourceC = parseFirstNumber(combined, [
      /\b(?:source|cold|evaporator|ambient)\s+(?:temperature\s*)?(?:is|=|:|at)?\s*(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i,
    ]);
    const sinkC = parseFirstNumber(combined, [
      /\b(?:sink|hot|condenser|supply|delivery)\s+(?:temperature\s*)?(?:is|=|:|at)?\s*(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i,
    ]);
    const cop = parseFirstNumber(combined, [
      /\bCOP\D{0,30}(\d+(?:\.\d+)?)/i,
      /\bcoefficient\s+of\s+performance\D{0,40}(\d+(?:\.\d+)?)/i,
    ]);
    if (sourceC !== null && sinkC !== null && cop !== null && sinkC > sourceC) {
      const hotK = sinkC + 273.15;
      const coldK = sourceC + 273.15;
      const carnotHeatingCop = hotK / (hotK - coldK);
      if (cop > carnotHeatingCop * 1.02 && hasPositiveTechnicalNarrative(report) && !isFlaggedAsImpossibleOrUnitIssue(report)) {
        findings.push({
          type: "technical_heat_pump_cop_above_carnot",
          severity: "blocker",
          message: `COP ${cop.toLocaleString("en-US", { maximumFractionDigits: 2 })} exceeds the Carnot heating limit of about ${carnotHeatingCop.toLocaleString("en-US", { maximumFractionDigits: 2 })} for ${sourceC}C source and ${sinkC}C sink. Treat the result as impossible until temperatures, COP definition, or units are corrected.`,
          evidence: { source_c: sourceC, sink_c: sinkC, cop, carnot_heating_cop: carnotHeatingCop },
        });
      }
    }
  }

  if (isGenerationTask(combined)) {
    const capacityMw = parseFirstNumber(combined, [
      /\b(?:nameplate|rated\s+capacity|capacity)\D{0,50}(\d+(?:\.\d+)?)\s*MW\b/i,
      /\b(\d+(?:\.\d+)?)\s*MW\s+(?:nameplate|rated\s+capacity|capacity)\b/i,
    ]);
    const annualMwh = parseFirstNumber(combined, [
      /\b(?:annual\s+generation|generation)\D{0,60}(\d+(?:\.\d+)?)\s*MWh\b/i,
      /\b(\d+(?:\.\d+)?)\s*MWh\s*(?:\/\s*yr|per\s+year|annually)\b/i,
    ]);
    if (capacityMw !== null && annualMwh !== null && capacityMw > 0) {
      const capacityFactor = annualMwh / (capacityMw * 8760);
      if (capacityFactor > 1.02 && hasPositiveTechnicalNarrative(report) && !isFlaggedAsImpossibleOrUnitIssue(report)) {
        findings.push({
          type: "technical_generation_capacity_factor_above_100",
          severity: "blocker",
          message: `Annual generation of ${annualMwh.toLocaleString("en-US", { maximumFractionDigits: 0 })} MWh from ${capacityMw.toLocaleString("en-US", { maximumFractionDigits: 2 })} MW implies a ${(capacityFactor * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}% capacity factor. Recheck MW/MWh units, nameplate basis, or annualization before treating the result as feasible.`,
          evidence: { capacity_mw: capacityMw, annual_generation_mwh: annualMwh, capacity_factor: capacityFactor },
        });
      }
    }

    const statedCapacityFactorPct = parseFirstNumber(combined, [
      /\bcapacity\s+factor\D{0,40}(\d+(?:\.\d+)?)\s*%/i,
      /\b(\d+(?:\.\d+)?)\s*%\s+capacity\s+factor\b/i,
    ]);
    if (
      statedCapacityFactorPct !== null &&
      statedCapacityFactorPct > 100 &&
      hasPositiveTechnicalNarrative(report) &&
      !isFlaggedAsImpossibleOrUnitIssue(report)
    ) {
      findings.push({
        type: "technical_capacity_factor_above_100",
        severity: "blocker",
        message: `${statedCapacityFactorPct.toLocaleString("en-US", { maximumFractionDigits: 1 })}% capacity factor is above the physical bound for annual generation from fixed nameplate capacity. Recheck units and annualization.`,
        evidence: { capacity_factor_pct: statedCapacityFactorPct },
      });
    }
  }

  if (isProcessOrCaptureTask(combined)) {
    for (const metric of parsePercentMetrics(combined)) {
      if (metric.value > 100 && hasPositiveTechnicalNarrative(report) && !isFlaggedAsImpossibleOrUnitIssue(report)) {
        findings.push({
          type: "technical_fraction_metric_above_100",
          severity: "blocker",
          message: `${metric.label} of ${metric.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}% is above the physical bound for an ordinary fraction metric. Recheck basis, recycle accounting, and units before presenting the process as feasible.`,
          evidence: { label: metric.label, value_pct: metric.value },
        });
      }
    }

    const inletCo2 = parseFirstNumber(combined, [
      /\b(?:inlet|emitted|emissions?|flue\s+gas)\s+CO2\D{0,60}(\d+(?:\.\d+)?)\s*(?:t|tonnes?|tons?)\b/i,
    ]);
    const capturedCo2 = parseFirstNumber(combined, [
      /\b(?:captured|capture)\s+CO2\D{0,60}(\d+(?:\.\d+)?)\s*(?:t|tonnes?|tons?)\b/i,
    ]);
    if (
      inletCo2 !== null &&
      capturedCo2 !== null &&
      capturedCo2 > inletCo2 * 1.02 &&
      hasPositiveTechnicalNarrative(report) &&
      !isFlaggedAsImpossibleOrUnitIssue(report)
    ) {
      findings.push({
        type: "technical_carbon_capture_mass_balance_violation",
        severity: "blocker",
        message: `Captured CO2 (${capturedCo2.toLocaleString("en-US", { maximumFractionDigits: 1 })}) exceeds inlet/emitted CO2 (${inletCo2.toLocaleString("en-US", { maximumFractionDigits: 1 })}) without an external source or accounting adjustment. Reconcile the carbon balance before claiming capture performance.`,
        evidence: { inlet_co2: inletCo2, captured_co2: capturedCo2 },
      });
    }
  }

  if (isStructuralMechanicalTask(combined)) {
    const stressMpa = parseFirstNumber(combined, [
      /\b(?:applied|von\s+mises|maximum|peak|computed)\s+stress\D{0,50}(\d+(?:\.\d+)?)\s*MPa\b/i,
      /\bstress\D{0,30}(\d+(?:\.\d+)?)\s*MPa\b/i,
    ]);
    const yieldMpa = parseFirstNumber(combined, [
      /\b(?:yield\s+strength|yield|allowable\s+stress|allowable)\D{0,50}(\d+(?:\.\d+)?)\s*MPa\b/i,
    ]);
    if (
      stressMpa !== null &&
      yieldMpa !== null &&
      stressMpa > yieldMpa &&
      hasPositiveTechnicalNarrative(report) &&
      !isFlaggedAsImpossibleOrUnitIssue(report)
    ) {
      findings.push({
        type: "technical_stress_exceeds_allowable",
        severity: "blocker",
        message: `Applied stress of ${stressMpa.toLocaleString("en-US", { maximumFractionDigits: 1 })} MPa exceeds the stated allowable/yield stress of ${yieldMpa.toLocaleString("en-US", { maximumFractionDigits: 1 })} MPa. The design cannot be called acceptable without redesign, a different allowable basis, or a code-specific justification.`,
        evidence: { stress_mpa: stressMpa, allowable_or_yield_mpa: yieldMpa },
      });
    }

    const pressureBar = parseFirstNumber(combined, [
      /\b(?:pressure|internal\s+pressure|design\s+pressure)\D{0,50}(\d+(?:\.\d+)?)\s*bar\b/i,
    ]);
    const radiusM = parseFirstNumber(combined, [
      /\b(?:radius|vessel\s+radius)\D{0,50}(\d+(?:\.\d+)?)\s*m\b/i,
    ]);
    const thicknessMm = parseFirstNumber(combined, [
      /\b(?:wall\s+thickness|thickness)\D{0,50}(\d+(?:\.\d+)?)\s*mm\b/i,
    ]);
    const allowableMpa = parseFirstNumber(combined, [
      /\b(?:allowable\s+stress|allowable)\D{0,50}(\d+(?:\.\d+)?)\s*MPa\b/i,
    ]);
    if (pressureBar !== null && radiusM !== null && thicknessMm !== null && allowableMpa !== null && thicknessMm > 0) {
      const hoopMpa = pressureBar * 100000 * radiusM / (thicknessMm / 1000) / 1_000_000;
      if (hoopMpa > allowableMpa && hasPositiveTechnicalNarrative(report) && !isFlaggedAsImpossibleOrUnitIssue(report)) {
        findings.push({
          type: "technical_pressure_vessel_hoop_stress_exceeds_allowable",
          severity: "blocker",
          message: `Thin-wall hoop stress is about ${hoopMpa.toLocaleString("en-US", { maximumFractionDigits: 1 })} MPa, above the stated allowable stress of ${allowableMpa.toLocaleString("en-US", { maximumFractionDigits: 1 })} MPa. Treat the pressure-vessel design as not acceptable until thickness, pressure, code basis, and safety factor are corrected.`,
          evidence: { pressure_bar: pressureBar, radius_m: radiusM, thickness_mm: thicknessMm, hoop_stress_mpa: hoopMpa, allowable_mpa: allowableMpa },
        });
      }
    }
  }

  if (isFluidsPumpTask(combined)) {
    const flowM3s = parseFirstNumber(combined, [
      /\b(?:flow\s+rate|flow)\D{0,50}(\d+(?:\.\d+)?)\s*m3\s*\/\s*s\b/i,
      /\b(\d+(?:\.\d+)?)\s*m3\s*\/\s*s\b/i,
    ]);
    const headM = parseFirstNumber(combined, [
      /\b(?:head|pump\s+head)\D{0,50}(\d+(?:\.\d+)?)\s*m\b/i,
    ]);
    const pumpPowerKw = parseFirstNumber(combined, [
      /\b(?:pump\s+power|shaft\s+power|motor\s+power|electrical\s+power)\D{0,50}(\d+(?:\.\d+)?)\s*kW\b/i,
    ]);
    if (flowM3s !== null && headM !== null && pumpPowerKw !== null) {
      const hydraulicKw = 1000 * 9.80665 * flowM3s * headM / 1000;
      if (pumpPowerKw < hydraulicKw * 0.98 && hasPositiveTechnicalNarrative(report) && !isFlaggedAsImpossibleOrUnitIssue(report)) {
        findings.push({
          type: "technical_pump_power_below_hydraulic_minimum",
          severity: "blocker",
          message: `Pump power of ${pumpPowerKw.toLocaleString("en-US", { maximumFractionDigits: 1 })} kW is below the hydraulic power floor of about ${hydraulicKw.toLocaleString("en-US", { maximumFractionDigits: 1 })} kW for ${flowM3s} m3/s and ${headM} m head. Recheck flow/head units, density, and efficiency before calling the pump selection feasible.`,
          evidence: { flow_m3_s: flowM3s, head_m: headM, pump_power_kw: pumpPowerKw, hydraulic_power_kw: hydraulicKw },
        });
      }
    }
  }

  if (!isDataCenterPowerTask(combined)) return findings;

  const load = firstResult(numbers, [
    /\btotal load mw\b/,
    /\bload mw\b/,
    /\bcritical load mw\b/,
    /\bcampus load mw\b/,
    /\bit load mw\b/,
  ]);
  const allHot = firstResult(numbers, [
    /\bhot.*(?:all|6|six).*generation.*mw\b/,
    /\ball.*hot.*(?:generation|capacity|total).*mw\b/,
    /\bhot total mw\b/,
    /\ball turbine.*hot.*mw\b/,
  ]);
  const n1Firm = firstResult(numbers, [
    /\b(?:n\s*1|n1).*(?:plus|with).*grid.*mw\b/,
    /\b(?:n\s*1|n1).*firm.*mw\b/,
    /\bfive.*(?:plus|with).*grid.*mw\b/,
  ]);
  const n2Firm = firstResult(numbers, [
    /\b(?:n\s*2|n2).*(?:plus|with).*grid.*mw\b/,
    /\b(?:n\s*2|n2).*firm.*mw\b/,
    /\bfour.*(?:plus|with).*grid.*mw\b/,
  ]);

  if (load && allHot && allHot.value < load.value) {
    findings.push({
      type: "technical_capacity_shortfall",
      severity: "blocker",
      message: `Hot-day all-unit generation is ${formatMw(allHot.value)} against ${formatMw(load.value)} of load. Treat this as a capacity shortfall unless the model explicitly adds firm grid, storage, load shedding, or a different operating basis.`,
      evidence: { load_mw: load.value, hot_generation_mw: allHot.value },
    });
  }
  if (load && n1Firm) {
    const margin = n1Firm.value - load.value;
    if (margin >= 0 && margin < Math.max(15, load.value * 0.05)) {
      findings.push({
        type: "technical_thin_n1_margin",
        severity: "warning",
        message: `N-1 plus firm grid leaves only ${formatMw(margin)} of margin on a ${formatMw(load.value)} load. Do not describe this as robust without voltage, transient, maintenance, and common-mode contingency analysis.`,
        evidence: { load_mw: load.value, n1_firm_mw: n1Firm.value, margin_mw: margin },
      });
    }
  }
  if (load && n2Firm && n2Firm.value < load.value) {
    findings.push({
      type: "technical_n2_shortfall",
      severity: "blocker",
      message: `N-2 plus firm grid is ${formatMw(n2Firm.value)}, below the ${formatMw(load.value)} load. Any N-2 resilience claim needs redesign, load shedding, storage, or additional firm supply.`,
      evidence: { load_mw: load.value, n2_firm_mw: n2Firm.value },
    });
  }

  const availabilityValues = allResults(numbers, [
    /\bprob.*(?:n\s*1|n1|n plus 1|at least 5|five|available)\b/,
    /\bavailability.*(?:n\s*1|n1|five|5|at least)\b/,
  ]);
  const targetFiveNines = /\b(?:99\.999|five[- ]nines?|5[- ]nines?)\s*%?\b/i.test(combined);
  for (const entry of availabilityValues) {
    const probability = normalizedProbability(entry.value);
    if (probability > 0 && probability < 0.99999 && (targetFiveNines || hasPositiveAvailabilityNarrative(report, entry.value))) {
      findings.push({
        type: "technical_availability_overclaim",
        severity: targetFiveNines ? "blocker" : "warning",
        message: `${entry.path} is ${formatPercent(entry.value)}, which is not compatible with a five-nines-class data-center reliability claim. Frame it as a reliability gap and model planned maintenance, grid dependency, common-mode failures, and repair time before recommending readiness.`,
        evidence: { path: entry.path, value: entry.value, normalized_probability: probability },
      });
    }
  }
  if (targetFiveNines && availabilityValues.length === 0) {
    for (const sentence of reportSentences(report)) {
      if (
        /\b(?:availability|N\+1|at\s+least\s+5|five\s+turbines?)\b/i.test(sentence) &&
        /\b(?:excellent|strong|high|robust|sufficient|adequate|meets?|supports?|acceptable)\b/i.test(sentence)
      ) {
        const match = sentence.replace(/,/g, "").match(/\b(9\d(?:\.\d+)?)\s*%(?=\s|$|[,.;:])/);
        const value = match?.[1] ? Number(match[1]) / 100 : NaN;
        if (Number.isFinite(value) && value < 0.99999) {
          findings.push({
            type: "technical_availability_overclaim",
            severity: "blocker",
            message: `${match?.[1]}% availability is not compatible with a five-nines-class data-center reliability claim. Frame it as a reliability gap and model planned maintenance, grid dependency, common-mode failures, and repair time before recommending readiness.`,
            evidence: { normalized_probability: value },
          });
        }
      }
    }
  }

  if (
    /\bshort[- ]?circuit|fault\s+current|breaker|switchgear\b/i.test(combined) &&
    /\b13\.8\s*kV\b/i.test(combined) &&
    /\b30\s*MVA\b/i.test(report) &&
    /\b7\s*%/i.test(report) &&
    !/\b30\s*MVA\b/i.test(task) &&
    !/\b7\s*%/i.test(task)
  ) {
    findings.push({
      type: "technical_invented_short_circuit_topology",
      severity: "blocker",
      message: "The 13.8 kV short-circuit calculation appears to use an assumed 30 MVA, 7% transformer that was not supplied by the prompt. Treat the result as illustrative only and require the actual transformer, generator subtransient reactance, grounding, and utility Thevenin data before specifying switchgear.",
    });
  }

  if (
    /\bshort[- ]?circuit|fault\s+current|breaker|switchgear\b/i.test(combined) &&
    /\bgenerator|turbine\b/i.test(combined) &&
    /\b13\.8\s*kV\b/i.test(combined) &&
    /\b(?:adequate|acceptable|within|supports?|meets?)\b/i.test(report) &&
    !/\b(?:subtransient|x''|xd''|x d double prime|generator contribution|Thevenin|ETAP|SKM|PSCAD)\b/i.test(report)
  ) {
    findings.push({
      type: "technical_missing_generator_fault_contribution",
      severity: "warning",
      message: "A 13.8 kV fault-current conclusion for turbine generation needs generator subtransient contribution and system Thevenin impedance. Do not present breaker adequacy as verified without those inputs.",
    });
  }

  if (containsUnsupportedPositiveRideThroughClaim(report)) {
    findings.push({
      type: "technical_ride_through_overclaim",
      severity: "blocker",
      message: "The ride-through conclusion is stronger than the modeled evidence. A 10-second voltage sag cannot be verified from steady-state capacity alone; it needs UPS/BESS/flywheel energy, controls, relay settings, and dynamic/transient analysis.",
    });
  }

  if (taskRequests(combined, [/\bheat[- ]?rate\s+penalty\b/i, /\bpart[- ]load\s+heat[- ]?rate\b/i])) {
    const reportAddressesPenalty = /\b(?:heat[- ]?rate\s+penalty|part[- ]load|degradation|derate|correction|incremental\s+heat[- ]?rate)\b/i.test(report);
    if (!reportAddressesPenalty || /\bconstant\s+heat[- ]?rate\b/i.test(report)) {
      findings.push({
        type: "technical_missing_heat_rate_penalty",
        severity: "warning",
        message: "The task asks for heat-rate penalty, but the report does not compute a load/temperature heat-rate correction. Fuel use and economics should separate turbine output from grid import and apply the requested penalty model.",
      });
    }
  }

  const parsedLosses = parseTransformerLossesKw(combined);
  const noLoadLossKw = parsedLosses.noLoadLossKw ?? parseNumberNear(combined, /\b(?:no[- ]?load|core)\s+loss\b/i, /kW\b/i);
  const loadLossKw = parsedLosses.loadLossKw ?? parseNumberNear(combined, /\b(?:load|copper)\s+loss\b/i, /kW\b/i);
  const reportedHundredPercentLoss = (() => {
    const match = report.replace(/,/g, "").match(/\b100\s*%(?=\s|$|[,.;:|])[\s\S]{0,140}?(\d+(?:\.\d+)?)\s*kW\b/i);
    if (!match?.[1]) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  })();
  if (noLoadLossKw !== null && loadLossKw !== null && reportedHundredPercentLoss !== null) {
    const ratedLoss = noLoadLossKw + loadLossKw;
    if (reportedHundredPercentLoss < ratedLoss * 0.92) {
      findings.push({
        type: "technical_transformer_loss_basis_error",
        severity: "warning",
        message: `Transformer losses labeled 100% loading are ${reportedHundredPercentLoss.toLocaleString("en-US", { maximumFractionDigits: 1 })} kW, below the supplied no-load plus load-loss basis of ${ratedLoss.toLocaleString("en-US", { maximumFractionDigits: 1 })} kW. Recalculate losses on transformer MVA loading, not turbine output unless that basis is explicitly labeled.`,
        evidence: { no_load_loss_kw: noLoadLossKw, load_loss_kw: loadLossKw, reported_100pct_loss_kw: reportedHundredPercentLoss },
      });
    }
  }

  if (
    /\b(?:heat\s+recovery|HRSG|chiller|absorption\s+chiller|cooling\s+offset|waste\s+heat)\b/i.test(combined) &&
    /\b(?:not\s+justified|dismiss|not\s+recommended|low\s+priority)\b/i.test(report) &&
    /\b\d+(?:\.\d+)?\s*MW\b/i.test(report) &&
    !/\b(?:capacity\s+margin|firm\s+capacity|grid\s+import|fuel\s+savings?|water|capex|thermal\s+integration)\b/i.test(report)
  ) {
    findings.push({
      type: "technical_incomplete_heat_recovery_tradeoff",
      severity: "warning",
      message: "The heat-recovery conclusion is incomplete. If recovered heat offsets chiller electric load, compare capacity margin, grid import, fuel use, water use, CAPEX, and operational constraints before dismissing it.",
    });
  }

  const hardTypes = new Set([
    "technical_capacity_shortfall",
    "technical_n2_shortfall",
    "technical_availability_overclaim",
    "technical_invented_short_circuit_topology",
    "technical_ride_through_overclaim",
  ]);
  if (
    findings.some((finding) => hardTypes.has(finding.type)) &&
    /\b(?:recommendation|verdict|decision)\b[\s\S]{0,220}\bproceed\b|\bproceed\s+with\s+conditions\b/i.test(report) &&
    !/\b(?:redesign|not\s+ready|do\s+not\s+proceed|hold|defer|fails?|shortfall)\b/i.test(report)
  ) {
    findings.push({
      type: "technical_recommendation_not_supported",
      severity: "blocker",
      message: "The recommendation says to proceed even though the computed reliability, capacity, short-circuit, or ride-through evidence contains unresolved blockers. The recommendation should be downgraded or tied to explicit redesign actions.",
    });
  }

  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
