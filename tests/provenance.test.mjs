import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedIdeaId =
  "sha256:182f6bf27b400b724d6e77e5a7d10d1d402dede3b5dbcaebb979a897bf74ad2e";
const expectedImplementationId =
  "sha256:077a992d147c61a813c5a8024f74a95cf9e2618af73036a439be4fee755225d8";
const expectedParentImplementationId =
  "sha256:053616a6560b0233c1ee0286268ce4f3e7b096d319a8fce5841a5b4daf51588f";

test("keeps the repository and public WOFI license byte-identical", async () => {
  const [repositoryLicense, publicLicense] = await Promise.all([
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../public/LICENSE.txt", import.meta.url), "utf8"),
  ]);

  assert.equal(publicLicense, repositoryLicense);
  assert.match(repositoryLicense, /^WOFI SOFTWARE LICENSE\nVersion 1\.0, 12 August 2026/m);
  assert.match(repositoryLicense, /Copyright \(c\) 2026 Andrea Bertoncini/);
  assert.match(repositoryLicense, /Provenance Manifest/);
  assert.match(repositoryLicense, /Public Implementation Registration/);
});

test("keeps the repository and public provenance manifests byte-identical", async () => {
  const [repositoryBytes, publicBytes] = await Promise.all([
    readFile(new URL("../wofi.json", import.meta.url), "utf8"),
    readFile(new URL("../public/wofi.json", import.meta.url), "utf8"),
  ]);

  assert.equal(publicBytes, repositoryBytes);

  const manifest = JSON.parse(repositoryBytes);
  assert.equal(manifest.$schema, "https://wofi.ai/schemas/wofi.repository.v1.schema.json");
  assert.equal(manifest.schema_version, "wofi.repository.v1");
  assert.equal(manifest.implements.idea_id, expectedIdeaId);
  assert.equal(manifest.implementation.id, expectedImplementationId);
  assert.equal(manifest.implementation.parent_implementation_id, expectedParentImplementationId);
  assert.deepEqual(manifest.implementation.artifact, {
    kind: "url",
    value: "https://twophotonlithography.com/",
  });
  assert.equal(manifest.license.id, "WOFI-Software-1.0");
  assert.equal(manifest.license.url, "https://wofi.ai/licenses/WOFI-Software-1.0.txt");
});
