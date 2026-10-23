import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";

export async function clientAsset(root, pattern) {
  const files = await readdir(root, { recursive: true });
  const matches = files.filter(file => pattern.test(path.basename(file)));
  assert.equal(matches.length, 1, `expected one production asset matching ${pattern}`);
  return path.join(root, matches[0]);
}

export function productionFetch(entry, request) {
  const context = { waitUntil() {}, passThroughOnException() {} };
  if (typeof entry === "function") return entry(request, context);
  return entry.fetch(request, {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, context);
}
