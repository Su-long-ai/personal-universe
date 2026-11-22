import { lazy, Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { GalaxyScene } from "./GalaxyScene";
import { SystemScene } from "./SystemScene";
import { CinematicPipeline } from "./CinematicPipeline";
import { CinematicCamera } from "./CinematicCamera";
import type { YeisGalaxyViewState, YeisSignalHover } from "./YeisGalaxyScene";
import type { UniverseContentPlacement } from "../../lib/universe/content";
import type { UniverseNavigationCameraRequest } from "../../lib/universe/yeis/navigation";
import type {
  GalaxyMarker,
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
  UniverseEngine,
} from "../../lib/universe/types";

const LazyPlanetScene = lazy(() =>
  import("./PlanetScene").then((module) => ({ default: module.PlanetScene })),
);
const LazySurfaceScene = lazy(() =>
  import("./SurfaceScene").then((module) => ({ default: module.SurfaceScene })),
);
const LazyYeisGalaxyScene = lazy(() =>
  import("./YeisGalaxyScene").then((module) => ({
    default: module.YeisGalaxyScene,
  })),
);

export function UniverseCanvas({
  phase,
  engineMode,
  markers,
  contentPlacements,
  navigationRequest,
  onNavigationComplete,
  onSignalHover,
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
  engineMode: UniverseEngine;
  markers: GalaxyMarker[];
  contentPlacements: UniverseContentPlacement[];
  navigationRequest: UniverseNavigationCameraRequest | null;
  onNavigationComplete: (request: UniverseNavigationCameraRequest) => void;
  onSignalHover: (hover: YeisSignalHover) => void;
  selectedSystem: SystemDefinition | null;
  selectedPlanet: PlanetDefinition | null;
  onSelectSystem: (marker: GalaxyMarker) => void;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  quality: QualityMode;
  scrollDepth: number;
  reducedMotion: boolean;
  onCinematicPhaseComplete: (phase: UniversePhase) => void;
}) {
  const yeisViewStateRef = useRef<YeisGalaxyViewState | null>(null);

  return (
    <Canvas
      dpr={quality === "low" ? [1, 1] : [1, 1.75]}
      camera={{ position: [0, 26.5, 43], fov: 48, near: 0.05, far: 260 }}
      gl={{
        antialias: quality !== "low",
        powerPreference: "high-performance",
        logarithmicDepthBuffer: engineMode === "yeis",
      }}
    >
      {!(engineMode === "yeis" && phase === "galaxy") && (
        <CinematicCamera
        phase={phase}
        scrollDepth={scrollDepth}
        reducedMotion={reducedMotion}
        onPhaseComplete={onCinematicPhaseComplete}
        />
      )}

      {phase === "galaxy" && engineMode === "yeis" && (
        <Suspense fallback={null}>
          <LazyYeisGalaxyScene
            markers={markers}
            contentPlacements={contentPlacements}
            navigationRequest={navigationRequest}
            onNavigationComplete={onNavigationComplete}
            onSelectSystem={onSelectSystem}
            onSignalHover={onSignalHover}
            quality={quality}
            viewStateRef={yeisViewStateRef}
          />
        </Suspense>
      )}

      {(phase === "galaxy" || phase === "returning") &&
        engineMode !== "yeis" && (
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
