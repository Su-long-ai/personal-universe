import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityMode } from "../../lib/universe/types";

export function CinematicPipeline({ quality }: { quality: QualityMode }) {
  const { gl, scene, camera, size } = useThree();
  const high = quality !== "low";

  const composer = useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.outputColorSpace = THREE.SRGBColorSpace;

    const next = new EffectComposer(gl);
    next.addPass(new RenderPass(scene, camera));
    next.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(size.width, size.height),
        high ? 0.48 : 0.28,
        high ? 0.48 : 0.36,
        1.08,
      ),
    );
    next.addPass(new OutputPass());
    return next;
  }, [camera, gl, high, scene, size.height, size.width]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
    composer.setPixelRatio(Math.min(gl.getPixelRatio(), high ? 1.75 : 1));
  }, [composer, gl, high, size.height, size.width]);

  useEffect(() => {
    return () => composer.dispose();
  }, [composer]);

  useFrame((_, delta) => {
    composer.render(delta);
  }, 1);

  return null;
}
