use std::f64::consts::PI;

/// Backward Euler cylindrical finite volumes, concentrations normalized by the
/// uniform initial bulk density. A single shared face flux conserves mass.
/// Axis and ends are sealed; the exterior has a Robin sink with zero ambient V.
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
