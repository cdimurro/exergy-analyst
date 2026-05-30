import { buildConversationMemory, renderConversationMemory } from "@/lib/agent-memory";

describe("agent conversation memory", () => {
  it("captures current files, assumptions, and presentation preferences from recent user turns", () => {
    const memory = buildConversationMemory([
      { role: "user", content: "Analyze this.\n\n[Attached: plant deck.pdf]" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "Assume gas price is 4.25 USD/MMBtu and keep the answer simple. No View Details or Export Report." },
    ], "Now calculate economics.");

    expect(memory.currentFiles).toEqual(["plant deck.pdf"]);
    expect(memory.assumptions).toContain("gas price is 4.25 USD/MMBtu and keep the answer simple");
    expect(memory.presentationPreferences).toEqual(expect.arrayContaining([
      "Prefer a direct, plain-language answer before details.",
      "Do not show internal report-card labels or platform UI language in chat.",
    ]));
    expect(renderConversationMemory(memory)).toContain("Current working files: plant deck.pdf");
  });
});
