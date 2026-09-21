# Serles / Portela literature review: transformation inside the printed resin

**Date:** 2026-09-19.  
**Purpose:** correct and strengthen the pyrolysis design after reviewing the literature identified by the user.  
**Status:** research notes and proposed model changes, not a calibrated material model or an implemented solver.  
**Companion specification:** `PYROLYSIS_CARBONIZATION_PLAN.md`.

## 1. Correction to the initial framing

The object being simulated is the printed, crosslinked resin **while it transforms into carbon during heating**. Carbon-network formation and rearrangement belong inside that process, alongside decomposition, volatile release, density change and deformation. They are not a separate coating process or merely a property assigned after shrinkage.

The term *pyrolytic carbon* is used in the Serles literature for this polymer-derived material [R1, R2]. The previous emphasis on separating chemical-vapor-deposited carbon was distracting. A vapor-fed deposition process would need a different mass-input model, but that distinction must not exclude in-situ sp²-rich network formation from the present simulator.

Keep separate **state variables and measurement definitions**, not disconnected physics. Elemental composition, bonding, network organization, pore structure, density and stress can influence one another. The project should model those interactions through explicit constitutive relationships, with calibration status attached to each relationship.

## 2. Evidence actually checked

The following capsules distinguish reported observations from proposed simulator behavior. Sources are not interchangeable material calibrations.

### R1 — Serles et al., Advanced Materials (2025), Portela coauthor

*Ultrahigh Specific Strength by Bayesian Optimization of Carbon Nanolattices*. DOI: **10.1002/adma.202410651**.

Section 2.3 reports a diameter-dependent core/edge sp² difference by localized EELS. Its methods describe reactive-MD rods with fixed axial length and open radial escape. Thus the study motivates internal composition fields, but its atomistic deformation is not a free three-dimensional shrinkage measurement. The authors explicitly distinguish MD scales from the experiment. See the main article's Figure 4 discussion and experimental methods; supplementary PDF access failed.

### R2 — Serles et al., Carbon (2023; online 2022)

*Mechanically robust pyrolyzed carbon produced by two photon polymerization*. DOI: **10.1016/j.carbon.2022.09.016**.

The publisher abstract and preview connect printing conditions to the resulting carbon: modulus is associated with graphitic sp² bonding, whereas porosity affects yielding through crack initiation. The precursor and carbon do not have identical property relationships. This motivates preserving printing/preparation history rather than assigning every developed solid one universal carbon law. Full experimental methods were not accessible in this review.

### R3 — Serles et al., Advanced Functional Materials (2026), Portela coauthor

*Quasi-Static to Supersonic Energy Absorption of Nanoarchitected Tubulanes and Schwarzites*. DOI: **10.1002/adfm.202526595**; first published 2026-02-22.

Methods 6.1–6.2 identify IP-Dip2 and describe a modified early heating schedule for large Schwarzite structures after warping and bubbling attributed to gas desorption. The two schedules share the same final 900 °C hold but differ earlier. This is fabrication evidence for history-dependent transport/deformation, not a quantitatively identified bubble-pressure or failure law. Full main article and methods were accessible; supplementary figures were not verified.

### R4 — Portela et al., Nature Materials (2021)

*Supersonic impact resilience of nanoarchitected carbon*. DOI: **10.1038/s41563-021-01033-z**.

The accessible Extended Data Figure 1 caption describes helical-spring foundations decoupling IP-Dip unit cells from silicon. This motivates a compliant-support benchmark rather than only free versus perfectly clamped specimens. Access was limited to the publisher preview/extended-data captions and the supporting-information file; this review does not claim a full reading of the paywalled main methods or extract a kinetics law from impact results.

### R5 — Mao et al., Carbon (2023)

*Evolution of chemical and mechanical properties in two-photon polymerized materials during pyrolysis*. DOI: **10.1016/j.carbon.2023.03.061**.

The publisher abstract, highlights and preview describe IP-Q transformation through monomer loss, decomposition and carbonization. Modulus increases, decreases and increases across these regimes; shrinkage is not proportional to that modulus trajectory. This supports a nonmonotonic constitutive model and retention of relevant precursor state. Full-text access through the linked HAL manuscript failed. No transition temperatures or fitted constants were taken from inaccessible figures.

### R6 — Sharma et al., author manuscript (2018)

*Evolution of Glassy Carbon Microstructure: In Situ Transmission Electron Microscopy of the Pyrolysis Process*. arXiv:**1801.01785v2**.

The manuscript describes direct observation of rearranging graphene fragments during heating of SU-8, including fragment separation and merger. The methods use a TEM vacuum and nanoscale specimens, not the nitrogen furnace of R3. Text and methods were reviewed; attempted figure-page screenshots failed. This supplies qualitative internal-evolution evidence, not transferable commercial-resin kinetic parameters or proof of a single texture law.

## 3. Reading boundaries that matter numerically

### A. A size-dependent timescale is not an intrinsic rate law

R1 writes the pyrolysis number as `Py = lambda / (k rho cp r²)`. With `a = lambda/(rho cp)`, this is `Py = (1/k)/(r²/a)`: reaction timescale divided by thermal-diffusion timescale. Holding material properties and `k` fixed, halving radius multiplies this ratio by four. It does **not**, by algebra alone, multiply intrinsic chemical `k` by four.

For our model, estimate thermal, chemical and mass-transport timescales separately. A spatially nearly uniform temperature can coexist with a nonuniform volatile concentration or chemical state. Derive finite-volume balances using the actual cylindrical/three-dimensional geometry rather than copying an unexplained radial prefactor into the solver. These are dimensional-analysis and discretization requirements, not new experimental claims.

### B. Boundary conditions must accompany atomistic results

An axial constraint is part of a material test, not a universal material property. To identify a stress-free transformation tensor, compute or measure a force-free response, or explicitly solve the inverse problem with the imposed constraints. Do not fit independent free axial/radial shrink factors directly from a constrained rod trajectory.

Use atomistic studies to suggest reaction pathways and candidate structure/property relationships. A browser continuum model still needs scale-appropriate kinetics and constitutive calibration. An accelerated atomic trajectory is not a furnace clock, and a structural classification based on atomic coordination is not automatically identical to an experimental spectroscopy estimator.

### C. Endpoint characterization does not identify the whole transient

Two final core/edge measurements constrain a few endpoints, not a unique reaction network, diffusion coefficient, pore-evolution law or relaxation spectrum. Distinguish measured final strut dimensions from the initial radius supplied to a transient calculation. Keep initial geometry and final geometry separately in every calibration record.

Likewise, a fabrication observation of bubbling does not supply an equation of state, nucleation threshold, permeability or cohesive fracture energy. Retained gas can be modeled before a claim to predict visible bubbles is warranted.

## 4. Proposed coupled state and physics

The following is our implementation proposal, not a model already validated by these papers.

### Preserve the initial solid's history

The dry-specimen handoff should retain the resolved polymer network and cure/exposure fields, preparation history, material identity, voids and boundary labels. Where retained monomer or crosslink state matters, represent it explicitly or mark it unknown; do not fabricate a concentration from render opacity. Washing and drying do not justify assuming every surviving voxel has identical chemistry.

Separate printing-direction metadata from measured molecular orientation. The initial state can influence later transformation without a hardcoded rule that a hatch tangent becomes a graphite basal plane.

### Use evolving internal state, not only a scalar burn fraction

A reduced local state could contain precursor/intermediate/char pools, retained C/H/O bookkeeping, mobile volatile species, carbon-bonding populations, a carbon-network organization variable and unresolved pore descriptors. The exact minimal network remains to be fitted.

Where a true sp² fraction is modeled, track its numerator and denominator consistently. For example, `f_sp2 = N_C,sp2 / N_C,retained` in a stated phase. Selective mass loss can change a fraction even without converting each removed atom into another bonding state. Account for any precursor aromatic carbon. A bounded surrogate ordering variable is acceptable when clearly labelled, but it must not masquerade as a measured percentage.

### Close the mechanical feedback loop

Use evolving state `z` in proposed relationships for stress-free density, transport, elastic response and relaxation:

`rho_free = R(z)`  
`D_gas = D(T, z, pore_state)`  
`mechanical response = M(F_e, T, z, history)`.

The retained mass and consistent stress-free density determine volumetric transformation; a separate, data-supported tensor law determines any intrinsic directional component. Mechanics determines current geometry. That geometry changes transport lengths and boundary area, which feed back into the next physical increment. Solve this coupling with conservative updates, convergence checks and timestep control.

Do not make `E`, conductivity or shrinkage universally proportional to `f_sp2`. Distinct pore/defect/network states may share the same bonding fraction. A nonmonotonic process trajectory must be representable without manually switching the object between an elastic polymer and a fixed final-carbon preset.

## 5. What this changes about anisotropic shrinkage

We should compare four independent sources of directional response: intrinsic material transformation, spatially heterogeneous transformation, mechanical constraints, and numerical bias.

An isotropic local law need not produce an isotropically scaled whole structure. Conversely, a radial gradient of a scalar chemical variable does not by itself establish oriented graphite or identify axial/radial free shrinkage. Heterogeneous eigen-deformations must still satisfy compatibility and equilibrium. A perfectly symmetric initial specimen must not acquire arbitrary lateral bending without a physical asymmetry or a resolved instability.

Add the possibility of evolving texture to the material interface, but do not invent its kinetics or set it directly from the optical PSF. Material anisotropy, architectural anisotropy and scalar chemical gradients should remain independently switchable for control experiments.

Preserve the finite-strain formulation and mass/density closure in the main plan. Add carbon-state-dependent relaxation and chemistry/transport gradients to their inputs. Supports must transform where they are printed polymer and must retain their actual compliance.

## 6. Revised first scientific implementation

Begin with a **single-strut reaction–transport–mechanics demonstrator**, before full Benchy integration:

1. A well-mixed closed mass ledger and thermal schedule, as an analytic/testing limit.
2. A conservative radial finite-volume chemistry/volatile model with evolving geometry and a controlled surface escape condition.
3. Axisymmetric finite-strain mechanics for an ideal long strut, with either a solved force-free axial stretch or a specified axial constraint; compare a generalized-plane-strain reduction against a higher-dimensional solution before relying on it.
4. A small three-dimensional free/bonded/spring-supported coupon set to test compatibility, ends, junctions and support motion.

This structure deliberately separates scientific model validation from the much larger cost of full-object simulation. The radial model is not a substitute for arbitrary three-dimensional structures; junctions, nearby surfaces and finite-length end effects require resolved 3D or a validated reduced representation.

Chemical resolution and display/mechanics resolution need not match. If a coarse cell contains an unresolved thin strut, use a justified subgrid model or declare it unresolved. Do not paint a nanometer-resolved core/shell field onto an unrelated micrometer-scale mesh and present it as computed detail.

The first user-facing carbonization stage should already support spatial internal evolution and its feedback into deformation. An instantaneous-gas-escape, homogeneous-carbon limit remains useful, but must be labelled as a reduction with an explicit validity range, not the full intended model.

## 7. Measurements and tests needed next

Use matched diameter series, different printing/cure histories, and interrupted furnace schedules on one named material. Measure retained mass and dimensions together, with density/porosity and chemical characterization where feasible. Compare free, bonded and compliant support conditions under the same thermal history. Use fast/slow paths ending at the same peak temperature to test path dependence.

Keep spectroscopy, atomistic descriptors and continuum state definitions linked through explicit observation models. Fit to the actual measurement volume and resolution; do not compare a pointwise field directly to a spatially averaged spectrum.

Numerical gates include species and elemental conservation, positivity, correct surface-flux scaling, timestep and radial-grid convergence, mesh/objectivity checks, free-transform zero stress, axial constraint reaction forces, support movement, nonlinear convergence and deterministic accepted-step replay. Controlled symmetry tests should detect artificial directional shrinkage from the grid.

Calibration status should be stated per output. Endpoint spectroscopy alone is not a validated transient model; an apparently plausible shape animation is not mechanical verification. Publish uncertainty and held-out errors rather than silently tuning a final XYZ scale to match a picture.

## 8. Sources and access ledger

[R1] Main article, full HTML and relevant methods: https://advanced.onlinelibrary.wiley.com/doi/10.1002/adma.202410651

[R2] Publisher abstract and article preview: https://www.sciencedirect.com/science/article/abs/pii/S0008622322007400

[R3] Main article, full HTML and relevant methods: https://advanced.onlinelibrary.wiley.com/doi/10.1002/adfm.202526595

[R4] Publisher preview and Extended Data Figure 1 caption: https://www.nature.com/articles/s41563-021-01033-z

[R5] Publisher abstract/highlights/preview: https://www.sciencedirect.com/science/article/pii/S000862232300221X ; author manuscript https://hal.science/hal-04088843v1/document was blocked during review.

[R6] Author manuscript text and methods: https://arxiv.org/abs/1801.01785 ; PDF https://arxiv.org/pdf/1801.01785 . Figure screenshots were attempted but not retrieved successfully; no figure-derived numerical measurements were extracted.

No publisher PDFs, third-party figures, copyrighted article bodies or inferred private data are copied into this repository. No runtime code, numerical calibration, build, experiment or deployment was performed as part of this literature-review change.
