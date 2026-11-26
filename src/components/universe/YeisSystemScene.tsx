import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  SYSTEM_OVERVIEW_RADIUS,
  type PlanetDefinition,
  type QualityMode,
  type SystemDefinition,
  type UniversePhase,
} from "../../lib/universe/types";
import { loadYeisCore } from "../../lib/universe/yeis";
import { J2000_JD } from "../../vendor/yeis/core/constants";
import { StarSystem } from "../../vendor/yeis/core/StarSystem";
import type { CelestialBody } from "../../vendor/yeis/core/CelestialBody";
import type {
  BodyData,
  OrbitElements,
  SimpleElements,
} from "../../vendor/yeis/data/types";
import { starLightColor } from "../../vendor/yeis/astro/stellar";
import { productSystemScale } from "../../lib/universe/yeis/systemScale";
import { BodyRenderer } from "../../vendor/yeis/render/BodyRenderer";
import { BodyPoints } from "../../vendor/yeis/render/BodyPoints";
import { OrbitLines } from "../../vendor/yeis/render/OrbitLines";
import {
  SystemScene,
  useSystemScaleFocusSource,
  type SystemScaleFocusSource,
  type SystemScaleFrame,
} from "./SystemScene";
import { LifecycleStars } from "./LifecycleStars";

const HIT_RADIUS = 0.34;
let nativeSystemInstanceSequence = 0;

type NativeResources = {
  instance: string;
  system: StarSystem;
  scene: THREE.Scene;
  bodies: BodyRenderer;
  points: BodyPoints;
  orbits: OrbitLines;
  luminosity: number;
  sunColor: THREE.Vector3;
};

type ProductTargetResources = {
  hitGeometry: THREE.SphereGeometry;
  haloGeometry: THREE.SphereGeometry;
  hitMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
};

function nativeStarId(system: SystemDefinition) {
  return system.id.startsWith("yeis-system:")
    ? system.id.slice("yeis-system:".length)
    : null;
}

function nativePlanetId(planet: PlanetDefinition) {
  return planet.id.startsWith("yeis-planet:")
    ? planet.id.slice("yeis-planet:".length)
    : planet.id;
}

function scaledOrbit(body: CelestialBody, scale: number): OrbitElements | undefined {
  const orbit = body.data.orbit;
  if (!orbit) return undefined;

  if (body.resolved && (orbit.kind === "jpl" || orbit.kind === "simple")) {
    const resolved = body.resolved;
    const simple: SimpleElements = {
      kind: "simple",
      a: resolved.a * scale,
      e: resolved.e,
      i: THREE.MathUtils.radToDeg(resolved.i),
      node: THREE.MathUtils.radToDeg(resolved.node),
      argPeri: THREE.MathUtils.radToDeg(resolved.argPeri),
      M0: THREE.MathUtils.radToDeg(resolved.M),
      epoch: J2000_JD,
      period: Math.max(body.periodDays, 1e-4),
      frame: orbit.kind === "simple" ? orbit.frame : "ecliptic",
      ...(orbit.kind === "simple" && orbit.nodeRate !== undefined
        ? { nodeRate: orbit.nodeRate }
        : {}),
      ...(orbit.kind === "simple" && orbit.periRate !== undefined
        ? { periRate: orbit.periRate }
        : {}),
    };
    return simple;
  }

  if (orbit.kind === "linear") {
    return {
      ...orbit,
      pos: orbit.pos.map((value) => value * scale) as [number, number, number],
      vel: orbit.vel.map((value) => value * scale) as [number, number, number],
    };
  }

  if (orbit.kind === "surface") {
    return {
      ...orbit,
      ...(orbit.alt !== undefined ? { alt: orbit.alt * scale } : {}),
    };
  }

  if (orbit.kind === "lagrange") {
    return { ...orbit, distance: orbit.distance * scale };
  }

  return undefined;
}

function scaledBody(body: CelestialBody, scale: number): BodyData {
  const data = body.data;
  return {
    ...data,
    radius: data.radius * scale,
    mass: data.mass * scale * scale * scale,
    orbit: scaledOrbit(body, scale),
    rings: data.rings
      ? {
          ...data.rings,
          inner: data.rings.inner * scale,
          outer: data.rings.outer * scale,
          gaps: data.rings.gaps?.map(
            ([radius, width]) => [radius * scale, width * scale] as [number, number],
          ),
        }
      : undefined,
  };
}

function createRenderSystem(source: StarSystem) {
  source.update(J2000_JD, 0);
  const scale = productSystemScale(source);
  const retained = source.bodies.filter(
    (body) =>
      body.data.type !== "spacecraft" &&
      body.data.orbit?.kind !== "trajectory",
  );
  const ids = new Set(retained.map((body) => body.id));
  const catalogue = retained
    .filter((body) => !body.parent || ids.has(body.parent.id))
    .map((body) => scaledBody(body, scale));
  const renderSystem = new StarSystem(
    `${source.id}:product-render`,
    source.starId,
    source.catalogIndex,
    new THREE.Vector3(),
    catalogue,
    [],
    source.planetIds.filter((id) => ids.has(id)),
  );
  renderSystem.update(J2000_JD, 0);
  return { renderSystem, scale };
}

function disposeResources(resources: NativeResources) {
  resources.bodies.dispose();
  resources.points.dispose();
  resources.orbits.dispose();
  resources.scene.clear();

}

function ProductPlanetTarget({
  planet,
  resources,
  targetResources,
  onSelect,
}: {
  planet: PlanetDefinition;
  resources: NativeResources;
  targetResources: ProductTargetResources;
  onSelect: (planet: PlanetDefinition) => void;
}) {
  const hit = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const nativeId = nativePlanetId(planet);
  const body = resources.system.get(nativeId);
  const hasContent = Boolean(planet.content?.length);

  useFrame((state) => {
    if (!body) return;
    hit.current?.position.copy(body.position);
    if (halo.current) {
      halo.current.position.copy(body.position);
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.8) * 0.08;
      halo.current.scale.setScalar(pulse);
    }
  });

  if (!body) return null;

  return (
    <>
      <mesh
        ref={hit}
        position={body.position}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(planet);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.classList.add("planet-hover");
        }}
        onPointerOut={() => document.body.classList.remove("planet-hover")}
        geometry={targetResources.hitGeometry}
        material={targetResources.hitMaterial}
      />

      {hasContent ? (
        <mesh
          ref={halo}
          position={body.position}
          geometry={targetResources.haloGeometry}
          material={targetResources.haloMaterial}
        />
      ) : null}
    </>
  );
}

export function YeisSystemScene({
  system,
  phase,
  phaseRef,
  presenting,
  onPresented,
  starPointLightVisible,
  onSelectPlanet,
  onScaleFocus,
  scaleFocusSource,
  scaleTargetPlanet,
  handoffTargetPlanetId,
  onHandoffTargetSuppressed,
  onScaleFrame,
  quality,
}: {
  system: SystemDefinition;
  phase: UniversePhase;
  phaseRef: MutableRefObject<UniversePhase>;
  presenting: boolean;
  onPresented?: () => void;
  starPointLightVisible: boolean;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  onScaleFocus?: (planet: PlanetDefinition | null) => void;
  scaleFocusSource?: MutableRefObject<SystemScaleFocusSource | null>;
  scaleTargetPlanet?: PlanetDefinition | null;
  handoffTargetPlanetId?: string | null;
  onHandoffTargetSuppressed?: (planetId: string) => void;
  onScaleFrame?: (frame: SystemScaleFrame | null) => void;
  quality: QualityMode;
}) {
  const { gl, camera, size } = useThree();
  const [resources, setResources] = useState<NativeResources | null>(null);
  const [failed, setFailed] = useState(false);
  const starId = nativeStarId(system);
  const presentedResource = useRef<NativeResources | null>(null);
  const focusFrameRef = useRef(0);
  const focusedIdRef = useRef<string | null>(null);
  const focusedNativeIdRef = useRef<string | null>(null);
  const focusFillRef = useRef(new Map<string, number>());
  const focusProjectionRef = useRef(new THREE.Vector3());
  const scaleFrameIdRef = useRef<string | null>(null);
  const scaleFrameTickRef = useRef(0);
  const suppressedHandoffIdRef = useRef<string | null>(null);
  const handoffNativeId = useMemo(() => {
    if (!handoffTargetPlanetId) return null;
    const target = system.planets.find(
      (planet) => planet.id === handoffTargetPlanetId,
    );
    return target ? nativePlanetId(target) : null;
  }, [handoffTargetPlanetId, system.planets]);

  const targetResources = useMemo<ProductTargetResources>(
    () => ({
      hitGeometry: new THREE.SphereGeometry(HIT_RADIUS, 12, 12),
      haloGeometry: new THREE.SphereGeometry(HIT_RADIUS * 0.78, 18, 18),
      hitMaterial: new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.001,
        depthWrite: false,
        toneMapped: false,
      }),
      haloMaterial: new THREE.MeshBasicMaterial({
        color: "#73f4ff",
        transparent: true,
        opacity: 0.38,
        wireframe: true,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [],
  );
  const bodyRenderOptions = useMemo(
    () => ({
      atmospheres: quality !== "low",
      clouds: quality !== "low",
      rings: true,
      ringParticles: false,
      shadows: quality !== "low",
      imagery: false,
      fill: focusFillRef.current,
    }),
    [quality],
  );
  const apparentRadiusForBody = useCallback(
    (id: string) => resources?.bodies.byId.get(id)?.apparentRadiusPx ?? 0,
    [resources],
  );

  useEffect(
    () => () => {
      targetResources.hitGeometry.dispose();
      targetResources.haloGeometry.dispose();
      targetResources.hitMaterial.dispose();
      targetResources.haloMaterial.dispose();
    },
    [targetResources],
  );

  useEffect(() => {
    let active = true;
    let created: NativeResources | null = null;

    if (!starId) {
      setFailed(true);
      return;
    }

    void loadYeisCore()
      .then((runtime) => {
        // A quick departure or key/context change can retire this instance while
        // the shared runtime is still loading. Never allocate its old owner.
        if (!active) return;
        const source = runtime.universe.system(starId);
        const { renderSystem, scale } = createRenderSystem(source);
        const renderScene = new THREE.Scene();
        const bodies = new BodyRenderer(
          renderScene,
          gl.capabilities.getMaxAnisotropy(),
        );
        bodies.setSystem(renderSystem);
        // The pinned native renderer adds these Three lights for the PBR
        // spacecraft models; its procedural bodies already shade themselves.
        // The product projection omits spacecraft. Don't let these otherwise
        // unused lights leak into (and recompile) the separate, authored globe
        // material while native and close-world scenes overlap in the Canvas.
        if (!renderSystem.bodies.some(({ data }) => data.appearance.kind === "spacecraft")) {
          for (const child of renderScene.children) {
            if (child instanceof THREE.DirectionalLight || child instanceof THREE.AmbientLight) {
              child.visible = false;
            }
          }
        }
        const points = new BodyPoints(renderScene);
        points.setViews(bodies.views);
        const orbits = new OrbitLines(renderScene);
        orbits.setSystem(renderSystem);
        const [r, g, b] = starLightColor(renderSystem.starTemperature);

        created = {
          instance: `${starId}:${++nativeSystemInstanceSequence}`,
          system: renderSystem,
          scene: renderScene,
          bodies,
          points,
          orbits,
          luminosity:
            runtime.universe.starInfo(starId).luminosity * scale * scale,
          sunColor: new THREE.Vector3(r, g, b),
        };

        setResources(created);
        setFailed(false);
      })
      .catch((error) => {
        if (!active) return;
        console.error("[YEIS-NATIVE-SYSTEM] FAILED; retaining product fallback", error);
        setFailed(true);
      });

    return () => {
      active = false;
      if (created) disposeResources(created);
    };
  }, [gl, starId]);

  useEffect(() => {
    const data = document.documentElement.dataset;
    if (!resources) return;
    data.universeNativeSystemInstance = resources.instance;
    return () => {
      if (data.universeNativeSystemInstance === resources.instance) {
        delete data.universeNativeSystemInstance;
      }
    };
  }, [resources]);

  useEffect(() => {
    const data = document.documentElement.dataset;
    if (resources) {
      data.universeNativeSystemLifecycle = presenting ? "active" : "parked";
    }
    if (presenting) {
      data.universeSystemRenderer = resources
        ? "yeis-native"
        : failed ? "prototype-fallback" : starId ? "yeis-native-loading" : "prototype";
      if (resources) data.universeSystemReady = "true";
    }
    return () => {
      delete data.universeNativeSystemLifecycle;
      if (!presenting) return;
      delete data.universeSystemRenderer;
      delete data.universeSystemReady;
    };
  }, [failed, presenting, resources, starId]);

  useEffect(() => {
    if (!presenting) return;
    return () => {
      document.body.classList.remove("planet-hover");
      delete document.documentElement.dataset.universeSystemFocus;
      delete document.documentElement.dataset.universeSystemTargetSuppressed;
      if (focusedIdRef.current !== null) onScaleFocus?.(null);
      if (scaleFrameIdRef.current !== null) onScaleFrame?.(null);
      focusedIdRef.current = null;
      focusedNativeIdRef.current = null;
      focusFillRef.current.clear();
      scaleFrameIdRef.current = null;
      scaleFrameTickRef.current = 0;
      focusFrameRef.current = 0;
      suppressedHandoffIdRef.current = null;
    };
  }, [onScaleFocus, onScaleFrame, presenting]);

  const pickScaleFocus = useCallback(() => {
    if (!resources) return null;
    let bestPlanet: PlanetDefinition | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const planet of system.planets) {
      const body = resources.system.get(nativePlanetId(planet));
      if (!body) continue;
      const projected = focusProjectionRef.current
        .copy(body.position)
        .project(camera as THREE.PerspectiveCamera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot(
        projected.x * size.width * 0.5,
        projected.y * size.height * 0.5,
      );
      if (distance <= 92 && distance < bestDistance) {
        bestPlanet = planet;
        bestDistance = distance;
      }
    }

    return bestPlanet;
  }, [camera, resources, size.height, size.width, system.planets]);

  const readScaleFocus = useCallback(() => (
    resources?.scene.visible && presentedResource.current === resources &&
    phaseRef.current === "system" ? pickScaleFocus() : null
  ), [phaseRef, pickScaleFocus, resources]);
  useSystemScaleFocusSource(
    presenting && phase === "system" && !failed && resources
      ? scaleFocusSource
      : undefined,
    system.id,
    readScaleFocus,
  );

  // Like the retained Surface tree, the coordinator's synchronous phase
  // invalidates a stale committed presentation before the existing draw.
  // Keep the native objects/programs, not a hidden native simulation.
  const ownsFrame = () => presenting && phaseRef.current === phase;
  useFrame(() => {
    if (resources) resources.scene.visible = ownsFrame();
  }, -100);

  useFrame((state) => {
    if (!resources || !ownsFrame()) return;

    // Pinned YEIS renderers intentionally emit camera-relative coordinates
    // because their native host keeps the camera at a floating origin. Our R3F
    // product camera lives at its real shot position, so restore that origin
    // offset once at the shared native sub-scene boundary. Child positions and
    // shader uniforms remain camera-relative; the product camera is no longer
    // applied a second time by the scene graph.
    resources.scene.position.copy(camera.position);

    const native = resources.system;
    native.update(J2000_JD, state.clock.elapsedTime * 3600);

    scaleFrameTickRef.current = (scaleFrameTickRef.current + 1) % 4;
    const scaleTargetChanged =
      scaleFrameIdRef.current !== (scaleTargetPlanet?.id ?? null);
    if (
      scaleTargetPlanet &&
      onScaleFrame &&
      (scaleTargetChanged || scaleFrameTickRef.current === 0)
    ) {
      const targetBody = native.get(nativePlanetId(scaleTargetPlanet));
      if (targetBody) {
        scaleFrameIdRef.current = scaleTargetPlanet.id;
        onScaleFrame({
          planetId: scaleTargetPlanet.id,
          position: [
            targetBody.position.x,
            targetBody.position.y,
            targetBody.position.z,
          ],
          radius: Math.max(targetBody.data.radius, 1e-8),
        });
      }
    } else if (
      !scaleTargetPlanet &&
      onScaleFrame &&
      scaleFrameIdRef.current !== null
    ) {
      scaleFrameIdRef.current = null;
      onScaleFrame(null);
    }

    focusFrameRef.current = (focusFrameRef.current + 1) % 6;
    if (focusFrameRef.current === 0) {
      const bestPlanet = pickScaleFocus();
      const nextId = bestPlanet?.id ?? null;
      const nextNativeId = bestPlanet ? nativePlanetId(bestPlanet) : null;
      if (focusedIdRef.current !== nextId) {
        focusedIdRef.current = nextId;
        focusedNativeIdRef.current = nextNativeId;
        focusFillRef.current.clear();
        if (nextNativeId) focusFillRef.current.set(nextNativeId, 0.22);
        if (nextId) {
          document.documentElement.dataset.universeSystemFocus = nextId;
        } else {
          delete document.documentElement.dataset.universeSystemFocus;
        }
        onScaleFocus?.(bestPlanet);
      }
    }

    const perspective = camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(perspective.fov || 48);
    const pxPerRad = size.height / 2 / Math.tan(fovRad / 2);
    const star = native.star;

    resources.bodies.update(
      camera.position,
      camera.quaternion,
      camera,
      size.height,
      fovRad,
      star.position,
      star.radius,
      resources.sunColor,
      state.clock.elapsedTime,
      bodyRenderOptions,
    );

    const handoffView = handoffNativeId
      ? resources.bodies.byId.get(handoffNativeId)
      : null;
    if (handoffView) {
      // BodyRenderer.update() owns ordinary visibility and runs first. The
      // close-world renderer has already produced a matched frame at this
      // stage, so only the duplicated target disc transfers ownership; star,
      // orbits and every other System body remain visible until final paint.
      handoffView.group.visible = false;
      const suppressedId = handoffTargetPlanetId ?? handoffNativeId;
      document.documentElement.dataset.universeSystemTargetSuppressed =
        suppressedId;
      if (suppressedHandoffIdRef.current !== suppressedId) {
        suppressedHandoffIdRef.current = suppressedId;
        onHandoffTargetSuppressed?.(suppressedId);
      }
    } else {
      suppressedHandoffIdRef.current = null;
      delete document.documentElement.dataset.universeSystemTargetSuppressed;
    }

    resources.points.setPixelRatio(gl.getPixelRatio());
    resources.points.update(
      star.position,
      camera.position,
      resources.luminosity,
    );
    resources.orbits.update(
      camera.position,
      true,
      quality !== "low",
      pxPerRad,
      apparentRadiusForBody,
      focusedNativeIdRef.current,
    );
  });

  useFrame(() => {
    if (!resources || !resources.scene.visible ||
        !ownsFrame() || presentedResource.current === resources) return;
    // The original CinematicPipeline at priority 1 already submitted the
    // scene. Mark eligibility once; this is not camera/endpoint evidence.
    presentedResource.current = resources;
    onPresented?.();
  }, 2);

  if (!starId || failed || !resources) {
    if (!presenting) return null;
    return (
      <SystemScene
        system={system}
        starPointLightVisible={starPointLightVisible}
        onSelectPlanet={onSelectPlanet}
        onScaleFocus={onScaleFocus}
        scaleFocusSource={phase === "system" ? scaleFocusSource : undefined}
        scaleTargetPlanet={scaleTargetPlanet}
        handoffTargetPlanetId={handoffTargetPlanetId}
        onHandoffTargetSuppressed={onHandoffTargetSuppressed}
        onScaleFrame={onScaleFrame}
      />
    );
  }

  return (
    <>
      {presenting && <>
        <color attach="background" args={["#010208"]} />
        <LifecycleStars
          radius={90}
          depth={45}
          count={quality === "low" ? 900 : 1800}
          factor={1.7}
          saturation={0.22}
          fade
          speed={0.06}
        />
      </>}
      <primitive object={resources.scene} visible={presenting} />
      {presenting && system.planets.map((planet) =>
        planet.id === handoffTargetPlanetId ? null : (
          <ProductPlanetTarget
            key={planet.id}
            planet={planet}
            resources={resources}
            targetResources={targetResources}
            onSelect={onSelectPlanet}
          />
        ),
      )}
    </>
  );
}
