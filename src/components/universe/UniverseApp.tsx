import { useCallback, useEffect, useMemo, useState } from "react";
import { UniverseCanvas } from "./UniverseCanvas";
import { UniverseHud } from "./UniverseHud";
import type {
  GalaxyMarker,
  PlanetDefinition,
  QualityMode,
  SystemDefinition,
  UniversePhase,
} from "../../lib/universe/types";
import {
  buildGalaxyIndex,
  resolveSystem,
} from "../../lib/universe/generation";
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

const VALID_PHASES: UniversePhase[] = [
  "galaxy",
  "system",
  "approach",
  "orbit",
  "atmosphere",
  "surface",
  "returning",
];

export default function UniverseApp() {
  const galaxy = useMemo(() => buildGalaxyIndex("personal-universe-v2"), []);
  const [phase, setPhase] = useState<UniversePhase>("galaxy");
  const [selectedSystem, setSelectedSystem] = useState<SystemDefinition | null>(null);
  const [selectedPlanet, setSelectedPlanet] = useState<PlanetDefinition | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [scrollDepth, setScrollDepth] = useState(0);
  const [coreDiagnostic, setCoreDiagnostic] = useState<{
    status: "loading" | "ready" | "error";
    detail: string;
  } | null>(null);
  const reducedMotion = useReducedMotion();
  const ambient = useAmbientAudio(muted, phase);
  const debugFreeze =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("freeze") === "1";

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("phase");
    if (!requested || !VALID_PHASES.includes(requested as UniversePhase)) return;

    const requestedPhase = requested as UniversePhase;
    if (requestedPhase === "galaxy") {
      setPhase("galaxy");
      return;
    }

    const heroMarker = galaxy.markers.find((marker) => marker.source === "hero");
    if (!heroMarker) return;
    const system = resolveSystem(heroMarker);
    setSelectedSystem(system);

    if (requestedPhase === "system" || requestedPhase === "returning") {
      setPhase(requestedPhase);
      return;
    }

    const heroPlanet =
      system.planets.find((planet) => planet.heroKey === "home") ??
      system.planets[0] ??
      null;
    if (!heroPlanet) return;
    setSelectedPlanet(heroPlanet);
    setPhase(requestedPhase);
  }, [galaxy.markers]);

  useEffect(() => {
    const diagnostic = new URLSearchParams(window.location.search).get("diagnostic");
    if (diagnostic !== "yeis-core") return;

    let cancelled = false;
    setCoreDiagnostic({
      status: "loading",
      detail: "Loading vendored universe model and 109,401-star catalogue…",
    });

    void import("../../lib/universe/yeis")
      .then(async ({ loadYeisCore, HERO_PLANET_ID }) => {
        const runtime = await loadYeisCore();
        const hero = runtime.heroSystem.get(HERO_PLANET_ID);
        const detail =
          `stars=${runtime.catalog.count} heroSystem=${runtime.heroSystem.id} ` +
          `bodies=${runtime.heroSystem.bodies.length} hero=${hero?.name ?? "missing"}`;

        if (cancelled) return;
        document.documentElement.dataset.yeisCore = "ready";
        document.documentElement.dataset.yeisStars = String(runtime.catalog.count);
        console.info(`[YEIS-CORE] READY ${detail}`);
        setCoreDiagnostic({ status: "ready", detail });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        document.documentElement.dataset.yeisCore = "error";
        console.error("[YEIS-CORE] FAILED", error);
        setCoreDiagnostic({ status: "error", detail });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectSystem = useCallback(
    (marker: GalaxyMarker) => {
      const system = resolveSystem(marker);
      setSelectedSystem(system);
      setSelectedPlanet(null);
      setScrollDepth(0);
      ambient.ensurePlaying();
      setPhase("system");
    },
    [ambient],
  );

  const handleSelectPlanet = useCallback(
    (planet: PlanetDefinition) => {
      setSelectedPlanet(planet);
      ambient.ensurePlaying();
      setPhase("approach");
    },
    [ambient],
  );

  const handleCinematicPhaseComplete = useCallback(
    (completed: UniversePhase) => {
      if (debugFreeze) return;

      setPhase((current) => {
        if (current !== completed) return current;

        if (completed === "approach") return "orbit";
        if (completed === "orbit") {
          return selectedPlanet?.surfaceMode === "none" ? "orbit" : "atmosphere";
        }
        if (completed === "atmosphere") return "surface";
        if (completed === "returning") return "galaxy";
        return current;
      });
    },
    [debugFreeze, selectedPlanet?.surfaceMode],
  );

  const handleReturn = useCallback(() => {
    if (phase === "system") {
      setSelectedSystem(null);
      setSelectedPlanet(null);
      setPhase("returning");
      return;
    }

    if (phase === "returning") return;

    setSelectedPlanet(null);
    if (selectedSystem) {
      setPhase("system");
    } else {
      setPhase("galaxy");
    }
  }, [phase, selectedSystem]);

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
        setScrollDepth((value) =>
          Math.max(-3.5, Math.min(4.5, value + Math.sign(event.deltaY) * 0.42)),
        );
      }}
    >
      <div className="universe-canvas">
        <UniverseCanvas
          phase={phase}
          markers={galaxy.markers}
          selectedSystem={selectedSystem}
          selectedPlanet={selectedPlanet}
          onSelectSystem={handleSelectSystem}
          onSelectPlanet={handleSelectPlanet}
          quality={quality}
          scrollDepth={scrollDepth}
          reducedMotion={reducedMotion}
          onCinematicPhaseComplete={handleCinematicPhaseComplete}
        />
      </div>

      <div className="cinematic-wash" aria-hidden="true" />

      {coreDiagnostic && (
        <aside
          data-yeis-core-diagnostic={coreDiagnostic.status}
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 20,
            maxWidth: 520,
            padding: "10px 12px",
            border: "1px solid rgba(126, 235, 255, 0.35)",
            background: "rgba(1, 7, 14, 0.88)",
            color: "#dffaff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: 1.5,
            pointerEvents: "none",
          }}
        >
          <strong>YEIS CORE // {coreDiagnostic.status.toUpperCase()}</strong>
          <div>{coreDiagnostic.detail}</div>
        </aside>
      )}

      <UniverseHud
        phase={phase}
        selectedSystem={selectedSystem}
        selectedPlanet={selectedPlanet}
        markerCount={galaxy.markers.length}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        muted={muted}
        onToggleMuted={() => {
          if (muted) ambient.ensurePlaying();
          setMuted((value) => !value);
        }}
        quality={quality}
        onQualityChange={setQuality}
        onReturn={handleReturn}
      />

      {phase === "galaxy" && (
        <section className="hero-copy">
          <span className="eyebrow">PERSONAL UNIVERSE // GALACTIC INDEX</span>
          <h1>A living map of observed and imagined worlds.</h1>
          <p>
            Bright survey rings are observed systems. Cyan marks a handcrafted Hero world.
            Everything else is deterministic procedural space.
          </p>
        </section>
      )}

      {phase === "system" && selectedSystem && (
        <section className="system-copy">
          <span>
            {selectedSystem.source.toUpperCase()} SYSTEM // {selectedSystem.star.spectralType}
          </span>
          <strong>{selectedSystem.name}</strong>
          <small>
            {selectedSystem.planets.length} worlds. Select a planet to approach it.
            Ordinary worlds remain orbital; Hero worlds may continue below the clouds.
          </small>
        </section>
      )}

      {phase === "surface" && selectedPlanet && (
        <section className="surface-copy">
          <span>HERO WORLD // SURFACE MODULE</span>
          <strong>{selectedPlanet.name}</strong>
          <small>
            Custom surfaces are overrides. The procedural universe does not require every
            generated planet to carry a handcrafted world.
          </small>
        </section>
      )}

      {phase === "approach" && selectedPlanet && (
        <div className="travel-caption">
          LOCK ACQUIRED // {selectedPlanet.name}
        </div>
      )}
      {phase === "orbit" && selectedPlanet && (
        <div className="travel-caption">
          ORBIT // {selectedPlanet.name}
          {selectedPlanet.surfaceMode === "none" ? " // SCAN MODE" : ""}
        </div>
      )}
      {phase === "atmosphere" && selectedPlanet && (
        <div className="travel-caption">
          ATMOSPHERIC ENTRY // {selectedPlanet.name}
        </div>
      )}
    </main>
  );
}
