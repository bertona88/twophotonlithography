import assert from "node:assert/strict";
import test from "node:test";
import { initializeRenderer } from "../app/renderer-initialization.js";

test("contains a synchronous renderer failure and reports it asynchronously", async () => {
  let unavailable = false;
  const handles = initializeRenderer(
    () => {
      throw new Error("Error creating WebGL context");
    },
    () => {
      unavailable = true;
    },
  );

  assert.equal(handles, null);
  assert.equal(unavailable, false);
  await Promise.resolve();
  assert.equal(unavailable, true);
});

test("returns renderer handles without reporting a failure", async () => {
  const expected = { renderer: "ready" };
  let unavailable = false;
  const handles = initializeRenderer(
    () => expected,
    () => {
      unavailable = true;
    },
  );

  assert.equal(handles, expected);
  await Promise.resolve();
  assert.equal(unavailable, false);
});
