import { useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { BenchmarkPlanet } from "./BenchmarkPlanet";
import type { QualityMode, UniversePhase } from "../../lib/universe/types";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function ParallaxStars({
  count,
  spread,
  size,
  opacity,
  seed,
}: {
  count: number;
  spread: number;
  size: number;
  opacity: number;
  seed: number;
}) {
  const { positions, colors, scales } = useMemo(() => {
    const random = seededRandom(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const warm = new THREE.Color("#ffd9ad");
    const cool = new THREE.Color("#b8d5ff");
    const white = new THREE.Color("#f7fbff");
    const mixed = new THREE.Color();

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const radius = spread * (0.25 + random() * 0.75);
      const theta = random() * Math.PI * 2;
      const z = (random() - 0.5) * spread * 1.7;
      positions[i3] = Math.cos(theta) * radius;
      positions[i3 + 1] = (random() - 0.5) * spread * 0.9;
      positions[i3 + 2] = z;

      const temperature = random();
      mixed.copy(temperature < 0.16 ? warm : temperature > 0.78 ? cool : white);
      const gain = 0.54 + random() * 0.8;
      colors[i3] = mixed.r * gain;
      colors[i3 + 1] = mixed.g * gain;
      colors[i3 + 2] = mixed.b * gain;
      scales[i] = 0.55 + Math.pow(random(), 5) * 2.8;
    }
    return { positions, colors, scales };
  }, [count, seed, spread]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: {
          uSize: { value: size },
          uOpacity: { value: opacity },
        },
        vertexShader: `
          attribute float aScale;
          varying vec3 vColor;
          uniform float uSize;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = min(18.0, uSize * aScale * (110.0 / max(1.0, -mvPosition.z)));
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          uniform float uOpacity;
          void main() {
            vec2 p = gl_PointCoord - vec2(0.5);
            float r = length(p);
            if (r > 0.5) discard;
            float core = smoothstep(0.18, 0.0, r);
            float halo = pow(max(0.0, 1.0 - r * 2.0), 2.25);
            float alpha = (halo * 0.72 + core) * uOpacity;
            gl_FragColor = vec4(vColor * (0.7 + core * 1.8), alpha);
          }
        `,
      }),
    [opacity, size],
  );

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={positions} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-color" array={colors} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" array={scales} count={count} itemSize={1} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}

function DeepSky() {
  const texture = useTexture("/textures/stars_milky_way.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  return (
    <mesh rotation={[0.18, -0.72, -0.1]} frustumCulled={false}>
      <sphereGeometry args={[92, 64, 64]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        color="#2b3a50"
        toneMapped={false}
        transparent
        opacity={0.62}
        depthWrite={false}
      />
    </mesh>
  );
}

function HeroStar() {
  return (
    <group position={[-12.5, 5.5, -18]}>
      <mesh>
        <sphereGeometry args={[1.35, 64, 64]} />
        <meshBasicMaterial toneMapped={false}><color attach="color" args={[5.2, 3.7, 1.8]} /></meshBasicMaterial>
      </mesh>
      <mesh scale={3.2}>
        <sphereGeometry args={[1, 48, 48]} />
        <meshBasicMaterial
          color="#8a5424"
          transparent
          opacity={0.09}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh scale={7.5}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial
          color="#3b1a0b"
          transparent
          opacity={0.02}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export function GalaxyScene({
  phase,
  onSelectPlanet,
  quality,
}: {
  phase: UniversePhase;
  onSelectPlanet: () => void;
  quality: QualityMode;
}) {
  const high = quality !== "low";

  return (
    <>
      <color attach="background" args={["#000106"]} />
      <DeepSky />
      <ParallaxStars
        count={high ? 1650 : 700}
        spread={42}
        size={high ? 2.6 : 2.1}
        opacity={high ? 0.68 : 0.52}
        seed={713}
      />
      <HeroStar />
      <BenchmarkPlanet phase={phase} quality={quality} onSelect={onSelectPlanet} />
    </>
  );
}
