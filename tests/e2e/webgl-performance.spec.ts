import { test, expect } from "./support/test";
import { waitForYeis } from "./support/runtime";

test("terminal WebGL release permits a fresh BrowserContext @webgl-heavy", async ({
  browser,
}, testInfo) => {
  const baseURL = String(
    testInfo.project.use.baseURL ?? "http://127.0.0.1:4321",
  );
  const contextOptions = {
    baseURL,
    viewport: { width: 1440, height: 900 },
  };

  const first = await browser.newContext(contextOptions);
  const firstPage = await first.newPage();
  await firstPage.goto("/?freeze=1");
  await waitForYeis(firstPage);

  const firstHtml = firstPage.locator("html");
  await expect(firstHtml).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );

  // A bfcache page is not terminal and must retain its renderer.
  await firstPage.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
  });
  await expect(firstHtml).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );

  const initiallyLost = await firstPage.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl =
      canvas?.getContext("webgl2") ??
      canvas?.getContext("webgl") ??
      null;
    return gl?.isContextLost() ?? false;
  });
  expect(initiallyLost).toBe(false);

  const terminalDispatchMs = await firstPage.evaluate(() => {
    const startedAt = performance.now();
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    );
    return performance.now() - startedAt;
  });
  expect(
    terminalDispatchMs,
    "terminal pagehide must return without waiting for context loss",
  ).toBeLessThan(1_000);
  await expect(firstHtml).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "released",
  );
  await expect
    .poll(() =>
      firstPage.evaluate(() => {
        const canvas = document.querySelector("canvas");
        const gl =
          canvas?.getContext("webgl2") ??
          canvas?.getContext("webgl") ??
          null;
        return gl?.isContextLost() ?? false;
      }),
    )
    .toBe(true);

  await first.close();

  // The acceptance condition is not merely a lost first context: Chromium
  // must be able to create and boot a fresh WebGL BrowserContext immediately.
  const second = await browser.newContext(contextOptions);
  const secondPage = await second.newPage();
  await secondPage.goto("/?freeze=1");
  await waitForYeis(secondPage);
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );

  // Leave final teardown to Playwright/browser ownership. The preceding
  // context-loss assertion covers the explicit product terminal contract.
  await second.close();
});
