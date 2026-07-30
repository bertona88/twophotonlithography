use std::error::Error;
use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};

use crate::simulation::{
    development_required_substeps, exposure_diffusion_courant, exposure_required_substeps,
    FIXED_TIMESTEP_MODEL_TIME, MAX_INTERNAL_SUBSTEPS_PER_UPDATE,
};

pub(crate) const MAX_EXPOSURE_STEPS_TOTAL: u32 = 10_000_000;
const MAX_EXPLICIT_DIFFUSION_COURANT: f64 = 0.5;

/// Small, JSON-like configuration passed once while constructing the Wasm core.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationConfig {
    /// Current worker-computed number of fixed exposure steps.
    pub exposure_steps_total: u32,
    /// Optical, resin, reaction, and development parameters.
    pub parameters: Parameters,
}

impl SimulationConfig {
    /// Validate the fixed schedule and all numerical parameters.
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.exposure_steps_total == 0 {
            return Err(ValidationError::new(
                "exposureStepsTotal must be at least one",
            ));
        }
        if self.exposure_steps_total > MAX_EXPOSURE_STEPS_TOTAL {
            return Err(ValidationError::new(format!(
                "exposureStepsTotal must not exceed {MAX_EXPOSURE_STEPS_TOTAL}"
            )));
        }
        self.parameters.validate()
    }
}

/// Adjustable parameters used by the existing TypeScript Reaction Lens.
///
/// Rates and diffusion coefficients are expressed in the model's current
/// nondimensional time and length units. Optical controls retain the UI units
/// documented by the application (mW, µm/s, MHz, fs, and nm).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameters {
    pub passes: f64,
    pub power: f64,
    pub speed: f64,
    pub repetition_rate: f64,
    pub pulse_duration: f64,
    pub wavelength: f64,
    pub na: f64,
    pub initiator: f64,
    pub oxygen: f64,
    pub pi_depletion: f64,
    pub radical_yield: f64,
    pub dark_loss: f64,
    pub oxygen_quench: f64,
    pub termination: f64,
    pub propagation: f64,
    pub oxygen_diffusion: f64,
    pub radical_diffusion: f64,
    pub pi_diffusion: f64,
    pub gel_point: f64,
    pub developer_rate: f64,
    pub developer_resistance: f64,
    pub development_time: f64,
}

impl Default for Parameters {
    fn default() -> Self {
        Self {
            passes: 1.0,
            power: 16.0,
            speed: 45.0,
            repetition_rate: 80.0,
            pulse_duration: 100.0,
            wavelength: 780.0,
            na: 1.4,
            initiator: 1.0,
            oxygen: 1.0,
            pi_depletion: 0.02,
            radical_yield: 1.0,
            dark_loss: 0.15,
            oxygen_quench: 8.0,
            termination: 2.0,
            propagation: 0.7,
            oxygen_diffusion: 0.0035,
            radical_diffusion: 0.00008,
            pi_diffusion: 0.00036,
            gel_point: 0.3,
            developer_rate: 1.5,
            developer_resistance: 9.0,
            development_time: 45.0,
        }
    }
}

impl Parameters {
    /// Reject values that cannot be evolved safely by the explicit solver.
    pub fn validate(&self) -> Result<(), ValidationError> {
        finite("passes", self.passes)?;
        if !(1.0..=3.0).contains(&self.passes) || self.passes.fract() != 0.0 {
            return Err(ValidationError::new(
                "passes must be a whole number between one and three",
            ));
        }
        nonnegative("power", self.power)?;
        positive("speed", self.speed)?;
        positive("repetitionRate", self.repetition_rate)?;
        positive("pulseDuration", self.pulse_duration)?;
        positive("wavelength", self.wavelength)?;
        positive("na", self.na)?;

        nonnegative_f32("initiator", self.initiator)?;
        nonnegative_f32("oxygen", self.oxygen)?;
        nonnegative("piDepletion", self.pi_depletion)?;
        nonnegative("radicalYield", self.radical_yield)?;
        nonnegative("darkLoss", self.dark_loss)?;
        nonnegative("oxygenQuench", self.oxygen_quench)?;
        nonnegative("termination", self.termination)?;
        nonnegative("propagation", self.propagation)?;
        nonnegative("oxygenDiffusion", self.oxygen_diffusion)?;
        nonnegative("radicalDiffusion", self.radical_diffusion)?;
        nonnegative("piDiffusion", self.pi_diffusion)?;
        nonnegative("developerRate", self.developer_rate)?;
        nonnegative("developerResistance", self.developer_resistance)?;
        nonnegative("developmentTime", self.development_time)?;

        finite("gelPoint", self.gel_point)?;
        if !(0.0..1.0).contains(&self.gel_point) {
            return Err(ValidationError::new(
                "gelPoint must be greater than or equal to zero and less than one",
            ));
        }

        for (name, diffusivity) in [
            ("oxygenDiffusion", self.oxygen_diffusion),
            ("radicalDiffusion", self.radical_diffusion),
            ("piDiffusion", self.pi_diffusion),
        ] {
            let courant = exposure_diffusion_courant(diffusivity);
            if !courant.is_finite() || courant > MAX_EXPLICIT_DIFFUSION_COURANT {
                return Err(ValidationError::new(format!(
                    "{name} is unstable for model timestep={FIXED_TIMESTEP_MODEL_TIME}: \
                     D*dt*(1/dx^2+1/dz^2)={courant}, maximum is \
                     {MAX_EXPLICIT_DIFFUSION_COURANT}"
                )));
            }
        }

        // These expressions bound every source and loss term reached by the
        // hard-bounded state (P <= initiator, O <= oxygen, R <= 8). Checking
        // them here prevents finite inputs from overflowing in combination.
        let waist = ((0.36 * self.wavelength) / 780.0 / self.na).max(0.2);
        let source_scale = 4.0
            * (self.power / 16.0).powi(2)
            * (80.0 / self.repetition_rate)
            * (100.0 / self.pulse_duration)
            * (45.0 / self.speed);
        let radical_source_bound = self.radical_yield * source_scale * self.initiator;
        let pi_sink_bound = self.pi_depletion * source_scale * self.initiator;
        let radical_loss_bound =
            (self.dark_loss + self.oxygen_quench * self.oxygen) * 8.0 + self.termination * 64.0;
        if !waist.is_finite()
            || !source_scale.is_finite()
            || !radical_source_bound.is_finite()
            || !pi_sink_bound.is_finite()
            || !radical_loss_bound.is_finite()
        {
            return Err(ValidationError::new(
                "combined optical and reaction parameters overflow the numerical model",
            ));
        }

        // Convert counts only after these finite upper-bound checks. This keeps
        // every logical worker update deterministic and prevents an extreme,
        // but individually finite, parameter combination from creating
        // effectively unbounded work.
        validate_internal_substeps(
            "illuminated exposure",
            exposure_required_substeps(self, 1.0),
        )?;
        validate_internal_substeps("dark exposure", exposure_required_substeps(self, 0.0))?;
        validate_internal_substeps("development", development_required_substeps(self))?;

        Ok(())
    }
}

fn validate_internal_substeps(label: &str, required: f64) -> Result<(), ValidationError> {
    if !required.is_finite() || required < 1.0 || required > MAX_INTERNAL_SUBSTEPS_PER_UPDATE as f64
    {
        return Err(ValidationError::new(format!(
            "{label} requires {required} internal substeps per update; maximum is \
             {MAX_INTERNAL_SUBSTEPS_PER_UPDATE}"
        )));
    }
    Ok(())
}

fn finite(name: &str, value: f64) -> Result<(), ValidationError> {
    if !value.is_finite() {
        return Err(ValidationError::new(format!("{name} must be finite")));
    }
    Ok(())
}

fn nonnegative(name: &str, value: f64) -> Result<(), ValidationError> {
    finite(name, value)?;
    if value < 0.0 {
        return Err(ValidationError::new(format!("{name} must not be negative")));
    }
    Ok(())
}

fn nonnegative_f32(name: &str, value: f64) -> Result<(), ValidationError> {
    nonnegative(name, value)?;
    if value > f32::MAX as f64 {
        return Err(ValidationError::new(format!(
            "{name} cannot be represented in the f32 state arrays"
        )));
    }
    Ok(())
}

fn positive(name: &str, value: f64) -> Result<(), ValidationError> {
    finite(name, value)?;
    if value <= 0.0 {
        return Err(ValidationError::new(format!(
            "{name} must be greater than zero"
        )));
    }
    Ok(())
}

/// A parameter or schedule value was rejected before it reached the solver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    message: String,
}

impl ValidationError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for ValidationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for ValidationError {}
