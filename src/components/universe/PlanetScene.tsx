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

function rendererLabel(gl: THREE.WebGLRenderer) {
  const context = gl.getContext();
  try {
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    if (debug) {
      return String(
        context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? "",
      );
    }
  } catch {
    // Some privacy-hardened browsers intentionally deny unmasked renderer info.
  }
  return String(context.getParameter(context.RENDERER) ?? "");
}

function shouldKeepFallback(gl: THREE.WebGLRenderer, quality: QualityMode) {
  if (quality === "low") return "low-quality";
  const renderer = rendererLabel(gl);
  return /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(renderer)
    ? "software-renderer"
    : null;
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
    let warmupTimer: number | null = null;
    const idleWindow = window as IdleWindow;
    const fallbackReason = shouldKeepFallback(gl, quality);

    if (fallbackReason) {
      document.documentElement.dataset.planetRenderMode =
        "fallback-" + fallbackReason;
      return () => {
        if (
          document.documentElement.dataset.planetRenderMode ===
          "fallback-" + fallbackReason
        ) {
          delete document.documentElement.dataset.planetRenderMode;
        }
      };
    }

    document.documentElement.dataset.planetRenderMode = "fallback-warmup";

    const bake = () => {
      if (cancelled) return;

      document.documentElement.dataset.planetRenderMode = "baking";
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
        document.documentElement.dataset.planetRenderMode = "baked";
      }).catch((error) => {
        document.documentElement.dataset.planetRenderMode = "fallback-error";
        console.warn("[planet-bake]", planet.name, error);
      });
    };

    // bakePlanet is deliberately not started in the first arrival commit.
    // ProceduralPlanets documents baking as GPU-blocking work. Two frames make
    // the fallback/HUD observable, and a short warmup window lets quick travel
    // or return actions cancel the expensive work entirely. Software WebGL
    // renderers never bake: SwiftShader/llvmpipe can block navigation for tens
    // of seconds, while the fallback remains a complete interactive world.
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        warmupTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (idleWindow.requestIdleCallback) {
            idleHandle = idleWindow.requestIdleCallback(() => bake(), {
              timeout: 1200,
            });
          } else {
            fallbackTimer = window.setTimeout(bake, 120);
          }
        }, 1800);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (idleHandle !== null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle);
      }
      if (warmupTimer !== null) window.clearTimeout(warmupTimer);
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      setBaked(null);
      if (created) disposeBaked(created);
      delete document.documentElement.dataset.planetRenderMode;
    };
  }, [bakeOptions, gl, planet.name, quality]);

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
