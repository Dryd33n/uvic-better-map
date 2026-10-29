"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingProps, CampusBundle, FloorFile, FloorOutlines, Level, LocalFeature, LocalPolygon, Overhangs } from "./types";

const DATA_URL = "/campus/campus.local.json";
const OVERHANGS_URL = "/campus/extras/overhangs.json";
const OUTLINES_URL = "/campus/extras/floorOutlines.json";
const floorUrl = (key: string) => `/campus/floors/${key}.local.json`;

// Ground layers, bottom to top, with their colours.
const AREAS: [key: string, color: string][] = [
  ["boundary", "#e6e9df"],
  ["forest", "#b9d3a8"],
  ["fields", "#a8cf8e"],
  ["trails", "#d8c9a6"],
  ["roads", "#c9ccd1"],
  ["parking", "#d6d8dc"],
  ["reserved", "#cfd3e0"],
  ["shortParking", "#cfd3e0"],
  ["walkways", "#f6f3ec"],
  ["paths", "#f6f3ec"],
  ["fountains", "#8fc1e3"],
  ["construction", "#f0d9a8"],
];
const SKY = "#eef2f5";
const BUILDING = { Main: "#d9d4ca", Secondary: "#c9c4ba", hover: "#f2c46d", selected: "#e8953f" };
// The source has no heights for buildings without floor plans.
const HEIGHT_BY_TYPE: Record<string, number> = { Main: 15, Secondary: 9 };
const HEIGHT_DEFAULT = 11;

// Floor plans, bottom to top: the cut top of the building (roof wherever the floor doesn't reach),
// the floor plate (shows through the gaps between rooms as walls), then the rooms.
const CUT_CAP = "#efbb8c";
const FLOOR_SLAB = "#7a746b";
const ROOM_COLORS: Record<number, string> = {
  0: "#f1ede4", // corridor
  1: "#9fc6d4", // classroom
  2: "#8fb0dc", // washroom
  3: "#eab08a", // food service
  4: "#c4c7c1", // stair or lift
  5: "#dfe5e1", // other
};
const ROOM_OTHER = 5;
const CAP_LIFT = 0.02; // above the cut, so the cap closes the chopped walls
const SLAB_LIFT = 0.05;
const ROOM_LIFT = 0.08;
const NO_CUT = 1e6;

type Building = LocalFeature<BuildingProps>;
export type FloorPicker = { levels: Level[]; level: string } | null;

// Flat [x, y, ...] ring -> Vector2s in map metres.
function ringPoints(flat: number[]): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return pts;
}

function toShape([outer, ...holes]: LocalPolygon): THREE.Shape {
  const shape = new THREE.Shape(ringPoints(outer));
  for (const h of holes) shape.holes.push(new THREE.Path(ringPoints(h)));
  return shape;
}

// Shapes are drawn in the XY plane; rotating -90° about X puts them on the ground with north = -z.
const toGround = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);

function buildingHeight(p: BuildingProps): number {
  return p.height ?? HEIGHT_BY_TYPE[p.type ?? ""] ?? HEIGHT_DEFAULT;
}

// The floor shown when a building is selected: Level 1, else the lowest level at or above ground.
function groundLevel(levels: Level[]): string {
  return (levels.find((l) => l.elev === 0) ?? levels.find((l) => l.elev >= 0) ?? levels[0]).id;
}

export default function CampusViewer() {
  const mountRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Set by the scene once it exists; the UI calls into it.
  const sceneApi = useRef<{ deselect(): void; showLevel(id: string): void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<BuildingProps | null>(null);
  const [selected, setSelected] = useState<BuildingProps | null>(null);
  const [floors, setFloors] = useState<FloorPicker>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const abort = new AbortController();
    const disposables: { dispose(): void }[] = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    const camera = new THREE.PerspectiveCamera(40, 1, 5, 12000);
    camera.position.set(100, 850, 750);

    const controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = false;
    controls.minDistance = 40;
    controls.maxDistance = 3000;
    controls.maxPolarAngle = 1.2;
    controls.zoomToCursor = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9088, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-500, 700, 350);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -1000, right: 1000, top: 1000, bottom: -1000, near: 10, far: 2500 });
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    // The selected building is cut at the shown floor: everything above `cut.constant` is clipped.
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), NO_CUT);
    const materials = {
      Main: new THREE.MeshLambertMaterial({ color: BUILDING.Main }),
      Secondary: new THREE.MeshLambertMaterial({ color: BUILDING.Secondary }),
      hover: new THREE.MeshLambertMaterial({ color: BUILDING.hover }),
      selected: new THREE.MeshLambertMaterial({ color: BUILDING.selected, clippingPlanes: [cut], clipShadows: true }),
    };
    const lifted = (color: string, step: number) => new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -step, polygonOffsetUnits: -step });
    const capMaterial = lifted(CUT_CAP, 1);
    const slabMaterial = lifted(FLOOR_SLAB, 2);
    const roomMaterials = Object.fromEntries(Object.entries(ROOM_COLORS).map(([t, color]) => [t, lifted(color, 3)]));
    disposables.push(...Object.values(materials), capMaterial, slabMaterial, ...Object.values(roomMaterials));
    const baseMaterial = (b: Building) => (b.props.type === "Secondary" ? materials.Secondary : materials.Main);

    // Building meshes, for picking, and what each one needs for its floor plans.
    const buildings: THREE.Mesh[] = [];
    let campus: CampusBundle | null = null;
    let overhangs: Overhangs = {};

    function addCampus(data: CampusBundle) {
      // Ground layers: one merged mesh per layer. They're coplanar, so draw order (not depth) stacks them.
      AREAS.forEach(([key, color], i) => {
        const shapes = (data.layers[key]?.features ?? []).flatMap((f) => (f.polys ?? []).map(toShape));
        if (!shapes.length) return;
        const geometry = toGround(new THREE.ShapeGeometry(shapes));
        const material = new THREE.MeshLambertMaterial({ color, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = i;
        mesh.receiveShadow = true;
        scene.add(mesh);
        disposables.push(geometry, material);
      });

      // Buildings: extruded footprints, one mesh each so they can be picked. The footprint is the
      // ground-floor outline, so skyways and overhangs come from the overhang bands, each extruded
      // between its own floor and top, leaving open ground underneath.
      for (const b of (data.layers.buildings?.features ?? []) as Building[]) {
        if (!b.polys?.length) continue;
        const height = buildingHeight(b.props);
        const parts = b.polys.map((p) => new THREE.ExtrudeGeometry(toShape(p), { depth: height, bevelEnabled: false }));
        for (const { elev, top, polys } of overhangs[b.id] ?? []) {
          for (const p of polys) parts.push(new THREE.ExtrudeGeometry(toShape(p), { depth: top - elev, bevelEnabled: false }).translate(0, 0, elev));
        }
        const geometry = toGround(parts.length === 1 ? parts[0] : mergeGeometries(parts));
        if (parts.length > 1) parts.forEach((g) => g.dispose());
        const mesh = new THREE.Mesh(geometry, baseMaterial(b));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.renderOrder = AREAS.length;
        mesh.userData.building = b;
        scene.add(mesh);
        buildings.push(mesh);
        disposables.push(geometry);
      }

      // Centre the view on the campus land.
      const box = new THREE.Box3();
      for (const f of data.layers.boundary?.features ?? []) {
        const [x0, y0, x1, y1] = f.bbox ?? [0, 0, 0, 0];
        box.expandByPoint(new THREE.Vector3(x0, 0, -y0)).expandByPoint(new THREE.Vector3(x1, 0, -y1));
      }
      if (!box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        controls.target.copy(c);
        camera.position.set(c.x, 850, c.z + 750);
        sun.target.position.copy(c);
      }
    }

    // ── floor plans ──
    // The shown floor: a cap over the cut (footprint plus any overhang band at that height), the
    // floor's outline as its plate, and its rooms merged per room type. The cap is pickable and
    // stands in for the selected building. Drawn after the ground, so basements show through it.
    const plan = new THREE.Group();
    scene.add(plan);
    const floorFiles = new Map<string, Promise<FloorFile>>();
    let outlines: Promise<FloorOutlines> | null = null; // loaded on first selection
    let planToken = 0;

    const loadJson = <T,>(url: string, cache: Map<string, Promise<T>>): Promise<T> => {
      if (!cache.has(url)) {
        const p = fetch(url, { signal: abort.signal }).then((r) => {
          if (!r.ok) throw new Error(`${url} returned ${r.status}`);
          return r.json() as Promise<T>;
        });
        p.catch(() => cache.delete(url));
        cache.set(url, p);
      }
      return cache.get(url)!;
    };
    const planMesh = (polys: LocalPolygon[], y: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(toGround(new THREE.ShapeGeometry(polys.map(toShape))).translate(0, y, 0), material);
      mesh.receiveShadow = true;
      mesh.renderOrder = AREAS.length + 1;
      plan.add(mesh);
      return mesh;
    };

    function clearPlan() {
      planToken++;
      for (const m of plan.children as THREE.Mesh[]) m.geometry.dispose();
      plan.clear();
      cut.constant = NO_CUT;
    }

    function levelsOf(b: Building): Level[] {
      const ids = b.props.floors ?? [];
      return (campus?.floorList ?? []).filter((l) => ids.includes(l.id));
    }

    async function showLevel(levelId: string) {
      const b = selectedMesh?.userData.building as Building | undefined;
      const levels = b ? levelsOf(b) : [];
      const level = levels.find((l) => l.id === levelId);
      if (!b?.props.floorKey || !level) return;
      clearPlan();
      const token = planToken;
      setFloors({ levels, level: level.id });

      outlines ??= loadJson<FloorOutlines>(OUTLINES_URL, new Map()).catch((): FloorOutlines => ({}));
      let file: FloorFile, outline: LocalPolygon[] | undefined;
      try {
        [file, outline] = await Promise.all([loadJson(floorUrl(b.props.floorKey), floorFiles), outlines.then((o) => o[b.id]?.[level.id])]);
      } catch {
        return; // aborted or missing: the building just stays whole
      }
      const floor = file.floors.find((f) => f.id === level.id);
      if (token !== planToken || !floor) return;

      cut.constant = floor.elev;
      const top = [...(b.polys ?? []), ...(overhangs[b.id] ?? []).filter((o) => o.elev <= floor.elev && floor.elev < o.top).flatMap((o) => o.polys)];
      // Without outlines, the cap doubles as the plate.
      planMesh(top, floor.elev + CAP_LIFT, outline ? capMaterial : slabMaterial).userData.owner = selectedMesh;
      if (outline) planMesh(outline, floor.elev + SLAB_LIFT, slabMaterial);

      const byType = new Map<number, LocalPolygon[]>();
      for (const r of floor.rooms) {
        const t = r.t in ROOM_COLORS ? r.t : ROOM_OTHER;
        if (!byType.has(t)) byType.set(t, []);
        byType.get(t)!.push(...r.polys);
      }
      for (const [t, polys] of byType) planMesh(polys, floor.elev + ROOM_LIFT, roomMaterials[t]);
    }

    // ── picking and selection ──
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoverMesh: THREE.Mesh | null = null;
    let selectedMesh: THREE.Mesh | null = null;
    let downAt: [number, number] | null = null;

    const restyle = (m: THREE.Mesh | null) => {
      if (!m) return;
      const b = m.userData.building as Building;
      m.material = m === selectedMesh ? materials.selected : m === hoverMesh ? materials.hover : baseMaterial(b);
    };
    const pick = (e: PointerEvent): THREE.Mesh | null => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      for (const hit of raycaster.intersectObjects([...buildings, ...plan.children], false)) {
        if (hit.object.userData.owner) return hit.object.userData.owner as THREE.Mesh;
        // The selected building above the cut is invisible.
        if (hit.object === selectedMesh && hit.point.y > cut.constant + 0.01) continue;
        if (buildings.includes(hit.object as THREE.Mesh)) return hit.object as THREE.Mesh;
      }
      return null;
    };

    function select(mesh: THREE.Mesh | null) {
      if (mesh === selectedMesh) return;
      const prev = selectedMesh;
      selectedMesh = mesh;
      restyle(prev);
      restyle(mesh);
      clearPlan();
      const b = mesh?.userData.building as Building | undefined;
      setSelected(b?.props ?? null);
      const levels = b?.props.floorKey ? levelsOf(b) : [];
      setFloors(null);
      if (levels.length) void showLevel(groundLevel(levels));
    }
    sceneApi.current = { deselect: () => select(null), showLevel: (id) => void showLevel(id) };

    const onMove = (e: PointerEvent) => {
      if (e.buttons) return; // dragging the map
      const hit = pick(e);
      if (tooltipRef.current) tooltipRef.current.style.transform = `translate(${e.offsetX + 14}px, ${e.offsetY + 14}px)`;
      if (hit === hoverMesh) return;
      const prev = hoverMesh;
      hoverMesh = hit;
      restyle(prev);
      restyle(hit);
      renderer.domElement.style.cursor = hit ? "pointer" : "";
      setHovered(hit ? (hit.userData.building as Building).props : null);
    };
    const onLeave = () => {
      const prev = hoverMesh;
      hoverMesh = null;
      restyle(prev);
      setHovered(null);
    };
    const onDown = (e: PointerEvent) => { downAt = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      // A click, not the end of a drag.
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      select(pick(e));
    };
    const el = renderer.domElement;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    const getJson = async <T,>(url: string): Promise<T> => {
      const r = await fetch(url, { signal: abort.signal });
      if (!r.ok) throw new Error(`${url} returned ${r.status}`);
      return r.json();
    };
    Promise.all([
      getJson<CampusBundle>(DATA_URL),
      // Optional: without it, buildings are plain footprint extrusions.
      getJson<Overhangs>(OVERHANGS_URL).catch((): Overhangs => ({})),
    ])
      .then(([data, extra]) => {
        campus = data;
        overhangs = extra;
        addCampus(data);
        setStatus("ready");
      })
      .catch((e: Error) => {
        if (abort.signal.aborted) return;
        setError(e.message);
        setStatus("error");
      });

    return () => {
      abort.abort();
      sceneApi.current = null;
      observer.disconnect();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      renderer.setAnimationLoop(null);
      controls.dispose();
      clearPlan();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.remove();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mountRef} className="absolute inset-0" />

      <div
        ref={tooltipRef}
        className="pointer-events-none absolute left-0 top-0 rounded-md bg-zinc-900/85 px-2 py-1 text-xs font-medium text-white shadow"
        hidden={!hovered}
      >
        {hovered?.name}
        {hovered?.code && <span className="ml-1.5 text-zinc-400">{hovered.code}</span>}
      </div>

      {selected && (
        <aside className="absolute left-4 top-4 w-80 max-w-[calc(100%-2rem)] rounded-lg bg-white/95 p-4 text-sm text-zinc-800 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold leading-snug text-zinc-950">{selected.fullName ?? selected.name}</h2>
            <button onClick={() => sceneApi.current?.deselect()} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
              ✕
            </button>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {[selected.code, selected.number && `Building ${selected.number}`].filter(Boolean).join(" · ")}
          </p>
          {selected.about && <p className="mt-2 leading-relaxed">{selected.about}</p>}
          {selected.link && (
            <a href={selected.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-blue-700 hover:underline">
              Building page ↗
            </a>
          )}
        </aside>
      )}

      {floors && (
        <div role="group" aria-label="Floor" className="absolute bottom-4 left-4 flex gap-1 rounded-full bg-white/95 p-1 shadow-lg backdrop-blur">
          {floors.levels.map((l) => (
            <button
              key={l.id}
              title={l.label}
              aria-pressed={l.id === floors.level}
              onClick={() => sceneApi.current?.showLevel(l.id)}
              className={`h-8 min-w-8 rounded-full px-2 text-sm font-medium tabular-nums transition-colors ${
                l.id === floors.level ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {l.id}
            </button>
          ))}
        </div>
      )}

      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center text-sm text-zinc-600">
          {status === "loading" ? "Loading campus…" : `Couldn't load the campus data: ${error}`}
        </div>
      )}
    </div>
  );
}
