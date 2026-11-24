import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const reportedImpostorPixels = useRef<number | null>(null);
  const metricFrame = useRef(0);
  const liveDrawFrames = useRef(0);
  const reportedReady = useRef<boolean | null>(null);
  const reportedWorldReadyEvidence = useRef<boolean | null>(null);
  const reportedScreenshotReadyEvidence = useRef<boolean | null>(null);
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  const publishReady = (ready: boolean) => {
    if (reportedReady.current === ready) return;
    reportedReady.current = ready;
    onReadyChangeRef.current?.(ready);
  };
  const publishWorldReadyEvidence = useCallback((ready: boolean) => {
    if (reportedWorldReadyEvidence.current === ready) return;
    reportedWorldReadyEvidence.current = ready;
    if (ready) {
      document.documentElement.dataset.universeWorldReady = "true";
    } else {
      delete document.documentElement.dataset.universeWorldReady;
    }
  }, []);
  const publishScreenshotReadyEvidence = useCallback((ready: boolean) => {
    if (reportedScreenshotReadyEvidence.current === ready) return;
    reportedScreenshotReadyEvidence.current = ready;
    if (ready) {
      document.documentElement.dataset.universeWorldScreenshotReady = "true";
    } else {
      delete document.documentElement.dataset.universeWorldScreenshotReady;
    }
  }, []);
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

  useEffect(() => {
    const canvas = gl.domElement;
    const html = document.documentElement;

    const invalidateReady = (state: "lost" | "warming") => {
      stableFrames.current = 0;
      if (reportedReady.current !== false) {
        reportedReady.current = false;
        onReadyChangeRef.current?.(false);
      }
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      html.dataset.universeWorldRecovery = state;
    };

    const onContextLost = () => invalidateReady("lost");
    const onContextRestored = () => invalidateReady("warming");

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      delete html.dataset.universeWorldRecovery;
    };
  }, [gl, publishScreenshotReadyEvidence, publishWorldReadyEvidence]);

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    // EffectComposer otherwise allocates its initial ping-pong targets at
    // the renderer drawing-buffer size before the later parking effect can
    // shrink them. Software AUTO/LOW spends most of its lifetime parked, so
    // start the same composer at 1x1 and only grow it when HIGH live rendering
    // explicitly needs the post-processing path.
    const initialTarget = softwareRenderer
      ? new THREE.WebGLRenderTarget(1, 1)
      : undefined;
    const next = new EffectComposer(gl, initialTarget);
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
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      return;
    }

    if (fallbackReason) {
      // A retained PlanetPass may have converged before a temporary fallback.
      // Returning to live rendering must earn fresh consecutive ready frames.
      stableFrames.current = 0;
      const mode = `fallback-${fallbackReason}`;
      document.documentElement.dataset.universeWorldPipeline = mode;
      publishWorldReadyEvidence(false);
      return () => {
        if (
          document.documentElement.dataset.universeWorldPipeline === mode
        ) {
          delete document.documentElement.dataset.universeWorldPipeline;
        }
        publishWorldReadyEvidence(false);
      };
    }

    if (!planetPass) {
      delete document.documentElement.dataset.universeWorldPipeline;
      publishWorldReadyEvidence(false);
      return;
    }

    document.documentElement.dataset.universeWorldPipeline =
      "procedural-planets-pass";
    publishWorldReadyEvidence(false);
    return () => {
      if (
        document.documentElement.dataset.universeWorldPipeline ===
        "procedural-planets-pass"
      ) {
        delete document.documentElement.dataset.universeWorldPipeline;
      }
      publishWorldReadyEvidence(false);
    };
  }, [
    fallbackReason,
    liveWorld,
    planetPass,
    publishScreenshotReadyEvidence,
    publishWorldReadyEvidence,
  ]);

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
    publishDatasetMetric(
      document.documentElement,
      "universeWorldRenderPath",
      renderWithComposer ? "composer" : "direct",
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
    renderWithComposer,
    setDpr,
    size.height,
    size.width,
    softwarePixelRatio,
    softwareRenderer,
  ]);

  useEffect(() => {
    return () => {
      stableFrames.current = 0;
      liveDrawFrames.current = 0;
      publishReady(false);
      reportedWorldReadyEvidence.current = null;
      reportedScreenshotReadyEvidence.current = null;
      delete document.documentElement.dataset.universeWorldReady;
      delete document.documentElement.dataset.universeWorldScreenshotReady;
      delete document.documentElement.dataset.universeWorldPipelineLifecycle;
      delete document.documentElement.dataset.universeWorldImpostorPixels;
      delete document.documentElement.dataset.universeWorldLiveDrawFrame;
      delete document.documentElement.dataset.universeWebglPixelRatio;
      delete document.documentElement.dataset.universeWorldRenderPath;
      delete document.documentElement.dataset.universeWorldComposerTargets;
      delete document.documentElement.dataset.universeWorldBloom;
      delete document.documentElement.dataset.universeWorldRecovery;
      appliedImpostorPixels.current = null;
      reportedImpostorPixels.current = null;
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
      if (reportedImpostorPixels.current !== impostorPixels) {
        reportedImpostorPixels.current = impostorPixels;
        html.dataset.universeWorldImpostorPixels = String(impostorPixels);
      }
    }

    if (renderWithComposer) {
      composer.composer.render(delta);
    } else {
      // useFrame priority=1 intentionally owns the render step. On software
      // fallback paths, draw with the same Three/R3F renderer directly instead
      // of paying an offscreen RenderPass + OutputPass round trip.
      gl.render(scene, camera);
    }
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
        if (reportedImpostorPixels.current !== impostorPixels) {
          reportedImpostorPixels.current = impostorPixels;
          html.dataset.universeWorldImpostorPixels = String(impostorPixels);
        }
      } else {
        rendererProfileReady = true;
      }
    } else if (reportedImpostorPixels.current !== null) {
      reportedImpostorPixels.current = null;
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
      publishDatasetMetric(
        html,
        "universeWorldLiveDrawFrame",
        String(liveDrawFrames.current),
      );
    }

    const cameraReady =
      html.dataset.universeNavigationPhase !== "surface" ||
      html.dataset.universeCameraSettled === "surface";

    if (!liveWorld) {
      stableFrames.current = 0;
      publishReady(false);
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      if (html.dataset.universeWorldRecovery === "warming") {
        html.dataset.universeWorldRecovery = "idle";
      }
      return;
    }

    if (fallbackReason) {
      const sceneReady = html.dataset.universeWorldSceneReady === "true";
      publishReady(sceneReady);
      publishWorldReadyEvidence(sceneReady);
      publishScreenshotReadyEvidence(sceneReady && cameraReady);
      if (
        sceneReady &&
        html.dataset.universeWorldRecovery === "warming"
      ) {
        html.dataset.universeWorldRecovery = "ready";
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
    if (frameReady) liveDrawFrames.current += 1;
    stableFrames.current = frameReady ? stableFrames.current + 1 : 0;

    // A single pending=0 sample is not enough: moving the near-surface camera
    // can immediately enqueue another LOD generation pass. Require consecutive
    // settled frames before consumers are allowed to capture the canvas.
    if (stableFrames.current >= 3) {
      publishReady(true);
      publishWorldReadyEvidence(true);
      publishScreenshotReadyEvidence(cameraReady);
      if (html.dataset.universeWorldRecovery === "warming") {
        html.dataset.universeWorldRecovery = "ready";
      }
    } else {
      publishReady(false);
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
    }
  }, 1);

  return null;
}
