import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function SurfaceScene() {
  const beacon = useRef<THREE.Mesh>(null);
  const [active, setActive] = useState(false);

  useFrame((state, delta) => {
    if (!beacon.current) return;
    beacon.current.rotation.y += delta * 0.4;
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.08;
    beacon.current.scale.setScalar(active ? pulse * 1.18 : pulse);
  });

  return (
    <>
      <color attach="background" args={["#06151f"]} />
      <fog attach="fog" args={["#0b2931", 7, 30]} />
      <hemisphereLight args={["#95d9ff", "#0b1618", 2.2]} />
      <directionalLight position={[5, 8, 2]} intensity={3.8} color="#ffd8a0" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, 0]}>
        <planeGeometry args={[80, 80, 64, 64]} />
        <meshStandardMaterial color="#133b3c" roughness={0.96} metalness={0.05} />
      </mesh>

      <group position={[0, -1.4, -8]}>
        {[-7, -4, -1, 2, 5, 8].map((x, i) => (
          <mesh key={x} position={[x, 0.15 + (i % 2) * 0.5, -i * 1.1]} scale={[2.2, 3.1 + (i % 3), 1.8]}>
            <coneGeometry args={[1, 1, 5]} />
            <meshStandardMaterial color={i % 2 ? "#193e42" : "#21484b"} roughness={1} />
          </mesh>
        ))}
      </group>

      <mesh
        ref={beacon}
        position={[0, -0.35, -3.4]}
        onClick={() => setActive((value) => !value)}
      >
        <octahedronGeometry args={[0.52, 0]} />
        <meshStandardMaterial
          color={active ? "#ffe6a3" : "#87e8ff"}
          emissive={active ? "#ffb74d" : "#2dd8ff"}
          emissiveIntensity={active ? 5 : 3}
          roughness={0.18}
          metalness={0.35}
        />
      </mesh>

      <mesh position={[0, -0.35, -3.4]} scale={2.2}>
        <sphereGeometry args={[0.52, 24, 24]} />
        <meshBasicMaterial
          color={active ? "#ffb74d" : "#4ee8ff"}
          transparent
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}
