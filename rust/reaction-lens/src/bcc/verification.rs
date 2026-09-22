//! Independent numerical checks: manufactured affine fields, graph topology,
//! constitutive derivatives and invariants. These are not material calibration.

use super::{math::*, mechanics, mesh::Mesh, transport, BccConfig, Support};
use std::collections::{BTreeSet, VecDeque};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance * expected.abs().max(1.0),
        "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

fn manufactured_deformation() -> M {
    [[0.81, 0.14, -0.04], [0.03, 0.93, 0.08], [0.05, -0.06, 0.72]]
}

#[test]
fn bcc_mesh_has_face_connected_tetrahedra_and_a_finite_bonded_footprint() {
    let config = BccConfig {
        cells_per_axis: 2,
        voxels_per_cell: 8,
        strut_radius_ratio: 0.22,
        support: Support::Bonded,
        ..BccConfig::default()
    };
    let mesh = Mesh::new(&config).expect("resolved BCC mesh");
    let mut adjacency = vec![Vec::new(); mesh.tets.len()];
    let mut substrate_area = 0.0;
    for face in &mesh.faces {
        if let Some(right) = face.right {
            adjacency[face.left].push(right);
            adjacency[right].push(face.left);
            assert!(!face.substrate, "substrate cannot be an interior face");
        } else if face.substrate {
            let [a, b, c] = face.nodes.map(|id| mesh.nodes[id]);
            substrate_area += 0.5 * norm(cross(sub(b, a), sub(c, a)));
            for node in face.nodes {
                assert!(mesh.fixed[node]);
            }
        }
    }
    let mut visited = BTreeSet::from([0]);
    let mut queue = VecDeque::from([0]);
    while let Some(tet) = queue.pop_front() {
        for &neighbor in &adjacency[tet] {
            if visited.insert(neighbor) {
                queue.push_back(neighbor);
            }
        }
    }
    assert_eq!(visited.len(), mesh.tets.len(), "no point-only joints");
    assert!(substrate_area > 0.0 && substrate_area < 4.0);
    assert!(mesh.fixed.iter().filter(|&&fixed| fixed).count() > 3);
    for (node, &fixed) in mesh.nodes.iter().zip(&mesh.fixed) {
        assert_eq!(fixed, node[2] == 0.0);
    }
    assert!(mesh.tets.iter().all(|tet| tet.volume > 0.0));
    close(
        mesh.tets.iter().map(|tet| tet.volume).sum(),
        mesh.volume,
        1e-12,
    );
}

#[test]
fn tetrahedra_reproduce_a_general_affine_deformation_and_scalar_gradient() {
    let mesh = Mesh::new(&BccConfig::default()).expect("default mesh");
    let affine = manufactured_deformation();
    let translation = [0.7, -0.4, 0.2];
    let spatial_gradient = [0.31, -0.27, 0.63];
    let positions: Vec<V> = mesh
        .nodes
        .iter()
        .map(|&x| add(mv(affine, x), translation))
        .collect();
    let concentration: Vec<f64> = positions
        .iter()
        .map(|&x| 2.0 + dot(spatial_gradient, x))
        .collect();
    let inverse_transpose = transpose(inv(affine));

    for tet in &mesh.tets {
        let computed = mesh.deformation(tet, &positions);
        for i in 0..3 {
            for j in 0..3 {
                close(computed[i][j], affine[i][j], 1e-12);
            }
        }
        let mut reference_gradient = [0.0; 3];
        let mut partition_gradient = [0.0; 3];
        for (local, &id) in tet.nodes.iter().enumerate() {
            reference_gradient = add(
                reference_gradient,
                scale(tet.gradients[local], concentration[id]),
            );
            partition_gradient = add(partition_gradient, tet.gradients[local]);
        }
        let computed_gradient = mv(inverse_transpose, reference_gradient);
        for axis in 0..3 {
            close(partition_gradient[axis], 0.0, 1e-12);
            close(computed_gradient[axis], spatial_gradient[axis], 1e-11);
        }
        close(det(computed) * tet.volume, det(affine) * tet.volume, 1e-12);
    }
}

#[test]
fn bcc_volume_and_footprint_are_mirror_symmetric() {
    let mesh = Mesh::new(&BccConfig::default()).expect("default mesh");
    // Quantization is only a node-lookup key; it does not alter geometry.
    let key = |point: V| point.map(|value| (value * 1e9).round() as i64);
    let keys: BTreeSet<_> = mesh.nodes.iter().map(|&point| key(point)).collect();
    for &point in &mesh.nodes {
        assert!(keys.contains(&key([-point[0], point[1], point[2]])));
        assert!(keys.contains(&key([point[0], -point[1], point[2]])));
    }
}

// Explicit scalar expansion keeps the energy reference independent of the
// production matrix determinant, inverse and constitutive response routines.
fn reference_determinant(a: M) -> f64 {
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
}

fn reference_energy(f: M, cv: M, natural: f64, config: &BccConfig) -> f64 {
    let j = reference_determinant(f);
    let jn = natural.powi(3);
    let logj = (j / jn).ln();
    let eq = if config.relaxation_time_s == 0.0 {
        1.0
    } else {
        config.equilibrium_fraction
    };
    let lame =
        2.0 * config.poisson_ratio / (1.0 - 2.0 * config.poisson_ratio) + (1.0 - eq) * 2.0 / 3.0;
    let norm2: f64 = f.iter().flatten().map(|value| value * value).sum();
    let mut energy = eq * (0.5 * (norm2 / natural.powi(2) - 3.0) - logj) + 0.5 * lame * logj * logj;
    if eq < 1.0 {
        let d = reference_determinant(cv);
        let inverse: M = std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                let rows: Vec<usize> = (0..3).filter(|&r| r != j).collect();
                let cols: Vec<usize> = (0..3).filter(|&c| c != i).collect();
                let minor = cv[rows[0]][cols[0]] * cv[rows[1]][cols[1]]
                    - cv[rows[0]][cols[1]] * cv[rows[1]][cols[0]];
                minor * if (i + j) % 2 == 0 { 1.0 } else { -1.0 } / d
            })
        });
        let mut trace_product = 0.0;
        for row in &f {
            for i in 0..3 {
                for k in 0..3 {
                    trace_product += row[i] * inverse[i][k] * row[k];
                }
            }
        }
        energy += 0.5 * (1.0 - eq) * (j.powf(-2.0 / 3.0) * trace_product - 3.0);
    }
    jn * energy
}

#[test]
fn constitutive_nominal_stress_matches_independent_energy_derivatives() {
    let mut config = BccConfig::default();
    let f = manufactured_deformation();
    let cv_raw = [[1.4, 0.2, 0.1], [0.2, 0.9, -0.03], [0.1, -0.03, 0.82]];
    let cv = sm(cv_raw, reference_determinant(cv_raw).powf(-1.0 / 3.0));
    for relaxation_time in [0.0, 50.0] {
        config.relaxation_time_s = relaxation_time;
        let (energy, nominal) = mechanics::response(f, cv, 0.68, &config);
        close(energy, reference_energy(f, cv, 0.68, &config), 2e-13);
        for i in 0..3 {
            for j in 0..3 {
                let mut plus = f;
                let mut minus = f;
                plus[i][j] += 1e-6;
                minus[i][j] -= 1e-6;
                let derivative = (reference_energy(plus, cv, 0.68, &config)
                    - reference_energy(minus, cv, 0.68, &config))
                    / 2e-6;
                close(nominal[i][j], derivative, 2e-8);
            }
        }
    }
}

#[test]
fn instantaneous_bulk_and_shear_match_the_configured_poisson_ratio() {
    let epsilon = 1e-6;
    for equilibrium_fraction in [0.05, 0.25, 1.0] {
        let config = BccConfig {
            equilibrium_fraction,
            relaxation_time_s: 300.0,
            ..BccConfig::default()
        };
        let bulk = 2.0 * (1.0 + config.poisson_ratio) / (3.0 * (1.0 - 2.0 * config.poisson_ratio));
        let dilation = sm(ID, 1.0 + epsilon);
        let pressure = mechanics::response(dilation, ID, 1.0, &config).1[0][0] / epsilon;
        close(pressure, 3.0 * bulk, 5e-6);
        let shear = [[1.0, epsilon, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        close(
            mechanics::response(shear, ID, 1.0, &config).1[0][1] / epsilon,
            1.0,
            1e-9,
        );
    }
}

#[test]
fn finite_strain_response_and_relaxation_are_objective_under_rigid_rotation() {
    let config = BccConfig::default();
    let f = manufactured_deformation();
    let angle: f64 = 0.71;
    let rotation = [
        [angle.cos(), -angle.sin(), 0.0],
        [angle.sin(), angle.cos(), 0.0],
        [0.0, 0.0, 1.0],
    ];
    let rotated = mul(rotation, f);
    let cv = mechanics::relaxed_metric(ID, f, 0.43);
    let cv_rotated = mechanics::relaxed_metric(ID, rotated, 0.43);
    let (energy, stress) = mechanics::response(f, cv, 0.74, &config);
    let (rotated_energy, rotated_stress) = mechanics::response(rotated, cv_rotated, 0.74, &config);
    let expected_stress = mul(rotation, stress);
    close(rotated_energy, energy, 1e-12);
    for i in 0..3 {
        for j in 0..3 {
            close(cv_rotated[i][j], cv[i][j], 1e-12);
            close(rotated_stress[i][j], expected_stress[i][j], 1e-12);
        }
    }
    close(
        mechanics::von_mises(rotated_stress, rotated),
        mechanics::von_mises(stress, f),
        1e-12,
    );
}

#[test]
fn maxwell_hold_dissipates_energy_without_changing_viscous_volume() {
    let config = BccConfig {
        relaxation_time_s: 10.0,
        ..BccConfig::default()
    };
    let f = [[1.0, 0.65, 0.0], [0.0, 1.0, 0.17], [0.0, 0.0, 1.0]];
    let mut metric = ID;
    let initial = mechanics::response(f, metric, 1.0, &config).0;
    let mut previous = initial;
    for _ in 0..80 {
        metric = mechanics::relaxed_metric(metric, f, 0.2);
        assert!(spd(metric));
        close(det(metric), 1.0, 1e-12);
        let energy = mechanics::response(f, metric, 1.0, &config).0;
        assert!(
            energy <= previous + 2e-13,
            "held-deformation energy increased"
        );
        previous = energy;
    }
    assert!(
        previous < 0.5 * initial,
        "Maxwell branch must actually relax"
    );
}

#[test]
fn maxwell_small_shear_converges_to_analytic_exponential_relaxation() {
    let config = BccConfig {
        relaxation_time_s: 1.0,
        equilibrium_fraction: 0.2,
        ..BccConfig::default()
    };
    let shear = 1e-5;
    let f = [[1.0, shear, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let exact = shear
        * (config.equilibrium_fraction + (1.0 - config.equilibrium_fraction) * (-1.0f64).exp());
    let error = |steps| {
        let mut cv = ID;
        for _ in 0..steps {
            cv = mechanics::relaxed_metric(cv, f, 1.0 / steps as f64);
        }
        (mechanics::response(f, cv, 1.0, &config).1[0][1] - exact).abs()
    };
    let coarse = error(20);
    let fine = error(40);
    assert!(
        fine < 0.55 * coarse,
        "first-order relaxation refinement: {coarse:e} -> {fine:e}"
    );
    assert!(fine / shear < 0.005);
}

#[test]
fn free_lattice_recovers_zero_stress_finite_contraction() {
    let config = BccConfig {
        cells_per_axis: 1,
        support: Support::Free,
        ..BccConfig::default()
    };
    let mesh = Mesh::new(&config).expect("free mesh");
    let mut positions = mesh.nodes.clone();
    let history = vec![ID; mesh.tets.len()];
    let natural = 0.56;
    let (residual, _) = mechanics::solve(&mesh, &mut positions, &history, natural, &config)
        .expect("free contraction equilibrium");
    assert!(residual < 1e-12);
    for (actual, reference) in positions.iter().zip(&mesh.nodes) {
        for axis in 0..3 {
            close(actual[axis], natural * reference[axis], 1e-12);
        }
    }
    let mut volume = 0.0;
    for tet in &mesh.tets {
        let f = mesh.deformation(tet, &positions);
        let (energy, stress) = mechanics::response(f, ID, natural, &config);
        close(energy, 0.0, 1e-12);
        assert!(inner(stress, stress).sqrt() < 1e-11);
        volume += det(f) * tet.volume;
    }
    close(volume / mesh.volume, natural.powi(3), 1e-12);
}

#[test]
fn bonded_lattice_contracts_above_an_exactly_immobile_substrate() {
    let config = BccConfig {
        cells_per_axis: 1,
        support: Support::Bonded,
        relaxation_time_s: 0.0,
        ..BccConfig::default()
    };
    let mesh = Mesh::new(&config).expect("bonded mesh");
    let mut positions = mesh.nodes.clone();
    let history = vec![ID; mesh.tets.len()];
    mechanics::solve(&mesh, &mut positions, &history, 0.96, &config).expect("bonded equilibrium");
    let mut top_before = 0.0;
    let mut top_after = 0.0;
    for (i, (actual, reference)) in positions.iter().zip(&mesh.nodes).enumerate() {
        if mesh.fixed[i] {
            assert_eq!(actual, reference, "bonded footprint moved");
        }
        if reference[2] > 0.99 {
            top_before += reference[2];
            top_after += actual[2];
        }
    }
    assert!(top_after < top_before - 0.01);
    let mut energy = 0.0;
    for tet in &mesh.tets {
        let f = mesh.deformation(tet, &positions);
        assert!(det(f) > 0.0);
        energy += mechanics::response(f, ID, 0.96, &config).0 * tet.volume;
    }
    assert!(energy > 1e-7, "rigid bond must prevent stress-free scaling");
}

#[test]
fn deformed_fem_diffusion_passes_the_affine_neumann_patch_test() {
    let config = BccConfig {
        cells_per_axis: 1,
        ..BccConfig::default()
    };
    let mesh = Mesh::new(&config).expect("mesh");
    let affine = manufactured_deformation();
    let positions: Vec<V> = mesh.nodes.iter().map(|&x| mv(affine, x)).collect();
    let gradient = [0.31, -0.27, 0.63];
    let diffusivity = 0.37;
    let concentration: Vec<f64> = positions.iter().map(|&x| 2.0 + dot(gradient, x)).collect();
    let mut stiffness_load = vec![0.0; mesh.nodes.len()];
    for tet in &mesh.tets {
        let stiffness = transport::element_stiffness(&mesh, tet, &positions, diffusivity);
        for i in 0..4 {
            close(stiffness[i].iter().sum(), 0.0, 1e-12);
            for j in 0..4 {
                close(stiffness[i][j], stiffness[j][i], 1e-12);
                stiffness_load[tet.nodes[i]] += stiffness[i][j] * concentration[tet.nodes[j]];
            }
        }
    }
    // Divergence theorem gives the exact boundary load for an affine field.
    // There is no numerical face-distance or production matrix inversion here.
    let mut boundary_load = vec![0.0; mesh.nodes.len()];
    for face in &mesh.faces {
        if face.right.is_none() {
            let [a, b, c] = face.nodes.map(|id| positions[id]);
            let outward_area_vector = scale(cross(sub(b, a), sub(c, a)), 0.5);
            let nodal_load = diffusivity * dot(gradient, outward_area_vector) / 3.0;
            for &node in &face.nodes {
                boundary_load[node] += nodal_load;
            }
        }
    }
    for (actual, expected) in stiffness_load.iter().zip(&boundary_load) {
        close(*actual, *expected, 3e-12);
    }
}

#[test]
fn no_flux_deformed_transport_preserves_constant_concentration_and_mass() {
    let mut config = BccConfig {
        cells_per_axis: 1,
        ..BccConfig::default()
    };
    config.material.surface_transfer_m_s = 0.0;
    let mesh = Mesh::new(&config).expect("mesh");
    let positions: Vec<V> = mesh
        .nodes
        .iter()
        .map(|&x| mv(manufactured_deformation(), x))
        .collect();
    let volumes = transport::volumes(&mesh, &positions);
    let mass: Vec<f64> = volumes.iter().map(|volume| volume * 0.13).collect();
    let (after, escaped) = transport::diffuse(&mesh, &positions, &mass, 0.0, 50.0, 0.4, &config)
        .expect("constant concentration transport");
    close(escaped, 0.0, 1e-14);
    for (after, before) in after.iter().zip(&mass) {
        close(*after, *before, 1e-12);
    }
    let (generated, escaped) =
        transport::diffuse(&mesh, &positions, &mass, 0.07, 5.0, 0.4, &config)
            .expect("closed generated inventory");
    close(escaped, 0.0, 1e-14);
    close(
        generated.iter().sum::<f64>(),
        mass.iter().sum::<f64>() + 0.07 * mesh.volume,
        1e-11,
    );
    assert!(generated.iter().all(|mass| *mass >= 0.0));
}

#[test]
fn surface_escape_matches_independent_robin_decay_and_seals_the_substrate() {
    let mut escaped_by_support = Vec::new();
    for support in [Support::Free, Support::Bonded] {
        let mut config = BccConfig {
            cells_per_axis: 1,
            support,
            ..BccConfig::default()
        };
        config.material.diffusivity_m2_s = 0.0;
        config.material.surface_transfer_m_s = 1e-7;
        let mesh = Mesh::new(&config).expect("mesh");
        let volumes = transport::volumes(&mesh, &mesh.nodes);
        let mass: Vec<f64> = volumes.iter().map(|volume| volume * 0.2).collect();
        let dt = 0.4;
        let mut surface_capacity = vec![0.0; mesh.nodes.len()];
        for face in &mesh.faces {
            if face.right.is_none() && !(face.substrate && support == Support::Bonded) {
                let [a, b, c] = face.nodes.map(|id| mesh.nodes[id]);
                let area = norm(cross(sub(b, a), sub(c, a))) / 2.0;
                for &node in &face.nodes {
                    surface_capacity[node] +=
                        dt * config.material.surface_transfer_m_s / config.pitch_m * area / 3.0;
                }
            }
        }
        let expected_escape: f64 = mass
            .iter()
            .zip(&surface_capacity)
            .zip(&volumes)
            .map(|((m, capacity), volume)| m * capacity / (volume + capacity))
            .sum();
        let (remaining, escaped) =
            transport::diffuse(&mesh, &mesh.nodes, &mass, 0.0, dt, 0.0, &config)
                .expect("surface-only escape");
        close(escaped, expected_escape, 1e-12);
        close(
            remaining.iter().sum::<f64>() + escaped,
            mass.iter().sum(),
            1e-12,
        );
        escaped_by_support.push(escaped);
    }
    assert!(
        escaped_by_support[1] < escaped_by_support[0],
        "bond must remove a finite escape area"
    );
}

#[test]
fn transport_limiter_preserves_a_nonnegative_localized_inventory_and_the_ledger() {
    let mut config = BccConfig {
        cells_per_axis: 1,
        voxels_per_cell: 8,
        strut_radius_ratio: 0.22,
        ..BccConfig::default()
    };
    config.material.diffusivity_m2_s = config.pitch_m.powi(2);
    config.material.surface_transfer_m_s = 0.0;
    let mesh = Mesh::new(&config).expect("limiter mesh");
    let deformation = [[0.5, 0.8, 0.0], [0.0, 0.5, 0.0], [0.0, 0.0, 0.7]];
    let positions: Vec<V> = mesh.nodes.iter().map(|&x| mv(deformation, x)).collect();
    let volumes = transport::volumes(&mesh, &positions);
    let center = mesh
        .nodes
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            norm(sub(**a, [0.0, 0.0, 0.5])).total_cmp(&norm(sub(**b, [0.0, 0.0, 0.5])))
        })
        .unwrap()
        .0;
    let mut mass = vec![0.0; mesh.nodes.len()];
    mass[center] = 0.2 * volumes[center];
    let (after, escaped, alpha) =
        transport::diffuse_with_limiter(&mesh, &positions, &mass, 0.0, 0.01, 0.0, &config)
            .expect("limited sharply localized transport");
    assert!(after.iter().all(|&value| value >= 0.0));
    assert!(
        alpha < 1.0,
        "adversarial skew-mesh test must exercise limiting"
    );
    close(escaped, 0.0, 1e-14);
    close(after.iter().sum::<f64>(), mass.iter().sum(), 1e-11);
    eprintln!("BCC LIMITER: localized skew-mesh alpha={alpha:e}");
}

#[test]
fn smooth_positive_transport_retains_the_galerkin_solution_on_refined_skew_meshes() {
    for resolution in [8, 10, 12] {
        let mut config = BccConfig {
            cells_per_axis: 1,
            voxels_per_cell: resolution,
            strut_radius_ratio: 0.22,
            ..BccConfig::default()
        };
        config.material.diffusivity_m2_s = config.pitch_m.powi(2);
        config.material.surface_transfer_m_s = 0.0;
        let mesh = Mesh::new(&config).expect("smooth transport mesh");
        let positions: Vec<V> = mesh
            .nodes
            .iter()
            .map(|&x| mv(manufactured_deformation(), x))
            .collect();
        let volumes = transport::volumes(&mesh, &positions);
        let mass: Vec<f64> = positions
            .iter()
            .zip(&volumes)
            .map(|(x, v)| v * (2.0 + 0.31 * x[0] - 0.27 * x[1] + 0.63 * x[2]))
            .collect();
        let (after, escaped, alpha) =
            transport::diffuse_with_limiter(&mesh, &positions, &mass, 0.0, 0.03, 0.0, &config)
                .expect("smooth transport");
        assert_eq!(
            alpha, 1.0,
            "limiter should be inactive on smooth positive fields"
        );
        close(
            after.iter().sum::<f64>() + escaped,
            mass.iter().sum(),
            1e-10,
        );
    }
}

#[test]
#[ignore = "explicit full-schedule release validation; records runtime and accepted state"]
fn default_bonded_schedule_completes_with_conservation_and_positive_geometry() {
    let started = std::time::Instant::now();
    let mut core = super::BccCore::new(BccConfig::default()).expect("default configuration");
    let mut increments = 0;
    while core.advance() {
        increments += 1;
        if increments % 100 == 0 {
            let d = core.diagnostics();
            eprintln!(
                "BCC progress: t={}s, steps={}, rejected={}, residual={:e}, elapsed={:.2}s",
                d.time_s,
                d.accepted_steps,
                d.rejected_steps,
                d.mechanical_residual,
                started.elapsed().as_secs_f64()
            );
        }
        assert!(increments < 20_000, "default schedule step budget");
    }
    let d = core.diagnostics();
    assert!(d.failure.is_none(), "default run failed: {:?}", d.failure);
    assert!(d.complete, "default schedule stopped at {}", d.time_s);
    assert!(d.min_jacobian > 0.0);
    assert!(d.relative_mass_error.abs() < 1e-9);
    assert!(d.mechanical_residual < 2.1e-6);
    assert!(d.dimensions_um[2] < d.reference_dimensions_um[2]);
    assert!(d.relaxation_dissipation_j > 0.0);
    eprintln!("BCC DEFAULT VERIFIED: elapsed={:.3}s steps={} rejected={} nodes={} elements={} dimensions_um={:?} volume_ratio={:.10} mass_error={:e} min_j={:.10} residual={:e} dissipated_j={:e} checksum={}", started.elapsed().as_secs_f64(), d.accepted_steps, d.rejected_steps, d.nodes, d.elements, d.dimensions_um, d.volume_ratio, d.relative_mass_error, d.min_jacobian, d.mechanical_residual, d.relaxation_dissipation_j, d.checksum);
}

#[test]
#[ignore = "explicit mesh sensitivity record; no claim that peak clamp stress converges"]
fn bonded_lattice_mesh_refinement_records_dimensions_volume_and_energy() {
    let mut last: Option<(f64, f64)> = None;
    for resolution in [10, 12] {
        let config = BccConfig {
            cells_per_axis: 1,
            voxels_per_cell: resolution,
            strut_radius_ratio: 0.15,
            support: Support::Bonded,
            relaxation_time_s: 0.0,
            ..BccConfig::default()
        };
        let mesh = Mesh::new(&config).expect("resolved mesh");
        let mut positions = mesh.nodes.clone();
        let history = vec![ID; mesh.tets.len()];
        let (residual, iterations) =
            mechanics::solve(&mesh, &mut positions, &history, 0.9, &config)
                .expect("refined bonded equilibrium");
        let height = positions.iter().map(|point| point[2]).fold(0.0, f64::max);
        let mut volume = 0.0;
        let mut energy = 0.0;
        for tet in &mesh.tets {
            let f = mesh.deformation(tet, &positions);
            volume += det(f) * tet.volume;
            energy += mechanics::response(f, ID, 0.9, &config).0 * tet.volume;
        }
        let volume_ratio = volume / mesh.volume;
        eprintln!("BCC MESH: voxels_per_cell={resolution} nodes={} tets={} reference_volume={:.10} height_ratio={:.10} volume_ratio={volume_ratio:.10} energy={energy:.10} residual={residual:e} iterations={iterations}", mesh.nodes.len(), mesh.tets.len(), mesh.volume, height);
        assert!(height < 1.0 && height > 0.8);
        assert!(volume_ratio > 0.7 && volume_ratio < 1.0);
        if let Some((previous_height, previous_volume)) = last {
            assert!(
                (height - previous_height).abs() < 0.03,
                "unresolved height sensitivity"
            );
            assert!(
                (volume_ratio - previous_volume).abs() < 0.03,
                "unresolved volume sensitivity"
            );
        }
        last = Some((height, volume_ratio));
    }
}

#[test]
#[ignore = "explicit coupled timestep refinement against a fine-step reference"]
fn bonded_chemomechanical_timestep_refinement_reduces_history_error() {
    let run = |max_step_s| {
        let mut config = BccConfig {
            cells_per_axis: 1,
            max_step_s,
            relaxation_time_s: 10.0,
            ..BccConfig::default()
        };
        config.schedule = vec![
            crate::pyrolysis::schedule::TemperaturePoint {
                time_s: 0.0,
                temperature_k: 900.0,
            },
            crate::pyrolysis::schedule::TemperaturePoint {
                time_s: 20.0,
                temperature_k: 900.0,
            },
        ];
        config.material.reaction_a_per_s = 0.02;
        config.material.reaction_e_j_mol = 0.0;
        config.material.network_a_per_s = 0.0;
        config.material.surface_transfer_m_s = 0.0;
        let mut core = super::BccCore::new(config).expect("time study configuration");
        while core.advance() {}
        let diagnostics = core.diagnostics();
        assert!(
            diagnostics.failure.is_none(),
            "time refinement failed: {:?}",
            diagnostics.failure
        );
        assert!(diagnostics.complete);
        assert!(diagnostics.relative_mass_error.abs() < 1e-9);
        eprintln!("BCC TIME: max_step={max_step_s}s accepted={} rejected={} dimensions={:?} volume={} dissipated={:e}", diagnostics.accepted_steps, diagnostics.rejected_steps, diagnostics.dimensions_um, diagnostics.volume_ratio, diagnostics.relaxation_dissipation_j);
        core.checkpoint().state
    };
    let reference = run(0.125);
    let mut previous_error = f64::INFINITY;
    for step in [2.0, 1.0, 0.5] {
        let state = run(step);
        let squared: f64 = state
            .viscous_metrics
            .iter()
            .flatten()
            .flatten()
            .zip(reference.viscous_metrics.iter().flatten().flatten())
            .map(|(a, b)| (a - b).powi(2))
            .sum();
        let error = (squared / (state.viscous_metrics.len() * 9) as f64).sqrt();
        eprintln!("BCC TIME ERROR: max_step={step}s metric_rms={error:e}");
        assert!(
            error < previous_error * 0.8,
            "history error did not fall with timestep refinement"
        );
        previous_error = error;
    }
}
