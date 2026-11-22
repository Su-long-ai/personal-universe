import type { GalaxyMarker, SystemDefinition } from "../types";
import type {
  UniverseContentKind,
  UniverseContentPlacement,
} from "../content";
import type { YeisCoreRuntime } from "./index";
import { markerForYeisStarId } from "./bridge";

const HERO_SYSTEM_ID = "h-aurora";
const HERO_PLANET_ID = "aurora-01";

export type UniverseNavigationKind =
  | "personal"
  | UniverseContentKind
  | "featured"
  | "hero"
  | "body"
  | "observed"
  | "star"
  | "blackhole"
  | "landmark"
  | "galaxy";

export type UniverseNavigationGroup =
  | "personal-signals"
  | "featured"
  | "projects"
  | "research"
  | "experience"
  | "artifacts"
  | "notes"
  | "hero"
  | "observed-hosts"
  | "bodies"
  | "stars"
  | "black-holes"
  | "deep-sky"
  | "galaxies";

export type UniverseNavigationTarget =
  | { kind: "star"; nativeId: string }
  | { kind: "marker"; markerId: string }
  | { kind: "body"; starId: string; bodyId: string; markerId?: string }
  | {
      kind: "content";
      nativeId: string;
      markerId: string;
      entryId: string;
    }
  | { kind: "blackhole"; id: string }
  | { kind: "galaxy"; index: number }
  | { kind: "landmark"; index: number };

export type UniverseNavigationCameraTarget =
  | { kind: "star"; nativeId: string }
  | { kind: "point"; id: string; positionPc: [number, number, number] }
  | { kind: "body"; starId: string; bodyId: string }
  | { kind: "blackhole"; id: string }
  | { kind: "galaxy"; index: number }
  | { kind: "landmark"; index: number };

export interface UniverseNavigationDestination {
  id: string;
  kind: UniverseNavigationKind;
  group: UniverseNavigationGroup;
  title: string;
  detail: string;
  target: UniverseNavigationTarget;
  markerId?: string;
  entryId?: string;
  keywords?: string[];
}

export interface UniverseNavigationSection {
  id: UniverseNavigationGroup;
  title: string;
  destinations: UniverseNavigationDestination[];
}

export interface UniverseNavigationCameraRequest {
  requestId: number;
  mode: "locate" | "travel";
  target: UniverseNavigationCameraTarget;
  title: string;
}

const GROUP_TITLES: Record<UniverseNavigationGroup, string> = {
  "personal-signals": "Personal Signals",
  featured: "Featured",
  projects: "Projects",
  research: "Research",
  experience: "Experience",
  artifacts: "Artifacts",
  notes: "Notes",
  hero: "Hero World",
  "observed-hosts": "Observed Exoplanet Hosts",
  bodies: "Planets & Bodies",
  stars: "Stars",
  "black-holes": "Black Holes",
  "deep-sky": "Nebulae, Clusters & Landmarks",
  galaxies: "Galaxies",
};

const SEARCH_GROUP_ORDER: UniverseNavigationGroup[] = [
  "personal-signals",
  "projects",
  "research",
  "experience",
  "artifacts",
  "notes",
  "hero",
  "observed-hosts",
  "bodies",
  "stars",
  "black-holes",
  "deep-sky",
  "galaxies",
  "featured",
];

const CONTENT_GROUP: Record<UniverseContentKind, UniverseNavigationGroup> = {
  project: "projects",
  research: "research",
  experience: "experience",
  artifact: "artifacts",
  note: "notes",
};

type CuratedRef = {
  label: string;
  ref: string;
  note?: string;
  fallbackRefs?: string[];
};

const CURATED_BODIES: CuratedRef[] = [
  ["Earth", "earth", "Home world"],
  ["Moon", "moon", "Earth's natural satellite"],
  ["Mars", "mars", "Rocky planet"],
  ["Jupiter", "jupiter", "Gas giant"],
  ["Europa", "europa", "Ocean moon"],
  ["Io", "io", "Volcanic moon"],
  ["Saturn", "saturn", "Ringed gas giant"],
  ["Titan", "titan", "Atmospheric moon"],
  ["Enceladus", "enceladus", "Icy plume world"],
  ["Uranus", "uranus", "Ice giant"],
  ["Neptune", "neptune", "Outer ice giant"],
  ["Triton", "triton", "Retrograde moon"],
  ["Pluto", "pluto", "Dwarf planet"],
  ["Sun", "sun", "Solar primary"],
  ["1P/Halley", "halley", "Periodic comet"],
  ["Voyager 1", "voyager1", "Interstellar spacecraft"],
  ["Voyager 2", "voyager2", "Interstellar spacecraft"],
  ["Pioneer 10", "pioneer10", "Outer-system spacecraft"],
  ["Pioneer 11", "pioneer11", "Outer-system spacecraft"],
  ["New Horizons", "newhorizons", "Kuiper Belt mission"],
  ["Parker Solar Probe", "parker", "Solar probe"],
  ["James Webb Space Telescope", "jwst", "Sun-Earth L2"],
  ["Hubble Space Telescope", "hubble", "Low Earth orbit"],
  ["International Space Station", "iss", "Low Earth orbit"],
  ["Juno", "juno", "Jupiter orbiter"],
  ["Perseverance", "perseverance", "Mars rover"],
  ["Curiosity", "curiosity", "Mars rover"],
].map(([label, ref, note]) => ({ label, ref, note }));

const CURATED_STARS: CuratedRef[] = [
  ["Proxima Centauri", "Proxima Centauri", "Nearest star to the Sun"],
  ["Alpha Centauri", "Rigil Kentaurus", "Nearby triple system"],
  ["Sirius", "Sirius", "Brightest night-sky star"],
  ["Vega", "Vega", ""],
  ["Betelgeuse", "Betelgeuse", "Red supergiant"],
  ["Rigel", "Rigel", "Blue supergiant"],
  ["Polaris", "Polaris", "North Star"],
  ["Aldebaran", "Aldebaran", ""],
  ["Antares", "Antares", ""],
  ["Deneb", "Deneb", "Distant luminous supergiant"],
].map(([label, ref, note]) => ({ label, ref, note }));

const CURATED_BLACK_HOLES: CuratedRef[] = [
  ["Sagittarius A*", "b0", "Milky Way central black hole"],
  ["Cygnus X-1", "cygx1", "Historic stellar black hole"],
  ["Gaia BH1", "b2", "Nearby dormant black hole"],
  ["V404 Cygni", "b3", "X-ray binary"],
  ["A0620-00", "b4", "Quiescent binary"],
  ["M87*", "b1", "Event Horizon Telescope target"],
  ["M31*", "m31star", "Andromeda central black hole"],
  ["LMC X-1", "lmcx1", "Large Magellanic Cloud"],
  ["M33 X-7", "m33x7", "Triangulum Galaxy"],
  ["Centaurus A*", "cenastar", "Nearby active nucleus"],
].map(([label, ref, note]) => ({ label, ref, note }));

const CURATED_LANDMARKS: CuratedRef[] = [
  ["Orion Nebula (M42)", "l-m42", "Stellar nursery"],
  ["Pleiades (M45)", "l-pleiades", "Open cluster"],
  ["Carina Nebula", "l-carina", "Massive star-forming region"],
  ["Crab Nebula (M1)", "l-m1", "Supernova remnant"],
  ["Omega Centauri", "l-omegacen", "Globular cluster"],
  ["Tarantula Nebula", "l-30dor", "Large Magellanic Cloud"],
  ["R136a1", "l-r136a1", "Extreme massive star"],
  ["SN 1987A", "l-sn1987a", "Supernova remnant"],
  ["Mayall II (G1)", "l-g1", "Andromeda globular cluster"],
  ["Hubble's V1 Cepheid", "l-m31v1", "Historic Andromeda variable"],
  ["NGC 604", "l-ngc604", "Triangulum star-forming region"],
  ["Crab Pulsar", "l-crabpsr", "Young pulsar"],
  ["Vela Pulsar", "l-vela", "Nearby pulsar"],
  ["PSR B1919+21", "l-b1919", "First discovered pulsar"],
  ["PSR B1257+12 (Lich)", "l-lich", "Historic pulsar planets"],
  ["PSR J1748-2446ad", "l-j1748", "Fast millisecond pulsar"],
  ["Hulse-Taylor Binary", "l-hulsetaylor", "Binary pulsar"],
  ["Geminga", "l-geminga", "Gamma-ray pulsar"],
  ["PSR J0437-4715", "l-j0437", "Nearby millisecond pulsar"],
  ["SGR 1806-20", "l-sgr1806", "Magnetar"],
].map(([label, ref, note]) => ({ label, ref, note }));

const CURATED_GALAXIES: CuratedRef[] = [
  { label: "Milky Way", ref: "#0", note: "Our home galaxy" },
  {
    label: "Large Magellanic Cloud",
    ref: "Büyük Macellan",
    fallbackRefs: ["Large Magellanic", "LMC"],
  },
  {
    label: "Small Magellanic Cloud",
    ref: "Küçük Macellan",
    fallbackRefs: ["Small Magellanic", "SMC"],
  },
  { label: "Andromeda Galaxy (M31)", ref: "Andromeda" },
  { label: "Triangulum Galaxy (M33)", ref: "M33", fallbackRefs: ["Üçgen", "Triangulum"] },
  { label: "Centaurus A", ref: "Centaurus A" },
  { label: "Whirlpool Galaxy (M51)", ref: "M51", fallbackRefs: ["Girdap"] },
  { label: "Pinwheel Galaxy (M101)", ref: "M101", fallbackRefs: ["Fırıldak"] },
  { label: "Sombrero Galaxy (M104)", ref: "M104", fallbackRefs: ["Sombrero"] },
  { label: "Virgo A (M87)", ref: "M87" },
  { label: "Antennae Galaxies", ref: "Antenler", fallbackRefs: ["Antennae"] },
];

const QUERY_ALIASES: Record<string, string> = {
  "太阳": "sun",
  "地球": "earth",
  "月球": "moon",
  "月亮": "moon",
  "火星": "mars",
  "木星": "jupiter",
  "土星": "saturn",
  "天王星": "uranus",
  "海王星": "neptune",
  "冥王星": "pluto",
  "天狼星": "sirius",
  "织女星": "vega",
  "織女星": "vega",
  "参宿四": "betelgeuse",
  "參宿四": "betelgeuse",
  "北极星": "polaris",
  "北極星": "polaris",
  "比邻星": "proxima centauri",
  "比鄰星": "proxima centauri",
  "银河系": "milky way",
  "銀河系": "milky way",
  "仙女座": "andromeda",
  "仙女座星系": "andromeda",
  "猎户座大星云": "orion nebula m42",
  "獵戶座大星雲": "orion nebula m42",
  "猎户星云": "orion nebula m42",
  "獵戶星雲": "orion nebula m42",
  "昴星团": "pleiades",
  "昴星團": "pleiades",
  "蟹状星云": "crab nebula m1",
  "蟹狀星雲": "crab nebula m1",
  "人马座a*": "sagittarius a*",
  "人馬座a*": "sagittarius a*",
};

export async function loadUniverseNavigation(
  query: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
  currentSystem: SystemDefinition | null = null,
): Promise<UniverseNavigationDestination[]> {
  const [{ loadYeisCore }, { normalizeQuery }] = await Promise.all([
    import("./index"),
    import("../../../vendor/yeis/core/Universe"),
  ]);
  const runtime = await loadYeisCore();
  if (!query.trim()) {
    return dedupe(
      buildPlaces(runtime, placements, markers).flatMap(
        (section) => section.destinations,
      ),
    ).slice(0, 80);
  }
  return searchDestinations(
    runtime,
    query,
    placements,
    markers,
    currentSystem,
    normalizeQuery,
  );
}

export async function loadUniversePlaces(
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): Promise<UniverseNavigationSection[]> {
  const { loadYeisCore } = await import("./index");
  return buildPlaces(await loadYeisCore(), placements, markers);
}

export function navigationSectionsForResults(
  destinations: UniverseNavigationDestination[],
): UniverseNavigationSection[] {
  const grouped = new Map<
    UniverseNavigationGroup,
    UniverseNavigationDestination[]
  >();
  for (const destination of destinations) {
    const list = grouped.get(destination.group) ?? [];
    list.push(destination);
    grouped.set(destination.group, list);
  }
  return SEARCH_GROUP_ORDER.flatMap((id) => {
    const destinations = grouped.get(id);
    return destinations?.length
      ? [{ id, title: GROUP_TITLES[id], destinations }]
      : [];
  });
}

export function navigationDestinationForPlacement(
  placement: UniverseContentPlacement,
  markers: GalaxyMarker[],
): UniverseNavigationDestination | null {
  const marker = markers.find((candidate) => candidate.id === placement.markerId);
  const nativeId = placement.nativeId ?? marker?.nativeId;
  if (!nativeId) return null;
  return {
    id: "personal:" + placement.entry.id,
    kind: "personal",
    group: "personal-signals",
    title: placement.entry.title,
    detail:
      placement.entry.kind.toUpperCase() +
      " · " +
      (marker?.name ?? nativeId),
    target: {
      kind: "content",
      nativeId,
      markerId: placement.markerId,
      entryId: placement.entry.id,
    },
    markerId: placement.markerId,
    entryId: placement.entry.id,
    keywords: [
      placement.entry.summary,
      ...placement.entry.tags,
      placement.entry.kind,
      placement.entry.status,
      marker?.name ?? "",
    ],
  };
}

export function navigationDestinationForMarker(
  marker: GalaxyMarker,
  placements: UniverseContentPlacement[] = [],
): UniverseNavigationDestination {
  if (marker.source === "hero" && marker.nativeId) {
    return heroDestination(marker);
  }

  if (marker.engine === "v2" && marker.source === "catalog") {
    return observedDestination(marker);
  }

  const placement = placements.find(
    (candidate) => candidate.markerId === marker.id,
  );
  if (placement) {
    const personal = navigationDestinationForPlacement(placement, [marker]);
    if (personal) return personal;
  }

  if (marker.nativeId) {
    return {
      id: "star:" + marker.nativeId,
      kind: "star",
      group: "stars",
      title: marker.name,
      detail: (marker.spectralType || "STAR") + " · YEIS SYSTEM",
      target: { kind: "star", nativeId: marker.nativeId },
      markerId: marker.id,
      keywords: markerKeywords(marker),
    };
  }

  return observedDestination(marker);
}

export function navigationDestinationForGalaxy(
  runtime: YeisCoreRuntime,
  index: number,
): UniverseNavigationDestination {
  return galaxyDestination(runtime, index);
}

export function navigationDestinationForLandmark(
  runtime: YeisCoreRuntime,
  index: number,
): UniverseNavigationDestination {
  return landmarkDestination(runtime, index);
}

export async function navigationMarker(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): Promise<GalaxyMarker> {
  if (destination.target.kind === "marker") {
    const marker = markers.find(
      (candidate) => candidate.id === destination.target.markerId,
    );
    if (!marker) {
      throw new Error(
        `Unknown navigation marker: ${destination.target.markerId}`,
      );
    }
    return marker;
  }

  const nativeId = systemNativeId(destination.target);
  if (!nativeId) {
    throw new Error(
      `Navigation target ${destination.id} is spatial, not a system target`,
    );
  }

  const { loadYeisCore } = await import("./index");
  const runtime = await loadYeisCore();
  const targetMarkerId =
    destination.markerId ??
    (destination.target.kind === "body"
      ? destination.target.markerId
      : destination.target.kind === "content"
        ? destination.target.markerId
        : undefined);
  return (
    (targetMarkerId
      ? markers.find((marker) => marker.id === targetMarkerId)
      : undefined) ??
    markers.find((marker) => marker.nativeId === nativeId) ??
    markerForYeisStarId(runtime, markers, nativeId)
  );
}

export function navigationCameraTarget(
  destination: UniverseNavigationDestination,
  markers: GalaxyMarker[],
): UniverseNavigationCameraTarget | null {
  const target = destination.target;
  if (
    target.kind === "galaxy" ||
    target.kind === "landmark" ||
    target.kind === "blackhole"
  ) {
    return target;
  }
  if (target.kind === "star") return target;
  if (target.kind === "body") {
    return {
      kind: "body",
      starId: target.starId,
      bodyId: target.bodyId,
    };
  }
  if (target.kind === "content") {
    return { kind: "star", nativeId: target.nativeId };
  }

  const marker = markers.find((candidate) => candidate.id === target.markerId);
  if (!marker) return null;
  if (marker.nativeId) {
    return { kind: "star", nativeId: marker.nativeId };
  }
  if (marker.physicalPositionPc) {
    return {
      kind: "point",
      id: marker.id,
      positionPc: marker.physicalPositionPc,
    };
  }
  return null;
}

export async function resolveUniverseNavigationDestination(
  id: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): Promise<UniverseNavigationDestination | null> {
  const key = id.trim();
  if (!key) return null;

  if (key.startsWith("personal:")) {
    const entryId = key.slice("personal:".length);
    const placement = placements.find(
      (candidate) => candidate.entry.id === entryId,
    );
    return placement
      ? navigationDestinationForPlacement(placement, markers)
      : null;
  }

  if (key === "hero" || key === "hero:" + HERO_PLANET_ID) {
    const marker = markers.find((candidate) => candidate.source === "hero");
    return marker ? heroDestination(marker) : null;
  }

  if (key.startsWith("observed:")) {
    const marker = markers.find(
      (candidate) => candidate.id === key.slice("observed:".length),
    );
    return marker ? navigationDestinationForMarker(marker, placements) : null;
  }

  if (key.startsWith("star:")) {
    const nativeId = key.slice("star:".length);
    if (!nativeId) return null;
    const marker = markers.find((candidate) => candidate.nativeId === nativeId);
    if (marker) return navigationDestinationForMarker(marker, placements);
    const { loadYeisCore } = await import("./index");
    const runtime = await loadYeisCore();
    return {
      id: key,
      kind: "star",
      group: "stars",
      title: runtime.universe.starName(nativeId),
      detail: "STAR · YEIS SYSTEM",
      target: { kind: "star", nativeId },
    };
  }

  if (key.startsWith("body:")) {
    const payload = key.slice("body:".length);
    const slash = payload.indexOf("/");
    if (slash <= 0 || slash >= payload.length - 1) return null;
    const starId = payload.slice(0, slash);
    const bodyId = payload.slice(slash + 1);
    const { loadYeisCore } = await import("./index");
    const runtime = await loadYeisCore();
    const nativeSystem = runtime.universe.system(starId);
    nativeSystem.update(2451545.0, 0);
    const nativeBody = nativeSystem.get(bodyId);
    if (!nativeBody) return null;
    const marker = markers.find((candidate) => candidate.nativeId === starId);
    return {
      id: key,
      kind: "body",
      group: "bodies",
      title: nativeBody.name,
      detail:
        nativeBody.data.type.toUpperCase() +
        " · " +
        (marker?.name ?? runtime.universe.starName(starId)),
      target: {
        kind: "body",
        starId,
        bodyId,
        markerId: marker?.id,
      },
      markerId: marker?.id,
      keywords: [nativeBody.data.name, nativeBody.data.type],
    };
  }

  const { loadYeisCore } = await import("./index");
  const runtime = await loadYeisCore();

  if (key.startsWith("landmark:")) {
    const landmarkId = key.slice("landmark:".length);
    const index = runtime.universe.landmarks.findIndex(
      (candidate) => candidate.def.id === landmarkId,
    );
    return index >= 0 ? landmarkDestination(runtime, index) : null;
  }

  if (key.startsWith("galaxy:")) {
    const index = Number(key.slice("galaxy:".length));
    return Number.isInteger(index) &&
      index >= 0 &&
      index < runtime.universe.galaxies.count
      ? galaxyDestination(runtime, index)
      : null;
  }

  if (key.startsWith("blackhole:")) {
    const blackHole = runtime.universe.blackHole(
      key.slice("blackhole:".length),
    );
    return blackHole ? blackHoleDestination(blackHole) : null;
  }

  return null;
}

function buildPlaces(
  runtime: YeisCoreRuntime,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationSection[] {
  const sections: UniverseNavigationSection[] = [];
  const personal = personalDestinations(placements, markers);
  if (personal.length) sections.push(section("personal-signals", personal));

  const featured = dedupe(
    [
      ...personal.filter((destination) =>
        placements.some(
          (placement) =>
            placement.entry.id === destination.entryId &&
            placement.entry.featured,
        ),
      ),
      markers.find((marker) => marker.source === "hero")
        ? heroDestination(markers.find((marker) => marker.source === "hero")!)
        : null,
      ...curatedStars(runtime, CURATED_STARS.slice(0, 3), "featured"),
      ...curatedBlackHoles(
        runtime,
        CURATED_BLACK_HOLES.slice(0, 1),
        "featured",
      ),
      ...curatedLandmarks(
        runtime,
        CURATED_LANDMARKS.slice(0, 3),
        "featured",
      ),
      ...curatedGalaxies(
        runtime,
        CURATED_GALAXIES.slice(0, 2),
        "featured",
      ),
    ].filter(
      (value): value is UniverseNavigationDestination => Boolean(value),
    ),
  );
  if (featured.length) sections.push(section("featured", featured));

  for (const kind of [
    "project",
    "research",
    "experience",
    "artifact",
    "note",
  ] as UniverseContentKind[]) {
    const destinations = personal
      .filter((destination) =>
        placements.some(
          (placement) =>
            placement.entry.id === destination.entryId &&
            placement.entry.kind === kind,
        ),
      )
      .map((destination) => ({
        ...destination,
        kind,
        group: CONTENT_GROUP[kind],
      }));
    if (destinations.length) {
      sections.push(section(CONTENT_GROUP[kind], destinations));
    }
  }

  const observed = observedDestinations(markers).slice(0, 16);
  if (observed.length) sections.push(section("observed-hosts", observed));

  const bodies = curatedBodies(runtime);
  if (bodies.length) sections.push(section("bodies", bodies));

  const stars = curatedStars(runtime, CURATED_STARS, "star");
  if (stars.length) sections.push(section("stars", stars));

  const blackHoles = curatedBlackHoles(
    runtime,
    CURATED_BLACK_HOLES,
    "blackhole",
  );
  if (blackHoles.length) sections.push(section("black-holes", blackHoles));

  const deepSky = curatedLandmarks(
    runtime,
    CURATED_LANDMARKS,
    "landmark",
  );
  if (deepSky.length) sections.push(section("deep-sky", deepSky));

  const galaxies = curatedGalaxies(runtime, CURATED_GALAXIES, "galaxy");
  if (galaxies.length) sections.push(section("galaxies", galaxies));

  return sections;
}

function searchDestinations(
  runtime: YeisCoreRuntime,
  rawQuery: string,
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
  currentSystem: SystemDefinition | null,
  normalize: (value: string) => string,
): UniverseNavigationDestination[] {
  const queries = queryVariants(rawQuery, normalize);
  const out: UniverseNavigationDestination[] = [];

  for (const destination of personalDestinations(placements, markers)) {
    const placement = placements.find(
      (candidate) => candidate.entry.id === destination.entryId,
    );
    if (!placement) continue;
    const haystack = normalize(
      [
        placement.entry.title,
        placement.entry.summary,
        placement.entry.kind,
        placement.entry.status,
        ...placement.entry.tags,
        destination.detail,
        ...(destination.keywords ?? []),
      ].join(" "),
    );
    if (matchesAny(haystack, queries)) {
      out.push({
        ...destination,
        kind: placement.entry.kind,
        group: CONTENT_GROUP[placement.entry.kind],
      });
    }
  }

  const heroMarker = markers.find((marker) => marker.source === "hero");
  if (
    heroMarker &&
    matchesAny(
      normalize("AURORA AURORA-01 HELION HERO WORLD HOME PERSONAL UNIVERSE"),
      queries,
    )
  ) {
    out.push(heroDestination(heroMarker));
  }

  for (const destination of observedDestinations(markers)) {
    const haystack = normalize(
      [destination.title, destination.detail, ...(destination.keywords ?? [])].join(
        " ",
      ),
    );
    if (matchesAny(haystack, queries)) out.push(destination);
  }

  if (currentSystem) {
    const currentStarId = currentSystem.id.startsWith("yeis-system:")
      ? currentSystem.id.slice("yeis-system:".length)
      : null;
    if (currentStarId) {
      for (const planet of currentSystem.planets) {
        const haystack = normalize(
          [
            planet.name,
            planet.id,
            planet.archetype,
            ...(planet.content?.flatMap((entry) => [
              entry.title,
              entry.summary,
              ...entry.tags,
            ]) ?? []),
          ].join(" "),
        );
        if (!matchesAny(haystack, queries)) continue;
        out.push({
          id: `body:${currentStarId}/${planet.id}`,
          kind: "body",
          group: "bodies",
          title: planet.name,
          detail: "CURRENT SYSTEM · " + currentSystem.name,
          target: {
            kind: "body",
            starId: currentStarId,
            bodyId: planet.id,
          },
          keywords: [planet.archetype, currentSystem.name],
        });
      }
    }
  }

  for (const body of runtime.universe.bodies) {
    const haystack = normalize(
      [body.name, body.data.name, body.id, body.data.type].join(" "),
    );
    if (!matchesAny(haystack, queries)) continue;
    out.push({
      id: `body:${runtime.universe.current.starId}/${body.id}`,
      kind: "body",
      group: "bodies",
      title: body.name,
      detail:
        body.data.type.toUpperCase() +
        " · " +
        runtime.universe.starName(runtime.universe.current.starId),
      target: {
        kind: "body",
        starId: runtime.universe.current.starId,
        bodyId: body.id,
      },
      keywords: [body.data.name, body.data.type],
    });
  }

  for (const query of queries) {
    for (const foreign of runtime.universe.searchForeignBodies(query, 10)) {
      out.push({
        id: `body:${foreign.starId}/${foreign.body.id}`,
        kind: "body",
        group: "bodies",
        title: foreign.name,
        detail:
          foreign.body.type.toUpperCase() + " · " + foreign.systemName,
        target: {
          kind: "body",
          starId: foreign.starId,
          bodyId: foreign.body.id,
        },
        keywords: [foreign.body.name, foreign.body.type, foreign.systemName],
      });
    }
  }

  for (const query of queries) {
    for (const index of runtime.catalog.search(query, 12)) {
      const nativeId = "c" + index;
      const info = runtime.catalog.info(index);
      out.push({
        id: "star:" + nativeId,
        kind: "star",
        group: "stars",
        title: info.name,
        detail:
          (info.catalogSpectral || info.spectral || "STAR") +
          " · " +
          formatDistanceLy(info.distancePc),
        target: { kind: "star", nativeId },
        keywords: [
          info.names?.proper ?? "",
          info.names?.bayer ?? "",
          info.names?.gliese ?? "",
        ],
      });
    }
  }

  for (const query of queries) {
    for (const blackHole of runtime.universe.searchBlackHoles(query, 8)) {
      out.push(blackHoleDestination(blackHole));
    }
    for (const index of runtime.universe.searchLandmarks(query, 10)) {
      out.push(landmarkDestination(runtime, index));
    }
    for (const index of runtime.universe.galaxies.search(query, 10)) {
      out.push(galaxyDestination(runtime, index));
    }
  }

  return dedupe(out).slice(0, 80);
}

function personalDestinations(
  placements: UniverseContentPlacement[],
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  return placements.flatMap((placement) => {
    const destination = navigationDestinationForPlacement(placement, markers);
    return destination ? [destination] : [];
  });
}

function observedDestinations(
  markers: GalaxyMarker[],
): UniverseNavigationDestination[] {
  return markers
    .filter(
      (marker) =>
        marker.source === "catalog" &&
        marker.engine === "v2",
    )
    .map(observedDestination);
}

function observedDestination(
  marker: GalaxyMarker,
): UniverseNavigationDestination {
  const distancePc = marker.physicalPositionPc
    ? Math.hypot(...marker.physicalPositionPc)
    : null;
  return {
    id: "observed:" + marker.id,
    kind: "observed",
    group: "observed-hosts",
    title: marker.name,
    detail:
      "OBSERVED HOST · " +
      (distancePc !== null
        ? formatDistanceLy(distancePc)
        : "NASA EXOPLANET ARCHIVE"),
    target: marker.nativeId
      ? { kind: "star", nativeId: marker.nativeId }
      : { kind: "marker", markerId: marker.id },
    markerId: marker.id,
    keywords: markerKeywords(marker),
  };
}

function heroDestination(
  marker: GalaxyMarker,
): UniverseNavigationDestination {
  return {
    id: "hero:" + HERO_PLANET_ID,
    kind: "hero",
    group: "hero",
    title: "AURORA-01",
    detail: "HERO WORLD · HELION SYSTEM",
    target: {
      kind: "body",
      starId: marker.nativeId ?? HERO_SYSTEM_ID,
      bodyId: HERO_PLANET_ID,
      markerId: marker.id,
    },
    markerId: marker.id,
    keywords: ["aurora", "helion", "hero", "home", HERO_SYSTEM_ID],
  };
}

function curatedBodies(
  runtime: YeisCoreRuntime,
): UniverseNavigationDestination[] {
  const solar = runtime.universe.system("c0");
  solar.update(2451545.0, 0);
  const byId = new Map(solar.bodies.map((body) => [body.id, body]));

  return CURATED_BODIES.flatMap((place) => {
    const body = byId.get(place.ref);
    if (!body) return [];
    return [{
      id: "body:c0/" + body.id,
      kind: "body" as const,
      group: "bodies" as const,
      title: place.label,
      detail:
        (place.note ? place.note.toUpperCase() + " · " : "") +
        body.data.type.toUpperCase(),
      target: { kind: "body" as const, starId: "c0", bodyId: body.id },
      keywords: [body.name, body.data.name, place.note ?? ""],
    }];
  });
}

function curatedStars(
  runtime: YeisCoreRuntime,
  refs: CuratedRef[],
  kind: "star" | "featured",
): UniverseNavigationDestination[] {
  return refs.flatMap((place) => {
    const index = runtime.catalog.search(place.ref, 1)[0];
    if (index === undefined) return [];
    const info = runtime.catalog.info(index);
    const nativeId = "c" + index;
    return [{
      id: (kind === "featured" ? "featured:star:" : "star:") + nativeId,
      kind,
      group: kind === "featured" ? "featured" as const : "stars" as const,
      title: place.label,
      detail:
        (place.note ? place.note.toUpperCase() + " · " : "") +
        formatDistanceLy(info.distancePc),
      target: { kind: "star" as const, nativeId },
      keywords: [
        info.name,
        info.names?.proper ?? "",
        info.names?.bayer ?? "",
        place.note ?? "",
      ],
    }];
  });
}

function curatedBlackHoles(
  runtime: YeisCoreRuntime,
  refs: CuratedRef[],
  kind: "blackhole" | "featured",
): UniverseNavigationDestination[] {
  return refs.flatMap((place) => {
    const blackHole = runtime.universe.blackHole(place.ref);
    if (!blackHole) return [];
    const destination = blackHoleDestination(blackHole);
    return [{
      ...destination,
      id:
        kind === "featured"
          ? "featured:blackhole:" + place.ref
          : destination.id,
      kind,
      group: kind === "featured" ? "featured" as const : "black-holes" as const,
      title: place.label,
      detail:
        (place.note ? place.note.toUpperCase() + " · " : "") +
        "BLACK HOLE",
    }];
  });
}

function curatedLandmarks(
  runtime: YeisCoreRuntime,
  refs: CuratedRef[],
  kind: "landmark" | "featured",
): UniverseNavigationDestination[] {
  return refs.flatMap((place) => {
    const index = runtime.universe.landmarks.findIndex(
      (landmark) => landmark.def.id === place.ref,
    );
    if (index < 0) return [];
    const destination = landmarkDestination(
      runtime,
      index,
      place.label,
      place.note,
    );
    if (kind === "featured") {
      destination.id = "featured:landmark:" + place.ref;
      destination.kind = "featured";
      destination.group = "featured";
    }
    return [destination];
  });
}

function curatedGalaxies(
  runtime: YeisCoreRuntime,
  refs: CuratedRef[],
  kind: "galaxy" | "featured",
): UniverseNavigationDestination[] {
  return refs.flatMap((place) => {
    const index = resolveGalaxyRef(runtime, place);
    if (index === null) return [];
    const destination = galaxyDestination(
      runtime,
      index,
      place.label,
      place.note,
    );
    if (kind === "featured") {
      destination.id = "featured:galaxy:" + index;
      destination.kind = "featured";
      destination.group = "featured";
    }
    return [destination];
  });
}

function resolveGalaxyRef(
  runtime: YeisCoreRuntime,
  place: CuratedRef,
): number | null {
  if (place.ref.startsWith("#")) {
    const index = Number(place.ref.slice(1));
    return Number.isInteger(index) ? index : null;
  }
  for (const query of [place.ref, ...(place.fallbackRefs ?? [])]) {
    const index = runtime.universe.galaxies.search(query, 1)[0];
    if (index !== undefined) return index;
  }
  return null;
}

type NavigationBlackHole = YeisCoreRuntime["universe"]["blackHoles"][number];

function blackHoleDestination(
  blackHole: NavigationBlackHole,
): UniverseNavigationDestination {
  return {
    id: "blackhole:" + blackHole.entry.id,
    kind: "blackhole",
    group: "black-holes",
    title: blackHole.entry.name,
    detail: "BLACK HOLE · YEIS PLACE",
    target: { kind: "blackhole", id: blackHole.entry.id },
    keywords: [
      blackHole.entry.summary,
      blackHole.entry.id,
      blackHole.systemStarId,
    ],
  };
}

function galaxyDestination(
  runtime: YeisCoreRuntime,
  index: number,
  title?: string,
  note?: string,
): UniverseNavigationDestination {
  const galaxies = runtime.universe.galaxies;
  const distancePc = Math.hypot(
    galaxies.positions[index * 3],
    galaxies.positions[index * 3 + 1],
    galaxies.positions[index * 3 + 2],
  );
  return {
    id: "galaxy:" + index,
    kind: "galaxy",
    group: "galaxies",
    title: title ?? galaxies.name(index),
    detail:
      note?.toUpperCase() ??
      ("GALAXY · " +
        (index === 0 ? "HOME" : formatDistanceLy(distancePc))),
    target: { kind: "galaxy", index },
    keywords: [galaxies.name(index), note ?? ""],
  };
}

function landmarkDestination(
  runtime: YeisCoreRuntime,
  index: number,
  title?: string,
  note?: string,
): UniverseNavigationDestination {
  const landmark = runtime.universe.landmarks[index];
  return {
    id: "landmark:" + landmark.def.id,
    kind: "landmark",
    group: "deep-sky",
    title: title ?? landmark.def.name,
    detail:
      (note ? note.toUpperCase() + " · " : "") +
      landmark.def.kind.toUpperCase() +
      " · " +
      (landmark.systemId ? "STELLAR LANDMARK" : "DEEP-SKY PLACE"),
    target: landmark.systemId
      ? { kind: "star", nativeId: landmark.systemId }
      : { kind: "landmark", index },
    keywords: [
      landmark.def.name,
      landmark.def.id,
      runtime.universe.galaxies.name(landmark.galaxy),
      landmark.def.kind,
    ],
  };
}

function section(
  id: UniverseNavigationGroup,
  destinations: UniverseNavigationDestination[],
): UniverseNavigationSection {
  return { id, title: GROUP_TITLES[id], destinations };
}

function markerKeywords(marker: GalaxyMarker): string[] {
  return [
    marker.name,
    marker.catalogId ?? "",
    marker.catalogIdentity?.hipName ?? "",
    marker.catalogIdentity?.hdName ?? "",
    marker.catalogIdentity?.gaiaDr3Id ?? "",
    marker.catalogIdentity?.hip ? "HIP " + marker.catalogIdentity.hip : "",
    marker.spectralType,
  ];
}

function systemNativeId(
  target: UniverseNavigationTarget,
): string | null {
  if (target.kind === "star") return target.nativeId;
  if (target.kind === "body") return target.starId;
  if (target.kind === "content") return target.nativeId;
  return null;
}

function dedupe(
  destinations: UniverseNavigationDestination[],
): UniverseNavigationDestination[] {
  const ids = new Set<string>();
  const systemTargets = new Set<string>();
  return destinations.filter((destination) => {
    if (ids.has(destination.id)) return false;
    const target = targetKey(destination.target);
    const onePerSystem =
      destination.target.kind === "star" ||
      destination.target.kind === "marker";
    if (onePerSystem && systemTargets.has(target)) return false;
    ids.add(destination.id);
    if (onePerSystem) systemTargets.add(target);
    return true;
  });
}

function targetKey(target: UniverseNavigationTarget): string {
  if (target.kind === "star") return "star:" + target.nativeId;
  if (target.kind === "marker") return "marker:" + target.markerId;
  if (target.kind === "body") return `body:${target.starId}/${target.bodyId}`;
  if (target.kind === "content") return "content:" + target.entryId;
  if (target.kind === "blackhole") return "blackhole:" + target.id;
  return target.kind + ":" + target.index;
}

function queryVariants(
  rawQuery: string,
  normalize: (value: string) => string,
): string[] {
  const normalized = normalize(rawQuery);
  const values = new Set<string>(normalized ? [normalized] : []);
  const rawLower = rawQuery.trim().toLowerCase();
  for (const [alias, canonical] of Object.entries(QUERY_ALIASES)) {
    if (
      rawLower === alias.toLowerCase() ||
      normalized === normalize(alias)
    ) {
      values.add(normalize(canonical));
    }
  }
  return [...values].filter(Boolean);
}

function matchesAny(haystack: string, queries: string[]): boolean {
  return queries.some((query) => haystack.includes(query));
}

function formatDistanceLy(distancePc: number): string {
  const ly = distancePc * 3.26156;
  if (ly < 100) return ly.toFixed(1) + " LY";
  if (ly < 10_000) return ly.toFixed(0) + " LY";
  if (ly < 1_000_000) return (ly / 1000).toFixed(1) + " KLY";
  return (ly / 1_000_000).toFixed(2) + " MLY";
}
