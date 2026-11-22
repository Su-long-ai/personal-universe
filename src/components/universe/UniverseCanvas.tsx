import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { MathUtils, Vector3 } from "three";
import { GalaxyScene } from "./GalaxyScene";
import { SurfaceScene } from "./SurfaceScene";
import { TEST_WORLD, type QualityMode, type UniversePhase } from "../../lib/universe/types";

const TARGETS: Record<Exclude<UniversePhase, "surface">, [number, number, number]> = {
  galaxy: [0, 0.4, 20],
  approach: [3.4, 0.45, 10.8],
  orbit: [6.7, 0.45, 5.8],
  atmosphere: [6.7, 0.28, 3.35],
  returning: [2, 0.35, 13.8],
};

function CameraDirector({
  phase,
  scrollDepth,
  reducedMotion,
}: {
  phase: UniversePhase;
  scrollDepth: number;
  reducedMotion: boolean;
}) {
  const { camera } = useThree();
  const desired = new Vector3();
  const lookAt = new Vector3();

  useFrame((_, delta) => {
    if (phase === "surface") {
      desired.set(0, 1.4, 8.5);
      lookAt.set(0, -0.2, -3.2);
    } else {
      const target = TARGETS[phase];
      desired.set(target[0], target[1], target[2] + (phase === "galaxy" ? scrollDepth : 0));
      lookAt.set(
        phase === "galaxy" || phase === "returning" ? 1.6 : TEST_WORLD.position[0],
        phase === "galaxy" || phase === "returning" ? 0 : TEST_WORLD.position[1],
        0,
      );
    }

    const lambda = reducedMotion ? 8.5 : phase === "atmosphere" ? 2.15 : 1.45;
    camera.position.x = MathUtils.damp(camera.position.x, desired.x, lambda, delta);
    camera.position.y = MathUtils.damp(camera.position.y, desired.y, lambda, delta);
    camera.position.z = MathUtils.damp(camera.position.z, desired.z, lambda, delta);
    camera.lookAt(lookAt);
  });

  return null;
}

export function UniverseCanvas({
  phase,
  onSelectPlanet,
  quality,
  scrollDepth,
  reducedMotion,
}: {
  phase: UniversePhase;
  onSelectPlanet: () => void;
  quality: QualityMode;
  scrollDepth: number;
  reducedMotion: boolean;
}) {
  return (
    <Canvas
      dpr={quality === "low" ? [1, 1] : [1, 1.75]}
      camera={{ position: [0, 0.4, 20], fov: 48, near: 0.05, far: 140 }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance" }}
    >
      <CameraDirector phase={phase} scrollDepth={scrollDepth} reducedMotion={reducedMotion} />
      {phase === "surface" ? (
        <SurfaceScene />
      ) : (
        <GalaxyScene phase={phase} onSelectPlanet={onSelectPlanet} quality={quality} />
      )}
      <EffectComposer multisampling={quality === "low" ? 0 : 4}>
        <Bloom
          luminanceThreshold={0.62}
          luminanceSmoothing={0.82}
          intensity={quality === "low" ? 0.62 : 1.18}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.13} darkness={0.74} />
      </EffectComposer>
    </Canvas>
  );
}
