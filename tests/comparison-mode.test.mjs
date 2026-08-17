import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunComparison } from "../app/comparison-mode.js";

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
