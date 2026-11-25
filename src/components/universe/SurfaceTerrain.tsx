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
import {
  rankSurfaceContentAnchors,
  rankSurfaceContentClusters,
  rankSurfaceWorldLandmarks,
  rankSurfaceWorldRegions,
  type SurfaceWorldProfile,
} from "../../lib/universe/surface";
import { isSoftwareRenderer } from "./CinematicPipeline";
import { FALLBACK_SURFACE_CAMERA_FRAME } from "./CinematicCamera";

const TERRAIN_Y = 0;
const SOFTWARE_FULL_COVERAGE_CHUNKS = 29;
const HARDWARE_FULL_COVERAGE_CHUNKS = 29;
const SOFTWARE_STREAM_WARMUP_UPDATES = 32;
let surfaceTerrainInstanceSequence = 0;

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

function SurfaceRocks({
  terrain,
  profile,
}: {
  terrain: FiniteTerrain;
  profile: SurfaceWorldProfile;
}) {
  // This component is mounted only on the real-GPU branch. Keeping useGLTF
  // here ensures software fallback never fetches/parses hardware-only assets.
  const boulder = useGLTF("/models/boulder_01/boulder_01_1k.gltf");
  const rockInstances = useMemo(
    () =>
      profile.landmarks.slice(0, 4).map((landmark, index) => {
        const object = seededClone(boulder.scene, index);
        const localHeight =
          terrain.sampleHeight(landmark.position[0], landmark.position[1]) ?? 0;
        const scale = 1.45 + landmark.scale * 1.55;
        object.position.set(
          landmark.position[0],
          TERRAIN_Y + localHeight - scale * 0.52,
          landmark.position[1],
        );
        object.rotation.set(
          landmark.prominence * 0.08,
          landmark.prominence * Math.PI * 1.7,
          -landmark.prominence * 0.04,
        );
        object.scale.setScalar(scale);
        return object;
      }),
    [boulder.scene, profile.id, profile.landmarks, terrain],
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
  profile,
  focusedEntryId,
  onFocusEntry,
  onAnchorHeight,
}: {
  prepare: boolean;
  active: boolean;
  presenting: boolean;
  phaseRef: MutableRefObject<"galaxy" | "system" | "approach" | "orbit" | "atmosphere" | "surface" | "returning">;
  profile: SurfaceWorldProfile;
  focusedEntryId: string | null;
  onFocusEntry: (entryId: string) => void;
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
      const instanceId = ++surfaceTerrainInstanceSequence;
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
                chunkSize: 32,
                viewRadius: 3,
                triangleBudget: 35000,
                maxCreatesPerFrame: 3,
                streamBudgetMs: 0.6,
                cacheResolution: 64,
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
            seed: profile.terrain.noiseSeed,
            // The pinned ProceduralTerrains shader specializes its octave
            // count at compile time. Driver compilation itself cannot be
            // interrupted, so use the package's formal lower-complexity
            // configuration on software WebGL instead of starting the
            // seven-octave shader and trying to cancel it later.
            octaves: softwareRenderer ? 2 : 7,
            scale: profile.terrain.scale,
            ridge: profile.terrain.ridge,
            warp: profile.terrain.warp,
            persistence: profile.terrain.persistence,
            lacunarity: profile.terrain.lacunarity,
            edgeFalloffMode: "mountains",
          },
          heightScale: profile.terrain.heightScale,
          seaLevel: profile.terrain.seaLevel,
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
            paletteSaturation: profile.terrain.saturation,
            paletteContrast: profile.terrain.contrast,
            paletteTint: profile.terrain.tint,
            sunColor: profile.lighting.sunColor,
            sunIntensity: profile.lighting.sunIntensity,
            skyAmbient: profile.lighting.skyAmbient,
            groundBounce: profile.lighting.groundBounce,
          },
          lighting: {
            sunAzimuth: profile.lighting.sunAzimuth,
            sunElevation: profile.lighting.sunElevation,
            fogDensity: profile.atmosphere.fogDensity,
          },
          palette: profile.terrain.palette,
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
      document.documentElement.dataset.universeSurfaceTerrainWorld = profile.id;
      document.documentElement.dataset.universeSurfaceTerrainInstance =
        `${profile.id}:${instanceId}`;
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
      delete document.documentElement.dataset.universeSurfaceTerrainWorld;
      delete document.documentElement.dataset.universeSurfaceTerrainInstance;
    };
  }, [
    activated,
    camera,
    gl,
    landingStreamCamera,
    onAnchorHeight,
    profile.id,
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
      // Infinite World needs several bounded updates to populate the initial
      // camera-centred ring. SwiftShader still must not run streaming work every
      // frame forever, so schedule a short warm-up burst, then return to the
      // previous camera-driven policy. Any real manual camera/projection change
      // restarts the bounded burst.
      streamCamera.updateWorldMatrix(true, false);
      streamCamera.getWorldPosition(currentCameraPosition.current);
      streamCamera.getWorldQuaternion(currentCameraQuaternion.current);
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
        !streamCamera.projectionMatrix.equals(lastProjection.current);

      if (positionChanged || rotationChanged || projectionChanged) {
        lastCameraPosition.current.copy(currentCameraPosition.current);
        lastCameraQuaternion.current.copy(currentCameraQuaternion.current);
        lastProjection.current.copy(streamCamera.projectionMatrix);
        terrainViewInitialized.current = true;
        softwareStreamUpdates.current = Math.max(
          softwareStreamUpdates.current,
          SOFTWARE_STREAM_WARMUP_UPDATES,
        );
        softwareStreamAccumulator.current = 0;
      }

      if (softwareStreamUpdates.current <= 0) return;
      softwareStreamAccumulator.current += delta;
      if (softwareStreamAccumulator.current < 0.09) return;
      softwareStreamAccumulator.current = 0;
      softwareStreamUpdates.current -= 1;
    }

    terrain.update(delta, { camera: streamCamera });

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
        document.documentElement.dataset.universeSurfaceTerrainReadyView =
          presenting ? "product-camera" : "landing-prestream";
        onAnchorHeight?.(
          (terrain.sampleHeight(profile.landing[0], profile.landing[1]) ?? 0) +
            0.75,
        );
      }
    }
  });

  const pathSegments = useMemo(() => {
    if (!terrain) return [];
    const subdivisions = softwareRenderer ? 3 : 6;
    return profile.paths.flatMap((path) =>
      Array.from({ length: subdivisions }, (_, index) => {
        const t0 = index / subdivisions;
        const t1 = (index + 1) / subdivisions;
        const x0 = THREE.MathUtils.lerp(path.from[0], path.to[0], t0);
        const z0 = THREE.MathUtils.lerp(path.from[1], path.to[1], t0);
        const x1 = THREE.MathUtils.lerp(path.from[0], path.to[0], t1);
        const z1 = THREE.MathUtils.lerp(path.from[1], path.to[1], t1);
        const x = (x0 + x1) * 0.5;
        const z = (z0 + z1) * 0.5;
        const dx = x1 - x0;
        const dz = z1 - z0;
        return {
          id: `${path.id}:${index}`,
          landmarkId: path.landmarkId,
          position: [
            x,
            (terrain.sampleHeight(x, z) ?? 0) + 0.09,
            z,
          ] as [number, number, number],
          length: Math.hypot(dx, dz),
          rotationY: Math.atan2(dx, dz),
          width: path.width,
        };
      }),
    );
  }, [profile.id, profile.paths, softwareRenderer, terrain]);

  const rankedContent = useMemo(
    () => rankSurfaceContentAnchors(profile.contentAnchors, focusedEntryId),
    [focusedEntryId, profile.contentAnchors],
  );
  const focusedAnchor =
    rankedContent.find((anchor) => anchor.entryId === focusedEntryId) ?? null;
  const rankedLandmarks = useMemo(
    () =>
      rankSurfaceWorldLandmarks(
        profile.landmarks,
        focusedAnchor?.landmarkId ?? null,
      ),
    [focusedAnchor?.landmarkId, profile.landmarks],
  );
  const rankedRegions = useMemo(
    () =>
      rankSurfaceWorldRegions(
        profile.regions,
        focusedAnchor?.regionId ?? null,
      ),
    [focusedAnchor?.regionId, profile.regions],
  );
  const rankedClusters = useMemo(
    () =>
      rankSurfaceContentClusters(
        profile.contentClusters,
        focusedAnchor?.cluster ?? null,
      ),
    [focusedAnchor?.cluster, profile.contentClusters],
  );

  const visibleLandmarks = softwareRenderer
    ? rankedLandmarks.slice(0, 3)
    : rankedLandmarks;
  const visibleRegions = softwareRenderer
    ? rankedRegions.slice(0, 2)
    : rankedRegions;
  const visibleContent = softwareRenderer
    ? rankedContent.slice(0, 3)
    : rankedContent;
  const visibleClusters = softwareRenderer
    ? rankedClusters.slice(0, 2)
    : rankedClusters;

  useEffect(() => {
    document.documentElement.dataset.universeSurfaceInteractiveSignals = String(
      active ? visibleContent.length : 0,
    );
    return () => {
      delete document.documentElement.dataset.universeSurfaceInteractiveSignals;
    };
  }, [active, profile.id, visibleContent.length]);

  if (!terrain) return null;

  return (
    <>
      <primitive object={terrain.object} />

      {pathSegments.map((segment) => {
        const focused =
          segment.landmarkId === focusedAnchor?.landmarkId;
        return (
          <mesh
            key={segment.id}
            position={segment.position}
            rotation={[0, segment.rotationY, 0]}
          >
            <boxGeometry
              args={[
                segment.width * (focused ? 1.3 : 1),
                0.035,
                segment.length,
              ]}
            />
            <meshBasicMaterial
              color={focused ? "#fff0cf" : profile.accent}
              transparent
              opacity={focused ? 0.38 : softwareRenderer ? 0.18 : 0.14}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {visibleClusters.map((cluster) => {
        const height =
          (terrain.sampleHeight(cluster.center[0], cluster.center[1]) ?? 0) +
          0.08;
        const focused = focusedAnchor?.cluster === cluster.index;
        const radius =
          (cluster.priority === "primary"
            ? 0.52
            : cluster.priority === "secondary"
              ? 0.4
              : 0.3) * (focused ? 1.18 : 1);
        return (
          <mesh
            key={cluster.id}
            position={[cluster.center[0], height, cluster.center[1]]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry
              args={[radius, radius + 0.045, softwareRenderer ? 14 : 28]}
            />
            <meshBasicMaterial
              color={profile.accent}
              transparent
              opacity={
                focused
                  ? 0.46
                  : cluster.priority === "primary"
                    ? 0.34
                    : cluster.priority === "secondary"
                      ? 0.22
                      : 0.14
              }
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {visibleRegions.map((region) => {
        const height =
          (terrain.sampleHeight(region.center[0], region.center[1]) ?? 0) +
          0.12;
        const focused = region.id === focusedAnchor?.regionId;
        const focusScale = focused ? 1.12 : 1;
        return (
          <mesh
            key={region.id}
            position={[region.center[0], height, region.center[1]]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry
              args={[
                Math.max(0.34, region.radius * 0.1) * focusScale,
                Math.max(0.5, region.radius * 0.14) * focusScale,
                softwareRenderer ? 12 : 24,
              ]}
            />
            <meshBasicMaterial
              color={focused ? "#fff0cf" : profile.accent}
              transparent
              opacity={focused ? 0.42 : softwareRenderer ? 0.2 : 0.12}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {visibleLandmarks.map((landmark) => {
        const focused = landmark.id === focusedAnchor?.landmarkId;
        const focusScale = focused ? 1.18 : 1;
        const height =
          (terrain.sampleHeight(
            landmark.position[0],
            landmark.position[1],
          ) ?? 0) + 0.34 * landmark.scale * focusScale;
        return (
          <mesh
            key={landmark.id}
            position={[landmark.position[0], height, landmark.position[1]]}
            scale={[
              0.32 * landmark.scale * focusScale,
              0.9 * landmark.scale * focusScale,
              0.32 * landmark.scale * focusScale,
            ]}
          >
            {landmark.kind === "crater" || landmark.kind === "basin" ? (
              <torusGeometry
                args={[0.68, 0.13, 6, softwareRenderer ? 10 : 18]}
              />
            ) : landmark.kind === "ridge" ? (
              <boxGeometry args={[1.1, 0.46, 0.34]} />
            ) : (
              <coneGeometry args={[0.55, 1.55, softwareRenderer ? 5 : 8]} />
            )}
            <meshBasicMaterial
              color={focused ? "#fff0cf" : profile.accent}
              transparent
              opacity={focused ? 0.84 : 0.38 + landmark.prominence * 0.22}
            />
          </mesh>
        );
      })}

      {visibleContent.map((anchor) => {
        const focused = anchor.entryId === focusedEntryId;
        const priorityScale = focused
          ? 1.38
          : anchor.priority === "primary"
            ? 1.25
            : anchor.priority === "secondary"
              ? 1
              : 0.82;
        const height =
          (terrain.sampleHeight(anchor.position[0], anchor.position[1]) ?? 0) +
          0.42 * priorityScale;
        return (
          <group
            key={anchor.id}
            name={`surface-signal-${anchor.id}`}
            userData={{ surfaceEntryId: anchor.entryId }}
            position={[anchor.position[0], height, anchor.position[1]]}
            scale={priorityScale}
            onClick={
              active
                ? (event) => {
                    event.stopPropagation();
                    onFocusEntry(anchor.entryId);
                  }
                : undefined
            }
          >
            {active ? (
              <mesh
                name={`surface-signal-hit-${anchor.id}`}
                position={[0, 0.22, 0]}
              >
                <sphereGeometry args={[0.3, 8, 6]} />
                <meshBasicMaterial
                  transparent
                  opacity={0}
                  depthWrite={false}
                />
              </mesh>
            ) : null}
            <mesh>
              <cylinderGeometry args={[0.045, 0.07, 0.74, 6]} />
              <meshBasicMaterial
                color={profile.accent}
                transparent
                opacity={
                  focused || anchor.priority === "primary" ? 0.98 : 0.76
                }
              />
            </mesh>
            <mesh position={[0, 0.48, 0]}>
              <octahedronGeometry args={[0.12, 0]} />
              <meshBasicMaterial
                color={
                  focused || anchor.priority === "primary"
                    ? "#fff0cf"
                    : "#ffffff"
                }
              />
            </mesh>
          </group>
        );
      })}

      {!softwareRenderer ? (
        <Suspense fallback={null}>
          <SurfaceRocks terrain={terrain} profile={profile} />
        </Suspense>
      ) : null}
    </>
  );
}
