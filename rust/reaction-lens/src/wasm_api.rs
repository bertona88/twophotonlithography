use wasm_bindgen::prelude::*;

use crate::{
    Diagnostics, Parameters, Simulation, SimulationConfig, VolumeDiagnostics, WholeVolumeConfig,
    WholeVolumeCore,
};

/// JavaScript-facing owner of the authoritative numerical state.
#[wasm_bindgen]
pub struct ReactionLensSimulation {
    inner: Simulation,
}

#[wasm_bindgen]
impl ReactionLensSimulation {
    /// Construct from `{ exposureStepsTotal, parameters }` and an explicit seed.
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue, seed: u32) -> Result<ReactionLensSimulation, JsValue> {
        let config: SimulationConfig = serde_wasm_bindgen::from_value(config)
            .map_err(|error| js_error(format!("invalid simulation config: {error}")))?;
        let inner = Simulation::try_new(config, seed).map_err(validation_error)?;
        Ok(Self { inner })
    }

    /// Apply validated parameters without implicitly resetting the state.
    pub fn set_parameters(&mut self, parameters: JsValue) -> Result<(), JsValue> {
        let parameters: Parameters = serde_wasm_bindgen::from_value(parameters)
            .map_err(|error| js_error(format!("invalid parameters: {error}")))?;
        self.inner
            .set_parameters(parameters)
            .map_err(validation_error)
    }

    /// Apply the current worker-derived exposure schedule.
    pub fn set_exposure_steps_total(&mut self, exposure_steps_total: u32) -> Result<(), JsValue> {
        self.inner
            .set_exposure_steps_total(exposure_steps_total)
            .map_err(validation_error)
    }

    /// Reset all fields and logical progress with a deterministic seed.
    pub fn reset(&mut self, seed: u32) {
        self.inner.reset(seed);
    }

    /// Advance exact fixed exposure steps, returning the count actually run.
    pub fn advance_exposure_steps(&mut self, step_count: u32) -> u32 {
        self.inner.advance_exposure_steps(step_count)
    }

    /// Advance illuminated fixed steps at a stationary trajectory progress.
    pub fn advance_exposure_at_progress_steps(
        &mut self,
        step_count: u32,
        progress: f64,
    ) -> Result<u32, JsValue> {
        self.inner
            .advance_exposure_at_progress_steps(step_count, progress)
            .map_err(validation_error)
    }

    /// Continue diffusion and chemistry with no optical source.
    pub fn advance_dark_steps(&mut self, step_count: u32, progress: f64) -> Result<u32, JsValue> {
        self.inner
            .advance_dark_steps(step_count, progress)
            .map_err(validation_error)
    }

    /// Advance logical development steps, returning the count actually run.
    pub fn advance_development_steps(&mut self, step_count: u32) -> u32 {
        self.inner.advance_development_steps(step_count)
    }

    /// Refresh the packed snapshot and return its stable byte offset in Wasm memory.
    ///
    /// The worker must reacquire `wasm.memory.buffer`, create a `Float32Array`
    /// view of `snapshot_len()` elements, and copy that view before transferring
    /// an `ArrayBuffer` to the main thread.
    pub fn get_snapshot(&mut self) -> u32 {
        self.inner.snapshot().as_ptr() as u32
    }

    /// Packed snapshot length in f32 elements (not bytes).
    pub fn snapshot_len(&self) -> u32 {
        self.inner.snapshot_len() as u32
    }

    /// Return a small object with solver identity, schedule, time, checksum, and memory.
    pub fn get_diagnostics(&self) -> Result<JsValue, JsValue> {
        let diagnostics: Diagnostics = self.inner.diagnostics();
        serde_wasm_bindgen::to_value(&diagnostics)
            .map_err(|error| js_error(format!("could not serialize diagnostics: {error}")))
    }
}

/// Factory equivalent to `new ReactionLensSimulation(config, seed)`.
#[wasm_bindgen]
pub fn create_simulation(config: JsValue, seed: u32) -> Result<ReactionLensSimulation, JsValue> {
    ReactionLensSimulation::new(config, seed)
}

/// JavaScript-facing owner of the adaptive dense 3D resin volume.
#[wasm_bindgen]
pub struct WholeVolumeSimulation {
    inner: WholeVolumeCore,
}

#[wasm_bindgen]
impl WholeVolumeSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue, occupancy: &[u8]) -> Result<WholeVolumeSimulation, JsValue> {
        let config: WholeVolumeConfig = serde_wasm_bindgen::from_value(config)
            .map_err(|error| js_error(format!("invalid whole-volume config: {error}")))?;
        let inner = WholeVolumeCore::try_new(config, occupancy).map_err(validation_error)?;
        Ok(Self { inner })
    }

    pub fn set_parameters(&mut self, parameters: JsValue) -> Result<(), JsValue> {
        let parameters: Parameters = serde_wasm_bindgen::from_value(parameters)
            .map_err(|error| js_error(format!("invalid parameters: {error}")))?;
        self.inner
            .set_parameters(parameters)
            .map_err(validation_error)
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }

    pub fn advance_exposure_steps(&mut self, step_count: u32) -> u32 {
        self.inner.advance_exposure_steps(step_count)
    }

    pub fn advance_development_steps(&mut self, step_count: u32) -> u32 {
        self.inner.advance_development_steps(step_count)
    }

    pub fn get_snapshot(&mut self) -> u32 {
        self.inner.snapshot().as_ptr() as u32
    }

    pub fn snapshot_len(&self) -> u32 {
        self.inner.snapshot_len() as u32
    }

    /// Packed illuminated line segments in XYZXYZ order (f32 elements).
    pub fn get_scan_path(&self) -> u32 {
        self.inner.scan_path_segments().as_ptr() as u32
    }

    pub fn scan_path_len(&self) -> u32 {
        self.inner.scan_path_segments().len() as u32
    }

    /// Physical Z coordinate of every emitted scan layer (f32 elements).
    pub fn get_layer_positions(&self) -> u32 {
        self.inner.layer_positions().as_ptr() as u32
    }

    pub fn layer_positions_len(&self) -> u32 {
        self.inner.layer_positions().len() as u32
    }

    pub fn focus(&self) -> Vec<f32> {
        self.inner.focus().to_vec()
    }

    pub fn exposure_progress(&self) -> f64 {
        self.inner.exposure_progress()
    }

    pub fn development_progress(&self) -> f64 {
        self.inner.development_progress()
    }

    pub fn get_diagnostics(&self) -> Result<JsValue, JsValue> {
        let diagnostics: VolumeDiagnostics = self.inner.diagnostics();
        serde_wasm_bindgen::to_value(&diagnostics)
            .map_err(|error| js_error(format!("could not serialize volume diagnostics: {error}")))
    }
}

fn validation_error(error: impl std::fmt::Display) -> JsValue {
    js_error(error.to_string())
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    js_sys_error(message.as_ref())
}

// `js_sys::Error` would add an otherwise unnecessary direct dependency. A
// thrown string still reaches the worker as a clear initialization/config error.
fn js_sys_error(message: &str) -> JsValue {
    JsValue::from_str(message)
}
