import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PlanetPass } from "procedural-planets";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityMode } from "../../lib/universe/types";

export function CinematicPipeline({
  quality,
  liveWorld,
}: {
  quality: QualityMode;
  liveWorld: boolean;
}) {
  const { gl, scene, camera, size } = useThree();
  const high = quality !== "low";

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    const planetPass = liveWorld
      ? new PlanetPass(scene, camera, {
          background: "transparent",
          output: "linear",
          impostors: true,
          impostorPixels: quality === "low" ? 120 : 90,
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
    liveWorld,
    quality,
    scene,
    size.height,
    size.width,
  ]);

  useEffect(() => {
    if (!liveWorld || !composer.planetPass) {
      delete document.documentElement.dataset.universeWorldPipeline;
      return;
    }
    document.documentElement.dataset.universeWorldPipeline =
      "procedural-planets-pass";
    return () => {
      if (
        document.documentElement.dataset.universeWorldPipeline ===
        "procedural-planets-pass"
      ) {
        delete document.documentElement.dataset.universeWorldPipeline;
      }
    };
  }, [composer, liveWorld]);

  useEffect(() => {
    composer.composer.setSize(size.width, size.height);
    composer.composer.setPixelRatio(
      Math.min(gl.getPixelRatio(), high ? 1.75 : 1),
    );
  }, [composer, gl, high, size.height, size.width]);

  useEffect(() => {
    return () => {
      composer.planetPass?.dispose();
      composer.composer.dispose();
    };
  }, [composer]);

  useFrame((_, delta) => {
    composer.composer.render(delta);
  }, 1);

  return null;
}
