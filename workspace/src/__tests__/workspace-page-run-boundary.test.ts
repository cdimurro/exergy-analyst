import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(process.cwd(), "src/app/projects/[id]/page.tsx"),
  "utf8",
);

describe("workspace page run boundary", () => {
  it("does not recover chat results by guessing action timestamps", () => {
    expect(pageSource).not.toContain("actions?action_id");
    expect(pageSource).not.toContain("recoveredActionIdsRef");
    expect(pageSource).not.toMatch(/project\?\.actions\?\.length[\s\S]{0,1200}loadingMsg/);
  });

  it("does not execute legacy tools from chat retry, plan approval, or canvas actions", () => {
    expect(pageSource).not.toContain("runLegacyToolAction(m.failedAction");
    expect(pageSource).not.toMatch(/runPlan\(m\.id/);
    expect(pageSource).not.toContain("await runLegacyToolAction(r.action");
    expect(pageSource).toContain("DURABLE_RUN_REQUIRED_MESSAGE");
  });

  it("submits normal chat through durable server-owned runs", () => {
    expect(pageSource).toContain("fetch(`/api/projects/${id}/runs`");
    expect(pageSource).toContain('mode: "implement"');
    expect(pageSource).toContain('thinking_level: "expert"');
  });
});
