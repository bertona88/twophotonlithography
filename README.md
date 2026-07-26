# TwoPhotonLithography

> **Preliminary Setup Universe wrapper.** The current demo is temporary; the full simulator is expected to be redesigned and rebuilt substantially from scratch.

- **Live prototype:** https://twophotonlithography.com/
- **Prototype release verified:** 2026-07-26 (`20260726T002235Z-478235af2650`); check the URL for current availability
- **Field:** Nonlinear microfabrication
- **Status:** Greenfield planning wrapper with a preserved prototype snapshot

## Vision

The intended TwoPhotonLithography product is a two-photon fabrication simulator joining optical focusing, nonlinear absorption, radical chemistry, material conversion, scan mechanics, development, and manufactured geometry.

TwoPhotonLithography is part of the **Setup Universe**: independently deployed scientific and systems workbenches intended to become interoperable. Over time, setups should be able to orchestrate or interface with one another through explicit, versioned, unit-aware ports without transferring ownership or copying private implementation state.

**First accepted end-to-end slice:** Build one scan-line exposure that carries a defined optical dose through radical generation, material conversion, thresholding, and developed geometry with reproducible conservation/accounting checks.

**Model boundary:** TwoPhotonLithography owns fabrication-process state; OpticalSetup/PicSetup provide light, ElectricalSetup provides motion and control, and MolecularSetup provides material response through explicit ports.

**Claim gate:** No process recipe, dimensional-accuracy, resist-qualification, throughput, or fabrication-yield claim is allowed before objective, pulse, resin, kinetics, and development parameters are calibrated.

## Important starting point

Read [AGENTS.md](./AGENTS.md) before planning or implementing work.

The present browser demo should not constrain the next architecture. Before substantial implementation, this repository expects `VISION.md`, `FABRICATION_MODEL_CONTRACT.md`, `INTERFACE_CONTRACT.md`, `CLAIMS_AND_VALIDATION.md`, and `ACCEPTANCE_TESTS.md`.

## Prototype model boundary

The following describes only the current reference prototype, not the intended simulator.

**Exact current scope:** A deterministic 2D XZ reaction–diffusion model: Gaussian intensity, two-photon source I², radical diffusion/decay, and thresholded development.

**Known limits:**

- The fields are pedagogical and dimensionless; they are not calibrated to a specific photoresist or objective.
- Vector diffraction, oxygen inhibition, heat, shrinkage, and 3D transport are not included.

## Current prototype snapshot

`prototype/` preserves the exact shared browser-prototype source associated with production release `20260726T002235Z-478235af2650`. Its recorded deployed-source SHA-256 is `478235af26508aa70aa2af5f0196c9868b92ded1bed88106a9aa1a1cd86f8ba5`.

The snapshot contains all current Setup Universe demos because that release uses one shared, host-routed runtime. It is immutable, reference-only prior art: do not build the new architecture inside it. Moving, archiving, or removing it requires explicit user authorization after an accepted successor and preserved provenance.

To run the snapshot locally:

```sh
npm run prototype:test
npm run prototype:check
npm run prototype:serve
```

Then open http://127.0.0.1:4173/?setup=two-photon.

These commands validate only the legacy prototype. This wrapper intentionally has no future-product test suite until the greenfield implementation begins.

## Setup Universe

[PicSetup](https://github.com/bertona88/picsetup) · [ElectricalSetup](https://github.com/bertona88/electricalsetup) · [BiologicalSetup](https://github.com/bertona88/biologicalsetup) · [GravitySetup](https://github.com/bertona88/gravitysetup) · [EgoSetup](https://github.com/bertona88/egosetup) · [QuantumSetup](https://github.com/bertona88/quantumsetup) · [NoeticSetup](https://github.com/bertona88/noeticsetup) · [ComputationSetup](https://github.com/bertona88/computationsetup) · [LogisticSetup](https://github.com/bertona88/logisticsetup) · [MolecularSetup](https://github.com/bertona88/molecularsetup)

OpticalSetup remains in [LucaGenchi/optics-sketch](https://github.com/LucaGenchi/optics-sketch).

## License

No open-source license has been selected yet.
