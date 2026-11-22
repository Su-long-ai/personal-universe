import { test, expect } from "@playwright/test";
import {
  observeRuntime,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

async function openNavigator(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Hero deep link returns through system to galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);

  await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();

  await page.getByRole("button", { name: /RETURN TO SYSTEM/ }).click();
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  await page.getByRole("button", { name: /RETURN TO GALAXY/ }).click();
  await waitForYeis(page);
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("black-hole navigation completes native travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const search = page.getByRole("textbox", { name: "Search universe" });
  await search.fill("Cygnus X-1");

  const result = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-blackhole") })
    .first();
  await expect(result).toBeVisible();
  await result.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^blackhole:/);
  const target = await html.getAttribute("data-universe-navigation-target");
  expect(target).toBeTruthy();

  await expect(html).toHaveAttribute("data-universe-traveling", target!);
  await expect
    .poll(
      async () => html.getAttribute("data-universe-travel-complete"),
      { timeout: 15_000 },
    )
    .toBe(target);
  await expect(html).not.toHaveAttribute("data-universe-traveling", target!);

  await runtime.assertClean(testInfo);
});

test("deep-sky landmark navigation completes native travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const search = page.getByRole("textbox", { name: "Search universe" });
  await search.fill("Orion Nebula");

  const result = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-landmark") })
    .first();
  await expect(result).toBeVisible();
  await result.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^landmark:/);
  const target = await html.getAttribute("data-universe-navigation-target");
  expect(target).toBeTruthy();

  await expect(html).toHaveAttribute("data-universe-traveling", target!);
  await expect
    .poll(
      async () => html.getAttribute("data-universe-travel-complete"),
      { timeout: 15_000 },
    )
    .toBe(target);
  await expect
    .poll(async () =>
      Number(
        (await html.getAttribute("data-universe-travel-arrival-ratio")) ??
          "Infinity",
      ),
    )
    .toBeLessThan(8);

  await runtime.assertClean(testInfo);
});

test("guided Journey stays manual under reduced motion", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await openNavigator(page);
  const journey = page
    .locator(".navigator-journeys button:not([disabled])")
    .first();
  await expect(journey).toBeVisible();
  const stopText = await journey.locator("small").innerText();
  const stopMatch = /^(\\d+) STOPS$/.exec(stopText.trim());
  expect(stopMatch, "enabled Journey should expose a positive stop count").toBeTruthy();
  const stopCount = Number(stopMatch![1]);
  expect(stopCount).toBeGreaterThan(0);
  await journey.click();

  const controls = page.locator(".universe-journey-controls");
  const progress = page.locator(".journey-current small");
  await expect(controls).toBeVisible();
  await expect(page.locator(".journey-mode")).toHaveText(
    "REDUCED MOTION · MANUAL ADVANCE",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-journey",
    /.+/,
  );
  await expect(progress).toHaveText(`1 / ${stopCount}`);

  // Normal journeys auto-advance after a 6.5s dwell. Reduced motion must not.
  await page.waitForTimeout(7_000);
  await expect(progress).toHaveText(`1 / ${stopCount}`);

  if (stopCount > 1) {
    await page.getByRole("button", { name: "NEXT →" }).click();
    await expect(progress).toHaveText(`2 / ${stopCount}`);
    await page.getByRole("button", { name: "Stop guided journey" }).click();
  } else {
    await page.getByRole("button", { name: "DONE" }).click();
  }

  await expect(controls).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-universe-journey",
    /.+/,
  );

  await runtime.assertClean(testInfo);
});

test("mobile navigation reaches an exact body deep link", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const search = page.getByRole("textbox", { name: "Search universe" });
  await search.fill("Earth");

  const earth = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Earth" })
    .first();
  await expect(earth).toBeVisible();
  await earth.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  const url = new URL(page.url());
  expect(url.searchParams.get("phase")).toBe("approach");
  expect(url.searchParams.get("star")).toBeTruthy();
  expect(url.searchParams.get("body")).toBeTruthy();

  await runtime.assertClean(testInfo);
});

test("invalid deep link fails closed to the galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=system&star=definitely-not-a-real-stellar-address&freeze=1",
  );
  await waitForYeis(page);

  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.getByText("STELLAR SYSTEM")).toBeHidden();

  await runtime.assertClean(testInfo);
});

test("runtime guard detects a critical client bundle failure", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [/^Failed to load resource: net::ERR_FAILED$/],
  });
  await page.route(/\/_astro\/[^?#]+\.js(?:\?|$)/i, async (route) => {
    await route.abort("failed");
  });

  await page.goto("/?freeze=1");
  await expect
    .poll(() =>
      runtime.problems.some(
        (problem) =>
          problem.kind === "requestfailed" &&
          problem.detail.includes("/_astro/"),
      ),
    )
    .toBeTruthy();

  await runtime.assertDetected(testInfo, "requestfailed");
});

test("runtime guard detects forced WebGL context loss", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [/^THREE\.WebGLRenderer: Context Lost\.?$/],
  });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const forced = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return false;
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl");
    if (!gl) return false;
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(forced, "WEBGL_lose_context should be available in Chromium").toBe(
    true,
  );

  await expect
    .poll(() =>
      runtime.problems.some(
        (problem) => problem.kind === "webglcontextlost",
      ),
    )
    .toBeTruthy();

  await runtime.assertDetected(testInfo, "webglcontextlost");
});
