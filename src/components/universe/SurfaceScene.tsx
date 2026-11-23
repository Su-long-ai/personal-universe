import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
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

export function SurfaceScene({ anchored = false }: { anchored?: boolean }) {
  const [active, setActive] = useState(false);
  const [anchorHeight, setAnchorHeight] = useState(4.8);
  const [terrainEnabled, setTerrainEnabled] = useState(!anchored);

  const handleAnchorHeight = useCallback((height: number) => {
    setAnchorHeight(height);
    document.documentElement.dataset.universeSurfaceTerrainState = "ready";
  }, []);

  useEffect(() => {
    if (!anchored) {
      setTerrainEnabled(true);
      return;
    }

    // ProceduralTerrains preparation can synchronously monopolize SwiftShader.
    // Give the landing frame and a possible immediate reverse-scale gesture a
    // stable window first. If Surface remains active, progressively start the
    // existing terrain fallback during browser idle time.
    const idleWindow = window as IdleWindow;
    let cancelled = false;
    let idleHandle: number | null = null;
    document.documentElement.dataset.universeSurfaceTerrainState = "deferred";

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const enable = () => {
        if (cancelled) return;
        document.documentElement.dataset.universeSurfaceTerrainState =
          "preparing";
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
  }, [anchored]);

  const content = (
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
        intensity={active ? 7 : 2.8}
        distance={11}
        color={active ? "#ffb46d" : "#74d8ff"}
      />

      <Suspense fallback={null}>
        {terrainEnabled ? (
          <SurfaceTerrain onAnchorHeight={handleAnchorHeight} />
        ) : null}
      </Suspense>

      <DistantMoon />
      <ArrivalBeacon
        active={active}
        height={anchorHeight}
        onToggle={() => setActive((value) => !value)}
      />
    </>
  );

  useEffect(() => {
    if (!anchored) return;
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
  }, [anchored]);

  return (
    <>
      <color attach="background" args={["#030b12"]} />
      <fog attach="fog" args={["#07141d", 34, 118]} />
      {content}
    </>
  );
}
