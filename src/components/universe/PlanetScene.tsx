import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { Planet } from "procedural-planets";
import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import {
  PLANET_ANCHOR,
  PLANET_RENDER_RADIUS,
  type PlanetArchetype,
  type PlanetDefinition,
  type QualityMode,
} from "../../lib/universe/types";
import { hashSeed } from "../../lib/universe/generation";
import { isSoftwareRenderer, liveWorldFallbackReason } from "./CinematicPipeline";
import type { SurfaceCameraFrame } from "./CinematicCamera";

const STAR_POSITION: [number, number, number] = [-12.5, 5.5, -18];
const LIVE_PLANET_RADIUS = 2000;
const LIVE_WORLD_RADIUS = PLANET_RENDER_RADIUS;
const FALLBACK_WORLD_RADIUS = PLANET_RENDER_RADIUS * 0.965;

// Keep the canonical landing patch on the lit hemisphere. This direction
// has a strong positive dot product with the current product sun vector,
 // so Surface reads as terrain rather than a black planet limb.
const SURFACE_WORLD_NORMAL = new THREE.Vector3(
  -0.10013,
  0.350456,
  -0.931211,
).normalize();
const SURFACE_UP = new THREE.Vector3(0, 1, 0);

function LiveSurfaceAnchor({
  planet,
  onCameraFrame,
}: {
  planet: Planet;
  onCameraFrame: (frame: SurfaceCameraFrame | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const cameraFramePublished = useRef(false);
  const scratch = useMemo(
    () => ({
      center: new THREE.Vector3(),
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      localDirection: new THREE.Vector3(),
      worldQuaternion: new THREE.Quaternion(),
      inverseQuaternion: new THREE.Quaternion(),
      anchorQuaternion: new THREE.Quaternion(),
      tangent: new THREE.Vector3(),
      cameraPosition: new THREE.Vector3(),
      cameraTarget: new THREE.Vector3(),
    }),
    [],
  );

  useEffect(() => {
    document.documentElement.dataset.universeSurfaceRenderer =
      "procedural-planets-live-surface";
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceRenderer ===
        "procedural-planets-live-surface"
      ) {
        delete document.documentElement.dataset.universeSurfaceRenderer;
      }
      delete document.documentElement.dataset.universeSurfaceAnchorReady;
      delete document.documentElement.dataset.universeSurfaceCameraFrame;
      onCameraFrame(null);
    };
  }, [onCameraFrame]);

  useFrame(() => {
    if (!group.current || cameraFramePublished.current) return;

    // PlanetScene locks rotation for the whole final 4->5 interval. The
    // terrain-derived landing frame is therefore stable and only needs to be
    // resolved once per anchor activation; crossing back to <=4 unmounts this
    // anchor and a later inward pass resolves a fresh frame.
    planet.updateWorldMatrix(true, false);
    planet.getWorldPosition(scratch.center);
    planet.getWorldQuaternion(scratch.worldQuaternion);
    scratch.inverseQuaternion.copy(scratch.worldQuaternion).invert();
    scratch.localDirection
      .copy(SURFACE_WORLD_NORMAL)
      .applyQuaternion(scratch.inverseQuaternion)
      .normalize();
    planet.getSurfacePoint(scratch.localDirection, scratch.point);
    scratch.normal
      .copy(scratch.point)
      .sub(scratch.center)
      .normalize();

    group.current.position
      .copy(scratch.point)
      .addScaledVector(scratch.normal, 0.035);
    scratch.anchorQuaternion.setFromUnitVectors(
      SURFACE_UP,
      scratch.normal,
    );
    group.current.quaternion.copy(scratch.anchorQuaternion);

    if (!cameraFramePublished.current) {
      scratch.tangent.crossVectors(SURFACE_UP, scratch.normal);
      if (scratch.tangent.lengthSq() < 1e-6) {
        scratch.tangent.set(1, 0, 0);
      } else {
        scratch.tangent.normalize();
      }

      // Derive the landing view from the actual displaced terrain point,
      // not from the nominal sphere radius. This keeps the camera above the
      // rendered ground even when the procedural height field changes.
      scratch.cameraPosition
        .copy(scratch.point)
        .addScaledVector(scratch.normal, 0.012)
        .addScaledVector(scratch.tangent, -0.012);
      scratch.cameraTarget
        .copy(scratch.point)
        .addScaledVector(scratch.tangent, 0.18)
        .addScaledVector(scratch.normal, 0.008);

      onCameraFrame({
        position: scratch.cameraPosition.toArray() as [number, number, number],
        target: scratch.cameraTarget.toArray() as [number, number, number],
        up: scratch.normal.toArray() as [number, number, number],
      });
      cameraFramePublished.current = true;
      document.documentElement.dataset.universeSurfaceCameraFrame = "ready";
    }

    document.documentElement.dataset.universeSurfaceAnchorReady = "true";
  });

  return (
    <group ref={group} name="live-surface-anchor">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[0.035, 0.065, 28]} />
        <meshBasicMaterial
          color="#76e6ff"
          transparent
          opacity={0.24}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function presetFor(planet: PlanetDefinition) {
  switch (planet.archetype) {
    case "ocean": return "ocean";
    case "temperate": return "terran";
    case "desert": return "desert";
    case "ice":
    case "frozen": return "ice";
    case "lava": return "lava";
    case "volcanic": return "ashen";
    case "gas_giant": return planet.hasRings ? "ringed" : "gasGiant";
    case "ice_giant": return "iceGiant";
    case "alien": return "alien";
    case "rocky":
    default: return "mars";
  }
}

function fallbackColor(archetype: PlanetArchetype) {
  switch (archetype) {
    case "ocean": return "#2d79a6";
    case "temperate": return "#71896d";
    case "desert": return "#b58b61";
    case "ice":
    case "frozen": return "#bad6df";
    case "lava": return "#bc4a28";
    case "volcanic": return "#725045";
    case "gas_giant": return "#c0a07f";
    case "ice_giant": return "#77abc8";
    case "alien": return "#8571b0";
    default: return "#77736f";
  }
}

type FallbackRgb = readonly [number, number, number];
type FallbackPalette = readonly [
  FallbackRgb,
  FallbackRgb,
  FallbackRgb,
  FallbackRgb,
];

function fallbackPalette(archetype: PlanetArchetype): FallbackPalette {
  switch (archetype) {
    case "ocean":
      return [
        [7, 34, 61],
        [22, 103, 139],
        [166, 158, 105],
        [226, 226, 205],
      ];
    case "temperate":
      return [
        [28, 53, 47],
        [72, 116, 68],
        [151, 139, 87],
        [210, 207, 174],
      ];
    case "desert":
      return [
        [79, 52, 37],
        [166, 112, 70],
        [205, 163, 105],
        [238, 211, 159],
      ];
    case "ice":
    case "frozen":
      return [
        [71, 104, 126],
        [139, 183, 201],
        [202, 226, 234],
        [244, 249, 250],
      ];
    case "lava":
      return [
        [35, 17, 16],
        [112, 35, 24],
        [208, 70, 32],
        [255, 157, 67],
      ];
    case "volcanic":
      return [
        [37, 31, 30],
        [91, 59, 52],
        [133, 88, 69],
        [180, 139, 112],
      ];
    case "gas_giant":
      return [
        [92, 67, 49],
        [165, 119, 78],
        [216, 178, 127],
        [245, 221, 183],
      ];
    case "ice_giant":
      return [
        [31, 78, 104],
        [67, 137, 170],
        [126, 190, 211],
        [191, 226, 235],
      ];
    case "alien":
      return [
        [43, 29, 68],
        [99, 73, 139],
        [132, 112, 164],
        [187, 177, 207],
      ];
    case "rocky":
    default:
      return [
        [54, 49, 46],
        [105, 94, 84],
        [145, 132, 117],
        [194, 183, 165],
      ];
  }
}

function mixFallbackRgb(
  from: FallbackRgb,
  to: FallbackRgb,
  t: number,
): FallbackRgb {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return [
    Math.round(THREE.MathUtils.lerp(from[0], to[0], k)),
    Math.round(THREE.MathUtils.lerp(from[1], to[1], k)),
    Math.round(THREE.MathUtils.lerp(from[2], to[2], k)),
  ];
}

function sampleFallbackPalette(
  palette: FallbackPalette,
  value: number,
): FallbackRgb {
  if (value < 0.48) {
    return mixFallbackRgb(palette[0], palette[1], value / 0.48);
  }
  if (value < 0.68) {
    return mixFallbackRgb(
      palette[1],
      palette[2],
      (value - 0.48) / 0.2,
    );
  }
  return mixFallbackRgb(
    palette[2],
    palette[3],
    (value - 0.68) / 0.32,
  );
}

function createFallbackSurfaceTexture(planet: PlanetDefinition) {
  const width = 128;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  const palette = fallbackPalette(planet.archetype);
  const noise = new ImprovedNoise();
  const seed = hashSeed(planet.seed);
  const offsetX = ((seed & 0xff) / 255) * 19.0;
  const offsetY = (((seed >>> 8) & 0xff) / 255) * 19.0;
  const offsetZ = (((seed >>> 16) & 0xff) / 255) * 19.0;
  const giant =
    planet.archetype === "gas_giant" ||
    planet.archetype === "ice_giant";

  for (let row = 0; row < height; row += 1) {
    const v = (row + 0.5) / height;
    const phi = v * Math.PI;
    const normalY = Math.cos(phi);
    const radial = Math.sin(phi);

    for (let column = 0; column < width; column += 1) {
      const u = (column + 0.5) / width;
      const theta = u * Math.PI * 2;
      const normalX = radial * Math.cos(theta);
      const normalZ = radial * Math.sin(theta);

      const broad = noise.noise(
        normalX * 1.55 + offsetX,
        normalY * 1.55 + offsetY,
        normalZ * 1.55 + offsetZ,
      );
      const medium = noise.noise(
        normalX * 3.1 + offsetX * 0.73,
        normalY * 3.1 + offsetY * 0.73,
        normalZ * 3.1 + offsetZ * 0.73,
      );
      const fine = noise.noise(
        normalX * 6.2 + offsetX * 1.17,
        normalY * 6.2 + offsetY * 1.17,
        normalZ * 6.2 + offsetZ * 1.17,
      );

      let value = THREE.MathUtils.clamp(
        0.5 + broad * 0.29 + medium * 0.14 + fine * 0.07,
        0,
        1,
      );

      if (giant) {
        const bandNoise = broad * 0.75 + medium * 0.25;
        value = THREE.MathUtils.clamp(
          0.5 +
            Math.sin(normalY * 18 + bandNoise * 3.2 + offsetY) * 0.25 +
            medium * 0.08,
          0,
          1,
        );
      }

      let color = sampleFallbackPalette(palette, value);
      const polar = THREE.MathUtils.smoothstep(
        Math.abs(normalY),
        0.78,
        0.96,
      );
      if (!giant && polar > 0) {
        color = mixFallbackRgb(color, palette[3], polar * 0.68);
      }

      const index = (row * width + column) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function DeepSky() {
  const texture = useTexture(
    `${import.meta.env.BASE_URL}textures/stars_milky_way.jpg`,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return (
    <mesh rotation={[0.18, -0.72, -0.1]} frustumCulled={false}>
      <sphereGeometry args={[92, 64, 64]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        color="#26354a"
        toneMapped={false}
        transparent
        opacity={0.48}
        depthWrite={false}
      />
    </mesh>
  );
}

type LiveQualityMode = Exclude<QualityMode, "low">;

function liveStructuralQuality(
  quality: LiveQualityMode,
  softwareRenderer: boolean,
) {
  if (softwareRenderer) {
    return {
      chunkRes: 16,
      maxDepth: 5,
    } as const;
  }

  return quality === "high"
    ? ({ chunkRes: 32, maxDepth: 6 } as const)
    : ({ chunkRes: 24, maxDepth: 5 } as const);
}

function liveDynamicQuality(
  quality: LiveQualityMode,
  softwareRenderer: boolean,
) {
  // chunkRes/maxDepth are deliberately excluded: ProceduralPlanets marks them
  // as REBUILD_KEYS and Planet.set() would rebuild every LOD chunk. Structural
  // quality is monotonic (AUTO -> HIGH at most once) while these non-structural
  // knobs may follow the active live profile without replacing the Planet.
  if (softwareRenderer) {
    return {
      cloudQuality: 32,
      cloudResolution: 0.35,
      splitFactor: 2.3,
    } as const;
  }

  return quality === "high"
    ? ({
        cloudQuality: 72,
        cloudResolution: 0.6,
        splitFactor: 2.7,
      } as const)
    : ({
        cloudQuality: 56,
        cloudResolution: 0.5,
        splitFactor: 2.4,
      } as const);
}

export function PlanetScene({
  planet,
  quality,
  phase,
  worldScalePosition,
  presentationActive = true,
  surfaceFallbackReady = false,
  onPaintStartedChange,
  onPaintReadyChange,
  onSurfaceCameraFrame,
  onBeforeLivePlanetDispose,
}: {
  planet: PlanetDefinition;
  quality: QualityMode;
  phase: UniversePhase;
  worldScalePosition: number;
  presentationActive?: boolean;
  surfaceFallbackReady?: boolean;
  onPaintStartedChange?: (started: boolean) => void;
  onPaintReadyChange?: (ready: boolean) => void;
  onSurfaceCameraFrame: (frame: SurfaceCameraFrame | null) => void;
  onBeforeLivePlanetDispose?: (planet: Planet) => void;
}) {
  const { gl } = useThree();
  const sunDirection = useMemo(
    () =>
      new THREE.Vector3(
        STAR_POSITION[0] - PLANET_ANCHOR[0],
        STAR_POSITION[1] - PLANET_ANCHOR[1],
        STAR_POSITION[2] - PLANET_ANCHOR[2],
      ).normalize(),
    [],
  );
  const softwareRenderer = isSoftwareRenderer(gl);
  const fallbackReason = liveWorldFallbackReason(gl, quality);
  const fallbackSurfaceOwnsPresentation =
    phase === "surface" &&
    Boolean(fallbackReason) &&
    surfaceFallbackReady;
  const worldPresentationActive =
    presentationActive && !fallbackSurfaceOwnsPresentation;
  const fallbackSurfaceTexture = useMemo(() => {
    if (!softwareRenderer) return null;
    const texture = createFallbackSurfaceTexture(planet);
    const html = document.documentElement;
    html.dataset.universeWorldFallbackTextureAllocations = String(
      Number(html.dataset.universeWorldFallbackTextureAllocations ?? "0") + 1,
    );
    return texture;
  }, [softwareRenderer, planet.archetype, planet.seed]);
  const fallbackSurfaceMap =
    fallbackReason === "software-renderer"
      ? fallbackSurfaceTexture
      : null;
  const liveKey = `${planet.id}:${softwareRenderer ? "software" : "gpu"}`;
  const [warmedKey, setWarmedKey] = useState<string | null>(null);
  const initialLiveStructureTier = useRef<"auto" | "high" | "software">(
    softwareRenderer ? "software" : "auto",
  );
  const liveProvisioned = warmedKey === liveKey;
  const paintedFrames = useRef(0);
  const paintStartedReported = useRef(false);
  const paintReported = useRef(false);
  const lastLiveDrawFrame = useRef(0);
  const appliedLiveProfile = useRef<{
    planet: Planet;
    key: "gpu-auto" | "gpu-high" | "software-high";
  } | null>(null);
  const liveStructure = useRef<{
    planet: Planet;
    tier: "auto" | "high" | "software";
  } | null>(null);
  const onPaintStartedChangeRef = useRef(onPaintStartedChange);
  onPaintStartedChangeRef.current = onPaintStartedChange;
  const onPaintReadyChangeRef = useRef(onPaintReadyChange);
  onPaintReadyChangeRef.current = onPaintReadyChange;

  const publishPaintStarted = useCallback((started: boolean) => {
    if (paintStartedReported.current === started) return;
    paintStartedReported.current = started;
    if (started) {
      document.documentElement.dataset.universeWorldPaintStarted = "true";
    } else {
      delete document.documentElement.dataset.universeWorldPaintStarted;
    }
    onPaintStartedChangeRef.current?.(started);
  }, []);

  const publishPaintReady = useCallback((ready: boolean) => {
    if (paintReported.current === ready) return;
    paintReported.current = ready;
    if (ready) {
      document.documentElement.dataset.universeWorldPaintReady = "true";
    } else {
      delete document.documentElement.dataset.universeWorldPaintReady;
    }
    onPaintReadyChangeRef.current?.(ready);
  }, []);

  useEffect(() => {
    if (fallbackReason || warmedKey === liveKey) return;

    // Hidden prewarm is useful on a real GPU, where constructing the live
    // ProceduralPlanets world can happen without stalling the scale gesture.
    // On software WebGL, never begin a new heavy Planet while presentation is
    // hidden (System prewarm or a parked Galaxy target). An already-warmed
    // instance exits above via warmedKey and remains retained; a missing one
    // starts only when the close-world presentation actually asks for it.
    if (softwareRenderer && !presentationActive) {
      return;
    }

    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let warmupTimer: number | null = null;
    let idleHandle: number | null = null;
    let fallbackTimer: number | null = null;
    const idleWindow = window as IdleWindow;

    const enableLive = () => {
      if (cancelled) return;
      initialLiveStructureTier.current = softwareRenderer
        ? "software"
        : quality === "high"
          ? "high"
          : "auto";
      setWarmedKey(liveKey);
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        warmupTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (idleWindow.requestIdleCallback) {
            idleHandle = idleWindow.requestIdleCallback(enableLive, {
              timeout: 1200,
            });
          } else {
            fallbackTimer = window.setTimeout(enableLive, 120);
          }
        }, phase === "system" ? 0 : 240);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (warmupTimer !== null) window.clearTimeout(warmupTimer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
    };
  }, [
    fallbackReason,
    liveKey,
    phase,
    presentationActive,
    quality,
    softwareRenderer,
    warmedKey,
  ]);

  const livePlanet = useMemo(() => {
    if (!liveProvisioned) return null;
    const initialTier = initialLiveStructureTier.current;
    const initialMode: LiveQualityMode =
      initialTier === "high" ? "high" : "auto";
    const nextPlanet = new Planet({
      preset: presetFor(planet),
      seed: hashSeed(planet.seed),
      radius: LIVE_PLANET_RADIUS,
      lightSource: sunDirection,
      name: planet.name,
      // Construct directly at the quality that actually triggered warmup.
      // Direct HIGH therefore avoids an AUTO -> HIGH structural rebuild,
      // while an AUTO-first world can still promote exactly once later.
      ...liveStructuralQuality(initialMode, softwareRenderer),
      ...liveDynamicQuality(initialMode, softwareRenderer),
    });
    const html = document.documentElement;
    html.dataset.universeWorldPlanetAllocations = String(
      Number(html.dataset.universeWorldPlanetAllocations ?? "0") + 1,
    );
    return nextPlanet;
  }, [liveProvisioned, planet, softwareRenderer, sunDirection]);

  useEffect(() => {
    return () => {
      if (livePlanet) onBeforeLivePlanetDispose?.(livePlanet);
      livePlanet?.dispose();
    };
  }, [livePlanet, onBeforeLivePlanetDispose]);

  useEffect(() => {
    if (!livePlanet || fallbackReason) {
      delete document.documentElement.dataset.universeWorldLiveProfile;
      delete document.documentElement.dataset.universeWorldLiveStructure;
      return;
    }

    const liveMode = quality === "high" ? "high" : "auto";
    const profileKey = softwareRenderer
      ? "software-high"
      : (`gpu-${liveMode}` as "gpu-auto" | "gpu-high");
    const applied = appliedLiveProfile.current;

    const currentStructure = liveStructure.current;
    if (currentStructure?.planet !== livePlanet) {
      liveStructure.current = {
        planet: livePlanet,
        tier: initialLiveStructureTier.current,
      };
    }

    if (
      !softwareRenderer &&
      liveMode === "high" &&
      liveStructure.current?.tier !== "high"
    ) {
      // The package marks chunkRes/maxDepth as structural rebuild keys. Promote
      // once, then never demote this Planet, so repeated quality toggles cannot
      // keep throwing away and recreating the LOD world.
      livePlanet.set(liveStructuralQuality("high", false));
      liveStructure.current = { planet: livePlanet, tier: "high" };
      const html = document.documentElement;
      html.dataset.universeWorldStructuralPromotions = String(
        Number(html.dataset.universeWorldStructuralPromotions ?? "0") + 1,
      );
    }

    if (applied?.planet !== livePlanet || applied.key !== profileKey) {
      livePlanet.set(liveDynamicQuality(liveMode, softwareRenderer));
      appliedLiveProfile.current = {
        planet: livePlanet,
        key: profileKey,
      };
      const html = document.documentElement;
      html.dataset.universeWorldLiveProfileUpdates = String(
        Number(html.dataset.universeWorldLiveProfileUpdates ?? "0") + 1,
      );
    }
    document.documentElement.dataset.universeWorldLiveProfile = profileKey;
    document.documentElement.dataset.universeWorldLiveStructure =
      liveStructure.current?.tier ?? "auto";

    return () => {
      delete document.documentElement.dataset.universeWorldLiveProfile;
      delete document.documentElement.dataset.universeWorldLiveStructure;
    };
  }, [fallbackReason, livePlanet, quality, softwareRenderer]);

  useEffect(
    () => () => {
      fallbackSurfaceTexture?.dispose();
    },
    [fallbackSurfaceTexture],
  );

  useEffect(() => {
    document.documentElement.dataset.universeWorldSceneReady = "true";
    document.documentElement.dataset.universeWorldSceneLifecycle =
      worldPresentationActive
        ? "active"
        : phase === "system"
          ? "prewarming"
          : "parked";
    return () => {
      publishPaintStarted(false);
      publishPaintReady(false);
      delete document.documentElement.dataset.universeWorldSceneReady;
      delete document.documentElement.dataset.universeWorldSceneLifecycle;
      delete document.documentElement.dataset.universeWorldCapability;
    };
  }, [publishPaintReady, publishPaintStarted]);

  useEffect(() => {
    document.documentElement.dataset.universeWorldSceneLifecycle =
      worldPresentationActive
        ? "active"
        : phase === "system"
          ? "prewarming"
          : "parked";
  }, [phase, presentationActive, worldPresentationActive]);

  useEffect(() => {
    const capability = fallbackReason
      ? `fallback-${fallbackReason}`
      : "procedural-planets-live";
    document.documentElement.dataset.universeWorldCapability = capability;

    // First-paint readiness is valid only for the currently visible renderer
    // identity. Hiding the world for the System endpoint, changing quality, or
    // selecting another planet invalidates the old paint even if the retained
    // resource instance can be reused underneath.
    paintedFrames.current = 0;
    lastLiveDrawFrame.current = Number(
      document.documentElement.dataset.universeWorldLiveDrawFrame ?? "0",
    );
    publishPaintStarted(false);
    publishPaintReady(false);

    return () => {
      if (
        document.documentElement.dataset.universeWorldCapability === capability
      ) {
        delete document.documentElement.dataset.universeWorldCapability;
      }
    };
  }, [
    fallbackReason,
    liveKey,
    worldPresentationActive,
    publishPaintReady,
    publishPaintStarted,
  ]);

  useEffect(() => {
    const mode = fallbackReason
      ? `procedural-planets-fallback-${fallbackReason}`
      : livePlanet
        ? "procedural-planets-live"
        : "procedural-planets-warmup";
    document.documentElement.dataset.universeWorldRenderer = mode;
    if (fallbackSurfaceMap) {
      document.documentElement.dataset.universeWorldFallbackSurface =
        "generated-texture";
    } else {
      delete document.documentElement.dataset.universeWorldFallbackSurface;
    }
    return () => {
      if (
        document.documentElement.dataset.universeWorldRenderer === mode
      ) {
        delete document.documentElement.dataset.universeWorldRenderer;
      }
      delete document.documentElement.dataset.universeWorldFallbackSurface;
    };
  }, [fallbackReason, fallbackSurfaceMap, livePlanet]);

  useFrame((_, delta) => {
    // Freeze the live planet for the entire final Atmosphere->Surface
    // interval, not only after the semantic Surface boundary. LiveSurfaceAnchor
    // publishes one terrain-derived landing frame as soon as position > 4; if
    // the body kept rotating after that publication, the rendered patch would
    // drift away from the camera frame during the remainder of 4->5. Reversal
    // below/equal 4 resumes rotation from the exact frozen orientation.
    if (
      worldPresentationActive &&
      livePlanet &&
      !fallbackReason &&
      phase !== "surface" &&
      worldScalePosition <= 4
    ) {
      livePlanet.rotation.y += delta * 0.014;
    }

    // Retained worlds stay mounted through System/Galaxy so their resources
    // survive reversal, but a parked renderer has no paint authority. Avoid
    // polling pipeline/profile DOM state on every hidden frame.
    if (!worldPresentationActive) return;

    const expectedLiveProfile = softwareRenderer
      ? "software-high"
      : quality === "high"
        ? "gpu-high"
        : "gpu-auto";
    const concreteRendererReady =
      Boolean(fallbackReason) ||
      (Boolean(livePlanet) &&
        document.documentElement.dataset.universeWorldPipeline ===
          "procedural-planets-pass" &&
        document.documentElement.dataset.universeWorldLiveProfile ===
          expectedLiveProfile);

    if (
      worldPresentationActive &&
      !paintReported.current &&
      concreteRendererReady
    ) {
      if (fallbackReason) {
        // The lightweight fallback is part of the ordinary R3F render, so two
        // presented frames are enough to hand off from System.
        paintedFrames.current += 1;
      } else {
        // Live authority comes only from PlanetRenderer itself. The pipeline
        // publishes this counter after a frame where a planet was actually
        // drawn and no shader/program work remained pending. Because this
        // component runs before the priority-1 pipeline frame, seeing a new
        // stamp here proves the previous browser frame really contained the
        // matched live world.
        const liveDrawFrame = Number(
          document.documentElement.dataset.universeWorldLiveDrawFrame ?? "0",
        );
        if (liveDrawFrame > lastLiveDrawFrame.current) {
          lastLiveDrawFrame.current = liveDrawFrame;
          paintedFrames.current += 1;
        } else {
          paintedFrames.current = 0;
        }
      }

      if (paintedFrames.current >= 1) {
        publishPaintStarted(true);
      }
      if (paintedFrames.current >= 2) {
        publishPaintReady(true);
      }
    }
  });

  return (
    <>
      {worldPresentationActive ? (
        <color attach="background" args={["#000106"]} />
      ) : null}
      <group visible={worldPresentationActive}>
      <DeepSky />
      <Stars
        radius={78}
        depth={30}
        count={softwareRenderer ? 600 : quality === "low" ? 600 : 1400}
        factor={1.6}
        saturation={0.16}
        fade
        speed={phase === "surface" ? 0 : 0.08}
      />

      <ambientLight intensity={0.34} />
      <directionalLight
        // Keep the lightweight fallback on the exact same stellar light axis
        // as ProceduralPlanets. The old +Z work light only looked correct from
        // the previous night-side Orbit shot.
        position={[sunDirection.x, sunDirection.y, sunDirection.z]}
        intensity={3.8}
        color="#ffe0aa"
      />

      <group position={STAR_POSITION}>
        <mesh>
          <sphereGeometry args={[1.25, 48, 48]} />
          <meshBasicMaterial toneMapped={false}>
            <color attach="color" args={[5.0, 3.5, 1.65]} />
          </meshBasicMaterial>
        </mesh>
      </group>

      <group
        position={PLANET_ANCHOR}
        rotation={[0.08, -0.65, -0.16]}
      >
        <mesh scale={FALLBACK_WORLD_RADIUS}>
          <sphereGeometry args={[1, 64, 64]} />
          <meshStandardMaterial
            color={
              fallbackSurfaceMap
                ? "#ffffff"
                : fallbackColor(planet.archetype)
            }
            map={fallbackSurfaceMap}
            roughness={0.82}
            metalness={0.02}
          />
        </mesh>
        {livePlanet ? (
          <primitive
            object={livePlanet}
            visible={!fallbackReason}
            scale={LIVE_WORLD_RADIUS / LIVE_PLANET_RADIUS}
          />
        ) : null}
      </group>

      {(phase === "surface" || worldScalePosition > 4) &&
      livePlanet &&
      !fallbackReason ? (
        <LiveSurfaceAnchor
          planet={livePlanet}
          onCameraFrame={onSurfaceCameraFrame}
        />
      ) : null}
      </group>
    </>
  );
}
