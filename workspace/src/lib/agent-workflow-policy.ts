export interface WorkflowPlanStepLike {
  action_type?: string;
}

const HOLD_PLAN_PATTERNS: RegExp[] = [
  /\bplan\s+only\b/i,
  /\bjust\s+(?:show|create|make|draft|outline)\s+(?:me\s+)?(?:a|the\s+)?plan\b/i,
  /\b(?:show|create|make|draft|outline)\s+(?:me\s+)?(?:a|the\s+)?plan\s+(?:only|first)\b/i,
  /\bdo\s+not\s+(?:run|execute|start|kick\s+off)\b/i,
  /\bdon'?t\s+(?:run|execute|start|kick\s+off)\b/i,
  /\bwithout\s+(?:running|executing|starting)\b/i,
  /\bwait\s+for\s+(?:my\s+)?approval\b/i,
  /\blet\s+me\s+(?:approve|review|edit)\s+(?:it|the\s+plan)\s+first\b/i,
];

const AUTONOMOUS_WORK_PATTERNS: RegExp[] = [
  /\b(?:run|execute|conduct|perform|complete|do)\b.*\b(?:analysis|assessment|evaluation|study|review|simulation|model|research|diligence)\b/i,
  /\b(?:full|comprehensive|complete|thorough|deep)\s+(?:analysis|assessment|evaluation|review|diligence|study)\b/i,
  /\bdue\s+diligence\b/i,
  /\btechno[\s-]?economic\b/i,
  /\b(?:simulate|model|calculate|compute|evaluate|analy[sz]e|assess|research|compare)\b/i,
  /\b(?:physics|economics?|environmental|permitting|risk|sensitivity|scenario|bankability|npv|irr|capex|opex)\b/i,
];

export function shouldAutoRunPlanForRequest(
  message: string | null | undefined,
  steps: WorkflowPlanStepLike[] | null | undefined,
): boolean {
  const executableSteps = (steps || []).filter((step) => step.action_type && step.action_type !== "synthesis");
  if (executableSteps.length === 0) return false;

  const text = (message || "").trim();
  if (!text) return executableSteps.length > 1;
  if (HOLD_PLAN_PATTERNS.some((pattern) => pattern.test(text))) return false;

  if (executableSteps.length >= 3) return true;
  return AUTONOMOUS_WORK_PATTERNS.some((pattern) => pattern.test(text));
}
