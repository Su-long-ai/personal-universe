import { expect, test } from "@playwright/test";
import { observeRuntime, waitForYeisEngine } from "./support/runtime";

const COPY = {
  "en-US": {
    locale: "en",
    lang: "en",
    title: "Personal Universe",
    summary:
      "An explorable personal homepage that turns projects and experiences into sparse signals inside a reusable astronomical universe.",
    toggle: "Switch language to Chinese",
    navigator: "Universe Navigator",
    search: "Search universe",
    locate: "Locate Personal Universe in galaxy",
  },
  "zh-CN": {
    locale: "zh",
    lang: "zh-CN",
    title: "个人宇宙",
    summary: "一个可探索的个人主页，把项目与经历映射为可复用天文宇宙中的稀疏信号。",
    toggle: "切换语言为英文",
    navigator: "宇宙导航",
    search: "搜索宇宙",
    locate: "在银河中定位 个人宇宙",
  },
} as const;

for (const browserLocale of ["en-US", "zh-CN"] as const) {
  test.describe(`native authored copy · ${browserLocale}`, () => {
    test.use({ locale: browserLocale });

    for (const phase of ["system", "orbit"] as const) {
      test(`cold-start Spica ${phase} uses the authored locale`, async ({
        page,
      }, testInfo) => {
        const copy = COPY[browserLocale];
        const runtime = await observeRuntime(page);
        await page.goto(`/?phase=${phase}&star=c59669&freeze=1`);
        await waitForYeisEngine(page);

        const html = page.locator("html");
        const card = page.locator(
          phase === "system" ? ".content-signal-card" : ".world-content-card",
        );
        const title = card.locator(phase === "system" ? "b" : "strong");
        const summary = card.locator("small");
        // The signal cannot resolve until the native catalogue has loaded.
        // Assert document.lang after that, not merely after product hydration.
        await expect(card).toBeVisible();
        await expect(html).toHaveAttribute("data-universe-navigation-phase", phase);
        await expect(html).toHaveAttribute("data-universe-locale", copy.locale);
        await expect.soft(html).toHaveAttribute("lang", copy.lang);
        await expect.soft(title).toHaveText(copy.title);
        await expect.soft(summary).toHaveText(copy.summary);

        if (phase === "system") {
          await page.keyboard.press("Control+k");
          const navigator = page.getByRole("dialog", { name: copy.navigator });
          await expect(navigator).toBeVisible();
          await navigator
            .getByRole("combobox", { name: copy.search })
            .fill(copy.title);
          const authored = navigator.locator(
            '.navigator-result-row[data-destination-id="personal:personal-universe"]',
          );
          await expect(authored.locator("strong").first()).toHaveText(copy.title);
          await expect(
            authored.getByRole("button", { name: copy.locate, exact: true }).first(),
          ).toBeVisible();
        } else {
          let mainFrameNavigations = 0;
          page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) mainFrameNavigations += 1;
          });
          const originalUrl = page.url();
          const switched = COPY[browserLocale === "en-US" ? "zh-CN" : "en-US"];
          await page.getByRole("button", { name: copy.toggle }).click();
          await expect(html).toHaveAttribute("lang", switched.lang);
          await expect(title).toHaveText(switched.title);
          await expect(summary).toHaveText(switched.summary);
          await expect(html).toHaveAttribute("data-universe-navigation-phase", "orbit");
          await expect(page.locator("canvas")).toHaveCount(1);
          expect(page.url()).toBe(originalUrl);
          expect(mainFrameNavigations).toBe(0);
        }

        await runtime.assertClean(testInfo);
      });
    }
  });
}
