# BCC foam carbonization benchmark

This document records the three-dimensional BCC benchmark and its verification boundaries. It complements the [radial cylinder formulation](CARBONIZATION_MECHANICS.md); the cylinder remains an independent verification and exploration mode. The broader [browser scope](CARBONIZATION_BROWSER_SCOPE.md) is a research roadmap, not a list of experimentally validated capabilities.

## Physical interpretation

The benchmark is a finite piece of an open-cell body-centred cubic strut lattice. Each cubic cell has eight finite-radius struts joining its centre to its corners. Neighbouring struts overlap into connected junctions. The architectural pores are explicit empty space; the material's unresolved porosity is a separate constitutive quantity.

The default is 2 × 2 × 2 unit cells, a 40 µm pitch and strut radius 0.15 times the pitch. Ten voxels per pitch represent a nominal strut diameter of three voxels. The voxelized architecture has 37.6% solid volume before its unresolved material porosity is applied. Resolution changes can alter that approximate boundary and its initial mass.

The substrate is an ideal rigid, non-transforming support. A bonded run fixes all three displacement components at the polymer footprint and prevents volatile escape through that contact. It does not solve the substrate's elasticity, heating, adhesion strength or delamination. A free run is the homogeneous, unconstrained control.

The material profile is an **uncalibrated inert-process demonstration**. It is not a fitted prediction for IP-Dip, SU-8 or another commercial resin. Reaction yield, density evolution, diffusivity, modulus and relaxation time need material-specific measurements before quantitative manufacturing use. Prescribed specimen temperature does not model furnace heat transfer. Carbon-network order is a bounded internal variable, not a measured sp² percentage.

Substrate constraint is physically important: published TPP-derived wires show support-dependent elongation and buckling during pyrolysis. That evidence motivates solving compatibility and supports; it does not identify this benchmark's material parameters or validate its BCC results. See [Cardenas-Benitez et al. (2019)](https://www.nature.com/articles/s41378-019-0079-9).

## Mass, transformation and geometry

The existing one-way reaction is `P -> y C + (1-y) V`, with reference-volume inventories for precursor, retained char and mobile products. Transport releases mobile inventory through exposed surfaces. The required ledger is

```
initial mass = precursor + char + mobile + escaped
J_py = (P+C) rho_initial / rho_free
rho_actual = (P+C) rho_initial / J_actual
```

Natural chemical contraction and actual compatible deformation are different quantities. An isotropic local natural transformation does not force the bonded lattice to shrink uniformly. In this profile, mobile concentration does not alter solid chemistry: uniform initial composition and uniform temperature must retain uniform precursor/char evolution even when mobile products vary spatially.

The rendered deformed surface and section must come from accepted solver coordinates and fields. A smooth rendering does not increase physical resolution. Voxel boundaries approximate cylindrical struts; first-order tetrahedra resolve a piecewise-affine displacement field and require refinement for bending and local stress accuracy.

## Constitutive reference for finite-strain relaxation

The elastic reference is a compressible neo-Hookean energy with positive determinant, using the actual deformation relative to the chemical natural configuration. The [DOLFINx hyperelasticity example](https://docs.fenicsproject.org/dolfinx/main/cpp/demos/demo_hyperelasticity.html) gives the standard energy, variational residual and Cauchy-stress conversion. The natural-to-dry volume factor must be retained when integrating an energy defined per natural volume.

The relaxation branch uses an isochoric Maxwell metric `C_v`, initially identity. With `C_bar = det(F)^(-2/3) F^T F`, the projected implicit update is

```
A = C_v_old + (dt/tau) C_bar
C_v_new = A / det(A)^(1/3)
W_v = J_nat mu_v / 2 [tr(C_bar C_v^(-1)) - 3]
```

This is the neo-Hookean multiplicative Maxwell update of [Shutov, Landgraf and Ihlemann (2013), equation 23](https://arxiv.org/abs/1304.3380). Its symmetric positive-definite metric and unit determinant are preserved, and held-deformation relaxation reduces stored branch energy. It is first order in time. A parallel equilibrium branch retains long-term stiffness; bulk relaxation is not implied by an isochoric branch. The paper establishes properties of this integration algorithm, not experimental validity for pyrolysing resin.

The configured Poisson ratio describes the instantaneous response. With total instantaneous shear modulus `mu`, equilibrium shear fraction `g`, and `lambda_0/mu = 2 nu/(1-2 nu)`, the equilibrium logarithmic bulk coefficient is `lambda_0/mu + 2(1-g)/3`. This adjustment keeps the instantaneous bulk modulus fixed when changing the relaxing shear fraction. The illustrative state-dependent modulus and temperature/order-dependent relaxation time are hypothetical closures, not values derived from the Maxwell integration paper.

With retained-char share `f = C/(P+C)` and network order `q`, the modulus multiplier is `0.05 + 0.95(1-f) + 4 f q²`. The relaxation time is the configured reference time multiplied by `exp[(50000/R)(1/T-1/900)] (1+20 q²)`, bounded to `[1, 10^12]` seconds. Zero configured reference time selects the elastic control. This expresses illustrative intermediate softening, network stiffening and slowing of relaxation; it is not a fitted constitutive trajectory. The BCC mode does not add a separate thermal-expansion strain.

When evaluating different global equilibrium candidates within one physical increment, every trial metric must originate from the same previously accepted history. Repeatedly updating the history during solver iterations would incorrectly turn numerical iterations into extra physical time. Rejected increments must roll back coordinates, chemistry, mobile inventory and viscous history together.

## Verification acceptance checklist

The following are the release checks; the validation record below identifies completed numerical checks separately from remaining application checks:

- **Geometry:** eight centre-to-corner struts per unit cell; positive element volumes; paired interior triangles; a face-connected solid body; no connection supported solely by a point or an edge; nonempty bonded footprint. Refine the voxelized radius and junction volume without silently deleting load-bearing features.
- **Constitutive response:** energy derivatives agree with independent finite differences; an isotropic free transformation gives zero stress and the correct volume; superposed rigid rotations preserve energy and rotate stress appropriately.
- **Boundary conditions:** bonded footprint coordinates are unchanged; the free control has no artificial anchoring stress; bonded contraction produces a compatible nonuniform field; support reactions balance free-node residuals.
- **Relaxation:** positive-definite, unit-determinant history; decreasing branch energy in a fixed-deformation hold; objective response under rotation; disabled relaxation recovers the elastic limit; timestep refinement; deterministic continuation after checkpoint restore.
- **Chemistry and transport:** nonnegative pools; closed mass ledger; zero internal flux for constant concentration; no flux through the substrate contact; an impermeable case retains generated products; an open case loses exactly its integrated boundary flux. Uniform one-way solid kinetics remain uniform.
- **Numerics:** the default bonded furnace schedule reaches completion at the declared force tolerance with positive Jacobians; failed trial steps preserve the last accepted state. Record mesh/time sensitivity for dimensions, volume, integrated energy and gas retention. Peak footprint stresses require separate refinement and may be singular at ideal clamp edges.
- **Application:** copied snapshots do not alias Wasm memory; stale run commands cannot change a newer run; pause, resume, cancel and checkpoint continuation work with the emitted production worker; exported coordinates match the visible accepted state. Check the default BCC/substrate and the radial mode on desktop and mobile, then repeat the defining interaction against the deployed assets.

Transport uses persistent nodal mobile inventories, lumped current-volume capacities and a linear-tetrahedron Galerkin diffusion operator transformed through the actual deformation gradient. The operator passes a manufactured affine-concentration Neumann patch test on sheared, contracted tetrahedra. This avoids the mesh-orthogonality restriction of two-point face fluxes described in the [DuMux TPFA formulation](https://dumux.org/docs/doxygen/master/group___c_c_tpfa_discretization.html).

On distorted meshes, a Galerkin solve can produce a negative concentration. In that case a second solve adds symmetric zero-row-sum graph diffusion to remove positive matrix off-diagonals. The accepted concentration is the largest nonnegative global convex blend of the Galerkin and monotone solutions, with a small floating-point safety margin. The surface escape is evaluated from that same blended concentration. Both candidate systems share the source, current-volume capacity and Robin boundary terms, so the blend preserves their common total mass balance without clipping inventory. Diagnostics retain the minimum Galerkin weight and the number of limited steps.

This limiter can add artificial diffusion. Smooth positive fields retain weight 1 on the tested refined meshes, but that result does not prove accuracy for the sharply depleted near-surface fields in a strongly contracted default run. Gas gradients need their own mesh/time sensitivity study. The scalar solid chemistry in this one-way profile does not change when gas transport is limited.

## Scope boundaries

This benchmark does not predict crack initiation, debonding, fracture, contact after self-intersection, bubble nucleation, oxidation, atomistic bonding or a quantitatively calibrated material response. Rigid substrate and free-lattice cases do not imply compliant or transforming substrate bodies. A successful BCC run also does not establish arbitrary imported-object or whole-Benchy accuracy. Those extensions remain separate work in the research roadmap.

## Validation record

On 2026-09-22 all 21 BCC checks passed in a native release build. Fifteen independent checks in `rust/reaction-lens/src/bcc/verification.rs` cover the face-connected mesh/finite footprint, affine deformation and scalar gradients, mirror symmetry, independently differentiated constitutive energy, rigid-rotation objectivity, instantaneous bulk/shear parameters, held-deformation dissipation and unit viscous determinant, small-shear analytic relaxation with first-order time convergence, free finite contraction, bonded contraction, the deformed diffusion patch, sealed mass conservation, surface-only Robin decay with substrate exclusion, positive conservative limiting of a localized inventory, and an inactive limiter for smooth positive data at 8/10/12 voxels. The deliberately skewed localized-inventory case uses Galerkin weight 0.973371. These checks use the actual numerical modules; they are not browser execution or experimental validation.

The five coupled-state checks cover checkpoint replay with mass conservation, rejection of invalid saved states, retention of the last accepted state after a failed material increment, export/restore while an optimizer trial is pending, and exact trajectory agreement across optimizer batch sizes of 1, 8 and 37 iterations. The production core now executes at most eight L-BFGS iterations per `advance()` call and retains its evaluation, preconditioner and history between calls. Pending chemistry, viscous history and coordinates are private until the complete increment passes equilibrium, transport and ledger checks. Pausing retains the pending work; a saved checkpoint contains only accepted state, and restoring it deterministically repeats the same physical increment. `accepted_steps()` lets the worker keep “One step” defined as one accepted increment while yielding between numerical batches. A focused optimizer boundary check also accepts a converged evaluation at the 240-iteration limit while rejecting an unconverged one, both at entry and after a batch. Formatting and strict Clippy checks also passed.

A separate one-cell bonded elastic sensitivity check applies a natural linear stretch of 0.9 at the default radius/pitch ratio of 0.15. Volumes below are normalized by the unit-cell pitch cubed; the energy is normalized by shear modulus times pitch cubed.

| Voxels per cell | Tetrahedra | Initial solid volume | Current height / pitch | Current / initial volume | Stored energy |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 2,256 | 0.376000 | 0.871111 | 0.736919 | 0.00100868 |
| 12 | 4,032 | 0.388889 | 0.866092 | 0.736100 | 0.00092864 |

Both equilibrium residuals are below `2e-6`. Height differs by approximately 0.58% between these meshes, and the normalized volume ratio differs by approximately 0.11%. **Initial solid volume changes by 3.4%, and stored energy changes by 7.9%.** Two resolutions do not establish converged stress, energy or absolute material volume. The browser resolutions are illustrative, and higher-order or boundary-conforming meshes remain necessary for accurate thin-strut mechanics.

A coupled one-cell timestep study at 900 K uses a 20-second hold, an analytic reaction rate of `0.02/s`, zero network evolution and a 10-second relaxation time. Against a 0.125-second reference, the RMS error in the viscous metric falls from `0.002625` at 2 seconds to `0.001255` at 1 second and `0.000545` at 0.5 seconds. Final heights are 35.01335, 35.00490 and 35.00207 µm, respectively, versus 35.00382 µm in the reference. All four runs finish without rejected steps and retain relative mass error below `1e-9`. This is a time-integration check on the stated model, with first-order history convergence; the very small height changes are also affected by the equilibrium tolerance.

Seventeen emitted-worker and rendered-HTML checks passed against the final resumable build. These exercise the actual production worker/Wasm artifacts and include state isolation, accepted-state replay, pause/cancel/stale-command handling, failure reporting, bonded-footprint deformation and route/model-boundary declarations.

Before the final optimizer-only resumability change, observed desktop UI checks covered material-field changes, material probing, keyboard camera control, the spatial section, reset, one accepted step, resume and pause. A short 90-second 25 → 300 → 25 °C schedule completed for the two-cell 0.15-radius/10-voxel benchmark under both support modes; reported peak von Mises stress was about 0.100 MPa bonded and 8.88e-13 MPa free. A 390 × 844 mobile viewport had no horizontal overflow and kept the specimen and substrate readable. The radial route and its return link loaded, and browser logs were empty during those checks. These observations establish the tested local UI behavior, not device-independent performance or a deployed result. The final rebuilt preview and live release require their own interaction readback.

The final full-default emitted-worker result is being recorded separately below when that run completes. Deployment validation follows release; no successful deployment is asserted by this local validation record.
