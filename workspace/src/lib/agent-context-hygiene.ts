import type { Artifact } from "@/lib/storage/types";

export function attachmentNamesFromText(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/\[Attached:\s*([^\]]+)\]/gi)) {
    for (const name of (match[1] || "").split(/\s*,\s*/)) {
      const clean = name.trim();
      if (clean) names.push(clean);
    }
  }
  return Array.from(new Set(names));
}

export function currentTurnAttachmentNames(
  history: Array<{ role?: string; content?: string }> | null | undefined,
  message = "",
): string[] {
  const entries = [...(history || [])].reverse();
  const latestUser = entries.find((entry) => entry.role === "user");
  const latestNames = latestUser ? attachmentNamesFromText(latestUser.content || "") : [];
  return latestNames.length > 0 ? latestNames : attachmentNamesFromText(message);
}

export function latestConversationAttachmentNames(
  history: Array<{ role?: string; content?: string }> | null | undefined,
  message = "",
): string[] {
  const entries = [...(history || [])].reverse();
  for (const entry of entries) {
    if (entry.role !== "user") continue;
    const names = attachmentNamesFromText(entry.content || "");
    if (names.length > 0) return names;
  }
  return attachmentNamesFromText(message);
}

function tokensForAttachment(name: string): string[] {
  const stopwords = new Set([
    "info",
    "sheet",
    "spec",
    "data",
    "deck",
    "report",
    "document",
    "pdf",
    "rev",
    "rev1",
    "rev2",
    "final",
  ]);
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4 && !stopwords.has(token));
}

export function artifactMentionsAnyAttachment(
  artifact: Artifact,
  attachmentNames: string[],
): boolean {
  if (attachmentNames.length === 0) return true;
  const compact = JSON.stringify({
    title: artifact.title,
    summary: artifact.summary,
    metadata: artifact.metadata,
    content: artifact.content,
  }).toLowerCase();
  return attachmentNames.some((name) => {
    const lowerName = name.toLowerCase();
    if (compact.includes(lowerName)) return true;
    const tokens = tokensForAttachment(name);
    if (tokens.length === 0) return false;
    const hits = tokens.filter((token) => compact.includes(token)).length;
    return hits >= Math.min(2, tokens.length);
  });
}

export function staleArtifactNotice(args: {
  currentAttachments: string[];
  totalArtifacts: number;
  includedArtifacts: number;
}): string {
  if (args.currentAttachments.length === 0 || args.totalArtifacts === args.includedArtifacts) return "";
  const omitted = args.totalArtifacts - args.includedArtifacts;
  return [
    `Context hygiene: ${omitted} older artifact${omitted === 1 ? "" : "s"} omitted because the current turn attached ${args.currentAttachments.join(", ")}.`,
    "Do not reuse older conclusions unless they explicitly match the current attachment or the user asks for a prior-result follow-up.",
  ].join(" ");
}
