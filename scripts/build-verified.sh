#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout >/dev/null || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

wasm_dir="${SITES_PROJECT_ROOT}/app/wasm/reaction_lens"
wasm_binary="${wasm_dir}/reaction_lens_bg.wasm"

if command -v cargo >/dev/null && command -v wasm-pack >/dev/null; then
  "${script_dir}/build-wasm.sh" web
else
  for generated in \
    "${wasm_dir}/reaction_lens.js" \
    "${wasm_dir}/reaction_lens.d.ts" \
    "${wasm_binary}" \
    "${wasm_dir}/reaction_lens_bg.wasm.d.ts"; do
    [[ -f "${generated}" ]] || {
      echo "Missing pinned Rust/Wasm artifact: ${generated}" >&2
      exit 66
    }
  done

  wasm_magic="$(od -An -tx1 -N4 "${wasm_binary}" | tr -d '[:space:]')"
  [[ "${wasm_magic}" == "0061736d" ]] || {
    echo "Invalid WebAssembly magic bytes in ${wasm_binary}." >&2
    exit 65
  }

  echo "Rust toolchain unavailable; using the pinned Rust/Wasm browser artifact."
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

"${script_dir}/validate-artifact.sh"
