//! Browser-sized, connected BCC continuum benchmark. All dimensions are SI in
//! configuration; the FE mesh uses pitch-normalized coordinates internally.
mod math;
mod mechanics;
mod mesh;
#[cfg(test)]
mod tests;
mod transport;
#[cfg(test)]
mod verification;
use crate::pyrolysis::{
    invalid,
    material::{arrhenius, Material},
    schedule::{self, TemperaturePoint},
    Diagnostic, Result,
};
use math::*;
use mesh::Mesh;
use serde::{Deserialize, Serialize};
pub const MODEL_VERSION: &str = "bcc-tet-v1";
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Support {
    Bonded,
    Free,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BccConfig {
    pub model_version: String,
    pub cells_per_axis: usize,
    pub voxels_per_cell: usize,
    pub pitch_m: f64,
    pub strut_radius_ratio: f64,
    pub support: Support,
    pub max_step_s: f64,
    pub relative_tolerance: f64,
    pub schedule: Vec<TemperaturePoint>,
    pub material: Material,
    pub shear_modulus_pa: f64,
    pub poisson_ratio: f64,
    pub equilibrium_fraction: f64,
    pub relaxation_time_s: f64,
}
impl Default for BccConfig {
    fn default() -> Self {
        Self {
            model_version: MODEL_VERSION.into(),
            cells_per_axis: 2,
            voxels_per_cell: 10,
            pitch_m: 40e-6,
            strut_radius_ratio: 0.15,
            support: Support::Bonded,
            max_step_s: 30.,
            relative_tolerance: 1e-3,
            schedule: crate::pyrolysis::RadialConfig::default().schedule,
            material: Material::default(),
            shear_modulus_pa: 1e8,
            poisson_ratio: 0.3,
            equilibrium_fraction: 0.25,
            relaxation_time_s: 300.,
        }
    }
}
impl BccConfig {
    pub fn validate(&self) -> Result<()> {
        if self.model_version != MODEL_VERSION
            || !(1..=2).contains(&self.cells_per_axis)
            || !(6..=12).contains(&self.voxels_per_cell)
        {
            return Err(invalid(
                "BCC supports 1–2 unit cells per axis and 6–12 voxels per cell",
            ));
        }
        for (name, v, lo, hi) in [
            ("pitch m", self.pitch_m, 1e-6, 1e-3),
            ("strut radius / pitch", self.strut_radius_ratio, 0.15, 0.30),
            ("maximum step s", self.max_step_s, 0.05, 60.),
            ("relative tolerance", self.relative_tolerance, 1e-6, 0.01),
            ("shear modulus Pa", self.shear_modulus_pa, 1., 1e12),
            ("Poisson ratio", self.poisson_ratio, 0., 0.4),
            ("equilibrium fraction", self.equilibrium_fraction, 0.05, 1.),
            ("relaxation time s", self.relaxation_time_s, 0., 1e8),
        ] {
            if !v.is_finite() || v < lo || v > hi {
                return Err(invalid(&format!("{name} must lie in [{lo}, {hi}]")));
            }
        }
        if 2. * self.strut_radius_ratio * (self.voxels_per_cell as f64) < 3. {
            return Err(invalid("resolve the strut diameter with at least three voxels; increase resolution or radius"));
        }
        schedule::validate(&self.schedule)?;
        self.material.validate()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub time_s: f64,
    pub precursor: f64,
    pub char: f64,
    pub order: f64,
    pub positions: Vec<V>,
    pub mobile_mass: Vec<f64>,
    pub viscous_metrics: Vec<M>,
    pub escaped: f64,
    pub relaxation_dissipation_j: f64,
    pub mechanical_residual: f64,
    pub mechanical_iterations: usize,
    pub transport_limiter_min_alpha: f64,
    pub transport_limited_steps: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub schema_version: u32,
    pub config: BccConfig,
    pub state: State,
    pub accepted_steps: u32,
    pub rejected_steps: u32,
    pub next_step_s: f64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub model_version: &'static str,
    pub calibration: &'static str,
    pub geometry: &'static str,
    pub support: Support,
    pub time_s: f64,
    pub duration_s: f64,
    pub specimen_temperature_k: f64,
    pub initial_mass_kg: f64,
    pub precursor_mass_kg: f64,
    pub char_mass_kg: f64,
    pub mobile_mass_kg: f64,
    pub escaped_mass_kg: f64,
    pub relative_mass_error: f64,
    pub mean_network_order: f64,
    pub min_natural_jacobian: f64,
    pub min_jacobian: f64,
    pub volume_ratio: f64,
    pub dimensions_um: V,
    pub reference_dimensions_um: V,
    pub max_stress_m_pa: f64,
    pub mechanical_residual: f64,
    pub mechanical_iterations: usize,
    pub relaxation_dissipation_j: f64,
    pub transport_limiter_min_alpha: f64,
    pub transport_limited_steps: u32,
    pub accepted_steps: u32,
    pub rejected_steps: u32,
    pub next_step_s: f64,
    pub nodes: usize,
    pub elements: usize,
    pub surface_triangles: usize,
    pub voxel_size_um: f64,
    pub strut_diameter_voxels: f64,
    pub estimated_peak_bytes: usize,
    pub complete: bool,
    pub checksum: String,
    pub failure: Option<Diagnostic>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellFields {
    pub precursor: Vec<f64>,
    pub char: Vec<f64>,
    pub mobile: Vec<f64>,
    pub order: Vec<f64>,
    pub porosity: Vec<f64>,
    pub density: Vec<f64>,
    #[serde(rename = "stressMPa")]
    pub stress_m_pa: Vec<f64>,
    pub natural_jacobian: Vec<f64>,
    pub jacobian: Vec<f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub positions_um: Vec<f64>,
    pub reference_positions_um: Vec<f64>,
    pub tetrahedra: Vec<usize>,
    pub triangles: Vec<usize>,
    pub triangle_cells: Vec<usize>,
    pub cell_centers_um: Vec<f64>,
    pub cell_fields: CellFields,
    pub diagnostics: Diagnostics,
}
struct PendingTrial {
    state: State,
    dt: f64,
    source: f64,
    natural: f64,
    optimizer: mechanics::Optimizer,
}
pub struct BccCore {
    config: BccConfig,
    mesh: Mesh,
    state: State,
    accepted_steps: u32,
    rejected_steps: u32,
    next_step_s: f64,
    failure: Option<Diagnostic>,
    pending: Option<PendingTrial>,
}
impl BccCore {
    pub fn new(config: BccConfig) -> Result<Self> {
        config.validate()?;
        let mesh = Mesh::new(&config)?;
        let state = State {
            time_s: 0.,
            precursor: 1.,
            char: 0.,
            order: 0.,
            positions: mesh.nodes.clone(),
            mobile_mass: vec![0.; mesh.nodes.len()],
            viscous_metrics: vec![ID; mesh.tets.len()],
            escaped: 0.,
            relaxation_dissipation_j: 0.,
            mechanical_residual: 0.,
            mechanical_iterations: 0,
            transport_limiter_min_alpha: 1.,
            transport_limited_steps: 0,
        };
        Ok(Self {
            next_step_s: config.max_step_s,
            config,
            mesh,
            state,
            accepted_steps: 0,
            rejected_steps: 0,
            failure: None,
            pending: None,
        })
    }
    fn duration(&self) -> f64 {
        self.config.schedule.last().unwrap().time_s
    }
    fn properties(&self, s: &State) -> Result<[f64; 3]> {
        self.config
            .material
            .properties(s.precursor, s.char, s.order, 0, s.time_s)
    }
    fn stiffness(&self, s: &State) -> f64 {
        let fraction = s.char / (s.precursor + s.char);
        self.config.shear_modulus_pa
            * (0.05 + 0.95 * (1. - fraction) + 4. * fraction * s.order * s.order)
    }
    fn relaxation_time(&self, t: f64, order: f64) -> f64 {
        if self.config.relaxation_time_s == 0. {
            return f64::INFINITY;
        }
        let k = schedule::temperature(&self.config.schedule, t);
        (self.config.relaxation_time_s
            * (50_000. / 8.314462618 * (1. / k - 1. / 900.)).exp()
            * (1. + 20. * order * order))
            .clamp(1., 1e12)
    }
    fn chemistry(&self, p: f64, o: f64, t: f64, dt: f64) -> (f64, f64) {
        let m = &self.config.material;
        let rate = |a, e, time| arrhenius(a, e, schedule::temperature(&self.config.schedule, time));
        let integrate =
            |a, e| dt * (rate(a, e, t) + 4. * rate(a, e, t + dt / 2.) + rate(a, e, t + dt)) / 6.;
        let pn = p * (-integrate(m.reaction_a_per_s, m.reaction_e_j_mol)).exp();
        let mid = (p + pn) / 2.;
        let share = m.char_yield * (1. - mid) / (mid + m.char_yield * (1. - mid));
        let on = 1. - (1. - o) * (-integrate(m.network_a_per_s, m.network_e_j_mol) * share).exp();
        (pn, on)
    }
    fn begin_trial(&self, dt: f64) -> Result<PendingTrial> {
        let mut s = self.state.clone();
        let (full_p, full_o) = self.chemistry(s.precursor, s.order, s.time_s, dt);
        let (half_p, half_o) = self.chemistry(s.precursor, s.order, s.time_s, dt / 2.);
        let (p, o) = self.chemistry(half_p, half_o, s.time_s + dt / 2., dt / 2.);
        let error = (p - full_p).abs().max((o - full_o).abs());
        if error > self.config.relative_tolerance * 0.1 {
            return Err(invalid("chemistry splitting tolerance exceeded"));
        }
        let source = (s.precursor - p) * (1. - self.config.material.char_yield);
        s.precursor = p;
        s.char = self.config.material.char_yield * (1. - p);
        s.order = o;
        s.time_s += dt;
        let natural = self.properties(&s)?[2].cbrt();
        let old_natural = self.properties(&self.state)?[2].cbrt();
        if (natural / old_natural - 1.).abs() > 0.025 {
            return Err(invalid(
                "natural deformation increment exceeds 2.5%; reduce step",
            ));
        }
        let tau = self.relaxation_time(self.state.time_s + dt / 2., s.order);
        for (e, t) in self.mesh.tets.iter().enumerate() {
            let f = self.mesh.deformation(t, &self.state.positions);
            let old = s.viscous_metrics[e];
            let new = mechanics::relaxed_metric(old, f, dt / tau);
            let released = mechanics::response(f, old, natural, &self.config).0
                - mechanics::response(f, new, natural, &self.config).0;
            if released < -1e-10 {
                return Err(invalid("viscous metric update violates dissipation"));
            }
            s.viscous_metrics[e] = new;
            s.relaxation_dissipation_j +=
                released.max(0.) * t.volume * self.config.pitch_m.powi(3) * self.stiffness(&s);
        }
        // Continue the last compatible displacement as a predictor only.
        // The following nonlinear FE solve still must meet its force tolerance.
        if self.config.support == Support::Bonded && old_natural < 0.9999 {
            let ratio = (1. - natural) / (1. - old_natural);
            let predicted: Vec<V> = self
                .mesh
                .nodes
                .iter()
                .zip(&s.positions)
                .map(|(&reference, &current)| add(reference, scale(sub(current, reference), ratio)))
                .collect();
            if self
                .mesh
                .tets
                .iter()
                .all(|t| det(self.mesh.deformation(t, &predicted)) > 1e-8)
            {
                s.positions = predicted;
            }
        }
        let optimizer = mechanics::Optimizer::new(
            &self.mesh,
            &mut s.positions,
            &s.viscous_metrics,
            natural,
            &self.config,
        );
        Ok(PendingTrial {
            state: s,
            dt,
            source,
            natural,
            optimizer,
        })
    }
    fn finish_trial(&self, pending: PendingTrial) -> Result<State> {
        let PendingTrial {
            mut state,
            dt,
            source,
            ..
        } = pending;
        let s = &mut state;
        let (mobile, escaped, alpha) = transport::diffuse_with_limiter(
            &self.mesh,
            &s.positions,
            &s.mobile_mass,
            source,
            dt,
            s.order,
            &self.config,
        )?;
        s.mobile_mass = mobile;
        s.escaped += escaped;
        s.transport_limiter_min_alpha = s.transport_limiter_min_alpha.min(alpha);
        if alpha < 1. {
            s.transport_limited_steps += 1;
        }
        self.validate_state(s, false)?;
        Ok(state)
    }
    pub fn accepted_steps(&self) -> u32 {
        self.accepted_steps
    }
    pub fn advance(&mut self) -> bool {
        if self.failure.is_some() || self.state.time_s >= self.duration() {
            return false;
        }
        if self.pending.is_none() {
            let remaining = (self.duration() - self.state.time_s).min(
                schedule::next_knot(&self.config.schedule, self.state.time_s) - self.state.time_s,
            );
            let tau = self.relaxation_time(self.state.time_s, self.state.order);
            let dt = self.next_step_s.min(remaining).min(tau / 4.);
            match self.begin_trial(dt) {
                Ok(pending) => {
                    self.pending = Some(pending);
                }
                Err(failure) => {
                    return self.reject_trial(dt, failure);
                }
            }
        }
        let mut pending = self
            .pending
            .take()
            .expect("pending trial initialized above");
        let dt = pending.dt;
        match pending.optimizer.advance(
            &self.mesh,
            &mut pending.state.positions,
            &pending.state.viscous_metrics,
            pending.natural,
            &self.config,
            8,
        ) {
            Ok(None) => {
                self.pending = Some(pending);
                true
            }
            Ok(Some((residual, iterations))) => {
                pending.state.mechanical_residual = residual;
                pending.state.mechanical_iterations = iterations;
                match self.finish_trial(pending) {
                    Ok(state) => {
                        self.state = state;
                        self.accepted_steps += 1;
                        self.next_step_s = (dt * 1.4).min(self.config.max_step_s);
                        true
                    }
                    Err(failure) => self.reject_trial(dt, failure),
                }
            }
            Err(failure) => self.reject_trial(dt, failure),
        }
    }
    fn reject_trial(&mut self, dt: f64, mut failure: Diagnostic) -> bool {
        self.rejected_steps += 1;
        failure.trial_time_s = self.state.time_s + dt;
        if dt < 1e-4 {
            failure.code = "bcc-step-rejected".into();
            self.failure = Some(failure);
            false
        } else {
            self.next_step_s = dt * 0.5;
            true
        }
    }
    fn validate_state(&self, s: &State, check_equilibrium: bool) -> Result<()> {
        if s.positions.len() != self.mesh.nodes.len()
            || s.mobile_mass.len() != self.mesh.nodes.len()
            || s.viscous_metrics.len() != self.mesh.tets.len()
            || !s.time_s.is_finite()
            || s.time_s < 0.
            || s.time_s > self.duration() + 1e-8
            || [
                s.precursor,
                s.char,
                s.order,
                s.escaped,
                s.relaxation_dissipation_j,
                s.mechanical_residual,
                s.transport_limiter_min_alpha,
            ]
            .iter()
            .any(|v| !v.is_finite() || *v < 0.)
            || s.precursor > 1.
            || s.char > 1.
            || s.order > 1.
            || s.transport_limiter_min_alpha > 1.
            || s.positions.iter().flatten().any(|v| !v.is_finite())
            || s.mobile_mass.iter().any(|v| !v.is_finite() || *v < 0.)
        {
            return Err(invalid("invalid BCC checkpoint state"));
        }
        if (s.char - self.config.material.char_yield * (1. - s.precursor)).abs() > 1e-10 {
            return Err(invalid("checkpoint chemistry is inconsistent"));
        }
        for (i, p) in s.positions.iter().enumerate() {
            if self.mesh.fixed[i] && norm(sub(*p, self.mesh.nodes[i])) > 1e-12 {
                return Err(invalid("bonded substrate node moved"));
            }
        }
        for (i, t) in self.mesh.tets.iter().enumerate() {
            if det(self.mesh.deformation(t, &s.positions)) <= 1e-8
                || !spd(s.viscous_metrics[i])
                || (det(s.viscous_metrics[i]) - 1.).abs() > 1e-7
            {
                return Err(invalid("invalid deformation or viscous SPD metric"));
            }
        }
        let ledger = s.precursor
            + s.char
            + (s.mobile_mass.iter().sum::<f64>() + s.escaped) / self.mesh.volume;
        if (ledger - 1.).abs() > 1e-8 {
            return Err(invalid("BCC mass ledger failed"));
        }
        let natural = self.properties(s)?[2].cbrt();
        if check_equilibrium {
            let actual_residual = mechanics::residual(
                &self.mesh,
                &s.positions,
                &s.viscous_metrics,
                natural,
                &self.config,
            );
            if actual_residual > 2.1e-6 || (s.mechanical_residual - actual_residual).abs() > 1e-10 {
                return Err(invalid(
                    "checkpoint geometry or stored mechanical residual is inconsistent",
                ));
            }
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            schema_version: 1,
            config: self.config.clone(),
            state: self.state.clone(),
            accepted_steps: self.accepted_steps,
            rejected_steps: self.rejected_steps,
            next_step_s: self.next_step_s,
        }
    }
    pub fn from_checkpoint(cp: Checkpoint) -> Result<Self> {
        if cp.schema_version != 1
            || !cp.next_step_s.is_finite()
            || cp.next_step_s <= 0.
            || cp.next_step_s > cp.config.max_step_s
        {
            return Err(invalid("invalid BCC checkpoint version or timestep"));
        }
        let mut core = Self::new(cp.config)?;
        core.validate_state(&cp.state, true)?;
        core.state = cp.state;
        core.accepted_steps = cp.accepted_steps;
        core.rejected_steps = cp.rejected_steps;
        core.next_step_s = cp.next_step_s;
        Ok(core)
    }
    fn checksum(&self) -> String {
        let mut hash = 14695981039346656037u64;
        let s = &self.state;
        for v in [
            s.time_s,
            s.precursor,
            s.char,
            s.order,
            s.escaped,
            s.relaxation_dissipation_j,
        ]
        .iter()
        .chain(s.positions.iter().flatten())
        .chain(s.mobile_mass.iter())
        .chain(s.viscous_metrics.iter().flatten().flatten())
        {
            for byte in v.to_bits().to_le_bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(1099511628211);
            }
        }
        format!("{hash:016x}")
    }
    pub fn diagnostics(&self) -> Diagnostics {
        let s = &self.state;
        let c = &self.config;
        let properties = self.properties(s).unwrap();
        let natural = properties[2].cbrt();
        let mut min_j = f64::INFINITY;
        let mut volume = 0.;
        let mut stress = 0f64;
        for (e, t) in self.mesh.tets.iter().enumerate() {
            let f = self.mesh.deformation(t, &s.positions);
            let j = det(f);
            min_j = min_j.min(j);
            volume += j * t.volume;
            stress = stress.max(
                mechanics::von_mises(
                    mechanics::response(f, s.viscous_metrics[e], natural, c).1,
                    f,
                ) * self.stiffness(s)
                    * 1e-6,
            );
        }
        let dimensions = std::array::from_fn(|k| {
            let lo = s
                .positions
                .iter()
                .map(|p| p[k])
                .fold(f64::INFINITY, f64::min);
            let hi = s
                .positions
                .iter()
                .map(|p| p[k])
                .fold(f64::NEG_INFINITY, f64::max);
            (hi - lo) * c.pitch_m * 1e6
        });
        let mass_scale = c.material.initial_density() * c.pitch_m.powi(3);
        let m0 = self.mesh.volume * mass_scale;
        let mobile = s.mobile_mass.iter().sum::<f64>() * mass_scale;
        let escaped = s.escaped * mass_scale;
        Diagnostics {
            model_version: MODEL_VERSION,
            calibration: "illustrative, uncalibrated constitutive parameters",
            geometry: "voxelized connected BCC strut union; conforming P1 tetrahedra",
            support: c.support,
            time_s: s.time_s,
            duration_s: self.duration(),
            specimen_temperature_k: schedule::temperature(&c.schedule, s.time_s),
            initial_mass_kg: m0,
            precursor_mass_kg: m0 * s.precursor,
            char_mass_kg: m0 * s.char,
            mobile_mass_kg: mobile,
            escaped_mass_kg: escaped,
            relative_mass_error: (m0 * (s.precursor + s.char) + mobile + escaped - m0) / m0,
            mean_network_order: s.order,
            min_natural_jacobian: properties[2],
            min_jacobian: min_j,
            volume_ratio: volume / self.mesh.volume,
            dimensions_um: dimensions,
            reference_dimensions_um: [c.pitch_m * c.cells_per_axis as f64 * 1e6; 3],
            max_stress_m_pa: stress,
            mechanical_residual: s.mechanical_residual,
            mechanical_iterations: s.mechanical_iterations,
            relaxation_dissipation_j: s.relaxation_dissipation_j,
            transport_limiter_min_alpha: s.transport_limiter_min_alpha,
            transport_limited_steps: s.transport_limited_steps,
            accepted_steps: self.accepted_steps,
            rejected_steps: self.rejected_steps,
            next_step_s: self.next_step_s,
            nodes: self.mesh.nodes.len(),
            elements: self.mesh.tets.len(),
            surface_triangles: self.mesh.faces.iter().filter(|f| f.right.is_none()).count(),
            voxel_size_um: self.mesh.h * c.pitch_m * 1e6,
            strut_diameter_voxels: 2. * c.strut_radius_ratio * c.voxels_per_cell as f64,
            estimated_peak_bytes: 2_000_000
                + self.mesh.nodes.len() * 1500
                + self.mesh.tets.len() * 1400,
            complete: s.time_s >= self.duration(),
            checksum: self.checksum(),
            failure: self.failure.clone(),
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        let s = &self.state;
        let c = &self.config;
        let props = self.properties(s).unwrap();
        let natural = props[2].cbrt();
        let volumes = transport::volumes(&self.mesh, &s.positions);
        let concentration: Vec<_> = s
            .mobile_mass
            .iter()
            .zip(volumes)
            .map(|(m, v)| m / v)
            .collect();
        let mut fields = CellFields {
            precursor: Vec::new(),
            char: Vec::new(),
            mobile: Vec::new(),
            order: Vec::new(),
            porosity: Vec::new(),
            density: Vec::new(),
            stress_m_pa: Vec::new(),
            natural_jacobian: Vec::new(),
            jacobian: Vec::new(),
        };
        let mut centers = Vec::new();
        for (e, t) in self.mesh.tets.iter().enumerate() {
            let f = self.mesh.deformation(t, &s.positions);
            let j = det(f);
            fields.precursor.push(s.precursor);
            fields.char.push(s.char);
            fields
                .mobile
                .push(j * t.nodes.iter().map(|&i| concentration[i]).sum::<f64>() / 4.);
            fields.order.push(s.order);
            fields.porosity.push(props[0]);
            fields
                .density
                .push(c.material.initial_density() * (s.precursor + s.char) / j);
            fields.stress_m_pa.push(
                mechanics::von_mises(
                    mechanics::response(f, s.viscous_metrics[e], natural, c).1,
                    f,
                ) * self.stiffness(s)
                    * 1e-6,
            );
            fields.natural_jacobian.push(props[2]);
            fields.jacobian.push(j);
            centers.extend(scale(self.mesh.center(t, &s.positions), c.pitch_m * 1e6));
        }
        let faces: Vec<_> = self
            .mesh
            .faces
            .iter()
            .filter(|f| f.right.is_none())
            .collect();
        Snapshot {
            positions_um: s
                .positions
                .iter()
                .flatten()
                .map(|v| v * c.pitch_m * 1e6)
                .collect(),
            reference_positions_um: self
                .mesh
                .nodes
                .iter()
                .flatten()
                .map(|v| v * c.pitch_m * 1e6)
                .collect(),
            tetrahedra: self.mesh.tets.iter().flat_map(|t| t.nodes).collect(),
            triangles: faces.iter().flat_map(|f| f.nodes).collect(),
            triangle_cells: faces.iter().map(|f| f.left).collect(),
            cell_centers_um: centers,
            cell_fields: fields,
            diagnostics: self.diagnostics(),
        }
    }
}
