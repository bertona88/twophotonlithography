use serde::Serialize;

use crate::parameters::{
    photoinitiator_absorption_factor, Parameters, SimulationConfig, ValidationError,
    MAX_EXPOSURE_STEPS_TOTAL,
};

pub const GRID_WIDTH: usize = 112;
pub const GRID_HEIGHT: usize = 68;
pub const GRID_LEN: usize = GRID_WIDTH * GRID_HEIGHT;
pub const LENS_WIDTH_UM: f64 = 15.0;
pub const LENS_HEIGHT_UM: f64 = 9.0;
/// Fixed step in the reduced model's nondimensional time coordinate T0.
///
/// It is not calibrated physical seconds.
pub const FIXED_TIMESTEP_MODEL_TIME: f64 = 0.016;
pub const DEVELOPMENT_STEPS_TOTAL: u32 = 210;
pub const SNAPSHOT_FIELD_COUNT: usize = 6;
pub const SNAPSHOT_FIELD_ORDER: [&str; SNAPSHOT_FIELD_COUNT] = [
    "photoinitiator",
    "oxygen",
    "radicalActivity",
    "conversion",
    "developer",
    "remainingMass",
];

const DX_UM: f64 = LENS_WIDTH_UM / (GRID_WIDTH as f64 - 1.0);
const DZ_UM: f64 = LENS_HEIGHT_UM / (GRID_HEIGHT as f64 - 1.0);
const INVERSE_CELL_SQUARE_SUM: f64 = 1.0 / (DX_UM * DX_UM) + 1.0 / (DZ_UM * DZ_UM);
const MAX_RADICAL_ACTIVITY: f64 = 8.0;
const MAX_DEVELOPER_DIFFUSIVITY: f64 = 0.114;
const DEVELOPER_STABILITY_SAFETY: f64 = 0.45;
const REACTION_STABILITY_SAFETY: f64 = 0.9;
pub(crate) const MAX_INTERNAL_SUBSTEPS_PER_UPDATE: usize = 1_024;

/// The explicit diffusion Courant number used for exposure-field validation.
pub(crate) fn exposure_diffusion_courant(diffusivity: f64) -> f64 {
    FIXED_TIMESTEP_MODEL_TIME * diffusivity * INVERSE_CELL_SQUARE_SUM
}

/// Deterministic internal substeps required for a positivity-preserving
/// exposure update at the worst state and optical source permitted by `parameters`.
///
/// Each coefficient is the fraction removable (or, for the radical source, the
/// fraction of the bounded field range addable) during one logical 0.016 T0
/// update. Diffusion contributes twice its Courant sum to the center-cell
/// removal coefficient. Dividing the full update keeps every explicit Euler
/// coefficient below 0.9, including reaction and diffusion acting together.
pub(crate) fn exposure_required_substeps(parameters: &Parameters, source_multiplier: f64) -> f64 {
    // State is rounded to f32 after every internal update. Use the exact stored
    // ceilings here so a value that rounds upward cannot evade the bound.
    let initiator_bound = (parameters.initiator as f32) as f64;
    let oxygen_bound = (parameters.oxygen as f32) as f64;
    let source_scale = 4.0
        * (parameters.power / 16.0).powi(2)
        * (80.0 / parameters.repetition_rate)
        * (100.0 / parameters.pulse_duration)
        * (45.0 / parameters.speed)
        * photoinitiator_absorption_factor(parameters.wavelength, parameters.pi_absorption_peak)
        * source_multiplier;

    let pi_removal = 2.0 * exposure_diffusion_courant(parameters.pi_diffusion)
        + FIXED_TIMESTEP_MODEL_TIME * parameters.pi_depletion * source_scale;
    let oxygen_removal = 2.0 * exposure_diffusion_courant(parameters.oxygen_diffusion)
        + FIXED_TIMESTEP_MODEL_TIME * 0.2 * parameters.oxygen_quench * MAX_RADICAL_ACTIVITY;
    let radical_removal = 2.0 * exposure_diffusion_courant(parameters.radical_diffusion)
        + FIXED_TIMESTEP_MODEL_TIME
            * (parameters.dark_loss
                + parameters.oxygen_quench * oxygen_bound
                + parameters.termination * MAX_RADICAL_ACTIVITY);
    let conversion_removal =
        FIXED_TIMESTEP_MODEL_TIME * parameters.propagation * MAX_RADICAL_ACTIVITY;
    let radical_source_fraction =
        FIXED_TIMESTEP_MODEL_TIME * parameters.radical_yield * source_scale * initiator_bound
            / MAX_RADICAL_ACTIVITY;

    let largest_coefficient = [
        pi_removal,
        oxygen_removal,
        radical_removal,
        conversion_removal,
        radical_source_fraction,
    ]
    .into_iter()
    .fold(0.0, f64::max);
    (largest_coefficient / REACTION_STABILITY_SAFETY)
        .ceil()
        .max(1.0)
}

/// Stable internal step for the largest possible developer diffusivity.
pub(crate) fn development_stable_timestep(developer_rate: f64) -> f64 {
    let diffusion_timestep =
        DEVELOPER_STABILITY_SAFETY / (MAX_DEVELOPER_DIFFUSIVITY * INVERSE_CELL_SQUARE_SUM);
    let reaction_timestep = if developer_rate > 0.0 {
        REACTION_STABILITY_SAFETY / developer_rate
    } else {
        f64::INFINITY
    };
    diffusion_timestep.min(reaction_timestep)
}

/// Required substeps for both developer diffusion and the dissolution sink.
pub(crate) fn development_required_substeps(parameters: &Parameters) -> f64 {
    let logical_timestep = parameters.development_time / DEVELOPMENT_STEPS_TOTAL as f64;
    (logical_timestep / development_stable_timestep(parameters.developer_rate))
        .ceil()
        .max(1.0)
}

#[derive(Debug, Clone)]
struct Fields {
    photoinitiator: Vec<f32>,
    oxygen: Vec<f32>,
    radical_activity: Vec<f32>,
    conversion: Vec<f32>,
    developer: Vec<f32>,
    remaining_mass: Vec<f32>,
}

impl Fields {
    fn initialized(parameters: &Parameters) -> Self {
        Self {
            photoinitiator: vec![parameters.initiator as f32; GRID_LEN],
            oxygen: vec![parameters.oxygen as f32; GRID_LEN],
            radical_activity: vec![0.0; GRID_LEN],
            conversion: vec![0.0; GRID_LEN],
            developer: vec![0.0; GRID_LEN],
            remaining_mass: vec![1.0; GRID_LEN],
        }
    }

    fn scratch() -> Self {
        Self {
            photoinitiator: vec![0.0; GRID_LEN],
            oxygen: vec![0.0; GRID_LEN],
            radical_activity: vec![0.0; GRID_LEN],
            conversion: vec![0.0; GRID_LEN],
            developer: vec![0.0; GRID_LEN],
            remaining_mass: vec![1.0; GRID_LEN],
        }
    }

    fn reset(&mut self, parameters: &Parameters, scratch: bool) {
        self.photoinitiator.fill(if scratch {
            0.0
        } else {
            parameters.initiator as f32
        });
        self.oxygen.fill(if scratch {
            0.0
        } else {
            parameters.oxygen as f32
        });
        self.radical_activity.fill(0.0);
        self.conversion.fill(0.0);
        self.developer.fill(0.0);
        self.remaining_mass.fill(1.0);
    }

    fn capacity_bytes(&self) -> usize {
        (self.photoinitiator.capacity()
            + self.oxygen.capacity()
            + self.radical_activity.capacity()
            + self.conversion.capacity()
            + self.developer.capacity()
            + self.remaining_mass.capacity())
            * std::mem::size_of::<f32>()
    }
}

/// Small diagnostic payload; grid-sized values stay in the packed f32 snapshot.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub solver: &'static str,
    pub grid_width: usize,
    pub grid_height: usize,
    pub field_count: usize,
    pub field_order: [&'static str; SNAPSHOT_FIELD_COUNT],
    pub timestep_model_time: f64,
    pub exposure_step: u32,
    pub exposure_steps_total: u32,
    pub development_step: u32,
    pub development_steps_total: u32,
    pub exposure_simulated_model_time: f64,
    pub dark_simulated_model_time: f64,
    pub development_simulated_model_time: f64,
    pub simulated_model_time: f64,
    pub light_updates: u32,
    pub dark_updates: u32,
    pub total_updates: u32,
    pub seed: u32,
    pub checksum: String,
    pub owned_memory_bytes: usize,
}

/// Deterministic, allocation-free-after-construction Reaction Lens simulation.
///
/// State is stored field-major in six explicit `Vec<f32>` arrays. Arithmetic is
/// evaluated with f64 intermediates, matching JavaScript number semantics, then
/// rounded once when assigned back to the f32 state.
pub struct Simulation {
    parameters: Parameters,
    exposure_steps_total: u32,
    exposure_step: u32,
    development_step: u32,
    development_simulated_model_time: f64,
    total_updates: u32,
    light_updates: u32,
    dark_updates: u32,
    light_exposure_substeps: usize,
    dark_exposure_substeps: usize,
    development_substeps: usize,
    seed: u32,
    state: Fields,
    scratch: Fields,
    snapshot: Vec<f32>,
    x_positions: Vec<f64>,
    z_positions: Vec<f64>,
    radial_squared: Vec<f64>,
    axial_squared: Vec<f64>,
    source_profile: Vec<f64>,
    development_diffusion_offset: Vec<f64>,
    development_resistance: Vec<f64>,
    development_coefficients_valid: bool,
}

impl Simulation {
    /// Create and validate a simulation without taking an initial numerical step.
    pub fn try_new(config: SimulationConfig, seed: u32) -> Result<Self, ValidationError> {
        config.validate()?;
        let light_exposure_substeps = exposure_required_substeps(&config.parameters, 1.0) as usize;
        let dark_exposure_substeps = exposure_required_substeps(&config.parameters, 0.0) as usize;
        let development_substeps = development_required_substeps(&config.parameters) as usize;
        Ok(Self {
            state: Fields::initialized(&config.parameters),
            scratch: Fields::scratch(),
            snapshot: vec![0.0; GRID_LEN * SNAPSHOT_FIELD_COUNT],
            x_positions: (0..GRID_WIDTH)
                .map(|ix| (ix as f64 / (GRID_WIDTH as f64 - 1.0) - 0.5) * LENS_WIDTH_UM)
                .collect(),
            z_positions: (0..GRID_HEIGHT)
                .map(|iz| (iz as f64 / (GRID_HEIGHT as f64 - 1.0) - 0.5) * LENS_HEIGHT_UM)
                .collect(),
            radial_squared: vec![0.0; GRID_WIDTH],
            axial_squared: vec![0.0; GRID_HEIGHT],
            source_profile: vec![0.0; GRID_LEN],
            development_diffusion_offset: vec![0.0; GRID_LEN],
            development_resistance: vec![0.0; GRID_LEN],
            development_coefficients_valid: false,
            parameters: config.parameters,
            exposure_steps_total: config.exposure_steps_total,
            exposure_step: 0,
            development_step: 0,
            development_simulated_model_time: 0.0,
            total_updates: 0,
            light_updates: 0,
            dark_updates: 0,
            light_exposure_substeps,
            dark_exposure_substeps,
            development_substeps,
            seed,
        })
    }

    /// Validate and apply parameters. Call `reset` when initial concentrations
    /// should be applied to the whole domain, matching the worker's configure flow.
    pub fn set_parameters(&mut self, parameters: Parameters) -> Result<(), ValidationError> {
        parameters.validate()?;
        let light_exposure_substeps = exposure_required_substeps(&parameters, 1.0) as usize;
        let dark_exposure_substeps = exposure_required_substeps(&parameters, 0.0) as usize;
        let development_substeps = development_required_substeps(&parameters) as usize;
        // The stability proof uses P <= initiator and O <= oxygen. Preserve
        // those invariants when a live parameter update lowers either bound
        // without otherwise resetting the chemistry.
        let initiator = parameters.initiator as f32;
        let oxygen = parameters.oxygen as f32;
        for value in &mut self.state.photoinitiator {
            *value = value.min(initiator);
        }
        for value in &mut self.state.oxygen {
            *value = value.min(oxygen);
        }
        self.parameters = parameters;
        self.light_exposure_substeps = light_exposure_substeps;
        self.dark_exposure_substeps = dark_exposure_substeps;
        self.development_substeps = development_substeps;
        self.development_coefficients_valid = false;
        Ok(())
    }

    /// Replace the worker-derived fixed-step exposure schedule.
    pub fn set_exposure_steps_total(
        &mut self,
        exposure_steps_total: u32,
    ) -> Result<(), ValidationError> {
        let candidate = SimulationConfig {
            exposure_steps_total,
            parameters: self.parameters.clone(),
        };
        candidate.validate()?;
        self.exposure_steps_total = exposure_steps_total;
        self.exposure_step = self.exposure_step.min(exposure_steps_total);
        Ok(())
    }

    /// Reset all six fields and both logical schedules.
    ///
    /// The current model has no stochastic term, so the seed is recorded for
    /// reproducible replay and future stochastic extensions without perturbing
    /// the TypeScript parity baseline.
    pub fn reset(&mut self, seed: u32) {
        self.state.reset(&self.parameters, false);
        self.scratch.reset(&self.parameters, true);
        self.snapshot.fill(0.0);
        self.exposure_step = 0;
        self.development_step = 0;
        self.development_simulated_model_time = 0.0;
        self.total_updates = 0;
        self.light_updates = 0;
        self.dark_updates = 0;
        self.seed = seed;
        self.development_coefficients_valid = false;
    }

    /// Advance at most `step_count` exact 0.016 T0 exposure updates.
    ///
    /// Progress and the focus trajectory are owned by Rust:
    /// `progress = exposure_step / max(1, exposure_steps_total - 1)`.
    /// Returning the actual count makes end-of-schedule handling explicit.
    pub fn advance_exposure_steps(&mut self, step_count: u32) -> u32 {
        let steps = step_count.min(self.exposure_steps_total - self.exposure_step);
        for _ in 0..steps {
            let denominator = self.exposure_steps_total.saturating_sub(1).max(1);
            let progress = self.exposure_step as f64 / denominator as f64;
            self.step_exposure(progress, 1.0);
            self.exposure_step += 1;
            self.total_updates += 1;
            self.light_updates += 1;
        }
        steps
    }

    /// Advance illuminated updates at one explicit trajectory progress.
    ///
    /// This is useful for a stationary Reaction Lens and for numerical parity
    /// checkpoints. Production moving scans normally use
    /// `advance_exposure_steps`, which derives progress from the Rust schedule.
    pub fn advance_exposure_at_progress_steps(
        &mut self,
        step_count: u32,
        progress: f64,
    ) -> Result<u32, ValidationError> {
        validate_progress(progress)?;
        let steps = step_count.min(self.exposure_steps_total - self.exposure_step);
        for _ in 0..steps {
            self.step_exposure(progress, 1.0);
            self.exposure_step += 1;
            self.total_updates += 1;
            self.light_updates += 1;
        }
        Ok(steps)
    }

    /// Continue reaction and diffusion with the optical source disabled.
    ///
    /// PI, oxygen, radicals, and conversion still evolve with the identical
    /// fixed-step equations. The explicit progress preserves a future movable
    /// focus contract, although source-off dynamics are focus independent.
    /// Dark updates advance chemistry time without consuming the illuminated
    /// scan schedule, so a paused or completed exposure can continue relaxing.
    pub fn advance_dark_steps(
        &mut self,
        step_count: u32,
        progress: f64,
    ) -> Result<u32, ValidationError> {
        validate_progress(progress)?;
        let steps = step_count.min(MAX_EXPOSURE_STEPS_TOTAL - self.dark_updates);
        for _ in 0..steps {
            self.step_exposure(progress, 0.0);
            self.total_updates += 1;
            self.dark_updates += 1;
        }
        Ok(steps)
    }

    /// Advance at most `step_count` of the existing 210 development updates.
    ///
    /// Every logical update is subdivided enough to keep the variable developer
    /// diffusion term below a conservative 0.45 Courant sum.
    pub fn advance_development_steps(&mut self, step_count: u32) -> u32 {
        let steps = step_count.min(DEVELOPMENT_STEPS_TOTAL - self.development_step);
        for _ in 0..steps {
            self.step_development();
            self.development_step += 1;
            self.development_simulated_model_time +=
                self.parameters.development_time / DEVELOPMENT_STEPS_TOTAL as f64;
            self.total_updates += 1;
        }
        steps
    }

    /// Refresh and borrow a packed, field-major render snapshot.
    ///
    /// Layout is P, O, R, X, developer, remaining mass, with `GRID_LEN` f32
    /// values per field. This buffer is distinct from the numerical state, so a
    /// renderer cannot mutate authoritative chemistry through its snapshot view.
    pub fn snapshot(&mut self) -> &[f32] {
        let n = GRID_LEN;
        self.snapshot[0..n].copy_from_slice(&self.state.photoinitiator);
        self.snapshot[n..2 * n].copy_from_slice(&self.state.oxygen);
        self.snapshot[2 * n..3 * n].copy_from_slice(&self.state.radical_activity);
        self.snapshot[3 * n..4 * n].copy_from_slice(&self.state.conversion);
        self.snapshot[4 * n..5 * n].copy_from_slice(&self.state.developer);
        self.snapshot[5 * n..6 * n].copy_from_slice(&self.state.remaining_mass);
        &self.snapshot
    }

    /// Snapshot length in f32 elements.
    pub const fn snapshot_len(&self) -> usize {
        GRID_LEN * SNAPSHOT_FIELD_COUNT
    }

    /// Current compact diagnostic state.
    pub fn diagnostics(&self) -> Diagnostics {
        let exposure_time = self.light_updates as f64 * FIXED_TIMESTEP_MODEL_TIME;
        let dark_time = self.dark_updates as f64 * FIXED_TIMESTEP_MODEL_TIME;
        let development_time = self.development_simulated_model_time;
        Diagnostics {
            solver: "Rust/Wasm",
            grid_width: GRID_WIDTH,
            grid_height: GRID_HEIGHT,
            field_count: SNAPSHOT_FIELD_COUNT,
            field_order: SNAPSHOT_FIELD_ORDER,
            timestep_model_time: FIXED_TIMESTEP_MODEL_TIME,
            exposure_step: self.exposure_step,
            exposure_steps_total: self.exposure_steps_total,
            development_step: self.development_step,
            development_steps_total: DEVELOPMENT_STEPS_TOTAL,
            exposure_simulated_model_time: exposure_time,
            dark_simulated_model_time: dark_time,
            development_simulated_model_time: development_time,
            simulated_model_time: exposure_time + dark_time + development_time,
            light_updates: self.light_updates,
            dark_updates: self.dark_updates,
            total_updates: self.total_updates,
            seed: self.seed,
            checksum: format!("{:08x}", self.state_checksum()),
            owned_memory_bytes: self.state.capacity_bytes()
                + self.scratch.capacity_bytes()
                + self.snapshot.capacity() * std::mem::size_of::<f32>()
                + (self.x_positions.capacity()
                    + self.z_positions.capacity()
                    + self.radial_squared.capacity()
                    + self.axial_squared.capacity()
                    + self.source_profile.capacity()
                    + self.development_diffusion_offset.capacity()
                    + self.development_resistance.capacity())
                    * std::mem::size_of::<f64>(),
        }
    }

    fn step_exposure(&mut self, progress: f64, source_multiplier: f64) {
        let parameters = &self.parameters;
        let phase = (progress * parameters.passes.max(1.0) * 8.2) % 1.0;
        let focus_x = (phase - 0.5) * LENS_WIDTH_UM * 0.78;
        let focus_z = (progress * std::f64::consts::PI * 7.0).sin() * 0.72;
        let waist = ((0.36 * parameters.wavelength) / 780.0 / parameters.na).max(0.2);
        let axial = waist * 3.1;
        let source_scale = 4.0
            * (parameters.power / 16.0).powi(2)
            * (80.0 / parameters.repetition_rate)
            * (100.0 / parameters.pulse_duration)
            * (45.0 / parameters.speed)
            * photoinitiator_absorption_factor(
                parameters.wavelength,
                parameters.pi_absorption_peak,
            )
            * source_multiplier;

        for (radial_squared, x_position) in self
            .radial_squared
            .iter_mut()
            .zip(self.x_positions.iter().copied())
        {
            let radial = (x_position - focus_x) / waist;
            *radial_squared = radial * radial;
        }
        for (axial_squared, z_position) in self
            .axial_squared
            .iter_mut()
            .zip(self.z_positions.iter().copied())
        {
            let axial_distance = (z_position - focus_z) / axial;
            *axial_squared = axial_distance * axial_distance;
        }

        {
            let radial_squared = &self.radial_squared;
            let axial_squared = &self.axial_squared;
            let source_profile = &mut self.source_profile;

            for (iz, axial_squared) in axial_squared.iter().copied().enumerate() {
                for (ix, radial_squared) in radial_squared.iter().copied().enumerate() {
                    let index = iz * GRID_WIDTH + ix;
                    let psi = (-2.0 * (radial_squared + axial_squared)).exp();
                    source_profile[index] = source_scale * psi * psi;
                }
            }
        }

        let substeps = if source_multiplier == 0.0 {
            self.dark_exposure_substeps
        } else {
            self.light_exposure_substeps
        };
        let substep_dt = FIXED_TIMESTEP_MODEL_TIME / substeps as f64;

        for _ in 0..substeps {
            {
                let state = &self.state;
                let scratch = &mut self.scratch;
                let source_profile = &self.source_profile;

                for iz in 0..GRID_HEIGHT {
                    for ix in 0..GRID_WIDTH {
                        let index = iz * GRID_WIDTH + ix;
                        let left_index = index - if ix > 0 { 1 } else { 0 };
                        let right_index = index + if ix < GRID_WIDTH - 1 { 1 } else { 0 };
                        let down_index = index - if iz > 0 { GRID_WIDTH } else { 0 };
                        let up_index = index + if iz < GRID_HEIGHT - 1 { GRID_WIDTH } else { 0 };
                        let source = source_profile[index];

                        let p = state.photoinitiator[index] as f64;
                        let o = state.oxygen[index] as f64;
                        let r = state.radical_activity[index] as f64;
                        let x = state.conversion[index] as f64;
                        let laplacian_p = laplacian_at(
                            &state.photoinitiator,
                            index,
                            left_index,
                            right_index,
                            down_index,
                            up_index,
                        );
                        let laplacian_o = laplacian_at(
                            &state.oxygen,
                            index,
                            left_index,
                            right_index,
                            down_index,
                            up_index,
                        );
                        let laplacian_r = laplacian_at(
                            &state.radical_activity,
                            index,
                            left_index,
                            right_index,
                            down_index,
                            up_index,
                        );
                        let radical_loss = (parameters.dark_loss + parameters.oxygen_quench * o)
                            * r
                            + parameters.termination * r * r;

                        // Nondimensional reduced model, explicit Euler:
                        // ∂P/∂t = Dp ∇²P - β S P
                        scratch.photoinitiator[index] = clamp(
                            p + substep_dt
                                * (parameters.pi_diffusion * laplacian_p
                                    - parameters.pi_depletion * source * p),
                            0.0,
                            parameters.initiator,
                        ) as f32;
                        // ∂R/∂t = Dr ∇²R + η S P - (δ + q O)R - κR²
                        scratch.radical_activity[index] = clamp(
                            r + substep_dt
                                * (parameters.radical_diffusion * laplacian_r
                                    + parameters.radical_yield * source * p
                                    - radical_loss),
                            0.0,
                            MAX_RADICAL_ACTIVITY,
                        ) as f32;
                        // ∂O/∂t = Do ∇²O - 0.2 q O R
                        scratch.oxygen[index] = clamp(
                            o + substep_dt
                                * (parameters.oxygen_diffusion * laplacian_o
                                    - 0.2 * parameters.oxygen_quench * o * r),
                            0.0,
                            parameters.oxygen,
                        ) as f32;
                        // ∂X/∂t = γ R (1 - X); X is conversion, not gel fraction.
                        scratch.conversion[index] =
                            clamp_unit(x + substep_dt * parameters.propagation * r * (1.0 - x))
                                as f32;

                        // Existing boundary conditions: replenished P and O at the
                        // domain edge; R and X retain mirrored-neighbor no-flux terms.
                        if ix == 0 || iz == 0 || ix == GRID_WIDTH - 1 || iz == GRID_HEIGHT - 1 {
                            scratch.photoinitiator[index] = parameters.initiator as f32;
                            scratch.oxygen[index] = parameters.oxygen as f32;
                        }
                    }
                }
            }

            std::mem::swap(
                &mut self.state.photoinitiator,
                &mut self.scratch.photoinitiator,
            );
            std::mem::swap(&mut self.state.oxygen, &mut self.scratch.oxygen);
            std::mem::swap(
                &mut self.state.radical_activity,
                &mut self.scratch.radical_activity,
            );
            std::mem::swap(&mut self.state.conversion, &mut self.scratch.conversion);
        }
        self.development_coefficients_valid = false;
    }

    fn step_development(&mut self) {
        self.refresh_development_coefficients();
        let logical_dt = self.parameters.development_time / DEVELOPMENT_STEPS_TOTAL as f64;
        let substeps = self.development_substeps;
        let substep_dt = logical_dt / substeps as f64;
        let developer_rate = self.parameters.developer_rate;

        for _ in 0..substeps {
            {
                let state = &self.state;
                let scratch = &mut self.scratch;
                let development_diffusion_offset = &self.development_diffusion_offset;
                let development_resistance = &self.development_resistance;

                for iz in 0..GRID_HEIGHT {
                    for ix in 0..GRID_WIDTH {
                        let index = iz * GRID_WIDTH + ix;
                        let left_index = index - if ix > 0 { 1 } else { 0 };
                        let right_index = index + if ix < GRID_WIDTH - 1 { 1 } else { 0 };
                        let down_index = index - if iz > 0 { GRID_WIDTH } else { 0 };
                        let up_index = index + if iz < GRID_HEIGHT - 1 { GRID_WIDTH } else { 0 };
                        let developer = state.developer[index] as f64;
                        let mass = state.remaining_mass[index] as f64;
                        let diffusivity =
                            0.014 + 0.08 * (1.0 - mass) + development_diffusion_offset[index];
                        let laplacian_developer = laplacian_at(
                            &state.developer,
                            index,
                            left_index,
                            right_index,
                            down_index,
                            up_index,
                        );

                        // ∂Cdev/∂t = Ddev(M, gel) ∇²Cdev
                        scratch.developer[index] =
                            clamp_unit(developer + substep_dt * diffusivity * laplacian_developer)
                                as f32;
                        // ∂M/∂t = -k0 exp(-ak gel) Cdev M
                        scratch.remaining_mass[index] = clamp_unit(
                            mass - substep_dt
                                * developer_rate
                                * development_resistance[index]
                                * developer
                                * mass,
                        ) as f32;

                        // Developer bath is held at unit concentration on every edge.
                        if ix == 0 || iz == 0 || ix == GRID_WIDTH - 1 || iz == GRID_HEIGHT - 1 {
                            scratch.developer[index] = 1.0;
                        }
                    }
                }
            }

            std::mem::swap(&mut self.state.developer, &mut self.scratch.developer);
            std::mem::swap(
                &mut self.state.remaining_mass,
                &mut self.scratch.remaining_mass,
            );
        }
    }

    fn refresh_development_coefficients(&mut self) {
        if self.development_coefficients_valid {
            return;
        }

        let gel_point = self.parameters.gel_point;
        let developer_resistance = self.parameters.developer_resistance;
        for index in 0..GRID_LEN {
            // Gel fraction is a derived development resistance. It remains
            // distinct from both conversion X and remaining mass M. Conversion
            // is frozen during development, so these transcendental terms are
            // identical for every substep and can be cached without approximation.
            let conversion = self.state.conversion[index] as f64;
            let gel = clamp_unit((conversion - gel_point) / (1.0 - gel_point)).powf(0.7);
            self.development_diffusion_offset[index] = 0.02 * (-3.0 * gel).exp();
            self.development_resistance[index] = (-developer_resistance * gel).exp();
        }
        self.development_coefficients_valid = true;
    }

    fn state_checksum(&self) -> u32 {
        let mut hash = 2_166_136_261_u32;
        hash = fnv_word(hash, self.seed);
        hash = fnv_word(hash, self.exposure_step);
        hash = fnv_word(hash, self.development_step);
        hash = fnv_word(hash, self.light_updates);
        hash = fnv_word(hash, self.dark_updates);
        let development_time_bits = self.development_simulated_model_time.to_bits();
        hash = fnv_word(hash, development_time_bits as u32);
        hash = fnv_word(hash, (development_time_bits >> 32) as u32);
        for field in [
            &self.state.photoinitiator,
            &self.state.oxygen,
            &self.state.radical_activity,
            &self.state.conversion,
            &self.state.developer,
            &self.state.remaining_mass,
        ] {
            for value in field {
                hash = fnv_word(hash, value.to_bits());
            }
        }
        hash
    }
}

fn fnv_word(mut hash: u32, word: u32) -> u32 {
    hash ^= word;
    hash.wrapping_mul(16_777_619)
}

#[inline(always)]
fn laplacian_at(
    field: &[f32],
    index: usize,
    left_index: usize,
    right_index: usize,
    down_index: usize,
    up_index: usize,
) -> f64 {
    let left = field[left_index] as f64;
    let right = field[right_index] as f64;
    let down = field[down_index] as f64;
    let up = field[up_index] as f64;
    let center = field[index] as f64;
    (left + right - center * 2.0) / (DX_UM * DX_UM) + (down + up - center * 2.0) / (DZ_UM * DZ_UM)
}

fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

fn clamp_unit(value: f64) -> f64 {
    clamp(value, 0.0, 1.0)
}

fn validate_progress(progress: f64) -> Result<(), ValidationError> {
    if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
        return Err(ValidationError::new(
            "progress must be finite and between zero and one",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: u32 = 0x07a1;

    fn config(parameters: Parameters, exposure_steps_total: u32) -> SimulationConfig {
        SimulationConfig {
            parameters,
            exposure_steps_total,
        }
    }

    fn simulation(parameters: Parameters, exposure_steps_total: u32) -> Simulation {
        Simulation::try_new(config(parameters, exposure_steps_total), SEED).unwrap()
    }

    fn assert_fields_equal(left: &Simulation, right: &Simulation) {
        assert_eq!(left.state.photoinitiator, right.state.photoinitiator);
        assert_eq!(left.state.oxygen, right.state.oxygen);
        assert_eq!(left.state.radical_activity, right.state.radical_activity);
        assert_eq!(left.state.conversion, right.state.conversion);
        assert_eq!(left.state.developer, right.state.developer);
        assert_eq!(left.state.remaining_mass, right.state.remaining_mass);
    }

    fn state_fields(sim: &Simulation) -> [&[f32]; SNAPSHOT_FIELD_COUNT] {
        [
            &sim.state.photoinitiator,
            &sim.state.oxygen,
            &sim.state.radical_activity,
            &sim.state.conversion,
            &sim.state.developer,
            &sim.state.remaining_mass,
        ]
    }

    fn field_statistics(field: &[f32]) -> [f64; 3] {
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        let mut sum = 0.0;
        for value in field {
            let value = *value as f64;
            minimum = minimum.min(value);
            maximum = maximum.max(value);
            sum += value;
        }
        [minimum, maximum, sum / field.len() as f64]
    }

    fn assert_close(label: &str, actual: f64, expected: f64) {
        // The compact TypeScript reference stores Float32 state after binary64
        // V8 intermediates. Rust deliberately uses the same precision boundary;
        // libm transcendental implementations may still differ by a few ulps.
        let tolerance = 2.0e-6_f64.max(expected.abs() * 2.0e-5);
        assert!(
            (actual - expected).abs() <= tolerance,
            "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.12e}"
        );
    }

    fn assert_statistics(
        scenario: &str,
        sim: &Simulation,
        expected: [[f64; 3]; SNAPSHOT_FIELD_COUNT],
    ) {
        for (field_index, (field, expected)) in
            state_fields(sim).into_iter().zip(expected).enumerate()
        {
            let actual = field_statistics(field);
            for statistic_index in 0..3 {
                assert_close(
                    &format!("{scenario} field {field_index} statistic {statistic_index}"),
                    actual[statistic_index],
                    expected[statistic_index],
                );
            }
        }
    }

    fn assert_sample(
        scenario: &str,
        sim: &Simulation,
        index: usize,
        expected: [f64; SNAPSHOT_FIELD_COUNT],
    ) {
        for (field_index, (field, expected)) in
            state_fields(sim).into_iter().zip(expected).enumerate()
        {
            assert_close(
                &format!("{scenario} sample {index} field {field_index}"),
                field[index] as f64,
                expected,
            );
        }
    }

    #[test]
    fn deterministic_reset_and_replay_are_bit_exact() {
        let mut sim = simulation(Parameters::default(), 160);
        assert_eq!(sim.advance_exposure_steps(91), 91);
        assert_eq!(sim.advance_development_steps(7), 7);
        let first = sim.snapshot().to_vec();
        let first_checksum = sim.diagnostics().checksum;

        sim.reset(SEED);
        assert_eq!(sim.advance_exposure_steps(91), 91);
        assert_eq!(sim.advance_development_steps(7), 7);
        assert_eq!(sim.snapshot(), first.as_slice());
        assert_eq!(sim.diagnostics().checksum, first_checksum);
    }

    #[test]
    fn exposure_is_independent_of_batch_chunking() {
        let mut one_batch = simulation(Parameters::default(), 137);
        let mut frame_batches = simulation(Parameters::default(), 137);
        assert_eq!(one_batch.advance_exposure_steps(137), 137);
        for steps in [1, 7, 2, 31, 3, 46, 47] {
            frame_batches.advance_exposure_steps(steps);
        }
        assert_fields_equal(&one_batch, &frame_batches);
        assert_eq!(one_batch.diagnostics(), frame_batches.diagnostics());
        assert_eq!(frame_batches.advance_exposure_steps(1), 0);
    }

    #[test]
    fn stationary_exposure_counts_each_light_update_once() {
        let mut sim = simulation(Parameters::default(), 137);
        let step_count = 43;
        assert_eq!(sim.light_exposure_substeps, 1);
        assert_eq!(sim.dark_exposure_substeps, 1);

        assert_eq!(
            sim.advance_exposure_at_progress_steps(step_count, 0.5)
                .unwrap(),
            step_count
        );

        let diagnostics = sim.diagnostics();
        assert_eq!(diagnostics.light_updates, step_count);
        assert_eq!(diagnostics.dark_updates, 0);
        assert_eq!(diagnostics.total_updates, step_count);
    }

    #[test]
    fn dark_chemistry_continues_without_consuming_scan_progress() {
        let mut sim = simulation(Parameters::default(), 2);
        assert_eq!(sim.advance_exposure_steps(2), 2);
        let checksum_after_light = sim.diagnostics().checksum;

        assert_eq!(sim.advance_dark_steps(3, 0.5).unwrap(), 3);

        let diagnostics = sim.diagnostics();
        assert_eq!(diagnostics.exposure_step, 2);
        assert_eq!(diagnostics.light_updates, 2);
        assert_eq!(diagnostics.dark_updates, 3);
        assert_eq!(diagnostics.total_updates, 5);
        assert_eq!(
            diagnostics.exposure_simulated_model_time,
            2.0 * FIXED_TIMESTEP_MODEL_TIME,
        );
        assert_eq!(
            diagnostics.dark_simulated_model_time,
            3.0 * FIXED_TIMESTEP_MODEL_TIME,
        );
        assert_eq!(
            diagnostics.simulated_model_time,
            5.0 * FIXED_TIMESTEP_MODEL_TIME,
        );
        assert_ne!(diagnostics.checksum, checksum_after_light);
    }

    #[test]
    fn dark_chemistry_respects_the_bounded_update_budget() {
        let mut sim = simulation(Parameters::default(), 1);
        sim.dark_updates = MAX_EXPOSURE_STEPS_TOTAL - 1;
        sim.total_updates = MAX_EXPOSURE_STEPS_TOTAL - 1;

        assert_eq!(sim.advance_dark_steps(3, 0.5).unwrap(), 1);
        assert_eq!(sim.dark_updates, MAX_EXPOSURE_STEPS_TOTAL);
        assert_eq!(sim.advance_dark_steps(1, 0.5).unwrap(), 0);
    }

    #[test]
    fn validation_rejects_nonfinite_negative_and_unstable_values_transactionally() {
        let mut sim = simulation(Parameters::default(), 16);
        let original = sim.parameters.clone();

        let mut invalid = original.clone();
        invalid.oxygen = f64::NAN;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.initiator = -0.01;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.passes = f64::MAX;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.passes = 1.5;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.oxygen_diffusion = 0.51 / (FIXED_TIMESTEP_MODEL_TIME * INVERSE_CELL_SQUARE_SUM);
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.pi_depletion = 1_000_000.0;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        let mut invalid = original.clone();
        invalid.developer_rate = 1_000_000.0;
        assert!(sim.set_parameters(invalid).is_err());
        assert_eq!(sim.parameters, original);

        assert!(sim.set_exposure_steps_total(0).is_err());
        assert_eq!(sim.exposure_steps_total, 16);
        assert!(sim
            .advance_exposure_at_progress_steps(1, f64::INFINITY)
            .is_err());
        assert!(sim.advance_dark_steps(1, -0.01).is_err());
        assert_eq!(sim.exposure_step, 0);
    }

    #[test]
    fn diffusion_only_smooths_a_gradient_and_respects_bounds() {
        let parameters = Parameters {
            pi_diffusion: 0.003,
            oxygen_diffusion: 0.0,
            radical_diffusion: 0.0,
            pi_depletion: 0.0,
            radical_yield: 0.0,
            dark_loss: 0.0,
            oxygen_quench: 0.0,
            termination: 0.0,
            propagation: 0.0,
            ..Parameters::default()
        };
        let mut sim = simulation(parameters, 2);
        sim.state.photoinitiator.fill(0.0);
        let center = (GRID_HEIGHT / 2) * GRID_WIDTH + GRID_WIDTH / 2;
        sim.state.photoinitiator[center] = 1.0;

        sim.advance_exposure_steps(1);

        assert!(sim.state.photoinitiator[center] < 1.0);
        assert!(sim.state.photoinitiator[center - 1] > 0.0);
        assert!(sim
            .state
            .photoinitiator
            .iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value)));
    }

    #[test]
    fn reaction_only_generates_radicals_then_conversion_without_visual_shortcuts() {
        let parameters = Parameters {
            oxygen: 0.0,
            pi_diffusion: 0.0,
            oxygen_diffusion: 0.0,
            radical_diffusion: 0.0,
            dark_loss: 0.0,
            oxygen_quench: 0.0,
            termination: 0.0,
            ..Parameters::default()
        };
        let mut sim = simulation(parameters, 3);

        let initial_p: f64 = sim
            .state
            .photoinitiator
            .iter()
            .map(|value| *value as f64)
            .sum();
        sim.advance_exposure_steps(1);
        let radical_after_one: f64 = sim
            .state
            .radical_activity
            .iter()
            .map(|value| *value as f64)
            .sum();
        assert!(radical_after_one > 0.0);
        assert!(sim.state.conversion.iter().all(|value| *value == 0.0));

        sim.advance_exposure_steps(1);
        let final_p: f64 = sim
            .state
            .photoinitiator
            .iter()
            .map(|value| *value as f64)
            .sum();
        assert!(final_p < initial_p);
        assert!(sim.state.conversion.iter().any(|value| *value > 0.0));
    }

    #[test]
    fn extreme_pi_depletion_uses_bounded_positive_substeps() {
        let parameters = Parameters {
            pi_depletion: 30.0,
            radical_yield: 0.0,
            dark_loss: 0.0,
            oxygen_quench: 0.0,
            termination: 0.0,
            propagation: 0.0,
            pi_diffusion: 0.0,
            oxygen_diffusion: 0.0,
            radical_diffusion: 0.0,
            ..Parameters::default()
        };
        // At peak source, one logical Euler update would remove 1.92 P and
        // clamp to zero. Three stable substeps retain a positive concentration.
        assert_eq!(exposure_required_substeps(&parameters, 1.0), 3.0);
        let mut sim = simulation(parameters, 1);
        assert_eq!(sim.light_exposure_substeps, 3);

        sim.advance_exposure_at_progress_steps(1, 0.5).unwrap();

        let minimum = sim
            .state
            .photoinitiator
            .iter()
            .copied()
            .fold(f32::INFINITY, f32::min);
        assert!(minimum > 0.0 && minimum < 0.5);
        assert!(sim
            .state
            .photoinitiator
            .iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value)));
    }

    #[test]
    fn extreme_radical_loss_uses_bounded_positive_substeps() {
        let parameters = Parameters {
            power: 0.0,
            oxygen: 2.0,
            pi_depletion: 0.0,
            radical_yield: 0.0,
            dark_loss: 100.0,
            oxygen_quench: 100.0,
            termination: 100.0,
            propagation: 0.0,
            pi_diffusion: 0.0,
            oxygen_diffusion: 0.0,
            radical_diffusion: 0.0,
            ..Parameters::default()
        };
        // At R=8 and O=2, one logical Euler update would remove 140.8 R.
        // The worst-case loss coefficient requires twenty positive substeps.
        assert_eq!(exposure_required_substeps(&parameters, 0.0), 20.0);
        let mut sim = simulation(parameters, 1);
        assert_eq!(sim.dark_exposure_substeps, 20);
        sim.state.radical_activity.fill(MAX_RADICAL_ACTIVITY as f32);

        sim.advance_dark_steps(1, 0.5).unwrap();

        let center = (GRID_HEIGHT / 2) * GRID_WIDTH + GRID_WIDTH / 2;
        assert!(sim.state.radical_activity[center] > 0.0);
        assert!(sim.state.radical_activity[center] < MAX_RADICAL_ACTIVITY as f32);
        assert!(sim.state.oxygen[center] > 0.0);
        assert!(sim.state.oxygen[center] < 2.0);
        assert!(sim
            .state
            .radical_activity
            .iter()
            .chain(&sim.state.oxygen)
            .all(|value| value.is_finite() && *value >= 0.0));
    }

    #[test]
    fn oxygen_depletes_by_quenching_and_recovers_by_diffusion() {
        let depletion_parameters = Parameters {
            oxygen_diffusion: 0.0,
            radical_yield: 0.0,
            pi_depletion: 0.0,
            radical_diffusion: 0.0,
            ..Parameters::default()
        };
        let mut depletion = simulation(depletion_parameters, 2);
        let center = (GRID_HEIGHT / 2) * GRID_WIDTH + GRID_WIDTH / 2;
        depletion.state.radical_activity[center] = 1.0;
        depletion.advance_exposure_steps(1);
        assert!(depletion.state.oxygen[center] < 1.0);

        let recovery_parameters = Parameters {
            oxygen_diffusion: 0.0035,
            radical_yield: 0.0,
            pi_depletion: 0.0,
            radical_diffusion: 0.0,
            oxygen_quench: 0.0,
            ..Parameters::default()
        };
        let mut recovery = simulation(recovery_parameters, 2);
        recovery.state.oxygen[center] = 0.0;
        recovery.advance_exposure_steps(1);
        assert!(recovery.state.oxygen[center] > 0.0);
    }

    #[test]
    fn radicals_decay_and_conversion_is_monotone() {
        let parameters = Parameters {
            oxygen: 0.0,
            pi_depletion: 0.0,
            radical_yield: 0.0,
            pi_diffusion: 0.0,
            oxygen_diffusion: 0.0,
            radical_diffusion: 0.0,
            dark_loss: 0.2,
            termination: 0.0,
            ..Parameters::default()
        };
        let mut sim = simulation(parameters, 24);
        let center = (GRID_HEIGHT / 2) * GRID_WIDTH + GRID_WIDTH / 2;
        sim.state.radical_activity[center] = 1.0;

        let mut previous_radical = 1.0;
        let mut previous_conversion = 0.0;
        for _ in 0..24 {
            sim.advance_exposure_steps(1);
            let radical = sim.state.radical_activity[center];
            let conversion = sim.state.conversion[center];
            assert!(radical <= previous_radical);
            assert!(conversion >= previous_conversion);
            previous_radical = radical;
            previous_conversion = conversion;
        }
        assert!(previous_radical < 1.0);
        assert!(previous_conversion > 0.0);
    }

    #[test]
    fn development_time_accumulates_across_live_parameter_changes() {
        let mut sim = simulation(Parameters::default(), 1);
        let first_step_time = sim.parameters.development_time / DEVELOPMENT_STEPS_TOTAL as f64;
        assert_eq!(sim.advance_development_steps(1), 1);
        assert_eq!(
            sim.diagnostics().development_simulated_model_time,
            first_step_time,
        );

        let mut updated = sim.parameters.clone();
        updated.development_time = 90.0;
        sim.set_parameters(updated).unwrap();
        assert_eq!(
            sim.diagnostics().development_simulated_model_time,
            first_step_time,
        );

        assert_eq!(sim.advance_development_steps(1), 1);
        assert_eq!(
            sim.diagnostics().development_simulated_model_time,
            first_step_time + 90.0 / DEVELOPMENT_STEPS_TOTAL as f64,
        );

        sim.reset(SEED);
        assert_eq!(sim.diagnostics().development_simulated_model_time, 0.0);
    }

    #[test]
    fn development_is_stable_monotone_and_conversion_resistant() {
        let parameters = Parameters {
            development_time: 5.0,
            ..Parameters::default()
        };
        let mut sim = simulation(parameters, 1);
        for iz in 0..GRID_HEIGHT {
            for ix in GRID_WIDTH / 2..GRID_WIDTH {
                sim.state.conversion[iz * GRID_WIDTH + ix] = 0.8;
            }
        }
        let soluble_edge = 10;
        let resistant_edge = GRID_WIDTH - 11;
        let mut previous_mass = sim.state.remaining_mass.clone();

        for _ in 0..DEVELOPMENT_STEPS_TOTAL {
            sim.advance_development_steps(1);
            for (before, after) in previous_mass.iter().zip(&sim.state.remaining_mass) {
                assert!(*after <= *before);
                assert!(after.is_finite() && (0.0..=1.0).contains(after));
            }
            assert!(sim
                .state
                .developer
                .iter()
                .all(|value| value.is_finite() && (0.0..=1.0).contains(value)));
            previous_mass.copy_from_slice(&sim.state.remaining_mass);
        }

        assert!(sim.state.remaining_mass[soluble_edge] < sim.state.remaining_mass[resistant_edge]);
        assert_eq!(sim.development_step, DEVELOPMENT_STEPS_TOTAL);
        assert_eq!(sim.advance_development_steps(1), 0);
    }

    #[test]
    fn snapshot_dimensions_order_and_storage_are_stable() {
        let parameters = Parameters {
            initiator: 0.75,
            oxygen: 0.5,
            ..Parameters::default()
        };
        let mut sim = simulation(parameters, 10);
        let expected_len = GRID_WIDTH * GRID_HEIGHT * SNAPSHOT_FIELD_COUNT;

        let pointer_before = sim.snapshot().as_ptr();
        assert_eq!(sim.snapshot_len(), expected_len);
        let snapshot = sim.snapshot();
        assert!(snapshot[0..GRID_LEN].iter().all(|value| *value == 0.75));
        assert!(snapshot[GRID_LEN..2 * GRID_LEN]
            .iter()
            .all(|value| *value == 0.5));
        assert!(snapshot[2 * GRID_LEN..4 * GRID_LEN]
            .iter()
            .all(|value| *value == 0.0));
        assert!(snapshot[4 * GRID_LEN..5 * GRID_LEN]
            .iter()
            .all(|value| *value == 0.0));
        assert!(snapshot[5 * GRID_LEN..6 * GRID_LEN]
            .iter()
            .all(|value| *value == 1.0));

        sim.advance_exposure_steps(1);
        let pointer_after = sim.snapshot().as_ptr();
        assert_eq!(pointer_before, pointer_after);
        assert_eq!(SNAPSHOT_FIELD_ORDER[0], "photoinitiator");
        assert_eq!(SNAPSHOT_FIELD_ORDER[5], "remainingMass");
    }

    #[test]
    fn compact_typescript_parity_reference_stays_within_tolerance() {
        // Compact reference values are from the pre-migration TypeScript harness
        // at commit fbf18178755341c921f7a42be3a5c37c7e269f0e. Keeping only
        // representative statistics and samples avoids committing the 385 KiB
        // full-grid fixture or a duplicated TypeScript solver.
        let mut stationary = simulation(Parameters::default(), 2_000);
        stationary
            .advance_exposure_at_progress_steps(600, 0.5)
            .unwrap();
        assert_statistics(
            "stationary step 600",
            &stationary,
            [
                [0.523_437_798_023, 1.0, 0.999_245_447_099],
                [0.023_750_854_656_1, 1.0, 0.995_387_993_702],
                [0.0, 0.935_944_437_981, 0.001_403_923_284_22],
                [0.0, 0.997_806_847_095, 0.002_652_474_125_49],
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
            ],
        );
        assert_sample(
            "stationary step 600 focus",
            &stationary,
            28 * GRID_WIDTH + 21,
            [
                0.523_437_798,
                0.023_750_854_7,
                0.935_944_438,
                0.997_806_847,
                0.0,
                1.0,
            ],
        );

        stationary
            .advance_exposure_at_progress_steps(200, 0.5)
            .unwrap();
        let oxygen_before_dark = stationary.state.oxygen[28 * GRID_WIDTH + 21];
        let radical_before_dark = stationary.state.radical_activity[28 * GRID_WIDTH + 21];
        stationary.advance_dark_steps(1_200, 0.5).unwrap();
        assert_statistics(
            "stationary 800 plus dark 1200",
            &stationary,
            [
                [0.605_989_277_363, 1.0, 0.999_040_772_019],
                [0.497_272_580_862, 1.0, 0.994_340_552_843],
                [0.0, 3.055_918_152_29e-22, 5.357_878_725_76e-26],
                [0.0, 0.999_824_345_112, 0.003_072_115_071_98],
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
            ],
        );
        assert_sample(
            "stationary dark recovery focus",
            &stationary,
            28 * GRID_WIDTH + 21,
            [
                0.605_989_277,
                0.497_272_581,
                3.055_918_15e-22,
                0.999_824_345,
                0.0,
                1.0,
            ],
        );
        assert!(stationary.state.oxygen[28 * GRID_WIDTH + 21] > oxygen_before_dark);
        assert!(stationary.state.radical_activity[28 * GRID_WIDTH + 21] < radical_before_dark);

        let mut moving = simulation(Parameters::default(), 720);
        moving.advance_exposure_steps(720);
        assert_statistics(
            "moving scan 720",
            &moving,
            [
                [0.989_934_921_265, 1.0, 0.998_929_873_954],
                [0.913_695_335_388, 1.0, 0.989_713_702_985],
                [0.0, 0.093_775_406_479_8, 0.000_599_260_382_498],
                [0.0, 0.041_575_282_812_1, 0.004_571_645_433_41],
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
            ],
        );
        assert_sample(
            "moving scan center",
            &moving,
            34 * GRID_WIDTH + 56,
            [
                0.994_502_485,
                0.945_168_853,
                0.000_003_130_127_2,
                0.023_635_175_1,
                0.0,
                1.0,
            ],
        );
        assert_sample(
            "moving scan left",
            &moving,
            34 * GRID_WIDTH + 15,
            [
                0.990_866_84,
                0.919_211_864,
                0.011_059_542_2,
                0.038_998_346_8,
                0.0,
                1.0,
            ],
        );

        moving.advance_development_steps(DEVELOPMENT_STEPS_TOTAL);
        assert_statistics(
            "moving scan full development",
            &moving,
            [
                [0.989_934_921_265, 1.0, 0.998_929_873_954],
                [0.913_695_335_388, 1.0, 0.989_713_702_985],
                [0.0, 0.093_775_406_479_8, 0.000_599_260_382_498],
                [0.0, 0.041_575_282_812_1, 0.004_571_645_433_41],
                [0.158_474_624_157, 1.0, 0.641_799_535_728],
                [
                    7.845_010_907_13e-31,
                    0.175_965_622_067,
                    0.007_874_279_364_24,
                ],
            ],
        );
        assert_sample(
            "moving scan developed center",
            &moving,
            34 * GRID_WIDTH + 56,
            [
                0.994_502_485,
                0.945_168_853,
                0.000_003_130_127_2,
                0.023_635_175_1,
                0.158_474_624,
                0.175_965_622,
            ],
        );

        let mut decay = simulation(Parameters::default(), 1_050);
        decay.advance_exposure_at_progress_steps(250, 0.5).unwrap();
        let activated_max = field_statistics(&decay.state.radical_activity)[1];
        assert_close("radical activation max", activated_max, 1.031_304_597_85);
        decay.advance_dark_steps(800, 0.5).unwrap();
        assert_statistics(
            "radical decay after 800 dark steps",
            &decay,
            [
                [0.811_764_419_079, 1.0, 0.999_654_698_945],
                [0.602_667_391_3, 1.0, 0.997_306_153_084],
                [0.0, 7.808_928_133_21e-20, 1.292_767_902_24e-23],
                [0.0, 0.924_457_788_467, 0.001_540_841_600_37],
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
            ],
        );
        assert!(field_statistics(&decay.state.radical_activity)[1] < 1.0e-15);
    }
}
