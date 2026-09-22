use std::f64::consts::PI;

/// Backward Euler cylindrical finite volumes, concentrations normalized by the
/// uniform initial bulk density. A single shared face flux conserves mass.
/// Axis and ends are sealed; the exterior has a Robin sink with zero ambient V.
#[cfg(test)]
pub fn diffuse(
    mobile: &mut [f64],
    diffusivity: &[f64],
    radius: f64,
    length: f64,
    h: f64,
    dt: f64,
) -> f64 {
    let n = mobile.len();
    let dr = radius / n as f64;
    let volumes: Vec<f64> = (0..n)
        .map(|i| PI * dr * dr * (2 * i + 1) as f64 * length)
        .collect();
    let mut conductance = vec![0.0; n + 1];
    for i in 1..n {
        let (left, right) = (diffusivity[i - 1], diffusivity[i]);
        if left > 0.0 && right > 0.0 {
            conductance[i] =
                2.0 * PI * i as f64 * dr * length / (0.5 * dr / left + 0.5 * dr / right);
        }
    }
    if h > 0.0 && diffusivity[n - 1] > 0.0 {
        conductance[n] = 2.0 * PI * radius * length / (0.5 * dr / diffusivity[n - 1] + 1.0 / h);
    }
    let mut diagonal = vec![0.0; n];
    let mut rhs = vec![0.0; n];
    for i in 0..n {
        diagonal[i] = volumes[i] + dt * (conductance[i] + conductance[i + 1]);
        rhs[i] = volumes[i] * mobile[i];
        if i > 0 {
            let factor = -dt * conductance[i] / diagonal[i - 1];
            diagonal[i] -= factor * (-dt * conductance[i]);
            rhs[i] -= factor * rhs[i - 1];
        }
    }
    for i in (0..n).rev() {
        mobile[i] = (rhs[i]
            + if i + 1 < n {
                dt * conductance[i + 1] * mobile[i + 1]
            } else {
                0.0
            })
            / diagonal[i];
    }
    dt * conductance[n] * mobile[n - 1]
}

/// Lagrangian moving annuli. Unknown is current concentration / rho_initial;
/// inventories remain normalized by reference volumes. Shared current-geometry
/// fluxes conserve inventory exactly, including concentration during contraction.
pub fn diffuse_deformed(
    mobile: &mut [f64],
    diffusivity: &[f64],
    radius: f64,
    length: f64,
    deformation: &super::mechanics::Deformation,
    h: f64,
    dt: f64,
) -> f64 {
    let n = mobile.len();
    let dr = radius / n as f64;
    let reference: Vec<f64> = (0..n)
        .map(|i| PI * dr * dr * (2 * i + 1) as f64 * length)
        .collect();
    let faces: Vec<f64> = deformation
        .radial_faces
        .iter()
        .map(|r| r * radius)
        .collect();
    let current_length = length * deformation.axial_stretch;
    let volume: Vec<f64> = (0..n)
        .map(|i| PI * (faces[i + 1].powi(2) - faces[i].powi(2)) * current_length)
        .collect();
    let mut g = vec![0.0; n + 1];
    for i in 1..n {
        if diffusivity[i - 1] > 0.0 && diffusivity[i] > 0.0 {
            g[i] = 2.0 * PI * faces[i] * current_length
                / (0.5 * (faces[i] - faces[i - 1]) / diffusivity[i - 1]
                    + 0.5 * (faces[i + 1] - faces[i]) / diffusivity[i]);
        }
    }
    if h > 0.0 && diffusivity[n - 1] > 0.0 {
        g[n] = 2.0 * PI * faces[n] * current_length
            / (0.5 * (faces[n] - faces[n - 1]) / diffusivity[n - 1] + 1.0 / h);
    }
    let mut diagonal = vec![0.0; n];
    let mut rhs = vec![0.0; n];
    for i in 0..n {
        diagonal[i] = volume[i] + dt * (g[i] + g[i + 1]);
        rhs[i] = reference[i] * mobile[i];
        if i > 0 {
            let factor = -dt * g[i] / diagonal[i - 1];
            diagonal[i] -= factor * (-dt * g[i]);
            rhs[i] -= factor * rhs[i - 1];
        }
    }
    let mut concentration = vec![0.0; n];
    for i in (0..n).rev() {
        concentration[i] = (rhs[i]
            + if i + 1 < n {
                dt * g[i + 1] * concentration[i + 1]
            } else {
                0.0
            })
            / diagonal[i];
        mobile[i] = concentration[i] * volume[i] / reference[i];
    }
    dt * g[n] * concentration[n - 1]
}
