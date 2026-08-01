//! Rust numerical models for the Two-Photon Lithography Lab.
//!
//! The adaptive 3D volume is the only model exported through `wasm_api`.
//! The older 2D core remains platform-neutral for native parity tests only.
//! Wasm render and XY-slice snapshots never alias authoritative state arrays.

mod parameters;
mod simulation;
mod whole_volume;

pub use parameters::{Parameters, SimulationConfig, ValidationError};
pub use simulation::{
    Diagnostics, Simulation, DEVELOPMENT_STEPS_TOTAL, FIXED_TIMESTEP_MODEL_TIME, GRID_HEIGHT,
    GRID_LEN, GRID_WIDTH, LENS_HEIGHT_UM, LENS_WIDTH_UM, SNAPSHOT_FIELD_COUNT,
    SNAPSHOT_FIELD_ORDER,
};
pub use whole_volume::{
    preview_vectorial_psf, PsfPreview, VolumeDiagnostics, WholeVolumeConfig,
    WholeVolumeSimulation as WholeVolumeCore,
};

#[cfg(target_arch = "wasm32")]
mod wasm_api;

#[cfg(target_arch = "wasm32")]
pub use wasm_api::{preview_volume_psf, WholeVolumeSimulation};
