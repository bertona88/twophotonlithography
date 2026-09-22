//! Persistent nodal mobile inventories; mass-lumped P1 finite elements on the
//! current tetrahedra. The stiffness passes affine-gradient patch tests.
use super::{math::*, mesh::Mesh, BccConfig, Support};
use crate::pyrolysis::{invalid, Result};
pub fn element_stiffness(
    mesh: &Mesh,
    t: &super::mesh::Tet,
    x: &[V],
    diffusivity: f64,
) -> [[f64; 4]; 4] {
    let f = mesh.deformation(t, x);
    let it = transpose(inv(f));
    let g = t.gradients.map(|v| mv(it, v));
    let volume = t.volume * det(f);
    std::array::from_fn(|i| std::array::from_fn(|j| diffusivity * volume * dot(g[i], g[j])))
}
pub fn volumes(mesh: &Mesh, x: &[V]) -> Vec<f64> {
    let mut v = vec![0.; x.len()];
    for t in &mesh.tets {
        let vol = t.volume * det(mesh.deformation(t, x)) / 4.;
        for &i in &t.nodes {
            v[i] += vol;
        }
    }
    v
}
#[cfg(test)]
pub fn diffuse(
    mesh: &Mesh,
    x: &[V],
    mass: &[f64],
    source_fraction: f64,
    dt: f64,
    order: f64,
    c: &BccConfig,
) -> Result<(Vec<f64>, f64)> {
    let (m, e, _) = diffuse_with_limiter(mesh, x, mass, source_fraction, dt, order, c)?;
    Ok((m, e))
}
pub fn diffuse_with_limiter(
    mesh: &Mesh,
    x: &[V],
    mass: &[f64],
    source_fraction: f64,
    dt: f64,
    order: f64,
    c: &BccConfig,
) -> Result<(Vec<f64>, f64, f64)> {
    let volume = volumes(mesh, x);
    let mut b = mass.to_vec();
    for t in &mesh.tets {
        for &i in &t.nodes {
            b[i] += source_fraction * t.volume / 4.;
        }
    }
    let diffusivity = c.material.diffusivity_m2_s
        * (1. + c.material.network_diffusivity_gain * order)
        / c.pitch_m.powi(2);
    let stiffness = mesh
        .tets
        .iter()
        .map(|t| element_stiffness(mesh, t, x, diffusivity * dt))
        .collect::<Vec<_>>();
    let mut boundary = vec![0.; x.len()];
    for face in &mesh.faces {
        if face.right.is_some() || (face.substrate && c.support == Support::Bonded) {
            continue;
        }
        let [a, b, d] = face.nodes;
        let area = 0.5 * norm(cross(sub(x[b], x[a]), sub(x[d], x[a])));
        let g = dt * c.material.surface_transfer_m_s / c.pitch_m * area / 3.;
        for &i in &face.nodes {
            boundary[i] += g;
        }
    }
    let mut diagonal: Vec<_> = volume.iter().zip(&boundary).map(|(v, b)| v + b).collect();
    for (t, k) in mesh.tets.iter().zip(&stiffness) {
        for a in 0..4 {
            diagonal[t.nodes[a]] += k[a][a];
        }
    }
    let apply = |v: &[f64]| {
        let mut y: Vec<_> = volume
            .iter()
            .zip(&boundary)
            .zip(v)
            .map(|((m, b), v)| (m + b) * v)
            .collect();
        for (t, k) in mesh.tets.iter().zip(&stiffness) {
            for a in 0..4 {
                y[t.nodes[a]] += (0..4).map(|b| k[a][b] * v[t.nodes[b]]).sum::<f64>();
            }
        }
        y
    };
    let inner = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
    let mut concentration: Vec<_> = b.iter().zip(&volume).map(|(m, v)| m / v).collect();
    let ac = apply(&concentration);
    let mut r: Vec<_> = b.iter().zip(ac).map(|(b, a)| b - a).collect();
    let mut z: Vec<_> = r.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
    let mut p = z.clone();
    let mut rz = inner(&r, &z);
    let bnorm = inner(&b, &b).sqrt();
    let tolerance = 1e-12 * bnorm.max(1e-20);
    let mut converged = inner(&r, &r).sqrt() <= tolerance;
    for _ in 0..800 {
        if converged {
            break;
        }
        let ap = apply(&p);
        let pap = inner(&p, &ap);
        if pap <= 0. || !pap.is_finite() {
            return Err(invalid("transport matrix lost positive definiteness"));
        }
        let alpha = rz / pap;
        for i in 0..r.len() {
            concentration[i] += alpha * p[i];
            r[i] -= alpha * ap[i];
        }
        if inner(&r, &r).sqrt() <= tolerance {
            converged = true;
            break;
        }
        for i in 0..r.len() {
            z[i] = r[i] / diagonal[i];
        }
        let next = inner(&r, &z);
        let beta = next / rz;
        for i in 0..p.len() {
            p[i] = z[i] + beta * p[i];
        }
        rz = next;
    }
    if !converged {
        return Err(invalid("implicit transport failed to converge"));
    }
    if concentration.iter().any(|v| !v.is_finite()) {
        return Err(invalid("nonfinite mobile concentration"));
    }
    let mut alpha = 1f64;
    if concentration.iter().any(|v| *v < 0.) {
        // Conservative convex limiting. The low-order graph operator adds a
        // symmetric zero-row-sum diffusion, making off-diagonals nonpositive.
        // Both systems have the identical global mass+Robin balance; their convex
        // combination therefore preserves that balance without clipping a pool.
        let mut edges = std::collections::BTreeMap::<(usize, usize), f64>::new();
        for (t, k) in mesh.tets.iter().zip(&stiffness) {
            for (a, row) in k.iter().enumerate() {
                for (b, coefficient) in row.iter().enumerate().skip(a + 1) {
                    let (i, j) = (t.nodes[a].min(t.nodes[b]), t.nodes[a].max(t.nodes[b]));
                    *edges.entry((i, j)).or_default() += coefficient;
                }
            }
        }
        let mut rows = vec![Vec::<(usize, f64)>::new(); x.len()];
        let mut low_diagonal: Vec<_> = volume.iter().zip(&boundary).map(|(v, b)| v + b).collect();
        for ((i, j), k) in edges {
            let g = (-k).max(0.);
            if g > 0. {
                rows[i].push((j, g));
                rows[j].push((i, g));
                low_diagonal[i] += g;
                low_diagonal[j] += g;
            }
        }
        let mut low: Vec<_> = b.iter().zip(&low_diagonal).map(|(b, d)| b / d).collect();
        let mut low_converged = false;
        for _ in 0..1200 {
            for i in 0..low.len() {
                low[i] = (b[i] + rows[i].iter().map(|(j, g)| g * low[*j]).sum::<f64>())
                    / low_diagonal[i];
            }
            let residual: f64 = (0..low.len())
                .map(|i| {
                    let r = low_diagonal[i] * low[i]
                        - rows[i].iter().map(|(j, g)| g * low[*j]).sum::<f64>()
                        - b[i];
                    r * r
                })
                .sum();
            if residual.sqrt() <= tolerance {
                low_converged = true;
                break;
            }
        }
        if !low_converged {
            return Err(invalid("positive low-order transport failed to converge"));
        }
        for (high, lo) in concentration.iter().zip(&low) {
            if *high < 0. {
                alpha = alpha.min(lo / (lo - high));
            }
        }
        alpha *= 1. - 1e-10;
        for (high, lo) in concentration.iter_mut().zip(low) {
            *high = alpha * (*high) + (1. - alpha) * lo;
        }
        if concentration.iter().any(|v| *v < 0.) {
            return Err(invalid(
                "conservative transport limiter could not preserve positivity",
            ));
        }
    }
    let escaped: f64 = boundary
        .iter()
        .zip(&concentration)
        .map(|(a, b)| a * b)
        .sum();
    let new_mass: Vec<_> = volume
        .iter()
        .zip(concentration)
        .map(|(a, b)| a * b)
        .collect();
    let balance = (new_mass.iter().sum::<f64>() + escaped - b.iter().sum::<f64>()).abs();
    if balance > 1e-10 * mesh.volume {
        return Err(invalid("transport mass ledger failed"));
    }
    Ok((new_mass, escaped, alpha))
}
