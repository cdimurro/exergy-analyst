import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "fs";
import { join } from "path";

const port = Number(process.env.PLAYWRIGHT_PORT || 3010);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const localBrowserLibDir = join(process.cwd(), ".playwright-libs", "root", "usr", "lib", "x86_64-linux-gnu");

if (existsSync(localBrowserLibDir)) {
  process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      EXERGY_DISABLE_MINERU: process.env.EXERGY_DISABLE_MINERU || "1",
      FF_PROJECTS_ENABLED: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
