import assert from "node:assert/strict";
import test from "node:test";

import { shouldIgnoreLabShortcut } from "../app/keyboard-shortcuts.js";

function keyboardEvent(overrides = {}) {
  return {
    target: null,
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

test("keeps global shortcuts away from focused controls", () => {
  const button = {
    closest(selector) {
      assert.match(selector, /button/);
      return this;
    },
  };

  assert.equal(
    shouldIgnoreLabShortcut(keyboardEvent({ target: button })),
    true,
  );
});

test("ignores prevented and modified key chords", () => {
  assert.equal(
    shouldIgnoreLabShortcut(keyboardEvent({ defaultPrevented: true })),
    true,
  );
  assert.equal(shouldIgnoreLabShortcut(keyboardEvent({ altKey: true })), true);
  assert.equal(shouldIgnoreLabShortcut(keyboardEvent({ ctrlKey: true })), true);
  assert.equal(shouldIgnoreLabShortcut(keyboardEvent({ metaKey: true })), true);
});

test("allows unmodified shortcuts outside interactive controls", () => {
  const canvas = {
    closest() {
      return null;
    },
  };

  assert.equal(
    shouldIgnoreLabShortcut(keyboardEvent({ target: canvas })),
    false,
  );
});
