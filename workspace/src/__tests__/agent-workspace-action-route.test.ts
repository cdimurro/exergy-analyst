import { readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_ROUTE_PATH = join(
  __dirname,
  "..",
  "app",
  "api",
  "projects",
  "[id]",
  "actions",
  "route.ts",
);

const routeSource = readFileSync(ACTIONS_ROUTE_PATH, "utf-8");
const fileRouteSource = readFileSync(
  join(
    __dirname,
    "..",
    "app",
    "api",
    "projects",
    "[id]",
    "artifacts",
    "[artifactId]",
    "files",
    "route.ts",
  ),
  "utf-8",
);

describe("agent workspace action route", () => {
  it("exposes the long-running workspace execution action", () => {
    expect(routeSource).toContain('case "agent_workspace"');
    expect(routeSource).toContain("handleAgentWorkspace");
    expect(routeSource).toContain("runAgentWorkspaceTask");
  });

  it("stores generated workspace runs as inspectable artifacts", () => {
    expect(routeSource).toContain('type: "workspace_run"');
    expect(routeSource).toContain("generated_code");
    expect(routeSource).toContain("process_steps");
    expect(routeSource).toContain("security_findings");
    expect(routeSource).toContain("sandbox_mode");
  });

  it("supports background action polling for long-running client workloads", () => {
    expect(routeSource).toContain("executeActionRecord");
    expect(routeSource).toContain("body.async === true");
    expect(routeSource).toContain("status: \"running\"");
    expect(routeSource).toContain('request.nextUrl.searchParams.get("action_id")');
    expect(routeSource).toContain("result_summary");
  });

  it("serves generated files only when listed on the artifact and inside runtime", () => {
    expect(fileRouteSource).toContain("listedOutputPath");
    expect(fileRouteSource).toContain("resolved.startsWith(runtimeRoot)");
    expect(fileRouteSource).toContain("Content-Disposition");
  });
});
