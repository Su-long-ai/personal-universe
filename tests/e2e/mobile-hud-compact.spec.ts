import { expect, test } from "./support/test";
import { observeRuntime, waitForYeisEngine } from "./support/runtime";

const orbitUrl = "/?phase=orbit&star=h-aurora&body=aurora-01&lang=en&freeze=1";

for (const [width, height] of [[320, 640], [390, 844], [834, 1194]]) {
  test.describe(`compact Orbit HUD at ${width}×${height}`, () => {
    test.use({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });

    test("keeps the world center and HUD tap controls reachable", async ({ page }, testInfo) => {
      const runtime = await observeRuntime(page);
      await page.goto(orbitUrl);
      await waitForYeisEngine(page);
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-camera-settled",
        "orbit",
        { timeout: 30_000 },
      );

      const hud = page.locator(".universe-hud");
      const box = await hud.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height, "settled narrow HUD should not cover the world").toBeLessThan(310);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expect(page.locator(".universe-canvas canvas")).toHaveCount(1);
      if (width === 320) {
        await expect.poll(() => page.evaluate(() => {
          const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          return Boolean(hit?.closest(".universe-canvas") && !hit.closest(".universe-hud"));
        }), { message: "the canvas, not the Return button, receives center touches" }).toBe(true);
      }

      const navigate = hud.getByRole("button", { name: /Search \/ Places/i });
      await navigate.tap();
      const navigator = page.getByRole("dialog", { name: "Universe navigator" });
      await expect(navigator).toBeVisible();
      await navigator.getByRole("button", { name: /close navigator/i }).tap();
      await expect(navigator).toBeHidden();

      await hud.getByRole("button", { name: "HIDE", exact: true }).tap();
      await expect(navigate).toBeHidden();
      await hud.getByRole("button", { name: "OPEN", exact: true }).tap();
      await expect(navigate).toBeVisible();
      await expect(hud.locator(".hud-return")).toBeVisible();
      await runtime.assertClean(testInfo);
    });
  });
}
