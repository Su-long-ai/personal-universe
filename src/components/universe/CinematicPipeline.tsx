import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  PlanetPass,
  PlanetRenderer,
  type Planet,
} from "procedural-planets";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityMode } from "../../lib/universe/types";

const softwareRendererCache =
  new WeakMap<THREE.WebGLRenderer, boolean>();

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

function publishDatasetMetric(
  html: HTMLElement,
  key: string,
  value: string,
) {
  if (html.dataset[key] !== value) html.dataset[key] = value;
}

export function isSoftwareRenderer(gl: THREE.WebGLRenderer) {
  const cached = softwareRendererCache.get(gl);
  if (cached !== undefined) return cached;

  const software =
    /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(
      rendererLabel(gl),
    );
  softwareRendererCache.set(gl, software);
  return software;
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
  canSubmitCurrentPose,
  quality,
  liveWorld,
  prewarmLiveWorld = false,
  planetReleaseRef,
}: {
  canSubmitCurrentPose: () => boolean;
  quality: QualityMode;
  liveWorld: boolean;
  prewarmLiveWorld?: boolean;
  planetReleaseRef?: MutableRefObject<
    ((planet: Planet) => void) | null
  >;
}) {
  const { gl, scene, camera, size, setDpr } = useThree();
  const high = quality !== "low";
  const highQuality = quality === "high";
  const rendererIdentity = useMemo(
    () => rendererLabel(gl).slice(0, 240) || "unknown",
    [gl],
  );
  const softwareRenderer = isSoftwareRenderer(gl);
  const fallbackReason = liveWorldFallbackReason(gl, quality);
  const useLiveWorld = liveWorld && !fallbackReason;
  // SwiftShader does not need an offscreen composer while the live world is
  // parked/fallback. Keep the same R3F renderer and camera authority, but draw
  // the scene directly until explicit HIGH live rendering needs PlanetPass.
  const renderWithComposer = !softwareRenderer || useLiveWorld;
  const parkComposerTargets = softwareRenderer && !useLiveWorld;
  // Real-GPU System prewarm may allocate the same retained PlanetPass before
  // presentation begins. Software WebGL keeps the existing lazy policy so a
  // hidden target cannot create expensive live-renderer resources.
  const provisionLiveWorld =
    useLiveWorld ||
    (prewarmLiveWorld && !softwareRenderer && !fallbackReason);
  const stableFrames = useRef(0);
  const metricElapsed = useRef(0);
  const metricSample = useRef(0);
  const liveDrawFrames = useRef(0);
  const appliedImpostorPixels = useRef<number | null>(null);
  const reportedImpostorPixels = useRef<number | null>(null);
  const reportedWorldReadyEvidence = useRef<boolean | null>(null);
  const reportedScreenshotReadyEvidence = useRef<boolean | null>(null);
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
  const softwarePixelRatio = highQuality ? 0.75 : 0.7;
  const pixelRatioCap = softwareRenderer
    ? softwarePixelRatio
    : high
      ? 1.75
      : 1;

  const publishWebglMetrics = useCallback(() => {
    const html = document.documentElement;
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
    metricSample.current += 1;
    publishDatasetMetric(
      html,
      "universeWebglMetricSample",
      String(metricSample.current),
    );
  }, [gl]);

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const initialTarget = softwareRenderer
      ? new THREE.WebGLRenderTarget(1, 1)
      : undefined;
    const next = new EffectComposer(gl, initialTarget);
    next.addPass(new RenderPass(scene, camera));

    // Keep the composer topology stable across product quality changes.
    // On a real GPU the retained PlanetPass host may be provisioned while
    // System still presents; software WebGL keeps it lazy until a live world
    // is actually visible. Either way the same pass is retained and parked
    // across later fallback/quality switches instead of rebuilding topology.
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
    return { composer: next, bloomPass, allocation: allocations };
  }, [camera, gl, scene, softwareRenderer]);

  const planetPassRef = useRef<PlanetPass | null>(null);
  const [planetPass, setPlanetPass] = useState<PlanetPass | null>(null);

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
    if (provisionLiveWorld && !planetPassRef.current) {
      const impostorPixels =
        softwareRenderer ? 180 : highQuality ? 90 : 120;
      // PlanetPass itself creates PlanetRenderer only on its first render.
      // While a real-GPU System target is already locked, construct that same
      // renderer host now so Pipeline/ProgramWarmer allocation is not left on
      // the presentation handoff edge. Do not call prepare(): its target-
      // specific async work is intentionally not cancellable upstream.
      const provisionedRenderer =
        !softwareRenderer && prewarmLiveWorld
          ? new PlanetRenderer(gl, {
              background: "transparent",
              output: "linear",
              impostors: true,
              impostorPixels,
            })
          : undefined;
      const nextPass = new PlanetPass(scene, camera, {
        background: "transparent",
        output: "linear",
        impostors: true,
        // Use one stable live-renderer budget for the lifetime of this WebGL
        // host. HIGH keeps its detailed GPU profile; software HIGH retains the
        // conservative hosted-runner impostor threshold.
        impostorPixels,
        planetRenderer: provisionedRenderer,
      });
      composer.composer.insertPass(nextPass, 1);
      planetPassRef.current = nextPass;
      setPlanetPass(nextPass);

      const html = document.documentElement;
      html.dataset.universeWorldPlanetPassAllocations = String(
        Number(html.dataset.universeWorldPlanetPassAllocations ?? 0) + 1,
      );
    }

    const retainedPass = planetPassRef.current;
    if (retainedPass) retainedPass.enabled = useLiveWorld;
    document.documentElement.dataset.universeWorldPipelineLifecycle =
      useLiveWorld ? "active" : "parked";
    publishWebglMetrics();
  }, [
    camera,
    composer,
    fallbackReason,
    highQuality,
    scene,
    softwareRenderer,
    prewarmLiveWorld,
    provisionLiveWorld,
    publishWebglMetrics,
    useLiveWorld,
  ]);

  useEffect(() => {
    if (!planetReleaseRef) return;
    const releasePlanet = (planet: Planet) => {
      const renderer = planetPassRef.current?.planetRenderer;
      if (!renderer) return;
      renderer.release(planet);
      const html = document.documentElement;
      html.dataset.universeWorldPlanetReleases = String(
        Number(html.dataset.universeWorldPlanetReleases ?? "0") + 1,
      );
    };
    planetReleaseRef.current = releasePlanet;
    return () => {
      if (planetReleaseRef.current === releasePlanet) {
        planetReleaseRef.current = null;
      }
    };
  }, [planetReleaseRef]);

  useEffect(() => {
    const canvas = gl.domElement;
    const html = document.documentElement;
    const invalidateRecovery = (state: "lost" | "warming") => {
      stableFrames.current = 0;
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      html.dataset.universeWorldRecovery = state;
    };
    const onContextLost = () => invalidateRecovery("lost");
    const onContextRestored = () => invalidateRecovery("warming");

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      delete html.dataset.universeWorldRecovery;
    };
  }, [gl, publishScreenshotReadyEvidence, publishWorldReadyEvidence]);

  useEffect(() => {
    if (composer.bloomPass) {
      composer.bloomPass.enabled = high;
    }
    document.documentElement.dataset.universeWorldBloom =
      composer.bloomPass?.enabled ? "on" : "off";
    return () => {
      delete document.documentElement.dataset.universeWorldBloom;
    };
  }, [composer, high]);

  useEffect(() => {
    const html = document.documentElement;
    html.dataset.universeWorldRenderPath =
      renderWithComposer ? "composer" : "direct";
    return () => {
      delete html.dataset.universeWorldRenderPath;
    };
  }, [renderWithComposer]);

  useEffect(() => {
    if (!liveWorld) {
      delete document.documentElement.dataset.universeWorldPipeline;
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      return;
    }

    if (fallbackReason) {
      const mode = `fallback-${fallbackReason}`;
      document.documentElement.dataset.universeWorldPipeline = mode;
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      return () => {
        if (
          document.documentElement.dataset.universeWorldPipeline === mode
        ) {
          delete document.documentElement.dataset.universeWorldPipeline;
        }
        publishWorldReadyEvidence(false);
        publishScreenshotReadyEvidence(false);
      };
    }

    if (!planetPass) {
      delete document.documentElement.dataset.universeWorldPipeline;
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      return;
    }

    document.documentElement.dataset.universeWorldPipeline =
      "procedural-planets-pass";
    publishWorldReadyEvidence(false);
    publishScreenshotReadyEvidence(false);
    return () => {
      if (
        document.documentElement.dataset.universeWorldPipeline ===
        "procedural-planets-pass"
      ) {
        delete document.documentElement.dataset.universeWorldPipeline;
      }
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
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
    // Park SwiftShader's offscreen targets at 1x1 when the composer is not
    // the active render path. Reusing the same composer avoids allocation churn;
    // a live HIGH world restores viewport size before PlanetPass presentation.
    composer.composer.setSize(
      parkComposerTargets ? 1 : size.width,
      parkComposerTargets ? 1 : size.height,
    );
    document.documentElement.dataset.universeWorldComposerTargets =
      parkComposerTargets ? "parked-1x1" : "viewport";
  }, [
    composer,
    gl,
    parkComposerTargets,
    pixelRatioCap,
    setDpr,
    size.height,
    size.width,
    softwareRenderer,
    softwarePixelRatio,
  ]);

  useEffect(() => {
    return () => {
      stableFrames.current = 0;
      liveDrawFrames.current = 0;
      appliedImpostorPixels.current = null;
      reportedImpostorPixels.current = null;
      reportedWorldReadyEvidence.current = null;
      reportedScreenshotReadyEvidence.current = null;
      delete document.documentElement.dataset.universeWorldReady;
      delete document.documentElement.dataset.universeWorldScreenshotReady;
      delete document.documentElement.dataset.universeWorldPipelineLifecycle;
      delete document.documentElement.dataset.universeWorldImpostorPixels;
      delete document.documentElement.dataset.universeWorldPlanetReleases;
      delete document.documentElement.dataset.universeWorldRenderPath;
      delete document.documentElement.dataset.universeWorldComposerTargets;
      delete document.documentElement.dataset.universeWorldBloom;
      delete document.documentElement.dataset.universeWorldRecovery;
      delete document.documentElement.dataset.universeWebglMetricSample;
      planetPassRef.current?.dispose();
      planetPassRef.current = null;
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
    // Wheel intent invalidates local terrain synchronously. If the root
    // scene has not committed its world camera yet, keep the prior painted
    // view rather than submitting a blank cross-space frame.
    if (!canSubmitCurrentPose()) return;
    const desiredImpostorPixels = softwareRenderer ? 180 : highQuality ? 90 : 120;
    const rendererBeforeDraw = planetPass?.planetRenderer;
    if (
      rendererBeforeDraw &&
      appliedImpostorPixels.current !== desiredImpostorPixels
    ) {
      // PlanetPass creates PlanetRenderer lazily. Once it exists, apply the
      // current quality profile before the next composer draw rather than
      // rebuilding the pass. This also handles a quality switch that lands
      // between pass provisioning and renderer creation.
      rendererBeforeDraw.setOptions({
        impostorPixels: desiredImpostorPixels,
      });
      appliedImpostorPixels.current = desiredImpostorPixels;
      if (reportedImpostorPixels.current !== desiredImpostorPixels) {
        reportedImpostorPixels.current = desiredImpostorPixels;
        publishDatasetMetric(
          document.documentElement,
          "universeWorldImpostorPixels",
          String(desiredImpostorPixels),
        );
      }
    }

    if (renderWithComposer) {
      composer.composer.render(delta);
    } else {
      // useFrame priority=1 owns the render step. Software fallback and parked
      // views draw directly with the same renderer/camera instead of paying an
      // offscreen RenderPass + OutputPass round trip.
      gl.render(scene, camera);
    }

    const html = document.documentElement;
    metricElapsed.current += delta;
    if (metricElapsed.current >= 0.5) {
      metricElapsed.current %= 0.5;
      publishWebglMetrics();
    }

    if (!liveWorld) {
      stableFrames.current = 0;
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
      reportedImpostorPixels.current = null;
      delete html.dataset.universeWorldImpostorPixels;
      if (html.dataset.universeWorldRecovery === "warming") {
        html.dataset.universeWorldRecovery = "idle";
      }
      return;
    }

    const cameraReady =
      html.dataset.universeNavigationPhase !== "surface" ||
      html.dataset.universeCameraSettled === "surface";

    if (fallbackReason) {
      reportedImpostorPixels.current = null;
      delete html.dataset.universeWorldImpostorPixels;
      // A retained live PlanetPass may have been fully converged before a
      // quality/capability fallback. Do not carry that convergence token back
      // across the capability boundary: returning to live rendering must earn
      // fresh consecutive pending=0 frames.
      stableFrames.current = 0;
      const surfaceFallback =
        html.dataset.universeNavigationPhase === "surface";
      const presentationReady = surfaceFallback
        ? html.dataset.universeSurfaceTerrainState === "ready" &&
          html.dataset.universeSurfacePaintReady === "true"
        : html.dataset.universeWorldPaintReady === "true";
      publishWorldReadyEvidence(presentationReady);
      publishScreenshotReadyEvidence(presentationReady && cameraReady);
      if (
        presentationReady &&
        html.dataset.universeWorldRecovery === "warming"
      ) {
        html.dataset.universeWorldRecovery = "ready";
      }
      return;
    }

    const renderer = planetPass?.planetRenderer;
    let rendererProfileReady = false;
    if (renderer) {
      if (appliedImpostorPixels.current !== desiredImpostorPixels) {
        // First active PlanetPass draw may create the lazy renderer. Match its
        // retained profile now and require the following frame as paint
        // evidence so the just-drawn mismatched frame cannot own handoff.
        renderer.setOptions({
          impostorPixels: desiredImpostorPixels,
        });
        appliedImpostorPixels.current = desiredImpostorPixels;
      } else {
        rendererProfileReady = true;
      }
      if (reportedImpostorPixels.current !== desiredImpostorPixels) {
        reportedImpostorPixels.current = desiredImpostorPixels;
        publishDatasetMetric(
          html,
          "universeWorldImpostorPixels",
          String(desiredImpostorPixels),
        );
      }
    } else {
      reportedImpostorPixels.current = null;
      delete html.dataset.universeWorldImpostorPixels;
    }

    const frameReady = Boolean(
      rendererProfileReady &&
      renderer &&
      renderer.info.planets > 0 &&
      renderer.info.pending === 0,
    );
    if (frameReady) {
      liveDrawFrames.current += 1;
      // PlanetScene needs two consecutive real renderer draws to transfer
      // presentation authority. Ordinary WebGL metrics stay throttled to every
      // 30 frames, but this short-lived authority stamp must advance on each
      // qualifying draw until the current activation publishes full paint.
      // Once paint is ready, the hot path falls back to the throttled metric.
      if (html.dataset.universeWorldPaintReady !== "true") {
        publishDatasetMetric(
          html,
          "universeWorldLiveDrawFrame",
          String(liveDrawFrames.current),
        );
      }
    }
    stableFrames.current = frameReady ? stableFrames.current + 1 : 0;

    // A single pending=0 sample is not enough: moving the near-surface camera
    // can immediately enqueue another LOD generation pass. Require consecutive
    // settled frames before consumers are allowed to capture the canvas.
    if (stableFrames.current >= 3) {
      publishWorldReadyEvidence(true);
      publishScreenshotReadyEvidence(cameraReady);
      if (html.dataset.universeWorldRecovery === "warming") {
        html.dataset.universeWorldRecovery = "ready";
      }
    } else {
      publishWorldReadyEvidence(false);
      publishScreenshotReadyEvidence(false);
    }
  }, 1);

  return null;
}
