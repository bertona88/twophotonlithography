#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
crate_root="${project_root}/rust/reaction-lens"
cargo_home="${CARGO_HOME:-${HOME}/.cargo}"
mode="${1:-web}"
required_wasm_pack="wasm-pack 0.13.1"

# Rust panic locations from both this crate and registry dependencies are
# retained in the optimized Wasm. Remap their machine-specific roots so the
# reviewed browser artifact is reproducible on development, CI, and production
# hosts that use different checkout paths or Cargo homes.
export RUSTFLAGS="${RUSTFLAGS:+${RUSTFLAGS} }--remap-path-prefix=${project_root}=/workspace --remap-path-prefix=${cargo_home}=/cargo"

command -v cargo >/dev/null || {
  echo "Rust/Cargo is required. Install the toolchain pinned by rust-toolchain.toml." >&2
  exit 69
}
command -v wasm-pack >/dev/null || {
  echo "wasm-pack 0.13.1 is required. Install it with: cargo install wasm-pack --version 0.13.1 --locked" >&2
  exit 69
}

actual_wasm_pack="$(wasm-pack --version)"
if [[ "${actual_wasm_pack}" != "${required_wasm_pack}" ]]; then
  echo "Expected ${required_wasm_pack}, got ${actual_wasm_pack}." >&2
  exit 69
fi

case "${mode}" in
  web)
    target="web"
    output="${project_root}/app/wasm/reaction_lens"
    ;;
  node)
    target="nodejs"
    output="${project_root}/.wasm-test/reaction_lens"
    ;;
  *)
    echo "usage: build-wasm.sh [web|node]" >&2
    exit 64
    ;;
esac

mkdir -p "${output}"
cargo check \
  --manifest-path "${crate_root}/Cargo.toml" \
  --target wasm32-unknown-unknown \
  --locked
wasm-pack build \
  "${crate_root}" \
  --target "${target}" \
  --out-dir "${output}" \
  --out-name reaction_lens \
  --release
