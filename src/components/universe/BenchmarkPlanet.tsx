import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Planet } from "procedural-planets";
import { TEST_WORLD, type QualityMode, type UniversePhase } from "../../lib/universe/types";

export function BenchmarkPlanet({
  phase,
  quality,
  onSelect,
}: {
  phase: UniversePhase;
  quality: QualityMode;
  onSelect: () => void;
}) {
  const planet = useMemo(() => {
    const high = quality !== "low";
    const body = new Planet({
      preset: "terran",
      seed: 428041,
      radius: 2000,
      heightScale: 118,
      seaLevel: 0.46,
      continents: 0.69,
      waterEnabled: true,
      colDeep: [0.006, 0.026, 0.075],
      colShallow: [0.06, 0.34, 0.48],
      colSand: [0.42, 0.38, 0.29],
      colRock: [0.21, 0.23, 0.24],
      colSnow: [0.82, 0.88, 0.94],
      colGrass: [0.08, 0.16, 0.12],
      colForest: [0.025, 0.085, 0.065],
      bioJungle: [0.02, 0.095, 0.07],
      cloudColor: [0.82, 0.88, 0.95],
      cloudShadow: [0.34, 0.42, 0.58],
      cloudShadowStrength: 0.82,
      cloudCoverage: 0.48,
      cloudQuality: high ? 96 : 40,
      cloudResolution: high ? 0.75 : 0.4,
      atmoColor: [0.16, 0.39, 0.92],
      exposure: high ? 0.82 : 0.76,
      sunAzimuth: 42,
      sunElevation: 7,
    });

    body.position.set(...TEST_WORLD.position);
    body.scale.setScalar(3.65 / 2000);
    body.rotation.set(0.08, -0.65, -0.16);
    body.name = TEST_WORLD.name;
    return body;
  }, [quality]);

  useEffect(() => {
    return () => planet.dispose();
  }, [planet]);

  useFrame((_, delta) => {
    planet.rotation.y += delta * 0.018;
  });

  const active = phase === "galaxy";

  return (
    <primitive
      object={planet}
      onClick={(event: { stopPropagation: () => void }) => {
        event.stopPropagation();
        if (active) onSelect();
      }}
      onPointerOver={() => {
        if (active) document.body.classList.add("planet-hover");
      }}
      onPointerOut={() => document.body.classList.remove("planet-hover")}
    />
  );
}
