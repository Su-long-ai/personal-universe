import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { createTerrain, type FiniteTerrain } from "procedural-terrains";
import * as THREE from "three";

const TERRAIN_Y = 0;

const ROCKS = [
  { x: -8.6, z: 1.8, scale: 3.4, ry: 0.45, tilt: 0.04 },
  { x: 11.0, z: 2.6, scale: 2.8, ry: 2.0, tilt: -0.06 },
  { x: -9.8, z: -13.5, scale: 2.8, ry: 2.6, tilt: 0.03 },
  { x: 9.6, z: -18.0, scale: 3.3, ry: 0.9, tilt: -0.04 },
] as const;

function terrainErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return String((error as { code?: unknown }).code ?? "");
}

function seededClone(source: THREE.Object3D, index: number) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
    }
  });
  clone.name = `surface-boulder-${index}`;
  return clone;
}

export function SurfaceTerrain({ onAnchorHeight }: { onAnchorHeight?: (height: number) => void }) {
  const { gl, camera } = useThree();
  const boulder = useGLTF("/models/boulder_01/boulder_01_1k.gltf");
  const [terrain, setTerrain] = useState<FiniteTerrain | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: FiniteTerrain | null = null;
    const controller = new AbortController();

    void (async () => {
      instance = await createTerrain({
        renderer: gl,
        signal: controller.signal,
        configuration: {
          layout: {
            chunkCount: 6,
            chunkSize: 12,
          },
          source: {
            kind: "noise",
            seed: 73021,
            octaves: 7,
            scale: 0.025,
            ridge: 0.7,
            warp: 0.3,
            persistence: 0.54,
            lacunarity: 2.08,
            edgeFalloffMode: "mountains",
          },
          heightScale: 34,
          seaLevel: -20,
          material: {
            terrainDetailQuality: 2,
            terrainTriplanar: true,
          },
          style: {
            paletteSaturation: 0.7,
            paletteContrast: 1.16,
            paletteTint: [0.72, 0.82, 0.9],
            sunColor: [1.0, 0.69, 0.42],
            sunIntensity: 1.45,
            skyAmbient: [0.07, 0.13, 0.2],
            groundBounce: [0.04, 0.075, 0.08],
          },
          lighting: {
            sunAzimuth: 145,
            sunElevation: 14,
            fogDensity: 0.0025,
          },
          palette: {
            sand: [0.19, 0.2, 0.18],
            dune: [0.16, 0.17, 0.16],
            dryGrass: [0.12, 0.16, 0.13],
            grass: [0.055, 0.12, 0.1],
            forest: [0.025, 0.075, 0.065],
            jungle: [0.02, 0.07, 0.065],
            swamp: [0.025, 0.065, 0.07],
            tundra: [0.19, 0.22, 0.23],
            redRock: [0.26, 0.2, 0.18],
            redRock2: [0.18, 0.16, 0.16],
            rock: [0.13, 0.15, 0.16],
            rockHi: [0.26, 0.29, 0.31],
            snow: [0.62, 0.69, 0.73],
          },
        },
      });

      await instance.prepare(camera, { signal: controller.signal });

      if (cancelled) {
        instance.dispose();
        return;
      }
      setTerrain(instance);
      onAnchorHeight?.((instance.sampleHeight(0.4, -5.4) ?? 0) + 0.75);
    })().catch((error) => {
      const code = terrainErrorCode(error);
      const expectedTeardown =
        cancelled &&
        (code === "TERRAIN_CANCELLED" || code === "TERRAIN_DISPOSED");

      if (!expectedTeardown) {
        console.error("[surface-terrain]", error);
      }
      if (!cancelled) {
        instance?.dispose();
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
      setTerrain(null);
      instance?.dispose();
    };
  }, [camera, gl, onAnchorHeight]);

  useFrame((_, delta) => {
    terrain?.update(delta, { camera });
  });

  const rockInstances = useMemo(() => {
    if (!terrain) return [];

    return ROCKS.map((placement, index) => {
      const object = seededClone(boulder.scene, index);
      const localHeight = terrain.sampleHeight(placement.x, placement.z) ?? 0;
      object.position.set(
        placement.x,
        TERRAIN_Y + localHeight - placement.scale * 0.52,
        placement.z,
      );
      object.rotation.set(placement.tilt, placement.ry, placement.tilt * 0.4);
      object.scale.setScalar(placement.scale);
      return object;
    });
  }, [boulder.scene, terrain]);

  useEffect(() => {
    return () => {
      for (const object of rockInstances) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // Geometry/materials belong to the shared glTF cache and are not disposed here.
            child.castShadow = false;
          }
        });
      }
    };
  }, [rockInstances]);

  if (!terrain) return null;

  return (
    <>
      <primitive object={terrain.object} />
      {rockInstances.map((object) => (
        <primitive key={object.name} object={object} />
      ))}
    </>
  );
}

useGLTF.preload("/models/boulder_01/boulder_01_1k.gltf");
