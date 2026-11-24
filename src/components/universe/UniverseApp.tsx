import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from "react";
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
  SURFACE_CONTENT_SIGNAL_BUDGET,
  buildSurfaceWorldProfile,
  nextSurfaceClusterEntryId,
  rankSurfaceContentAnchors,
  rankSurfaceContentClusters,
} from "../../lib/universe/surface";
import {
  attachContentToSystem,
  placeUniverseContent,
  placementsForMarker,
  type UniverseContentEntry,
} from "../../lib/universe/content";
import {
  CONTINUOUS_SCALE_ACTIVE_RESET_MS,
  CONTINUOUS_SCALE_RESET_MS,
  CONTINUOUS_SCALE_WHEEL_THRESHOLD,
  GALAXY_SCALE_MIN,
  SYSTEM_SCALE_MIN,
  WORLD_SCALE_EPSILON,
  WORLD_SCALE_MIN,
  applyGalaxyScaleWheel,
  applySystemScaleWheel,
  applyWorldScaleWheel,
  continuousScaleDelta,
  continuousScaleDirection,
  continuousScaleInputResponseDelta,
  continuousScaleResponseDistance,
  normalizeWheelDelta,
  galaxyScaleSegmentProgress,
  isWorldScalePhase,
  nextWorldScalePhase,
  scalePhaseIndex,
  scalePositionForPhase,
  systemScaleSegmentProgress,
  worldScaleMax,
  worldScalePhaseForPosition,
  worldScalePositionMatchesPhase,
  worldScaleSegmentProgress,
  type ContinuousScaleDirection,
} from "../../lib/universe/continuousScale";
import {
  applyProductLocale,
  astronomicalName,
  detectProductLocale,
  journeyTitle,
  kindLabel,
  text,
  type ProductLocale,
} from "../../lib/universe/locale";
import {
  navigationCameraTarget,
  navigationDestinationForMarker,
  navigationDestinationForPlacement,
  navigationDestinationForPlanet,
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

function nativePlanetId(planet: PlanetDefinition): string {
  return planet.id.startsWith("yeis-planet:")
    ? planet.id.slice("yeis-planet:".length)
    : planet.id;
}

function nativeSystemId(system: SystemDefinition | null): string | null {
  if (!system?.id.startsWith("yeis-system:")) return null;
  return system.id.slice("yeis-system:".length);
}

function routeStarIdentityForSystem(
  system: SystemDefinition,
  markers: GalaxyMarker[],
): string | null {
  const nativeId = nativeSystemId(system);
  if (nativeId) return nativeId;

  const [x, y, z] = system.galaxyPosition;
  const marker = markers.find(
    (candidate) =>
      Math.abs(candidate.position[0] - x) < 1e-9 &&
      Math.abs(candidate.position[1] - y) < 1e-9 &&
      Math.abs(candidate.position[2] - z) < 1e-9,
  );
  return marker?.nativeId ?? marker?.id ?? null;
}

function deepLinkNavigationKey(
  destinationId: string,
  mode: "open" | "locate",
  phase?: UniversePhase | null,
) {
  const restorableWorldPhase =
    phase && ["approach", "orbit", "atmosphere", "surface"].includes(phase)
      ? phase
      : "";
  return destinationId + "|" + mode + "|" + restorableWorldPhase;
}

function replaceNavigationUrl({
  phase,
  starId,
  bodyId,
  destinationId,
  navigationMode,
}: {
  phase: UniversePhase;
  starId?: string | null;
  bodyId?: string | null;
  destinationId?: string | null;
  navigationMode?: "open" | "locate" | null;
}) {
  const url = new URL(window.location.href);

  if (phase === "galaxy") {
    url.searchParams.delete("phase");
    url.searchParams.delete("star");
    url.searchParams.delete("body");
  } else {
    url.searchParams.set("phase", phase);
    if (starId) url.searchParams.set("star", starId);
    else if (starId === null) url.searchParams.delete("star");
    if (bodyId) url.searchParams.set("body", bodyId);
    else if (bodyId === null) url.searchParams.delete("body");
  }

  if (destinationId !== undefined) {
    if (destinationId) url.searchParams.set("destination", destinationId);
    else url.searchParams.delete("destination");
  }

  if (navigationMode !== undefined) {
    if (navigationMode === "locate") {
      url.searchParams.set("navigation", "locate");
    } else {
      url.searchParams.delete("navigation");
    }
  }

  window.history.replaceState(window.history.state, "", url);
}

type UniverseJourneyState = {
  title: string;
  destinations: UniverseNavigationDestination[];
  index: number;
  paused: boolean;
  completed: boolean;
};


function cameraTargetLabel(
  target: UniverseNavigationCameraRequest["target"],
): string {
  if (target.kind === "star") return target.nativeId;
  if (target.kind === "point") return "point:" + target.id;
  if (target.kind === "body") {
    return target.starId + "/" + target.bodyId;
  }
  if (target.kind === "blackhole") return "blackhole:" + target.id;
  return target.kind + ":" + target.index;
}

function scheduleScaleRendererHandoff({
  label,
  isCurrent,
  commit,
}: {
  label: string;
  isCurrent: () => boolean;
  commit: () => void;
}) {
  let completed = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let deadline = 0;

  const finish = (source: "paint" | "deadline") => {
    if (completed) return;
    completed = true;
    if (firstFrame) window.cancelAnimationFrame(firstFrame);
    if (secondFrame) window.cancelAnimationFrame(secondFrame);
    if (deadline) window.clearTimeout(deadline);

    if (!isCurrent()) return;
    document.documentElement.dataset.universeScaleHandoff =
      label + ":" + source;
    commit();
  };

  // Two rAF callbacks preserve one real endpoint paint on a healthy renderer.
  // Hosted/software WebGL can stop delivering rAF while the browser still
  // accepts wheel events, so do not let that presentation preference become
  // an input lock. The matched endpoints are already composition-equivalent.
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => finish("paint"));
  });
  deadline = window.setTimeout(() => finish("deadline"), 64);
}

function scaleSystemDestinationForMarker(
  marker: GalaxyMarker,
): UniverseNavigationDestination {
  if (marker.nativeId) {
    return {
      id: "star:" + marker.nativeId,
      kind: "star",
      group: "stars",
      title: marker.name,
      detail: (marker.spectralType || "STAR") + " · YEIS SYSTEM",
      target: { kind: "star", nativeId: marker.nativeId },
      markerId: marker.id,
    };
  }
  return navigationDestinationForMarker(marker, []);
}

export default function UniverseApp({
  contentEntries = [],
}: {
  contentEntries?: UniverseContentEntry[];
}) {
  const v2Galaxy = useMemo(() => buildGalaxyIndex("personal-universe-v2"), []);
  const [galaxy, setGalaxy] = useState(v2Galaxy);
  const [phase, setPhase] = useState<UniversePhase>("galaxy");
  const phaseRef = useRef<UniversePhase>("galaxy");
  phaseRef.current = phase;
  const [selectedSystem, setSelectedSystem] = useState<SystemDefinition | null>(null);
  const selectedSystemRef = useRef<SystemDefinition | null>(null);
  selectedSystemRef.current = selectedSystem;
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetDefinition | null>(null);
  const [activeDestinationId, setActiveDestinationId] = useState<string | null>(
    null,
  );
  const [surfaceLocalFocusEntryId, setSurfaceLocalFocusEntryId] = useState<
    string | null
  >(null);
  const surfaceNavigationFocusEntryId = useMemo(() => {
    if (!selectedPlanet || !activeDestinationId?.startsWith("personal:")) {
      return null;
    }
    const entryId = activeDestinationId.slice("personal:".length);
    return selectedPlanet.content?.some((entry) => entry.id === entryId)
      ? entryId
      : null;
  }, [activeDestinationId, selectedPlanet]);
  const surfaceFocusEntryId = useMemo(() => {
    if (
      surfaceLocalFocusEntryId &&
      selectedPlanet?.content?.some(
        (entry) => entry.id === surfaceLocalFocusEntryId,
      )
    ) {
      return surfaceLocalFocusEntryId;
    }
    return surfaceNavigationFocusEntryId;
  }, [
    selectedPlanet,
    surfaceLocalFocusEntryId,
    surfaceNavigationFocusEntryId,
  ]);

  useEffect(() => {
    // Local Surface exploration can survive Atmosphere/Surface round trips,
    // but a new product navigation destination must regain authority even when
    // it resolves to another signal on the same world.
    setSurfaceLocalFocusEntryId(null);
  }, [activeDestinationId, selectedPlanet?.id]);

  useEffect(() => {
    if (surfaceFocusEntryId) {
      document.documentElement.dataset.universeSurfaceFocusEntry =
        surfaceFocusEntryId;
      document.documentElement.dataset.universeSurfaceFocusSource =
        surfaceLocalFocusEntryId === surfaceFocusEntryId
          ? "surface-selection"
          : "navigation";
    } else {
      delete document.documentElement.dataset.universeSurfaceFocusEntry;
      delete document.documentElement.dataset.universeSurfaceFocusSource;
    }
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceFocusEntry ===
        surfaceFocusEntryId
      ) {
        delete document.documentElement.dataset.universeSurfaceFocusEntry;
        delete document.documentElement.dataset.universeSurfaceFocusSource;
      }
    };
  }, [surfaceFocusEntryId, surfaceLocalFocusEntryId]);

  const surfaceProfile = useMemo(
    () =>
      selectedPlanet && selectedPlanet.surfaceMode !== "none"
        ? buildSurfaceWorldProfile(selectedPlanet)
        : null,
    [selectedPlanet],
  );
  const surfaceFocusedAnchor = useMemo(
    () =>
      surfaceProfile?.contentAnchors.find(
        (anchor) => anchor.entryId === surfaceFocusEntryId,
      ) ?? null,
    [surfaceFocusEntryId, surfaceProfile],
  );
  const surfaceContentPresentation = useMemo(() => {
    if (!surfaceProfile) {
      return new Map<
        string,
        {
          location: string;
          cluster: string;
          priority: "primary" | "secondary" | "ambient";
        }
      >();
    }
    const landmarkNames = new Map(
      surfaceProfile.landmarks.map((landmark) => [landmark.id, landmark.name]),
    );
    const regionNames = new Map(
      surfaceProfile.regions.map((region) => [region.id, region.name]),
    );
    const clusterLabels = new Map(
      surfaceProfile.contentClusters.map((cluster) => [
        cluster.index,
        cluster.label,
      ]),
    );
    return new Map(
      surfaceProfile.contentAnchors.map((anchor) => [
        anchor.entryId,
        {
          location:
            (anchor.landmarkId && landmarkNames.get(anchor.landmarkId)) ||
            (anchor.regionId && regionNames.get(anchor.regionId)) ||
            surfaceProfile.biome,
          cluster:
            clusterLabels.get(anchor.cluster) ?? surfaceProfile.biome,
          priority: anchor.priority,
        },
      ]),
    );
  }, [surfaceProfile]);
  const worldContentEntries = useMemo(() => {
    const entries = selectedPlanet?.content ?? [];
    if (!surfaceProfile) return entries;

    const rank = new Map(
      rankSurfaceContentAnchors(
        surfaceProfile.contentAnchors,
        surfaceFocusEntryId,
      ).map((anchor, index) => [anchor.entryId, index]),
    );
    return [...entries].sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );
  }, [selectedPlanet, surfaceFocusEntryId, surfaceProfile]);
  const visibleWorldContentEntries = useMemo(
    () =>
      phase === "surface" && surfaceProfile
        ? worldContentEntries.slice(
            0,
            SURFACE_CONTENT_SIGNAL_BUDGET.stable,
          )
        : worldContentEntries,
    [phase, surfaceProfile, worldContentEntries],
  );
  const handleSurfaceFocusEntry = useCallback(
    (entryId: string) => {
      if (phaseRef.current !== "surface") return;
      if (!selectedPlanet?.content?.some((entry) => entry.id === entryId)) {
        return;
      }
      setSurfaceLocalFocusEntryId((current) =>
        current === entryId ? null : entryId,
      );
    },
    [selectedPlanet],
  );
  const handleSurfaceFocusCluster = useCallback(
    (clusterIndex: number) => {
      if (phaseRef.current !== "surface" || !surfaceProfile) return;
      const focusedEntry =
        surfaceFocusedAnchor?.cluster === clusterIndex
          ? surfaceFocusEntryId
          : null;
      const nextEntryId = nextSurfaceClusterEntryId(
        surfaceProfile.contentAnchors,
        clusterIndex,
        focusedEntry,
      );
      if (!nextEntryId) return;
      if (
        !selectedPlanet?.content?.some((entry) => entry.id === nextEntryId)
      ) {
        return;
      }
      setSurfaceLocalFocusEntryId(nextEntryId);
    },
    [
      selectedPlanet,
      surfaceFocusEntryId,
      surfaceFocusedAnchor?.cluster,
      surfaceProfile,
    ],
  );
  const [collapsed, setCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [locale, setLocale] = useState<ProductLocale>("en");
  const [scrollDepth, setScrollDepth] = useState(0);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [navigationRequest, setNavigationRequest] =
    useState<UniverseNavigationCameraRequest | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<
    "locating" | "traveling" | "located" | "arrived" | null
  >(null);
  const [navigationFailure, setNavigationFailure] = useState<{
    request: UniverseNavigationCameraRequest;
    reason: string;
  } | null>(null);
  const [pendingDestinationId, setPendingDestinationId] = useState<string | null>(
    null,
  );
  const [pendingDestinationMode, setPendingDestinationMode] = useState<
    "locating" | "traveling" | null
  >(null);
  const [signalHover, setSignalHover] = useState<{
    title: string;
    kind: string;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [journey, setJourney] = useState<UniverseJourneyState | null>(null);
  const [cameraSettledPhase, setCameraSettledPhase] =
    useState<UniversePhase | null>(null);
  const cameraSettledPhaseRef = useRef<UniversePhase | null>(null);
  cameraSettledPhaseRef.current = cameraSettledPhase;
  const [worldScalePosition, setWorldScalePosition] =
    useState(GALAXY_SCALE_MIN);
  const worldScalePositionRef = useRef(GALAXY_SCALE_MIN);
  const worldScaleRenderFrameRef = useRef<number | null>(null);
  const pendingWorldScaleRenderPositionRef = useRef<number | null>(null);
  const worldScaleRenderCommitCountRef = useRef(0);
  const [worldScaleContinuous, setWorldScaleContinuous] = useState(false);
  const [galaxyScaleTarget, setGalaxyScaleTarget] =
    useState<UniverseNavigationDestination | null>(null);
  const galaxyScaleTargetRef =
    useRef<UniverseNavigationDestination | null>(null);
  galaxyScaleTargetRef.current = galaxyScaleTarget;
  const worldScalePlanetRef = useRef<string | null>(null);
  const [systemScaleTargetPlanet, setSystemScaleTargetPlanet] =
    useState<PlanetDefinition | null>(null);
  const navigationRequestSeq = useRef(0);
  const deepLinkHandledRef = useRef<string | null>(null);
  const openedWorldDestinationRef = useRef<string | null>(null);
  const journeyNavigationRef = useRef(false);
  const journeyRef = useRef<UniverseJourneyState | null>(null);
  const galaxyScaleFocusRef =
    useRef<UniverseNavigationDestination | null>(null);
  const systemScaleFocusRef = useRef<PlanetDefinition | null>(null);
  const lockedGalaxyScaleFocusRef =
    useRef<UniverseNavigationDestination | null>(null);
  const pinnedGalaxyScaleFocusRef =
    useRef<UniverseNavigationDestination | null>(null);
  const lockedSystemScaleFocusRef = useRef<PlanetDefinition | null>(null);
  const preferredSystemScaleDestinationRef =
    useRef<UniverseNavigationDestination | null>(null);
  const pendingScaleEnterSystemRef =
    useRef<UniverseNavigationDestination | null>(null);
  const galaxySoftFocusAvailableRef = useRef(true);
  const pendingWorldScaleStepsRef = useRef(0);
  const continuousScaleIntentEpochRef = useRef(0);
  const worldScaleBoundaryLockedRef = useRef(false);
  const worldScaleBoundaryUnlockFrameRef = useRef<number | null>(null);
  const scaleWheelRef = useRef<{
    accumulated: number;
    direction: ContinuousScaleDirection | null;
    lastAt: number;
    samples: number;
    gesture: number;
  }>({
    accumulated: 0,
    direction: null,
    lastAt: 0,
    samples: 0,
    gesture: 0,
  });

  const publishWorldScalePosition = useCallback(
    (position: number, immediate = false) => {
      // Camera authority is always this imperative coordinate. React receives
      // at most one mirror commit per RAF so diagnostics/semantic consumers
      // stay current without making wheel sample frequency drive renders.
      worldScalePositionRef.current = position;
      document.documentElement.dataset.universeScalePosition =
        position.toFixed(3);
      pendingWorldScaleRenderPositionRef.current = position;
      if (immediate) {
        if (worldScaleRenderFrameRef.current !== null) {
          window.cancelAnimationFrame(worldScaleRenderFrameRef.current);
          worldScaleRenderFrameRef.current = null;
        }
        pendingWorldScaleRenderPositionRef.current = null;
        setWorldScalePosition(position);
        return;
      }

      if (worldScaleRenderFrameRef.current !== null) return;
      worldScaleRenderFrameRef.current = window.requestAnimationFrame(() => {
        worldScaleRenderFrameRef.current = null;
        const pending = pendingWorldScaleRenderPositionRef.current;
        pendingWorldScaleRenderPositionRef.current = null;
        if (pending === null) return;
        setWorldScalePosition(pending);
      });
    },
    [],
  );

  useEffect(
    () => () => {
      if (worldScaleRenderFrameRef.current !== null) {
        window.cancelAnimationFrame(worldScaleRenderFrameRef.current);
        worldScaleRenderFrameRef.current = null;
      }
    },
    [],
  );

  const cancelPendingContinuousScaleIntent = useCallback(
    (
      reason: string,
      options: { preserveGalaxyScaleBridge?: boolean } = {},
    ) => {
      continuousScaleIntentEpochRef.current += 1;
      const queuedWorldSteps = pendingWorldScaleStepsRef.current;
      if (queuedWorldSteps !== 0) {
        document.documentElement.dataset.universeScaleCancelledQueue =
          "world:" +
          (queuedWorldSteps > 0 ? "+" : "") +
          String(queuedWorldSteps);
      }
      pendingWorldScaleStepsRef.current = 0;
      pendingScaleEnterSystemRef.current = null;
      lockedGalaxyScaleFocusRef.current = null;
      lockedSystemScaleFocusRef.current = null;
      if (!options.preserveGalaxyScaleBridge) {
        galaxyScaleTargetRef.current = null;
        setGalaxyScaleTarget(null);
        delete document.documentElement.dataset.universeGalaxyScaleTarget;
      }

      const wheel = scaleWheelRef.current;
      wheel.accumulated = 0;
      wheel.direction = null;
      wheel.lastAt = 0;
      wheel.samples = 0;
      wheel.gesture += 1;

      delete document.documentElement.dataset.universeScaleQueued;
      delete document.documentElement.dataset.universeScaleDirection;
      document.documentElement.dataset.universeScaleProgress = "0";
      document.documentElement.dataset.universeScaleSuperseded = reason;
    },
    [],
  );
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
  // Keep the server render and the browser's first hydration render identical.
  // Query-string rollback is applied by the effect below immediately after hydration.
  const [activeEngine, setActiveEngine] = useState<UniverseEngine>("yeis");
  const contentPlacements = useMemo(
    () => placeUniverseContent(contentEntries, galaxy.markers),
    [contentEntries, galaxy.markers],
  );
  const defaultGalaxyScaleFocus = useMemo(() => {
    // Opening soft focus is a product-tour fallback, not the centre-pick
    // ranking. Prefer the one world that currently owns the complete
    // Galaxy=0 -> Surface=5 path so a first-time visitor who simply scrolls
    // can experience the whole scale journey. Real centre focus still keeps
    // Personal Signals ahead of Hero, and Search/Places ranking is unchanged.
    const hero = galaxy.markers.find((marker) => marker.source === "hero");
    if (hero) {
      return navigationDestinationForMarker(hero, contentPlacements);
    }

    for (const placement of contentPlacements) {
      const destination = navigationDestinationForPlacement(
        placement,
        galaxy.markers,
      );
      if (destination) return destination;
    }

    const nativeStar = galaxy.markers.find(
      (marker) =>
        Boolean(marker.nativeId) &&
        marker.source === "catalog",
    );
    return nativeStar
      ? navigationDestinationForMarker(nativeStar, contentPlacements)
      : null;
  }, [contentPlacements, galaxy.markers]);
  const reducedMotion = useReducedMotion();
  const { ensurePlaying } = useAmbientAudio(muted, phase);
  const debugFreeze =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("freeze") === "1";
  const journeyDestinationSettled =
    phase === "galaxy"
      ? navigationStatus === "arrived" || navigationStatus === "located"
      : phase !== "returning" && cameraSettledPhase === phase;

  useEffect(() => {
    const detected = detectProductLocale();
    setLocale(detected);
    applyProductLocale(detected);
    document.documentElement.dataset.universeScaleSoftFocus = "available";
    return () => {
      delete document.documentElement.dataset.universeScaleSoftFocus;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.universeNavigationPhase = phase;
    document.documentElement.dataset.universeScaleIndex = String(
      scalePhaseIndex(phase),
    );
    return () => {
      delete document.documentElement.dataset.universeNavigationPhase;
      delete document.documentElement.dataset.universeScaleIndex;
    };
  }, [phase]);

  useEffect(() => {
    const anchor = scalePositionForPhase(phase);
    const planetId = selectedPlanet?.id ?? null;
    const planetChanged =
      isWorldScalePhase(phase) && worldScalePlanetRef.current !== planetId;
    worldScalePlanetRef.current = planetId;

    if (phase === "galaxy") {
      const position = worldScalePositionRef.current;
      const validGalaxyPosition =
        position >= GALAXY_SCALE_MIN - WORLD_SCALE_EPSILON &&
        position <= SYSTEM_SCALE_MIN + WORLD_SCALE_EPSILON;
      // A manual pointer takeover intentionally detaches the camera from the
      // captured native path while preserving the user's current scale. Only
      // an actively continuous bridge with no target is invalid; a frozen
      // partial coordinate is a valid takeover state and must not jump to 0.
      if (
        !validGalaxyPosition ||
        (!galaxyScaleTarget && position > 0 && worldScaleContinuous)
      ) {
        worldScalePositionRef.current = GALAXY_SCALE_MIN;
        setWorldScalePosition(GALAXY_SCALE_MIN);
        setWorldScaleContinuous(false);
      }
      return;
    }

    if (phase === "system") {
      const position = worldScalePositionRef.current;
      const validSystemPosition =
        position >= SYSTEM_SCALE_MIN - WORLD_SCALE_EPSILON &&
        position <= WORLD_SCALE_MIN + WORLD_SCALE_EPSILON;
      if (!validSystemPosition || (!systemScaleTargetPlanet && position > 1)) {
        worldScalePositionRef.current = SYSTEM_SCALE_MIN;
        setWorldScalePosition(SYSTEM_SCALE_MIN);
        setWorldScaleContinuous(false);
      }
      return;
    }

    if (anchor === null) {
      setWorldScaleContinuous(false);
      return;
    }

    if (
      planetChanged ||
      !worldScalePositionMatchesPhase(worldScalePositionRef.current, phase)
    ) {
      worldScalePositionRef.current = anchor;
      setWorldScalePosition(anchor);
      setWorldScaleContinuous(false);
    }
  }, [
    galaxyScaleTarget?.id,
    phase,
    selectedPlanet?.id,
    systemScaleTargetPlanet,
    worldScaleContinuous,
  ]);

  useEffect(() => {
    if (phase !== "system" && systemScaleTargetPlanet) {
      setSystemScaleTargetPlanet(null);
    }
  }, [phase, systemScaleTargetPlanet]);

  useEffect(() => {
    // Every scale publisher updates the imperative ref before React state.
    // Never mirror state back into the ref here: an older endpoint commit can
    // otherwise overwrite a newer high-frequency Galaxy reversal.
    worldScaleRenderCommitCountRef.current += 1;
    document.documentElement.dataset.universeScalePosition =
      worldScalePositionRef.current.toFixed(3);
    document.documentElement.dataset.universeScaleReactCommits = String(
      worldScaleRenderCommitCountRef.current,
    );
  }, [worldScalePosition]);

  useEffect(() => {
    const authority =
      phase === "galaxy"
        ? "galaxy"
        : phase === "system"
          ? "system"
          : phase === "surface"
            ? "surface"
            : isWorldScalePhase(phase)
              ? "world"
              : "transition";
    document.documentElement.dataset.universeRenderAuthority = authority;

    if (phase === "system" && worldScalePosition > SYSTEM_SCALE_MIN) {
      document.documentElement.dataset.universeHandoffState =
        "system:approach";
    } else if (
      (phase === "atmosphere" || phase === "surface") &&
      worldScalePosition > 4
    ) {
      document.documentElement.dataset.universeHandoffState =
        "atmosphere:surface";
    } else {
      document.documentElement.dataset.universeHandoffState = "stable";
    }
  }, [phase, worldScalePosition]);

  useEffect(
    () => () => {
      delete document.documentElement.dataset.universeScalePosition;
      delete document.documentElement.dataset.universeScaleReactCommits;
      delete document.documentElement.dataset.universeRenderAuthority;
      delete document.documentElement.dataset.universeHandoffState;
    },
    [],
  );

  useEffect(() => {
    if (!navigatorOpen) return;
    // Opening Search is a temporary higher-priority authority, not a new
    // spatial destination. Freeze a partial Galaxy scale bridge exactly where
    // it is so closing Search can resume the same 0↔1 path. Choosing a result
    // still clears the bridge through handleNavigateDestination.
    cancelPendingContinuousScaleIntent("navigator-open", {
      preserveGalaxyScaleBridge: true,
    });
  }, [cancelPendingContinuousScaleIntent, navigatorOpen]);

  const handleLocaleChange = useCallback((next: ProductLocale) => {
    setLocale(next);
    applyProductLocale(next);
  }, []);

  useEffect(() => {
    if (activeEngine !== "yeis") {
      setNavigatorOpen(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("navigator") === "1") {
      setNavigatorOpen(true);
    }

    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (editing) return;

      const commandK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
      const slash = event.key === "/";

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
    const requestedBody = params.get("body")?.trim().toLowerCase();
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
    selectedSystemRef.current = system;
    setSelectedSystem(system);

    if (requestedPhase === "system" || requestedPhase === "returning") {
      setSelectedPlanet(null);
      setPhase(requestedPhase);
      return;
    }

    const exactRequestedPlanet = requestedBody
      ? system.planets.find((planet) => {
          const id = planet.id.toLowerCase();
          return (
            id === requestedBody ||
            id === "yeis-planet:" + requestedBody ||
            nativePlanetId(planet).toLowerCase() === requestedBody
          );
        })
      : undefined;

    const selected =
      exactRequestedPlanet ??
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
      cancelPendingContinuousScaleIntent("select-system");
      journeyNavigationRef.current = false;
      journeyRef.current = null;
      setJourney(null);
      delete document.documentElement.dataset.universeJourney;
      delete document.documentElement.dataset.universeJourneyComplete;
      const system = resolveMarker(marker);
      const destination = navigationDestinationForMarker(
        marker,
        contentPlacements,
      );
      selectedSystemRef.current = system;
      setSelectedSystem(system);
      setSelectedPlanet(null);
      setScrollDepth(0);
      setNavigationRequest(null);
      setNavigationStatus(null);
      setActiveDestinationId(destination.id);
      document.documentElement.dataset.universeActiveDestination =
        destination.id;
      ensurePlaying();
      setPhase("system");
      replaceNavigationUrl({
        phase: "system",
        starId: marker.nativeId ?? null,
        bodyId: null,
        destinationId: destination.id,
        navigationMode: "open",
      });
    },
    [
      cancelPendingContinuousScaleIntent,
      contentPlacements,
      ensurePlaying,
      resolveMarker,
    ],
  );

  const handleNavigateDestination = useCallback(
    async (
      destination: UniverseNavigationDestination,
      options: { preserveGalaxyScaleBridge?: boolean } = {},
    ) => {
      cancelPendingContinuousScaleIntent("navigate-destination", options);
      const journeyDriven = journeyNavigationRef.current;
      journeyNavigationRef.current = false;
      if (!journeyDriven) {
        journeyRef.current = null;
        setJourney(null);
        delete document.documentElement.dataset.universeJourney;
        delete document.documentElement.dataset.universeJourneyComplete;
      }
      if (activeEngine !== "yeis") return;
      setCameraSettledPhase(null);
      setNavigationFailure(null);
      delete document.documentElement.dataset.universeNavigationError;
      openedWorldDestinationRef.current = null;

      const spatial =
        destination.target.kind === "galaxy" ||
        destination.target.kind === "landmark" ||
        destination.target.kind === "blackhole";

      setPendingDestinationId(null);
      setPendingDestinationMode(null);
      delete document.documentElement.dataset.universePendingDestination;

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
            selectedSystemRef.current = null;
            setSelectedSystem(null);
            setSelectedPlanet(null);
            setPhase("galaxy");
            deepLinkHandledRef.current = deepLinkNavigationKey(
              destination.id,
              "open",
              "galaxy",
            );
            replaceNavigationUrl({
              phase: "galaxy",
              destinationId: destination.id,
              navigationMode: "open",
            });
            setActiveDestinationId(null);
            delete document.documentElement.dataset.universeActiveDestination;
            setPendingDestinationId(destination.id);
            setPendingDestinationMode("traveling");
            document.documentElement.dataset.universePendingDestination =
              destination.id;
            setNavigationRequest({
              requestId: navigationRequestSeq.current,
              destinationId: destination.id,
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
        setActiveDestinationId(destination.id);
        document.documentElement.dataset.universeActiveDestination =
          destination.id;
        selectedSystemRef.current = system;
        setSelectedSystem(system);
        setSelectedPlanet(planet);
        openedWorldDestinationRef.current = planet ? destination.id : null;
        setScrollDepth(0);
        delete document.documentElement.dataset.universeLocated;
        ensurePlaying();
        const nextPhase: UniversePhase = planet ? "approach" : "system";
        setPhase(nextPhase);

        const destinationStarId =
          destination.target.kind === "star"
            ? destination.target.nativeId
            : destination.target.kind === "body"
              ? destination.target.starId
              : destination.target.kind === "content"
                ? destination.target.nativeId
                : marker.nativeId ?? null;
        const destinationBodyId =
          planet && destination.target.kind === "body"
            ? destination.target.bodyId
            : planet
              ? nativePlanetId(planet)
              : null;
        deepLinkHandledRef.current = deepLinkNavigationKey(
          destination.id,
          "open",
          nextPhase,
        );
        replaceNavigationUrl({
          phase: nextPhase,
          starId: destinationStarId,
          bodyId: destinationBodyId,
          destinationId: destination.id,
          navigationMode: "open",
        });

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
      selectedSystemRef.current = null;
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("galaxy");
      deepLinkHandledRef.current = deepLinkNavigationKey(
        destination.id,
        "open",
        "galaxy",
      );
      replaceNavigationUrl({
        phase: "galaxy",
        destinationId: destination.id,
        navigationMode: "open",
      });
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      setPendingDestinationId(destination.id);
      setPendingDestinationMode("traveling");
      document.documentElement.dataset.universePendingDestination =
        destination.id;
      setNavigationRequest({
        requestId: navigationRequestSeq.current,
        destinationId: destination.id,
        mode: "travel",
        target: cameraTarget,
        title: destination.title,
      });
      setNavigationStatus("traveling");
      const spatialTarget = cameraTargetLabel(cameraTarget);
      document.documentElement.dataset.universeNavigationTarget =
        spatialTarget;
      document.documentElement.dataset.universeNavigationPhase = "galaxy";
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
      cancelPendingContinuousScaleIntent,
      ensurePlaying,
      galaxy.markers,
      resolveMarker,
    ],
  );

  const handleLocateDestination = useCallback(
    async (destination: UniverseNavigationDestination) => {
      cancelPendingContinuousScaleIntent("locate-destination");
      journeyNavigationRef.current = false;
      journeyRef.current = null;
      setJourney(null);
      delete document.documentElement.dataset.universeJourney;
      delete document.documentElement.dataset.universeJourneyComplete;
      if (activeEngine !== "yeis") return;
      setCameraSettledPhase(null);
      setNavigationFailure(null);
      delete document.documentElement.dataset.universeNavigationError;
      const cameraTarget = navigationCameraTarget(destination, galaxy.markers);
      if (!cameraTarget) {
        await handleNavigateDestination(destination);
        return;
      }

      navigationRequestSeq.current += 1;
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      setPendingDestinationId(destination.id);
      setPendingDestinationMode("locating");
      document.documentElement.dataset.universePendingDestination =
        destination.id;
      selectedSystemRef.current = null;
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("galaxy");
      deepLinkHandledRef.current = deepLinkNavigationKey(
        destination.id,
        "locate",
        "galaxy",
      );
      replaceNavigationUrl({
        phase: "galaxy",
        destinationId: destination.id,
        navigationMode: "locate",
      });
      setNavigationRequest({
        requestId: navigationRequestSeq.current,
        destinationId: destination.id,
        mode: "locate",
        target: cameraTarget,
        title: destination.title,
      });
      setNavigationStatus("locating");
      const target = cameraTargetLabel(cameraTarget);
      document.documentElement.dataset.universeNavigationTarget = target;
      document.documentElement.dataset.universeNavigationPhase = "galaxy";
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
      cancelPendingContinuousScaleIntent,
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
      cancelPendingContinuousScaleIntent("start-journey");
      const next: UniverseJourneyState = {
        title,
        destinations,
        index: 0,
        paused: false,
        completed: false,
      };
      delete document.documentElement.dataset.universeJourneyComplete;
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
    [cancelPendingContinuousScaleIntent, handleNavigateDestination],
  );

  const handleJourneyStep = useCallback(
    (delta: number) => {
      const current = journeyRef.current;
      if (!current) return;
      const nextIndex = current.index + delta;
      if (nextIndex < 0) return;
      if (nextIndex >= current.destinations.length) {
        const completed = { ...current, paused: true, completed: true };
        journeyRef.current = completed;
        setJourney(completed);
        document.documentElement.dataset.universeJourneyComplete =
          current.title;
        console.info("[UNIVERSE-JOURNEY] complete " + current.title);
        return;
      }

      const next = { ...current, index: nextIndex, completed: false };
      delete document.documentElement.dataset.universeJourneyComplete;
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
    if (current.completed) return;
    const next = { ...current, paused: !current.paused };
    journeyRef.current = next;
    setJourney(next);
  }, []);

  const handleStopJourney = useCallback(() => {
    journeyNavigationRef.current = false;
    journeyRef.current = null;
    setJourney(null);
    delete document.documentElement.dataset.universeJourney;
    delete document.documentElement.dataset.universeJourneyComplete;
  }, []);

  const handleCinematicUserControlStart = useCallback(() => {
    cancelPendingContinuousScaleIntent("manual-camera");
    cameraSettledPhaseRef.current = null;
    setCameraSettledPhase(null);
    if (!journeyRef.current) return;
    handleStopJourney();
    console.info("[UNIVERSE-JOURNEY] interrupted by manual camera control");
  }, [cancelPendingContinuousScaleIntent, handleStopJourney]);

  const handleContinuousScaleIntentStart = useCallback(() => {
    if (!journeyRef.current) return;
    handleStopJourney();
    console.info("[UNIVERSE-JOURNEY] interrupted by manual scale intent");
  }, [handleStopJourney]);

  const handleGalaxyScaleFocus = useCallback(
    (destination: UniverseNavigationDestination | null) => {
      if (pinnedGalaxyScaleFocusRef.current) return;
      galaxyScaleFocusRef.current = destination;
      if (destination) {
        document.documentElement.dataset.universeScaleFocus = destination.id;
        document.documentElement.dataset.universeScaleFocusLayer = "galaxy";
      } else if (
        document.documentElement.dataset.universeScaleFocusLayer === "galaxy"
      ) {
        delete document.documentElement.dataset.universeScaleFocus;
        delete document.documentElement.dataset.universeScaleFocusLayer;
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    if (phase !== "galaxy" || !activeDestinationId) {
      pinnedGalaxyScaleFocusRef.current = null;
      return;
    }

    void resolveUniverseNavigationDestination(
      activeDestinationId,
      contentPlacements,
      galaxy.markers,
    ).then((destination) => {
      if (cancelled || !destination) return;
      pinnedGalaxyScaleFocusRef.current = destination;
      galaxyScaleFocusRef.current = destination;
      document.documentElement.dataset.universeScaleFocus = destination.id;
      document.documentElement.dataset.universeScaleFocusLayer = "galaxy";
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeDestinationId,
    contentPlacements,
    galaxy.markers,
    phase,
  ]);

  const handleGalaxyScaleManualTakeover = useCallback(() => {
    galaxySoftFocusAvailableRef.current = false;
    document.documentElement.dataset.universeScaleSoftFocus = "disabled";
    if (phaseRef.current !== "galaxy") return;

    const frozenPosition = Math.min(
      SYSTEM_SCALE_MIN,
      Math.max(GALAXY_SCALE_MIN, worldScalePositionRef.current),
    );
    // Pointer authority must supersede the same coordinator-owned intent as
    // Search/Journey takeovers. Reuse the central cancellation path so stale
    // native completion, queued wheel state, and diagnostics cannot survive.
    cancelPendingContinuousScaleIntent("manual-camera");
    worldScalePositionRef.current = frozenPosition;
    setWorldScalePosition(frozenPosition);
    setWorldScaleContinuous(false);
    document.documentElement.dataset.universeScalePosition =
      frozenPosition.toFixed(3);
    document.documentElement.dataset.universeScaleProgress =
      galaxyScaleSegmentProgress(frozenPosition).toFixed(3);
    document.documentElement.dataset.universeGalaxyScaleBridge =
      "manual-frozen";
    // Keep the explicit takeover diagnostic published by main in addition to
    // the coordinator cancellation above. This is intentionally redundant for
    // cleanup, but makes the winning pointer authority observable immediately.
    document.documentElement.dataset.universeScaleSuperseded =
      "manual-camera";
    delete document.documentElement.dataset.universeGalaxyScaleTarget;
    delete document.documentElement.dataset.universeScaleQueued;
  }, [cancelPendingContinuousScaleIntent]);

  const handleSystemScaleFocus = useCallback(
    (planet: PlanetDefinition | null) => {
      systemScaleFocusRef.current = planet;
      if (preferredSystemScaleDestinationRef.current) return;
      if (planet) {
        document.documentElement.dataset.universeScaleFocus =
          "planet:" + planet.id;
        document.documentElement.dataset.universeScaleFocusLayer = "system";
      } else if (
        document.documentElement.dataset.universeScaleFocusLayer === "system"
      ) {
        delete document.documentElement.dataset.universeScaleFocus;
        delete document.documentElement.dataset.universeScaleFocusLayer;
      }
    },
    [],
  );

  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  useEffect(() => {
    if (
      !journey ||
      journey.paused ||
      journey.completed ||
      navigatorOpen ||
      reducedMotion ||
      navigationStatus === "traveling" ||
      navigationStatus === "locating" ||
      navigationFailure !== null ||
      !journeyDestinationSettled
    ) {
      return;
    }

    // Reuse the pinned MIT TourPlayer's core sequencing idea without its
    // narration/cue state machine: only advance after navigation has settled,
    // then give the visitor an intentional dwell at the destination.
    const timer = window.setTimeout(() => {
      handleJourneyStep(1);
    }, 6500);
    return () => window.clearTimeout(timer);
  }, [
    handleJourneyStep,
    journey,
    journeyDestinationSettled,
    navigationFailure,
    navigationStatus,
    navigatorOpen,
    phase,
    reducedMotion,
  ]);

  useEffect(() => {
    if (activeEngine !== "yeis" || !yeisResolverRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const destinationId = params.get("destination")?.trim();
    if (!destinationId) {
      deepLinkHandledRef.current = null;
      return;
    }

    const mode = params.get("navigation") === "locate" ? "locate" : "open";
    const requestedPhase = params.get("phase") as UniversePhase | null;
    const restorableWorldPhase =
      requestedPhase &&
      ["approach", "orbit", "atmosphere", "surface"].includes(requestedPhase)
        ? requestedPhase
        : null;
    const key = deepLinkNavigationKey(
      destinationId,
      mode,
      restorableWorldPhase,
    );
    if (deepLinkHandledRef.current === key) return;
    deepLinkHandledRef.current = key;

    let cancelled = false;
    void resolveUniverseNavigationDestination(
      destinationId,
      contentPlacements,
      galaxy.markers,
    )
      .then(async (destination) => {
        if (cancelled) return;
        if (!destination) {
          deepLinkHandledRef.current = null;
          document.documentElement.dataset.universeDeepLink = "unresolved";
          return;
        }
        document.documentElement.dataset.universeDeepLink = destination.id;

        if (mode === "locate") {
          await handleLocateDestination(destination);
          return;
        }

        await handleNavigateDestination(destination);
        if (
          cancelled ||
          !restorableWorldPhase ||
          openedWorldDestinationRef.current !== destination.id
        ) {
          return;
        }

        setPhase(restorableWorldPhase);
        document.documentElement.dataset.universeNavigationPhase =
          restorableWorldPhase;
        replaceNavigationUrl({
          phase: restorableWorldPhase,
        });
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

  const handleNavigationFailed = useCallback(
    (
      request: UniverseNavigationCameraRequest,
      reason: string,
    ) => {
      cancelPendingContinuousScaleIntent("navigation-failed");
      setNavigationStatus(null);
      setNavigationRequest(null);
      setPendingDestinationId(null);
      setPendingDestinationMode(null);
      delete document.documentElement.dataset.universePendingDestination;
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      setNavigationFailure({ request, reason });
      document.documentElement.dataset.universeNavigationError =
        cameraTargetLabel(request.target);
      console.error(
        "[UNIVERSE-NAV] failed " +
          cameraTargetLabel(request.target) +
          " · " +
          reason,
      );
    },
    [cancelPendingContinuousScaleIntent],
  );

  const handleNavigationComplete = useCallback(
    (request: UniverseNavigationCameraRequest) => {
      delete document.documentElement.dataset.universeNavigationError;
      setNavigationFailure(null);
      setPendingDestinationId(null);
      setPendingDestinationMode(null);
      delete document.documentElement.dataset.universePendingDestination;
      setActiveDestinationId(request.destinationId);
      document.documentElement.dataset.universeActiveDestination =
        request.destinationId;
      setNavigationStatus(
        request.mode === "travel" ? "arrived" : "located",
      );
    },
    [],
  );

  const handleRetryNavigation = useCallback(() => {
    if (!navigationFailure) return;
    navigationRequestSeq.current += 1;
    const request: UniverseNavigationCameraRequest = {
      ...navigationFailure.request,
      requestId: navigationRequestSeq.current,
    };
    setNavigationFailure(null);
    setPendingDestinationId(request.destinationId);
    setPendingDestinationMode(
      request.mode === "travel" ? "traveling" : "locating",
    );
    document.documentElement.dataset.universePendingDestination =
      request.destinationId;
    setNavigationRequest(request);
    setNavigationStatus(
      request.mode === "travel" ? "traveling" : "locating",
    );
    delete document.documentElement.dataset.universeNavigationError;
    document.documentElement.dataset.universeNavigationTarget =
      cameraTargetLabel(request.target);
    document.documentElement.dataset.universeNavigationPhase = "galaxy";
    console.info(
      "[UNIVERSE-NAV] retry " +
        request.title +
        " -> " +
        cameraTargetLabel(request.target),
    );
  }, [navigationFailure]);

  const handleDismissNavigationFailure = useCallback(() => {
    setNavigationFailure(null);
    delete document.documentElement.dataset.universeNavigationError;
  }, []);

  const handleSelectPlanet = useCallback(
    (planet: PlanetDefinition) => {
      cancelPendingContinuousScaleIntent("select-planet");
      if (activeEngine === "yeis" && selectedSystem) {
        const destination = navigationDestinationForPlanet(
          selectedSystem,
          planet,
          galaxy.markers,
          contentPlacements,
        );
        if (destination) {
          void handleNavigateDestination(destination);
          return;
        }
      }

      journeyNavigationRef.current = false;
      journeyRef.current = null;
      setJourney(null);
      setCameraSettledPhase(null);
      setSelectedPlanet(planet);
      ensurePlaying();
      setPhase("approach");
    },
    [
      activeEngine,
      cancelPendingContinuousScaleIntent,
      contentPlacements,
      ensurePlaying,
      galaxy.markers,
      handleNavigateDestination,
      selectedSystem,
    ],
  );

  const handleCinematicPhaseComplete = useCallback(
    (completed: UniversePhase) => {
      if (phaseRef.current !== completed) return;
      cameraSettledPhaseRef.current = completed;
      setCameraSettledPhase(completed);
      document.documentElement.dataset.universeScaleSettled = completed;
      if (debugFreeze || completed !== "returning") return;

      // The v2 rollback path still uses the legacy returning shot. Product
      // world phases no longer auto-chain: wheel scale owns advancement.
      phaseRef.current = "galaxy";
      cameraSettledPhaseRef.current = null;
      setPhase("galaxy");
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      document.documentElement.dataset.universeNavigationPhase = "galaxy";
      delete document.documentElement.dataset.universeNavigationTarget;
      replaceNavigationUrl({
        phase: "galaxy",
        destinationId: null,
        navigationMode: null,
      });
    },
    [debugFreeze, phase],
  );

  const handleReturn = useCallback(() => {
    cancelPendingContinuousScaleIntent("return");
    cameraSettledPhaseRef.current = null;
    setCameraSettledPhase(null);
    journeyNavigationRef.current = false;
    journeyRef.current = null;
    setJourney(null);
    delete document.documentElement.dataset.universeJourney;
    delete document.documentElement.dataset.universeJourneyComplete;

    if (phase === "system") {
      selectedSystemRef.current = null;
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      delete document.documentElement.dataset.universeNavigationTarget;
      const nextPhase = activeEngine === "yeis" ? "galaxy" : "returning";
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
      if (activeEngine === "yeis") {
        document.documentElement.dataset.universeNavigationPhase = "galaxy";
        replaceNavigationUrl({
          phase: "galaxy",
          destinationId: null,
          navigationMode: null,
        });
      }
      return;
    }

    if (phase === "returning") return;

    setSelectedPlanet(null);
    if (selectedSystem) {
      const starId = routeStarIdentityForSystem(selectedSystem, galaxy.markers);
      phaseRef.current = "system";
      setPhase("system");
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      document.documentElement.dataset.universeNavigationPhase = "system";

      if (starId) {
        document.documentElement.dataset.universeNavigationTarget = starId;
        replaceNavigationUrl({
          phase: "system",
          starId,
          bodyId: null,
          destinationId: null,
          navigationMode: null,
        });
      } else {
        delete document.documentElement.dataset.universeNavigationTarget;
        replaceNavigationUrl({
          phase: "system",
          starId: null,
          bodyId: null,
          destinationId: null,
          navigationMode: null,
        });
      }
    } else {
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      delete document.documentElement.dataset.universeNavigationTarget;
      document.documentElement.dataset.universeNavigationPhase = "galaxy";
      phaseRef.current = "galaxy";
      setPhase("galaxy");
      replaceNavigationUrl({
        phase: "galaxy",
        destinationId: null,
        navigationMode: null,
      });
    }
  }, [
    activeEngine,
    cancelPendingContinuousScaleIntent,
    galaxy.markers,
    phase,
    selectedSystem,
  ]);

  useEffect(() => {
    if (phase !== "system" || !selectedSystem) return;
    const preferred = preferredSystemScaleDestinationRef.current;
    if (!preferred) return;

    let planet: PlanetDefinition | null = null;
    if (preferred.target.kind === "body") {
      planet =
        selectedSystem.planets.find(
          (candidate) =>
            candidate.id === preferred.target.bodyId ||
            nativePlanetId(candidate) === preferred.target.bodyId,
        ) ?? null;
    } else if (preferred.target.kind === "observed-body") {
      planet =
        selectedSystem.planets.find(
          (candidate) =>
            candidate.id === preferred.target.bodyId ||
            nativePlanetId(candidate) === preferred.target.bodyId,
        ) ?? null;
    } else if (preferred.target.kind === "content") {
      planet =
        selectedSystem.planets.find((candidate) =>
          candidate.content?.some(
            (entry) => entry.id === preferred.target.entryId,
          ),
        ) ?? null;
    }

    if (!planet) return;
    document.documentElement.dataset.universeScaleFocus =
      "planet:" + planet.id;
    document.documentElement.dataset.universeScaleFocusLayer = "system";
    document.documentElement.dataset.universeScalePreferred =
      preferred.id;
  }, [phase, selectedSystem]);

  const setWorldScalePhase = useCallback(
    (
      nextPhase: UniversePhase,
      options: { preserveWorldScalePosition?: boolean } = {},
    ) => {
      phaseRef.current = nextPhase;
      const nextScalePosition = scalePositionForPhase(nextPhase);
      if (!options.preserveWorldScalePosition) {
        if (nextScalePosition === null) {
          setWorldScaleContinuous(false);
        } else {
          worldScalePositionRef.current = nextScalePosition;
          setWorldScalePosition(nextScalePosition);
          setWorldScaleContinuous(false);
        }
      }
      worldScaleBoundaryLockedRef.current = true;
      if (worldScaleBoundaryUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(worldScaleBoundaryUnlockFrameRef.current);
      }
      worldScaleBoundaryUnlockFrameRef.current = window.requestAnimationFrame(
        () => {
          worldScaleBoundaryLockedRef.current = false;
          worldScaleBoundaryUnlockFrameRef.current = null;
        },
      );
      cameraSettledPhaseRef.current = null;
      setCameraSettledPhase(null);
      // The navigation coordinator owns invalidation of the previous phase's
      // settlement synchronously. CinematicCamera remains the only authority
      // allowed to publish the next settled phase.
      delete document.documentElement.dataset.universeCameraSettled;
      delete document.documentElement.dataset.universeScaleSettled;
      setPhase(nextPhase);
      document.documentElement.dataset.universeNavigationPhase = nextPhase;
      document.documentElement.dataset.universeScaleIndex = String(
        scalePhaseIndex(nextPhase),
      );

      const starId = selectedSystem
        ? routeStarIdentityForSystem(selectedSystem, galaxy.markers)
        : null;

      if (nextPhase === "system") {
        setSelectedPlanet(null);
        setActiveDestinationId(null);
        delete document.documentElement.dataset.universeActiveDestination;
        if (starId) {
          document.documentElement.dataset.universeNavigationTarget = starId;
        }
        replaceNavigationUrl({
          phase: "system",
          starId,
          bodyId: null,
          destinationId: null,
          navigationMode: null,
        });
        return;
      }

      if (starId && selectedPlanet) {
        replaceNavigationUrl({
          phase: nextPhase,
          starId,
          bodyId: nativePlanetId(selectedPlanet),
        });
      }
    },
    [galaxy.markers, selectedPlanet, selectedSystem],
  );

  useEffect(() => {
    if (
      pendingWorldScaleStepsRef.current === 0 ||
      cameraSettledPhase !== phase ||
      !selectedPlanet ||
      phase === "galaxy" ||
      phase === "system" ||
      phase === "returning"
    ) {
      return;
    }

    const queued = pendingWorldScaleStepsRef.current;
    const direction: ContinuousScaleDirection = queued > 0 ? "in" : "out";
    const nextPhase = nextWorldScalePhase(
      phase,
      direction,
      selectedPlanet.surfaceMode,
    );

    if (!nextPhase) {
      pendingWorldScaleStepsRef.current = 0;
      delete document.documentElement.dataset.universeScaleQueued;
      document.documentElement.dataset.universeScaleBlocked =
        direction === "in" && phase !== "surface"
          ? "no-surface"
          : direction === "in"
            ? "surface-limit"
            : "system-limit";
      return;
    }

    pendingWorldScaleStepsRef.current += direction === "in" ? -1 : 1;
    const remaining = pendingWorldScaleStepsRef.current;
    if (remaining === 0) {
      delete document.documentElement.dataset.universeScaleQueued;
    } else {
      document.documentElement.dataset.universeScaleQueued =
        "world:" + (remaining > 0 ? "+" : "") + String(remaining);
    }

    const sourcePhase = phase;
    const intentEpoch = continuousScaleIntentEpochRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (
        continuousScaleIntentEpochRef.current !== intentEpoch ||
        phaseRef.current !== sourcePhase
      ) {
        return;
      }
      setWorldScalePhase(nextPhase);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    cameraSettledPhase,
    phase,
    selectedPlanet,
    setWorldScalePhase,
  ]);

  useEffect(() => {
    if (phase !== "system" || pendingWorldScaleStepsRef.current >= 0) return;

    pendingWorldScaleStepsRef.current += 1;
    const remaining = pendingWorldScaleStepsRef.current;
    if (remaining === 0) {
      delete document.documentElement.dataset.universeScaleQueued;
    } else {
      document.documentElement.dataset.universeScaleQueued =
        "world:" + String(remaining);
    }

    const intentEpoch = continuousScaleIntentEpochRef.current;
    const frame = window.requestAnimationFrame(() => {
      if (
        continuousScaleIntentEpochRef.current !== intentEpoch ||
        phaseRef.current !== "system"
      ) {
        return;
      }
      handleReturn();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [handleReturn, phase]);

  const beginGalaxyScaleTravel = useCallback(
    (destination: UniverseNavigationDestination) => {
      const resolvedCameraTarget = navigationCameraTarget(
        destination,
        galaxy.markers,
      );
      // Scale travel enters the owning stellar system, never the exact body.
      // Exact body travel remains available to Search/Places/click navigation.
      const cameraTarget =
        resolvedCameraTarget?.kind === "body"
          ? {
              kind: "star" as const,
              nativeId: resolvedCameraTarget.starId,
            }
          : resolvedCameraTarget;
      if (!cameraTarget) {
        void handleNavigateDestination(destination);
        return;
      }

      navigationRequestSeq.current += 1;
      setCameraSettledPhase(null);
      setNavigationFailure(null);
      delete document.documentElement.dataset.universeNavigationError;
      selectedSystemRef.current = null;
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("galaxy");
      setActiveDestinationId(null);
      delete document.documentElement.dataset.universeActiveDestination;
      setPendingDestinationId(destination.id);
      setPendingDestinationMode("traveling");
      document.documentElement.dataset.universePendingDestination =
        destination.id;
      setNavigationRequest({
        requestId: navigationRequestSeq.current,
        destinationId: destination.id,
        mode: "travel",
        target: cameraTarget,
        title: destination.title,
      });
      setNavigationStatus("traveling");
      document.documentElement.dataset.universeNavigationTarget =
        cameraTargetLabel(cameraTarget);
      document.documentElement.dataset.universeNavigationPhase = "galaxy";
      document.documentElement.dataset.universeScaleMode = "travel";
      deepLinkHandledRef.current = deepLinkNavigationKey(
        destination.id,
        "open",
        "galaxy",
      );
      replaceNavigationUrl({
        phase: "galaxy",
        destinationId: destination.id,
        navigationMode: "open",
      });
      console.info(
        "[UNIVERSE-SCALE] travel " +
          destination.title +
          " -> " +
          cameraTargetLabel(cameraTarget),
      );
    },
    [galaxy.markers, handleNavigateDestination],
  );

  const enterScaleFocusedSystem = useCallback(
    async (focus: UniverseNavigationDestination) => {
      preferredSystemScaleDestinationRef.current = focus;
      const marker = await navigationMarker(focus, galaxy.markers);
      await handleNavigateDestination(scaleSystemDestinationForMarker(marker));
    },
    [galaxy.markers, handleNavigateDestination],
  );

  const commitGalaxyScaleFocusedSystem = useCallback(
    async (focus: UniverseNavigationDestination) => {
      const marker = await navigationMarker(focus, galaxy.markers);
      if (
        phaseRef.current !== "galaxy" ||
        galaxyScaleTargetRef.current?.id !== focus.id ||
        worldScalePositionRef.current <
          SYSTEM_SCALE_MIN - WORLD_SCALE_EPSILON
      ) {
        return;
      }

      const system = resolveMarker(marker);
      const systemDestination = scaleSystemDestinationForMarker(marker);
      preferredSystemScaleDestinationRef.current = focus;
      selectedSystemRef.current = system;
      setSelectedSystem(system);
      setSelectedPlanet(null);
      setSystemScaleTargetPlanet(null);
      setScrollDepth(0);
      setNavigationRequest(null);
      setNavigationStatus("arrived");
      setPendingDestinationId(null);
      setPendingDestinationMode(null);
      delete document.documentElement.dataset.universePendingDestination;
      setActiveDestinationId(systemDestination.id);
      document.documentElement.dataset.universeActiveDestination =
        systemDestination.id;
      ensurePlaying();

      phaseRef.current = "system";
      setPhase("system");
      setWorldScaleContinuous(true);
      worldScalePositionRef.current = SYSTEM_SCALE_MIN;
      setWorldScalePosition(SYSTEM_SCALE_MIN);
      document.documentElement.dataset.universeScalePosition =
        SYSTEM_SCALE_MIN.toFixed(3);
      document.documentElement.dataset.universeScaleProgress = "0";
      document.documentElement.dataset.universeScaleIndex =
        String(scalePhaseIndex("system"));
      document.documentElement.dataset.universeNavigationPhase = "system";
      document.documentElement.dataset.universeNavigationTarget =
        marker.nativeId ?? marker.id;
      document.documentElement.dataset.universeGalaxyScaleBridge =
        "system-endpoint";

      replaceNavigationUrl({
        phase: "system",
        starId: marker.nativeId ?? marker.id,
        bodyId: null,
        destinationId: systemDestination.id,
        navigationMode: "open",
      });
    },
    [ensurePlaying, galaxy.markers, resolveMarker],
  );

  useEffect(() => {
    const queued = pendingScaleEnterSystemRef.current;
    if (!queued || phase !== "galaxy") return;
    if (activeDestinationId !== queued.id) return;
    if (pendingDestinationId === queued.id) return;

    pendingScaleEnterSystemRef.current = null;
    delete document.documentElement.dataset.universeScaleQueued;
    void enterScaleFocusedSystem(queued);
  }, [
    activeDestinationId,
    enterScaleFocusedSystem,
    pendingDestinationId,
    phase,
  ]);

  const handleContinuousScaleWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (navigatorOpen || navigationFailure) return;

      const currentPhase = phaseRef.current;
      if (activeEngine !== "yeis") {
        if (currentPhase === "galaxy") {
          setScrollDepth((value) =>
            Math.max(
              -3.5,
              Math.min(4.5, value + Math.sign(event.deltaY) * 0.42),
            ),
          );
        }
        return;
      }

      const normalizedDelta = normalizeWheelDelta(
        event.deltaY,
        event.deltaMode,
        window.innerHeight,
      );
      const direction = continuousScaleDirection(normalizedDelta);
      if (!direction) return;
      const settledPhase = cameraSettledPhaseRef.current;

      const now = performance.now();
      const wheel = scaleWheelRef.current;
      const previousDirection = wheel.direction;
      const directionChanged =
        previousDirection !== null && previousDirection !== direction;
      const resetWindow =
        wheel.samples >= 2
          ? CONTINUOUS_SCALE_ACTIVE_RESET_MS
          : CONTINUOUS_SCALE_RESET_MS;
      const gestureExpired =
        wheel.direction !== null && now - wheel.lastAt > resetWindow;
      if (wheel.direction === null || directionChanged || gestureExpired) {
        wheel.gesture += 1;
        wheel.accumulated = 0;
        wheel.samples = 0;
        wheel.direction = direction;
        if (directionChanged) {
          continuousScaleIntentEpochRef.current += 1;
          pendingWorldScaleStepsRef.current = 0;
          delete document.documentElement.dataset.universeScaleQueued;
          document.documentElement.dataset.universeScaleReversal = String(
            wheel.gesture,
          );
        }
      }
      wheel.lastAt = now;
      wheel.samples = Math.min(255, wheel.samples + 1);
      document.documentElement.dataset.universeScaleGesture = String(
        wheel.gesture,
      );
      document.documentElement.dataset.universeScaleInput =
        event.deltaMode === 1
          ? "line"
          : event.deltaMode === 2
            ? "page"
            : "pixel";
      document.documentElement.dataset.universeScaleDelta =
        normalizedDelta.toFixed(3);
      const responseSourcePosition = worldScalePositionRef.current;
      const responseDelta = continuousScaleInputResponseDelta(
        responseSourcePosition,
        normalizedDelta,
      );
      document.documentElement.dataset.universeScaleResponse =
        responseDelta.toFixed(4);
      document.documentElement.dataset.universeScaleResponseDistance =
        continuousScaleResponseDistance(responseSourcePosition).toFixed(2);

      // Manual scale intent owns navigation immediately, even before a small
      // trackpad delta crosses the currentPhase threshold. This stops Journey
      // auto-advance without clearing the current camera-settled contract.
      handleContinuousScaleIntentStart();
      delete document.documentElement.dataset.universeScaleCancelledQueue;

      if (currentPhase === "galaxy") {
        const currentPosition = Math.min(
          SYSTEM_SCALE_MIN,
          Math.max(GALAXY_SCALE_MIN, worldScalePositionRef.current),
        );

        if (
          direction === "out" &&
          currentPosition <= GALAXY_SCALE_MIN + WORLD_SCALE_EPSILON
        ) {
          galaxyScaleTargetRef.current = null;
          setGalaxyScaleTarget(null);
          setWorldScaleContinuous(false);
          delete document.documentElement.dataset.universeGalaxyScaleTarget;
          delete document.documentElement.dataset.universeGalaxyScaleBridge;
          // Fall through to retained native outward Galaxy travel.
        } else {
          const centerFocus =
            galaxyScaleTargetRef.current ??
            lockedGalaxyScaleFocusRef.current ??
            galaxyScaleFocusRef.current;
          const focus =
            centerFocus ??
            (galaxySoftFocusAvailableRef.current
              ? defaultGalaxyScaleFocus
              : null);

          if (!focus) {
            document.documentElement.dataset.universeScaleBlocked =
              "no-galaxy-focus";
            return;
          }

          const resolvedTarget = navigationCameraTarget(
            focus,
            galaxy.markers,
          );
          const nativeStarId =
            resolvedTarget?.kind === "star"
              ? resolvedTarget.nativeId
              : resolvedTarget?.kind === "body"
                ? resolvedTarget.starId
                : null;

          // Non-native observed/spatial targets retain their existing travel
          // path. We do not invent a fake physical scale model for them.
          if (!nativeStarId) {
            if (direction === "in") {
              beginGalaxyScaleTravel(focus);
              return;
            }
          } else {
            if (
              direction === "in" &&
              galaxySoftFocusAvailableRef.current
            ) {
              galaxySoftFocusAvailableRef.current = false;
              document.documentElement.dataset.universeScaleSoftFocus =
                centerFocus ? "consumed-center" : "consumed-fallback";
            }

            lockedGalaxyScaleFocusRef.current = focus;
            if (galaxyScaleTargetRef.current?.id !== focus.id) {
              galaxyScaleTargetRef.current = focus;
              setGalaxyScaleTarget(focus);
            }
            document.documentElement.dataset.universeGalaxyScaleTarget =
              focus.id;
            document.documentElement.dataset.universeNavigationTarget =
              nativeStarId;

            const nextPosition = applyGalaxyScaleWheel(
              currentPosition,
              normalizedDelta,
            );

            if (
              Math.abs(nextPosition - currentPosition) <=
              WORLD_SCALE_EPSILON
            ) {
              // Same-direction input at the matched endpoint must not
              // invalidate the paint/deadline handoff already in flight.
              return;
            }

            continuousScaleIntentEpochRef.current += 1;
            const intentEpoch = continuousScaleIntentEpochRef.current;
            pendingScaleEnterSystemRef.current = null;
            pendingWorldScaleStepsRef.current = 0;
            setNavigationRequest(null);
            setPendingDestinationId(null);
            setPendingDestinationMode(null);
            setNavigationStatus(null);
            delete document.documentElement.dataset.universePendingDestination;
            delete document.documentElement.dataset.universeScaleQueued;
            delete document.documentElement.dataset.universeScaleBlocked;

            // Native YEIS consumes Galaxy 0→1 directly from the shared
            // imperative coordinate. React mirrors that coordinate at most
            // once per RAF for semantic/diagnostic freshness; exact endpoints
            // publish immediately for renderer handoff.
            const semanticGalaxyEndpoint =
              nextPosition === GALAXY_SCALE_MIN ||
              nextPosition === SYSTEM_SCALE_MIN;
            publishWorldScalePosition(
              nextPosition,
              semanticGalaxyEndpoint,
            );
            setWorldScaleContinuous(true);
            document.documentElement.dataset.universeScaleDirection =
              direction;
            document.documentElement.dataset.universeScaleProgress =
              galaxyScaleSegmentProgress(nextPosition).toFixed(3);
            document.documentElement.dataset.universeGalaxyScaleBridge =
              "active";

            if (
              direction === "in" &&
              nextPosition >=
                SYSTEM_SCALE_MIN - WORLD_SCALE_EPSILON
            ) {
              scheduleScaleRendererHandoff({
                label: "galaxy-system",
                isCurrent: () =>
                  continuousScaleIntentEpochRef.current === intentEpoch &&
                  phaseRef.current === "galaxy" &&
                  worldScalePositionRef.current >=
                    SYSTEM_SCALE_MIN - WORLD_SCALE_EPSILON,
                commit: () => {
                  void commitGalaxyScaleFocusedSystem(focus);
                },
              });
            }

            return;
          }
        }
      }

      if (isWorldScalePhase(currentPhase) && selectedPlanet) {
        const currentPosition = worldScalePositionRef.current;
        const maxPosition = worldScaleMax(selectedPlanet.surfaceMode);

        if (
          direction === "out" &&
          currentPosition <= WORLD_SCALE_MIN + WORLD_SCALE_EPSILON
        ) {
          // Preserve the physical wheel sample across the Approach -> System
          // renderer boundary. The boundary itself must not consume input:
          // a normalized +96 sample moves 2 -> 1.5, then the next 1.5 -> 1.
          const nextPosition = applySystemScaleWheel(
            WORLD_SCALE_MIN,
            normalizedDelta,
          );
          setSystemScaleTargetPlanet(selectedPlanet);
          publishWorldScalePosition(nextPosition, true);
          setWorldScaleContinuous(true);
          document.documentElement.dataset.universeScaleDirection = direction;
          document.documentElement.dataset.universeScaleProgress =
            systemScaleSegmentProgress(nextPosition).toFixed(3);
          setWorldScalePhase("system", {
            preserveWorldScalePosition: true,
          });
          return;
        }

        if (
          direction === "in" &&
          currentPosition >= maxPosition - WORLD_SCALE_EPSILON
        ) {
          document.documentElement.dataset.universeScaleBlocked =
            selectedPlanet.surfaceMode === "none"
              ? "no-surface"
              : "surface-limit";
          return;
        }

        const nextPosition = applyWorldScaleWheel(
          currentPosition,
          normalizedDelta,
          selectedPlanet.surfaceMode,
        );

        if (Math.abs(nextPosition - currentPosition) <= WORLD_SCALE_EPSILON) {
          return;
        }

        pendingWorldScaleStepsRef.current = 0;
        delete document.documentElement.dataset.universeScaleQueued;
        delete document.documentElement.dataset.universeScaleBlocked;

        publishWorldScalePosition(
          nextPosition,
          worldScalePhaseForPosition(
            nextPosition,
            selectedPlanet.surfaceMode,
          ) !== currentPhase,
        );
        setWorldScaleContinuous(true);
        document.documentElement.dataset.universeScaleDirection = direction;
        document.documentElement.dataset.universeScaleProgress =
          worldScaleSegmentProgress(nextPosition).toFixed(3);

        cameraSettledPhaseRef.current = null;
        setCameraSettledPhase(null);
        delete document.documentElement.dataset.universeCameraSettled;
        delete document.documentElement.dataset.universeScaleSettled;

        const semanticPhase = worldScalePhaseForPosition(
          nextPosition,
          selectedPlanet.surfaceMode,
        );
        if (semanticPhase !== currentPhase) {
          setWorldScalePhase(semanticPhase, {
            preserveWorldScalePosition: true,
          });
        }
        return;
      }

      const activeSystem =
        selectedSystemRef.current ?? selectedSystem;
      if (currentPhase === "system" && activeSystem) {
        const currentPosition = Math.min(
          WORLD_SCALE_MIN,
          Math.max(SYSTEM_SCALE_MIN, worldScalePositionRef.current),
        );

        if (
          direction === "out" &&
          currentPosition <= SYSTEM_SCALE_MIN + WORLD_SCALE_EPSILON
        ) {
          const retainedGalaxyTarget = galaxyScaleTargetRef.current;
          if (retainedGalaxyTarget) {
            continuousScaleIntentEpochRef.current += 1;
            const nextPosition = applyGalaxyScaleWheel(
              SYSTEM_SCALE_MIN,
              normalizedDelta,
            );
            setSystemScaleTargetPlanet(null);
            publishWorldScalePosition(nextPosition, true);
            setWorldScaleContinuous(true);
            phaseRef.current = "galaxy";
            setPhase("galaxy");
            cameraSettledPhaseRef.current = null;
            setCameraSettledPhase(null);
            delete document.documentElement.dataset.universeCameraSettled;
            delete document.documentElement.dataset.universeScaleSettled;
            document.documentElement.dataset.universeScalePosition =
              nextPosition.toFixed(3);
            document.documentElement.dataset.universeScaleDirection =
              direction;
            document.documentElement.dataset.universeScaleProgress =
              galaxyScaleSegmentProgress(nextPosition).toFixed(3);
            document.documentElement.dataset.universeNavigationPhase =
              "galaxy";
            document.documentElement.dataset.universeGalaxyScaleTarget =
              retainedGalaxyTarget.id;
            document.documentElement.dataset.universeGalaxyScaleBridge =
              "active";
            replaceNavigationUrl({
              phase: "galaxy",
              destinationId: retainedGalaxyTarget.id,
              navigationMode: "open",
            });
            return;
          }

          setSystemScaleTargetPlanet(null);
          setWorldScaleContinuous(false);
          handleReturn();
          return;
        }

        let preferredPlanet: PlanetDefinition | null = null;
        const preferred = preferredSystemScaleDestinationRef.current;
        if (preferred?.target.kind === "body") {
          preferredPlanet =
            activeSystem.planets.find(
              (candidate) =>
                candidate.id === preferred.target.bodyId ||
                nativePlanetId(candidate) === preferred.target.bodyId,
            ) ?? null;
        } else if (preferred?.target.kind === "observed-body") {
          preferredPlanet =
            activeSystem.planets.find(
              (candidate) =>
                candidate.id === preferred.target.bodyId ||
                nativePlanetId(candidate) === preferred.target.bodyId,
            ) ?? null;
        } else if (preferred?.target.kind === "content") {
          preferredPlanet =
            activeSystem.planets.find((candidate) =>
              candidate.content?.some(
                (entry) => entry.id === preferred.target.entryId,
              ),
            ) ?? null;
        }

        const targetPlanet =
          systemScaleTargetPlanet ??
          preferredPlanet ??
          lockedSystemScaleFocusRef.current ??
          systemScaleFocusRef.current;

        if (!targetPlanet) {
          document.documentElement.dataset.universeScaleBlocked =
            "no-planet-focus";
          return;
        }

        lockedSystemScaleFocusRef.current = targetPlanet;
        if (systemScaleTargetPlanet?.id !== targetPlanet.id) {
          setSystemScaleTargetPlanet(targetPlanet);
        }

        const nextPosition = applySystemScaleWheel(
          currentPosition,
          normalizedDelta,
        );

        if (Math.abs(nextPosition - currentPosition) <= WORLD_SCALE_EPSILON) {
          // Preserve the already-scheduled System→Approach handoff while
          // sustained input continues against the coordinate-2 endpoint.
          return;
        }

        continuousScaleIntentEpochRef.current += 1;
        const intentEpoch = continuousScaleIntentEpochRef.current;
        delete document.documentElement.dataset.universeScaleBlocked;
        delete document.documentElement.dataset.universeScaleQueued;
        publishWorldScalePosition(
          nextPosition,
          nextPosition >= WORLD_SCALE_MIN - WORLD_SCALE_EPSILON,
        );
        setWorldScaleContinuous(true);
        document.documentElement.dataset.universeScaleDirection = direction;
        document.documentElement.dataset.universeScaleProgress =
          systemScaleSegmentProgress(nextPosition).toFixed(3);
        cameraSettledPhaseRef.current = null;
        setCameraSettledPhase(null);
        delete document.documentElement.dataset.universeCameraSettled;
        delete document.documentElement.dataset.universeScaleSettled;

        if (
          direction === "in" &&
          nextPosition >= WORLD_SCALE_MIN - WORLD_SCALE_EPSILON
        ) {
          const destination = navigationDestinationForPlanet(
            activeSystem,
            targetPlanet,
            galaxy.markers,
            contentPlacements,
          );
          preferredSystemScaleDestinationRef.current = null;
          delete document.documentElement.dataset.universeScalePreferred;

          // Prefer one painted matched System endpoint, but never let a
          // throttled/software rAF stall consume the visitor's next scale
          // samples. Any newer scale/navigation intent invalidates the handoff.
          scheduleScaleRendererHandoff({
            label: "system-approach",
            isCurrent: () =>
              continuousScaleIntentEpochRef.current === intentEpoch &&
              phaseRef.current === "system" &&
              worldScalePositionRef.current >=
                WORLD_SCALE_MIN - WORLD_SCALE_EPSILON,
            commit: () => {
              if (destination) {
                void handleNavigateDestination(destination, {
                  preserveGalaxyScaleBridge: true,
                });
              } else {
                setSelectedPlanet(targetPlanet);
                setWorldScalePhase("approach");
              }
            },
          });
        }
        return;
      }

      const worldTransitionUnsettled =
        currentPhase !== "galaxy" &&
        currentPhase !== "system" &&
        currentPhase !== "returning" &&
        (settledPhase !== currentPhase ||
          worldScaleBoundaryLockedRef.current);

      // Do not discard committed wheel samples merely because the previous
      // phase settled quickly. On SwiftShader a 220ms time cooldown caused
      // distinct wheel events in one sustained gesture to disappear. The
      // threshold already limits each browser event to at most one boundary,
      // while unsettled phases serialize extra steps through the existing
      // queue.
      if (wheel.samples === 1) {
        lockedGalaxyScaleFocusRef.current = null;
        lockedSystemScaleFocusRef.current = null;
      }

      wheel.lastAt = now;
      wheel.samples = Math.min(8, wheel.samples + 1);
      wheel.accumulated += Math.abs(continuousScaleDelta(normalizedDelta));
      document.documentElement.dataset.universeScaleDirection = direction;
      document.documentElement.dataset.universeScaleProgress = String(
        Math.min(
          1,
          wheel.accumulated / CONTINUOUS_SCALE_WHEEL_THRESHOLD,
        ).toFixed(3),
      );

      if (wheel.accumulated < CONTINUOUS_SCALE_WHEEL_THRESHOLD) return;

      wheel.accumulated = 0;
      document.documentElement.dataset.universeScaleProgress = "0";
      document.documentElement.dataset.universeScaleIndex = String(
        scalePhaseIndex(currentPhase),
      );
      delete document.documentElement.dataset.universeScaleBlocked;

      if (worldTransitionUnsettled) {
        if (directionChanged && selectedPlanet) {
          pendingWorldScaleStepsRef.current = 0;
          delete document.documentElement.dataset.universeScaleQueued;
          const reversePhase = nextWorldScalePhase(
            currentPhase,
            direction,
            selectedPlanet.surfaceMode,
          );
          if (reversePhase) {
            setWorldScalePhase(reversePhase);
          }
          return;
        }

        const step = direction === "in" ? 1 : -1;
        pendingWorldScaleStepsRef.current = Math.max(
          -6,
          Math.min(6, pendingWorldScaleStepsRef.current + step),
        );
        const queued = pendingWorldScaleStepsRef.current;
        document.documentElement.dataset.universeScaleQueued =
          "world:" + (queued > 0 ? "+" : "") + String(queued);
        return;
      }

      if (direction === "in") {
        if (currentPhase === "galaxy") {
          const centerFocus =
            lockedGalaxyScaleFocusRef.current ??
            galaxyScaleFocusRef.current;
          const focus =
            centerFocus ??
            (galaxySoftFocusAvailableRef.current
              ? defaultGalaxyScaleFocus
              : null);
          if (!focus) {
            document.documentElement.dataset.universeScaleBlocked =
              "no-galaxy-focus";
            return;
          }
          if (galaxySoftFocusAvailableRef.current) {
            galaxySoftFocusAvailableRef.current = false;
            document.documentElement.dataset.universeScaleSoftFocus =
              centerFocus ? "consumed-center" : "consumed-fallback";
          }
          lockedGalaxyScaleFocusRef.current = focus;

          // A located destination is only orientation state. Even when it is
          // already active, inward scale must still perform the native YEIS
          // star→system approach before product System takes visual authority.
          if (activeDestinationId === focus.id) {
            pendingScaleEnterSystemRef.current = focus;
            document.documentElement.dataset.universeScaleQueued =
              "enter-system:" + focus.id;
            beginGalaxyScaleTravel(focus);
            return;
          }

          if (pendingDestinationId === focus.id) {
            pendingScaleEnterSystemRef.current = focus;
            document.documentElement.dataset.universeScaleQueued =
              "enter-system:" + focus.id;
            return;
          }

          pendingScaleEnterSystemRef.current = focus;
          document.documentElement.dataset.universeScaleQueued =
            "enter-system:" + focus.id;
          beginGalaxyScaleTravel(focus);
          return;
        }

        if (currentPhase === "system") {
          const preferred = preferredSystemScaleDestinationRef.current;
          let preferredPlanet: PlanetDefinition | null = null;
          if (preferred?.target.kind === "body") {
            preferredPlanet =
              selectedSystem?.planets.find(
                (candidate) =>
                  candidate.id === preferred.target.bodyId ||
                  nativePlanetId(candidate) === preferred.target.bodyId,
              ) ?? null;
          } else if (preferred?.target.kind === "observed-body") {
            preferredPlanet =
              selectedSystem?.planets.find(
                (candidate) =>
                  candidate.id === preferred.target.bodyId ||
                  nativePlanetId(candidate) === preferred.target.bodyId,
              ) ?? null;
          } else if (preferred?.target.kind === "content") {
            preferredPlanet =
              selectedSystem?.planets.find((candidate) =>
                candidate.content?.some(
                  (entry) => entry.id === preferred.target.entryId,
                ),
              ) ?? null;
          }
          const planet =
            preferredPlanet ??
            lockedSystemScaleFocusRef.current ??
            systemScaleFocusRef.current;
          if (!planet || !selectedSystem) {
            document.documentElement.dataset.universeScaleBlocked =
              "no-planet-focus";
            return;
          }
          // This legacy threshold branch is retained only as a defensive
          // fallback. Normal System wheel input is consumed by the continuous
          // 1→2 scale segment above before reaching this point.
          lockedSystemScaleFocusRef.current = planet;
          setSystemScaleTargetPlanet(planet);
          return;
        }

        if (selectedPlanet) {
          const nextPhase = nextWorldScalePhase(
            currentPhase,
            "in",
            selectedPlanet.surfaceMode,
          );
          if (nextPhase) {
            setWorldScalePhase(nextPhase);
          } else {
            document.documentElement.dataset.universeScaleBlocked =
              currentPhase === "surface" ? "surface-limit" : "no-surface";
          }
        }
        return;
      }

      if (currentPhase === "galaxy") {
        pendingScaleEnterSystemRef.current = null;
        delete document.documentElement.dataset.universeScaleQueued;
        if (
          activeDestinationId === "galaxy:0" &&
          navigationStatus === "arrived"
        ) {
          document.documentElement.dataset.universeScaleBlocked =
            "galaxy-limit";
          return;
        }
        void resolveUniverseNavigationDestination(
          "galaxy:0",
          contentPlacements,
          galaxy.markers,
        ).then((homeGalaxy) => {
          if (homeGalaxy) beginGalaxyScaleTravel(homeGalaxy);
        });
        return;
      }

      if (currentPhase === "system") {
        preferredSystemScaleDestinationRef.current = null;
        delete document.documentElement.dataset.universeScalePreferred;
        handleReturn();
        return;
      }

      if (selectedPlanet) {
        const nextPhase = nextWorldScalePhase(
          currentPhase,
          "out",
          selectedPlanet.surfaceMode,
        );
        if (nextPhase) setWorldScalePhase(nextPhase);
      }
    },
    [
      activeDestinationId,
      activeEngine,
      beginGalaxyScaleTravel,
      cameraSettledPhase,
      commitGalaxyScaleFocusedSystem,
      contentPlacements,
      defaultGalaxyScaleFocus,
      enterScaleFocusedSystem,
      galaxy.markers,
      galaxyScaleTarget,
      handleContinuousScaleIntentStart,
      handleNavigateDestination,
      handleReturn,
      navigationFailure,
      navigationStatus,
      navigatorOpen,
      phase,
      selectedPlanet,
      selectedSystem,
      setWorldScalePhase,
      systemScaleTargetPlanet,
      publishWorldScalePosition,
    ],
  );

  const transitionClass = useMemo(() => {
    if (phase === "atmosphere") return "transition-atmosphere";
    if (phase === "surface") return "transition-surface";
    return "";
  }, [phase]);

  return (
    <main
      className={`universe-root ${transitionClass}`}
      onWheel={handleContinuousScaleWheel}
    >
      <div className="universe-canvas">
        <UniverseCanvas
          phase={phase}
          phaseRef={phaseRef}
          worldScalePosition={worldScalePosition}
          worldScalePositionRef={worldScalePositionRef}
          worldScaleContinuous={worldScaleContinuous}
          galaxyScaleTarget={galaxyScaleTarget}
          engineMode={activeEngine}
          markers={galaxy.markers}
          contentPlacements={contentPlacements}
          navigationRequest={navigationRequest}
          onNavigationComplete={handleNavigationComplete}
          onNavigationFailed={handleNavigationFailed}
          selectedSystem={selectedSystem}
          selectedPlanet={selectedPlanet}
          surfaceFocusEntryId={surfaceFocusEntryId}
          onSurfaceFocusEntry={handleSurfaceFocusEntry}
          systemScaleTargetPlanet={systemScaleTargetPlanet}
          onSelectSystem={handleSelectSystem}
          onNavigateDestination={handleNavigateDestination}
          onSignalHover={setSignalHover}
          onScaleFocusDestination={handleGalaxyScaleFocus}
          onScaleManualTakeover={handleGalaxyScaleManualTakeover}
          onScaleFocusPlanet={handleSystemScaleFocus}
          onSelectPlanet={handleSelectPlanet}
          quality={quality}
          scrollDepth={scrollDepth}
          reducedMotion={reducedMotion}
          onCinematicPhaseComplete={handleCinematicPhaseComplete}
          onCinematicUserControlStart={handleCinematicUserControlStart}
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
            <span>
              {text(locale, "personalSignal")} · {kindLabel(locale, signalHover.kind)}
            </span>
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
              <span>
                {journey.completed
                  ? text(locale, "journeyComplete")
                  : text(locale, "guidedJourney")}
              </span>
              <strong>{journeyTitle(locale, journey.title)}</strong>
            </div>
            <button
              type="button"
              onClick={handleStopJourney}
              aria-label={text(locale, "stopJourney")}
            >
              {text(locale, "stop")}
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
              {text(locale, "prev")}
            </button>
            {!journey.completed && (
              <button
                type="button"
                onClick={handleToggleJourneyPause}
              >
                {journey.paused
                  ? text(locale, "resume")
                  : text(locale, "pause")}
              </button>
            )}
            <button
              type="button"
              onClick={
                journey.completed
                  ? handleStopJourney
                  : () => handleJourneyStep(1)
              }
            >
              {journey.completed
                ? text(locale, "close")
                : journey.index >= journey.destinations.length - 1
                  ? text(locale, "done")
                  : text(locale, "next")}
            </button>
          </div>
          <small className="journey-mode">
            {journey.completed
              ? text(locale, "completeMode")
              : reducedMotion
                ? text(locale, "reducedMode")
                : journey.paused
                  ? text(locale, "pausedMode")
                  : journeyDestinationSettled
                    ? text(locale, "dwellingMode")
                    : text(locale, "settlingMode")}
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
          if (muted) ensurePlaying();
          setMuted((value) => !value);
        }}
        quality={quality}
        onQualityChange={setQuality}
        onOpenNavigator={() => setNavigatorOpen(true)}
        navigatorAvailable={activeEngine === "yeis"}
        onReturn={handleReturn}
        locale={locale}
        onLocaleChange={handleLocaleChange}
      />

      <UniverseNavigator
        open={navigatorOpen && activeEngine === "yeis"}
        markers={galaxy.markers}
        placements={contentPlacements}
        currentSystem={selectedSystem}
        activeDestinationId={activeDestinationId}
        pendingDestinationId={pendingDestinationId}
        pendingDestinationMode={pendingDestinationMode}
        onClose={() => setNavigatorOpen(false)}
        onNavigate={handleNavigateDestination}
        onLocate={handleLocateDestination}
        onStartJourney={handleStartJourney}
        locale={locale}
      />

      {navigationFailure && (
        <aside
          className="navigation-failure-notice"
          role="alert"
          data-navigation-target={cameraTargetLabel(
            navigationFailure.request.target,
          )}
        >
          <div className="navigation-failure-copy">
            <span>{text(locale, "routeInterrupted")}</span>
            <strong>{navigationFailure.request.title}</strong>
            <small>
              {text(locale, "routeFailure")}
            </small>
          </div>
          <div className="navigation-failure-actions">
            <button type="button" onClick={handleRetryNavigation}>
              {text(locale, "retry")}
            </button>
            <button
              type="button"
              onClick={handleDismissNavigationFailure}
            >
              {text(locale, "dismiss")}
            </button>
          </div>
        </aside>
      )}

      {phase === "galaxy" && navigationRequest && (
        <div className="galaxy-locate-caption">
          {navigationStatus === "arrived"
            ? text(locale, "arrived")
            : navigationStatus === "located"
              ? text(locale, "located")
              : navigationRequest.mode === "travel"
                ? text(locale, "navigating")
                : text(locale, "locating")} //{" "}
          {astronomicalName(locale, navigationRequest.title)}
        </div>
      )}

      {phase === "galaxy" && (
        <section className="hero-copy">
          <span className="eyebrow">{text(locale, "heroEyebrow")}</span>
          <h1>{text(locale, "heroTitle")}</h1>
          <p>{text(locale, "heroDescription")}</p>
        </section>
      )}

      {phase === "system" && selectedSystem && (
        <section className="system-copy">
          <span>
            {selectedSystem.source.toUpperCase()} {text(locale, "systemWord")} // {selectedSystem.star.spectralType}
          </span>
          <strong>{astronomicalName(locale, selectedSystem.name)}</strong>
          <small>
            {locale === "zh"
              ? `${selectedSystem.planets.length} ${text(locale, "worlds")}。`
              : `${selectedSystem.planets.length} worlds.`}
            {selectedSystem.content?.length
              ? locale === "zh"
                ? ` ${selectedSystem.content.length} ${text(
                    locale,
                    selectedSystem.content.length === 1
                      ? "personalSignalDetected"
                      : "personalSignalsDetected",
                  )}；${text(locale, "linkedWorldHighlighted")}`
                : ` ${selectedSystem.content.length} personal signal${
                    selectedSystem.content.length === 1 ? "" : "s"
                  } detected; ${text(locale, "linkedWorldHighlighted")}`
              : " " + text(locale, "selectPlanet")}
          </small>
          {selectedSystem.content?.map((entry) => (
            <div className="content-signal-card" key={entry.id}>
              <span>
                {text(locale, "contentSignal")} // {kindLabel(locale, entry.kind)}
              </span>
              <b>{entry.title}</b>
              <small>{entry.summary}</small>
            </div>
          ))}
        </section>
      )}

      {phase !== "galaxy" &&
        phase !== "system" &&
        visibleWorldContentEntries.length ? (
          <div
            className="world-content-stack"
            aria-label="World content"
            data-surface-card-budget={
              phase === "surface"
                ? SURFACE_CONTENT_SIGNAL_BUDGET.stable
                : undefined
            }
          >
            {visibleWorldContentEntries.map((entry) => {
              const surfacePresentation =
                phase === "surface"
                  ? surfaceContentPresentation.get(entry.id)
                  : undefined;
              return (
                <section
                  className={
                    "world-content-card" +
                    (surfaceFocusEntryId === entry.id
                      ? " is-surface-focus"
                      : "")
                  }
                  data-surface-priority={surfacePresentation?.priority}
                  data-surface-focus={
                    surfaceFocusEntryId === entry.id ? "true" : undefined
                  }
                  key={entry.id}
                >
                  <span>
                    {text(locale, "worldSignal")} // {kindLabel(locale, entry.kind)}
                  </span>
                  {surfaceFocusEntryId === entry.id && (
                    <em className="world-content-focus-label">
                      {locale === "zh" ? "当前目标" : "CURRENT TARGET"}
                    </em>
                  )}
                  <strong>{entry.title}</strong>
                  <small>{entry.summary}</small>
                  {surfacePresentation && (
                    <>
                      <em className="world-content-location">
                        {locale === "zh" ? "地表位置" : "SURFACE LOCATION"} //{" "}
                        {surfacePresentation.location}
                      </em>
                      <em className="world-content-cluster">
                        {locale === "zh" ? "区域簇" : "CLUSTER"} //{" "}
                        {surfacePresentation.cluster}
                      </em>
                      <em
                        className={
                          "world-content-priority priority-" +
                          surfacePresentation.priority
                        }
                      >
                        {locale === "zh"
                          ? surfacePresentation.priority === "primary"
                            ? "重点信号"
                            : surfacePresentation.priority === "secondary"
                              ? "次级信号"
                              : "环境信号"
                          : surfacePresentation.priority.toUpperCase() +
                            " SIGNAL"}
                      </em>
                    </>
                  )}
                  {surfacePresentation && (
                    <button
                      type="button"
                      className="world-content-focus-action"
                      data-surface-entry={entry.id}
                      aria-pressed={surfaceFocusEntryId === entry.id}
                      onClick={() => handleSurfaceFocusEntry(entry.id)}
                    >
                      {surfaceFocusEntryId === entry.id
                        ? locale === "zh"
                          ? "已聚焦地表位置"
                          : "SURFACE SIGNAL FOCUSED"
                        : locale === "zh"
                          ? "聚焦地表位置"
                          : "FOCUS SURFACE SIGNAL"}
                    </button>
                  )}
                  {entry.tags.length > 0 && (
                    <em className="world-content-tags">
                      {entry.tags.slice(0, 4).join(" · ")}
                    </em>
                  )}
                </section>
              );
            })}
          </div>
        ) : null}

      {phase === "surface" && selectedPlanet && surfaceProfile && (
        <section className="surface-copy">
          <span>
            {text(locale, "heroSurface")} // {surfaceProfile.biome.toUpperCase()}
          </span>
          <strong>{astronomicalName(locale, selectedPlanet.name)}</strong>
          <small>{text(locale, "surfaceDescription")}</small>
          <div className="surface-world-meta" aria-label="Surface world profile">
            <b>
              {surfaceProfile.regions.length}
              <i>{locale === "zh" ? "区域" : "REGIONS"}</i>
            </b>
            <b>
              {surfaceProfile.landmarks.length}
              <i>{locale === "zh" ? "地标" : "LANDMARKS"}</i>
            </b>
            <b>
              {surfaceProfile.contentAnchors.length}
              <i>{locale === "zh" ? "内容点" : "SIGNALS"}</i>
            </b>
          </div>
          <div className="surface-region-index" aria-label="Surface regions">
            {surfaceProfile.regions.slice(0, 4).map((region) => (
              <span key={region.id}>{region.name}</span>
            ))}
          </div>
          {surfaceProfile.contentClusters.length > 0 && (
            <div
              className="surface-cluster-index"
              aria-label="Surface signal clusters"
            >
              {rankSurfaceContentClusters(
                surfaceProfile.contentClusters,
                surfaceFocusedAnchor?.cluster ?? null,
              ).map((cluster) => {
                const focusedEntry =
                  surfaceFocusedAnchor?.cluster === cluster.index
                    ? surfaceFocusEntryId
                    : null;
                const nextEntryId = nextSurfaceClusterEntryId(
                  surfaceProfile.contentAnchors,
                  cluster.index,
                  focusedEntry,
                );
                return (
                  <button
                    type="button"
                    className="surface-cluster-chip"
                    data-priority={cluster.priority}
                    data-surface-cluster={cluster.index}
                    data-surface-entry={nextEntryId ?? undefined}
                    aria-pressed={
                      surfaceFocusedAnchor?.cluster === cluster.index
                    }
                    aria-label={
                      locale === "zh"
                        ? `${cluster.label}，${cluster.anchorIds.length} 个信号，点按切换`
                        : `${cluster.label}, ${cluster.anchorIds.length} signals, tap to cycle`
                    }
                    disabled={!nextEntryId}
                    key={cluster.id}
                    onClick={() => handleSurfaceFocusCluster(cluster.index)}
                  >
                    {cluster.label} · {cluster.anchorIds.length}
                  </button>
                );
              })}
            </div>
          )}
          <em className="surface-explore-hint">
            {locale === "zh"
              ? "点按信号聚焦 · 拖动探索 · 双指调整视角 · 滚轮离开地表"
              : "TAP SIGNALS TO FOCUS · DRAG TO EXPLORE · PINCH TO FRAME · WHEEL TO DEPART"}
          </em>
        </section>
      )}

      {phase === "approach" && selectedPlanet && (
        <div className="travel-caption">
          {text(locale, "lockAcquired")} //{" "}
          {astronomicalName(locale, selectedPlanet.name)}
        </div>
      )}
      {phase === "orbit" && selectedPlanet && (
        <div className="travel-caption">
          {text(locale, "orbit")} //{" "}
          {astronomicalName(locale, selectedPlanet.name)}
          {selectedPlanet.surfaceMode === "none"
            ? " // " + text(locale, "scanMode")
            : ""}
        </div>
      )}
      {phase === "atmosphere" && selectedPlanet && (
        <div className="travel-caption">
          {text(locale, "atmosphericEntry")} //{" "}
          {astronomicalName(locale, selectedPlanet.name)}
        </div>
      )}
    </main>
  );
}
