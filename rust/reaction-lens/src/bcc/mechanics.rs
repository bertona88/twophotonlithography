//! Compressible equilibrium neo-Hookean branch and an objective isochoric Maxwell branch.
//! The unimodular metric update is Eq.23 of Shutov et al., arXiv:1304.3380.
use super::{math::*, mesh::Mesh, BccConfig, Support};
use crate::pyrolysis::{invalid, Result};

pub fn response(f: M, cv: M, natural: f64, c: &BccConfig) -> (f64, M) {
    let j = det(f);
    if j <= 1e-10 || !j.is_finite() {
        return (f64::INFINITY, [[0.; 3]; 3]);
    }
    let jn = natural.powi(3);
    let logj = (j / jn).ln();
    let inverse_t = transpose(inv(f));
    let eq = if c.relaxation_time_s == 0. {
        1.
    } else {
        c.equilibrium_fraction
    };
    // The Maxwell branch is isochoric: compensate its absent volumetric shear
    // contribution so poissonRatio describes the instantaneous bulk/shear ratio.
    let lame = 2. * c.poisson_ratio / (1. - 2. * c.poisson_ratio) + (1. - eq) * 2. / 3.;
    let mut energy =
        eq * (0.5 * (inner(f, f) / natural.powi(2) - 3.) - logj) + 0.5 * lame * logj * logj;
    let mut p = am(sm(f, eq / natural.powi(2)), sm(inverse_t, lame * logj - eq));
    if eq < 1. {
        let ci = inv(cv);
        let fc = mul(f, ci);
        let tr = inner(fc, f);
        let fac = j.powf(-2. / 3.);
        energy += 0.5 * (1. - eq) * (fac * tr - 3.);
        p = am(p, sm(am(fc, sm(inverse_t, -tr / 3.)), (1. - eq) * fac));
    }
    (energy * jn, sm(p, jn))
}
pub fn relaxed_metric(cv: M, f: M, ratio: f64) -> M {
    let cbar = sm(mul(transpose(f), f), det(f).powf(-2. / 3.));
    let a = am(cv, sm(cbar, ratio));
    sm(a, det(a).powf(-1. / 3.))
}
pub fn von_mises(p: M, f: M) -> f64 {
    let s = sm(mul(p, transpose(f)), 1. / det(f));
    let mean = trace(s) / 3.;
    let mut d = s;
    for (i, row) in d.iter_mut().enumerate() {
        row[i] -= mean;
    }
    (1.5 * inner(d, d)).sqrt()
}

struct Evaluation {
    energy: f64,
    gradient: Vec<f64>,
    residual: f64,
}
fn evaluate(
    mesh: &Mesh,
    x: &[V],
    cv: &[M],
    natural: f64,
    c: &BccConfig,
    diagonal: &[f64],
) -> Evaluation {
    let mut energy = 0.;
    let mut g = vec![0.; 3 * x.len()];
    for (e, t) in mesh.tets.iter().enumerate() {
        let f = mesh.deformation(t, x);
        let (w, p) = response(f, cv[e], natural, c);
        energy += w * t.volume;
        if !energy.is_finite() {
            return Evaluation {
                energy,
                gradient: g,
                residual: f64::INFINITY,
            };
        }
        for a in 0..4 {
            let v = scale(mv(p, t.gradients[a]), t.volume);
            for k in 0..3 {
                g[3 * t.nodes[a] + k] += v[k];
            }
        }
    }
    let mut residual = 0f64;
    for (i, g) in g.iter_mut().enumerate() {
        if mesh.fixed[i / 3] {
            *g = 0.;
        } else {
            residual = residual.max(g.abs() / (diagonal[i] * mesh.h));
        }
    }
    Evaluation {
        energy,
        gradient: g,
        residual,
    }
}
fn dot_slice(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
/// L-BFGS history persists across worker slices, without publishing trial geometry.
pub struct Optimizer {
    diagonal: Vec<f64>,
    evaluation: Evaluation,
    history: Vec<(Vec<f64>, Vec<f64>, f64)>,
    iteration: usize,
}
impl Optimizer {
    pub fn new(mesh: &Mesh, x: &mut [V], cv: &[M], natural: f64, c: &BccConfig) -> Self {
        // For this unloaded, homogeneous free control, this is the exact FE equilibrium;
        // verify its residual rather than approximating a 3D bonded solve by scaling.
        if c.support == Support::Free
            && cv
                .iter()
                .all(|m| inner(am(*m, sm(ID, -1.)), am(*m, sm(ID, -1.))) < 1e-20)
        {
            for (p, r) in x.iter_mut().zip(&mesh.nodes) {
                *p = scale(*r, natural);
            }
        }
        let mut diagonal = vec![0.; 3 * x.len()];
        let lame = 2. * c.poisson_ratio / (1. - 2. * c.poisson_ratio);
        for t in &mesh.tets {
            for a in 0..4 {
                let d = t.volume * dot(t.gradients[a], t.gradients[a]) * (2. + lame) * natural;
                for k in 0..3 {
                    diagonal[t.nodes[a] * 3 + k] += d;
                }
            }
        }
        let evaluation = evaluate(mesh, x, cv, natural, c, &diagonal);
        Self {
            diagonal,
            evaluation,
            history: Vec::new(),
            iteration: 0,
        }
    }
    pub fn advance(
        &mut self,
        mesh: &Mesh,
        x: &mut Vec<V>,
        cv: &[M],
        natural: f64,
        c: &BccConfig,
        budget: usize,
    ) -> Result<Option<(f64, usize)>> {
        let diagonal = &self.diagonal;
        let ev = &mut self.evaluation;
        let history = &mut self.history;
        let iteration = &mut self.iteration;
        let tolerance = 2e-6;
        for _ in 0..budget {
            if ev.residual < tolerance {
                return Ok(Some((ev.residual, *iteration)));
            }
            if *iteration >= 240 {
                return Err(nonconvergence(ev.residual));
            }
            if !ev.energy.is_finite() {
                return Err(invalid("mechanical geometry has a nonpositive Jacobian"));
            }
            let mut q = ev.gradient.clone();
            let mut alpha = vec![0.; history.len()];
            for i in (0..history.len()).rev() {
                let (s, y, rho) = &history[i];
                alpha[i] = rho * dot_slice(s, &q);
                for k in 0..q.len() {
                    q[k] -= alpha[i] * y[k];
                }
            }
            let gamma = history.last().map_or(1., |(s, y, _)| {
                let sy = dot_slice(s, y);
                let ydy: f64 = y.iter().zip(diagonal).map(|(a, d)| a * a / d).sum();
                (sy / ydy).clamp(0.001, 100.)
            });
            for k in 0..q.len() {
                q[k] *= gamma / diagonal[k];
            }
            for (i, (s, y, rho)) in history.iter().enumerate() {
                let beta = rho * dot_slice(y, &q);
                for k in 0..q.len() {
                    q[k] += s[k] * (alpha[i] - beta);
                }
            }
            for (k, value) in q.iter_mut().enumerate() {
                *value = if mesh.fixed[k / 3] { 0. } else { -*value };
            }
            let mut descent = dot_slice(&ev.gradient, &q);
            if descent >= 0. || !descent.is_finite() {
                history.clear();
                for k in 0..q.len() {
                    q[k] = -ev.gradient[k] / diagonal[k];
                }
                descent = dot_slice(&ev.gradient, &q);
            }
            let old = x.clone();
            let mut step = 1.;
            let mut accepted = None;
            for _ in 0..24 {
                for (i, p) in x.iter_mut().enumerate() {
                    for k in 0..3 {
                        p[k] = old[i][k] + step * q[3 * i + k];
                    }
                }
                let candidate = evaluate(mesh, x, cv, natural, c, diagonal);
                if candidate.energy.is_finite()
                    && candidate.energy <= ev.energy + 1e-4 * step * descent + 1e-16
                {
                    accepted = Some(candidate);
                    break;
                }
                step *= 0.5;
            }
            let Some(next) = accepted else {
                *x = old;
                return Err(invalid(
                    "finite-strain line search failed; accepted state retained",
                ));
            };
            let s = q.iter().map(|v| v * step).collect::<Vec<_>>();
            let y = next
                .gradient
                .iter()
                .zip(&ev.gradient)
                .map(|(a, b)| a - b)
                .collect::<Vec<_>>();
            let sy = dot_slice(&s, &y);
            if sy > 1e-20 {
                if history.len() == 8 {
                    history.remove(0);
                }
                history.push((s, y, 1. / sy));
            }
            *ev = next;
            *iteration += 1;
        }
        if ev.residual < tolerance {
            Ok(Some((ev.residual, *iteration)))
        } else if *iteration >= 240 {
            Err(nonconvergence(ev.residual))
        } else {
            Ok(None)
        }
    }
}

fn nonconvergence(residual: f64) -> crate::pyrolysis::Diagnostic {
    let mut d = invalid("finite-strain equilibrium did not converge; accepted state retained");
    d.code = "mechanical-equilibrium-failure".into();
    d.quantity = "normalized-force-residual".into();
    d.value = residual;
    d.bound = 2e-6;
    d
}
#[cfg(test)]
pub fn solve(
    mesh: &Mesh,
    x: &mut Vec<V>,
    cv: &[M],
    natural: f64,
    c: &BccConfig,
) -> Result<(f64, usize)> {
    let mut optimizer = Optimizer::new(mesh, x, cv, natural, c);
    loop {
        if let Some(result) = optimizer.advance(mesh, x, cv, natural, c, 240)? {
            return Ok(result);
        }
    }
}

pub fn residual(mesh: &Mesh, x: &[V], cv: &[M], natural: f64, c: &BccConfig) -> f64 {
    let mut diagonal = vec![0.; x.len() * 3];
    for t in &mesh.tets {
        for a in 0..4 {
            for k in 0..3 {
                diagonal[3 * t.nodes[a] + k] += t.volume
                    * dot(t.gradients[a], t.gradients[a])
                    * (2. + 2. * c.poisson_ratio / (1. - 2. * c.poisson_ratio))
                    * natural;
            }
        }
    }
    evaluate(mesh, x, cv, natural, c, &diagonal).residual
}

#[cfg(test)]
mod boundary_tests {
    use super::*;

    #[test]
    fn converged_last_iteration_is_accepted_before_the_iteration_limit() {
        let config = BccConfig {
            cells_per_axis: 1,
            ..BccConfig::default()
        };
        let mesh = Mesh::new(&config).unwrap();
        let cv = vec![ID; mesh.tets.len()];
        // Budget zero checks the post-batch boundary; a nonzero budget checks
        // the entry boundary. Both must accept a converged final evaluation.
        for budget in [0, 1] {
            let mut positions = mesh.nodes.clone();
            let mut converged = Optimizer::new(&mesh, &mut positions, &cv, 1., &config);
            converged.iteration = 240;
            assert!(converged.evaluation.residual < 2e-6);
            let result = converged
                .advance(&mesh, &mut positions, &cv, 1., &config, budget)
                .unwrap();
            assert_eq!(result.unwrap().1, 240);

            let mut unconverged = Optimizer::new(&mesh, &mut positions, &cv, 0.99, &config);
            unconverged.iteration = 240;
            assert!(unconverged.evaluation.residual > 2e-6);
            assert!(unconverged
                .advance(&mesh, &mut positions, &cv, 0.99, &config, budget)
                .is_err());
        }
    }
}
