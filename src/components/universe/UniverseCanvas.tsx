import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { GalaxyScene } from "./GalaxyScene";
import { SystemScene } from "./SystemScene";
import { CinematicPipeline } from "./CinematicPipeline";
import {
  CinematicCamera,
  type SurfaceCameraFrame,
} from "./CinematicCamera";
import type {
  YeisGalaxyViewState,
  YeisSignalHover,
} from "./YeisGalaxyScene";
import type { UniverseContentPlacement } from "../../lib/universe/content";
import type {
  UniverseNavigationCameraRequest,
  UniverseNavigationDestination,
} from "../../lib/universe/yeis/navigation";
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
const LazyYeisSystemScene = lazy(() =>
  import("./YeisSystemScene").then((module) => ({
    default: module.YeisSystemScene,
  })),
);

function RendererPageLifecycle() {
  const { gl } = useThree();

  useEffect(() => {
    let released = false;
    let releaseTimer: number | null = null;
    const html = document.documentElement;
    html.dataset.universeWebglLifecycle = "active";

    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted || released) return;
      released = true;
      html.dataset.universeWebglLifecycle = "released";

      // Keep pagehide itself bounded. R3F/browser teardown remains the primary
      // owner at a discarded document boundary; if this page remains runnable
      // long enough, lose the context on the next task through Three.js'
      // standard WEBGL_lose_context wrapper.
      releaseTimer = window.setTimeout(() => {
        releaseTimer = null;
        // A real discarded document is already owned by the browser/R3F
        // teardown path. Only force the context when this document is still
        // live (for example the explicit terminal-release acceptance probe).
        // This avoids racing Chromium BrowserContext destruction with a late
        // WEBGL_lose_context task on hosted SwiftShader.
        if (document.visibilityState !== "visible") return;
        gl.forceContextLoss();
      }, 0);
    };

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (releaseTimer !== null) {
        window.clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      if (html.dataset.universeWebglLifecycle === "active") {
        delete html.dataset.universeWebglLifecycle;
      }
    };
  }, [gl]);

  return null;
}

export function UniverseCanvas({
  phase,
  phaseRef,
  engineMode,
  markers,
  contentPlacements,
  navigationRequest,
  onNavigationComplete,
  onNavigationFailed,
  selectedSystem,
  selectedPlanet,
  onSelectSystem,
  onNavigateDestination,
  onSignalHover,
  onScaleFocusDestination,
  onScaleManualTakeover,
  onScaleFocusPlanet,
  onSelectPlanet,
  quality,
  scrollDepth,
  reducedMotion,
  onCinematicPhaseComplete,
  onCinematicUserControlStart,
}: {
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  engineMode: UniverseEngine;
  markers: GalaxyMarker[];
  contentPlacements: UniverseContentPlacement[];
  navigationRequest: UniverseNavigationCameraRequest | null;
  onNavigationComplete: (request: UniverseNavigationCameraRequest) => void;
  onNavigationFailed: (
    request: UniverseNavigationCameraRequest,
    reason: string,
  ) => void;
  selectedSystem: SystemDefinition | null;
  selectedPlanet: PlanetDefinition | null;
  onSelectSystem: (marker: GalaxyMarker) => void;
  onNavigateDestination: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
  onSignalHover: (hover: YeisSignalHover) => void;
  onScaleFocusDestination: (
    destination: UniverseNavigationDestination | null,
  ) => void;
  onScaleManualTakeover: () => void;
  onScaleFocusPlanet: (planet: PlanetDefinition | null) => void;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  quality: QualityMode;
  scrollDepth: number;
  reducedMotion: boolean;
  onCinematicPhaseComplete: (phase: UniversePhase) => void;
  onCinematicUserControlStart: () => void;
}) {
  const yeisViewStateRef = useRef<YeisGalaxyViewState | null>(null);
  const [surfaceCameraFrame, setSurfaceCameraFrame] =
    useState<SurfaceCameraFrame | null>(null);
  const [surfaceFallbackPrimed, setSurfaceFallbackPrimed] = useState(false);

  useEffect(() => {
    if (phase === "surface") setSurfaceFallbackPrimed(true);
  }, [phase]);

  const liveWorld =
    Boolean(selectedPlanet) &&
    (phase === "approach" ||
      phase === "orbit" ||
      phase === "atmosphere" ||
      phase === "surface");

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
      <RendererPageLifecycle />
      {!(engineMode === "yeis" && phase === "galaxy") && (
        <CinematicCamera
          phase={phase}
          scrollDepth={scrollDepth}
          reducedMotion={reducedMotion}
          quality={quality}
          surfaceCameraFrame={surfaceCameraFrame}
          onPhaseComplete={onCinematicPhaseComplete}
          onUserControlStart={onCinematicUserControlStart}
        />
      )}

      {phase === "galaxy" && engineMode === "yeis" && (
        <Suspense fallback={null}>
          <LazyYeisGalaxyScene
            markers={markers}
            contentPlacements={contentPlacements}
            navigationRequest={navigationRequest}
            onNavigationComplete={onNavigationComplete}
            onNavigationFailed={onNavigationFailed}
            onNavigateDestination={onNavigateDestination}
            onSignalHover={onSignalHover}
            onScaleFocus={onScaleFocusDestination}
            onScaleManualTakeover={onScaleManualTakeover}
            quality={quality}
            reducedMotion={reducedMotion}
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
        selectedSystem.id.startsWith("yeis-system:") ? (
          <Suspense
            fallback={
              <SystemScene
                system={selectedSystem}
                onSelectPlanet={onSelectPlanet}
                onScaleFocus={onScaleFocusPlanet}
              />
            }
          >
            <LazyYeisSystemScene
              system={selectedSystem}
              onSelectPlanet={onSelectPlanet}
              onScaleFocus={onScaleFocusPlanet}
              quality={quality}
            />
          </Suspense>
        ) : (
          <SystemScene
            system={selectedSystem}
            onSelectPlanet={onSelectPlanet}
            onScaleFocus={onScaleFocusPlanet}
          />
        )
      )}

      <Suspense fallback={null}>
        {phase !== "galaxy" &&
          phase !== "system" &&
          phase !== "returning" &&
          selectedPlanet && (
            <LazyPlanetScene
              planet={selectedPlanet}
              quality={quality}
              phase={phase}
              onSurfaceCameraFrame={setSurfaceCameraFrame}
            />
          )}
      </Suspense>

      {surfaceFallbackPrimed ? (
        <Suspense fallback={null}>
          <LazySurfaceScene
            anchored
            phase={phase}
            phaseRef={phaseRef}
            quality={quality}
            hasPlanet={Boolean(selectedPlanet)}
          />
        </Suspense>
      ) : null}

      <CinematicPipeline
        quality={quality}
        liveWorld={liveWorld}
      />
    </Canvas>
  );
}
