import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("backend env loading", () => {
  const originalExtra = process.env.EXERGY_EXTRA_ENV_FILES;
  const originalMineruCommand = process.env.EXERGY_MINERU_COMMAND;
  const originalGeminiVisionModel = process.env.GEMINI_VISION_MODEL;

  afterEach(() => {
    if (originalExtra === undefined) delete process.env.EXERGY_EXTRA_ENV_FILES;
    else process.env.EXERGY_EXTRA_ENV_FILES = originalExtra;
    if (originalMineruCommand === undefined) delete process.env.EXERGY_MINERU_COMMAND;
    else process.env.EXERGY_MINERU_COMMAND = originalMineruCommand;
    if (originalGeminiVisionModel === undefined) delete process.env.GEMINI_VISION_MODEL;
    else process.env.GEMINI_VISION_MODEL = originalGeminiVisionModel;
    jest.resetModules();
  });

  it("loads local MinerU command config from extra env files without requiring process.env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exergy-env-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "EXERGY_MINERU_COMMAND=test-mineru {input} {output}\n", "utf-8");
    delete process.env.EXERGY_MINERU_COMMAND;
    process.env.EXERGY_EXTRA_ENV_FILES = envPath;

    const { getEnvVar } = await import("../backend");

    expect(getEnvVar("EXERGY_MINERU_COMMAND")).toBe("test-mineru {input} {output}");
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads Gemini vision model config from extra env files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exergy-env-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "GEMINI_VISION_MODEL=gemini-3.5-flash\n", "utf-8");
    delete process.env.GEMINI_VISION_MODEL;
    process.env.EXERGY_EXTRA_ENV_FILES = envPath;

    const { getEnvVar } = await import("../backend");

    expect(getEnvVar("GEMINI_VISION_MODEL")).toBe("gemini-3.5-flash");
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps Gemini Flash defaults on configurable multimodal model fallbacks", () => {
    const source = readFileSync(join(__dirname, "..", "backend.ts"), "utf-8");

    expect(source).toContain('const DEFAULT_GEMINI_FLASH_MODEL = "gemini-3.5-flash"');
    expect(source).toContain('"gemini-3-flash-preview"');
    expect(source).toContain('"gemini-2.5-flash"');
    expect(source).toContain('"gemini-2.5-pro"');
    expect(source).toContain("geminiModelCandidates");
  });
});
