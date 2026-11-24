import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Material,
  Mesh,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from "three";
import type { GalaxyMarker, QualityMode } from "../../lib/universe/types";
import type { UniverseContentPlacement } from "../../lib/universe/content";
import {
  navigationDestinationForGalaxy,
  navigationDestinationForLandmark,
  navigationDestinationForMarker,
  navigationDestinationForPlacement,
  resolveUniverseNavigationDestination,
  type UniverseNavigationCameraRequest,
  type UniverseNavigationDestination,
} from "../../lib/universe/yeis/navigation";
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
import {
  BodyRenderer,
  type RenderSettings,
} from "../../vendor/yeis/render/BodyRenderer";
import { BodyPoints } from "../../vendor/yeis/render/BodyPoints";
import { OrbitLines } from "../../vendor/yeis/render/OrbitLines";
import { starLightColor } from "../../vendor/yeis/astro/stellar";
import { IMAGERY } from "../../vendor/yeis/data/imagery";
import {
  nativeSystemOverviewDistance,
  nativeSystemSpan,
} from "../../lib/universe/yeis/systemScale";
import { GalaxyCloud } from "../../vendor/yeis/render/GalaxyCloud";
import { GalaxySprites } from "../../vendor/yeis/render/GalaxySprites";
import { LandmarkSprites } from "../../vendor/yeis/render/LandmarkSprites";
import { LANDMARK_IMAGES } from "../../vendor/yeis/data/landmarkImages";
import {
  WORLD_SCALE_EPSILON,
  galaxyScaleVisualResponse,
} from "../../lib/universe/continuousScale";

type NativeGalaxyState = {
  runtime: YeisCoreRuntime;
  controller: CameraController;
  input: Input;
  starPoints: StarPoints;
  procPoints: ProcStarPoints;
  galaxyClouds: Map<number, GalaxyCloud>;
  galaxySprites: GalaxySprites;
  landmarkSprites: LandmarkSprites;
  nativeSystemScene: Scene;
  nativeBodies: BodyRenderer;
  nativeBodyPoints: BodyPoints;
  nativeOrbits: OrbitLines;
  nativeSunColor: Vector3;
  nativeLuminosity: number;
  nativeSystemSpanKm: number;
  systemOverview: boolean;
  galaxyBoost: number;
  maxPointPx: number;
  cameraPc: Vector3;
  heroSky: Points;
  heroSkyPosition: Vector3;
  currentGalaxy: number | null;
  galaxyAcc: number;
  observedSky: Points;
  observedCount: number;
  contentSky: Points;
  contentCount: number;
  openingMotionArmed: boolean;
  disposed: boolean;
};

export type YeisGalaxyViewState = {
  starId: string;
  positionKm: [number, number, number];
  quaternion: [number, number, number, number];
  systemOverview: boolean;
};

export type YeisGalaxyScaleBridgeState = {
  targetId: string;
  starId: string;
  sourceFrameId: string;
  startAbsolutePositionKm: [number, number, number];
  startPositionKm: [number, number, number];
  startQuaternion: [number, number, number, number];
  targetCentreKm: [number, number, number];
  startDistanceKm: number;
  arrivalDistanceKm: number;
  approachDirection: [number, number, number];
  entryViewDirection: [number, number, number];
  frameSwitchJumpKm: number;
};

export type YeisSignalHover = {
  title: string;
  kind: string;
  clientX: number;
  clientY: number;
} | null;

const NATIVE_GALAXY_SYSTEM_SETTINGS: RenderSettings = {
  atmospheres: true,
  clouds: true,
  rings: true,
  ringParticles: false,
  shadows: true,
  imagery: false,
  fill: null,
};

function retargetNativeSystemRenderers(state: NativeGalaxyState) {
  const system = state.runtime.universe.current;
  system.update(2451545.0, performance.now() / 1000);

  // BodyView eagerly constructs TileGlobe and queues root imagery in its
  // constructor, even when RenderSettings.imagery is false. Galaxy-scale LOD
  // only needs the pinned procedural/native geometry, never external surface
  // tiles. Suppress registry entries synchronously while views are rebuilt,
  // then restore the shared registry for exact native body travel elsewhere.
  const suppressedImagery = new Map<
    string,
    (typeof IMAGERY)[string]
  >();
  for (const body of system.bodies) {
    const imagery = IMAGERY[body.data.id];
    if (!imagery) continue;
    suppressedImagery.set(body.data.id, imagery);
    delete IMAGERY[body.data.id];
  }
  try {
    state.nativeBodies.setSystem(system);
  } finally {
    for (const [id, imagery] of suppressedImagery) {
      IMAGERY[id] = imagery;
    }
  }
  state.nativeBodyPoints.setViews(state.nativeBodies.views);
  state.nativeOrbits.setSystem(system);
  const [r, g, b] = starLightColor(system.starTemperature);
  state.nativeSunColor.set(r, g, b);
  state.nativeLuminosity =
    state.runtime.universe.starInfo(system.starId).luminosity;
  state.nativeSystemSpanKm = nativeSystemSpan(system);
  document.documentElement.dataset.yeisNativeSystem = system.starId;
  document.documentElement.dataset.yeisNativeSystemReady = "true";
  document.documentElement.dataset.yeisNativeSystemSpanKm =
    state.nativeSystemSpanKm.toExponential(6);
}

function disposeNativeSystemRenderers(
  state: NativeGalaxyState,
  parentScene: Scene,
) {
  state.nativeBodies.dispose();
  state.nativeBodyPoints.dispose();
  state.nativeOrbits.dispose();
  state.nativeSystemScene.clear();
  parentScene.remove(state.nativeSystemScene);

}

const heroProjection = new Vector3();
const contentProjection = new Vector3();
const observedProjection = new Vector3();
const observedDirection = new Vector3();
const contentDirection = new Vector3();
const navigationDirection = new Vector3();
const navigationPoint = new Vector3();
const navigationNormal = new Vector3();
const navigationOrigin = new Vector3();

const scaleBridgeDirection = new Vector3();
const scaleBridgeAbsoluteBefore = new Vector3();
const scaleBridgeAbsoluteAfter = new Vector3();
const scaleBridgeTargetCentre = new Vector3();

function cameraAbsolutePosition(
  state: NativeGalaxyState,
  out: Vector3,
): Vector3 {
  return out
    .copy(state.controller.position)
    .add(state.runtime.universe.current.origin);
}

function switchScaleReferenceFrame(
  state: NativeGalaxyState,
  targetStarId: string,
): number {
  cameraAbsolutePosition(state, scaleBridgeAbsoluteBefore);
  if (state.runtime.universe.current.starId !== targetStarId) {
    const frameDelta = state.runtime.universe.switchTo(
      targetStarId,
      2451545.0,
      performance.now() / 1000,
    );
    state.controller.shiftFrame(
      frameDelta,
      state.runtime.universe.star,
    );
  }
  cameraAbsolutePosition(state, scaleBridgeAbsoluteAfter);
  const jumpKm = scaleBridgeAbsoluteBefore.distanceTo(
    scaleBridgeAbsoluteAfter,
  );
  document.documentElement.dataset.universeGalaxyScaleFrameJumpKm =
    jumpKm.toExponential(6);
  return jumpKm;
}

function scaleTargetNativeStarId(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): string | null {
  const target = destination.target;
  if (target.kind === "star") return target.nativeId;
  if (target.kind === "body") return target.starId;
  if (target.kind === "content") return target.nativeId;
  if (target.kind === "marker" || target.kind === "observed-body") {
    return (
      markers.find((marker) => marker.id === target.markerId)?.nativeId ??
      null
    );
  }
  return null;
}

export function YeisGalaxyScene({
  markers,
  contentPlacements,
  navigationRequest,
  onNavigationComplete,
  onNavigationFailed,
  onNavigateDestination,
  onSignalHover,
  onScaleFocus,
  onScaleManualTakeover,
  quality,
  reducedMotion,
  scalePosition,
  scaleTarget,
  scaleBridgeRef,
  viewStateRef,
}: {
  markers: GalaxyMarker[];
  contentPlacements: UniverseContentPlacement[];
  navigationRequest: UniverseNavigationCameraRequest | null;
  onNavigationComplete: (request: UniverseNavigationCameraRequest) => void;
  onNavigationFailed: (
    request: UniverseNavigationCameraRequest,
    reason: string,
  ) => void;
  onNavigateDestination: (
    destination: UniverseNavigationDestination,
  ) => Promise<void> | void;
  onSignalHover: (hover: YeisSignalHover) => void;
  onScaleFocus?: (destination: UniverseNavigationDestination | null) => void;
  onScaleManualTakeover?: () => void;
  quality: QualityMode;
  reducedMotion: boolean;
  scalePosition: number;
  scaleTarget: UniverseNavigationDestination | null;
  scaleBridgeRef: MutableRefObject<YeisGalaxyScaleBridgeState | null>;
  viewStateRef: MutableRefObject<YeisGalaxyViewState | null>;
}) {
  const { gl, scene, camera, size } = useThree();
  const perspective = camera as PerspectiveCamera;
  const stateRef = useRef<NativeGalaxyState | null>(null);
  const markersRef = useRef(markers);
  const contentPlacementsRef = useRef(contentPlacements);
  const navigationRequestRef = useRef(navigationRequest);
  const lastNavigationRequestRef = useRef(0);
  const navigationStartQuaternionRef = useRef<
    [number, number, number, number] | null
  >(null);
  const navigationStartPositionRef = useRef<
    [number, number, number] | null
  >(null);
  const navigationStartPcRef = useRef<
    [number, number, number] | null
  >(null);
  const pendingNavigationRef =
    useRef<UniverseNavigationCameraRequest | null>(null);
  const locatedDestinationIdRef = useRef<string | null>(null);
  const locatedScaleFocusRef =
    useRef<UniverseNavigationDestination | null>(null);
  const navigationCompleteRef = useRef(onNavigationComplete);
  const navigationFailureRef = useRef(onNavigationFailed);
  const navigateRef = useRef(onNavigateDestination);
  const signalHoverRef = useRef(onSignalHover);
  const scaleFocusRef = useRef(onScaleFocus);
  const scaleManualTakeoverRef = useRef(onScaleManualTakeover);
  const scaleManualTakeoverReportedRef = useRef(false);
  const scaleFocusIdRef = useRef<string | null>(null);
  const scaleFocusFrameRef = useRef(0);
  const scaleBridgeControllerKeyRef = useRef<string | null>(null);
  const scalePositionRef = useRef(scalePosition);
  const scaleTargetRef =
    useRef<UniverseNavigationDestination | null>(scaleTarget);

  scalePositionRef.current = scalePosition;
  scaleTargetRef.current = scaleTarget;

  useEffect(() => {
    if (scaleTarget) {
      scaleManualTakeoverReportedRef.current = false;
    }
  }, [scaleTarget?.id]);

  markersRef.current = markers;
  contentPlacementsRef.current = contentPlacements;
  navigationRequestRef.current = navigationRequest;
  navigationCompleteRef.current = onNavigationComplete;
  navigationFailureRef.current = onNavigationFailed;
  navigateRef.current = onNavigateDestination;
  signalHoverRef.current = onSignalHover;
  scaleFocusRef.current = onScaleFocus;
  scaleManualTakeoverRef.current = onScaleManualTakeover;

  useEffect(() => {
    let cancelled = false;
    let removeHoverListeners: (() => void) | null = null;
    let removeScaleWheelListener: (() => void) | null = null;
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
        const landmarkSprites = new LandmarkSprites(
          runtime.universe.landmarks,
          scene,
        );
        const galaxyClouds = new Map<number, GalaxyCloud>();
        const milkyWay = runtime.universe.galaxies.model(0);

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

        const initialSignalCapacity = Math.max(
          32,
          2 ** Math.ceil(
            Math.log2(contentPlacementsRef.current.length + 1),
          ),
        );
        const contentGeometry = new BufferGeometry();
        contentGeometry.setAttribute(
          "position",
          new BufferAttribute(
            new Float32Array(initialSignalCapacity * 3),
            3,
          ),
        );
        contentGeometry.setDrawRange(0, 0);
        document.documentElement.dataset.personalSignalCapacity =
          String(initialSignalCapacity);
        const contentMaterial = new PointsMaterial({
          color: 0x73f4ff,
          size: quality === "low" ? 8 : 11,
          sizeAttenuation: false,
          transparent: true,
          opacity: 0.98,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        });
        const contentSky = new Points(contentGeometry, contentMaterial);
        contentSky.frustumCulled = false;
        contentSky.renderOrder = -6;
        scene.add(contentSky);

        const savedView = viewStateRef.current;
        if (
          savedView &&
          runtime.universe.current.starId !== savedView.starId
        ) {
          runtime.universe.switchTo(
            savedView.starId,
            2451545.0,
            performance.now() / 1000,
          );
        }

        const input = new Input(gl.domElement);
        const controller = new CameraController(runtime.universe);
        const nativeSystemScene = new Scene();
        scene.add(nativeSystemScene);
        const nativeBodies = new BodyRenderer(
          nativeSystemScene,
          gl.capabilities.getMaxAnisotropy(),
        );
        const nativeBodyPoints = new BodyPoints(nativeSystemScene);
        const nativeOrbits = new OrbitLines(nativeSystemScene);
        const nativeSunColor = new Vector3(1, 1, 1);
        const onScaleWheel = () => {
          if (controller.autoOrbit !== 0) {
            controller.autoOrbit = 0;
            if (
              document.documentElement.dataset.yeisOpeningMotion ===
              "auto-orbit"
            ) {
              document.documentElement.dataset.yeisOpeningMotion = "stopped";
            }
          }
        };
        gl.domElement.addEventListener("wheel", onScaleWheel, {
          passive: true,
        });
        removeScaleWheelListener = () => {
          gl.domElement.removeEventListener("wheel", onScaleWheel);
        };

        const viewLocal = new Vector3(
          milkyWay.radius * 0.08,
          milkyWay.radius * 1.18,
          milkyWay.radius * 1.62,
        );
        const cameraPc = milkyWay.toScene(viewLocal, new Vector3());
        const orbitCenterKm = milkyWay.center.clone().multiplyScalar(PARSEC_KM);
        const orbitRadiusKm = milkyWay.radius * 0.045 * PARSEC_KM;
        if (savedView) {
          controller.position.fromArray(savedView.positionKm);
          if (savedView.systemOverview) {
            const span = nativeSystemSpan(runtime.universe.current);
            controller.orbitPoint(
              runtime.universe.star.position,
              span,
              runtime.universe.star.name,
            );
          } else {
            controller.setReference(runtime.universe.star);
          }
          controller.quaternion.fromArray(savedView.quaternion);
          runtime.universe.toParsecs(controller.position, cameraPc);
        } else {
          controller.position.copy(cameraPc).multiplyScalar(PARSEC_KM);
          controller.orbitPoint(orbitCenterKm, orbitRadiusKm, "Milky Way");
        }

        const motionFrozen =
          new URLSearchParams(window.location.search).get("freeze") === "1";
        const openingMotionArmed =
          !savedView && !reducedMotion && !motionFrozen;
        controller.autoOrbit = openingMotionArmed ? 0.018 : 0;
        document.documentElement.dataset.yeisOpeningMotion =
          openingMotionArmed
            ? "auto-orbit"
            : motionFrozen
              ? "frozen"
              : reducedMotion
                ? "reduced"
                : "restored";

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
          galaxyClouds,
          galaxySprites,
          landmarkSprites,
          nativeSystemScene,
          nativeBodies,
          nativeBodyPoints,
          nativeOrbits,
          nativeSunColor,
          nativeLuminosity: 1,
          nativeSystemSpanKm: 1,
          systemOverview: savedView?.systemOverview ?? false,
          galaxyBoost: 0,
          maxPointPx,
          cameraPc,
          heroSky,
          heroSkyPosition: new Vector3(),
          observedSky,
          observedCount: 0,
          contentSky,
          contentCount: 0,
          openingMotionArmed,
          currentGalaxy: null,
          galaxyAcc: 1,
          disposed: false,
        };
        stateRef.current = state;
        retargetNativeSystemRenderers(state);

        const navigateDestination = (
          destination: UniverseNavigationDestination,
        ) => {
          document.documentElement.dataset.yeisPickedTarget = destination.id;
          void navigateRef.current(destination);
        };

        const navigateNativeStar = (starId: string) => {
          const marker = markerForYeisStarId(
            runtime,
            markersRef.current,
            starId,
          );
          const destination = navigationDestinationForMarker(
            marker,
            contentPlacementsRef.current,
          );
          console.info(
            `[YEIS-NATIVE-PICK] star=${starId} marker=${marker.id} destination=${destination.id}`,
          );
          navigateDestination(destination);
        };

        input.onClick = (clientX, clientY) => {
          if (state.disposed) return;
          const rect = gl.domElement.getBoundingClientRect();
          const x = clientX - rect.left;
          const y = clientY - rect.top;
          const width = rect.width;
          const height = rect.height;
          const pickRadius = state.input.coarse ? 24 : 17;
          const signalPickRadius = state.input.coarse ? 18 : 10;
          const heroPickRadius = state.input.coarse ? 18 : 8;

          const locatedDestinationId = locatedDestinationIdRef.current;
          if (
            locatedDestinationId &&
            Math.hypot(x - width / 2, y - height / 2) <= pickRadius
          ) {
            locatedDestinationIdRef.current = null;
            locatedScaleFocusRef.current = null;
            void resolveUniverseNavigationDestination(
              locatedDestinationId,
              contentPlacementsRef.current,
              markersRef.current,
            ).then((destination) => {
              if (!destination) return;
              console.info(
                `[YEIS-LOCATED-PICK] ${locatedDestinationId} -> ${destination.id}`,
              );
              navigateDestination(destination);
            });
            return;
          }

          const markerById = new Map(
            markersRef.current.map((marker) => [marker.id, marker]),
          );
          let nearestSignal:
            | { placement: UniverseContentPlacement; distance: number }
            | null = null;
          for (const placement of contentPlacementsRef.current) {
            const marker = markerById.get(placement.markerId);
            const nativeId = placement.nativeId ?? marker?.nativeId;
            if (!nativeId) continue;
            const starPc = runtime.universe.starPositionPc(nativeId);
            contentDirection.copy(starPc).sub(state.cameraPc);
            if (contentDirection.lengthSq() <= 1e-12) continue;
            contentDirection
              .normalize()
              .multiplyScalar(SKY_RADIUS_KM * 0.992);
            contentProjection.copy(contentDirection).project(perspective);
            if (contentProjection.z < -1 || contentProjection.z > 1) continue;
            const sx = (contentProjection.x * 0.5 + 0.5) * width;
            const sy = (-contentProjection.y * 0.5 + 0.5) * height;
            const distance = Math.hypot(sx - x, sy - y);
            if (
              distance <= signalPickRadius &&
              (!nearestSignal || distance < nearestSignal.distance)
            ) {
              nearestSignal = { placement, distance };
            }
          }

          if (nearestSignal) {
            const destination = navigationDestinationForPlacement(
              nearestSignal.placement,
              markersRef.current,
            );
            if (destination) {
              console.info(
                `[PERSONAL-SIGNAL-PICK] ${nearestSignal.placement.entry.id} -> ${destination.id}`,
              );
              navigateDestination(destination);
              return;
            }
          }

          heroProjection.copy(state.heroSkyPosition).project(perspective);
          if (heroProjection.z >= -1 && heroProjection.z <= 1) {
            const hx = (heroProjection.x * 0.5 + 0.5) * width;
            const hy = (-heroProjection.y * 0.5 + 0.5) * height;
            if (Math.hypot(hx - x, hy - y) <= heroPickRadius) {
              const hero = markersRef.current.find(
                (marker) => marker.source === "hero",
              );
              if (hero) {
                navigateDestination(
                  navigationDestinationForMarker(
                    hero,
                    contentPlacementsRef.current,
                  ),
                );
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
            if (Math.hypot(ox - x, oy - y) <= pickRadius) {
              navigateDestination(
                navigationDestinationForMarker(
                  marker,
                  contentPlacementsRef.current,
                ),
              );
              return;
            }
          }

          const landmarkIndex = state.landmarkSprites.pick(
            x,
            y,
            perspective,
            width,
            height,
            pickRadius,
          );
          if (landmarkIndex !== null) {
            navigateDestination(
              navigationDestinationForLandmark(runtime, landmarkIndex),
            );
            return;
          }

          const pxPerRad =
            height / 2 / Math.tan((perspective.fov * DEG) / 2);
          const galaxyIndex = state.galaxySprites.pick(
            x,
            y,
            perspective,
            width,
            height,
            pxPerRad,
            state.galaxyBoost,
            state.currentGalaxy ?? -1,
            pickRadius,
          );
          if (galaxyIndex !== null) {
            navigateDestination(
              navigationDestinationForGalaxy(runtime, galaxyIndex),
            );
            return;
          }

          const catalogIndex = state.starPoints.pick(
            x,
            y,
            perspective,
            width,
            height,
            runtime.universe.current.catalogIndex,
            pickRadius,
            7.2,
          );
          if (catalogIndex !== null) {
            navigateNativeStar(`c${catalogIndex}`);
            return;
          }

          const proceduralId = state.procPoints.pick(
            x,
            y,
            perspective,
            width,
            height,
            runtime.universe.current.starId,
            pickRadius,
            7.2,
          );
          if (proceduralId) navigateNativeStar(proceduralId);
        };

        const clearSignalHover = () => {
          gl.domElement.style.cursor = "";
          delete document.documentElement.dataset.personalSignalHover;
          signalHoverRef.current(null);
        };

        let hoverFrame = 0;
        let hoverEvent: PointerEvent | null = null;

        const resolveSignalHover = () => {
          hoverFrame = 0;
          const event = hoverEvent;
          hoverEvent = null;
          if (
            !event ||
            state.disposed ||
            state.input.coarse ||
            state.input.dragging
          ) {
            clearSignalHover();
            return;
          }

          const rect = gl.domElement.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          let best:
            | { placement: UniverseContentPlacement; distance: number }
            | null = null;
          const markerById = new Map(
            markersRef.current.map((marker) => [marker.id, marker]),
          );

          for (const placement of contentPlacementsRef.current) {
            const marker = markerById.get(placement.markerId);
            const nativeId = placement.nativeId ?? marker?.nativeId;
            if (!nativeId) continue;
            const starPc = runtime.universe.starPositionPc(nativeId);
            contentDirection.copy(starPc).sub(state.cameraPc);
            if (contentDirection.lengthSq() <= 1e-12) continue;
            contentDirection
              .normalize()
              .multiplyScalar(SKY_RADIUS_KM * 0.992);
            contentProjection.copy(contentDirection).project(perspective);
            if (contentProjection.z < -1 || contentProjection.z > 1) continue;
            const sx = (contentProjection.x * 0.5 + 0.5) * rect.width;
            const sy = (-contentProjection.y * 0.5 + 0.5) * rect.height;
            const distance = Math.hypot(sx - x, sy - y);
            if (distance <= 20 && (!best || distance < best.distance)) {
              best = { placement, distance };
            }
          }

          if (!best) {
            clearSignalHover();
            return;
          }

          gl.domElement.style.cursor = "pointer";
          document.documentElement.dataset.personalSignalHover =
            best.placement.entry.id;
          signalHoverRef.current({
            title: best.placement.entry.title,
            kind: best.placement.entry.kind,
            clientX: event.clientX,
            clientY: event.clientY,
          });
        };

        const onSignalPointerMove = (event: PointerEvent) => {
          hoverEvent = event;
          if (!hoverFrame) {
            hoverFrame = window.requestAnimationFrame(resolveSignalHover);
          }
        };

        const onSignalPointerLeave = () => {
          hoverEvent = null;
          if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
          hoverFrame = 0;
          clearSignalHover();
        };

        gl.domElement.addEventListener("pointermove", onSignalPointerMove);
        gl.domElement.addEventListener("pointerleave", onSignalPointerLeave);
        removeHoverListeners = () => {
          gl.domElement.removeEventListener("pointermove", onSignalPointerMove);
          gl.domElement.removeEventListener(
            "pointerleave",
            onSignalPointerLeave,
          );
          onSignalPointerLeave();
        };

        document.documentElement.dataset.yeisNativeGalaxy = "ready";
        document.documentElement.dataset.yeisLandmarks = String(
          runtime.universe.landmarks.length,
        );
        document.documentElement.dataset.yeisLandmarkPhotos = String(
          Object.keys(LANDMARK_IMAGES).length,
        );
        console.info(
          `[YEIS-NATIVE-GALAXY] READY stars=${runtime.catalog.count} landmarks=${runtime.universe.landmarks.length} photos=${Object.keys(LANDMARK_IMAGES).length} cloud=${quality === "low" ? 90_000 : 180_000}`,
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
      removeHoverListeners?.();
      removeScaleWheelListener?.();
      const state = stateRef.current;
      if (state) {
        viewStateRef.current = {
          starId: state.runtime.universe.current.starId,
          positionKm: state.controller.position.toArray() as [number, number, number],
          quaternion: state.controller.quaternion.toArray() as [
            number,
            number,
            number,
            number,
          ],
          systemOverview: state.systemOverview,
        };
        state.disposed = true;
        state.input.dispose();
        disposeNativeSystemRenderers(state, scene);
        state.starPoints.dispose(scene);
        state.procPoints.dispose(scene);
        for (const cloud of state.galaxyClouds.values()) cloud.dispose(scene);
        state.galaxyClouds.clear();
        state.galaxySprites.dispose(scene);
        state.landmarkSprites.dispose(scene);
        scene.remove(state.heroSky);
        state.heroSky.geometry.dispose();
        (state.heroSky.material as PointsMaterial).dispose();
        scene.remove(state.observedSky);
        state.observedSky.geometry.dispose();
        (state.observedSky.material as PointsMaterial).dispose();
        scene.remove(state.contentSky);
        state.contentSky.geometry.dispose();
        (state.contentSky.material as PointsMaterial).dispose();
        stateRef.current = null;
      }

      perspective.near = previousNear;
      perspective.far = previousFar;
      perspective.position.copy(previousPosition);
      perspective.quaternion.copy(previousQuaternion);
      perspective.updateProjectionMatrix();
      perspective.updateMatrixWorld();
      delete document.documentElement.dataset.yeisNativeGalaxy;
      delete document.documentElement.dataset.yeisLandmarks;
      delete document.documentElement.dataset.yeisLandmarkPhotos;
      delete document.documentElement.dataset.yeisLandmarkPhotosRequested;
      delete document.documentElement.dataset.yeisLandmarkPhotosLoaded;
      delete document.documentElement.dataset.yeisLandmarkPhotosFailed;
      delete document.documentElement.dataset.yeisLandmarkPhotosComplete;
      delete document.documentElement.dataset.yeisPickedTarget;
      delete document.documentElement.dataset.yeisHiplessObserved;
      delete document.documentElement.dataset.personalSignalOverlay;
      delete document.documentElement.dataset.personalSignalCapacity;
      delete document.documentElement.dataset.yeisGalaxyClouds;
      delete document.documentElement.dataset.yeisCurrentGalaxy;
      delete document.documentElement.dataset.yeisOpeningMotion;
      delete document.documentElement.dataset.yeisNativeSystem;
      delete document.documentElement.dataset.yeisNativeSystemReady;
      delete document.documentElement.dataset.yeisNativeSystemSpanKm;
      delete document.documentElement.dataset.yeisNativeSystemOverview;
      delete document.documentElement.dataset.yeisNativeSystemArrivalRatio;
      locatedScaleFocusRef.current = null;
      if (scaleFocusIdRef.current !== null) {
        scaleFocusIdRef.current = null;
        scaleFocusRef.current?.(null);
      }
      delete document.documentElement.dataset.universeTraveling;
      delete document.documentElement.dataset.universeTravelArrivalRatio;
    };
  }, [gl, perspective, quality, reducedMotion, scene, viewStateRef]);

  useFrame((_, delta) => {
    const state = stateRef.current;
    if (!state || state.disposed) return;
    const { runtime } = state;

    runtime.universe.update(2451545.0, performance.now() / 1000);

    const manualCameraInput =
      state.input.dragX !== 0 ||
      state.input.dragY !== 0 ||
      state.input.pinch !== 0 ||
      state.input.panX !== 0 ||
      state.input.panY !== 0 ||
      state.input.keys.size > 0;
    if (manualCameraInput) {
      locatedDestinationIdRef.current = null;
      locatedScaleFocusRef.current = null;
      if (state.systemOverview) {
        state.systemOverview = false;
        delete document.documentElement.dataset.yeisNativeSystemOverview;
      }
    }

    const fovRad = perspective.fov * DEG;
    // Product-level continuous scale navigation owns mouse-wheel scale.
    // Preserve YEIS drag/orbit/autopilot while suppressing its wheel dolly/speed.
    const manualScaleTakeover =
      Math.abs(state.input.dragX) > 0.01 ||
      Math.abs(state.input.dragY) > 0.01 ||
      Math.abs(state.input.pinch) > 0.0001 ||
      Math.abs(state.input.panX) > 0.01 ||
      Math.abs(state.input.panY) > 0.01 ||
      state.input.keys.size > 0;
    if (manualScaleTakeover) {
      // Pointer/touch takeover is an authority boundary, not a request to let
      // the time-driven YEIS autopilot finish one more frame. Freeze exactly
      // where the continuous coordinate left the camera before manual input is
      // applied, then let native free/orbit controls take over from there.
      state.controller.autopilot = null;
      state.controller.autoOrbit = 0;
      state.controller.velocity.set(0, 0, 0);
      if (!scaleManualTakeoverReportedRef.current) {
        scaleManualTakeoverReportedRef.current = true;
        scaleManualTakeoverRef.current?.();
      }
    }
    const scaleDestination = scaleTargetRef.current;
    const scalePosition = Math.min(
      1,
      Math.max(0, scalePositionRef.current),
    );
    let scaleBridgeActive = false;

    if (scaleDestination && !manualScaleTakeover) {
      const targetStarId = scaleTargetNativeStarId(
        scaleDestination,
        markersRef.current,
      );
      if (targetStarId) {
        scaleBridgeActive = true;
        let bridge = scaleBridgeRef.current;

        if (
          !bridge ||
          bridge.targetId !== scaleDestination.id ||
          bridge.starId !== targetStarId
        ) {
          const sourceFrameId = runtime.universe.current.starId;
          const startAbsolutePositionKm = cameraAbsolutePosition(
            state,
            scaleBridgeAbsoluteBefore,
          ).toArray() as [number, number, number];
          const startQuaternion =
            state.controller.quaternion.toArray() as [
              number,
              number,
              number,
              number,
            ];
          const frameSwitchJumpKm = switchScaleReferenceFrame(
            state,
            targetStarId,
          );
          retargetNativeSystemRenderers(state);

          const star = runtime.universe.star;
          const targetCentre = scaleBridgeTargetCentre.copy(star.position);
          const arrivalDistance = nativeSystemOverviewDistance(
            runtime.universe.current,
            perspective.getEffectiveFOV(),
            perspective.aspect,
          );
          scaleBridgeDirection
            .copy(state.controller.position)
            .sub(targetCentre);
          const startDistanceKm = scaleBridgeDirection.length();
          if (scaleBridgeDirection.lengthSq() <= 1e-18) {
            scaleBridgeDirection
              .set(0, 0, 1)
              .applyQuaternion(state.controller.quaternion);
          }
          scaleBridgeDirection.normalize();

          bridge = {
            targetId: scaleDestination.id,
            starId: targetStarId,
            sourceFrameId,
            startAbsolutePositionKm,
            startPositionKm:
              state.controller.position.toArray() as [
                number,
                number,
                number,
              ],
            startQuaternion,
            targetCentreKm:
              targetCentre.toArray() as [number, number, number],
            startDistanceKm,
            arrivalDistanceKm: arrivalDistance,
            approachDirection:
              scaleBridgeDirection.toArray() as [
                number,
                number,
                number,
              ],
            entryViewDirection:
              scaleBridgeDirection.toArray() as [
                number,
                number,
                number,
              ],
            frameSwitchJumpKm,
          };
          scaleBridgeRef.current = bridge;
          document.documentElement.dataset.universeGalaxyScalePath =
            `${sourceFrameId}->${targetStarId}`;
          document.documentElement.dataset.universeGalaxyScaleStartDistanceKm =
            startDistanceKm.toExponential(6);
          document.documentElement.dataset.universeGalaxyScaleEndpointDistanceKm =
            arrivalDistance.toExponential(6);
        } else if (runtime.universe.current.starId !== bridge.starId) {
          switchScaleReferenceFrame(state, bridge.starId);
          retargetNativeSystemRenderers(state);
        }

        // Recreate the pinned YEIS gotoPoint trajectory whenever Galaxy
        // remounts from product System or scale input supersedes an older
        // Locate/Travel autopilot. The trajectory itself is retained, but its
        // execution is scrubbed directly from the product scale coordinate;
        // elapsed time is not an authority for Galaxy -> System motion.
        const bridgeControllerKey =
          bridge.targetId + ":" + bridge.starId;
        if (
          scaleBridgeControllerKeyRef.current !== bridgeControllerKey ||
          !state.controller.autopilot
        ) {
          pendingNavigationRef.current = null;
          state.controller.autopilot = null;
          state.controller.position.fromArray(bridge.startPositionKm);
          state.controller.quaternion.fromArray(bridge.startQuaternion);
          state.controller.goToPoint(
            scaleBridgeTargetCentre.fromArray(bridge.targetCentreKm),
            bridge.arrivalDistanceKm,
            scaleBridgeDirection.fromArray(bridge.entryViewDirection),
            {
              radius: state.nativeSystemSpanKm,
              name: runtime.universe.star.name,
            },
          );
          scaleBridgeControllerKeyRef.current = bridgeControllerKey;
        }

        const visualScalePosition =
          galaxyScaleVisualResponse(scalePosition);
        state.controller.setAutopilotProgress(visualScalePosition);
        document.documentElement.dataset.universeGalaxyScaleExecutor =
          "native-progress";
        document.documentElement.dataset.universeGalaxyScaleVisualProgress =
          visualScalePosition.toFixed(4);
        state.controller.autoOrbit = 0;
        state.controller.speed = 0;
        state.systemOverview =
          scalePosition >= 1 - WORLD_SCALE_EPSILON;

        document.documentElement.dataset.yeisNativeSystemOverview =
          state.systemOverview
            ? bridge.starId
            : "approaching:" + bridge.starId;
        document.documentElement.dataset.universeTravelArrivalRatio =
          (
            state.controller.position.distanceTo(
              scaleBridgeTargetCentre.fromArray(bridge.targetCentreKm),
            ) / Math.max(state.nativeSystemSpanKm, 1)
          ).toFixed(4);
        document.documentElement.dataset.universeGalaxyScaleBridge =
          state.systemOverview
            ? "system-endpoint"
            : scalePosition <= WORLD_SCALE_EPSILON
              ? "galaxy-endpoint"
              : "active";
      }
    } else if (
      scaleBridgeRef.current ||
      scaleBridgeControllerKeyRef.current
    ) {
      // A real authority takeover (manual camera, Search result, Journey,
      // explicit navigation) clears the retained path and freezes the native
      // scale executor immediately. Merely reaching Galaxy coordinate zero
      // does not: the target is still present in that case and reverse/forward
      // scrubbing must keep the same path identity.
      scaleBridgeRef.current = null;
      scaleBridgeControllerKeyRef.current = null;
      state.controller.autopilot = null;
      state.controller.speed = 0;
      state.systemOverview = false;
      delete document.documentElement.dataset.universeGalaxyScaleBridge;
      delete document.documentElement.dataset.universeGalaxyScaleExecutor;
      delete document.documentElement.dataset.universeGalaxyScaleVisualProgress;
      delete document.documentElement.dataset.yeisNativeSystemOverview;
    }

    state.input.wheel = 0;
    state.controller.update(
      delta,
      state.input,
      size.width,
      size.height,
      fovRad,
    );

    if (scaleBridgeActive && scaleBridgeRef.current) {
      const bridge = scaleBridgeRef.current;
      document.documentElement.dataset.universeTravelArrivalRatio =
        (
          state.controller.position.distanceTo(
            scaleBridgeTargetCentre.fromArray(bridge.targetCentreKm),
          ) / Math.max(state.nativeSystemSpanKm, 1)
        ).toFixed(4);
      if (scalePosition >= 1 - WORLD_SCALE_EPSILON) {
        state.systemOverview = true;
        viewStateRef.current = {
          starId: runtime.universe.current.starId,
          positionKm:
            state.controller.position.toArray() as [
              number,
              number,
              number,
            ],
          quaternion:
            state.controller.quaternion.toArray() as [
              number,
              number,
              number,
              number,
            ],
          systemOverview: true,
        };
        document.documentElement.dataset.yeisNativeSystemOverview =
          bridge.starId;
      }
    }

    if (
      state.openingMotionArmed &&
      document.documentElement.dataset.universeScaleDirection
    ) {
      state.controller.autoOrbit = 0;
      state.openingMotionArmed = false;
    }

    if (
      state.controller.autoOrbit === 0 &&
      document.documentElement.dataset.yeisOpeningMotion === "auto-orbit"
    ) {
      document.documentElement.dataset.yeisOpeningMotion = "stopped";
    }

    perspective.position.set(0, 0, 0);
    perspective.quaternion.copy(state.controller.quaternion);
    perspective.updateMatrixWorld();

    runtime.universe.toParsecs(
      state.controller.position,
      state.cameraPc,
    );

    viewStateRef.current = {
      starId: runtime.universe.current.starId,
      positionKm: state.controller.position.toArray() as [number, number, number],
      quaternion: state.controller.quaternion.toArray() as [
        number,
        number,
        number,
        number,
      ],
      systemOverview: state.systemOverview,
    };

    if (scaleFocusRef.current) {
      scaleFocusFrameRef.current = (scaleFocusFrameRef.current + 1) % 6;
      if (scaleFocusFrameRef.current === 0) {
        const width = size.width;
        const height = size.height;
        const cx = width / 2;
        const cy = height / 2;
        const focusRadius = state.input.coarse ? 54 : 42;
        const signalRadius = state.input.coarse ? 44 : 34;
        let focused: UniverseNavigationDestination | null =
          locatedScaleFocusRef.current;

        const markerById = new Map(
          markersRef.current.map((marker) => [marker.id, marker]),
        );
        let nearestSignal:
          | { placement: UniverseContentPlacement; distance: number }
          | null = null;

        for (const placement of contentPlacementsRef.current) {
          const marker = markerById.get(placement.markerId);
          const nativeId = placement.nativeId ?? marker?.nativeId;
          if (!nativeId) continue;
          const starPc = runtime.universe.starPositionPc(nativeId);
          contentDirection.copy(starPc).sub(state.cameraPc);
          if (contentDirection.lengthSq() <= 1e-12) continue;
          contentDirection
            .normalize()
            .multiplyScalar(SKY_RADIUS_KM * 0.992);
          contentProjection.copy(contentDirection).project(perspective);
          if (contentProjection.z < -1 || contentProjection.z > 1) continue;
          const sx = (contentProjection.x * 0.5 + 0.5) * width;
          const sy = (-contentProjection.y * 0.5 + 0.5) * height;
          const distance = Math.hypot(sx - cx, sy - cy);
          if (
            distance <= signalRadius &&
            (!nearestSignal || distance < nearestSignal.distance)
          ) {
            nearestSignal = { placement, distance };
          }
        }

        if (nearestSignal) {
          focused = navigationDestinationForPlacement(
            nearestSignal.placement,
            markersRef.current,
          );
        }

        if (!focused) {
          heroProjection.copy(state.heroSkyPosition).project(perspective);
          if (heroProjection.z >= -1 && heroProjection.z <= 1) {
            const hx = (heroProjection.x * 0.5 + 0.5) * width;
            const hy = (-heroProjection.y * 0.5 + 0.5) * height;
            if (Math.hypot(hx - cx, hy - cy) <= signalRadius) {
              const hero = markersRef.current.find(
                (marker) => marker.source === "hero",
              );
              if (hero) {
                focused = navigationDestinationForMarker(
                  hero,
                  contentPlacementsRef.current,
                );
              }
            }
          }
        }

        if (!focused) {
          let nearestObserved:
            | { marker: GalaxyMarker; distance: number }
            | null = null;
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
            const distance = Math.hypot(ox - cx, oy - cy);
            if (
              distance <= focusRadius &&
              (!nearestObserved || distance < nearestObserved.distance)
            ) {
              nearestObserved = { marker, distance };
            }
          }
          if (nearestObserved) {
            focused = navigationDestinationForMarker(
              nearestObserved.marker,
              contentPlacementsRef.current,
            );
          }
        }

        if (!focused) {
          const catalogIndex = state.starPoints.pick(
            cx,
            cy,
            perspective,
            width,
            height,
            runtime.universe.current.catalogIndex,
            focusRadius,
            7.2,
          );
          if (catalogIndex !== null) {
            const starId = `c${catalogIndex}`;
            const marker = markerForYeisStarId(
              runtime,
              markersRef.current,
              starId,
            );
            focused = navigationDestinationForMarker(
              marker,
              contentPlacementsRef.current,
            );
          }
        }

        if (!focused) {
          const proceduralId = state.procPoints.pick(
            cx,
            cy,
            perspective,
            width,
            height,
            runtime.universe.current.starId,
            focusRadius,
            7.2,
          );
          if (proceduralId) {
            const marker = markerForYeisStarId(
              runtime,
              markersRef.current,
              proceduralId,
            );
            focused = navigationDestinationForMarker(
              marker,
              contentPlacementsRef.current,
            );
          }
        }

        const nextId = focused?.id ?? null;
        if (nextId !== scaleFocusIdRef.current) {
          scaleFocusIdRef.current = nextId;
          scaleFocusRef.current(focused);
        }
      }
    }

    const request = navigationRequestRef.current;
    if (
      request &&
      request.requestId !== lastNavigationRequestRef.current
    ) {
      const targetKey = cameraTargetKey(request.target);

      navigationStartQuaternionRef.current =
        state.controller.quaternion.toArray() as [
          number,
          number,
          number,
          number,
        ];
      navigationStartPositionRef.current =
        state.controller.position.toArray() as [number, number, number];
      navigationStartPcRef.current = runtime.universe
        .toParsecs(state.controller.position, new Vector3())
        .toArray() as [number, number, number];
      pendingNavigationRef.current = null;
      locatedDestinationIdRef.current = null;
      locatedScaleFocusRef.current = null;
      lastNavigationRequestRef.current = request.requestId;
      if (request.mode === "travel") {
        state.systemOverview = false;
        delete document.documentElement.dataset.yeisNativeSystemOverview;
      }

      if (request.mode === "locate") {
        if (request.target.kind === "star") {
          const targetPc = runtime.universe.starPositionPc(
            request.target.nativeId,
          );
          navigationDirection.copy(targetPc).sub(state.cameraPc);
        } else if (request.target.kind === "point") {
          navigationDirection
            .set(
              request.target.positionPc[0],
              request.target.positionPc[1],
              request.target.positionPc[2],
            )
            .sub(state.cameraPc);
        } else if (request.target.kind === "body") {
          const targetPc = runtime.universe.starPositionPc(
            request.target.starId,
          );
          navigationDirection.copy(targetPc).sub(state.cameraPc);
        } else if (request.target.kind === "blackhole") {
          const blackHole = runtime.universe.blackHole(request.target.id);
          if (blackHole) {
            const targetPc = runtime.universe.starPositionPc(
              blackHole.systemStarId,
            );
            navigationDirection.copy(targetPc).sub(state.cameraPc);
          } else {
            navigationDirection.set(0, 0, 0);
          }
        } else if (request.target.kind === "galaxy") {
          runtime.universe.galaxyRelative(
            request.target.index,
            state.controller.position,
            navigationDirection,
          );
        } else {
          const landmark = runtime.universe.landmarks[request.target.index];
          if (landmark.systemId) {
            const targetPc = runtime.universe.starPositionPc(
              landmark.systemId,
            );
            navigationDirection.copy(targetPc).sub(state.cameraPc);
          } else {
            runtime.universe.landmarkRelative(
              request.target.index,
              state.controller.position,
              navigationDirection,
            );
          }
        }

        if (navigationDirection.lengthSq() > 1e-12) {
          state.controller.centerOnDirection(navigationDirection);
          document.documentElement.dataset.universeLocated = targetKey;
          document.documentElement.dataset.universeLocateRequest = String(
            request.requestId,
          );
          pendingNavigationRef.current = request;
          console.info(
            "[YEIS-NATIVE-LOCATE] " +
              request.title +
              " -> " +
              targetKey,
          );
        } else {
          const reason = "locate target has no usable direction";
          document.documentElement.dataset.universeNavigationError =
            targetKey;
          navigationFailureRef.current(request, reason);
          console.error(
            "[YEIS-NATIVE-LOCATE] failed " +
              targetKey +
              " · " +
              reason,
          );
        }
      } else if (request.target.kind === "star") {
        const targetStarId = request.target.nativeId;
        try {
          if (runtime.universe.current.starId !== targetStarId) {
            const frameDelta = runtime.universe.switchTo(
              targetStarId,
              2451545.0,
              performance.now() / 1000,
            );
            state.controller.shiftFrame(
              frameDelta,
              runtime.universe.star,
            );
          }
          retargetNativeSystemRenderers(state);

          const star = runtime.universe.star;
          const arrivalDistance = nativeSystemOverviewDistance(
            runtime.universe.current,
            perspective.getEffectiveFOV(),
            perspective.aspect,
          );
          navigationDirection
            .copy(state.controller.position)
            .sub(star.position);
          if (navigationDirection.lengthSq() <= 1e-18) {
            navigationDirection
              .set(0, 0, 1)
              .applyQuaternion(state.controller.quaternion);
          }
          navigationDirection.normalize();

          state.controller.goToPoint(
            star.position,
            arrivalDistance,
            navigationDirection,
            {
              radius: state.nativeSystemSpanKm,
              name: star.name,
            },
          );
          pendingNavigationRef.current = request;
          document.documentElement.dataset.universeTraveling = targetKey;
          document.documentElement.dataset.yeisNativeSystemOverview =
            "approaching:" + targetStarId;
          document.documentElement.dataset.universeTravelArrivalRatio =
            (
              state.controller.position.distanceTo(star.position) /
              Math.max(state.nativeSystemSpanKm, 1)
            ).toFixed(4);
          console.info(
            "[YEIS-NATIVE-TRAVEL] start " +
              targetKey +
              " system=" +
              targetStarId +
              " arriveKm=" +
              arrivalDistance.toExponential(6),
          );
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : String(error);
          document.documentElement.dataset.universeNavigationError =
            targetKey;
          navigationFailureRef.current(request, reason);
          console.error(
            "[YEIS-NATIVE-TRAVEL] failed " +
              targetKey +
              " · " +
              reason,
          );
        }
      } else if (request.target.kind === "body") {
        const starId = request.target.starId;
        if (runtime.universe.current.starId !== starId) {
          const frameDelta = runtime.universe.switchTo(
            starId,
            2451545.0,
            performance.now() / 1000,
          );
          state.controller.shiftFrame(frameDelta, runtime.universe.star);
          retargetNativeSystemRenderers(state);
        }

        const body = runtime.universe.get(request.target.bodyId);
        if (body) {
          state.controller.goTo(body, runtime.universe.star.position);
          pendingNavigationRef.current = request;
          document.documentElement.dataset.universeTraveling = targetKey;
          console.info(
            "[YEIS-NATIVE-BODY] " +
              request.title +
              " -> " +
              targetKey,
          );
        } else {
          const reason = "native body unavailable";
          document.documentElement.dataset.universeNavigationError =
            targetKey;
          navigationFailureRef.current(request, reason);
          console.error(
            "[YEIS-NATIVE-BODY] unavailable " + targetKey,
          );
        }
      } else if (request.target.kind === "blackhole") {
        const blackHole = runtime.universe.blackHole(request.target.id);
        if (blackHole) {
          if (
            runtime.universe.current.starId !== blackHole.systemStarId
          ) {
            const frameDelta = runtime.universe.switchTo(
              blackHole.systemStarId,
              2451545.0,
              performance.now() / 1000,
            );
            state.controller.shiftFrame(frameDelta, runtime.universe.star);
            retargetNativeSystemRenderers(state);
          }
          const body = runtime.universe.get(blackHole.entry.bodyId);
          if (body) {
            state.controller.goTo(body, runtime.universe.star.position);
            pendingNavigationRef.current = request;
            document.documentElement.dataset.universeTraveling = targetKey;
            console.info(
              "[YEIS-NATIVE-BLACKHOLE] " +
                request.title +
                " -> " +
                targetKey,
            );
          } else {
            const reason = "black-hole body unavailable";
            document.documentElement.dataset.universeNavigationError =
              targetKey;
            navigationFailureRef.current(request, reason);
            console.error(
              "[YEIS-NATIVE-BLACKHOLE] missing body " + targetKey,
            );
          }
        } else {
          const reason = "unknown black-hole target";
          document.documentElement.dataset.universeNavigationError =
            targetKey;
          navigationFailureRef.current(request, reason);
          console.error(
            "[YEIS-NATIVE-BLACKHOLE] unknown " + targetKey,
          );
        }
      } else if (request.target.kind === "galaxy") {
        const index = request.target.index;
        const galaxies = runtime.universe.galaxies;
        runtime.universe.galaxyRelative(
          index,
          navigationOrigin,
          navigationPoint,
        );
        const radiusKm = galaxies.radius[index] * PARSEC_KM;
        navigationDirection
          .copy(state.controller.position)
          .sub(navigationPoint)
          .normalize();
        navigationNormal.set(
          galaxies.normal[index * 3],
          galaxies.normal[index * 3 + 1],
          galaxies.normal[index * 3 + 2],
        );
        if (navigationDirection.dot(navigationNormal) < 0) {
          navigationNormal.negate();
        }
        navigationDirection.lerp(navigationNormal, 0.55).normalize();
        state.controller.goToPoint(
          navigationPoint,
          radiusKm * 2.6,
          navigationDirection,
          {
            radius: radiusKm * 0.02,
            name: galaxies.name(index),
          },
        );
        pendingNavigationRef.current = request;
        document.documentElement.dataset.universeTraveling = targetKey;
        console.info(
          "[YEIS-NATIVE-TRAVEL] " +
            request.title +
            " -> " +
            targetKey,
        );
      } else if (request.target.kind === "landmark") {
        const index = request.target.index;
        const landmark = runtime.universe.landmarks[index];
        runtime.universe.landmarkRelative(
          index,
          navigationOrigin,
          navigationPoint,
        );
        const radiusKm = landmark.def.radiusPc * PARSEC_KM;
        navigationDirection
          .copy(state.controller.position)
          .sub(navigationPoint)
          .normalize();
        state.controller.goToPoint(
          navigationPoint,
          radiusKm * (landmark.def.kind === "remnant" ? 5 : 3.2),
          navigationDirection,
          {
            radius: radiusKm * 0.3,
            name: landmark.def.name,
          },
        );
        pendingNavigationRef.current = request;
        document.documentElement.dataset.universeTraveling = targetKey;
        console.info(
          "[YEIS-NATIVE-TRAVEL] " +
            request.title +
            " -> " +
            targetKey,
        );
      }
    }

    const pendingNavigation = pendingNavigationRef.current;
    if (
      pendingNavigation?.mode === "travel" &&
      pendingNavigation.target.kind === "star" &&
      state.controller.autopilot
    ) {
      const star = runtime.universe.star;
      document.documentElement.dataset.universeTravelArrivalRatio =
        (
          state.controller.position.distanceTo(star.position) /
          Math.max(state.nativeSystemSpanKm, 1)
        ).toFixed(4);
    }

    const startQuaternion = navigationStartQuaternionRef.current;
    const startPosition = navigationStartPositionRef.current;
    const startPc = navigationStartPcRef.current;
    if (
      pendingNavigation &&
      pendingNavigation.requestId === lastNavigationRequestRef.current &&
      !state.controller.autopilot
    ) {
      const targetKey = cameraTargetKey(pendingNavigation.target);

      if (pendingNavigation.mode === "locate" && startQuaternion) {
        const current = state.controller.quaternion.toArray();
        const dot = Math.min(
          1,
          Math.abs(
            startQuaternion[0] * current[0] +
              startQuaternion[1] * current[1] +
              startQuaternion[2] * current[2] +
              startQuaternion[3] * current[3],
          ),
        );
        const deltaRad = 2 * Math.acos(dot);
        document.documentElement.dataset.universeLocateComplete = targetKey;
        document.documentElement.dataset.universeLocateDeltaRad =
          deltaRad.toFixed(6);
        locatedDestinationIdRef.current = pendingNavigation.destinationId;
        void resolveUniverseNavigationDestination(
          pendingNavigation.destinationId,
          contentPlacementsRef.current,
          markersRef.current,
        ).then((destination) => {
          if (state.disposed || !destination) return;
          locatedScaleFocusRef.current = destination;
          scaleFocusIdRef.current = destination.id;
          scaleFocusRef.current?.(destination);
        });
        console.info(
          "[YEIS-NATIVE-LOCATE] complete " +
            targetKey +
            " deltaRad=" +
            deltaRad.toFixed(6),
        );
      } else if (
        pendingNavigation.mode === "travel" &&
        startPosition
      ) {
        const currentPc = runtime.universe.toParsecs(
          state.controller.position,
          new Vector3(),
        );
        const deltaPc = startPc
          ? currentPc.distanceTo(new Vector3().fromArray(startPc))
          : state.controller.position
              .distanceTo(new Vector3().fromArray(startPosition)) /
            PARSEC_KM;
        document.documentElement.dataset.universeTravelComplete = targetKey;
        document.documentElement.dataset.universeTravelDeltaPc =
          deltaPc.toExponential(6);
        if (pendingNavigation.target.kind === "galaxy") {
          document.documentElement.dataset.universeTravelArrivalRatio =
            state.galaxySprites
              .apparent(pendingNavigation.target.index)
              .ratio.toFixed(4);
        } else if (pendingNavigation.target.kind === "landmark") {
          const landmark =
            runtime.universe.landmarks[pendingNavigation.target.index];
          const distancePc = state.landmarkSprites.distancePc(
            pendingNavigation.target.index,
          );
          document.documentElement.dataset.universeTravelArrivalRatio =
            (distancePc / Math.max(landmark.def.radiusPc, 1e-9)).toFixed(4);
        } else if (pendingNavigation.target.kind === "star") {
          const star = runtime.universe.star;
          const distance = state.controller.position.distanceTo(star.position);
          document.documentElement.dataset.universeTravelArrivalRatio =
            (distance / Math.max(state.nativeSystemSpanKm, 1)).toFixed(4);
          state.systemOverview = true;
          viewStateRef.current = {
            starId: runtime.universe.current.starId,
            positionKm: state.controller.position.toArray() as [
              number,
              number,
              number,
            ],
            quaternion: state.controller.quaternion.toArray() as [
              number,
              number,
              number,
              number,
            ],
            systemOverview: true,
          };
          document.documentElement.dataset.yeisNativeSystemOverview =
            runtime.universe.current.starId;
        }
        delete document.documentElement.dataset.universeTraveling;
        console.info(
          "[YEIS-NATIVE-TRAVEL] complete " +
            targetKey +
            " deltaPc=" +
            deltaPc.toExponential(6),
        );
      }

      navigationCompleteRef.current(pendingNavigation);
      pendingNavigationRef.current = null;
      navigationStartQuaternionRef.current = null;
      navigationStartPositionRef.current = null;
      navigationStartPcRef.current = null;
    }

    state.galaxyAcc += delta;
    if (state.galaxyAcc >= 0.12) {
      state.galaxyAcc = 0;
      const galaxies = runtime.universe.galaxies;
      state.currentGalaxy = galaxies.containing(state.cameraPc, 3);
      runtime.universe.currentGalaxy = state.currentGalaxy;

      const wanted = new Set<number>();
      let nearestRatio = Infinity;
      for (let index = 0; index < galaxies.count; index += 1) {
        const dx =
          galaxies.positions[index * 3] - state.cameraPc.x;
        const dy =
          galaxies.positions[index * 3 + 1] - state.cameraPc.y;
        const dz =
          galaxies.positions[index * 3 + 2] - state.cameraPc.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const ratio = distance / galaxies.radius[index];
        if (ratio < nearestRatio) nearestRatio = ratio;
        if (ratio < 18) wanted.add(index);
      }

      for (const [index, cloud] of state.galaxyClouds) {
        if (wanted.has(index)) continue;
        cloud.dispose(scene);
        state.galaxyClouds.delete(index);
      }

      for (const index of wanted) {
        if (
          state.galaxyClouds.has(index) ||
          state.galaxyClouds.size >= 3
        ) {
          continue;
        }
        const radius = galaxies.radius[index];
        const count =
          index === 0
            ? quality === "low"
              ? 90_000
              : 180_000
            : Math.round(
                Math.min(
                  quality === "low" ? 80_000 : 160_000,
                  (quality === "low" ? 20_000 : 40_000) +
                    radius * (quality === "low" ? 3 : 6),
                ),
              );
        const cloud = new GalaxyCloud(
          index,
          galaxies.model(index),
          scene,
          count,
          state.maxPointPx,
        );
        state.galaxyClouds.set(index, cloud);
      }

      runtime.universe.procStars.update(
        state.cameraPc,
        state.currentGalaxy,
      );

      const targetBoost = Math.min(
        1,
        Math.max(0, (nearestRatio - 4) / 8),
      );
      state.galaxyBoost +=
        (targetBoost - state.galaxyBoost) * 0.35;

      document.documentElement.dataset.yeisGalaxyClouds =
        String(state.galaxyClouds.size);
      document.documentElement.dataset.yeisCurrentGalaxy =
        state.currentGalaxy === null
          ? "intergalactic"
          : String(state.currentGalaxy);
    }

    const pixelRatio = gl.getPixelRatio();
    const pxPerRad =
      size.height / 2 / Math.tan(fovRad / 2);

    const nativeStar = runtime.universe.star;
    state.nativeBodies.update(
      state.controller.position,
      state.controller.quaternion,
      perspective,
      size.height,
      fovRad,
      nativeStar.position,
      nativeStar.radius,
      state.nativeSunColor,
      performance.now() / 1000,
      {
        ...NATIVE_GALAXY_SYSTEM_SETTINGS,
        atmospheres: quality !== "low",
        clouds: quality !== "low",
        shadows: quality !== "low",
      },
    );
    state.nativeBodyPoints.setPixelRatio(pixelRatio);
    state.nativeBodyPoints.update(
      nativeStar.position,
      state.controller.position,
      state.nativeLuminosity,
    );
    state.nativeOrbits.update(
      state.controller.position,
      true,
      quality !== "low",
      pxPerRad,
      (id) => state.nativeBodies.byId.get(id)?.apparentRadiusPx ?? 0,
      null,
    );

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
    for (const cloud of state.galaxyClouds.values()) {
      cloud.update(
        state.cameraPc,
        pxPerRad,
        pixelRatio,
        true,
      );
    }
    state.galaxySprites.update(
      state.cameraPc,
      pxPerRad,
      pixelRatio,
      state.galaxyBoost,
      state.currentGalaxy ?? -1,
    );
    state.landmarkSprites.update(
      state.cameraPc,
      pxPerRad,
      runtime.universe.current.starId,
      (index) => state.galaxySprites.apparent(index).ratio,
    );

    const photoStatus = state.landmarkSprites.photoLoadStatus;
    document.documentElement.dataset.yeisLandmarkPhotosRequested =
      String(photoStatus.requested);
    document.documentElement.dataset.yeisLandmarkPhotosLoaded =
      String(photoStatus.loaded);
    document.documentElement.dataset.yeisLandmarkPhotosFailed =
      String(photoStatus.failed);
    document.documentElement.dataset.yeisLandmarkPhotosComplete =
      photoStatus.complete ? "1" : "0";

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

    const contentMaterial = state.contentSky.material as PointsMaterial;
    const signalPulse = 1 + Math.sin(performance.now() * 0.0032) * 0.12;
    contentMaterial.size = (quality === "low" ? 8 : 11) * signalPulse;
    contentMaterial.opacity =
      0.9 + Math.sin(performance.now() * 0.0026) * 0.08;

    let contentPosition = state.contentSky.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    const requiredSignalCapacity = contentPlacementsRef.current.length;
    if (requiredSignalCapacity > contentPosition.count) {
      const nextCapacity = Math.max(
        32,
        2 ** Math.ceil(Math.log2(requiredSignalCapacity + 1)),
      );
      contentPosition = new BufferAttribute(
        new Float32Array(nextCapacity * 3),
        3,
      );
      state.contentSky.geometry.setAttribute("position", contentPosition);
      document.documentElement.dataset.personalSignalCapacity =
        String(nextCapacity);
      console.info(
        `[PERSONAL-SIGNALS] capacity=${nextCapacity}`,
      );
    }

    const markerById = new Map(
      markersRef.current.map((marker) => [marker.id, marker]),
    );
    let contentCount = 0;
    for (const placement of contentPlacementsRef.current) {
      if (contentCount >= contentPosition.count) break;
      const marker = markerById.get(placement.markerId);
      const nativeId = marker?.nativeId ?? placement.nativeId;
      if (!nativeId) continue;

      const starPc = runtime.universe.starPositionPc(nativeId);
      contentDirection.copy(starPc).sub(state.cameraPc);
      if (contentDirection.lengthSq() <= 1e-12) continue;
      contentDirection
        .normalize()
        .multiplyScalar(SKY_RADIUS_KM * 0.992);
      contentPosition.setXYZ(
        contentCount,
        contentDirection.x,
        contentDirection.y,
        contentDirection.z,
      );
      contentCount += 1;
    }
    contentPosition.needsUpdate = true;
    state.contentSky.geometry.setDrawRange(0, contentCount);
    if (state.contentCount !== contentCount) {
      state.contentCount = contentCount;
      document.documentElement.dataset.personalSignalOverlay =
        String(contentCount);
      console.info(
        `[PERSONAL-SIGNALS] overlay=${contentCount}`,
      );
    }
  });

  return <color attach="background" args={["#000005"]} />;
}


function cameraTargetKey(
  target: UniverseNavigationCameraRequest["target"],
): string {
  if (target.kind === "star") return target.nativeId;
  if (target.kind === "point") return "point:" + target.id;
  if (target.kind === "body") {
    return target.starId + "/" + target.bodyId;
  }
  if (target.kind === "blackhole") return "blackhole:" + target.id;
  return target.kind + ":" + target.index;
}

