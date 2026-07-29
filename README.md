# Two-Photon Lithography Lab

An interactive browser laboratory that connects a sliced Micro-Benchy exposure
path to a deterministic reaction–diffusion polymerization simulation.

[Open the live lab](https://twophotonlithography.com)

## What is implemented

- Parameter-driven Micro-Benchy slicing with layer, hatch, contour, scan-speed,
  power, and motion controls
- A timestamped Three.js exposure view with layer inspection
- Fixed-step fields for photoinitiator, oxygen, radical activity, conversion,
  gelation, and developer transport
- A movable reaction lens showing local chemistry around the write path
- Development based on computed transport and gel fraction
- Deterministic replay and an oxygen-diffusion A/B branch

The target mesh is used only to create the exposure toolpath. Polymerized and
developed material is calculated from that path and the selected model
parameters; the rendered outcome is not a canned cured Benchy.

## Scientific boundary

This release is an educational reduced continuum model. It builds intuition for
nonlinear exposure, oxygen inhibition, radical transport, conversion, gelation,
and development, but it is not calibrated to predict a specific commercial
photoresist. Model parameters and numerical resolution are exposed so future
resin presets can be fitted and validated explicitly.

## Run locally

Prerequisites:

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

```bash
npm run install:ci
npm run dev
```

The local development server uses Vite and Vinext. Generated dependencies,
build artifacts, Wrangler state, and the Vinext font cache are intentionally
excluded from Git.

## Validate

```bash
npm run lint
npm test
```

`npm test` performs the production build, validates the deployable Worker
artifact, and checks the rendered HTML metadata.

Additional commands:

```bash
npm run build
npm run start
npm run validate:artifact
```

## Current architecture

- `app/page.tsx` — laboratory UI, slicer state, timeline, and controls
- `app/lab-viewport.tsx` — client-only Three.js viewport
- `app/simulation.worker.ts` — deterministic reaction–diffusion and development
  solver running off the main thread
- `worker/index.ts` — deployable Cloudflare Worker entry
- `tests/` — build-artifact and rendered-output checks

The current solver is TypeScript and runs in a Web Worker. Arbitrary STL
slicing, multiscale refinement, resin calibration, and a Rust/Wasm reference
solver are planned extensions rather than claims of this release.

## Production deployment

Pushes to `main` are deployed automatically to the existing Hetzner VPS. The
server polls GitHub approximately every three minutes, builds and tests the
exact revision, switches releases atomically, and rolls back if the local
health check fails. See [`ops/hetzner/README.md`](ops/hetzner/README.md).
