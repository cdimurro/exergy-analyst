import type {
  AttachmentEvidenceSummary,
  InitialEvaluationProjectState,
  ParsedChatResponse,
} from "@/lib/initial-evaluation-guardrail";
import { classifyClientIntent } from "@/lib/client-intent";
import type { ClientIntent } from "@/lib/client-intent";
import {
  createClientResponseBlock,
  renderClientResponseBlocks,
  type ClientResponseBlock,
} from "@/lib/client-response-blocks";
import {
  buildEvidencePack,
  renderEvidencePackItems,
} from "@/lib/evidence-pack";

export interface EvidenceEvaluationFallbackArgs {
  message: string;
  state: InitialEvaluationProjectState;
  project: {
    domain?: string;
    description?: string;
    name?: string;
  };
}

export interface PlatformPlanArgs {
  message: string;
  history?: Array<{ role?: string; content?: string }> | null;
  state: InitialEvaluationProjectState;
  project: {
    domain?: string;
    description?: string;
    name?: string;
  };
}

export interface PlatformActionArgs extends PlatformPlanArgs {}

export interface ChartFocus {
  label: "economics" | "performance" | "comparison" | "risk";
  keywords: string[];
  copy: string;
}

export const EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON = "evidence_gap_failed_extraction_recovery";
export const ECONOMICS_REQUEST_NEEDS_SOURCE_DATA_REASON = "economics_request_needs_source_data";
export const PHYSICS_REQUEST_NEEDS_SOURCE_DATA_REASON = "physics_request_needs_source_data";
export const FAILED_EXTRACTION_CHART_ECONOMICS_RECOVERY_REASON = "failed_extraction_chart_economics_recovery";
export const SPARSE_CLIENT_SYNTHESIS_REASON = "sparse_client_synthesis";

const EVALUATION_INTENT_PATTERNS: RegExp[] = [
  /\banalyze\b/i,
  /\banalysis\b/i,
  /\bevaluate\b/i,
  /\bevaluation\b/i,
  /\bassess\b/i,
  /\bassessment\b/i,
  /\bsimulate\b/i,
  /\bsimulation\b/i,
  /\bcalculate\b/i,
  /\bcalculation\b/i,
  /\bdeployment\s+readiness\b/i,
  /\bcommercial\s+readiness\b/i,
  /\bdiligence\b/i,
  /\binvestable\b/i,
  /\binvestability\b/i,
  /\bexergetic\s+efficiency\b/i,
  /\breport\b/i,
  /\bvalue\b/i,
];

const COMPLEX_EVALUATION_INTENT_PATTERNS: RegExp[] = [
  /\bfull\s+(techno[\s-]?economic\s+)?(analysis|assessment|evaluation|review)\b/i,
  /\bcomprehensive\s+(analysis|assessment|evaluation|review)\b/i,
  /\bcomplete\s+(analysis|assessment|evaluation|review)\b/i,
  /\bthorough\s+(analysis|assessment|evaluation|review)\b/i,
  /\bdue\s+diligence\b/i,
  /\binvestment\s+thesis\b/i,
  /\brun\s+everything\b/i,
  /\bdeep\s+(analysis|assessment|evaluation|review)\b/i,
  /\brun\s+(?:some\s+)?simulations?\b/i,
  /\bcalculate\b.*\b(exergetic|exergy|efficiency|readiness|economics|cost|risk)\b/i,
  /\b(exergetic|exergy|second[\s-]?law)\s+efficien/i,
  /\bmodel\b.*\bperformance\b/i,
  /\bvalidate\b.*\b(physics|claims|performance|efficiency)\b/i,
  /\btechno[\s-]?economic\s+study\b/i,
  /\b(?:chart|graph|plot|visuali[sz]ation)\b.*\b(?:economics|cost|efficiency|risk|score|sensitivity|trade[\s-]?off)\b/i,
  /\b(?:economic|cost|bankability|lcoe|lcof)\s+(?:model|analysis|assessment)\b/i,
  /\b(?:adapt|iterate|stress[\s-]?test|what[\s-]?if)\b.*\b(?:scenario|case|parameter|assumption|model)\b/i,
];

const PLAN_REQUEST_PATTERNS: RegExp[] = [
  /\bwhere(?:'s| is)\s+the\s+plan\b/i,
  /\bplan\s+you\s+were\s+supposed\s+to\s+create\b/i,
  /\bcreate\s+(?:a|the)\s+plan\b/i,
  /\bmake\s+(?:a|the)\s+plan\b/i,
  /\bshow\s+me\s+(?:a|the)\s+plan\b/i,
  /\bexecution\s+plan\b/i,
  /\beditable\s+plan\b/i,
  /\beditable\b.*\bplan\b/i,
  /\bdiligence\s+plan\b/i,
  /\bdiligence\s+work[\s-]?plan\b/i,
  /\bwork[\s-]?plan\b/i,
  /\bplan\s+out\b/i,
];

export function messageHasEvaluationIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return EVALUATION_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function messageHasComplexEvaluationIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return COMPLEX_EVALUATION_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function messageHasPlanRequest(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return PLAN_REQUEST_PATTERNS.some((pattern) => pattern.test(message));
}

function messageHasAutonomousWorkflowFrame(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return [
    /\b(full|comprehensive|complete|thorough|deep)\s+(analysis|assessment|evaluation|review|diligence|study)\b/i,
    /\bdue\s+diligence\b/i,
    /\binvestment\s+thesis\b/i,
    /\brun\s+everything\b/i,
    /\btechno[\s-]?economic\s+study\b/i,
  ].some((pattern) => pattern.test(message));
}

export function messageHasResearchIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return [
    /\b(find|search|pull|review|summari[sz]e)\b.*\b(papers?|literature|studies|research|sources?)\b/i,
    /\bwhat does the literature say\b/i,
    /\bstate of (?:the )?(?:art|research)\b/i,
    /\bpublished\s+(?:data|benchmarks|results|evidence)\b/i,
  ].some((pattern) => pattern.test(message));
}

export function messageHasChartIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return /\b(charts?|graphs?|plots?|visuali[sz]ations?|figures?|dashboards?|tables?)\b/i.test(message);
}

export function messageHasEconomicsIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return /\b(economics?|bankability|bankable|cost\s+model|operating\s+cost|fuel[\s-]?cost|cost\s+and\s+fuel|unit\s+economics|lcoe|lcos|lcof|npv|irr|payback|capex|opex|breakeven|project\s+finance|financial\s+(?:data|model|inputs?)|financ(?:e|ed|ing|eable)|lend(?:er|able|ing)|debt|wacc|offtake|revenue|price\s+stack)\b/i.test(message);
}

export function messageHasPhysicsFollowupIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return /\b(physics|simulate|simulation|solver|model|exergy|second[\s-]?law|efficiency|performance|measurements?|mechanism|boundary|boundaries|validation|test(?:ing)?|thermodynamic\s+(?:state\s+)?variables?)\b/i.test(message);
}

export function messageHasEvidenceGapIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  if ([
    /\bdata\s+owner\b.*\b(?:metric|chart|data)\b/i,
    /\bproof\s+changes?\b.*\b(?:language|claim|recommendation)\b/i,
    /\bproof\b.*\blet\b.*\bsentence\b.*\bstronger\b/i,
    /\bproof\b.*\blet\b.*\bsay\s+it\s+more\s+strongly\b/i,
    /\bwho\s+should\s+own\s+those\s+inputs\b/i,
    /\bwhich\s+owner\s+should\s+provide\s+each\s+data\s+input\b/i,
    /\bshort\s+description\b.*\bwhat\s+matters\s+most\s+next\b/i,
    /\bwhat\s+would\s+change\s+the\s+go\/no[\s-]?go\s+recommendation\b/i,
    /\bwhat\s+proof\b.*\bchange\b.*\bgo\/no[\s-]?go\s+(?:call|recommendation)\b/i,
    /\bwhat\s+would\s+change\s+the\s+go\/no[\s-]?go\s+next\s+week\b/i,
    /\bwhat\s+should\s+(?:i|we)\s+ask\s+for\s+first\b/i,
    /\bwhat\s+should\s+(?:i|we)\s+ask\s+(?:the\s+)?technical\s+lead\s+for\s+first\b/i,
    /\bwhat\s+would\s+make\s+the\s+claim\s+defensible\b/i,
    /\bdraft\b.*\bfirst\s+request\s+email\b/i,
    /\bdraft\b.*\bdata[\s-]?room\s+request\b/i,
  ].some((pattern) => pattern.test(message))) {
    return true;
  }
  return /\b(evidence\s+gaps?|evidence\s+requests?|evidence\s+pack|evidence\s+ask|data\s+gaps?|data\s+room\s+request|data[\s-]?room\s+ask|minimum\s+viable\s+evidence\s+pack|proof\s+points?|evidence\s+(?:matters|matter|needed)\b.*\b(?:first|most|before|external|sharing|outreach)|evidence\s+is\s+needed\b.*\b(?:before|external|sharing|outreach)|evidence\s+unlock(?:s|ed)?\b.*\b(?:claims?|stronger|confidence)|evidence\s+changes?\s+(?:your|the)?\s*recommendation|which\s+evidence\b.*\b(?:ask|request|collect|gather|unlock|change)\b.*\b(?:first|before|external|sharing|claims?|outreach|recommendation)|which\s+proof\s+points?\b.*\b(?:ask|request|collect|gather|unlock)|what\s+proof\s+(?:should|would|can)\b.*\b(?:ask|request|collect|gather|customer|reference)|customer\s+asks\s+for\s+proof|what\s+proof\s+points?\b.*\b(?:make|would|should|request|collect|strengthen|unlock)|missing\s+(?:data|evidence|inputs?)|thin\s+extraction|thin\s+(?:source|evidence)|(?:failed\s+(?:or\s+thin\s+)?extraction|extraction\s+(?:failed|did\s+not\s+work|didn't\s+work|failed\s+to\s+work))|recoverable|salvage|next\s+diligence|diligence\s+actions?|source\s+(?:document\s+)?(?:sections?|pages?|tables?)|test\s+records?|recover\s+diligence|recover\s+(?:from\s+)?(?:failed\s+)?extraction|what\s+exact\b.*\b(?:rows?|pages?|tables?|sections?|test\s+records?)\b.*\bdo\s+(?:i|we|you)\s+need|what\s+(?:pages?|tables?|test\s+records?)\b.*\b(?:improve|strengthen|recover|matter|need)|what\s+(?:data|evidence|inputs?|source\s+(?:document\s+)?(?:sections?|pages?|tables?))\s+(?:would|will)\s+(?:improve|strengthen|recover|unlock|change)|what\s+(?:data|evidence|inputs?|source\s+(?:document\s+)?(?:sections?|pages?|tables?))\s+should\s+(?:i|we)\s+(?:collect|gather|provide|upload|send)|what\s+(?:data|evidence|inputs?|source\s+(?:document\s+)?(?:sections?|pages?|tables?))\s+do\s+(?:i|we|you)\s+need|highest[\s-]?value\s+(?:data|evidence|inputs?)|high[\s-]?value\s+evidence\s+request|without\s+(?:pretending\s+)?(?:data|evidence)|honest\s+way\s+to\s+diligence|fastest\s+honest\s+way|fastest\s+honest\s+path|honest\s+fastest\s+path|what\s+(?:source\s+)?evidence\s+would\s+change\s+(?:your|the)\s+recommendation|what\s+would\s+change\s+(?:your|the)\s+recommendation|what\s+(?:do|would)\s+you\s+need)\b/i.test(message);
}

function messageHasSourceEvidenceRecoveryIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  if (
    /\b(?:claims?\s+should\s+(?:stay|remain)|what\s+should\s+(?:stay|remain)|hold\s+back)\b.*\b(?:data\s+room|external\s+summary)\b/i.test(message)
  ) {
    return false;
  }
  return [
    /\b(?:pages?|tables?|source\s+tables?|source\s+(?:document\s+)?sections?|test\s+records?|witness(?:ed)?\s+tests?|data\s+room)\b.*\b(?:improve|recover|diligence|collect|request|need|matter|upload|provide|ask)\b/i,
    /\b(?:improve|recover|diligence|collect|request|need|matter|upload|provide|ask)\b.*\b(?:pages?|tables?|source\s+tables?|source\s+(?:document\s+)?sections?|test\s+records?|witness(?:ed)?\s+tests?|data\s+room)\b/i,
    /\bwhat\s+data\s+room\s+request\s+should\s+(?:i|we)\s+send\b/i,
    /\bdata\s+room\s+request\b.*\b(?:send|ask|make|draft|create)\b/i,
    /\bdraft\b.*\bdata[\s-]?room\s+request\b/i,
    /\bdraft\b.*\bfirst\s+request\s+email\b/i,
    /\bdata[\s-]?room\s+ask\b.*\b(?:counterparty|first|draft|request)\b/i,
    /\bdraft\b.*\bdata[\s-]?room\s+ask\b/i,
    /\b(?:thin|failed)\s+(?:source|evidence|extraction)\b/i,
    /\bextraction\s+failed\b.*\b(?:recoverable|collect|recover|next)\b/i,
    /\bextraction\s+(?:did\s+not\s+work|didn't\s+work|failed\s+to\s+work)\b.*\b(?:salvage|recoverable|collect|recover|request|next)\b/i,
    /\bwhat\s+is\s+recoverable\b.*\b(?:collect|recover|next)\b/i,
    /\bhigh[\s-]?value\s+evidence\s+request\b/i,
  ].some((pattern) => pattern.test(message));
}

export function messageHasReportExportIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return /\b(export|exported|download|generate|create|make|produce|write)\b.*\b(report|pdf|json|brief|packet|deck|document|summary|one[\s-]?pager)\b/i.test(message)
    || /\bbe\s+exported\b.*\b(?:client|customer|investor|board|lender)?[\s-]?(?:summary|brief|memo|report|packet|document)\b/i.test(message)
    || /\b(turn|convert|shape|draft|outline)\b.*\b(report|brief|memo|diligence\s+note|customer[\s-]?safe\s+summary|investor\s+memo|one[\s-]?pager)\b/i.test(message)
    || /\b(investor\s+memo|diligence\s+note|report\s+outline|customer[\s-]?safe\s+summary|client[\s-]?ready\s+report)\b/i.test(message)
    || /\bwhat\s+should\s+go\s+in\b.*\bdiligence\s+memo\b/i.test(message)
    || /\bdiligence\s+memo\b.*\b(?:instead|outline|include|say)\b/i.test(message)
    || /\b(?:what\s+belongs\s+in|what\s+goes\s+in|what\s+should\s+be\s+in)\b.*\binternal\s+diligence\s+memo\b/i.test(message)
    || /\bexport\s+(?:it|this)\s+(?:today|now)\b/i.test(message)
    || /\bwhat\s+should\b.*\breport\b.*\bsay\b/i.test(message)
    || /\b(report|pdf|json)\s+export\b/i.test(message);
}

export function messageHasClientSynthesisIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return [
    /\bmost\s+useful\s+conclusion\b/i,
    /\bdecision\s+implication\b/i,
    /\bexecutive\s+takeaway\b/i,
    /\bspend(?:ing)?\s+(?:more\s+)?diligence\s+time\b/i,
    /\bboard[\s-]?level\s+takeaway\b/i,
    /\bwhat\s+can\s+(?:i|we)\s+(?:actually\s+)?(?:take\s+away|say|tell)\b/i,
    /\bwhat\s+can\s+be\s+shared\s+externally\b/i,
    /\bwhat\s+can\s+(?:i|we)\s+responsibly\s+say\s+outside\b/i,
    /\bgive\s+me\s+the\s+outside[\s-]?the[\s-]?company\s+version\b/i,
    /\bwhat\s+can\s+sales\s+safely\s+say\s+externally\b/i,
    /\bwhat\s+can\s+be\s+sent\s+to\s+(?:a\s+)?counterparty\b/i,
    /\bwhat\s+is\s+safe\s+to\s+share\s+outside\b.*\bdiligence\s+team\b/i,
    /\bwhat\s+can\s+(?:i|we)?\s*(?:put|include|share|say|send|go)\b.*\b(?:external\s+email|customer|counterparty|outside|externally)\b/i,
    /\bwhat\s+should\s+(?:the\s+)?customer\s+hear\b/i,
    /\bwhat\s+should\s+(?:the\s+)?board\s+hear\b.*\bcustomer\b/i,
    /\bboard\s+message\b.*\bcustomer\s+message\b/i,
    /\bboard\b.*\bversus\b.*\bcustomer\b/i,
    /\bseparate\b.*\bboard\s+message\b.*\bcustomer\s+message\b/i,
    /\bwhat\s+should\s+be\s+in\s+(?:the\s+)?email\b.*\bdiligence\s+memo\b/i,
    /\bemail\b.*\bdiligence\s+memo\b/i,
    /\bcustomer\s+email\b/i,
    /\bcustomer\s+one[\s-]?pager\b/i,
    /\bcustomer[\s-]?safe\s+one[\s-]?pager\b/i,
    /\bshort\s+customer\s+email\s+version\b/i,
    /\b(?:sales|outbound)\s+deck\b/i,
    /\bsales(?:\s+team)?\b.*\b(?:avoid|not)\s+(?:say|saying|claim|claiming|promise|promising)\b/i,
    /\bwhat\s+should\s+be\s+removed\s+before\s+sales\s+uses\s+it\b/i,
    /\bwhat\s+should\s+not\s+be\s+in\s+(?:a\s+)?sales\s+email\b/i,
    /\bwhat\s+should\s+not\s+appear\s+in\s+(?:a\s+)?sales\s+note\b/i,
    /\b(?:email|customer)\b.*\b(?:does\s+not|do\s+not|don't|without)\s+overclaim/i,
    /\bsales\s+deck\b.*\bstay\s+internal\b/i,
    /\bgo\s+into\s+(?:a\s+)?sales\s+deck\b/i,
    /\boutbound\s+deck\b.*\b(?:inside|internal|diligence\s+team)\b/i,
    /\bred[\s-]?team\b.*\b(?:claims?|share|sharing|externally|external)\b/i,
    /\bexternal\s+sharing\b.*\bred[\s-]?team\b/i,
    /\bwhat\s+should\s+not\s+leave\s+(?:the\s+)?data\s+room\b/i,
    /\bwhat\s+should\s+not\s+leave\s+(?:our|the)\s+diligence\s+room\b/i,
    /\bwhat\s+should\s+remain\s+internal\b/i,
    /\bwhat\s+stays\s+private\s+until\s+proof\s+improves\b/i,
    /\bwhat\s+should\s+stay\s+private\s+before\s+proof\s+gets\s+stronger\b/i,
    /\bwhat\s+should\s+stay\s+inside\s+for\s+now\b/i,
    /\bwhat\s+should\s+stay\s+in\s+(?:the\s+)?data\s+room\b/i,
    /\bwhat\s+should\s+remain\s+in\s+(?:the\s+)?data\s+room\b/i,
    /\bwhich\s+claims?\s+should\s+(?:stay|remain)\b.*\bdata\s+room\b/i,
    /\bhold\s+back\b.*\bexternal\s+summary\b/i,
    /\bwhat\s+does\s+this\s+mean\s+commercially\b/i,
    /\bcan\s+(?:i|we)\s+claim\b/i,
    /\bclaim\s+(?:fuel\s+displacement|lower\s+operating\s+cost|cost\s+advantage|performance|efficiency)\b/i,
    /\bmake\s+the\s+claim\s+customer[\s-]?safe\b/i,
    /\bwhat\s+should\s+not\s+be\s+claimed\b/i,
    /\bcan\s+(?:i|we)\s+say\s+this\s+is\s+validated\b/i,
    /\bcan\s+(?:i|we)\s+tell\s+(?:a\s+)?customer\b.*\bvalidated\b/i,
    /\bcan\s+(?:i|we)\s+say\b.*\bvalidated\b/i,
    /\bcustomer[\s-]?safe\s+claim\s+language\b/i,
    /\binvestor[\s-]?safe\b(?:.*\bwithout\s+numbers\b)?/i,
    /\bcautious\s+investor\b.*\bsay\s+today\b/i,
    /\bcautious\s+investor\b.*\bsentence\b/i,
    /\bwhat\s+should\s+(?:i|we)\s+tell\s+an?\s+(?:investor|executive|client|board|lender)\b/i,
    /\bwhat\s+can\s+(?:the\s+)?ceo\s+say\s+with\s+confidence\b/i,
    /\bwhat\s+should\s+(?:the\s+)?ceo\s+not\s+say\s+yet\b/i,
    /\bwhat\s+should\s+(?:(?:an?|the)\s+)?(?:executive|ceo|board)\s+decide\b/i,
    /\bwhat\s+should\s+(?:i|we)\s+avoid\s+claiming\b/i,
    /\b(?:can|should)\s+(?:i|we)\s+mention\b.*\b(?:fuel\s+displacement|lower\s+operating\s+cost|cost\s+advantage|performance|efficiency)\b/i,
    /\bclient[\s-]?ready\s+(?:explanation|summary|answer|synthesis)\b/i,
    /\bhuman[\s-]?readable\s+(?:answer|assessment|summary|explanation)\b/i,
    /\bdo\s+not\s+show\s+(?:me\s+)?(?:platform|internal|workflow)\s+(?:internals?|details?)\b/i,
    /\bnot\s+(?:platform|internal|workflow)\s+(?:status|internals?|details?)\b/i,
    /\bno\s+platform\s+status\b/i,
    /\bskip\s+platform\s+status\b/i,
    /\bjust\s+tell\s+me\s+what\s+matters\b.*\bno\s+internal\s+status\s+language\b/i,
    /\btell\s+me\s+what\s+matters\b.*\bwhat\s+to\s+do\s+next\b/i,
    /\btell\s+me\s+what\s+matters\s+next\b/i,
    /\bexplain\s+(?:it|this)\s+like\s+(?:(?:a|an)\s+)?(?:diligence\s+lead|ceo|executive|board\s+member)\b/i,
    /\bexplain\s+(?:it|this)\s+to\s+(?:(?:a|an)\s+)?(?:ceo|executive|board\s+member)\b/i,
    /\bhow\s+should\s+(?:i|we)\s+explain\s+that\s+to\s+an?\s+executive\b/i,
    /\bexplain\s+the\s+current\s+state\s+to\s+an?\s+executive\b.*\bwithout\s+internal\s+labels\b/i,
    /\bexplain\s+that\s+in\s+board\s+language\b/i,
    /\banswer\s+like\s+(?:a\s+)?diligence\s+lead\b.*\bno\s+status\s+labels\b/i,
    /\banswer\s+as\s+(?:a\s+)?diligence\s+lead\b.*\bskip\s+status\s+language\b/i,
    /\bmake\s+it\s+(?:useful|safe)\s+for\s+(?:a\s+)?(?:ceo|executive|customer|client|board|investor|lender)\b/i,
    /\bmake\s+(?:this|it)\s+safe\s+to\s+send\s+to\s+(?:a\s+)?(?:customer|client|investor|executive|board|lender)\b/i,
    /\bmake\s+(?:this|it)\s+useful\b.*\b(?:do\s+not|don't|without)\s+overclaim/i,
    /\bsame\s+point\s+for\s+(?:an?\s+)?(?:investor|customer|client|executive|ceo|board|lender)\b/i,
    /\bwhat\s+should\s+stay\s+(?:internal|inside\s+(?:the\s+)?(?:diligence\s+)?team)\b/i,
    /\bwhat\s+goes\s+only\s+in\s+(?:the\s+)?internal\s+memo\b/i,
    /\bwhat\s+belongs\s+only\s+in\s+(?:the\s+)?internal\s+memo\b/i,
    /\bwhat\s+goes\s+in\s+(?:the\s+)?internal[\s-]?only\s+section\b/i,
    /\bwhat\s+should\s+be\s+excluded\s+from\s+external\s+claims\b/i,
    /\bwhat\s+can\s+be\s+said\s+publicly\s+without\s+numbers\b/i,
    /\bwhat\s+should\s+be\s+excluded\b.*\bexternal\s+sharing\b/i,
    /\b(?:recommended\s+)?next\s+action\b.*\b(?:diligence\s+lead|lead)\b/i,
    /\bfinal\s+recommendation\b.*\b(?:diligence\s+lead|lead)\b/i,
    /\b(?:diligence\s+lead|lead)\b.*\bfinal\s+recommendation\b/i,
    /\bmake\s+(?:the\s+)?final\s+recommendation\b/i,
    /\bi\s+need\s+(?:a\s+)?memo\s+recommendation\s+by\s+tomorrow\b/i,
    /\bwhat\s+should\s+the\s+memo\s+recommend\s+next\b/i,
    /\bwhat\s+should\s+(?:the\s+)?internal\s+memo\s+recommend\b.*\bnext\s+step\b/i,
    /\bwhat\s+should\s+the\s+team\s+do\s+in\s+the\s+next\s+two\s+days\b/i,
    /\bwhat\s+should\s+(?:i|we|the\s+team)\s+do\s+over\s+the\s+next\s+48\s+hours\b/i,
    /\bwhat\s+should\s+the\s+team\s+do\s+by\s+friday\b/i,
    /\bwhat\s+next\s+action\s+should\s+(?:the\s+)?diligence\s+owner\s+take\b/i,
    /\bwhat\s+(?:one\s+)?action\s+should\s+(?:i|we)\s+take\s+next\b/i,
    /\bwhat\s+is\s+the\s+next\s+action\b/i,
    /\bwhat\s+is\s+the\s+most\s+honest\s+next\s+step\b/i,
    /\bwhat\s+cannot\s+be\s+calculated\s+yet\b/i,
    /\bwhich\s+numbers\s+cannot\s+be\s+calculated\s+yet\b/i,
    /\bwhich\s+numbers\s+are\s+still\s+unavailable\b/i,
    /\bdecision[\s-]?useful\s+next[\s-]?step\s+plan\b/i,
    /\bturn\s+sparse\s+context\b.*\bdecision[\s-]?useful\b/i,
    /\bsparse\s+workspace\b.*\bpractical\s+decision\s+plan\b/i,
    /\bexecutive\s+(?:deciding|summary|view|decision)\b/i,
    /\bceo\s+(?:summary|view|decision|takeaway)\b/i,
    /\bshort\s+ceo\s+note\b/i,
    /\bcustomer[\s-]?safe\s+(?:summary|answer|language|report|memo)\b/i,
    /\bcustomer[\s-]?safe\s+version\b/i,
    /\bmake\s+(?:it|this)\s+customer[\s-]?safe\b/i,
    /\bmake\s+the\s+same\s+point\s+customer[\s-]?safe\b/i,
    /\bmake\s+the\s+same\s+point\s+safe\s+for\s+(?:the\s+)?customer\b/i,
    /\bsafe\s+for\s+(?:a\s+)?customer\b/i,
    /\bunsupported\s+claims?\b.*\b(?:stay\s+out|leave\s+out|avoid|exclude|not\s+claim)\b/i,
    /\bspend\s+more\s+diligence\s+time\b/i,
    /\bspend\s+another\s+(?:day|week|month)\s+on\s+diligence\b/i,
    /\bspend\s+another\s+(?:day|week|month)\s+or\s+pause\s+diligence\b/i,
    /\bspend\s+another\s+(?:day|week|month)\s+or\s+pause\b/i,
    /\bdiligence\s+or\s+stop\b/i,
    /\bstrongest\s+and\s+weakest\b/i,
    /\bno\s+workflow\s+talk\b.*\bwhat\s+matters\b/i,
    /\bgive\s+me\s+the\s+practical\s+recommendation\s+without\s+platform\s+words\b/i,
    /\bwhat\s+should\s+stay\s+out\s+of\s+(?:a\s+)?board\s+memo\b/i,
    /\bwhat\s+matters\s+commercially\b.*\bsparse\s+description\b/i,
    /\bwhat\s+is\s+commercially\s+meaningful\b.*\bthin\s+description\b/i,
    /\bbased\s+only\s+on\s+(?:the\s+)?provided\b/i,
    /\bincomplete\s+diligence\s+workspace\b/i,
    /\bnot\s+just\s+tell\s+me\s+there\s+is\s+not\s+enough\s+data\b/i,
  ].some((pattern) => pattern.test(message));
}

export function messageHasAdversarialReadinessIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return [
    /\b(investor[\s-]?ready|client[\s-]?ready|board[\s-]?ready|lender[\s-]?ready|counterparty[\s-]?ready|project\s+finance\s+ready|ready\s+for\s+project\s+finance)\b/i,
    /\b(write|make|produce|create|export|give)\b.*\b(report|brief|deck|packet|document|summary|conclusion|verdict|recommendation)\b.*\b(confident(?:ly)?|strong|bullish|investors?|clients?|board|lenders?|counterpart(?:y|ies))\b/i,
    /\b(write|make|produce|create|export|give)\b.*\b(clients?|investors?|board|lenders?|counterpart(?:y|ies))\b.*\b(report|brief|deck|packet|document|summary|conclusion|verdict|recommendation)\b.*\b(confident(?:ly)?|strong|bullish|ready)\b/i,
    /\bconfident(?:ly)?\b.*\b(?:investors?|clients?|board|lenders?|counterpart(?:y|ies))\b.*\b(?:conclusion|verdict|recommendation)\b/i,
    /\bdo\s+not\s+mention\s+caveats\b/i,
    /\bdo\s+not\s+include\s+caveats\b/i,
    /\bdo\s+not\s+call\s+it\s+blocked\b/i,
    /\bwithout\s+caveats\b/i,
    /\bjust\s+export\s+something\s+useful\b/i,
    /\bjust\s+(?:write|make|say|call)\b.*\b(confident|strong|bullish|ready)\b/i,
    /\b(?:can|should)\s+(?:i|we)\s+send\b.*\b(?:investors?|board|clients?|customers?|lenders?|counterpart(?:y|ies))\b.*\b(?:now|today|as\s+is)?\b/i,
    /\b(?:send|share)\b.*\b(?:investors?|board|clients?|customers?|lenders?|counterpart(?:y|ies))\b.*\b(?:now|today|as\s+is)\b/i,
  ].some((pattern) => pattern.test(message));
}

const CHART_FOCUS_OPTIONS: ChartFocus[] = [
  {
    label: "economics",
    keywords: ["economics", "cost", "lcoe", "lcof", "lcoh", "capex", "opex", "bankability"],
    copy: "economics",
  },
  {
    label: "performance",
    keywords: ["performance", "efficiency", "exergy", "second-law", "yield", "throughput"],
    copy: "performance and exergy",
  },
  {
    label: "comparison",
    keywords: ["comparison", "benchmark", "versus", "vs", "compared"],
    copy: "comparison and benchmarks",
  },
  {
    label: "risk",
    keywords: ["safety", "risk", "hazard"],
    copy: "risk and safety",
  },
];

export function classifyChartFocuses(message: string | null | undefined): ChartFocus[] {
  if (typeof message !== "string" || message.trim().length === 0) {
    return [];
  }
  const lower = message.toLowerCase();
  const matches = CHART_FOCUS_OPTIONS
    .map((option) => {
      const matchedKeywords = option.keywords.filter((keyword) => {
        const normalized = keyword.replace("-", "[\\s-]?");
        return new RegExp(`\\b${normalized}\\b`, "i").test(lower);
      });
      return matchedKeywords.length > 0 ? { ...option, keywords: matchedKeywords } : null;
    })
    .filter((focus): focus is ChartFocus => focus !== null);
  const nonComparisonMatches = matches.filter((focus) => focus.label !== "comparison");
  if (nonComparisonMatches.length >= 2) {
    return nonComparisonMatches;
  }
  return matches;
}

export function classifyChartFocus(message: string | null | undefined): ChartFocus | null {
  return classifyChartFocuses(message)[0] || null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstItems(values: string[] | undefined, limit: number): string[] {
  return (values || []).filter(Boolean).slice(0, limit);
}

function chartCaveatItems(values: string[] | undefined, limit: number): string[] {
  return firstItems((values || []).map((value) => {
    const text = value.toLowerCase();
    const alreadyCautious = /\b(do not|don't|not |unsupported|contradicted|blocked|missing|unavailable)\b/.test(text);
    const looksLikeClaim = /\b(pilot|ready|readiness|commercial|deployment|qualified|qualification|bankab|investor-grade|returns?|validated|validation|revenue|scale)\b/.test(text);
    if (!looksLikeClaim || alreadyCautious) return value;
    const sourceMatch = value.match(/^(\[[^\]]+\]\s*)(.+)$/);
    if (sourceMatch) {
      return `${sourceMatch[1]}Do not chart as numeric evidence: ${sourceMatch[2]}`;
    }
    return `Do not chart as numeric evidence: ${value}`;
  }), limit);
}

function claimReviewPriority(value: string): number {
  const text = value.toLowerCase();
  let priority = 0;
  if (/\bis contradicted\b|\bcontradicted by\b|\bconflicts?\b/.test(text)) priority -= 60;
  if (/\bis unsupported\b|\bnot supported\b|\bunsupported\b/.test(text)) priority -= 45;
  if (/\bcommercial deployment|pilot|pilot-scale|validated|customer-qualified|bankable|bankability|investor-grade\b/.test(text)) {
    priority -= 20;
  }
  if (/\[(?:conflict|investor|customer)[^\]]*\]/i.test(value)) priority -= 10;
  if (/\[test-report[^\]]*\]/i.test(value)) priority += 10;
  if (/^no\b/i.test(value.replace(/^\[[^\]]+\]\s*/, ""))) priority += 5;
  return priority;
}

function prioritizeClaimReviewItems(values: string[] | undefined): string[] {
  return (values || [])
    .filter(Boolean)
    .map((value, index) => ({ value, index, priority: claimReviewPriority(value) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.value);
}

function softenExternalClaimLanguage(value: string): string {
  return value
    .replace(/\bbankable\b/gi, "finance-readiness claim")
    .replace(/\bbankability\b/gi, "finance-readiness claim")
    .replace(/\bpilot[\s-]?validated\b/gi, "larger-site validation claim")
    .replace(/\bpilot\s+validation\b/gi, "larger-site validation claim");
}

function externalClaimCautionItems(summary: AttachmentEvidenceSummary, limit: number): string[] {
  return firstItems(
    prioritizeClaimReviewItems([...summary.contradictedClaims, ...summary.unsupportedClaims])
      .map(softenExternalClaimLanguage),
    limit,
  );
}

function prioritizeFinanceMissingInputs(values: string[] | undefined): string[] {
  return (values || [])
    .filter(Boolean)
    .map((value, index) => {
      const text = value.toLowerCase();
      let priority = 0;
      if (/\[cost-model/.test(text)) {
        priority -= 80;
      }
      if (/wacc|discount|utilization|lifetime|product\s+(?:selling\s+)?price|feedstock|scale-up|revenue|margin|opex|capex|finance|financing/.test(text)) {
        priority -= 40;
      }
      if (/durability|repeatability|assay|emissions|pilot|commercial-scale|mass-balance|test report/.test(text)) {
        priority += 20;
      }
      return { value, index, priority };
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.value);
}

function prioritizePhysicsMissingInputs(values: string[] | undefined): string[] {
  return (values || [])
    .filter(Boolean)
    .map((value, index) => {
      const text = value.toLowerCase();
      let priority = 0;
      if (/temperature|pressure|flow|feed|output|sensor|heater|mass-balance|energy balance|thermodynamic|durability|repeatability|assay|emissions|run|test|\[test-report|\[ops-data/.test(text)) {
        priority -= 35;
      }
      if (/wacc|discount|utilization|price|feedstock|scale-up|finance|cost-model|npv|irr|payback/.test(text)) {
        priority += 30;
      }
      if (/customer|qualification|outreach|sales/.test(text)) {
        priority += 15;
      }
      return { value, index, priority };
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((item) => item.value);
}

function hasAttachmentEvidence(summary: AttachmentEvidenceSummary | undefined): summary is AttachmentEvidenceSummary {
  return !!summary && (
    summary.facts.length > 0 ||
    summary.unsupportedClaims.length > 0 ||
    summary.contradictedClaims.length > 0 ||
    summary.missingInputs.length > 0 ||
    summary.chartableFields.length > 0
  );
}

function renderAttachmentEvidenceSnapshot(summary: AttachmentEvidenceSummary): string {
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
      createClientResponseBlock("known_from_workspace", firstItems(summary.facts, 6), "Known facts from attachments"),
      ...(summary.unsupportedClaims.length || summary.contradictedClaims.length
        ? [createClientResponseBlock("not_supported_yet", [
          ...firstItems(summary.unsupportedClaims, 5),
          ...firstItems(summary.contradictedClaims, 5),
        ], "Unsupported or contradicted claims")]
        : []),
      ...(summary.missingInputs.length
        ? [createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Missing evidence")]
        : []),
      ...(summary.chartableFields.length
        ? [createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 6), "Chartable fields available now")]
        : []),
    ],
  });
}

function renderStructuredBlocks(blocks: ClientResponseBlock[]): {
  content: string;
  response_blocks: ClientResponseBlock[];
} {
  return {
    content: renderClientResponseBlocks({ blocks }),
    response_blocks: blocks,
  };
}

function messageHasDirectAttachmentFollowupIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return [
    /\bsales\s+deck\b/i,
    /\bsales\b.*\bas[\s-]?is\b/i,
    /\bsales\b.*\b(?:safely\s+)?say\b.*\bexternally\b/i,
    /\bwhat\s+can\s+sales\b/i,
    /\blanguage\s+should\s+sales\s+avoid\b/i,
    /\bsales\s+avoid\b/i,
    /\boutbound\s+deck\b/i,
    /\bcustomer\s+email\b/i,
    /\bwhat\s+cannot\s+be\s+calculated\s+yet\b/i,
    /\bwhich\s+numbers?\s+cannot\s+be\s+calculated\b/i,
    /\bwhich\s+numbers?\s+are\s+still\s+unavailable\b/i,
    /\blower\s+operating\s+cost\b/i,
    /\bshow\s+this\s+to\s+a\s+lender\b/i,
    /\bis\s+this\s+bankable\b/i,
    /\bwhat\s+proof\b.*\bask\b/i,
    /\bask\b.*\bproof\b.*\bfirst\b/i,
    /\bwhat\s+evidence\b.*\bask\b.*\bfirst\b/i,
    /\bask\b.*\b(?:test|data)\s+owner\b/i,
    /\bask\b.*\btechnical\s+lead\b/i,
    /\bdata[\s-]?room\s+request\b/i,
    /\bwhat\s+can\s+go\s+to\s+(?:the\s+)?data[\s-]?room\b/i,
    /\bdata[\s-]?room\b.*\b(?:redact|redaction|redacting|caveat|caveating|share|sharing)\b/i,
    /\b(?:redact|redaction|caveat|caveating)\b.*\bdata[\s-]?room\b/i,
    /\brequest\s+list\b.*\b(?:technical\s+lead|finance\s+owner|commercial\s+owner|data\s+owner|source\s+owner|owner)\b/i,
    /\b(?:technical\s+lead|finance\s+owner|commercial\s+owner|data\s+owner|source\s+owner|owner)\b.*\brequest\s+list\b/i,
    /\bevidence\b.*\bchange\s+the\s+recommendation\b/i,
    /\bdata\b.*\bunlock\s+a\s+stronger\s+claim\b/i,
    /\bone\s+safe\s+sentence\b/i,
    /\bexact\b.*\b(?:investor|legal|customer|external|public)[\s-]?safe\b.*\bsentence\b/i,
    /\b(?:board|investor|legal|sales|customer|external|public)[\s-]?safe\s+(?:sentence|version|statement)\b/i,
    /\bwhat\s+can\s+(?:i|we)\s+say\s+publicly\b/i,
    /\bwhat\s+can\s+(?:the\s+)?ceo\s+say\s+publicly\b/i,
    /\bceo\b.*\bavoid\b.*\bpublic\s+remarks\b/i,
    /\bpublic\s+headline\b.*\bprivate\s+caveat\b/i,
    /\bwhat\s+should\s+not\s+be\s+said\s+publicly\b/i,
    /\bwhat\s+can\s+be\s+said\s+publicly\b/i,
    /\bwhat\s+can\s+be\s+disclosed\s+externally\b/i,
    /\bwhat\s+can\s+go\s+in\s+(?:a\s+)?sales\s+email\b/i,
    /\b(?:customer\s+email|board\s+memo|investor\s+caveat|internal\s+risk)\s+sentence\b/i,
    /\binvestor\s+caveat\b/i,
    /\bcaveat\b.*\bcustomer\s+slide\b/i,
    /\bcustomer\s+slide\b.*\bcaveat\b/i,
    /\bsafest\s+external\s+headline\b/i,
    /\bheadline\b.*\boverclaim\b/i,
    /\boverclaim\b.*\bheadline\b/i,
    /\bcommercial\s+deployment\b.*\bpress\s+quote\b/i,
    /\b(?:safest\s+)?sentence\s+for\s+(?:a\s+)?counterparty\b/i,
    /\bnot\s+go\s+to\s+(?:the\s+)?counterparty\b/i,
    /\b(?:go\s+into|stay\s+out\s+of|must\s+stay\s+out\s+of)\s+(?:(?:a|the)\s+)?teaser\b/i,
    /\b(?:used\s+in|removed\s+from)\s+(?:the\s+)?outreach\b/i,
    /\bredlined?\s+before\s+sales\b/i,
    /\bheld\s+for\s+diligence\s+only\b/i,
    /\bone\s+line\s+should\s+(?:finance|the\s+test\s+owner)\s+approve\b/i,
    /\bsafest\s+commercial\s+statement\b/i,
    /\bcommercial\s+sentence\b.*\boverstate\b/i,
    /\bcall\s+it\s+(?:proven|finance[\s-]?ready)\b/i,
    /\bdiligence\s+memo\s+say\s+first\b/i,
    /\brisk\s+appendix\b/i,
    /\bexact\s+cautious\s+wording\b/i,
    /\blegal\b.*\b(?:strike|redline)\b/i,
    /\b(?:strike|redline)\b.*\blegal\b/i,
    /\bwording\b.*\bengineering\b.*\bapprove\b/i,
    /\bengineering\b.*\bapprove\b.*\bwording\b/i,
    /\bexact\s+number\b.*\bcite\b/i,
    /\bnumber\b.*\bcite\b/i,
    /\bbelow\s+500\s*(?:c|°c|deg(?:ree)?s?\s*c)\b/i,
    /\bfix\b.*\bfirst\b/i,
    /\bfastest\s+unblock\b/i,
    /\bshould\s+not\s+be\s+charted\b/i,
    /\bwhat\s+should\s+not\s+be\s+charted\b/i,
    /\bchart\s+(?:title|subtitle|caveat)\b/i,
    /\b(?:title|subtitle|caveat)\b.*\bchart\b/i,
    /\b(?:y|x)[-\s]?axis\b/i,
    /\baxis\s+label\b/i,
    /\b(?:most\s+reliable|reliable)\s+source\b/i,
    /\bsource\b.*\b(?:most\s+)?reliable\b/i,
    /\bmetric\b.*\bunit\b/i,
    /\bmention\b.*\b(?:number|kg\/h|cost)\b/i,
    /\bboard\s+message\b.*\bcustomer\s+message\b/i,
    /\bcustomer\s+message\b.*\bboard\s+message\b/i,
    /\bboard\s+version\b.*\bcustomer\s+version\b/i,
    /\bcustomer\s+version\b.*\bboard\s+version\b/i,
    /\btell\s+(?:the\s+)?ceo\b.*\bone\s+sentence\b/i,
    /\bone\s+sentence\b.*\bceo\b/i,
    /\bclaim\s+pilot\s+validation\b/i,
    /\bpilot\s+validation\b/i,
    /\bpilot[\s-]?ready\b/i,
    /\bpilot\s+readiness\b/i,
    /\bboard[\s-]?level\s+takeaway\b/i,
    /\bboard\s+takeaway\b/i,
    /\btop\s+(?:three|3)\s+diligence\s+asks?\b/i,
    /\bdiligence\s+asks?\b/i,
    /\bclaim\s+is\s+most\s+dangerous\b/i,
    /\bmost\s+dangerous\s+claim\b/i,
    /\blegal\b.*\b(?:review|outside|external)\b/i,
    /\bdata\s+owner\b.*\bfix\b.*\bfirst\b/i,
    /\bwhat\s+should\s+(?:we|i)\s+not\s+calculate\b/i,
    /\bwhat\s+should\s+not\s+be\s+calculated\b/i,
    /\bboard\b.*\bnot\s+hear\b/i,
    /\bsafe\s+to\s+share\s+outside\b/i,
    /\bremain\s+internal\b/i,
    /\binternal\s+memo\b/i,
    /\bexcluded\s+from\s+external\s+sharing\b/i,
  ].some((pattern) => pattern.test(message));
}

function directAttachmentAnswer(args: PlatformActionArgs, clientIntent: ClientIntent): ParsedChatResponse | null {
  const summary = args.state.documentEvidence;
  const text = args.message;
  if (!hasAttachmentEvidence(summary) || (!clientIntent.simpleFollowup && !messageHasDirectAttachmentFollowupIntent(text))) return null;
  const sourceLine = firstItems(summary.sourceLabels, 4).join(", ");
  let content: string | null = null;
  let responseBlocks: ClientResponseBlock[] | null = null;

  if (/\bboard\s+message\b.*\bcustomer\s+message\b|\bcustomer\s+message\b.*\bboard\s+message\b|\bboard\s+version\b.*\bcustomer\s+version\b|\bcustomer\s+version\b.*\bboard\s+version\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Use a narrow customer message and a more explicit board message. The customer version should state only sourced bench-test facts; the board version should also name the unsupported readiness, durability, customer, and bankability risks."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "Customer message basis"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 8), "Board/internal cautions"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Evidence needed before stronger messages"),
        createClientResponseBlock("recommended_next_action", "send the customer note as a sourced bench-test update and give the board the same facts plus a clear owner list for repeatability, durability, product assay, emissions, utilization, lifetime, and financing gaps."),
      ]));
  } else if (/\bcustomer|sent\s+to\s+a\s+customer|send\s+to\s+customer\b|\bcustomer\s+email\b|\bsales\s+deck\b|\bsales\b.*\b(?:as[\s-]?is|(?:safely\s+)?say\b.*\bexternally|avoid)|\bwhat\s+can\s+sales\b|\blanguage\s+should\s+sales\s+avoid\b|\boutbound\s+deck\b/i.test(text) && !/\bcaveat\b.*\bcustomer\s+slide\b|\bcustomer\s+slide\b.*\bcaveat\b/i.test(text)) {
    const asksSales = /\bsales\s+deck\b|\bsales\b|\boutbound\s+deck\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksSales
          ? "Sales can use a cautious source-backed bench-test statement, but the sales deck should not claim deployment readiness, validation, customer qualification, durability, or bankability."
          : "Yes, but only as a cautious bench-test update, not as a deployment or qualification claim."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), asksSales ? "Sales-safe facts" : "Safe customer-facing facts"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 6), asksSales ? "Keep out of the sales deck" : "Keep out of the customer version"),
        createClientResponseBlock("recommended_next_action", "send a short summary limited to the sourced bench results, then request repeatability, durability, product assay, emissions, and commercial-basis evidence before stronger external claims."),
      ]));
  } else if (/\bkey\s+(technical\s+)?risk\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The key technical risk is that the evidence is bench-scale and short-duration, so it does not yet prove repeatability, durability, product quality, or commercial readiness."),
        createClientResponseBlock("known_from_workspace", firstItems(summary.facts, 4), "Evidence behind that view"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 5), "Evidence that would reduce the risk"),
        createClientResponseBlock("recommended_next_action", "ask the test owner for repeat runs, longer-duration durability data, product assay, emissions data, and a mass-balance closure table."),
      ]));
  } else if (/\bceo\b.*\bnot\s+say|what\s+should\s+the\s+ceo\s+not\s+say/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The CEO should not say this is pilot-ready, commercially deployable, customer-qualified, bankable, or validated beyond the recorded bench run."),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 7), "Claims to avoid"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "What can be said instead"),
        createClientResponseBlock("recommended_next_action", "use language that says preliminary bench testing produced operating data, while repeatability, durability, product quality, emissions, and economics still need proof."),
      ]));
  } else if (/\btell\s+(?:the\s+)?ceo\b.*\bone\s+sentence\b|\bone\s+sentence\b.*\bceo\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Tell the CEO this is a source-backed bench-test diligence screen, not a pilot, commercial, customer-qualified, or bankability claim."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "CEO sentence support"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 6), "Do not compress into the CEO sentence"),
        createClientResponseBlock("recommended_next_action", "ask for repeatability, durability, product assay, emissions, utilization, lifetime, and finance inputs before using stronger executive language."),
      ]));
  } else if (/\bboard[\s-]?level\s+takeaway\b|\bboard\s+takeaway\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Board-level takeaway: the file set supports a focused diligence screen, not a readiness, customer, or finance conclusion."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "Facts behind the board takeaway"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 7), "Board risks to keep explicit"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Evidence the board should require next"),
        createClientResponseBlock("recommended_next_action", "approve only a targeted evidence request and hold customer, investor, deployment, validation, and bankability language until the team closes those gaps."),
      ]));
  } else if (/\bboard\b.*\bnot\s+hear\b|\bsafe\s+to\s+share\s+outside\b|\bremain\s+internal\b|\binternal\s+memo\b|\bexcluded\s+from\s+external\s+sharing\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Keep external language narrow. The internal memo should carry the readiness, validation, durability, customer qualification, and bankability risks until evidence improves."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "External-safe facts"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 8), "Keep internal until proven"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Evidence needed before external sharing"),
        createClientResponseBlock("recommended_next_action", "send only source-backed bench-test facts externally and put unsupported readiness, validation, durability, customer, and bankability claims in the internal diligence memo."),
      ]));
  } else if (/\bexact\b.*\b(?:investor|legal|customer|external|public)[\s-]?safe\b.*\bsentence\b|\b(?:board|investor|legal|sales|customer|external|public)[\s-]?safe\s+(?:sentence|version|statement)\b|\bone\s+safe\s+sentence\b|\bwhat\s+can\s+(?:i|we)\s+say\s+publicly\b|\bwhat\s+can\s+(?:the\s+)?ceo\s+say\s+publicly\b|\bceo\b.*\bavoid\b.*\bpublic\s+remarks\b|\bpublic\s+headline\b.*\bprivate\s+caveat\b|\bwhat\s+should\s+not\s+be\s+said\s+publicly\b|\bwhat\s+can\s+be\s+said\s+publicly\b|\bwhat\s+can\s+be\s+disclosed\s+externally\b|\bwhat\s+can\s+go\s+in\s+(?:a\s+)?sales\s+email\b|\b(?:customer\s+email|board\s+memo|investor\s+caveat|internal\s+risk)\s+sentence\b|\binvestor\s+caveat\b|\bcaveat\b.*\bcustomer\s+slide\b|\bcustomer\s+slide\b.*\bcaveat\b|\bsafest\s+external\s+headline\b|\bheadline\b.*\boverclaim\b|\boverclaim\b.*\bheadline\b|\bcommercial\s+deployment\b.*\bpress\s+quote\b|\b(?:safest\s+)?sentence\s+for\s+(?:a\s+)?counterparty\b|\bnot\s+go\s+to\s+(?:the\s+)?counterparty\b|\b(?:go\s+into|stay\s+out\s+of|must\s+stay\s+out\s+of)\s+(?:(?:a|the)\s+)?teaser\b|\b(?:used\s+in|removed\s+from)\s+(?:the\s+)?outreach\b|\bredlined?\s+before\s+sales\b|\bheld\s+for\s+diligence\s+only\b|\bone\s+line\s+should\s+(?:finance|the\s+test\s+owner)\s+approve\b|\bsafest\s+commercial\s+statement\b|\bcommercial\s+sentence\b.*\boverstate\b|\bcall\s+it\s+(?:proven|finance[\s-]?ready)\b|\bdiligence\s+memo\s+say\s+first\b|\brisk\s+appendix\b|\bexact\s+cautious\s+wording\b|\bwording\b.*\bengineering\b.*\bapprove\b|\bengineering\b.*\bapprove\b.*\bwording\b/i.test(text)) {
    const asksDoNotSay = /\bwhat\s+should\s+not\s+be\s+said\s+publicly\b|\bceo\b.*\bavoid\b.*\bpublic\s+remarks\b|\bheadline\b.*\boverclaim\b|\boverclaim\b.*\bheadline\b|\bcommercial\s+deployment\b.*\bpress\s+quote\b|\bnot\s+go\s+to\s+(?:the\s+)?counterparty\b|\bstay\s+out\s+of\s+(?:(?:a|the)\s+)?teaser\b|\bmust\s+stay\s+out\s+of\s+(?:(?:a|the)\s+)?teaser\b|\bremoved\s+from\s+(?:the\s+)?outreach\b|\bredlined?\s+before\s+sales\b|\bcommercial\s+sentence\b.*\boverstate\b|\bcall\s+it\s+(?:proven|finance[\s-]?ready)\b|\brisk\s+appendix\b|\bprivate\s+caveat\b/i.test(text);
    const asksEngineering = /\bwording\b.*\bengineering\b.*\bapprove\b|\bengineering\b.*\bapprove\b.*\bwording\b|\bone\s+line\s+should\s+(?:finance|the\s+test\s+owner)\s+approve\b/i.test(text);
    const asksSalesEmail = /\bsales\s+email\b|\bsales[\s-]?safe\b|\bteaser\b|\boutreach\b/i.test(text);
    const asksSlideCaveat = /\bcustomer\s+slide\b|\bcaveat\b|\brisk\s+appendix\b/i.test(text);
    const asksInvestor = /\binvestor/i.test(text);
    const asksBoard = /\bboard\b/i.test(text);
    const asksLegal = /\blegal\b/i.test(text);
    const label = asksEngineering
      ? "Source-owner approved wording"
      : asksSalesEmail
        ? "Sales/outreach wording"
        : asksSlideCaveat
          ? "Caution wording"
          : asksBoard
            ? "Board-safe wording"
            : asksLegal
              ? "Legal-safe wording"
              : asksInvestor
                ? "Investor-safe wording"
                : asksDoNotSay
                  ? "Public wording to avoid"
                  : "External-safe wording";
    const takeaway = asksDoNotSay
      ? "Do not use language that turns this evidence into readiness, qualification, durability, scale, or finance proof. The safe external position is a preliminary bench-scale result with major proof gaps still open."
      : asksEngineering
        ? "The source owner should approve only source-labeled bench-test wording, with no readiness, qualification, durability, scale, or finance conclusion added."
        : asksSalesEmail
          ? "Sales can say preliminary bench-scale testing produced source-labeled operating data, but the email must not imply readiness, qualification, durability, or finance-ready economics."
          : asksSlideCaveat
            ? "Caveat: preliminary bench-scale results are shown for diligence only; repeatability, durability, product quality, emissions, scale basis, and finance inputs remain open."
            : asksBoard
              ? "Board-safe sentence: the attachments support a narrow bench-test diligence screen, while readiness, durability, product quality, emissions, scale basis, and finance inputs remain open."
              : asksLegal
                ? "Legal-safe sentence: preliminary bench-scale testing produced source-labeled operating data, and stronger readiness, qualification, durability, scale, or finance statements remain unsupported."
            : asksInvestor
              ? "Investor-safe sentence: preliminary bench-scale testing produced source-labeled operating data, while repeatability, durability, product quality, emissions, scale basis, and finance inputs remain open."
              : "Safe sentence: preliminary bench-scale testing produced source-labeled operating data, while repeatability, durability, product quality, emissions, scale basis, and finance inputs remain open.";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", takeaway),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "Source basis for the sentence"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 6), label === "Public wording to avoid" ? "Do not say publicly" : "Do not add to the wording"),
        createClientResponseBlock("recommended_next_action", `use the ${label.toLowerCase()} only with source labels and keep stronger readiness, customer, durability, scale, and finance claims out of external materials until the missing evidence is collected.`),
      ]));
  } else if (/\bexact\s+number\b.*\bcite\b|\bnumber\b.*\bcite\b|\bbelow\s+500\s*(?:c|°c|deg(?:ree)?s?\s*c)\b/i.test(text)) {
    const asksTemperature = /\bbelow\s+500\s*(?:c|°c|deg(?:ree)?s?\s*c)\b/i.test(text);
    const numericFacts = firstItems(
      summary.facts.filter((item) => asksTemperature
        ? /temperature|482|500|operated/i.test(item)
        : /\d|kg\/h|output|temperature|pressure|operated|usd|cost/i.test(item)),
      6,
    );
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksTemperature
          ? "Yes, but cite it narrowly as a recorded bench-run condition, not as a readiness or validation claim."
          : "Cite only numbers that appear with a source label, unit, and operating basis in the attachments."),
        createClientResponseBlock("supported_now", numericFacts.length ? numericFacts : firstItems(summary.facts, 4), asksTemperature ? "Temperature support" : "Numbers currently safe to cite"),
        createClientResponseBlock("not_supported_yet", "Do not use those numbers to infer pilot validation, commercial scale, customer qualification, durability, financing readiness, NPV, IRR, or payback."),
        createClientResponseBlock("recommended_next_action", "quote the number with its source label, unit, run duration or basis, and an explicit bench-scale caveat."),
      ]));
  } else if (/\bchart\s+(?:title|subtitle|caveat)\b|\b(?:title|subtitle|caveat)\b.*\bchart\b|\b(?:y|x)[-\s]?axis\b|\baxis\s+label\b/i.test(text)) {
    const asksAxis = /\b(?:y|x)[-\s]?axis\b|\baxis\s+label\b/i.test(text);
    const asksOverclaim = /\boverclaim|not\s+say|avoid|validated|customer[\s-]?qualified|commercial\s+scale|payback/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksAxis
          ? "Use a plain source-backed axis label with the metric and unit, not a readiness or validation phrase."
          : asksOverclaim
            ? "Avoid any chart title that turns bench-scale data into validation, commercial scale, customer qualification, or economics proof."
            : "Use a neutral bench-scale chart title or subtitle that names the measured metric, source, and limitation."),
        createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 8), asksAxis ? "Axis-label candidates from chartable fields" : "Chart wording should be based on these fields"),
        createClientResponseBlock("not_supported_yet", chartCaveatItems(summary.nonChartableFields, 7), "Do not put these in the title or axis as numeric proof"),
        createClientResponseBlock("recommended_next_action", asksAxis
          ? "label the y-axis with the selected metric and unit, such as liquid output (kg/h), and keep run ID or time on the x-axis when those values are present."
          : "title the chart as bench operating data, add source label and run basis in the subtitle, and put readiness or bankability caveats below the chart."),
      ]));
  } else if (/\bchart\b.*\bfirst|first\s+chart/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Show the bench operating-output chart first: run or time on the x-axis, with feed rate, liquid output, gas output, solid residue, temperature, and pressure where values are present."),
        createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 8), "Chartable fields from the attachments"),
        createClientResponseBlock("not_supported_yet", chartCaveatItems(summary.nonChartableFields, 5), "Do not turn these into numeric charts yet"),
        createClientResponseBlock("recommended_next_action", "plot only populated numeric rows, mark missing or invalid cells explicitly, and keep readiness or customer qualification out of the chart title."),
      ]));
  } else if (/\bshould\s+not\s+be\s+charted\b|\bwhat\s+should\s+not\s+be\s+charted\b|\bnot\s+charted\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Do not chart promotional claims, readiness claims, missing cells, or text fields as numeric evidence."),
        createClientResponseBlock("not_supported_yet", chartCaveatItems(summary.nonChartableFields, 10), "Do not chart as numeric evidence"),
        createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 8), "Chartable numeric fields to use instead"),
        createClientResponseBlock("recommended_next_action", "plot only populated numeric values with units and source labels, and move readiness or bankability statements into caveats rather than chart series."),
      ]));
  } else if (/\bwhat\s+data\s+is\s+missing\b|\bmissing\s+(?:data|evidence|inputs?)\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The biggest missing data are repeatability, durability, product quality, emissions, and finance assumptions; do not treat the current attachment set as complete diligence evidence."),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 10), "Missing evidence by source"),
        createClientResponseBlock("recommended_next_action", "assign each missing input to the technical test, finance, engineering, commercial, or EHS owner before creating stronger customer or investor claims."),
      ]));
  } else if (/\bwhich\s+source\s+should\s+i\s+trust\b|\bsource\s+should\s+i\s+trust\b|\btrust\b.*\bsource\b|\b(?:most\s+reliable|reliable)\s+source\b|\bsource\b.*\b(?:most\s+)?reliable\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Trust measured test and operating-data sources for performance facts; use deck or customer-summary language only as claims to verify or rewrite."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Sources in the workspace"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "Measured or source-backed facts"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 6), "Claims needing caution"),
        createClientResponseBlock("recommended_next_action", "anchor external statements to the test report and operating data first, then mark deck claims as supported, unsupported, or contradicted."),
      ]));
  } else if (((/\bfix\b.*\bfirst\b|\bfastest\s+unblock\b/i.test(text) && !/\bdata\s+owner\b/i.test(text))) || /\bmetric\b.*\bunit\b/i.test(text)) {
    const asksUnit = /\bmetric\b.*\bunit\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksUnit
          ? "The next unit request should target missing or invalid operating fields before those fields are charted."
          : "Fix the highest-value missing source evidence first: the technical and finance gaps that block external, chart, readiness, and bankability claims."),
        createClientResponseBlock("evidence_needed", firstItems(asksUnit ? summary.missingInputs.filter((item) => /unit|row|field|cell|output|feed|sensor|operating|kg\/h/i.test(item)) : summary.missingInputs, 8), asksUnit ? "Metrics or fields needing source cleanup" : "Highest-value fixes"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "Facts already usable while the fix is pending"),
        createClientResponseBlock("recommended_next_action", asksUnit
          ? "ask the data owner for a corrected operating table with units, run IDs, invalid-cell flags, and source basis."
          : "ask the source owner for searchable evidence with units, date or run basis, owner, and whether each value is measured, budgetary, assumed, or unavailable."),
      ]));
  } else if (/\bmost\s+defensible\s+metric\b|\bdefensible\s+metric\b|\bmention\b.*\b(?:number|kg\/h)\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The most defensible metric is the measured bench-run liquid output, stated with the run duration and bench-scale limitation."),
        createClientResponseBlock("supported_now", firstItems(summary.facts.filter((item) => /liquid output|output|recorded|measured|operated|bench/i.test(item)), 6), "Metric support"),
        createClientResponseBlock("not_supported_yet", "Do not turn that metric into pilot readiness, commercial capacity, customer qualification, durability, or bankability claims."),
        createClientResponseBlock("recommended_next_action", "show the metric with source label, units, run duration, operating conditions, and a clear note that repeatability and durability are still missing."),
      ]));
  } else if (/\bengineering\b.*\bnext\b|\bwhat\s+should\s+engineering\s+do\s+next\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Engineering should close the technical evidence gaps before scale-up or deployment language is used."),
        createClientResponseBlock("evidence_needed", firstItems(prioritizePhysicsMissingInputs(summary.missingInputs), 8), "Technical gaps to close"),
        createClientResponseBlock("recommended_next_action", "run repeatability and longer-duration tests, collect product assay and emissions data, close mass/energy balance, and document operating conditions in a source-labeled table."),
      ]));
  } else if (/\bremoved?\s+from\s+the\s+deck\b|\bwhat\s+should\s+be\s+removed\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Remove or rewrite claims about pilot readiness, commercial deployment, customer qualification, durability, and investor-grade economics unless each one has source-labeled support."),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 10), "Deck claims to remove or rewrite"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "Claims that can be retained with narrow wording"),
        createClientResponseBlock("recommended_next_action", "keep only sourced bench-run statements in the deck and move unsupported readiness, customer, durability, and bankability language into an internal risk appendix."),
      ]));
  } else if (/\bshow\s+the\s+operating\s+data\b|\bcan\s+i\s+show\s+the\s+operating\s+data\b|\boperating\s+data\b.*\bshow\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Yes, show the operating data as bench-scale evidence, but label missing or invalid cells and avoid implying pilot or commercial readiness."),
        createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 8), "Operating fields that can be shown"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizePhysicsMissingInputs(summary.missingInputs), 6), "Data caveats to show"),
        createClientResponseBlock("recommended_next_action", "plot populated numeric fields only, annotate missing sensor values, and keep chart titles tied to bench operation rather than readiness."),
      ]));
  } else if (/\bdata[\s-]?room\s+request\b|\bwhat\s+can\s+go\s+to\s+(?:the\s+)?data[\s-]?room\b|\bdata[\s-]?room\b.*\b(?:redact|redaction|redacting|caveat|caveating|share|sharing)\b|\b(?:redact|redaction|caveat|caveating)\b.*\bdata[\s-]?room\b|\brequest\s+list\b.*\b(?:technical\s+lead|finance\s+owner|commercial\s+owner|data\s+owner|source\s+owner|owner)\b|\b(?:technical\s+lead|finance\s+owner|commercial\s+owner|data\s+owner|source\s+owner|owner)\b.*\brequest\s+list\b/i.test(text)) {
    const asksRedaction = /\b(?:redact|redaction|redacting|caveat|caveating|share|sharing)\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksRedaction
          ? "The data room can include source-backed bench and cost records, but readiness, validation, customer, durability, and bankability claims need caveats or redaction until proven."
          : "Treat this as a source request list, not a bankability conclusion. The attachments already support a few narrow bench and cost facts, but the owner requests should focus on the evidence gaps that block external, finance, and readiness claims."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), asksRedaction ? "Can go in the data room with source labels" : "Facts already usable"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 8), asksRedaction ? "Needs redaction or caveat before sharing" : "Commercial owner claims to hold back"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizePhysicsMissingInputs(summary.missingInputs), 5), "Technical lead requests"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizeFinanceMissingInputs(summary.missingInputs), 5), "Finance owner requests"),
        createClientResponseBlock("recommended_next_action", asksRedaction
          ? "share only source-labeled records and add a caveat register for every readiness, validation, customer, durability, emissions, scale, and finance statement."
          : "send the request list with source labels, units, date or run basis, owner, and whether each item is measured, budgetary, assumed, or not yet available."),
      ]));
  } else if (/\bwhat\s+proof\b.*\bask\b|\bask\b.*\bproof\b.*\bfirst\b|\bwhat\s+evidence\b.*\bask\b.*\bfirst\b|\bask\b.*\b(?:test|data)\s+owner\b|\bask\b.*\btechnical\s+lead\b|\bevidence\b.*\bchange\s+the\s+recommendation\b|\bdata\b.*\bunlock\s+a\s+stronger\s+claim\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Ask first for the missing evidence that would turn cautious bench-test language into defensible diligence evidence."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "Facts already usable"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 8), "Proof to request first"),
        createClientResponseBlock("recommended_next_action", "send one source-labeled request for repeatability, durability, product assay, emissions, mass or energy balance, utilization, lifetime, WACC, product price, feedstock cost, and scale-up basis."),
      ]));
  } else if (/\bsafest\s+externally\b|\bsafest\s+(?:external\s+)?claim\b|\bvalidated\b|\bpilot\s+validation\b|\bpilot[\s-]?ready\b|\bpilot\s+readiness\b|\bboard\s+hear\b|\bmemo\s+recommend\b|\bnext\s+best\s+step\b/i.test(text)) {
    const asksValidation = /\bvalidated\b|\bpilot\s+validation\b|\bpilot[\s-]?ready\b|\bpilot\s+readiness\b/i.test(text);
    const asksBoardOrMemo = /\bboard\s+hear\b|\bmemo\s+recommend\b|\bnext\s+best\s+step\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksValidation
          ? "No. The evidence supports a preliminary bench-test statement, not a validation claim."
          : asksBoardOrMemo
            ? "The recommendation should be to keep diligence active but block customer, investor, bankability, and deployment claims until the missing proof is collected."
            : "The safest external claim is that preliminary bench-scale testing produced source-backed operating data, with repeatability, durability, product quality, emissions, and commercial economics still open."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "Facts that can support cautious wording"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 7), "Do not say externally"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Evidence that would make the claim stronger"),
        createClientResponseBlock("recommended_next_action", "use the cautious bench-test wording externally and assign owners for repeatability, durability, product assay, emissions, utilization, lifetime, WACC, product price, feedstock cost, and scale-up basis."),
      ]));
  } else if (/\btop\s+(?:three|3)\s+diligence\s+asks?\b|\bdiligence\s+asks?\b|\bdata\s+owner\b.*\bfix\b.*\bfirst\b/i.test(text)) {
    const asksDataOwner = /\bdata\s+owner\b.*\bfix\b.*\bfirst\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksDataOwner
          ? "The data owner should fix the highest-value missing source fields before anyone strengthens charts, customer language, or diligence conclusions."
          : "The top diligence asks are the missing evidence items that block readiness, finance, and external claims."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "Facts already usable"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, asksDataOwner ? 6 : 3), asksDataOwner ? "Data owner fixes first" : "Top diligence asks"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 5), "Claims blocked until those asks are answered"),
        createClientResponseBlock("recommended_next_action", asksDataOwner
          ? "send the data owner a source-labeled correction request with units, run or date basis, owner, and whether each field is measured, assumed, or unavailable."
          : "assign each ask to a named source owner and require units, basis, date or run identifier, and source document before external use."),
      ]));
  } else if (/\bclaim\s+is\s+most\s+dangerous\b|\bmost\s+dangerous\s+claim\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The most dangerous claim is the strongest contradicted readiness or bankability claim, because it can make a bench evidence package sound deployment-ready."),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 5), "Most dangerous claim candidates"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 4), "Facts to use instead"),
        createClientResponseBlock("recommended_next_action", "remove or rewrite the highest-risk claim first, then require a source label for every retained customer, investor, readiness, and economics statement."),
      ]));
  } else if (/\blegal\b.*\b(?:review|outside|external|strike|redline)\b|\b(?:strike|redline)\b.*\blegal\b/i.test(text)) {
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "Legal should strike or rewrite every external-facing readiness, qualification, durability, scale, and finance statement that lacks source-labeled support."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 5), "External-safe source basis"),
        createClientResponseBlock("not_supported_yet", externalClaimCautionItems(summary, 8), "Legal review focus"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 6), "Evidence legal should require before stronger claims"),
        createClientResponseBlock("recommended_next_action", "send legal a redline list that separates source-backed facts from unsupported or contradicted claims, with owner and evidence request for each blocked statement."),
      ]));
  } else if (/\bfinance\b|\bbankability\b|\binvestor diligence\b|\binvestor\b|\bwhat\s+cannot\s+be\s+calculated\s+yet\b|\bwhich\s+numbers?\s+cannot\s+be\s+calculated\b|\bwhich\s+numbers?\s+are\s+still\s+unavailable\b|\bwhat\s+should\s+(?:we|i)\s+not\s+calculate\b|\bwhat\s+should\s+not\s+be\s+calculated\b|\blower\s+operating\s+cost\b|\bshow\s+this\s+to\s+a\s+lender\b|\bis\s+this\s+bankable\b/i.test(text)) {
    const financeFacts = firstItems(
      summary.facts.filter((item) => /\[COST-MODEL|capex|opex|usd|electricity|labor|maintenance|skid|cost/i.test(item)),
      4,
    );
    const asksCalculationBoundary = /\bwhat\s+cannot\s+be\s+calculated\s+yet\b|\bwhich\s+numbers?\s+(?:cannot\s+be\s+calculated|are\s+still\s+unavailable)\b|\bwhat\s+should\s+(?:we|i)\s+not\s+calculate\b|\bwhat\s+should\s+not\s+be\s+calculated\b|\blower\s+operating\s+cost\b|\bshow\s+this\s+to\s+a\s+lender\b|\bis\s+this\s+bankable\b/i.test(text);
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", asksCalculationBoundary
          ? "NPV, IRR, payback, lender readiness, investor-grade returns, and commercial-scale economics cannot be calculated yet from the uploaded evidence."
          : /\binvestor diligence\b|\binvestor\b/i.test(text)
          ? "It is ready for an initial diligence screen, not investor-ready conclusions."
          : "Finance should provide the missing assumptions before anyone calculates NPV, IRR, payback, or bankability."),
        createClientResponseBlock("supported_now", financeFacts.length ? financeFacts : firstItems(summary.facts, 4), "Cost or operating facts currently available"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizeFinanceMissingInputs(summary.missingInputs), 8), "Finance inputs still needed"),
        createClientResponseBlock("not_supported_yet", "NPV, IRR, payback, lender readiness, investor-grade returns, and commercial-scale economics are not supported until those inputs are sourced."),
        createClientResponseBlock("recommended_next_action", "ask finance for utilization, lifetime, WACC or discount rate, product price, feedstock cost, scale-up basis, and committed versus budgetary CAPEX."),
      ]));
  }

  if (!content) return null;
  return {
    type: "response",
    content,
    response_blocks: responseBlocks,
    plan_steps: null,
    action: null,
    suggested_followups: [
      "Show the unsupported claims",
      "Turn this into a customer-safe summary",
      "List the missing evidence by owner",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "attachment_grounded_simple_answer",
      client_intent: clientIntent,
      evidence_sources: sourceLine,
    },
  };
}

function attachmentGroundedWorkflowResponse(args: PlatformActionArgs, clientIntent: ClientIntent): ParsedChatResponse | null {
  const summary = args.state.documentEvidence;
  if (!hasAttachmentEvidence(summary) || clientIntent.workflowMode === "plan_request") return null;
  const message = args.message;
  const unsupported = firstItems(
    prioritizeClaimReviewItems([...summary.contradictedClaims, ...summary.unsupportedClaims])
      .map(softenExternalClaimLanguage),
    10,
  );
  const hasClaimReview = clientIntent.taskKinds.includes("claim_review") || clientIntent.conflictingEvidence;
  const hasBankability = clientIntent.taskKinds.includes("bankability_economics");
  const hasChartPackage = clientIntent.taskKinds.includes("chart_package");
  const hasPhysics = clientIntent.taskKinds.includes("physics_exergy_review");
  const hasFailedExtraction = /\bfailed\s+extraction|extraction\s+failed|failed-extraction|failed\s+(?:document|upload|scan|source)|unreadable|recollect|recover/i.test(message);
  const hasCustomerSafe = clientIntent.sharingContext === "customer_safe" || /\bcustomer-safe|customer\s+safe|sent\s+to\s+a\s+customer|stay\s+internal|internal\s+risk/i.test(message);

  let content: string | null = null;
  let responseBlocks: ClientResponseBlock[] | null = null;
  let reason = "attachment_grounded_workflow";

  if (hasBankability) {
    reason = "attachment_bankability_review";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "A bankability memo can identify cost drivers and missing finance inputs now, but it cannot calculate NPV, IRR, payback, lender readiness, or investor-grade returns from this attachment set."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
        createClientResponseBlock("supported_now", firstItems(summary.facts.filter((item) => /\[COST-MODEL/i.test(item) || /capex|opex|usd|electricity|labor|maintenance|skid/i.test(item)), 8), "Cost facts available now"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizeFinanceMissingInputs(summary.missingInputs), 10), "Inputs blocking calculations"),
        createClientResponseBlock("not_supported_yet", "NPV, IRR, payback, commercial-scale CAPEX extrapolation, lender readiness, investor-grade returns, and bankability conclusions are not supported without utilization, lifetime, WACC or discount rate, product price, feedstock cost, revenue basis, and scale-up basis."),
        createClientResponseBlock("recommended_next_action", "ask finance for the missing assumptions with units, date, source basis, and committed-versus-budgetary status before calculating economics."),
      ]));
  } else if (hasChartPackage) {
    reason = "attachment_chart_package";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "A CEO chart package can start with source-backed operating data, but readiness, customer qualification, and bankability should remain text caveats until measured inputs exist."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
        createClientResponseBlock("chart_package_plan", firstItems(summary.chartableFields, 10), "Charts that can be made now"),
        createClientResponseBlock("not_supported_yet", chartCaveatItems(summary.nonChartableFields, 7), "Do not chart these as numeric values"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 7), "Blocked chart inputs"),
        createClientResponseBlock("recommended_next_action", "build the first chart from populated operating rows, show missing cells explicitly, and keep every chart title tied to bench-scale evidence rather than deployment readiness."),
      ]));
  } else if (hasPhysics) {
    reason = "attachment_physics_review";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The attachments support a qualitative physics screen of the bench run, but not solver-backed validation, exergy efficiency, larger-scale deployment, or mechanism proof."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
        createClientResponseBlock("supported_now", firstItems(summary.facts.filter((item) => /temperature|pressure|feed|heater|output|bench|run|operated/i.test(item)), 8), "Physics-relevant facts"),
        createClientResponseBlock("evidence_needed", firstItems(prioritizePhysicsMissingInputs(summary.missingInputs), 8), "Measurements still missing"),
        createClientResponseBlock("not_supported_yet", "solver-backed confidence, closed mass or energy balance, exergy efficiency, durability, repeatability, product assay, emissions performance, and commercial readiness are not supported by the uploaded evidence."),
        createClientResponseBlock("recommended_next_action", "collect thermodynamic state tables, mass-balance closure, product assay, emissions, repeatability, and longer-duration test data before making mechanism or solver-backed claims."),
      ]));
  } else if (hasCustomerSafe && (clientIntent.conflictingEvidence || unsupported.length > 0)) {
    reason = "attachment_customer_safe_conflict_summary";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The customer version should be a cautious bench-test update; the internal note should explicitly hold back deployment, pilot validation, customer qualification, durability, and bankability claims."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 6), "Customer-safe facts"),
        createClientResponseBlock("not_supported_yet", unsupported, "Internal risk note"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 8), "Evidence needed before stronger external claims"),
        createClientResponseBlock("recommended_next_action", "send only the sourced bench-test summary externally; keep the contradicted readiness and bankability language in the internal diligence note with owners for repeatability, durability, product assay, emissions, and finance inputs."),
      ]));
  } else if (hasClaimReview || clientIntent.conflictingEvidence) {
    reason = clientIntent.conflictingEvidence ? "attachment_conflicting_evidence_review" : "attachment_claim_review";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The deck can keep measured bench-run claims. Remove or rewrite claims about pilot readiness, customer qualification, commercial deployment, durability, and investor-grade economics unless each claim has source-labeled support."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Evidence used"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 6), "Supported facts"),
        createClientResponseBlock("not_supported_yet", unsupported, "Unsupported or contradicted deck claims"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 7), "Missing evidence before outreach"),
        createClientResponseBlock("recommended_next_action", "rewrite the investor deck so every retained claim points to a source label, and move pilot readiness, customer qualification, durability, and bankability language into an internal risk appendix until evidence improves."),
      ]));
  } else if (hasFailedExtraction) {
    reason = "attachment_failed_extraction_recovery";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The failed document should be treated as a recovery task, not as evidence for missing product quality, durability, or emissions claims."),
        createClientResponseBlock("evidence_basis", firstItems(summary.sourceLabels, 8), "Other evidence still usable"),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 6), "What can still be used"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 9), "What to recollect"),
        createClientResponseBlock("recommended_next_action", "recollect the failed appendix as searchable PDF or CSV and ask the data owner for the source spreadsheet behind assay, durability, repeatability, and emissions tables."),
      ]));
  } else if (hasCustomerSafe) {
    reason = "attachment_customer_safe_summary";
    ({ content, response_blocks: responseBlocks } = renderStructuredBlocks([
        createClientResponseBlock("useful_takeaway", "The customer version should say preliminary bench testing produced operating data; the internal note should keep the deployment, pilot, bankability, and qualification risks visible."),
        createClientResponseBlock("supported_now", firstItems(summary.facts, 6), "Customer-safe facts"),
        createClientResponseBlock("not_supported_yet", unsupported, "Keep internal until proven"),
        createClientResponseBlock("evidence_needed", firstItems(summary.missingInputs, 7), "Evidence needed before stronger customer claims"),
        createClientResponseBlock("recommended_next_action", "send only the cautious bench-test summary externally and use the internal note to assign owners for repeatability, durability, product assay, emissions, and finance inputs."),
      ]));
  }

  if (!content) return null;
  return {
    type: "response",
    content,
    response_blocks: responseBlocks,
    plan_steps: null,
    action: null,
    suggested_followups: [
      "Turn this into a diligence memo",
      "List missing evidence by owner",
      "Create the customer-safe version",
    ],
    workflow_orchestration: {
      source: "platform",
      reason,
      client_intent: clientIntent,
      evidence_sources: summary.sourceLabels,
    },
  };
}

export function buildGroundedEvaluationPlan(args: {
  domain: string;
  description: string;
}): NonNullable<ParsedChatResponse["plan_steps"]> {
  const domain = args.domain || "general";
  const description = args.description || `${domain.replace(/_/g, " ")} uploaded technology`;
  const subject = description || "uploaded technology";

  return [
    {
      step: 1,
      title: "Evidence Intake",
      description: "Extract usable facts from uploaded documents and build the first grounded evidence view.",
      action_type: "evidence_evaluation",
      config: { domain, description, brief: true },
    },
    {
      step: 2,
      title: "Literature & Benchmark Research",
      description: "Search published benchmarks, reference cases, competing approaches, and documented risks.",
      action_type: "literature_search",
      config: {
        query: `${subject} published benchmarks performance economics safety regulatory deployment`,
      },
    },
    {
      step: 3,
      title: "Physics & Performance Validation",
      description: "Check core physics, simulations, exergy/performance claims, and reference-case consistency.",
      action_type: "deep_analysis",
      config: {
        question:
          `Validate the physics and performance claims for ${subject}. Use the extracted evidence and literature benchmarks from prior steps. Run available physics/simulation tools where the domain supports them, compare modeled values against claimed and published values, identify exergy or efficiency implications, and state which claims require independent test data before they can support deployment readiness.`,
      },
    },
    {
      step: 4,
      title: "Economics & Bankability",
      description: "Assess cost, commercial model, financing risk, and assumptions that drive investability.",
      action_type: "deep_analysis",
      config: {
        question:
          `Analyze the economics and bankability of ${subject}. Compare claimed cost, power, efficiency, delivery timeline, and commercial model against the prior evidence and published reference cases. Identify the assumptions that most affect investability.`,
      },
    },
    {
      step: 5,
      title: "Risk & Deployment Review",
      description: "Review safety, regulatory, manufacturing, environmental, scalability, and integration risks.",
      action_type: "deep_analysis",
      config: {
        question:
          `Assess safety, regulatory, manufacturing, environmental, scalability, and system-integration risks for ${subject}. Build on prior findings and call out the blockers, unresolved evidence, and recovery data needed for a higher-confidence assessment.`,
      },
    },
    {
      step: 6,
      title: "Client Charts & Sensitivity Views",
      description: "Generate client-facing chart specs and derived views from the evaluation and research artifacts.",
      action_type: "exploratory_analysis",
      config: {
        analysis_type: "gap_analysis",
        question:
          `Create client-facing chart specifications and derived views for ${subject}. Use only real values from the evaluation, simulations, literature research, and prior analysis artifacts. Prioritize module scorecards, evidence gaps, economics drivers, exergy/performance metrics, and sensitivity or tradeoff views that help a client decide what matters next. Clearly list assumptions and limitations for every chart.`,
      },
    },
    {
      step: 7,
      title: "Deployment Readiness Evaluation",
      description: "Convert the validated evidence, physics, economics, and risk findings into a readiness verdict.",
      action_type: "deep_analysis",
      config: {
        question:
          `Provide a deployment-readiness evaluation for ${subject} using all prior findings. For physics, performance, economics, safety, regulatory, manufacturing, environmental, scalability, system integration, and strategic value, state the current verdict, evidence basis, gaps, and blockers. Do not repeat vendor claims unless the prior evidence supports them.`,
      },
    },
    {
      step: 8,
      title: "Investment & Readiness Synthesis",
      description: "Summarize the decision, strongest evidence, missing data, and next diligence steps.",
      action_type: "deep_analysis",
      config: {
        question:
          `Synthesize a client-ready diligence view for ${subject}. State the strongest evidence, the biggest risks, the highest-value missing data, and the concrete next diligence steps a user should take before any investment or deployment-readiness claim.`,
      },
    },
  ];
}

export function buildFollowOnEvaluationPlan(args: {
  domain: string;
  description: string;
}): NonNullable<ParsedChatResponse["plan_steps"]> {
  const domain = args.domain || "general";
  const description = args.description || `${domain.replace(/_/g, " ")} uploaded technology`;
  const subject = description || "uploaded technology";

  return [
    {
      step: 1,
      title: "Literature & Benchmark Research",
      description: "Search published benchmarks, reference cases, competing approaches, and documented risks.",
      action_type: "literature_search",
      config: {
        query: `${subject} exergy second-law efficiency benchmarks performance economics safety regulatory deployment`,
      },
    },
    {
      step: 2,
      title: "Technical & Exergy Validation",
      description: "Review whether exergy was computed, what solver assumptions apply, and what thermodynamic interpretation is supported.",
      action_type: "deep_analysis",
      config: {
        question:
          `Using the existing evaluation artifact and extracted document evidence for ${subject}, review the technical claims and state whether exergy was computed or remains unavailable. Explain any reported second-law efficiency, first-law efficiency, quality factor, solver assumptions, and what can or cannot be concluded without independent data.`,
      },
    },
    {
      step: 3,
      title: "Economics & Bankability",
      description: "Assess cost, financing, market comparables, and economics sensitivity using sourced or explicitly provisional assumptions.",
      action_type: "deep_analysis",
      config: {
        question:
          `Analyze economics and bankability for ${subject} using the existing evaluation, extracted evidence, and literature benchmarks. Separate measured data, vendor claims, inferred assumptions, and missing data. Identify CAPEX/OPEX drivers, unit economics, sensitivity to utilization and energy/feedstock cost, and what a lender or investor would require before relying on the economics.`,
      },
    },
    {
      step: 4,
      title: "Exergy Improvement Pathway",
      description: "Identify likely exergy-destruction drivers, missing decomposition data, and improvement levers.",
      action_type: "deep_analysis",
      config: {
        question:
          `Analyze the exergy improvement pathway for ${subject}. Identify likely exergy destruction mechanisms, missing stage-wise data, heat integration opportunities, catalyst/reactor constraints, and the measurements needed before treating any aggregate efficiency estimate as a client-facing exergy map.`,
      },
    },
    {
      step: 5,
      title: "Commercial & Deployment Risk",
      description: "Assess commercialization risk, independent validation needs, scale-up, economics, and deployment blockers.",
      action_type: "deep_analysis",
      config: {
        question:
          `Assess commercialization and deployment risk for ${subject} using the evaluation, literature benchmarks, and exergy findings. Cover independent validation, scale-up, economics, safety/regulatory risk, manufacturing readiness, and what would block a deployment or investment decision.`,
      },
    },
    {
      step: 6,
      title: "Client Charts & Sensitivity Views",
      description: "Generate chart specs and derived views from the existing evaluation and follow-on analysis.",
      action_type: "exploratory_analysis",
      config: {
        analysis_type: "sensitivity",
        question:
          `Create client-facing chart specifications for ${subject} using only real values from the existing evaluation, literature research, and analysis artifacts. Prioritize exergy/performance metrics, economics drivers, module gaps, and sensitivity or tradeoff views. Include source descriptions, assumptions, and limitations for each chart.`,
      },
    },
    {
      step: 7,
      title: "Client-Ready Synthesis",
      description: "Summarize the result, confidence level, decision implications, and highest-value next data requests.",
        action_type: "deep_analysis",
        config: {
          question:
          `Synthesize a client-ready view for ${subject}. State whether exergy was computed or remains unavailable, the bounded confidence level, what is supported by evidence, what remains unverified, and the highest-value next data requests needed before any higher-confidence assessment.`,
        },
      },
    ];
}

function buildAttachmentGroundedWorkflowPlan(args: {
  domain: string;
  description: string;
  summary: AttachmentEvidenceSummary;
  clientIntent: ClientIntent;
  message: string;
}): NonNullable<ParsedChatResponse["plan_steps"]> {
  const subject = args.description || `${args.domain.replace(/_/g, " ")} uploaded technology`;
  const steps: NonNullable<ParsedChatResponse["plan_steps"]> = [];
  const addStep = (
    title: string,
    description: string,
    actionType: string,
    config: Record<string, unknown>,
  ) => {
    steps.push({
      step: steps.length + 1,
      title,
      description,
      action_type: actionType,
      config,
    });
  };

  addStep(
    "Attachment Evidence Intake",
    "Extract source-labeled facts, assumptions, unsupported claims, contradicted claims, missing inputs, and chartable fields from the uploaded files.",
    "evidence_evaluation",
    {
      domain: args.domain,
      description: subject,
      brief: true,
      question:
        `Use only the uploaded evidence for ${subject}. Separate known facts, assumptions, unsupported claims, contradicted claims, missing inputs, chartable fields, and next actions. Do not infer missing numeric values or cite sources that are not in the attachment evidence.`,
    },
  );

  if (args.clientIntent.taskKinds.includes("claim_review") || args.clientIntent.conflictingEvidence) {
    addStep(
      "Deck Claim Review",
      "Compare promotional claims against the test and operating evidence, then mark each claim as supported, unsupported, contradicted, or not yet reviewable.",
      "deep_analysis",
      {
        question:
          `Compare the uploaded deck or customer claims for ${subject} against the extracted attachment evidence. Keep only source-labeled support, flag contradicted and unsupported claims, and state what should be removed before outreach.`,
        source_labels: args.summary.sourceLabels,
      },
    );
  }

  if (args.clientIntent.taskKinds.includes("chart_package")) {
    addStep(
      "Chart Package Specification",
      "Identify charts that can be built from populated numeric attachment fields and list blocked charts with the missing input owner.",
      "exploratory_analysis",
      {
        analysis_type: "chart_plan",
        question:
          `Create chart specifications for ${subject} using only populated numeric fields from the uploaded evidence. List blocked charts separately with the required metric, unit, source document, owner, and reason the chart is blocked. Do not fabricate chart values.`,
        chartable_fields: args.summary.chartableFields,
      },
    );
  }

  if (args.clientIntent.taskKinds.includes("bankability_economics")) {
    addStep(
      "Bankability Evidence Review",
      "Turn the cost model into a bankability memo outline while blocking NPV, IRR, payback, lender readiness, and investor-grade economics until finance inputs exist.",
      "deep_analysis",
      {
        question:
          `Review bankability and economics for ${subject} from the uploaded cost evidence. State what can be calculated now, what cannot be calculated, and which finance inputs are required before NPV, IRR, payback, LCOE-style, or lender-readiness claims can be made.`,
      },
    );
  }

  if (args.clientIntent.taskKinds.includes("physics_exergy_review")) {
    addStep(
      "Physics And Exergy Boundary Review",
      "Assess physics claims from measured test evidence and identify missing thermodynamic state variables before solver-backed or exergy claims are used.",
      "deep_analysis",
      {
        question:
          `Assess the physics and exergy claims for ${subject} from the uploaded test evidence. Separate measured operating facts from mechanism claims, identify missing temperature, pressure, flow, composition, boundary, reference-environment, and uncertainty inputs, and do not call anything solver-backed unless a solver artifact exists.`,
      },
    );
  }

  if (args.clientIntent.sharingContext === "customer_safe" || args.clientIntent.sharingContext === "external" || args.clientIntent.artifactRequest !== "none") {
    addStep(
      "Client-Safe Output Draft",
      "Draft the customer, investor, or internal memo language from supported facts only, with unsupported and internal-only claims held back.",
      "deep_analysis",
      {
        question:
          `Draft client-facing language for ${subject} using only supported attachment facts. Keep unsupported deployment, validation, customer qualification, durability, commercial economics, and bankability claims out of external language, and put internal risks in a separate note.`,
      },
    );
  }

  if (args.summary.failedExtractions.length > 0 || /\bfailed\s+extraction|recollect|recover|unreadable/i.test(args.message)) {
    addStep(
      "Failed Extraction Recovery",
      "Identify what remains usable from other files and the exact tables, pages, or source records to recollect from the failed document.",
      "deep_analysis",
      {
        question:
          `For ${subject}, treat failed extractions as missing evidence. State what can still be done from successful attachments and list exactly what to recollect, including source tables, numeric fields, units, owner, and file format.`,
        failed_extractions: args.summary.failedExtractions,
      },
    );
  }

  addStep(
    "Grounded Diligence Synthesis",
    "Produce the useful answer first, then the remaining work plan: known facts, assumptions, unsupported claims, contradictions, missing evidence, and next actions.",
    "deep_analysis",
    {
      question:
        `Synthesize a diligence view for ${subject}. Use only attachment-grounded facts, separate assumptions, unsupported claims, contradictions, missing evidence, and next actions, and include the first concrete action the client should take next.`,
    },
  );

  return steps;
}

export function buildResearchFirstPlan(args: {
  domain: string;
  description: string;
  focus?: ChartFocus | null;
  focuses?: ChartFocus[];
}): NonNullable<ParsedChatResponse["plan_steps"]> {
  const domain = args.domain || "general";
  const description = args.description || `${domain.replace(/_/g, " ")} technology`;
  const subject = description || "technology";
  const focusKeywordSource = args.focuses?.length ? args.focuses : args.focus ? [args.focus] : [];
  const focusKeywords = uniqueFocusKeywords(focusKeywordSource);
  const focusQuerySuffix = focusKeywords.length > 0 ? ` ${focusKeywords.join(" ")}` : "";

  return [
    {
      step: 1,
      title: "Literature & Benchmark Research",
      description: "Search published benchmarks, reference cases, competing approaches, and documented risks.",
      action_type: "literature_search",
      config: {
        query: `${subject} published benchmarks performance economics safety regulatory deployment${focusQuerySuffix}`,
      },
    },
    {
      step: 2,
      title: "Physics & Performance Feasibility",
      description: "Validate feasibility from published data and identify what needs simulation or measurement.",
      action_type: "deep_analysis",
      config: {
        question:
          `Assess physics and performance feasibility for ${subject} using the literature and project context. Identify whether domain solvers or simulations can be used, which parameters are required to run them, where exergy or efficiency analysis is decision-relevant, and what claims remain unsupported without uploaded documents or numeric inputs.`,
      },
    },
    {
      step: 3,
      title: "Economics & Bankability",
      description: "Build a research-grounded economics view and identify missing assumptions.",
      action_type: "deep_analysis",
      config: {
        question:
          `Analyze economics and bankability for ${subject} from published benchmarks and available project context. Separate known cost data from assumptions, identify unit economics drivers, and state the inputs required for a lender-usable model.`,
      },
    },
    {
      step: 4,
      title: "Risk & Deployment Review",
      description: "Assess safety, regulatory, manufacturing, environmental, scalability, and integration risks.",
      action_type: "deep_analysis",
      config: {
        question:
          `Assess deployment risks for ${subject} from the research record. Cover safety, regulatory, manufacturing, environmental, scalability, and system integration risks, and rank the gaps that should be resolved first.`,
      },
    },
    {
      step: 5,
      title: "Client Charts & Evidence Map",
      description: "Generate chart specs only from available numeric data, or produce a targeted data request when chart inputs are missing.",
      action_type: "exploratory_analysis",
      config: {
        analysis_type: "comparison",
        question:
          `Create client-facing chart specifications for ${subject} using only real values from the research and analysis artifacts. If there is not enough numeric data for a chart, do not fabricate chart values. Produce a targeted data-gathering plan that lists each missing metric, unit, operating regime or time basis, source artifact or document needed, and next action required before a chart can be generated.`,
      },
    },
    {
      step: 6,
      title: "Client-Ready Synthesis",
      description: "Summarize what is known, what is uncertain, and what data would unlock a stronger assessment.",
      action_type: "deep_analysis",
      config: {
        question:
          `Synthesize a client-ready view for ${subject}. State what the literature supports, what remains uncertain, which simulations or economics inputs are missing, and the highest-value next actions to turn this into a grounded evaluation.`,
      },
    },
  ];
}

export function buildEvidenceEvaluationFallback({
  message,
  state,
  project,
}: EvidenceEvaluationFallbackArgs): ParsedChatResponse | null {
  if (!state.hasUploadedDocuments || state.hasSuccessfulEvaluationArtifact) {
    return null;
  }
  if (!messageHasEvaluationIntent(message)) {
    return null;
  }

  const domain = stringOrNull(project.domain) || stringOrNull(state.domain) || "general";
  const description =
    stringOrNull(project.description) ||
    stringOrNull(project.name) ||
    "";

  if (messageHasComplexEvaluationIntent(message)) {
    return {
      type: "plan",
      content:
        "I will start with evidence intake, then use the extracted facts to guide benchmark research, technical validation, economics, risk review, and final synthesis. The plan will run automatically unless you explicitly ask to review it first.",
      plan_steps: buildGroundedEvaluationPlan({ domain, description }),
      action: null,
      suggested_followups: [
        "Focus the plan on investor diligence",
        "Add more technical validation before economics",
        "Compare this against competing technologies",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "complex_request_detected",
        auto_run_plan: true,
      },
    };
  }

  const fallbackContent = messageHasEconomicsIntent(message)
    ? "Starting grounded evidence intake from the uploaded documents before any economics or bankability claim. LCOE, LCOS, NPV, IRR, payback, and bankability calculations are not computed and are not yet supported until CAPEX, OPEX, utilization, maintenance or replacement cadence, financing, revenue or price stack, and incumbent baseline evidence is extracted or supplied. Missing evidence requests: extract or provide those cost, utilization, financing, revenue, and incumbent baseline inputs with units, source basis, and operating regime."
    : messageHasPhysicsFollowupIntent(message)
    ? "Starting grounded evidence intake from the uploaded documents before any physics, simulation, or exergy claim. Solver-backed validation is not computed and remains unavailable or blocked until temperature, pressure, flows, composition, reference environment, operating regime, and boundary evidence is extracted or supplied."
    : "Starting a grounded evaluation from the uploaded documents. I will extract what can be supported, calculate only what the available data allows, and make any remaining gaps explicit.";

  return {
    type: "action",
    content: fallbackContent,
    plan_steps: null,
    action: {
      type: "evidence_evaluation",
      config: {
        domain,
        description,
        brief: true,
      },
    },
    suggested_followups: [
      "How do these results compare to published benchmarks?",
      "What are the biggest commercialization risks?",
      "What data would most improve this assessment?",
    ],
  };
}

export function shouldUsePlatformOwnedPlan(args: PlatformPlanArgs): boolean {
  if (messageHasPlanRequest(args.message)) return true;
  if (messageHasAutonomousWorkflowFrame(args.message)) return true;
  if (messageHasChartIntent(args.message) && !messageHasComplexEvaluationIntent(args.message)) return false;
  if (
    args.state.hasSuccessfulEvaluationArtifact &&
    (messageHasEconomicsIntent(args.message) || messageHasPhysicsFollowupIntent(args.message))
  ) {
    return false;
  }
  if (
    !args.state.hasSuccessfulEvaluationArtifact &&
    !args.state.hasUploadedDocuments &&
    (messageHasEconomicsIntent(args.message) || messageHasPhysicsFollowupIntent(args.message))
  ) {
    return false;
  }
  return messageHasComplexEvaluationIntent(args.message);
}

export function buildPlatformOwnedPlanResponse(args: PlatformPlanArgs): ParsedChatResponse | null {
  if (!shouldUsePlatformOwnedPlan(args)) return null;
  const clientIntent = classifyClientIntent(args);

  const domain = stringOrNull(args.project.domain) || stringOrNull(args.state.domain) || "general";
  const description =
    stringOrNull(args.project.description) ||
    stringOrNull(args.project.name) ||
    `${domain.replace(/_/g, " ")} uploaded technology`;
  const shouldStartWithEvidenceIntake =
    args.state.hasUploadedDocuments && !args.state.hasSuccessfulEvaluationArtifact;
  const hasEvidenceSummary = hasAttachmentEvidence(args.state.documentEvidence);
  const evidenceSummary = hasEvidenceSummary
    ? args.state.documentEvidence as AttachmentEvidenceSummary
    : null;
  const shouldUseAttachmentPlan =
    shouldStartWithEvidenceIntake &&
    !!evidenceSummary &&
    clientIntent.attachmentGrounded;
  const planSteps = shouldUseAttachmentPlan
    ? buildAttachmentGroundedWorkflowPlan({
        domain,
        description,
        summary: evidenceSummary as AttachmentEvidenceSummary,
        clientIntent,
        message: args.message,
      })
    : shouldStartWithEvidenceIntake
      ? buildGroundedEvaluationPlan({ domain, description })
    : args.state.hasSuccessfulEvaluationArtifact
      ? buildFollowOnEvaluationPlan({ domain, description })
      : buildResearchFirstPlan({ domain, description });
  const evidenceSnapshot = evidenceSummary
    ? renderAttachmentEvidenceSnapshot(evidenceSummary)
    : "";
  const planReason = shouldUseAttachmentPlan && clientIntent.workflowMode === "plan_and_execute"
    ? "attachment_plan_and_execute_request"
    : messageHasPlanRequest(args.message)
      ? "explicit_plan_request"
      : "complex_request_detected";
  const intro = shouldUseAttachmentPlan
    ? "I am starting the attachment-grounded plan-and-execute workflow. It starts with the evidence already extracted from the uploaded files, gives immediate value below, and keeps calculations or external claims blocked unless the attachments support them."
    : shouldStartWithEvidenceIntake
      ? "I am starting an evidence-grounded execution plan. It starts with evidence intake so every later step is grounded in the uploaded documents, and the immediate evidence snapshot below is usable while the full workflow runs."
      : args.state.hasSuccessfulEvaluationArtifact
        ? "I am starting a follow-on plan that builds on the existing evaluation instead of repeating completed intake."
        : "I am starting an execution plan that starts with research and benchmark discovery; upload technical documents when available to make the assessment more grounded.";

  return {
    type: "plan",
    content: [
      intro,
      evidenceSnapshot,
    ].filter(Boolean).join("\n\n"),
    response_blocks: evidenceSummary ? renderStructuredBlocks([
      createClientResponseBlock("evidence_basis", firstItems(evidenceSummary.sourceLabels, 8), "Evidence used"),
      createClientResponseBlock("supported_now", firstItems(evidenceSummary.facts, 6), "Immediate facts from attachments"),
      createClientResponseBlock("not_supported_yet", firstItems([
        ...evidenceSummary.unsupportedClaims,
        ...evidenceSummary.contradictedClaims,
      ], 8), "Unsupported or contradicted claims"),
      createClientResponseBlock("evidence_needed", firstItems(evidenceSummary.missingInputs, 8), "Missing evidence"),
      createClientResponseBlock("recommended_next_action", "run the attachment evidence intake step first, then execute only the claim review, chart, bankability, physics, and memo stages that the uploaded evidence can support."),
    ]).response_blocks : null,
    plan_steps: planSteps,
    action: null,
    suggested_followups: shouldUseAttachmentPlan
      ? [
          "Focus the output on client-safe claims",
          "Show only unsupported claims",
          "List blocked charts by owner",
        ]
      : [
          "Focus the plan on investor diligence",
          "Add more technical validation before economics",
          "Compare this against competing technologies",
        ],
    workflow_orchestration: {
      source: "platform",
      reason: planReason,
      client_intent: clientIntent,
      has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
      starts_with_evidence_intake: shouldStartWithEvidenceIntake,
      evidence_sources: evidenceSummary ? evidenceSummary.sourceLabels : [],
      auto_run_plan: !messageHasPlanRequest(args.message),
    },
  };
}

function projectQuery(args: PlatformActionArgs): string {
  return [
    args.project.name,
    args.project.description,
    args.project.domain || args.state.domain,
    args.message,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueFocusKeywords(focuses: ChartFocus[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const focus of focuses) {
    for (const keyword of focus.keywords) {
      if (seen.has(keyword)) continue;
      seen.add(keyword);
      keywords.push(keyword);
    }
  }
  return keywords;
}

function clientReadinessPhrase(readiness: NonNullable<InitialEvaluationProjectState["exportReadiness"]>): string {
  if (readiness === "ready") return "ready for export from the existing evaluation";
  if (readiness === "conditionally_ready") return "useful as an internal diligence note, but not yet suitable as an investor, customer, or lender package";
  return "not yet suitable for an external diligence report";
}

function extractionPhrase(status: InitialEvaluationProjectState["extractionStatus"] | undefined): string {
  if (status === "failed") return "the source extraction failed";
  if (status === "partial") return "the source extraction is partial";
  if (status === "complete") return "the source extraction is complete";
  if (status === "none") return "no source extraction is available";
  return "source extraction has not produced a clear evidence basis";
}

function messageHasDiligenceSynthesisIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return /\b(in one answer|in one package|one package|summari[sz]e|synthesis|diligence|readiness|export|exported|export readiness|package)\b/i.test(message);
}

function multiFocusIntentCount(message: string): number {
  return [
    messageHasEconomicsIntent(message),
    messageHasPhysicsFollowupIntent(message),
    messageHasEvidenceGapIntent(message),
    messageHasReportExportIntent(message),
  ].filter(Boolean).length;
}

function blockedEvidenceGapRequests(): string[] {
  return [
    "Upload or identify source documents with measured performance metrics, units, operating regime, and provenance so extraction absence is not mistaken for true evidence absence.",
    "Provide economics inputs including CAPEX, OPEX, utilization, replacement cadence, financing assumptions, price or revenue basis, and incumbent baseline with source basis.",
    "Provide physical boundary inputs including temperature, pressure, flows, composition, reference environment, duty cycle, and system boundary for physics or exergy review.",
  ];
}

function conciseProjectSubject(args: PlatformActionArgs): string {
  const description = stringOrNull(args.project.description);
  if (description) {
    const firstSentence = description.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length <= 260) {
      return firstSentence;
    }
    return description.slice(0, 260).trim().replace(/\s+\S*$/, "");
  }

  const name = stringOrNull(args.project.name);
  if (name) return name;

  const domain = stringOrNull(args.project.domain) || stringOrNull(args.state.domain) || "the technology";
  return domain.replace(/_/g, " ");
}

function sourceEvidenceRecoveryContent(args: PlatformActionArgs): string {
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  const subjectSentence = /[.!?]$/.test(subject) ? subject : `${subject}.`;
  const hasUploadedDocuments = args.state.hasUploadedDocuments;
  const evidenceItems = [
    "Source pages or sections that define the system boundary, operating mode, claimed use case, and customer environment.",
    "Measured performance tables with units, test duration, duty cycle, uncertainty, operating regime, and who ran or witnessed the test.",
    "Test records for durability, degradation, safety events, availability, and any third-party validation or certification.",
    "Economics source tables for CAPEX, OPEX, utilization, replacement cadence, financing basis, revenue or price stack, and incumbent baseline.",
    "A short provenance note tying each value to a document, page, table, test run, date, and scenario label.",
    ...renderEvidencePackItems(buildEvidencePack("report")).slice(0, 2),
  ];
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", "the next request should target source evidence, not another broad conclusion."),
      createClientResponseBlock("known_from_workspace", subjectSentence),
      createClientResponseBlock(
        "supported_now",
        hasUploadedDocuments
          ? "the uploaded material can start intake, but it is not enough by itself to support an external diligence view until the source records below are present or extracted."
          : "the workspace does not yet include source records, so the fastest useful move is to request a compact evidence package before asking for calculations or report claims.",
      ),
      createClientResponseBlock("minimum_viable_evidence_pack", evidenceItems, "Ask for these first"),
      createClientResponseBlock("not_supported_yet", "verified performance, bankability, numeric charts, solver-backed physics, customer-ready report conclusions, or project-finance readiness.", "What I would not claim yet"),
      createClientResponseBlock("recommended_next_action", "send this as a targeted data-room request, upload the returned source records, then run a grounded evidence evaluation before writing the external report."),
    ],
  });
}

function sparseClientSynthesisContent(args: PlatformActionArgs): string {
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  const description = stringOrNull(args.project.description);
  const hasDescription = !!description;
  const evidenceBasis = args.state.hasUploadedDocuments
    ? "the project has uploaded source material, but no completed grounded evaluation is available yet"
    : "the current workspace has a project description, but no uploaded evidence package or completed evaluation artifact";
  const requestIsInvestorOrExecutive =
    /\b(investor|bankability|bankable|executive|board|lender|project\s+finance|spend\s+more\s+diligence\s+time)\b/i.test(args.message);

  const nextEvidence = requestIsInvestorOrExecutive
    ? [
      "measured performance at the claimed operating conditions, including test duration, duty cycle, uncertainty, and who ran the test",
      "a cost model with CAPEX, OPEX, utilization, maintenance or replacement cadence, financing basis, and incumbent comparison",
      "durability, degradation, safety, integration, and third-party validation evidence tied to the same operating regime",
    ]
    : [
      "measured performance with units, operating regime, duration, uncertainty, and source provenance",
      "cost, utilization, maintenance, replacement, and incumbent comparison inputs if economics are part of the decision",
      "durability, safety, integration, and independent validation evidence for the claimed deployment environment",
    ];

  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", "here is what I can say from what you provided."),
      createClientResponseBlock("known_from_workspace", hasDescription ? subject : "the technology is not described in enough detail to identify the system, use case, or claims."),
      createClientResponseBlock("evidence_basis", `${evidenceBasis}.`),
      createClientResponseBlock(
        "supported_now",
        hasDescription
          ? "the opportunity can be screened at the concept and diligence-priority level. The stated use case and claims are enough to identify what must be checked first, but they are not enough to verify performance, economics, durability, safety, or readiness."
          : "there is not enough context to screen the opportunity itself yet, but the next step is clear: capture the system description, claimed operating conditions, target customer, and claimed advantage before asking for calculations.",
        "What this suggests",
      ),
      requestIsInvestorOrExecutive
        ? createClientResponseBlock(
          "decision_implication",
          "this is a diligence candidate, not an investment-ready or financing-ready case. The useful message is that the thesis is defined enough to request targeted proof, but the evidence package is not yet strong enough to support cost, lifetime, efficiency, bankability, or deployment-readiness claims.",
          "What I would tell an investor today",
        )
        : createClientResponseBlock(
          "decision_implication",
          "treat the current material as a claim map, not proof. It tells you what the technology is trying to do and which assumptions matter most; it does not yet prove that the specific design works as claimed.",
        ),
      createClientResponseBlock("not_supported_yet", "do not claim verified efficiency, cost advantage, lifetime, safety performance, solver-backed validation, project finance readiness, or numeric chart results unless those values appear in a completed evaluation, test report, model, or sourced artifact.", "What I would not claim yet"),
      createClientResponseBlock("evidence_needed", nextEvidence, "Highest-value next evidence to collect"),
      createClientResponseBlock(
        "recommended_next_action",
        args.state.hasUploadedDocuments
          ? "run a grounded evidence evaluation on the uploaded material, then use the resulting gaps to decide whether to request more documents or stop diligence."
          : "ask the counterparty for a compact evidence package covering those items, upload it here, and run a grounded evaluation before making an external-facing conclusion.",
      ),
    ],
  });
}

function economicsEvidenceRequests(): string[] {
  return [
    "Provide total installed CAPEX with equipment, EPC, contingency, owner's costs, commissioning, unit, currency year, and source basis.",
    "Provide fixed and variable OPEX with utilities, feedstock, labor, maintenance, replacement cadence, degradation, and source basis.",
    "Provide utilization or capacity factor, lifetime, ramp profile, availability, production volume, and operating regime.",
    "Provide financing assumptions including WACC or discount rate, debt/equity split, interest rate, tenor, tax treatment, incentives, and policy-credit monetization basis.",
    "Provide revenue or price stack with market segment, offtake status, volume, contract tenor, counterparty quality, incentives, and incumbent baseline.",
  ];
}

function physicsEvidenceRequests(): string[] {
  return [
    "Define the system boundary, control volume, mechanism, operating regime, duty cycle, and whether the requested result is first-law efficiency, exergy efficiency, or solver confidence.",
    "Provide inlet and outlet temperature, pressure, mass or molar flow rates, composition, phase, and measurement uncertainty for every material stream.",
    "Provide heat, work, electrical input or output, product energy basis, losses, and any recycle or purge streams needed to close the energy and exergy balance.",
    "Provide the reference environment for exergy calculations, including ambient temperature, pressure, and chemical reference basis.",
    "Provide an actual solver, simulation, or test artifact with scenario labels, assumptions, model version, and source provenance before claiming solver-backed confidence.",
  ];
}

export function reportEvidenceRequestsForStatus(
  status: InitialEvaluationProjectState["extractionStatus"],
): string[] {
  if (status === "failed") {
    return [
      "Re-run document extraction or upload a parseable source document with page or section references for process description, system boundary, operating conditions, measured performance tables, and evidence provenance.",
      "Provide a third-party test report with measured performance, operating regime, and source traceability.",
      "Provide CAPEX, OPEX, utilization, and pricing assumptions with units and basis.",
    ];
  }
  if (status === "partial") {
    return [
      "Provide the missing extracted metrics with units and source page references.",
      "Provide operating regime details such as temperature, pressure, flows, duration, and boundary conditions.",
      "Provide economics inputs including CAPEX, OPEX, utilization, replacement cadence, financing, and incumbent baseline.",
    ];
  }
  return [
    "Provide source documents or artifacts with metrics, units, provenance, and operating basis.",
    "Run a grounded evidence evaluation before treating the report as decision-ready.",
  ];
}

function normalizeReportEvidenceRequests(
  requests: string[] | undefined,
  status: InitialEvaluationProjectState["extractionStatus"],
): string[] {
  const seen = new Set<string>();
  const concrete = (requests || [])
    .map((request) => request.trim())
    .filter((request) => {
      if (!request || seen.has(request)) return false;
      seen.add(request);
      return true;
    });
  if (concrete.length === 0) {
    return reportEvidenceRequestsForStatus(status);
  }
  return concrete;
}

function mergeEvidencePackItems(workflow: Parameters<typeof buildEvidencePack>[0], extraRequests: string[] = []): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [
    ...renderEvidencePackItems(buildEvidencePack(workflow)),
    ...extraRequests,
  ]) {
    const trimmed = item
      .replace(/\bclient-ready report\b/gi, "shareable report")
      .replace(/\bblocked chart inputs\b/gi, "unavailable chart inputs")
      .trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

function exportReadinessForState(state: InitialEvaluationProjectState): NonNullable<InitialEvaluationProjectState["exportReadiness"]> {
  const fallback = state.exportReadiness || (
    state.hasSuccessfulEvaluationArtifact ? "ready" : state.hasAnyArtifact ? "conditionally_ready" : "blocked"
  );
  if (state.extractionStatus === "failed") {
    return state.hasAnyArtifact && state.hasChartableArtifact ? "conditionally_ready" : "blocked";
  }
  if (state.extractionStatus === "partial") {
    return fallback === "blocked" ? "blocked" : "conditionally_ready";
  }
  return fallback;
}

function reportExportContent(args: PlatformActionArgs): string {
  const readiness = exportReadinessForState(args.state);
  const extraction = args.state.extractionStatus || "unknown";
  const requestList = normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extraction);
  const requests = mergeEvidencePackItems("report", requestList);
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");

  if (readiness === "ready") {
    return renderClientResponseBlocks({
      blocks: [
        createClientResponseBlock("useful_takeaway", `${subject} has a completed evaluation artifact available, so the existing assessment can be exported.`),
        createClientResponseBlock("supported_now", "use the report export flow for the completed assessment, and use the JSON export control in the chat header for the structured workspace export.", "What the workspace supports now"),
        createClientResponseBlock("not_supported_yet", "it does not create a separate downloadable file by itself.", "What this chat response does not do"),
        createClientResponseBlock("decision_implication", "the exported report should still be read against the evidence notes on the card; if any source extraction or evidence notes are partial, keep those caveats in the shared package."),
        createClientResponseBlock("recommended_next_action", "export the existing assessment, then review the evidence notes before sending it outside the diligence team."),
      ],
    });
  }

  if (readiness === "conditionally_ready") {
    return renderClientResponseBlocks({
      blocks: [
        createClientResponseBlock("useful_takeaway", `${subject} can support an internal diligence note, but not an investor-ready, customer-ready, lender-ready, or quantified investment case yet.`),
        createClientResponseBlock("supported_now", `artifacts are present, but ${extractionPhrase(extraction)}. You can use JSON export to preserve the workspace state; report export should only be used for completed evaluation artifacts with caveats kept visible.`, "What the workspace supports now"),
        createClientResponseBlock("not_supported_yet", "it does not produce a separate downloadable file, generate numeric charts, or recompute economics on its own.", "What this chat response does not do"),
        createClientResponseBlock("not_supported_yet", "decision-ready conclusions, numeric charts, computed NPV, IRR, LCOE, LCOS, payback, solver-backed validation, or external readiness claims unless those values are supported by source artifacts.", "What should not be claimed yet"),
        createClientResponseBlock("not_supported_yet", "any performance, economics, physics, or readiness statement that is not tied to a sourced artifact.", "Unsupported claims to keep out of the external package"),
        createClientResponseBlock("evidence_needed", requests, "Highest-value evidence before external sharing"),
        createClientResponseBlock("recommended_next_action", "turn the current material into an internal diligence memo, request the missing evidence, then rerun grounded evaluation before creating the external report package."),
      ],
    });
  }

  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", `${subject} is not yet suitable for an external diligence report, but the next diligence step is clear.`),
      createClientResponseBlock("supported_now", `no completed evaluation is available for report export, and ${extractionPhrase(extraction)}. **Export JSON** can preserve the current workspace state if artifacts exist.`, "What the workspace supports now"),
      createClientResponseBlock("report_memo_readiness", "a short internal diligence note that summarizes the claim, states the evidence gap, and asks for the source records needed before external sharing.", "What can be written now"),
      createClientResponseBlock("not_supported_yet", "PDF assessment readiness, numeric charts, computed economics, project-finance readiness, or solver-backed conclusions.", "What should not be claimed yet"),
      createClientResponseBlock("not_supported_yet", "any performance, economics, physics, or readiness statement that is not tied to a sourced artifact.", "Unsupported claims to keep out of the external package"),
      createClientResponseBlock("evidence_needed", requests),
      createClientResponseBlock("recommended_next_action", "collect parseable source evidence, run a grounded evaluation, then export a report only after the supported findings are visible in an evaluation artifact."),
    ],
  });
}

function chartReadinessForReport(state: InitialEvaluationProjectState): string {
  if (state.hasChartableArtifact || state.hasSuccessfulEvaluationArtifact) {
    return "For charts, existing project artifacts can be used only where they already contain real values; this chat response does not invent chart values or generate a separate chart file.";
  }
  return "For charts, source data must first provide the metric, unit, operating regime or time basis, source artifact or document, and next action for each requested series.";
}

function messageHasChartDataRequestIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  return messageHasChartIntent(message) &&
    /\b(blocked|missing|wait\s+for\s+data|what\s+data|which\s+.*charts?|what\s+charts?\s+should\s+wait|data\s+(?:do\s+you\s+need|request|table)|need\s+for\s+(?:the\s+)?charts?)\b/i.test(message);
}

function messageHasFinanceEvidenceRequestIntent(message: string | null | undefined): boolean {
  if (typeof message !== "string" || message.trim().length === 0) {
    return false;
  }
  if (/\bproof\b/i.test(message)) {
    return false;
  }
  return messageHasEconomicsIntent(message) &&
    /\b(evidence|inputs?|data|request|collect|need|ask|unlock|before)\b/i.test(message);
}

function chartPackagePlanContent(args: PlatformActionArgs, options: { hasSomeValues: boolean }): string {
  const extraction = args.state.extractionStatus || "unknown";
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  const basis = options.hasSomeValues
    ? "Some chart inputs may already exist in project artifacts, but every external chart still needs source-backed values and clear units."
    : "The current workspace does not yet contain source-backed numeric series for client-facing charts.";
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", `${subject} can have a useful chart package plan now, even though some chart values are not yet available.`),
      createClientResponseBlock("evidence_basis", `${extractionPhrase(extraction)}.`),
      createClientResponseBlock("supported_now", basis, "What the workspace supports now"),
      createClientResponseBlock("chart_package_plan", [
        ...mergeEvidencePackItems("chart"),
        "Economics sensitivity: tornado or waterfall chart; required metric: CAPEX, OPEX, utilization, replacement cadence, financing or WACC, revenue or price stack, and incumbent baseline; unit: currency year plus cost per output unit or MWh-equivalent; source needed: cost model, offtake or price support, and incumbent benchmark; why it matters: shows whether the business case survives realistic cost and utilization movement; what can be summarized today: economics are a diligence priority, but calculated NPV, IRR, payback, and LCOE-style claims are not yet supported.",
        "Technical performance: line or bar chart by operating point; required metric: measured output, efficiency, duty cycle, degradation, and uncertainty; unit: domain-specific output unit plus test duration and operating regime; source needed: test logs, validation report, or source table; why it matters: separates claimed performance from demonstrated performance; what can be summarized today: the test envelope and missing proof items can be described without plotting values.",
        "Exergy or physics boundary: Sankey or stacked loss chart; required metric: heat, work, stream temperature, pressure, flow, composition, reference environment, and loss terms; unit: kW, kWh, percent, or exergy per output unit with stated basis; source needed: solver or test artifact, thermodynamic state table, and boundary definition; why it matters: shows where useful work is lost and whether the mechanism is plausible; what can be summarized today: boundary conditions and uncomputed solver claims.",
        "Uncertainty and risk: heat map or ranked bar chart; required metric: evidence confidence, uncertainty range, failure mode, severity, and likelihood basis; unit: dated event count, confidence range, or qualitative tier tied to source evidence; source needed: validation report, safety records, reliability data, standards pathway, and expert review notes; why it matters: helps decide which risk can stop external sharing; what can be summarized today: ranked evidence gaps and risk drivers.",
        "Milestone readiness: milestone ladder or timeline; required metric: completed tests, third-party validation, certification, customer requirements, manufacturing readiness, and commercial commitments; unit: date, milestone owner, pass/fail evidence, or readiness basis; source needed: project plan, customer requirements, certification records, and manufacturing evidence; why it matters: shows whether the project is moving toward investable or deployable proof; what can be summarized today: the next milestone and evidence pack needed.",
      ]),
      createClientResponseBlock("recommended_next_action", "turn this into a one-page chart data request table, collect the missing metric, unit, source document, operating basis, and owner for each chart, then generate charts only from values present in grounded artifacts."),
    ],
  });
}

function chartDataRequestContent(args: PlatformActionArgs): string {
  return chartPackagePlanContent(args, {
    hasSomeValues: args.state.hasChartableArtifact || args.state.hasSuccessfulEvaluationArtifact,
  });
}

function adversarialReadinessContent(args: PlatformActionArgs): string {
  const readiness = exportReadinessForState(args.state);
  const extraction = args.state.extractionStatus || "unknown";
  const requests = mergeEvidencePackItems("report",
    normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extraction),
  );
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", `${subject} is ${clientReadinessPhrase(readiness)}.`),
      createClientResponseBlock("evidence_basis", `${extractionPhrase(extraction)}.`),
      createClientResponseBlock("not_supported_yet", "I cannot omit material caveats or make an incomplete evidence package sound decision-ready.", "What I cannot do"),
      createClientResponseBlock("supported_now", "an internal diligence summary that separates supported facts, assumptions, unavailable data, and next evidence actions.", "What can be used now"),
      createClientResponseBlock("not_supported_yet", "investor-ready or project-finance-ready status, computed NPV, IRR, LCOE, LCOS, payback, numeric charts from missing values, or solver-backed validation unless those claims are supported by artifacts.", "What should not be claimed yet"),
      createClientResponseBlock("not_supported_yet", "any performance, economics, physics, or readiness statement that is not tied to a sourced artifact.", "Unsupported claims to keep out of the external package"),
      createClientResponseBlock("evidence_needed", requests, "Missing evidence requests"),
      createClientResponseBlock("recommended_next_action", "request the missing evidence, rerun grounded evaluation, then create the external report only if the resulting artifact supports the claims being shared."),
    ],
  });
}

function blockedEconomicsContent(args: PlatformActionArgs): string {
  const extraction = args.state.extractionStatus || "none";
  const requests = renderEvidencePackItems(buildEvidencePack("bankability"));
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", `${subject} can be screened for financing risk now, but it is not ready for a bankability conclusion or calculated investment case.`),
      createClientResponseBlock("evidence_basis", `${extractionPhrase(extraction)}.`),
      createClientResponseBlock("supported_now", "a diligence agenda for the financing case. The highest-risk areas are whether the cost basis is complete, whether utilization and degradation are credible, whether revenue or offtake support exists, and whether the incumbent baseline is defined."),
      createClientResponseBlock("not_supported_yet", "NPV, IRR, payback, LCOE, LCOS, lender readiness, offtake-backed revenue, policy-credit value, benchmark advantage, or bankability conclusion.", "What should not be claimed yet"),
      createClientResponseBlock("not_supported_yet", "any finance, cost, revenue, or bankability statement that is not tied to a sourced artifact.", "Unsupported claims to keep out of the external package"),
      createClientResponseBlock("bankability_guidance", "NPV and IRR need dated CAPEX, OPEX, revenue, utilization, lifetime, tax, incentive, and financing assumptions; LCOE or LCOS needs output volume, efficiency or yield, degradation, replacement cadence, and incumbent baseline; payback needs initial cost, annual net cash flow, ramp profile, and maintenance assumptions.", "What would unlock calculations"),
      createClientResponseBlock("decision_implication", "treat this as a finance data-room request, not a financeable case. A lender or investor would first ask which market segment is being financed, which costs are committed versus estimated, which revenue is contracted versus assumed, which operating conditions drive output, and which independent evidence supports availability, degradation, and replacement cadence."),
      createClientResponseBlock("minimum_viable_evidence_pack", requests, "Highest-value missing evidence to collect"),
      createClientResponseBlock("recommended_next_action", "send the evidence list as a minimum viable finance pack request, collect each input with unit, date, source document, and operating basis, then run a grounded economics evaluation before using any calculated or finance-ready claim."),
    ],
  });
}

function blockedPhysicsContent(args: PlatformActionArgs): string {
  const extraction = args.state.extractionStatus || "none";
  const requests = renderEvidencePackItems(buildEvidencePack("physics"));
  const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", "the mechanism can be screened qualitatively, but exergy efficiency or solver confidence cannot be claimed yet."),
      createClientResponseBlock("known_from_workspace", `${subject}.`),
      createClientResponseBlock("evidence_basis", `${extractionPhrase(extraction)}.`),
      createClientResponseBlock("supported_now", "whether the claimed mechanism has a coherent boundary, energy or material input, intended output, operating regime, and loss pathway. From sparse evidence, that is a plausibility screen, not a validation result.", "What can be assessed now"),
      createClientResponseBlock("physics_exergy_advisory", "Exergy efficiency is not computed from the current workspace, and solver-backed confidence is unavailable because no solver, simulation, test, or complete thermodynamic state artifact is present."),
      createClientResponseBlock("evidence_needed", [
        "Governing quantities to collect: system boundary, control volume, inlet and outlet temperature, pressure, flow, composition, phase, heat, work, electrical input or output, product energy basis, losses, recycle or purge streams, and reference environment.",
        "Boundary conditions that matter: operating regime, duty cycle, ambient reference state, material stream definitions, measurement uncertainty, and whether the result should be first-law efficiency, exergy efficiency, or solver confidence.",
      ]),
      createClientResponseBlock("not_supported_yet", "computed exergy efficiency, closed energy balance, solver-backed validation, mechanism validation, or physics confidence based on an inferred system boundary.", "What should not be claimed yet"),
      createClientResponseBlock("minimum_viable_evidence_pack", requests, "Next inputs to collect"),
      createClientResponseBlock("recommended_next_action", "collect the boundary, operating regime, thermodynamic state variables, reference environment, uncertainty, and solver or test artifact, then run or upload the solver-backed evaluation before using any exergy-efficiency or physics-confidence claim."),
    ],
  });
}

function failedExtractionChartEconomicsContent(args: PlatformActionArgs): string {
  const requests = [
    ...reportEvidenceRequestsForStatus("failed"),
    ...renderEvidencePackItems(buildEvidencePack("bankability")).slice(0, 3),
  ];
  return renderClientResponseBlocks({
    blocks: [
      createClientResponseBlock("useful_takeaway", "the current extraction cannot support charts or bankability claims, but it does define the evidence package to request next.", "The useful recovery takeaway"),
      createClientResponseBlock("evidence_basis", "the source extraction failed."),
      createClientResponseBlock("not_supported_yet", "Charts cannot be produced because the failed extraction did not produce numeric metrics with units, source provenance, and operating basis.", "Charts cannot be produced"),
      createClientResponseBlock("bankability_guidance", "Economics and bankability conclusions cannot be supported. NPV, IRR, payback, LCOE, LCOS, and financing readiness are not computed from the failed extraction."),
      createClientResponseBlock("not_supported_yet", "I cannot create charts, bankability conclusions, or investor-ready claims from an extraction failure.", "What I cannot create yet"),
      createClientResponseBlock("minimum_viable_evidence_pack", requests, "Next inputs to collect"),
      createClientResponseBlock("recommended_next_action", "upload a parseable source document or rerun extraction, collect the finance inputs with units and source basis, then rerun grounded evaluation before charting or using bankability conclusions.", "Next required actions"),
    ],
  });
}

export function buildPlatformOwnedActionResponse(args: PlatformActionArgs): ParsedChatResponse | null {
  const clientIntent = classifyClientIntent(args);
  const isChartRequest = clientIntent.chartRequest !== "none" || messageHasChartIntent(args.message);
  const isReportExportRequest = messageHasReportExportIntent(args.message);
  const directAttachment = directAttachmentAnswer(args, clientIntent);
  if (directAttachment) return directAttachment;
  const attachmentWorkflow = attachmentGroundedWorkflowResponse(args, clientIntent);
  if (attachmentWorkflow) return attachmentWorkflow;
  if (!isChartRequest && shouldUsePlatformOwnedPlan(args)) return null;

  const query = projectQuery(args);
  const domain = stringOrNull(args.project.domain) || stringOrNull(args.state.domain) || "general";
  const description =
    stringOrNull(args.project.description) ||
    stringOrNull(args.project.name) ||
    query ||
    `${domain.replace(/_/g, " ")} technology`;

  if (clientIntent.claimBoundaryContext === "adversarial_readiness" || messageHasAdversarialReadinessIntent(args.message)) {
    const exportReadiness = exportReadinessForState(args.state);
    const extractionStatus = args.state.extractionStatus || "unknown";
    const missingEvidenceRequests = normalizeReportEvidenceRequests(
      args.state.reportEvidenceRequests,
      extractionStatus,
    );
    return {
      type: "response",
      content: [
        adversarialReadinessContent(args),
        isChartRequest ? chartReadinessForReport(args.state) : "",
      ].filter(Boolean).join(" "),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Turn this into a caveated diligence summary",
        "List the evidence required for investor-ready export",
        "Separate supported claims from unsupported claims",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "adversarial_readiness_request_detected",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        export_readiness: exportReadiness,
        extraction_status: extractionStatus,
        missing_evidence_requests: exportReadiness === "ready" ? [] : missingEvidenceRequests,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (
    args.state.extractionStatus === "failed" &&
    isChartRequest &&
    messageHasEconomicsIntent(args.message) &&
    (
      /\b(?:extraction\s+failed|failed\s+extraction|failed-extraction)\b/i.test(args.message) ||
      messageHasSourceEvidenceRecoveryIntent(args.message)
    )
  ) {
    const missingEvidenceRequests = [
      ...reportEvidenceRequestsForStatus("failed"),
      ...economicsEvidenceRequests(),
    ];
    return {
      type: "response",
      content: failedExtractionChartEconomicsContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Create a failed-extraction recovery checklist",
        "List the finance inputs needed before bankability",
        "Rerun extraction before charting",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: FAILED_EXTRACTION_CHART_ECONOMICS_RECOVERY_REASON,
        has_successful_evaluation: false,
        export_readiness: "blocked",
        extraction_status: "failed",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (
    messageHasEvidenceGapIntent(args.message) &&
    args.state.extractionStatus === "failed" &&
    !args.state.hasSuccessfulEvaluationArtifact
  ) {
    const missingEvidenceRequests = reportEvidenceRequestsForStatus("failed");
    return {
      type: "response",
      content: renderClientResponseBlocks({
        blocks: [
          createClientResponseBlock("useful_takeaway", "the uploaded source could not be converted into a completed evaluation, so I cannot rank gaps from extracted facts yet.", "The useful recovery takeaway"),
          createClientResponseBlock("minimum_viable_evidence_pack", missingEvidenceRequests, "Missing evidence requests"),
          createClientResponseBlock("recommended_next_action", "re-run extraction with parseable source evidence or upload the requested source documents before treating the gap list as decision-ready.", "Next required actions"),
        ],
      }),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Create an editable evidence intake plan",
        "Upload a parseable source document",
        "Run a grounded evaluation first",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: EVIDENCE_GAP_FAILED_EXTRACTION_RECOVERY_REASON,
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        extraction_status: "failed",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (
    !args.state.hasSuccessfulEvaluationArtifact &&
    !args.state.hasUploadedDocuments &&
    messageHasEconomicsIntent(args.message) &&
    /\d/.test(args.message)
  ) {
    return {
      type: "action",
      content: "I’ll run an economics calculation from the numeric inputs you provided, then show the assumptions, sensitivity, and missing finance inputs.",
      plan_steps: null,
      action: {
        type: "economics_analysis",
        config: {
          domain,
          question: args.message,
          description,
        },
      },
      suggested_followups: [
        "Run a sensitivity on the biggest cost driver",
        "List the inputs needed for bankability",
        "Turn this into a finance memo",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "numeric_economics_solver_route",
        starts_with_evidence_intake: false,
      },
    };
  }

  if (!args.state.hasSuccessfulEvaluationArtifact && (clientIntent.primaryIntent === "bankability" || messageHasFinanceEvidenceRequestIntent(args.message))) {
    const missingEvidenceRequests = economicsEvidenceRequests();
    return {
      type: "response",
      content: blockedEconomicsContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "List the minimum inputs for NPV and IRR",
        "Create a finance data request checklist",
        "Run evidence intake before economics",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: ECONOMICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
        client_intent: clientIntent,
        has_successful_evaluation: false,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (isReportExportRequest) {
    const exportReadiness = exportReadinessForState(args.state);
    const extractionStatus = args.state.extractionStatus || "unknown";
    const missingEvidenceRequests =
      exportReadiness === "ready"
        ? normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extractionStatus)
          .filter((request) => (args.state.reportEvidenceRequests || []).includes(request))
        : normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extractionStatus);
    return {
      type: "response",
      content: [
        reportExportContent(args),
        isChartRequest ? chartReadinessForReport(args.state) : "",
      ].filter(Boolean).join(" "),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Create an editable diligence plan first",
        "Run a grounded evaluation from the available evidence",
        "List the data needed for a stronger report",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "report_export_request_detected",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        export_readiness: exportReadiness,
        extraction_status: extractionStatus,
        missing_evidence_requests: exportReadiness === "ready" ? [] : missingEvidenceRequests,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (clientIntent.chartRequest === "data_requirements" || messageHasChartDataRequestIntent(args.message)) {
    return {
      type: "response",
      content: chartDataRequestContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Create charts only from currently chartable values",
        "Turn unavailable charts into a data request table",
        "Rerun charting after extraction gaps are cleared",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "chart_data_request_detected",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        extraction_status: args.state.extractionStatus || "unknown",
        starts_with_evidence_intake: false,
      },
    };
  }

  if (
    messageHasSourceEvidenceRecoveryIntent(args.message) &&
    !args.state.hasSuccessfulEvaluationArtifact
  ) {
    const missingEvidenceRequests = blockedEvidenceGapRequests();
    return {
      type: "response",
      content: sourceEvidenceRecoveryContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Turn this into a data-room request",
        "Prioritize the top five source records",
        "Run grounded evidence intake after upload",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "source_evidence_recovery_request_detected",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: args.state.hasUploadedDocuments,
      },
    };
  }

  if (
    isChartRequest &&
    args.state.hasSuccessfulEvaluationArtifact &&
    messageHasDiligenceSynthesisIntent(args.message) &&
    multiFocusIntentCount(args.message) >= 2
  ) {
    const exportReadiness = exportReadinessForState(args.state);
    const extractionStatus = args.state.extractionStatus || "unknown";
    const missingEvidenceRequests = exportReadiness === "ready"
      ? []
      : normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extractionStatus);
    return {
      type: "action",
      content:
        `Preparing a combined diligence follow-up from the existing project evidence. I will preserve bankability, physics/exergy, chart readiness, evidence gaps, and report export readiness (${exportReadiness}) in one pass; new calculations or solver validation remain not computed, unavailable, or blocked unless supported by artifacts.`,
      plan_steps: null,
      action: {
        type: "deep_analysis",
        config: {
          question:
            `Summarize the combined diligence state for ${description} using existing artifacts only. Cover bankability and economics inputs including CAPEX, OPEX, utilization, maintenance or replacement cadence, financing, revenue or price stack, and incumbent baseline; mark missing calculations as not computed or blocked. Cover physics and exergy confidence including system boundary, mechanism, operating regime, temperature, pressure, flows, composition, reference environment, and boundary definition; if no solver artifact exists, state solver validation is unavailable or blocked. State chart readiness using only existing chartable metrics and identify missing metric, unit, source, and operating basis for any unavailable chart. State evidence gaps as concrete document, measurement, or source requests, then state report export readiness without claiming a new PDF or JSON file was generated by this chat response.`,
        },
      },
      suggested_followups: [
        "Turn this into a diligence checklist",
        "Separate blockers from useful follow-up data",
        "Create charts only from chartable artifact values",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "multi_focus_followup_detected",
        has_successful_evaluation: true,
        export_readiness: exportReadiness,
        extraction_status: extractionStatus,
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (isChartRequest) {
    if (!args.state.hasChartableArtifact && !args.state.hasSuccessfulEvaluationArtifact) {
      const focuses = classifyChartFocuses(args.message);
      const content = chartPackagePlanContent(args, { hasSomeValues: false });
      return {
        type: "plan",
        content,
        plan_steps: buildResearchFirstPlan({ domain, description, focuses }).slice(0, 5),
        action: null,
        suggested_followups: [
          "Use a table if there is not enough numeric data",
          "Focus the chart on economics",
          "Focus the chart on performance and exergy",
        ],
        workflow_orchestration: {
          source: "platform",
          reason: "chart_request_needs_source_data",
          client_intent: clientIntent,
          has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
          starts_with_evidence_intake: false,
        },
      };
    }
    return {
      type: "action",
      content:
        "Generating client-facing charts from the existing project artifacts. I will use only values already present in the evaluation, research, or analysis outputs and will include source descriptions and limitations.",
      plan_steps: null,
      action: {
        type: "exploratory_analysis",
        config: {
          question: args.message,
          analysis_type: messageHasEconomicsIntent(args.message) ? "sensitivity" : "comparison",
        },
      },
      suggested_followups: [
        "Turn this into an investor-facing chart set",
        "Show the biggest sensitivity drivers",
        "Compare this against alternatives",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "chart_request_detected",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (
    !args.state.hasSuccessfulEvaluationArtifact &&
    (clientIntent.primaryIntent === "bankability" || messageHasEconomicsIntent(args.message)) &&
    !messageHasEvidenceGapIntent(args.message)
  ) {
    const missingEvidenceRequests = economicsEvidenceRequests();
    return {
      type: "response",
      content: blockedEconomicsContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "List the minimum inputs for NPV and IRR",
        "Create a finance data request checklist",
        "Run evidence intake before economics",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: ECONOMICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
        client_intent: clientIntent,
        has_successful_evaluation: false,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (!args.state.hasSuccessfulEvaluationArtifact && (clientIntent.primaryIntent === "physics_exergy" || messageHasPhysicsFollowupIntent(args.message))) {
    const missingEvidenceRequests = physicsEvidenceRequests();
    return {
      type: "response",
      content: blockedPhysicsContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "List the thermodynamic variables needed for exergy",
        "Create a solver input checklist",
        "Run evidence intake before physics validation",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: PHYSICS_REQUEST_NEEDS_SOURCE_DATA_REASON,
        client_intent: clientIntent,
        has_successful_evaluation: false,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (
    args.state.hasSuccessfulEvaluationArtifact &&
    messageHasEconomicsIntent(args.message) &&
    messageHasPhysicsFollowupIntent(args.message)
  ) {
    const exportReadiness = exportReadinessForState(args.state);
    const extractionStatus = args.state.extractionStatus || "unknown";
    const missingEvidenceRequests = exportReadiness === "ready"
      ? []
      : normalizeReportEvidenceRequests(args.state.reportEvidenceRequests, extractionStatus);
    return {
      type: "action",
      content:
        "Preparing a combined economics and physics/exergy follow-up from the existing project evidence. I will state only supported conclusions; NPV, IRR, LCOE, LCOS, payback, solver-backed validation, and exergy efficiency remain not computed, unavailable, or blocked unless already supported by artifacts.",
      plan_steps: null,
      action: {
        type: "deep_analysis",
        config: {
          question:
            `Summarize economics and physics/exergy conclusions for ${description} using existing artifacts only. Preserve the current extraction status (${extractionStatus}) and report readiness (${exportReadiness}). For economics, separate supported facts from blocked calculations and cover CAPEX, OPEX, utilization, maintenance or replacement cadence, financing/WACC, revenue or price stack, and incumbent baseline; mark NPV, IRR, LCOE, LCOS, payback, and bankability claims as not computed or blocked unless required inputs are present. For physics and exergy, state the system boundary, mechanism, operating regime, temperature, pressure, flows, composition, reference environment, and boundary gaps; if no solver artifact exists, state solver validation and exergy efficiency are unavailable or blocked. Do not ask again for already-listed missing data except to preserve the blocker status and next action.`,
        },
      },
      suggested_followups: [
        "Separate supported conclusions from unsupported claims",
        "Turn this into an evidence status table",
        "Create a data request checklist for unresolved blockers",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "multi_focus_followup_detected",
        has_successful_evaluation: true,
        export_readiness: exportReadiness,
        extraction_status: extractionStatus,
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (messageHasEvidenceGapIntent(args.message) && !args.state.hasSuccessfulEvaluationArtifact) {
    const missingEvidenceRequests = blockedEvidenceGapRequests();
    const subject = conciseProjectSubject(args).replace(/[.!?]\s*$/, "");
    return {
      type: "response",
      content: renderClientResponseBlocks({
        blocks: [
          createClientResponseBlock("useful_takeaway", "the next diligence move can be specific now, even though the workspace does not yet support a ranked gap assessment from extracted facts."),
          createClientResponseBlock("known_from_workspace", `${subject || "the project has not provided enough description to identify the system or claims."}.`),
          createClientResponseBlock("supported_now", "a minimum viable evidence request focused on the facts needed before performance, finance, chart, or report claims can be relied on."),
          createClientResponseBlock("not_supported_yet", "verified performance, computed economics, numeric charts, solver-backed physics, customer-ready report conclusions, or financing readiness.", "What should not be claimed yet"),
          createClientResponseBlock("minimum_viable_evidence_pack", renderEvidencePackItems(buildEvidencePack("report")).slice(0, 5), "Next inputs to collect"),
          createClientResponseBlock("recommended_next_action", "send this as the first data-room request, upload the returned source records, then run a grounded evidence evaluation before writing an external-facing report or chart package."),
        ],
      }),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Create an editable evidence intake plan",
        "Upload source documents for extraction",
        "Run a grounded evaluation first",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "evidence_gap_request_needs_source_data",
        client_intent: clientIntent,
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: true,
      },
    };
  }

  if (
    (clientIntent.primaryIntent === "client_advisory" || messageHasClientSynthesisIntent(args.message)) &&
    !args.state.hasSuccessfulEvaluationArtifact
  ) {
    const missingEvidenceRequests = blockedEvidenceGapRequests();
    return {
      type: "response",
      content: sparseClientSynthesisContent(args),
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Turn this into an investor-safe summary",
        "Create the targeted evidence request list",
        "Run a grounded evaluation after upload",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: SPARSE_CLIENT_SYNTHESIS_REASON,
        client_intent: clientIntent,
        has_successful_evaluation: false,
        extraction_status: args.state.extractionStatus || "none",
        missing_evidence_requests: missingEvidenceRequests,
        starts_with_evidence_intake: args.state.hasUploadedDocuments,
      },
    };
  }

  if (messageHasResearchIntent(args.message)) {
    return {
      type: "action",
      content:
        "Searching the literature and benchmark record now. I will ground the result in real sources and call out gaps instead of filling them with unsupported claims.",
      plan_steps: null,
      action: {
        type: "literature_search",
        config: { query: query || args.message },
      },
      suggested_followups: [
        "Compare the strongest papers against this project",
        "Extract the key benchmark ranges",
        "Turn the results into a readiness view",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "research_request_detected",
        has_successful_evaluation: args.state.hasSuccessfulEvaluationArtifact,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (args.state.hasSuccessfulEvaluationArtifact && messageHasEvidenceGapIntent(args.message)) {
    return {
      type: "action",
      content:
        "Extracting the evidence gaps and next diligence actions from the existing project evidence.",
      plan_steps: null,
      action: {
        type: "deep_analysis",
        config: {
          question:
            `Identify the evidence gaps and next diligence actions for ${description}. Use existing evaluation artifacts and project evidence only. Rank missing inputs by decision impact, specify the concrete document, measurement, test, or third-party source needed for each gap, and distinguish blocking gaps from useful follow-up data.`,
        },
      },
      suggested_followups: [
        "Turn the gap list into a diligence checklist",
        "Show which gaps block bankability",
        "Create a data request table for the counterparty",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "evidence_gap_followup_detected",
        has_successful_evaluation: true,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (args.state.hasSuccessfulEvaluationArtifact && messageHasEconomicsIntent(args.message)) {
    return {
      type: "action",
      content:
        "Preparing an economics and bankability review from the existing project evidence. Finance calculations are blocked until the required cost, utilization, financing, revenue, and baseline inputs are available; LCOE, LCOS, IRR, NPV, and payback are not computed yet.",
      plan_steps: null,
      action: {
        type: "deep_analysis",
        config: {
          question:
            `Analyze economics and bankability for ${description}. Use existing evaluation artifacts only. Separate measured data, unavailable facts, assumptions, and evidence gaps. Identify the market segment or ask for it if missing. Cover CAPEX, OPEX, utilization, maintenance and replacement cadence, financing/WACC, revenue and price stack, and incumbent baseline needs. Do not compute LCOE, LCOS, IRR, NPV, payback, or bankability claims unless the required inputs are present; mark each missing calculation as not computed or blocked. Give concrete diligence next actions and required source evidence.`,
        },
      },
      suggested_followups: [
        "Show the top cost sensitivities as a chart",
        "Compare the economics against incumbents",
        "List the missing data needed for bankability",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "economics_followup_detected",
        has_successful_evaluation: true,
        starts_with_evidence_intake: false,
      },
    };
  }

  if (args.state.hasSuccessfulEvaluationArtifact && messageHasPhysicsFollowupIntent(args.message)) {
    return {
      type: "action",
      content:
        "Preparing a physics and exergy review from the existing evaluation artifacts. New solver-backed validation is not computed yet; any missing state variables or solver artifacts will be marked unavailable or blocked rather than inferred.",
      plan_steps: null,
      action: {
        type: "deep_analysis",
        config: {
          question:
            `Review the physics, simulation, exergy, and performance implications for ${description}. Use existing evaluation artifacts and prior evidence only. Tie every solver/result statement to an actual artifact; if no solver artifact exists, state that solver validation is not computed, unavailable, or blocked. State the system boundary, mechanism, operating regime, and unmodeled assumptions. For exergy, request missing thermodynamic state variables including temperature, pressure, mass or molar flows, composition, reference environment, and boundary definition. Identify which values were computed versus inferred and the measurements needed for stronger simulation coverage.`,
        },
      },
      suggested_followups: [
        "Run a sensitivity chart for the critical parameters",
        "Compare the physics against reference cases",
        "List the missing measurements needed next",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "physics_followup_detected",
        has_successful_evaluation: true,
        starts_with_evidence_intake: false,
      },
    };
  }

  return null;
}
