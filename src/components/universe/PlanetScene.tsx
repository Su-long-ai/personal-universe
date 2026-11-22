import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Planet } from "procedural-planets";
import { AdditiveBlending, Color, Group, Vector3 } from "three";
import { PLANET_ANCHOR, type PlanetDefinition, type QualityMode } from "../../lib/universe/types";
import { DeepSky } from "./DeepSky";

const STAR_POSITION: [number, number, number] = [-12.5, 5.5, -18];
const LIVE_PLANET_RADIUS = 2000;
const LIVE_WORLD_RADIUS = 3.65;
const FALLBACK_WORLD_RADIUS = 3.48;

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function presetFor(planet: PlanetDefinition) {
  if (planet.id === "hero-aurelia") return "ocean" as const;
  const palette = ["terran", "desert", "ice", "moon", "lava", "ocean", "mars"] as const;
  return palette[hashSeed(planet.id) % palette.length];
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
  const planetRef = useRef<Group>(null);
  const preset = presetFor(planet);
  const seed = useMemo(() => hashSeed(planet.id) || 1, [planet.id]);
  const sunDirection = useMemo(
    () =>
      new Vector3(
        STAR_POSITION[0] - PLANET_ANCHOR[0],
        STAR_POSITION[1] - PLANET_ANCHOR[1],
        STAR_POSITION[2] - PLANET_ANCHOR[2],
      ).normalize(),
    [],
  );
  const livePlanet = useMemo(
    () =>
      new Planet({
        preset,
        seed,
        radius: LIVE_PLANET_RADIUS,
        lightSource: sunDirection,
        name: planet.name,
        ...liveQuality(quality),
      }),
    [planet.name, preset, quality, seed, sunDirection],
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

  useFrame((state, delta) => {
    if (planetRef.current) {
      planetRef.current.rotation.y = state.clock.elapsedTime * 0.015;
    }
    livePlanet.rotation.y += delta * 0.006;
  });

  const fallback = new Color(planet.accent).multiplyScalar(0.46);

  return (
    <>
      <DeepSky quality={quality} />
      <ambientLight intensity={0.16} color="#7a91bd" />
      <directionalLight
        position={STAR_POSITION}
        intensity={3.2}
        color="#ffe3b3"
      />

      <group
        ref={planetRef}
        position={PLANET_ANCHOR}
        rotation={[0.08, -0.34, 0.03]}
      >
        <primitive
          object={livePlanet}
          scale={LIVE_WORLD_RADIUS / LIVE_PLANET_RADIUS}
        />
        <mesh>
          <sphereGeometry args={[FALLBACK_WORLD_RADIUS, 64, 64]} />
          <meshStandardMaterial
            color={fallback}
            roughness={0.82}
            metalness={0.02}
          />
        </mesh>
        <mesh scale={1.075}>
          <sphereGeometry args={[FALLBACK_WORLD_RADIUS, 48, 48]} />
          <meshBasicMaterial
            color={planet.accent}
            transparent
            opacity={0.035}
            blending={AdditiveBlending}
            depthWrite={false}
            side={2}
          />
        </mesh>
      </group>

      <group position={STAR_POSITION}>
        <pointLight intensity={95} distance={110} color="#ffd6a1" />
        <mesh>
          <sphereGeometry args={[0.55, 24, 24]} />
          <meshBasicMaterial color="#ffe2b8" />
        </mesh>
        <mesh scale={2.6}>
          <sphereGeometry args={[0.55, 24, 24]} />
          <meshBasicMaterial
            color="#ffc47a"
            transparent
            opacity={0.1}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    </>
  );
}
