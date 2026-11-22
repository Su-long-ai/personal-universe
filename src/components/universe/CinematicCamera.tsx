import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CameraControls, type CameraControls as CameraControlsApi } from "@react-three/drei";
import { Vector3 } from "three";
import { TEST_WORLD, type UniversePhase } from "../../lib/universe/types";

type CinematicCameraProps = {
  phase: UniversePhase;
  scrollDepth: number;
  reducedMotion: boolean;
  onPhaseComplete: (phase: UniversePhase) => void;
};

const WORLD = TEST_WORLD.position;

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
    }
  >
> = {
  approach: {
    position: [1.35, 1.15, 13.6],
    target: [WORLD[0] - 0.15, WORLD[1] + 0.15, WORLD[2]],
    smoothTime: 1.28,
    maxSpeed: 28,
    positionTolerance: 0.16,
    targetTolerance: 0.1,
  },
  orbit: {
    position: [8.65, 1.28, 6.25],
    target: [WORLD[0] - 0.22, WORLD[1] + 0.02, WORLD[2]],
    smoothTime: 0.92,
    maxSpeed: 18,
    positionTolerance: 0.12,
    targetTolerance: 0.08,
  },
  atmosphere: {
    position: [7.12, 0.9, 3.42],
    target: [WORLD[0] - 0.18, WORLD[1] - 0.24, WORLD[2] - 0.08],
    smoothTime: 0.68,
    maxSpeed: 12,
    positionTolerance: 0.08,
    targetTolerance: 0.06,
  },
  returning: {
    position: [1.8, 0.45, 14.8],
    target: [1.6, 0, 0],
    smoothTime: 1.05,
    maxSpeed: 26,
    positionTolerance: 0.16,
    targetTolerance: 0.1,
  },
};

export function CinematicCamera({
  phase,
  scrollDepth,
  reducedMotion,
  onPhaseComplete,
}: CinematicCameraProps) {
  const controlsRef = useRef<CameraControlsApi>(null);
  const completedPhase = useRef<UniversePhase | null>(null);
  const currentPosition = useRef(new Vector3());
  const currentTarget = useRef(new Vector3());
  const desiredPosition = useRef(new Vector3());
  const desiredTarget = useRef(new Vector3());

  useEffect(() => {
    completedPhase.current = null;
    const controls = controlsRef.current;
    if (!controls) return;

    controls.stop();

    if (phase === "galaxy") {
      controls.smoothTime = reducedMotion ? 0.05 : 0.48;
      controls.maxSpeed = 24;
      void controls.setLookAt(
        0,
        0.4,
        20 + scrollDepth,
        1.6,
        0,
        0,
        !reducedMotion,
      );
      return;
    }

    if (phase === "surface") {
      controls.smoothTime = reducedMotion ? 0.05 : 0.38;
      controls.maxSpeed = 24;
      void controls.setLookAt(0.5, 22.0, 18.0, 0, 8.0, -16.0, false);
      return;
    }

    const shot = SHOTS[phase];
    if (!shot) return;

    controls.smoothTime = reducedMotion ? 0.05 : shot.smoothTime;
    controls.maxSpeed = reducedMotion ? 1000 : shot.maxSpeed;
    desiredPosition.current.set(...shot.position);
    desiredTarget.current.set(...shot.target);

    void controls.setLookAt(
      ...shot.position,
      ...shot.target,
      !reducedMotion,
    );
  }, [phase, reducedMotion, scrollDepth]);

  useFrame(() => {
    const controls = controlsRef.current;
    const shot = SHOTS[phase];
    if (!controls || !shot || completedPhase.current === phase) return;

    controls.getPosition(currentPosition.current);
    controls.getTarget(currentTarget.current);

    const positionReached =
      currentPosition.current.distanceTo(desiredPosition.current) <=
      shot.positionTolerance;
    const targetReached =
      currentTarget.current.distanceTo(desiredTarget.current) <=
      shot.targetTolerance;

    if (!positionReached || !targetReached) return;

    completedPhase.current = phase;
    onPhaseComplete(phase);
  });

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      dollyToCursor={false}
      mouseButtons={{ left: 0, middle: 0, right: 0, wheel: 0 }}
      touches={{ one: 0, two: 0, three: 0 }}
      minDistance={0.3}
      maxDistance={36}
      restThreshold={0.05}
      minPolarAngle={0.3}
      maxPolarAngle={Math.PI - 0.3}
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.45}
      dollySpeed={0.55}
      truckSpeed={0.45}
    />
  );
}
