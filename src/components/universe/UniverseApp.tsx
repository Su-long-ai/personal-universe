import { useEffect, useMemo, useState } from "react";
import { UniverseCanvas } from "./UniverseCanvas";
import { UniverseHud } from "./UniverseHud";
import type { QualityMode, UniversePhase } from "../../lib/universe/types";
import { useAmbientAudio } from "../../lib/universe/useAmbientAudio";
import "./universe.css";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export default function UniverseApp() {
  const [phase, setPhase] = useState<UniversePhase>("galaxy");
  const [collapsed, setCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [scrollDepth, setScrollDepth] = useState(0);
  const reducedMotion = useReducedMotion();
  const ambient = useAmbientAudio(muted, phase);
  const debugFreeze =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("freeze") === "1";

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("phase");
    if (requested && ["galaxy", "approach", "orbit", "atmosphere", "surface", "returning"].includes(requested)) {
      setPhase(requested as UniversePhase);
    }
  }, []);

  useEffect(() => {
    if (debugFreeze || phase === "galaxy" || phase === "surface" || phase === "returning") return;
    const durations: Partial<Record<UniversePhase, number>> = reducedMotion
      ? { approach: 350, orbit: 350, atmosphere: 300 }
      : { approach: 2400, orbit: 1750, atmosphere: 1450 };

    const next: Partial<Record<UniversePhase, UniversePhase>> = {
      approach: "orbit",
      orbit: "atmosphere",
      atmosphere: "surface",
    };

    const timer = window.setTimeout(() => {
      const destination = next[phase];
      if (destination) setPhase(destination);
    }, durations[phase] ?? 800);

    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, debugFreeze]);

  useEffect(() => {
    if (debugFreeze || phase !== "returning") return;
    const timer = window.setTimeout(() => setPhase("galaxy"), reducedMotion ? 250 : 1250);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion, debugFreeze]);

  const transitionClass = useMemo(() => {
    if (phase === "atmosphere") return "transition-atmosphere";
    if (phase === "surface") return "transition-surface";
    return "";
  }, [phase]);

  return (
    <main
      className={`universe-root ${transitionClass}`}
      onWheel={(event) => {
        if (phase !== "galaxy") return;
        setScrollDepth((value) => Math.max(-2.5, Math.min(3, value + Math.sign(event.deltaY) * 0.35)));
      }}
    >
      <div className="universe-canvas">
        <UniverseCanvas
          phase={phase}
          onSelectPlanet={() => {
            if (phase !== "galaxy") return;
            ambient.ensurePlaying();
            setPhase("approach");
          }}
          quality={quality}
          scrollDepth={scrollDepth}
          reducedMotion={reducedMotion}
        />
      </div>

      <div className="cinematic-wash" aria-hidden="true" />

      <UniverseHud
        phase={phase}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        muted={muted}
        onToggleMuted={() => {
          if (muted) ambient.ensurePlaying();
          setMuted((value) => !value);
        }}
        quality={quality}
        onQualityChange={setQuality}
        onReturn={() => setPhase("returning")}
      />

      {phase === "galaxy" && (
        <section className="hero-copy">
          <span className="eyebrow">PERSONAL UNIVERSE // PROTOTYPE 00</span>
          <h1>Somewhere beyond the charted sky.</h1>
          <p>Scroll to drift. Select the blue world to begin descent.</p>
        </section>
      )}

      {phase === "surface" && (
        <section className="surface-copy">
          <span>WORLD MODULE // ONLINE</span>
          <strong>This world is allowed to become something else entirely.</strong>
          <small>Click the beacon. This is only the heterogeneous-world proof.</small>
        </section>
      )}

      {phase === "approach" && <div className="travel-caption">LOCK ACQUIRED // ACCELERATING</div>}
      {phase === "orbit" && <div className="travel-caption">ORBITAL INSERTION // AURORA-01</div>}
      {phase === "atmosphere" && <div className="travel-caption">ATMOSPHERIC ENTRY</div>}
    </main>
  );
}
