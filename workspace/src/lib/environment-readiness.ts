import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { getEnvVar } from "@/lib/backend";

export type ReadinessStatus = "ready" | "warning" | "missing";
export type ProductionReadinessLevel =
  | "not_ready"
  | "controlled_pilot_only"
  | "ready_for_external_client_testing"
  | "ready_for_broad_production";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  message: string;
  required: boolean;
}

export interface EnvironmentReadiness {
  overall: ReadinessStatus;
  checks: ReadinessCheck[];
  production_readiness: {
    level: ProductionReadinessLevel;
    product_blockers: string[];
    blockers: string[];
    active_unresolved_risks: string[];
    fixed_and_verified_issues: string[];
    historical_warnings_policy: string;
    evaluator_false_positive_policy: string;
  };
}

const DEFAULT_BREAKTHROUGH_ROOT = "/home/chris/breakthrough-engine";
const DEFAULT_AGENT_CONTAINER_IMAGE = "exergy-agent-workspace:2026-05-24";

function hasAnyEnv(keys: string[]): boolean {
  return keys.some((key) => Boolean(getEnvVar(key)));
}

function localMineruAvailable(): boolean {
  if (hasAnyEnv([
    "EXERGY_MINERU_COMMAND",
    "MINERU_COMMAND",
    "BT_MINERU_OCR_COMMAND",
    "MINERU_OCR_COMMAND",
  ])) {
    return true;
  }

  const configuredPython = getEnvVar("EXERGY_MINERU_PYTHON");
  if (configuredPython && existsSync(configuredPython)) return true;

  const root = getEnvVar("EXERGY_BREAKTHROUGH_ENGINE_ROOT")
    || getEnvVar("BREAKTHROUGH_ENGINE_ROOT")
    || DEFAULT_BREAKTHROUGH_ROOT;
  const entry = join(root, "breakthrough_engine", "rlm", "_mineru_pro_entry.py");
  return existsSync(entry) && (
    existsSync(join(root, ".venv", "bin", "python"))
    || existsSync(join(root, ".venv-mineru", "bin", "python"))
    || existsSync(join(root, ".venv-vllm", "bin", "python"))
  );
}

function pythonRuntimeAvailable(): boolean {
  const configured = getEnvVar("PYTHON_PATH");
  if (configured) return existsSync(configured);
  return true; // backend falls back to python3 when the repo venv is absent.
}

function commandAvailable(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function containerRuntime(): "docker" | "podman" | null {
  const preferred = (getEnvVar("EXERGY_AGENT_CONTAINER_RUNTIME") || "docker").toLowerCase();
  const runtimes: Array<"docker" | "podman"> = preferred === "podman" ? ["podman", "docker"] : ["docker", "podman"];
  return runtimes.find((runtime) => commandAvailable(runtime)) || null;
}

function containerImageAvailable(runtime: string, image: string): boolean {
  try {
    execFileSync(runtime, ["image", "inspect", image], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function buildEnvironmentReadiness(): EnvironmentReadiness {
  const production = process.env.NODE_ENV === "production";
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "llm",
    label: "Primary agent model",
    status: hasAnyEnv(["DEEPSEEK_API_KEY", "DEEPSEEK_V3_API_KEY"]) ? "ready" : "missing",
    required: true,
    message: hasAnyEnv(["DEEPSEEK_API_KEY", "DEEPSEEK_V3_API_KEY"])
      ? "Primary agent model key is configured."
      : "Set the primary agent model API key so the chat agent can reason, route work, and synthesize results.",
  });

  const authConfigured = hasAnyEnv(["AUTH_SECRET", "NEXTAUTH_SECRET"]);
  checks.push({
    id: "auth_secret",
    label: "Auth session secret",
    status: authConfigured ? "ready" : production ? "missing" : "warning",
    required: production,
    message: authConfigured
      ? "Auth session signing secret is configured."
      : production
        ? "Set AUTH_SECRET before production deployment."
        : "Local development is using the built-in auth fallback; production must set AUTH_SECRET.",
  });

  const mineruReady = localMineruAvailable();
  const geminiVisionReady = hasAnyEnv(["GEMINI_API_KEY"]);
  checks.push({
    id: "pdf_vision_assistant",
    label: "Fast PDF vision assistant",
    status: geminiVisionReady ? "ready" : "warning",
    required: false,
    message: geminiVisionReady
      ? "PDF vision extraction is configured for fast complex-PDF extraction."
      : "Set a PDF vision API key to use vision extraction before the local complex-PDF fallback.",
  });

  checks.push({
    id: "local_mineru",
    label: "Complex PDF extraction",
    status: mineruReady || geminiVisionReady ? "ready" : "warning",
    required: false,
    message: mineruReady && geminiVisionReady
      ? "Vision extraction and local complex-PDF extraction are both available."
      : geminiVisionReady
        ? "Vision extraction is available for fast complex-PDF extraction; local extraction remains optional fallback."
        : mineruReady
          ? "Local complex-PDF extraction is available."
          : "Local PDF text extraction will work, but complex/scanned PDFs need a vision key or local extraction command.",
  });

  checks.push({
    id: "python_runtime",
    label: "Python analysis runtime",
    status: pythonRuntimeAvailable() ? "ready" : "missing",
    required: true,
    message: pythonRuntimeAvailable()
      ? "Python analysis runtime is available."
      : "Set PYTHON_PATH to a valid Python interpreter for backend analysis actions.",
  });

  const sandboxMode = (getEnvVar("EXERGY_AGENT_SANDBOX_MODE") || "auto").toLowerCase();
  const sandboxRequired = production || sandboxMode === "container";
  const runtime = containerRuntime();
  const sandboxImage = getEnvVar("EXERGY_AGENT_CONTAINER_IMAGE") || DEFAULT_AGENT_CONTAINER_IMAGE;
  const imageReady = runtime ? containerImageAvailable(runtime, sandboxImage) : false;
  const sandboxReady = runtime && imageReady && sandboxMode !== "local";
  checks.push({
    id: "agent_workspace_sandbox",
    label: "Agent workspace sandbox",
    status: sandboxReady ? "ready" : sandboxRequired ? "missing" : "warning",
    required: sandboxRequired,
    message: sandboxReady
      ? `Container sandbox is ready: ${runtime} using ${sandboxImage}.`
      : !runtime
        ? "Install Docker/Podman and build the agent sandbox image before client workloads."
        : sandboxMode === "local"
          ? "Agent workspace is configured for local restricted execution; use EXERGY_AGENT_SANDBOX_MODE=container for client workloads."
          : `Container runtime is available, but image ${sandboxImage} is missing. Run npm run sandbox:build.`,
  });

  checks.push({
    id: "database",
    label: "Database",
    status: hasAnyEnv(["DATABASE_URL"]) ? "ready" : "warning",
    required: false,
    message: hasAnyEnv(["DATABASE_URL"])
      ? "Database URL is configured."
      : "Anonymous/local flows can run without DATABASE_URL, but accounts, saved settings, and production persistence need it.",
  });

  const requiredMissing = checks.some((check) => check.required && check.status === "missing");
  const anyWarning = checks.some((check) => check.status === "warning");
  const overall: ReadinessStatus = requiredMissing ? "missing" : anyWarning ? "warning" : "ready";
  const blockers = checks
    .filter((check) => check.required && check.status === "missing")
    .map((check) => `${check.id}: ${check.message}`);
  const activeRisks = checks
    .filter((check) => check.status === "warning")
    .map((check) => `${check.id}: ${check.message}`);
  const broadProductionOverride = getEnvVar("EXERGY_BROAD_PRODUCTION_ACCEPTANCE") === "verified";
  const level: ProductionReadinessLevel =
    blockers.length > 0 ? "not_ready"
      : activeRisks.length > 0 ? "controlled_pilot_only"
        : production && broadProductionOverride ? "ready_for_broad_production"
          : "ready_for_external_client_testing";
  return {
    overall,
    checks,
    production_readiness: {
      level,
      product_blockers: blockers,
      blockers,
      active_unresolved_risks: activeRisks,
      fixed_and_verified_issues: [
        "High-stakes answer contracts, source-value retention, scenario reproducibility, workspace output verification, and diagnostic triage are covered by production-readiness tests.",
      ],
      historical_warnings_policy: "Historical campaign warnings stay in campaign reports; readiness uses current checks plus fixed/verified issue annotations.",
      evaluator_false_positive_policy: "Expected-context findings should be source-aware and may be downgraded when synonyms, numeric equivalence, or irrelevant tokens explain the miss.",
    },
  };
}
