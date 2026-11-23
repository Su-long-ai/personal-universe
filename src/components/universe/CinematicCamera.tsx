import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, type CameraControls as CameraControlsApi } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { Vector3 } from "three";
import {
  PLANET_ANCHOR,
  PLANET_RENDER_RADIUS,
  type QualityMode,
  type UniversePhase,
} from "../../lib/universe/types";
import { liveWorldFallbackReason } from "./CinematicPipeline";

export type SurfaceCameraFrame = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
};

type CinematicCameraProps = {
  phase: UniversePhase;
  scrollDepth: number;
  reducedMotion: boolean;
  quality: QualityMode;
  surfaceCameraFrame: SurfaceCameraFrame | null;
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

const FALLBACK_SURFACE_SHOT = {
  position: [0.5, 22.0, 18.0] as [number, number, number],
  target: [0, 8.0, -16.0] as [number, number, number],
  smoothTime: 0.38,
  maxSpeed: 24,
  positionTolerance: 0.14,
  targetTolerance: 0.1,
  transition: false,
};

const SHOTS: Partial<
  Record<
    UniversePhase,
    {
      position: [number, number, number];
      target: [number, number, number];
      smoothTime: number;
      maxSpeed: number;
      positionTolerance: number;
      targetTolerance: number;
      frameScale?: number;
      transition?: boolean;
    }
  >
> = {
  system: {
    position: [0, 8.6, 18.5],
    target: [0, 0, 0],
    smoothTime: 0.52,
    maxSpeed: 28,
    positionTolerance: 0.16,
    targetTolerance: 0.1,
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
    position: [8.65, 1.28, 6.25],
    target: [WORLD[0] - 0.22, WORLD[1] + 0.02, WORLD[2]],
    smoothTime: 0.92,
    maxSpeed: 18,
    positionTolerance: 0.12,
    targetTolerance: 0.08,
    frameScale: 1.28,
  },
  atmosphere: {
    position: [7.3, 1.2, 4.8],
    target: [6.75, 0.45, 1.2],
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
  scrollDepth,
  reducedMotion,
  quality,
  surfaceCameraFrame,
  onPhaseComplete,
  onUserControlStart,
}: CinematicCameraProps) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const surfaceFallback =
    phase === "surface" && Boolean(liveWorldFallbackReason(gl, quality));
  const activeSurfaceCameraFrame =
    phase === "surface" ? surfaceCameraFrame : null;
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
        ? 5
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
    [onPhaseComplete, phase],
  );

  const publishIfReached = useCallback(
    (expectedGeneration = transitionGeneration.current) => {
      if (
        expectedGeneration !== transitionGeneration.current ||
        manualOverride.current ||
        configuredPhase.current !== phase
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
    [phase, publishSettled],
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

    const desiredNear =
      phase === "surface" && !surfaceFallback && activeSurfaceCameraFrame
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
        controls.getDistanceToFitSphere(PLANET_RENDER_RADIUS) * shot.frameScale;
      desiredPosition.current
        .sub(desiredTarget.current)
        .normalize()
        .multiplyScalar(distance)
        .add(desiredTarget.current);
    }

    configuredPhase.current = phase;
    void controls
      .setLookAt(
        desiredPosition.current.x,
        desiredPosition.current.y,
        desiredPosition.current.z,
        desiredTarget.current.x,
        desiredTarget.current.y,
        desiredTarget.current.z,
        shot.transition ?? !reducedMotion,
      )
      .then(() => publishIfReached(generation));

    // camera-controls is the transition executor, but on heavily throttled
    // software-rendered runners a smooth transition can otherwise remain in
    // motion indefinitely. Bound the product contract: if the same generation
    // is still active after several smooth-time constants, snap the exact
    // requested shot and publish settlement from the same target/tolerance.
    const settleGuardMs = reducedMotion
      ? 250
      : Math.max(1200, Math.min(4000, Math.round(shot.smoothTime * 3000)));
    const watchdogId = window.setTimeout(() => {
      if (
        transitionGeneration.current !== generation ||
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
    phase,
    reducedMotion,
    scrollDepth,
    surfaceFallback,
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
    },
    [],
  );

  return (
    <CameraControls
      ref={handleControlsRef}
      makeDefault
      dollyToCursor={false}
      onStart={handleUserControlStart}
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
