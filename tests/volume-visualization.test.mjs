import assert from "node:assert/strict";
import test from "node:test";
import { voxelActivity } from "../app/volume-visualization.js";

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
