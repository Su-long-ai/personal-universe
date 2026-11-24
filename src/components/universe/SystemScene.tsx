import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
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

function planetRenderRadius(planet: PlanetDefinition) {
  return Math.min(0.58, 0.15 + Math.log1p(planet.radiusEarth) * 0.12);
}

export type SystemScaleFrame = {
  planetId: string;
  position: [number, number, number];
  radius: number;
};

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
  const size = planetRenderRadius(planet);

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
            emissive={
              planet.content?.length
                ? "#1b7d8f"
                : planet.observed
                  ? "#173044"
                  : "#0b1118"
            }
            emissiveIntensity={planet.content?.length ? 0.82 : planet.observed ? 0.38 : 0.12}
          />
        </mesh>
        {planet.content?.length ? (
          <mesh position={[orbit, 0, 0]} scale={1.42}>
            <sphereGeometry args={[size, 18, 18]} />
            <meshBasicMaterial
              color="#73f4ff"
              transparent
              opacity={0.2}
              wireframe
              depthWrite={false}
            />
          </mesh>
        ) : null}
      </group>
    </>
  );
}

export function SystemScene({
  system,
  onSelectPlanet,
  onScaleFocus,
  scaleTargetPlanet,
  handoffTargetPlanetId,
  onScaleFrame,
}: {
  system: SystemDefinition;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  onScaleFocus?: (planet: PlanetDefinition | null) => void;
  scaleTargetPlanet?: PlanetDefinition | null;
  handoffTargetPlanetId?: string | null;
  onScaleFrame?: (frame: SystemScaleFrame | null) => void;
}) {
  const starColor = spectralColor(system.star.spectralType);
  const { camera, size } = useThree();
  const focusFrameRef = useRef(0);
  const focusedIdRef = useRef<string | null>(null);
  const focusPositionRef = useRef(new THREE.Vector3());
  const focusProjectionRef = useRef(new THREE.Vector3());
  const scaleFramePositionRef = useRef(new THREE.Vector3());
  const scaleFrameIdRef = useRef<string | null>(null);
  const scaleFrameTickRef = useRef(0);
  const systemTiltRef = useRef(new THREE.Euler(0.03, 0, -0.015));

  useFrame((state) => {
    scaleFrameTickRef.current = (scaleFrameTickRef.current + 1) % 4;
    const scaleTargetChanged =
      scaleFrameIdRef.current !== (scaleTargetPlanet?.id ?? null);
    if (
      scaleTargetPlanet &&
      onScaleFrame &&
      (scaleTargetChanged || scaleFrameTickRef.current === 0)
    ) {
      const index = system.planets.findIndex(
        (planet) => planet.id === scaleTargetPlanet.id,
      );
      if (index >= 0) {
        const orbit = compressedOrbit(scaleTargetPlanet, index);
        const period = Math.max(0.45, scaleTargetPlanet.orbitalPeriodYears);
        const phase =
          ((hashSeed(scaleTargetPlanet.seed) % 1000) / 1000) * Math.PI * 2 +
          state.clock.elapsedTime * (0.055 / Math.sqrt(period));
        const position = scaleFramePositionRef.current
          .set(
            Math.cos(phase) * orbit,
            0,
            -Math.sin(phase) * orbit,
          )
          .applyEuler(systemTiltRef.current);
        scaleFrameIdRef.current = scaleTargetPlanet.id;
        onScaleFrame({
          planetId: scaleTargetPlanet.id,
          position: [position.x, position.y, position.z],
          radius: planetRenderRadius(scaleTargetPlanet),
        });
      }
    } else if (
      !scaleTargetPlanet &&
      onScaleFrame &&
      scaleFrameIdRef.current !== null
    ) {
      scaleFrameIdRef.current = null;
      onScaleFrame(null);
    }

    if (!onScaleFocus) return;
    focusFrameRef.current = (focusFrameRef.current + 1) % 6;
    if (focusFrameRef.current !== 0) return;

    let best: { planet: PlanetDefinition; distance: number } | null = null;
    for (let index = 0; index < system.planets.length; index += 1) {
      const planet = system.planets[index];
      const orbit = compressedOrbit(planet, index);
      const period = Math.max(0.45, planet.orbitalPeriodYears);
      const phase =
        ((hashSeed(planet.seed) % 1000) / 1000) * Math.PI * 2 +
        state.clock.elapsedTime * (0.055 / Math.sqrt(period));
      const projected = focusProjectionRef.current
        .copy(
          focusPositionRef.current.set(
            Math.cos(phase) * orbit,
            0,
            -Math.sin(phase) * orbit,
          ),
        )
        .applyEuler(systemTiltRef.current)
        .project(camera);

      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot(
        projected.x * size.width * 0.5,
        projected.y * size.height * 0.5,
      );
      if (distance <= 92 && (!best || distance < best.distance)) {
        best = { planet, distance };
      }
    }

    const nextId = best?.planet.id ?? null;
    if (focusedIdRef.current === nextId) return;
    focusedIdRef.current = nextId;
    onScaleFocus(best?.planet ?? null);
  });

  useEffect(
    () => () => {
      if (focusedIdRef.current !== null) onScaleFocus?.(null);
      if (scaleFrameIdRef.current !== null) onScaleFrame?.(null);
    },
    [onScaleFocus, onScaleFrame],
  );

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

        {system.planets.map((planet, index) =>
          planet.id === handoffTargetPlanetId ? null : (
            <PlanetBody
              key={planet.id}
              planet={planet}
              index={index}
              onSelect={onSelectPlanet}
            />
          ),
        )}
      </group>
    </>
  );
}
