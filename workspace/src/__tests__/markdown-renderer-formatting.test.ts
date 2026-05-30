import { isLongMarkdownTableCell, normalizeMarkdownForDisplay } from "@/components/MarkdownRenderer";

describe("normalizeMarkdownForDisplay", () => {
  it("repairs collapsed workspace report markdown into sections and tables", () => {
    const collapsed = "# Analysis Run ## Direct Answer The model completed. ## 20-Year Sensitivity | Case | Cost | |---|---:| | Base | USD 1/kg | | High | USD 2/kg | Downloads - [Download report.md](/file)";

    const normalized = normalizeMarkdownForDisplay(collapsed);

    expect(normalized).not.toContain("# Analysis Run");
    expect(normalized).toContain("## Executive Summary\nThe model completed.");
    expect(normalized).toContain("## 20-Year Sensitivity\n| Case | Cost |");
    expect(normalized).toContain("| Base | USD 1/kg |");
  });

  it("turns collapsed bold technical sections into readable headings", () => {
    const collapsed = "**How I calculated it** I used the saved run. **Assumptions made** Base power price was provided. **Limits** This is screening only.";

    const normalized = normalizeMarkdownForDisplay(collapsed);

    expect(normalized).toContain("## How I calculated it\nI used the saved run.");
    expect(normalized).toContain("## Assumptions made\nBase power price was provided.");
    expect(normalized).toContain("## Limits\nThis is screening only.");
  });

  it("marks paragraph-length table cells as long cells", () => {
    expect(isLongMarkdownTableCell("Short value")).toBe(false);
    expect(isLongMarkdownTableCell("This cell contains a full explanatory paragraph that should wrap in a constrained column instead of stretching the entire result table beyond a readable width.")).toBe(true);
  });
});
