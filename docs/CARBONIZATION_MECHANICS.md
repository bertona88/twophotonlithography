# Coupled elastic long-cylinder benchmark

This extends the reviewed chemistry/specimen work in PR #10 with an **elastic finite-strain generalized-plane-strain cylinder**, not a whole-object solver. The demonstration constants remain uncalibrated. The UI at `/carbonization` now defaults to solved geometry and also offers the original fixed-reference transport control.

## Review of PR #10

Reviewed commit: `5c63076825ea7769e73f3aaeaba9d5bc9aae153b`.

The specimen handoff retains full-resolution material, preparation assumptions and off-target fragments; the local chemistry conserves its three pools; radial transport uses a shared conservative flux; accepted states and invalid replacements are kept separate. The distinction between natural volume and actual geometry is correct. No blocking issue was found in these paths. All 55 native tests passed before this extension. The full application gates are run on the combined implementation.

The first PR deliberately does not supply a mechanical displacement field. This extension adds that field instead of interpreting its natural-volume diagnostic as solved deformation. The later gates in the plan (3D, relaxation, finite end/interface effects, experimental calibration) are still required.

## Kinematics and energy

Coordinates refer to the dry, stress-free initial cylinder. Within this reduction:

```
r = r(R), z = lambda_z Z
F = diag(dr/dR, r/R, lambda_z)
F = F_e F_nat
F_nat = F_th F_py
F_th = exp(alpha (T - T_initial)) I
F_py = J_py^(1/3) diag(exp(-gamma/3), exp(-gamma/3), exp(2 gamma/3))
gamma = configured_anisotropy * C/(P+C)
J_py = (P+C) rho_initial / rho_free
```

Default anisotropy and thermal expansion are zero. Nonzero anisotropy is a hypothetical material-frame, axial/transverse law; it has no inferred relationship to laser writing or carbon bonding. Thermal expansion is applied once, relative to the schedule's first specimen temperature. `J_py` is still the chemistry-only free-volume diagnostic; `det(F_nat)` additionally includes thermal expansion. Actual cell density is `(P+C) rho_initial / J_actual`.

The compressible neo-Hookean elastic energy is

```
W0 = J_nat mu [ (tr(F_e^T F_e)-3)/2 - ln J_e
                + (lambda/mu) (ln J_e)^2/2 ]
lambda/mu = 2 nu/(1-2 nu)
```

`W0` is energy per unit dry-reference volume. The `J_nat` factor converts energy per unit natural volume to dry-reference volume. Nominal stress is `P = dW0/dF`, and Cauchy stress is `sigma = P F^T / det(F)`. Tensile stresses and tensile axial specimen force are positive. This uses the standard compressible energy and variational equilibrium formulation illustrated in the [DOLFINx hyperelasticity demo](https://docs.fenicsproject.org/dolfinx/main/cpp/demos/demo_hyperelasticity.html), with the explicit natural-configuration conversion above. There is no gas stress or effective-pressure term.

The shear modulus is constant and strictly positive. Poisson ratio is restricted to 0–0.45: near-incompressibility and locking-free mixed formulations are not claimed. This is elastic mechanics; no relaxation, damage, softening or experimentally fitted state-dependent modulus is implied.

## Equilibrium and boundary conditions

The unknowns are the current positions of all radial faces and one axial stretch. Only the axis position is fixed radially. The outer cylindrical surface is traction-free. Piecewise-linear radial interpolation and two-point Gauss integration per annulus give a variational radial equilibrium problem. Chemistry is piecewise constant on the same reference annuli. Gauss-point hoop stretch is `r/R`; it is never replaced with the natural stretch. Current annular volume is integrated exactly from its two face radii and current length.

Axial choices are:

- **Force-free:** solve for zero integrated axial specimen force.
- **Prescribed separation:** enforce the specified axial stretch and report the axial reaction. This is a generalized-plane-strain axial constraint, not a fully bonded end face.
- **Compliant:** add `k (L-L_anchor)^2/2` to the energy and solve equilibrium with that spring. The spring exerts `-k (L-L_anchor)` on the specimen.

Anchor separation changes linearly from `L0` to the configured final ratio times `L0` over the whole schedule. This is prescribed support motion, not a solved transforming support material. Zero spring stiffness recovers the force-free case. The current radius/diameter and axial length are physical landmarks in this cylinder's material frame; shrinkage is `1 - current/reference`, allowing negative values for expansion.

Newton's method uses the analytic consistent tangent, a tridiagonal radial solve and an axial Schur complement. Energy backtracking checks positive current geometry. The normalized residual must be below `1e-9`; energy is normalized by `mu*pi*R0^2*L0` and coordinates by `R0` and `L0`. At most 50 Newton iterations and 24 backtracking candidates per iteration are permitted. Nonpositive tangents, invalid geometry and nonconvergence reject the coupled increment. No geometry, material mass or stiffness is clamped to rescue a failed solve. The existing timestep reduction and final rollback policy applies.

## Moving-geometry transport and time coupling

Each trial increment performs chemistry/network evolution, mechanical equilibrium, then implicit transport on that deformed geometry. There is no mobile-to-solid or mobile-to-mechanical feedback in the selected profile, so no within-increment fixed-point iteration is necessary. Time splitting and geometry changes are controlled by full-step versus two-half-step comparison, including all radial face positions and axial stretch in addition to the existing material and escape fields. The accepted solution is the two-half-step result; this remains a first-order scheme.

The transport unknown is current mobile concentration divided by `rho_initial`. Its capacity is the **current** cell volume; its right-hand side is the **reference** volume times mobile inventory fraction. Face conductances use current radii, current axial length and current half-cell distances. The exterior uses the same Robin resistance as before. The solved concentration is converted back to inventory per reference volume after the step. Escaped inventory uses exactly the boundary flux in the matrix. Thus contraction concentrates mobile products without creating or destroying them. Mechanical transport is Lagrangian; there is no Eulerian advection term on these material-following annuli.

The global ledger stays `initial = precursor + char + mobile + escaped`. A free, uniform transformation has `J_actual=J_nat`; a constrained cylinder generally does not. The chemistry-only solid state still remains uniform under uniform temperature regardless of mobile gradients.

## Browser and persistence contract

Model version is `radial-mechanics-v2`; radial snapshot/checkpoint schema is **2**. Version-1 radial checkpoints are rejected; they lack required mechanical configuration and geometry. Dry-specimen exports retain their independent schema **1**. There is no silent checkpoint conversion or reinterpretation of prior transport histories.

Checkpoints store current radial faces and axial stretch alongside all prior chemical state, parameters and adaptive history. Imports check geometry, positive Jacobians, axial conditions, mechanical equilibrium, material validity and mass balance before replacing the accepted owner. Checksums include every radial face and the axial stretch.

The 19 scalar fields per annulus are declared in Rust and checked by the worker. The first nine retain their original meaning; the additional fields are current center radius, current cell volume ratio, actual solid density, radial/hoop/axial stretches, radial/hoop/axial Cauchy stress, and current outer face radius. Stresses and stretches are sampled at the material-cell midpoint; cell volume and actual density use exact integrated annular volume. Stress is not an average over the cell. The fixed-reference control emits identity stretches and zero placeholder stress fields; it does not solve stress.

The section uses authoritative current face positions, with a dashed dry-reference outline. Profile horizontal coordinates remain material-reference radii for comparison and probing. Stress charts include compression as negative values. Diagnostics expose actual diameter/length/volume, axial force and normalized equilibrium residual. The conservative peak-memory policy is `64 KiB + 2048 bytes/cell`, including trial states, sparse assembly, snapshots and transfer/serialization overhead. Worker scheduling still yields between increments; the Newton/backtracking limits bound an increment, not its wall-clock duration.

## Verification and remaining scope

Native checks cover energy derivatives/tangent against central differences; independent 3D invariant energy under a superposed rigid rotation; free 50% contraction and compatible axial anisotropy; constrained homogeneous cylinder response against an independent scalar root solve; moving anchors and spring force balance; heterogeneous radial compatibility and mesh convergence; identity transport parity; current-geometry mass conservation; the contracted well-mixed surface-escape limit; coupled time refinement against analytic expanding-cylinder escape; thermal ramp/cool closure; actual/free density consistency; invalid geometry rejection and exact supported-run checkpoint continuation.

The production-worker suite checks free/constrained dimensions and reactions, the schema and copied fields, invalid geometry replacement, fixed-reference mode, analytic chemistry, pause/replay/cancel and domain rollback using the actual emitted Wasm. Existing printing/development tests remain in place.

The independent 3D energy check is a constitutive objectivity check, **not a 3D finite-element comparison**. The current cylinder assumes a uniform axial stretch and cannot resolve finite ends, junctions, bonded pads, bending, buckling or spatially varying axial support tractions. Small-3D mechanical comparison, rotating anisotropy tensors, finite-strain relaxation with dissipation, transforming support bodies, mixed incompressible elements, whole-Benchy integration and named-material calibration remain unimplemented gates. This milestone makes elastic contraction and constraint effects inspectable without claiming those later capabilities.

## Validation run

On this implementation, `npm test` passed: 66 native Rust tests, Rust formatting/Clippy, JavaScript lint, existing renderer/interaction tests, production build, TypeScript checking, native/Wasm parity, all seven production-worker tests (including five carbonization tests), and all six rendered-HTML tests. The browser bindings and binary were regenerated with Rust 1.88.0, wasm-pack 0.13.1 and wasm-bindgen 0.2.126. The final validation run used the repository's writable environment wrapper and a fresh Cargo build directory.

Desktop/mobile screenshot QA could not be completed: Chromium was absent, the Playwright installer failed, and a direct browser download did not return a valid ZIP archive. Actual emitted worker execution and server-rendered route checks passed; they do not replace interactive visual verification.
