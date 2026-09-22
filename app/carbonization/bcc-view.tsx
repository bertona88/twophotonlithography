"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import styles from "./carbonization.module.css";

export type MeshSnapshot = {
  positionsUm: number[]; referencePositionsUm: number[]; triangles: number[];
  triangleCells: number[]; cellCentersUm: number[]; tetrahedra: number[];
  cellFields: Record<string, number[]>;
};
export function fieldColor(value: number, minimum: number, maximum: number) {
  const t = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-12, maximum - minimum)));
  return new THREE.Color().setHSL((265 - 215 * t) / 360, 0.68, 0.38 + 0.26 * t);
}

type Props = { snapshot: MeshSnapshot | null; field: string; minimum: number; maximum: number; reference: boolean; cutaway: boolean; probe: number; onProbe: (index: number) => void; extentUm: number; support: string };
type Scene = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; extentUm: number; render: () => void };

function clearGroup(group: THREE.Group) {
  while (group.children.length) {
    const item = group.children[0]; group.remove(item);
    if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) {
      item.geometry.dispose();
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose();
    }
  }
}

type Point3 = [number, number, number];
type Section = { positions: number[]; cells: number[] };
function pointAt(snapshot: MeshSnapshot, node: number): Point3 { return snapshot.positionsUm.slice(node * 3, node * 3 + 3) as Point3; }
function intersectPlane(a: Point3, b: Point3): Point3 { const t = -a[1] / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0, a[2] + t * (b[2] - a[2])]; }
function sectionSurface(snapshot: MeshSnapshot, extentUm: number): Section {
  const result: Section = { positions: [], cells: [] };
  const eps = extentUm * 1e-8;
  const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  for (let cell = 0; cell < snapshot.tetrahedra.length / 4; cell++) {
    const nodes = snapshot.tetrahedra.slice(cell * 4, cell * 4 + 4).map(node => pointAt(snapshot, node));
    // Include a plane-aligned face only from its retained (negative-y) side.
    if (Math.min(...nodes.map(p => p[1])) >= -eps || Math.max(...nodes.map(p => p[1])) < -eps) continue;
    const points: Point3[] = [];
    const add = (p: Point3) => { if (!points.some(q => Math.hypot(p[0] - q[0], p[2] - q[2]) < eps)) points.push([p[0], 0, p[2]]); };
    for (const p of nodes) if (Math.abs(p[1]) <= eps) add(p);
    for (const [ia, ib] of edges) { const a = nodes[ia], b = nodes[ib]; if ((a[1] < -eps && b[1] > eps) || (a[1] > eps && b[1] < -eps)) add(intersectPlane(a, b)); }
    if (points.length < 3) continue;
    const cx = points.reduce((n, p) => n + p[0], 0) / points.length, cz = points.reduce((n, p) => n + p[2], 0) / points.length;
    points.sort((a, b) => Math.atan2(a[2] - cz, a[0] - cx) - Math.atan2(b[2] - cz, b[0] - cx));
    for (let i = 1; i + 1 < points.length; i++) { result.positions.push(...points[0], ...points[i], ...points[i + 1]); result.cells.push(cell); }
  }
  return result;
}
function clipTriangle(points: Point3[]): Point3[] {
  const clipped: Point3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a[1] <= 0) clipped.push(a);
    if ((a[1] < 0 && b[1] > 0) || (a[1] > 0 && b[1] < 0)) clipped.push(intersectPlane(a, b));
  }
  return clipped;
}
function Projection({ snapshot, field, minimum, maximum, cutaway, probe, onProbe, extentUm }: Props) {
  const scale = 205 / extentUm;
  const project = (p: Point3) => [300 + (p[0] - p[1]) * scale, 320 + (p[0] + p[1]) * scale * 0.44 - p[2] * scale * 1.3];
  const faces: { points: Point3[]; cell: number }[] = [];
  if (snapshot) {
    for (let i = 0; i < snapshot.triangles.length / 3; i++) {
      const original = snapshot.triangles.slice(i * 3, i * 3 + 3).map(node => pointAt(snapshot, node));
      const points = cutaway ? clipTriangle(original) : original;
      if (points.length >= 3) faces.push({ points, cell: snapshot.triangleCells[i] });
    }
    if (cutaway) { const section = sectionSurface(snapshot, extentUm); section.cells.forEach((cell, i) => faces.push({ cell, points: [0, 1, 2].map(n => section.positions.slice(i * 9 + n * 3, i * 9 + n * 3 + 3) as Point3) })); }
  }
  const depth = (face: { points: Point3[] }) => face.points.reduce((sum, p) => sum + p[0] + p[1], 0) / face.points.length;
  faces.sort((a, b) => depth(a) - depth(b));
  return <svg viewBox="0 0 600 430" role="img" aria-label="Projected BCC surface on rigid substrate" className={styles.projectedMesh}>
    <polygon points="35,320 300,210 565,320 300,430" fill="#343b49" stroke="#667086" />
    {faces.map((face, i) => <polygon key={i} points={face.points.map(p => project(p).join(",")).join(" ")} fill={`#${fieldColor(snapshot!.cellFields[field][face.cell], minimum, maximum).getHexString()}`} stroke={face.cell === probe ? "white" : "none"} strokeWidth="0.8" onClick={() => onProbe(face.cell)} />)}
  </svg>;
}

export default function BccView(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const propsRef = useRef(props);
  const [fallback, setFallback] = useState(false);
  useEffect(() => { propsRef.current = props; });

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let mounted = true;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { queueMicrotask(() => { if (mounted) setFallback(true); }); return () => { mounted = false; }; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const world = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 10000);
    camera.up.set(0, 0, 1);
    const e = propsRef.current.extentUm;
    camera.position.set(e * 1.75, -e * 2.15, e * 1.7);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, e * 0.42);
    controls.minDistance = e * 0.6; controls.maxDistance = e * 8;
    controls.enableDamping = false;
    const group = new THREE.Group(); world.add(group);
    world.add(new THREE.HemisphereLight("#f2ecff", "#3c4154", 2.4));
    const light = new THREE.DirectionalLight("#ffffff", 2); light.position.set(-e, -e * 2, e * 3); world.add(light);
    const render = () => renderer.render(world, camera);
    controls.addEventListener("change", render);
    const resize = new ResizeObserver(() => { const rect = container.getBoundingClientRect(); renderer.setSize(rect.width, rect.height); camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix(); render(); });
    resize.observe(container);
    renderer.domElement.setAttribute("aria-label", "Interactive solved BCC mesh. Drag or use arrow keys to orbit; scroll or use plus and minus to zoom; Home resets the camera. Click a surface to probe, or use the material probe slider below.");
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    container.appendChild(renderer.domElement);
    scene.current = { renderer, scene: world, camera, controls, group, extentUm: e, render };
    let pointerStart = [0, 0];
    const down = (event: PointerEvent) => { pointerStart = [event.clientX, event.clientY]; };
    const up = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
      const surfaces = [group.getObjectByName("solved-surface"), group.getObjectByName("section-surface")].filter((item): item is THREE.Object3D => !!item);
      const hit = ray.intersectObjects(surfaces).find(h => !propsRef.current.cutaway || h.point.y <= 1e-6);
      if (hit && hit.faceIndex != null) propsRef.current.onProbe((hit.object.userData.cellIndices as number[])[hit.faceIndex]);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].includes(event.key)) return;
      event.preventDefault();
      const extent = propsRef.current.extentUm;
      if (event.key === "Home") { camera.position.set(extent * 1.75, -extent * 2.15, extent * 1.7); controls.target.set(0, 0, extent * 0.42); }
      else {
        const offset = camera.position.clone().sub(controls.target);
        let radius = offset.length(); let azimuth = Math.atan2(offset.y, offset.x); let elevation = Math.atan2(offset.z, Math.hypot(offset.x, offset.y));
        if (event.key === "ArrowLeft") azimuth -= 0.12;
        if (event.key === "ArrowRight") azimuth += 0.12;
        if (event.key === "ArrowUp") elevation = Math.min(1.45, elevation + 0.12);
        if (event.key === "ArrowDown") elevation = Math.max(-0.15, elevation - 0.12);
        if (event.key === "+" || event.key === "=") radius = Math.max(controls.minDistance, radius * 0.85);
        if (event.key === "-") radius = Math.min(controls.maxDistance, radius / 0.85);
        camera.position.set(radius * Math.cos(elevation) * Math.cos(azimuth), radius * Math.cos(elevation) * Math.sin(azimuth), radius * Math.sin(elevation)).add(controls.target);
      }
      controls.update(); render();
    };
    const contextLost = (event: Event) => { event.preventDefault(); setFallback(true); };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    renderer.domElement.addEventListener("keydown", keydown);
    controls.update(); render();
    return () => { mounted = false; resize.disconnect(); controls.dispose(); clearGroup(group); renderer.dispose(); renderer.domElement.remove(); scene.current = null; };
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s || fallback) return;
    const { snapshot, field, minimum, maximum, reference, cutaway, probe, extentUm } = props;
    clearGroup(s.group);
    if (s.extentUm !== extentUm) {
      const ratio = extentUm / s.extentUm; s.camera.position.multiplyScalar(ratio); s.controls.target.multiplyScalar(ratio);
      s.controls.minDistance = extentUm * 0.6; s.controls.maxDistance = extentUm * 8; s.extentUm = extentUm; s.controls.update();
    }
    const plate = new THREE.Mesh(new THREE.BoxGeometry(extentUm * 1.32, extentUm * 1.32, extentUm * 0.04), new THREE.MeshStandardMaterial({ color: "#737e8f", metalness: 0.1, roughness: 0.85 }));
    plate.position.z = -extentUm * 0.02; s.group.add(plate);
    const grid = new THREE.GridHelper(extentUm * 1.32, 8, "#a0a9b9", "#8792a4"); grid.rotation.x = Math.PI / 2; grid.position.z = 0.03; s.group.add(grid);
    if (snapshot) {
      const positions = new Float32Array(snapshot.triangles.length * 3);
      const colors = new Float32Array(positions.length);
      snapshot.triangles.forEach((node, i) => {
        positions.set(snapshot.positionsUm.slice(node * 3, node * 3 + 3), i * 3);
        const color = fieldColor(snapshot.cellFields[field][snapshot.triangleCells[Math.floor(i / 3)]], minimum, maximum);
        colors.set([color.r, color.g, color.b], i * 3);
      });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)); geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
      const clippingPlanes = cutaway ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)] : [];
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.03, side: THREE.DoubleSide, clippingPlanes })); mesh.name = "solved-surface"; mesh.userData.cellIndices = snapshot.triangleCells; s.group.add(mesh);
      if (cutaway) {
        const section = sectionSurface(snapshot, extentUm);
        const capColors = new Float32Array(section.positions.length);
        section.cells.forEach((cell, i) => { const c = fieldColor(snapshot.cellFields[field][cell], minimum, maximum); for (let n = 0; n < 3; n++) capColors.set([c.r, c.g, c.b], i * 9 + n * 3); });
        const capGeometry = new THREE.BufferGeometry(); capGeometry.setAttribute("position", new THREE.Float32BufferAttribute(section.positions, 3)); capGeometry.setAttribute("color", new THREE.BufferAttribute(capColors, 3)); capGeometry.computeVertexNormals();
        const cap = new THREE.Mesh(capGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        cap.name = "section-surface"; cap.userData.cellIndices = section.cells; s.group.add(cap);
      }
      if (reference) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(snapshot.referencePositionsUm, 3)); g.setIndex(snapshot.triangles);
        const wire = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: "#d6d8e2", transparent: true, opacity: 0.22, depthWrite: false, clippingPlanes }));
        g.dispose(); s.group.add(wire);
      }
      const point = snapshot.cellCentersUm.slice(probe * 3, probe * 3 + 3);
      if (point.length === 3 && (!cutaway || point[1] <= 0)) { const dot = new THREE.Mesh(new THREE.SphereGeometry(extentUm * 0.012, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff", depthTest: false })); dot.position.set(point[0], point[1], point[2]); dot.renderOrder = 2; s.group.add(dot); }
    }
    s.render();
  }, [props, fallback]);

  function resetCamera() { const s = scene.current; if (!s) return; const e = props.extentUm; s.camera.position.set(e * 1.75, -e * 2.15, e * 1.7); s.controls.target.set(0, 0, e * 0.42); s.controls.update(); s.render(); }
  return <div className={styles.meshFrame}>
    <div ref={host} className={styles.meshCanvas} style={fallback ? { visibility: "hidden" } : undefined} />
    {fallback && <div className={styles.fallback}><Projection {...props} /><span>WebGL unavailable · projected solved surface</span></div>}
    {!props.snapshot && <div className={styles.meshLoading}>Preparing the BCC reference mesh…</div>}
    <div className={styles.meshTop}><span>{props.support === "bonded" ? "BONDED TO RIGID SUBSTRATE" : "FREE SHRINKAGE CONTROL"}</span><button type="button" onClick={resetCamera} disabled={fallback}>Reset camera</button></div>
    <div className={styles.meshBottom}><span>{props.cutaway ? "Spatial section y = 0 µm · current configuration" : "Drag / arrows: orbit · + −: zoom · click: probe"}</span><span>Reference span {props.extentUm.toFixed(0)} µm</span></div>
  </div>;
}
