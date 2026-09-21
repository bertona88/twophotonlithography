//! SI-unit, fixed-reference radial transformation benchmark. No mechanics,
//! pressure, elemental composition, or volatile-to-solid feedback is solved.
pub mod material;
pub mod schedule;
pub mod specimen;
mod transport;

use std::f64::consts::PI;

use serde::{Deserialize, Serialize};

use material::{arrhenius, Material};
use schedule::TemperaturePoint;

pub const MODEL_VERSION: &str = "radial-reference-v1";
pub const FIELD_COUNT: usize = 9;
pub const FIELD_ORDER: &str = "radius_m,precursor_fraction,char_fraction,mobile_fraction,network_order,micro_porosity,free_density_kg_m3,natural_jacobian,natural_isotropic_stretch";
pub type Result<T> = std::result::Result<T, Diagnostic>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    pub quantity: String,
    pub value: f64,
    pub bound: f64,
    pub cell: Option<usize>,
    pub trial_time_s: f64,
}

impl std::fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

pub fn invalid(message: &str) -> Diagnostic {
    Diagnostic {
        code: "invalid-configuration".into(),
        message: message.into(),
        quantity: String::new(),
        value: 0.0,
        bound: 0.0,
        cell: None,
        trial_time_s: 0.0,
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RadialConfig {
    pub model_version: String,
    pub radial_cells: usize,
    pub radius_m: f64,
    pub length_m: f64,
    pub schedule: Vec<TemperaturePoint>,
    pub material: Material,
    pub max_step_s: f64,
    pub min_step_s: f64,
    pub relative_tolerance: f64,
    pub absolute_tolerance: f64,
    pub memory_budget_bytes: usize,
}

impl Default for RadialConfig {
    fn default() -> Self {
        Self {
            model_version: MODEL_VERSION.into(),
            radial_cells: 64,
            radius_m: 1e-6,
            length_m: 20e-6,
            schedule: vec![
                TemperaturePoint {
                    time_s: 0.0,
                    temperature_k: 298.15,
                },
                TemperaturePoint {
                    time_s: 3_600.0,
                    temperature_k: 1_173.15,
                },
                TemperaturePoint {
                    time_s: 5_400.0,
                    temperature_k: 1_173.15,
                },
                TemperaturePoint {
                    time_s: 7_200.0,
                    temperature_k: 298.15,
                },
            ],
            material: Material::default(),
            max_step_s: 10.0,
            min_step_s: 1e-5,
            relative_tolerance: 1e-3,
            absolute_tolerance: 1e-7,
            memory_budget_bytes: 8 * 1024 * 1024,
        }
    }
}

impl RadialConfig {
    pub fn validate(&self) -> Result<()> {
        if self.model_version != MODEL_VERSION || !(4..=256).contains(&self.radial_cells) {
            return Err(invalid("unsupported model or radial cell count (4–256)"));
        }
        for (name, value, lo, hi) in [
            ("radius (m)", self.radius_m, 1e-8, 1e-3),
            ("length (m)", self.length_m, 1e-8, 1.0),
            ("maximum step (s)", self.max_step_s, 1e-6, 600.0),
            ("minimum step (s)", self.min_step_s, 1e-9, 1.0),
            ("relative tolerance", self.relative_tolerance, 1e-8, 0.1),
            ("absolute tolerance", self.absolute_tolerance, 1e-12, 1e-3),
        ] {
            if !value.is_finite() || !(lo..=hi).contains(&value) {
                return Err(invalid(&format!("{name} must be in [{lo}, {hi}]")));
            }
        }
        if self.min_step_s > self.max_step_s {
            return Err(invalid("minimum step exceeds maximum step"));
        }
        if self.memory_budget_bytes < self.estimated_peak_bytes() {
            return Err(invalid("radial solver peak-memory budget exceeded"));
        }
        schedule::validate(&self.schedule)?;
        self.material.validate()
    }

    pub fn estimated_peak_bytes(&self) -> usize {
        // Current/full/fine/trial states, finite-volume workspace, snapshots,
        // serialization and copied transfer/checkpoint buffers, plus overhead.
        65_536 + self.radial_cells.saturating_mul(1_024)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cell {
    pub precursor: f64,
    pub char: f64,
    pub mobile: f64,
    pub order: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub time_s: f64,
    pub cells: Vec<Cell>,
    pub escaped_kg: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Checkpoint {
    pub schema_version: u32,
    pub config: RadialConfig,
    pub state: State,
    pub next_step_s: f64,
    pub accepted_steps: u32,
    pub rejected_steps: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub model_version: &'static str,
    pub calibration: &'static str,
    pub geometry: &'static str,
    pub temperature_convention: &'static str,
    pub volatile_feedback: &'static str,
    pub atmosphere: &'static str,
    pub schema_version: u32,
    pub field_order: &'static str,
    pub radial_cells: usize,
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
    pub accepted_steps: u32,
    pub rejected_steps: u32,
    pub next_step_s: f64,
    pub estimated_peak_bytes: usize,
    pub complete: bool,
    pub checksum: String,
    pub failure: Option<Diagnostic>,
}

pub struct PyrolysisCore {
    config: RadialConfig,
    state: State,
    next_step_s: f64,
    accepted_steps: u32,
    rejected_steps: u32,
    failure: Option<Diagnostic>,
    snapshot: Vec<f64>,
}

impl PyrolysisCore {
    pub fn new(config: RadialConfig) -> Result<Self> {
        config.validate()?;
        let cells = vec![
            Cell {
                precursor: 1.0,
                char: 0.0,
                mobile: 0.0,
                order: 0.0
            };
            config.radial_cells
        ];
        Ok(Self {
            next_step_s: config.max_step_s,
            config,
            state: State {
                time_s: 0.0,
                cells,
                escaped_kg: 0.0,
            },
            accepted_steps: 0,
            rejected_steps: 0,
            failure: None,
            snapshot: Vec::new(),
        })
    }

    pub fn from_checkpoint(checkpoint: Checkpoint) -> Result<Self> {
        if checkpoint.schema_version != 1 {
            return Err(invalid("unsupported checkpoint schema"));
        }
        let mut core = Self::new(checkpoint.config)?;
        if !checkpoint.state.time_s.is_finite()
            || checkpoint.state.time_s < 0.0
            || checkpoint.state.time_s > core.duration()
            || checkpoint.state.cells.len() != core.config.radial_cells
            || !checkpoint.next_step_s.is_finite()
            || checkpoint.next_step_s < core.config.min_step_s
            || checkpoint.next_step_s > core.config.max_step_s
        {
            return Err(invalid("invalid checkpoint dimensions, time or timestep"));
        }
        core.validate_state(&checkpoint.state)?;
        core.state = checkpoint.state;
        core.next_step_s = checkpoint.next_step_s;
        core.accepted_steps = checkpoint.accepted_steps;
        core.rejected_steps = checkpoint.rejected_steps;
        Ok(core)
    }

    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            schema_version: 1,
            config: self.config.clone(),
            state: self.state.clone(),
            next_step_s: self.next_step_s,
            accepted_steps: self.accepted_steps,
            rejected_steps: self.rejected_steps,
        }
    }

    pub fn duration(&self) -> f64 {
        self.config
            .schedule
            .last()
            .expect("validated schedule")
            .time_s
    }
    pub fn complete(&self) -> bool {
        self.state.time_s >= self.duration()
    }

    /// One accepted increment, at most 42 bounded trial solves. Render cadence
    /// cannot change dt selection. On failure only diagnostics change.
    pub fn advance(&mut self) -> bool {
        if self.complete() || self.failure.is_some() {
            return false;
        }
        let remaining =
            schedule::next_knot(&self.config.schedule, self.state.time_s) - self.state.time_s;
        let mut dt = self.next_step_s.min(remaining);
        let mut last_error = invalid("timestep tolerance could not be satisfied");
        last_error.code = "step-size-underflow".into();
        for _ in 0..42 {
            let trial = self.trial(&self.state, dt).and_then(|full| {
                let half = self.trial(&self.state, 0.5 * dt)?;
                let mut fine = self.trial(&half, 0.5 * dt)?;
                // Identical physical endpoint, independent of half-step rounding.
                fine.time_s = self.state.time_s + dt;
                let error = self.error_norm(&full, &fine);
                if error > 1.0 {
                    let mut diagnostic = invalid("step-doubling error exceeds tolerance");
                    diagnostic.code = "timestep-error".into();
                    diagnostic.value = error;
                    diagnostic.bound = 1.0;
                    diagnostic.trial_time_s = fine.time_s;
                    Err(diagnostic)
                } else {
                    Ok((fine, error))
                }
            });
            match trial {
                Ok((state, error)) => {
                    self.state = state;
                    self.accepted_steps = self.accepted_steps.saturating_add(1);
                    let factor = if error < 0.01 {
                        2.0
                    } else {
                        (0.9 / error.sqrt()).clamp(0.5, 2.0)
                    };
                    self.next_step_s =
                        (dt * factor).clamp(self.config.min_step_s, self.config.max_step_s);
                    return true;
                }
                Err(error) => {
                    last_error = error;
                    self.rejected_steps = self.rejected_steps.saturating_add(1);
                    if dt <= self.config.min_step_s {
                        break;
                    }
                    dt = (0.5 * dt).max(self.config.min_step_s).min(remaining);
                }
            }
        }
        self.failure = Some(last_error);
        false
    }

    fn trial(&self, old: &State, dt: f64) -> Result<State> {
        let mut state = old.clone();
        let material = &self.config.material;
        let temperature = schedule::temperature(&self.config.schedule, old.time_s + dt * 0.5);
        let k = arrhenius(
            material.reaction_a_per_s,
            material.reaction_e_j_mol,
            temperature,
        );
        let kn = arrhenius(
            material.network_a_per_s,
            material.network_e_j_mol,
            temperature,
        );
        for cell in &mut state.cells {
            let loss = cell.precursor * -(-k * dt).exp_m1();
            cell.precursor *= (-k * dt).exp();
            cell.char += material.char_yield * loss;
            cell.mobile += (1.0 - material.char_yield) * loss;
            // Midpoint approximation of char share, controlled by step doubling.
            let middle_char = cell.char - 0.5 * material.char_yield * loss;
            let middle_solid = cell.precursor + 0.5 * loss + middle_char;
            cell.order += (1.0 - cell.order) * -(-kn * dt * middle_char / middle_solid).exp_m1();
        }
        state.time_s = old.time_s + dt;
        // Check constitutive domain BEFORE transport; never repair mass/density.
        for (index, cell) in state.cells.iter().enumerate() {
            material.properties(cell.precursor, cell.char, cell.order, index, state.time_s)?;
        }
        let mut mobile: Vec<f64> = state.cells.iter().map(|cell| cell.mobile).collect();
        let diffusivity: Vec<f64> = state
            .cells
            .iter()
            .map(|cell| {
                material.diffusivity_m2_s * (1.0 + material.network_diffusivity_gain * cell.order)
            })
            .collect();
        state.escaped_kg += material.initial_density()
            * transport::diffuse(
                &mut mobile,
                &diffusivity,
                self.config.radius_m,
                self.config.length_m,
                material.surface_transfer_m_s,
                dt,
            );
        for (cell, value) in state.cells.iter_mut().zip(mobile) {
            cell.mobile = value;
        }
        self.validate_state(&state)?;
        Ok(state)
    }

    fn initial_cell_mass(&self, index: usize) -> f64 {
        let dr = self.config.radius_m / self.config.radial_cells as f64;
        PI * dr
            * dr
            * (2 * index + 1) as f64
            * self.config.length_m
            * self.config.material.initial_density()
    }

    fn initial_mass(&self) -> f64 {
        PI * self.config.radius_m.powi(2)
            * self.config.length_m
            * self.config.material.initial_density()
    }

    fn validate_state(&self, state: &State) -> Result<()> {
        let mut total = state.escaped_kg;
        if !total.is_finite() || total < 0.0 {
            return Err(invalid("invalid escaped mass"));
        }
        for (index, cell) in state.cells.iter().enumerate() {
            if [cell.precursor, cell.char, cell.mobile, cell.order]
                .iter()
                .any(|v| !v.is_finite() || *v < 0.0)
                || cell.order > 1.0
            {
                return Err(invalid("nonfinite, negative or unbounded material state"));
            }
            self.config.material.properties(
                cell.precursor,
                cell.char,
                cell.order,
                index,
                state.time_s,
            )?;
            total += self.initial_cell_mass(index) * (cell.precursor + cell.char + cell.mobile);
        }
        let mass_error = (total / self.initial_mass() - 1.0).abs();
        if !mass_error.is_finite() || mass_error > 1e-9 {
            return Err(Diagnostic {
                code: "mass-balance-error".into(),
                message: "mass ledger does not close; last accepted state retained".into(),
                quantity: "relative-mass-error".into(),
                value: mass_error,
                bound: 1e-9,
                cell: None,
                trial_time_s: state.time_s,
            });
        }
        Ok(())
    }

    fn error_norm(&self, a: &State, b: &State) -> f64 {
        let scaled = |x: f64, y: f64| {
            (x - y).abs()
                / (self.config.absolute_tolerance
                    + self.config.relative_tolerance * x.abs().max(y.abs()))
        };
        let mut error = scaled(
            a.escaped_kg / self.initial_mass(),
            b.escaped_kg / self.initial_mass(),
        );
        for (left, right) in a.cells.iter().zip(&b.cells) {
            for (x, y) in [
                (left.precursor, right.precursor),
                (left.char, right.char),
                (left.mobile, right.mobile),
                (left.order, right.order),
            ] {
                error = error.max(scaled(x, y));
            }
        }
        error
    }

    pub fn snapshot(&mut self) -> &[f64] {
        self.snapshot.clear();
        for (index, cell) in self.state.cells.iter().enumerate() {
            let [phi, rho, j] = self
                .config
                .material
                .properties(
                    cell.precursor,
                    cell.char,
                    cell.order,
                    index,
                    self.state.time_s,
                )
                .expect("accepted state");
            self.snapshot.extend_from_slice(&[
                (index as f64 + 0.5) * self.config.radius_m / self.config.radial_cells as f64,
                cell.precursor,
                cell.char,
                cell.mobile,
                cell.order,
                phi,
                rho,
                j,
                j.cbrt(),
            ]);
        }
        &self.snapshot
    }

    pub fn snapshot_len(&self) -> usize {
        self.config.radial_cells * FIELD_COUNT
    }

    pub fn diagnostics(&self) -> Diagnostics {
        let (mut precursor, mut char, mut mobile, mut network, mut min_j) =
            (0.0, 0.0, 0.0, 0.0, f64::INFINITY);
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        let mut hash_value = |value: f64| {
            for byte in value.to_bits().to_le_bytes() {
                hash = (hash ^ byte as u64).wrapping_mul(0x100_0000_01b3);
            }
        };
        hash_value(self.state.time_s);
        hash_value(self.state.escaped_kg);
        for (index, cell) in self.state.cells.iter().enumerate() {
            let mass = self.initial_cell_mass(index);
            precursor += mass * cell.precursor;
            char += mass * cell.char;
            mobile += mass * cell.mobile;
            network += mass * cell.order;
            min_j = min_j.min(
                self.config
                    .material
                    .properties(
                        cell.precursor,
                        cell.char,
                        cell.order,
                        index,
                        self.state.time_s,
                    )
                    .expect("accepted state")[2],
            );
            for value in [mass, cell.precursor, cell.char, cell.mobile, cell.order] {
                hash_value(value);
            }
        }
        Diagnostics {
            model_version: MODEL_VERSION,
            calibration: "hypothetical; not fitted to a named resin",
            geometry: "fixed reference cylinder; sealed ends; no solved mechanics",
            temperature_convention: "prescribed uniform specimen temperature",
            volatile_feedback: "none (one-way chemistry to mobile products)",
            atmosphere: "inert; zero ambient mobile-product concentration; no pressure model",
            schema_version: 1,
            field_order: FIELD_ORDER,
            radial_cells: self.config.radial_cells,
            time_s: self.state.time_s,
            duration_s: self.duration(),
            specimen_temperature_k: schedule::temperature(&self.config.schedule, self.state.time_s),
            initial_mass_kg: self.initial_mass(),
            precursor_mass_kg: precursor,
            char_mass_kg: char,
            mobile_mass_kg: mobile,
            escaped_mass_kg: self.state.escaped_kg,
            relative_mass_error: (precursor + char + mobile + self.state.escaped_kg)
                / self.initial_mass()
                - 1.0,
            mean_network_order: network / self.initial_mass(),
            min_natural_jacobian: min_j,
            accepted_steps: self.accepted_steps,
            rejected_steps: self.rejected_steps,
            next_step_s: self.next_step_s,
            estimated_peak_bytes: self.config.estimated_peak_bytes(),
            complete: self.complete(),
            checksum: format!("{hash:016x}"),
            failure: self.failure.clone(),
        }
    }
}

#[cfg(test)]
mod tests;
