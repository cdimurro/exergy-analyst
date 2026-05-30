import { readFile } from "fs/promises";

import { callDeepSeekV3, getEnvVar } from "@/lib/backend";
import { getProjectUploadPaths } from "@/lib/exergy-agent";
import type { Artifact, Project, ProjectDocument, StorageAdapter } from "@/lib/storage/types";
import {
  artifactMentionsAnyAttachment,
  currentTurnAttachmentNames,
  latestConversationAttachmentNames,
  staleArtifactNotice,
} from "@/lib/agent-context-hygiene";
import { buildConversationMemory, renderConversationMemory } from "@/lib/agent-memory";

interface WorkspaceAgentArgs {
  projectId: string;
  message: string;
  history?: Array<{ role?: string; content?: string }> | null;
  project: Project | null | undefined;
  storage: StorageAdapter;
}

const ACTIONISH_PATTERNS: RegExp[] = [
  /\b(analy[sz]e|evaluate|assess|run|simulate|calculate|process)\b.*\b(file|upload|uploaded|document|dataset|analysis|simulation|model|calculation|evidence)\b/i,
  /\b(full|complete|comprehensive|deep)\s+(analysis|assessment|evaluation|review)\b/i,
  /\b(create|make|generate|export|download|build)\b.*\b(report|pdf|brief|memo|deck|chart|graph|plot|dashboard)\b/i,
  /\b(search|find|pull|look up)\b.*\b(papers?|literature|sources?|online|web|latest|current)\b/i,
];

const CONVERSATIONAL_PATTERNS: RegExp[] = [
  /\bhello\b|\bhi\b|\bhey\b/i,
  /\bcan you help\b/i,
  /\bwhat\s+(?:is|are|does|do|would|should|can)\b/i,
  /\bwhich\b/i,
  /\bwhy\b/i,
  /\bhow\b/i,
  /\btell me\b/i,
  /\bexplain\b/i,
  /\boverview\b/i,
  /\bcompare\b/i,
  /\bwhat if\b/i,
];

function isConversationalTurn(message: string): boolean {
  const text = (message || "").trim();
  if (!text) return false;
  if (ACTIONISH_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return CONVERSATIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = oneLine(value);
    if (text) return text;
  }
  return "";
}

function artifactSummary(artifact: Artifact): string {
  const content = artifact.content || {};
  const summary = isRecord(content.client_summary) ? content.client_summary : {};
  const metrics = Array.isArray(summary.computed_metrics)
    ? summary.computed_metrics
      .filter(isRecord)
      .slice(0, 4)
      .map((metric) => `${firstText(metric.label)}=${firstText(metric.value)}`)
      .filter(Boolean)
      .join(", ")
    : "";
  const conclusion = firstText(summary.conclusion, content.executive_summary, artifact.summary);
  const notProven = Array.isArray(summary.not_proven) ? summary.not_proven.slice(0, 4).map(oneLine).filter(Boolean) : [];
  const dataRequests = Array.isArray(summary.data_requests)
    ? summary.data_requests
      .filter(isRecord)
      .slice(0, 4)
      .map((item) => firstText(item.request))
      .filter(Boolean)
    : [];
  return [
    `Artifact: ${artifact.title} (${artifact.type})`,
    conclusion ? `Conclusion: ${conclusion}` : "",
    metrics ? `Metrics: ${metrics}` : "",
    notProven.length ? `Not proven yet: ${notProven.join("; ")}` : "",
    dataRequests.length ? `Data requests: ${dataRequests.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function documentSummary(doc: ProjectDocument): string {
  const evidence = isRecord(doc.extraction_result?.document_evidence) ? doc.extraction_result.document_evidence : {};
  const facts = Array.isArray(evidence.headline_facts)
    ? evidence.headline_facts.map(oneLine).filter(Boolean).slice(0, 5)
    : [];
  return [
    `${doc.filename} (${doc.mime_type || "unknown"}, ${doc.size_bytes} bytes)`,
    facts.length ? `facts: ${facts.join("; ")}` : "",
  ].filter(Boolean).join(" - ");
}

async function inspectSourceFile(path: string): Promise<string> {
  const name = path.split("/").pop() || path;
  const lower = path.toLowerCase();
  const raw = await readFile(path, "utf-8").catch(() => "");
  if (!raw) return `${name}: unreadable or binary source.`;
  if (lower.endsWith(".csv")) {
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const header = lines[0] || "";
    const rows = lines.slice(1, 5);
    return [`${name}: CSV`, `columns: ${header}`, ...rows.map((row, index) => `row ${index + 1}: ${row}`)].join("\n");
  }
  if (lower.endsWith(".json")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        const keys = Object.keys(parsed).slice(0, 12);
        const artifacts = Array.isArray(parsed.artifacts) ? parsed.artifacts.length : 0;
        const documents = Array.isArray(parsed.documents) ? parsed.documents.length : 0;
        return `${name}: JSON keys=${keys.join(", ")}${artifacts ? `; artifacts=${artifacts}` : ""}${documents ? `; documents=${documents}` : ""}`;
      }
    } catch {
      return `${name}: JSON-like file, but parsing failed.`;
    }
  }
  return `${name}: text preview\n${raw.slice(0, 1200)}`;
}

async function buildToolContext(args: WorkspaceAgentArgs): Promise<string> {
  const latestAttachments = latestConversationAttachmentNames(args.history, args.message);
  const currentAttachments = currentTurnAttachmentNames(args.history, args.message);
  const [documents, artifactSummaries, uploadPaths] = await Promise.all([
    args.storage.listDocuments(args.projectId),
    args.storage.listArtifacts(args.projectId),
    getProjectUploadPaths(args.projectId, latestAttachments),
  ]);
  const loadedArtifacts = await Promise.all(
    artifactSummaries.slice(0, 8).map((artifact) => args.storage.getArtifact(args.projectId, artifact.id)),
  );
  const artifacts = loadedArtifacts
    .filter((artifact): artifact is Artifact => !!artifact)
    .filter((artifact) =>
      currentAttachments.length === 0 || artifactMentionsAnyAttachment(artifact, currentAttachments)
    )
    .slice(0, 4);
  const filePreviews = await Promise.all(uploadPaths.slice(0, 3).map(inspectSourceFile));
  const notice = staleArtifactNotice({
    currentAttachments,
    totalArtifacts: loadedArtifacts.filter(Boolean).length,
    includedArtifacts: artifacts.length,
  });
  const memory = buildConversationMemory(args.history, args.message);
  return [
    `Project: ${args.project?.name || "Untitled"}`,
    `Domain: ${args.project?.domain || "general"}`,
    args.project?.description ? `Description: ${args.project.description}` : "",
    `Conversation memory:\n${renderConversationMemory(memory)}`,
    documents.length ? `Uploaded files:\n${documents.map(documentSummary).join("\n")}` : "Uploaded files: none",
    notice,
    artifacts.length
      ? `Latest artifacts:\n${artifacts.map(artifactSummary).join("\n\n")}`
      : "Latest artifacts: none",
    filePreviews.length ? `Source previews:\n${filePreviews.join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

function fallbackAgentAnswer(message: string): string {
  if (/heat\s+pumps?/i.test(message)) {
    return [
      "Heat pumps move heat from a lower-temperature source to a higher-temperature sink using a vapor-compression or related thermodynamic cycle. They are useful because they move more heat than the electrical energy they consume.",
      "",
      "The key metric is COP. A COP of 3 means 1 kWh of electricity delivers about 3 kWh of heat. COP depends mainly on temperature lift: moving heat from 10 C to 40 C is much easier than moving it from -10 C to 90 C.",
      "",
      "For real projects, the important questions are source temperature, required supply temperature, load profile, integration constraints, electricity and fuel prices, refrigerant constraints, peak backup needs, and maintenance risk.",
    ].join("\n");
  }
  return "I can help with general engineering questions, inspect uploaded files, explain prior results, run analysis actions when needed, and turn evidence into client-ready recommendations.";
}

export async function buildWorkspaceAgentResponse(args: WorkspaceAgentArgs): Promise<Record<string, unknown> | null> {
  if (process.env.NODE_ENV === "test" && process.env.EXERGY_ENABLE_WORKSPACE_AGENT_IN_TEST !== "true") {
    return null;
  }
  if (!isConversationalTurn(args.message)) return null;

  const toolContext = await buildToolContext(args);
  let content = "";
  if (getEnvVar("DEEPSEEK_API_KEY") || getEnvVar("DEEPSEEK_V3_API_KEY")) {
    try {
      content = await callDeepSeekV3(
        [
          {
            role: "system",
            content: [
              "You are Exergy Analyst, a model-led workspace agent for energy, science, and engineering.",
              "You have already been given tool outputs from the workspace: uploaded files, source previews, and latest artifacts.",
              "Use those tool outputs when they are relevant. If the user asks a general educational question, answer normally.",
              "If the user asks for a project-specific conclusion, clearly separate what the workspace supports from what is missing.",
              "Do not invent source evidence. Do not say you cannot answer general background questions just because no file is uploaded.",
              "Keep the answer practical, direct, and conversational.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Workspace tool context:\n${toolContext}\n\nRecent conversation:\n${(args.history || []).slice(-8).map((item) => `${item.role || "user"}: ${item.content || ""}`).join("\n")}\n\nUser question:\n${args.message}`,
          },
        ],
        {
          jsonMode: false,
          thinking: "disabled",
          temperature: 0.2,
          maxTokens: 1800,
        },
      );
    } catch {
      content = "";
    }
  }

  const safeContent = typeof content === "string" ? content : "";
  return {
    type: "response",
    content: safeContent.trim() || fallbackAgentAnswer(args.message),
    plan_steps: null,
    action: null,
    suggested_followups: [
      "What data would you need to evaluate this?",
      "Explain the tradeoffs",
      "What should I do next?",
    ],
    workflow_orchestration: {
      source: "platform",
      reason: "workspace_agent_dialogue",
      starts_with_evidence_intake: false,
      tools_used: ["list_documents", "inspect_source_files", "summarize_artifacts"],
    },
  };
}
