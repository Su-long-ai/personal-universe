import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Page, type TestInfo } from "./support/test";
import {
  observeRuntime,
  waitForYeis,
  waitForYeisEngine,
} from "./support/runtime";
import sharp from "sharp";

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
// HIGH ProceduralPlanets transition evidence uses a smaller desktop viewport
// that stays above the product's 900px responsive breakpoint. This keeps the
// same desktop composition contract while bounding SwiftShader's framebuffer
// workload; normal DESKTOP/WQHD/ULTRAWIDE cases still own the layout matrix.
const HIGH_TRANSITION_DESKTOP: Viewport = {
  name: "desktop-high-960x600",
  width: 960,
  height: 600,
};
const WQHD: Viewport = {
  name: "wqhd-2560x1440",
  width: 2560,
  height: 1440,
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
const ULTRAWIDE: Viewport = {
  name: "ultrawide-3440x1440",
  width: 3440,
  height: 1440,
};

test.describe.configure({ retries: 0 });

const pendingReadableWorldFrame = new WeakMap<Page, Buffer>();

async function shot(
  page: Page,
  testInfo: TestInfo,
  viewport: string,
  name: string,
) {
  const path = testInfo.outputPath("visual", `${viewport}--${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  const pendingFrame = pendingReadableWorldFrame.get(page);
  if (pendingFrame) {
    pendingReadableWorldFrame.delete(page);
    writeFileSync(path, pendingFrame);
  } else {
    await page.screenshot({ path });
  }
  await testInfo.attach(`${viewport}--${name}`, {
    path,
    contentType: "image/png",
  });
}

async function dispatchVisualWheel(page: Page, deltaY: number) {
  // Use Chromium's native input path for visual acceptance. Executing a
  // synthetic WheelEvent through page.evaluate() competes with the WebGL main
  // thread and can itself stall for many seconds under hosted SwiftShader,
  // which measures the injector rather than the interaction. The viewport
  // centre is always inside the full-screen universe root/canvas.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("visual wheel requires a viewport");
  await page.mouse.move(
    Math.floor(viewport.width / 2),
    Math.floor(viewport.height / 2),
  );
  await page.mouse.wheel(0, deltaY);
}

const dispatchVisualScaleWheel = dispatchVisualWheel;

async function locateHeroScaleTarget(page: Page) {
  await page.goto(
    "/?destination=hero:aurora-01&navigation=locate&freeze=1",
  );
  await waitForYeis(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute(
    "data-universe-active-destination",
    "hero:aurora-01",
    { timeout: 20_000 },
  );
  return html;
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

type ReadableWorldFrameOptions = {
  subjectRoiOnly?: boolean;
};

async function expectReadableWorldFrame(
  page: Page,
  label: string,
  options: ReadableWorldFrameOptions = {},
) {
  // Stable endpoint screenshots deliberately wait for the renderer's
  // quiescent-pipeline signal.
  await expect(page.locator("html")).toHaveAttribute(
    "data-universe-world-screenshot-ready",
    "true",
    { timeout: 60_000 },
  );

  await captureReadableWorldFrame(page, label, options);
}

async function captureReadableWorldFrame(
  page: Page,
  label: string,
  options: ReadableWorldFrameOptions = {},
) {
  // Capture once and let visualCase reuse the exact same framebuffer read for
  // the artifact. HIGH transition acceptance only needs the same central ROI
  // that this probe measures; asking SwiftShader to read the surrounding
  // black-space/HUD pixels first can dominate the entire test budget without
  // adding visual evidence.
  const viewport = page.viewportSize();
  const subjectClip =
    options.subjectRoiOnly && viewport
      ? {
          x: Math.floor(viewport.width * 0.2),
          y: Math.floor(viewport.height * 0.2),
          width: Math.max(1, Math.floor(viewport.width * 0.6)),
          height: Math.max(1, Math.floor(viewport.height * 0.6)),
        }
      : undefined;
  const png = await page.screenshot(
    subjectClip ? { clip: subjectClip } : undefined,
  );
  pendingReadableWorldFrame.set(page, png);
  const image = sharp(png);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error(`${label} visual probe received an empty screenshot`);
  }

  // Measure the spatial subject, not the full black-space composition. On
  // ultrawide and portrait viewports a correctly framed planet can occupy a
  // small fraction of the whole canvas while remaining large and readable.
  // Keep this probe off the browser main thread: decoding a PNG with
  // createImageBitmap can block hosted SwiftShader long enough to distort the
  // renderer acceptance that the probe is supposed to observe.
  const left = subjectClip ? 0 : Math.floor(width * 0.2);
  const top = subjectClip ? 0 : Math.floor(height * 0.2);
  const roiWidth = subjectClip ? width : Math.max(1, Math.floor(width * 0.6));
  const roiHeight = subjectClip ? height : Math.max(1, Math.floor(height * 0.6));
  const { data, info } = await image
    .extract({
      left,
      top,
      width: Math.min(roiWidth, width - left),
      height: Math.min(roiHeight, height - top),
    })
    .resize(160, 100, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let readable = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  const total = info.width * info.height;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const luminance =
      data[offset] * 0.2126 +
      data[offset + 1] * 0.7152 +
      data[offset + 2] * 0.0722;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
    if (luminance > 20) readable += 1;
  }

  const meanLuminance = luminanceSum / total;
  const luminanceVariance = Math.max(
    0,
    luminanceSquaredSum / total - meanLuminance * meanLuminance,
  );
  const stats = {
    meanLuminance,
    readableFraction: readable / total,
    luminanceContrast: Math.sqrt(luminanceVariance),
  };

  expect(
    stats.readableFraction,
    `${label} central world region should contain a visible spatial subject`,
  ).toBeGreaterThan(0.06);
  expect(
    stats.meanLuminance,
    `${label} central world region should not be blank/near-black`,
  ).toBeGreaterThan(4);
  expect(
    stats.luminanceContrast,
    `${label} central world region should retain visible geometry/lighting contrast`,
  ).toBeGreaterThan(7);
}

async function expectCompactNarrowHud(page: Page) {
  const box = await page.locator(".universe-hud").boundingBox();
  expect(box, "narrow-screen HUD should have a measurable layout box").not.toBeNull();
  expect(
    box!.height,
    "narrow-screen HUD should stay compact enough to avoid covering the world",
  ).toBeLessThan(310);
}

async function expectViewportContainedLayout(page: Page, label: string) {
  const layout = await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>(".universe-hud");
    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    const hudRect = hud?.getBoundingClientRect() ?? null;
    const canvasRect = canvas?.getBoundingClientRect() ?? null;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      hud: hudRect
        ? {
            left: hudRect.left,
            top: hudRect.top,
            right: hudRect.right,
            bottom: hudRect.bottom,
          }
        : null,
      canvas: canvasRect
        ? {
            left: canvasRect.left,
            top: canvasRect.top,
            right: canvasRect.right,
            bottom: canvasRect.bottom,
            width: canvasRect.width,
            height: canvasRect.height,
          }
        : null,
    };
  });

  expect(layout.hud, `${label} HUD should be laid out`).not.toBeNull();
  expect(layout.canvas, `${label} canvas should be laid out`).not.toBeNull();
  expect(
    layout.scrollWidth,
    `${label} should not create horizontal viewport overflow`,
  ).toBeLessThanOrEqual(layout.width + 2);
  expect(layout.hud!.left, `${label} HUD should stay on-screen`).toBeGreaterThanOrEqual(-2);
  expect(layout.hud!.top, `${label} HUD should stay on-screen`).toBeGreaterThanOrEqual(-2);
  expect(layout.hud!.right, `${label} HUD should stay on-screen`).toBeLessThanOrEqual(
    layout.width + 2,
  );
  expect(layout.hud!.bottom, `${label} HUD should stay on-screen`).toBeLessThanOrEqual(
    layout.height + 2,
  );
  expect(layout.canvas!.width, `${label} canvas should cover the viewport`).toBeGreaterThanOrEqual(
    layout.width - 2,
  );
  expect(layout.canvas!.height, `${label} canvas should cover the viewport`).toBeGreaterThanOrEqual(
    layout.height - 2,
  );
}

async function expectReadableNarrowSurfaceLayout(
  page: Page,
  viewport: Viewport,
) {
  const surfaceCopy = page.locator(".surface-copy");
  await expect(surfaceCopy).toBeVisible();
  const surfaceBox = await surfaceCopy.boundingBox();
  expect(surfaceBox, "Surface destination copy should have a layout box").not.toBeNull();
  expect(surfaceBox!.x).toBeGreaterThanOrEqual(0);
  expect(surfaceBox!.y).toBeGreaterThanOrEqual(0);
  expect(surfaceBox!.x + surfaceBox!.width).toBeLessThanOrEqual(
    viewport.width + 1,
  );
  expect(surfaceBox!.y + surfaceBox!.height).toBeLessThanOrEqual(
    viewport.height + 1,
  );

  const stack = page.locator(".world-content-stack");
  if ((await stack.count()) === 0) return;

  await expect(stack).toBeVisible();
  const stackBox = await stack.boundingBox();
  expect(stackBox, "Surface content stack should have a layout box").not.toBeNull();
  expect(stackBox!.x).toBeGreaterThanOrEqual(0);
  expect(stackBox!.y).toBeGreaterThanOrEqual(0);
  expect(stackBox!.x + stackBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(stackBox!.y + stackBox!.height).toBeLessThanOrEqual(viewport.height + 1);

  const cards = stack.locator(".world-content-card");
  const surfaceCardBudget = Number(
    (await stack.getAttribute("data-surface-card-budget")) ?? "0",
  );
  if (surfaceCardBudget > 0) {
    expect(
      await cards.count(),
      "Surface DOM card count should stay within the shared stable signal budget",
    ).toBeLessThanOrEqual(surfaceCardBudget);
  }
  if ((await cards.count()) > 0) {
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute(
      "data-surface-priority",
      /primary|secondary|ambient/,
    );

    const focusAction = cards.first().locator(".world-content-focus-action");
    await expect(focusAction).toBeVisible();
    const focusBox = await focusAction.boundingBox();
    expect(
      focusBox,
      "Surface focus control should have a measurable layout box",
    ).not.toBeNull();
    expect(focusBox!.x).toBeGreaterThanOrEqual(stackBox!.x - 1);
    expect(focusBox!.x + focusBox!.width).toBeLessThanOrEqual(
      stackBox!.x + stackBox!.width + 1,
    );
    if (viewport.width <= 800) {
      expect(
        focusBox!.height,
        "mobile Surface focus action should retain a usable touch height",
      ).toBeGreaterThanOrEqual(29);
    }
  }

  const clusterChips = surfaceCopy.locator(".surface-cluster-chip");
  const publishedClusterValue = await page
    .locator("html")
    .getAttribute("data-universe-surface-content-clusters");
  if (publishedClusterValue !== null) {
    const publishedClusterCount = Number(publishedClusterValue);
    expect(
      Number.isInteger(publishedClusterCount) && publishedClusterCount >= 0,
      "Surface cluster diagnostic should publish a valid count",
    ).toBe(true);
    expect(
      await clusterChips.count(),
      "Surface UI should retain every generated content cluster",
    ).toBe(publishedClusterCount);
  }
  if ((await clusterChips.count()) > 0) {
    await expect(clusterChips.first()).toBeVisible();
    const clusterBox = await clusterChips.first().boundingBox();
    expect(
      clusterBox,
      "Surface cluster control should have a measurable layout box",
    ).not.toBeNull();
    expect(clusterBox!.x).toBeGreaterThanOrEqual(surfaceBox!.x - 1);
    expect(clusterBox!.x + clusterBox!.width).toBeLessThanOrEqual(
      surfaceBox!.x + surfaceBox!.width + 1,
    );
    if (viewport.width <= 800) {
      expect(
        clusterBox!.height,
        "mobile Surface cluster chip should retain a usable touch height",
      ).toBeGreaterThanOrEqual(27);
    }
  }

  if (viewport.width <= 800) {
    expect(
      stackBox!.y + stackBox!.height,
      "mobile prioritized Surface cards should end before destination copy begins",
    ).toBeLessThanOrEqual(surfaceBox!.y + 2);
    if ((await cards.count()) > 0) {
      await expect(cards.first().locator("small")).toBeHidden();
      await expect(
        cards.first().locator(".world-content-priority"),
      ).toBeHidden();
    }
    if ((await cards.count()) > 2) {
      await expect(cards.nth(2)).toBeHidden();
    }
    if (viewport.height <= 720 && (await cards.count()) > 1) {
      await expect(cards.nth(1)).toBeHidden();
    }

    if ((await clusterChips.count()) > 2) {
      expect(
        await clusterChips.nth(2).evaluate(
          (element) => getComputedStyle(element).display !== "none",
        ),
        "mobile cluster strip should retain every generated cluster",
      ).toBe(true);
    }
  }

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

  // Read the renderer telemetry in one browser round-trip. Six sequential
  // locator.getAttribute calls can each queue behind a saturated SwiftShader
  // frame after a visual capture and turn measurement overhead into a timeout.
  const webgl = await page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      software: data.universeWebglSoftware ?? null,
      pixelRatio: Number(data.universeWebglPixelRatio ?? "0"),
      geometries: Number(data.universeWebglGeometries ?? "0"),
      textures: Number(data.universeWebglTextures ?? "0"),
      programs: Number(data.universeWebglPrograms ?? "0"),
      calls: Number(data.universeWebglCalls ?? "0"),
      triangles: Number(data.universeWebglTriangles ?? "0"),
    };
  });
  const continuity = await page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      phase: data.universeNavigationPhase ?? null,
      position: Number(data.universeScalePosition ?? "NaN"),
      segment: data.universeScaleCameraSegment ?? null,
      direction: data.universeScaleDirection ?? null,
      authority: data.universeRenderAuthority ?? null,
      handoff: data.universeHandoffState ?? null,
      queued: data.universeScaleQueued ?? null,
      projectedRadius: Number(data.universeProjectedRadius ?? "NaN"),
      worldRenderer: data.universeWorldRenderer ?? null,
      worldPipeline: data.universeWorldPipeline ?? null,
      worldReady: data.universeWorldReady ?? null,
      canvasCount: document.querySelectorAll("canvas").length,
    };
  });

  await testInfo.attach("visual-metrics.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          viewport: viewport.name,
          case: name,
          elapsedMs: Date.now() - startedAt,
          continuity,
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
    const featured = dialog.locator(
      '.navigator-result-group[aria-label="Featured"]',
    );
    await expect(featured).toBeVisible();
    await expect(
      featured.locator('[data-destination-featured="true"]').first(),
    ).toBeVisible();
  });
});

test("visual: desktop Galaxy-System midpoint", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "galaxy-system-midpoint", async () => {
    const html = await locateHeroScaleTarget(page);
    await dispatchVisualScaleWheel(page, -96);
    await dispatchVisualScaleWheel(page, -96);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "0.500",
    );
    await expect(html).toHaveAttribute(
      "data-universe-galaxy-scale-bridge",
      "active",
      { timeout: 10_000 },
    );
    await expect
      .poll(async () =>
        Number(await html.getAttribute("data-universe-travel-arrival-ratio")),
      )
      .toBeGreaterThan(1);
  });
});


test("visual: desktop Galaxy-System reverse midpoint", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "galaxy-system-reverse-midpoint",
    async () => {
      const html = await locateHeroScaleTarget(page);
      for (let sample = 0; sample < 4; sample += 1) {
        await dispatchVisualScaleWheel(page, -96);
      }
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "system",
        { timeout: 10_000 },
      );
      expect(await page.locator("canvas").count()).toBe(1);

      await dispatchVisualScaleWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "0.750",
      );
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "galaxy",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-direction",
        "out",
      );
      await expect(html).toHaveAttribute(
        "data-universe-galaxy-scale-bridge",
        "active",
      );
      expect(await page.locator("canvas").count()).toBe(1);
    },
  );
});

test("visual: desktop System-Approach midpoint", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "system-approach-midpoint", async () => {
    const html = await locateHeroScaleTarget(page);
    for (let sample = 0; sample < 4; sample += 1) {
      await dispatchVisualScaleWheel(page, -96);
    }
    await expect(html).toHaveAttribute(
      "data-universe-navigation-phase",
      "system",
      { timeout: 10_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-system-renderer",
      "yeis-native",
      { timeout: 15_000 },
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-handoff",
      /galaxy-system:(?:paint|deadline)/,
      { timeout: 10_000 },
    );
    expect(await page.locator("canvas").count()).toBe(1);

    await dispatchVisualScaleWheel(page, -96);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "1.333",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-camera-segment",
      "system:approach",
      { timeout: 10_000 },
    );
  });
});

test("visual: desktop Approach-System reverse midpoint", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "approach-system-reverse-midpoint",
    async () => {
      await page.goto(
        "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await waitForCameraSettled(page, "approach");
      const html = page.locator("html");

      await dispatchVisualScaleWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "1.667",
      );
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "system",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-camera-segment",
        "system:approach",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-direction",
        "out",
      );
      await expect(html).toHaveAttribute(
        "data-universe-system-renderer",
        "yeis-native",
        { timeout: 15_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-system-ready",
        "true",
        { timeout: 15_000 },
      );
      await expect
        .poll(
          async () =>
            Number(await html.getAttribute("data-universe-projected-radius")),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
      expect(await page.locator("canvas").count()).toBe(1);
      await expectViewportContainedLayout(
        page,
        "desktop Approach-System reverse midpoint",
      );
    },
  );
});

test("visual: desktop Approach-Orbit midpoint", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "approach-orbit-midpoint", async () => {
    await page.goto(
      "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);
    await waitForCameraSettled(page, "approach");
    const html = page.locator("html");

    await dispatchVisualScaleWheel(page, -96);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "2.500",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-camera-segment",
      "approach:orbit",
      { timeout: 10_000 },
    );
    await expectReadableWorldFrame(page, "Approach-Orbit midpoint");
  });
});

test("visual: desktop Orbit-Approach reverse midpoint", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "orbit-approach-reverse-midpoint",
    async () => {
      await page.goto(
        "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await waitForCameraSettled(page, "orbit");
      const html = page.locator("html");

      await dispatchVisualScaleWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "2.500",
      );
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "approach",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-camera-segment",
        "approach:orbit",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-direction",
        "out",
      );
      expect(await page.locator("canvas").count()).toBe(1);
      await expectViewportContainedLayout(
        page,
        "desktop Orbit-Approach reverse midpoint",
      );
      await expectReadableWorldFrame(
        page,
        "desktop Orbit-Approach reverse midpoint",
      );
    },
  );
});

for (const viewport of [DESKTOP, WQHD]) {
  test(
    `visual: ${viewport.name} Orbit-Atmosphere midpoint`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "orbit-atmosphere-midpoint",
        async () => {
          await page.goto(
            "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
          );
          await waitForYeisEngine(page);
          await waitForCameraSettled(page, "orbit");
          const html = page.locator("html");

          await dispatchVisualScaleWheel(page, -96);
          await expect(html).toHaveAttribute(
            "data-universe-scale-position",
            "3.500",
          );
          await expect(html).toHaveAttribute(
            "data-universe-scale-camera-segment",
            "orbit:atmosphere",
            { timeout: 10_000 },
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
            `${viewport.name} Orbit-Atmosphere target should remain visibly framed`,
          ).toBeGreaterThan(0.12);
          expect(
            normalizedRadius,
            `${viewport.name} Orbit-Atmosphere target should not clip vertically`,
          ).toBeLessThan(0.7);
          expect(await page.locator("canvas").count()).toBe(1);
          await expectViewportContainedLayout(
            page,
            `${viewport.name} Orbit-Atmosphere midpoint`,
          );
          await expectReadableWorldFrame(
            page,
            `${viewport.name} Orbit-Atmosphere midpoint`,
          );
        },
      );
    },
  );
}


test("visual: desktop Atmosphere-Orbit reverse midpoint", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "atmosphere-orbit-reverse-midpoint",
    async () => {
      await page.goto(
        "/?phase=atmosphere&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await waitForCameraSettled(page, "atmosphere");
      const html = page.locator("html");

      await dispatchVisualScaleWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "3.500",
      );
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "orbit",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-camera-segment",
        "orbit:atmosphere",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-direction",
        "out",
      );
      await expectViewportContainedLayout(
        page,
        "desktop Atmosphere-Orbit reverse midpoint",
      );
      await expectReadableWorldFrame(
        page,
        "desktop Atmosphere-Orbit reverse midpoint",
      );
    },
  );
});

test("visual: desktop Atmosphere-Surface midpoint", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "atmosphere-surface-midpoint", async () => {
    await page.goto(
      "/?phase=atmosphere&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);
    await waitForCameraSettled(page, "atmosphere");
    const html = page.locator("html");

    await dispatchVisualScaleWheel(page, -96);
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "4.400",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-camera-segment",
      "atmosphere:surface",
      { timeout: 10_000 },
    );
    await expectReadableWorldFrame(page, "Atmosphere-Surface midpoint");
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

test("visual: desktop System to Approach midpoint", async ({ page }, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "system-approach-midpoint",
    async () => {
      await page.goto("/?phase=system&star=h-aurora&freeze=1");
      await waitForYeisEngine(page);
      const html = page.locator("html");
      await expect(html).toHaveAttribute(
        "data-universe-system-renderer",
        "yeis-native",
        { timeout: 30_000 },
      );
      await expect
        .poll(
          async () => html.getAttribute("data-universe-system-focus"),
          { timeout: 30_000 },
        )
        .not.toBeNull();

      await dispatchVisualWheel(page, -96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "1.333",
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-segment",
        "system:approach",
      );
      await expect(html).toHaveAttribute(
        "data-universe-handoff-state",
        "system:approach",
      );
      await expect
        .poll(
          async () =>
            Number(await html.getAttribute("data-universe-projected-radius")),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
    },
  );
});

test("visual: desktop Hero approach", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "hero-approach", async () => {
    await page.goto(
      "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);
    await waitForCameraSettled(page, "approach");
    await expectReadableWorldFrame(page, "AUTO Hero approach");
  });
});

test("visual: desktop Hero atmosphere", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, DESKTOP, "hero-atmosphere", async () => {
    await page.goto(
      "/?phase=atmosphere&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);
    await waitForCameraSettled(page, "atmosphere");
    await expectReadableWorldFrame(page, "AUTO Hero atmosphere");
  });
});

test("visual: desktop Atmosphere to Surface midpoint keeps live spatial motion @webgl-heavy", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    HIGH_TRANSITION_DESKTOP,
    "atmosphere-surface-midpoint-live",
    async () => {
      await page.goto(
        "/?phase=atmosphere&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await page.getByLabel("QUALITY").selectOption("high");
      const html = page.locator("html");
      await expect(html).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-live",
        { timeout: 60_000 },
      );
      await waitForCameraSettled(page, "atmosphere");

      await dispatchVisualWheel(page, -96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "4.400",
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-segment",
        "atmosphere:surface",
      );
      await expect(html).toHaveAttribute(
        "data-universe-handoff-state",
        "atmosphere:surface",
      );
      await expect(html).toHaveAttribute(
        "data-universe-render-authority",
        "world",
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-layout-tier",
        "transition",
      );
      const totalSurfaceSignals = Number(
        await html.getAttribute("data-universe-surface-content-anchors"),
      );
      if (totalSurfaceSignals > 0) {
        await expect(html).toHaveAttribute(
          "data-universe-surface-layout-signals",
          "1",
        );
        await expect(html).toHaveAttribute(
          "data-universe-surface-layout-clusters",
          "1",
        );
      }
      await expectViewportContainedLayout(
        page,
        "HIGH Atmosphere/Surface midpoint",
      );
      await expectReadableWorldFrame(
        page,
        "HIGH Atmosphere/Surface midpoint",
        { subjectRoiOnly: true },
      );
    },
  );
});

test("visual: desktop Surface to Atmosphere reverse keeps live spatial continuity @webgl-heavy", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    HIGH_TRANSITION_DESKTOP,
    "surface-atmosphere-reverse-live",
    async () => {
      await page.goto(
        "/?phase=surface&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await page.getByLabel("QUALITY").selectOption("high");
      const html = page.locator("html");
      await expect(html).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-live",
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
      await expect(html).toHaveAttribute(
        "data-universe-world-ready",
        "true",
        { timeout: 60_000 },
      );
      await waitForCameraSettled(page, "surface");

      await dispatchVisualWheel(page, 96);
      await expect(html).toHaveAttribute(
        "data-universe-scale-position",
        "4.600",
      );
      await expect(html).toHaveAttribute(
        "data-universe-navigation-phase",
        "atmosphere",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-scale-camera-segment",
        "atmosphere:surface",
        { timeout: 10_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-handoff-state",
        "atmosphere:surface",
      );
      await expect(html).toHaveAttribute(
        "data-universe-render-authority",
        "world",
      );
      await expectViewportContainedLayout(
        page,
        "HIGH Surface/Atmosphere reverse midpoint",
      );
      await expectReadableWorldFrame(
        page,
        "HIGH Surface/Atmosphere reverse midpoint",
        { subjectRoiOnly: true },
      );

    },
  );
});

test("visual: ultrawide close-world composition", async ({ page }, testInfo) => {
  await visualCase(page, testInfo, ULTRAWIDE, "approach-orbit-midpoint", async () => {
    await page.goto(
      "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
    );
    await waitForYeisEngine(page);
    await waitForCameraSettled(page, "approach");
    await dispatchVisualWheel(page, -96);
    const html = page.locator("html");
    await expect(html).toHaveAttribute(
      "data-universe-scale-position",
      "2.500",
    );
    await expect(html).toHaveAttribute(
      "data-universe-scale-segment",
      "approach:orbit",
    );
    await expectReadableWorldFrame(page, "ultrawide Approach/Orbit midpoint");
    await expectViewportContainedLayout(
      page,
      "ultrawide Approach/Orbit midpoint",
    );
  });
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


test("visual: desktop Hero world low-quality fallback renderer", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "hero-world-low-fallback",
    async () => {
      await page.goto(
        "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await page.getByLabel("QUALITY").selectOption("low");
      const html = page.locator("html");
      await expect(html).toHaveAttribute(
        "data-universe-world-renderer",
        "procedural-planets-fallback-low-quality",
        { timeout: 30_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-world-pipeline",
        "fallback-low-quality",
        { timeout: 30_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-world-ready",
        "true",
        { timeout: 30_000 },
      );
      await expect(html).not.toHaveAttribute(
        "data-universe-world-fallback-surface",
        "generated-texture",
      );
      await waitForCameraSettled(page, "orbit");
      await expectViewportContainedLayout(
        page,
        "desktop LOW Hero orbit",
      );
      await expectReadableWorldFrame(page, "LOW Hero orbit");
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
        "data-universe-surface-profile",
        /^surface:/,
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-landmarks",
        /[1-9][0-9]*/,
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
      await expect(html).toHaveAttribute(
        "data-universe-surface-layout-tier",
        "full",
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

test("visual: generated secondary Surface is a readable destination @webgl-heavy", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    DESKTOP,
    "generated-secondary-surface-low",
    async () => {
      await page.goto(
        "/?engine=v2&phase=surface&star=proc%3A0&body=personal-universe-v2%3Asystem%3A0%3Aplanet%3A0&freeze=1",
      );
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-universe-engine", "v2", {
        timeout: 15_000,
      });
      await page.getByLabel("QUALITY").selectOption("low");
      await expect(html).toHaveAttribute(
        "data-universe-surface-renderer",
        "procedural-terrains-fallback",
        { timeout: 60_000 },
      );
      const profile = await html.getAttribute("data-universe-surface-profile");
      expect(profile).toMatch(/^surface:/);
      await expect(html).toHaveAttribute(
        "data-universe-surface-terrain-world",
        profile!,
        { timeout: 60_000 },
      );
      await expect(page.locator(".surface-world-meta")).toBeVisible();
      await expect(page.locator(".surface-region-index span").first()).toBeVisible();
      await waitForCameraSettled(page, "surface");
      await expectReadableWorldFrame(page, "generated secondary Surface");
    },
  );
});

for (const viewport of [TABLET, MOBILE]) {
  test(
    `visual: ${viewport.name} System-Approach midpoint`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "system-approach-midpoint",
        async () => {
          const html = await locateHeroScaleTarget(page);
          for (let sample = 0; sample < 4; sample += 1) {
            await dispatchVisualScaleWheel(page, -96);
          }
          await expect(html).toHaveAttribute(
            "data-universe-navigation-phase",
            "system",
            { timeout: 10_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-scale-handoff",
            /galaxy-system:(?:paint|deadline)/,
            { timeout: 10_000 },
          );
          expect(await page.locator("canvas").count()).toBe(1);
          await dispatchVisualScaleWheel(page, -96);
          await expect(html).toHaveAttribute(
            "data-universe-scale-position",
            "1.333",
          );
          await expect(html).toHaveAttribute(
            "data-universe-scale-camera-segment",
            "system:approach",
            { timeout: 10_000 },
          );
          await expectCompactNarrowHud(page);
          await expectViewportContainedLayout(
            page,
            `${viewport.name} System-Approach midpoint`,
          );
        },
      );
    },
  );

  test(
    `visual: ${viewport.name} Atmosphere-Surface midpoint`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "atmosphere-surface-midpoint",
        async () => {
          await page.goto(
            "/?phase=atmosphere&star=h-aurora&body=aurora-01&freeze=1",
          );
          await waitForYeisEngine(page);
          await waitForCameraSettled(page, "atmosphere");
          const html = page.locator("html");
          await dispatchVisualScaleWheel(page, -96);
          await expect(html).toHaveAttribute(
            "data-universe-scale-position",
            "4.400",
          );
          await expect(html).toHaveAttribute(
            "data-universe-scale-camera-segment",
            "atmosphere:surface",
            { timeout: 10_000 },
          );
          await expectReadableWorldFrame(
            page,
            `${viewport.name} Atmosphere-Surface midpoint`,
          );
          await expectCompactNarrowHud(page);
          await expectViewportContainedLayout(
            page,
            `${viewport.name} Atmosphere-Surface midpoint`,
          );
        },
      );
    },
  );
}


test("visual: mobile portrait keeps HUD and canvas contained through close-world scale", async ({
  page,
}, testInfo) => {
  await visualCase(
    page,
    testInfo,
    MOBILE,
    "layout-close-world-contained",
    async () => {
      await page.goto(
        "/?phase=orbit&star=h-aurora&body=aurora-01&freeze=1",
      );
      await waitForYeisEngine(page);
      await waitForCameraSettled(page, "orbit");
      await expectCompactNarrowHud(page);
      await expectViewportContainedLayout(page, "mobile Orbit layout");

      await dispatchVisualScaleWheel(page, -96);
      await expect(page.locator("html")).toHaveAttribute(
        "data-universe-scale-position",
        "3.500",
      );
      await expectCompactNarrowHud(page);
      await expectViewportContainedLayout(
        page,
        "mobile Orbit-Atmosphere midpoint layout",
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
      await expectViewportContainedLayout(page, `${viewport.name} Galaxy`);
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
    `visual: ${viewport.name} Hero close-world midpoint`,
    async ({ page }, testInfo) => {
      await visualCase(
        page,
        testInfo,
        viewport,
        "hero-approach-orbit-midpoint",
        async () => {
          await page.goto(
            "/?phase=approach&star=h-aurora&body=aurora-01&freeze=1",
          );
          await waitForYeisEngine(page);
          await waitForCameraSettled(page, "approach");
          await dispatchVisualWheel(page, -96);
          const html = page.locator("html");
          await expect(html).toHaveAttribute(
            "data-universe-scale-position",
            "2.500",
          );
          await expect(html).toHaveAttribute(
            "data-universe-scale-segment",
            "approach:orbit",
          );
          await expectReadableWorldFrame(
            page,
            `${viewport.name} Approach/Orbit midpoint`,
          );
          await expectCompactNarrowHud(page);
          await expectViewportContainedLayout(
            page,
            `${viewport.name} Approach/Orbit midpoint`,
          );
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
          await expect(html).toHaveAttribute(
            "data-universe-surface-profile",
            /^surface:/,
            { timeout: 60_000 },
          );
          await expect(html).toHaveAttribute(
            "data-universe-surface-landmarks",
            /[1-9][0-9]*/,
            { timeout: 60_000 },
          );
          await waitForCameraSettled(page, "surface");
          await expectReadableWorldFrame(
            page,
            `${viewport.name} AUTO Hero surface`,
          );
          await expectCompactNarrowHud(page);
          await expectViewportContainedLayout(
            page,
            `${viewport.name} AUTO Hero surface`,
          );
          await expectReadableNarrowSurfaceLayout(page, viewport);

        },
      );
    },
  );
}


test("visual: mobile default YEIS secondary Surface @webgl-heavy", async ({
  page,
}, testInfo) => {
  test.slow(
    true,
    "Hosted software-WebGL mobile secondary Surface capture belongs in the heavy lane",
  );
  await visualCase(
    page,
    testInfo,
    MOBILE,
    "default-yeis-secondary-surface-low",
    async () => {
      await page.goto(
        "/?phase=surface&star=c0&body=yeis-planet%3Aearth&freeze=1",
      );
      await waitForYeisEngine(page);
      const html = page.locator("html");
      await page.getByLabel("QUALITY").selectOption("low");
      await expect(html).toHaveAttribute(
        "data-universe-surface-renderer",
        "procedural-terrains-fallback",
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-profile",
        /^surface:/,
        { timeout: 60_000 },
      );
      const profile = await html.getAttribute(
        "data-universe-surface-profile",
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-terrain-world",
        profile!,
        { timeout: 60_000 },
      );
      await expect(html).toHaveAttribute(
        "data-universe-surface-terrain-state",
        "ready",
        { timeout: 60_000 },
      );
      await waitForCameraSettled(page, "surface");
      await expectReadableWorldFrame(
        page,
        "mobile default YEIS secondary Surface",
      );
      await expectCompactNarrowHud(page);
      await expectReadableNarrowSurfaceLayout(page, MOBILE);
    },
  );
});
