import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { GalaxyMarker, QualityMode } from "../../lib/universe/types";
import { generateGalaxyPointCloud } from "../../lib/universe/generation";

function spectralColor(type: string) {
  const cls = type.charAt(0).toUpperCase();
  if (cls === "O") return "#91adff";
  if (cls === "B") return "#a9c1ff";
  if (cls === "A") return "#d6e4ff";
  if (cls === "F") return "#fff2d5";
  if (cls === "G") return "#ffe2a0";
  if (cls === "K") return "#ffbd72";
  return "#ff8862";
}

function GalaxyDisc() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uOpacity: { value: 0.72 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uOpacity;
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;
            float a = atan(p.y, p.x);
            float spiral = 0.5 + 0.5 * cos(4.0 * (a - r * 6.8));
            float arm = pow(spiral, 5.2);
            float core = exp(-r * 5.5);
            float lane = pow(0.5 + 0.5 * cos(4.0 * (a - r * 6.8 - 0.14)), 12.0);
            float envelope = smoothstep(1.0, 0.12, r);
            float density = envelope * (0.055 + arm * 0.28 + core * 0.72);
            density *= 1.0 - lane * 0.38 * smoothstep(0.12, 0.72, r);
            vec3 warm = vec3(1.0, 0.67, 0.34);
            vec3 cool = vec3(0.32, 0.52, 0.95);
            vec3 col = mix(warm, cool, smoothstep(0.08, 0.95, r));
            col += vec3(0.28, 0.12, 0.28) * arm * smoothstep(0.28, 0.72, r);
            gl_FragColor = vec4(col * density * 1.8, density * uOpacity);
          }
        `,
      }),
    [],
  );

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.26, 0]}>
      <planeGeometry args={[70, 70, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function GalaxyStars({
  quality,
  seed,
}: {
  quality: QualityMode;
  seed: string;
}) {
  const count = quality === "low" ? 12000 : quality === "high" ? 36000 : 26000;
  const cloud = useMemo(() => generateGalaxyPointCloud(seed, count), [count, seed]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: { uSize: { value: quality === "low" ? 2.0 : 2.7 } },
        vertexShader: `
          attribute float aScale;
          varying vec3 vColor;
          uniform float uSize;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = min(9.0, uSize * aScale * (110.0 / max(8.0, -mv.z)));
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            vec2 p = gl_PointCoord - 0.5;
            float r = length(p);
            if (r > 0.5) discard;
            float halo = pow(max(0.0, 1.0 - r * 2.0), 2.1);
            float core = smoothstep(0.16, 0.0, r);
            gl_FragColor = vec4(vColor * (0.58 + core * 1.5), halo * 0.72 + core * 0.72);
          }
        `,
      }),
    [quality],
  );

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={cloud.positions} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-color" array={cloud.colors} count={count} itemSize={3} />
        <bufferAttribute attach="attributes-aScale" array={cloud.scales} count={count} itemSize={1} />
      </bufferGeometry>
      <primitive object={material} attach="material" />
    </points>
  );
}

function FarSky() {
  const texture = useTexture("/textures/stars_milky_way.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return (
    <mesh rotation={[0.4, -0.5, -0.12]} frustumCulled={false}>
      <sphereGeometry args={[125, 48, 48]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        color="#101927"
        toneMapped={false}
        transparent
        opacity={0.22}
        depthWrite={false}
      />
    </mesh>
  );
}

function SurveyMarker({
  marker,
  onSelect,
}: {
  marker: GalaxyMarker;
  onSelect: (marker: GalaxyMarker) => void;
}) {
  const hero = marker.source === "hero";
  const color = hero ? "#7ff2ff" : "#d9e7ff";
  const size = hero ? 0.34 : 0.22;

  return (
    <group position={marker.position}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(marker);
        }}
        onPointerOver={() => document.body.classList.add("planet-hover")}
        onPointerOut={() => document.body.classList.remove("planet-hover")}
      >
        <sphereGeometry args={[size, 18, 18]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={hero ? [0.48, 0.51, 48] : [0.3, 0.315, 32]} />
        <meshBasicMaterial
          color={hero ? "#70dfea" : "#a9c5ff"}
          transparent
          opacity={hero ? 0.62 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function ProceduralMarkerCloud({
  markers,
  onSelect,
}: {
  markers: GalaxyMarker[];
  onSelect: (marker: GalaxyMarker) => void;
}) {
  const { positions, colors } = useMemo(() => {
    const nextPositions = new Float32Array(markers.length * 3);
    const nextColors = new Float32Array(markers.length * 3);
    const color = new THREE.Color();

    markers.forEach((marker, index) => {
      const offset = index * 3;
      nextPositions[offset] = marker.position[0];
      nextPositions[offset + 1] = marker.position[1];
      nextPositions[offset + 2] = marker.position[2];

      color.set(spectralColor(marker.spectralType));
      nextColors[offset] = color.r;
      nextColors[offset + 1] = color.g;
      nextColors[offset + 2] = color.b;
    });

    return { positions: nextPositions, colors: nextColors };
  }, [markers]);

  return (
    <points
      frustumCulled={false}
      onClick={(event) => {
        const index = event.index;
        if (index == null || !markers[index]) return;
        event.stopPropagation();
        onSelect(markers[index]);
      }}
      onPointerOver={() => document.body.classList.add("planet-hover")}
      onPointerOut={() => document.body.classList.remove("planet-hover")}
    >
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={markers.length}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          array={colors}
          count={markers.length}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.23}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.82}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

export function GalaxyScene({
  markers,
  onSelectSystem,
  quality,
  seed,
}: {
  markers: GalaxyMarker[];
  onSelectSystem: (marker: GalaxyMarker) => void;
  quality: QualityMode;
  seed: string;
}) {
  const root = useRef<THREE.Group>(null);
  const raycaster = useThree((state) => state.raycaster);
  const surveyMarkers = useMemo(
    () => markers.filter((marker) => marker.source !== "procedural"),
    [markers],
  );
  const proceduralMarkers = useMemo(
    () => markers.filter((marker) => marker.source === "procedural"),
    [markers],
  );

  useEffect(() => {
    const previous = raycaster.params.Points.threshold;
    raycaster.params.Points.threshold = 0.62;
    return () => {
      raycaster.params.Points.threshold = previous;
      document.body.classList.remove("planet-hover");
    };
  }, [raycaster]);

  useFrame((_, delta) => {
    if (root.current) root.current.rotation.y += delta * 0.0045;
  });

  return (
    <>
      <color attach="background" args={["#000106"]} />
      <FarSky />
      <group ref={root}>
        <GalaxyDisc />
        <GalaxyStars quality={quality} seed={seed} />
        <ProceduralMarkerCloud
          markers={proceduralMarkers}
          onSelect={onSelectSystem}
        />
        {surveyMarkers.map((marker) => (
          <SurveyMarker
            key={marker.id}
            marker={marker}
            onSelect={onSelectSystem}
          />
        ))}
      </group>
    </>
  );
}
