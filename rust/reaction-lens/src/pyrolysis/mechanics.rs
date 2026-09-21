//! Long-cylinder generalized plane strain: r=r(R), z=lambda_z Z.
//! Compressible neo-Hookean energy per dry-reference volume is J_nat W(F F_nat^-1).
//! Two-point annular quadrature; consistent tangent; tridiagonal/axial Schur solve.
use super::{invalid, Diagnostic, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MechanicsConfig {
    pub enabled: bool,
    pub shear_modulus_pa: f64,
    pub poisson_ratio: f64,
    pub axial_boundary: AxialBoundary,
    /// Spring stiffness in N/m; only used for the compliant axial boundary.
    pub axial_stiffness_n_m: f64,
    /// Anchor separation/reference length; linear motion over the whole schedule.
    pub final_anchor_stretch: f64,
    pub thermal_expansion_per_k: f64,
    /// Hypothetical transverse isotropy: ln(a_z/a_r) = anisotropy * char share.
    pub axial_anisotropy: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AxialBoundary {
    Free,
    Prescribed,
    Compliant,
}
impl Default for MechanicsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            shear_modulus_pa: 1e8,
            poisson_ratio: 0.3,
            axial_boundary: AxialBoundary::Free,
            axial_stiffness_n_m: 10.0,
            final_anchor_stretch: 1.0,
            thermal_expansion_per_k: 0.0,
            axial_anisotropy: 0.0,
        }
    }
}
impl MechanicsConfig {
    pub fn validate(&self) -> Result<()> {
        for (name, x, lo, hi) in [
            ("shear modulus (Pa)", self.shear_modulus_pa, 1.0, 1e12),
            ("Poisson ratio", self.poisson_ratio, 0.0, 0.45),
            (
                "axial spring stiffness (N/m)",
                self.axial_stiffness_n_m,
                0.0,
                1e6,
            ),
            ("final anchor stretch", self.final_anchor_stretch, 0.2, 2.0),
            (
                "thermal expansion (1/K)",
                self.thermal_expansion_per_k,
                0.0,
                5e-4,
            ),
            ("axial anisotropy", self.axial_anisotropy, -1.0, 1.0),
        ] {
            if !x.is_finite() || !(lo..=hi).contains(&x) {
                return Err(invalid(&format!("{name} must be in [{lo}, {hi}]")));
            }
        }
        Ok(())
    }
    pub fn lame_ratio(&self) -> f64 {
        2.0 * self.poisson_ratio / (1.0 - 2.0 * self.poisson_ratio)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Deformation {
    /// Current radial face positions divided by the original outer radius.
    pub radial_faces: Vec<f64>,
    pub axial_stretch: f64,
}
impl Deformation {
    pub fn identity(n: usize) -> Self {
        Self {
            radial_faces: (0..=n).map(|i| i as f64 / n as f64).collect(),
            axial_stretch: 1.0,
        }
    }
    pub fn stretches(&self, i: usize, t: f64) -> [f64; 3] {
        let n = (self.radial_faces.len() - 1) as f64;
        let [a, b] = [self.radial_faces[i], self.radial_faces[i + 1]];
        [
            (b - a) * n,
            (a * (1.0 - t) + b * t) * n / (i as f64 + t),
            self.axial_stretch,
        ]
    }
    pub fn cell_jacobian(&self, i: usize) -> f64 {
        let n = (self.radial_faces.len() - 1) as f64;
        (self.radial_faces[i + 1].powi(2) - self.radial_faces[i].powi(2))
            * n
            * n
            * self.axial_stretch
            / (2 * i + 1) as f64
    }
    pub fn validate(&self, n: usize) -> Result<()> {
        if self.radial_faces.len() != n + 1
            || self.radial_faces[0] != 0.0
            || !self.axial_stretch.is_finite()
            || self.axial_stretch <= 0.0
            || self.radial_faces.iter().any(|r| !r.is_finite())
            || self.radial_faces.windows(2).any(|r| r[1] <= r[0])
            || (0..n).any(|i| self.cell_jacobian(i) < 1e-10)
        {
            return Err(failure("invalid or inverted mechanical geometry"));
        }
        Ok(())
    }
}
fn failure(message: &str) -> Diagnostic {
    let mut d = invalid(message);
    d.code = "mechanical-equilibrium-failure".into();
    d
}

/// Energy/mu, nominal stress/mu and consistent material tangent/mu.
/// Principal components in the coaxial cylindrical material frame.
pub fn response(s: [f64; 3], natural: [f64; 3], lame: f64) -> (f64, [f64; 3], [[f64; 3]; 3]) {
    let jn: f64 = natural.iter().product();
    let logj = (s.iter().product::<f64>() / jn).ln();
    let b = lame * logj - 1.0;
    let energy = jn
        * (0.5 * ((0..3).map(|i| (s[i] / natural[i]).powi(2)).sum::<f64>() - 3.0) - logj
            + 0.5 * lame * logj * logj);
    let mut p = [0.0; 3];
    let mut h = [[0.0; 3]; 3];
    for i in 0..3 {
        p[i] = jn * (s[i] / natural[i].powi(2) + b / s[i]);
        for j in 0..3 {
            h[i][j] = if i == j {
                jn * (1.0 / natural[i].powi(2) + (lame - b) / s[i].powi(2))
            } else {
                jn * lame / (s[i] * s[j])
            };
        }
    }
    (energy, p, h)
}

pub struct System {
    pub energy: f64,
    pub gradient: Vec<f64>,
    diagonal: Vec<f64>,
    off: Vec<f64>,
    coupling: Vec<f64>,
    axial: f64,
}
impl System {
    pub fn residual(&self, fixed: bool) -> f64 {
        self.gradient[..self.gradient.len() - usize::from(fixed)]
            .iter()
            .fold(0.0_f64, |a, b| a.max(b.abs()))
    }
}
/// Normalize energy by mu*pi*R0^2*L0 and coordinates by R0/L0.
/// spring = k L0 / (mu*pi*R0^2).
pub fn assemble(
    d: &Deformation,
    natural: &[[f64; 3]],
    lame: f64,
    spring: f64,
    anchor: f64,
) -> System {
    let n = natural.len();
    let nf = n as f64;
    let mut a = System {
        energy: 0.0,
        gradient: vec![0.0; n + 1],
        diagonal: vec![0.0; n],
        off: vec![0.0; n - 1],
        coupling: vec![0.0; n],
        axial: 0.0,
    };
    for (i, nat) in natural.iter().enumerate() {
        for t in [0.5 - 0.5 / 3.0_f64.sqrt(), 0.5 + 0.5 / 3.0_f64.sqrt()] {
            let r = (i as f64 + t) / nf;
            let weight = r / nf;
            let (energy, p, h) = response(d.stretches(i, t), *nat, lame);
            a.energy += weight * energy;
            let b = [[-nf, (1.0 - t) / r, 0.0], [nf, t / r, 0.0], [0.0, 0.0, 1.0]];
            let ids = [i.checked_sub(1), Some(i), Some(n)];
            for u in 0..3 {
                let Some(row) = ids[u] else { continue };
                a.gradient[row] += weight * (0..3).map(|k| b[u][k] * p[k]).sum::<f64>();
                for v in u..3 {
                    let Some(col) = ids[v] else { continue };
                    let mut value = 0.0;
                    for (k, hrow) in h.iter().enumerate() {
                        for (l, entry) in hrow.iter().enumerate() {
                            value += weight * b[u][k] * entry * b[v][l];
                        }
                    }
                    if row == n {
                        a.axial += value;
                    } else if col == n {
                        a.coupling[row] += value;
                    } else if row == col {
                        a.diagonal[row] += value;
                    } else {
                        a.off[row] += value;
                    }
                }
            }
        }
    }
    a.energy += 0.5 * spring * (d.axial_stretch - anchor).powi(2);
    a.gradient[n] += spring * (d.axial_stretch - anchor);
    a.axial += spring;
    a
}
fn tridiagonal(diag: &[f64], off: &[f64], rhs: &[f64]) -> Result<Vec<f64>> {
    let n = diag.len();
    let mut d = diag.to_vec();
    let mut x = rhs.to_vec();
    for i in 0..n {
        if i > 0 {
            let q = off[i - 1] / d[i - 1];
            d[i] -= q * off[i - 1];
            x[i] -= q * x[i - 1];
        }
        if !d[i].is_finite() || d[i] <= 0.0 {
            return Err(failure("nonpositive mechanical tangent"));
        }
    }
    for i in (0..n).rev() {
        x[i] = (x[i] - if i + 1 < n { off[i] * x[i + 1] } else { 0.0 }) / d[i];
    }
    Ok(x)
}
pub fn solve(
    old: &Deformation,
    natural: &[[f64; 3]],
    config: &MechanicsConfig,
    spring: f64,
    anchor: f64,
) -> Result<Deformation> {
    let n = natural.len();
    let fixed = config.axial_boundary == AxialBoundary::Prescribed;
    let mut d = old.clone();
    if fixed {
        d.axial_stretch = anchor;
    }
    let lame = config.lame_ratio();
    for _ in 0..50 {
        d.validate(n)?;
        let a = assemble(&d, natural, lame, spring, anchor);
        if a.residual(fixed) < 1e-9 {
            return Ok(d);
        }
        let rhs: Vec<f64> = a.gradient[..n].iter().map(|v| -v).collect();
        let y = tridiagonal(&a.diagonal, &a.off, &rhs)?;
        let z = tridiagonal(&a.diagonal, &a.off, &a.coupling)?;
        let schur = a.axial - a.coupling.iter().zip(&z).map(|(x, y)| x * y).sum::<f64>();
        if !fixed && (!schur.is_finite() || schur <= 0.0) {
            return Err(failure("nonpositive axial tangent"));
        }
        let dz = if fixed {
            0.0
        } else {
            (-a.gradient[n] - a.coupling.iter().zip(&y).map(|(x, y)| x * y).sum::<f64>()) / schur
        };
        let step: Vec<f64> = y
            .iter()
            .zip(&z)
            .map(|(y, z)| y - z * dz)
            .chain(std::iter::once(dz))
            .collect();
        let slope = a
            .gradient
            .iter()
            .zip(&step)
            .map(|(x, y)| x * y)
            .sum::<f64>();
        let mut alpha = 1.0;
        let mut next = None;
        for _ in 0..24 {
            let mut candidate = d.clone();
            for (r, delta) in candidate.radial_faces[1..].iter_mut().zip(&step) {
                *r += alpha * delta;
            }
            candidate.axial_stretch += alpha * dz;
            if candidate.validate(n).is_ok() {
                let b = assemble(&candidate, natural, lame, spring, anchor);
                // Residual reduction also permits the final step near energy roundoff.
                if b.energy.is_finite()
                    && (b.energy <= a.energy + 1e-4 * alpha * slope
                        || b.residual(fixed) < a.residual(fixed) * 0.5)
                {
                    next = Some(candidate);
                    break;
                }
            }
            alpha *= 0.5;
        }
        d = next.ok_or_else(|| failure("mechanical line search did not converge"))?;
    }
    Err(failure(
        "mechanical Newton iteration limit; last accepted state retained",
    ))
}
