# Pyrolysis and carbonization simulator: implementation plan

**Status:** proposed design, not implemented or experimentally validated.  
**Inspection date:** 2026-09-18.  
**Inspected repository revision:** `9a70f6325c1cca53b1bb42cbeb31d75013dd4d4c` on `main`.  
**Scope of this change:** documentation only; no changes to the running laboratory, deployment, license, or WOFI registration. No local build or numerical tests were run for this planning exercise.

## 1. Product and scientific objective

Extend the existing process chain into:

**Slice → expose → develop → prepare a dry specimen → heat / carbonize → cool → inspect the final carbon structure.**

The central deliverable is a mechanically meaningful prediction of dimensional change: local thinning, directional contraction, shape distortion, support-induced stretching, and residual stress. This must not be a Three.js scale animation. The first implementation should solve a reduced, calibrated-or-explicitly-uncalibrated continuum model, with Rust owning every physical state variable.

For this repository, the initial material scope is **polymer-derived carbon from a printed organic precursor**, including glassy/disordered carbon. Chemical-vapor-deposited pyrolytic carbon, highly oriented graphite, and polymer-derived ceramics require separate material/process models. They must not silently share one generic “carbon” preset. Sharipova et al. report different outcomes for IP-Dip versus hybrid organic–inorganic photoresists [S3].

The product must distinguish three things:

1. **Chemistry:** what mass and chemical structure remain after a thermal history?
2. **Stress-free transformation:** how would each small material region change shape without mechanical constraints?
3. **Mechanics:** what shape is actually compatible with neighboring material, shrinking supports, substrate attachment, and relaxation?

A useful first release should answer: “Does this bridge become thinner, shorter, longer, bent, or highly stressed under this process, and which assumptions control the answer?” It should not claim atomically resolved carbon chemistry or universal accuracy for commercial resins.

## 2. Repository findings and integration constraints

The following observations are from the inspected revision, not assumptions about older project versions.

| Existing component | What is present | Consequence for pyrolysis |
| --- | --- | --- |
| `rust/reaction-lens/src/whole_volume.rs` | Authoritative dense 3D volume; conversion, remaining material, oxygen, radicals, initiator, exposure and development | Add a full-resolution specimen handoff here; do not put the entire new mechanical solver into this large file |
| `rust/reaction-lens/src/wasm_api.rs` | Wasm wrapper exposing exposure/development stepping and copied render/slice exports | Add a separate pyrolysis owner and a versioned handoff/snapshot API |
| `app/simulation.worker.ts` | Off-main-thread Wasm initialization, queues, step scheduling, diagnostics and checked buffer copies | Reuse worker ownership; add process states and resumable numerical work |
| `app/lab-interface.tsx` | Process controls and diagnostics | Add furnace, material, support and comparison controls without replacing the existing workflow |
| `app/lab-viewport.tsx`, `app/volume-visualization.js` | Visualization of existing chemistry; display activity and quantization | Add physically deformed geometry; display helpers must remain non-authoritative |
| Rust and worker tests | Deterministic replay, chemistry/reference checks, snapshot/worker/build tests | Preserve these and add independent mechanics and carbonization tests |

The maximum chemistry grid is `128 × 72 × 104` (958,464 cells). Its physical voxel pitches are not exactly equal in X, Y and Z. The renderer samples at most 60,000 voxels; those samples are **not** a complete physical specimen. The worker currently selects approximately 8–64 MiB for the volume, with a 32 MiB fallback. These are existing volume budgets, not evidence that a coupled mechanical problem fits in the same memory.

The current production solver has no temperature, displacement, stress, carbonization or carbon-order state. The Rust crate has no existing finite-element or linear-algebra subsystem to reuse. The bundled Benchy occupancy is prepared offline; arbitrary uploaded STL execution is not implemented. Synthetic cubes, pillars and bridges can therefore be introduced directly as test fixtures rather than making arbitrary mesh import a prerequisite.

The README describes empirical/nondimensional chemistry, while the current volume also accumulates path-derived exposure seconds. Do not inherit an ambiguous time scale. Define physical pyrolysis time explicitly in seconds and document the upstream chemistry's lack of material calibration separately.

### A critical handoff issue

`remaining` is normalized and starts at one, including initially unexposed resin. During development, inactive off-target material is removed, while target cells and active off-target cells are treated separately. It is not an independently measured dry mass density. Neither CAD occupancy, `remaining` alone, nor the renderer's visibility threshold is an adequate definition of the load-bearing pyrolysis specimen.

A specimen preparation step must resolve this before any physical carbon yield is reported. It must include surviving off-target polymer, distinguish low-cure residue from a solid network, and account for material removed by preparation. It must also state that washing/drying has completed. The existing simulation does not supply drying shrinkage or cure-induced residual stress; an initially stress-free dry reference is therefore an explicit assumption unless additional data are supplied.

## 3. What the literature changes about the design

| Evidence | Design implication and limitation |
| --- | --- |
| Cardenas-Benitez et al. study pyrolyzed TPP SU-8 bridges and report thinning together with approximately 14% axial elongation as anchoring structures move [S1] | Supports must be allowed to shrink and move. This is a valuable bridge benchmark, not an IP-Dip calibration |
| Mori et al. show that substrate pinning and receiving-surface properties affect the uniformity of thermally shrunk TPP structures [S2] | Compare released and attached specimens. Their thermolysis experiment is not interchangeable with an inert high-temperature carbonization dataset |
| Sharipova et al. compare different resins, dimensions, adhesion and elemental composition after argon treatment [S3] | Material identity, geometry and process conditions belong in each calibration record; do not pool unlike resins |
| Sharma et al. observe evolving, disordered glassy-carbon microstructure during in-situ heating [S4] | Carbonization and carbon-network ordering require separate state descriptions; sp²-rich does not mean perfectly graphitic |
| Ferrari and Robertson analyze Raman signatures across different disordered-carbon regimes [S5] | Do not interpret the D band as an sp³ peak or convert a single D/G ratio into a universal sp² percentage |

These papers motivate the architecture and possible validation cases. They do not collectively provide a calibrated parameter set for the current repository's generic resin. The equations below are a proposed model design, not a claim that one cited paper has already validated the whole coupled solver.

## 4. Authoritative dry-specimen contract

Add an owned, versioned `DevelopedSpecimen` representation inside Rust. Its fields should include reference geometry and units, solid volume/mass information, retained cure field, material IDs, connected components, substrate/interface labels, and provenance of the source run. Where available, retain dose-weighted scan-direction statistics as process metadata, not as a measured molecular orientation.

Define the mass convention once. For example, an initial reference cell mass may be computed from dry solid density, cell volume and a solid volume fraction. If `remaining` is used to derive that fraction, do not multiply the same factor into density again. Record material excluded by thresholding/preparation, and expose sensitivity to the load-bearing extraction rule. Small disconnected residues cannot silently become stiff carbon bridges.

Use the full authoritative arrays. Provide a Rust-to-Rust transition or equivalent lossless owned transfer, not a round trip through the 8-bit render snapshot. The contract should preserve the actual non-cubic physical pitch. Mechanical coarsening must conserve retained mass and preserve connected struts and resolved voids. Point/edge-only voxel contacts require an explicit connectivity rule rather than accidentally welding solids through a shared node.

The initial version should assume a washed, dry specimen. Unsupported trapped liquid or incomplete development should be rejected or handled through a clearly identified residue model. The radical/oxygen fields used during photopolymerization must not be reinterpreted as furnace atmosphere or gas pressure.

Save this immutable handoff so alternative furnace schedules, support conditions and material fits can be replayed without rerunning the exposure. Include source checksum, source parameters, geometry scale, extraction policy, material-data version and solver revision.

## 5. Thermal history and mass-conserving chemistry

### 5.1 Start with the simplest justified temperature model

The UI should accept a ramp/hold/cool schedule in °C and minutes while the solver uses Kelvin and seconds. Spatial dimensions convert from micrometers to meters at one documented boundary; stresses use pascals and masses use kilograms.

Version one should support either a prescribed **specimen** temperature history or a lumped specimen heat balance with an explicit furnace temperature and lag. A displayed furnace temperature must not be mistaken for the temperature used by the reactions.

Evaluate thermal diffusion time `L²/a`, ramp/reaction time scales, and the relevant Biot number before paying for a spatial heat equation. Near-isothermal conditions are a valid outcome; do not manufacture large gradients to make the visualization more dramatic. Add spatial conduction, substrate thermal contact and reaction enthalpy when scale/conditions or validation data require them. Any later energy balance must consistently include changing mass, deformed geometry and the enthalpy convention for released gas.

Atmosphere and pressure should be recorded from the beginning. The first supported physics should be inert carbonization within a stated calibration envelope. Do not expose an “air” or “vacuum” switch that purports to change the physics without the corresponding oxidation or transport model.

### 5.2 Reduced reaction network

Start with a small mass-conserving network of precursor, intermediate and char pools with volatile-release pathways. Fit the number of pathways to data rather than adding reactions for visual complexity. A generic rate form is:

`r_j = A_j exp[-E_j / (R T)] f_j(material state, initial cure)`

The units of `r_j` and its mass/stoichiometric factors must be explicit. Positive, bounded implicit or adaptive integration is preferable to large explicit steps through a steep temperature-dependent reaction interval.

For the initial inert closed bookkeeping system:

`initial specimen mass = remaining solid + retained gas + cumulative escaped gas`.

When immediate gas escape is assumed, retained gas is zero by model definition, not an untracked loss. Char yield is a mass yield, not a statement that the residue is 100% elemental carbon. Oxidation, when added, needs incoming oxygen and outgoing product mass in the ledger.

Use multi-heating-rate thermogravimetric data to identify kinetics. Cure dependence is an optional fitted relationship, not a hardcoded rule that “less cured always shrinks this much more.” A generic demonstration dataset must be called uncalibrated; it must not carry a vendor resin name.

### 5.3 Density, porosity and volatile transport

Keep retained solid mass, stress-free density and unresolved internal porosity distinct. Macroscopic pores already represented by empty mesh space must not also be counted as internal material porosity.

Initially, assume a documented gas-escape regime. If size-dependent transport matters, add a conservative volatile transport model with evolving diffusivity/permeability, storage and boundary fluxes. Pressure requires a thermodynamic/storage closure, not merely an arbitrary scalar proportional to decomposition rate.

Do not simultaneously apply an empirical size-dependent char-yield correction and a transport/secondary-reaction model for the same mechanism without refitting; that would double-count the effect. Source [S1] offers a size-dependent empirical reference, not a universal transport law.

## 6. Anisotropic shrinkage: the central model

### 6.1 Separate sources of directionality

The solver must distinguish **intrinsic material directionality**, **spatially heterogeneous conversion/densification**, **mechanical constraints**, and **numerical grid bias**.

An initially isotropic material with isotropic local free shrinkage can deform anisotropically when attached to a substrate. A free specimen can distort when its cure/density fields vary spatially. Neither effect is evidence of anisotropic carbon bonds. Likewise, the elongated optical PSF influences the precursor geometry and cure field; it is not itself a measured graphite orientation.

Default intrinsic anisotropy to zero. Introduce nonzero directional material parameters only in explicitly hypothetical or experimentally fitted profiles.

### 6.2 Finite deformation, not small-strain scaling

Let `X` be a point in the dry reference specimen, `x = X + u(X)` its current location, and `F = ∂x/∂X` its deformation gradient. Use finite deformation so a large reduction in size does not violate the assumptions of the mechanical solver.

The baseline decomposition is `F = F_e F_nat`, with stress-free transformation `F_nat = F_th F_py`. A later finite-strain relaxation model may introduce an additional viscous factor, for example `F = F_e F_v F_th F_py`. Its free energy, evolution law, frame conventions and dissipation must be derived and tested together. Do not mix unrelated small-strain creep formulas into a finite-strain code.

Represent pyrolysis's stress-free transformation by:

`E_py = (ln J_py / 3) I + D_py`, with `tr(D_py) = 0`,

`F_py = exp(E_py)`.

Here `J_py` controls free volume change, while the symmetric, trace-free tensor `D_py` controls the directional distribution of that change. Equivalently, `F_py = Q diag(λ1, λ2, λ3) Qᵀ`, with positive principal stretches and directors attached to the material rather than world-screen axes.

### 6.3 Tie free volume change to mass and density

For one retained material region, evaluated consistently at the same reference temperature:

`J_py = (m_s / m_0) (ρ_0,ref / ρ_free,ref)`.

If porosity is used, define `ρ_free,ref = (1 - φ_micro) ρ_skeleton,ref`. Thermal expansion is handled separately by `F_th`; do not include it again through a temperature-expanded density in this equation.

Actual current density is `m_s / (det(F) V_0)`. Mechanical constraints can make actual volume differ from the stress-free volume, so do not overwrite `det(F)` with `J_py` after solving equilibrium.

Either fit independent free stretches and infer the associated density consistently, or fit mass/density and constrain their product. Carbon yield, density, porosity and three free shrink factors cannot all be independent unconstrained sliders.

A mathematical illustration, not a resin preset: `J_py = 0.125` permits isotropic stretches `(0.5, 0.5, 0.5)` or anisotropic stretches `(0.4, 0.5, 0.625)`. Both retain one eighth of the original free volume. A volume ratio alone cannot identify the three directional contractions.

### 6.4 Material directors and scan history

A first directional law could be transversely isotropic about a known material director `n`, using `D_py = γ (n⊗n - I/3)`. More general orthotropy can be added after rotated-coupon tests.

Optionally accumulate a normalized dose-weighted hatch tensor `A_h = <t⊗t>`, excluding laser-off jumps, and use it as a candidate explanatory feature. It must be labelled scan history, not molecular alignment. Alternating hatch directions, overlapping passes and gradients cannot be reduced reliably to one global hatch angle. Any coefficient connecting this feature to shrinkage needs calibration or an explicit hypothetical status.

Hold reference directors fixed initially. Introducing director evolution or texture formation requires a separate objective evolution law. Do not assign graphite basal planes directly from toolpath tangents.

### 6.5 Observable versus free shrinkage

Expose both the stress-free transformation and the actual solved deformation. Report local principal stretches, selected landmark distances, strut diameters, final volume and support motion. Define reported length shrinkage as `s = 1 - L_final/L_initial`; a negative value correctly represents lengthening.

Global bounding-box changes are useful geometric diagnostics but can mix deformation with rotation. They must not be the only “anisotropy” metric. Compare in the specimen's material/reference frame and retain reference-to-current correspondences.

## 7. Mechanical solver and boundary conditions

Use a voxel-conforming, active-cell hexahedral finite-element mesh as the first candidate. It matches the current reference volume and avoids introducing a general tetrahedral mesher before proving the mechanics. Benchmark this choice; it is a proposal, not a measured browser performance result.

Start with compressible hyperelasticity under the imposed stress-free transformation, then add a calibrated finite-strain viscoelastic law for temperature- and conversion-dependent relaxation. Permit a softening/stiffening transition through the process rather than assuming monotonically increasing modulus. Keep elastic anisotropy separate from shrinkage anisotropy: the latter does not justify using graphite's elastic constants.

Solve quasi-static equilibrium in the reference configuration, `Div(P) = 0`, with robust nonlinear iterations, line search and positive-Jacobian checks. Use consistent constitutive tangents and appropriate linear solvers. Conjugate gradients is suitable only where the linearized problem is positive definite; buckling and some nonlinear/contact configurations need another strategy. Test locking and bending performance; reduced-integration elements without stabilization are not an acceptable shortcut.

The first mechanical boundary conditions should be:

- **Free specimen:** remove only rigid-body modes, without accidentally clamping a face.
- **Bonded base:** attach the actual interface to a substrate with an explicit prescribed or solved motion/thermal expansion.
- **Shrinking polymer supports:** retain these in the same transforming solid so anchor motion emerges rather than being suppressed.

Add frictionless sliding and calibrated finite adhesion next. Cooldown belongs to the simulated process, since the final stress state is not determined by the peak-temperature shape alone. Uniform contraction constrained by a substrate does not automatically imply compressive stress everywhere; the solver must determine the sign.

Initially, report stress and a clearly identified failure-risk indicator. Do not display predicted cracks or delamination unless cohesive/damage/contact laws with suitable energy and mesh-resolution controls are implemented. For buckling, use controlled, recorded imperfections and sensitivity tests rather than random visual wobble. At very small or softened features, evaluate whether surface forces or other omitted physics dominate before claiming quantitative accuracy.

## 8. Carbon bonding, sp² and properties

Keep these observables separate:

| Variable | Meaning | First-release treatment |
| --- | --- | --- |
| Retained solid/char mass | Amount left after release pathways | Conserved reduced-kinetics state |
| Elemental carbon fraction | Carbon atoms or mass relative to other elements | Only available with a composition model/data |
| `f_sp2` | Fraction of carbon in the defined phase assigned to sp² bonding | Optional calibrated quantity; otherwise unavailable, not an invented percentage |
| Carbon-network order | Clustering/ordering descriptor of the carbonized phase | Separate phenomenological state with its own validity label |
| Texture | Directional distribution of carbon structural units | Not inferred automatically from hatch orientation |
| Conductivity, stiffness, thermal transport | Effective physical properties | Separate measured/fitted constitutive relationships |

Do not initialize all polymer carbon as “0% sp²” by definition: precursor bonding and phase definitions must be accounted for. Where only char-phase information is available, mask the field outside that phase rather than inventing a whole-specimen fraction.

Order can evolve after major mass loss has slowed, so its state cannot be identical to decomposition progress. A bounded phenomenological order law is acceptable as an uncalibrated demonstrator; an actual sp² percentage requires an appropriate measurement model. Raman D/G information needs regime and excitation-wavelength context [S5]. XPS/EELS or other characterization can provide complementary constraints, with method-specific uncertainty. Elemental carbon percentages are not hybridization percentages.

Electrical resistance could later be computed by solving conduction on the deformed structure using calibrated local conductivity. It should not be inferred from a black rendering color or from a universal “conductivity = sp² fraction” rule.

## 9. Browser implementation and proposed file map

Keep the existing architecture:

`React / Three.js ↔ TypeScript worker ↔ Rust/Wasm process cores`.

Add a separate Rust module tree, for example:

```text
rust/reaction-lens/src/pyrolysis/
  mod.rs
  specimen.rs
  material.rs
  schedule.rs
  kinetics.rs
  thermal.rs
  microstructure.rs
  shrinkage.rs
  mechanics/
    mesh.rs
    constitutive.rs
    nonlinear.rs
  diagnostics.rs
```

Modify `lib.rs` and `wasm_api.rs` for the new core/owner. Keep `whole_volume.rs` changes narrowly focused on the specimen export and any optional process-history accumulation. Introduce shared TypeScript contracts such as `app/pyrolysis-types.ts` rather than duplicating another unversioned protocol in several files.

Extend the worker with preparation/configuration/start/pause/resume/cancel/reset commands and an explicit process stage separate from run status. A snapshot should identify source checkpoint, run/mesh revision, sequence, physical time, temperature interpretation, selected field and units, and deformed geometry. Preserve range checks and copying before transferring Wasm-derived arrays.

The current renderer receives essentially fixed geometry at slicing time. Pyrolysis requires updated physical positions or displacements and the topology needed to reconstruct them. Do not represent contraction by lowering voxel opacity or visual activity. Mesh decimation is a display operation with a mapping back to solved state, never the authoritative mechanical mesh.

The Reaction Lens needs a declared slice convention. Initially, a material-reference slice can deform with the specimen. A spatial XY slice through the deformed body is a different query requiring interpolation; do not show an undeformed reference array under an unlabelled current-space cutting plane.

### Responsiveness, memory and reproducibility

A worker avoids blocking the main thread, but one long synchronous nonlinear solve still prevents the worker from receiving pause/cancel messages. Make numerical work resumable across bounded chunks and accept physical steps only after convergence. Rejected steps must restore a checkpoint and reduce the timestep or solver increment; snapshot cadence must not alter the numerical trajectory.

Preflight peak memory for the precursor, mechanics mesh, state/history tensors, solver vectors, rollback state, and transfer copies. Budgeting only the chemistry fields is insufficient. Avoid a dense global stiffness matrix; benchmark sparse/matrix-free approaches and their preconditioners. Inspect any added dependency's license, Wasm compatibility and pinned version.

An initial mechanics target of roughly 5,000–30,000 active elements is a **benchmark range to investigate**, not a promised capacity or accuracy. Minimum resolved strut thickness and convergence must govern whether that range is useful. Start smaller where necessary. Use f64 where numerical conditioning/reductions require it; validate any f32 storage choices against the native reference.

Reduce output frequency and display detail before reducing physical resolution. When physical coarsening is necessary, disclose it and preserve mass/connectivity. Do not silently remove thin members, change material laws, or substitute a scale animation. Use fallible allocation/preflight rather than expecting an out-of-memory abort to be recoverable; the current release profile uses panic abort.

Diagnostics should include mass-balance error, retained/escaped mass, mesh counts, minimum Jacobian, equilibrium residual, accepted/rejected steps, nonlinear iterations, current physical time, memory and downgrade reason. Record model/material version, timestep policy, tolerances, mesh tier, initialization and source checksum. Reproducibility claims should distinguish same-build deterministic replay from cross-platform floating-point agreement.

## 10. Calibration and identifiability

The main scientific unknown is the **specific precursor plus its preparation and furnace process**. Begin the code with a plainly labelled synthetic/demo material, while collecting one named material dataset. Do not rename a generic fit “IP-Dip,” combine IP-Dip and IP-Dip2 indiscriminately, or apply an SU-8 experiment as validation of the existing generic exposure chemistry.

A proposed minimum experimental program is multi-heating-rate TGA/DTG, retained density/porosity information, and before/after three-dimensional measurements of released and bonded coupons. Three or more heating rates would be a useful starting design, not a guarantee of kinetic identifiability. Interrupted schedules help separate early softening, mass loss and later ordering. Mechanical relaxation, modulus evolution and interface measurements are needed for stress-sensitive predictions. Raman with acquisition metadata and complementary carbon characterization is needed for bonding/order claims.

Use free cubes/pillars with rotated writing orientations, bonded pads, suspended bridges with deformable supports, and deliberately graded-cure beams. Rotate specimens relative to the numerical grid independently of material directions to detect mesh bias. Holding furnace conditions fixed while changing attachment helps distinguish intrinsic shrinkage from constraint effects. Bulk material data may not transfer perfectly to microstructures; preserve that uncertainty.

Fit in stages: reaction yields/rates; free volume/density change; directional free shrinkage if supported; relaxation and interfaces; then carbon-order/property relationships. Validate on held-out geometry and thermal histories. One final Benchy bounding box cannot identify all these parameters. Shrinkage measurements alone cannot uniquely separate density, mass loss, porosity and mechanical constraint.

Every material record should store source, specimen preparation, parameter units, validity ranges, fitting method, uncertainty, and calibration status. Disable quantitative labels for missing observables. Experimental acceptance should be tied to measurement uncertainty and held-out error, not an unsupported universal percentage claim.

## 11. Verification and acceptance gates

| Test family | Required evidence |
| --- | --- |
| Chemistry and units | Analytic single-reaction limits; Kelvin conversion; schedule/dwell/cool handling; nonnegative pools; mass conservation; no unsupported atmosphere interpretation |
| Free deformation | Zero stress for a compatible free isotropic transformation; prescribed orthotropic stretch; correct mass/density/volume relation; no double-counted thermal expansion |
| Objectivity and mesh | Rotated material/specimen tests; rigid-motion invariance; finite-element patch and bending tests; tangent checks; positive Jacobians; refinement/time-step studies |
| Constraints | Isotropic material produces constraint-induced directional deformation; correct interface reactions; shrinking supports move anchors; free specimens are not accidentally clamped |
| Handoff | Target and off-target survivors accounted for; extraction mass ledger; no 8-bit physics; no invented connections or lost struts under coarsening |
| Carbon observables | Missing sp² calibration produces unavailable/estimated status, not a fabricated percentage; elemental carbon and bonding remain distinct |
| Worker and rendering | Deterministic accepted-step replay; batching/snapshot independence; pause/cancel/reset; stale-run rejection; valid immutable buffer transfer; both views use the same deformed state |
| Regression/build | Existing chemistry/parity/renderer tests remain valid; actual Wasm emitted and exercised in the production worker |

Choose numerical tolerances from precision studies, and publish them with each benchmark. Do not claim experimental accuracy from passing analytic tests. Benchmark native and Wasm on the same problem and settings, reporting element counts and solver work separately from display frame rate.

Existing commands to retain include `npm run test:rust`, `npm run lint:rust`, `npm run test:wasm-worker`, `npm run test:production-worker`, `npm run typecheck`, `npm run build`, `npm run validate:artifact` and the complete `npm test` sequence.

## 12. Staged delivery plan

### PR 1 — Specimen contract, units and benchmark fixtures

Implement the full-resolution dry-specimen handoff, mass convention, provenance, material schema and synthetic free/bonded coupon fixtures. Document preparation and initial-stress assumptions. Add unit and extraction tests. Begin collecting calibration data immediately.

**Exit gate:** an audited specimen with physical dimensions and a closed preparation mass ledger; no renderer-derived physics.

### PR 2 — Thermal schedule and reduced carbonization core

Implement physical time, prescribed/lumped specimen temperature, mass-conserving reaction pools, density/free-volume closure, and separately labelled carbon-order state. Support native tests and deterministic replay. Do not yet advertise a shape predictor from a displayed shrink factor.

**Exit gate:** verified mass/temperature/reaction trajectories and a documented calibration status for every output.

### PR 3 — Finite-strain anisotropic mechanics

Implement the hexahedral benchmark solver, stress-free tensor decomposition, free/bonded boundary conditions and transforming supports. Add the initial relaxation model only with objective, dissipative updates and tests. Resolve nonlinear convergence, rigid modes, mesh bias and large-contraction failures before proceeding to a complex Benchy demonstration.

**Exit gate:** isotropic control, rotated orthotropic cube, attached pad and moving-anchor bridge behave correctly under verification/refinement. This is the highest implementation-risk milestone.

### PR 4 — Integrated browser pyrolysis stage

Connect the new core to the existing worker, controls, deformed viewport and labelled slice inspection. Add temperature/mass/stretch/stress diagnostics, A/B comparison, reset/replay, exported run metadata and clear memory/fidelity status. Keep exposure and development intact.

**Exit gate:** the same developed specimen can be compared under different schedules and supports, with shape changes produced by the Rust solver rather than rendering logic. PRs 1–4 constitute the first useful shrinkage simulator.

### PR 5 — Named-material validation and justified extensions

Fit and validate the first named precursor/process. Prioritize slipping/adhesive interfaces, spatial heating or gas transport according to observed residual errors. Add calibrated sp²/property outputs only when data justify them. Treat fracture/delamination and nanoscale surface-force effects as separate validated features, not automatic consequences of a stress heatmap.

**Exit gate:** held-out measurements, uncertainty, validity envelope and known failure cases published with the material profile.

### Later — Inverse process/geometry design

After forward validation, optimize precursor shape, support design, hatch strategy or thermal schedule to achieve a final carbon geometry. A constrained, nonuniformly shrinking structure requires repeated forward solves; inverse compensation is not merely dividing STL coordinates by three scale factors.

## 13. First demonstration and scope guardrails

Use a small coupon set before the full Benchy: a free isotropic cube, the same material bonded at its base, a free explicitly orthotropic cube, and a bridge on shrinking supports. These isolate volume closure, constraint-induced anisotropy, intrinsic anisotropy and anchor motion. Only then run the developed Benchy as an integration/visualization case.

Do not ship global XYZ scaling labelled physics, a temperature-only “percent graphite” slider, hardcoded hatch-to-graphite alignment, uncited vendor presets, unaccounted disappearing mass, or decorative cracks. The first release can be scientifically useful while still saying clearly that its material parameters are uncalibrated.

**Recommended next implementation task:** PR 1 followed by the native free/attached-coupon mechanics work. The governing priority is correct anisotropic and constrained deformation, not a more elaborate carbon color scheme.

## References and inspection provenance

**[S1]** Cardenas-Benitez et al. (2019), *Pyrolysis-induced shrinking of three-dimensional structures fabricated by two-photon polymerization: experiment and theoretical model*, Microsystems & Nanoengineering 5, 38. DOI: `10.1038/s41378-019-0079-9`. Primary article: https://www.nature.com/articles/s41378-019-0079-9

**[S2]** Mori et al. (2023), *Pick and place process for uniform shrinking of 3D printed micro- and nano-architected materials*, Nature Communications 14, 5876. DOI: `10.1038/s41467-023-41535-9`. Primary article: https://www.nature.com/articles/s41467-023-41535-9 ; author-institution record: https://repository.sutd.edu.sg/esploro/outputs/journalArticle/Pick-and-place-process-for-uniform/9911274509846

**[S3]** Sharipova et al. (2021), *Effect of pyrolysis on microstructures made of various photoresists by two-photon polymerization: comparative study*, Optical Materials Express 11, 371–384. DOI: `10.1364/OME.416457`. Author-hosted full text: https://nanolab.phys.msu.ru/sites/default/files/ome-11-2-371.pdf . Tables on printed page 377 were checked in the PDF rendering.

**[S4]** Sharma, Shyam Kumar, Korvink and Kübel (2018), *Evolution of Glassy Carbon Microstructure: In Situ Transmission Electron Microscopy of the Pyrolysis Process*. Author manuscript: https://arxiv.org/abs/1801.01785 . Used for qualitative microstructure evidence, not numerical sp² calibration.

**[S5]** Ferrari and Robertson (2000), *Interpretation of Raman spectra of disordered and amorphous carbon*, Physical Review B 61, 14095. DOI: `10.1103/PhysRevB.61.14095`. Primary article: https://journals.aps.org/prb/abstract/10.1103/PhysRevB.61.14095

**Repository inspection:** `README.md`, `package.json`, `rust/reaction-lens/Cargo.toml`, `rust/reaction-lens/src/lib.rs`, `rust/reaction-lens/src/wasm_api.rs`, relevant state/exposure/development sections of `rust/reaction-lens/src/whole_volume.rs`, worker protocol/scheduling sections of `app/simulation.worker.ts`, and `app/volume-visualization.js`, all pinned to `9a70f6325c1cca53b1bb42cbeb31d75013dd4d4c`. UI integration paths were identified from the repository map; this planning exercise was not a browser execution test or an exhaustive audit of every UI file.
