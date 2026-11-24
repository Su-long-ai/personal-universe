import { defineConfig } from "@playwright/test";

function localPreviewPort() {
  let hash = 2166136261;
  for (const char of process.cwd().toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 20_000 + ((hash >>> 0) % 20_000);
}

const previewPort = Number(
  process.env.PLAYWRIGHT_PORT ??
    (process.env.CI ? 4321 : localPreviewPort()),
);
const previewBaseURL = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  timeout: 75_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ["line"],
        ["blob", { outputDir: "blob-report" }],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  projects: [
    {
      name: "release",
      grepInvert: /@webgl-heavy/,
    },
    {
      name: "webgl-heavy",
      grep: /@webgl-heavy/,
      fullyParallel: false,
      use: {
        // Trace capture includes a screencast and can materially perturb the
        // SwiftShader workload this lane is measuring. Keep the primary run
        // clean and capture the full trace on CI's first retry after failure.
        trace: "on-first-retry",
      },
    },
  ],
  use: {
    baseURL: previewBaseURL,
    headless: true,
    channel: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        "--disable-dev-shm-usage",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    url: `${previewBaseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
