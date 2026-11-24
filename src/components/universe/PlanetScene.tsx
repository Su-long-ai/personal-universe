import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { Planet } from "procedural-planets";
import * as THREE from "three";
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
    if (!group.current) return;

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

function liveQuality(
  quality: QualityMode,
  softwareRenderer: boolean,
) {
  if (quality === "low") {
    return {
      cloudQuality: 32,
      cloudResolution: 0.35,
      chunkRes: 16,
      maxDepth: 4,
      splitFactor: 2.1,
    } as const;
  }

  // HIGH remains a live ProceduralPlanets renderer under SwiftShader, but
  // software rasterizers get a conservative terrain budget so hosted Linux
  // can reach a stable landing frame without starving browser teardown.
  if (softwareRenderer) {
    return {
      cloudQuality: 32,
      cloudResolution: 0.35,
      chunkRes: 16,
      maxDepth: 5,
      splitFactor: 2.3,
    } as const;
  }

  if (quality === "high") {
    return {
      cloudQuality: 72,
      cloudResolution: 0.6,
      chunkRes: 32,
      maxDepth: 6,
      splitFactor: 2.7,
    } as const;
  }
  return {
    cloudQuality: 56,
    cloudResolution: 0.5,
    chunkRes: 24,
    maxDepth: 5,
    splitFactor: 2.4,
  } as const;
}

export function PlanetScene({
  planet,
  quality,
  phase,
  onSurfaceCameraFrame,
}: {
  planet: PlanetDefinition;
  quality: QualityMode;
  phase: UniversePhase;
  onSurfaceCameraFrame: (frame: SurfaceCameraFrame | null) => void;
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
  const liveKey = `${planet.id}:${quality}:${softwareRenderer ? "software" : "gpu"}`;
  const [warmedKey, setWarmedKey] = useState<string | null>(null);
  const liveEnabled = warmedKey === liveKey && !fallbackReason;

  useEffect(() => {
    if (fallbackReason) return;

    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let warmupTimer: number | null = null;
    let idleHandle: number | null = null;
    let fallbackTimer: number | null = null;
    const idleWindow = window as IdleWindow;

    const enableLive = () => {
      if (!cancelled) setWarmedKey(liveKey);
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
        }, 1800);
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
  }, [fallbackReason, liveKey]);

  const livePlanet = useMemo(() => {
    if (!liveEnabled) return null;
    return new Planet({
      preset: presetFor(planet),
      seed: hashSeed(planet.seed),
      radius: LIVE_PLANET_RADIUS,
      lightSource: sunDirection,
      name: planet.name,
      ...liveQuality(quality, softwareRenderer),
    });
  }, [liveEnabled, planet, quality, softwareRenderer, sunDirection]);

  useEffect(() => {
    return () => {
      livePlanet?.dispose();
    };
  }, [livePlanet]);

  useEffect(() => {
    document.documentElement.dataset.universeWorldSceneReady = "true";
    return () => {
      delete document.documentElement.dataset.universeWorldSceneReady;
    };
  }, []);

  useEffect(() => {
    const mode = livePlanet
      ? "procedural-planets-live"
      : fallbackReason
        ? `procedural-planets-fallback-${fallbackReason}`
        : "procedural-planets-warmup";
    document.documentElement.dataset.universeWorldRenderer = mode;
    return () => {
      if (
        document.documentElement.dataset.universeWorldRenderer === mode
      ) {
        delete document.documentElement.dataset.universeWorldRenderer;
      }
    };
  }, [fallbackReason, livePlanet]);

  useFrame((_, delta) => {
    // Once landed, keep the terrain under the visitor fixed. Orbit/approach
    // retain the subtle planetary rotation.
    if (livePlanet && phase !== "surface") {
      livePlanet.rotation.y += delta * 0.014;
    }
  });

  if (phase === "surface" && fallbackReason) {
    // UniverseCanvas owns the longer-lived fallback SurfaceScene. Keeping
    // that host mounted across phase changes prevents FiniteTerrain.dispose()
    // from landing on the Surface -> Atmosphere input-critical path.
    return null;
  }

  return (
    <>
      <color attach="background" args={["#000106"]} />
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
        position={[-8, 5, 8]}
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
            color={fallbackColor(planet.archetype)}
            roughness={0.76}
            metalness={0.02}
          />
        </mesh>
        {livePlanet ? (
          <primitive
            object={livePlanet}
            scale={LIVE_WORLD_RADIUS / LIVE_PLANET_RADIUS}
          />
        ) : null}
      </group>

      {phase === "surface" && livePlanet ? (
        <LiveSurfaceAnchor
          planet={livePlanet}
          onCameraFrame={onSurfaceCameraFrame}
        />
      ) : null}
    </>
  );
}
