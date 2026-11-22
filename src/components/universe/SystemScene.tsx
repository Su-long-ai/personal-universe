import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import type { PlanetArchetype, PlanetDefinition, SystemDefinition } from "../../lib/universe/types";
import { hashSeed } from "../../lib/universe/generation";

function spectralColor(type: string) {
  const cls = type.charAt(0).toUpperCase();
  if (cls === "O") return "#9bb7ff";
  if (cls === "B") return "#aabfff";
  if (cls === "A") return "#d6e4ff";
  if (cls === "F") return "#fff2cf";
  if (cls === "G") return "#ffe4a3";
  if (cls === "K") return "#ffc078";
  return "#ff8c62";
}

function planetColor(type: PlanetArchetype) {
  switch (type) {
    case "ocean": return "#347da5";
    case "temperate": return "#698d6e";
    case "desert": return "#ba8a58";
    case "ice":
    case "frozen": return "#b9d5df";
    case "lava": return "#c34d28";
    case "volcanic": return "#6f5044";
    case "gas_giant": return "#b99b7c";
    case "ice_giant": return "#75a8c5";
    case "alien": return "#8d78b5";
    default: return "#7c7771";
  }
}

function compressedOrbit(planet: PlanetDefinition, index: number) {
  return 2.7 + Math.log1p(Math.max(0.05, planet.orbitAU)) * 2.1 + index * 0.72;
}

function PlanetBody({
  planet,
  index,
  onSelect,
}: {
  planet: PlanetDefinition;
  index: number;
  onSelect: (planet: PlanetDefinition) => void;
}) {
  const orbit = compressedOrbit(planet, index);
  const group = useRef<THREE.Group>(null);
  const phase = useMemo(() => (hashSeed(planet.seed) % 1000) / 1000 * Math.PI * 2, [planet.seed]);
  const size = Math.min(0.58, 0.15 + Math.log1p(planet.radiusEarth) * 0.12);

  useFrame((state) => {
    if (!group.current) return;
    const period = Math.max(0.45, planet.orbitalPeriodYears);
    group.current.rotation.y = phase + state.clock.elapsedTime * (0.055 / Math.sqrt(period));
  });

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[orbit - 0.008, orbit + 0.008, 128]} />
        <meshBasicMaterial color="#7692ad" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <group ref={group}>
        <mesh
          position={[orbit, 0, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(planet);
          }}
          onPointerOver={() => document.body.classList.add("planet-hover")}
          onPointerOut={() => document.body.classList.remove("planet-hover")}
        >
          <sphereGeometry args={[size, 28, 28]} />
          <meshStandardMaterial
            color={planetColor(planet.archetype)}
            roughness={0.78}
            metalness={0.02}
            emissive={planet.observed ? "#173044" : "#0b1118"}
            emissiveIntensity={planet.observed ? 0.38 : 0.12}
          />
        </mesh>
      </group>
    </>
  );
}

export function SystemScene({
  system,
  onSelectPlanet,
}: {
  system: SystemDefinition;
  onSelectPlanet: (planet: PlanetDefinition) => void;
}) {
  const starColor = spectralColor(system.star.spectralType);

  return (
    <>
      <color attach="background" args={["#010208"]} />
      <Stars radius={90} depth={45} count={1800} factor={1.7} saturation={0.22} fade speed={0.06} />
      <ambientLight intensity={0.18} />
      <pointLight position={[0, 0, 0]} intensity={34} distance={45} color={starColor} />

      <group rotation={[0.03, 0, -0.015]}>
        <mesh>
          <sphereGeometry args={[0.82, 48, 48]} />
          <meshBasicMaterial color={starColor} toneMapped={false} />
        </mesh>
        <mesh scale={1.9}>
          <sphereGeometry args={[0.82, 32, 32]} />
          <meshBasicMaterial
            color={starColor}
            transparent
            opacity={0.055}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {system.planets.map((planet, index) => (
          <PlanetBody
            key={planet.id}
            planet={planet}
            index={index}
            onSelect={onSelectPlanet}
          />
        ))}
      </group>
    </>
  );
}
