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

export function isSoftwareRenderer(gl: THREE.WebGLRenderer) {
  return /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(
    rendererLabel(gl),
  );
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
  prewarmLiveWorld = false,
}: {
  quality: QualityMode;
  liveWorld: boolean;
  prewarmLiveWorld?: boolean;
}) {
  const { gl, scene, camera, size, setDpr } = useThree();
  const high = quality !== "low";
  const highQuality = quality === "high";
  const softwareRenderer = isSoftwareRenderer(gl);
  const fallbackReason = liveWorldFallbackReason(gl, quality);
  const useLiveWorld = liveWorld && !fallbackReason;
  // Real-GPU System prewarm may allocate the same retained PlanetPass before
  // presentation begins. Software WebGL keeps the existing lazy policy so a
  // hidden target cannot create expensive live-renderer resources.
  const provisionLiveWorld =
    useLiveWorld ||
    (prewarmLiveWorld && !softwareRenderer && !fallbackReason);
  const stableFrames = useRef(0);
  const metricFrame = useRef(0);
  const appliedImpostorPixels = useRef<number | null>(null);
  const pixelRatioCap = softwareRenderer ? 1 : high ? 1.75 : 1;

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));

    // Keep the composer topology stable across product quality changes.
    // PlanetPass is provisioned lazily below only when a live world is
    // actually requested, then retained and parked for later fallback modes.
    // This avoids paying its construction cost on AUTO/software while also
    // preventing LOW/AUTO/HIGH switches from reallocating the whole pipeline.
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
    if (provisionLiveWorld && !planetPassRef.current) {
      const nextPass = new PlanetPass(scene, camera, {
        background: "transparent",
        output: "linear",
        impostors: true,
        // Use one stable live-renderer budget for the lifetime of this WebGL
        // host. HIGH keeps its detailed GPU profile; software HIGH retains the
        // conservative hosted-runner impostor threshold.
        impostorPixels: softwareRenderer ? 180 : highQuality ? 90 : 120,
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
  }, [
    camera,
    composer,
    fallbackReason,
    highQuality,
    scene,
    softwareRenderer,
    provisionLiveWorld,
    useLiveWorld,
  ]);

  useEffect(() => {
    if (composer.bloomPass) {
      composer.bloomPass.enabled = high;
    }
  }, [composer, high]);

  useEffect(() => {
    if (!liveWorld) {
      delete document.documentElement.dataset.universeWorldPipeline;
      delete document.documentElement.dataset.universeWorldReady;
      return;
    }

    if (fallbackReason) {
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
  }, [planetPass, fallbackReason, liveWorld]);

  useEffect(() => {
    // R3F owns the renderer DPR. On software WebGL, cap the actual canvas
    // backing store as well as the EffectComposer targets; otherwise a
    // 1440x900 screenshot can become a multi-million-pixel SwiftShader render.
    if (softwareRenderer && gl.getPixelRatio() > 1) {
      setDpr(1);
    }
    composer.composer.setPixelRatio(
      Math.min(gl.getPixelRatio(), pixelRatioCap),
    );
    composer.composer.setSize(size.width, size.height);
  }, [
    composer,
    gl,
    pixelRatioCap,
    setDpr,
    size.height,
    size.width,
    softwareRenderer,
  ]);

  useEffect(() => {
    return () => {
      stableFrames.current = 0;
      appliedImpostorPixels.current = null;
      delete document.documentElement.dataset.universeWorldReady;
      delete document.documentElement.dataset.universeWorldScreenshotReady;
      delete document.documentElement.dataset.universeWorldPipelineLifecycle;
      delete document.documentElement.dataset.universeWorldImpostorPixels;
      planetPassRef.current?.dispose();
      planetPassRef.current = null;
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
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
    }

    composer.composer.render(delta);

    const html = document.documentElement;
    metricFrame.current += 1;
    if (metricFrame.current >= 30) {
      metricFrame.current = 0;
      html.dataset.universeWebglGeometries = String(gl.info.memory.geometries);
      html.dataset.universeWebglTextures = String(gl.info.memory.textures);
      html.dataset.universeWebglPrograms = String(gl.info.programs?.length ?? 0);
      html.dataset.universeWebglCalls = String(gl.info.render.calls);
      html.dataset.universeWebglTriangles = String(gl.info.render.triangles);
      html.dataset.universeWebglSoftware = softwareRenderer ? "true" : "false";
    }

    if (!liveWorld) {
      stableFrames.current = 0;
      delete html.dataset.universeWorldReady;
      delete html.dataset.universeWorldScreenshotReady;
      delete html.dataset.universeWorldImpostorPixels;
      return;
    }

    const cameraReady =
      html.dataset.universeNavigationPhase !== "surface" ||
      html.dataset.universeCameraSettled === "surface";

    if (fallbackReason) {
      delete html.dataset.universeWorldImpostorPixels;
      // A retained live PlanetPass may have been fully converged before a
      // quality/capability fallback. Do not carry that convergence token back
      // across the capability boundary: returning to live rendering must earn
      // fresh consecutive pending=0 frames.
      stableFrames.current = 0;
      const surfaceFallback =
        html.dataset.universeNavigationPhase === "surface";
      const presentationReady = surfaceFallback
        ? html.dataset.universeSurfaceTerrainState === "ready"
        : html.dataset.universeWorldPaintReady === "true";
      if (presentationReady) {
        html.dataset.universeWorldReady = "true";
      } else {
        delete html.dataset.universeWorldReady;
      }
      if (presentationReady && cameraReady) {
        html.dataset.universeWorldScreenshotReady = "true";
      } else {
        delete html.dataset.universeWorldScreenshotReady;
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
      html.dataset.universeWorldImpostorPixels =
        String(desiredImpostorPixels);
    } else {
      delete html.dataset.universeWorldImpostorPixels;
    }

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
      html.dataset.universeWorldReady = "true";
      if (cameraReady) {
        html.dataset.universeWorldScreenshotReady = "true";
      } else {
        delete html.dataset.universeWorldScreenshotReady;
      }
    } else {
      delete html.dataset.universeWorldReady;
      delete html.dataset.universeWorldScreenshotReady;
    }
  }, 1);

  return null;
}
