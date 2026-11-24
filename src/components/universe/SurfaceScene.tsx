import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { QualityMode, UniversePhase } from "../../lib/universe/types";
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

function ArrivalBeacon({ active, onToggle, height }: { active: boolean; onToggle: () => void; height: number }) {
  const beacon = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!beacon.current) return;
    beacon.current.rotation.y += delta * 0.12;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.55) * 0.035;
    beacon.current.scale.setScalar(active ? pulse * 1.06 : pulse);
  });

  return (
    <group ref={beacon} position={[0.4, height, -5.4]} onClick={onToggle}>
      <mesh scale={[0.1, 1.45, 0.1]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={active ? "#ffd7a0" : "#b9e8ff"}
          emissive={active ? "#ff9a45" : "#5ac8ff"}
          emissiveIntensity={active ? 4.5 : 2.2}
          metalness={0.64}
          roughness={0.22}
        />
      </mesh>
      <mesh position={[0, 0.65, 0]} scale={active ? 0.42 : 0.3}>
        <sphereGeometry args={[0.24, 24, 24]} />
        <meshBasicMaterial
          color={active ? "#ffd9a0" : "#7fd8ff"}
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
  hasPlanet,
}: {
  anchored?: boolean;
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  quality: QualityMode;
  hasPlanet: boolean;
}) {
  const { gl } = useThree();
  const softwareRenderer = isSoftwareRenderer(gl);
  const surfaceGroupRef = useRef<THREE.Group>(null);
  const [beaconActive, setBeaconActive] = useState(false);
  const [anchorHeight, setAnchorHeight] = useState(4.8);
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const active =
    anchored &&
    hasPlanet &&
    phase === "surface" &&
    Boolean(liveWorldFallbackReason(gl, quality));

  const handleAnchorHeight = useCallback((height: number) => {
    setAnchorHeight(height);
    document.documentElement.dataset.universeSurfaceTerrainState = "ready";
  }, []);

  useFrame(() => {
    const group = surfaceGroupRef.current;
    if (!group) return;

    // React may not have reconciled the new phase into the R3F subtree yet
    // when software rendering is saturated. The navigation coordinator updates
    // phaseRef synchronously in the wheel handler, so hide the heavy retained
    // Surface group before the next render as soon as that intent leaves
    // Surface. This is presentation-only gating; React phase remains the
    // navigation authority and will reconcile the same visibility normally.
    group.visible = active && phaseRef.current === "surface";
  }, -100);

  useEffect(() => {
    if (!active) {
      // Once the fallback terrain has been created, keep that same instance
      // mounted under the shared Canvas and let SurfaceTerrain publish
      // lifecycle="parked". Its active/phaseRef guards pause all update work;
      // actual disposal remains owned by Canvas teardown.
      delete document.documentElement.dataset.universeSurfaceTerrainState;
      return;
    }

    // A previously prepared terrain is the retained fallback. Re-entering
    // Surface must resume it rather than scheduling a second FiniteTerrain.
    if (terrainEnabled) return;

    const idleWindow = window as IdleWindow;
    let cancelled = false;
    let idleHandle: number | null = null;
    document.documentElement.dataset.universeSurfaceTerrainState = "deferred";

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const enable = () => {
        if (cancelled) return;
        document.documentElement.dataset.universeSurfaceTerrainState = "preparing";
        setTerrainEnabled(true);
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(enable, { timeout: 650 });
      } else {
        enable();
      }
    }, 480);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      delete document.documentElement.dataset.universeSurfaceTerrainState;
    };
  }, [active, terrainEnabled]);

  const content = (
    <>
      <hemisphereLight args={["#7da6c8", "#101617", 1.15]} />
      <directionalLight
        position={[-12, 9, 4]}
        intensity={4.6}
        color="#ffc27d"
        castShadow
      />
      {!softwareRenderer ? (
        <pointLight
          position={[0.4, anchorHeight + 1.0, -5.4]}
          intensity={beaconActive ? 7 : 2.8}
          distance={11}
          color={beaconActive ? "#ffb46d" : "#74d8ff"}
        />
      ) : null}

      <Suspense fallback={null}>
        {terrainEnabled ? (
          <SurfaceTerrain
            active={active}
            phaseRef={phaseRef}
            onAnchorHeight={handleAnchorHeight}
          />
        ) : null}
      </Suspense>

      {!softwareRenderer ? (
        <>
          <DistantMoon />
          <ArrivalBeacon
            active={beaconActive}
            height={anchorHeight}
            onToggle={() => setBeaconActive((value) => !value)}
          />
        </>
      ) : null}
    </>
  );

  useEffect(() => {
    if (!active) return;
    document.documentElement.dataset.universeSurfaceRenderer =
      "procedural-terrains-fallback";
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceRenderer ===
        "procedural-terrains-fallback"
      ) {
        delete document.documentElement.dataset.universeSurfaceRenderer;
      }
    };
  }, [active]);

  return (
    <>
      {active ? (
        <>
          <color attach="background" args={["#030b12"]} />
          {!softwareRenderer ? (
            <fog attach="fog" args={["#07141d", 34, 118]} />
          ) : null}
        </>
      ) : null}
      <group ref={surfaceGroupRef} visible={active}>{content}</group>
    </>
  );
}
