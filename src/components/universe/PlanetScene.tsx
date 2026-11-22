import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { Planet } from "procedural-planets";
import * as THREE from "three";
import {
  PLANET_ANCHOR,
  type PlanetArchetype,
  type PlanetDefinition,
  type QualityMode,
} from "../../lib/universe/types";
import { hashSeed } from "../../lib/universe/generation";

const STAR_POSITION: [number, number, number] = [-12.5, 5.5, -18];
const LIVE_PLANET_RADIUS = 2000;
const LIVE_WORLD_RADIUS = 3.65;
const FALLBACK_WORLD_RADIUS = 3.48;

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

function liveQuality(quality: QualityMode) {
  if (quality === "low") {
    return {
      cloudQuality: 32,
      cloudResolution: 0.35,
      chunkRes: 16,
      maxDepth: 4,
      splitFactor: 2.1,
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
}: {
  planet: PlanetDefinition;
  quality: QualityMode;
}) {
  const sunDirection = useMemo(
    () =>
      new THREE.Vector3(
        STAR_POSITION[0] - PLANET_ANCHOR[0],
        STAR_POSITION[1] - PLANET_ANCHOR[1],
        STAR_POSITION[2] - PLANET_ANCHOR[2],
      ).normalize(),
    [],
  );
  const livePlanet = useMemo(
    () =>
      new Planet({
        preset: presetFor(planet),
        seed: hashSeed(planet.seed),
        radius: LIVE_PLANET_RADIUS,
        lightSource: sunDirection,
        name: planet.name,
        ...liveQuality(quality),
      }),
    [planet, quality, sunDirection],
  );

  useEffect(() => {
    document.documentElement.dataset.universeWorldRenderer =
      "procedural-planets-live";
    return () => {
      if (
        document.documentElement.dataset.universeWorldRenderer ===
        "procedural-planets-live"
      ) {
        delete document.documentElement.dataset.universeWorldRenderer;
      }
      livePlanet.dispose();
    };
  }, [livePlanet]);

  useFrame((_, delta) => {
    livePlanet.rotation.y += delta * 0.014;
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
        <primitive
          object={livePlanet}
          scale={LIVE_WORLD_RADIUS / LIVE_PLANET_RADIUS}
        />
      </group>
    </>
  );
}
