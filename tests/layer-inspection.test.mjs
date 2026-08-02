import assert from "node:assert/strict";
import test from "node:test";

import {
  isLayerInspectionLocked,
  nearestLayerIndex,
} from "../app/layer-inspection.js";

test("maps the authoritative laser focus to the nearest printable layer", () => {
  const layers = new Float32Array([7, 7.2, 7.4, 7.6]);

  assert.equal(nearestLayerIndex(layers, 7.01), 0);
  assert.equal(nearestLayerIndex(layers, 7.37), 2);
  assert.equal(nearestLayerIndex(layers, 7.59), 3);
});

test("locks layer scrubbing only while the lens follows exposure or compares", () => {
  assert.equal(isLayerInspectionLocked("exposing"), true);
  assert.equal(isLayerInspectionLocked("developing"), false);
  assert.equal(isLayerInspectionLocked("paused"), false);
  assert.equal(isLayerInspectionLocked("complete"), false);
  assert.equal(isLayerInspectionLocked("compare"), true);
});
