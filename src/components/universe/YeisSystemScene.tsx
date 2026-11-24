import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import {
  SYSTEM_OVERVIEW_RADIUS,
  type PlanetDefinition,
  type QualityMode,
  type SystemDefinition,
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
  type SystemScaleFrame,
} from "./SystemScene";

const HIT_RADIUS = 0.34;

type NativeResources = {
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
  onSelectPlanet,
  onScaleFocus,
  scaleTargetPlanet,
  handoffTargetPlanetId,
  onScaleFrame,
  quality,
}: {
  system: SystemDefinition;
  onSelectPlanet: (planet: PlanetDefinition) => void;
  onScaleFocus?: (planet: PlanetDefinition | null) => void;
  scaleTargetPlanet?: PlanetDefinition | null;
  handoffTargetPlanetId?: string | null;
  onScaleFrame?: (frame: SystemScaleFrame | null) => void;
  quality: QualityMode;
}) {
  const { gl, camera, size } = useThree();
  const [resources, setResources] = useState<NativeResources | null>(null);
  const [failed, setFailed] = useState(false);
  const starId = nativeStarId(system);
  const focusFrameRef = useRef(0);
  const focusedIdRef = useRef<string | null>(null);
  const focusedNativeIdRef = useRef<string | null>(null);
  const focusFillRef = useRef(new Map<string, number>());
  const focusProjectionRef = useRef(new THREE.Vector3());
  const scaleFrameIdRef = useRef<string | null>(null);
  const scaleFrameTickRef = useRef(0);
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

    delete document.documentElement.dataset.universeSystemReady;
    document.documentElement.dataset.universeSystemRenderer =
      starId ? "yeis-native-loading" : "prototype";

    if (!starId) {
      setFailed(true);
      return () => {
        delete document.documentElement.dataset.universeSystemRenderer;
        delete document.documentElement.dataset.universeSystemReady;
      };
    }

    void loadYeisCore()
      .then((runtime) => {
        const source = runtime.universe.system(starId);
        const { renderSystem, scale } = createRenderSystem(source);
        const renderScene = new THREE.Scene();
        const bodies = new BodyRenderer(
          renderScene,
          gl.capabilities.getMaxAnisotropy(),
        );
        bodies.setSystem(renderSystem);
        const points = new BodyPoints(renderScene);
        points.setViews(bodies.views);
        const orbits = new OrbitLines(renderScene);
        orbits.setSystem(renderSystem);
        const [r, g, b] = starLightColor(renderSystem.starTemperature);

        created = {
          system: renderSystem,
          scene: renderScene,
          bodies,
          points,
          orbits,
          luminosity:
            runtime.universe.starInfo(starId).luminosity * scale * scale,
          sunColor: new THREE.Vector3(r, g, b),
        };

        if (!active) {
          disposeResources(created);
          return;
        }

        setResources(created);
        setFailed(false);
        document.documentElement.dataset.universeSystemRenderer = "yeis-native";
        document.documentElement.dataset.universeSystemReady = "true";
      })
      .catch((error) => {
        if (!active) return;
        console.error("[YEIS-NATIVE-SYSTEM] FAILED; retaining product fallback", error);
        setFailed(true);
        document.documentElement.dataset.universeSystemRenderer =
          "prototype-fallback";
        delete document.documentElement.dataset.universeSystemReady;
      });

    return () => {
      active = false;
      document.body.classList.remove("planet-hover");
      delete document.documentElement.dataset.universeSystemRenderer;
      delete document.documentElement.dataset.universeSystemReady;
      delete document.documentElement.dataset.universeSystemFocus;
      delete document.documentElement.dataset.universeSystemTargetSuppressed;
      focusedIdRef.current = null;
      focusedNativeIdRef.current = null;
      focusFillRef.current.clear();
      if (scaleFrameIdRef.current !== null) onScaleFrame?.(null);
      scaleFrameIdRef.current = null;
      if (created) disposeResources(created);
    };
  }, [gl, starId]);

  useFrame((state) => {
    if (!resources) return;

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
      let bestPlanet: PlanetDefinition | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const planet of system.planets) {
        const body = native.get(nativePlanetId(planet));
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
      document.documentElement.dataset.universeSystemTargetSuppressed =
        handoffTargetPlanetId ?? handoffNativeId;
    } else {
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

  useEffect(
    () => () => {
      if (focusedIdRef.current !== null) onScaleFocus?.(null);
    },
    [onScaleFocus],
  );

  if (!starId || failed || !resources) {
    return (
      <SystemScene
        system={system}
        onSelectPlanet={onSelectPlanet}
        onScaleFocus={onScaleFocus}
        scaleTargetPlanet={scaleTargetPlanet}
        handoffTargetPlanetId={handoffTargetPlanetId}
        onScaleFrame={onScaleFrame}
      />
    );
  }

  return (
    <>
      <color attach="background" args={["#010208"]} />
      <Stars
        radius={90}
        depth={45}
        count={quality === "low" ? 900 : 1800}
        factor={1.7}
        saturation={0.22}
        fade
        speed={0.06}
      />
      <primitive object={resources.scene} />
      {system.planets.map((planet) =>
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
