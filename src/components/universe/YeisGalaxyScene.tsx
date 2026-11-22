import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import type { GalaxyMarker, QualityMode } from "../../lib/universe/types";
import {
  loadYeisCore,
  HERO_SYSTEM_ID,
  type YeisCoreRuntime,
} from "../../lib/universe/yeis";
import { markerForYeisStarId } from "../../lib/universe/yeis/bridge";
import { CameraController } from "../../vendor/yeis/camera/CameraController";
import { Input } from "../../vendor/yeis/input/Input";
import {
  CAMERA_FAR_KM,
  CAMERA_NEAR_KM,
  DEG,
  PARSEC_KM,
  SKY_RADIUS_KM,
} from "../../vendor/yeis/core/constants";
import { StarPoints } from "../../vendor/yeis/render/StarPoints";
import { ProcStarPoints } from "../../vendor/yeis/render/ProcStarPoints";
import { GalaxyCloud } from "../../vendor/yeis/render/GalaxyCloud";
import { GalaxySprites } from "../../vendor/yeis/render/GalaxySprites";

type NativeGalaxyState = {
  runtime: YeisCoreRuntime;
  controller: CameraController;
  input: Input;
  starPoints: StarPoints;
  procPoints: ProcStarPoints;
  galaxyCloud: GalaxyCloud;
  galaxySprites: GalaxySprites;
  cameraPc: Vector3;
  heroSky: Points;
  heroSkyPosition: Vector3;
  currentGalaxy: number | null;
  galaxyAcc: number;
  observedSky: Points;
  observedCount: number;
  disposed: boolean;
};

export type YeisGalaxyViewState = {
  positionKm: [number, number, number];
  quaternion: [number, number, number, number];
};

const heroProjection = new Vector3();
const observedProjection = new Vector3();
const observedDirection = new Vector3();

export function YeisGalaxyScene({
  markers,
  onSelectSystem,
  quality,
  viewStateRef,
}: {
  markers: GalaxyMarker[];
  onSelectSystem: (marker: GalaxyMarker) => void;
  quality: QualityMode;
  viewStateRef: MutableRefObject<YeisGalaxyViewState | null>;
}) {
  const { gl, scene, camera, size } = useThree();
  const perspective = camera as PerspectiveCamera;
  const stateRef = useRef<NativeGalaxyState | null>(null);
  const markersRef = useRef(markers);
  const selectRef = useRef(onSelectSystem);

  markersRef.current = markers;
  selectRef.current = onSelectSystem;

  useEffect(() => {
    let cancelled = false;
    const previousNear = perspective.near;
    const previousFar = perspective.far;
    const previousPosition = perspective.position.clone();
    const previousQuaternion = perspective.quaternion.clone();

    void loadYeisCore()
      .then((runtime) => {
        if (cancelled) return;

        const context = gl.getContext();
        const range = context.getParameter(
          context.ALIASED_POINT_SIZE_RANGE,
        ) as Float32Array | number[];
        const maxPointPx = Math.max(
          32,
          Math.min(256, (range?.[1] ?? 64) / gl.getPixelRatio()),
        );

        const starPoints = new StarPoints(runtime.catalog, scene);
        const procPoints = new ProcStarPoints(runtime.universe.procStars, scene);
        const galaxySprites = new GalaxySprites(
          runtime.universe.galaxies,
          scene,
          maxPointPx,
        );
        const milkyWay = runtime.universe.galaxies.model(0);
        const galaxyCloud = new GalaxyCloud(
          0,
          milkyWay,
          scene,
          quality === "low" ? 90_000 : 180_000,
          maxPointPx,
        );

        const heroGeometry = new BufferGeometry();
        heroGeometry.setAttribute(
          "position",
          new BufferAttribute(new Float32Array(3), 3),
        );
        const heroMaterial = new PointsMaterial({
          color: 0x7ff2ff,
          size: quality === "low" ? 7 : 10,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        });
        const heroSky = new Points(heroGeometry, heroMaterial);
        heroSky.frustumCulled = false;
        heroSky.renderOrder = -8;
        scene.add(heroSky);

        const observedGeometry = new BufferGeometry();
        observedGeometry.setAttribute(
          "position",
          new BufferAttribute(
            new Float32Array(Math.max(32, markersRef.current.length) * 3),
            3,
          ),
        );
        observedGeometry.setDrawRange(0, 0);
        const observedMaterial = new PointsMaterial({
          color: 0xffc978,
          size: quality === "low" ? 5 : 7,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        });
        const observedSky = new Points(observedGeometry, observedMaterial);
        observedSky.frustumCulled = false;
        observedSky.renderOrder = -7;
        scene.add(observedSky);

        const input = new Input(gl.domElement);
        const controller = new CameraController(runtime.universe);

        const viewLocal = new Vector3(
          milkyWay.radius * 0.08,
          milkyWay.radius * 1.18,
          milkyWay.radius * 1.62,
        );
        const cameraPc = milkyWay.toScene(viewLocal, new Vector3());
        const orbitCenterKm = milkyWay.center.clone().multiplyScalar(PARSEC_KM);
        const orbitRadiusKm = milkyWay.radius * 0.045 * PARSEC_KM;
        const savedView = viewStateRef.current;
        if (savedView) {
          controller.position.fromArray(savedView.positionKm);
          controller.orbitPoint(orbitCenterKm, orbitRadiusKm, "Milky Way");
          controller.quaternion.fromArray(savedView.quaternion);
          runtime.universe.toParsecs(controller.position, cameraPc);
        } else {
          controller.position.copy(cameraPc).multiplyScalar(PARSEC_KM);
          controller.orbitPoint(orbitCenterKm, orbitRadiusKm, "Milky Way");
        }
        console.info(
          `[YEIS-NATIVE-VIEW] restored=${savedView ? "1" : "0"} ` +
            `distanceKm=${controller.position.length().toExponential(8)}`,
        );

        perspective.near = CAMERA_NEAR_KM;
        perspective.far = CAMERA_FAR_KM;
        perspective.position.set(0, 0, 0);
        perspective.quaternion.copy(controller.quaternion);
        perspective.updateProjectionMatrix();
        perspective.updateMatrixWorld();

        const state: NativeGalaxyState = {
          runtime,
          controller,
          input,
          starPoints,
          procPoints,
          galaxyCloud,
          galaxySprites,
          cameraPc,
          heroSky,
          heroSkyPosition: new Vector3(),
          observedSky,
          observedCount: 0,
          currentGalaxy: null,
          galaxyAcc: 1,
          disposed: false,
        };
        stateRef.current = state;

        const selectNativeStar = (starId: string) => {
          const marker = markerForYeisStarId(
            runtime,
            markersRef.current,
            starId,
          );
          console.info(
            `[YEIS-NATIVE-PICK] star=${starId} marker=${marker.id} engine=${marker.engine ?? "v2"}`,
          );
          selectRef.current(marker);
        };

        input.onClick = (clientX, clientY) => {
          if (state.disposed) return;
          const rect = gl.domElement.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;
          const width = rect.width;
          const height = rect.height;

          heroProjection
            .copy(state.heroSkyPosition)
            .project(perspective);
          if (
            heroProjection.z >= -1 &&
            heroProjection.z <= 1
          ) {
            const hx = (heroProjection.x * 0.5 + 0.5) * width;
            const hy = (-heroProjection.y * 0.5 + 0.5) * height;
            if (Math.hypot(hx - x, hy - y) <= 18) {
              const hero = markersRef.current.find(
                (marker) => marker.source === "hero",
              );
              if (hero) {
                selectRef.current(hero);
                return;
              }
            }
          }

          for (const marker of markersRef.current) {
            const physical = marker.physicalPositionPc;
            if (
              marker.source !== "catalog" ||
              marker.engine !== "v2" ||
              marker.nativeId ||
              !physical
            ) {
              continue;
            }

            observedDirection
              .set(physical[0], physical[1], physical[2])
              .sub(state.cameraPc);
            if (observedDirection.lengthSq() <= 1e-12) continue;
            observedDirection
              .normalize()
              .multiplyScalar(SKY_RADIUS_KM * 0.985);
            observedProjection.copy(observedDirection).project(perspective);
            if (observedProjection.z < -1 || observedProjection.z > 1) continue;

            const ox = (observedProjection.x * 0.5 + 0.5) * width;
            const oy = (-observedProjection.y * 0.5 + 0.5) * height;
            if (Math.hypot(ox - x, oy - y) <= 16) {
              selectRef.current(marker);
              return;
            }
          }

          const catalogIndex = state.starPoints.pick(
            x,
            y,
            perspective,
            width,
            height,
            runtime.universe.current.catalogIndex,
            16,
            7.2,
          );
          if (catalogIndex !== null) {
            selectNativeStar(`c${catalogIndex}`);
            return;
          }

          const proceduralId = state.procPoints.pick(
            x,
            y,
            perspective,
            width,
            height,
            runtime.universe.current.starId,
            16,
            7.2,
          );
          if (proceduralId) selectNativeStar(proceduralId);
        };

        document.documentElement.dataset.yeisNativeGalaxy = "ready";
        console.info(
          `[YEIS-NATIVE-GALAXY] READY stars=${runtime.catalog.count} cloud=${quality === "low" ? 90_000 : 180_000}`,
        );
      })
      .catch((error) => {
        if (!cancelled) {
          document.documentElement.dataset.yeisNativeGalaxy = "error";
          console.error("[YEIS-NATIVE-GALAXY] FAILED", error);
        }
      });

    return () => {
      cancelled = true;
      const state = stateRef.current;
      if (state) {
        viewStateRef.current = {
          positionKm: state.controller.position.toArray() as [number, number, number],
          quaternion: state.controller.quaternion.toArray() as [
            number,
            number,
            number,
            number,
          ],
        };
        state.disposed = true;
        state.input.dispose();
        state.starPoints.dispose(scene);
        state.procPoints.dispose(scene);
        state.galaxyCloud.dispose(scene);
        state.galaxySprites.dispose(scene);
        scene.remove(state.heroSky);
        state.heroSky.geometry.dispose();
        (state.heroSky.material as PointsMaterial).dispose();
        scene.remove(state.observedSky);
        state.observedSky.geometry.dispose();
        (state.observedSky.material as PointsMaterial).dispose();
        stateRef.current = null;
      }

      perspective.near = previousNear;
      perspective.far = previousFar;
      perspective.position.copy(previousPosition);
      perspective.quaternion.copy(previousQuaternion);
      perspective.updateProjectionMatrix();
      perspective.updateMatrixWorld();
      delete document.documentElement.dataset.yeisNativeGalaxy;
      delete document.documentElement.dataset.yeisHiplessObserved;
    };
  }, [gl, perspective, quality, scene, viewStateRef]);

  useFrame((_, delta) => {
    const state = stateRef.current;
    if (!state || state.disposed) return;
    const { runtime } = state;

    runtime.universe.update(2451545.0, performance.now() / 1000);

    const fovRad = perspective.fov * DEG;
    state.controller.update(
      delta,
      state.input,
      size.width,
      size.height,
      fovRad,
    );

    perspective.position.set(0, 0, 0);
    perspective.quaternion.copy(state.controller.quaternion);
    perspective.updateMatrixWorld();

    runtime.universe.toParsecs(
      state.controller.position,
      state.cameraPc,
    );

    state.galaxyAcc += delta;
    if (state.galaxyAcc >= 0.12) {
      state.galaxyAcc = 0;
      state.currentGalaxy = runtime.universe.galaxies.containing(
        state.cameraPc,
        3,
      );
      runtime.universe.currentGalaxy = state.currentGalaxy;
      runtime.universe.procStars.update(
        state.cameraPc,
        state.currentGalaxy,
      );
    }

    const pixelRatio = gl.getPixelRatio();
    const pxPerRad =
      size.height / 2 / Math.tan(fovRad / 2);

    state.starPoints.setPixelRatio(pixelRatio);
    state.starPoints.update(
      state.cameraPc,
      runtime.universe.current.catalogIndex,
    );
    state.procPoints.update(
      state.cameraPc,
      pixelRatio,
      runtime.universe.current.starId,
      delta,
    );
    state.galaxyCloud.update(
      state.cameraPc,
      pxPerRad,
      pixelRatio,
      true,
    );
    state.galaxySprites.update(
      state.cameraPc,
      pxPerRad,
      pixelRatio,
      0,
      state.currentGalaxy ?? -1,
    );

    const heroPc = runtime.universe.starPositionPc(HERO_SYSTEM_ID);
    state.heroSkyPosition
      .copy(heroPc)
      .sub(state.cameraPc);
    if (state.heroSkyPosition.lengthSq() > 1e-12) {
      state.heroSkyPosition
        .normalize()
        .multiplyScalar(SKY_RADIUS_KM * 0.99);
    }

    const position = state.heroSky.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    position.setXYZ(
      0,
      state.heroSkyPosition.x,
      state.heroSkyPosition.y,
      state.heroSkyPosition.z,
    );
    position.needsUpdate = true;

    const observedPosition = state.observedSky.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    let observedCount = 0;
    for (const marker of markersRef.current) {
      const physical = marker.physicalPositionPc;
      if (
        marker.source !== "catalog" ||
        marker.engine !== "v2" ||
        marker.nativeId ||
        !physical ||
        observedCount >= observedPosition.count
      ) {
        continue;
      }

      observedDirection
        .set(physical[0], physical[1], physical[2])
        .sub(state.cameraPc);
      if (observedDirection.lengthSq() <= 1e-12) continue;
      observedDirection
        .normalize()
        .multiplyScalar(SKY_RADIUS_KM * 0.985);
      observedPosition.setXYZ(
        observedCount,
        observedDirection.x,
        observedDirection.y,
        observedDirection.z,
      );
      observedCount += 1;
    }
    observedPosition.needsUpdate = true;
    state.observedSky.geometry.setDrawRange(0, observedCount);
    if (state.observedCount !== observedCount) {
      state.observedCount = observedCount;
      document.documentElement.dataset.yeisHiplessObserved =
        String(observedCount);
      console.info(
        `[YEIS-OBSERVED-OVERLAY] HIP-less physical hosts=${observedCount}`,
      );
    }
  });

  return <color attach="background" args={["#000005"]} />;
}
