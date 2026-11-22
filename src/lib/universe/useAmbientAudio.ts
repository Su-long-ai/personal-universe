import { useCallback, useEffect, useRef } from "react";
import type { Howl as HowlType } from "howler";
import type { UniversePhase } from "./types";

function targetVolume(phase: UniversePhase) {
  if (phase === "surface") return 0.075;
  if (phase === "atmosphere") return 0.17;
  if (phase === "approach" || phase === "orbit") return 0.14;
  return 0.095;
}

export function useAmbientAudio(muted: boolean, phase: UniversePhase) {
  const soundRef = useRef<HowlType | null>(null);
  const requestedRef = useRef(false);
  const mutedRef = useRef(muted);
  const phaseRef = useRef(phase);

  mutedRef.current = muted;
  phaseRef.current = phase;

  const ensurePlaying = useCallback(() => {
    requestedRef.current = true;
    const sound = soundRef.current;
    if (!sound || mutedRef.current || sound.playing()) return;
    const target = targetVolume(phaseRef.current);
    sound.volume(0);
    sound.play();
    sound.fade(0, target, 1100);
  }, []);

  useEffect(() => {
    let disposed = false;

    void import("howler").then(({ Howl }) => {
      if (disposed) return;
      const sound = new Howl({
        src: [`${import.meta.env.BASE_URL}audio/deep-space.ogg`],
        loop: true,
        preload: true,
        volume: targetVolume(phaseRef.current),
      });
      soundRef.current = sound;
      if (requestedRef.current && !mutedRef.current) ensurePlaying();
    });

    return () => {
      disposed = true;
      soundRef.current?.unload();
      soundRef.current = null;
    };
  }, [ensurePlaying]);

  useEffect(() => {
    const sound = soundRef.current;
    if (!sound) return;

    sound.mute(muted);
    if (!muted && requestedRef.current && !sound.playing()) {
      ensurePlaying();
      return;
    }
    if (sound.playing() && !muted) {
      sound.fade(sound.volume(), targetVolume(phase), 700);
    }
  }, [ensurePlaying, muted, phase]);

  return { ensurePlaying };
}
