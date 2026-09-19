#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

bash "${script_dir}/build-wasm.sh" web
if ! git -C "${project_root}" diff --exit-code HEAD -- app/wasm/reaction_lens; then
  echo "The committed browser Wasm does not match the current Rust source." >&2
  echo "Regenerate with npm run build:wasm on the pinned Linux CI toolchain, then commit app/wasm/reaction_lens with the Rust changes." >&2
  echo "macOS output can differ; CI saves its rebuilt package as rebuilt-browser-wasm on mismatch." >&2
  exit 1
fi
