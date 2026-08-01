import assert from "node:assert/strict";
import test from "node:test";
import {
  lineSegmentDrawCount,
  multipassPathProgress,
  voxelActivity,
} from "../app/volume-visualization.js";

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
