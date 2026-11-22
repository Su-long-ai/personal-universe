import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  observeRuntime,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

type Viewport = {
  name: string;
  width: number;
  height: number;
};

const DESKTOP: Viewport = {
  name: "desktop-1440x900",
  width: 1440,
  height: 900,
};
const TABLET: Viewport = {
  name: "tablet-834x1194",
  width: 834,
  height: 1194,
};
const MOBILE: Viewport = {
  name: "mobile-390x844",
  width: 390,
  height: 844,
};

test.describe.configure({ retries: 0 });

async function shot(
  page: Page,
  testInfo: TestInfo,
  viewport: string,
  name: string,
) {
  const path = testInfo.outputPath("visual", `${viewport}--${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
  await testInfo.attach(`${viewport}--${name}`, {
    path,
    contentType: "image/png",
  });
}

async function personalTarget(page: Page) {
  await page.goto("/?freeze=1");
  await waitForYeis(page);
  const targets = await page
    .locator("html")
    .getAttribute("data-personal-signal-targets");
  const target = targets
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  expect(target, "visual case needs a real Personal Signal target").toBeTruthy();
  return target!;
}

async function visualCase(
  page: Page,
  testInfo: TestInfo,
  viewport: Viewport,
  name: string,
  exercise: () => Promise<void>,
) {
  const startedAt = Date.now();
  const runtime = await observeRuntime(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });

  await exercise();
  await shot(page, testInfo, viewport.name, name);

  await testInfo.attach("visual-metrics.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          viewport: viewport.name,
          case: name,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  await runtime.assertClean(testInfo);
}

test("visual: desktop galaxy", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "galaxy", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await expect(page.locator(".universe-hud")).toBeVisible();
  });
});

test("visual: desktop search open", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "search-open", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();

    const dialog = page.getByRole("dialog", { name: "Universe navigator" });
    await expect(dialog).toBeVisible();
    const search = page.getByRole("textbox", { name: "Search universe" });
    await search.fill("Personal Universe");
    await expect
      .poll(async () =>
        Number(
          (await page
            .locator("html")
            .getAttribute("data-universe-navigator-results")) ?? "0",
        ),
      )
      .toBeGreaterThan(0);
  });
});

test("visual: desktop places open", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "places-open", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();

    const dialog = page.getByRole("dialog", { name: "Universe navigator" });
    await expect(dialog).toBeVisible();
    await expect(page.locator(".kind-featured").first()).toBeVisible();
  });
});

test("visual: desktop Personal Signal system", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "system-personal-signal",
    async () => {
      const target = await personalTarget(page);
      await page.goto(
        `/?phase=system&star=${encodeURIComponent(target)}&freeze=1`,
      );
      await waitForYeisEngine(page);
      await expect(page.locator(".content-signal-card")).toBeVisible();
    },
  );
});

test("visual: desktop Personal Signal orbit", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "orbit-personal-world",
    async () => {
      const target = await personalTarget(page);
      await page.goto(
        `/?phase=orbit&star=${encodeURIComponent(target)}&freeze=1`,
      );
      await waitForYeisEngine(page);
      await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
      await expect(page.locator(".world-content-card")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-live",
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-pipeline",
        "procedural-planets-pass",
      );
    },
  );
});

test("visual: desktop Hero world", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "hero-world", async () => {
    await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
    await waitForYeisEngine(page);
    await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-universe-world-renderer",
      "procedural-planets-live",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-universe-world-pipeline",
      "procedural-planets-pass",
    );
  });
});

for (const viewport of [TABLET, MOBILE]) {
  test(`visual: ${viewport.name} galaxy`, async ({ page }, testInfo) => {
    await visualCase(page, testInfo, viewport, "galaxy", async () => {
      await page.goto("/?freeze=1");
      await waitForYeis(page);
      await expect(page.locator(".universe-hud")).toBeVisible();
    });
  });

  test(
    `visual: ${viewport.name} Personal Signal orbit`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "orbit-personal-world",
        async () => {
          const target = await personalTarget(page);
          await page.goto(
            `/?phase=orbit&star=${encodeURIComponent(target)}&freeze=1`,
          );
          await waitForYeisEngine(page);
          await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
          await expect(page.locator(".world-content-card")).toBeVisible();
        },
      );
    },
  );
}
