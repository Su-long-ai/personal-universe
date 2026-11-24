import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Page, type TestInfo } from "./support/test";
import {
  observeRuntime,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

type Viewport = {
  name: string;
  width: number;
  height: number;
};

const DESKTOP: Viewport = {
  name: "desktop-1440x900",
  width: 1440,
  height: 900,
};
const TABLET: Viewport = {
  name: "tablet-834x1194",
  width: 834,
  height: 1194,
};
const MOBILE: Viewport = {
  name: "mobile-390x844",
  width: 390,
  height: 844,
};

test.describe.configure({ retries: 0 });

async function shot(
  page: Page,
  testInfo: TestInfo,
  viewport: string,
  name: string,
) {
  const path = testInfo.outputPath("visual", `${viewport}--${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
  await testInfo.attach(`${viewport}--${name}`, {
    path,
    contentType: "image/png",
  });
}

async function waitForCameraSettled(
  page: Page,
  phase: "approach" | "orbit" | "atmosphere" | "surface" | "returning",
) {
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-camera-settled",
    phase,
  );
}

async function expectReadableWorldFrame(page: Page, label: string) {
  const png = await page.locator(".universe-canvas canvas").screenshot();
  const stats = await page.evaluate(async ({ base64 }) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const sample = document.createElement("canvas");
    sample.width = 160;
    sample.height = 100;
    const context = sample.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas unavailable for visual probe");
    context.drawImage(bitmap, 0, 0, sample.width, sample.height);
    bitmap.close();

    const pixels = context.getImageData(
      0,
      0,
      sample.width,
      sample.height,
    ).data;
    let readable = 0;
    let luminanceSum = 0;
    const total = sample.width * sample.height;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const luminance =
        pixels[offset] * 0.2126 +
        pixels[offset + 1] * 0.7152 +
        pixels[offset + 2] * 0.0722;
      luminanceSum += luminance;
      if (luminance > 20) readable += 1;
    }
    return {
      meanLuminance: luminanceSum / total,
      readableFraction: readable / total,
    };
  }, { base64: png.toString("base64") });

  expect(
    stats.readableFraction,
    `${label} should render a readable world instead of a near-black canvas`,
  ).toBeGreaterThan(0.08);
  expect(
    stats.meanLuminance,
    `${label} should produce visible world luminance`,
  ).toBeGreaterThan(8);
}

async function expectCompactNarrowHud(page: Page) {
  const box = await page.locator(".universe-hud").boundingBox();
  expect(box, "narrow-screen HUD should have a measurable layout box").not.toBeNull();
  expect(
    box!.height,
    "narrow-screen HUD should stay compact enough to avoid covering the world",
  ).toBeLessThan(310);
}

async function personalTarget(page: Page) {
  await page.goto("/?freeze=1");
  await waitForYeis(page);
  const targets = await page
    .locator("html")
    .getAttribute("data-personal-signal-targets");
  const target = targets
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  expect(target, "visual case needs a real Personal Signal target").toBeTruthy();
  return target!;
}

async function visualCase(
  page: Page,
  testInfo: TestInfo,
  viewport: Viewport,
  name: string,
  exercise: () => Promise<void>,
) {
  const startedAt = Date.now();
  const runtime = await observeRuntime(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });

  await exercise();
  await shot(page, testInfo, viewport.name, name);

  const html = page.locator("html");
  const webgl = {
    software: await html.getAttribute("data-universe-webgl-software"),
    geometries: Number(
      (await html.getAttribute("data-universe-webgl-geometries")) ?? "0",
    ),
    textures: Number(
      (await html.getAttribute("data-universe-webgl-textures")) ?? "0",
    ),
    programs: Number(
      (await html.getAttribute("data-universe-webgl-programs")) ?? "0",
    ),
    calls: Number(
      (await html.getAttribute("data-universe-webgl-calls")) ?? "0",
    ),
    triangles: Number(
      (await html.getAttribute("data-universe-webgl-triangles")) ?? "0",
    ),
  };

  await testInfo.attach("visual-metrics.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          viewport: viewport.name,
          case: name,
          elapsedMs: Date.now() - startedAt,
          webgl,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  await runtime.assertClean(testInfo);
}

test("visual: desktop galaxy", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "galaxy", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await expect(page.locator(".universe-hud")).toBeVisible();
  });
});

test("visual: desktop search open", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "search-open", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();

    const dialog = page.getByRole("dialog", { name: "Universe navigator" });
    await expect(dialog).toBeVisible();
    const search = page.getByRole("combobox", { name: "Search universe" });
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
  });
});

test("visual: desktop places open", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "places-open", async () => {
    await page.goto("/?freeze=1");
    await waitForYeis(page);
    await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();

    const dialog = page.getByRole("dialog", { name: "Universe navigator" });
    await expect(dialog).toBeVisible();
    await expect(page.locator(".kind-featured").first()).toBeVisible();
  });
});

test("visual: desktop Personal Signal system", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "system-personal-signal",
    async () => {
      const target = await personalTarget(page);
      await page.goto(
        `/?phase=system&star=${encodeURIComponent(target)}&freeze=1`,
      );
      await waitForYeisEngine(page);
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-system-renderer",
        "yeis-native",
        { timeout: 30_000 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-system-ready",
        "true",
        { timeout: 30_000 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-system-focus",
        /.+/,
        { timeout: 30_000 },
      );
      await expect(page.locator(".content-signal-card")).toBeVisible();
    },
  );
});

test("visual: desktop Personal Signal orbit", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "orbit-personal-world",
    async () => {
      const target = await personalTarget(page);
      await page.goto(
        `/?phase=orbit&star=${encodeURIComponent(target)}&freeze=1`,
      );
      await waitForYeisEngine(page);
      await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-fallback-surface",
        "generated-texture",
        { timeout: 60_000 },
      );
      await waitForCameraSettled(page, "orbit");
      await expect(page.locator(".world-content-card")).toBeVisible();
    },
  );
});

test("visual: desktop Hero world", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "hero-world", async () => {
    await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
    await waitForYeisEngine(page);
    await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-universe-world-fallback-surface",
      "generated-texture",
      { timeout: 60_000 },
    );
    await waitForCameraSettled(page, "orbit");
    await expectReadableWorldFrame(page, "AUTO Hero orbit");
  });
});

test("visual: desktop Hero world high-quality live renderer", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "hero-world-live-high",
    async () => {
      await page.goto("/?phase=orbit&star=h-aurora&freeze=1");
      await waitForYeisEngine(page);
      await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
      await page.getByLabel("QUALITY").selectOption("high");
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-live",
        { timeout: 60_000 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-pipeline",
        "procedural-planets-pass",
        { timeout: 60_000 },
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-world-ready",
        "true",
        { timeout: 60_000 },
      );
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-universe-world-fallback-surface",
        "generated-texture",
      );
      await expectReadableWorldFrame(page, "HIGH Hero orbit");
    },
  );
});

test("visual: desktop Hero surface keeps the live planet renderer @webgl-heavy", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "hero-surface-live-high",
    async () => {
      await page.goto(
        "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await page.getByLabel("QUALITY").selectOption("high");
      await waitForCameraSettled(page, "surface");
      const html = page.locator("html");
      await expect(html).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-live",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-world-pipeline",
        "procedural-planets-pass",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-world-ready",
        "true",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-renderer",
        "procedural-planets-live-surface",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-anchor-ready",
        "true",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-camera-frame",
        "ready",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-camera-applied",
        "true",
        { timeout: 60_000 },
      );
      await waitForCameraSettled(page, "surface");
      await expect(html).toHaveAttribute(
        "data-universe-world-screenshot-ready",
        "true",
        { timeout: 30_000 },
      );
    },
  );
});

for (const viewport of [TABLET, MOBILE]) {
  test(`visual: ${viewport.name} galaxy`, async ({ page }, testInfo) => {
    await visualCase(page, testInfo, viewport, "galaxy", async () => {
      await page.goto("/?freeze=1");
      await waitForYeis(page);
      await expect(page.locator(".universe-hud")).toBeVisible();
    });
  });

  test(
    `visual: ${viewport.name} Personal Signal system`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "system-personal-signal",
        async () => {
          const target = await personalTarget(page);
          await page.goto(
            `/?phase=system&star=${encodeURIComponent(target)}&freeze=1`,
          );
          await waitForYeisEngine(page);
          const html = page.locator("html");
          await expect(html).toHaveAttribute(
            "data-universe-system-renderer",
            "yeis-native",
            { timeout: 30_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-system-ready",
            "true",
            { timeout: 30_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-system-focus",
            /.+/,
            { timeout: 30_000 },
          );
          await expect(page.locator(".content-signal-card")).toBeVisible();
          await expectCompactNarrowHud(page);
        },
      );
    },
  );

  test(
    `visual: ${viewport.name} Personal Signal orbit`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "orbit-personal-world",
        async () => {
          const target = await personalTarget(page);
          await page.goto(
            `/?phase=orbit&star=${encodeURIComponent(target)}&freeze=1`,
          );
          await waitForYeisEngine(page);
          await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute(
            "data-universe-world-fallback-surface",
            "generated-texture",
            { timeout: 60_000 },
          );
          await waitForCameraSettled(page, "orbit");
          await expect(page.locator(".world-content-card")).toBeVisible();
          await expectCompactNarrowHud(page);
        },
      );
    },
  );

  test(
    `visual: ${viewport.name} Hero surface${viewport === TABLET ? " @webgl-heavy" : ""}`,
    async ({ page }, testInfo) => {
      test.slow(
        viewport === TABLET,
        "Hosted software-WebGL tablet Surface capture is isolated in the heavy lane",
      );
      await visualCase(
        page,
        testInfo,
        viewport,
        "hero-surface-auto",
        async () => {
          await page.goto(
            "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
          );
          await waitForYeisEngine(page);
          const html = page.locator("html");
          await expect(html).toHaveAttribute(
            "data-universe-surface-renderer",
            "procedural-terrains-fallback",
            { timeout: 60_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-surface-terrain-profile",
            "infinite-software",
            { timeout: 60_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-surface-terrain-state",
            "ready",
            { timeout: 60_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-surface-depth-cues",
            "software-beacon",
            { timeout: 60_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-surface-horizon",
            "generated-gradient",
            { timeout: 60_000 },
          );
          await waitForCameraSettled(page, "surface");
          await expectReadableWorldFrame(
            page,
            `${viewport.name} AUTO Hero surface`,
          );
          await expectCompactNarrowHud(page);
        },
      );
    },
  );
}
