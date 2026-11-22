import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UniverseCanvas } from "./UniverseCanvas";
import { UniverseHud } from "./UniverseHud";
import { UniverseNavigator } from "./UniverseNavigator";
import type {
  GalaxyMarker,
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
  UniverseEngine,
} from "../../lib/universe/types";
import {
  buildGalaxyIndex,
  resolveSystem,
} from "../../lib/universe/generation";
import { useAmbientAudio } from "../../lib/universe/useAmbientAudio";
import {
  attachContentToSystem,
  placeUniverseContent,
  placementsForMarker,
  type UniverseContentEntry,
} from "../../lib/universe/content";
import {
  navigationCameraTarget,
  navigationDestinationForMarker,
  navigationMarker,
  resolveUniverseNavigationDestination,
  type UniverseNavigationCameraRequest,
  type UniverseNavigationDestination,
} from "../../lib/universe/yeis/navigation";
import "./universe.css";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

const VALID_PHASES: UniversePhase[] = [
  "galaxy",
  "system",
  "approach",
  "orbit",
  "atmosphere",
  "surface",
  "returning",
];

type UniverseJourneyState = {
  title: string;
  destinations: UniverseNavigationDestination[];
  index: number;
  paused: boolean;
};


function cameraTargetLabel(
  target: UniverseNavigationCameraRequest["target"],
): string {
  if (target.kind === "star") return target.nativeId;
  if (target.kind === "point") return "point:" + target.id;
  if (target.kind === "body") {
    return "body:" + target.starId + "/" + target.bodyId;
  }
  if (target.kind === "blackhole") return "blackhole:" + target.id;
  return target.kind + ":" + target.index;
}

export default function UniverseApp({
  contentEntries = [],
}: {
  contentEntries?: UniverseContentEntry[];
}) {
  const v2Galaxy = useMemo(() => buildGalaxyIndex("personal-universe-v2"), []);
  const [galaxy, setGalaxy] = useState(v2Galaxy);
  const [phase, setPhase] = useState<UniversePhase>("galaxy");
  const [selectedSystem, setSelectedSystem] = useState<SystemDefinition | null>(null);
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetDefinition | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [scrollDepth, setScrollDepth] = useState(0);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navigationRequest, setNavigationRequest] =
    useState<UniverseNavigationCameraRequest | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<
    "locating" | "traveling" | "located" | "arrived" | null
  >(null);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(
    null,
  );
  const [signalHover, setSignalHover] = useState<{
    title: string;
    kind: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [journey, setJourney] = useState<UniverseJourneyState | null>(null);
  const navigationRequestSeq = useRef(0);
  const deepLinkHandledRef = useRef<string | null>(null);
  const journeyNavigationRef = useRef(false);
  const journeyRef = useRef<UniverseJourneyState | null>(null);
  const [coreDiagnostic, setCoreDiagnostic] = useState<{
    status: "loading" | "ready" | "error";
    detail: string;
  } | null>(null);
  const yeisResolverRef = useRef<((marker: GalaxyMarker) => SystemDefinition) | null>(null);
  const requestedEngine: UniverseEngine =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("engine") === "v2"
      ? "v2"
      : "yeis";
  const [activeEngine, setActiveEngine] = useState<UniverseEngine>(requestedEngine);
  const contentPlacements = useMemo(
    () => placeUniverseContent(contentEntries, galaxy.markers),
    [contentEntries, galaxy.markers],
  );
  const reducedMotion = useReducedMotion();
  const ambient = useAmbientAudio(muted, phase);
  const debugFreeze =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("freeze") === "1";

  useEffect(() => {
    if (activeEngine !== "yeis") {
      setNavigatorOpen(false);
      return;
    }

    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const commandK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !editing;

      if (!commandK && !slash) return;
      event.preventDefault();
      setNavigatorOpen(true);
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeEngine]);

  useEffect(() => {
    if (requestedEngine !== "yeis") {
      yeisResolverRef.current = null;
      setGalaxy(v2Galaxy);
      setActiveEngine("v2");
      document.documentElement.dataset.universeEngine = "v2";
      return;
    }

    let cancelled = false;
    setActiveEngine("yeis");
    void import("../../lib/universe/yeis")
      .then(async ({ loadYeisCore, buildYeisGalaxyIndex, resolveYeisSystem }) => {
        const runtime = await loadYeisCore();
        const observedMarkers = v2Galaxy.markers.filter(
          (marker) => marker.source === "catalog",
        );
        const nextGalaxy = buildYeisGalaxyIndex(runtime, observedMarkers);

        if (cancelled) return;
        yeisResolverRef.current = (marker) => resolveYeisSystem(runtime, marker);
        document.documentElement.dataset.universeEngine = "yeis";
        setActiveEngine("yeis");
        const yeisSample = nextGalaxy.markers.find(
          (marker) =>
            marker.engine === "yeis" &&
            marker.source === "catalog" &&
            marker.nativeId !== "c0",
        );
        const observedSample = nextGalaxy.markers.find(
          (marker) => marker.engine === "v2" && marker.source === "catalog",
        );
        console.info(
          `[YEIS-BRIDGE] READY markers=${nextGalaxy.markers.length} ` +
            `observed=${observedMarkers.length} ` +
            `yeisSample=${yeisSample?.id ?? "none"}:${yeisSample?.name ?? "none"} ` +
            `observedSample=${observedSample?.id ?? "none"}:${observedSample?.name ?? "none"}`,
        );
        setGalaxy(nextGalaxy);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[YEIS-BRIDGE] FAILED; retaining V2 fallback", error);
        document.documentElement.dataset.universeEngine = "v2-fallback";
        yeisResolverRef.current = null;
        setActiveEngine("v2");
        setGalaxy(v2Galaxy);
      });

    return () => {
      cancelled = true;
    };
  }, [requestedEngine, v2Galaxy]);

  const resolveMarker = useCallback(
    (marker: GalaxyMarker): SystemDefinition => {
      const base =
        marker.engine === "yeis" && yeisResolverRef.current
          ? yeisResolverRef.current(marker)
          : resolveSystem(marker);
      return attachContentToSystem(
        base,
        placementsForMarker(contentPlacements, marker.id),
      );
    },
    [contentPlacements],
  );

  useEffect(() => {
    document.documentElement.dataset.personalContent = String(contentEntries.length);
    document.documentElement.dataset.personalSignals = String(contentPlacements.length);
    document.documentElement.dataset.personalSignalTargets = contentPlacements
      .map((placement) => placement.nativeId ?? placement.markerId)
      .join(",");
    if (contentPlacements.length > 0) {
      console.info(
        `[PERSONAL-CONTENT] entries=${contentEntries.length} placements=${contentPlacements
          .map((placement) => `${placement.entry.id}->${placement.nativeId ?? placement.markerId}`)
          .join(",")}`,
      );
    }
    return () => {
      delete document.documentElement.dataset.personalContent;
      delete document.documentElement.dataset.personalSignals;
      delete document.documentElement.dataset.personalSignalTargets;
    };
  }, [contentEntries.length, contentPlacements]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("destination")) return;
    const requested = params.get("phase");
    if (!requested || !VALID_PHASES.includes(requested as UniversePhase)) return;

    const requestedPhase = requested as UniversePhase;
    if (requestedPhase === "galaxy") {
      setPhase("galaxy");
      return;
    }

    const requestedStar = params.get("star")?.trim().toLowerCase();
    const targetMarker = requestedStar
      ? galaxy.markers.find(
          (marker) =>
            marker.id.toLowerCase() === requestedStar ||
            marker.nativeId?.toLowerCase() === requestedStar ||
            marker.name.toLowerCase() === requestedStar,
        )
      : galaxy.markers.find((marker) => marker.source === "hero");

    if (!targetMarker) return;
    const system = resolveMarker(targetMarker);
    console.info(
      `[UNIVERSE-DEBUG] star=${targetMarker.id} engine=${targetMarker.engine ?? "v2"} ` +
        `system=${system.name} planets=${system.planets.length} source=${system.source}`,
    );
    setSelectedSystem(system);

    if (requestedPhase === "system" || requestedPhase === "returning") {
      setSelectedPlanet(null);
      setPhase(requestedPhase);
      return;
    }

    const selected =
      system.planets.find((planet) => planet.content?.length) ??
      system.planets.find((planet) => planet.heroKey === "home") ??
      system.planets[0] ??
      null;
    if (!selected) return;
    setSelectedPlanet(selected);
    setPhase(requestedPhase);
  }, [galaxy.markers, resolveMarker]);

  useEffect(() => {
    const diagnostic = new URLSearchParams(window.location.search).get("diagnostic");
    if (diagnostic !== "yeis-core") return;

    let cancelled = false;
    setCoreDiagnostic({
      status: "loading",
      detail: "Loading vendored universe model and 109,401-star catalogue…",
    });

    void import("../../lib/universe/yeis")
      .then(async ({ loadYeisCore, HERO_PLANET_ID }) => {
        const runtime = await loadYeisCore();
        const hero = runtime.heroSystem.get(HERO_PLANET_ID);
        const detail =
          `stars=${runtime.catalog.count} heroSystem=${runtime.heroSystem.id} ` +
          `bodies=${runtime.heroSystem.bodies.length} hero=${hero?.name ?? "missing"}`;

        if (cancelled) return;
        document.documentElement.dataset.yeisCore = "ready";
        document.documentElement.dataset.yeisStars = String(runtime.catalog.count);
        console.info(`[YEIS-CORE] READY ${detail}`);
        setCoreDiagnostic({ status: "ready", detail });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        document.documentElement.dataset.yeisCore = "error";
        console.error("[YEIS-CORE] FAILED", error);
        setCoreDiagnostic({ status: "error", detail });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectSystem = useCallback(
    (marker: GalaxyMarker) => {
      const system = resolveMarker(marker);
      setSelectedSystem(system);
      setSelectedPlanet(null);
      setScrollDepth(0);
      setNavigationRequest(null);
      setNavigationStatus(null);
      setActiveDestinationId(
        navigationDestinationForMarker(marker, contentPlacements).id,
      );
      ambient.ensurePlaying();
      setPhase("system");
    },
    [ambient, contentPlacements, resolveMarker],
  );

  const handleNavigateDestination = useCallback(
    async (destination: UniverseNavigationDestination) => {
      const journeyDriven = journeyNavigationRef.current;
      journeyNavigationRef.current = false;
      if (!journeyDriven) {
        journeyRef.current = null;
        setJourney(null);
      }
      if (activeEngine !== "yeis") return;

      const spatial =
        destination.target.kind === "galaxy" ||
        destination.target.kind === "landmark" ||
        destination.target.kind === "blackhole";

      setActiveDestinationId(destination.id);
      document.documentElement.dataset.universeActiveDestination =
        destination.id;

      if (!spatial) {
        const marker = await navigationMarker(destination, galaxy.markers);
        const system = resolveMarker(marker);
        let planet: PlanetDefinition | null = null;

        if (destination.target.kind === "content") {
          planet =
            system.planets.find((candidate) =>
              candidate.content?.some(
                (entry) => entry.id === destination.target.entryId,
              ),
            ) ?? null;
        } else if (destination.target.kind === "body") {
          const bodyId = destination.target.bodyId.toLowerCase();
          planet =
            system.planets.find((candidate) => {
              const id = candidate.id.toLowerCase();
              const name = candidate.name.toLowerCase();
              return (
                id === bodyId ||
                id === "yeis-planet:" + bodyId ||
                name === bodyId
              );
            }) ?? null;
        } else if (destination.target.kind === "observed-body") {
          planet =
            system.planets.find(
              (candidate) =>
                candidate.id === destination.target.bodyId,
            ) ?? null;
          if (!planet) {
            console.error(
              "[UNIVERSE-NAV] observed exoplanet missing from resolved host",
              destination.target.markerId,
              destination.target.bodyId,
            );
            document.documentElement.dataset.universeNavigationError =
              destination.id;
          }
        }

        if (destination.target.kind === "body" && !planet) {
          const cameraTarget = navigationCameraTarget(
            destination,
            galaxy.markers,
          );
          if (cameraTarget) {
            navigationRequestSeq.current += 1;
            setSelectedSystem(null);
            setSelectedPlanet(null);
            setPhase("galaxy");
            setNavigationRequest({
              requestId: navigationRequestSeq.current,
              mode: "travel",
              target: cameraTarget,
              title: destination.title,
            });
            setNavigationStatus("traveling");
            const nativeBodyTarget = cameraTargetLabel(cameraTarget);
            document.documentElement.dataset.universeNavigationTarget =
              nativeBodyTarget;
            document.documentElement.dataset.universeNavigationPhase =
              "galaxy";
            console.info(
              "[UNIVERSE-NAV] native body travel " +
                destination.title +
                " -> " +
                nativeBodyTarget,
            );
            return;
          }
        }

        setNavigationRequest(null);
        setNavigationStatus(null);
        setSelectedSystem(system);
        setSelectedPlanet(planet);
        setScrollDepth(0);
        delete document.documentElement.dataset.universeLocated;
        ambient.ensurePlaying();
        setPhase(planet ? "approach" : "system");

        const nativeTarget =
          destination.target.kind === "marker"
            ? destination.target.markerId
            : destination.target.kind === "content"
              ? destination.target.nativeId + "/" + destination.target.entryId
              : destination.target.kind === "body"
                ? destination.target.starId + "/" + destination.target.bodyId
                : destination.target.kind === "observed-body"
                  ? destination.target.markerId + "/" + destination.target.bodyId
                  : destination.target.kind === "star"
                    ? destination.target.nativeId
                    : destination.id;
        document.documentElement.dataset.universeNavigationTarget =
          nativeTarget;
        document.documentElement.dataset.universeNavigationPhase =
          planet ? "approach" : "system";
        console.info(
          "[UNIVERSE-NAV] open " +
            destination.kind +
            ":" +
            destination.title +
            " -> " +
            nativeTarget +
            (planet ? " planet=" + planet.id : ""),
        );
        return;
      }

      const cameraTarget = navigationCameraTarget(destination, galaxy.markers);
      if (!cameraTarget) return;

      navigationRequestSeq.current += 1;
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("galaxy");
      setNavigationRequest({
        requestId: navigationRequestSeq.current,
        mode: "travel",
        target: cameraTarget,
        title: destination.title,
      });
      setNavigationStatus("traveling");
      const spatialTarget = cameraTargetLabel(cameraTarget);
      document.documentElement.dataset.universeNavigationTarget =
        spatialTarget;
      console.info(
        "[UNIVERSE-NAV] travel " +
          destination.kind +
          ":" +
          destination.title +
          " -> " +
          spatialTarget,
      );
    },
    [
      activeEngine,
      ambient,
      galaxy.markers,
      resolveMarker,
    ],
  );

  const handleLocateDestination = useCallback(
    async (destination: UniverseNavigationDestination) => {
      journeyNavigationRef.current = false;
      journeyRef.current = null;
      setJourney(null);
      if (activeEngine !== "yeis") return;
      const cameraTarget = navigationCameraTarget(destination, galaxy.markers);
      if (!cameraTarget) {
        await handleNavigateDestination(destination);
        return;
      }

      navigationRequestSeq.current += 1;
      setActiveDestinationId(destination.id);
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("galaxy");
      setNavigationRequest({
        requestId: navigationRequestSeq.current,
        mode: "locate",
        target: cameraTarget,
        title: destination.title,
      });
      setNavigationStatus("locating");
      const target = cameraTargetLabel(cameraTarget);
      document.documentElement.dataset.universeActiveDestination =
        destination.id;
      document.documentElement.dataset.universeNavigationTarget = target;
      console.info(
        "[UNIVERSE-NAV] locate " +
          destination.kind +
          ":" +
          destination.title +
          " -> " +
          target,
      );
    },
    [
      activeEngine,
      galaxy.markers,
      handleNavigateDestination,
    ],
  );

  const handleStartJourney = useCallback(
    (
      title: string,
      destinations: UniverseNavigationDestination[],
    ) => {
      if (!destinations.length) return;
      const next: UniverseJourneyState = {
        title,
        destinations,
        index: 0,
        paused: false,
      };
      journeyRef.current = next;
      setJourney(next);
      journeyNavigationRef.current = true;
      void handleNavigateDestination(destinations[0]);
      document.documentElement.dataset.universeJourney = title;
      console.info(
        "[UNIVERSE-JOURNEY] start " +
          title +
          " stops=" +
          destinations.length,
      );
    },
    [handleNavigateDestination],
  );

  const handleJourneyStep = useCallback(
    (delta: number) => {
      const current = journeyRef.current;
      if (!current) return;
      const nextIndex = current.index + delta;
      if (nextIndex < 0) return;
      if (nextIndex >= current.destinations.length) {
        journeyRef.current = null;
        setJourney(null);
        delete document.documentElement.dataset.universeJourney;
        console.info("[UNIVERSE-JOURNEY] complete " + current.title);
        return;
      }

      const next = { ...current, index: nextIndex };
      journeyRef.current = next;
      setJourney(next);
      journeyNavigationRef.current = true;
      void handleNavigateDestination(next.destinations[nextIndex]);
    },
    [handleNavigateDestination],
  );

  const handleToggleJourneyPause = useCallback(() => {
    const current = journeyRef.current;
    if (!current) return;
    const next = { ...current, paused: !current.paused };
    journeyRef.current = next;
    setJourney(next);
  }, []);

  const handleStopJourney = useCallback(() => {
    journeyNavigationRef.current = false;
    journeyRef.current = null;
    setJourney(null);
    delete document.documentElement.dataset.universeJourney;
  }, []);

  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  useEffect(() => {
    if (
      !journey ||
      journey.paused ||
      reducedMotion ||
      journey.destinations.length < 2 ||
      !["system", "orbit", "surface"].includes(phase)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      handleJourneyStep(1);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [
    handleJourneyStep,
    journey,
    phase,
    reducedMotion,
  ]);

  useEffect(() => {
    if (activeEngine !== "yeis") return;
    const params = new URLSearchParams(window.location.search);
    const destinationId = params.get("destination")?.trim();
    if (!destinationId) {
      deepLinkHandledRef.current = null;
      return;
    }

    const mode = params.get("navigation") === "locate" ? "locate" : "open";
    const key = destinationId + "|" + mode;
    if (deepLinkHandledRef.current === key) return;
    deepLinkHandledRef.current = key;

    let cancelled = false;
    void resolveUniverseNavigationDestination(
      destinationId,
      contentPlacements,
      galaxy.markers,
    )
      .then((destination) => {
        if (cancelled || !destination) return;
        document.documentElement.dataset.universeDeepLink = destination.id;
        return mode === "locate"
          ? handleLocateDestination(destination)
          : handleNavigateDestination(destination);
      })
      .catch((error) => {
        if (cancelled) return;
        deepLinkHandledRef.current = null;
        console.error("[UNIVERSE-NAV] deep link failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeEngine,
    contentPlacements,
    galaxy.markers,
    handleLocateDestination,
    handleNavigateDestination,
  ]);

  const handleNavigationComplete = useCallback(
    (request: UniverseNavigationCameraRequest) => {
      setNavigationStatus(
        request.mode === "travel" ? "arrived" : "located",
      );
    },
    [],
  );

  const handleSelectPlanet = useCallback(
    (planet: PlanetDefinition) => {
      setSelectedPlanet(planet);
      ambient.ensurePlaying();
      setPhase("approach");
    },
    [ambient],
  );

  const handleCinematicPhaseComplete = useCallback(
    (completed: UniversePhase) => {
      if (debugFreeze) return;

      setPhase((current) => {
        if (current !== completed) return current;

        if (completed === "approach") return "orbit";
        if (completed === "orbit") {
          return selectedPlanet?.surfaceMode === "none" ? "orbit" : "atmosphere";
        }
        if (completed === "atmosphere") return "surface";
        if (completed === "returning") return "galaxy";
        return current;
      });
    },
    [debugFreeze, selectedPlanet?.surfaceMode],
  );

  const handleReturn = useCallback(() => {
    journeyNavigationRef.current = false;
    journeyRef.current = null;
    setJourney(null);
    delete document.documentElement.dataset.universeJourney;
    if (phase === "system") {
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase(activeEngine === "yeis" ? "galaxy" : "returning");
      return;
    }

    if (phase === "returning") return;

    setSelectedPlanet(null);
    if (selectedSystem) {
      setPhase("system");
    } else {
      setPhase("galaxy");
    }
  }, [activeEngine, phase, selectedSystem]);

  const transitionClass = useMemo(() => {
    if (phase === "atmosphere") return "transition-atmosphere";
    if (phase === "surface") return "transition-surface";
    return "";
  }, [phase]);

  return (
    <main
      className={`universe-root ${transitionClass}`}
      onWheel={(event) => {
        if (phase !== "galaxy" || activeEngine === "yeis") return;
        setScrollDepth((value) =>
          Math.max(-3.5, Math.min(4.5, value + Math.sign(event.deltaY) * 0.42)),
        );
      }}
    >
      <div className="universe-canvas">
        <UniverseCanvas
          phase={phase}
          engineMode={activeEngine}
          markers={galaxy.markers}
          contentPlacements={contentPlacements}
          navigationRequest={navigationRequest}
          onNavigationComplete={handleNavigationComplete}
          selectedSystem={selectedSystem}
          selectedPlanet={selectedPlanet}
          onSelectSystem={handleSelectSystem}
          onNavigateDestination={handleNavigateDestination}
          onSignalHover={setSignalHover}
          onSelectPlanet={handleSelectPlanet}
          quality={quality}
          scrollDepth={scrollDepth}
          reducedMotion={reducedMotion}
          onCinematicPhaseComplete={handleCinematicPhaseComplete}
        />
      </div>

      <div className="cinematic-wash" aria-hidden="true" />

      {phase === "galaxy" &&
        activeEngine === "yeis" &&
        signalHover &&
        !navigatorOpen && (
          <aside
            className="personal-signal-hover"
            style={{
              left: Math.min(signalHover.clientX + 16, window.innerWidth - 240),
              top: Math.min(signalHover.clientY + 16, window.innerHeight - 92),
            }}
          >
            <span>PERSONAL SIGNAL · {signalHover.kind.toUpperCase()}</span>
            <strong>{signalHover.title}</strong>
          </aside>
        )}

      {coreDiagnostic && (
        <aside
          data-yeis-core-diagnostic={coreDiagnostic.status}
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 20,
            maxWidth: 520,
            padding: "10px 12px",
            border: "1px solid rgba(126, 235, 255, 0.35)",
            background: "rgba(1, 7, 14, 0.88)",
            color: "#dffaff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            pointerEvents: "none",
          }}
        >
          <strong>YEIS CORE // {coreDiagnostic.status.toUpperCase()}</strong>
          <div>{coreDiagnostic.detail}</div>
        </aside>
      )}

      {journey && (
        <aside className="universe-journey-controls">
          <header>
            <div>
              <span>GUIDED JOURNEY</span>
              <strong>{journey.title}</strong>
            </div>
            <button
              type="button"
              onClick={handleStopJourney}
              aria-label="Stop guided journey"
            >
              STOP
            </button>
          </header>
          <div className="journey-current">
            <small>
              {journey.index + 1} / {journey.destinations.length}
            </small>
            <strong>
              {journey.destinations[journey.index]?.title}
            </strong>
          </div>
          <div className="journey-progress" aria-hidden="true">
            <i
              style={{
                width:
                  ((journey.index + 1) /
                    journey.destinations.length) *
                    100 +
                  "%",
              }}
            />
          </div>
          <div className="journey-actions">
            <button
              type="button"
              disabled={journey.index === 0}
              onClick={() => handleJourneyStep(-1)}
            >
              ← PREV
            </button>
            <button
              type="button"
              onClick={handleToggleJourneyPause}
            >
              {journey.paused ? "RESUME" : "PAUSE"}
            </button>
            <button
              type="button"
              disabled={
                journey.index >= journey.destinations.length - 1
              }
              onClick={() => handleJourneyStep(1)}
            >
              NEXT →
            </button>
          </div>
          <small className="journey-mode">
            {reducedMotion
              ? "REDUCED MOTION · MANUAL ADVANCE"
              : journey.paused
                ? "PAUSED · CAMERA REMAINS FREE"
                : "AUTO ADVANCE · CAMERA REMAINS FREE"}
          </small>
        </aside>
      )}

      <UniverseHud
        phase={phase}
        selectedSystem={selectedSystem}
        selectedPlanet={selectedPlanet}
        markerCount={galaxy.markers.length}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        muted={muted}
        onToggleMuted={() => {
          if (muted) ambient.ensurePlaying();
          setMuted((value) => !value);
        }}
        quality={quality}
        onQualityChange={setQuality}
        onOpenNavigator={() => setNavigatorOpen(true)}
        navigatorAvailable={activeEngine === "yeis"}
        onReturn={handleReturn}
      />

      <UniverseNavigator
        open={navigatorOpen && activeEngine === "yeis"}
        markers={galaxy.markers}
        placements={contentPlacements}
        currentSystem={selectedSystem}
        activeDestinationId={activeDestinationId}
        onClose={() => setNavigatorOpen(false)}
        onNavigate={handleNavigateDestination}
        onLocate={handleLocateDestination}
        onStartJourney={handleStartJourney}
      />

      {phase === "galaxy" && navigationRequest && (
        <div className="galaxy-locate-caption">
          {navigationStatus === "arrived"
            ? "ARRIVED"
            : navigationStatus === "located"
              ? "LOCATED"
              : navigationRequest.mode === "travel"
                ? "NAVIGATING"
                : "LOCATING"} //{" "}
          {navigationRequest.title}
        </div>
      )}

      {phase === "galaxy" && (
        <section className="hero-copy">
          <span className="eyebrow">PERSONAL UNIVERSE // GALACTIC INDEX</span>
          <h1>A living map of observed and imagined worlds.</h1>
          <p>
            {contentPlacements.length} personal {contentPlacements.length === 1 ? "signal is" : "signals are"} mapped onto stable stellar addresses.
            Observed and procedural worlds remain astronomical until real content is attached.
          </p>
        </section>
      )}

      {phase === "system" && selectedSystem && (
        <section className="system-copy">
          <span>
            {selectedSystem.source.toUpperCase()} SYSTEM // {selectedSystem.star.spectralType}
          </span>
          <strong>{selectedSystem.name}</strong>
          <small>
            {selectedSystem.planets.length} worlds.
            {selectedSystem.content?.length
              ? ` ${selectedSystem.content.length} personal signal${selectedSystem.content.length === 1 ? "" : "s"} detected; the linked world is highlighted.`
              : " Select a planet to approach it. Ordinary worlds remain orbital; Hero worlds may continue below the clouds."}
          </small>
          {selectedSystem.content?.map((entry) => (
            <div className="content-signal-card" key={entry.id}>
              <span>PERSONAL SIGNAL // {entry.kind.toUpperCase()}</span>
              <b>{entry.title}</b>
              <small>{entry.summary}</small>
            </div>
          ))}
        </section>
      )}

      {phase !== "galaxy" &&
        phase !== "system" &&
        selectedPlanet?.content?.map((entry) => (
          <section className="world-content-card" key={entry.id}>
            <span>WORLD SIGNAL // {entry.kind.toUpperCase()}</span>
            <strong>{entry.title}</strong>
            <small>{entry.summary}</small>
            {entry.tags.length > 0 && (
              <em>{entry.tags.slice(0, 4).join(" · ")}</em>
            )}
          </section>
        ))}

      {phase === "surface" && selectedPlanet && (
        <section className="surface-copy">
          <span>HERO WORLD // SURFACE MODULE</span>
          <strong>{selectedPlanet.name}</strong>
          <small>
            Custom surfaces are overrides. The procedural universe does not require every
            generated planet to carry a handcrafted world.
          </small>
        </section>
      )}

      {phase === "approach" && selectedPlanet && (
        <div className="travel-caption">
          LOCK ACQUIRED // {selectedPlanet.name}
        </div>
      )}
      {phase === "orbit" && selectedPlanet && (
        <div className="travel-caption">
          ORBIT // {selectedPlanet.name}
          {selectedPlanet.surfaceMode === "none" ? " // SCAN MODE" : ""}
        </div>
      )}
      {phase === "atmosphere" && selectedPlanet && (
        <div className="travel-caption">
          ATMOSPHERIC ENTRY // {selectedPlanet.name}
        </div>
      )}
    </main>
  );
}
