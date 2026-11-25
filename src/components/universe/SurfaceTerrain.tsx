import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { type FiniteTerrain } from "procedural-terrains";
import { createInfiniteTerrain } from "procedural-terrains/infinite";
import * as THREE from "three";
import { isSoftwareRenderer } from "./CinematicPipeline";
import { FALLBACK_SURFACE_CAMERA_FRAME } from "./CinematicCamera";

const TERRAIN_Y = 0;
// Radius 2 contains 13 radial chunks. The generated software horizon supplies
// the far-distance depth cue, so SwiftShader does not need the 29-chunk ring.
const SOFTWARE_FULL_COVERAGE_CHUNKS = 13;
const HARDWARE_FULL_COVERAGE_CHUNKS = 29;
const SOFTWARE_TERRAIN_CHUNK_SIZE = 32;
const SOFTWARE_STREAM_WARMUP_UPDATES = 16;
const SOFTWARE_STREAM_REBASE_UPDATES = 6;
const SOFTWARE_VIEW_REFRESH_UPDATES = 1;
const SOFTWARE_POSITION_REFRESH_DISTANCE_SQ = 1;
const SOFTWARE_ROTATION_REFRESH_EPSILON = 1e-5;

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

function SurfaceRocks({ terrain }: { terrain: FiniteTerrain }) {
  // Keep decorative glTF work behind the real-GPU branch. In particular,
  // SwiftShader/software fallback must not fetch, parse, cache or compile a
  // model that its visual profile never renders.
  const boulder = useGLTF("/models/boulder_01/boulder_01_1k.gltf");
  const rockInstances = useMemo(
    () =>
      ROCKS.map((placement, index) => {
        const object = seededClone(boulder.scene, index);
        const localHeight =
          terrain.sampleHeight(placement.x, placement.z) ?? 0;
        object.position.set(
          placement.x,
          TERRAIN_Y + localHeight - placement.scale * 0.52,
          placement.z,
        );
        object.rotation.set(
          placement.tilt,
          placement.ry,
          placement.tilt * 0.4,
        );
        object.scale.setScalar(placement.scale);
        return object;
      }),
    [boulder.scene, terrain],
  );

  useEffect(() => {
    document.documentElement.dataset.universeSurfaceDecorations =
      "hardware-rocks";
    return () => {
      if (
        document.documentElement.dataset.universeSurfaceDecorations ===
        "hardware-rocks"
      ) {
        delete document.documentElement.dataset.universeSurfaceDecorations;
      }
      for (const object of rockInstances) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // Geometry/materials remain owned by drei's shared glTF cache.
            child.castShadow = false;
          }
        });
      }
    };
  }, [rockInstances]);

  return (
    <>
      {rockInstances.map((object) => (
        <primitive key={object.name} object={object} />
      ))}
    </>
  );
}

export function SurfaceTerrain({
  prepare,
  active,
  presenting,
  phaseRef,
  onAnchorHeight,
}: {
  prepare: boolean;
  active: boolean;
  presenting: boolean;
  phaseRef: MutableRefObject<"galaxy" | "system" | "approach" | "orbit" | "atmosphere" | "surface" | "returning">;
  onAnchorHeight?: (height: number) => void;
}) {
  const { gl, camera } = useThree();
  const [terrain, setTerrain] = useState<FiniteTerrain | null>(null);
  const [activated, setActivated] = useState(prepare || active);
  const softwareRenderer = isSoftwareRenderer(gl);
  const landingStreamCamera = useMemo(() => camera.clone(false), [camera]);
  const terrainViewInitialized = useRef(false);
  const terrainReadyPublished = useRef(false);
  const softwareStreamUpdates = useRef(0);
  const softwareStreamAccumulator = useRef(0);
  const lastCameraPosition = useRef(new THREE.Vector3());
  const lastCameraQuaternion = useRef(new THREE.Quaternion());
  const lastProjection = useRef(new THREE.Matrix4());
  const currentCameraPosition = useRef(new THREE.Vector3());
  const currentCameraQuaternion = useRef(new THREE.Quaternion());
  const lastSoftwareChunkX = useRef<number | null>(null);
  const lastSoftwareChunkZ = useRef<number | null>(null);
  const productTerrainUpdateOptions = useMemo(() => ({ camera }), [camera]);
  const landingTerrainUpdateOptions = useMemo(
    () => ({ camera: landingStreamCamera }),
    [landingStreamCamera],
  );

  useEffect(() => {
    if (softwareRenderer) return;
    // Start the shared drei cache fetch while the real-GPU terrain itself is
    // preparing, so decorations are usually ready before Surface owns the
    // frame. Software fallback never touches this hardware-only asset.
    useGLTF.preload("/models/boulder_01/boulder_01_1k.gltf");
  }, [softwareRenderer]);

  useEffect(() => {
    if (prepare || active) setActivated(true);
  }, [active, prepare]);

  useEffect(() => {
    if (!activated) return;

    let cancelled = false;
    let instance: FiniteTerrain | null = null;
    const controller = new AbortController();

    // ProceduralTerrains Infinite World streams around the camera supplied to
    // prepare/update. Prime it at the actual fallback landing frame instead of
    // the still-visible globe camera, otherwise a "full" ring can be centred on
    // the wrong world-space region and immediately churn when presentation
    // hands over.
    landingStreamCamera.projectionMatrix.copy(camera.projectionMatrix);
    landingStreamCamera.projectionMatrixInverse.copy(
      camera.projectionMatrixInverse,
    );
    landingStreamCamera.position.set(
      ...FALLBACK_SURFACE_CAMERA_FRAME.position,
    );
    landingStreamCamera.up.set(0, 1, 0);
    landingStreamCamera.lookAt(...FALLBACK_SURFACE_CAMERA_FRAME.target);
    landingStreamCamera.updateMatrixWorld(true);

    void (async () => {
      const html = document.documentElement;
      html.dataset.universeSurfaceTerrainAllocations = String(
        Number(html.dataset.universeSurfaceTerrainAllocations ?? "0") + 1,
      );
      instance = await createInfiniteTerrain({
        renderer: gl,
        signal: controller.signal,
        configuration: {
          layout: softwareRenderer
            ? {
                // Infinite World removes the visible finite-board boundary while
                // keeping software rendering bounded to a small camera-centred
                // window. The runtime streams no more than three chunks per
                // scheduled update and keeps its clipmap at the minimum supported
                // resolution.
                chunkSize: SOFTWARE_TERRAIN_CHUNK_SIZE,
                viewRadius: 2,
                triangleBudget: 20000,
                maxCreatesPerFrame: 2,
                streamBudgetMs: 0.45,
                cacheResolution: 48,
              }
            : {
                // LOW-quality hardware fallback can afford a slightly broader
                // horizon without becoming a second high-detail renderer.
                chunkSize: 30,
                viewRadius: 3,
                triangleBudget: 180000,
                maxCreatesPerFrame: 8,
                streamBudgetMs: 1.2,
                cacheResolution: 128,
              },
          source: {
            kind: "noise",
            seed: 73021,
            // The pinned ProceduralTerrains shader specializes its octave
            // count at compile time. Driver compilation itself cannot be
            // interrupted, so use the package's formal lower-complexity
            // configuration on software WebGL instead of starting the
            // seven-octave shader and trying to cancel it later.
            octaves: softwareRenderer ? 2 : 7,
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
                lodSegments: [16, 8, 4, 2],
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

      await instance.prepare(landingStreamCamera, {
        signal: controller.signal,
      });

      if (cancelled) {
        instance.dispose();
        return;
      }
      terrainViewInitialized.current = false;
      terrainReadyPublished.current = false;
      softwareStreamUpdates.current = softwareRenderer
        ? SOFTWARE_STREAM_WARMUP_UPDATES
        : 0;
      softwareStreamAccumulator.current = 0;
      document.documentElement.dataset.universeSurfaceTerrainProfile =
        softwareRenderer ? "infinite-software" : "infinite-hardware";
      setTerrain(instance);
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
      delete document.documentElement.dataset.universeSurfaceTerrainReadyView;
    };
  }, [
    activated,
    camera,
    gl,
    landingStreamCamera,
    onAnchorHeight,
    softwareRenderer,
  ]);

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
    // Hidden Atmosphere prewarm is allowed to populate the destination ring,
    // but only while the coordinator still owns Atmosphere. A reverse to
    // Orbit pauses streaming immediately; an already-created terrain remains
    // retained for the next inward journey.
    const surfaceStreaming =
      active && phaseRef.current === "surface";
    const hiddenLandingPrestream =
      prepare &&
      !active &&
      phaseRef.current === "atmosphere" &&
      !terrainReadyPublished.current;
    if ((!surfaceStreaming && !hiddenLandingPrestream) || !terrain) return;

    const streamCamera = presenting ? camera : landingStreamCamera;
    if (!presenting) {
      // Keep projection identical to the product camera, but use a detached
      // non-rendered view at the final terrain landing pose. camera-controls
      // remains the only visible/product camera authority.
      landingStreamCamera.projectionMatrix.copy(camera.projectionMatrix);
      landingStreamCamera.projectionMatrixInverse.copy(
        camera.projectionMatrixInverse,
      );
      landingStreamCamera.position.set(
        ...FALLBACK_SURFACE_CAMERA_FRAME.position,
      );
      landingStreamCamera.up.set(0, 1, 0);
      landingStreamCamera.lookAt(...FALLBACK_SURFACE_CAMERA_FRAME.target);
      landingStreamCamera.updateMatrixWorld(true);
    }

    if (softwareRenderer) {
      // Infinite World changes its desired chunk set only when the camera
      // crosses a terrain chunk. Do not restart a long warmup for tiny settling
      // motion: initial fill gets a bounded burst, real chunk crossings get a
      // shorter rebase burst, and same-chunk view changes get one refresh.
      streamCamera.updateWorldMatrix(true, false);
      streamCamera.getWorldPosition(currentCameraPosition.current);
      streamCamera.getWorldQuaternion(currentCameraQuaternion.current);

      const currentChunkX = Math.floor(
        currentCameraPosition.current.x / SOFTWARE_TERRAIN_CHUNK_SIZE,
      );
      const currentChunkZ = Math.floor(
        currentCameraPosition.current.z / SOFTWARE_TERRAIN_CHUNK_SIZE,
      );
      const chunkChanged =
        lastSoftwareChunkX.current === null ||
        lastSoftwareChunkZ.current === null ||
        lastSoftwareChunkX.current !== currentChunkX ||
        lastSoftwareChunkZ.current !== currentChunkZ;
      const positionChanged =
        !terrainViewInitialized.current ||
        currentCameraPosition.current.distanceToSquared(
          lastCameraPosition.current,
        ) > SOFTWARE_POSITION_REFRESH_DISTANCE_SQ;
      const rotationChanged =
        !terrainViewInitialized.current ||
        1 -
          Math.abs(
            currentCameraQuaternion.current.dot(lastCameraQuaternion.current),
          ) >
          SOFTWARE_ROTATION_REFRESH_EPSILON;
      const projectionChanged =
        !terrainViewInitialized.current ||
        !streamCamera.projectionMatrix.equals(lastProjection.current);

      if (chunkChanged || positionChanged || rotationChanged || projectionChanged) {
        lastCameraPosition.current.copy(currentCameraPosition.current);
        lastCameraQuaternion.current.copy(currentCameraQuaternion.current);
        lastProjection.current.copy(streamCamera.projectionMatrix);
        lastSoftwareChunkX.current = currentChunkX;
        lastSoftwareChunkZ.current = currentChunkZ;
        const requestedUpdates = chunkChanged
          ? terrainViewInitialized.current
            ? SOFTWARE_STREAM_REBASE_UPDATES
            : SOFTWARE_STREAM_WARMUP_UPDATES
          : SOFTWARE_VIEW_REFRESH_UPDATES;
        terrainViewInitialized.current = true;
        softwareStreamUpdates.current = Math.max(
          softwareStreamUpdates.current,
          requestedUpdates,
        );
        softwareStreamAccumulator.current = 0;
      }

      if (softwareStreamUpdates.current <= 0) return;
      softwareStreamAccumulator.current += delta;
      if (softwareStreamAccumulator.current < 0.09) return;
      softwareStreamAccumulator.current = 0;
      softwareStreamUpdates.current -= 1;
    }

    terrain.update(
      delta,
      presenting
        ? productTerrainUpdateOptions
        : landingTerrainUpdateOptions,
    );

    if (!terrainReadyPublished.current) {
      const diagnostics = terrain.getDiagnostics() as { chunks?: number };
      // ProceduralTerrains uses radial (not square) coverage. Radius 3 has
      // exactly 29 desired chunks. Publish readiness only when the complete
      // initial ring exists, so the product never treats a partially streamed
      // horizon as settled.
      const readyChunkCount = softwareRenderer
        ? SOFTWARE_FULL_COVERAGE_CHUNKS
        : HARDWARE_FULL_COVERAGE_CHUNKS;
      if ((diagnostics.chunks ?? 0) >= readyChunkCount) {
        terrainReadyPublished.current = true;
        if (softwareRenderer) {
          // Initial full coverage is the stop condition. Future software work
          // is scheduled only by meaningful camera/chunk changes above.
          softwareStreamUpdates.current = 0;
          softwareStreamAccumulator.current = 0;
        }
        document.documentElement.dataset.universeSurfaceTerrainReadyView =
          presenting ? "product-camera" : "landing-prestream";
        onAnchorHeight?.((terrain.sampleHeight(0.4, -5.4) ?? 0) + 0.75);
      }
    }
  });

  if (!terrain) return null;

  return (
    <>
      <primitive object={terrain.object} />
      {!softwareRenderer ? (
        <Suspense fallback={null}>
          <SurfaceRocks terrain={terrain} />
        </Suspense>
      ) : null}
    </>
  );
}
