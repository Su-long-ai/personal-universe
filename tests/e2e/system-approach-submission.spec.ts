import { expect, test, type Page } from "@playwright/test";
import { Quaternion } from "three";
import { observeRuntime, waitForYeis } from "./support/runtime";

type Submitted = { at: number; position: number; quaternion: number[]; radius: number };

async function observeActualSystemPaint(page: Page, stopAt: "endpoint" | "interior") {
  await page.addInitScript((mode) => {
    const roots = new Set<any>();
    const renderers = new WeakSet<any>();
    const history: Submitted[] = [];
    const held = new Map<number, FrameRequestCallback>();
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    let rendererId = 0;
    let armed = false;
    let pausedAt: Submitted | null = null;
    let paused = false;
    window.requestAnimationFrame = (callback) => {
      const id = raf((timestamp) => {
        if (!paused) callback(timestamp);
        else held.set(id, callback);
      });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      held.delete(id);
      cancel(id);
    };
    const findRenderer = () => {
      for (const root of roots) {
        const fibers = [root.current];
        for (let fiber; (fiber = fibers.pop()); ) {
          if (fiber.child) fibers.push(fiber.child);
          if (fiber.sibling) fibers.push(fiber.sibling);
          const gl = fiber.stateNode?.__r3f?.root?.getState()?.gl;
          if (!gl || renderers.has(gl)) continue;
          renderers.add(gl);
          const render = gl.render;
          gl.render = function (scene: unknown, camera: any) {
            const result = render.call(this, scene, camera);
            const html = document.documentElement.dataset;
            const applied = Number(html.universeCinematicScaleAppliedPosition);
            if (
              html.universeNavigationPhase === "system" &&
              html.universeWorldRenderPath === "direct" &&
              Number.isFinite(applied)
            ) {
              const frame = {
                at: performance.now(),
                position: applied,
                quaternion: camera.quaternion.toArray(),
                radius: Number(html.universeProjectedRadius),
              };
              history.push(frame);
              const endpoint = html.universeCinematicScaleAppliedPosition === "2.000" &&
                Boolean(html.universeHandoffExitProjectedRadius);
              if (armed && html.universeScalePosition === "2.000" &&
                  (mode === "endpoint" ? endpoint : applied >= 1.50 && applied < 2)) {
                armed = false;
                paused = true;
                pausedAt = frame;
              }
            }
            return result;
          };
        }
      }
    };
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => ++rendererId,
        onCommitFiberRoot: (_: number, root: any) => {
          roots.add(root);
          findRenderer();
        },
        onCommitFiberUnmount: () => {},
      },
      __systemSubmission: {
        arm() { armed = true; },
        read() { return { history, pausedAt, held: held.size }; },
        release() {
          paused = false;
          for (const callback of held.values()) raf(callback);
          held.clear();
        },
      },
    });
  }, stopAt);
}

const read = (page: Page): Promise<{ history: Submitted[]; pausedAt: Submitted | null; held: number }> =>
  page.evaluate(() => (window as any).__systemSubmission.read());

async function openAndReachSystemEndpoint(page: Page) {
  await page.goto("/?destination=hero:aurora-01&navigation=locate");
  await waitForYeis(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-universe-active-destination", "hero:aurora-01");
  const canvas = await page.locator("canvas").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  for (let i = 0; i < 4; ++i) await page.mouse.wheel(0, -96);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "system");
  await expect(html).toHaveAttribute("data-universe-galaxy-scale-applied-position", "1.000");
  await page.evaluate(() => (window as any).__systemSubmission.arm());
  for (let i = 0; i < 3; ++i) await page.mouse.wheel(0, -96);
  await expect(html).toHaveAttribute("data-universe-scale-position", "2.000");
  await expect.poll(async () => (await read(page)).pausedAt?.position ?? null).not.toBeNull();
  return html;
}

test("the exact System exit paint can commit Approach without a spare renderer frame", async ({ page }, info) => {
  const runtime = await observeRuntime(page);
  await observeActualSystemPaint(page, "endpoint");
  const html = await openAndReachSystemEndpoint(page);
  try {
    await expect.poll(async () => (await read(page)).held).toBeGreaterThan(0);
    const painted = await read(page);
    expect(painted.pausedAt?.position).toBe(2);
    expect(painted.pausedAt!.radius).toBeGreaterThan(0);
    await info.attach("system-submitted-frames.json", {
      contentType: "application/json", body: JSON.stringify(painted),
    });
    const interior = painted.history.filter(({ position }) => position > 1 && position < 2);
    expect(new Set(interior.map(({ position }) => position)).size).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < painted.history.length; i += 1) {
      const a = painted.history[i - 1];
      const b = painted.history[i];
      expect(b.position).toBeGreaterThanOrEqual(a.position - 0.001);
      expect(new Quaternion().fromArray(a.quaternion).angleTo(new Quaternion().fromArray(b.quaternion)))
        .toBeLessThanOrEqual(THREE_MAX_SYSTEM_ANGLE);
    }
    // This checks semantic ownership only; with native rAF stopped, no
    // Approach pixels may be claimed until its own renderer actually draws.
    await expect(html).toHaveAttribute("data-universe-navigation-phase", "approach", { timeout: 2_000 });
    await expect(html).toHaveAttribute("data-universe-scale-handoff", "system-approach:paint");
    await expect(html).not.toHaveAttribute("data-universe-world-paint-ready");
  } finally {
    await page.evaluate(() => (window as any).__systemSubmission.release());
  }
  await expect(html).toHaveAttribute("data-universe-world-paint-ready", "true");
  await runtime.assertClean(info);
});

const THREE_MAX_SYSTEM_ANGLE = (24 * Math.PI) / 180 + 1e-5;

test("a trusted reverse before the exact System exit draw invalidates Approach ownership", async ({ page }, info) => {
  const runtime = await observeRuntime(page);
  await observeActualSystemPaint(page, "interior");
  const html = await openAndReachSystemEndpoint(page);
  const paused = await read(page);
  expect(paused.pausedAt!.position).toBeLessThan(2);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "system");
  try {
    await page.mouse.wheel(0, 96);
    await expect(html).not.toHaveAttribute("data-universe-scale-position", "2.000");
  } finally {
    await page.evaluate(() => (window as any).__systemSubmission.release());
  }
  await expect.poll(async () => (await read(page)).history.length).toBeGreaterThan(paused.history.length);
  const end = await read(page);
  expect(end.history[paused.history.length].position).toBeLessThan(paused.pausedAt!.position);
  await expect(html).toHaveAttribute("data-universe-navigation-phase", "system");
  await expect(html).not.toHaveAttribute("data-universe-scale-handoff", "system-approach:paint");
  await runtime.assertClean(info);
});
