jest.mock("@/lib/backend", () => ({
  getEnvVar: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
}));

jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
}));

import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { getEnvVar } from "@/lib/backend";
import { buildEnvironmentReadiness } from "../environment-readiness";

const mockGetEnvVar = getEnvVar as jest.MockedFunction<typeof getEnvVar>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

describe("environment readiness", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    mockGetEnvVar.mockReset();
    mockExistsSync.mockReset();
    mockExecFileSync.mockReset();
    Object.defineProperty(process.env, "NODE_ENV", {
      value: originalNodeEnv,
      configurable: true,
    });
  });

  function configure(values: Record<string, string>) {
    mockGetEnvVar.mockImplementation((key: string) => values[key]);
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue(Buffer.from("ok"));
  }

  it("reports ready when required agent services and local PDF extraction are configured", () => {
    configure({
      DEEPSEEK_API_KEY: "redacted",
      GEMINI_API_KEY: "redacted",
      AUTH_SECRET: "redacted",
      EXERGY_MINERU_COMMAND: "mineru {input} {output}",
      DATABASE_URL: "redacted",
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.overall).toBe("ready");
    expect(readiness.checks.find((check) => check.id === "pdf_vision_assistant")?.status).toBe("ready");
    expect(readiness.checks.find((check) => check.id === "local_mineru")?.status).toBe("ready");
    expect(readiness.checks.find((check) => check.id === "agent_workspace_sandbox")?.status).toBe("ready");
    expect(readiness.production_readiness.level).toBe("ready_for_external_client_testing");
    expect(readiness.production_readiness.product_blockers).toEqual([]);
    expect(JSON.stringify(readiness)).not.toContain("redacted");
  });

  it("fails production readiness when the auth secret is missing", () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    });
    configure({
      DEEPSEEK_API_KEY: "redacted",
      EXERGY_MINERU_COMMAND: "mineru {input} {output}",
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.overall).toBe("missing");
    expect(readiness.checks.find((check) => check.id === "auth_secret")?.status).toBe("missing");
    expect(readiness.production_readiness.level).toBe("not_ready");
    expect(readiness.production_readiness.product_blockers.join(" ")).toContain("AUTH_SECRET");
  });

  it("warns, but does not hard-fail, when local MinerU is unavailable", () => {
    configure({
      DEEPSEEK_API_KEY: "redacted",
      AUTH_SECRET: "redacted",
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.overall).toBe("warning");
    expect(readiness.checks.find((check) => check.id === "local_mineru")?.status).toBe("warning");
    expect(readiness.production_readiness.level).toBe("controlled_pilot_only");
    expect(readiness.production_readiness.active_unresolved_risks.join(" ")).toContain("local_mineru");
  });

  it("treats Gemini vision as a ready complex-PDF path when MinerU is unavailable", () => {
    configure({
      DEEPSEEK_API_KEY: "redacted",
      GEMINI_API_KEY: "redacted",
      AUTH_SECRET: "redacted",
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.checks.find((check) => check.id === "pdf_vision_assistant")?.status).toBe("ready");
    expect(readiness.checks.find((check) => check.id === "local_mineru")?.status).toBe("ready");
  });

  it("fails client-workload readiness when container mode has no runtime", () => {
    configure({
      DEEPSEEK_API_KEY: "redacted",
      AUTH_SECRET: "redacted",
      EXERGY_AGENT_SANDBOX_MODE: "container",
    });
    mockExecFileSync.mockImplementation(() => {
      throw new Error("missing runtime");
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.overall).toBe("missing");
    expect(readiness.checks.find((check) => check.id === "agent_workspace_sandbox")?.status).toBe("missing");
    expect(readiness.production_readiness.level).toBe("not_ready");
  });

  it("requires an explicit acceptance flag before broad-production readiness", () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value: "production",
      configurable: true,
    });
    configure({
      DEEPSEEK_API_KEY: "redacted",
      GEMINI_API_KEY: "redacted",
      AUTH_SECRET: "redacted",
      EXERGY_MINERU_COMMAND: "mineru {input} {output}",
      DATABASE_URL: "redacted",
      EXERGY_BROAD_PRODUCTION_ACCEPTANCE: "verified",
    });

    const readiness = buildEnvironmentReadiness();

    expect(readiness.overall).toBe("ready");
    expect(readiness.production_readiness.level).toBe("ready_for_broad_production");
    expect(readiness.production_readiness.fixed_and_verified_issues.join(" ")).toContain("contracts");
  });
});
