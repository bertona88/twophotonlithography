import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("keeps the mobile Reaction Lens and layer scrubber in one stage dock", () => {
  const interfaceSource = readFileSync(
    new URL("../app/lab-interface.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const dockStart = interfaceSource.indexOf("mobile-inspection-dock");
  const dockEnd = interfaceSource.indexOf("</section>", dockStart);
  const dockSource = interfaceSource.slice(dockStart, dockEnd);

  assert.ok(dockStart >= 0, "mobile inspection dock is present");
  assert.match(dockSource, /mobile-lens-preview/);
  assert.match(dockSource, /mobile-layer-scrubber/);
  assert.match(dockSource, /mobile-inspection-layer/);
  assert.doesNotMatch(interfaceSource, /mobile-quick-tools/);
  assert.match(
    styles,
    /\.causal-tape\.has-slices\s*\{\s*display:\s*none;\s*\}/,
  );
});
