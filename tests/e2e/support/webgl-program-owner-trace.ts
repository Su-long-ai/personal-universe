import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

// Diagnostic topic only. Read the validated Vite asset and place a conditional
// Chromium breakpoint immediately after Three has acquired a program for a
// material. The expression always returns false: no pause or bundle rewrite.
const acquire = "d=Fe.acquireProgram(s,c),";
const marker = acquire + "l.set(c,d),r.uniforms=s.uniforms";
const scope = "e.onBeforeCompile(s,E)," + marker;

type Stamp = {
  ms: number;
  phase: string | null;
  scale: number | null;
  sample: number | null;
};

type Program = { id: number; usedTimes: number; cacheKey: string };
type Renderer = { info: { programs?: Program[] } };
type Material = {
  id: number;
  type: string;
  addEventListener: (type: "dispose", callback: () => void) => void;
};
type SceneObject = {
  id: number;
  type: string;
  isScene?: boolean;
  parent?: SceneObject | null;
  geometry?: { attributes?: { position?: { count?: number } } };
};
type Parameters = {
  numDirLights?: number;
  numPointLights?: number;
  numSpotLights?: number;
  numHemiLights?: number;
  numRectAreaLights?: number;
  numDirLightShadows?: number;
};

export type OwnerTraceSnapshot = {
  stamp: Stamp;
  acquisitions: number;
  droppedAcquisitions: number;
  truncatedPrograms: number;
  programs: Array<{
    id: number;
    usedTimes: number;
    // Identity for the complete key, without dumping arbitrary shader source
    // or callback text from customProgramCacheKey().
    keyFingerprint: string;
    owners: Array<{
      materialId: number;
      materialType: string;
      materialGeneration: number;
      objectId: number;
      objectType: string;
      positionVertices: number | null;
      acquired: Stamp;
      disposed: Stamp | null;
      objectAlive: boolean;
      rootSceneId: number | null;
      lights: {
        directional: number;
        point: number;
        spot: number;
        hemisphere: number;
        rectangle: number;
        directionalShadows: number;
      };
    }>;
  }>;
};

type RecorderWindow = Window & {
  __puProgramOwnersRead?: () => OwnerTraceSnapshot;
  __puProgramOwnersAcquire?: (
    renderer: Renderer,
    material: Material,
    object: SceneObject,
    program: Program,
    parameters: Parameters,
  ) => void;
};

function installRecorder() {
  const win = window as RecorderWindow;
  const maxAcquisitions = 512;
  const maxPrograms = 96;
  type Lifetime = {
    id: number;
    type: string;
    generation: number;
    disposed: Stamp | null;
  };
  type Owner = {
    lifetime: Lifetime;
    object: WeakRef<SceneObject>;
    objectId: number;
    objectType: string;
    positionVertices: number | null;
    acquired: Stamp;
    lights: OwnerTraceSnapshot["programs"][number]["owners"][number]["lights"];
  };
  const lifetimes = new WeakMap<Material, { current: Lifetime }>();
  const owners = new Map<number, Owner[]>();
  const phases = new Set([
    "galaxy", "system", "approach", "planet", "orbit", "atmosphere",
    "surface", "returning",
  ]);
  let renderer: WeakRef<Renderer> | undefined;
  let acquisitions = 0;
  let droppedAcquisitions = 0;

  function stamp(): Stamp {
    const data = document.documentElement?.dataset;
    const phase = data?.universeNavigationPhase ?? "";
    const scale = Number(data?.universeScalePosition);
    const sample = Number(data?.universeWebglMetricSample);
    return {
      ms: Math.round(performance.now()),
      phase: phases.has(phase) ? phase : null,
      scale: Number.isFinite(scale) ? scale : null,
      sample: Number.isFinite(sample) ? sample : null,
    };
  }

  function label(type: string) {
    return /^[a-zA-Z0-9_]{1,40}$/.test(type) ? type : "unknown";
  }

  function fingerprint(key: string) {
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < key.length; i += 1) {
      a = Math.imul(a ^ key.charCodeAt(i), 0x01000193);
      b = Math.imul(b ^ key.charCodeAt(i), 0x85ebca6b);
    }
    return `${key.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
  }

  win.__puProgramOwnersAcquire = (current, material, object, program, params) => {
    acquisitions += 1;
    if (acquisitions > maxAcquisitions) {
      droppedAcquisitions += 1;
      return;
    }
    try {
      renderer ??= new WeakRef(current);
      let materialRecord = lifetimes.get(material);
      if (!materialRecord) {
        const ownerRecord = { current: {
          id: material.id,
          type: label(material.type),
          generation: 1,
          disposed: null,
        } as Lifetime };
        lifetimes.set(material, ownerRecord);
        material.addEventListener("dispose", () => {
          ownerRecord.current.disposed ??= stamp();
        });
        materialRecord = ownerRecord;
      } else if (materialRecord.current.disposed) {
        const old = materialRecord.current;
        materialRecord.current = {
          id: old.id, type: old.type, generation: old.generation + 1, disposed: null,
        };
      }
      const list = owners.get(program.id) ?? [];
      list.push({
        lifetime: materialRecord.current,
        object: new WeakRef(object),
        objectId: object.id,
        objectType: label(object.type),
        positionVertices: object.geometry?.attributes?.position?.count ?? null,
        acquired: stamp(),
        lights: {
          directional: params.numDirLights ?? 0,
          point: params.numPointLights ?? 0,
          spot: params.numSpotLights ?? 0,
          hemisphere: params.numHemiLights ?? 0,
          rectangle: params.numRectAreaLights ?? 0,
          directionalShadows: params.numDirLightShadows ?? 0,
        },
      });
      owners.set(program.id, list);
    } catch {
      // Observation failures must not interrupt the renderer or the guard.
      droppedAcquisitions += 1;
    }
  };
  win.__puProgramOwnersRead = () => {
    const live = renderer?.deref()?.info.programs ?? [];
    return {
      stamp: stamp(),
      acquisitions,
      droppedAcquisitions,
      truncatedPrograms: Math.max(0, live.length - maxPrograms),
      programs: live.slice(0, maxPrograms).map((program) => ({
        id: program.id,
        usedTimes: program.usedTimes,
        keyFingerprint: fingerprint(program.cacheKey),
        owners: (owners.get(program.id) ?? []).map((owner) => {
          const object = owner.object.deref();
          let rootSceneId: number | null = null;
          let parent = object;
          for (let depth = 0; parent && depth < 24; depth += 1) {
            if (parent.isScene) rootSceneId = parent.id;
            parent = parent.parent ?? undefined;
          }
          return {
            materialId: owner.lifetime.id,
            materialType: owner.lifetime.type,
            materialGeneration: owner.lifetime.generation,
            objectId: owner.objectId,
            objectType: owner.objectType,
            positionVertices: owner.positionVertices,
            acquired: owner.acquired,
            disposed: owner.lifetime.disposed,
            objectAlive: Boolean(object),
            rootSceneId,
            lights: owner.lights,
          };
        }),
      })),
    };
  };
}

export async function installWebglProgramOwnerTrace(page: Page) {
  const dir = join(process.cwd(), "dist", "_astro");
  try {
    const assets = (await readdir(dir)).filter((name) =>
      /^events-[\w-]+\.esm\.[\w-]+\.js$/.test(name),
    );
    if (assets.length !== 1) return { state: "unexpected-renderer-asset-count" };
    const asset = assets[0]!;
    const source = await readFile(join(dir, asset), "utf8");
    if (source.split(scope).length !== 2) return { state: "renderer-shape-mismatch" };
    const offset = source.indexOf(scope) + scope.indexOf(marker) + acquire.length;
    const prefix = source.slice(0, offset);
    const lineNumber = prefix.split("\n").length - 1;
    const columnNumber = prefix.length - prefix.lastIndexOf("\n") - 1;

    await page.addInitScript(installRecorder);
    const session = await page.context().newCDPSession(page);
    await session.send("Debugger.enable");
    await session.send("Debugger.setBreakpointByUrl", {
      urlRegex: "/_astro/" + asset.replaceAll(".", "\\.") + "$",
      lineNumber,
      columnNumber,
      condition: "(globalThis.__puProgramOwnersAcquire?.(E,e,n,d,s),false)",
    });
    return {
      state: "installed",
      asset,
      assetSha256: createHash("sha256").update(source).digest("hex"),
      lineNumber,
      columnNumber,
    };
  } catch {
    return { state: "setup-unavailable" };
  }
}
