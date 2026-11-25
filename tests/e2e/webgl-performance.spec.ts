import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./support/test";
import { waitForYeis, waitForYeisEngine } from "./support/runtime";

type WebglMetrics = {
  sample: number;
  renderer: string;
  software: boolean;
  geometries: number;
  textures: number;
  programs: number;
  calls: number;
  triangles: number;
  allocations: number;
  planetAllocations: number;
  planetPassAllocations: number;
  fallbackTextureAllocations: number;
  terrainAllocations: number;
  terrainInstance: string | null;
  renderPath: string | null;
  composerTargets: string | null;
  bloom: string | null;
  lifecycle: string | null;
  pipelineLifecycle: string | null;
  sceneLifecycle: string | null;
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

async function forceWebglLossAndRestore(page: Page) {
  return page.evaluate(async () => {
    const unavailable = () => ({
      supported: false,
      lost: false,
      restored: false,
      duringLoss: null,
      lifecycleAfterRestore: null,
      generationBefore: 0,
      generationAfter: 0,
    });
    const canvas = document.querySelector("canvas");
    if (!canvas) return unavailable();
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return unavailable();
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) return unavailable();

    const html = document.documentElement;
    const generationBefore = Number(
      html.dataset.universeWebglContextGeneration ?? "0",
    );
    const waitFor = (name: "webglcontextlost" | "webglcontextrestored") =>
      new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), 5_000);
        canvas.addEventListener(
          name,
          (event) => {
            if (name === "webglcontextlost") event.preventDefault();
            window.clearTimeout(timer);
            resolve(true);
          },
          { once: true },
        );
      });

    canvas.addEventListener(
      "webglcontextlost",
      (event) => event.preventDefault(),
      { once: true },
    );
    const lostPromise = waitFor("webglcontextlost");
    extension.loseContext();
    const lost = await lostPromise;
    if (!lost) {
      return {
        supported: true,
        lost: false,
        restored: false,
        duringLoss: null,
        lifecycleAfterRestore: html.dataset.universeWebglLifecycle ?? null,
        generationBefore,
        generationAfter: Number(
          html.dataset.universeWebglContextGeneration ?? "0",
        ),
      };
    }

    const duringLoss = {
      lifecycle: html.dataset.universeWebglLifecycle ?? null,
      recovery: html.dataset.universeWorldRecovery ?? null,
      worldReady: html.dataset.universeWorldReady ?? null,
      screenshotReady: html.dataset.universeWorldScreenshotReady ?? null,
    };

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const restoredPromise = waitFor("webglcontextrestored");
    extension.restoreContext();
    const restored = await restoredPromise;

    return {
      supported: true,
      lost,
      restored,
      duringLoss,
      lifecycleAfterRestore: html.dataset.universeWebglLifecycle ?? null,
      generationBefore,
      generationAfter: Number(
        html.dataset.universeWebglContextGeneration ?? "0",
      ),
    };
  });
}

async function trackDreiStarsPrograms(page: Page) {
  function install() {
    const gl = WebGL2RenderingContext.prototype;
    const vertexShaders = new WeakSet<WebGLShader>();
    const programs = new Set<WebGLProgram>();
    const originalShaderSource = gl.shaderSource;
    const originalAttach = gl.attachShader;
    const originalDelete = gl.deleteProgram;

    // Identify the installed Drei Stars vertex shader, not a specific driver
    // variant. Its different lighting cache keys can emit identical GLSL.
    gl.shaderSource = function (shader, source) {
      if (
        source.includes("attribute float size;") &&
        source.includes("sin(time + 100.0)")
      ) {
        vertexShaders.add(shader);
      }
      originalShaderSource.call(this, shader, source);
    };
    gl.attachShader = function (program, shader) {
      if (vertexShaders.has(shader)) programs.add(program);
      originalAttach.call(this, program, shader);
    };
    gl.deleteProgram = function (program) {
      if (program) programs.delete(program);
      originalDelete.call(this, program);
    };

    Object.defineProperty(window, "__puDreiStarsPrograms", {
      get: () => programs.size,
    });
  }

  await page.addInitScript(install);
  return () =>
    page.evaluate(
      () =>
        (window as Window & { __puDreiStarsPrograms: number })
          .__puDreiStarsPrograms,
    );
}

async function driveGalaxySystemRoundTrip(
  page: Page,
  readStarsPrograms: () => Promise<number>,
) {
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
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-ready",
    "true",
    { timeout: 15_000 },
  );

  // System's readiness can precede its first Three.js draw. Require a
  // compiled program so a skipped System render cannot satisfy teardown.
  await expect.poll(readStarsPrograms).toBeGreaterThan(0);

  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );

  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
  );
  await waitForYeis(page);
  // Unlike a full world journey, Galaxy/System never paints the retained
  // planet starfield. No Drei Stars program has a live owner after return.
  await expect.poll(readStarsPrograms).toBe(0);
}

async function driveFullScaleRoundTrip(page: Page) {
  const html = page.locator("html");

  // This is a resource-lifetime acceptance, not a step-size test. The product
  // intentionally retunes continuous wheel response by scale segment, so drive
  // far enough to the clamped endpoints instead of baking one historical
  // samples-per-phase ratio into the WebGL test.
  for (let sample = 0; sample < 4; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  // Logical scale reaches System before its renderer has mounted and drawn.
  // Exercise the real System in both warm-up and measured journeys.
  await expect(html).toHaveAttribute("data-universe-system-ready", "true");
  await waitForNextWebglMetric(page, await readWebglMetricSample(page));

  for (let sample = 0; sample < 16; sample += 1) {
    if ((await html.getAttribute("data-universe-scale-position")) === "5.000") {
      break;
    }
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-ready",
    "true",
    { timeout: 20_000 },
  );
  if ((await html.getAttribute("data-universe-webgl-software")) === "true") {
    await expect(html).toHaveAttribute(
      "data-universe-surface-terrain-lifecycle",
      "active",
      { timeout: 20_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-surface-renderer",
      "procedural-terrains-fallback",
      { timeout: 20_000 },
    );
  }
  await expect(html).toHaveAttribute(
    "data-universe-world-screenshot-ready",
    "true",
    { timeout: 20_000 },
  );

  for (let sample = 0; sample < 20; sample += 1) {
    if ((await html.getAttribute("data-universe-scale-position")) === "0.000") {
      break;
    }
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
    { timeout: 20_000 },
  );
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
    "data-universe-webgl-metric-sample",
    "data-universe-world-pipeline-allocations",
  ]) {
    await expect(html).toHaveAttribute(attribute, /^\d+$/, {
      timeout: 15_000,
    });
  }

  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      sample: Number(data.universeWebglMetricSample ?? -1),
      renderer: data.universeWebglRenderer ?? "unknown",
      software: data.universeWebglSoftware === "true",
      geometries: Number(data.universeWebglGeometries ?? 0),
      textures: Number(data.universeWebglTextures ?? 0),
      programs: Number(data.universeWebglPrograms ?? 0),
      calls: Number(data.universeWebglCalls ?? 0),
      triangles: Number(data.universeWebglTriangles ?? 0),
      allocations: Number(data.universeWorldPipelineAllocations ?? 0),
      planetAllocations: Number(data.universeWorldPlanetAllocations ?? 0),
      planetPassAllocations: Number(
        data.universeWorldPlanetPassAllocations ?? 0,
      ),
      fallbackTextureAllocations: Number(
        data.universeWorldFallbackTextureAllocations ?? 0,
      ),
      terrainAllocations: Number(data.universeSurfaceTerrainAllocations ?? 0),
      terrainInstance: data.universeSurfaceTerrainInstance ?? null,
      renderPath: data.universeWorldRenderPath ?? null,
      composerTargets: data.universeWorldComposerTargets ?? null,
      bloom: data.universeWorldBloom ?? null,
      lifecycle: data.universeWebglLifecycle ?? null,
      pipelineLifecycle: data.universeWorldPipelineLifecycle ?? null,
      sceneLifecycle: data.universeWorldSceneLifecycle ?? null,
    };
  });
}

async function settleWebglMetrics(page: Page) {
  const current = await readWebglMetrics(page);

  // Pipeline lifecycle transitions publish a synchronous gl.info snapshot.
  // A parked renderer may then stop producing frames entirely, so that
  // lifecycle sample is already the settled result and must not depend on a
  // future animation frame just to make diagnostics fresh.
  if (current.pipelineLifecycle === "parked") {
    return { first: current, second: current };
  }

  await waitForNextWebglMetric(page, current.sample);
  return { first: current, second: await readWebglMetrics(page) };
}

async function readWebglMetricSample(page: Page) {
  const value = await page.locator("html").getAttribute(
    "data-universe-webgl-metric-sample",
  );
  return Number(value ?? -1);
}

async function waitForNextWebglMetric(page: Page, previousSample: number) {
  await expect
    .poll(() => readWebglMetricSample(page), { timeout: 20_000 })
    .toBeGreaterThan(previousSample);
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
  await expect(firstHtml).toHaveAttribute(
    "data-universe-webgl-context-generation",
    "0",
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
  const secondHtml = secondPage.locator("html");
  await expect(secondHtml).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );
  await expect(secondHtml).toHaveAttribute(
    "data-universe-webgl-context-generation",
    "0",
  );
  const secondMetrics = await readWebglMetrics(secondPage);
  await attachMetrics(testInfo, "webgl-fresh-context.json", secondMetrics);
  expect(secondMetrics.renderer).toBe(firstMetrics.renderer);
  expect(secondMetrics.software).toBe(firstMetrics.software);

  await second.close();
});

test("Galaxy System remounts retire WebGL geometry @webgl-heavy", async ({
  page,
}, testInfo) => {
  const readStarsPrograms = await trackDreiStarsPrograms(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  expect(await readStarsPrograms()).toBe(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await driveGalaxySystemRoundTrip(page, readStarsPrograms);
  const first = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-system-cycle-1.json", first);

  await driveGalaxySystemRoundTrip(page, readStarsPrograms);
  const second = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-system-cycle-2.json", second);

  expect(second.renderer).toBe(first.renderer);
  expect(second.geometries).toBeLessThanOrEqual(first.geometries + 1);
  expect(second.textures).toBeLessThanOrEqual(first.textures + 1);
  expect(second.programs).toBeLessThanOrEqual(first.programs + 1);
});

test("retained Surface fallback recovers and parks without resource growth @webgl-heavy", async ({
  page,
}, testInfo) => {
  let boulderRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/models/boulder_01/boulder_01_1k.gltf")) {
      boulderRequests += 1;
    }
  });

  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.locator(".hud-actions select").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-surface-prewarm",
    /^(preparing|ready)$/,
    { timeout: 5_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "active",
    { timeout: 60_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-ready",
    "true",
    { timeout: 15_000 },
  );
  const initial = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-surface-initial.json", initial);
  if (initial.software) {
    expect(
      boulderRequests,
      "software Surface must not request decorative hardware-only GLTF",
    ).toBe(0);
  }

  const recovery = await forceWebglLossAndRestore(page);
  expect(recovery.supported).toBe(true);
  expect(recovery.lost).toBe(true);
  expect(recovery.restored).toBe(true);
  expect(recovery.duringLoss?.lifecycle).toBe("lost");
  expect(recovery.duringLoss?.recovery).toBe("lost");
  expect(recovery.duringLoss?.worldReady).toBeNull();
  expect(recovery.duringLoss?.screenshotReady).toBeNull();
  expect(recovery.lifecycleAfterRestore).toBe("active");
  expect(recovery.generationAfter).toBe(recovery.generationBefore + 1);
  await expect(html).toHaveAttribute(
    "data-universe-world-recovery",
    "ready",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-ready",
    "true",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-screenshot-ready",
    "true",
    { timeout: 15_000 },
  );

  const recovered = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-surface-recovered.json", recovered);
  expect(recovered.renderer).toBe(initial.renderer);
  expect(recovered.allocations).toBe(initial.allocations);
  expect(recovered.terrainAllocations).toBe(initial.terrainAllocations);
  expect(recovered.terrainInstance).toBe(initial.terrainInstance);

  const parkAndResume = async (count: number) => {
    for (let cycle = 0; cycle < count; cycle += 1) {
      await dispatchScaleWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "atmosphere",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-terrain-lifecycle",
        "parked",
        { timeout: 10_000 },
      );

      await dispatchScaleWheel(page, -96);
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "surface",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-terrain-lifecycle",
        "active",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-world-screenshot-ready",
        "true",
        { timeout: 10_000 },
      );
    }
  };

  await parkAndResume(3);
  const firstParkResume = (await settleWebglMetrics(page)).second;
  await attachMetrics(
    testInfo,
    "webgl-surface-park-resume-1.json",
    firstParkResume,
  );

  await parkAndResume(3);
  const secondParkResume = (await settleWebglMetrics(page)).second;
  await attachMetrics(
    testInfo,
    "webgl-surface-park-resume-2.json",
    secondParkResume,
  );

  for (const current of [firstParkResume, secondParkResume]) {
    expect(current.renderer).toBe(recovered.renderer);
    expect(current.allocations).toBe(recovered.allocations);
    expect(current.planetAllocations).toBe(recovered.planetAllocations);
    expect(current.planetPassAllocations).toBe(recovered.planetPassAllocations);
    expect(current.fallbackTextureAllocations).toBe(
      recovered.fallbackTextureAllocations,
    );
    expect(current.terrainAllocations).toBe(recovered.terrainAllocations);
    expect(current.terrainInstance).toBe(recovered.terrainInstance);
  }

  // Context restoration legitimately recreates GPU-side programs/resources.
  // Once that recovered Surface has been exercised, another three park/resume
  // cycles must remain inside the same warmed resource envelope.
  expect(secondParkResume.geometries).toBeLessThanOrEqual(
    firstParkResume.geometries + 1,
  );
  expect(secondParkResume.textures).toBeLessThanOrEqual(
    firstParkResume.textures + 1,
  );
  expect(secondParkResume.programs).toBeLessThanOrEqual(
    firstParkResume.programs + 1,
  );
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

  const cycles: WebglMetrics[] = [];
  for (let cycle = 1; cycle <= 4; cycle += 1) {
    await driveFullScaleRoundTrip(page);
    // "Parked" describes the world pipeline, not the active Galaxy renderer.
    // Compare fresh Galaxy frames after the native scene has returned, not a
    // synchronous parking snapshot taken before that scene mounts or draws.
    await waitForYeis(page);
    await waitForNextWebglMetric(page, await readWebglMetricSample(page));
    const settled = await readWebglMetrics(page);
    cycles.push(settled);
    await attachMetrics(testInfo, `webgl-cycle-${cycle}.json`, settled);
  }
  const baseline = cycles[0]!;

  for (const current of cycles.slice(1)) {
    expect(current.renderer).toBe(baseline.renderer);
    expect(current.software).toBe(baseline.software);
    expect(current.allocations).toBe(baseline.allocations);
    expect(current.planetAllocations).toBe(baseline.planetAllocations);
    expect(current.planetPassAllocations).toBe(baseline.planetPassAllocations);
    expect(current.fallbackTextureAllocations).toBe(
      baseline.fallbackTextureAllocations,
    );
    expect(current.terrainAllocations).toBe(baseline.terrainAllocations);
    expect(current.terrainInstance).toBe(baseline.terrainInstance);
    expect(current.lifecycle).toBe("active");
    expect(current.pipelineLifecycle).toBe("parked");
    expect(current.sceneLifecycle).toBe("parked");
  }

  // Three.js/ProceduralTerrains may lazily compile a final shader variant or
  // upload a clipmap resource on the second complete journey. Treat the first
  // two journeys as the bounded warm-up envelope, then prove two more full
  // journeys cannot grow beyond it. This still catches persistent per-journey
  // leaks while avoiding a false assumption that the very first traversal has
  // already exercised every renderer variant.
  const warmGeometries = Math.max(cycles[0]!.geometries, cycles[1]!.geometries);
  const warmTextures = Math.max(cycles[0]!.textures, cycles[1]!.textures);
  const warmPrograms = Math.max(cycles[0]!.programs, cycles[1]!.programs);
  for (const current of cycles.slice(2)) {
    expect(current.geometries).toBeLessThanOrEqual(warmGeometries + 1);
    expect(current.textures).toBeLessThanOrEqual(warmTextures + 1);
    expect(current.programs).toBeLessThanOrEqual(warmPrograms + 1);
  }
});

test("AUTO LOW AUTO quality switching reuses the existing pipeline @webgl-heavy", async ({
  page,
}, testInfo) => {
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const quality = page.locator(".hud-actions select");
  const html = page.locator("html");
  await expect(quality).toHaveValue("auto");

  const initial = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-quality-auto-before.json", initial);

  for (let cycle = 0; cycle < 2; cycle += 1) {
    await quality.selectOption("low");
    await expect(quality).toHaveValue("low");
    await expect(html).toHaveAttribute("data-universe-world-bloom", "off");
    await expect
      .poll(
        async () =>
          Number(
            await html.getAttribute(
              "data-universe-world-pipeline-allocations",
            ),
          ),
        { timeout: 15_000 },
      )
      .toBe(initial.allocations);

    await quality.selectOption("auto");
    await expect(quality).toHaveValue("auto");
    await expect(html).toHaveAttribute(
      "data-universe-world-bloom",
      initial.software ? "off" : "on",
    );
    await expect
      .poll(
        async () =>
          Number(
            await html.getAttribute(
              "data-universe-world-pipeline-allocations",
            ),
          ),
        { timeout: 15_000 },
      )
      .toBe(initial.allocations);
  }

  const restored = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-quality-auto-restored.json", restored);

  expect(restored.renderer).toBe(initial.renderer);
  expect(restored.software).toBe(initial.software);
  expect(restored.allocations).toBe(initial.allocations);
  if (initial.software) {
    expect(initial.renderPath).toBe("direct");
    expect(initial.composerTargets).toBe("parked-1x1");
    expect(restored.renderPath).toBe("direct");
    expect(restored.composerTargets).toBe("parked-1x1");
  }
  expect(restored.geometries).toBeLessThanOrEqual(initial.geometries + 1);
  expect(restored.textures).toBeLessThanOrEqual(initial.textures + 1);
  expect(restored.programs).toBeLessThanOrEqual(initial.programs + 1);
});


test("software fallback only activates the composer for HIGH live worlds @webgl-heavy", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const quality = page.locator(".hud-actions select");
  const html = page.locator("html");
  await quality.selectOption("auto");
  const autoBefore = (await settleWebglMetrics(page)).second;
  await attachMetrics(
    testInfo,
    "webgl-software-composer-auto-before.json",
    autoBefore,
  );

  test.skip(
    !autoBefore.software,
    "parked composer target acceptance is specific to software WebGL",
  );

  expect(autoBefore.renderPath).toBe("direct");
  expect(autoBefore.composerTargets).toBe("parked-1x1");
  const pipelineAllocations = autoBefore.allocations;

  await quality.selectOption("high");
  await expect(quality).toHaveValue("high");
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-lifecycle",
    "active",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-render-path",
    "composer",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-composer-targets",
    "viewport",
    { timeout: 30_000 },
  );

  const high = (await settleWebglMetrics(page)).second;
  await attachMetrics(testInfo, "webgl-software-composer-high.json", high);
  expect(high.allocations).toBe(pipelineAllocations);
  expect(high.renderPath).toBe("composer");
  expect(high.composerTargets).toBe("viewport");

  await quality.selectOption("auto");
  await expect(quality).toHaveValue("auto");
  await expect(html).toHaveAttribute(
    "data-universe-world-render-path",
    "direct",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-composer-targets",
    "parked-1x1",
    { timeout: 30_000 },
  );

  const autoRestored = (await settleWebglMetrics(page)).second;
  await attachMetrics(
    testInfo,
    "webgl-software-composer-auto-restored.json",
    autoRestored,
  );
  expect(autoRestored.allocations).toBe(pipelineAllocations);
  expect(autoRestored.renderPath).toBe("direct");
  expect(autoRestored.composerTargets).toBe("parked-1x1");
  expect(autoRestored.planetPassAllocations).toBe(high.planetPassAllocations);
});
