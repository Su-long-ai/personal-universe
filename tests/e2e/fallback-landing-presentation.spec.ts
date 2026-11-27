import { expect, test, type Page } from "@playwright/test";
import { Quaternion } from "three";
import { observeRuntime, waitForYeis } from "./support/runtime";

type LandingDraw = {
  phase: string;
  requested: number;
  applied: number | null;
  settled: string | null;
  local: string | null;
  position: number[];
  orientation: number[];
  calls: number;
  triangles: number;
};

async function setupPaintObserver(page: Page) {
  await page.addInitScript(() => {
    const queue = new Map<number, FrameRequestCallback>();
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    const draws: LandingDraw[] = [];
    let held: LandingDraw | null = null;
    let armed = false;
    let disabled = false;
    let identifier = 0;
    let installed = false;
    let trustedWheels = 0;
    window.addEventListener("wheel", (event) => {
      if (event.isTrusted) trustedWheels++;
    }, { capture: true, passive: true });
    window.requestAnimationFrame = (callback) => {
      const handle = nativeRaf((time) => {
        if (disabled) queue.set(handle, callback);
        else callback(time);
      });
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      queue.delete(handle);
      nativeCancel(handle);
    };

    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => ++identifier,
        onCommitFiberUnmount: () => {},
        onCommitFiberRoot(_: number, root: any) {
          if (installed) return;
          const stack = [root.current];
          for (let fiber; (fiber = stack.pop()); ) {
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
            const state = fiber.stateNode?.__r3f?.root?.getState();
            const gl = state?.gl;
            if (!gl) continue;
            installed = true;
            const render = gl.render;
            gl.render = function (scene: any, camera: any) {
              // The same renderer also renders off-screen terrain preparation
              // with a different camera. Only the visible Canvas is evidence.
              if (scene !== state.scene || gl.getRenderTarget() !== null) {
                return render.call(this, scene, camera);
              }
              const backdrop = scene.background;
              const data = document.documentElement.dataset;
              const frame = {
                phase: data.universeNavigationPhase ?? "",
                requested: Number(data.universeScalePosition),
                applied: data.universeCinematicScaleAppliedPosition === undefined
                  ? null : Number(data.universeCinematicScaleAppliedPosition),
                settled: data.universeCameraSettled ?? null,
                local: backdrop?.isDataTexture &&
                    backdrop.image?.width === 1 && backdrop.image?.height === 8
                  ? backdrop.uuid : null,
                position: camera.position.toArray(),
                orientation: camera.quaternion.toArray(),
                calls: 0,
                triangles: 0,
              };
              const result = render.call(this, scene, camera);
              frame.calls = gl.info.render.calls;
              frame.triangles = gl.info.render.triangles;
              draws.push(frame);
              if (armed && frame.phase === "atmosphere" && frame.applied === 4) {
                held = frame;
                armed = false;
                disabled = true;
              }
              return result;
            };
            break;
          }
        },
      },
      __fallbackLandingDraws: {
        arm() { armed = true; },
        held: () => held,
        read: () => ({ draws, held, trustedWheels }),
        release() {
          armed = false;
          disabled = false;
          for (const callback of queue.values()) nativeRaf(callback);
          queue.clear();
        },
      },
    });
  });
}

const read = (page: Page): Promise<{ draws: LandingDraw[]; held: LandingDraw | null; trustedWheels: number }> =>
  page.evaluate(() => (window as any).__fallbackLandingDraws.read());
const release = (page: Page) => page.evaluate(() => (window as any).__fallbackLandingDraws.release());

async function wheel(page: Page, samples: number[]) {
  for (const delta of samples) await page.mouse.wheel(0, delta);
}

async function reachHeldAtmosphere(page: Page) {
  await setupPaintObserver(page);
  await page.goto("/?destination=hero:aurora-01&navigation=locate&freeze=1");
  await waitForYeis(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-universe-active-destination", "hero:aurora-01", { timeout: 20_000 });
  await expect(html).toHaveAttribute("data-universe-webgl-software", "true");
  const center = await page.locator("canvas").boundingBox();
  expect(center).not.toBeNull();
  await page.mouse.move(center!.x + center!.width / 2, center!.y + center!.height / 2);

  await wheel(page, [-96, -96, -96, -96]);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "system", { timeout: 10_000 });
  await wheel(page, [-96, -96, -96]);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "approach", { timeout: 15_000 });
  await page.evaluate(() => (window as any).__fallbackLandingDraws.arm());
  await wheel(page, [-96, -96, -96, -96]);
  await expect(html).toHaveAttribute("data-universe-scale-position", "4.000");
  await expect.poll(async () => (await read(page)).held?.applied).toBe(4);
  return html;
}

const requireSurface = async (html: ReturnType<Page["locator"]>) => {
  await expect(html).toHaveAttribute("data-universe-surface-paint-ready", "true", { timeout: 20_000 });
  await expect(html).toHaveAttribute("data-universe-camera-settled", "surface", { timeout: 20_000 });
};

test("held fallback landing paints a bounded globe trajectory before the same local terrain shot", async ({ page }, info) => {
  test.slow();
  const runtime = await observeRuntime(page);
  const html = await reachHeldAtmosphere(page);
  try {
    await wheel(page, [-96, -96, -48]);
    await expect(html).toHaveAttribute("data-universe-scale-position", "5.000");
    await expect(html).not.toHaveAttribute("data-universe-surface-paint-ready");
    await expect(html).not.toHaveAttribute("data-universe-camera-settled", "surface");
  } finally {
    await release(page);
  }
  await requireSurface(html);
  const landing = await read(page);
  await info.attach("actual-fallback-landing-draws.json", {
    body: JSON.stringify(landing), contentType: "application/json",
  });
  const start = landing.draws.findIndex((frame) =>
    frame.phase === "atmosphere" && frame.applied === 4);
  const local = landing.draws.findIndex((frame, index) => index > start && frame.local !== null);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(local).toBeGreaterThan(start);
  const outgoing = landing.draws.slice(start, local);
  const intermediate = outgoing.filter(({ applied }) => applied !== null && applied > 4 && applied < 5);
  expect(new Set(intermediate.map(({ applied }) => applied)).size).toBeGreaterThanOrEqual(3);
  expect(outgoing.at(-1)?.applied).toBe(5);
  expect(outgoing.every((frame) => frame.settled !== "surface")).toBe(true);
  expect(landing.draws[local].settled).not.toBe("surface");
  expect(landing.trustedWheels).toBe(14);
  for (let index = 1; index < outgoing.length; index++) {
    const a = outgoing[index - 1];
    const b = outgoing[index];
    expect(b.applied! + 0.000001).toBeGreaterThanOrEqual(a.applied!);
    if (b.applied! < 5 && a.applied! < 5) {
      expect((b.applied! - a.applied!) / (5 - a.applied!)).toBeLessThanOrEqual(0.72);
    }
    expect(new Quaternion().fromArray(a.orientation).angleTo(new Quaternion().fromArray(b.orientation)))
      .toBeLessThanOrEqual((24 * Math.PI) / 180);
  }
  const terrain = landing.draws[local];
  for (const [index, value] of [0.5, 22, 18].entries()) {
    expect(terrain.position[index]).toBeCloseTo(value, 3);
  }

  // The first reversal after local terrain is ready must use the world camera
  // again; no fading/interpolation through the unrelated terrain coordinates.
  await wheel(page, [96]);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "atmosphere");
  await expect(html).toHaveAttribute("data-universe-scale-position", "4.600");
  await expect.poll(async () => (await read(page)).draws.slice(landing.draws.length)
    .filter((frame) => frame.phase === "atmosphere" && frame.applied !== null).length)
    .toBeGreaterThan(0);
  const reversed = (await read(page)).draws.slice(landing.draws.length);
  await info.attach("actual-fallback-ready-reversal-draws.json", {
    body: JSON.stringify(reversed), contentType: "application/json",
  });
  const firstOut = reversed.find((frame) => frame.phase === "atmosphere")!;
  expect(firstOut.local).toBeNull();
  expect(firstOut.calls, "first visible reverse frame must draw the globe").toBeGreaterThan(0);
  expect(firstOut.triangles).toBeGreaterThan(0);
  expect(firstOut.applied).toBeLessThan(5);
  expect(firstOut.position[1]).toBeLessThan(5);
  await expect(html).not.toHaveAttribute("data-universe-surface-paint-ready");

  await wheel(page, [-96]);
  await requireSurface(html);
  const returned = (await read(page)).draws.filter((frame) => frame.local !== null);
  expect(new Set(returned.map((frame) => frame.local)).size).toBe(1);
  await expect(html).toHaveAttribute("data-universe-surface-terrain-allocations", "1");
  await runtime.assertClean(info);
});

test("opposite trusted wheel while world landing is held retargets from the painted globe", async ({ page }, info) => {
  test.slow();
  const runtime = await observeRuntime(page);
  const html = await reachHeldAtmosphere(page);
  const prior = await read(page);
  try {
    await wheel(page, [-96, -96, -48]);
    await expect(html).toHaveAttribute("data-universe-scale-position", "5.000");
    await wheel(page, [96]);
    await expect(html).toHaveAttribute("data-universe-scale-position", "3.500");
    await expect(html).not.toHaveAttribute("data-universe-surface-paint-ready");
  } finally {
    await release(page);
  }
  await expect.poll(async () => (await read(page)).draws.slice(prior.draws.length)
    .filter((frame) => frame.applied !== null && frame.applied !== 4).length).toBeGreaterThan(0);
  const backwards = await read(page);
  const after = backwards.draws.slice(prior.draws.length);
  const changed = after.find((frame) => frame.applied !== null && frame.applied !== 4)!;
  expect(changed.applied).toBeLessThan(4);
  expect(after.every((frame) => frame.local === null && frame.settled !== "surface")).toBe(true);
  expect(backwards.trustedWheels).toBe(15);
  await info.attach("actual-fallback-early-reverse-draws.json", {
    body: JSON.stringify(backwards), contentType: "application/json",
  });
  await runtime.assertClean(info);
});
