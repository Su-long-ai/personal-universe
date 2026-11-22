import { lazy, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { GalaxyScene } from "./GalaxyScene";
import { SystemScene } from "./SystemScene";
import { CinematicPipeline } from "./CinematicPipeline";
import { CinematicCamera } from "./CinematicCamera";
import type {
  GalaxyMarker,
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
} from "../../lib/universe/types";

const LazyPlanetScene = lazy(() =>
  import("./PlanetScene").then((module) => ({ default: module.PlanetScene })),
);
const LazySurfaceScene = lazy(() =>
  import("./SurfaceScene").then((module) => ({ default: module.SurfaceScene })),
);

export function UniverseCanvas({
  phase,
  markers,
  selectedSystem,
  selectedPlanet,
  onSelectSystem,
  onSelectPlanet,
  quality,
  scrollDepth,
  reducedMotion,
  onCinematicPhaseComplete,
}: {
  phase: UniversePhase;
  markers: GalaxyMarker[];
  selectedSystem: SystemDefinition | null;
  selectedPlanet: PlanetDefinition | null;
  onSelectSystem: (marker: GalaxyMarker) => void;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  quality: QualityMode;
  scrollDepth: number;
  reducedMotion: boolean;
  onCinematicPhaseComplete: (phase: UniversePhase) => void;
}) {
  return (
    <Canvas
      dpr={quality === "low" ? [1, 1] : [1, 1.75]}
      camera={{ position: [0, 26.5, 43], fov: 48, near: 0.05, far: 260 }}
      gl={{ antialias: quality !== "low", powerPreference: "high-performance" }}
    >
      <CinematicCamera
        phase={phase}
        scrollDepth={scrollDepth}
        reducedMotion={reducedMotion}
        onPhaseComplete={onCinematicPhaseComplete}
      />

      {(phase === "galaxy" || phase === "returning") && (
        <GalaxyScene
          markers={markers}
          onSelectSystem={onSelectSystem}
          quality={quality}
          seed="personal-universe-v2"
        />
      )}

      {phase === "system" && selectedSystem && (
        <SystemScene system={selectedSystem} onSelectPlanet={onSelectPlanet} />
      )}

      <Suspense fallback={null}>
        {phase === "surface" && <LazySurfaceScene />}

        {phase !== "galaxy" &&
          phase !== "system" &&
          phase !== "surface" &&
          phase !== "returning" &&
          selectedPlanet && (
            <LazyPlanetScene planet={selectedPlanet} quality={quality} />
          )}
      </Suspense>

      <CinematicPipeline key={phase} quality={quality} />
    </Canvas>
  );
}
