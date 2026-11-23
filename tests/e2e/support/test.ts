import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);

    if (page.isClosed()) return;
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: false }),
      );
    });
  },
});

export { expect };
export type { Page, TestInfo } from "@playwright/test";
