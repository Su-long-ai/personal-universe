import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PlanetPass } from "procedural-planets";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityMode } from "../../lib/universe/types";

function rendererLabel(gl: THREE.WebGLRenderer) {
  const context = gl.getContext();
  try {
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      return String(
        context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? "",
      );
    }
  } catch {
    // Privacy-hardened browsers may intentionally hide unmasked renderer data.
  }
  return String(context.getParameter(context.RENDERER) ?? "");
}

function rendererIsSoftware(renderer: string) {
  return /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer);
}

function publishDatasetMetric(
  html: HTMLElement,
  key: string,
  value: string,
) {
  if (html.dataset[key] !== value) html.dataset[key] = value;
}

export function isSoftwareRenderer(gl: THREE.WebGLRenderer) {
  return rendererIsSoftware(rendererLabel(gl));
}

export function liveWorldFallbackReason(
  gl: THREE.WebGLRenderer,
  quality: QualityMode,
) {
  if (quality === "low") return "low-quality";
  if (quality === "high") return null;
  return isSoftwareRenderer(gl) ? "software-renderer" : null;
}

export function CinematicPipeline({
  quality,
  liveWorld,
  onReadyChange,
}: {
  quality: QualityMode;
  liveWorld: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const { gl, scene, camera, size, setDpr } = useThree();
  const high = quality !== "low";
  const highQuality = quality === "high";
  const rendererIdentity = useMemo(
    () => rendererLabel(gl).slice(0, 240) || "unknown",
    [gl],
  );
  const softwareRenderer = rendererIsSoftware(rendererIdentity);
  const fallbackReason =
    quality === "low"
      ? "low-quality"
      : quality === "high"
        ? null
        : softwareRenderer
          ? "software-renderer"
          : null;
  const useLiveWorld = liveWorld && !fallbackReason;
  // SwiftShader does not need an offscreen EffectComposer pass when the live
  // ProceduralPlanets path is parked. Keep the single R3F renderer/camera
  // authority and render the scene directly until an explicit HIGH live world
  // actually needs PlanetPass.
  const renderWithComposer = !softwareRenderer || useLiveWorld;
  const parkComposerTargets = softwareRenderer && !useLiveWorld;
  const impostorPixels = softwareRenderer
    ? 180
    : quality === "high"
      ? 90
      : 120;
  const stableFrames = useRef(0);
  const appliedImpostorPixels = useRef<number | null>(null);
  const metricFrame = useRef(0);
  const reportedReady = useRef<boolean | null>(null);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const publishReady = (ready: boolean) => {
    if (reportedReady.current === ready) return;
    reportedReady.current = ready;
    onReadyChangeRef.current?.(ready);
  };
  // SwiftShader is fill-rate bound. Keep HIGH visually live but render its
  // backing store at 75% CSS resolution; AUTO/LOW software paths can go a bit
  // lower because they already use the lightweight fallback renderer.
  const softwarePixelRatio = highQuality ? 0.75 : 0.7;
  const pixelRatioCap = softwareRenderer
    ? softwarePixelRatio
    : high
      ? 1.75
      : 1;

  useEffect(() => {
    const html = document.documentElement;
    publishDatasetMetric(html, "universeWebglRenderer", rendererIdentity);
    publishDatasetMetric(
      html,
      "universeWebglSoftware",
      softwareRenderer ? "true" : "false",
    );
    return () => {
      if (html.dataset.universeWebglRenderer === rendererIdentity) {
        delete html.dataset.universeWebglRenderer;
      }
      delete html.dataset.universeWebglSoftware;
    };
  }, [rendererIdentity, softwareRenderer]);

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));

    // Keep one composer for the lifetime of this R3F renderer. PlanetPass is
    // inserted lazily the first time a live world is actually presented, then
    // parked and reused across HIGH/AUTO/LOW capability changes.
    const bloomPass = !softwareRenderer
      ? new UnrealBloomPass(
          new THREE.Vector2(1, 1),
          0.48,
          0.48,
          1.08,
        )
      : null;
    if (bloomPass) next.addPass(bloomPass);

    next.addPass(new OutputPass());
    const html = document.documentElement;
    const allocations =
      Number(html.dataset.universeWorldPipelineAllocations ?? 0) + 1;
    html.dataset.universeWorldPipelineAllocations = String(allocations);
    return {
      composer: next,
      bloomPass,
      allocation: allocations,
    };
  }, [camera, gl, scene, softwareRenderer]);

  const planetPassRef = useRef<PlanetPass | null>(null);
  const [planetPass, setPlanetPass] = useState<PlanetPass | null>(null);

  useEffect(() => {
    if (useLiveWorld && !planetPassRef.current) {
      const nextPass = new PlanetPass(scene, camera, {
        background: "transparent",
        output: "linear",
        impostors: true,
        impostorPixels: softwareRenderer
          ? 180
          : quality === "high"
            ? 90
            : 120,
      });
      composer.composer.insertPass(nextPass, 1);
      planetPassRef.current = nextPass;
      appliedImpostorPixels.current = null;
      setPlanetPass(nextPass);

      const html = document.documentElement;
      html.dataset.universeWorldPlanetPassAllocations = String(
        Number(html.dataset.universeWorldPlanetPassAllocations ?? "0") + 1,
      );
    }

    const retainedPass = planetPassRef.current;
    if (retainedPass) retainedPass.enabled = useLiveWorld;
    if (composer.bloomPass) {
      // LOW is explicitly the bounded/readable mode. Disable the expensive
      // bloom pass instead of rendering it at a weaker strength; AUTO/HIGH on
      // real GPUs reuse the same pass object and simply re-enable it.
      composer.bloomPass.enabled = high;
      composer.bloomPass.strength = 0.48;
      composer.bloomPass.radius = 0.48;
      composer.bloomPass.threshold = 1.08;
    }
    publishDatasetMetric(
      document.documentElement,
      "universeWorldBloom",
      composer.bloomPass?.enabled ? "on" : "off",
    );
    document.documentElement.dataset.universeWorldPipelineLifecycle =
      useLiveWorld ? "active" : "parked";
  }, [
    camera,
    composer,
    high,
    quality,
    scene,
    softwareRenderer,
    useLiveWorld,
  ]);

  useEffect(() => {
    if (!liveWorld) {
      delete document.documentElement.dataset.universeWorldPipeline;
      delete document.documentElement.dataset.universeWorldReady;
      return;
    }

    if (fallbackReason) {
      // A retained PlanetPass may have converged before a temporary fallback.
      // Returning to live rendering must earn fresh consecutive ready frames.
      stableFrames.current = 0;
      const mode = `fallback-${fallbackReason}`;
      document.documentElement.dataset.universeWorldPipeline = mode;
      delete document.documentElement.dataset.universeWorldReady;
      return () => {
        if (
          document.documentElement.dataset.universeWorldPipeline === mode
        ) {
          delete document.documentElement.dataset.universeWorldPipeline;
        }
        delete document.documentElement.dataset.universeWorldReady;
      };
    }

    if (!planetPass) {
      delete document.documentElement.dataset.universeWorldPipeline;
      delete document.documentElement.dataset.universeWorldReady;
      return;
    }

    document.documentElement.dataset.universeWorldPipeline =
      "procedural-planets-pass";
    delete document.documentElement.dataset.universeWorldReady;
    return () => {
      if (
        document.documentElement.dataset.universeWorldPipeline ===
        "procedural-planets-pass"
      ) {
        delete document.documentElement.dataset.universeWorldPipeline;
      }
      delete document.documentElement.dataset.universeWorldReady;
    };
  }, [fallbackReason, liveWorld, planetPass]);

  useEffect(() => {
    // R3F owns the renderer DPR. On software WebGL, cap the actual canvas
    // backing store as well as the EffectComposer targets; otherwise a
    // 1440x900 screenshot can become a multi-million-pixel SwiftShader render.
    if (
      softwareRenderer &&
      Math.abs(gl.getPixelRatio() - softwarePixelRatio) > 0.01
    ) {
      setDpr(softwarePixelRatio);
    }
    composer.composer.setPixelRatio(
      softwareRenderer
        ? softwarePixelRatio
        : Math.min(gl.getPixelRatio(), pixelRatioCap),
    );
    publishDatasetMetric(
      document.documentElement,
      "universeWebglPixelRatio",
      String(pixelRatioCap),
    );
    // A parked SwiftShader composer otherwise retains a full-size pair of
    // render targets even though AUTO/LOW fallback and Galaxy/System render
    // directly. Collapse those targets while parked; restoring live HIGH
    // rendering resizes the same composer before PlanetPass draws again.
    composer.composer.setSize(
      parkComposerTargets ? 1 : size.width,
      parkComposerTargets ? 1 : size.height,
    );
    publishDatasetMetric(
      document.documentElement,
      "universeWorldComposerTargets",
      parkComposerTargets ? "parked-1x1" : "viewport",
    );
  }, [
    composer,
    gl,
    parkComposerTargets,
    pixelRatioCap,
    setDpr,
    size.height,
    size.width,
    softwarePixelRatio,
    softwareRenderer,
  ]);

  useEffect(() => {
    return () => {
      stableFrames.current = 0;
      publishReady(false);
      delete document.documentElement.dataset.universeWorldReady;
      delete document.documentElement.dataset.universeWorldScreenshotReady;
      delete document.documentElement.dataset.universeWorldPipelineLifecycle;
      delete document.documentElement.dataset.universeWorldImpostorPixels;
      delete document.documentElement.dataset.universeWorldLiveDrawFrame;
      delete document.documentElement.dataset.universeWebglPixelRatio;
      delete document.documentElement.dataset.universeWorldRenderPath;
      delete document.documentElement.dataset.universeWorldComposerTargets;
      delete document.documentElement.dataset.universeWorldBloom;
      appliedImpostorPixels.current = null;
      planetPassRef.current?.dispose();
      planetPassRef.current = null;
      composer.bloomPass?.dispose();
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
    const html = document.documentElement;
    const rendererBeforeDraw = planetPass?.planetRenderer;
    if (
      rendererBeforeDraw &&
      appliedImpostorPixels.current !== impostorPixels
    ) {
      rendererBeforeDraw.setOptions({ impostorPixels });
      appliedImpostorPixels.current = impostorPixels;
    }

    if (renderWithComposer) {
      composer.composer.render(delta);
    } else {
      // useFrame priority=1 intentionally owns the render step. On software
      // fallback paths, draw with the same Three/R3F renderer directly instead
      // of paying an offscreen RenderPass + OutputPass round trip.
      gl.render(scene, camera);
    }
    publishDatasetMetric(
      html,
      "universeWorldRenderPath",
      renderWithComposer ? "composer" : "direct",
    );

    // PlanetPass creates PlanetRenderer lazily during its first live draw.
    // If that happened this frame, align the final profile now but do not
    // count the just-drawn frame as readiness evidence; the next frame will
    // start with the correct quality profile.
    const rendererAfterDraw = planetPass?.planetRenderer;
    let rendererProfileReady = false;
    if (rendererAfterDraw) {
      if (appliedImpostorPixels.current !== impostorPixels) {
        rendererAfterDraw.setOptions({ impostorPixels });
        appliedImpostorPixels.current = impostorPixels;
      } else {
        rendererProfileReady = true;
      }
      publishDatasetMetric(
        html,
        "universeWorldImpostorPixels",
        String(impostorPixels),
      );
    } else {
      delete html.dataset.universeWorldImpostorPixels;
    }

    metricFrame.current += 1;
    if (metricFrame.current >= 30) {
      metricFrame.current = 0;
      publishDatasetMetric(
        html,
        "universeWebglGeometries",
        String(gl.info.memory.geometries),
      );
      publishDatasetMetric(
        html,
        "universeWebglTextures",
        String(gl.info.memory.textures),
      );
      publishDatasetMetric(
        html,
        "universeWebglPrograms",
        String(gl.info.programs?.length ?? 0),
      );
      publishDatasetMetric(
        html,
        "universeWebglCalls",
        String(gl.info.render.calls),
      );
      publishDatasetMetric(
        html,
        "universeWebglTriangles",
        String(gl.info.render.triangles),
      );
    }

    const cameraReady =
      html.dataset.universeNavigationPhase !== "surface" ||
      html.dataset.universeCameraSettled === "surface";

    if (!liveWorld) {
      stableFrames.current = 0;
      publishReady(false);
      delete html.dataset.universeWorldReady;
      delete html.dataset.universeWorldScreenshotReady;
      return;
    }

    if (fallbackReason) {
      const sceneReady = html.dataset.universeWorldSceneReady === "true";
      publishReady(sceneReady);
      if (sceneReady) {
        html.dataset.universeWorldReady = "true";
      } else {
        delete html.dataset.universeWorldReady;
      }
      if (sceneReady && cameraReady) {
        html.dataset.universeWorldScreenshotReady = "true";
      } else {
        delete html.dataset.universeWorldScreenshotReady;
      }
      return;
    }

    const renderer = rendererAfterDraw;
    const frameReady = Boolean(
      rendererProfileReady &&
      renderer &&
      renderer.info.planets > 0 &&
      renderer.info.pending === 0,
    );
    if (frameReady) {
      html.dataset.universeWorldLiveDrawFrame = String(
        Number(html.dataset.universeWorldLiveDrawFrame ?? "0") + 1,
      );
    }
    stableFrames.current = frameReady ? stableFrames.current + 1 : 0;

    // A single pending=0 sample is not enough: moving the near-surface camera
    // can immediately enqueue another LOD generation pass. Require consecutive
    // settled frames before consumers are allowed to capture the canvas.
    if (stableFrames.current >= 3) {
      publishReady(true);
      html.dataset.universeWorldReady = "true";
      if (cameraReady) {
        html.dataset.universeWorldScreenshotReady = "true";
      } else {
        delete html.dataset.universeWorldScreenshotReady;
      }
    } else {
      publishReady(false);
      delete html.dataset.universeWorldReady;
      delete html.dataset.universeWorldScreenshotReady;
    }
  }, 1);

  return null;
}
