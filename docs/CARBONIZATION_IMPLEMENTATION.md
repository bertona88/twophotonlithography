# Carbonization implementation: specimen handoff and radial core

This implements the first chemistry/transport gate of [PR #8's plan](PYROLYSIS_CARBONIZATION_PLAN.md). The browser entry is `/carbonization`. It is an independent, synthetic long-cylinder benchmark, **not a deformed Benchy or a coupled mechanical simulation**. All material constants are hypothetical and uncalibrated. No commercial-resin, elemental-carbon, sp², stress, pressure or experimentally accurate dimension prediction is made.

## Implemented boundary

- Rust owns the full-resolution dry-specimen preparation contract and its mass ledger. In the printing lab's **Specimen** parameter sheet, complete development and choose **Export full-resolution dry specimen**.
- Rust owns radial precursor/char/mobile pools, conservative escape, evolving network order, density/porosity/natural-volume closures, physical time, rejection/rollback and replay state.
- The separate TypeScript worker schedules bounded increments and copies versioned `f64` snapshots before transferring them. React renders radial sections, profiles, a material probe and sampled mass histories.
- The benchmark offers schedule editing, pause/resume, cancel, individual accepted increments, replay with edited inputs, pinned comparison profiles, JSON checkpoint import/export and radial CSV export. Saved checkpoints contain all parameters and full radial fields; continuation does not replay printing.
- The dry 3D specimen is not silently projected onto the radial mesh. Importing it into this benchmark is intentionally unsupported. Its owned Rust representation is the handoff for subsequent 3D work.

The next gate remains axisymmetric finite-strain mechanics, followed by verified small 3D solids, relaxation and free/bonded/compliant transforming supports. This change does not implement those gates, arbitrary topology changes, spatial heat conduction, closed-cavity gas storage, named-material calibration, inverse design or whole-object carbonization.

## Dry specimen contract (`dry-extraction-demo-v1`)

Preparation is permitted only after all development increments complete. It reads the authoritative grid, including active off-target material, without using render sampling, opacity or CAD occupancy as a solid-state substitute. Coordinates preserve the source's cell-center convention and non-cubic pitches, converted once from micrometers to meters. Source indices follow `x + nx * (y + ny * z)`.

The explicit demonstration wash/dry assumption is:

```
retained inventory = rho_dry * voxel_volume * remaining
candidate dry polymer = retained inventory * conversion
removed soluble inventory = retained inventory * (1 - conversion)
```

`rho_dry` is a supplied dry-polymer reference density, not measured density of the bath. These are model inventories under an assumed conversion-to-polymer mapping, not experimentally calibrated masses. A cell is included if its conversion is at least the chosen threshold (no lower than the source gel point) and its retention is at least the chosen positive threshold. Excluded polymer is recorded separately. Retention is counted once, as part of the solid fraction, not again in density.

The preparation ledger closes:

```
retained inventory = selected dry polymer + excluded polymer + removed soluble inventory
```

All selected fragments survive the handoff. Six-face connectivity does not weld edge/point contacts. Near-threshold cell count and candidate mass within an absolute 0.02 of either threshold identify extraction sensitivity. No automatic support identification or mechanical coarsening occurs. The model records initially stress-free drying and unknown retained species as assumptions. Raw conversion, retention, initiator, oxygen and radical fields are preserved for selected cells as printing metadata, along with source parameters/checksum and preparation policy. They are not reinterpreted as furnace gases. Export owns its data independently of later source reset.

Preparation estimates peak source/connectivity/state/serialization/transfer memory, rejects over-budget requests without deleting cells, and uses fallible allocation for the large vectors. The worker's export cap is 256 MiB. The estimate allows 2048 bytes per selected cell for Rust state, JS objects and JSON/Blob copies. This conservative estimate is a preflight policy, not a device-capacity benchmark or a guarantee about browser allocator overhead.

## Radial model (`radial-reference-v1`)

All solver quantities use seconds, Kelvin, meters, kilograms and kg/m³. UI temperature waypoints are minutes/°C. Piecewise-linear interpolation implements ramps, holds and cooling; steps end at schedule knots. Temperature is a **prescribed uniform specimen temperature**, not a solved furnace/specimen lag. Valid input temperatures are 273.15–1673.15 K with schedules up to seven days; these numerical input limits are not experimental material validity claims.

The reference cylinder has 4–256 radial annuli (UI choices 16–256), symmetry at the axis, sealed ends and a Robin escape boundary at the exterior. It does not model finite ends, junctions or cavities. Radial resolution is the physical resolution; there is no hidden subgrid or molecular detail.

### Chemistry and material state

The mass-fraction reaction is `P -> y C + (1-y) V`, with `k = A exp(-E/(R T))`. Each temperature-frozen local step uses the analytic nonnegative precursor decay and transfers exactly the same lost precursor mass into char and mobile products. Char is residue mass, not elemental carbon. The first profile has **no volatile-to-solid feedback**. At uniform temperature and initial solid state, the solid pools and network state remain radially uniform even when the mobile field has a gradient.

Network order `q` is a bounded structural surrogate:

```
dq/dt = kn(T) * char_share * (1-q)
phi = phi_initial + phi_transient * char_share * (1-q)
rho_skeleton = (1-char_share)*rho_polymer + char_share*(rho_char + q*network_density_gain)
rho_free = (1-phi)*rho_skeleton
J_natural = (P+C) * rho_initial / rho_free
D = D_base * (1 + q*network_diffusivity_gain)
```

Here `char_share = C/(P+C)`. The network integration uses the midpoint char share and an exponential relaxation update. Micro-porosity represents unresolved material pores only. There are no resolved architectural holes in the synthetic cylinder. Network order is not a bonding population or observed sp² percentage. The density/transport closures are exposed in the checkpoint, have no fit to spectroscopy, and make no claim about electrical or mechanical properties.

`J_natural` and its isotropic cube root are **stress-free constitutive diagnostics**, never a solved current geometry. Transport runs on the fixed reference cylinder. There is no geometry feedback or global scale animation; coupled deformation is the next milestone. Use this benchmark to verify internal-state laws, not to predict dimensions or escape on a contracting object.

### Conservative transport and numerics

Annular volumes are `pi*(r_outer²-r_inner²)*L`; face areas are `2*pi*r*L`. A shared face conductance uses the harmonic diffusion resistance of adjacent half-cells. The exterior resistance includes both the last half-cell and `1/h`. Ambient mobile concentration is zero. Setting `h=0` seals the surface; `D=0` suppresses diffusion/escape. Mobile mass is a lumped surrogate with no pressure or species interpretation.

Backward Euler transport solves a positive tridiagonal finite-volume system. Escaped mass is integrated using the **same final boundary flux** as the transport matrix. The mass ledger is `initial = precursor + char + mobile + escaped`. Local fractions are normalized by each annulus's initial mass, not its current mass.

Local chemistry is followed by implicit transport. Step doubling compares one full step with two half steps for every pool, network order and total escaped fraction. The accepted solution is the two-half-step result. This controls the first-order splitting/transport error; it is not an assertion of second-order integration. Defaults are relative tolerance `1e-3`, absolute fraction tolerance `1e-7`, maximum step 10 s and minimum step `1e-5` s. Trial states must close global mass to `1e-9` relative error. Tests use tighter thresholds where supported by analytic solutions.

Every trial validates retained solid, free density, natural Jacobian and micro-porosity against explicit profile bounds. Invalid trials halve the step; exhausting the minimum interval stops the run and reports `material-state-out-of-domain` with the quantity, trial cell/time, value and bound. The last accepted physical state is unchanged. No residual mass/density/stiffness is fabricated and no cell is deleted. A maximum of 42 trials covers the allowed timestep range while keeping work bounded. Other errors (invalid input, mass ledger, timestep tolerance) remain distinct diagnostics.

### Replay and browser protocol

Snapshots include schema/model/material versions, the field order and units, run ID, sequence, accepted time, temperature convention, calibration/geometry/feedback status and diagnostics. Transferred arrays are copies of Rust-owned memory. Numerical steps depend on accepted state and tolerances, never on display cadence. The worker yields after at most eight increments or a 12 ms scheduling budget, publishing normally every 100 ms; one Wasm increment itself is bounded by 256 cells and 42 trials. These are scheduling policies, not frame-rate promises.

New configurations use increasing run IDs. Old commands/snapshots cannot change the new run. Cancellation retains the last accepted state for export but requires replay/restore for a new run. Import validates schema, dimensions, configuration, positivity, constitutive domain and mass balance before replacing the prior Rust owner. Snapshot checksums identify physical state for same-build replay; they are not cryptographic provenance hashes. Cross-platform agreement is numerical, not a promised bitwise checksum identity.

Browser history and pinned comparisons are display/session state. JSON files explicitly preserve configuration, accepted radial state, counters and the next adaptive timestep. Charts may thin old display samples after 2048 snapshots. CSV exports the full current radial field with accepted time and model limitations. No remote run-storage service is implied.

## Verification

The native tests cover:

- Kelvin/seconds ramp/hold/cool interpolation and invalid schedules;
- analytic reaction-only decay, nonnegative pools and exact mass transfer;
- uniform solid with nonuniform mobile products and no volatile feedback;
- cylindrical finite-volume boundary conservation and radius/length scaling;
- the high-diffusivity, surface-limited `exp(-2*h*t/R)` limit;
- radial mesh convergence against the analytical Bessel-series solution and backward-Euler time convergence;
- network/density/porosity/natural-volume closure;
- zero/near-zero char yield and limiting-porosity domain rejection with unchanged accepted-state checksum;
- checkpoint continuation independent of snapshot cadence and rejection of invalid imports;
- extraction mass accounting, off-target fragments, face-only connectivity and raw field precision.

Production-worker tests load the actual emitted Wasm and exercise the analytic reaction limit, copied snapshots, pause/resume, stale commands, JSON continuation, cancellation, initialization failure and domain rollback. They are included in `npm run test:production-worker` and the full `npm test` gate. The existing Rust/chemistry/renderer/worker/build tests remain in place. Run `npm run verify:wasm` after committing regenerated browser artifacts to verify the pinned Linux build is reproducible.

Numerical verification is not experimental validation. Bending/locking/objectivity/constraint tests, moving geometry, closed cavities, thermal lag, named-material fitting and held-out experimental errors remain requirements for later releases.
