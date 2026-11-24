import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/test";
import { waitForYeis } from "./support/runtime";

type WebglMetrics = {
  renderer: string;
  software: boolean;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
  allocations: number;
  lifecycle: string | null;
  pipelineLifecycle: string | null;
};

async function dispatchScaleWheel(page: Page, deltaY: number) {
  await page.locator("main.universe-root").evaluate((root, delta) => {
    root.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: delta,
      }),
    );
  }, deltaY);
}

async function driveFullScaleRoundTrip(page: Page) {
  const html = page.locator("html");

  for (let sample = 0; sample < 4; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );

  for (let sample = 0; sample < 2; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 10_000 },
  );

  for (let sample = 0; sample < 6; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-ready",
    "true",
    { timeout: 15_000 },
  );

  for (let sample = 0; sample < 6; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );

  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
    { timeout: 10_000 },
  );

  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-lifecycle",
    "parked",
  );
}

async function readWebglMetrics(page: Page): Promise<WebglMetrics> {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-universe-webgl-renderer", /.+/);
  for (const attribute of [
    "data-universe-webgl-geometries",
    "data-universe-webgl-textures",
    "data-universe-webgl-programs",
    "data-universe-webgl-calls",
    "data-universe-webgl-triangles",
    "data-universe-world-pipeline-allocations",
  ]) {
    await expect(html).toHaveAttribute(attribute, /^\d+$/, {
      timeout: 15_000,
    });
  }

  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      renderer: data.universeWebglRenderer ?? "unknown",
      software: data.universeWebglSoftware === "true",
      geometries: Number(data.universeWebglGeometries ?? 0),
      textures: Number(data.universeWebglTextures ?? 0),
      programs: Number(data.universeWebglPrograms ?? 0),
      calls: Number(data.universeWebglCalls ?? 0),
      triangles: Number(data.universeWebglTriangles ?? 0),
      allocations: Number(data.universeWorldPipelineAllocations ?? 0),
      lifecycle: data.universeWebglLifecycle ?? null,
      pipelineLifecycle: data.universeWorldPipelineLifecycle ?? null,
    };
  });
}

async function settleWebglMetrics(page: Page) {
  // CinematicPipeline publishes every 30 frames. Two samples keep the test
  // independent from host frame rate while giving disposal a render turn.
  await page.waitForTimeout(750);
  const first = await readWebglMetrics(page);
  await page.waitForTimeout(750);
  const second = await readWebglMetrics(page);
  return { first, second };
}

async function attachMetrics(
  testInfo: TestInfo,
  name: string,
  metrics: WebglMetrics,
) {
  await testInfo.attach(name, {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
}

test("terminal WebGL release permits a fresh BrowserContext @webgl-heavy", async ({
  browser,
  context,
  page: firstPage,
}, testInfo) => {
  const baseURL = String(
    testInfo.project.use.baseURL ?? "http://127.0.0.1:4321",
  );
  const contextOptions = {
    baseURL,
    viewport: { width: 1440, height: 900 },
  };

  await firstPage.goto("/?freeze=1");
  await waitForYeis(firstPage);

  const firstHtml = firstPage.locator("html");
  await expect(firstHtml).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );
  const firstMetrics = await readWebglMetrics(firstPage);
  await attachMetrics(testInfo, "webgl-first-context.json", firstMetrics);

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

  await context.close();

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
  const secondMetrics = await readWebglMetrics(secondPage);
  await attachMetrics(testInfo, "webgl-fresh-context.json", secondMetrics);
  expect(secondMetrics.renderer).toBe(firstMetrics.renderer);
  expect(secondMetrics.software).toBe(firstMetrics.software);

  await second.close();
});

test("repeated full scale journeys keep WebGL resources bounded @webgl-heavy", async ({
  page,
}, testInfo) => {
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await driveFullScaleRoundTrip(page);
  const cycleOne = await settleWebglMetrics(page);
  await attachMetrics(testInfo, "webgl-cycle-1.json", cycleOne.second);

  await driveFullScaleRoundTrip(page);
  const cycleTwo = await settleWebglMetrics(page);
  await attachMetrics(testInfo, "webgl-cycle-2.json", cycleTwo.second);

  expect(cycleTwo.second.renderer).toBe(cycleOne.second.renderer);
  expect(cycleTwo.second.software).toBe(cycleOne.second.software);
  expect(cycleTwo.second.allocations).toBe(cycleOne.second.allocations);

  // A second identical 0 -> 5 -> 0 journey must reuse/retire resources instead
  // of leaving another persistent resource world behind. Keep this strict:
  // diagnosis should fix ownership rather than teaching acceptance to tolerate
  // linear growth.
  expect(cycleTwo.second.geometries).toBeLessThanOrEqual(
    cycleOne.second.geometries + 1,
  );
  expect(cycleTwo.second.textures).toBeLessThanOrEqual(
    cycleOne.second.textures + 1,
  );
  expect(cycleTwo.second.programs).toBeLessThanOrEqual(
    cycleOne.second.programs + 1,
  );

  expect(cycleTwo.second.lifecycle).toBe("active");
  expect(cycleTwo.second.pipelineLifecycle).toBe("parked");
});

test("AUTO LOW AUTO quality switching keeps one renderer and bounded pipeline churn @webgl-heavy", async ({
  page,
}, testInfo) => {
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const quality = page.locator(".hud-actions select");
  await expect(quality).toHaveValue("auto");

  const initial = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-quality-auto-before.json", initial);

  await quality.selectOption("low");
  await expect(quality).toHaveValue("low");
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator("html")
            .getAttribute("data-universe-world-pipeline-allocations"),
        ),
      { timeout: 15_000 },
    )
    .toBe(initial.allocations + 1);

  await quality.selectOption("auto");
  await expect(quality).toHaveValue("auto");
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator("html")
            .getAttribute("data-universe-world-pipeline-allocations"),
        ),
      { timeout: 15_000 },
    )
    .toBe(initial.allocations + 2);

  const restored = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-quality-auto-restored.json", restored);

  expect(restored.renderer).toBe(initial.renderer);
  expect(restored.software).toBe(initial.software);
  expect(restored.allocations).toBe(initial.allocations + 2);
  expect(restored.geometries).toBeLessThanOrEqual(initial.geometries + 1);
  expect(restored.textures).toBeLessThanOrEqual(initial.textures + 1);
  expect(restored.programs).toBeLessThanOrEqual(initial.programs + 1);
});
