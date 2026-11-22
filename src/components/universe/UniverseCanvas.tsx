import { Canvas } from "@react-three/fiber";
import { GalaxyScene } from "./GalaxyScene";
import { SurfaceScene } from "./SurfaceScene";
import { CinematicPipeline } from "./CinematicPipeline";
import { CinematicCamera } from "./CinematicCamera";
import type { QualityMode, UniversePhase } from "../../lib/universe/types";

export function UniverseCanvas({
  phase,
  onSelectPlanet,
  quality,
  scrollDepth,
  reducedMotion,
  onCinematicPhaseComplete,
}: {
  phase: UniversePhase;
  onSelectPlanet: () => void;
  quality: QualityMode;
  scrollDepth: number;
  reducedMotion: boolean;
  onCinematicPhaseComplete: (phase: UniversePhase) => void;
}) {
  return (
    <Canvas
      dpr={quality === "low" ? [1, 1] : [1, 1.75]}
      camera={{ position: [0, 0.4, 20], fov: 48, near: 0.05, far: 180 }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance" }}
    >
      <CinematicCamera
        phase={phase}
        scrollDepth={scrollDepth}
        reducedMotion={reducedMotion}
        onPhaseComplete={onCinematicPhaseComplete}
      />
      {phase === "surface" ? (
        <SurfaceScene />
      ) : (
        <GalaxyScene phase={phase} onSelectPlanet={onSelectPlanet} quality={quality} />
      )}
      <CinematicPipeline quality={quality} />
    </Canvas>
  );
}
