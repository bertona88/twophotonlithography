"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { initializeRenderer } from "./renderer-initialization";
import {
  lineSegmentDrawCount,
  voxelActivity,
} from "./volume-visualization";
import { createVoxelMesh, voxelPathOpacity } from "./voxel-rendering";
import {
  BEAM_ROTATION_X,
  beamConeDimensions,
} from "./optics-visualization";

export type FieldMode = "conversion" | "oxygen" | "radicals" | "development";

export type PsfPreview = {
  model: string;
  qualityTier: string;
  pupilSamples: number;
  kernelVoxels: number;
  na: number;
  wavelengthNm: number;
  coneHalfAngleRad: number;
  fwhmRadiiUm: [number, number, number];
  tenthMaxRadiiUm: [number, number, number];
};

type LabViewportProps = {
  pathPositions: Float32Array | null;
  macroPositions: Float32Array | null;
  conversion: Uint8Array | null;
  oxygen: Uint8Array | null;
  radicals: Uint8Array | null;
  remaining: Uint8Array | null;
  focus: [number, number, number];
  progress: number;
  selectedLayerZ: number;
  sectionEnabled: boolean;
  voxelPitch: [number, number, number];
  opticsPreview: PsfPreview | null;
  fieldMode: FieldMode;
  stage: string;
};

type SceneHandles = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  path: THREE.LineSegments;
  materialPoints: THREE.InstancedMesh;
  focus: THREE.Mesh;
  focusHalo: THREE.Mesh;
  beam: THREE.Mesh;
  membrane: THREE.Mesh;
  lensBox: THREE.LineSegments;
  sectionPlane: THREE.Plane;
  resizeObserver: ResizeObserver;
  animationFrame: number;
};

const RENDERER_UNAVAILABLE_MESSAGE =
  "This browser could not start WebGL 2. The simulation controls and authoritative chemistry section remain available.";

const VIOLET = new THREE.Color("#8b5cff");
const CYAN = new THREE.Color("#46d8ff");
const GOLD = new THREE.Color("#ffca5a");
const AMBER = new THREE.Color("#ff8a3d");
const IVORY = new THREE.Color("#f1e4c8");
const SLATE = new THREE.Color("#69728e");
const DARK = new THREE.Color("#111724");
const MAX_RENDER_VOXELS = 60_000;

async function loadBenchyTarget(
  scene: THREE.Scene,
  signal: AbortSignal,
  sectionPlane: THREE.Plane,
) {
  const response = await fetch("/benchy/3dbenchy-mesh.bin", { signal });
  if (!response.ok) throw new Error(`3DBenchy mesh returned ${response.status}`);
  const positions = new Float32Array(await response.arrayBuffer());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(
    geometry,
    new THREE.MeshPhysicalMaterial({
      color: "#b9c7eb",
      transparent: true,
      opacity: 0.08,
      roughness: 0.18,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      clippingPlanes: [sectionPlane],
    }),
  );
  surface.name = "official-3dbenchy-target";
  scene.add(surface);
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
  renderer.localClippingEnabled = true;

  const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);

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

  const path = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: SLATE,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      clippingPlanes: [sectionPlane],
    }),
  );
  scene.add(path);

  const materialPoints = createVoxelMesh(THREE, MAX_RENDER_VOXELS);
  (materialPoints.material as THREE.Material).clippingPlanes = [sectionPlane];
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
  focusHalo.scale.set(0.36, 0.36, 2.4);
  focusHalo.position.copy(focus.position);
  scene.add(focusHalo);

  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(1, 1, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: VIOLET,
      transparent: true,
      opacity: 0.035,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  // ConeGeometry's tip starts on +Y. Rotate it toward -Z so the tip lands at
  // the focus and the aperture opens above the specimen.
  beam.rotation.x = BEAM_ROTATION_X;
  beam.scale.set(2.2, 17, 2.2);
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
  const pulsedHaloScale = new THREE.Vector3();
  const animate = () => {
    const elapsed = (performance.now() - started) / 1000;
    controls.update();
    const pulse = 1 + Math.sin(elapsed * 4.5) * 0.08;
    const focusTarget = focus.userData.targetScale as THREE.Vector3 | undefined;
    if (focusTarget) focus.scale.lerp(focusTarget, 0.18);
    const haloTarget = focusHalo.userData.targetScale as THREE.Vector3 | undefined;
    if (haloTarget) {
      pulsedHaloScale.copy(haloTarget).multiplyScalar(pulse);
      focusHalo.scale.lerp(pulsedHaloScale, 0.14);
    }
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
    sectionPlane,
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
  selectedLayerZ,
  sectionEnabled,
  voxelPitch,
  opticsPreview,
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
    const meshAbortController = new AbortController();
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
      void loadBenchyTarget(
        handles.scene,
        meshAbortController.signal,
        handles.sectionPlane,
      ).catch(
        () => undefined,
      );
    }

    return () => {
      disposed = true;
      meshAbortController.abort();
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
    handles.path.geometry.setDrawRange(0, 0);
  }, [pathPositions]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !macroPositions) return;
    const count = Math.min(
      MAX_RENDER_VOXELS,
      Math.floor(macroPositions.length / 3),
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(
      voxelPitch[0] * 0.92,
      voxelPitch[1] * 0.92,
      voxelPitch[2] * 0.92,
    );
    const quaternion = new THREE.Quaternion();
    for (let index = 0; index < count; index += 1) {
      position.fromArray(macroPositions, index * 3);
      matrix.compose(position, quaternion, scale);
      handles.materialPoints.setMatrixAt(index, matrix);
    }
    handles.materialPoints.count = count;
    handles.materialPoints.instanceMatrix.needsUpdate = true;
    handles.materialPoints.computeBoundingSphere();
  }, [macroPositions, voxelPitch]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || !conversion || !macroPositions) return;
    let visible = false;
    const color = new THREE.Color();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const count = Math.min(handles.materialPoints.count, conversion.length);
    for (let index = 0; index < count; index += 1) {
      const conversionValue = conversion[index] / 255;
      const oxygenValue = (oxygen?.[index] ?? 255) / 255;
      const radicalValue = (radicals?.[index] ?? 0) / 255;
      const remainingValue = (remaining?.[index] ?? 255) / 255;
      const activity = voxelActivity(
        fieldMode,
        conversionValue,
        oxygenValue,
        radicalValue,
        remainingValue,
      );

      position.fromArray(macroPositions, index * 3);
      const visibleScale = activity <= 0 ? 0 : 0.58 + Math.sqrt(activity) * 0.42;
      scale.set(
        voxelPitch[0] * 0.92 * visibleScale,
        voxelPitch[1] * 0.92 * visibleScale,
        voxelPitch[2] * 0.92 * visibleScale,
      );
      matrix.compose(position, quaternion, scale);
      handles.materialPoints.setMatrixAt(index, matrix);

      if (fieldMode === "oxygen") {
        color.copy(DARK).lerp(CYAN, 1 - oxygenValue);
      } else if (fieldMode === "development") {
        color.copy(DARK).lerp(IVORY, remainingValue * conversionValue);
      } else if (fieldMode === "radicals") {
        color.copy(DARK).lerp(GOLD, radicalValue);
      } else if (conversionValue >= 0.3 && remainingValue > 0.2) {
        const gel = clamp01((conversionValue - 0.3) / 0.7);
        color.copy(AMBER).lerp(IVORY, gel * remainingValue);
      } else {
        color.copy(DARK).lerp(AMBER, conversionValue * 1.8);
      }
      visible ||= activity > 0;
      handles.materialPoints.setColorAt(index, color);
    }
    handles.materialPoints.instanceMatrix.needsUpdate = true;
    if (handles.materialPoints.instanceColor) {
      handles.materialPoints.instanceColor.needsUpdate = true;
    }
    handles.materialPoints.visible = visible;
    const material = handles.materialPoints.material as THREE.MeshBasicMaterial;
    material.opacity =
      fieldMode === "conversion" || fieldMode === "development" ? 0.94 : 0.76;
  }, [
    conversion,
    oxygen,
    radicals,
    remaining,
    fieldMode,
    macroPositions,
    voxelPitch,
  ]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.path.geometry.setDrawRange(
      0,
      lineSegmentDrawCount(
        handles.path.geometry.getAttribute("position")?.count ?? 0,
        progress,
      ),
    );
    const material = handles.path.material as THREE.LineBasicMaterial;
    material.opacity = voxelPathOpacity(stage, progress);
  }, [pathPositions, progress, stage]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.focus.position.set(...focus);
    handles.focusHalo.position.set(...focus);
    handles.lensBox.position.set(...focus);
    if (!opticsPreview) {
      handles.beam.position.set(focus[0], focus[1], focus[2] + 8.5);
      return;
    }

    const beam = beamConeDimensions(opticsPreview.coneHalfAngleRad);
    handles.beam.scale.set(beam.radius, beam.length, beam.radius);
    handles.beam.position.set(
      focus[0],
      focus[1],
      focus[2] + beam.centerOffsetZ,
    );
    handles.focus.userData.targetScale = new THREE.Vector3(
      ...opticsPreview.fwhmRadiiUm,
    );
    handles.focusHalo.userData.targetScale = new THREE.Vector3(
      ...opticsPreview.tenthMaxRadiiUm,
    );
  }, [focus, opticsPreview]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.membrane.position.z = selectedLayerZ;
    handles.membrane.visible = sectionEnabled;
    handles.sectionPlane.constant = sectionEnabled ? selectedLayerZ : 1e6;
  }, [sectionEnabled, selectedLayerZ]);

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
