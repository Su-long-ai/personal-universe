import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { createTerrain, type FiniteTerrain } from "procedural-terrains";
import * as THREE from "three";
import { isSoftwareRenderer } from "./CinematicPipeline";

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

export function SurfaceTerrain({
  active,
  phaseRef,
  onAnchorHeight,
}: {
  active: boolean;
  phaseRef: MutableRefObject<"galaxy" | "system" | "approach" | "orbit" | "atmosphere" | "surface" | "returning">;
  onAnchorHeight?: (height: number) => void;
}) {
  const { gl, camera } = useThree();
  const boulder = useGLTF("/models/boulder_01/boulder_01_1k.gltf");
  const [terrain, setTerrain] = useState<FiniteTerrain | null>(null);
  const [activated, setActivated] = useState(active);
  const softwareRenderer = isSoftwareRenderer(gl);
  const terrainViewInitialized = useRef(false);
  const lastCameraPosition = useRef(new THREE.Vector3());
  const lastCameraQuaternion = useRef(new THREE.Quaternion());
  const lastProjection = useRef(new THREE.Matrix4());
  const currentCameraPosition = useRef(new THREE.Vector3());
  const currentCameraQuaternion = useRef(new THREE.Quaternion());

  useEffect(() => {
    if (active) setActivated(true);
  }, [active]);

  useEffect(() => {
    if (!activated) return;

    let cancelled = false;
    let instance: FiniteTerrain | null = null;
    const controller = new AbortController();

    void (async () => {
      instance = await createTerrain({
        renderer: gl,
        signal: controller.signal,
        configuration: {
          layout: softwareRenderer
            ? {
                // Preserve the same 72-unit footprint with fewer chunks so
                // SwiftShader does less geometry/material preparation.
                chunkCount: 4,
                chunkSize: 18,
              }
            : {
                chunkCount: 6,
                chunkSize: 12,
              },
          source: {
            kind: "noise",
            seed: 73021,
            // The pinned ProceduralTerrains shader specializes its octave
            // count at compile time. Driver compilation itself cannot be
            // interrupted, so use the package's formal lower-complexity
            // configuration on software WebGL instead of starting the
            // seven-octave shader and trying to cancel it later.
            octaves: softwareRenderer ? 3 : 7,
            scale: 0.025,
            ridge: 0.7,
            warp: 0.3,
            persistence: 0.54,
            lacunarity: 2.08,
            edgeFalloffMode: "mountains",
          },
          heightScale: 34,
          seaLevel: -20,
          quality: softwareRenderer
            ? {
                lodSegments: [32, 16, 8, 4],
                lodDistanceScale: 1,
                morphEnabled: false,
                mergeEnabled: true,
                cullingEnabled: true,
              }
            : {
                lodSegments: [64, 32, 16, 8],
                lodDistanceScale: 1,
                morphEnabled: true,
                mergeEnabled: true,
                cullingEnabled: true,
              },
          material: {
            // Detail pages and triplanar shading are optional visual layers.
            // Keep them on real GPUs; omit both from the software fallback so
            // its non-interruptible prepare/driver compile remains bounded.
            terrainDetailQuality: softwareRenderer ? 0 : 2,
            terrainTriplanar: !softwareRenderer,
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
      terrainViewInitialized.current = false;
      document.documentElement.dataset.universeSurfaceTerrainProfile =
        softwareRenderer ? "software-performance" : "gpu-default";
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
      instance?.dispose();
      delete document.documentElement.dataset.universeSurfaceTerrainProfile;
    };
  }, [activated, camera, gl, onAnchorHeight, softwareRenderer]);

  useEffect(() => {
    const lifecycle = !activated
      ? "idle"
      : !terrain
        ? "preparing"
        : active
          ? "active"
          : "parked";
    document.documentElement.dataset.universeSurfaceTerrainLifecycle =
      lifecycle;
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceTerrainLifecycle ===
        lifecycle
      ) {
        delete document.documentElement.dataset
          .universeSurfaceTerrainLifecycle;
      }
    };
  }, [active, activated, terrain]);

  useFrame((_, delta) => {
    // `active` is delivered through the R3F reconciler. Read the coordinator
    // ref first so no *new* Surface work starts after an outward wheel intent.
    if (!active || phaseRef.current !== "surface" || !terrain) return;

    if (softwareRenderer) {
      // FiniteTerrain.update() performs LOD/culling and optional detail-cache
      // work. Repeating it every frame for an unchanged camera is redundant,
      // and under SwiftShader one already-running update can monopolize the
      // main thread long enough to starve the React/R3F phase handoff. Keep
      // software fallback updates camera-driven: first visible frame plus any
      // real camera/projection change (manual exploration and resize still
      // update normally).
      camera.updateWorldMatrix(true, false);
      camera.getWorldPosition(currentCameraPosition.current);
      camera.getWorldQuaternion(currentCameraQuaternion.current);
      const positionChanged =
        !terrainViewInitialized.current ||
        currentCameraPosition.current.distanceToSquared(
          lastCameraPosition.current,
        ) > 1e-8;
      const rotationChanged =
        !terrainViewInitialized.current ||
        1 - Math.abs(
          currentCameraQuaternion.current.dot(lastCameraQuaternion.current),
        ) > 1e-8;
      const projectionChanged =
        !terrainViewInitialized.current ||
        !camera.projectionMatrix.equals(lastProjection.current);

      if (!positionChanged && !rotationChanged && !projectionChanged) return;

      lastCameraPosition.current.copy(currentCameraPosition.current);
      lastCameraQuaternion.current.copy(currentCameraQuaternion.current);
      lastProjection.current.copy(camera.projectionMatrix);
      terrainViewInitialized.current = true;
    }

    terrain.update(delta, { camera });
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
