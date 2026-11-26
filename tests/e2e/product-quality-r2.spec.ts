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

test("short landscape HUD leaves both fingers of a centered pinch on the canvas", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 664, height: 390 },
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
        type, touchPoints: x.map((value, id) => ({ id, x: value, y: 191 })),
      });
    await send("touchStart", [266, 398]);
    await send("touchMove", [236, 428]);
    await send("touchMove", [206, 458]);
    await send("touchEnd", []);
    await expect(page.locator("#trusted-pinch-test-record")).toHaveText("CANVAS CANVAS");
    expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);

    await page.setViewportSize({ width: 390, height: 664 });
    await expect(hud.getByRole("combobox")).toBeVisible();
    await expect(hud.getByRole("button", { name: /search \/ places/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await context.close();
  }
});
