import { useCallback, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, type CameraControls as CameraControlsApi } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import { Vector3 } from "three";
import {
  PLANET_ANCHOR,
  PLANET_RENDER_RADIUS,
  type UniversePhase,
} from "../../lib/universe/types";

type CinematicCameraProps = {
  phase: UniversePhase;
  scrollDepth: number;
  reducedMotion: boolean;
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
  wheel: CameraControlsImpl.ACTION.DOLLY,
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
    position: [7.12, 0.9, 3.42],
    target: [WORLD[0] - 0.18, WORLD[1] - 0.24, WORLD[2] - 0.08],
    smoothTime: 0.68,
    maxSpeed: 12,
    positionTolerance: 0.08,
    targetTolerance: 0.06,
  },
  surface: {
    position: [0.5, 22.0, 18.0],
    target: [0, 8.0, -16.0],
    smoothTime: 0.38,
    maxSpeed: 24,
    positionTolerance: 0.14,
    targetTolerance: 0.1,
    transition: false,
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
  onPhaseComplete,
  onUserControlStart,
}: CinematicCameraProps) {
  const { width, height } = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const controlsRef = useRef<CameraControlsApi>(null);
  const completedPhase = useRef<UniversePhase | null>(null);
  const manualOverride = useRef(false);
  const currentPosition = useRef(new Vector3());
  const currentTarget = useRef(new Vector3());
  const desiredPosition = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());

  const manualCameraEnabled =
    phase === "system" || phase === "orbit" || phase === "surface";
  const manualMinDistance =
    phase === "orbit"
      ? PLANET_RENDER_RADIUS * 1.28
      : phase === "system"
        ? 5
        : phase === "surface"
          ? 8
          : 0.3;
  const manualMaxDistance =
    phase === "orbit" ? PLANET_RENDER_RADIUS * 7 : phase === "system" ? 55 : 65;

  const handleUserControlStart = useCallback(() => {
    if (!manualCameraEnabled) return;
    manualOverride.current = true;
    completedPhase.current = null;
    delete document.documentElement.dataset.universeCameraSettled;
    document.documentElement.dataset.universeCameraMode = "manual";
    onUserControlStart();
  }, [manualCameraEnabled, onUserControlStart]);

  useEffect(() => {
    completedPhase.current = null;
    manualOverride.current = false;
    delete document.documentElement.dataset.universeCameraSettled;
    document.documentElement.dataset.universeCameraMode = "cinematic";
    const controls = controlsRef.current;
    if (!controls) return;

    controls.stop();

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

    const shot = SHOTS[phase];
    if (!shot) return;

    controls.smoothTime = reducedMotion ? 0.05 : shot.smoothTime;
    controls.maxSpeed = reducedMotion ? 1000 : shot.maxSpeed;

    desiredTarget.current.set(...shot.target);
    desiredPosition.current.set(...shot.position);

    if (shot.frameScale) {
      const distance =
        controls.getDistanceToFitSphere(PLANET_RENDER_RADIUS) * shot.frameScale;
      desiredPosition.current
        .sub(desiredTarget.current)
        .normalize()
        .multiplyScalar(distance)
        .add(desiredTarget.current);
    }

    void controls.setLookAt(
      desiredPosition.current.x,
      desiredPosition.current.y,
      desiredPosition.current.z,
      desiredTarget.current.x,
      desiredTarget.current.y,
      desiredTarget.current.z,
      shot.transition ?? !reducedMotion,
    );
  }, [height, phase, reducedMotion, scrollDepth, width]);

  useEffect(() => {
    if (!manualCameraEnabled) return;
    const canvas = gl.domElement;
    const onWheel = () => handleUserControlStart();
    canvas.addEventListener("wheel", onWheel, { passive: true });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [gl, handleUserControlStart, manualCameraEnabled]);

  useFrame(() => {
    const controls = controlsRef.current;
    const shot = SHOTS[phase];
    if (
      !controls ||
      !shot ||
      manualOverride.current ||
      completedPhase.current === phase
    ) {
      return;
    }

    controls.getPosition(currentPosition.current, false);
    controls.getTarget(currentTarget.current, false);

    const positionReached =
      currentPosition.current.distanceTo(desiredPosition.current) <=
      shot.positionTolerance;
    const targetReached =
      currentTarget.current.distanceTo(desiredTarget.current) <=
      shot.targetTolerance;

    if (!positionReached || !targetReached) return;

    completedPhase.current = phase;
    document.documentElement.dataset.universeCameraSettled = phase;
    document.documentElement.dataset.universeCameraMode = "settled";
    onPhaseComplete(phase);
  });

  useEffect(
    () => () => {
      delete document.documentElement.dataset.universeCameraSettled;
      delete document.documentElement.dataset.universeCameraMode;
    },
    [],
  );

  return (
    <CameraControls
      ref={controlsRef}
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
