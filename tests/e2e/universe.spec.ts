import { mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import {
  continuousScaleResponseDistance,
} from "../../src/lib/universe/continuousScale";
import {
  observeRuntime,
  positiveDataset,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";

async function openNavigator(page: Page) {
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".navigator-header span")).toHaveText(
    "PERSONAL UNIVERSE // SEARCH + PLACES",
  );
  return dialog;
}

async function wheelScale(
  page: Page,
  direction: "in" | "out",
) {
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  const html = page.locator("html");
  const startingPhase = await html.getAttribute(
    "data-universe-navigation-phase",
  );
  const startingPosition = Number(
    await html.getAttribute("data-universe-scale-position"),
  );
  const deltaY = direction === "in" ? -120 : 120;

  const worldAnchor: Record<string, number> = {
    approach: 2,
    orbit: 3,
    atmosphere: 4,
    surface: 5,
  };
  const nextWorldPhase: Record<string, { in?: string; out?: string }> = {
    approach: { in: "orbit", out: "system" },
    orbit: { in: "atmosphere", out: "approach" },
    atmosphere: { in: "surface", out: "orbit" },
    surface: { out: "atmosphere" },
  };
  const expectedWorldPhase =
    startingPhase && nextWorldPhase[startingPhase]
      ? nextWorldPhase[startingPhase][direction]
      : undefined;
  const targetWorldAnchor =
    expectedWorldPhase && worldAnchor[expectedWorldPhase];

  // This helper means "complete one semantic scale interval" for legacy
  // settled-phase tests. Individual browser samples remain real proportional
  // wheel input; tests that assert sub-phase continuity use dispatchScaleWheel
  // directly. When a tuned interval is not an integer multiple of the 96px
  // delivered-sample cap (notably Atmosphere<->Surface at 240px), make the
  // final physical sample exactly consume the remaining response distance.
  // That prevents the test driver itself from overshooting the authored anchor.
  for (let sample = 0; sample < 10; sample += 1) {
    let deliveredDeltaY = deltaY;
    const positionBeforeSample = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    if (
      expectedWorldPhase &&
      Number.isFinite(targetWorldAnchor) &&
      Number.isFinite(positionBeforeSample)
    ) {
      const currentDistance =
        continuousScaleResponseDistance(positionBeforeSample);
      const targetDistance =
        continuousScaleResponseDistance(targetWorldAnchor);
      const remainingDistance = Math.abs(targetDistance - currentDistance);
      if (remainingDistance > 0) {
        const deliveredMagnitude = Math.min(96, remainingDistance);
        deliveredDeltaY =
          direction === "in" ? -deliveredMagnitude : deliveredMagnitude;
      }
    }

    await page.mouse.wheel(0, deliveredDeltaY);
    await page.waitForTimeout(80);

    const phaseAfterSample = await html.getAttribute(
      "data-universe-navigation-phase",
    );
    const blocked = await html.getAttribute("data-universe-scale-blocked");
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );

    if (blocked) break;

    if (startingPhase === "galaxy") {
      if (direction === "out") break;
      if (phaseAfterSample === "system") break;
      if (Number.isFinite(position) && position >= 0.999) {
        // Renderer handoff is paint-gated; more wheel input would overshoot.
        await page.waitForTimeout(160);
        break;
      }
      continue;
    }

    if (startingPhase === "system") {
      if (direction === "out") {
        if (phaseAfterSample === "galaxy") break;
        continue;
      }
      if (phaseAfterSample === "approach") break;
      if (Number.isFinite(position) && position >= 1.999) {
        await page.waitForTimeout(160);
        break;
      }
      continue;
    }

    if (expectedWorldPhase === "system") {
      if (phaseAfterSample === "system") break;
      continue;
    }

    if (
      expectedWorldPhase &&
      Number.isFinite(targetWorldAnchor) &&
      Number.isFinite(position) &&
      Math.abs(position - targetWorldAnchor) <= 0.01 &&
      phaseAfterSample === expectedWorldPhase
    ) {
      break;
    }

    // Surface inward is a true hard limit. A missing/legacy scale-position
    // attribute should also remain a single physical input instead of causing
    // a test helper to synthesize an arbitrary gesture.
    if (
      (startingPhase === "surface" && direction === "in") ||
      (!Number.isFinite(startingPosition) && !Number.isFinite(position))
    ) {
      break;
    }
  }

  await page.waitForTimeout(320);
}

async function dispatchScaleWheel(
  page: Page,
  deltaY: number,
  deltaMode = 0,
) {
  await page.locator("main.universe-root").evaluate(
    (root, sample) => {
      root.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: sample.deltaMode,
          deltaY: sample.deltaY,
        }),
      );
    },
    { deltaY, deltaMode },
  );
}

test("public page publishes canonical and social preview metadata", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const canonicalHref = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonicalHref).toBeTruthy();

  const pageUrl = new URL(page.url());
  const canonicalUrl = new URL(canonicalHref!);
  expect(canonicalUrl.pathname).toBe(pageUrl.pathname);
  expect(canonicalUrl.search).toBe("");

  const description = await page
    .locator('meta[name="description"]')
    .getAttribute("content");
  expect(description).toContain("projects, research, and artifacts");

  const ogTitle = await page
    .locator('meta[property="og:title"]')
    .getAttribute("content");
  const ogUrl = await page
    .locator('meta[property="og:url"]')
    .getAttribute("content");
  const ogImage = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  const twitterCard = await page
    .locator('meta[name="twitter:card"]')
    .getAttribute("content");
  const twitterImage = await page
    .locator('meta[name="twitter:image"]')
    .getAttribute("content");

  expect(ogTitle).toBe("Personal Universe");
  expect(ogUrl).toBe(canonicalHref);
  expect(ogImage).toBeTruthy();
  expect(twitterCard).toBe("summary_large_image");
  expect(twitterImage).toBe(ogImage);

  const previewUrl = new URL(ogImage!);
  expect(previewUrl.pathname).toMatch(/\/social-preview\.png$/);

  const previewResponse = await page.request.get(previewUrl.pathname);
  expect(previewResponse.ok()).toBeTruthy();
  expect(previewResponse.headers()["content-type"]).toContain("image/png");
  expect((await previewResponse.body()).byteLength).toBeGreaterThan(100_000);

  await runtime.assertClean(testInfo);
});

test("default YEIS boots with native galaxy and personal signals", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  const initialRequests = new Set<string>();
  const initialScripts = new Set<string>();
  const expectedOrigin = new URL(
    String(testInfo.project.use.baseURL ?? "http://127.0.0.1:4321"),
  ).origin;

  page.on("request", (request) => {
    const url = request.url();
    if (new URL(url).origin !== expectedOrigin) return;
    const type = request.resourceType();
    if (!["document", "script", "stylesheet", "fetch", "xhr"].includes(type)) return;
    const parsed = new URL(url);
    initialRequests.add(`${type}:${parsed.pathname}`);
    if (type === "script") initialScripts.add(parsed.pathname);
  });

  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-opening-motion",
    "frozen",
  );

  await expect
    .poll(
      async () =>
        page
          .locator("html")
          .getAttribute("data-yeis-landmark-photos-complete"),
      { timeout: 20_000 },
    )
    .toBe("1");
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-requested",
    "15",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-loaded",
    "15",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-landmark-photos-failed",
    "0",
  );

  const content = await positiveDataset(page, "data-personal-content");
  const signals = await positiveDataset(page, "data-personal-signals");
  const overlay = await positiveDataset(page, "data-personal-signal-overlay");

  expect(content).toBeGreaterThan(0);
  expect(signals).toBeGreaterThan(0);
  expect(overlay).toBeGreaterThan(0);
  expect(initialRequests.size).toBeLessThanOrEqual(80);
  expect(initialScripts.size).toBeLessThanOrEqual(40);

  mkdirSync("test-results", { recursive: true });
  const metrics = {
    initialCriticalRequests: initialRequests.size,
    initialScripts: initialScripts.size,
    personalContent: content,
    personalSignals: signals,
    personalSignalOverlay: overlay,
  };
  writeFileSync(
    "test-results/runtime-metrics.json",
    JSON.stringify(metrics, null, 2) + "\n",
  );
  writeFileSync(
    "test-results/runtime-metrics.md",
    [
      "## Browser runtime metrics",
      "",
      "| Metric | Value |",
      "| --- | ---: |",
      `| Initial document/script/style/fetch/xhr requests | ${initialRequests.size} |`,
      `| Initial JS requests | ${initialScripts.size} |`,
      `| Personal content entries | ${content} |`,
      `| Personal signals | ${signals} |`,
      `| Personal signal overlay points | ${overlay} |`,
      "",
    ].join("\n"),
  );

  await testInfo.attach("runtime-metrics.json", {
    body: Buffer.from(JSON.stringify(metrics, null, 2)),
    contentType: "application/json",
  });
  await runtime.assertClean(testInfo);
});

test("System wheel approaches the focused planet before the Approach boundary", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await dispatchScaleWheel(page, -72);

  // The System renderer is still authoritative, but the same camera has
  // already moved 25% toward the focused planet. This gentler bridge removes
  // the old 384px -> 192px input-gain cliff at System without introducing any
  // delayed motion. Renderer identity still changes only at Approach.
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.250",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-camera-segment",
    "system:approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-scale-frame",
    "ready",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-camera-settled",
    "system",
  );

  const radius = Number(
    await html.getAttribute("data-universe-system-scale-radius"),
  );
  const distance = Number(
    await html.getAttribute("data-universe-system-scale-distance"),
  );
  expect(radius).toBeGreaterThan(0);
  expect(distance).toBeGreaterThan(0);

  await dispatchScaleWheel(page, 72);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("HIGH close-world retains one pipeline, Planet and PlanetPass across quality fallback @webgl-heavy", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "HIGH ProceduralPlanets lifetime acceptance is isolated from ordinary software-WebGL release shards",
  );
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("high");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-lifecycle",
    "parked",
  );
  const allocations = Number(
    await html.getAttribute("data-universe-world-pipeline-allocations"),
  );
  expect(allocations).toBeGreaterThan(0);
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await dispatchScaleWheel(page, -72);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.250",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-lifecycle",
    "prewarming",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-webgl-software",
    /true|false/,
    { timeout: 15_000 },
  );
  const softwareRenderer =
    (await html.getAttribute("data-universe-webgl-software")) === "true";
  await expect(html).toHaveAttribute(
    "data-universe-world-live-draw-frame",
    /\d+/,
  );
  expect(
    Number(await html.getAttribute("data-universe-world-live-draw-frame")),
  ).toBeGreaterThanOrEqual(2);
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline",
    "procedural-planets-pass",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-lifecycle",
    "active",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-impostor-pixels",
    softwareRenderer ? "180" : "90",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-live-structure",
    softwareRenderer ? "software" : "high",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-planet-allocations",
    /\d+/,
  );
  const planetAllocations = Number(
    await html.getAttribute("data-universe-world-planet-allocations"),
  );
  expect(planetAllocations).toBeGreaterThan(0);
  await expect(html).toHaveAttribute(
    "data-universe-world-planet-pass-allocations",
    /\d+/,
  );
  const planetPassAllocations = Number(
    await html.getAttribute("data-universe-world-planet-pass-allocations"),
  );
  expect(planetPassAllocations).toBeGreaterThan(0);
  await expect(html).toHaveAttribute(
    "data-universe-world-live-profile",
    softwareRenderer ? "software-high" : "gpu-high",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-live-profile-updates",
    /\d+/,
  );
  const liveProfileUpdates = Number(
    await html.getAttribute("data-universe-world-live-profile-updates"),
  );
  expect(liveProfileUpdates).toBeGreaterThan(0);
  const structuralPromotions = Number(
    (await html.getAttribute("data-universe-world-structural-promotions")) ??
      "0",
  );
  // This case selects HIGH before the live world is provisioned, so it should
  // build the final structure directly rather than AUTO then rebuild.
  expect(structuralPromotions).toBe(0);
  const fallbackTextureAllocations = Number(
    (await html.getAttribute(
      "data-universe-world-fallback-texture-allocations",
    )) ?? "0",
  );
  const firstHighPaintGeneration = Number(
    await html.getAttribute("data-universe-world-paint-generation"),
  );
  expect(firstHighPaintGeneration).toBeGreaterThanOrEqual(0);

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "orbit");
  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(allocations);

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(allocations);

  await page.getByLabel("QUALITY").selectOption("low");
  await expect(html).toHaveAttribute(
    "data-universe-world-capability",
    "fallback-low-quality",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 15_000 },
  );
  const lowPaintGeneration = Number(
    await html.getAttribute("data-universe-world-paint-generation"),
  );
  expect(lowPaintGeneration).toBeGreaterThan(firstHighPaintGeneration);
  await expect(html).not.toHaveAttribute(
    "data-universe-world-live-profile",
    /.+/,
  );
  expect(
    Number(await html.getAttribute("data-universe-world-live-profile-updates")),
  ).toBe(liveProfileUpdates);
  expect(
    Number(await html.getAttribute("data-universe-world-planet-allocations")),
  ).toBe(planetAllocations);
  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(allocations);
  expect(
    Number(
      await html.getAttribute("data-universe-world-planet-pass-allocations"),
    ),
  ).toBe(planetPassAllocations);

  await page.getByLabel("QUALITY").selectOption("high");
  await expect(html).toHaveAttribute(
    "data-universe-world-capability",
    "procedural-planets-live",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-renderer",
    "procedural-planets-live",
    { timeout: 15_000 },
  );
  const secondHighPaintGeneration = Number(
    await html.getAttribute("data-universe-world-paint-generation"),
  );
  expect(secondHighPaintGeneration).toBeGreaterThan(lowPaintGeneration);
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline",
    "procedural-planets-pass",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-live-profile",
    softwareRenderer ? "software-high" : "gpu-high",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-impostor-pixels",
    softwareRenderer ? "180" : "90",
  );
  expect(
    Number(await html.getAttribute("data-universe-world-live-profile-updates")),
  ).toBe(liveProfileUpdates);
  expect(
    Number(await html.getAttribute("data-universe-world-planet-allocations")),
  ).toBe(planetAllocations);
  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(allocations);
  expect(
    Number(
      await html.getAttribute("data-universe-world-planet-pass-allocations"),
    ),
  ).toBe(planetPassAllocations);
  expect(
    Number(
      (await html.getAttribute("data-universe-world-structural-promotions")) ??
        "0",
    ),
  ).toBe(structuralPromotions);
  if (fallbackTextureAllocations > 0) {
    expect(
      Number(
        await html.getAttribute(
          "data-universe-world-fallback-texture-allocations",
        ),
      ),
    ).toBe(fallbackTextureAllocations);
  }

  await runtime.assertClean(testInfo);
});

test("entered HIGH world parks through Galaxy and reuses live allocations @webgl-heavy", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "Repeated HIGH live-world entry is intentionally isolated from ordinary software-WebGL shards",
  );
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  await page.getByLabel("QUALITY").selectOption("high");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );

  const planetAllocations = Number(
    await html.getAttribute("data-universe-world-planet-allocations"),
  );
  const passAllocations = Number(
    await html.getAttribute("data-universe-world-planet-pass-allocations"),
  );
  const pipelineAllocations = Number(
    await html.getAttribute("data-universe-world-pipeline-allocations"),
  );
  expect(planetAllocations).toBeGreaterThan(0);
  expect(passAllocations).toBeGreaterThan(0);
  expect(pipelineAllocations).toBeGreaterThan(0);

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-lifecycle",
    "parked",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-lifecycle",
    "parked",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-world-impostor-pixels",
    /.+/,
  );
  expect(await page.locator("canvas").count()).toBe(1);
  expect(
    Number(await html.getAttribute("data-universe-world-planet-allocations")),
  ).toBe(planetAllocations);

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-impostor-pixels",
    /\d+/,
  );

  expect(
    Number(await html.getAttribute("data-universe-world-planet-allocations")),
  ).toBe(planetAllocations);
  expect(
    Number(
      await html.getAttribute("data-universe-world-planet-pass-allocations"),
    ),
  ).toBe(passAllocations);
  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(pipelineAllocations);
  expect(await page.locator("canvas").count()).toBe(1);

  await runtime.assertClean(testInfo);
});

test("replacing a retained live world releases its renderer-owned cache @webgl-heavy", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "Live renderer cache ownership is exercised under HIGH on hosted software WebGL",
  );
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  await page.getByLabel("QUALITY").selectOption("high");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-planet-pass-allocations",
    /\d+/,
  );

  const releasesBefore = Number(
    (await html.getAttribute("data-universe-world-planet-releases")) ?? "0",
  );

  // Park the same live world all the way back at Galaxy. It remains retained
  // because the captured destination is still Aurora, so no release is
  // allowed merely for scale reversal.
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
    { timeout: 15_000 },
  );
  expect(
    Number(
      (await html.getAttribute("data-universe-world-planet-releases")) ?? "0",
    ),
  ).toBe(releasesBefore);

  // Replacing the captured destination must unmount the old retained world.
  // The sole CinematicPipeline owns PlanetRenderer, so it releases the old
  // body's renderer-side impostor/cache entry before PlanetScene disposes the
  // caller-owned Planet.
  const dialog = await openNavigator(page);
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("月球");
  const moon = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ has: page.locator("strong", { hasText: /^Moon$/ }) })
    .first();
  await expect(moon).toBeVisible();
  await moon.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "body:c0/moon",
    { timeout: 20_000 },
  );

  await expect
    .poll(
      async () =>
        Number(
          (await html.getAttribute(
            "data-universe-world-planet-releases",
          )) ?? "0",
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(releasesBefore);
  expect(await page.locator("canvas").count()).toBe(1);

  await runtime.assertClean(testInfo);
});

test("System handoff waits for a fresh close-world paint on every entry", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await page.evaluate(() => {
    const root = document.documentElement;
    type HandoffEvent = {
      phase: string | null;
      started: string | null;
      paint: string | null;
      camera: string | null;
      system: string | null;
      target: string | null;
      suppressed: string | null;
      world: string | null;
    };
    const events: HandoffEvent[] = [];
    const sample = () => {
      events.push({
        phase: root.dataset.universeNavigationPhase ?? null,
        started: root.dataset.universeWorldPaintStarted ?? null,
        paint: root.dataset.universeWorldPaintReady ?? null,
        camera: root.dataset.universeCameraSettled ?? null,
        system: root.dataset.universeSystemRenderer ?? null,
        target: root.dataset.universeSystemHandoffTarget ?? null,
        suppressed:
          root.dataset.universeSystemTargetSuppressed ?? null,
        world: root.dataset.universeWorldRenderer ?? null,
      });
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-navigation-phase",
        "data-universe-world-paint-started",
        "data-universe-world-paint-ready",
        "data-universe-camera-settled",
        "data-universe-system-renderer",
        "data-universe-system-handoff-target",
        "data-universe-system-target-suppressed",
        "data-universe-world-renderer",
      ],
    });
    Object.assign(window, {
      __worldHandoffEvents: events,
      __worldHandoffObserver: observer,
    });
  });

  const assertFreshPaintHandoff = async () => {
    await wheelScale(page, "in");
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "approach",
    );
    await expect(html).toHaveAttribute(
      "data-universe-world-paint-ready",
      "true",
      { timeout: 15_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-camera-settled",
      "approach",
      { timeout: 15_000 },
    );

    const events = await page.evaluate(() =>
      (
        window as typeof window & {
          __worldHandoffEvents?: Array<{
            phase: string | null;
            started: string | null;
            paint: string | null;
            camera: string | null;
            system: string | null;
            target: string | null;
            suppressed: string | null;
            world: string | null;
          }>;
        }
      ).__worldHandoffEvents ?? [],
    );

    const unpaintedApproach = events.findIndex(
      (event) =>
        event.phase === "approach" &&
        event.paint !== "true" &&
        event.system !== null,
    );
    const paintStarted = events.findIndex(
      (event) =>
        event.phase === "approach" &&
        event.started === "true" &&
        event.system !== null,
    );
    const targetSuppressed = events.findIndex(
      (event) =>
        event.phase === "approach" &&
        event.started === "true" &&
        event.system !== null &&
        event.target !== null &&
        event.suppressed === event.target,
    );
    const painted = events.findIndex(
      (event) =>
        event.phase === "approach" &&
        event.paint === "true",
    );
    const settled = events.findIndex(
      (event) =>
        event.phase === "approach" &&
        event.camera === "approach",
    );

    expect(unpaintedApproach).toBeGreaterThanOrEqual(0);
    expect(paintStarted).toBeGreaterThan(unpaintedApproach);
    expect(targetSuppressed).toBeGreaterThanOrEqual(paintStarted);
    expect(painted).toBeGreaterThan(targetSuppressed);
    expect(settled).toBeGreaterThanOrEqual(painted);
    return Number(
      await html.getAttribute("data-universe-world-paint-generation"),
    );
  };

  const firstPaintGeneration = await assertFreshPaintHandoff();

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-world-paint-started",
    "true",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-handoff-target",
    /.+/,
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-target-suppressed",
    /.+/,
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-lifecycle",
    "prewarming",
  );
  const parkedPaintGeneration = Number(
    await html.getAttribute("data-universe-world-paint-generation"),
  );
  expect(parkedPaintGeneration).toBeGreaterThan(firstPaintGeneration);

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __worldHandoffEvents?: unknown[];
    };
    runtimeWindow.__worldHandoffEvents?.splice(0);
  });

  // Re-entering the same retained world is the important regression case:
  // renderer identity/resources may stay warm, but first-paint authority must
  // be reacquired before System disappears or camera settlement is published.
  const secondPaintGeneration = await assertFreshPaintHandoff();
  expect(secondPaintGeneration).toBeGreaterThan(parkedPaintGeneration);

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __worldHandoffObserver?: MutationObserver;
    };
    runtimeWindow.__worldHandoffObserver?.disconnect();
  });
  await runtime.assertClean(testInfo);
});

test("YEIS native System suppresses only the matched handoff target after first world draw", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=c0&freeze=1");
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-system-renderer",
    "yeis-native",
    { timeout: 20_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const focus = await html.getAttribute("data-universe-system-focus");
  expect(focus).toBeTruthy();

  await page.evaluate(() => {
    const root = document.documentElement;
    const events: Array<{
      phase: string | null;
      started: string | null;
      ready: string | null;
      renderer: string | null;
      target: string | null;
      suppressed: string | null;
    }> = [];
    const sample = () => {
      events.push({
        phase: root.dataset.universeNavigationPhase ?? null,
        started: root.dataset.universeWorldPaintStarted ?? null,
        ready: root.dataset.universeWorldPaintReady ?? null,
        renderer: root.dataset.universeSystemRenderer ?? null,
        target: root.dataset.universeSystemHandoffTarget ?? null,
        suppressed:
          root.dataset.universeSystemTargetSuppressed ?? null,
      });
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-navigation-phase",
        "data-universe-world-paint-started",
        "data-universe-world-paint-ready",
        "data-universe-system-renderer",
        "data-universe-system-handoff-target",
        "data-universe-system-target-suppressed",
      ],
    });
    Object.assign(window, {
      __nativeWorldHandoffEvents: events,
      __nativeWorldHandoffObserver: observer,
    });
  });

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 20_000 },
  );

  const events = await page.evaluate(() =>
    (
      window as typeof window & {
        __nativeWorldHandoffEvents?: Array<{
          phase: string | null;
          started: string | null;
          ready: string | null;
          renderer: string | null;
          target: string | null;
          suppressed: string | null;
        }>;
      }
    ).__nativeWorldHandoffEvents ?? [],
  );
  const firstDraw = events.findIndex(
    (event) =>
      event.phase === "approach" &&
      event.started === "true" &&
      event.renderer === "yeis-native",
  );
  const targetTransfer = events.findIndex(
    (event) =>
      event.phase === "approach" &&
      event.started === "true" &&
      event.ready !== "true" &&
      event.renderer === "yeis-native" &&
      event.target === focus &&
      event.suppressed === focus,
  );
  const fullHandoff = events.findIndex(
    (event) =>
      event.phase === "approach" &&
      event.ready === "true",
  );

  expect(firstDraw).toBeGreaterThanOrEqual(0);
  expect(targetTransfer).toBeGreaterThanOrEqual(firstDraw);
  expect(fullHandoff).toBeGreaterThan(targetTransfer);
  await expect(html).not.toHaveAttribute(
    "data-universe-system-renderer",
    /.+/,
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-target-suppressed",
    /.+/,
  );

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __nativeWorldHandoffObserver?: MutationObserver;
    };
    runtimeWindow.__nativeWorldHandoffObserver?.disconnect();
  });
  await runtime.assertClean(testInfo);
});

test("Orbit capability switches reacquire paint without resurfacing System", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 15_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-renderer",
    /.+/,
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-allocations",
    /\d+/,
  );
  const pipelineAllocations = await html.getAttribute(
    "data-universe-world-pipeline-allocations",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-fallback-texture-allocations",
    /\d+/,
  );
  const fallbackTextureAllocations = await html.getAttribute(
    "data-universe-world-fallback-texture-allocations",
  );

  await page.evaluate(() => {
    const root = document.documentElement;
    const events: Array<{
      capability: string | null;
      paint: string | null;
      system: string | null;
    }> = [];
    const sample = () => {
      events.push({
        capability: root.dataset.universeWorldCapability ?? null,
        paint: root.dataset.universeWorldPaintReady ?? null,
        system: root.dataset.universeSystemRenderer ?? null,
      });
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-world-capability",
        "data-universe-world-paint-ready",
        "data-universe-system-renderer",
      ],
    });
    Object.assign(window, {
      __worldCapabilityEvents: events,
      __worldCapabilityObserver: observer,
    });
  });

  await page.getByLabel("QUALITY").selectOption("low");
  await expect(html).toHaveAttribute(
    "data-universe-world-capability",
    "fallback-low-quality",
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 15_000 },
  );

  await page.getByLabel("QUALITY").selectOption("auto");
  await expect(html).toHaveAttribute(
    "data-universe-world-capability",
    "fallback-software-renderer",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 15_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-renderer",
    /.+/,
  );
  expect(
    await html.getAttribute("data-universe-world-pipeline-allocations"),
  ).toBe(pipelineAllocations);
  expect(
    await html.getAttribute(
      "data-universe-world-fallback-texture-allocations",
    ),
  ).toBe(fallbackTextureAllocations);

  const events = await page.evaluate(() =>
    (
      window as typeof window & {
        __worldCapabilityEvents?: Array<{
          capability: string | null;
          paint: string | null;
          system: string | null;
        }>;
      }
    ).__worldCapabilityEvents ?? [],
  );
  expect(
    events.some(
      (event) =>
        event.capability === "fallback-low-quality" &&
        event.paint !== "true",
    ),
  ).toBe(true);
  expect(
    events.some(
      (event) =>
        event.capability === "fallback-software-renderer" &&
        event.paint !== "true",
    ),
  ).toBe(true);
  expect(events.some((event) => event.system !== null)).toBe(false);

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __worldCapabilityObserver?: MutationObserver;
    };
    runtimeWindow.__worldCapabilityObserver?.disconnect();
  });
  await runtime.assertClean(testInfo);
});

test("wheel scale advances and reverses world layers without auto chaining", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  // Arrival alone must not auto-chain into orbit anymore.
  await page.waitForTimeout(420);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "orbit");
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "surface");

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute("data-universe-camera-settled", "orbit");
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );

  await runtime.assertClean(testInfo);
});

test("close-world wheel moves the live camera before a semantic phase boundary", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -72);

  // Three eighths of the Approach -> Orbit interval: semantic identity has
  // not changed, but the one camera authority is already at the interpolated
  // position. This is the contract that the old threshold/phase ladder lacked.
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.375",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-camera-segment",
    "approach:orbit",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );

  await dispatchScaleWheel(page, 72);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("low-quality Surface retains the existing terrain fallback", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
    { timeout: 15_000 },
  );

  await runtime.assertClean(testInfo);
});

test("LOW Surface handoff keeps the globe until retained terrain is actually ready", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 15_000 },
  );

  await page.evaluate(() => {
    const root = document.documentElement;
    type SurfaceHandoffEvent = {
      phase: string | null;
      terrain: string | null;
      renderer: string | null;
      camera: string | null;
      worldPaint: string | null;
      worldLifecycle: string | null;
    };
    const events: SurfaceHandoffEvent[] = [];
    const sample = () => {
      events.push({
        phase: root.dataset.universeNavigationPhase ?? null,
        terrain: root.dataset.universeSurfaceTerrainState ?? null,
        renderer: root.dataset.universeSurfaceRenderer ?? null,
        camera: root.dataset.universeCameraSettled ?? null,
        worldPaint: root.dataset.universeWorldPaintReady ?? null,
        worldLifecycle: root.dataset.universeWorldSceneLifecycle ?? null,
      });
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-navigation-phase",
        "data-universe-surface-terrain-state",
        "data-universe-surface-renderer",
        "data-universe-camera-settled",
        "data-universe-world-paint-ready",
        "data-universe-world-scene-lifecycle",
      ],
    });
    Object.assign(window, {
      __surfaceHandoffEvents: events,
      __surfaceHandoffObserver: observer,
    });
  });

  // Four half-interval samples intentionally reach Surface before the
  // Atmosphere idle-prewarm window can finish. The coordinate remains direct
  // input; only renderer/camera presentation waits for the retained terrain.
  for (let sample = 0; sample < 4; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(16);
  }

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-state",
    "ready",
    { timeout: 60_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-ready-view",
    "landing-prestream",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-scene-lifecycle",
    "parked",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-system-renderer",
    /.+/,
  );

  const events = await page.evaluate(() =>
    (
      window as typeof window & {
        __surfaceHandoffEvents?: Array<{
          phase: string | null;
          terrain: string | null;
          renderer: string | null;
          camera: string | null;
          worldPaint: string | null;
          worldLifecycle: string | null;
        }>;
      }
    ).__surfaceHandoffEvents ?? [],
  );

  const pendingSurface = events.findIndex(
    (event) =>
      event.phase === "surface" &&
      event.terrain !== "ready" &&
      event.renderer === null &&
      event.worldPaint === "true",
  );
  const terrainReady = events.findIndex(
    (event) =>
      event.phase === "surface" &&
      event.terrain === "ready",
  );
  const rendererActive = events.findIndex(
    (event) =>
      event.phase === "surface" &&
      event.renderer === "procedural-terrains-fallback",
  );
  const cameraSettled = events.findIndex(
    (event) =>
      event.phase === "surface" &&
      event.camera === "surface",
  );

  expect(pendingSurface).toBeGreaterThanOrEqual(0);
  expect(terrainReady).toBeGreaterThan(pendingSurface);
  expect(rendererActive).toBeGreaterThanOrEqual(terrainReady);
  expect(cameraSettled).toBeGreaterThanOrEqual(terrainReady);

  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __surfaceHandoffObserver?: MutationObserver;
    };
    runtimeWindow.__surfaceHandoffObserver?.disconnect();
  });
  await runtime.assertClean(testInfo);
});

test("live landing frame is revoked at four and reacquired on re-entry @webgl-heavy", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "HIGH forces the live ProceduralPlanets path on hosted software WebGL",
  );
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("high");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-world-paint-ready",
    "true",
    { timeout: 30_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.000",
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -48);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.600",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-planets-live-surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-camera-frame",
    "ready",
    { timeout: 15_000 },
  );

  // Crossing back to the exact Atmosphere anchor removes the live landing
  // anchor and clears the published frame. Rotation is allowed to resume only
  // at/below this boundary.
  await dispatchScaleWheel(page, 96);
  await dispatchScaleWheel(page, 48);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.000",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-surface-camera-frame",
    /.+/,
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-planets-live-surface",
  );

  await page.waitForTimeout(320);

  // A new inward crossing gets a fresh anchor instance/frame from the current
  // planet transform rather than reviving the stale frame from the prior pass.
  await dispatchScaleWheel(page, -48);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.200",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-planets-live-surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-camera-frame",
    "ready",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );

  await runtime.assertClean(testInfo);
});

test("LOW fallback prewarm cancels on immediate reverse and resumes before Surface", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");

  // Hold the first Atmosphere idle job so reversal and the stale callback can
  // be delivered in the same browser task. This reproduces the renderer-stall
  // ordering where phaseRef has already moved outward but React effect cleanup
  // has not necessarily reconciled yet.
  await page.evaluate(() => {
    const runtimeWindow = window as typeof window & {
      __surfaceIdleQueue?: Array<() => void>;
      __restoreSurfaceIdle?: () => void;
    };
    const originalRequestIdle = window.requestIdleCallback?.bind(window);
    const originalCancelIdle = window.cancelIdleCallback?.bind(window);
    runtimeWindow.__surfaceIdleQueue = [];
    window.requestIdleCallback = ((
      callback: Parameters<typeof window.requestIdleCallback>[0],
    ) => {
      const queue = runtimeWindow.__surfaceIdleQueue!;
      queue.push(() =>
        callback({
          didTimeout: true,
          timeRemaining: () => 0,
        }),
      );
      return queue.length;
    }) as typeof window.requestIdleCallback;
    window.cancelIdleCallback = (() => {}) as typeof window.cancelIdleCallback;
    runtimeWindow.__restoreSurfaceIdle = () => {
      window.requestIdleCallback = originalRequestIdle!;
      window.cancelIdleCallback = originalCancelIdle!;
    };
  });

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-prewarm",
    "scheduled",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __surfaceIdleQueue?: Array<() => void>;
            }
          ).__surfaceIdleQueue?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);

  await page.locator("main.universe-root").evaluate((root) => {
    root.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 96,
      }),
    );
    const runtimeWindow = window as typeof window & {
      __surfaceIdleQueue?: Array<() => void>;
      __restoreSurfaceIdle?: () => void;
    };
    const staleJobs = runtimeWindow.__surfaceIdleQueue?.splice(0) ?? [];
    for (const run of staleJobs) run();
    runtimeWindow.__restoreSurfaceIdle?.();
  });

  await expect(html).toHaveAttribute("data-universe-navigation-phase", "orbit");
  await expect(html).toHaveAttribute(
    "data-universe-surface-prewarm",
    "cancelled",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    /\d+/,
  );

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-surface-prewarm"),
      { timeout: 15_000 },
    )
    .toMatch(/preparing|ready/);
  await expect
    .poll(
      async () =>
        html.getAttribute("data-universe-surface-terrain-lifecycle"),
      { timeout: 15_000 },
    )
    .toMatch(/preparing|parked/);
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );

  // Reverse after actual construction has started. This is no longer the
  // cancellable idle timer: the one retained terrain may finish preparing
  // while parked, and re-entry must not allocate a replacement.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "orbit");
  await expect
    .poll(
      async () => html.getAttribute("data-universe-surface-prewarm"),
      { timeout: 10_000 },
    )
    .toMatch(/preparing|ready/);
  await expect
    .poll(
      async () =>
        html.getAttribute("data-universe-surface-terrain-lifecycle"),
      { timeout: 10_000 },
    )
    .toMatch(/preparing|parked/);
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "surface");
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "parked",
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );
  await runtime.assertClean(testInfo);
});

test("the first opening wheel always acquires a scale target", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "auto-orbit",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );
  await page.mouse.wheel(0, -120);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.250",
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-galaxy-scale-target"),
      { timeout: 10_000 },
    )
    .not.toBeNull();

  // When the opening composition has no explicit centre pick, the soft
  // fallback must demonstrate the only current full Galaxy→Surface path.
  if (
    (await html.getAttribute("data-universe-scale-soft-focus")) ===
    "consumed-fallback"
  ) {
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-target",
      "hero:aurora-01",
    );
  }
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-blocked",
    "no-galaxy-focus",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "stopped",
  );

  await runtime.assertClean(testInfo);
});

test("manual galaxy takeover disables the opening soft focus", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-scale-soft-focus",
    "available",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.62;
  const y = box!.y + box!.height * 0.48;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 90, y + 30, { steps: 6 });
  await page.mouse.up();

  await expect(html).toHaveAttribute(
    "data-universe-scale-soft-focus",
    "disabled",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "stopped",
  );

  await runtime.assertClean(testInfo);
});

test("continuous wheel coordinate crosses close-world boundaries without waiting for settlement", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Keep scrolling without waiting for authored shot settlement. Six capped
  // 96px samples reach 4.8 and one final 48px physical sample consumes the
  // remaining response distance to Surface=5; there is no world-step queue.
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(60);
  }
  await page.mouse.wheel(0, -48);
  await page.waitForTimeout(60);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 30_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 30_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("rapid reverse during transition supersedes stale camera completion", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  await page.mouse.wheel(0, -120);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );

  // Reverse the continuous coordinate before crossing the Orbit anchor.
  // The camera must return to the exact Approach anchor with no stale
  // intermediate completion winning afterward.
  await page.waitForTimeout(40);
  await page.mouse.wheel(0, 120);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute("data-universe-scale-index", "2");
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  // Give any stale intermediate rest/completion ample opportunity to arrive.
  await page.waitForTimeout(800);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );

  await runtime.assertClean(testInfo);
});

test("trackpad-like small deltas move the close-world coordinate continuously", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // A tiny trackpad sample now produces visible scale motion immediately;
  // it is not held behind a discrete threshold accumulator.
  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.083",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  // The coordinate itself survives an input pause. Continue the gesture until
  // the exact Orbit anchor (3.0) is reached.
  await page.waitForTimeout(600);
  for (let index = 0; index < 11; index += 1) {
    await dispatchScaleWheel(page, -16);
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "3.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("wheel units and stalled coalesced samples map to bounded scale distance", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  // Three line units become 48 CSS-pixel-equivalent units: exactly a quarter
  // of the Approach -> Orbit interval, without treating line mode as 3 pixels.
  await dispatchScaleWheel(page, -3, 1);
  await expect(html).toHaveAttribute("data-universe-scale-position", "2.250");
  await expect(html).toHaveAttribute("data-universe-scale-input", "line");
  await expect(html).toHaveAttribute("data-universe-scale-delta", "-48.000");

  // A pathological coalesced sample is capped to 96px and is not replayed as
  // hidden momentum after the browser/main thread catches up.
  await page.waitForTimeout(350);
  await dispatchScaleWheel(page, -900);
  await expect(html).toHaveAttribute("data-universe-scale-position", "2.750");
  await expect(html).toHaveAttribute("data-universe-scale-delta", "-96.000");
  const stalledPosition = await html.getAttribute(
    "data-universe-scale-position",
  );
  await page.waitForTimeout(600);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    stalledPosition!,
  );

  await runtime.assertClean(testInfo);
});

test("surface reversal starts a new gesture and moves outward immediately", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );

  await page.mouse.wheel(0, -120);
  await expect(html).toHaveAttribute("data-universe-scale-position", "5.000");
  await expect(html).toHaveAttribute(
    "data-universe-scale-blocked",
    "surface-limit",
  );
  const inwardGesture = Number(
    await html.getAttribute("data-universe-scale-gesture"),
  );

  await page.mouse.wheel(0, 120);
  await expect(html).toHaveAttribute("data-universe-scale-position", "4.600");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-scale-gesture")),
    )
    .toBeGreaterThan(inwardGesture);
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("surface boundary stays settled and outward wheel returns all the way to galaxy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "active",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-blocked",
    "surface-limit",
  );

  for (const phase of ["atmosphere", "orbit", "approach"] as const) {
    await wheelScale(page, "out");
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      phase,
    );
    await expect(html).not.toHaveAttribute(
      "data-universe-camera-settled",
      phase === "atmosphere" ? "surface" : phase === "orbit" ? "atmosphere" : "orbit",
    );
    await expect(html).toHaveAttribute(
      "data-universe-camera-settled",
      phase,
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-surface-terrain-lifecycle",
      "parked",
    );
  }

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute("data-universe-scale-index", "0");
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("reduced motion keeps continuous scale reversible and settled", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 8_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 5_000 },
  );

  await wheelScale(page, "out");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 5_000 },
  );

  await runtime.assertClean(testInfo);
});

test("Search takeover freezes an in-flight continuous world scale coordinate", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Move halfway toward Orbit and open Search in the same browser task.
  // Search is a higher-priority authority: it freezes the coordinate where
  // the user left it instead of allowing hidden queued phase motion.
  await page.locator("main.universe-root").evaluate((root) => {
    root.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -120,
      }),
    );
    const searchButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("SEARCH / PLACES"),
    );
    if (!(searchButton instanceof HTMLButtonElement)) {
      throw new Error("Search button unavailable during scale takeover");
    }
    searchButton.click();
  });
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );

  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");
  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "navigator-open",
  );

  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("wheel enters a centered YEIS star focus without clicking", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=star:c0&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "star:c0",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "star:c0",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("Galaxy scale uses small wheel deltas as direct native LOD distance", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.042",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system",
    "h-aurora",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system-ready",
    "true",
  );
  await expect(html).toHaveAttribute(
    "data-yeis-native-system-overview",
    "approaching:h-aurora",
  );

  const firstRatio = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  expect(firstRatio).toBeGreaterThan(1);

  await dispatchScaleWheel(page, -16);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.083",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeLessThan(firstRatio);

  await runtime.assertClean(testInfo);
});

test("Galaxy scale reverses the same native LOD path before System", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect
    .poll(async () =>
      Number(
        await html.getAttribute(
          "data-universe-galaxy-scale-applied-position",
        ),
      ),
    )
    .toBeCloseTo(0.5, 2);
  const inwardRatio = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );

  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.250",
  );
  await expect
    .poll(async () =>
      Number(
        await html.getAttribute(
          "data-universe-galaxy-scale-applied-position",
        ),
      ),
    )
    .toBeCloseTo(0.25, 2);
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeGreaterThan(inwardRatio);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  await runtime.assertClean(testInfo);
});

test("Galaxy native LOD reaches the matched System endpoint only at scale one", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, -96);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-entry-view",
    "yeis-native",
    { timeout: 10_000 },
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();

  // The first outward sample crosses back into Galaxy at a proportional 0.75,
  // not through the legacy return jump.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("release scale trace is monotonic from Galaxy zero to Surface five and back", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const trace: Array<{
    direction: "in" | "out";
    position: number;
    phase: string | null;
    bridge: string | null;
    renderer: string | null;
  }> = [];

  const sample = async (direction: "in" | "out") => {
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    trace.push({
      direction,
      position,
      phase: await html.getAttribute("data-universe-navigation-phase"),
      bridge: await html.getAttribute("data-universe-galaxy-scale-bridge"),
      renderer:
        (await html.getAttribute("data-universe-world-renderer")) ??
        (await html.getAttribute("data-universe-system-renderer")) ??
        (await html.getAttribute("data-yeis-native-system")),
    });
    return position;
  };

  let previous = 0;
  for (let index = 0; index < 18; index += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(100);
    const position = await sample("in");
    expect(position).toBeGreaterThanOrEqual(previous - 0.001);
    expect(position).toBeLessThanOrEqual(5.001);
    previous = position;
    if (position >= 4.999) break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );

  previous = 5;
  for (let index = 0; index < 24; index += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(100);
    const position = await sample("out");
    expect(position).toBeLessThanOrEqual(previous + 0.001);
    expect(position).toBeGreaterThanOrEqual(-0.001);
    previous = position;
    const phase = await html.getAttribute("data-universe-navigation-phase");
    if (position <= 0.001 && phase === "galaxy") break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-navigation-phase",
    "returning",
  );

  expect(trace.some((entry) => entry.position > 0 && entry.position < 1))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 1 && entry.position < 2))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 2 && entry.position < 3))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 3 && entry.position < 4))
    .toBeTruthy();
  expect(trace.some((entry) => entry.position > 4 && entry.position < 5))
    .toBeTruthy();

  await testInfo.attach("continuous-scale-release-trace.json", {
    body: Buffer.from(JSON.stringify(trace, null, 2)),
    contentType: "application/json",
  });
  await runtime.assertClean(testInfo);
});

test("high-frequency sustained wheel crosses renderer handoffs without losing scale intent", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  // Approximate a 60 Hz sustained wheel/trackpad burst. Samples that arrive
  // while Galaxy/System are sitting on a matched endpoint must not invalidate
  // the paint/deadline handoff and strand the scale coordinate there.
  for (let sample = 0; sample < 28; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(16);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    if (position >= 4.999) break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  for (let sample = 0; sample < 28; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(16);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    const phase = await html.getAttribute("data-universe-navigation-phase");
    if (position <= 0.001 && phase === "galaxy") break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  expect(await page.locator("canvas").count()).toBe(1);
  await runtime.assertClean(testInfo);
});

test("120Hz-like burst stays reversible across Galaxy System and Approach handoffs", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const inwardTrace: number[] = [];
  for (let sample = 0; sample < 24; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(8);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    inwardTrace.push(position);
    if (position >= 2.499) break;
  }

  for (let index = 1; index < inwardTrace.length; index += 1) {
    expect(inwardTrace[index]).toBeGreaterThanOrEqual(
      inwardTrace[index - 1] - 0.001,
    );
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    /approach|orbit/,
    { timeout: 10_000 },
  );
  expect(Number(await html.getAttribute("data-universe-scale-position")))
    .toBeGreaterThanOrEqual(2.499);

  const outwardTrace: number[] = [];
  for (let sample = 0; sample < 32; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(8);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    outwardTrace.push(position);
    const phase = await html.getAttribute("data-universe-navigation-phase");
    if (position <= 0.001 && phase === "galaxy") break;
  }

  for (let index = 1; index < outwardTrace.length; index += 1) {
    expect(outwardTrace[index]).toBeLessThanOrEqual(
      outwardTrace[index - 1] + 0.001,
    );
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");
  expect(await page.locator("canvas").count()).toBe(1);

  await testInfo.attach("continuous-scale-120hz-trace.json", {
    body: Buffer.from(
      JSON.stringify({ inward: inwardTrace, outward: outwardTrace }, null, 2),
    ),
    contentType: "application/json",
  });
  await runtime.assertClean(testInfo);
});

test("144Hz-like close-world burst reverses without phase or camera backlog", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const forward: number[] = [];
  for (let sample = 0; sample < 14; sample += 1) {
    await dispatchScaleWheel(page, -48);
    await page.waitForTimeout(7);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    forward.push(position);
    if (position >= 4.499) break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.600",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );

  const reverse: number[] = [];
  for (let sample = 0; sample < 12; sample += 1) {
    await dispatchScaleWheel(page, 48);
    await page.waitForTimeout(7);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    reverse.push(position);
    if (position <= 2.001) break;
  }

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  for (let index = 1; index < forward.length; index += 1) {
    expect(forward[index]).toBeGreaterThanOrEqual(forward[index - 1] - 0.001);
  }
  for (let index = 1; index < reverse.length; index += 1) {
    expect(reverse[index]).toBeLessThanOrEqual(reverse[index - 1] + 0.001);
  }

  await runtime.assertClean(testInfo);
});

test("trackpad inertia tail stops exactly where delivered samples end", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  // A decaying touchpad-like tail must affect the coordinate only through the
  // samples the browser actually delivered. There is no project-owned inertia
  // engine and no hidden replay queue after the final 3px sample.
  for (const deltaY of [-72, -36, -18, -9, -5, -3]) {
    await dispatchScaleWheel(page, deltaY);
    await page.waitForTimeout(12);
  }

  const stoppedAt = await html.getAttribute("data-universe-scale-position");
  expect(stoppedAt).not.toBeNull();
  await page.waitForTimeout(900);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    stoppedAt!,
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  const beforeReverse = Number(stoppedAt);
  await dispatchScaleWheel(page, 8);
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-scale-position")),
    )
    .toBeLessThan(beforeReverse);
  await expect(html).toHaveAttribute(
    "data-universe-scale-reversal",
    /\d+/,
  );

  await runtime.assertClean(testInfo);
});

test("Search freezes and resumes a partial Galaxy scale path", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-applied-position",
    "0.500",
  );

  const beforeSearch = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  const dialog = await openNavigator(page);
  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "navigator-open",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  await page.waitForTimeout(500);
  const duringSearch = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  expect(Math.abs(duringSearch - beforeSearch)).toBeLessThan(0.02);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.750",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
    )
    .toBeLessThan(beforeSearch);

  await runtime.assertClean(testInfo);
});

test("Search native travel keeps autopilot authority after partial Galaxy scale", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.500");
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-executor",
    "native-progress",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-applied-position",
    "0.500",
  );

  const dialog = await openNavigator(page);
  const search = page.getByRole("combobox", { name: "Search universe" });
  // The localized alias resolves into the live native body catalogue. Detail
  // text is runtime-owned (for example "MOON · Sol"), so select the canonical
  // native title and let the identity assertions below prove the exact body.
  await search.fill("月球");
  const moon = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ has: page.locator("strong", { hasText: /^Moon$/ }) })
    .first();
  await expect(moon).toBeVisible();
  await moon.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "body:c0/moon",
  );
  await expect(html).toHaveAttribute("data-universe-navigation-target", "c0/moon");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-target");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-executor");

  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute("data-universe-travel-complete");
      return traveling === "c0/moon" || complete === "c0/moon";
    })
    .toBe(true);
  await expect(html).toHaveAttribute(
    "data-universe-travel-complete",
    "c0/moon",
    { timeout: 15_000 },
  );
  const travelDeltaPc = Number(
    await html.getAttribute("data-universe-travel-delta-pc"),
  );
  expect(Number.isFinite(travelDeltaPc)).toBeTruthy();
  expect(travelDeltaPc).toBeGreaterThan(1e-9);

  await runtime.assertClean(testInfo);
});

test("Guided Journey supersedes a partial Galaxy scale path without stale System handoff", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  // Search temporarily freezes the retained path. Starting a Journey is a
  // stronger authority takeover: it must discard that path before the first
  // Journey destination is opened.
  const dialog = await openNavigator(page);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );

  await page.evaluate(() => {
    const root = document.documentElement;
    const phases: string[] = [];
    Object.assign(window, { __journeyTakeoverPhases: phases });
    new MutationObserver(() => {
      phases.push(root.dataset.universeNavigationPhase ?? "");
    }).observe(root, {
      attributes: true,
      attributeFilter: ["data-universe-navigation-phase"],
    });
  });

  await page.getByRole("button", { name: /Featured Journey/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".universe-journey-controls")).toBeVisible();
  await expect(html).not.toHaveAttribute(
    "data-universe-galaxy-scale-target",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  // The first Featured Journey stop is an Approach destination. A stale
  // coordinate-1 completion would briefly or permanently reassert System after
  // Journey takeover, which is forbidden.
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  const phaseHistory = await page.evaluate(() =>
    ((window as typeof window & { __journeyTakeoverPhases?: string[] })
      .__journeyTakeoverPhases ?? []),
  );
  expect(phaseHistory.filter(Boolean)).not.toContain("system");

  await runtime.assertClean(testInfo);
});

test("manual pointer takeover freezes a partial Galaxy scale coordinate", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width * 0.55;
  const y = box!.y + box!.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 24, { steps: 6 });
  await page.mouse.up();

  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "manual-camera",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-galaxy-scale-target",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  // A stale direct-scale completion must not fire after pointer authority wins.
  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.500",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-galaxy-scale-executor",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-galaxy-scale-target",
  );

  await runtime.assertClean(testInfo);
});

test("touch drag takeover freezes a partial Galaxy scale coordinate", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.500");
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-executor",
    "native-progress",
  );

  await page.locator("canvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.55;
    const y = rect.top + rect.height * 0.5;
    const init = {
      bubbles: true,
      cancelable: true,
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", init));
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        ...init,
        clientX: x + 72,
        clientY: y + 20,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        ...init,
        buttons: 0,
        clientX: x + 72,
        clientY: y + 20,
      }),
    );
  });

  await expect(html).toHaveAttribute(
    "data-universe-scale-superseded",
    "manual-camera",
  );
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.500");
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "galaxy");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-target");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-executor");

  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.500");
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "galaxy");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-target");
  await expect(html).not.toHaveAttribute("data-universe-galaxy-scale-executor");

  await runtime.assertClean(testInfo);
});

test("partial Galaxy scale tolerates repeated direction changes without hidden travel", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const sequence = [
    [-96, "0.250"],
    [-96, "0.500"],
    [96, "0.250"],
    [-96, "0.500"],
    [96, "0.250"],
    [96, "0.000"],
    [-96, "0.250"],
  ] as const;

  for (const [deltaY, position] of sequence) {
    await dispatchScaleWheel(page, deltaY);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      position,
    );
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    await expect(html).not.toHaveAttribute("data-universe-traveling");
  }

  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );
  await runtime.assertClean(testInfo);
});

test("repeated Galaxy System round trips reuse one canvas and one scale target", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  let retainedPathId: string | null = null;
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (let sample = 0; sample < 4; sample += 1) {
      await dispatchScaleWheel(page, -96);
      await page.waitForTimeout(60);
      if (sample === 0) {
        await expect(html).toHaveAttribute(
          "data-universe-galaxy-scale-path-id",
          /.+/,
        );
        const currentPathId = await html.getAttribute(
          "data-universe-galaxy-scale-path-id",
        );
        expect(currentPathId).toBeTruthy();
        if (retainedPathId === null) retainedPathId = currentPathId;
        expect(currentPathId).toBe(retainedPathId);
      }
    }
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "system",
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-system-entry-view",
      "yeis-native",
      { timeout: 10_000 },
    );
    expect(await page.locator("canvas").count()).toBe(1);

    for (let sample = 0; sample < 4; sample += 1) {
      await dispatchScaleWheel(page, 96);
      await page.waitForTimeout(60);
    }
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "0.000",
    );
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-target",
      "hero:aurora-01",
    );
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-path-id",
      retainedPathId!,
    );
    expect(await page.locator("canvas").count()).toBe(1);
  }

  await runtime.assertClean(testInfo);
});

test("outward wheel preserves proportional delta across Approach System Galaxy boundaries", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  // Galaxy 0 -> System 1 using four physical 96px samples.
  for (let sample = 0; sample < 4; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(60);
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

  // System 1 -> Approach 2 deliberately uses a 288px response budget so the
  // transition does not double in apparent input gain at the renderer bridge.
  // Three delivered 96px samples reach the exact endpoint with no queue.
  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(60);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );

  // The renderer boundary must not consume the outward sample. The same 288px
  // System response budget applies in reverse, so +96 retraces exactly one
  // third of the interval instead of accelerating at the handoff.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.667",
  );

  // Continue proportionally through the matched System endpoint and straight
  // back onto the retained native Galaxy path.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.333",
  );
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
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
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("Galaxy direct scale keeps one captured physical path through intermediate coordinates and reversal", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const target = "hero:aurora-01";
  let previousRatio = Number.POSITIVE_INFINITY;
  const driveTo = async (deltaY: number, expected: number) => {
    await dispatchScaleWheel(page, deltaY);
    await expect
      .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
      .toBeCloseTo(expected, 2);
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-target",
      target,
    );
    await expect
      .poll(async () =>
        Number(
          await html.getAttribute(
            "data-universe-galaxy-scale-applied-position",
          ),
        ),
      )
      .toBeCloseTo(expected, 2);
    const ratio = Number(
      await html.getAttribute("data-universe-travel-arrival-ratio"),
    );
    expect(Number.isFinite(ratio)).toBeTruthy();
    expect(ratio).toBeLessThan(previousRatio);
    previousRatio = ratio;
  };

  // 384 px spans Galaxy=0 -> System=1. These values deliberately land on
  // product-visible intermediate coordinates without crossing a semantic phase.
  await driveTo(-76.8, 0.2);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-executor",
    "native-progress",
  );
  await driveTo(-96, 0.45);
  await driveTo(-19.2, 0.5);

  // Elapsed frame time must not advance the native Galaxy trajectory. Holding
  // the wheel at coordinate 0.5 keeps the physical camera at the same point;
  // only another scale sample may move it.
  const ratioAtHalf = previousRatio;
  const executorRevisionAtHalf = await html.getAttribute(
    "data-universe-galaxy-scale-executor-revision",
  );
  expect(executorRevisionAtHalf).toBeTruthy();
  await page.waitForTimeout(300);
  expect(
    Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
  ).toBeCloseTo(ratioAtHalf, 4);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-executor-revision",
    executorRevisionAtHalf!,
  );

  await driveTo(-96, 0.75);
  await driveTo(-19.2, 0.8);

  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-path",
    /->h-aurora$/,
  );
  const frameJumpKm = Number(
    await html.getAttribute("data-universe-galaxy-scale-frame-jump-km"),
  );
  const startDistanceKm = Number(
    await html.getAttribute("data-universe-galaxy-scale-start-distance-km"),
  );
  const endpointDistanceKm = Number(
    await html.getAttribute("data-universe-galaxy-scale-endpoint-distance-km"),
  );
  expect(Number.isFinite(frameJumpKm)).toBeTruthy();
  expect(Number.isFinite(startDistanceKm)).toBeTruthy();
  expect(Number.isFinite(endpointDistanceKm)).toBeTruthy();
  expect(startDistanceKm).toBeGreaterThan(endpointDistanceKm);
  expect(frameJumpKm).toBeLessThanOrEqual(
    Math.max(1, startDistanceKm * 1e-12),
  );

  const ratioAtEightTenths = previousRatio;
  await dispatchScaleWheel(page, 96);
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(0.55, 2);
  await expect
    .poll(async () =>
      Number(
        await html.getAttribute(
          "data-universe-galaxy-scale-applied-position",
        ),
      ),
    )
    .toBeCloseTo(0.55, 2);
  const reverseRatio = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  expect(reverseRatio).toBeGreaterThan(ratioAtEightTenths);

  await dispatchScaleWheel(page, 57.6);
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(0.4, 2);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    target,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );

  await runtime.assertClean(testInfo);
});


test("Galaxy direct scale accepts tiny mixed trackpad deltas across pauses", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const samples = [-4, -8, -16, -32];
  let accumulated = 0;
  let previousRatio = Number.POSITIVE_INFINITY;
  for (const deltaY of samples) {
    accumulated += -deltaY / 384;
    await dispatchScaleWheel(page, deltaY);
    await expect
      .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
      .toBeCloseTo(accumulated, 2);
    await expect
      .poll(async () =>
        Number(
          await html.getAttribute(
            "data-universe-galaxy-scale-applied-position",
          ),
        ),
      )
      .toBeCloseTo(accumulated, 2);
    const ratio = Number(
      await html.getAttribute("data-universe-travel-arrival-ratio"),
    );
    expect(ratio).toBeLessThan(previousRatio);
    previousRatio = ratio;
  }

  // Gesture lifetime may reset, but the continuous coordinate and captured
  // path do not. A later tiny sample resumes exactly where the user stopped.
  await page.waitForTimeout(650);
  accumulated += 16 / 384;
  await dispatchScaleWheel(page, -16);
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(accumulated, 2);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-blocked",
    "no-galaxy-focus",
  );

  // Mixed reverse samples retrace the same curve instead of scheduling a
  // separate return animation.
  await dispatchScaleWheel(page, 8);
  accumulated -= 8 / 384;
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(accumulated, 2);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );

  await runtime.assertClean(testInfo);
});


test("Galaxy direct scale survives 60 120 and 144 Hz equivalent input bursts without queues", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const phases: string[] = [];
  await page.evaluate(() => {
    const root = document.documentElement;
    const history: string[] = [];
    Object.assign(window, { __galaxyScalePhaseHistory: history });
    new MutationObserver(() => {
      history.push(root.dataset.universeNavigationPhase ?? "");
    }).observe(root, {
      attributes: true,
      attributeFilter: ["data-universe-navigation-phase"],
    });
  });

  for (const intervalMs of [17, 8, 7]) {
    for (let sample = 0; sample < 8; sample += 1) {
      await dispatchScaleWheel(page, -4);
      await page.waitForTimeout(intervalMs);
    }
  }

  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(0.25, 2);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-target",
    "hero:aurora-01",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  phases.push(
    ...(await page.evaluate(() =>
      ((window as typeof window & { __galaxyScalePhaseHistory?: string[] })
        .__galaxyScalePhaseHistory ?? []),
    )),
  );
  expect(phases.filter(Boolean).every((phase) => phase === "galaxy")).toBeTruthy();

  // Burst reversal returns to the exact Galaxy endpoint with no stale
  // completion or phase oscillation winning after input stops.
  for (let sample = 0; sample < 24; sample += 1) {
    await dispatchScaleWheel(page, 4);
  }
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeCloseTo(0, 3);
  await page.waitForTimeout(350);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});


test("Galaxy direct scale reverses cleanly at 0.4 0.8 near-one and immediately after System handoff", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  const expectGalaxyScale = async (value: number) => {
    await expect
      .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
      .toBeCloseTo(value, 2);
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
    );
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-target",
      "hero:aurora-01",
    );
    await expect
      .poll(async () =>
        Number(
          await html.getAttribute(
            "data-universe-galaxy-scale-applied-position",
          ),
        ),
      )
      .toBeCloseTo(value, 2);
    await expect(html).not.toHaveAttribute("data-universe-scale-queued");
  };

  // 0 -> 0.4 -> 0.2.
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -57.6);
  await expectGalaxyScale(0.4);
  const ratioAt04 = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  await dispatchScaleWheel(page, 76.8);
  await expectGalaxyScale(0.2);
  expect(
    Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
  ).toBeGreaterThan(ratioAt04);

  // 0.2 -> 0.8 -> 0.6.
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -38.4);
  await expectGalaxyScale(0.8);
  const ratioAt08 = Number(
    await html.getAttribute("data-universe-travel-arrival-ratio"),
  );
  await dispatchScaleWheel(page, 76.8);
  await expectGalaxyScale(0.6);
  expect(
    Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
  ).toBeGreaterThan(ratioAt08);

  // Approach the renderer handoff without crossing it, then reverse on the
  // same captured native path. 0.6 -> 0.99 -> 0.74.
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -53.76);
  await expectGalaxyScale(0.99);
  await dispatchScaleWheel(page, 96);
  await expectGalaxyScale(0.74);

  // Reach System exactly, then immediately reverse. This intentionally races
  // the two-RAF native->product handoff and must resolve to the same native
  // path rather than a legacy return animation.
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -3.84);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-system-entry-view",
    "yeis-native",
    { timeout: 10_000 },
  );
  await dispatchScaleWheel(page, 96);
  await expectGalaxyScale(0.75);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-bridge",
    "active",
  );

  await runtime.assertClean(testInfo);
});


test("Galaxy exact endpoint reversal beats pending System handoff", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.750");

  await page.locator("main.universe-root").evaluate((root) => {
    root.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -96,
      bubbles: true,
      cancelable: true,
    }));
    root.dispatchEvent(new WheelEvent("wheel", {
      deltaY: 96,
      bubbles: true,
      cancelable: true,
    }));
  });

  await expect(html).toHaveAttribute("data-universe-scale-position", "0.750");
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "galaxy");
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-applied-position",
    "0.750",
  );
  await page.waitForTimeout(350);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "galaxy");
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.750");
  await expect(html).toHaveAttribute("data-universe-galaxy-scale-bridge", "active");
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("Hero continuous scale traverses Galaxy to Surface and back without waiting for settlement", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  // Galaxy 0 -> System 1. Do not wait for any camera-settled marker.
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
    "data-universe-scale-focus",
    "planet:aurora-01",
    { timeout: 10_000 },
  );

  // System 1 -> Approach 2 uses the gentler 288px bridge. The third sample
  // reaches the exact boundary; cadence stays independent of settlement.
  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 10_000 },
  );
  await expect
    .poll(async () => Number(await html.getAttribute("data-universe-scale-position")))
    .toBeGreaterThanOrEqual(2);

  // Approach -> Atmosphere keeps the established 192px cadence, while the
  // final Atmosphere -> Surface interval uses 240px to reduce landing overshoot.
  // Six 96px samples plus one 48px sample therefore reach Surface exactly.
  for (let sample = 0; sample < 6; sample += 1) {
    await dispatchScaleWheel(page, -96);
    await page.waitForTimeout(20);
  }
  await dispatchScaleWheel(page, -48);
  await page.waitForTimeout(20);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  // Reverse retraces the exact same response distance: six 96px samples and
  // one 48px sample return to Approach=2 with no asymmetric tail.
  for (let sample = 0; sample < 6; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await dispatchScaleWheel(page, 48);
  await page.waitForTimeout(20);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );

  // The outward sample crossing Approach -> System is preserved and follows
  // the same 288px bridge in reverse: 2 -> 1.667 -> 1.333 -> 1.000. The next
  // sample immediately enters the retained YEIS native bridge at 0.75.
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.667",
  );
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.333",
  );
  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.000",
  );
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

  // Finish 0.75 -> 0 with three proportional samples; no return phase or
  // animation is allowed to appear.
  const phaseHistory = await page.evaluate(() => {
    const root = document.documentElement;
    const values: string[] = [];
    Object.assign(window, { __fullScaleReversePhases: values });
    new MutationObserver(() => {
      values.push(root.dataset.universeNavigationPhase ?? "");
    }).observe(root, {
      attributes: true,
      attributeFilter: ["data-universe-navigation-phase"],
    });
    return values;
  });
  expect(phaseHistory).toEqual([]);
  for (let sample = 0; sample < 3; sample += 1) {
    await dispatchScaleWheel(page, 96);
    await page.waitForTimeout(20);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "0.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  const reversePhases = await page.evaluate(() =>
    ((window as typeof window & { __fullScaleReversePhases?: string[] })
      .__fullScaleReversePhases ?? []),
  );
  expect(reversePhases.filter(Boolean).every((phase) => phase === "galaxy")).toBeTruthy();
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});


test("LOW repeated 0 to 5 to 0 journeys retain one Canvas and terrain allocation", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "Two complete renderer journeys intentionally exercise retained Surface and reverse lifecycle",
  );
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-world-pipeline-allocations",
    /\d+/,
  );
  const pipelineAllocations = Number(
    await html.getAttribute("data-universe-world-pipeline-allocations"),
  );
  expect(pipelineAllocations).toBeGreaterThan(0);

  const driveIn = async () => {
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

    for (let sample = 0; sample < 3; sample += 1) {
      await dispatchScaleWheel(page, -96);
      await page.waitForTimeout(20);
    }
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "approach",
      { timeout: 15_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "2.000",
    );

    for (let sample = 0; sample < 6; sample += 1) {
      await dispatchScaleWheel(page, -96);
      await page.waitForTimeout(20);
    }
    await dispatchScaleWheel(page, -48);
    await page.waitForTimeout(20);
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
      "data-universe-surface-renderer",
      "procedural-terrains-fallback",
      { timeout: 30_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-surface-terrain-allocations",
      "1",
    );
    expect(await page.locator("canvas").count()).toBe(1);
  };

  const driveOut = async () => {
    for (let sample = 0; sample < 6; sample += 1) {
      await dispatchScaleWheel(page, 96);
      await page.waitForTimeout(20);
    }
    await dispatchScaleWheel(page, 48);
    await page.waitForTimeout(20);
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "approach",
      { timeout: 15_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "2.000",
    );

    for (let sample = 0; sample < 3; sample += 1) {
      await dispatchScaleWheel(page, 96);
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

    for (let sample = 0; sample < 4; sample += 1) {
      await dispatchScaleWheel(page, 96);
      await page.waitForTimeout(20);
    }
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "galaxy",
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "0.000",
    );
    await expect(html).toHaveAttribute(
      "data-universe-world-scene-lifecycle",
      "parked",
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-surface-terrain-lifecycle",
      "parked",
      { timeout: 10_000 },
    );
    expect(await page.locator("canvas").count()).toBe(1);
  };

  await driveIn();
  await driveOut();

  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(pipelineAllocations);
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );

  await driveIn();
  await driveOut();

  expect(
    Number(await html.getAttribute("data-universe-world-pipeline-allocations")),
  ).toBe(pipelineAllocations);
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-allocations",
    "1",
  );
  expect(await page.locator("canvas").count()).toBe(1);
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("wheel follows Hero focus from galaxy through system to surface", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "hero:aurora-01",
    { timeout: 20_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-preferred",
    "hero:aurora-01",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-focus",
    "planet:aurora-01",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "atmosphere",
  );

  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "surface",
  );

  await runtime.assertClean(testInfo);
});

test("opening galaxy auto-orbits until the visitor takes control", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-yeis-opening-motion",
    "auto-orbit",
  );

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  const centerX = box!.x + box!.width * 0.5;
  const centerY = box!.y + box!.height * 0.5;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 36, centerY + 12, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(() => html.getAttribute("data-yeis-opening-motion"))
    .toBe("stopped");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await waitForYeis(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-yeis-opening-motion",
    "reduced",
  );

  await runtime.assertClean(testInfo);
});

test("Chinese and English switch in place and persist", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);
  await expect(
    page.getByText(
      "Personal signals are scattered among observed and imagined worlds. Scroll or use the trackpad to move closer, or open Search / Places to choose a destination.",
    ),
  ).toBeVisible();

  let mainFrameNavigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });

  const languageButton = page.getByRole("button", {
    name: "Switch language to Chinese",
  });
  await expect(languageButton).toHaveText("ZH");
  await languageButton.click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "zh",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", {
      name: "一张连接真实观测与想象世界的动态地图。",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /搜索 \/ 地点/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "个人信号散落在真实观测与想象世界之间。滚动鼠标滚轮或触控板向前靠近，也可以打开“搜索 / 地点”选择目的地。",
    ),
  ).toBeVisible();
  expect(mainFrameNavigations).toBe(0);

  await page.getByRole("button", { name: /搜索 \/ 地点/ }).click();
  await expect(
    page.getByRole("dialog", { name: "宇宙导航" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("搜索个人信号、行星、恒星、天体地标、星系…"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await waitForYeis(page);
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "zh",
  );

  const englishButton = page.getByRole("button", {
    name: "切换语言为英文",
  });
  await expect(englishButton).toHaveText("EN");
  await englishButton.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-locale",
    "en",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", {
      name: "A living map of observed and imagined worlds.",
    }),
  ).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("v2 query remains a healthy rollback path", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?engine=v2&freeze=1");

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-engine",
    "v2",
  );
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.locator(".hero-copy")).toBeVisible();
  await runtime.assertClean(testInfo);
});

test("personal signal deep link reaches system and world content", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const targets = await page
    .locator("html")
    .getAttribute("data-personal-signal-targets");
  const target = targets
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  expect(target, "page should expose an actual personal signal target").toBeTruthy();

  await page.goto(
    `/?phase=system&star=${encodeURIComponent(target!)}&freeze=1`,
  );
  await waitForYeisEngine(page);
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(page.locator(".content-signal-card")).toBeVisible();

  await page.goto(
    `/?phase=orbit&star=${encodeURIComponent(target!)}&freeze=1`,
  );
  await waitForYeisEngine(page);
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
  await expect(page.locator(".world-content-card")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("blocking YEIS stars.bin exercises the real v2 fallback", async ({
  page,
}, testInfo) => {
  const stars = /\/vendor\/yeis\/data\/stars\.bin(?:\?|$)/;
  const runtime = await observeRuntime(page, {
    allowConsoleErrors: [
      /^\[YEIS-BRIDGE\] FAILED; retaining V2 fallback/,
      /^\[YEIS-NATIVE-GALAXY\] FAILED/,
      /^Failed to load resource: net::ERR_FAILED$/,
    ],
    allowFailedRequests: [stars],
  });

  await page.route(stars, async (route) => {
    await route.abort("failed");
  });
  await page.goto("/?freeze=1");

  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-engine",
    "v2-fallback",
  );
  await expect(page.getByText("GALACTIC OVERVIEW")).toBeVisible();
  await expect(page.locator(".hero-copy")).toBeVisible();

  await runtime.assertClean(testInfo);
});

test("observed NASA exoplanet Search opens the exact observed world", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Gliese 12 b");

  const exoplanet = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-exoplanet") })
    .filter({ hasText: "Gliese 12 b" })
    .first();
  await expect(exoplanet).toBeVisible();
  await exoplanet.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Gliese 12 b/)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^exoplanet:/);
  expect(url.searchParams.get("body")).toBe(
    "catalog:Gliese 12:Gliese 12 b",
  );

  // Search/deep-link entry must hand off to the same continuous-scale
  // coordinator instead of becoming a click-only dead end.
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  expect(new URL(page.url()).searchParams.get("destination")).toMatch(
    /^exoplanet:/,
  );

  await runtime.assertClean(testInfo);
});

test("Chinese Moon alias preserves exact native-body travel identity", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("月球");

  const moon = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Moon" })
    .first();
  await expect(moon).toBeVisible();
  await moon.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  const destinationId = "body:c0/moon";
  const nativeTarget = "c0/moon";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );

  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === nativeTarget || complete === nativeTarget;
    })
    .toBe(true);
  await expect(html).toHaveAttribute(
    "data-universe-travel-complete",
    nativeTarget,
    { timeout: 15_000 },
  );

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toBe(destinationId);
  expect(url.searchParams.get("phase")).toBeNull();
  expect(url.searchParams.get("star")).toBeNull();
  expect(url.searchParams.get("body")).toBeNull();
  await expect(page.locator(".navigation-failure-notice")).toHaveCount(0);
  expect(
    await html.getAttribute("data-universe-navigation-error"),
  ).toBeNull();

  await runtime.assertClean(testInfo);
});

test("black-hole Search preserves exact native travel identity", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Cygnus X-1");

  const blackHole = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-blackhole") })
    .first();
  await expect(blackHole).toBeVisible();
  await blackHole.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect
    .poll(async () => html.getAttribute("data-universe-navigation-target"))
    .toMatch(/^blackhole:/);

  const exactTarget = await html.getAttribute(
    "data-universe-navigation-target",
  );
  expect(exactTarget).toBeTruthy();
  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === exactTarget || complete === exactTarget;
    })
    .toBe(true);

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^blackhole:/);
  expect(url.searchParams.get("phase")).toBeNull();
  await expect(page.locator(".navigation-failure-notice")).toHaveCount(0);
  expect(
    await html.getAttribute("data-universe-navigation-error"),
  ).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Search keyboard navigation reaches personal content", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
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

  await search.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  const personalWorld = page.locator(".world-content-card");
  await expect(personalWorld).toBeVisible();
  await expect(personalWorld).toContainText("Personal Universe");
  const personalTarget = await page
    .locator("html")
    .getAttribute("data-universe-navigation-target");
  expect(personalTarget).toBeTruthy();

  await runtime.assertClean(testInfo);
});

test("Places featured destination navigates", async ({ page }, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const featured = page.locator(".navigator-result-row", {
    has: page.locator(".kind-featured"),
  }).first();
  await expect(featured).toBeVisible();
  await featured.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  const activeFeatured = await page
    .locator("html")
    .getAttribute("data-universe-active-destination");
  expect(activeFeatured).toMatch(/^featured:star:/);
  const placeTarget = await page
    .locator("html")
    .getAttribute("data-universe-navigation-target");
  expect(placeTarget).toBeTruthy();

  await runtime.assertClean(testInfo);
});

test("Earth body navigation preserves async search and shareable return flow", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const dialog = await openNavigator(page);
  const featuredRows = dialog
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-featured") });
  await expect(featuredRows.first()).toBeVisible();

  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Earth");

  // Query edits synchronously invalidate the prior Places rows instead of
  // leaving them clickable during the async search debounce window. Do not
  // require the transient aria-busy=true frame: a fast hosted run can finish
  // the 90 ms debounce + async lookup before Playwright samples that state.
  expect(await featuredRows.count()).toBe(0);
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-navigator-mode",
    "search",
  );

  const earth = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Earth" })
    .first();
  await expect(earth).toBeVisible();
  await expect(dialog.locator(".navigator-results")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(dialog).not.toContainText("Dünya");
  await earth.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  const earthDestination = "body:c0/earth";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    earthDestination,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    "c0/earth",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  const sharedUrl = new URL(page.url());
  expect(sharedUrl.searchParams.get("destination")).toBe(earthDestination);
  expect(sharedUrl.searchParams.get("star")).toBe("c0");
  expect(sharedUrl.searchParams.get("body")).toBe("earth");
  expect(sharedUrl.searchParams.get("phase")).toBe("approach");
  expect(sharedUrl.searchParams.get("freeze")).toBe("1");

  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    earthDestination,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    "c0/earth",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ Earth/)).toBeVisible();

  sharedUrl.searchParams.set("phase", "orbit");
  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(page.getByText(/ORBIT \/\//)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("phase")).toBe("orbit");

  await page.getByRole("button", { name: "← RETURN TO SYSTEM" }).click();
  await expect(page.getByText("STELLAR SYSTEM")).toBeVisible();
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "system",
  );
  const returnedSystemUrl = new URL(page.url());
  expect(returnedSystemUrl.searchParams.get("phase")).toBe("system");
  expect(returnedSystemUrl.searchParams.get("body")).toBeNull();
  expect(returnedSystemUrl.searchParams.get("destination")).toBeNull();

  await page.getByRole("button", { name: "← RETURN TO GALAXY" }).click();
  await waitForYeis(page);
  const returnedGalaxyUrl = new URL(page.url());
  expect(returnedGalaxyUrl.searchParams.get("phase")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("star")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("body")).toBeNull();
  expect(returnedGalaxyUrl.searchParams.get("destination")).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Guided Journey auto advance starts only after the destination settles", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  const controls = page.locator(".universe-journey-controls");

  // Measure the two product events on the browser's clock. Hosted SwiftShader
  // can delay Playwright itself, so a fixed wait that starts after Playwright
  // notices settlement can race an otherwise correct 6.5 s dwell.
  await page.evaluate(() => {
    const root = document.documentElement;
    const timing = {
      settledAt: null as number | null,
      completeAt: null as number | null,
    };
    Object.assign(window, { __journeySettleTiming: timing });

    const capture = () => {
      if (
        timing.settledAt === null &&
        root.dataset.universeCameraSettled === "approach"
      ) {
        timing.settledAt = performance.now();
      }
      if (
        timing.completeAt === null &&
        root.dataset.universeJourneyComplete === "Featured Journey"
      ) {
        timing.completeAt = performance.now();
      }
    };

    new MutationObserver(capture).observe(root, {
      attributes: true,
      attributeFilter: [
        "data-universe-camera-settled",
        "data-universe-journey-complete",
      ],
    });
    capture();
  });

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /Featured Journey/ }).click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  // Do not require Playwright itself to observe a transient SETTLING/DWELLING
  // label. Hosted software-WebGL can stall the driver while the browser keeps
  // advancing timers. The browser-clock observer installed before Journey
  // start is the authoritative contract below: completion must occur at least
  // six seconds after the destination actually settles.
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-journey-complete",
    "Featured Journey",
    { timeout: 15_000 },
  );

  const timing = await page.evaluate(() => {
    return (
      window as typeof window & {
        __journeySettleTiming?: {
          settledAt: number | null;
          completeAt: number | null;
        };
      }
    ).__journeySettleTiming;
  });
  expect(timing?.settledAt).not.toBeNull();
  expect(timing?.completeAt).not.toBeNull();
  expect(timing!.completeAt! - timing!.settledAt!).toBeGreaterThanOrEqual(
    6_000,
  );
  await expect(controls).toContainText("JOURNEY COMPLETE");

  await runtime.assertClean(testInfo);
});

test("wheel scale takeover interrupts Journey without changing destination", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/");
  await waitForYeis(page);

  const html = page.locator("html");
  const controls = page.locator(".universe-journey-controls");
  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  await page.getByRole("button", { name: /Featured Journey/ }).click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const destinationId = await html.getAttribute(
    "data-universe-active-destination",
  );
  expect(destinationId).toBeTruthy();
  const destinationBefore = new URL(page.url()).searchParams.get(
    "destination",
  );
  expect(destinationBefore).toBe(destinationId);

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * 0.5,
    box!.y + box!.height * 0.5,
  );

  // Even a sub-threshold trackpad intent is manual navigation and must stop
  // Journey auto-advance immediately without changing destination identity.
  await page.mouse.wheel(0, -16);
  await expect(controls).toHaveCount(0);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId!,
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    destinationBefore,
  );

  // The identity assertions above may exceed the single-sample gesture
  // reset. Start a fresh trackpad-like gesture and cross the threshold inside
  // one reset window; Journey must stay stopped while manual scale resumes.
  // Chromium can coalesce tiny automation-level mouse.wheel samples; use the
  // same DOM WheelEvent accumulator probe as the dedicated trackpad contract.
  // The first page.mouse.wheel above still validates real pointer takeover.
  for (let index = 0; index < 11; index += 1) {
    await dispatchScaleWheel(page, -16);
    await page.waitForTimeout(20);
  }

  await expect(html).not.toHaveAttribute(
    "data-universe-scale-superseded",
    "manual-camera",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(controls).toHaveCount(0);
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId!,
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    destinationBefore,
  );
  expect(new URL(page.url()).searchParams.get("phase")).toBe("orbit");

  await runtime.assertClean(testInfo);
});

test("Guided Journey completes visibly and competing navigation interrupts", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  const navigatorButton = page.getByRole("button", {
    name: /SEARCH \/ PLACES/,
  });
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const controls = page.locator(".universe-journey-controls");
  const html = page.locator("html");

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  const featuredJourney = page.getByRole("button", {
    name: /Featured Journey/,
  });
  await expect(featuredJourney).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /Projects Journey/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Research Journey/ }),
  ).toHaveCount(0);
  await featuredJourney.click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeVisible();
  await expect(controls).toContainText("REDUCED MOTION · MANUAL ADVANCE");
  await expect(html).toHaveAttribute(
    "data-universe-journey",
    "Featured Journey",
  );
  await expect(page.locator(".world-content-card")).toBeVisible();

  await controls.getByRole("button", { name: "DONE" }).click();
  await expect(controls).toContainText("JOURNEY COMPLETE");
  await expect(controls).toContainText(
    "COMPLETE · NAVIGATION REMAINS AVAILABLE",
  );
  await expect(html).toHaveAttribute(
    "data-universe-journey-complete",
    "Featured Journey",
  );

  await controls.getByRole("button", { name: "CLOSE" }).click();
  await expect(controls).toBeHidden();
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: /Featured Journey/ }).click();
  await expect(controls).toBeVisible();

  await navigatorButton.click();
  await expect(dialog).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Earth");
  const earth = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-body") })
    .filter({ hasText: "Earth" })
    .first();
  await expect(earth).toBeVisible();
  await earth.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(controls).toBeHidden();
  await expect(html).not.toHaveAttribute("data-universe-journey");
  await expect(html).not.toHaveAttribute("data-universe-journey-complete");

  await runtime.assertClean(testInfo);
});

test("Hero Search produces a reloadable exact world deep link", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("AURORA-01");

  const hero = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-hero") })
    .filter({ hasText: "AURORA-01" })
    .first();
  await expect(hero).toBeVisible();
  await hero.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  const destinationId = "hero:aurora-01";
  const nativeTarget = "h-aurora/aurora-01";
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ AURORA-01/)).toBeVisible();

  const sharedUrl = new URL(page.url());
  expect(sharedUrl.searchParams.get("destination")).toBe(destinationId);
  expect(sharedUrl.searchParams.get("star")).toBe("h-aurora");
  expect(sharedUrl.searchParams.get("body")).toBe("aurora-01");
  expect(sharedUrl.searchParams.get("phase")).toBe("approach");

  await page.goto(sharedUrl.toString());
  await waitForYeisEngine(page);
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    nativeTarget,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(page.getByText(/LOCK ACQUIRED \/\/ AURORA-01/)).toBeVisible();

  // A cold-reloaded exact world link must rejoin the same scale coordinator;
  // deep-link entry is not a separate click-only navigation mode.
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  await wheelScale(page, "in");
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "orbit",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "orbit",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    destinationId,
  );
  const scaledUrl = new URL(page.url());
  expect(scaledUrl.searchParams.get("destination")).toBe(destinationId);
  expect(scaledUrl.searchParams.get("phase")).toBe("orbit");

  await runtime.assertClean(testInfo);
});

test("Chinese Andromeda alias starts the exact galaxy travel contract", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("仙女座");

  const galaxy = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-galaxy") })
    .filter({ hasText: "Andromeda" })
    .first();
  await expect(galaxy).toBeVisible();
  await galaxy.locator(".navigator-result-open").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    /^galaxy:\d+$/,
  );
  const destinationId = await html.getAttribute(
    "data-universe-active-destination",
  );
  expect(destinationId).toMatch(/^galaxy:\d+$/);
  await expect(html).toHaveAttribute(
    "data-universe-navigation-target",
    destinationId!,
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "galaxy",
  );
  await expect
    .poll(async () => {
      const traveling = await html.getAttribute("data-universe-traveling");
      const complete = await html.getAttribute(
        "data-universe-travel-complete",
      );
      return traveling === destinationId || complete === destinationId;
    })
    .toBe(true);

  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toBe(destinationId);
  expect(url.searchParams.get("phase")).toBeNull();

  await runtime.assertClean(testInfo);
});

test("Locate then real canvas click reuses the same landmark destination", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Orion Nebula");

  const landmark = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-landmark") })
    .filter({ hasText: "Orion" })
    .first();
  await expect(landmark).toBeVisible();
  await landmark.locator(".navigator-locate").click();
  await expect(dialog).toBeHidden();

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-locate-complete",
    /^landmark:\d+$/,
  );

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, "native YEIS canvas should have a clickable viewport").not.toBeNull();
  await page.mouse.click(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2,
  );

  await expect(html).toHaveAttribute(
    "data-yeis-picked-target",
    "landmark:l-m42",
  );
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "landmark:l-m42",
  );
  expect(new URL(page.url()).searchParams.get("destination")).toBe(
    "landmark:l-m42",
  );

  await runtime.assertClean(testInfo);
});

test("landmark Search shares the same travel destination contract", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?freeze=1");
  await waitForYeis(page);

  await page.getByRole("button", { name: /SEARCH \/ PLACES/ }).click();
  const dialog = page.getByRole("dialog", { name: "Universe navigator" });
  const search = page.getByRole("combobox", { name: "Search universe" });
  await search.fill("Orion Nebula");

  const landmark = page
    .locator(".navigator-result-row")
    .filter({ has: page.locator(".kind-landmark") })
    .filter({ hasText: "Orion" })
    .first();
  await expect(landmark).toBeVisible();
  await landmark.locator(".navigator-result-open").click();

  await expect(dialog).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-active-destination",
    /landmark:/,
  );
  const url = new URL(page.url());
  expect(url.searchParams.get("destination")).toMatch(/^landmark:/);
  expect(url.searchParams.get("phase")).toBeNull();

  await runtime.assertClean(testInfo);
});

test("System to Approach handoff preserves apparent size and orientation", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.333",
  );
  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.667",
  );
  await dispatchScaleWheel(page, -96);

  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () =>
        html.getAttribute("data-universe-handoff-exit-projected-radius"),
      { timeout: 15_000 },
    )
    .not.toBeNull();
  await expect
    .poll(
      async () =>
        html.getAttribute("data-universe-handoff-entry-projected-radius"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  const exitRadius = Number(
    await html.getAttribute("data-universe-handoff-exit-projected-radius"),
  );
  const entryRadius = Number(
    await html.getAttribute("data-universe-handoff-entry-projected-radius"),
  );
  expect(exitRadius).toBeGreaterThan(0);
  expect(entryRadius).toBeGreaterThan(0);
  expect(entryRadius / exitRadius).toBeGreaterThan(0.97);
  expect(entryRadius / exitRadius).toBeLessThan(1.03);

  const parseQuaternion = (value: string | null) =>
    (value ?? "")
      .split(",")
      .map(Number)
      .filter((component) => Number.isFinite(component));
  const exitQuaternion = parseQuaternion(
    await html.getAttribute("data-universe-handoff-exit-quaternion"),
  );
  const entryQuaternion = parseQuaternion(
    await html.getAttribute("data-universe-handoff-entry-quaternion"),
  );
  expect(exitQuaternion).toHaveLength(4);
  expect(entryQuaternion).toHaveLength(4);
  const quaternionDot = Math.abs(
    exitQuaternion.reduce(
      (sum, component, index) =>
        sum + component * entryQuaternion[index],
      0,
    ),
  );
  expect(quaternionDot).toBeGreaterThan(0.995);

  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );
  await runtime.assertClean(testInfo);
});

test("precision-trackpad deltas move the close-world camera immediately", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -1);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.005",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );

  await runtime.assertClean(testInfo);
});

test("micro wheel samples remain immediate, reversible, and stop with delivered input", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  const inward = [-4, -8, -16, -32];
  const trace: number[] = [];
  for (const deltaY of inward) {
    await dispatchScaleWheel(page, deltaY);
    const position = Number(
      await html.getAttribute("data-universe-scale-position"),
    );
    trace.push(position);
    expect(
      Number(await html.getAttribute("data-universe-scale-response")),
    ).toBeGreaterThan(0);
    await expect(html).toHaveAttribute(
      "data-universe-scale-delta",
      deltaY.toFixed(3),
    );
  }

  for (let index = 1; index < trace.length; index += 1) {
    expect(trace[index]).toBeGreaterThan(trace[index - 1]);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.313",
  );
  const stoppedAt = await html.getAttribute("data-universe-scale-position");
  await page.waitForTimeout(500);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    stoppedAt!,
  );

  const inwardGesture = Number(
    await html.getAttribute("data-universe-scale-gesture"),
  );
  for (const deltaY of [32, 16, 8, 4]) {
    await dispatchScaleWheel(page, deltaY);
    expect(
      Number(await html.getAttribute("data-universe-scale-response")),
    ).toBeLessThan(0);
  }
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect
    .poll(async () =>
      Number(await html.getAttribute("data-universe-scale-gesture")),
    )
    .toBeGreaterThan(inwardGesture);
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("reduced-motion narrow viewport preserves direct reversible scale control", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -32);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.167",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-mode",
    "scale-continuous",
  );

  await dispatchScaleWheel(page, 32);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );
  await expect(html).not.toHaveAttribute("data-universe-scale-queued");

  await runtime.assertClean(testInfo);
});

test("line-mode wheel input normalizes to the same reversible scale domain", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -3, 1);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.250",
  );
  await expect(html).toHaveAttribute(
    "data-universe-scale-segment",
    "approach:orbit",
  );

  await dispatchScaleWheel(page, 3, 1);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );

  await runtime.assertClean(testInfo);
});

test("Galaxy high-frequency native scale stays off the React render hot path", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  const before = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );

  await page.locator("main.universe-root").evaluate((root) => {
    for (let index = 0; index < 48; index += 1) {
      root.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: -2,
      }));
    }
  });
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.250");
  await page.waitForTimeout(50);
  const afterIn = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );
  expect(afterIn - before).toBeLessThanOrEqual(1);
  await expect(html).toHaveAttribute(
    "data-universe-galaxy-scale-executor",
    "native-progress",
  );

  await page.locator("main.universe-root").evaluate((root) => {
    for (let index = 0; index < 48; index += 1) {
      root.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: 2,
      }));
    }
  });
  await expect(html).toHaveAttribute("data-universe-scale-position", "0.000");
  await page.waitForTimeout(50);
  const afterOut = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );
  expect(afterOut - afterIn).toBeLessThanOrEqual(1);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "galaxy");

  await runtime.assertClean(testInfo);
});

test("high-frequency wheel bursts publish at most one scale render per frame", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );
  const before = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );

  await page.locator("main.universe-root").evaluate((root) => {
    for (let index = 0; index < 24; index += 1) {
      root.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: -2,
        }),
      );
    }
  });

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.250",
  );
  await page.waitForTimeout(50);
  const afterIn = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );
  expect(afterIn - before).toBeLessThanOrEqual(2);

  await page.locator("main.universe-root").evaluate((root) => {
    for (let index = 0; index < 24; index += 1) {
      root.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: 2,
        }),
      );
    }
  });

  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await page.waitForTimeout(50);
  const afterOut = Number(
    await html.getAttribute("data-universe-scale-react-commits"),
  );
  expect(afterOut - afterIn).toBeLessThanOrEqual(2);
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-queued",
    /world:/,
  );

  await runtime.assertClean(testInfo);
});

test("apparent target radius grows monotonically during System approach", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto("/?phase=system&star=h-aurora&freeze=1");
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "system",
    { timeout: 15_000 },
  );
  await expect
    .poll(
      async () => html.getAttribute("data-universe-system-focus"),
      { timeout: 15_000 },
    )
    .not.toBeNull();

  await dispatchScaleWheel(page, -48);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.167",
  );
  await expect
    .poll(
      async () =>
        Number(await html.getAttribute("data-universe-projected-radius")),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const firstRadius = Number(
    await html.getAttribute("data-universe-projected-radius"),
  );
  const firstDistance = Number(
    await html.getAttribute("data-universe-camera-distance"),
  );

  await dispatchScaleWheel(page, -48);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "1.333",
  );
  await expect
    .poll(
      async () =>
        Number(await html.getAttribute("data-universe-projected-radius")),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(firstRadius);
  const secondDistance = Number(
    await html.getAttribute("data-universe-camera-distance"),
  );
  expect(secondDistance).toBeLessThan(firstDistance);

  await runtime.assertClean(testInfo);
});

test("rapid mid-segment reversal cancels stale scale settlement", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 15_000 },
  );

  await dispatchScaleWheel(page, -80);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.417",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
  );

  // Reverse before any semantic boundary. The signed coordinate must retrace
  // the same path rather than queueing a completion from the prior direction.
  await dispatchScaleWheel(page, 80);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "approach",
  );
  await expect(html).toHaveAttribute(
    "data-universe-camera-settled",
    "approach",
    { timeout: 10_000 },
  );
  await page.waitForTimeout(300);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "2.000",
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-queued",
    /world:/,
  );
  await expect(html).not.toHaveAttribute(
    "data-universe-scale-cancelled-queue",
    /world:/,
  );

  await runtime.assertClean(testInfo);
});

test("fallback Surface terrain parks and resumes across reverse scale @webgl-heavy", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  await page.goto(
    "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
  );
  await waitForYeisEngine(page);
  await page.getByLabel("QUALITY").selectOption("low");

  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-surface-renderer",
    "procedural-terrains-fallback",
    { timeout: 60_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "active",
    { timeout: 60_000 },
  );
  const terrainProfile = await html.getAttribute(
    "data-universe-surface-terrain-profile",
  );
  expect(terrainProfile).toBeTruthy();
  await expect(html).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );

  await dispatchScaleWheel(page, 96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "4.600",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "atmosphere",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "parked",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-profile",
    terrainProfile!,
  );

  await dispatchScaleWheel(page, -96);
  await expect(html).toHaveAttribute(
    "data-universe-scale-position",
    "5.000",
  );
  await expect(html).toHaveAttribute(
    "data-universe-navigation-phase",
    "surface",
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-lifecycle",
    "active",
    { timeout: 10_000 },
  );
  await expect(html).toHaveAttribute(
    "data-universe-surface-terrain-profile",
    terrainProfile!,
  );
  await expect(html).toHaveAttribute(
    "data-universe-webgl-lifecycle",
    "active",
  );

  await runtime.assertClean(testInfo);
});

test("mobile tablet desktop and ultrawide preserve comparable apparent scale", async ({
  page,
}, testInfo) => {
  const runtime = await observeRuntime(page);
  const viewports = [
    { width: 390, height: 844, label: "mobile portrait" },
    { width: 834, height: 1194, label: "tablet portrait" },
    { width: 1920, height: 1080, label: "desktop 16:9" },
    { width: 3440, height: 1440, label: "desktop ultrawide" },
  ];
  const normalizedRadii: number[] = [];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(
      "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);

    const html = page.locator("html");
    await expect(html).toHaveAttribute(
      "data-universe-camera-settled",
      "approach",
      { timeout: 15_000 },
    );

    await dispatchScaleWheel(page, -96);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "2.500",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-segment",
      "approach:orbit",
    );
    await expect
      .poll(
        async () =>
          Number(await html.getAttribute("data-universe-projected-radius")),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    const projectedRadius = Number(
      await html.getAttribute("data-universe-projected-radius"),
    );
    const normalizedRadius = projectedRadius / viewport.height;
    expect(
      normalizedRadius,
      `${viewport.label} projected target should stay visibly framed`,
    ).toBeGreaterThan(0.15);
    expect(
      normalizedRadius,
      `${viewport.label} projected target should not clip vertically`,
    ).toBeLessThan(0.45);
    expect(
      projectedRadius * 2,
      `${viewport.label} projected target should fit the horizontal viewport`,
    ).toBeLessThan(viewport.width * 0.96);
    expect(
      await page.locator("canvas").count(),
      `${viewport.label} should retain one renderer canvas`,
    ).toBe(1);
    normalizedRadii.push(normalizedRadius);
  }

  expect(
    Math.max(...normalizedRadii) - Math.min(...normalizedRadii),
    "projected scale should remain comparable from mobile portrait through ultrawide",
  ).toBeLessThan(0.08);

  await runtime.assertClean(testInfo);
});
