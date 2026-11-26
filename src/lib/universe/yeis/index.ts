import { Vector3 } from "three";
import { Universe, type ExtraSystem } from "../../../vendor/yeis/core/Universe";
import { StarCatalog, type StarInfo } from "../../../vendor/yeis/data/StarCatalog";
import type { BodyData } from "../../../vendor/yeis/data/types";
import { AU_KM, J2000_JD } from "../../../vendor/yeis/core/constants";
import { generateSystem as generateYeisSystem } from "../../../vendor/yeis/gen/SystemGenerator";
import { initI18n } from "../../../vendor/yeis/i18n";

export const YEIS_UPSTREAM_COMMIT =
  "e52056897364e060fbd6d00951628f163b57d7a1";
export const YEIS_DATA_BASE_URL = `${import.meta.env.BASE_URL}vendor/yeis/`;
export const HERO_SYSTEM_ID = "h-aurora";
export const HERO_PLANET_ID = "aurora-01";

export { buildYeisGalaxyIndex, resolveYeisSystem } from "./bridge";

export type YeisCoreRuntime = {
  catalog: StarCatalog;
  universe: Universe;
  heroSystem: ReturnType<Universe["system"]>;
};

let runtimePromise: Promise<YeisCoreRuntime> | null = null;

export function loadYeisCore(): Promise<YeisCoreRuntime> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

async function createRuntime(): Promise<YeisCoreRuntime> {
  // Keep the native astronomy dictionary, but leave the document language to the host.
  await initI18n("en", { setDocumentLanguage: false });
  const catalog = await StarCatalog.load(YEIS_DATA_BASE_URL);
  const universe = new Universe(catalog);
  universe.registerExtraSystem(createAuroraSystem());

  const heroSystem = universe.system(HERO_SYSTEM_ID);
  heroSystem.update(J2000_JD, 0);

  return { catalog, universe, heroSystem };
}

function createAuroraSystem(): ExtraSystem {
  const info = createAuroraStarInfo();

  return {
    id: HERO_SYSTEM_ID,
    name: "AURORA SYSTEM",
    positionPc: info.position.clone(),
    galaxy: 0,
    info,
    bodies: () => createAuroraBodies(info),
  };
}

function createAuroraStarInfo(): StarInfo {
  return {
    index: -1,
    name: "HELION",
    names: null,
    hip: 0,
    position: new Vector3(11.5, 1.8, -4.2),
    distancePc: 12.38,
    mag: 4.6,
    absMag: 4.14,
    bv: 0.63,
    temperature: 5820,
    luminosity: 1.08,
    radiusSolar: 1.01,
    radiusKm: 702_657,
    massSolar: 1.03,
    massKg: 2.048e30,
    spectral: "G2V",
    lumClass: 5,
    catalogSpectral: "G2V",
    isWhiteDwarf: false,
  };
}

function createAuroraBodies(info: StarInfo): BodyData[] {
  const generated = generateYeisSystem(info);
  const planets = generated.bodies.filter(
    (body) => body.type === "planet" || body.type === "dwarf",
  );
  const target = planets.reduce<BodyData | undefined>((best, body) => {
    if (!best) return body;
    return orbitDistanceFromAurora(body) < orbitDistanceFromAurora(best)
      ? body
      : best;
  }, undefined);

  if (!target) {
    const star = generated.bodies.find((body) => body.type === "star");
    if (!star) throw new Error("YEIS generated HELION without a host star");
    return [...generated.bodies, createAuroraPlanet(star.id)];
  }

  return generated.bodies.flatMap((body) => {
    if (body.id === target.id) {
      return [createAuroraPlanet(target.parent ?? generated.bodies[0]!.id)];
    }
    if (body.parent === target.id) return [];
    return [body];
  });
}

function orbitDistanceFromAurora(body: BodyData): number {
  const orbit = body.orbit;
  if (!orbit) return Number.POSITIVE_INFINITY;
  const aKm = orbit.kind === "simple" ? orbit.a : orbit.a * AU_KM;
  return Math.abs(aKm / AU_KM - 1.08);
}

function createAuroraPlanet(parent: string): BodyData {
  return {
    id: HERO_PLANET_ID,
    name: "AURORA-01",
    type: "planet",
    parent,
    radius: 10_959,
    mass: 2.448e25,
    rotationPeriod: 28.4,
    tilt: 18,
    orbit: {
      kind: "simple",
      a: 161_565_700,
      e: 0.028,
      i: 2.1,
      node: 35,
      argPeri: 72,
      M0: 120,
      epoch: J2000_JD,
      period: 403.6,
      frame: "ecliptic",
    },
    appearance: {
      kind: "terrestrial",
      seed: 428041,
      ocean: [0.02, 0.16, 0.34],
      landLow: [0.12, 0.32, 0.22],
      landMid: [0.46, 0.4, 0.22],
      landHigh: [0.72, 0.69, 0.6],
      ice: [0.92, 0.97, 1],
      seaLevel: 0.58,
      iceCaps: 0.82,
      craters: 0.08,
      roughness: 1,
      variation: 0.55,
    },
    atmosphere: {
      color: [0.24, 0.58, 1],
      height: 0.032,
      density: 1.15,
      sunsetColor: [1, 0.45, 0.22],
    },
    clouds: {
      seed: 428042,
      color: [1, 1, 1],
      coverage: 0.54,
      height: 0.008,
      speed: 1.12,
      opacity: 0.86,
    },
    temperature: 286,
    description: "Personal Universe Hero override.",
    facts: {
      Mode: "Hero override",
      Source: "Personal Universe adapter",
    },
  };
}
