"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { initializeRenderer } from "./renderer-initialization";

export type FieldMode = "conversion" | "oxygen" | "radicals" | "development";

type LabViewportProps = {
  pathPositions: Float32Array | null;
  macroPositions: Float32Array | null;
  conversion: Uint8Array | null;
  oxygen: Uint8Array | null;
  radicals: Uint8Array | null;
  remaining: Uint8Array | null;
  focus: [number, number, number];
  progress: number;
  selectedLayer: number;
  layerHeight: number;
  fieldMode: FieldMode;
  stage: string;
};

type SceneHandles = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  path: THREE.LineSegments;
  materialPoints: THREE.Points;
  focus: THREE.Mesh;
  focusHalo: THREE.Mesh;
  beam: THREE.Mesh;
  membrane: THREE.Mesh;
  lensBox: THREE.LineSegments;
  resizeObserver: ResizeObserver;
  animationFrame: number;
};

const RENDERER_UNAVAILABLE_MESSAGE =
  "This browser could not start WebGL 2. The simulation controls and 2D Reaction Lens remain available.";

const VIOLET = new THREE.Color("#8b5cff");
const CYAN = new THREE.Color("#46d8ff");
const GOLD = new THREE.Color("#ffca5a");
const AMBER = new THREE.Color("#ff8a3d");
const IVORY = new THREE.Color("#f1e4c8");
const SLATE = new THREE.Color("#69728e");
const DARK = new THREE.Color("#111724");

function addWireShell(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number] = [0, 0, 0],
) {
  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: "#dfe8ff",
      transparent: true,
      opacity: 0.035,
      roughness: 0.18,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  surface.position.set(...position);
  surface.scale.set(...scale);
  surface.rotation.set(...rotation);
  group.add(surface);

  const wire = new THREE.Mesh(
    geometry.clone(),
    new THREE.MeshBasicMaterial({
      color: "#99a9ce",
      wireframe: true,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
    }),
  );
  wire.position.copy(surface.position);
  wire.scale.copy(surface.scale);
  wire.rotation.copy(surface.rotation);
  group.add(wire);
}

function createBenchyTarget() {
  const group = new THREE.Group();
  group.name = "target-micro-benchy";

  addWireShell(
    group,
    new THREE.SphereGeometry(1, 38, 18),
    [-0.45, 0, 2.55],
    [10.65, 4.35, 2.55],
  );
  addWireShell(
    group,
    new THREE.BoxGeometry(14.8, 7.9, 0.58, 8, 4, 1),
    [-0.15, 0, 5.08],
  );
  addWireShell(
    group,
    new THREE.BoxGeometry(9.2, 6.45, 3.65, 5, 4, 3),
    [2.1, 0, 7.05],
  );
  addWireShell(
    group,
    new THREE.BoxGeometry(10.75, 7.55, 0.7, 6, 4, 1),
    [2.15, 0, 9.25],
  );
  addWireShell(
    group,
    new THREE.CylinderGeometry(0.88, 1.18, 3.15, 24, 3, true),
    [4.1, 0, 11.1],
    [1, 1, 1],
    [Math.PI / 2, 0, 0],
  );

  const windowMaterial = new THREE.MeshBasicMaterial({
    color: "#05070d",
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
  });
  const sideWindowGeometry = new THREE.PlaneGeometry(2.45, 1.55);
  for (const y of [-3.26, 3.26]) {
    for (const x of [0.4, 3.55]) {
      const windowMesh = new THREE.Mesh(sideWindowGeometry, windowMaterial);
      windowMesh.position.set(x, y, 7.35);
      windowMesh.rotation.set(Math.PI / 2, 0, 0);
      group.add(windowMesh);
    }
  }

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      color: "#aeb9d6",
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  label.scale.set(0.24, 0.24, 0.24);
  label.position.set(-10.8, 0, 5.4);
  group.add(label);
  return group;
}

function buildScene(canvas: HTMLCanvasElement, container: HTMLDivElement): SceneHandles {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2("#05070d", 0.019);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 140);
  camera.position.set(25, -30, 22);
  camera.up.set(0, 0, 1);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 5.5);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 16;
  controls.maxDistance = 58;
  controls.maxPolarAngle = Math.PI * 0.78;

  scene.add(new THREE.HemisphereLight("#8ea6ff", "#070910", 1.5));
  const key = new THREE.DirectionalLight("#dfe8ff", 3.2);
  key.position.set(-12, -9, 26);
  scene.add(key);
  const cyanRim = new THREE.PointLight("#46d8ff", 22, 38, 2);
  cyanRim.position.set(12, 9, 10);
  scene.add(cyanRim);
  const violetRim = new THREE.PointLight("#8b5cff", 18, 32, 2);
  violetRim.position.set(-12, 5, 13);
  scene.add(violetRim);

  const substrate = new THREE.Mesh(
    new THREE.BoxGeometry(31, 18, 0.65),
    new THREE.MeshPhysicalMaterial({
      color: "#121827",
      roughness: 0.18,
      metalness: 0.34,
      clearcoat: 0.4,
    }),
  );
  substrate.position.z = -0.46;
  scene.add(substrate);

  const grid = new THREE.GridHelper(28, 28, "#313a54", "#171d2c");
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.1;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.28;
  });
  scene.add(grid);

  const resin = new THREE.Mesh(
    new THREE.BoxGeometry(28, 16, 17),
    new THREE.MeshPhysicalMaterial({
      color: "#313e72",
      transparent: true,
      opacity: 0.035,
      transmission: 0.28,
      roughness: 0.03,
      metalness: 0,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  resin.position.z = 7.7;
  scene.add(resin);
  const resinEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(28, 16, 17)),
    new THREE.LineBasicMaterial({
      color: "#6e83bd",
      transparent: true,
      opacity: 0.17,
    }),
  );
  resinEdges.position.copy(resin.position);
  scene.add(resinEdges);

  scene.add(createBenchyTarget());

  const path = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: SLATE,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  scene.add(path);

  const materialPoints = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({
      size: 0.22,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  materialPoints.visible = false;
  scene.add(materialPoints);

  const focus = new THREE.Mesh(
    new THREE.SphereGeometry(1, 28, 18),
    new THREE.MeshBasicMaterial({
      color: VIOLET,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  focus.scale.set(0.34, 0.34, 1.0);
  focus.position.set(0, 0, 7);
  scene.add(focus);

  const focusHalo = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({
      color: "#b69bff",
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  focusHalo.scale.set(1.05, 1.05, 2.4);
  focus.add(focusHalo);

  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 17, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: VIOLET,
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.rotation.x = Math.PI / 2;
  beam.position.set(0, 0, 15.5);
  scene.add(beam);

  const membrane = new THREE.Mesh(
    new THREE.PlaneGeometry(27, 15.2),
    new THREE.MeshBasicMaterial({
      color: "#7794ff",
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  membrane.position.z = 0.18;
  scene.add(membrane);

  const lensBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(5.4, 4.2, 3.8)),
    new THREE.LineBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.42,
    }),
  );
  lensBox.position.copy(focus.position);
  scene.add(lensBox);

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let animationFrame = 0;
  const started = performance.now();
  const animate = () => {
    const elapsed = (performance.now() - started) / 1000;
    controls.update();
    const pulse = 1 + Math.sin(elapsed * 4.5) * 0.08;
    focusHalo.scale.set(1.05 * pulse, 1.05 * pulse, 2.4 * pulse);
    const focusMaterial = focus.material as THREE.MeshBasicMaterial;
    focusMaterial.opacity = 0.72 + Math.sin(elapsed * 7) * 0.1;
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };
  animate();

  return {
    renderer,
    scene,
    camera,
    controls,
    path,
    materialPoints,
    focus,
    focusHalo,
    beam,
    membrane,
    lensBox,
    resizeObserver,
    animationFrame,
  };
}

function disposeScene(handles: SceneHandles) {
  cancelAnimationFrame(handles.animationFrame);
  handles.resizeObserver.disconnect();
  handles.controls.dispose();
  handles.scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material?.dispose());
    }
    if (object instanceof THREE.LineSegments || object instanceof THREE.GridHelper) {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material?.dispose());
    }
  });
  handles.renderer.dispose();
}

export default function LabViewport({
  pathPositions,
  macroPositions,
  conversion,
  oxygen,
  radicals,
  remaining,
  focus,
  progress,
  selectedLayer,
  layerHeight,
  fieldMode,
  stage,
}: LabViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const [rendererUnavailable, setRendererUnavailable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let handles: SceneHandles | null = null;
    let disposed = false;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (handles) {
        cancelAnimationFrame(handles.animationFrame);
      }
      setRendererUnavailable(true);
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    handles = initializeRenderer(
      () => buildScene(canvas, container),
      () => {
        if (!disposed) {
          setRendererUnavailable(true);
        }
      },
    );
    if (handles) {
      handlesRef.current = handles;
    }

    return () => {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      if (handles) {
        disposeScene(handles);
        if (handlesRef.current === handles) {
          handlesRef.current = null;
        }
      }
    };
  }, []);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !pathPositions) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(pathPositions.slice(), 3),
    );
    handles.path.geometry.dispose();
    handles.path.geometry = geometry;
    handles.path.geometry.setDrawRange(
      0,
      Math.max(0, Math.floor(pathPositions.length * progress)),
    );
  }, [pathPositions, progress]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !macroPositions) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(macroPositions.slice(), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(macroPositions.length), 3),
    );
    handles.materialPoints.geometry.dispose();
    handles.materialPoints.geometry = geometry;
  }, [macroPositions]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !conversion || !macroPositions) return;
    const geometry = handles.materialPoints.geometry;
    const colorAttribute = geometry.getAttribute("color") as
      | THREE.BufferAttribute
      | undefined;
    if (!colorAttribute || colorAttribute.count !== conversion.length) return;

    let visible = false;
    const color = new THREE.Color();
    for (let index = 0; index < conversion.length; index += 1) {
      const conversionValue = conversion[index] / 255;
      const oxygenValue = (oxygen?.[index] ?? 255) / 255;
      const radicalValue = (radicals?.[index] ?? 0) / 255;
      const remainingValue = (remaining?.[index] ?? 255) / 255;

      if (fieldMode === "oxygen") {
        color.copy(DARK).lerp(CYAN, oxygenValue);
        visible ||= oxygenValue < 0.99 || stage === "exposing";
      } else if (fieldMode === "development") {
        color.copy(DARK).lerp(IVORY, remainingValue * conversionValue);
        visible ||= stage === "developing" || stage === "complete";
      } else if (fieldMode === "radicals") {
        color.copy(DARK).lerp(GOLD, radicalValue);
        visible ||= radicalValue > 0.03;
      } else if (conversionValue >= 0.3 && remainingValue > 0.2) {
        const gel = clamp01((conversionValue - 0.3) / 0.7);
        color.copy(AMBER).lerp(IVORY, gel * remainingValue);
        visible = true;
      } else {
        color.copy(DARK).lerp(AMBER, conversionValue * 1.8);
        visible ||= conversionValue > 0.018;
      }
      colorAttribute.setXYZ(index, color.r, color.g, color.b);
    }
    colorAttribute.needsUpdate = true;
    handles.materialPoints.visible = visible;
  }, [
    conversion,
    oxygen,
    radicals,
    remaining,
    fieldMode,
    macroPositions,
    stage,
  ]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.path.geometry.setDrawRange(
      0,
      Math.floor((handles.path.geometry.getAttribute("position")?.count ?? 0) * progress),
    );
    handles.focus.position.set(...focus);
    handles.lensBox.position.set(...focus);
    handles.beam.position.set(focus[0], focus[1], focus[2] + 8.5);
  }, [focus, progress]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.membrane.position.z = selectedLayer * layerHeight + 0.18;
  }, [selectedLayer, layerHeight]);

  return (
    <div
      className="lab-viewport"
      data-renderer-state={rendererUnavailable ? "unavailable" : "ready"}
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        className="lab-canvas"
        aria-hidden={rendererUnavailable}
        aria-label="Interactive three-dimensional Micro-Benchy exposure chamber"
      />
      {rendererUnavailable ? (
        <div
          className="lab-viewport-fallback"
          role="status"
          aria-live="polite"
        >
          <span className="eyebrow">3D viewport</span>
          <strong>3D preview unavailable</strong>
          <p>{RENDERER_UNAVAILABLE_MESSAGE}</p>
          <small>
            Enable hardware acceleration or use a WebGL 2-capable browser to
            restore the interactive chamber.
          </small>
        </div>
      ) : null}
    </div>
  );
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
