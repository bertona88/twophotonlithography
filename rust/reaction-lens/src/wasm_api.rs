use wasm_bindgen::prelude::*;

use crate::{
    preview_vectorial_psf, Parameters, VolumeDiagnostics, WholeVolumeConfig, WholeVolumeCore,
};

/// Compute a renderable PSF envelope from the same adaptive Debye kernel used
/// by the 3D simulation, without constructing or mutating simulation state.
#[wasm_bindgen]
pub fn preview_volume_psf(
    na: f64,
    wavelength_nm: f64,
    memory_budget_bytes: usize,
) -> Result<JsValue, JsValue> {
    let preview =
        preview_vectorial_psf(na, wavelength_nm, memory_budget_bytes).map_err(validation_error)?;
    serde_wasm_bindgen::to_value(&preview)
        .map_err(|error| js_error(format!("could not serialize PSF preview: {error}")))
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

    pub fn prepare_dry_specimen(
        &self,
        policy: JsValue,
    ) -> Result<DevelopedSpecimenHandle, JsValue> {
        let policy = serde_wasm_bindgen::from_value(policy).map_err(validation_error)?;
        let inner = self
            .inner
            .prepare_dry_specimen(policy)
            .map_err(validation_error)?;
        Ok(DevelopedSpecimenHandle { inner })
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

    /// Packed oxygen, radicals, conversion, remaining mass, and occupancy for
    /// the authoritative XY grid plane nearest the requested physical Z.
    pub fn get_xy_slice(&mut self, z_um: f64) -> u32 {
        self.inner.xy_slice_snapshot(z_um).as_ptr() as u32
    }

    pub fn xy_slice_len(&self) -> u32 {
        self.inner.xy_slice_len() as u32
    }

    pub fn xy_slice_width(&self) -> u32 {
        self.inner.xy_slice_width() as u32
    }

    pub fn xy_slice_height(&self) -> u32 {
        self.inner.xy_slice_height() as u32
    }

    pub fn xy_slice_z_um(&self) -> f32 {
        self.inner.xy_slice_z_um()
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

    pub fn get_diagnostics(&mut self) -> Result<JsValue, JsValue> {
        let diagnostics: VolumeDiagnostics = self.inner.diagnostics();
        serde_wasm_bindgen::to_value(&diagnostics)
            .map_err(|error| js_error(format!("could not serialize volume diagnostics: {error}")))
    }

    pub fn get_cached_diagnostics(&self) -> Result<JsValue, JsValue> {
        let diagnostics: VolumeDiagnostics = self.inner.cached_diagnostics();
        serde_wasm_bindgen::to_value(&diagnostics)
            .map_err(|error| js_error(format!("could not serialize volume diagnostics: {error}")))
    }
}

/// Owns full-resolution Rust state independently of subsequent exposure/reset.
#[wasm_bindgen]
pub struct DevelopedSpecimenHandle {
    inner: crate::pyrolysis::specimen::DevelopedSpecimen,
}

#[wasm_bindgen]
impl DevelopedSpecimenHandle {
    pub fn get_ledger(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.ledger).map_err(validation_error)
    }
    pub fn export_checkpoint(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner).map_err(validation_error)
    }
}

#[wasm_bindgen]
pub fn pyrolysis_defaults() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&crate::pyrolysis::RadialConfig::default())
        .map_err(validation_error)
}

#[wasm_bindgen]
pub struct PyrolysisSimulation {
    inner: crate::pyrolysis::PyrolysisCore,
}

#[wasm_bindgen]
impl PyrolysisSimulation {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<PyrolysisSimulation, JsValue> {
        let config = serde_wasm_bindgen::from_value(config).map_err(validation_error)?;
        Ok(Self {
            inner: crate::pyrolysis::PyrolysisCore::new(config).map_err(validation_error)?,
        })
    }
    pub fn restore(checkpoint: JsValue) -> Result<PyrolysisSimulation, JsValue> {
        let checkpoint = serde_wasm_bindgen::from_value(checkpoint).map_err(validation_error)?;
        Ok(Self {
            inner: crate::pyrolysis::PyrolysisCore::from_checkpoint(checkpoint)
                .map_err(validation_error)?,
        })
    }
    pub fn advance(&mut self) -> bool {
        self.inner.advance()
    }
    pub fn get_snapshot(&mut self) -> u32 {
        self.inner.snapshot().as_ptr() as u32
    }
    pub fn snapshot_len(&self) -> u32 {
        self.inner.snapshot_len() as u32
    }
    pub fn get_diagnostics(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.diagnostics()).map_err(validation_error)
    }
    pub fn export_checkpoint(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.checkpoint()).map_err(validation_error)
    }
}

fn validation_error(error: impl std::fmt::Display) -> JsValue {
    js_error(error.to_string())
}

#[wasm_bindgen]
pub fn bcc_defaults() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&crate::bcc::BccConfig::default()).map_err(validation_error)
}

#[wasm_bindgen]
pub struct BccSimulation {
    inner: crate::bcc::BccCore,
}

#[wasm_bindgen]
impl BccSimulation {
    pub fn accepted_steps(&self) -> u32 {
        self.inner.accepted_steps()
    }
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<BccSimulation, JsValue> {
        let config = serde_wasm_bindgen::from_value(config).map_err(validation_error)?;
        Ok(Self {
            inner: crate::bcc::BccCore::new(config).map_err(validation_error)?,
        })
    }
    pub fn restore(checkpoint: JsValue) -> Result<BccSimulation, JsValue> {
        let checkpoint = serde_wasm_bindgen::from_value(checkpoint).map_err(validation_error)?;
        Ok(Self {
            inner: crate::bcc::BccCore::from_checkpoint(checkpoint).map_err(validation_error)?,
        })
    }
    pub fn advance(&mut self) -> bool {
        self.inner.advance()
    }
    pub fn get_snapshot(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.snapshot()).map_err(validation_error)
    }
    pub fn get_diagnostics(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.diagnostics()).map_err(validation_error)
    }
    pub fn export_checkpoint(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.checkpoint()).map_err(validation_error)
    }
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    js_sys_error(message.as_ref())
}

// `js_sys::Error` would add an otherwise unnecessary direct dependency. A
// thrown string still reaches the worker as a clear initialization/config error.
fn js_sys_error(message: &str) -> JsValue {
    JsValue::from_str(message)
}
