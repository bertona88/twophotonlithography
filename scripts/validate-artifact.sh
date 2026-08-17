#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"
wasm="$(find "${SITES_PROJECT_ROOT}/dist/client" -type f -name '*.wasm' -print -quit 2>/dev/null || true)"
repository_license="${SITES_PROJECT_ROOT}/LICENSE"
public_license="${SITES_PROJECT_ROOT}/public/LICENSE.txt"
artifact_license="${SITES_PROJECT_ROOT}/dist/client/LICENSE.txt"
repository_manifest="${SITES_PROJECT_ROOT}/wofi.json"
public_manifest="${SITES_PROJECT_ROOT}/public/wofi.json"
artifact_manifest="${SITES_PROJECT_ROOT}/dist/client/wofi.json"

[[ -f "${worker}" ]] || {
  echo "Missing Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${hosting}" ]] || {
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}
[[ -n "${wasm}" && -f "${wasm}" ]] || {
  echo "Missing compiled Rust/Wasm client asset under dist/client." >&2
  exit 66
}
for provenance_file in \
  "${repository_license}" \
  "${public_license}" \
  "${artifact_license}" \
  "${repository_manifest}" \
  "${public_manifest}" \
  "${artifact_manifest}"; do
  [[ -f "${provenance_file}" ]] || {
    echo "Missing license or provenance artifact: ${provenance_file}" >&2
    exit 66
  }
done

cmp -s "${repository_license}" "${public_license}" || {
  echo "Repository and public WOFI license copies differ." >&2
  exit 65
}
cmp -s "${public_license}" "${artifact_license}" || {
  echo "Built WOFI license differs from the reviewed public copy." >&2
  exit 65
}
cmp -s "${repository_manifest}" "${public_manifest}" || {
  echo "Repository and public wofi.json manifests differ." >&2
  exit 65
}
cmp -s "${public_manifest}" "${artifact_manifest}" || {
  echo "Built wofi.json differs from the reviewed public copy." >&2
  exit 65
}

magic="$(od -An -tx1 -N4 "${wasm}" | tr -d '[:space:]')"
[[ "${magic}" == "0061736d" ]] || {
  echo "Invalid WebAssembly magic bytes in ${wasm}." >&2
  exit 65
}

node --input-type=module - "${worker}" "${hosting}" <<'NODE'
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [workerPath, hostingPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}
NODE

echo "Validated Sites artifact: Worker, hosting, Rust/Wasm, license, and WOFI provenance are present."
