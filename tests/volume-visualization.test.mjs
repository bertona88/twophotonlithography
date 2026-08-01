import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  lineSegmentDrawCount,
  multipassPathProgress,
  voxelActivity,
} from "../app/volume-visualization.js";
import {
  createVoxelMesh,
  voxelPathOpacity,
} from "../app/voxel-rendering.js";

test("unaffected occupied voxels stay hidden", () => {
  assert.equal(voxelActivity("conversion", 0, 1, 0, 1), 0);
  assert.equal(voxelActivity("oxygen", 0, 1, 0, 1), 0);
  assert.equal(voxelActivity("radicals", 0, 1, 0, 1), 0);
  assert.equal(voxelActivity("development", 0, 1, 0, 1), 0);
});

test("each field reveals only its simulated signal", () => {
  assert.ok(voxelActivity("conversion", 0.4, 1, 0, 1) > 0.9);
  assert.ok(voxelActivity("oxygen", 0, 0.6, 0, 1) > 0.9);
  assert.ok(voxelActivity("radicals", 0, 1, 0.3, 1) > 0.9);
  assert.ok(voxelActivity("development", 0.4, 1, 0, 0.8) > 0.7);
});

test("voxel mesh uses initialized instance colors without vertex-color multiplication", () => {
  const mesh = createVoxelMesh(THREE, 12);
  assert.equal(mesh.material.vertexColors, false);
  assert.equal(mesh.geometry.getAttribute("color"), undefined);
  assert.equal(mesh.instanceColor.count, 12);
  assert.deepEqual(Array.from(mesh.instanceColor.array.slice(0, 3)), [1, 1, 1]);
});

test("calculated material becomes dominant after exposure", () => {
  assert.equal(voxelPathOpacity("ready", 0), 0.16);
  assert.equal(voxelPathOpacity("exposing", 0.5), 0.09);
  assert.equal(voxelPathOpacity("paused", 1), 0.035);
  assert.equal(voxelPathOpacity("developing", 1), 0.035);
  assert.equal(voxelPathOpacity("complete", 1), 0.035);
});

test("toolpath progress reveals only complete line segments", () => {
  assert.equal(lineSegmentDrawCount(20, 0), 0);
  assert.equal(lineSegmentDrawCount(20, 0.26), 4);
  assert.equal(lineSegmentDrawCount(20, 1), 20);
  assert.equal(lineSegmentDrawCount(21, 1), 20);
  assert.equal(lineSegmentDrawCount(20, 2), 20);
});

test("multi-pass exposure reveals the complete one-pass path per traversal", () => {
  assert.equal(multipassPathProgress(0.25, 2), 0.5);
  assert.equal(multipassPathProgress(0.5, 2), 1);
  assert.equal(multipassPathProgress(0.25, 3), 0.75);
  assert.equal(multipassPathProgress(1, 3), 1);
});
