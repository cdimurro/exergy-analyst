import { latestConversationAttachmentNames } from "@/lib/agent-context-hygiene";

export interface AgentConversationMemory {
  currentFiles: string[];
  assumptions: string[];
  presentationPreferences: string[];
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function buildConversationMemory(
  history: Array<{ role?: string; content?: string }> | null | undefined,
  message = "",
): AgentConversationMemory {
  const entries = [...(history || []), { role: "user", content: message }]
    .filter((entry) => entry.role === "user" && typeof entry.content === "string")
    .slice(-12);
  const assumptions: string[] = [];
  const presentationPreferences: string[] = [];

  for (const entry of entries) {
    const content = entry.content || "";
    for (const match of content.matchAll(/\b(?:assume|use|take)\s+([\s\S]{8,180}?)(?:[.!?](?:\s+[A-Z]|$)|\n|$)/gi)) {
      const value = clean(match[1] || "");
      if (value && !/\b(attached|uploaded)\b/i.test(value)) assumptions.push(value);
    }
    if (/\b(simple|plain|concise|no\s+caveats|don't\s+mention\s+caveats|do\s+not\s+mention\s+caveats)\b/i.test(content)) {
      presentationPreferences.push("Prefer a direct, plain-language answer before details.");
    }
    if (/\b(no\s+view\s+details|no\s+export\s+report|no\s+screening|no\s+triage|hide\s+internal|don't\s+show\s+internal)\b/i.test(content)) {
      presentationPreferences.push("Do not show internal report-card labels or platform UI language in chat.");
    }
    if (/\b(plan\s+mode|wait\s+for\s+approval|do\s+not\s+run|don't\s+run)\b/i.test(content)) {
      presentationPreferences.push("Hold execution for approval when the user asks for plan-only behavior.");
    }
  }

  const dedupe = (items: string[]) => Array.from(new Set(items.map(clean).filter(Boolean))).slice(0, 5);
  return {
    currentFiles: latestConversationAttachmentNames(history, message),
    assumptions: dedupe(assumptions),
    presentationPreferences: dedupe(presentationPreferences),
  };
}

export function renderConversationMemory(memory: AgentConversationMemory): string {
  const lines = [
    memory.currentFiles.length ? `Current working files: ${memory.currentFiles.join(", ")}` : "",
    memory.assumptions.length ? `User-stated assumptions: ${memory.assumptions.join("; ")}` : "",
    memory.presentationPreferences.length ? `User preferences: ${memory.presentationPreferences.join("; ")}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "No durable conversation memory inferred yet.";
}
