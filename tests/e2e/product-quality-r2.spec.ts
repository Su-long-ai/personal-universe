import { test, expect } from "./support/test";
import { waitForYeis } from "./support/runtime";

test("real WebGL loss announces recovery and offers the static portfolio", async ({ page }) => {
  await page.goto("/?freeze=1");
  await waitForYeis(page);
  const html = page.locator("html");
  const notice = page.locator(".universe-render-status");
  const portfolio = notice.getByRole("link", { name: "Open text portfolio" });
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle", "active");
  await expect(portfolio).toHaveCount(0);
  const generation = Number(await html.getAttribute("data-universe-webgl-context-generation"));

  await page.locator("canvas").evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Missing native WEBGL_lose_context");
    canvas.addEventListener("test-restore-webgl", () => extension.restoreContext(), { once: true });
    extension.loseContext();
  });
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle", "lost");
  await expect(notice.getByRole("status")).toContainText("3D view interrupted");
  await expect(portfolio).toBeVisible();
  const href = await portfolio.getAttribute("href");
  expect(href).toMatch(/\/portfolio\/$/);
  // Confirm the recovery route is independently usable while 3D is still lost.
  const response = await page.request.get(new URL(href!, page.url()).href);
  expect(response.ok()).toBe(true);
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle", "lost");

  await page.locator("canvas").evaluate((node) => {
    node.dispatchEvent(new Event("test-restore-webgl"));
  });
  await expect(html).toHaveAttribute("data-universe-webgl-lifecycle", "active");
  await expect(html).toHaveAttribute("data-universe-webgl-context-generation", String(generation + 1));
  await expect(notice.getByRole("status")).toBeEmpty();
  await expect(portfolio).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(1);
});

for (const [width, height] of [[664, 390], [568, 320], [480, 320], [320, 260]]) {
  test(`short landscape HUD leaves both fingers of a centered pinch on the canvas at ${width}×${height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.goto("/?freeze=1");
      await waitForYeis(page);
      const hud = page.locator(".universe-hud");
      await expect(hud.getByRole("combobox")).toBeVisible();
      await expect(hud.getByRole("button", { name: /search \/ places/i })).toBeVisible();
      await expect(hud.getByRole("link", { name: "Portfolio" })).toBeVisible();
      await page.evaluate(() => {
        const record = document.createElement("div");
        record.hidden = true;
        record.id = "trusted-pinch-test-record";
        document.body.append(record);
        window.addEventListener("pointerdown", (event) => {
          if (event.isTrusted && event.pointerType === "touch") {
            record.textContent += ` ${(event.target as HTMLElement).tagName}`;
          }
        }, true);
      });
      const touch = await context.newCDPSession(page);
      const send = (type: "touchStart" | "touchMove" | "touchEnd", x: number[]) =>
        touch.send("Input.dispatchTouchEvent", {
          type, touchPoints: x.map((value, id) => ({ id, x: value, y: height / 2 })),
        });
      const mid = width / 2;
      const contact = (gap: number) => [mid - gap, mid + gap];
      await send("touchStart", contact(66));
      await send("touchMove", contact(96));
      await send("touchMove", contact(126));
      await send("touchMove", contact(66));
      await send("touchEnd", []);
      const contacts = page.locator("#trusted-pinch-test-record");
      await expect(contacts).toHaveText("CANVAS CANVAS");

      await hud.getByRole("button", { name: "HIDE", exact: true }).click();
      await expect(hud.getByRole("button", { name: "OPEN", exact: true })).toBeVisible();
      await contacts.evaluate((node) => { node.textContent = ""; });
      await send("touchStart", contact(66));
      await send("touchMove", contact(126));
      await send("touchMove", contact(66));
      await send("touchEnd", []);
      await expect(contacts).toHaveText("CANVAS CANVAS");
      await hud.getByRole("button", { name: "OPEN", exact: true }).click();
      await expect(hud.getByRole("button", { name: /search \/ places/i })).toBeVisible();
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);

      await page.setViewportSize({ width: 390, height: 664 });
      await expect(hud.getByRole("combobox")).toBeVisible();
      await expect(hud.getByRole("button", { name: /search \/ places/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    } finally {
      await context.close();
    }
  });
}

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`rotating a live viewport updates the HUD hit area before the first pinch (${reducedMotion})`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL, viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, reducedMotion,
    });
    try {
      const page = await context.newPage();
      await page.goto("/?freeze=1");
      await waitForYeis(page);
      const hud = page.locator(".universe-hud");
      await expect(hud.getByRole("combobox")).toBeVisible();
      await page.evaluate(() => {
        const output = document.createElement("div");
        output.id = "rotation-touch-contacts";
        output.hidden = true;
        document.body.append(output);
        window.addEventListener("pointerdown", (event) => {
          if (event.isTrusted && event.pointerType === "touch") {
            output.textContent += ` ${(event.target as Element).tagName}`;
          }
        }, true);
      });
      const touch = await context.newCDPSession(page);
      const contacts = page.locator("#rotation-touch-contacts");
      const sizes = [{ width: 568, height: 320 }, { width: 390, height: 664 }];
      const readRight = () => hud.evaluate((node) => node.getBoundingClientRect().right);

      // Exercise repeated rotations in the same live document, with no
      // waiting for the HUD to settle between resize and the first gesture.
      for (let cycle = 0; cycle < 2; cycle += 1) {
        expect(await readRight()).toBeGreaterThan(568 / 2 - 66);
        for (const size of sizes) {
          await contacts.evaluate((node) => { node.textContent = ""; });
          await page.setViewportSize(size);
          const geometry = await hud.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return {
              right: bounds.right,
              width: bounds.width,
              viewport: [innerWidth, innerHeight],
              widthAnimating: node.getAnimations().some((animation) =>
                "transitionProperty" in animation && animation.transitionProperty === "width"
              ),
            };
          });
          const center = size.width / 2;
          const send = (type: "touchStart" | "touchMove" | "touchEnd", gap?: number) =>
            touch.send("Input.dispatchTouchEvent", {
              type,
              touchPoints: gap === undefined ? [] : [-gap, gap].map((delta, id) =>
                ({ id, x: center + delta, y: size.height / 2 })),
            });

          await send("touchStart", 66);
          await send("touchMove", 90);
          await send("touchMove", 66);
          await send("touchEnd");
          await expect(contacts).toHaveText("CANVAS CANVAS");
          expect(geometry.viewport).toEqual([size.width, size.height]);
          expect(geometry.widthAnimating).toBe(false);
          expect(geometry.width).toBeGreaterThan(0);
          if (size.width === 568) expect(geometry.right).toBeLessThan(center - 66);
          else expect(geometry.right).toBeGreaterThan(center + 66);
          expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
        }
      }
      await expect(hud.getByRole("combobox")).toBeVisible();
      await expect(hud.getByRole("button", { name: /search \/ places/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
