import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { bakePlanet } from "procedural-planets";
import * as THREE from "three";
import {
  PLANET_ANCHOR,
  type PlanetArchetype,
  type PlanetDefinition,
  type QualityMode,
} from "../../lib/universe/types";
import { hashSeed } from "../../lib/universe/generation";

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
  const texture = useTexture(`${import.meta.env.BASE_URL}textures/stars_milky_way.jpg`);
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

function disposeBaked(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material?.dispose();
  });
}

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function PlanetScene({
  planet,
  quality,
}: {
  planet: PlanetDefinition;
  quality: QualityMode;
}) {
  const { gl } = useThree();
  const [baked, setBaked] = useState<THREE.Group | null>(null);
  const fallback = useRef<THREE.Mesh>(null);
  const radius = 2000;

  const bakeOptions = useMemo(
    () => ({
      preset: presetFor(planet),
      seed: hashSeed(planet.seed),
      radius,
      textureSize: quality === "low" ? 256 : quality === "high" ? 1024 : 512,
    }),
    [planet, quality],
  );

  useEffect(() => {
    let cancelled = false;
    let created: THREE.Group | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let idleHandle: number | null = null;
    let fallbackTimer: number | null = null;
    const idleWindow = window as IdleWindow;

    const bake = () => {
      if (cancelled) return;

      void bakePlanet(gl, bakeOptions).then((group) => {
        created = group;
        if (cancelled) {
          disposeBaked(group);
          return;
        }
        group.position.set(...PLANET_ANCHOR);
        group.scale.setScalar(3.65 / radius);
        group.rotation.set(0.08, -0.65, -0.16);
        group.name = planet.name;
        setBaked(group);
      }).catch((error) => {
        console.warn("[planet-bake]", planet.name, error);
      });
    };

    // bakePlanet is deliberately not started in the first arrival commit.
    // ProceduralPlanets documents baking as GPU-blocking work. Two frames give
    // the lightweight fallback, HUD and navigation contract a chance to paint;
    // then an idle slot warms in the deterministic baked representation.
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(() => bake(), {
            timeout: 900,
          });
        } else {
          fallbackTimer = window.setTimeout(bake, 120);
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      setBaked(null);
      if (created) disposeBaked(created);
    };
  }, [bakeOptions, gl, planet.name]);

  useFrame((_, delta) => {
    if (baked) baked.rotation.y += delta * 0.014;
    if (fallback.current) fallback.current.rotation.y += delta * 0.014;
  });

  return (
    <>
      <color attach="background" args={["#000106"]} />
      <DeepSky />
      <Stars
        radius={78}
        depth={30}
        count={quality === "low" ? 600 : 1400}
        factor={1.6}
        saturation={0.16}
        fade
        speed={0.08}
      />

      <ambientLight intensity={0.34} />
      <directionalLight
        position={[-8, 5, 8]}
        intensity={3.8}
        color="#ffe0aa"
      />

      <group position={[-12.5, 5.5, -18]}>
        <mesh>
          <sphereGeometry args={[1.25, 48, 48]} />
          <meshBasicMaterial toneMapped={false}>
            <color attach="color" args={[5.0, 3.5, 1.65]} />
          </meshBasicMaterial>
        </mesh>
      </group>

      {baked ? (
        <primitive object={baked} />
      ) : (
        <mesh
          ref={fallback}
          position={PLANET_ANCHOR}
          scale={3.65}
        >
          <sphereGeometry args={[1, 64, 64]} />
          <meshStandardMaterial
            color={fallbackColor(planet.archetype)}
            roughness={0.76}
            metalness={0.02}
          />
        </mesh>
      )}
    </>
  );
}
