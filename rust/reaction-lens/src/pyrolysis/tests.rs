use super::*;
use crate::Parameters;

fn isothermal(duration: f64) -> RadialConfig {
    RadialConfig {
        radial_cells: 16,
        schedule: vec![
            TemperaturePoint {
                time_s: 0.0,
                temperature_k: 900.0,
            },
            TemperaturePoint {
                time_s: duration,
                temperature_k: 900.0,
            },
        ],
        material: Material {
            reaction_a_per_s: 0.02,
            reaction_e_j_mol: 0.0,
            network_a_per_s: 0.01,
            network_e_j_mol: 0.0,
            ..Material::default()
        },
        ..RadialConfig::default()
    }
}

fn finish(core: &mut PyrolysisCore) {
    for _ in 0..100_000 {
        if !core.advance() {
            break;
        }
    }
    assert!(core.complete(), "{:?}", core.diagnostics().failure);
}

#[test]
fn schedule_interpolates_ramp_hold_and_cooling_in_kelvin_seconds() {
    let config = RadialConfig::default();
    assert_eq!(schedule::temperature(&config.schedule, 0.0), 298.15);
    assert!((schedule::temperature(&config.schedule, 1800.0) - 735.65).abs() < 1e-10);
    assert_eq!(schedule::temperature(&config.schedule, 4500.0), 1173.15);
    assert!((schedule::temperature(&config.schedule, 6300.0) - 735.65).abs() < 1e-10);
    assert_eq!(schedule::next_knot(&config.schedule, 3600.0), 5400.0);
    let mut invalid_config = config;
    invalid_config.schedule[1].time_s = 0.0;
    assert!(PyrolysisCore::new(invalid_config).is_err());
}

#[test]
fn analytic_reaction_limit_is_positive_and_conservative() {
    let mut config = isothermal(100.0);
    config.material.diffusivity_m2_s = 0.0;
    let mut core = PyrolysisCore::new(config).unwrap();
    finish(&mut core);
    let p = (-2.0_f64).exp();
    for cell in &core.state.cells {
        assert!((cell.precursor - p).abs() < 2e-14);
        assert!((cell.char - 0.25 * (1.0 - p)).abs() < 2e-14);
        assert!((cell.mobile - 0.75 * (1.0 - p)).abs() < 2e-14);
        assert!((0.0..=1.0).contains(&cell.order));
    }
    assert_eq!(core.state.escaped_kg, 0.0);
    assert!(core.diagnostics().relative_mass_error.abs() < 1e-13);
}

#[test]
fn no_feedback_solid_is_homogeneous_despite_a_mobile_gradient() {
    let config = isothermal(100.0);
    let mut blocked = config.clone();
    blocked.material.surface_transfer_m_s = 0.0;
    let mut sealed = PyrolysisCore::new(blocked).unwrap();
    let mut open = PyrolysisCore::new(config).unwrap();
    finish(&mut sealed);
    finish(&mut open);
    assert!(open.state.cells[0].mobile > open.state.cells.last().unwrap().mobile * 2.0);
    let first = &open.state.cells[0];
    for cell in &open.state.cells {
        assert_eq!(cell.precursor, first.precursor);
        assert_eq!(cell.char, first.char);
        assert_eq!(cell.order, first.order);
    }
    // Adaptive histories differ; solid mass still has the same analytic limit.
    assert!((first.precursor - sealed.state.cells[0].precursor).abs() < 1e-13);
    assert!((first.char - sealed.state.cells[0].char).abs() < 1e-13);
    assert_eq!(sealed.state.escaped_kg, 0.0);
    assert!(open.diagnostics().relative_mass_error.abs() < 1e-11);
}

#[test]
fn high_diffusivity_approaches_well_mixed_surface_limited_escape() {
    let mut mobile = vec![1.0; 64];
    let d = vec![1e6; 64];
    let h = 0.1;
    for _ in 0..1000 {
        transport::diffuse(&mut mobile, &d, 1.0, 3.0, h, 0.001);
    }
    let exact = (-2.0_f64 * h).exp(); // A/V = 2/R (sealed ends).
    for value in mobile {
        assert!((value - exact).abs() < 3e-5);
    }
}

fn diffusion_mean(n: usize, dt: f64) -> f64 {
    let mut mobile = vec![1.0; n];
    let d = vec![1.0; n];
    for _ in 0..(0.1 / dt).round() as usize {
        transport::diffuse(&mut mobile, &d, 1.0, 1.0, 1e12, dt);
    }
    mobile
        .iter()
        .enumerate()
        .map(|(i, v)| v * (2 * i + 1) as f64 / (n * n) as f64)
        .sum()
}

#[test]
fn radial_mesh_converges_to_cylinder_bessel_solution() {
    // Exact average concentration for an initially uniform cylinder with c(R)=0.
    let zeros: [f64; 8] = [
        2.40482555769577,
        5.52007811028631,
        8.65372791291101,
        11.7915344390143,
        14.9309177084878,
        18.0710639679109,
        21.2116366298793,
        24.3524715307493,
    ];
    let exact: f64 = zeros
        .iter()
        .map(|a| 4.0 / a.powi(2) * (-a.powi(2) * 0.1).exp())
        .sum();
    let coarse = (diffusion_mean(16, 0.00002) - exact).abs();
    let fine = (diffusion_mean(64, 0.00002) - exact).abs();
    assert!(fine < coarse / 4.0, "{coarse} {fine}");
    assert!(fine < 1e-4, "{fine}");
}

#[test]
fn implicit_transport_converges_in_time() {
    let reference = diffusion_mean(48, 0.00002);
    let coarse = (diffusion_mean(48, 0.01) - reference).abs();
    let fine = (diffusion_mean(48, 0.0025) - reference).abs();
    assert!(fine < coarse / 3.0);
}

#[test]
fn diffusion_geometry_scaling_and_boundary_flux_close_the_ledger() {
    let n = 32;
    let mut a = vec![1.0; n];
    let mut b = a.clone();
    let da = vec![0.01; n];
    let db = vec![0.04; n];
    let escaped = transport::diffuse(&mut a, &da, 1.0, 1.0, 0.1, 1.0);
    let escaped_scaled = transport::diffuse(&mut b, &db, 2.0, 3.0, 0.2, 1.0);
    for (x, y) in a.iter().zip(&b) {
        assert!((x - y).abs() < 1e-14);
    }
    assert!((escaped_scaled / escaped - 12.0).abs() < 1e-12);
    let retained: f64 = a
        .iter()
        .enumerate()
        .map(|(i, v)| PI * (2 * i + 1) as f64 / (n * n) as f64 * v)
        .sum();
    assert!((retained + escaped - PI).abs() < 1e-13);
}

#[test]
fn network_changes_properties_but_is_not_a_bonding_percentage() {
    let material = Material::default();
    let low = material.properties(0.0, 0.25, 0.0, 0, 1.0).unwrap();
    let high = material.properties(0.0, 0.25, 1.0, 0, 1.0).unwrap();
    assert!(high[1] > low[1]);
    assert!(high[0] < low[0]);
    for props in [low, high] {
        assert!((props[2] * props[1] - 0.25 * material.initial_density()).abs() < 1e-10);
        assert!((props[2].cbrt().powi(3) - props[2]).abs() < 1e-14);
    }
}

#[test]
fn domain_failure_rolls_back_without_manufacturing_mass() {
    for (char_yield, min_solid) in [(0.0, 0.9), (1e-10, 0.9)] {
        let mut config = isothermal(100.0);
        config.material.char_yield = char_yield;
        config.material.min_solid_fraction = min_solid;
        config.material.reaction_a_per_s = 1.0;
        config.min_step_s = 1.0;
        config.max_step_s = 1.0;
        let mut core = PyrolysisCore::new(config).unwrap();
        let before = core.diagnostics().checksum;
        assert!(!core.advance());
        let diagnostics = core.diagnostics();
        assert_eq!(before, diagnostics.checksum);
        let failure = diagnostics.failure.unwrap();
        assert_eq!(failure.code, "material-state-out-of-domain");
        assert_eq!(failure.quantity, "retained-solid-fraction");
        assert_eq!(diagnostics.time_s, 0.0);
        assert!(!core.advance());
    }
}

#[test]
fn porosity_and_density_limits_reject_before_acceptance() {
    let mut config = isothermal(100.0);
    config.material.max_porosity = 0.05;
    let mut core = PyrolysisCore::new(config).unwrap();
    assert!(!core.advance());
    assert_eq!(core.state.time_s, 0.0);
    assert_eq!(
        core.diagnostics().failure.unwrap().quantity,
        "micro-porosity"
    );
    let invalid_material = Material {
        initial_porosity: 1.0,
        ..Material::default()
    };
    assert!(invalid_material.validate().is_err());
    let density = Material {
        min_density_kg_m3: 2000.0,
        ..Material::default()
    };
    assert!(density.validate().is_err());
    assert!(Material::default()
        .properties(0.0, 0.0, 0.0, 0, 0.0)
        .is_err());
}

#[test]
fn checkpoint_replay_and_snapshot_cadence_do_not_change_accepted_steps() {
    let mut original = PyrolysisCore::new(isothermal(100.0)).unwrap();
    for _ in 0..30 {
        original.advance();
    }
    let checkpoint = original.checkpoint();
    let mut restored = PyrolysisCore::from_checkpoint(checkpoint.clone()).unwrap();
    while original.advance() {
        original.snapshot();
        original.diagnostics();
    }
    finish(&mut restored);
    assert_eq!(
        original.diagnostics().checksum,
        restored.diagnostics().checksum
    );
    assert_eq!(original.accepted_steps, restored.accepted_steps);
    let mut corrupted = checkpoint;
    corrupted.state.cells[0].mobile += 0.2;
    assert!(PyrolysisCore::from_checkpoint(corrupted).is_err());
}

#[test]
fn budget_and_nonfinite_configuration_rejected_before_allocation() {
    let mut config = RadialConfig {
        memory_budget_bytes: 100,
        ..RadialConfig::default()
    };
    assert!(PyrolysisCore::new(config.clone()).is_err());
    config.memory_budget_bytes = 1_000_000;
    config.radius_m = f64::NAN;
    assert!(PyrolysisCore::new(config).is_err());
}

#[test]
fn default_schedule_finishes_and_closes_mass() {
    let mut core = PyrolysisCore::new(RadialConfig::default()).unwrap();
    finish(&mut core);
    let d = core.diagnostics();
    assert!(d.relative_mass_error.abs() < 1e-10);
    assert!(d.char_mass_kg / d.initial_mass_kg > 0.249);
    assert!(d.mobile_mass_kg >= 0.0);
    assert!(d.mean_network_order > 0.0);
}

#[test]
fn extraction_is_full_resolution_and_retains_off_target_fragments() {
    use specimen::*;
    let parameters = Parameters::default();
    let occupancy = [1, 0, 0, 0, 1, 0, 0, 0];
    let active = [1; 8];
    let conversion = [0.8, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9];
    let remaining = [0.5; 8];
    let metadata = [0.125; 8];
    let input = PreparationInput {
        dims: [2, 2, 2],
        origin_um: [-1.0, 0.0, 0.0],
        pitch_um: [1.0, 2.0, 3.0],
        source_checksum: "fixture".into(),
        parameters: &parameters,
        source_memory_bytes: 100,
        occupancy: &occupancy,
        active: &active,
        conversion: &conversion,
        remaining: &remaining,
        photoinitiator: &metadata,
        oxygen: &metadata,
        radicals: &metadata,
    };
    let specimen = prepare(
        input,
        PreparationPolicy {
            dry_polymer_density_kg_m3: 1200.0,
            min_conversion: 0.3,
            min_remaining: 0.01,
            memory_budget_bytes: 1_000_000,
        },
    )
    .unwrap();
    assert_eq!(specimen.cells.len(), 3);
    assert_eq!(specimen.ledger.components, 2); // Edge contact is not a weld.
    assert_eq!(specimen.cells[0].component, specimen.cells[1].component);
    assert_ne!(specimen.cells[1].component, specimen.cells[2].component);
    assert!(specimen.ledger.off_target_dry_mass_kg > 0.0);
    assert_eq!(specimen.cells[0].conversion, conversion[0]);
    assert_eq!(specimen.cells[0].oxygen, metadata[0]);
    assert!(
        (specimen.cells[0].dry_mass_kg - 1200.0 * 6e-18 * 0.5 * conversion[0] as f64).abs() < 1e-28
    );
    assert!(specimen.ledger.relative_balance_error.abs() < 1e-14);
    assert_eq!(specimen.pitch_m, [1e-6, 2e-6, 3e-6]);
}

#[test]
fn finite_strain_energy_gradient_and_tangent_match_independent_differences() {
    use mechanics::*;
    let s = [0.7, 0.8, 1.1];
    let nat = [0.55, 0.6, 0.75];
    let (_, p, h) = response(s, nat, 1.5);
    for j in 0..3 {
        let mut hi = s;
        let mut lo = s;
        hi[j] += 1e-6;
        lo[j] -= 1e-6;
        let (wh, ph, _) = response(hi, nat, 1.5);
        let (wl, pl, _) = response(lo, nat, 1.5);
        assert!(((wh - wl) / 2e-6 - p[j]).abs() < 1e-9);
        for i in 0..3 {
            assert!(((ph[i] - pl[i]) / 2e-6 - h[i][j]).abs() < 1e-8);
        }
    }
    // Independent full 3D invariant energy, superposed rotation of F.
    let angle = 0.71_f64;
    let (sin, cos) = angle.sin_cos();
    let f = [
        [cos * s[0], -sin * s[1], 0.0],
        [sin * s[0], cos * s[1], 0.0],
        [0.0, 0.0, s[2]],
    ];
    let mut ic = 0.0;
    for row in f {
        for j in 0..3 {
            ic += (row[j] / nat[j]).powi(2);
        }
    }
    let det = (f[0][0] * f[1][1] - f[0][1] * f[1][0]) * f[2][2];
    let jn = nat.iter().product::<f64>();
    let logj = (det / jn).ln();
    let w3d = jn * (0.5 * (ic - 3.0) - logj + 0.75 * logj * logj);
    assert!((w3d - response(s, nat, 1.5).0).abs() < 1e-14);
}

#[test]
fn annular_assembly_tangent_matches_residual_differences() {
    use mechanics::*;
    let mut d = Deformation::identity(8);
    d.axial_stretch = 0.85;
    for (i, r) in d.radial_faces.iter_mut().enumerate() {
        *r *= 0.8 + 0.01 * i as f64;
    }
    let natural = vec![[0.65, 0.65, 0.7]; 8];
    let a = assemble(&d, &natural, 1.5, 0.3, 0.9);
    let eps = 1e-6;
    for j in 0..9 {
        let mut hi = d.clone();
        let mut lo = d.clone();
        if j == 8 {
            hi.axial_stretch += eps;
            lo.axial_stretch -= eps;
        } else {
            hi.radial_faces[j + 1] += eps;
            lo.radial_faces[j + 1] -= eps;
        }
        let h = assemble(&hi, &natural, 1.5, 0.3, 0.9);
        let l = assemble(&lo, &natural, 1.5, 0.3, 0.9);
        assert!(((h.energy - l.energy) / (2.0 * eps) - a.gradient[j]).abs() < 1e-7);
    }
}

#[test]
fn free_finite_contraction_and_anisotropy_recover_stress_free_tensor() {
    use mechanics::*;
    for n in [4, 16, 64] {
        for natural in [[0.5; 3], [0.4, 0.4, 0.78125]] {
            let config = MechanicsConfig::default();
            let d = solve(
                &Deformation::identity(n),
                &vec![natural; n],
                &config,
                0.0,
                1.0,
            )
            .unwrap();
            for i in 0..n {
                let s = d.stretches(i, 0.5);
                for j in 0..3 {
                    assert!((s[j] - natural[j]).abs() < 2e-9);
                }
                let (_, p, _) = response(s, natural, config.lame_ratio());
                assert!(p.iter().all(|x| x.abs() < 2e-9));
                assert!((d.cell_jacobian(i) - 0.125).abs() < 1e-9);
            }
        }
    }
}

#[test]
fn constrained_cylinder_agrees_with_independent_homogeneous_uniaxial_solution() {
    use mechanics::*;
    let config = MechanicsConfig {
        axial_boundary: AxialBoundary::Prescribed,
        ..MechanicsConfig::default()
    };
    let natural = 0.55_f64;
    let axial = 1.0;
    // Traction-free sides give mu*(b^2-1)+lambda*ln(b^2*lambda_z/a)=0.
    let mut lo = 0.01_f64;
    let mut hi = 2.0_f64;
    for _ in 0..100 {
        let b = (lo + hi) * 0.5;
        if b * b - 1.0 + config.lame_ratio() * (b * b * axial / natural).ln() > 0.0 {
            hi = b;
        } else {
            lo = b;
        }
    }
    let expected_radius = natural * (lo + hi) * 0.5;
    let d = solve(
        &Deformation::identity(32),
        &vec![[natural; 3]; 32],
        &config,
        0.0,
        axial,
    )
    .unwrap();
    assert!((d.radial_faces[32] - expected_radius).abs() < 1e-9);
    assert_eq!(d.axial_stretch, axial);
    let a = assemble(&d, &vec![[natural; 3]; 32], config.lame_ratio(), 0.0, 1.0);
    assert!(a.residual(true) < 1e-9);
    assert!(a.gradient[32] > 0.0);
    assert!((d.cell_jacobian(0) - natural.powi(3)).abs() > 0.01);
}

#[test]
fn moving_anchor_and_compliant_support_balance_axial_force() {
    use mechanics::*;
    let natural = vec![[0.6; 3]; 16];
    let free = solve(
        &Deformation::identity(16),
        &natural,
        &MechanicsConfig::default(),
        0.0,
        1.0,
    )
    .unwrap();
    let config = MechanicsConfig {
        axial_boundary: AxialBoundary::Compliant,
        ..MechanicsConfig::default()
    };
    let spring = 2.0;
    let anchor = 0.8;
    let d = solve(
        &Deformation::identity(16),
        &natural,
        &config,
        spring,
        anchor,
    )
    .unwrap();
    assert!(d.axial_stretch > free.axial_stretch && d.axial_stretch < anchor);
    let body = assemble(&d, &natural, config.lame_ratio(), 0.0, anchor);
    assert!((body.gradient[16] + spring * (d.axial_stretch - anchor)).abs() < 1e-9);
    let prescribed = MechanicsConfig {
        axial_boundary: AxialBoundary::Prescribed,
        ..config
    };
    let d = solve(&d, &natural, &prescribed, 0.0, 0.7).unwrap();
    assert_eq!(d.axial_stretch, 0.7);
}

#[test]
fn heterogeneous_transformation_is_compatible_and_converges_under_refinement() {
    use mechanics::*;
    let compute = |n: usize| {
        let natural: Vec<_> = (0..n)
            .map(|i| {
                let r = (i as f64 + 0.5) / n as f64;
                [0.6 + 0.15 * r * r; 3]
            })
            .collect();
        let c = MechanicsConfig::default();
        let d = solve(&Deformation::identity(n), &natural, &c, 0.0, 1.0).unwrap();
        let a = assemble(&d, &natural, c.lame_ratio(), 0.0, 1.0);
        assert!(a.residual(false) < 1e-9);
        assert!(
            a.energy > 1e-5,
            "heterogeneous natural stretches cannot be assigned independently"
        );
        (d.radial_faces[n], d.axial_stretch)
    };
    let reference = compute(256);
    let error = |x: (f64, f64)| (x.0 - reference.0).abs() + (x.1 - reference.1).abs();
    let e8 = error(compute(8));
    let e16 = error(compute(16));
    let e32 = error(compute(32));
    assert!(e16 < 0.4 * e8 && e32 < 0.4 * e16, "{e8} {e16} {e32}");
}

#[test]
fn moving_transport_preserves_reference_inventory_and_identity_limit() {
    use mechanics::*;
    let mut fixed: Vec<_> = (0..32).map(|i| 0.1 + i as f64 / 64.0).collect();
    let mut moving = fixed.clone();
    let d = vec![0.2; 32];
    let escaped = transport::diffuse(&mut fixed, &d, 1.0, 2.0, 0.1, 0.2);
    let other = transport::diffuse_deformed(
        &mut moving,
        &d,
        1.0,
        2.0,
        &Deformation::identity(32),
        0.1,
        0.2,
    );
    assert!((escaped - other).abs() < 1e-14);
    for (a, b) in fixed.iter().zip(&moving) {
        assert!((a - b).abs() < 1e-13);
    }
    let mut def = Deformation::identity(32);
    for r in &mut def.radial_faces {
        *r *= 0.5;
    }
    def.axial_stretch = 0.4;
    let inventory = |v: &[f64]| {
        v.iter()
            .enumerate()
            .map(|(i, x)| x * (2 * i + 1) as f64 * 2.0 * PI / 1024.0)
            .sum::<f64>()
    };
    let before = inventory(&moving);
    let escaped = transport::diffuse_deformed(&mut moving, &d, 1.0, 2.0, &def, 0.1, 0.2);
    assert!((inventory(&moving) + escaped - before).abs() < 1e-13);
    let zero = vec![0.0; 32];
    let previous = moving.clone();
    assert_eq!(
        transport::diffuse_deformed(&mut moving, &zero, 1.0, 2.0, &def, 0.0, 1.0),
        0.0
    );
    for (a, b) in previous.iter().zip(&moving) {
        assert!((a - b).abs() < 1e-14);
    }
}

#[test]
fn contracted_surface_limited_escape_uses_current_area_and_volume() {
    let mut def = mechanics::Deformation::identity(16);
    for r in &mut def.radial_faces {
        *r *= 0.5;
    }
    def.axial_stretch = 0.7;
    let mut mobile = vec![1.0; 16];
    for _ in 0..1000 {
        transport::diffuse_deformed(&mut mobile, &[1e5; 16], 1.0, 1.0, &def, 0.1, 0.001);
    }
    let exact = (-0.4_f64).exp(); // 2 h / current radius = 0.4 / s.
    for x in mobile {
        assert!((x - exact).abs() < 6e-5, "{x}");
    }
}

#[test]
fn coupled_free_geometry_density_and_thermal_cooling_are_consistent() {
    let mut config = isothermal(100.0);
    config.material.diffusivity_m2_s = 0.0;
    let mut core = PyrolysisCore::new(config).unwrap();
    finish(&mut core);
    for row in core.snapshot().chunks_exact(FIELD_COUNT) {
        assert!((row[10] - row[7]).abs() < 1e-8);
        assert!((row[11] / row[6] - 1.0).abs() < 1e-8);
        assert!(row[15..18].iter().all(|s| s.abs() < 1.0));
    }
    let mut config = RadialConfig::default();
    config.material.reaction_a_per_s = 0.0;
    config.mechanics.thermal_expansion_per_k = 1e-4;
    config.schedule = vec![
        TemperaturePoint {
            time_s: 0.0,
            temperature_k: 300.0,
        },
        TemperaturePoint {
            time_s: 10.0,
            temperature_k: 900.0,
        },
        TemperaturePoint {
            time_s: 20.0,
            temperature_k: 300.0,
        },
    ];
    let mut core = PyrolysisCore::new(config).unwrap();
    while core.state.time_s < 10.0 {
        assert!(core.advance());
    }
    assert!((core.state.deformation.axial_stretch - 0.06_f64.exp()).abs() < 1e-8);
    finish(&mut core);
    assert!((core.diagnostics().volume_ratio - 1.0).abs() < 1e-8);
    assert_eq!(core.state.cells[0].precursor, 1.0);
}

#[test]
fn geometry_checkpoint_corruption_is_rejected_and_constrained_replay_is_exact() {
    let mut config = isothermal(50.0);
    config.mechanics.axial_boundary = mechanics::AxialBoundary::Compliant;
    config.mechanics.final_anchor_stretch = 0.8;
    let mut core = PyrolysisCore::new(config).unwrap();
    for _ in 0..5 {
        assert!(core.advance());
    }
    let checkpoint = core.checkpoint();
    let mut replay = PyrolysisCore::from_checkpoint(checkpoint.clone()).unwrap();
    assert!(core.advance());
    assert!(replay.advance());
    assert_eq!(core.diagnostics().checksum, replay.diagnostics().checksum);
    let mut bad = checkpoint.clone();
    bad.state.deformation.radial_faces[4] = 0.0;
    assert!(PyrolysisCore::from_checkpoint(bad).is_err());
    let mut bad = checkpoint.clone();
    bad.state.deformation.axial_stretch *= 1.01;
    assert!(PyrolysisCore::from_checkpoint(bad).is_err());
    let mut bad = checkpoint;
    bad.schema_version = 1;
    assert!(PyrolysisCore::from_checkpoint(bad).is_err());
}

#[test]
fn coupled_time_refinement_converges_to_expanding_surface_escape_solution() {
    // Uniform mobile inventory, very fast mixing, pure thermal expansion:
    // R(t)=R_initial*exp(b*t), m/m_initial=exp[-2h/R_initial*(1-exp(-bt))/b].
    let compute = |dt: f64| {
        let mut config = isothermal(10.0);
        config.radial_cells = 8;
        config.material.reaction_a_per_s = 0.0;
        config.material.network_a_per_s = 0.0;
        config.material.diffusivity_m2_s = 1e-6;
        config.material.surface_transfer_m_s = 1e-7;
        config.mechanics.thermal_expansion_per_k = 1e-4;
        config.schedule[0].temperature_k = 300.0;
        config.schedule[1].temperature_k = 900.0;
        let core = PyrolysisCore::new(config).unwrap();
        let mut state = core.state.clone();
        for c in &mut state.cells {
            c.precursor = 0.8;
            c.mobile = 0.2;
        }
        state.deformation = mechanics::solve(
            &state.deformation,
            &core.natural_stretches(&state).unwrap(),
            &core.config.mechanics,
            0.0,
            1.0,
        )
        .unwrap();
        for _ in 0..(10.0 / dt).round() as usize {
            state = core.trial(&state, dt).unwrap();
        }
        state
            .cells
            .iter()
            .enumerate()
            .map(|(i, c)| core.initial_cell_mass(i) * c.mobile)
            .sum::<f64>()
            / (core.initial_mass() * 0.2)
    };
    let b = 0.006_f64;
    let exact = (-0.2 / 0.8_f64.cbrt() * (1.0 - (-10.0 * b).exp()) / b).exp();
    let errors = [0.5, 0.25, 0.125].map(|dt| (compute(dt) - exact).abs());
    assert!(
        errors[1] < 0.6 * errors[0] && errors[2] < 0.6 * errors[1],
        "{errors:?}"
    );
}
