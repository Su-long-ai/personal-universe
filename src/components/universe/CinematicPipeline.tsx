import { useEffect, useMemo, useRef } from "react";
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
}: {
  quality: QualityMode;
  liveWorld: boolean;
}) {
  const { gl, scene, camera, size, setDpr } = useThree();
  const high = quality !== "low";
  const softwareRenderer = isSoftwareRenderer(gl);
  const fallbackReason = liveWorldFallbackReason(gl, quality);
  const useLiveWorld = liveWorld && !fallbackReason;
  const stableFrames = useRef(0);
  const metricFrame = useRef(0);
  const pixelRatioCap = softwareRenderer ? 1 : high ? 1.75 : 1;

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    const planetPass = !fallbackReason
      ? new PlanetPass(scene, camera, {
          background: "transparent",
          output: "linear",
          impostors: true,
          impostorPixels: softwareRenderer
            ? 180
            : quality === "high"
              ? 90
              : 120,
        })
      : null;
    if (planetPass) next.addPass(planetPass);

    // SwiftShader already serializes shader compilation and is the slow path
    // on hosted Linux runners. Preserve the live Planet/PlanetPass contract
    // there, but skip the expensive full-frame bloom chain. Real GPU HIGH
    // quality keeps the existing post-processing path unchanged.
    if (!softwareRenderer) {
      next.addPass(
        new UnrealBloomPass(
          new THREE.Vector2(1, 1),
          high ? 0.48 : 0.28,
          high ? 0.48 : 0.36,
          1.08,
        ),
      );
    }
    next.addPass(new OutputPass());
    const html = document.documentElement;
    const allocations =
      Number(html.dataset.universeWorldPipelineAllocations ?? 0) + 1;
    html.dataset.universeWorldPipelineAllocations = String(allocations);
    return { composer: next, planetPass, allocation: allocations };
  }, [camera, fallbackReason, gl, high, quality, scene, softwareRenderer]);

  useEffect(() => {
    if (composer.planetPass) composer.planetPass.enabled = useLiveWorld;
    document.documentElement.dataset.universeWorldPipelineLifecycle =
      useLiveWorld ? "active" : "parked";
  }, [composer, useLiveWorld]);

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

    if (!composer.planetPass) {
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
  }, [composer.planetPass, fallbackReason, liveWorld]);

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
      delete document.documentElement.dataset.universeWorldReady;
      delete document.documentElement.dataset.universeWorldScreenshotReady;
      delete document.documentElement.dataset.universeWorldPipelineLifecycle;
      composer.planetPass?.dispose();
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
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

    const cameraReady =
      html.dataset.universeNavigationPhase !== "surface" ||
      html.dataset.universeCameraSettled === "surface";

    if (!liveWorld) {
      stableFrames.current = 0;
      delete html.dataset.universeWorldReady;
      delete html.dataset.universeWorldScreenshotReady;
      return;
    }

    if (fallbackReason) {
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

    const renderer = composer.planetPass?.planetRenderer;
    const frameReady = Boolean(
      renderer &&
      renderer.info.planets > 0 &&
      renderer.info.pending === 0,
    );
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
