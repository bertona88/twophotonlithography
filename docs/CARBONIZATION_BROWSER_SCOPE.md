# Carbonization Lab: ambitious, browser-feasible scope

**Date:** 2026-09-19.  
**Status:** proposed product and engineering scope; not implemented, benchmarked or experimentally calibrated.  
**Runtime revision checked:** `9a70f6325c1cca53b1bb42cbeb31d75013dd4d4c` (`main`).  
**Companion documents:** [coupled physical model](PYROLYSIS_CARBONIZATION_PLAN.md), [Serles / Portela review](PYROLYSIS_SERLES_PORTELA_REVIEW.md).  
**Change scope:** this document only. No runtime, deployment, license or registration changes; no build or numerical tests performed.

## Product decision

Build a **coupled continuum Carbonization Lab**, not atom-by-atom furnace simulation and not a global XYZ shrink animation. Users should heat a developed polymer structure, inspect spatial internal transformation while it happens, and see how that transformation changes dimensions, curvature and stress.

The ambition is a complete process loop:

**Printing state → developed dry specimen → chemistry and volatile transport → evolving carbon network / density / mechanical response → deformation → updated transport geometry.**

The practical compromise is controlled physical resolution and calibrated effective material laws. It is not a claim that every molecular pathway or every nanometer of a large object will be explicitly resolved.

## What can be reused

The checked `README.md`, `app/simulation.worker.ts` and `rust/reaction-lens/src/wasm_api.rs` confirm the existing Rust/Wasm ownership, worker scheduling, checked buffer copying and two views of one authoritative volume. They also show no carbonization process API or evolving mechanical geometry yet. The worker currently budgets approximately 8–64 MiB for the chemistry volume (32 MiB fallback), schedules bounded batches, and normally limits snapshot publication to one per 100 ms. These are current implementation policies, not pyrolysis performance benchmarks.

Retain React/Three.js for controls and rendering, the TypeScript worker for scheduling and buffer transfer, and Rust for physical state and accepted numerical steps. Add a `PyrolysisCore`; do not rewrite working exposure/development to begin this milestone. A lossless, owned Rust specimen handoff is required: normalized `remaining` or a rendered voxel sample is not a calibrated dry specimen mass.

## First integrated release

### 1. Furnace schedules and repeatable runs

Provide ramps, holds and cooling; explicit specimen temperature versus furnace temperature; pause, cancel, replay and saved checkpoints. Use SI units internally, with familiar °C, minutes and micrometers in controls. Begin with prescribed specimen temperature or a documented lumped thermal lag. Keep spatial heating optional where timescale tests justify the simpler model.

Support one stated inert-process regime initially. Record atmosphere, pressure and specimen preparation, but do not expose unsupported oxidation, vacuum pumping or furnace-flow effects as if they were solved. Reusing the same immutable developed specimen allows controlled A/B schedule comparisons.

**User experiment:** compare two paths to the same peak temperature and see whether their retained gas, internal carbon state and final deformation differ under the chosen model. This is motivated by the modified early schedule reported for large Schwarzite samples in [S2], not a guarantee of a particular outcome for every material.

### 2. Spatial chemistry and volatile escape

Use a small, fitted reaction network with nonnegative precursor/intermediate/char pools and mobile products. Track the mass stored locally and released through boundaries. A first reduction may lump volatile products together; claim species-specific or elemental predictions only when stoichiometry and measurements support them.

Solve conservative transport through the current geometry, or through an exactly consistent reference-coordinate transformation. Distinguish the exterior connected to the furnace atmosphere from closed cavities. Do not remove gas at every empty voxel or assume every pore is connected to an infinite sink. Begin with simple open specimens and explicitly restrict unsupported closed-cavity cases.

Transport can produce different surface and interior histories even when temperature is prescribed uniformly. Do not paint a fixed shell or apply a universal radius-dependent reaction multiplier. Serles et al. [S1] report diameter-dependent internal bonding differences, but their endpoint measurements do not uniquely identify the transient reaction and diffusion laws.

**Baseline volatile-feedback contract:** the first material profile uses one-way chemistry → mobile-product coupling unless a profile explicitly enables and defines volatile-to-solid feedback. A gradient in retained mobile products does not by itself imply a gradient in precursor conversion, char yield or carbon-network state. For a homogeneous precursor at prescribed uniform temperature with rates independent of mobile-product concentration, the solid reaction history must remain spatially homogeneous even when mobile-product concentration and escape flux are not. Any profile that lets retained products alter solid evolution must name the closure (for example secondary-char formation or product-dependent rates), its parameters, calibration status and limiting behavior. Verification must include a no-feedback homogeneous-solid control plus conservation and spatial/time-convergence tests for every enabled feedback closure.

**User experiment:** vary precursor strut diameter, initial printing state, diffusivity and ramp profile, then inspect computed radial/3D concentration gradients and escaped-mass curves. Distinguish mobile-product gradients from solid-state gradients and show which declared feedback, if any, couples them.

### 3. Evolving internal carbon material

Include carbon-network evolution in the coupled state from the start. Use a modest set of effective variables for bonding/network organization and unresolved porosity, alongside chemistry. These feed documented relationships for stress-free density, diffusivity/permeability, elasticity and relaxation. Parameters can be hypothetical demonstration parameters until a named-material fit exists; the model must not hide that status.

An actual sp² fraction requires a defined retained-carbon numerator and denominator and a measurement model. Otherwise display a labelled carbon-network/order variable rather than a fabricated percentage. Keep bonding fraction separate from cluster organization and texture. Do not infer graphite alignment from the hatch tangent or initialize aromatic precursor carbon incorrectly.

Distinguish unresolved material porosity from architectural holes already represented geometrically. Couple mass, density and porosity consistently. Do not set all three freely or count resolved pore volume twice. Allow nonmonotonic stiffness/relaxation trajectories rather than a universal linear interpolation from polymer to carbon; [S4] motivates resolving intermediate transformation regimes.

**User experiment:** inspect a core and a surface region through the heating history and compare material state, mass and density, not only their color.

### 4. Finite-strain deformation with anisotropic outcomes

This is the highest-risk engineering component and should not be postponed until after a polished furnace animation.

Separate the local stress-free transformation from the actual mechanically compatible deformation. Preserve the mass/density relation, at one reference temperature:

`J_py = (m_s / m_0) * (rho_0 / rho_free)`.

Distribute the stress-free volume change through a positive tensor-valued transformation. Start with isotropic local transformation as a control; enable independently specified material-frame directional parameters only in explicitly hypothetical or calibrated profiles. Local state variation and boundary constraints can already produce direction-dependent whole-specimen deformation.

Solve quasi-static finite-strain equilibrium with state- and temperature-dependent relaxation. Keep thermal expansion separate from chemical contraction. Use free, bonded and compliant-support cases, including transforming printed supports. The moving-anchor wires in [S3] provide a useful validation geometry, not a universal shrink law.

Report directional landmark changes, principal stretches, strut thickness, curvature, support motion, stress and final dimensions after cooling. A shortening material region can participate in a globally lengthening bridge; a symmetric homogeneous free control must not bend without physical asymmetry or a resolved instability. Rotating the numerical grid must not create material anisotropy.

Begin with active-cell hexahedral finite elements for small 3D solids. Address bending/locking, rigid modes, nonlinear convergence, positive Jacobians and consistent tangents before complex objects. Use linear solvers suitable for the actual tangent; do not assume every nonlinear problem is positive definite. Later beam/shell reductions need separate verification of bending, torsion, junctions and evolving sectional state.

**User experiment:** compare the same polymer under free, base-bonded and compliant/shrinking-support conditions, with intrinsic anisotropy held fixed.

### 5. A Carbonization Lens and comparison dashboard

Extend the existing section view into a cutaway of the authoritative deformed state. Select retained precursor/char, mobile products, carbon-network state, porosity/density, temperature, principal strain or stress. Add a movable material probe, a radial/line profile, mass-loss and temperature plots, and before/after geometry overlays.

The lens is not an independently tuned animation. A material-reference slice that moves with the object must be labelled differently from a fixed spatial plane through the deformed body. Every snapshot needs run ID, accepted time, mesh revision, units, model version and calibration/fidelity status.

Provide save/export of configuration, source checkpoint, selected numerical fields, measurements and deformed geometry. Display resolution must not imply physical resolution finer than the mesh or subgrid model.

## Resolution strategy

### Detailed strut benchmark

Develop a conservative radial finite-volume solver first, with force-free axial stretch or an explicitly imposed axial constraint in the corresponding mechanics reduction. Roughly 32–128 radial cells are an initial refinement range to test, not a proven requirement or runtime promise. Finite ends, junctions and nonsymmetric boundaries require higher-dimensional checks.

This is an independent benchmark mode. It must not be presented as resolved nanoscale information sampled from a coarse Benchy.

### Small resolved 3D specimens

Integrate the same constitutive laws into rods, pads, graded-cure beams, bridges and a small lattice with resolved internal gradients. Investigate roughly 5,000–30,000 active mechanical elements as an initial performance range; actual feasibility depends on conditioning, minimum feature thickness, quadrature/state storage, transport resolution and convergence.

Use refinement studies rather than an element-count slogan to decide whether the simulated geometry is trustworthy. The first user-facing coupled release should work here before claiming general whole-object accuracy.

### Larger objects and the Benchy

Run a coarser active-volume model when all load-bearing features and relevant gradients remain resolved. Where they do not, either reject the quality level or use a verified reduced model. Thin-strut cross-sectional models and beam/shell mechanics are plausible later options for suitable lattices, not automatic representations of a general Benchy.

Reduced models must conserve mass and carry the sectional history that determines transport, free deformation and mechanical stiffness/moments. A single average sp² number can discard important section gradients. Validate these reductions against the small resolved 3D solver and held-out geometries.

A local refined subproblem driven by a global run should explicitly be called one-way submodeling unless conservative two-way state/flux/mechanical feedback is implemented. Do not imply that clicking a point reveals an atomically resolved truth that was never computed.

## Browser implementation and resource policy

Use adaptive implicit/stiff local chemistry integration where needed, conservative implicit transport, and converged staggered thermo-chemo-mechanical increments with rollback on failure. Changing current volume/face area must not create or destroy mass. Estimate splitting error and reduce the timestep or iterate the coupling when needed.

Make nonlinear iterations resumable across worker tasks. A worker-hosted solver can still block its own message queue if each Wasm call is huge. Start from a deterministic serial CPU/Wasm baseline; SIMD, multithreading and GPU acceleration are later benchmark-driven enhancements, not prerequisites or assumed multipliers.

Use sparse/matrix-free systems with an appropriate preconditioner, not dense global stiffness matrices. Preflight peak memory including precursor retention, constitutive history, solver vectors, rollback checkpoints and copied transfer buffers. Inspect dependency licensing/Wasm compatibility before adoption. Validate precision choices against a native reference.

Smooth view interaction and slower asynchronous numerical snapshots are distinct goals. Do not promise real-time full-detail solving or a fixed number of frames per second without a device benchmark. Under resource pressure first reduce display detail/output frequency, then offer an explicitly different physical resolution. Never silently remove a strut, change reaction constants, disable transport or substitute scale factors.

Persist run inputs and results explicitly. Browser-local checkpoints improve resilience but are not a substitute for export or remote persistence. Documentation and code changes remain committed remotely; this document does not implement a new storage service.

## Stretch features, after the coupled forward model

**Parameter sweeps and uncertainty:** compare a small number of heating schedules, geometry dimensions and support choices; show output ranges from measured parameter uncertainty. Add sensitivity ranking to identify the next useful material measurement. This is more valuable than unsupported precision from a single run.

**Inverse compensation:** optimize a small parameterized precursor shape or furnace schedule against final dimensional error and modeled stress, with process constraints. Start with a bridge or lattice unit cell. An optimizer finds a solution to the fitted model; it does not make unvalidated material laws experimentally correct.

**Electrical and mechanical virtual testing:** solve conduction between two contacts on the cooled, deformed mesh once local conductivity is calibrated; similarly compute effective small-load stiffness. Do not infer conductivity solely from sp² fraction. Fracture strength and dynamic impact are separate models.

**Surface/interface physics:** add measured slip/adhesion, spatial heat transfer, pore pressure/storage, or surface-energy effects when residual errors and scale estimates justify them. Very small softened features may need surface forces before quantitative shape claims are justified.

## Explicit non-goals for the first release

No full-object reactive molecular dynamics across furnace times. No photorealistic graphene fragments claimed as numerically resolved atomic structure. No universal commercial-resin sp²/transient prediction from a couple of spectroscopy endpoints. No explicit bubble nucleation, crack paths, delamination or arbitrary topology changes without their own validated laws and numerical treatment. No unsupported real-time performance claims. No server/GPU dependency just to run the initial browser model.

These are scope decisions, not statements that those extensions can never be built.

## Delivery order and gates

1. **Specimen handoff and detailed strut core.** Audit dry-material extraction and units; implement schedule, mass-conserving reactions, radial transport and evolving material state. Verify well-mixed limits, positivity, flux scaling and grid/time convergence.
2. **Coupled deformation.** Add the axisymmetric/generalized-plane-strain benchmark, then small 3D finite-strain mechanics with relaxation, free/bonded/compliant supports and internal-state feedback. Verify mass-density-volume closure, objective response, zero-stress free transformations, symmetry and mesh convergence.
3. **Integrated Carbonization Lab.** Wire in deformed geometry, authoritative lens, checkpoint/replay, A/B comparison and diagnostics. Preserve existing exposure/development behavior; verify immutable snapshots, stale-run rejection, pause/cancel and accepted-step replay independently of render cadence.
4. **Larger geometry and material validation.** Demonstrate conservative coarsening/reduction against the resolved benchmark. Fit one named precursor/preparation/process with mass, dimensions and internal characterization; publish held-out errors and observable-specific uncertainty. Collect these measurements in parallel from the first milestone.
5. **Design exploration.** Add bounded sweeps, virtual resistance/stiffness tests and small inverse-design problems, then select advanced physics by evidence rather than visual appeal.

The first useful product comprises stages 1–3 on limited geometries. A full Benchy run is an integration target, not proof of scientific validation. A reduced model should be tested on structures it was not fitted to. No performance or experimental-accuracy result is asserted by this planning document.

## Evidence and source boundaries

**[S1]** Serles et al. (2025), *Ultrahigh Specific Strength by Bayesian Optimization of Carbon Nanolattices*, DOI `10.1002/adma.202410651`. Section 2.3 and MD methods motivate spatial composition/network state and careful treatment of atomistic constraints. https://advanced.onlinelibrary.wiley.com/doi/10.1002/adma.202410651

**[S2]** Serles et al. (2026), *Quasi-Static to Supersonic Energy Absorption of Nanoarchitected Tubulanes and Schwarzites*, DOI `10.1002/adfm.202526595`, methods 6.2. The reported change to the early schedule after warping/bubbling is process evidence, not an identified bubble model. https://advanced.onlinelibrary.wiley.com/doi/10.1002/adfm.202526595

**[S3]** Cardenas-Benitez et al. (2019), *Pyrolysis-induced shrinking of three-dimensional structures fabricated by two-photon polymerization: experiment and theoretical model*, DOI `10.1038/s41378-019-0079-9`. Their wire/support observations motivate a constrained-shrinkage benchmark. https://www.nature.com/articles/s41378-019-0079-9

**[S4]** Mao et al. (2023), *Evolution of chemical and mechanical properties in two-photon polymerized materials during pyrolysis*, DOI `10.1016/j.carbon.2023.03.061`. Publisher abstract/highlights/preview only; no unavailable full-text fit is claimed. https://www.sciencedirect.com/science/article/abs/pii/S000862232300221X

Current source checks used primary-publisher HTML/search-indexed text. No PDF figure measurements or new material fits were made for this scope note. Detailed access limitations from the preceding review remain recorded in the companion document.
