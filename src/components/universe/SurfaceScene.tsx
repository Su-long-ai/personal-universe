import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PlanetDefinition, QualityMode, UniversePhase } from "../../lib/universe/types";
import {
  SURFACE_STELLAR_LIGHT_DIRECTION,
  buildSurfaceWorldProfile,
} from "../../lib/universe/surface";
import {
  isSoftwareRenderer,
  liveWorldFallbackReason,
} from "./CinematicPipeline";
import { SurfaceTerrain } from "./SurfaceTerrain";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function ArrivalBeacon({
  active,
  running,
  onToggle,
  height,
  accent,
  landing,
  softwareLite = false,
}: {
  active: boolean;
  running: boolean;
  onToggle: () => void;
  height: number;
  accent: string;
  landing: [number, number];
  softwareLite?: boolean;
}) {
  const beacon = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (softwareLite || !running || !beacon.current) return;
    beacon.current.rotation.y += delta * 0.12;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.55) * 0.035;
    beacon.current.scale.setScalar(active ? pulse * 1.06 : pulse);
  });

  if (softwareLite) {
    return (
      <group position={[landing[0] + 0.8, height + 0.2, landing[1] - 5.6]} onClick={onToggle}>
        <mesh position={[0, 0.82, 0]}>
          <cylinderGeometry args={[0.045, 0.09, 1.7, 6]} />
          <meshBasicMaterial
            color={active ? "#ffd39a" : accent}
            transparent
            opacity={0.82}
          />
        </mesh>
        <mesh position={[0, 1.78, 0]}>
          <octahedronGeometry args={[0.17, 0]} />
          <meshBasicMaterial color={active ? "#fff0cf" : accent} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.22, 0.31, 12]} />
          <meshBasicMaterial
            color={active ? "#ffb66f" : accent}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  return (
    <group ref={beacon} position={[landing[0], height, landing[1]]} onClick={onToggle}>
      <mesh scale={[0.1, 1.45, 0.1]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={active ? "#ffd7a0" : accent}
          emissive={active ? "#ff9a45" : accent}
          emissiveIntensity={active ? 4.5 : 2.2}
          metalness={0.64}
          roughness={0.22}
        />
      </mesh>
      <mesh position={[0, 0.65, 0]} scale={active ? 0.42 : 0.3}>
        <sphereGeometry args={[0.24, 24, 24]} />
        <meshBasicMaterial
          color={active ? "#ffd9a0" : accent}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

function DistantMoon() {
  return (
    <group position={[20, 15, -48]}>
      <mesh>
        <sphereGeometry args={[5.8, 64, 64]} />
        <meshStandardMaterial
          color="#9aa5ad"
          roughness={0.95}
          metalness={0}
          emissive="#1b232b"
          emissiveIntensity={0.12}
        />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[5.8, 48, 48]} />
        <meshBasicMaterial
          color="#8fcaff"
          transparent
          opacity={0.055}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function SurfaceScene({
  anchored = false,
  phase,
  phaseRef,
  quality,
  planet,
  surfaceFocusEntryId,
  onSurfaceFocusEntry,
  ready,
  presentationPermitted,
  onReadyChange,
}: {
  anchored?: boolean;
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  quality: QualityMode;
  planet: PlanetDefinition | null;
  surfaceFocusEntryId: string | null;
  onSurfaceFocusEntry: (entryId: string) => void;
  ready: boolean;
  presentationPermitted: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const { gl, scene } = useThree();
  const softwareRenderer = isSoftwareRenderer(gl);
  const profile = useMemo(
    () => (planet ? buildSurfaceWorldProfile(planet) : null),
    [planet],
  );
  const softwareHorizonBackground = useMemo(() => {
    if (!softwareRenderer) return null;
    const horizon = new THREE.Color(profile?.atmosphere.horizon ?? "#59645e");
    const zenith = new THREE.Color(profile?.atmosphere.zenith ?? "#010204");
    const sample = new THREE.Color();
    const data = new Uint8Array(8 * 4);
    for (let index = 0; index < 8; index += 1) {
      const t = Math.pow(index / 7, 1.45);
      sample.lerpColors(horizon, zenith, t);
      data[index * 4] = Math.round(sample.r * 255);
      data[index * 4 + 1] = Math.round(sample.g * 255);
      data[index * 4 + 2] = Math.round(sample.b * 255);
      data[index * 4 + 3] = 255;
    }
    const texture = new THREE.DataTexture(data, 1, 8, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }, [profile?.id, softwareRenderer]);
  const backgroundLease = useRef<{
    installed: THREE.Texture | null;
    previous: THREE.Scene["background"];
  }>({ installed: null, previous: null });
  const releaseBackground = useCallback(() => {
    const lease = backgroundLease.current;
    if (!lease.installed) return;
    if (scene.background === lease.installed) {
      scene.background = lease.previous;
    }
    lease.installed = null;
    lease.previous = null;
  }, [scene]);
  const surfaceGroupRef = useRef<THREE.Group>(null);
  const surfacePaintReadyReported = useRef(false);
  const [beaconActive, setBeaconActive] = useState(false);
  const [anchorHeight, setAnchorHeight] = useState(4.8);
  const [terrainWorldId, setTerrainWorldId] = useState<string | null>(null);

  useEffect(() => {
    // These are local presentation states for one world, not product
    // navigation state. Never let a retained fallback carry them into another
    // generated world while its new terrain is preparing.
    setBeaconActive(false);
    setAnchorHeight(4.8);
    setTerrainWorldId((current) =>
      current === profile?.id ? current : null,
    );
    onReadyChange?.(false);
  }, [onReadyChange, profile?.id]);

  const landable = Boolean(profile && planet?.surfaceMode !== "none");
  const surfaceRequested =
    anchored &&
    landable &&
    phase === "surface" &&
    Boolean(liveWorldFallbackReason(gl, quality));
  const presentationActive = surfaceRequested && ready && presentationPermitted;
  const prepare =
    anchored &&
    landable &&
    (phase === "atmosphere" || phase === "surface") &&
    Boolean(liveWorldFallbackReason(gl, quality));

  useEffect(
    () => () => {
      if (backgroundLease.current.installed === softwareHorizonBackground) {
        releaseBackground();
      }
      softwareHorizonBackground?.dispose();
    },
    [releaseBackground, softwareHorizonBackground],
  );

  const handleAnchorHeight = useCallback((height: number) => {
    setAnchorHeight(height);
    document.documentElement.dataset.universeSurfaceTerrainState = "ready";
    document.documentElement.dataset.universeSurfacePrewarm = "ready";
    onReadyChange?.(true);
  }, [onReadyChange]);

  useEffect(
    () => () => {
      onReadyChange?.(false);
    },
    [onReadyChange],
  );

  useFrame(() => {
    releaseBackground();
    const group = surfaceGroupRef.current;
    if (!group) return;

    // React may not have reconciled the new phase into the R3F subtree yet
    // when software rendering is saturated. The navigation coordinator updates
    // phaseRef synchronously in the wheel handler, so hide the heavy retained
    // Surface group before the next render as soon as that intent leaves
    // Surface. This is presentation-only gating; React phase remains the
    // navigation authority and will reconcile the same visibility normally.
    group.visible =
      presentationActive && phaseRef.current === "surface";
    if (group.visible && softwareHorizonBackground) {
      // A declarative attach stores a previous scene.background, which can
      // restore this Surface texture after a rapid sequence of other owners'
      // background attaches. Borrow the existing backdrop for this one
      // actual Surface draw, just like the synchronous group gate above.
      const lease = backgroundLease.current;
      lease.previous = scene.background;
      lease.installed = softwareHorizonBackground;
      scene.background = softwareHorizonBackground;
    }
  }, -100);

  useFrame(() => {
    releaseBackground();
    const group = surfaceGroupRef.current;
    const painted = Boolean(
      group?.visible &&
      presentationActive &&
      phaseRef.current === "surface",
    );
    if (surfacePaintReadyReported.current === painted) return;
    surfacePaintReadyReported.current = painted;
    if (painted) {
      // CinematicPipeline renders at priority 1. This callback runs afterwards,
      // so the token proves that one real Surface presentation frame has
      // already reached the renderer; terrain preparation alone is not paint.
      document.documentElement.dataset.universeSurfacePaintReady = "true";
    } else {
      delete document.documentElement.dataset.universeSurfacePaintReady;
    }
  }, 2);

  useEffect(
    () => () => {
      surfacePaintReadyReported.current = false;
      delete document.documentElement.dataset.universeSurfacePaintReady;
    },
    [],
  );

  useEffect(() => {
    if (!prepare || !profile) {
      // Keep a prepared terrain only while it still belongs to the selected
      // world. Same-world reverse travel parks/resumes that instance; changing
      // world identity clears terrainWorldId in the profile effect above so
      // System/Approach never eagerly compile the next world's fallback.
      delete document.documentElement.dataset.universeSurfaceTerrainState;
      document.documentElement.dataset.universeSurfacePrewarm =
        terrainWorldId === profile?.id
          ? ready
            ? "ready"
            : "preparing"
          : "cancelled";
      return;
    }

    // A retained terrain belongs to one stable world identity. It can be
    // mounted but still preparing its first complete view, so readiness stays
    // separate from retention.
    if (terrainWorldId === profile.id) {
      document.documentElement.dataset.universeSurfaceTerrainState =
        ready ? "ready" : "preparing";
      document.documentElement.dataset.universeSurfacePrewarm =
        ready ? "ready" : "preparing";
      return;
    }

    const idleWindow = window as IdleWindow;
    let cancelled = false;
    let idleHandle: number | null = null;
    document.documentElement.dataset.universeSurfaceTerrainState = "deferred";
    document.documentElement.dataset.universeSurfacePrewarm = "scheduled";

    const coordinatorStillWantsPrime = () =>
      phaseRef.current === "atmosphere" ||
      phaseRef.current === "surface";
    const cancelBeforeConstruction = () => {
      document.documentElement.dataset.universeSurfacePrewarm = "cancelled";
      delete document.documentElement.dataset.universeSurfaceTerrainState;
    };

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      // phaseRef is mutated synchronously by the scale coordinator before
      // React reconciliation. On a saturated software renderer an outward
      // wheel can therefore supersede this Atmosphere effect before its
      // cleanup runs. Never let the stale idle job cross into non-interruptible
      // ProceduralTerrains preparation after that reversal.
      if (!coordinatorStillWantsPrime()) {
        cancelBeforeConstruction();
        return;
      }
      const enable = () => {
        if (cancelled) return;
        if (!coordinatorStillWantsPrime()) {
          cancelBeforeConstruction();
          return;
        }
        document.documentElement.dataset.universeSurfaceTerrainState = "preparing";
        document.documentElement.dataset.universeSurfacePrewarm = "preparing";
        setTerrainWorldId(profile.id);
      };
      if (phase === "surface") {
        // Once Surface owns the coordinate this is required presentation work,
        // not speculative prewarm. Hosted SwiftShader can stay continuously
        // busy enough to starve requestIdleCallback, so begin the already-
        // bounded terrain prepare on this task. Atmosphere keeps idle prewarm.
        enable();
      } else if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(enable, { timeout: 650 });
      } else {
        enable();
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      delete document.documentElement.dataset.universeSurfaceTerrainState;
    };
  }, [phase, prepare, profile, ready, terrainWorldId]);

  const content = (
    <>
      {!softwareRenderer ? (
        <>
          <hemisphereLight
            args={[
              profile?.atmosphere.horizon ?? "#7da6c8",
              profile?.atmosphere.fog ?? "#101617",
              1.15,
            ]}
          />
          <directionalLight
            position={[...SURFACE_STELLAR_LIGHT_DIRECTION]}
            intensity={(profile?.lighting.sunIntensity ?? 1.45) * 3.05}
            color={
              profile
                ? new THREE.Color(...profile.lighting.sunColor)
                : "#ffc27d"
            }
            castShadow
          />
          <pointLight
            position={[profile?.landing[0] ?? 0.4, anchorHeight + 1.0, profile?.landing[1] ?? -5.4]}
            intensity={beaconActive ? 7 : 2.8}
            distance={11}
            color={beaconActive ? "#ffb46d" : (profile?.accent ?? "#74d8ff")}
          />
        </>
      ) : null}

      <Suspense fallback={null}>
        {profile && landable && terrainWorldId === profile.id ? (
          <SurfaceTerrain
            prepare={prepare}
            active={surfaceRequested}
            presenting={presentationActive}
            phaseRef={phaseRef}
            profile={profile}
            focusedEntryId={surfaceFocusEntryId}
            onFocusEntry={onSurfaceFocusEntry}
            onAnchorHeight={handleAnchorHeight}
          />
        ) : null}
      </Suspense>

      {!softwareRenderer ? <DistantMoon /> : null}
      {profile ? (
        <ArrivalBeacon
          active={beaconActive}
          running={presentationActive}
          height={anchorHeight}
          accent={profile.accent}
          landing={profile.landing}
          onToggle={() => setBeaconActive((value) => !value)}
          softwareLite={softwareRenderer}
        />
      ) : null}
    </>
  );

  useEffect(() => {
    if (!presentationActive) return;
    document.documentElement.dataset.universeSurfaceRenderer =
      "procedural-terrains-fallback";
    document.documentElement.dataset.universeSurfaceDepthCues = softwareRenderer
      ? "software-beacon"
      : "full";
    document.documentElement.dataset.universeSurfaceHorizon = softwareRenderer
      ? "generated-gradient"
      : "gpu-fog";
    if (profile) {
      document.documentElement.dataset.universeSurfaceProfile = profile.id;
      document.documentElement.dataset.universeSurfaceBiome = profile.biome;
      document.documentElement.dataset.universeSurfaceLandmarks =
        String(profile.landmarks.length);
      document.documentElement.dataset.universeSurfaceContentAnchors =
        String(profile.contentAnchors.length);
      document.documentElement.dataset.universeSurfaceContentClusters =
        String(profile.contentClusters.length);
      document.documentElement.dataset.universeSurfacePrimarySignals =
        String(
          profile.contentAnchors.filter(
            (anchor) => anchor.priority === "primary",
          ).length,
        );
      const focusedAnchor = profile.contentAnchors.find(
        (anchor) => anchor.entryId === surfaceFocusEntryId,
      );
      if (focusedAnchor) {
        document.documentElement.dataset.universeSurfaceFocusAnchor =
          focusedAnchor.id;
        document.documentElement.dataset.universeSurfaceFocusCluster =
          String(focusedAnchor.cluster);
        if (focusedAnchor.regionId) {
          document.documentElement.dataset.universeSurfaceFocusRegion =
            focusedAnchor.regionId;
        } else {
          delete document.documentElement.dataset.universeSurfaceFocusRegion;
        }
        if (focusedAnchor.landmarkId) {
          document.documentElement.dataset.universeSurfaceFocusLandmark =
            focusedAnchor.landmarkId;
          const focusedPath = profile.paths.find(
            (path) => path.landmarkId === focusedAnchor.landmarkId,
          );
          if (focusedPath) {
            document.documentElement.dataset.universeSurfaceFocusPath =
              focusedPath.id;
          } else {
            delete document.documentElement.dataset.universeSurfaceFocusPath;
          }
        } else {
          delete document.documentElement.dataset.universeSurfaceFocusLandmark;
          delete document.documentElement.dataset.universeSurfaceFocusPath;
        }
      } else {
        delete document.documentElement.dataset.universeSurfaceFocusAnchor;
        delete document.documentElement.dataset.universeSurfaceFocusCluster;
        delete document.documentElement.dataset.universeSurfaceFocusRegion;
        delete document.documentElement.dataset.universeSurfaceFocusLandmark;
        delete document.documentElement.dataset.universeSurfaceFocusPath;
      }
    }
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceRenderer ===
        "procedural-terrains-fallback"
      ) {
        delete document.documentElement.dataset.universeSurfaceRenderer;
      }
      delete document.documentElement.dataset.universeSurfaceDepthCues;
      delete document.documentElement.dataset.universeSurfaceHorizon;
      delete document.documentElement.dataset.universeSurfaceProfile;
      delete document.documentElement.dataset.universeSurfaceBiome;
      delete document.documentElement.dataset.universeSurfaceLandmarks;
      delete document.documentElement.dataset.universeSurfaceContentAnchors;
      delete document.documentElement.dataset.universeSurfaceContentClusters;
      delete document.documentElement.dataset.universeSurfacePrimarySignals;
      delete document.documentElement.dataset.universeSurfaceFocusAnchor;
      delete document.documentElement.dataset.universeSurfaceFocusCluster;
      delete document.documentElement.dataset.universeSurfaceFocusRegion;
      delete document.documentElement.dataset.universeSurfaceFocusLandmark;
      delete document.documentElement.dataset.universeSurfaceFocusPath;
    };
  }, [presentationActive, profile, softwareRenderer, surfaceFocusEntryId]);

  return (
    <>
      {presentationActive ? (
        <>
          {!softwareRenderer ? (
            <color
              attach="background"
              args={[profile?.atmosphere.zenith ?? "#030b12"]}
            />
          ) : null}
          {!softwareRenderer ? (
            <fog
              attach="fog"
              args={[profile?.atmosphere.fog ?? "#07141d", 34, 118]}
            />
          ) : null}
        </>
      ) : null}
      <group ref={surfaceGroupRef} visible={presentationActive}>{content}</group>
    </>
  );
}
