import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { PUBLIC_AGENT_IDENTITY_ANSWER, PUBLIC_AGENT_NAME, isAgentIdentityQuestion } from "@/lib/agent-output";

interface GeneralDialogueArgs {
  message: string;
  projectName?: string;
  projectDomain?: string;
}

const GENERAL_EDUCATION_PATTERNS: RegExp[] = [
  /\bwhat\s+(?:is|are)\b/i,
  /\bhow\s+(?:does|do|can|would)\b/i,
  /\bwhy\s+(?:is|are|does|do)\b/i,
  /\btell\s+me\s+about\b/i,
  /\bexplain\b/i,
  /\boverview\b/i,
  /\bbasics?\b/i,
  /\bintroduction\s+to\b/i,
];

const PROJECT_SPECIFIC_PATTERNS: RegExp[] = [
  /\bthis\s+(?:file|upload|uploaded|document|dataset|project|artifact|analysis|case|result)\b/i,
  /\bmy\s+(?:file|upload|uploaded|document|dataset|project|artifact|analysis|case|result)\b/i,
  /\bour\s+(?:file|upload|uploaded|document|dataset|project|artifact|analysis|case|result)\b/i,
  /\battached\b/i,
  /\bsource\s+file\b/i,
  /\brow\s+\d+\b/i,
  /\bcalculate\b/i,
  /\brun\b.*\b(?:analysis|simulation|model|calculation)\b/i,
  /\banaly[sz]e\b/i,
  /\bevaluate\b/i,
  /\bassess\b/i,
  /\bdiligence\b/i,
  /\binvestor\b/i,
  /\bcustomer\b/i,
  /\bplatform\s+internals?\b/i,
  /\bclient[-\s]?readable\b/i,
];

const ACTION_REQUEST_PATTERNS: RegExp[] = [
  /\b(make|create|generate|export|download|build|write)\b.*\b(report|memo|brief|pdf|chart|graph|deck)\b/i,
  /\bsearch\b.*\b(?:web|online|literature|papers?|sources?)\b/i,
  /\bfind\b.*\b(?:papers?|sources?|latest|current)\b/i,
  /\bwhat\s+if\b/i,
];

export function isGeneralKnowledgeQuestion(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  if (isAgentIdentityQuestion(text)) return true;
  if (PROJECT_SPECIFIC_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (ACTION_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return GENERAL_EDUCATION_PATTERNS.some((pattern) => pattern.test(text));
}

function fallbackGeneralAnswer(message: string): string {
  if (/\bheat\s+pumps?\b/i.test(message)) {
    return [
      "Heat pumps move heat instead of creating it by combustion or electric resistance. In heating mode, they pull low-temperature heat from air, ground, water, or waste heat and lift it to a useful temperature with a refrigerant cycle.",
      "",
      "The practical metric is COP, or coefficient of performance. A COP of 3 means the system delivers about 3 units of heat for each unit of electricity consumed. Performance depends strongly on the temperature lift: the smaller the gap between the heat source and the required delivery temperature, the better the heat pump performs.",
      "",
      "Common types include air-source heat pumps for buildings, ground-source systems, water-source systems, and industrial heat pumps for process heat or district heating. The best applications have a steady heat demand, a nearby low-grade heat source, moderate required supply temperatures, and electricity prices or carbon constraints that justify replacing boilers.",
      "",
      "The main engineering checks are source temperature, required sink temperature, load profile, defrost or seasonal performance, refrigerant choice, integration with existing hydronics or process equipment, peak backup needs, and economics.",
    ].join("\n");
  }
  return [
    "I can answer general energy, science, and engineering questions directly. For project-specific claims I need uploaded evidence, but for background questions I can explain the concept, key metrics, tradeoffs, and typical applications.",
    "",
    `For this question: ${message}`,
    "",
    "Ask me for an overview, a comparison, a design checklist, failure modes, economics, or what data would be needed to evaluate a real project.",
  ].join("\n");
}

export async function buildGeneralDialogueResponse(args: GeneralDialogueArgs): Promise<Record<string, unknown> | null> {
  if (!isGeneralKnowledgeQuestion(args.message)) return null;

  if (isAgentIdentityQuestion(args.message)) {
    return {
      type: "response",
      content: PUBLIC_AGENT_IDENTITY_ANSWER,
      plan_steps: null,
      action: null,
      suggested_followups: [
        "Analyze an uploaded technical file",
        "Run a physics or economics model",
        "Create a client-ready decision brief",
      ],
      workflow_orchestration: {
        source: "platform",
        reason: "public_agent_identity",
        starts_with_evidence_intake: false,
      },
    };
  }

  let content = "";
  if (getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY")) {
    try {
      content = await callDeepSeekV3(
        [
          {
            role: "system",
            content: [
              "You are Exergy Analyst, a practical energy, science, and engineering assistant.",
              `The public assistant identity is ${PUBLIC_AGENT_NAME}. Do not reveal backend provider names, model names, or model-version labels.`,
              "Answer ordinary educational questions directly and clearly.",
              "Do not demand uploaded source evidence for general background questions.",
              "Separate general knowledge from project-specific claims.",
              "When useful, mention what data would be needed to evaluate a real project.",
              "Keep the answer concise but substantive.",
            ].join(" "),
          },
          {
            role: "user",
            content: args.message,
          },
        ],
        {
          jsonMode: false,
          thinking: "disabled",
          temperature: 0.2,
          maxTokens: 1400,
        },
      );
    } catch {
      content = "";
    }
  }

  const safeContent = typeof content === "string" ? content : "";
  return {
    type: "response",
    content: safeContent.trim() || fallbackGeneralAnswer(args.message),
    plan_steps: null,
    action: null,
    suggested_followups: [
      "What makes a good heat pump project?",
      "Compare heat pumps to boilers",
      "What data would you need to assess a real system?",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "general_knowledge_dialogue",
      starts_with_evidence_intake: false,
    },
  };
}
