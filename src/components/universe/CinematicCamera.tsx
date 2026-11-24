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
import { Quaternion, Vector3 } from "three";
import {
  PLANET_ANCHOR,
  PLANET_RENDER_RADIUS,
  SYSTEM_OVERVIEW_RADIUS,
  type QualityMode,
  type UniversePhase,
} from "../../lib/universe/types";
import {
  WORLD_SCALE_EPSILON,
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

type CinematicCameraProps = {
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  worldScalePosition: number;
  worldScaleContinuous: boolean;
  scrollDepth: number;
  reducedMotion: boolean;
  quality: QualityMode;
  surfaceCameraFrame: SurfaceCameraFrame | null;
  systemScaleFrame: SystemScaleFrame | null;
  galaxyViewState: YeisGalaxyViewState | null;
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

const FALLBACK_SURFACE_SHOT: CameraShot = {
  position: [0.5, 22.0, 18.0] as [number, number, number],
  target: [0, 8.0, -16.0] as [number, number, number],
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
    position: [1.35, 1.15, 13.6],
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
  worldScaleContinuous,
  scrollDepth,
  reducedMotion,
  quality,
  surfaceCameraFrame,
  systemScaleFrame,
  galaxyViewState,
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
  const surfaceFallback =
    phase === "surface" && surfaceFallbackAvailable;
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
  const currentPosition = useRef(new Vector3());
  const currentTarget = useRef(new Vector3());
  const desiredPosition = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());
  const desiredPositionTolerance = useRef(0);
  const desiredTargetTolerance = useRef(0);

  const handleControlsRef = useCallback(
    (controls: CameraControlsApi | null) => {
      controlsRef.current = controls;
      setControlsReady(Boolean(controls));
    },
    [],
  );

  const manualCameraEnabled =
    phase === "system" || phase === "orbit" || phase === "surface";
  const manualMinDistance =
    phase === "orbit"
      ? PLANET_RENDER_RADIUS * 1.28
      : phase === "system"
        ? continuousSystemCamera
          ? 1e-8
          : 5
        : phase === "surface"
          ? surfaceFallback
            ? 8
            : 0.015
          : 0.3;
  const manualMaxDistance =
    phase === "orbit"
      ? PLANET_RENDER_RADIUS * 7
      : phase === "system"
        ? 55
        : phase === "surface"
          ? surfaceFallback
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
        (!surfaceFallbackAvailable || worldScalePosition <= 4);
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

    // Wheel belongs exclusively to the continuous-scale coordinator. Listen
    // for an actual pointer/touch press instead of camera-controls' generic
    // controlstart event so a wheel gesture can never be misclassified as a
    // manual camera takeover and cancel an in-flight scale intent.
    const element = gl.domElement;
    const handlePointerDown = () => handleUserControlStart();
    element.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      element.removeEventListener("pointerdown", handlePointerDown, true);
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
      ? new Quaternion().fromArray(galaxyViewState.quaternion)
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
      (!surfaceFallbackAvailable || worldScalePosition <= 4);
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
      nativeSystemEntryQuaternion
    ) {
      camera.up
        .set(0, 1, 0)
        .applyQuaternion(nativeSystemEntryQuaternion)
        .normalize();
    } else if (
      continuousWorldCamera &&
      activeSurfaceCameraFrame &&
      worldScalePosition > 4
    ) {
      const surfaceInfluence = Math.min(1, worldScalePosition - 4);
      camera.up
        .set(0, 1, 0)
        .lerp(
          new Vector3(...activeSurfaceCameraFrame.up).normalize(),
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

      const systemTarget = new Vector3(...systemShot.target);
      const systemPosition = new Vector3(...systemShot.position);
      if (systemShot.frameScale) {
        const distance =
          controls.getDistanceToFitSphere(
            systemShot.fitRadius ?? SYSTEM_OVERVIEW_RADIUS,
          ) * systemShot.frameScale;
        if (nativeSystemEntryQuaternion) {
          const forward = new Vector3(0, 0, -1)
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
      // the viewing direction comes from the existing Approach shot.
      const approachTarget = new Vector3(...approachShot.target);
      const approachPosition = new Vector3(...approachShot.position);
      const approachDirection = approachPosition
        .sub(approachTarget)
        .normalize();
      const endpointTargetOffset = new Vector3(...approachShot.target)
        .sub(new Vector3(...WORLD))
        .multiplyScalar(
          Math.max(systemScaleFrame.radius, 1e-8) / PLANET_RENDER_RADIUS,
        );
      const endpointTarget = new Vector3(...systemScaleFrame.position).add(
        endpointTargetOffset,
      );

      const systemDirection = systemPosition
        .clone()
        .sub(systemTarget)
        .normalize();
      const linearT = Math.min(
        1,
        Math.max(0, worldScalePosition - 1),
      );
      const t = linearT * linearT * (3 - 2 * linearT);
      const direction = systemDirection
        .lerp(approachDirection, t)
        .normalize();

      const startDistance = Math.max(
        1e-8,
        systemPosition.distanceTo(systemTarget),
      );
      const endpointDistance = Math.max(
        1e-8,
        controls.getDistanceToFitSphere(
          Math.max(systemScaleFrame.radius, 1e-8),
        ) * (approachShot.frameScale ?? 1),
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
      document.documentElement.dataset.universeSystemScaleDistance =
        distance.toExponential(4);
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
      const surfaceShot =
        activeSurfaceCameraFrame && liveSurfaceShot
          ? liveSurfaceShot
          : SHOTS.surface;
      const lowerShot =
        lowerPhase === "surface" ? surfaceShot : SHOTS[lowerPhase];
      const upperShot =
        upperPhase === "surface" ? surfaceShot : SHOTS[upperPhase];
      if (!lowerShot || !upperShot) return;

      const resolveShot = (shot: CameraShot) => {
        const target = new Vector3(...shot.target);
        const position = new Vector3(...shot.position);
        if (shot.frameScale) {
          const distance =
            controls.getDistanceToFitSphere(
              shot.fitRadius ?? PLANET_RENDER_RADIUS,
            ) * shot.frameScale;
          position
            .sub(target)
            .normalize()
            .multiplyScalar(distance)
            .add(target);
        }
        return { position, target };
      };

      const from = resolveShot(lowerShot);
      const to = resolveShot(upperShot);
      const linearT =
        lowerIndex === upperIndex
          ? 0
          : clampedPosition - lowerIndex;
      // Smoothstep keeps velocity continuous at the authored shot anchors
      // while remaining exactly reversible for the same scale coordinate.
      const t = linearT * linearT * (3 - 2 * linearT);

      desiredPosition.current.lerpVectors(from.position, to.position, t);
      desiredTarget.current.lerpVectors(from.target, to.target, t);
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
      void controls.lerpLookAt(
        from.position.x,
        from.position.y,
        from.position.z,
        from.target.x,
        from.target.y,
        from.target.z,
        to.position.x,
        to.position.y,
        to.position.z,
        to.target.x,
        to.target.y,
        to.target.z,
        t,
        false,
      );
      controls.update(0);

      document.documentElement.dataset.universeCameraMode =
        "scale-continuous";
      document.documentElement.dataset.universeScaleCameraSegment =
        lowerPhase + ":" + upperPhase;

      if (
        Math.abs(clampedPosition - scalePhaseIndex(phase)) <=
        WORLD_SCALE_EPSILON
      ) {
        publishIfReached(generation);
      }
      return;
    }

    delete document.documentElement.dataset.universeScaleCameraSegment;

    const shot =
      phase === "surface"
        ? surfaceFallback
          ? FALLBACK_SURFACE_SHOT
          : activeSurfaceCameraFrame
            ? liveSurfaceShot
            : null
        : SHOTS[phase];
    if (!shot) return;

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
      const distance =
        controls.getDistanceToFitSphere(
          shot.fitRadius ?? PLANET_RENDER_RADIUS,
        ) * shot.frameScale;
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
    const enableTransition =
      shot.transition ?? (!reducedMotion && !softwareRenderer);
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
    systemScaleFrame,
    continuousSystemCamera,
    viewportHeight,
    viewportWidth,
    worldScaleContinuous,
    worldScalePosition,
    publishIfReached,
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
      delete document.documentElement.dataset.universeScaleCameraSegment;
      delete document.documentElement.dataset.universeSystemScaleFrame;
      delete document.documentElement.dataset.universeSystemScaleRadius;
      delete document.documentElement.dataset.universeSystemScaleDistance;
      delete document.documentElement.dataset.universeSystemEntryView;
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
