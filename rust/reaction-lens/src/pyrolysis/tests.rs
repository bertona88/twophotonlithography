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
