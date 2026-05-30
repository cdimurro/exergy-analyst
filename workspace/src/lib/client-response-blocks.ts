export type ClientResponseBlockType =
  | "useful_takeaway"
  | "known_from_workspace"
  | "evidence_basis"
  | "supported_now"
  | "not_supported_yet"
  | "decision_implication"
  | "evidence_needed"
  | "minimum_viable_evidence_pack"
  | "chart_package_plan"
  | "report_memo_readiness"
  | "bankability_guidance"
  | "physics_exergy_advisory"
  | "recommended_next_action";

export interface ClientResponseBlock {
  type: ClientResponseBlockType;
  title: string;
  body?: string;
  bullets?: string[];
}

export interface ClientResponseDraft {
  blocks: ClientResponseBlock[];
}

const CLIENT_LABELS: Record<ClientResponseBlockType, string> = {
  useful_takeaway: "Useful takeaway",
  known_from_workspace: "What I found",
  evidence_basis: "Source basis",
  supported_now: "Key facts",
  not_supported_yet: "Important limits",
  decision_implication: "Decision implication",
  evidence_needed: "Next inputs to collect",
  minimum_viable_evidence_pack: "Data request",
  chart_package_plan: "Chart package plan",
  report_memo_readiness: "Report readiness",
  bankability_guidance: "Bankability guidance",
  physics_exergy_advisory: "Physics and exergy view",
  recommended_next_action: "Recommended next action",
};

function cleanClientLabel(label: string): string {
  const text = (label || "").trim();
  if (!text) return "Details";
  if (/\bclaim interrogation|claim status|hidden residual|identified set|performance claims?\b/i.test(text)) {
    return "Technical notes";
  }
  return text.trim();
}

function cleanClientText(text: string): string {
  return text
    .replace(/\bunsupported[-\s]?claim list\b/gi, "Statements needing evidence")
    .replace(/\bclaim text\b/gi, "statement text")
    .replace(/\bclaim boundary\b/gi, "external wording boundary")
    .replace(/\bclaim status(?: ladder)?\b/gi, "review status")
    .replace(/\bhidden residuals?\b/gi, "remaining model error")
    .replace(/\bidentified sets?\b/gi, "bounded result ranges")
    .replace(/\bWhat should not be claimed yet\b/gi, "Important limits")
    .replace(/\bWhat the provided material supports now\b/gi, "Key facts")
    .trim();
}

export function createClientResponseBlock(
  type: ClientResponseBlockType,
  bodyOrBullets: string | string[],
  title = CLIENT_LABELS[type],
): ClientResponseBlock {
  const cleanTitle = cleanClientLabel(title);
  if (Array.isArray(bodyOrBullets)) {
    return { type, title: cleanTitle, bullets: bodyOrBullets.map(cleanClientText).filter(Boolean) };
  }
  return { type, title: cleanTitle, body: cleanClientText(bodyOrBullets) };
}

export function renderClientResponseBlocks(draft: ClientResponseDraft): string {
  return draft.blocks
    .map((block) => {
      const title = cleanClientLabel(block.title);
      const body = block.body ? cleanClientText(block.body) : "";
      const lines = [`**${title}:**${body ? ` ${body}` : ""}`];
      if (block.bullets?.length) {
        lines.push(...block.bullets.map((bullet) => `- ${cleanClientText(bullet).replace(/\.$/, "")}.`));
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export function collectBlockTypes(draft: ClientResponseDraft): ClientResponseBlockType[] {
  return draft.blocks.map((block) => block.type);
}
