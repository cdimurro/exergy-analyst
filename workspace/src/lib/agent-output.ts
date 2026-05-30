export const PUBLIC_AGENT_NAME = "Exergy Lab Agent";

export const PUBLIC_AGENT_IDENTITY_ANSWER = [
  `I’m the ${PUBLIC_AGENT_NAME}.`,
  "",
  "I can answer directly and I can use Exergy Lab tools when a request needs more than ordinary chat. That includes document analysis, literature and source research, physics and exergy calculations, simulations, techno-economic modeling, environmental/site data checks, code execution, and report or file generation.",
  "",
  "Examples of useful requests:",
  "- Upload a datasheet or report and ask me to extract the key assumptions, risks, and missing data.",
  "- Ask me to run a thermodynamic, process, or economic scenario model from supplied inputs.",
  "- Ask for a source-backed research brief, decision memo, CSV, PDF, or spreadsheet export.",
].join("\n");

export function isAgentIdentityQuestion(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  return (
    /\b(?:which|what)\s+(?:ai\s+)?model\s+(?:is|are)\s+(?:this|you)\b/i.test(text) ||
    /\b(?:who|what)\s+are\s+you\b/i.test(text) ||
    /\bare\s+you\s+(?:chatgpt|deepseek|claude|gemini|qwen|glm|an?\s+llm|an?\s+ai)\b/i.test(text) ||
    /\bwhat\s+can\s+you\s+(?:do|help(?:\s+me)?\s+with)\b/i.test(text)
  );
}

const MODEL_SELF_IDENTIFICATION_RE =
  /\b(?:i\s+am|i'm)\s+(?:the\s+)?(?:analysis engine|deepseek|qwen|glm|gemma|intern|oracle|s1\.pro|v\d+(?:\.\d+)?[-\s]?(?:flash|pro|reasoner|plus|max))(?:[\s._-]*(?:v?\d+(?:\.\d+)?|flash|pro|reasoner|plus|max))*\b/gi;

const INTERNAL_MODEL_RE =
  /\b(?:gemma|deepseek|intern|s1\.pro|oracle|qwen|glm)(?:[\s._-]*(?:v?\d+(?:\.\d+)?|flash|pro|reasoner|plus|max))*\b|\banalysis engine\s+v\d+(?:\.\d+)?[-\s]?(?:flash|pro|reasoner|plus|max)\b|\bv\d+(?:\.\d+)?[-\s]?(?:flash|pro|reasoner|plus|max)\b/gi;

const EXACT_UI_LABELS = new Set([
  "view details",
  "export report",
  "detailed view",
  "screening",
  "use as a triage note",
  "what is supported",
  "what the data can support",
  "what the provided material supports now",
  "what the workspace supports now",
  "what can be assessed now",
  "do not claim yet",
  "what should not be claimed yet",
  "unsupported claims to keep out of the external package",
  "claims needing caution",
  "claims to avoid",
  "claim interrogation results",
  "performance claims assessed",
  "claim status",
  "claim status ladder",
  "hidden residuals",
  "identified sets",
  "recommended actions",
  "best next data requests",
]);

function cleanLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return line;
  if (/\{[a-zA-Z_][a-zA-Z0-9_]*(?::[^{}\n]+)?\}/.test(trimmed) || /\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(trimmed)) return null;
  const normalized = trimmed
    .replace(/^#+\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
  if (EXACT_UI_LABELS.has(normalized)) return null;
  return line;
}

function repairMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const isPipeRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
  const isSeparatorRow = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const columnCount = (line: string) => Math.max(2, line.split("|").filter((part) => part.trim()).length);
  const separatorFor = (line: string) => {
    const columns = columnCount(line);
    return `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    out.push(line);
    const previous = lines[index - 1] || "";
    const next = lines[index + 1] || "";
    if (isPipeRow(line) && isSeparatorRow(next) && columnCount(line) !== columnCount(next)) {
      out.push(separatorFor(line));
      index += 1;
      continue;
    }
    if (
      isPipeRow(line) &&
      isPipeRow(next) &&
      !isSeparatorRow(next) &&
      !isPipeRow(previous)
    ) {
      out.push(separatorFor(line));
    }
  }
  return out.join("\n");
}

export function sanitizeInternalModelNames(text: string): string {
  return text
    .replace(MODEL_SELF_IDENTIFICATION_RE, `I’m the ${PUBLIC_AGENT_NAME}`)
    .replace(INTERNAL_MODEL_RE, "analysis engine")
    .replace(/\banalysis engine\s+analysis engine\b/gi, "analysis engine")
    .replace(/\banalysis engine\s+(?:flash|pro|reasoner|plus|max)\b/gi, "analysis engine");
}

export function sanitizeUserFacingAgentText(text: string): string {
  if (!text) return text;
  const lines = text
    .replace(/\\n/g, "\n")
    .replace(/^(?=[\s\S]{0,1800}\b(?:draft answer|quality_[a-z0-9_]+|quality warning|quality issue|quality check)\b)[\s\S]{0,1800}?\n\s*-{3,}\s*/i, "")
    .replace(/^.*\bquality_[a-z0-9_]+\b.*$/gim, "")
    .replace(/^.*\b(?:draft answer|quality warning|quality issue|quality check)\b.*$/gim, "")
    .replace(/\f/g, "\\f")
    .replace(/[\x00-\x08\x0B\x0E-\x1F\x7F]/g, "")
    .replace(/\t/g, " ")
    .replace(/\bI(?:'|’)ve already extracted\b/gi, "I extracted")
    .replace(/\bI(?:'|’)ve already analyzed\b/gi, "I analyzed")
    .replace(/\bI(?:'|’)ve already reviewed\b/gi, "I reviewed")
    .replace(/\bI(?:'|’)ve already parsed\b/gi, "I parsed")
    .replace(/\bI(?:'|’)ve already calculated\b/gi, "I calculated")
    .replace(/\bI(?:'|’)ve already estimated\b/gi, "I estimated")
    .replace(/\bI(?:'|’)ve already performed\b/gi, "I performed")
    .replace(/\bI(?:'|’)ve already prepared\b/gi, "I prepared")
    .replace(/\bI(?:'|’)ve already created\b/gi, "I created")
    .replace(/\bI(?:'|’)ve already generated\b/gi, "I generated")
    .replace(/\bI(?:'|’)ve already run\b/gi, "I ran")
    .replace(/^.*\b(?:claim status(?: ladder)?|hidden residuals?|identified sets?)\s*:.*$/gim, "")
    .replace(/^#{1,6}\s*Analysis\s+(?:Run|Result)\s*$/gim, "")
    .replace(/^#{1,6}\s*Direct Answer\s*$/gim, "## Executive Summary")
    .replace(/\*\*Result:\*\*\s*/g, "")
    .replace(/\bResult:\s*/g, "")
    .replace(/\bKey finding:\s*/g, "")
    .replace(/\bWhat the data can support:\s*/gi, "Basis: ")
    .replace(/\bWhat the provided material supports now:\s*/gi, "Basis: ")
    .replace(/\bWhat the workspace supports now:\s*/gi, "Basis: ")
    .replace(/\bSupported now:\s*/gi, "Basis: ")
    .replace(/\bWhat it cannot prove yet:\s*/gi, "Important limit: ")
    .replace(/\bWhat should not be claimed yet:\s*/gi, "Important limit: ")
    .replace(/\bNot supported yet:\s*/gi, "Important limit: ")
    .replace(/\bUnsupported claims(?: to keep out of the external package)?:\s*/gi, "Language to avoid: ")
    .replace(/\bClaims needing caution:\s*/gi, "Language to treat carefully: ")
    .replace(/\bClaim status(?: ladder)?:\s*/gi, "")
    .replace(/\bHidden residuals?:\s*/gi, "")
    .replace(/\bIdentified sets?:\s*/gi, "")
    .replace(/\bClaim interrogation results\b/gi, "Technical consistency checks")
    .replace(/\bPerformance claims assessed\b/gi, "Performance notes")
    .replace(/\bNext decision:\s*/g, "Next, ")
    .replace(/\bConfidence:\s*Screening(?:;|\.)?\s*/gi, "")
    .replace(/\bConfidence:\s*Screening grade(?:;|\.)?\s*/gi, "")
    .replace(/\bscreening[-\s]?grade\b/gi, "bounded by the available evidence")
    .replace(/\bscreening[-\s]?level\b/gi, "engineering-level")
    .replace(/\bscreening estimate\b/gi, "engineering estimate")
    .replace(/\bscreening calculation\b/gi, "engineering calculation")
    .replace(/\bscreening model\b/gi, "engineering model")
    .replace(/\bscreening case\b/gi, "engineering case")
    .replace(/\bscreening answer\b/gi, "useful answer")
    .replace(/\bscreening result\b/gi, "early result")
    .replace(/\bscreening brief\b/gi, "brief")
    .replace(/\bscreening basis\b/gi, "calculation basis")
    .replace(/\bscreening signals?\b/gi, "useful signals")
    .replace(/\bscreening context\b/gi, "available context")
    .replace(/\bsite-screening\b/gi, "site context")
    .replace(/\breactor-screening\b/gi, "reactor")
    .replace(/\bevidence screen\b/gi, "evidence view")
    .replace(/\bproduction screen\b/gi, "production estimate")
    .replace(/\bplant screen\b/gi, "plant estimate")
    .replace(/\bfor screening\b/gi, "for early analysis")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line): line is string => line !== null);
  return repairMarkdownTables(sanitizeInternalModelNames(lines.join("\n")))
    .replace(/\bunsupported claims?\b/gi, "statements needing evidence")
    .replace(/\bsupported claims?\b/gi, "source-backed statements")
    .replace(/\bclaim\s+status\b/gi, "review status")
    .replace(/\bclaim\s+ladder\b/gi, "review")
    .replace(/\bhidden residuals?\b/gi, "remaining model error")
    .replace(/\bidentified sets?\b/gi, "bounded result ranges")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function compactList(items: string[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = item.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}
