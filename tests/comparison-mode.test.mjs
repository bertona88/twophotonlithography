import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldRunComparison } from "../app/comparison-mode.js";
import { integrityPresentation } from "../app/result-presentation.js";

test("keeps counterfactual replay out of the mobile control path", () => {
  assert.equal(shouldRunComparison("physics", "complete", true), false);
  assert.equal(shouldRunComparison("slice", "compare", true), false);
});

test("retains explicit desktop comparison after a completed run changes", () => {
  assert.equal(shouldRunComparison("physics", "complete", false), true);
  assert.equal(shouldRunComparison("slice", "compare", false), true);
  assert.equal(shouldRunComparison(null, "complete", false), false);
  assert.equal(shouldRunComparison("physics", "ready", false), false);
});

test("reports cured material during exposure and surviving material after development", () => {
  const metrics = {
    gelledFraction: 0.98,
    survivingFraction: 0.932,
    offTargetGelledFraction: 0.065,
    offTargetSurvivingFraction: 0.041,
  };

  assert.deepEqual(integrityPresentation("exposing", metrics), {
    targetLabel: "target gel",
    targetFraction: 0.98,
    spillLabel: "spill gel",
    spillFraction: 0.065,
  });
  assert.deepEqual(integrityPresentation("complete", metrics), {
    targetLabel: "target survives",
    targetFraction: 0.932,
    spillLabel: "spill survives",
    spillFraction: 0.041,
  });
  assert.deepEqual(integrityPresentation("compare", metrics), {
    targetLabel: "target survives",
    targetFraction: 0.932,
    spillLabel: "spill survives",
    spillFraction: 0.041,
  });
});

test("switches to remaining mass for development and keeps the A/B card below the field selector", () => {
  const interfaceSource = readFileSync(
    new URL("../app/lab-interface.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    interfaceSource,
    /if \(stage === "paused"\) \{\s*setFieldMode\("development"\);\s*workerRef\.current\?\.postMessage\(\{ type: "develop" \}\);/,
  );
  assert.match(
    styles,
    /\.field-selector\s*\{[^}]*top:\s*88px;[^}]*\}/s,
  );
  assert.match(
    styles,
    /\.comparison-card\s*\{[^}]*top:\s*136px;[^}]*\}/s,
  );
});
