import { useEffect, useMemo } from "react";
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
  const { gl, scene, camera, size } = useThree();
  const high = quality !== "low";
  const softwareRenderer = isSoftwareRenderer(gl);
  const fallbackReason = liveWorld
    ? liveWorldFallbackReason(gl, quality)
    : null;
  const useLiveWorld = liveWorld && !fallbackReason;

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    const planetPass = useLiveWorld
      ? new PlanetPass(scene, camera, {
          background: "transparent",
          output: "linear",
          impostors: true,
          impostorPixels: quality === "high" ? 90 : 120,
        })
      : null;
    if (planetPass) next.addPass(planetPass);
    next.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(size.width, size.height),
        high ? 0.48 : 0.28,
        high ? 0.48 : 0.36,
        1.08,
      ),
    );
    next.addPass(new OutputPass());
    return { composer: next, planetPass };
  }, [
    camera,
    gl,
    high,
    quality,
    scene,
    size.height,
    size.width,
    useLiveWorld,
  ]);

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
  }, [composer, fallbackReason, liveWorld]);

  useEffect(() => {
    composer.composer.setSize(size.width, size.height);
    // "high" explicitly keeps the live ProceduralPlanets path available, but
    // a software rasterizer should not also multiply its render target area by
    // 1.75². Keep renderer identity/terrain semantics intact while bounding the
    // hosted-runner and CPU-only pixel budget.
    composer.composer.setPixelRatio(
      Math.min(gl.getPixelRatio(), softwareRenderer ? 1 : high ? 1.75 : 1),
    );
  }, [
    composer,
    gl,
    high,
    size.height,
    size.width,
    softwareRenderer,
  ]);

  useEffect(() => {
    return () => {
      composer.planetPass?.dispose();
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
    composer.composer.render(delta);

    if (!liveWorld) {
      delete document.documentElement.dataset.universeWorldReady;
      return;
    }

    if (fallbackReason) {
      if (
        document.documentElement.dataset.universeWorldSceneReady === "true"
      ) {
        document.documentElement.dataset.universeWorldReady = "true";
      } else {
        delete document.documentElement.dataset.universeWorldReady;
      }
      return;
    }

    const renderer = composer.planetPass?.planetRenderer;
    if (
      renderer &&
      renderer.info.planets > 0 &&
      renderer.info.pending === 0
    ) {
      document.documentElement.dataset.universeWorldReady = "true";
    } else {
      delete document.documentElement.dataset.universeWorldReady;
    }
  }, 1);

  return null;
}
