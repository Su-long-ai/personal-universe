import { useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { TEST_WORLD, type UniversePhase } from "../../lib/universe/types";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function StarLayer({
  count,
  spread,
  size,
  opacity,
  seed,
  band = false,
  color = "#eef4ff",
}: {
  count: number;
  spread: number;
  size: number;
  opacity: number;
  seed: number;
  band?: boolean;
  color?: string;
}) {
  const positions = useMemo(() => {
    const random = seededRandom(seed);
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      if (band) {
        const arm = random() * Math.PI * 2;
        const radius = Math.pow(random(), 0.5) * spread;
        data[i3] = Math.cos(arm) * radius + (random() - 0.5) * 2.1;
        data[i3 + 1] = (random() - 0.5) * (0.7 + radius / spread);
        data[i3 + 2] = Math.sin(arm) * radius * 0.36 + (random() - 0.5) * 3.2;
      } else {
        data[i3] = (random() - 0.5) * spread * 2;
        data[i3 + 1] = (random() - 0.5) * spread * 1.2;
        data[i3 + 2] = (random() - 0.5) * spread * 2;
      }
    }
    return data;
  }, [band, count, seed, spread]);

  return (
    <points rotation={band ? [0.1, -0.08, -0.18] : [0, 0, 0]}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={positions.length / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        sizeAttenuation
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Planet({
  phase,
  onSelect,
}: {
  phase: UniversePhase;
  onSelect: () => void;
}) {
  const cloudRef = useRef<THREE.Mesh>(null);
  const active = phase === "galaxy";
  const world = TEST_WORLD;
  const [surfaceTexture, cloudTexture] = useLoader(THREE.TextureLoader, [
    "/textures/aurora-albedo.png",
    "/textures/aurora-clouds.png",
  ]);
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  surfaceTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.wrapS = THREE.RepeatWrapping;

  useFrame((_, delta) => {
    if (cloudRef.current) cloudRef.current.rotation.y += delta * 0.024;
  });

  return (
    <group position={world.position} rotation={[0.08, -0.45, -0.08]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          if (active) onSelect();
        }}
        onPointerOver={() => {
          if (active) document.body.classList.add("planet-hover");
        }}
        onPointerOut={() => document.body.classList.remove("planet-hover")}
      >
        <sphereGeometry args={[world.radius, 112, 112]} />
        <meshStandardMaterial
          map={surfaceTexture}
          roughness={0.82}
          metalness={0.02}
          emissive="#03101a"
          emissiveIntensity={0.2}
        />
      </mesh>

      <mesh ref={cloudRef} scale={1.008}>
        <sphereGeometry args={[world.radius, 96, 96]} />
        <meshStandardMaterial
          map={cloudTexture}
          transparent
          opacity={0.52}
          roughness={1}
          depthWrite={false}
        />
      </mesh>

      <mesh scale={1.075}>
        <sphereGeometry args={[world.radius, 96, 96]} />
        <meshBasicMaterial
          color="#5baeff"
          transparent
          opacity={phase === "galaxy" ? 0.085 : 0.15}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <pointLight color="#76bfff" intensity={3.3} distance={7.5} decay={2} />
    </group>
  );
}

function DistantStar() {
  const glow = useLoader(THREE.TextureLoader, "/textures/star-corona.png");
  glow.colorSpace = THREE.SRGBColorSpace;

  return (
    <group position={[-10.5, -1.3, -12]}>
      <sprite scale={[13, 13, 1]}>
        <spriteMaterial
          map={glow}
          transparent
          opacity={0.72}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <mesh>
        <sphereGeometry args={[1.18, 64, 64]} />
        <meshBasicMaterial color="#fff5cf" toneMapped={false} />
      </mesh>
      <pointLight intensity={18} distance={38} color="#ffd7a0" />
    </group>
  );
}

function GalaxyBackdrop() {
  const dust = useLoader(THREE.TextureLoader, "/textures/milkyway-dust.png");
  dust.colorSpace = THREE.SRGBColorSpace;

  return (
    <mesh position={[1, 0.1, -28]} rotation={[0, 0, -0.16]} scale={[48, 15, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        map={dust}
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function GalaxyScene({
  phase,
  onSelectPlanet,
  quality,
}: {
  phase: UniversePhase;
  onSelectPlanet: () => void;
  quality: "auto" | "high" | "low";
}) {
  const high = quality !== "low";

  return (
    <>
      <color attach="background" args={["#010207"]} />
      <ambientLight intensity={0.085} />
      <directionalLight position={[-9, 5, 9]} intensity={4.9} color="#f8efdd" />

      <GalaxyBackdrop />
      <StarLayer count={high ? 2800 : 1100} spread={38} size={0.045} opacity={0.76} seed={13} />
      <StarLayer
        count={high ? 4200 : 1600}
        spread={32}
        size={0.055}
        opacity={0.2}
        seed={29}
        band
        color="#a9c3ff"
      />

      <DistantStar />
      <Planet phase={phase} onSelect={onSelectPlanet} />
    </>
  );
}
