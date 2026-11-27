import type { Page } from "@playwright/test";

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

export async function setupPaintObserver(page: Page) {
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
    let firstOutward: { drawCount: number; frame: LandingDraw | null; paintReady: boolean } | null = null;
    window.addEventListener("wheel", (event) => {
      if (event.isTrusted) trustedWheels++;
      if (event.deltaY > 0 && !firstOutward) {
        firstOutward = {
          drawCount: draws.length,
          frame: draws.at(-1) ?? null,
          paintReady: document.documentElement.dataset.universeSurfacePaintReady === "true",
        };
      }
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
        read: () => ({ draws, held, trustedWheels, firstOutward }),
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

export const readPaints = (page: Page): Promise<{ draws: LandingDraw[]; held: LandingDraw | null; trustedWheels: number; firstOutward: { drawCount: number; frame: LandingDraw | null; paintReady: boolean } | null }> =>
  page.evaluate(() => (window as any).__fallbackLandingDraws.read());
export const releasePaintHold = (page: Page) => page.evaluate(() => (window as any).__fallbackLandingDraws.release());

