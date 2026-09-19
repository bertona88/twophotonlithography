# Pyrolysis and carbonization simulator: implementation plan

**Status:** proposed design, not implemented or experimentally validated.  
**Revision:** 2026-09-19, following the Serles / Portela literature review.  
**Repository inspection date:** 2026-09-18.  
**Inspected runtime revision:** `9a70f6325c1cca53b1bb42cbeb31d75013dd4d4c` on `main`.  
**Scope:** documentation only; no runtime, deployment, license or WOFI changes. No local build, numerical validation or experiment was performed for this planning exercise.

## 1. Scientific objective and correction to the original framing

Extend the existing process chain into:

**Slice → expose → develop → prepare the dry polymer specimen → heat / carbonize → cool → inspect the carbon structure.**

The central objective is to simulate **transformation inside the printed resin during heating**, including evolving chemical composition, carbon bonding/network organization, volatile escape, pore/density changes and their mechanical consequences. Carbon-network evolution is part of the pyrolysis process, not a separate post-processing label added after the object has shrunk.

The first version of this plan underemphasized that coupling by making internal carbon order and transport largely optional downstream features. This revision changes that priority. See [the research review](PYROLYSIS_SERLES_PORTELA_REVIEW.md) for primary-source evidence, access limitations and modeling cautions.

Use *polymer-derived pyrolytic carbon* consistently with the literature reviewed there. A vapor-fed deposition process would have different mass-input physics, but it is not the process proposed here. Formation of sp²-rich, graphitic or disordered carbon structures inside the precursor remains in scope. Perfect crystalline graphite is not the default material endpoint.

Distinguish chemical composition, bonding, network organization, porosity and mechanical state as **coupled variables**, not isolated phenomena. The first scientifically useful release should predict or explicitly qualify local thinning, dimensional change, support motion, distortion and stress as consequences of that evolving state. It must not implement a scale animation or claim atomically resolved chemistry from an uncalibrated continuum model.

## 2. Existing repository and integration constraints

These findings refer to the inspected runtime revision, not a fresh execution test:

| Component | Existing role | Proposed integration |
| --- | --- | --- |
| `rust/reaction-lens/src/whole_volume.rs` | Authoritative dense 3D chemistry, exposure and development | Export an owned full-resolution specimen; retain necessary process history |
| `rust/reaction-lens/src/wasm_api.rs` | Wasm interface and checked render/slice exports | Add a pyrolysis owner, preparation API and versioned snapshots |
| `app/simulation.worker.ts` | Wasm initialization, queues, scheduling and buffer copies | Schedule resumable coupled numerical work off the main thread |
| `app/lab-interface.tsx` | Controls and diagnostics | Add furnace, material, support and comparison controls |
| `app/lab-viewport.tsx`, `app/volume-visualization.js` | Visualization and display activity | Render physically deformed geometry without modifying physical state |
| Existing Rust/worker tests | Determinism, chemistry parity, snapshots and builds | Preserve these and add independent transport/mechanics tests |

The maximum chemistry grid is `128 × 72 × 104` (958,464 cells), with unequal physical voxel pitches. The renderer samples at most 60,000 voxels. Render samples, activity and opacity are not the authoritative specimen.

The worker currently uses approximately 8–64 MiB volume budgets with a 32 MiB fallback. These are not measured capacities for nonlinear mechanics or coupled carbonization. The production solver has no temperature, displacement, stress, carbonization or carbon-network state, and the crate has no existing finite-element subsystem. The bundled Benchy occupancy is prepared offline; arbitrary STL execution is not implemented. Synthetic coupon fixtures can be introduced without making arbitrary mesh import a prerequisite.

Define physical pyrolysis time independently in seconds. Do not silently inherit a calibrated reaction clock from the upstream empirical/nondimensional exposure model. UI integration paths were identified from the repository map; the inspection was not an exhaustive UI audit.

## 3. Evidence and model boundaries

The companion review records the Serles 2023 and 2025 studies, Serles/Portela 2026 work, Portela 2021 support design, Mao 2023 chemical/mechanical evolution, and Sharma 2018 in-situ microscopy. It distinguishes full articles from accessible previews and records which figures/supplements were not checked.

Use those observations to design tests and identify missing state, not to assemble an undocumented universal resin preset. The papers do not collectively determine a complete anisotropic transformation tensor, a pore-pressure law or furnace-scale kinetics for this repository's generic resin.

In particular:

- A bonding fraction is not a density, porosity, elastic modulus or orientation tensor.
- A radial chemical gradient is not, by itself, evidence of oriented graphite or a complete directional shrinkage law.
- A constrained atomistic trajectory cannot directly calibrate stress-free axial contraction.
- A final chemical measurement does not uniquely identify a transient transport/reaction model.

These are requirements on interpretation and implementation. Keep experimental evidence, authors' proposed mechanisms, our candidate constitutive laws and missing calibration visibly distinct.

## 4. Full-resolution dry-specimen handoff

Create a versioned, owned `DevelopedSpecimen` inside Rust. It should contain reference geometry and physical units, solid volume/mass convention, retained cure/exposure fields, material IDs, connected components, supports/interfaces, preparation history and source-run provenance. Retain dose-weighted scan-direction statistics only as printing metadata unless a measured orientation relationship is available.

The current `remaining` field is normalized retention, not dry mass density. It starts at one and development handles target and active off-target material differently. CAD occupancy, `remaining` alone and renderer thresholds do not define a physically load-bearing dry solid.

Preparation must account for surviving off-target polymer, removed residue, unresolved connections and disconnected fragments. Define mass once, for example from dry density, reference cell volume and a solid fraction; do not multiply the same retention factor into both density and fraction. Record excluded mass and sensitivity to the extraction rule.

A washed, dry specimen can still have relevant retained chemical species. Do not assume complete monomer removal or identical crosslink density merely because washing occurred. Represent retained precursor species when the material profile supplies them; otherwise mark them unknown and expose the assumption. Free liquid or incomplete development needs a separate preparation/residue treatment.

Use a lossless Rust-to-Rust handoff, not an 8-bit render round trip. Preserve non-cubic pitches, connectivity and struts under mechanical coarsening. Point/edge-only voxel contacts need an explicit connection rule. Radical/oxygen fields from photopolymerization must not be reinterpreted as furnace gas or pressure.

Save an immutable checkpoint with source checksum, source parameters, material version, geometry scale, extraction policy and solver revision. Replaying furnace schedules should not require repeating exposure. An initially stress-free dry reference remains an explicit assumption unless drying/cure residual stresses are supplied.

## 5. Coupled thermal, chemical and transport core

### 5.1 Temperature and units

Accept ramp/hold/cool schedules in °C and minutes; compute in Kelvin and seconds. Convert micrometers to meters at one documented interface; use pascals and kilograms for mechanics/mass.

Start with either prescribed specimen temperature or a lumped specimen heat balance with explicit furnace lag. Estimate thermal diffusion, reaction and mass-transport timescales independently. Near-isothermal temperature does not require homogeneous chemistry. Add spatial conduction and substrate thermal contact when conditions or measured errors justify them, not for visual drama.

If a spatial energy balance is introduced, keep evolving mass, reaction enthalpy, gas enthalpy and deformed geometry consistent. Furnace temperature and the temperature actually used by reactions must be distinguishable in snapshots.

Record atmosphere, pressure and gas boundary assumptions. Initially support an inert process within a stated validity range. Air oxidation and arbitrary vacuum/pressure effects require their corresponding reaction and transport closures, not a cosmetic selector.

### 5.2 Reduced reaction and bonding state

Start with a small identifiable network of precursor, intermediate, char and volatile pools. Add retained C/H/O bookkeeping where composition is modeled. Define stoichiometry and units, not just a scalar conversion percentage.

A candidate rate form is:

`r_j = A_j exp[-E_j / (R T)] f_j(z, initial precursor state)`.

Here `z` is the evolving local state. The number and form of pathways must be fitted; the expression is not an established parameterization for a commercial resin. Use positive, bounded, implicit or adaptive integration through rapid reaction intervals.

Carbon-network state evolves during this same integration. A minimal closure may use a bounded structural variable until a true bonding-population model is calibrated. It must participate in explicitly documented material relationships rather than only affecting color. A measured sp² percentage requires a phase definition, an observation model and appropriate calibration.

When actual bonding fractions are carried, track retained carbon and sp²-assigned carbon consistently: `f_sp2 = N_C,sp2 / N_C,retained` in the specified phase. Account for precursor aromatic content and selective mass loss; neither initial zero sp² nor a universal monotonic percentage curve should be imposed by definition.

Network order, clustering and texture remain separate descriptors. They need not equal mass-loss progress, and intrinsic texture is not supplied by the hatch angle. Avoid adding state variables that cannot be constrained by data without clearly labeling them exploratory.

### 5.3 Conservative volatile transport is an early model capability

Include a spatial reaction–transport benchmark before calling the integrated feature a shrinkage simulator. A well-mixed, instantaneous-escape case is useful as a verified limiting approximation, not the universal production model.

For the initial inert accounting system:

`initial specimen mass = remaining solid + retained mobile products + cumulative escaped products`.

If elemental species are modeled, enforce the corresponding elemental ledgers. Oxidation later adds incoming oxygen and outgoing products. Char yield is residue mass yield, not elemental carbon purity.

Implement conservative fluxes on the actual geometry, with evolving transport coefficients and an explicit surface escape boundary. Track whether mobile products are dissolved, pore gas or a lumped surrogate. A pressure prediction requires storage, thermodynamics and coupling conventions; decomposition rate alone is not pressure.

For a radial strut benchmark, use cylindrical control-volume areas and volumes. For full geometry, use the correct reference/current-configuration transformation. Account for changing surface area and transport length as the specimen deforms. Avoid double-counting size dependence through both an empirical yield correction and an explicit transport mechanism fitted to the same effect.

Start with an identified set of gas/transport regimes. Warn about unresolved pressure/failure risks; do not claim predicted bubbling, fracture or delamination before those constitutive models exist.

### 5.4 Density, porosity and relaxation

Keep retained solid mass, stress-free density and pore descriptors distinct. Resolved architectural voids must not also be counted as unresolved material porosity. Define whether pore fraction is stress-free or actual, and whether pores are open/connected enough for the chosen transport model.

Proposed closures should depend on local state, for example:

`rho_free = R(z)`  
`transport = D(T, z, pore_state)`  
`mechanical response = M(F_e, T, z, history)`.

Do not independently prescribe density, porosity, mass yield and free volume without a closure relating them. Permit softening, relaxation and later stiffening rather than a forced monotonic interpolation between two elastic endpoints. Avoid universally setting stiffness, conductivity or shrinkage proportional to sp² fraction.

The coupled cycle is: reactions and transport update composition/network state; that state changes free transformation and mechanical response; mechanics updates geometry; geometry updates transport for the next converged increment. Select a staggered iterative or monolithic scheme through numerical testing, and control splitting error explicitly.

## 6. Finite-strain anisotropic shrinkage

### 6.1 Distinguish directionality mechanisms

Keep intrinsic directional transformation, spatial heterogeneity, constraints and grid bias independently testable. Initially isotropic material can undergo nonuniform constrained deformation. Conversely, scalar chemical gradients do not establish a graphite orientation tensor.

Use an isotropic intrinsic law as the default control case while allowing spatially evolving chemistry and mechanics. Nonzero intrinsic anisotropy requires a fitted or explicitly hypothetical material law. Symmetric conditions must not produce arbitrary transverse bending without physical asymmetry or a resolved instability.

### 6.2 Stress-free transformation and actual deformation

Let `X` denote dry-reference position, `x = X + u(X)` current position and `F = ∂x/∂X`. Use finite deformation because large contraction violates small-strain assumptions.

The baseline is `F = F_e F_nat`, with `F_nat = F_th F_py`. A finite-strain relaxation model may introduce a factor such as `F_v`, but its free energy, evolution, frame convention and dissipation must be derived together. Do not paste unrelated small-strain creep equations into this decomposition.

Represent stress-free pyrolysis transformation using:

`E_py = (ln J_py / 3) I + D_py`, with `tr(D_py) = 0`,  
`F_py = exp(E_py)`.

`J_py` controls free volume; the symmetric trace-free tensor `D_py` controls its directional distribution. Equivalently, use positive principal stretches with material-attached directors. An evolving orientation law needs its own objective update.

At a common reference temperature:

`J_py = (m_s / m_0) (rho_0,ref / rho_free,ref)`.

If unresolved pore volume is used, define its relation to bulk free density, for example `rho_free,ref = (1 - phi_micro) rho_skeleton,ref`. Thermal expansion belongs in `F_th`, not again in an expanded density in this closure. Avoid counting irreversible pore collapse in both density evolution and an independent volumetric viscous factor.

Actual current density follows `rho_actual = m_s / (det(F) V_0)`. Constraints can make actual and free volumes differ. Do not overwrite the solved Jacobian with `J_py`.

Either fit directional free stretches and infer consistent free density, or fit mass/density and constrain the stretch product. As a mathematical example, stretches `(0.5, 0.5, 0.5)` and `(0.4, 0.5, 0.625)` both give `J_py = 0.125`; a volume measurement cannot distinguish them.

### 6.3 Directors, scan history and observables

An exploratory transversely isotropic law may use `D_py = gamma (n⊗n - I/3)`. Linking `gamma` or `n` to printing/texture requires evidence. A dose-weighted hatch tensor `<t⊗t>` should exclude laser-off jumps and retain overlapping/alternating passes. It is process metadata, not measured molecular alignment.

Report both local stress-free transformation and solved deformation. Include principal stretches, material-frame landmark lengths, strut diameters, volume and support motion. Define length shrinkage as `s = 1 - L_final/L_initial`; negative values represent lengthening. Bounding boxes alone mix rotation with deformation and are insufficient measures of anisotropy.

## 7. Mechanical models and initial scientific benchmarks

### 7.1 Prove the local coupling before the full Benchy

Begin with a long-strut radial reaction–transport benchmark and axisymmetric finite-strain mechanics. Compare a force-free axial response with a specified axial constraint. Any generalized-plane-strain reduction must be checked against a higher-dimensional solution and should not be applied silently to finite ends or junctions.

Then use free cubes, bonded pads, graded-state beams and bridges on transforming/compliant supports. Compare diameter, heating-path and precursor-state variations. This sequence isolates physical causes before a large complex geometry can obscure errors.

### 7.2 Full-object mechanics

An active-cell, voxel-conforming hexahedral finite-element mesh is the initial candidate, not a promised final choice. It matches the current volume while avoiding premature dependence on a general tetrahedral mesher. Benchmark bending, locking, curved boundaries and large contraction.

Use a consistent compressible finite-strain material law plus tested temperature/state-dependent relaxation. Solve quasi-static equilibrium in the reference configuration, `Div(P) = 0`, with nonlinear convergence, consistent tangents, line search and positive-Jacobian checks. Account for gas loads only through a consistent pressure/effective-stress convention when that model is enabled.

Use conjugate gradients only for appropriate positive-definite linearized systems. Buckling, some contact problems and indefinite tangents require another strategy. Reduced integration without stabilization is not an acceptable performance shortcut.

Boundary conditions must include free specimens with only rigid modes removed, bonded interfaces with explicit substrate motion/thermal expansion, and polymer supports that themselves transform. Add compliant foundations, sliding and calibrated finite adhesion as independent cases. Cooling remains part of the process.

Initially report stress and a labelled failure-risk diagnostic. Predicted cracks/delamination need appropriate damage/cohesive/contact laws with energy and mesh controls. Recorded imperfections and sensitivity studies are necessary for instability predictions. Evaluate omitted surface forces where softened or nanoscale features could make them important.

## 8. Carbon observables and interpretation

| Observable | Required definition |
| --- | --- |
| Retained char/solid | Conserved mass pools, not elemental purity |
| Elemental carbon content | Explicit composition and denominator |
| sp² fraction | Defined carbon phase/population and calibrated observation model |
| Network organization | Separately defined ordering/clustering descriptor |
| Texture | Directional distribution, not inferred automatically from geometry or hatch |
| Effective properties | State-dependent measured/fitted material relationships |

All modeled internal fields evolve during heating and can affect other modeled fields through declared closures. Distinct observables do not imply decoupled processes. Missing calibration should disable unsupported quantitative labels, not force us to exclude internal carbon-network evolution altogether.

Raman, EELS, XPS and atomistic descriptors measure or infer different things. Preserve acquisition metadata, uncertainty, sampling volume and definitions. Do not use a universal D/G-to-sp² conversion or identify elemental carbon percentage with bonding fraction. Mask undefined phase fractions rather than assigning false zeros.

Electrical resistance is a later useful observable: solve conduction on the deformed geometry with calibrated local conductivity. A black rendering or a single bonding fraction is not a conductivity model.

## 9. Browser architecture and proposed files

Preserve:

`React / Three.js ↔ TypeScript worker ↔ Rust/Wasm process cores`.

Suggested Rust modules:

```text
rust/reaction-lens/src/pyrolysis/
  mod.rs
  specimen.rs
  material.rs
  schedule.rs
  kinetics.rs
  thermal.rs
  transport.rs
  microstructure.rs
  shrinkage.rs
  mechanics/
    radial.rs
    mesh.rs
    constitutive.rs
    nonlinear.rs
  diagnostics.rs
```

Keep `whole_volume.rs` changes focused on specimen export and process-history accumulation. Add the owner/API through `lib.rs` and `wasm_api.rs`. Share versioned TypeScript contracts, for example in `app/pyrolysis-types.ts`.

Worker commands should cover preparation, configuration, start, pause/resume, cancel, reset and replay. Distinguish process stage from run status. Snapshots identify source checkpoint, mesh/run revision, sequence, physical time, temperature convention, selected fields/units, diagnostics and deformed geometry. Preserve checked copying before transferring Wasm-derived buffers.

The renderer must update physical positions/displacements and topology where required. Display decimation and opacity remain non-authoritative. The Reaction Lens needs a declared convention: a material-reference slice deforming with the specimen differs from a fixed spatial plane interpolated through the current solid.

Chemical, mechanical and display resolutions need not match, but mappings must be documented and tested. Nanometer-scale internal gradients cannot be claimed resolved on a coarse whole-object mesh. Use a validated reduced/subgrid model or report unresolved features.

## 10. Responsiveness, memory and reproducibility

A worker protects the main thread but cannot receive pause/cancel during one long synchronous solve. Make coupled work resumable across bounded chunks, with checkpoints, converged accepted steps and rollback/reduced increments after failures. Snapshot cadence must not affect the numerical trajectory.

Preflight peak memory for the precursor, mesh, chemical fields, history tensors, solver vectors, rollback and transfer copies. Avoid a dense stiffness matrix. Benchmark sparse/matrix-free approaches and preconditioners, checking dependency licenses and Wasm compatibility. Use suitable precision for conditioning and reductions; validate reduced-precision storage against native references.

The previous planning range of roughly 5,000–30,000 active 3D elements is only a range to investigate, not a browser capacity or accuracy promise. Minimum resolved strut thickness and convergence determine usefulness. Start smaller.

Reduce display detail and output frequency before reducing physical resolution. Conservative coarsening must preserve mass, connectivity and resolved voids. Do not silently delete struts, change material laws or fall back to scale animation. Use fallible allocation/preflight rather than assuming an out-of-memory abort can be recovered; the current release profile uses panic abort.

Diagnostics include mass/element-balance error, escaped/retained mass, transport resolution/status, mesh counts, minimum Jacobian, equilibrium residual, accepted/rejected steps, nonlinear work, time and memory/downgrade reason. Record initialization, tolerances, timestep policy, model/material version and source checksum. Distinguish same-build replay from cross-platform floating-point agreement.

## 11. Calibration and uncertainty

Begin calibration-data collection with implementation, not after the UI. Use an explicitly uncalibrated demonstration material until a named precursor/process is fitted. Do not pool IP-Dip, IP-Dip2, IP-Q, SU-8 or hybrid organic–inorganic resists into one undocumented preset.

Collect multi-heating-rate mass-loss data, initial/final mass and dimensions, interrupted thermal histories, density/porosity information and matched precursor-state/diameter series. Use relevant chemical/network characterization, mechanical relaxation/modulus data and interface measurements. Match spectroscopy sampling to predicted spatial averages.

Fit reaction yields/rates and transport jointly where identifiable; then free volume/density, directional transformation if supported, relaxation/interfaces and effective properties. Use held-out geometry and schedules. A final Benchy bounding box cannot identify all of these. Endpoint bonding measurements alone cannot calibrate a full transient.

Compare free, bonded and compliant-supported coupons. Rotate physical material directions relative to the numerical grid independently. Preserve uncertainty in transferring bulk measurements to microstructures and in the upstream cure model. Each material record needs source, preparation, units, ranges, fitting method, uncertainty, calibration status and known failure modes.

## 12. Verification and acceptance gates

| Test family | Required evidence |
| --- | --- |
| Units/schedule | Kelvin/seconds conversion, ramp/dwell/cool, correct specimen-temperature convention |
| Chemistry/transport | Analytic limiting cases, positive pools, mass/element conservation, correct surface fluxes and geometry scaling |
| Internal state | Defined fractions, no fabricated phase percentages, consistent selective-loss bookkeeping |
| Coupling | Controlled splitting error, conservative geometry updates, timestep/radial-grid convergence |
| Free mechanics | Zero stress under compatible free transformation, correct volume/mass/density relation, no thermal double counting |
| Anisotropy/objectivity | Rotated orthotropic controls, rigid-motion invariance, symmetry, patch/bending/tangent tests and refinement |
| Constraints | Correct reactions, moving/shrinking anchors, compliant supports, no accidental face clamp |
| Handoff | Off-target survivors accounted for, preparation ledger, no render-derived state or accidental welded/disconnected struts |
| Worker/rendering | Deterministic accepted-step replay, batching independence, stale-run rejection, pause/cancel/reset and consistent deformed views |
| Regression | Existing chemistry/parity/worker/build tests preserved, actual Wasm exercised in production worker |

Select numerical tolerances through precision studies and publish them with benchmarks. Passing analytic tests is not experimental validation. Report native/Wasm numerical agreement and solver work separately from display frame rate.

Retain `npm run test:rust`, `npm run lint:rust`, `npm run test:wasm-worker`, `npm run test:production-worker`, `npm run typecheck`, `npm run build`, `npm run validate:artifact` and the complete `npm test` sequence when implementation begins.

## 13. Staged implementation

### PR 1 — Specimen contract and reproducible coupon fixtures

Implement preparation, mass convention, units, material/provenance schema and retained-state contract. Add synthetic free/bonded/strut/support fixtures. Start collecting material data.

**Exit gate:** audited physical specimen and closed preparation ledger; assumptions about residual species and initial stress explicit.

### PR 2 — Internal transformation and radial transport core

Implement physical thermal history, mass-conserving reactions, evolving carbon-network state and conservative volatile transport. Establish well-mixed and radial limits, consistent free-density/volume closure and native tests. Preserve the distinction between a structural surrogate and measured sp² fraction.

**Exit gate:** converged internal-state and mass/flux trajectories with defined calibration status, not merely a final carbon color.

### PR 3 — Coupled finite-strain shrinkage and mechanics

Add radial/axisymmetric and then small 3D benchmarks, free/constrained axial responses, tensor-valued natural transformation, relaxation and transforming/compliant supports. Validate coupled convergence and symmetry before large Benchy runs.

**Exit gate:** correct free transformation, heterogeneous compatibility, rotated anisotropy controls, constraint reactions and moving-support cases. This remains the highest implementation-risk milestone.

### PR 4 — Integrated browser carbonization stage

Connect the core to worker/UI/deformed viewport/slice inspection. Add furnace and support controls, internal-state diagnostics, A/B replay and memory/fidelity status. Preserve exposure/development.

**Exit gate:** changes in geometry arise from the coupled Rust solver; unresolved chemistry or mechanics is disclosed. PRs 1–4 form the first useful simulator.

### PR 5 — Named-material validation and justified extensions

Complete held-out validation with uncertainty. Add pressure/pore-growth, spatial heating, sliding/adhesion, damage or nanoscale surface effects according to measured residual errors. Add quantitative bonding/property outputs as calibration supports them. Do not defer all internal chemistry until this milestone.

**Exit gate:** published validity envelope, independent errors and known failure cases for the named material/process.

### Later — Inverse design

Only after forward validation, optimize precursor geometry, supports, printing state or furnace history for a target carbon shape. Nonuniform constrained transformation requires repeated forward solves, not simply dividing STL coordinates by three scale factors.

## 14. Scope guardrails and next task

Do not ship global XYZ scaling labelled physics, temperature-only graphite percentages, hatch-to-graphite alignment, unaccounted disappearing mass, unsupported resin presets or decorative cracks. Do not substitute a coarse display field for resolved nanoscale chemistry.

**Recommended next implementation:** the specimen contract followed by a mass-conserving single-strut internal reaction–transport model and its free/constrained finite-strain mechanics. Proceed to the full Benchy only after the causal links and numerical limits are visible on simpler cases.

## References and provenance

**New primary-source review:** [PYROLYSIS_SERLES_PORTELA_REVIEW.md](PYROLYSIS_SERLES_PORTELA_REVIEW.md), with DOI/URL records and explicit access limits for Serles 2023/2025, Serles–Portela 2026, Portela 2021, Mao 2023 and Sharma 2018. Its proposed equations and implementation choices are not represented as experimentally validated by those papers.

**Earlier planning sources retained for context:**

- Cardenas-Benitez et al. (2019), *Pyrolysis-induced shrinking of three-dimensional structures fabricated by two-photon polymerization: experiment and theoretical model*. DOI `10.1038/s41378-019-0079-9`. https://www.nature.com/articles/s41378-019-0079-9
- Mori et al. (2023), *Pick and place process for uniform shrinking of 3D printed micro- and nano-architected materials*. DOI `10.1038/s41467-023-41535-9`. https://www.nature.com/articles/s41467-023-41535-9
- Sharipova et al. (2021), *Effect of pyrolysis on microstructures made of various photoresists by two-photon polymerization: comparative study*. DOI `10.1364/OME.416457`. https://nanolab.phys.msu.ru/sites/default/files/ome-11-2-371.pdf
- Ferrari and Robertson (2000), *Interpretation of Raman spectra of disordered and amorphous carbon*. DOI `10.1103/PhysRevB.61.14095`. https://journals.aps.org/prb/abstract/10.1103/PhysRevB.61.14095

These older citations are retained from the initial planning exercise, not a claim that every source was reread during this revision. Mori's thermolysis and the different precursor/process studies are not interchangeable inert-carbonization calibrations.

**Runtime inspection:** `README.md`, `package.json`, `rust/reaction-lens/Cargo.toml`, `rust/reaction-lens/src/lib.rs`, `rust/reaction-lens/src/wasm_api.rs`, relevant state/exposure/development sections of `rust/reaction-lens/src/whole_volume.rs`, worker protocol/scheduling sections of `app/simulation.worker.ts`, and `app/volume-visualization.js`, pinned to `9a70f6325c1cca53b1bb42cbeb31d75013dd4d4c`. The initial plan remains available in Git history at `81e9057b8a941ce509f01f3af351f9b086b67abe`.
