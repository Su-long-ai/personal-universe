import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, type CameraControls as CameraControlsApi } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import {
  PLANET_ANCHOR,
  PLANET_RENDER_RADIUS,
  SYSTEM_OVERVIEW_RADIUS,
  type QualityMode,
  type UniversePhase,
} from "../../lib/universe/types";
import {
  WORLD_SCALE_EPSILON,
  WORLD_SCALE_MAX,
  continuousScaleResponse,
  isWorldScalePhase,
  scalePhaseIndex,
} from "../../lib/universe/continuousScale";
import {
  SYSTEM_OVERVIEW_FRAME_SCALE,
} from "../../lib/universe/yeis/systemScale";
import {
  isSoftwareRenderer,
  liveWorldFallbackReason,
} from "./CinematicPipeline";
import type { SystemScaleFrame } from "./SystemScene";
import type { YeisGalaxyViewState } from "./YeisGalaxyScene";

export type SurfaceCameraFrame = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
};

type SurfaceManualCameraView = {
  identity: string;
  renderer: "live" | "fallback";
  position: [number, number, number];
  target: [number, number, number];
};

type CinematicCameraProps = {
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  worldScalePosition: number;
  worldScaleRenderRevision: number;
  worldScaleContinuous: boolean;
  scrollDepth: number;
  reducedMotion: boolean;
  quality: QualityMode;
  surfaceIdentity: string | null;
  surfaceCameraFrame: SurfaceCameraFrame | null;
  systemScaleFrame: SystemScaleFrame | null;
  galaxyViewState: YeisGalaxyViewState | null;
  worldFrameReady: boolean;
  surfaceFallbackReady: boolean;
  onPhaseComplete: (phase: UniversePhase) => void;
  onUserControlStart: () => void;
};

const WORLD = PLANET_ANCHOR;

const DISABLED_MOUSE = {
  left: CameraControlsImpl.ACTION.NONE,
  middle: CameraControlsImpl.ACTION.NONE,
  right: CameraControlsImpl.ACTION.NONE,
  wheel: CameraControlsImpl.ACTION.NONE,
} as const;

const MANUAL_MOUSE = {
  left: CameraControlsImpl.ACTION.ROTATE,
  middle: CameraControlsImpl.ACTION.DOLLY,
  right: CameraControlsImpl.ACTION.NONE,
  wheel: CameraControlsImpl.ACTION.NONE,
} as const;

const DISABLED_TOUCH = {
  one: CameraControlsImpl.ACTION.NONE,
  two: CameraControlsImpl.ACTION.NONE,
  three: CameraControlsImpl.ACTION.NONE,
} as const;

const MANUAL_TOUCH = {
  one: CameraControlsImpl.ACTION.TOUCH_ROTATE,
  two: CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE,
  three: CameraControlsImpl.ACTION.NONE,
} as const;

const MANUAL_DRAG_THRESHOLD_PX = 5;
const MANUAL_DRAG_THRESHOLD_SQ =
  MANUAL_DRAG_THRESHOLD_PX * MANUAL_DRAG_THRESHOLD_PX;

type CameraShot = {
  position: [number, number, number];
  target: [number, number, number];
  smoothTime: number;
  maxSpeed: number;
  positionTolerance: number;
  targetTolerance: number;
  fitRadius?: number;
  frameScale?: number;
  transition?: boolean;
};

export const FALLBACK_SURFACE_CAMERA_FRAME = {
  position: [0.5, 22.0, 18.0] as [number, number, number],
  target: [0, 8.0, -16.0] as [number, number, number],
} as const;

const FALLBACK_SURFACE_SHOT: CameraShot = {
  ...FALLBACK_SURFACE_CAMERA_FRAME,
  smoothTime: 0.38,
  maxSpeed: 24,
  positionTolerance: 0.14,
  targetTolerance: 0.1,
  transition: false,
};

const SHOTS: Partial<Record<UniversePhase, CameraShot>> = {
  system: {
    position: [0, 8.6, 18.5],
    target: [0, 0, 0],
    smoothTime: 0.52,
    maxSpeed: 28,
    positionTolerance: 0.16,
    targetTolerance: 0.1,
    fitRadius: SYSTEM_OVERVIEW_RADIUS,
    frameScale: SYSTEM_OVERVIEW_FRAME_SCALE,
  },
  approach: {
    // Keep Approach on the same -Z hemisphere as Orbit, Atmosphere, and
    // Surface. The old +Z endpoint made the continuous 2 → 3 midpoint cross
    // the night side even though the planet remained geometrically large.
    position: [1.35, 1.15, -13.6],
    target: [WORLD[0] - 0.15, WORLD[1] + 0.15, WORLD[2]],
    smoothTime: 1.28,
    maxSpeed: 28,
    positionTolerance: 0.16,
    targetTolerance: 0.1,
    frameScale: 1.5,
  },
  orbit: {
    // Stay on the same illuminated hemisphere as the canonical Surface
    // anchor. The previous +Z shot looked across the night side and then
    // forced Atmosphere/Surface to reverse around the globe before landing.
    position: [10.45, 1.38, -5.2],
    target: [WORLD[0] - 0.22, WORLD[1] + 0.06, WORLD[2] - 0.15],
    smoothTime: 0.92,
    maxSpeed: 18,
    positionTolerance: 0.12,
    targetTolerance: 0.08,
    frameScale: 1.28,
  },
  atmosphere: {
    // Continue descending toward the lit landing patch rather than crossing
    // back over the terminator. Surface still replaces this with its terrain-
    // derived frame once the live anchor is ready.
    position: [7.7, 1.78, -4.35],
    target: [6.25, 1.2, -3.0],
    smoothTime: 0.68,
    maxSpeed: 12,
    positionTolerance: 0.08,
    targetTolerance: 0.06,
  },
  surface: {
    // Tangent-to-surface landing view at the canonical live terrain anchor.
    // The camera sits just above the same globe used in Orbit/Atmosphere and
    // looks along the spherical terrain instead of back through the planet.
    position: [6.463, 1.654, -3.884],
    target: [5.316, 1.456, -3.228],
    smoothTime: 0.58,
    maxSpeed: 6,
    positionTolerance: 0.035,
    targetTolerance: 0.03,
  },
  returning: {
    position: [0, 24, 41],
    target: [0, 0, 0],
    smoothTime: 1.05,
    maxSpeed: 34,
    positionTolerance: 0.2,
    targetTolerance: 0.14,
  },
};

export function CinematicCamera({
  phase,
  phaseRef,
  worldScalePosition,
  worldScaleRenderRevision,
  worldScaleContinuous,
  scrollDepth,
  reducedMotion,
  quality,
  surfaceIdentity,
  surfaceCameraFrame,
  systemScaleFrame,
  galaxyViewState,
  worldFrameReady,
  surfaceFallbackReady,
  onPhaseComplete,
  onUserControlStart,
}: CinematicCameraProps) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const viewportWidth = useThree((state) => state.size.width);
  const viewportHeight = useThree((state) => state.size.height);
  const softwareRenderer = isSoftwareRenderer(gl);
  const surfaceFallbackAvailable = Boolean(
    liveWorldFallbackReason(gl, quality),
  );
  const surfaceFallbackRequested =
    phase === "surface" && surfaceFallbackAvailable;
  const surfaceFallback =
    surfaceFallbackRequested && surfaceFallbackReady;
  const currentWorldFrameReady =
    surfaceFallbackRequested ? surfaceFallbackReady : worldFrameReady;
  const surfaceRendererMode: SurfaceManualCameraView["renderer"] =
    surfaceFallbackAvailable ? "fallback" : "live";
  const continuousSystemCamera =
    phase === "system" &&
    worldScaleContinuous &&
    worldScalePosition > 1 + WORLD_SCALE_EPSILON;
  const activeSurfaceCameraFrame =
    phase === "surface" || worldScalePosition > 4
      ? surfaceCameraFrame
      : null;
  const liveSurfaceShot =
    activeSurfaceCameraFrame && SHOTS.surface
      ? {
          ...SHOTS.surface,
          position: activeSurfaceCameraFrame.position,
          target: activeSurfaceCameraFrame.target,
        }
      : SHOTS.surface;
  const controlsRef = useRef<CameraControlsApi>(null);
  const [controlsReady, setControlsReady] = useState(false);
  const completedPhase = useRef<UniversePhase | null>(null);
  const configuredPhase = useRef<UniversePhase | null>(null);
  const transitionGeneration = useRef(0);
  const transitionWatchdog = useRef<number | null>(null);
  const manualOverride = useRef(false);
  const surfaceManualView = useRef<SurfaceManualCameraView | null>(null);
  const currentPosition = useRef(new Vector3());
  const currentTarget = useRef(new Vector3());
  const desiredPosition = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());
  const scratchWorldUp = useRef(new Vector3(0, 1, 0));
  const scratchSurfaceUp = useRef(new Vector3());
  const scratchSystemTarget = useRef(new Vector3());
  const scratchSystemPosition = useRef(new Vector3());
  const scratchForward = useRef(new Vector3());
  const scratchApproachTarget = useRef(new Vector3());
  const scratchApproachPosition = useRef(new Vector3());
  const scratchApproachDirection = useRef(new Vector3());
  const scratchEndpointOffset = useRef(new Vector3());
  const scratchEndpointTarget = useRef(new Vector3());
  const scratchSystemDirection = useRef(new Vector3());
  const scratchFrameCenter = useRef(new Vector3());
  const scratchFromPosition = useRef(new Vector3());
  const scratchFromTarget = useRef(new Vector3());
  const scratchToPosition = useRef(new Vector3());
  const scratchToTarget = useRef(new Vector3());
  const scratchNativeQuaternion = useRef(new Quaternion());
  const desiredPositionTolerance = useRef(0);
  const desiredTargetTolerance = useRef(0);
  const worldFrameReadyRef = useRef(currentWorldFrameReady);
  worldFrameReadyRef.current = currentWorldFrameReady;

  const handleControlsRef = useCallback(
    (controls: CameraControlsApi | null) => {
      controlsRef.current = controls;
      setControlsReady(Boolean(controls));
    },
    [],
  );

  const manualCameraEnabled =
    phase === "system" || phase === "orbit" || phase === "surface";
  const liveSurfaceScaleCamera =
    !surfaceFallbackAvailable &&
    worldScaleContinuous &&
    worldScalePosition > 4 + WORLD_SCALE_EPSILON;
  const manualMinDistance =
    phase === "orbit"
      ? PLANET_RENDER_RADIUS * 1.28
      : phase === "system"
        ? continuousSystemCamera
          ? 1e-8
          : 5
        : phase === "surface"
          ? surfaceFallbackAvailable
            ? 8
            : 0.015
          : liveSurfaceScaleCamera
            ? 0.015
            : 0.3;
  const manualMaxDistance =
    phase === "orbit"
      ? PLANET_RENDER_RADIUS * 7
      : phase === "system"
        ? 55
        : phase === "surface"
          ? surfaceFallbackAvailable
            ? 65
            : 1.4
          : 65;

  const publishSettled = useCallback(
    (expectedGeneration = transitionGeneration.current) => {
      if (
        expectedGeneration !== transitionGeneration.current ||
        manualOverride.current ||
        phaseRef.current !== phase ||
        configuredPhase.current !== phase ||
        completedPhase.current === phase
      ) {
        return;
      }

      const html = document.documentElement;
      if (
        isWorldScalePhase(phase) &&
        !worldFrameReadyRef.current
      ) {
        html.dataset.universeCameraAwaitingWorldFrame = phase;
        return;
      }
      delete html.dataset.universeCameraAwaitingWorldFrame;

      completedPhase.current = phase;
      if (transitionWatchdog.current !== null) {
        window.clearTimeout(transitionWatchdog.current);
        transitionWatchdog.current = null;
      }
      document.documentElement.dataset.universeCameraSettled = phase;
      document.documentElement.dataset.universeCameraMode = "settled";
      document.documentElement.dataset.universeCameraGeneration =
        String(expectedGeneration);
      onPhaseComplete(phase);
    },
    [onPhaseComplete, phase, phaseRef],
  );

  const publishIfReached = useCallback(
    (expectedGeneration = transitionGeneration.current) => {
      if (
        expectedGeneration !== transitionGeneration.current ||
        manualOverride.current ||
        phaseRef.current !== phase ||
        configuredPhase.current !== phase
      ) {
        return;
      }

      const continuousWorldCamera =
        worldScaleContinuous &&
        isWorldScalePhase(phase) &&
        (
          !surfaceFallbackAvailable ||
          worldScalePosition < WORLD_SCALE_MAX - WORLD_SCALE_EPSILON
        );
      const continuousScaleCamera =
        continuousSystemCamera || continuousWorldCamera;
      if (
        continuousScaleCamera &&
        (continuousSystemCamera ||
          Math.abs(worldScalePosition - scalePhaseIndex(phase)) >
            WORLD_SCALE_EPSILON)
      ) {
        return;
      }

      const controls = controlsRef.current;
      if (!controls) return;

      controls.getPosition(currentPosition.current, false);
      controls.getTarget(currentTarget.current, false);
      const positionReached =
        currentPosition.current.distanceTo(desiredPosition.current) <=
        desiredPositionTolerance.current;
      const targetReached =
        currentTarget.current.distanceTo(desiredTarget.current) <=
        desiredTargetTolerance.current;

      if (positionReached && targetReached) {
        publishSettled(expectedGeneration);
      }
    },
    [
      phase,
      phaseRef,
      publishSettled,
      continuousSystemCamera,
      surfaceFallbackAvailable,
      worldScaleContinuous,
      worldScalePosition,
    ],
  );

  useEffect(() => {
    if (!currentWorldFrameReady) return;

    // Renderer readiness can become true before a throttled camera transition
    // reaches publishSettled() and writes the diagnostic awaiting marker.
    // Treat readiness itself as the retry edge; publishIfReached() already
    // guards generation, phase ownership, manual takeover, scale boundaries,
    // and camera position/target tolerances.
    publishIfReached();
  }, [currentWorldFrameReady, publishIfReached]);

  const framedWorldDistance = useCallback(
    (
      controls: CameraControlsApi,
      radius: number,
      frameScale: number,
    ) => {
      const fitDistance = controls.getDistanceToFitSphere(radius);
      if (
        !(camera instanceof PerspectiveCamera) ||
        viewportWidth <= 0 ||
        viewportHeight <= 0
      ) {
        return fitDistance * frameScale;
      }

      // camera-controls correctly treats the narrow screen dimension as the
      // hard no-clipping constraint. A constant multiplier on that distance,
      // however, makes portrait worlds look much smaller than ultrawide worlds.
      // Keep its fit distance as the safety floor, then choose a farther
      // vertical-composition distance with an aspect-aware horizontal cap.
      const aspect = viewportWidth / viewportHeight;
      // Compose by height on wide viewports. Expanding the subject with the
      // extra horizontal space makes the same wheel position a different zoom.
      const preferredVerticalRadius = Math.min(0.28, 0.39 / frameScale);
      const horizontalSafeVerticalRadius = Math.max(
        0.16,
        aspect * 0.44,
      );
      const targetVerticalRadius = Math.max(
        0.16,
        Math.min(
          preferredVerticalRadius,
          horizontalSafeVerticalRadius,
        ),
      );
      const verticalFov = (camera.fov * Math.PI) / 180;
      const verticalDistance =
        Math.max(radius, 1e-8) /
        Math.max(
          2 *
            targetVerticalRadius *
            Math.tan(verticalFov / 2),
          1e-8,
        );

      // Preserve a small safety margin over camera-controls' exact fit even
      // when an unusually narrow viewport makes the horizontal constraint win.
      return Math.max(fitDistance * 1.04, verticalDistance);
    },
    [camera, viewportHeight, viewportWidth],
  );

  const publishScaleFrameDiagnostics = useCallback(
    (center: Vector3, radius: number) => {
      const distance = Math.max(1e-8, camera.position.distanceTo(center));
      document.documentElement.dataset.universeCameraDistance =
        distance.toExponential(4);

      if (camera instanceof PerspectiveCamera && viewportHeight > 0) {
        const verticalFov =
          (camera.fov * Math.PI) / 180;
        const projectedRadius =
          (Math.max(radius, 1e-8) /
            Math.max(distance * Math.tan(verticalFov / 2), 1e-8)) *
          (viewportHeight / 2);
        document.documentElement.dataset.universeProjectedRadius =
          projectedRadius.toFixed(2);
      } else {
        delete document.documentElement.dataset.universeProjectedRadius;
      }

      const quaternion = camera.quaternion;
      document.documentElement.dataset.universeCameraQuaternion = [
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      ]
        .map((value) => value.toFixed(6))
        .join(",");
    },
    [camera, viewportHeight],
  );

  useEffect(() => {
    const remembered = surfaceManualView.current;
    if (
      !remembered ||
      (remembered.identity === surfaceIdentity &&
        remembered.renderer === surfaceRendererMode)
    ) {
      return;
    }
    surfaceManualView.current = null;
    delete document.documentElement.dataset.universeSurfaceManualView;
  }, [surfaceIdentity, surfaceRendererMode]);

  useFrame(() => {
    if (
      phase !== "surface" ||
      !manualOverride.current ||
      !surfaceIdentity
    ) {
      return;
    }
    const controls = controlsRef.current;
    if (!controls) return;

    controls.getPosition(currentPosition.current, false);
    controls.getTarget(currentTarget.current, false);
    surfaceManualView.current = {
      identity: surfaceIdentity,
      renderer: surfaceRendererMode,
      position: currentPosition.current.toArray() as [number, number, number],
      target: currentTarget.current.toArray() as [number, number, number],
    };
    document.documentElement.dataset.universeSurfaceManualView = "captured";
  });

  const handleUserControlStart = useCallback(() => {
    if (!manualCameraEnabled) return;
    manualOverride.current = true;
    completedPhase.current = null;
    transitionGeneration.current += 1;
    if (transitionWatchdog.current !== null) {
      window.clearTimeout(transitionWatchdog.current);
      transitionWatchdog.current = null;
    }
    delete document.documentElement.dataset.universeCameraSettled;
    document.documentElement.dataset.universeCameraMode = "manual";
    onUserControlStart();
  }, [manualCameraEnabled, onUserControlStart]);

  useEffect(() => {
    if (!manualCameraEnabled) return;

    // Wheel belongs exclusively to the continuous-scale coordinator. A plain
    // canvas click may select a planet/Surface signal, so pointerdown alone is
    // not camera intent either. Keep camera-controls as the movement executor,
    // but only supersede product navigation after the pointer has crossed a
    // small drag threshold.
    const element = gl.domElement;
    const starts = new Map<number, { x: number; y: number }>();
    let takeoverStarted = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" &&
        event.button !== 0 &&
        event.button !== 1
      ) {
        return;
      }
      starts.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (takeoverStarted) return;
      const start = starts.get(event.pointerId);
      if (!start) return;
      if (event.pointerType === "mouse" && event.buttons === 0) {
        starts.delete(event.pointerId);
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx * dx + dy * dy < MANUAL_DRAG_THRESHOLD_SQ) return;

      takeoverStarted = true;
      handleUserControlStart();
    };

    const handlePointerEnd = (event: PointerEvent) => {
      starts.delete(event.pointerId);
      if (starts.size === 0) takeoverStarted = false;
    };

    element.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    return () => {
      starts.clear();
      element.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
    };
  }, [gl, handleUserControlStart, manualCameraEnabled]);

  useEffect(() => {
    completedPhase.current = null;
    configuredPhase.current = null;
    manualOverride.current = false;
    transitionGeneration.current += 1;
    const generation = transitionGeneration.current;
    if (transitionWatchdog.current !== null) {
      window.clearTimeout(transitionWatchdog.current);
      transitionWatchdog.current = null;
    }
    delete document.documentElement.dataset.universeCameraSettled;
    delete document.documentElement.dataset.universeCameraWatchdog;
    delete document.documentElement.dataset.universeCameraAwaitingWorldFrame;
    document.documentElement.dataset.universeCameraMode = "cinematic";
    document.documentElement.dataset.universeCameraGeneration =
      String(generation);
    const controls = controlsRef.current;
    if (!controls) {
      document.documentElement.dataset.universeCameraAwaitingControls = phase;
      return;
    }
    delete document.documentElement.dataset.universeCameraAwaitingControls;

    controls.stop();

    if (continuousSystemCamera && !systemScaleFrame) {
      document.documentElement.dataset.universeCameraMode =
        "scale-continuous";
      document.documentElement.dataset.universeScaleCameraSegment =
        "system:approach";
      document.documentElement.dataset.universeSystemScaleFrame =
        "awaiting";
      return;
    }
    if (systemScaleFrame) {
      document.documentElement.dataset.universeSystemScaleFrame = "ready";
      document.documentElement.dataset.universeSystemScaleRadius =
        systemScaleFrame.radius.toExponential(4);
    } else {
      delete document.documentElement.dataset.universeSystemScaleFrame;
      delete document.documentElement.dataset.universeSystemScaleRadius;
    }

    const nativeSystemEntryView =
      phase === "system" && galaxyViewState?.systemOverview === true;
    const nativeSystemEntryQuaternion = nativeSystemEntryView
      ? scratchNativeQuaternion.current.fromArray(galaxyViewState.quaternion)
      : null;
    if (nativeSystemEntryView) {
      document.documentElement.dataset.universeSystemEntryView =
        "yeis-native";
    } else {
      delete document.documentElement.dataset.universeSystemEntryView;
    }

    const continuousWorldCamera =
      worldScaleContinuous &&
      isWorldScalePhase(phase) &&
      (
        !surfaceFallbackAvailable ||
        worldScalePosition < WORLD_SCALE_MAX - WORLD_SCALE_EPSILON
      );
    const nearLiveSurface =
      !surfaceFallbackAvailable &&
      Boolean(activeSurfaceCameraFrame) &&
      (phase === "surface" ||
        (continuousWorldCamera && worldScalePosition > 4));
    const desiredNear =
      continuousSystemCamera && systemScaleFrame
        ? Math.max(
            1e-8,
            Math.min(0.05, Math.max(systemScaleFrame.radius, 1e-8) * 0.05),
          )
        : nearLiveSurface
          ? 0.001
          : 0.05;
    if (camera.near !== desiredNear) {
      camera.near = desiredNear;
      camera.updateProjectionMatrix();
    }

    if (
      phase === "surface" &&
      !surfaceFallback &&
      activeSurfaceCameraFrame
    ) {
      camera.up.set(...activeSurfaceCameraFrame.up).normalize();
    } else if (
      continuousSystemCamera &&
      nativeSystemEntryQuaternion
    ) {
      const linearUpT = Math.min(
        1,
        Math.max(0, worldScalePosition - 1),
      );
      const upT = continuousScaleResponse(linearUpT);
      camera.up
        .set(0, 1, 0)
        .applyQuaternion(nativeSystemEntryQuaternion)
        .lerp(scratchWorldUp.current.set(0, 1, 0), upT)
        .normalize();
    } else if (nativeSystemEntryQuaternion) {
      camera.up
        .set(0, 1, 0)
        .applyQuaternion(nativeSystemEntryQuaternion)
        .normalize();
    } else if (
      continuousWorldCamera &&
      activeSurfaceCameraFrame &&
      worldScalePosition > 4
    ) {
      const surfaceInfluence = continuousScaleResponse(
        Math.min(1, worldScalePosition - 4),
      );
      camera.up
        .set(0, 1, 0)
        .lerp(
          scratchSurfaceUp.current
            .set(...activeSurfaceCameraFrame.up)
            .normalize(),
          surfaceInfluence,
        )
        .normalize();
    } else {
      camera.up.set(0, 1, 0);
    }
    controls.updateCameraUp();

    if (phase === "galaxy") {
      controls.smoothTime = reducedMotion ? 0.05 : 0.58;
      controls.maxSpeed = 38;
      void controls.setLookAt(
        0,
        26.5,
        43 + scrollDepth * 1.8,
        0,
        0,
        0,
        !reducedMotion,
      );
      return;
    }

    if (continuousSystemCamera && systemScaleFrame) {
      const systemShot = SHOTS.system;
      const approachShot = SHOTS.approach;
      if (!systemShot || !approachShot) return;

      const systemTarget = scratchSystemTarget.current.set(
        ...systemShot.target,
      );
      const systemPosition = scratchSystemPosition.current.set(
        ...systemShot.position,
      );
      if (systemShot.frameScale) {
        const distance =
          controls.getDistanceToFitSphere(
            systemShot.fitRadius ?? SYSTEM_OVERVIEW_RADIUS,
          ) * systemShot.frameScale;
        if (nativeSystemEntryQuaternion) {
          const forward = scratchForward.current
            .set(0, 0, -1)
            .applyQuaternion(nativeSystemEntryQuaternion)
            .normalize();
          systemPosition
            .copy(systemTarget)
            .addScaledVector(forward, -distance);
        } else {
          systemPosition
            .sub(systemTarget)
            .normalize()
            .multiplyScalar(distance)
            .add(systemTarget);
        }
      }

      // Preserve the authored Approach composition at the renderer boundary:
      // the target offset is expressed as a fraction of planet radius, while
      // the viewing direction comes from the existing Approach shot. Reuse
      // scratch vectors here because this path runs for every continuous frame.
      const approachTarget = scratchApproachTarget.current.set(
        ...approachShot.target,
      );
      const approachPosition = scratchApproachPosition.current.set(
        ...approachShot.position,
      );
      const approachDirection = scratchApproachDirection.current
        .copy(approachPosition)
        .sub(approachTarget)
        .normalize();
      const endpointTargetOffset = scratchEndpointOffset.current
        .set(...approachShot.target)
        .sub(scratchFrameCenter.current.set(...WORLD))
        .multiplyScalar(
          Math.max(systemScaleFrame.radius, 1e-8) / PLANET_RENDER_RADIUS,
        );
      const endpointTarget = scratchEndpointTarget.current
        .set(...systemScaleFrame.position)
        .add(endpointTargetOffset);

      const systemDirection = scratchSystemDirection.current
        .copy(systemPosition)
        .sub(systemTarget)
        .normalize();
      const linearT = Math.min(
        1,
        Math.max(0, worldScalePosition - 1),
      );
      const t = continuousScaleResponse(linearT);
      const direction = systemDirection
        .lerp(approachDirection, t)
        .normalize();

      const startDistance = Math.max(
        1e-8,
        systemPosition.distanceTo(systemTarget),
      );
      const endpointDistance = Math.max(
        1e-8,
        framedWorldDistance(
          controls,
          Math.max(systemScaleFrame.radius, 1e-8),
          approachShot.frameScale ?? 1,
        ),
      );
      const distance = Math.exp(
        Math.log(startDistance) * (1 - t) +
          Math.log(endpointDistance) * t,
      );

      desiredTarget.current.lerpVectors(
        systemTarget,
        endpointTarget,
        t,
      );
      desiredPosition.current
        .copy(direction)
        .multiplyScalar(distance)
        .add(desiredTarget.current);
      desiredPositionTolerance.current = Math.min(
        systemShot.positionTolerance,
        approachShot.positionTolerance,
      );
      desiredTargetTolerance.current = Math.min(
        systemShot.targetTolerance,
        approachShot.targetTolerance,
      );
      configuredPhase.current = phase;

      controls.smoothTime = 0.05;
      controls.maxSpeed = 1000;
      controls.stop();
      void controls.setLookAt(
        desiredPosition.current.x,
        desiredPosition.current.y,
        desiredPosition.current.z,
        desiredTarget.current.x,
        desiredTarget.current.y,
        desiredTarget.current.z,
        false,
      );
      controls.update(0);

      document.documentElement.dataset.universeCameraMode =
        "scale-continuous";
      document.documentElement.dataset.universeScaleCameraSegment =
        "system:approach";
      document.documentElement.dataset.universeScaleSegment =
        "system:approach";
      document.documentElement.dataset.universeSystemScaleDistance =
        distance.toExponential(4);
      publishScaleFrameDiagnostics(
        scratchFrameCenter.current.set(...systemScaleFrame.position),
        systemScaleFrame.radius,
      );
      if (worldScalePosition >= 2 - WORLD_SCALE_EPSILON) {
        const html = document.documentElement;
        if (html.dataset.universeProjectedRadius) {
          html.dataset.universeHandoffExitProjectedRadius =
            html.dataset.universeProjectedRadius;
        }
        if (html.dataset.universeCameraQuaternion) {
          html.dataset.universeHandoffExitQuaternion =
            html.dataset.universeCameraQuaternion;
        }
      }
      return;
    }

    if (continuousWorldCamera) {
      const clampedPosition = Math.max(
        2,
        Math.min(5, worldScalePosition),
      );
      const lowerIndex = Math.min(5, Math.floor(clampedPosition));
      const upperIndex = Math.min(5, lowerIndex + 1);
      const phaseForIndex = (index: number): UniversePhase =>
        index >= 5
          ? "surface"
          : index >= 4
            ? "atmosphere"
            : index >= 3
              ? "orbit"
              : "approach";
      const lowerPhase = phaseForIndex(lowerIndex);
      const upperPhase = phaseForIndex(upperIndex);
      const rememberedSurfaceView =
        surfaceManualView.current?.identity === surfaceIdentity &&
        surfaceManualView.current?.renderer === surfaceRendererMode
          ? surfaceManualView.current
          : null;
      const defaultSurfaceShot =
        activeSurfaceCameraFrame && liveSurfaceShot
          ? liveSurfaceShot
          : SHOTS.surface;
      const rememberedSurfaceBaseShot =
        rememberedSurfaceView?.renderer === "fallback"
          ? FALLBACK_SURFACE_SHOT
          : defaultSurfaceShot;
      const surfaceShot =
        rememberedSurfaceView && rememberedSurfaceBaseShot
          ? {
              ...rememberedSurfaceBaseShot,
              position: rememberedSurfaceView.position,
              target: rememberedSurfaceView.target,
            }
          : defaultSurfaceShot;
      const lowerShot =
        lowerPhase === "surface" ? surfaceShot : SHOTS[lowerPhase];
      const upperShot =
        upperPhase === "surface" ? surfaceShot : SHOTS[upperPhase];
      if (!lowerShot || !upperShot) return;

      const fromTarget = scratchFromTarget.current.set(...lowerShot.target);
      const fromPosition = scratchFromPosition.current.set(
        ...lowerShot.position,
      );
      if (lowerShot.frameScale) {
        const distance = framedWorldDistance(
          controls,
          lowerShot.fitRadius ?? PLANET_RENDER_RADIUS,
          lowerShot.frameScale,
        );
        fromPosition
          .sub(fromTarget)
          .normalize()
          .multiplyScalar(distance)
          .add(fromTarget);
      }

      const toTarget = scratchToTarget.current.set(...upperShot.target);
      const toPosition = scratchToPosition.current.set(...upperShot.position);
      if (upperShot.frameScale) {
        const distance = framedWorldDistance(
          controls,
          upperShot.fitRadius ?? PLANET_RENDER_RADIUS,
          upperShot.frameScale,
        );
        toPosition
          .sub(toTarget)
          .normalize()
          .multiplyScalar(distance)
          .add(toTarget);
      }
      const linearT =
        lowerIndex === upperIndex
          ? 0
          : clampedPosition - lowerIndex;
      // Preserve non-zero motion through authored anchors so continuous input
      // reads as one descent rather than a sequence of eased cinematics.
      const t = continuousScaleResponse(linearT);

      desiredPosition.current.lerpVectors(fromPosition, toPosition, t);
      desiredTarget.current.lerpVectors(fromTarget, toTarget, t);
      desiredPositionTolerance.current = Math.min(
        lowerShot.positionTolerance,
        upperShot.positionTolerance,
      );
      desiredTargetTolerance.current = Math.min(
        lowerShot.targetTolerance,
        upperShot.targetTolerance,
      );
      configuredPhase.current = phase;

      controls.smoothTime = 0.05;
      controls.maxSpeed = 1000;
      controls.stop();
      if (lowerPhase === "approach" && upperPhase === "orbit") {
        // The authored directions straddle -PI/+PI. lerpLookAt interpolates
        // their signed azimuths through zero, taking the long way around the
        // dark side. Blend these nearby unit directions on their short arc
        // separately from distance so the sphere keeps its fitted size.
        const fromOffset = fromPosition.sub(fromTarget);
        const toOffset = toPosition.sub(toTarget);
        const distance = fromOffset.length() * (1 - t) + toOffset.length() * t;
        desiredPosition.current
          .lerpVectors(fromOffset.normalize(), toOffset.normalize(), t)
          .normalize()
          .multiplyScalar(distance)
          .add(desiredTarget.current);
        void controls.setLookAt(
          desiredPosition.current.x,
          desiredPosition.current.y,
          desiredPosition.current.z,
          desiredTarget.current.x,
          desiredTarget.current.y,
          desiredTarget.current.z,
          false,
        );
      } else {
        void controls.lerpLookAt(
          fromPosition.x,
          fromPosition.y,
          fromPosition.z,
          fromTarget.x,
          fromTarget.y,
          fromTarget.z,
          toPosition.x,
          toPosition.y,
          toPosition.z,
          toTarget.x,
          toTarget.y,
          toTarget.z,
          t,
          false,
        );
      }
      controls.update(0);

      document.documentElement.dataset.universeCameraMode =
        "scale-continuous";
      document.documentElement.dataset.universeScaleCameraSegment =
        lowerPhase + ":" + upperPhase;
      document.documentElement.dataset.universeScaleSegment =
        lowerPhase + ":" + upperPhase;
      if (
        rememberedSurfaceView &&
        (lowerPhase === "surface" || upperPhase === "surface")
      ) {
        document.documentElement.dataset.universeSurfaceManualView =
          "scale-endpoint";
      }
      publishScaleFrameDiagnostics(
        scratchFrameCenter.current.set(...WORLD),
        PLANET_RENDER_RADIUS,
      );

      if (
        Math.abs(clampedPosition - scalePhaseIndex(phase)) <=
        WORLD_SCALE_EPSILON
      ) {
        publishIfReached(generation);
      }
      return;
    }

    delete document.documentElement.dataset.universeScaleCameraSegment;
    delete document.documentElement.dataset.universeScaleSegment;

    const rememberedSurfaceView =
      surfaceManualView.current?.identity === surfaceIdentity &&
      surfaceManualView.current?.renderer === surfaceRendererMode
        ? surfaceManualView.current
        : null;
    const surfaceBaseShot =
      phase === "surface"
        ? surfaceFallback
          ? FALLBACK_SURFACE_SHOT
          : activeSurfaceCameraFrame
            ? liveSurfaceShot
            : null
        : null;
    const shot =
      phase === "surface" && rememberedSurfaceView && surfaceBaseShot
        ? {
            ...surfaceBaseShot,
            position: rememberedSurfaceView.position,
            target: rememberedSurfaceView.target,
          }
        : phase === "surface"
          ? surfaceBaseShot
          : SHOTS[phase];
    if (!shot) return;

    if (phase === "surface" && rememberedSurfaceView) {
      document.documentElement.dataset.universeSurfaceManualView = "restored";
    }

    if (phase === "surface" && !surfaceFallback && activeSurfaceCameraFrame) {
      document.documentElement.dataset.universeSurfaceCameraApplied = "true";
    } else {
      delete document.documentElement.dataset.universeSurfaceCameraApplied;
    }

    controls.smoothTime = reducedMotion ? 0.05 : shot.smoothTime;
    controls.maxSpeed = reducedMotion ? 1000 : shot.maxSpeed;

    desiredTarget.current.set(...shot.target);
    desiredPosition.current.set(...shot.position);
    desiredPositionTolerance.current = shot.positionTolerance;
    desiredTargetTolerance.current = shot.targetTolerance;

    if (shot.frameScale) {
      const fitRadius = shot.fitRadius ?? PLANET_RENDER_RADIUS;
      const distance =
        phase === "approach" || phase === "orbit"
          ? framedWorldDistance(controls, fitRadius, shot.frameScale)
          : controls.getDistanceToFitSphere(fitRadius) * shot.frameScale;
      if (phase === "system" && nativeSystemEntryQuaternion) {
        const forward = new Vector3(0, 0, -1)
          .applyQuaternion(nativeSystemEntryQuaternion)
          .normalize();
        desiredPosition.current
          .copy(desiredTarget.current)
          .addScaledVector(forward, -distance);
      } else {
        desiredPosition.current
          .sub(desiredTarget.current)
          .normalize()
          .multiplyScalar(distance)
          .add(desiredTarget.current);
      }
    }

    configuredPhase.current = phase;
    const matchedSystemApproachHandoff =
      phase === "approach" &&
      Math.abs(worldScalePosition - 2) <= WORLD_SCALE_EPSILON &&
      Boolean(
        document.documentElement.dataset.universeHandoffExitProjectedRadius,
      );
    // The continuous System segment already performed the travel. At the
    // renderer boundary the new coordinate space must paint the matched
    // Approach frame immediately; starting another camera-controls transition
    // here would expose the old System-space camera to the close-world scene.
    const enableTransition = matchedSystemApproachHandoff
      ? false
      : shot.transition ?? (!reducedMotion && !softwareRenderer);
    const transition = controls.setLookAt(
      desiredPosition.current.x,
      desiredPosition.current.y,
      desiredPosition.current.z,
      desiredTarget.current.x,
      desiredTarget.current.y,
      desiredTarget.current.z,
      enableTransition,
    );

    if (!enableTransition) {
      // camera-controls guarantees this path applies the end state
      // immediately. Validate and publish from that same authority without
      // waiting for an R3F frame that software WebGL may deliver very late.
      controls.update(0);
      if (matchedSystemApproachHandoff) {
        publishScaleFrameDiagnostics(
          scratchFrameCenter.current.set(...WORLD),
          PLANET_RENDER_RADIUS,
        );
        const html = document.documentElement;
        if (html.dataset.universeProjectedRadius) {
          html.dataset.universeHandoffEntryProjectedRadius =
            html.dataset.universeProjectedRadius;
        }
        if (html.dataset.universeCameraQuaternion) {
          html.dataset.universeHandoffEntryQuaternion =
            html.dataset.universeCameraQuaternion;
        }
        html.dataset.universeHandoffState = "system:approach-matched";
      }
      publishIfReached(generation);
    }
    void transition.then(() => publishIfReached(generation));

    // camera-controls is the transition executor, but on heavily throttled
    // software-rendered runners a smooth transition can otherwise remain in
    // motion indefinitely. Bound the product contract: if the same generation
    // is still active after several smooth-time constants, snap the exact
    // requested shot and publish settlement from the same target/tolerance.
    const settleGuardMs =
      reducedMotion || softwareRenderer
        ? 250
        : Math.max(1200, Math.min(4000, Math.round(shot.smoothTime * 3000)));
    const watchdogId = window.setTimeout(() => {
      if (
        transitionGeneration.current !== generation ||
        phaseRef.current !== phase ||
        configuredPhase.current !== phase ||
        manualOverride.current
      ) {
        return;
      }

      // camera-controls explicitly guarantees enableTransition=false is an
      // immediate move. Do not make settlement depend on the R3F frame loop or
      // on a transition Promise after this point: hosted SwiftShader can stall
      // both while the page is otherwise still responsive.
      document.documentElement.dataset.universeCameraWatchdog =
        "fired:" + phase + ":" + generation;
      controls.stop();
      void controls.setLookAt(
        desiredPosition.current.x,
        desiredPosition.current.y,
        desiredPosition.current.z,
        desiredTarget.current.x,
        desiredTarget.current.y,
        desiredTarget.current.z,
        false,
      );
      controls.update(0);
      publishSettled(generation);
    }, settleGuardMs);
    transitionWatchdog.current = watchdogId;
    document.documentElement.dataset.universeCameraWatchdog =
      "armed:" + phase + ":" + generation;

    return () => {
      // Clean up only the timer created by this exact effect generation.
      // A stale cleanup must never cancel the watchdog armed by a newer phase.
      window.clearTimeout(watchdogId);
      if (transitionWatchdog.current === watchdogId) {
        transitionWatchdog.current = null;
      }
    };
  }, [
    activeSurfaceCameraFrame,
    camera,
    controlsReady,
    galaxyViewState,
    phase,
    phaseRef,
    reducedMotion,
    scrollDepth,
    softwareRenderer,
    surfaceFallback,
    surfaceFallbackAvailable,
    surfaceIdentity,
    surfaceRendererMode,
    systemScaleFrame,
    continuousSystemCamera,
    viewportHeight,
    viewportWidth,
    worldScaleContinuous,
    worldScalePosition,
    worldScaleRenderRevision,
    framedWorldDistance,
    publishIfReached,
    publishScaleFrameDiagnostics,
  ]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const handleRest = () => publishIfReached();
    controls.addEventListener("rest", handleRest);
    return () => controls.removeEventListener("rest", handleRest);
  }, [publishIfReached]);

  useFrame(() => {
    const controls = controlsRef.current;
    const shot =
      phase === "surface"
        ? surfaceFallback
          ? FALLBACK_SURFACE_SHOT
          : activeSurfaceCameraFrame
            ? liveSurfaceShot
            : null
        : SHOTS[phase];
    if (
      !controls ||
      !shot ||
      phaseRef.current !== phase ||
      configuredPhase.current !== phase ||
      manualOverride.current ||
      completedPhase.current === phase
    ) {
      return;
    }

    publishIfReached();
  });

  useEffect(
    () => () => {
      delete document.documentElement.dataset.universeCameraSettled;
      delete document.documentElement.dataset.universeCameraMode;
      delete document.documentElement.dataset.universeSurfaceCameraApplied;
      delete document.documentElement.dataset.universeCameraGeneration;
      delete document.documentElement.dataset.universeCameraWatchdog;
      delete document.documentElement.dataset.universeCameraAwaitingControls;
      delete document.documentElement.dataset.universeCameraAwaitingWorldFrame;
      delete document.documentElement.dataset.universeScaleCameraSegment;
      delete document.documentElement.dataset.universeScaleSegment;
      delete document.documentElement.dataset.universeCameraDistance;
      delete document.documentElement.dataset.universeProjectedRadius;
      delete document.documentElement.dataset.universeCameraQuaternion;
      delete document.documentElement.dataset.universeHandoffExitProjectedRadius;
      delete document.documentElement.dataset.universeHandoffEntryProjectedRadius;
      delete document.documentElement.dataset.universeHandoffExitQuaternion;
      delete document.documentElement.dataset.universeHandoffEntryQuaternion;
      delete document.documentElement.dataset.universeSystemScaleFrame;
      delete document.documentElement.dataset.universeSystemScaleRadius;
      delete document.documentElement.dataset.universeSystemScaleDistance;
      delete document.documentElement.dataset.universeSystemEntryView;
      delete document.documentElement.dataset.universeSurfaceManualView;
    },
    [],
  );

  return (
    <CameraControls
      ref={handleControlsRef}
      makeDefault
      dollyToCursor={false}
      mouseButtons={manualCameraEnabled ? MANUAL_MOUSE : DISABLED_MOUSE}
      touches={manualCameraEnabled ? MANUAL_TOUCH : DISABLED_TOUCH}
      minDistance={manualMinDistance}
      maxDistance={manualCameraEnabled ? manualMaxDistance : 80}
      restThreshold={0.05}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI - 0.3}
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.45}
      dollySpeed={0.55}
      truckSpeed={0.45}
    />
  );
}
