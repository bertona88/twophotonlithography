use super::*;
fn accelerated(support: Support) -> BccConfig {
    BccConfig {
        cells_per_axis: 1,
        support,
        schedule: vec![
            TemperaturePoint {
                time_s: 0.,
                temperature_k: 900.,
            },
            TemperaturePoint {
                time_s: 2.,
                temperature_k: 900.,
            },
        ],
        material: Material {
            reaction_a_per_s: 0.02,
            reaction_e_j_mol: 0.,
            ..Material::default()
        },
        max_step_s: 1.,
        ..BccConfig::default()
    }
}
fn next_accepted(core: &mut BccCore) -> bool {
    let previous = core.accepted_steps;
    while core.advance() {
        if core.accepted_steps > previous {
            return true;
        }
    }
    false
}
#[test]
fn coupled_checkpoint_replays_bit_for_bit_and_mass_balances() {
    let mut a = BccCore::new(accelerated(Support::Bonded)).unwrap();
    assert!(next_accepted(&mut a));
    let mut b = BccCore::from_checkpoint(a.checkpoint()).unwrap();
    while next_accepted(&mut a) {
        assert!(next_accepted(&mut b));
        assert_eq!(a.checksum(), b.checksum());
    }
    assert!(!next_accepted(&mut b));
    let d = a.diagnostics();
    assert!(d.complete, "{:?}", d.failure);
    assert!(d.relative_mass_error.abs() < 1e-10);
    assert!(d.min_jacobian > 0.);
    assert!(d.max_stress_m_pa > 0.);
}
#[test]
fn pending_optimizer_yields_without_publishing_trial_state_and_replays_after_restore() {
    let mut a = BccCore::new(accelerated(Support::Bonded)).unwrap();
    let accepted_checksum = a.checksum();
    assert!(a.advance());
    assert!(
        a.pending.is_some(),
        "this nontrivial mechanics step must yield"
    );
    assert_eq!(a.accepted_steps(), 0);
    assert_eq!(a.checksum(), accepted_checksum);
    let mut restored = BccCore::from_checkpoint(a.checkpoint()).unwrap();
    assert!(restored.pending.is_none());
    // A pause makes no calls: pending history remains owned without mutating
    // accepted state. Resuming and restarting the accepted checkpoint agree.
    while next_accepted(&mut a) {
        assert!(next_accepted(&mut restored));
        assert_eq!(a.checksum(), restored.checksum());
        assert_eq!(
            a.state.mechanical_iterations,
            restored.state.mechanical_iterations
        );
    }
    assert!(!next_accepted(&mut restored));
}
#[test]
fn mechanical_slicing_preserves_the_same_iteration_sequence() {
    let config = accelerated(Support::Bonded);
    let mesh = Mesh::new(&config).unwrap();
    let cv = vec![ID; mesh.tets.len()];
    let mut reference = mesh.nodes.clone();
    let expected = mechanics::solve(&mesh, &mut reference, &cv, 0.97, &config).unwrap();
    for budget in [1, 8, 37] {
        let mut positions = mesh.nodes.clone();
        let mut optimizer = mechanics::Optimizer::new(&mesh, &mut positions, &cv, 0.97, &config);
        let result = loop {
            if let Some(result) = optimizer
                .advance(&mesh, &mut positions, &cv, 0.97, &config, budget)
                .unwrap()
            {
                break result;
            }
        };
        assert_eq!(positions, reference);
        assert_eq!(result, expected);
    }
}
#[test]
fn invalid_checkpoint_cannot_move_anchors_invert_geometry_or_erase_mass() {
    let a = BccCore::new(accelerated(Support::Bonded)).unwrap();
    let mut cp = a.checkpoint();
    let index = a.mesh.fixed.iter().position(|v| *v).unwrap();
    cp.state.positions[index][2] = 0.1;
    assert!(BccCore::from_checkpoint(cp).is_err());
    let mut cp = a.checkpoint();
    cp.state.escaped = 1.;
    assert!(BccCore::from_checkpoint(cp).is_err());
    let mut cp = a.checkpoint();
    cp.state.viscous_metrics[0][0][0] = -1.;
    assert!(BccCore::from_checkpoint(cp).is_err());
}
#[test]
fn rejected_material_step_keeps_the_last_accepted_state() {
    let mut c = accelerated(Support::Free);
    c.material.min_solid_fraction = 0.999;
    let mut a = BccCore::new(c).unwrap();
    while a.advance() {}
    let d = a.diagnostics();
    assert!(d.failure.is_some());
    let cp = a.checkpoint();
    assert!(BccCore::from_checkpoint(cp).is_ok());
    let before = a.checksum();
    assert!(!a.advance());
    assert_eq!(before, a.checksum());
}
#[test]
#[ignore = "manual browser-scale full schedule timing"]
fn default_bonded_full_schedule_timing() {
    let mut a = BccCore::new(BccConfig::default()).unwrap();
    let start = std::time::Instant::now();
    let mut maximum = std::time::Duration::ZERO;
    let mut last_logged = 0;
    while a.state.time_s < a.duration() {
        let now = std::time::Instant::now();
        let ok = a.advance();
        maximum = maximum.max(now.elapsed());
        if (a.accepted_steps % 20 == 0 && a.accepted_steps != last_logged) || !ok {
            last_logged = a.accepted_steps;
            eprintln!(
                "step={} time={} residual={} max-call={:?} wall={:?} failure={:?}",
                a.accepted_steps,
                a.state.time_s,
                a.state.mechanical_residual,
                maximum,
                start.elapsed(),
                a.failure
            );
        }
        if !ok {
            break;
        }
    }
    let d = a.diagnostics();
    eprintln!("complete={} nodes={} tets={} volume={} dimensions={:?} residual={} mass={} maxcall={:?} wall={:?} limiter_steps={} min_alpha={}",d.complete,d.nodes,d.elements,d.volume_ratio,d.dimensions_um,d.mechanical_residual,d.relative_mass_error,maximum,start.elapsed(),d.transport_limited_steps,d.transport_limiter_min_alpha);
    assert!(d.complete, "{:?}", d.failure);
}
