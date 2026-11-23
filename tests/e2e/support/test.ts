import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);

    // A failed test already causes Playwright to recycle the worker/browser.
    // Do not run an expensive synthetic terminal teardown after failure:
    // preserve the original failure screenshot/trace and avoid masking the
    // product assertion with a second teardown timeout.
    if (testInfo.status !== testInfo.expectedStatus || page.isClosed()) return;
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: false }),
      );
    });
  },
});

export { expect };
export type { Page, TestInfo } from "@playwright/test";
