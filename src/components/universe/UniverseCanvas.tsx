import { Canvas } from "@react-three/fiber";
import { GalaxyScene } from "./GalaxyScene";
import { SystemScene } from "./SystemScene";
import { PlanetScene } from "./PlanetScene";
import { SurfaceScene } from "./SurfaceScene";
import { CinematicPipeline } from "./CinematicPipeline";
import { CinematicCamera } from "./CinematicCamera";
import type {
  GalaxyMarker,
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
} from "../../lib/universe/types";

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

      {phase === "surface" && <SurfaceScene />}

      {phase !== "galaxy" &&
        phase !== "system" &&
        phase !== "surface" &&
        selectedPlanet && (
          <PlanetScene planet={selectedPlanet} quality={quality} />
        )}

      <CinematicPipeline key={phase} quality={quality} />
    </Canvas>
  );
}
