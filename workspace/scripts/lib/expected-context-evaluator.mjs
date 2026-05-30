const SYNONYMS = [
  [/\bunchanged\b/i, /\b(held constant|all other|constant|same basis|no other assumptions changed)\b/i],
  [/\bpermits?\b/i, /\b(permitting|approval|regulatory|environmental review|interconnection study)\b/i],
  [/\bmeasurements?\b/i, /\b(measured|metered|sensor|data request|next measurement|instrumentation)\b/i],
  [/\bmarkdown\b/i, /\b(md|\.md|report|memo)\b/i],
  [/\bcompressor\b/i, /\bcompressed air|inlet filter|compressor[_ -]?[a-z0-9]*\b/i],
  [/\bpump\b/i, /\bthrottled valve|circulation|pump[_ -]?[a-z0-9]*\b/i],
  [/\brefrigeration\b/i, /\bchiller|condensing temperature|refrigeration[_ -]?[a-z0-9]*\b/i],
];

const VALUE_RE = /(\$?\b-?\d+(?:,\d{3})*(?:\.\d+)?\b)/gi;

function normalize(text) {
  return String(text || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function numbers(text) {
  return Array.from(String(text || "").matchAll(VALUE_RE))
    .map((match) => Number(String(match[1] || match[0]).replace(/[$,]/g, "")))
    .filter(Number.isFinite);
}

function numericCovered(answer, term) {
  const expected = numbers(term)[0];
  if (!Number.isFinite(expected)) return false;
  return numbers(answer).some((value) => Math.abs(value - expected) / Math.max(1, Math.abs(expected)) <= 0.02 || Math.abs(value - expected) <= 0.05);
}

export function evaluateExpectedContext({ answer = "", expectedTerms = [], prompt = "", sourceTexts = [] }) {
  const normalizedAnswer = normalize(answer);
  const normalizedPrompt = normalize(prompt);
  const source = normalize(sourceTexts.join("\n"));
  const contextText = `${prompt || ""}\n${sourceTexts.join("\n")}`;
  return expectedTerms.map((rawTerm) => {
    const term = String(rawTerm || "").trim();
    const normalizedTerm = normalize(term);
    if (!term) return { term, status: "irrelevant", reason: "Empty expected term." };
    if (normalizedAnswer.includes(normalizedTerm) || numericCovered(answer, term)) {
      return { term, status: "covered", reason: "The answer contains the expected term or a numerically equivalent value." };
    }
    if (SYNONYMS.find(([termPattern, answerPattern]) => termPattern.test(term) && answerPattern.test(answer))) {
      return { term, status: "covered", reason: "The answer covers the expected context using an acceptable synonym or phrase." };
    }
    const synonymForTerm = SYNONYMS.find(([termPattern]) => termPattern.test(term));
    const contextHasTermOrSynonym =
      source.includes(normalizedTerm) ||
      normalizedPrompt.includes(normalizedTerm) ||
      Boolean(synonymForTerm?.[1].test(contextText));
    if (!contextHasTermOrSynonym) {
      return { term, status: "irrelevant", reason: "The expected term does not appear in prompt or source context, so it is not a reliable requirement for this run." };
    }
    if (/\b(markdown|pdf|csv|json|xlsx)\b/i.test(term) && /\.(md|pdf|csv|json|xlsx)\b/i.test(answer)) {
      return { term, status: "covered", reason: "The answer references the requested file type through a downloadable filename." };
    }
    if (term.length <= 4 && normalizedAnswer.split(" ").some((token) => token.startsWith(normalizedTerm))) {
      return { term, status: "false_positive", reason: "The expected token is short and appears as a stem inside an answer token; do not warn on this brittle check alone." };
    }
    return { term, status: "missing", reason: "The expected context appears relevant but was not covered by the answer, synonym set, or numeric equivalence check." };
  });
}
