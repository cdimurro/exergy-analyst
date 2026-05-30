import {
  artifactMentionsAnyAttachment,
  currentTurnAttachmentNames,
  latestConversationAttachmentNames,
  staleArtifactNotice,
} from "@/lib/agent-context-hygiene";
import type { Artifact } from "@/lib/storage/types";

function artifact(title: string, summary: string): Artifact {
  return {
    id: "art_1",
    schema_version: 1,
    type: "evaluation",
    title,
    summary,
    content: { client_summary: { conclusion: summary } },
    source: "canonical_engine",
    raw: {},
    metadata: {},
    action_id: "act_1",
    provenance: { source: "canonical_engine", deterministic: true },
    created_at: "2026-05-24T00:00:00Z",
    pinned: false,
  };
}

describe("agent context hygiene", () => {
  it("distinguishes current-turn attachments from older conversation attachments", () => {
    const history = [
      { role: "user", content: "Analyze this.\n\n[Attached: old.pdf]" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "Now compare the result." },
    ];

    expect(currentTurnAttachmentNames(history, "Now compare the result.")).toEqual([]);
    expect(latestConversationAttachmentNames(history, "Now compare the result.")).toEqual(["old.pdf"]);
  });

  it("filters stale artifact summaries when a new attachment is present", () => {
    const stale = artifact("Fischer Tropsch summary", "This is a Fischer-Tropsch information sheet.");
    const current = artifact("OxEon SOEC summary", "The oxeon SOEC info sheet rev2.pdf describes solid oxide electrolysis.");

    expect(artifactMentionsAnyAttachment(stale, ["oxeon SOEC info sheet rev2.pdf"])).toBe(false);
    expect(artifactMentionsAnyAttachment(current, ["oxeon SOEC info sheet rev2.pdf"])).toBe(true);
  });

  it("produces an explicit context notice when older artifacts are omitted", () => {
    const notice = staleArtifactNotice({
      currentAttachments: ["new deck.pdf"],
      totalArtifacts: 3,
      includedArtifacts: 1,
    });

    expect(notice).toContain("2 older artifacts omitted");
    expect(notice).toContain("Do not reuse older conclusions");
  });
});
