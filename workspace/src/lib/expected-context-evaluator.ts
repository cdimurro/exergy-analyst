import { extractNumericEvidence } from "@/lib/agent-quality-evaluator";

export type ExpectedContextStatus = "covered" | "missing" | "irrelevant" | "false_positive";

export interface ExpectedContextCheck {
  term: string;
  status: ExpectedContextStatus;
  reason: string;
}

const SYNONYMS: Array<[RegExp, RegExp]> = [
  [/\bunchanged\b/i, /\b(held constant|all other|constant|same basis|no other assumptions changed)\b/i],
  [/\bpermits?\b/i, /\b(permitting|approval|regulatory|environmental review|interconnection study)\b/i],
  [/\bmeasurements?\b/i, /\b(measured|metered|sensor|data request|next measurement|instrumentation)\b/i],
  [/\bmarkdown\b/i, /\b(md|\.md|report|memo)\b/i],
  [/\bcompressor\b/i, /\bcompressed air|inlet filter|compressor[_ -]?[a-z0-9]*\b/i],
  [/\bpump\b/i, /\bthrottled valve|circulation|pump[_ -]?[a-z0-9]*\b/i],
  [/\brefrigeration\b/i, /\bchiller|condensing temperature|refrigeration[_ -]?[a-z0-9]*\b/i],
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function numericCovered(answer: string, term: string): boolean {
  const expected = extractNumericEvidence(term, 4)[0];
  if (!expected) return false;
  return extractNumericEvidence(answer, 300).some((item) => {
    const scale = Math.max(1, Math.abs(expected.value));
    return Math.abs(item.value - expected.value) / scale <= 0.02 || Math.abs(item.value - expected.value) <= 0.05;
  });
}

export function evaluateExpectedContext(input: {
  answer: string;
  expectedTerms: string[];
  prompt?: string;
  sourceTexts?: string[];
}): ExpectedContextCheck[] {
  const answer = input.answer || "";
  const normalizedAnswer = normalize(answer);
  const source = normalize((input.sourceTexts || []).join("\n"));
  const prompt = normalize(input.prompt || "");
  const contextText = `${input.prompt || ""}\n${(input.sourceTexts || []).join("\n")}`;
  return (input.expectedTerms || []).map((rawTerm) => {
    const term = String(rawTerm || "").trim();
    const normalizedTerm = normalize(term);
    if (!term) return { term, status: "irrelevant", reason: "Empty expected term." };
    if (normalizedAnswer.includes(normalizedTerm) || numericCovered(answer, term)) {
      return { term, status: "covered", reason: "The answer contains the expected term or a numerically equivalent value." };
    }
    const synonym = SYNONYMS.find(([termPattern, answerPattern]) => termPattern.test(term) && answerPattern.test(answer));
    if (synonym) {
      return { term, status: "covered", reason: "The answer covers the expected context using an acceptable synonym or phrase." };
    }
    const synonymForTerm = SYNONYMS.find(([termPattern]) => termPattern.test(term));
    const contextHasTermOrSynonym =
      source.includes(normalizedTerm) ||
      prompt.includes(normalizedTerm) ||
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
