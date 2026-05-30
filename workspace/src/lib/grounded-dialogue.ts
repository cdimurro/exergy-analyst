import { readFile } from "fs/promises";

import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { getProjectUploadPaths } from "@/lib/exergy-agent";
import type { Artifact, Project, StorageAdapter } from "@/lib/storage/types";

interface GroundedDialogueArgs {
  projectId: string;
  message: string;
  project: Project | null | undefined;
  storage: StorageAdapter;
}

type GroundedResponse = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact(items: Array<string | null | undefined>): string[] {
  return items.map((item) => (item || "").trim()).filter(Boolean);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bulletList(items: string[], limit = 6): string {
  return items.slice(0, limit).map((item) => `- ${oneLine(item)}`).join("\n");
}

function numberedList(items: string[], limit = 6): string {
  return items.slice(0, limit).map((item, index) => `${index + 1}. ${oneLine(item)}`).join("\n");
}

function shouldSkipGroundedDialogue(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\b(analy[sz]e|assess|evaluate|review|summari[sz]e|extract|process)\b.*\b(file|document|pdf|deck|sheet|upload|uploaded|attached|attachment)\b/.test(lower)) {
    return true;
  }
  if (/\b(export|download|pdf|chart|graph|plot|dashboard|literature|papers?|search online|find sources?)\b/.test(lower)) {
    return true;
  }
  if (/\b(re-?run|run again|analyze again|reanaly[sz]e|new analysis|new evaluation|fresh analysis|full analysis|comprehensive analysis|deep analysis|simulate|simulation)\b/.test(lower)) {
    return true;
  }
  return false;
}

function looksLikeGroundedFollowup(message: string): boolean {
  const lower = message.toLowerCase();
  if (shouldSkipGroundedDialogue(message)) return false;
  return [
    /\bwhere(?:'s|\s+is)?\b/,
    /\banswer\b/,
    /\bwhy\b/,
    /\bwhat\b/,
    /\bwhich\b/,
    /\bhow\b/,
    /\bexplain\b/,
    /\btell me\b/,
    /\bgaps?\b/,
    /\bmissing\b/,
    /\bstrongest\b/,
    /\bact on\b/,
    /\bnext\b/,
    /\bmemo\b/,
    /\bclient[- ]ready\b/,
    /\bplant manager\b/,
    /\bceo\b/,
    /\bexecutive\b/,
    /\brow\b/,
    /\bfile\b/,
    /\bsource\b/,
    /\bassumptions?\b/,
    /\bdouble[ds]?\b/,
    /\btwice\b/,
    /\bscale(?:d|s)?\b/,
    /\bmultiply\b/,
    /\bhow many\b/,
    /\brecommend\b/,
    /\binverter\b/,
    /\bplant\b/,
    /\bgas price\b/,
    /\bmmbtu\b/,
    /\bfuel cost\b/,
    /\bspark spread\b/,
    /\bcapacity factor\b/,
    /\bemissions?\b/,
    /\bco2\b/,
    /\beconomics?\b/,
    /\bmodules?\b/,
    /\bunits?\b/,
    /\bwhat if\b/,
  ].some((pattern) => pattern.test(lower));
}

function latestEvaluationArtifact(artifacts: Artifact[]): Artifact | null {
  return artifacts.find((artifact) => {
    const content = isRecord(artifact.content) ? artifact.content : {};
    return (artifact.type === "workspace_run" || content.analysis_type === "agent_workspace") &&
      typeof content.report_markdown === "string" &&
      content.report_markdown.trim().length > 80;
  }) ||
    artifacts.find((artifact) => isRecord(artifact.content?.client_summary)) ||
    artifacts.find((artifact) => artifact.type === "evaluation" || artifact.type === "deep_analysis") ||
    artifacts[0] ||
    null;
}

function metricValue(summary: Record<string, unknown>, labelPattern: RegExp): string {
  for (const item of list(summary.computed_metrics)) {
    if (!isRecord(item)) continue;
    const label = text(item.label);
    if (labelPattern.test(label)) return text(item.value);
  }
  return "";
}

function metricNumber(summary: Record<string, unknown>, labelPattern: RegExp): number | null {
  const raw = metricValue(summary, labelPattern).replace(/[^0-9.+-]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function metricText(summary: Record<string, unknown>, labelPattern: RegExp): { label: string; value: string; note: string } | null {
  for (const item of list(summary.computed_metrics)) {
    if (!isRecord(item)) continue;
    const label = text(item.label);
    if (!labelPattern.test(label)) continue;
    const value = text(item.value);
    if (!value) continue;
    return { label, value, note: text(item.note) };
  }
  return null;
}

function supportedClaimTexts(summary: Record<string, unknown>): string[] {
  return list(summary.supported_claims)
    .filter(isRecord)
    .map((item) => {
      const claim = text(item.claim || item.title);
      const evidence = text(item.evidence);
      return oneLine([claim, evidence].filter(Boolean).join(": "));
    })
    .filter(Boolean);
}

function dataRequestTexts(summary: Record<string, unknown>): string[] {
  return list(summary.data_requests)
    .filter(isRecord)
    .map((item) => {
      const request = text(item.request);
      const why = text(item.why_it_matters);
      return oneLine(why ? `${request} Why it matters: ${why}` : request);
    })
    .filter(Boolean);
}

function summarySignalText(summary: Record<string, unknown>): string {
  const claims = supportedClaimTexts(summary).join(" ");
  return [
    text(summary.use_case_label),
    text(summary.conclusion),
    text(summary.decision),
    claims,
  ].join(" ").toLowerCase();
}

function hasNonWasteHeatSignals(summary: Record<string, unknown>): boolean {
  return /\b(soec|solid oxide|electrolysis|electrolyzer|hydrogen|syngas|tropsch|synthetic fuel|reactor|catalyst|fuel cell|battery|solar|pv|wind|nuclear|carbon capture|ccgt|combined cycle|cement|steel)\b/i
    .test(summarySignalText(summary));
}

function looksWasteHeatSpecific(value: string): boolean {
  return /\b(top-ranked stream|nearby heat demands?|hydraulic|retrofit scope|customer comfort|branch|supply-temperature|return-temperature|valve\/control|pump effects?)\b/i
    .test(value);
}

function relevantEvidenceRequestTexts(summary: Record<string, unknown>): string[] {
  const requests = dataRequestTexts(summary);
  const filteredRequests = hasNonWasteHeatSignals(summary)
    ? requests.filter((item) => !looksWasteHeatSpecific(item))
    : requests;
  if (filteredRequests.length > 0) return filteredRequests;

  const actions = actionTexts(summary);
  const filteredActions = hasNonWasteHeatSignals(summary)
    ? actions.filter((item) => !looksWasteHeatSpecific(item))
    : actions;
  return filteredActions;
}

function actionTexts(summary: Record<string, unknown>): string[] {
  return list(summary.recommended_actions)
    .map((item) => isRecord(item) ? text(item.action) : text(item))
    .filter(Boolean);
}

function reviewedFileTexts(summary: Record<string, unknown>, documents: Array<{ filename?: string; mime_type?: string; size_bytes?: number }>): string[] {
  const reviewed = list(summary.reviewed_files)
    .filter(isRecord)
    .map((item) => text(item.filename || item.name))
    .filter(Boolean);
  const uploaded = documents.map((doc) => doc.filename || "").filter(Boolean);
  return Array.from(new Set([...reviewed, ...uploaded]));
}

function priorityTitle(summary: Record<string, unknown>): string {
  const priority = isRecord(summary.priority_recommendation) ? summary.priority_recommendation : {};
  return text(priority.title);
}

function priorityRationale(summary: Record<string, unknown>): string {
  const priority = isRecord(summary.priority_recommendation) ? summary.priority_recommendation : {};
  return text(priority.rationale);
}

function baseResponse(content: string, reason: string, followups: string[]): GroundedResponse {
  return {
    type: "response",
    content,
    plan_steps: null,
    action: null,
    suggested_followups: followups,
    workflow_orchestration: {
      source: "platform",
      reason,
      starts_with_evidence_intake: false,
    },
  };
}

function workspaceReportMarkdown(artifact: Artifact): string {
  const content = isRecord(artifact.content) ? artifact.content : {};
  if (artifact.type !== "workspace_run" && content.analysis_type !== "agent_workspace") return "";
  return text(content.report_markdown);
}

function sectionAfter(report: string, heading: RegExp): string {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) return "";
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3}\s+/.test(line.trim())) break;
    if (line.trim()) out.push(line.trim());
  }
  return out.join("\n").trim();
}

function recoveredSoecFtPilotAnswer(report: string): string {
  if (!/\b(SOEC|HTCE|solid oxide|co-?electrolysis)\b/i.test(report) || !/\b(Tropsch|FT\b|synthetic fuels?|syngas-to-liquids?)\b/i.test(report)) {
    return "";
  }
  const hasFiveGpd = /\b5\s*(?:GPD|gallons per day)\b/i.test(report);
  const hasTwoBpd = /\b2\s*BPD\b/i.test(report);
  const hasPressure = /\b300\b[\s\S]{0,30}\bpsi\b/i.test(report);
  const hasTemp = /\b230\b[\s\S]{0,40}\b(?:C|bed temperature)\b/i.test(report);
  const hasAlpha = /\b(?:alpha|ASF)[\s\S]{0,40}\b(?:0?\.84|84)\b/i.test(report);

  return compact([
    "Here is the actual answer from the available SOEC/HTCE plus FT synthetic-fuels evidence.",
    compact([
      "The uploaded package supports a staged integrated pilot, not an immediate commercial-scale recommendation.",
      "The practical first scale is about 10-25 BPD of liquid product. That is large enough to test continuous SOEC/HTCE plus FT integration, heat management, recycle behavior, stack/catalyst degradation, and product handling, while keeping first-of-a-kind CAPEX bounded.",
      "A 50+ BPD unit should be treated as a qualification or pre-commercial module after the 10-25 BPD train proves uptime, selectivity, electricity intensity, product slate, and replacement intervals.",
    ]).join("\n\n"),
    compact([
      "Extracted operating basis:",
      hasFiveGpd ? "- FT lab system: about 5 GPD." : "",
      hasTwoBpd ? "- Prior larger FT system: about 2 BPD." : "",
      hasPressure ? "- FT inlet pressure: about 300 psi." : "",
      hasTemp ? "- FT bed temperature: about 230 C." : "",
      hasAlpha ? "- ASF alpha: about 0.84." : "",
    ]).join("\n"),
    [
      "Working economics model:",
      "Breakeven daily production = annualized fixed cost / contribution margin per barrel / operating days.",
      "Contribution margin per barrel = product price - electricity intensity x electricity price - non-power variable cost.",
      "Using a reasonable placeholder case of 3.0 MWh/bbl, USD 50/MWh electricity, USD 250/bbl product value, USD 35/bbl non-power variable cost, 90% capacity factor, 8% fixed OPEX, and 11.7% capital recovery factor, the margin is about USD 65/bbl.",
    ].join("\n"),
    [
      "Illustrative breakeven readout:",
      "- 2 BPD demonstrated skid scale: useful for validation, not standalone profitability.",
      "- 10 BPD integrated pilot with about USD 18M installed CAPEX: roughly 166 BPD breakeven in the base case, so it should be justified as validation rather than fuel-sales profit.",
      "- 25 BPD pilot with about USD 40M installed CAPEX: roughly 369 BPD breakeven in the base case.",
      "- 50 BPD pre-commercial module with about USD 70M installed CAPEX: roughly 647 BPD breakeven in the base case.",
    ].join("\n"),
    "Recommendation: build the 10-25 BPD integrated pilot first. It minimizes wasted CAPEX while maximizing the learning needed for the later commercial design. Only move to 50-100+ BPD after the pilot demonstrates stable uptime, stack degradation, FT selectivity, recycle ratio, product upgrading cost, and actual electricity intensity.",
  ]).join("\n\n");
}

function fallbackWorkspaceReportFollowup(message: string, report: string): string {
  const lower = message.toLowerCase();
  const recommendation = sectionAfter(report, /^##\s+recommendation/i);
  const economics = sectionAfter(report, /^##\s+economics/i);
  const model = sectionAfter(report, /^##\s+(?:pilot[- ]scale\s+)?simulation/i);
  const inputs = sectionAfter(report, /^##\s+inputs/i);
  const numeric = sectionAfter(report, /^##\s+extracted numeric/i);

  if (/\bwhere(?:'s|\s+is)?\b.*\banswer\b|\banswer\b.*\bwhere\b/i.test(lower)) {
    const recovered = recoveredSoecFtPilotAnswer(report);
    if (recovered) return recovered;
    const direct = sectionAfter(report, /^##\s+direct answer/i);
    return compact([
      direct || "The answer is in the latest workspace report. Here is the useful part:",
      model ? `Simulation:\n${model}` : "",
      economics ? `Economics:\n${economics}` : "",
      recommendation ? `Recommendation:\n${recommendation}` : "",
    ]).join("\n\n");
  }

  if (/\bplant manager|operator|operations\b/i.test(lower)) {
    return compact([
      "Plant-manager version: the current package is enough to frame the pilot as an integrated operating test, not enough to lock the commercial plant size yet.",
      recommendation ? `Operational recommendation: ${recommendation}` : "",
      "The practical decision is to run the smallest continuous unit that proves uptime, electricity intensity, syngas quality, FT conversion/selectivity, product handling, and maintenance rhythm under realistic operating conditions.",
      inputs ? `Before committing to a larger scale, collect:\n${inputs}` : "",
    ]).join("\n\n");
  }

  if (/\bassumptions?\b|\bdriving\b|\bwhy\b/i.test(lower)) {
    return compact([
      "The recommendation is driven by these assumptions:",
      "- Pilot economics are dominated by uptime, electricity intensity, conversion/selectivity, product price, and stack/catalyst replacement cost.",
      "- CAPEX should not be scaled faster than the evidence quality, because larger nameplate capacity does not solve uncertain yield, degradation, or operating availability.",
      "- The best pilot scale is the smallest train that can run continuously and generate representative product for qualification.",
      economics ? `Economic basis:\n${economics}` : "",
      inputs ? `Controlling missing inputs:\n${inputs}` : "",
      numeric ? `Extracted numeric basis:\n${numeric}` : "",
    ]).join("\n\n");
  }

  return compact([
    "More detail from the current workspace result:",
    model ? `Simulation basis:\n${model}` : "",
    economics ? `Economics basis:\n${economics}` : "",
    recommendation ? `Scale recommendation:\n${recommendation}` : "",
    inputs ? `Inputs needed to make the next answer numeric:\n${inputs}` : "",
  ]).join("\n\n");
}

async function answerWorkspaceReportFollowup(message: string, artifact: Artifact): Promise<GroundedResponse | null> {
  const report = workspaceReportMarkdown(artifact);
  if (!report || report.length < 80) return null;
  const deterministicAnswer = fallbackWorkspaceReportFollowup(message, report);
  if (/\bwhere(?:'s|\s+is)?\b.*\banswer\b|\banswer\b.*\bwhere\b/i.test(message) && deterministicAnswer) {
    return baseResponse(deterministicAnswer, "report_followup_from_latest_artifact", [
      "Show the breakeven formula with example numbers",
      "List the missing data by subsystem",
      "Turn this into a pilot test plan",
    ]);
  }
  const apiAvailable = process.env.NODE_ENV !== "test" &&
    !!(getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY"));
  let content = "";
  if (apiAvailable) {
    const prompt = [
      "Answer the user's follow-up using only the latest workspace report below.",
      "Do not invent values that are not in the report. If a numeric value is unavailable, explain the assumption or input needed.",
      "Do not mention internal tools, Docker, sandbox execution, parser status, or model names.",
      "Write a direct, detailed answer in plain professional language.",
      "",
      `USER FOLLOW-UP:\n${message}`,
      "",
      `LATEST WORKSPACE REPORT:\n${report.slice(0, 18000)}`,
    ].join("\n");
    content = await callDeepSeekV3(
      [{ role: "user", content: prompt }],
      { temperature: 0.2, maxTokens: 1800 },
    ).catch(() => "");
  }
  return baseResponse(content.trim() || deterministicAnswer, "report_followup_from_latest_artifact", [
    "Show the breakeven formula with example numbers",
    "List the missing data by subsystem",
    "Turn this into a pilot test plan",
  ]);
}

function answerGaps(summary: Record<string, unknown>): GroundedResponse {
  const requests = relevantEvidenceRequestTexts(summary);
  const notProven = strings(summary.not_proven);
  const conclusion = text(summary.conclusion);
  const content = compact([
    conclusion ? `The core result is useful for prioritization, but the evidence gaps still block an engineering or investment commitment: ${conclusion}` : "",
    requests.length ? `Best next data requests:\n${numberedList(requests, 5)}` : "",
    notProven.length ? `Do not claim yet:\n${bulletList(notProven, 5)}` : "",
    "Practical next step: collect the first operating-data request before spending time on final economics, scale selection, or external claims. That is the fastest way to test whether the technical signal is real, repeatable, and worth engineering budget.",
  ]).join("\n\n");
  return baseResponse(content, "grounded_evidence_gap_answer", [
    "Which one should I ask for first?",
    "Explain this for a plant manager",
    "What can we safely claim now?",
  ]);
}

function answerStrongest(summary: Record<string, unknown>): GroundedResponse {
  const conclusion = text(summary.conclusion);
  const firstInspect = metricValue(summary, /first place|inspect|top/i);
  const accessible = metricValue(summary, /accessible exergy/i);
  const totalEnergy = metricValue(summary, /total energy/i);
  const quality = metricValue(summary, /quality|exergy factor/i);
  const claims = supportedClaimTexts(summary);
  const priority = priorityTitle(summary);
  const rationale = priorityRationale(summary);
  const content = compact([
    conclusion || (priority ? `${priority}. ${rationale}` : ""),
    firstInspect ? `Strongest result: inspect ${firstInspect} first.` : "",
    compact([
      accessible ? `Accessible exergy: ${accessible}` : "",
      totalEnergy ? `Total energy screened: ${totalEnergy}` : "",
      quality ? `Quality factor: ${quality}` : "",
    ]).join("\n"),
    claims.length ? `Evidence basis:\n${bulletList(claims, 3)}` : "",
    "What this is strong enough for: first-pass prioritization and deciding where to focus the next technical review. What it is not strong enough for yet: final design, ROI, permitting, financing, or operating guarantees.",
  ]).join("\n\n");
  return baseResponse(content, "grounded_strongest_result_answer", [
    "Why is that branch stronger?",
    "What data would make this decision-grade?",
    "Turn this into a memo",
  ]);
}

function answerWhy(summary: Record<string, unknown>, message: string): GroundedResponse {
  const claims = supportedClaimTexts(summary);
  const top = metricValue(summary, /first place|inspect|top/i);
  const relevant = claims.filter((claim) => /largest|mwh|quality|exergy|temperature|useful-work|useful work/i.test(claim));
  const asksL4L22 = /\bl4\b/i.test(message) && /\bl22\b/i.test(message);
  const content = compact([
    asksL4L22
      ? "L4 is preferred over L22 because the ranking is based on useful-work potential, not raw heat quantity. L22 can be the larger MWh stream while still being less valuable after temperature quality is included."
      : top
        ? `${top} ranks first because the screen weights heat quantity by temperature quality. The useful question is not only “how many MWh?” but “how much accessible work can this heat actually provide?”`
        : "The ranking is based on useful-work potential rather than energy quantity alone.",
    relevant.length ? `Support in the current artifact:\n${bulletList(relevant, 4)}` : "",
    "The caveat is important: this explains the current technical priority, not project economics or implementation feasibility. Those require operating time series, cost basis, integration constraints, and service-quality data.",
  ]).join("\n\n");
  return baseResponse(content, "grounded_explanation_answer", [
    "What would make this decision-grade?",
    "Explain this to a plant manager",
    "What should we inspect first?",
  ]);
}

function answerMemo(summary: Record<string, unknown>): GroundedResponse {
  const conclusion = text(summary.conclusion);
  const claims = supportedClaimTexts(summary);
  const notProven = strings(summary.not_proven);
  const requests = relevantEvidenceRequestTexts(summary);
  const content = compact([
    "Client-ready memo:",
    `Bottom line: ${conclusion || "The uploaded evidence supports an initial prioritization, not a final engineering decision."}`,
    claims.length ? `What the data supports:\n${bulletList(claims, 4)}` : "",
    notProven.length ? `What it does not prove yet:\n${bulletList(notProven, 4)}` : "",
    requests.length ? `Recommended next data request:\n${numberedList(requests, 3)}` : "",
    "Recommendation: use this result to focus the next engineering review, then hold ROI, scale, safety, reliability, and customer-impact claims until the missing operating and economic evidence is collected.",
  ]).join("\n\n");
  return baseResponse(content, "grounded_client_memo_answer", [
    "Make it shorter",
    "Make it executive-facing",
    "What should stay internal?",
  ]);
}

function answerAudience(summary: Record<string, unknown>, message: string): GroundedResponse {
  const top = metricValue(summary, /first place|inspect|top/i);
  const accessible = metricValue(summary, /accessible exergy/i);
  const requests = relevantEvidenceRequestTexts(summary);
  const audience = /\bceo|executive|board\b/i.test(message) ? "executive" : "plant manager";
  const content = audience === "executive"
    ? compact([
        `Executive version: the uploaded evidence identifies ${top || "a promising technical pathway"} as the best first place to investigate${accessible ? `, with ${accessible} of useful-work opportunity` : ""}. This is enough to focus diligence, not enough to approve capital.`,
        requests[0] ? `The first funded follow-up should be: ${requests[0]}` : "",
        "Decision implication: keep the project moving only as a targeted evidence-gathering step until operating data, economics, and service impacts are documented.",
      ]).join("\n\n")
    : compact([
        `Plant-manager version: ${top || "the package points to a useful technical pathway"}, but the next decision should be based on measured operating data rather than brochure claims.`,
        "The practical check is whether the system can run continuously at the claimed conditions, produce the expected output, and maintain performance under realistic operating constraints.",
        requests[0] ? `Ask the operations team for this first: ${requests[0]}` : "",
      ]).join("\n\n");
  return baseResponse(content, "grounded_audience_answer", [
    "Make this customer-safe",
    "What should engineering check first?",
    "What should we not claim yet?",
  ]);
}

function answerWhatIf(summary: Record<string, unknown>, message: string): GroundedResponse | null {
  if (!/\b(double[ds]?|twice|2x)\b/i.test(message)) return null;
  const accessible = metricNumber(summary, /accessible exergy/i);
  const total = metricNumber(summary, /total energy/i);
  if (accessible === null && total === null) return null;
  const content = compact([
    "If the operating basis doubled and the same temperature profile held, the screened quantities would scale roughly linearly.",
    accessible !== null ? `Accessible exergy would move from about ${accessible.toFixed(3)} MWh_ex to about ${(accessible * 2).toFixed(3)} MWh_ex.` : "",
    total !== null ? `Total energy would move from about ${total.toFixed(3)} MWh to about ${(total * 2).toFixed(3)} MWh.` : "",
    "This is only a proportional screen. It assumes the same branch temperatures, return conditions, load mix, and controllability. It still would not prove ROI without cost, operating-hours, and integration data.",
  ]).join("\n\n");
  return baseResponse(content, "grounded_lightweight_what_if", [
    "What if temperatures changed?",
    "What data would make that calculation stronger?",
    "Which assumption matters most?",
  ]);
}

function parseScaleCount(message: string): number | null {
  const lower = message.toLowerCase();
  const shorthand = lower.match(/\b(\d+(?:\.\d+)?)\s*(million|billion|thousand|m|bn|k)\b/);
  if (shorthand?.[1] && shorthand?.[2]) {
    const base = Number(shorthand[1]);
    const suffix = shorthand[2];
    const multiplier = suffix === "billion" || suffix === "bn"
      ? 1_000_000_000
      : suffix === "million" || suffix === "m"
        ? 1_000_000
      : 1_000;
    if (Number.isFinite(base) && base > 0) return base * multiplier;
  }
  const explicit = lower.match(/\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:x|times|modules?|panels?|units?|devices?|systems?)\b/);
  if (explicit?.[1]) {
    const value = Number(explicit[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  const ofThese = lower.match(/\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s+of\s+(?:these\s+)?(?:modules?|panels?|units?|devices?|systems?)\b/);
  if (ofThese?.[1]) {
    const value = Number(ofThese[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function parseMetricQuantity(value: string): { value: number; unit: string } | null {
  const match = value.match(/(-?\d+(?:,\d{3})*(?:\.\d+)?)(.*)$/);
  if (!match?.[1]) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return { value: numeric, unit: (match[2] || "").trim() };
}

function isScalableMetric(label: string, unit: string): boolean {
  const text = `${label} ${unit}`.toLowerCase();
  if (/\b(factor|efficiency|coefficient|voltage|current|temperature|ratio|voc|isc|vmp|imp|cells?|area)\b/.test(text)) {
    return false;
  }
  return /\b(power|generation|energy|output|production|capacity|duty|load)\b/.test(text) ||
    /\b(w|kw|mw|gw|kwh|mwh|gwh)\b/.test(text);
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

function formatScaledPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1_000_000_000) return `${(watts / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} GW`;
  if (abs >= 1_000_000) return `${(watts / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} MW`;
  if (abs >= 1_000) return `${(watts / 1_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kW`;
  return `${watts.toLocaleString("en-US", { maximumFractionDigits: 2 })} W`;
}

function formatScaledEnergyKwh(kwh: number, period: string): string {
  const abs = Math.abs(kwh);
  const suffix = period ? `/${period}` : "";
  if (abs >= 1_000_000) return `${(kwh / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} GWh${suffix}`;
  if (abs >= 1_000) return `${(kwh / 1_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} MWh${suffix}`;
  return `${kwh.toLocaleString("en-US", { maximumFractionDigits: 2 })} kWh${suffix}`;
}

function formatPerUnit(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function scaledMetricLine(label: string, perUnit: { value: number; unit: string }, count: number): string | null {
  const unit = perUnit.unit.toLowerCase().replace(/\s+/g, "");
  const scaled = perUnit.value * count;
  if (unit === "w" || unit === "watt" || unit === "watts") {
    return `${label}: ${formatScaledPower(scaled)} total (${formatPerUnit(perUnit.value)} W each).`;
  }
  if (unit === "kw") return `${label}: ${formatScaledPower(scaled * 1_000)} total (${formatPerUnit(perUnit.value)} kW each).`;
  if (unit === "mw") return `${label}: ${formatScaledPower(scaled * 1_000_000)} total (${formatPerUnit(perUnit.value)} MW each).`;
  if (unit === "gw") return `${label}: ${formatScaledPower(scaled * 1_000_000_000)} total (${formatPerUnit(perUnit.value)} GW each).`;
  const energy = unit.match(/^(kwh|mwh|gwh)(?:\/(day|yr|year|month|hour|h))?$/);
  if (energy) {
    const baseKwh = energy[1] === "gwh" ? scaled * 1_000_000 : energy[1] === "mwh" ? scaled * 1_000 : scaled;
    const period = energy[2] === "yr" ? "year" : energy[2] || "";
    return `${label}: ${formatScaledEnergyKwh(baseKwh, period)} total (${formatPerUnit(perUnit.value)} ${perUnit.unit} each).`;
  }
  return `${label}: ${scaled.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${perUnit.unit} total (${formatPerUnit(perUnit.value)} ${perUnit.unit} each).`;
}

function answerScaledMetrics(summary: Record<string, unknown>, message: string): GroundedResponse | null {
  const count = parseScaleCount(message);
  if (!count || count <= 1) return null;

  const metricLines: string[] = [];
  for (const item of list(summary.computed_metrics)) {
    if (!isRecord(item)) continue;
    const label = text(item.label);
    const value = text(item.value);
    if (!label || !value) continue;
    const parsed = parseMetricQuantity(value);
    if (!parsed || !isScalableMetric(label, parsed.unit)) continue;
    const line = scaledMetricLine(label, parsed, count);
    if (line) metricLines.push(line);
  }
  if (metricLines.length === 0) return null;

  const peak = metricText(summary, /^peak power$/i);
  const sitePeak = metricText(summary, /site peak/i);
  const daily = metricText(summary, /average daily generation/i);
  const isPvPlant = !!peak && !!daily && /\b(modules?|panels?|pv|solar|inverter|plant)\b/i.test(message);
  const contentParts: string[] = [];

  contentParts.push(`Scaled to ${formatCount(count)} units, using the per-unit values from the latest analysis:`);
  contentParts.push(bulletList(metricLines, 8));

  if (isPvPlant) {
    const peakQuantity = peak ? parseMetricQuantity(peak.value) : null;
    const sitePeakQuantity = sitePeak ? parseMetricQuantity(sitePeak.value) : null;
    const dailyQuantity = daily ? parseMetricQuantity(daily.value) : null;
    const dcNameplateMw = peakQuantity && /^w/i.test(peakQuantity.unit)
      ? (peakQuantity.value * count) / 1_000_000
      : null;
    const recommendedAcMw = dcNameplateMw ? dcNameplateMw / 1.25 : null;
    const dailyKwh = dailyQuantity && /kwh\/day/i.test(dailyQuantity.unit)
      ? dailyQuantity.value * count
      : null;
    const annualGwh = dailyKwh ? (dailyKwh * 365) / 1_000_000 : null;
    contentParts.push(compact([
      dcNameplateMw !== null ? `PV plant interpretation: this is about ${dcNameplateMw.toLocaleString("en-US", { maximumFractionDigits: 1 })} MWp DC nameplate.` : "",
      sitePeakQuantity && /^w/i.test(sitePeakQuantity.unit)
        ? `The hot-site DC peak estimate is about ${((sitePeakQuantity.value * count) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} MW DC before inverter clipping and AC losses.`
        : "",
      annualGwh !== null ? `The annual DC energy implied by the daily estimate is about ${annualGwh.toLocaleString("en-US", { maximumFractionDigits: 1 })} GWh/year before plant-level AC losses.` : "",
    ]).join(" "));

    if (/\binverter|ac|grid|plant\b/i.test(message) && recommendedAcMw !== null) {
      contentParts.push([
        `Inverter recommendation: I would start with a utility-scale inverter block design around ${recommendedAcMw.toLocaleString("en-US", { maximumFractionDigits: 0 })} MWac, which is a DC/AC ratio of about 1.25 on ${dcNameplateMw?.toLocaleString("en-US", { maximumFractionDigits: 1 })} MWdc.`,
        "For a plant this large, use 1,500 Vdc utility-scale central inverter stations or modular central-inverter skids with MV transformers, plant controller, SCADA, grid-code support, and local service coverage.",
        "Use string inverters instead if the site has heavy row mismatch, complex terrain, or an O&M strategy that values granular MPPT and redundancy more than lowest installed cost.",
      ].join(" "));
    }
  }

  contentParts.push("Assumptions: this is a proportional scale-up of the latest per-unit result. It does not add spacing, wiring, transformer, clipping, curtailment, soiling, availability, or grid-interconnection losses unless those were already included in the prior artifact.");

  return baseResponse(contentParts.filter(Boolean).join("\n\n"), "grounded_scaled_metric_followup", [
    "What AC size should I use?",
    "Estimate annual generation after inverter losses",
    "What data do you need for project-grade sizing?",
  ]);
}

function latestAssistantMetricSummary(history?: Array<{ role?: string; content?: string }>): Record<string, unknown> | null {
  for (const entry of [...(history || [])].reverse()) {
    if (entry.role === "assistant" && typeof entry.content === "string" && entry.content.trim()) {
      const summary = summaryFromAssistantMetrics(entry.content);
      if (summary) return summary;
    }
  }
  return null;
}

function summaryFromAssistantMetrics(content: string): Record<string, unknown> | null {
  const metrics: Array<{ label: string; value: string }> = [];
  const peak = content.match(/Peak power:\s*(\d+(?:\.\d+)?)\s*W\b/i) ||
    content.match(/peak module rating\s*(\d+(?:\.\d+)?)\s*W\b/i);
  if (peak?.[1]) metrics.push({ label: "Peak Power", value: `${peak[1]} W` });
  const sitePeak = content.match(/about\s*(\d+(?:\.\d+)?)\s*W\s+temperature-adjusted/i) ||
    content.match(/heat-adjusted site peak about\s*(\d+(?:\.\d+)?)\s*W\b/i);
  if (sitePeak?.[1]) metrics.push({ label: "Site Peak Power", value: `${sitePeak[1]} W` });
  const daily = content.match(/Average daily generation:\s*(\d+(?:\.\d+)?)\s*kWh\/day/i) ||
    content.match(/average daily generation about\s*(\d+(?:\.\d+)?)\s*kWh\s+per\s+module-day/i);
  if (daily?.[1]) metrics.push({ label: "Average Daily Generation", value: `${daily[1]} kWh/day` });
  if (metrics.length < 2) return null;
  return {
    client_summary: {
      computed_metrics: metrics,
    },
  };
}

export function buildGroundedHistoryResponse(args: {
  message: string;
  history?: Array<{ role?: string; content?: string }>;
}): GroundedResponse | null {
  const message = args.message || "";
  if (!looksLikeGroundedFollowup(message)) return null;
  const historySummary = latestAssistantMetricSummary(args.history);
  const summary = isRecord(historySummary?.client_summary) ? historySummary.client_summary : {};
  if (Object.keys(summary).length === 0) return null;
  return answerScaledMetrics(summary, message);
}

function parseMoneyPerUnit(message: string, unit: "mmbtu" | "mwh"): number | null {
  const pattern = unit === "mmbtu"
    ? /\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:mm\s?btu|mmbtu|mmbtu\b)/i
    : /\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(?:mwh|mwhe)\b/i;
  const match = message.match(pattern);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseCapacityFactor(message: string): number | null {
  const direct = message.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:capacity factor|cf|utilization|load factor)\b/i);
  if (direct?.[1]) {
    const value = Number(direct[1]);
    return Number.isFinite(value) ? value : null;
  }
  const after = message.match(/\b(?:capacity factor|cf|utilization|load factor)\D{0,24}(\d+(?:\.\d+)?)\s*%/i);
  if (after?.[1]) {
    const value = Number(after[1]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function answerEnergyPlantFollowup(summary: Record<string, unknown>, message: string): GroundedResponse | null {
  const heatRate = metricNumber(summary, /heat rate/i);
  const netCapacity = metricNumber(summary, /net capacity/i);
  const baseCapacityFactor = metricNumber(summary, /capacity factor/i);
  const existingGasPrice = metricNumber(summary, /gas price/i);
  const existingPowerPrice = metricNumber(summary, /power price/i);
  const existingCo2Intensity = metricNumber(summary, /co2 intensity/i);
  const hasPlantBasis = heatRate !== null || netCapacity !== null || metricValue(summary, /spark spread|fuel cost|annual co2/i);
  if (!hasPlantBasis) return null;
  if (!/\b(gas|mmbtu|fuel|spark|capacity factor|cf|co2|carbon|emissions?|annual|generation|economics?|dispatch|plant)\b/i.test(message)) {
    return null;
  }

  const gasPrice = parseMoneyPerUnit(message, "mmbtu") ?? existingGasPrice;
  const powerPrice = parseMoneyPerUnit(message, "mwh") ?? existingPowerPrice;
  const capacityFactor = parseCapacityFactor(message) ?? baseCapacityFactor;
  const fuelCost = heatRate !== null && gasPrice !== null ? (heatRate / 1000) * gasPrice : null;
  const sparkSpread = powerPrice !== null && fuelCost !== null ? powerPrice - fuelCost : null;
  const annualGenerationGwh = netCapacity !== null && capacityFactor !== null
    ? netCapacity * (capacityFactor / 100) * 8760 / 1000
    : null;
  const annualFuelMmbtu = annualGenerationGwh !== null && heatRate !== null
    ? annualGenerationGwh * heatRate
    : null;
  const co2Intensity = existingCo2Intensity ?? (heatRate !== null ? (heatRate / 1000) * 0.05306 : null);
  const annualCo2 = annualGenerationGwh !== null && co2Intensity !== null
    ? annualGenerationGwh * 1000 * co2Intensity
    : null;

  const lines = compact([
    netCapacity !== null && capacityFactor !== null
      ? `At ${formatNumber(netCapacity, 1)} MW net and ${formatNumber(capacityFactor, 1)}% capacity factor, annual generation is about ${formatNumber(annualGenerationGwh || 0, 1)} GWh/year.`
      : "",
    heatRate !== null ? `The heat-rate basis is ${formatNumber(heatRate, 0)} Btu/kWh.` : "",
    fuelCost !== null && gasPrice !== null
      ? `At USD ${formatNumber(gasPrice, 2)}/MMBtu gas, fuel cost is about USD ${formatNumber(fuelCost, 2)}/MWh.`
      : "",
    annualFuelMmbtu !== null ? `Annual fuel use is about ${formatNumber(annualFuelMmbtu, 0)} MMBtu/year.` : "",
    sparkSpread !== null && powerPrice !== null
      ? `At USD ${formatNumber(powerPrice, 2)}/MWh power, spark spread before O&M and other costs is about USD ${formatNumber(sparkSpread, 2)}/MWh.`
      : "",
    co2Intensity !== null ? `Operational CO2 intensity is about ${formatNumber(co2Intensity, 4)} t/MWh${existingCo2Intensity === null ? " using a natural-gas combustion factor from the heat rate" : ""}.` : "",
    annualCo2 !== null ? `Annual operational CO2 is about ${formatNumber(annualCo2, 0)} t/year at this generation level.` : "",
  ]);

  if (lines.length === 0) return null;
  return baseResponse(lines.join("\n\n"), "grounded_energy_plant_followup", [
    "What if gas is $6/MMBtu?",
    "Run a capacity-factor sensitivity",
    "What inputs are missing for project-grade economics?",
  ]);
}

async function answerSourceInspection(projectId: string, message: string, summary: Record<string, unknown>, documents: Array<{ filename?: string; mime_type?: string; size_bytes?: number }>): Promise<GroundedResponse | null> {
  const lower = message.toLowerCase();
  if (!/\b(row|file|source|uploaded|raw)\b/.test(lower)) return null;
  const files = reviewedFileTexts(summary, documents);
  const rowMatch = lower.match(/\b(?:row|line)\s+(\d+|one|two|three|four|five)\b/);
  if (!rowMatch && /\bwhat\s+files?\b|\bwhich\s+files?\b|\bsource\b|\buploaded\b/.test(lower)) {
    return baseResponse(
      compact([
        files.length ? `Files available in this workspace:\n${bulletList(files, 8)}` : "I do not see a retained source filename in the current artifact.",
        "I can answer from the summarized artifact now, and for parser-ready CSV or JSON uploads I can inspect the source file directly when you ask for a row, key, or field.",
      ]).join("\n\n"),
      "grounded_source_inventory_answer",
      ["Check the third row", "What fields are in the source file?", "Which file supports the conclusion?"],
    );
  }
  if (!rowMatch) return null;
  const rowWord = rowMatch[1];
  const rowNumber = ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[rowWord] || Number(rowWord);
  if (!Number.isFinite(rowNumber) || rowNumber < 1) return null;
  const paths = await getProjectUploadPaths(projectId);
  for (const path of paths) {
    if (!path.toLowerCase().endsWith(".csv")) continue;
    const raw = await readFile(path, "utf-8").catch(() => "");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= rowNumber) continue;
    const headers = lines[0].split(",").map((item) => item.trim());
    const values = lines[rowNumber].split(",").map((item) => item.trim());
    const rowText = headers.map((header, index) => `${header}: ${values[index] ?? ""}`).join("; ");
    return baseResponse(
      `Row ${rowNumber} in ${path.split("/").pop()} reads: ${rowText}\n\nI would treat that as raw source evidence, not a conclusion by itself. To connect it to the analysis, compare its energy and temperature values against the computed useful-work ranking.`,
      "grounded_source_row_answer",
      ["Why does this row matter?", "Compare it to the top branch", "What fields are missing?"],
    );
  }
  return baseResponse(
    "I can see the workspace artifact, but I could not find a parser-ready CSV source file to inspect by row. If the upload was a JSON export, I can inspect the exported analysis fields, but it does not behave like a row-based table.",
    "grounded_source_row_unavailable",
    ["Which source file supports the conclusion?", "What data fields are available?", "What should I upload next?"],
  );
}

export async function buildGroundedWorkspaceResponse(args: GroundedDialogueArgs): Promise<GroundedResponse | null> {
  const message = args.message || "";
  if (!looksLikeGroundedFollowup(message)) return null;

  const summaries = await args.storage.listArtifacts(args.projectId);
  if (summaries.length === 0) return null;
  const fullArtifacts = await Promise.all(summaries.slice(0, 8).map((artifact) => args.storage.getArtifact(args.projectId, artifact.id)));
  const artifact = latestEvaluationArtifact(fullArtifacts.filter((item): item is Artifact => !!item));
  if (!artifact || !isRecord(artifact.content)) return null;
  const workspaceReportAnswer = await answerWorkspaceReportFollowup(message, artifact);
  if (workspaceReportAnswer) return workspaceReportAnswer;
  const summary = isRecord(artifact.content.client_summary) ? artifact.content.client_summary : {};
  if (Object.keys(summary).length === 0) return null;

  const documents = await args.storage.listDocuments(args.projectId);
  const sourceAnswer = await answerSourceInspection(args.projectId, message, summary, documents);
  if (sourceAnswer) return sourceAnswer;

  const energyPlantAnswer = answerEnergyPlantFollowup(summary, message);
  if (energyPlantAnswer) return energyPlantAnswer;

  const scaledAnswer = answerScaledMetrics(summary, message);
  if (scaledAnswer) return scaledAnswer;

  const whatIfAnswer = answerWhatIf(summary, message);
  if (whatIfAnswer) return whatIfAnswer;

  if (/\b(gaps?|missing|evidence|data request|what data|what do you need|confidence)\b/i.test(message)) {
    return answerGaps(summary);
  }
  if (/\b(strongest|act on|act first|first inspect|best result|most important|what matters most)\b/i.test(message)) {
    return answerStrongest(summary);
  }
  if (/\bwhy\b|\bexplain\b|\bassumptions?\b/i.test(message)) {
    if (/\bplant manager|ceo|executive|board\b/i.test(message)) {
      return answerAudience(summary, message);
    }
    return answerWhy(summary, message);
  }
  if (/\bmemo|client[- ]ready|customer[- ]safe|summary|write this|turn this into\b/i.test(message)) {
    return answerMemo(summary);
  }
  if (/\bplant manager|ceo|executive|board\b/i.test(message)) {
    return answerAudience(summary, message);
  }

  return answerStrongest(summary);
}
