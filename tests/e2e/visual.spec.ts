import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { observeRuntime, waitForYeis } from "./support/runtime";

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "tablet-834x1194", width: 834, height: 1194 },
  { name: "mobile-390x844", width: 390, height: 844 },
] as const;

test.describe.configure({ retries: 0 });

async function shot(
  page: Page,
  testInfo: TestInfo,
  viewport: string,
  name: string,
) {
  const path = testInfo.outputPath("visual", `${viewport}--${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${viewport}--${name}`, {
    path,
    contentType: "image/png",
  });
}

for (const viewport of VIEWPORTS) {
  test(`capture stable UI and WebGL artifacts: ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const runtime = await observeRuntime(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await expect(page.locator(".universe-hud")).toBeVisible();
    await shot(page, testInfo, viewport.name, "galaxy");

    const targets = await page
      .locator("html")
      .getAttribute("data-personal-signal-targets");
    const target = targets
      ?.split(",")
      .map((value) => value.trim())
      .find(Boolean);
    expect(target).toBeTruthy();

    const navigatorButton = page.getByRole("button", { name: /SEARCH \/ PLACES/ });
    await navigatorButton.click();
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
    await shot(page, testInfo, viewport.name, "search-open");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await navigatorButton.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator(".kind-featured").first()).toBeVisible();
    await shot(page, testInfo, viewport.name, "places-open");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.goto(
      `/?phase=system&star=${encodeURIComponent(target!)}&freeze=1`,
    );
    await waitForYeis(page);
    await expect(page.locator(".content-signal-card")).toBeVisible();
    await shot(page, testInfo, viewport.name, "system-personal-signal");

    await page.goto(
      `/?phase=orbit&star=${encodeURIComponent(target!)}&freeze=1`,
    );
    await waitForYeis(page);
    await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
    await expect(page.locator(".world-content-card")).toBeVisible();
    await shot(page, testInfo, viewport.name, "orbit-personal-world");

    await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
    await waitForYeis(page);
    await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
    await shot(page, testInfo, viewport.name, "hero-world");

    await runtime.assertClean(testInfo);
  });
}
