const EXPLICIT_SCENARIO_RE =
  /\b(re-?run|scenario|sensitivity|what[- ]if|counterfactual|changed? case|base case|prior run|previous run|reference case)\b/i;

const CHANGED_INPUT_RE =
  /\b(?:change|changed|set|switch|rerun|re-run|reduce|reduced|lower|lowered|increase|increased|raise|raised)\s+(?:only\s+)?(?:the\s+)?[a-z0-9_/%$ -]{1,80}\s+(?:to|from|by|at)\b/i;

const HELD_CONSTANT_RE =
  /\b(all other|everything else|hold(?:ing)?|held|keep|kept)\b.{0,80}\b(constant|unchanged|same|fixed)\b/i;

const ONLY_CHANGE_RE =
  /\b(?:only\s+(?:change|changes?|changed)|change\s+only|with\s+only\s+(?:one|two|[0-9]+)\s+changes?)\b/i;

const NON_SCENARIO_CHANGE_RE =
  /\b(?:emissions?|cost|operating[- ]cost|temperature|pressure|performance|efficiency|power|load|fuel|water)\s+change\b/i;

export function requiresScenarioReproducibilityPrompt(prompt: string): boolean {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (HELD_CONSTANT_RE.test(text) || ONLY_CHANGE_RE.test(text)) return true;
  if (CHANGED_INPUT_RE.test(text)) return true;
  if (EXPLICIT_SCENARIO_RE.test(text)) {
    if (/\b(base case|business case|use case|case study|project case|source case)\b/i.test(text) && !/\b(compare|against|versus|vs\.?|re-?run|scenario|sensitivity|changed? case|prior|previous|reference)\b/i.test(text)) {
      return false;
    }
    return true;
  }
  if (NON_SCENARIO_CHANGE_RE.test(text)) return false;
  return false;
}
