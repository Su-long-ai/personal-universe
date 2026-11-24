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

function ArrivalBeacon({
  active,
  onToggle,
  height,
  softwareLite = false,
}: {
  active: boolean;
  onToggle: () => void;
  height: number;
  softwareLite?: boolean;
}) {
  const beacon = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (softwareLite || !beacon.current) return;
    beacon.current.rotation.y += delta * 0.12;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.55) * 0.035;
    beacon.current.scale.setScalar(active ? pulse * 1.06 : pulse);
  });

  if (softwareLite) {
    return (
      <group position={[1.2, height + 0.2, -11]} onClick={onToggle}>
        <mesh position={[0, 0.82, 0]}>
          <cylinderGeometry args={[0.045, 0.09, 1.7, 6]} />
          <meshBasicMaterial
            color={active ? "#ffd39a" : "#8bdcff"}
            transparent
            opacity={0.82}
          />
        </mesh>
        <mesh position={[0, 1.78, 0]}>
          <octahedronGeometry args={[0.17, 0]} />
          <meshBasicMaterial color={active ? "#fff0cf" : "#e1f8ff"} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.22, 0.31, 12]} />
          <meshBasicMaterial
            color={active ? "#ffb66f" : "#65d5ff"}
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
  ready,
  onReadyChange,
}: {
  anchored?: boolean;
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  quality: QualityMode;
  hasPlanet: boolean;
  ready: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const { gl } = useThree();
  const softwareRenderer = isSoftwareRenderer(gl);
  const softwareHorizonBackground = useMemo(() => {
    // 1x8 vertical gradient stored bottom -> top. It stays near-black at the
    // zenith while lifting only the software horizon band.
    const data = new Uint8Array([
      0x59, 0x64, 0x5e, 0xff,
      0x59, 0x64, 0x5e, 0xff,
      0x59, 0x64, 0x5e, 0xff,
      0x56, 0x60, 0x5b, 0xff,
      0x50, 0x5a, 0x55, 0xff,
      0x43, 0x50, 0x4c, 0xff,
      0x1c, 0x28, 0x28, 0xff,
      0x01, 0x02, 0x04, 0xff,
    ]);
    const texture = new THREE.DataTexture(data, 1, 8, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }, []);
  const surfaceGroupRef = useRef<THREE.Group>(null);
  const [beaconActive, setBeaconActive] = useState(false);
  const [anchorHeight, setAnchorHeight] = useState(4.8);
  const [terrainEnabled, setTerrainEnabled] = useState(false);
  const surfaceRequested =
    anchored &&
    hasPlanet &&
    phase === "surface" &&
    Boolean(liveWorldFallbackReason(gl, quality));
  const presentationActive = surfaceRequested && ready;
  const prepare =
    anchored &&
    hasPlanet &&
    (phase === "atmosphere" || phase === "surface") &&
    Boolean(liveWorldFallbackReason(gl, quality));

  useEffect(
    () => () => {
      softwareHorizonBackground.dispose();
    },
    [softwareHorizonBackground],
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
  }, -100);

  useEffect(() => {
    if (!prepare) {
      // Once the fallback terrain has been created, keep that same instance
      // mounted under the shared Canvas and let SurfaceTerrain publish
      // lifecycle="parked". Its active/phaseRef guards pause all update work;
      // actual disposal remains owned by Canvas teardown.
      delete document.documentElement.dataset.universeSurfaceTerrainState;
      document.documentElement.dataset.universeSurfacePrewarm = ready
        ? "ready"
        : terrainEnabled
          ? "preparing"
          : "cancelled";
      return;
    }

    // A previously enabled terrain may still be compiling/streaming its first
    // usable view. Do not call that "ready" until SurfaceTerrain has reported
    // its actual anchor/full-coverage frame.
    if (terrainEnabled) {
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

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const enable = () => {
        if (cancelled) return;
        document.documentElement.dataset.universeSurfaceTerrainState = "preparing";
        document.documentElement.dataset.universeSurfacePrewarm = "preparing";
        setTerrainEnabled(true);
      };
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(enable, { timeout: 650 });
      } else {
        enable();
      }
    }, phase === "atmosphere" ? 320 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      delete document.documentElement.dataset.universeSurfaceTerrainState;
    };
  }, [phase, prepare, ready, terrainEnabled]);

  const content = (
    <>
      {!softwareRenderer ? (
        <>
          <hemisphereLight args={["#7da6c8", "#101617", 1.15]} />
          <directionalLight
            position={[-12, 9, 4]}
            intensity={4.6}
            color="#ffc27d"
            castShadow
          />
          <pointLight
            position={[0.4, anchorHeight + 1.0, -5.4]}
            intensity={beaconActive ? 7 : 2.8}
            distance={11}
            color={beaconActive ? "#ffb46d" : "#74d8ff"}
          />
        </>
      ) : null}

      <Suspense fallback={null}>
        {terrainEnabled ? (
          <SurfaceTerrain
            prepare={prepare}
            active={surfaceRequested}
            phaseRef={phaseRef}
            onAnchorHeight={handleAnchorHeight}
          />
        ) : null}
      </Suspense>

      {!softwareRenderer ? <DistantMoon /> : null}
      <ArrivalBeacon
        active={beaconActive}
        height={anchorHeight}
        onToggle={() => setBeaconActive((value) => !value)}
        softwareLite={softwareRenderer}
      />
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
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceRenderer ===
        "procedural-terrains-fallback"
      ) {
        delete document.documentElement.dataset.universeSurfaceRenderer;
      }
      delete document.documentElement.dataset.universeSurfaceDepthCues;
      delete document.documentElement.dataset.universeSurfaceHorizon;
    };
  }, [presentationActive, softwareRenderer]);

  return (
    <>
      {presentationActive ? (
        <>
          {softwareRenderer ? (
            <primitive
              attach="background"
              object={softwareHorizonBackground}
            />
          ) : (
            <color attach="background" args={["#030b12"]} />
          )}
          {!softwareRenderer ? (
            <fog attach="fog" args={["#07141d", 34, 118]} />
          ) : null}
        </>
      ) : null}
      <group ref={surfaceGroupRef} visible={presentationActive}>{content}</group>
    </>
  );
}
