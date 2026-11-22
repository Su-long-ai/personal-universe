import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { waitForYeis } from "./support/runtime";

const VIEWPORTS = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "tablet-834x1194", width: 834, height: 1194 },
  { name: "mobile-390x844", width: 390, height: 844 },
] as const;

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

test("capture stable UI and WebGL visual artifacts at key viewports", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
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

    await page.goto(
      `/?phase=system&star=${encodeURIComponent(target!)}&freeze=1`,
    );
    await expect(page.locator(".content-signal-card")).toBeVisible();
    await shot(page, testInfo, viewport.name, "system-personal-signal");

    await page.goto(
      `/?phase=orbit&star=${encodeURIComponent(target!)}&freeze=1`,
    );
    await expect(page.locator(".world-content-card")).toBeVisible();
    await shot(page, testInfo, viewport.name, "orbit-personal-world");

    await page.goto("/?navigator=1&navq=Personal%20Universe&freeze=1");
    await waitForYeis(page);
    await expect(page.getByRole("dialog", { name: "Universe navigator" })).toBeVisible();
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

    await page.goto("/?navigator=1&freeze=1");
    await waitForYeis(page);
    await expect(page.getByRole("dialog", { name: "Universe navigator" })).toBeVisible();
    await expect(page.locator(".kind-featured").first()).toBeVisible();
    await shot(page, testInfo, viewport.name, "places-open");

    await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
    await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
    await shot(page, testInfo, viewport.name, "hero-world");
  }
});
