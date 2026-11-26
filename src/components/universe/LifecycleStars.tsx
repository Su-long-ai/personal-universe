import { Stars } from "@react-three/drei";
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import type { Points } from "three";

export function LifecycleStars(props: ComponentPropsWithoutRef<typeof Stars>) {
  const pointsRef = useRef<Points>(null);
  useEffect(() => {
    // Drei creates a StarfieldMaterial for each Stars instance and attaches it
    // as a primitive, which R3F does not dispose. Capture it while attached:
    // R3F may restore the Points' old material before passive unmount cleanup.
    const material = pointsRef.current?.material;
    return () => {
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material?.dispose();
      }
    };
  }, []);
  return <Stars {...props} ref={pointsRef} />;
}
