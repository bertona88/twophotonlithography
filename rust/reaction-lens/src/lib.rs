//! Authoritative Reaction Lens solver.
//!
//! The numerical core is platform-neutral and covered by native Rust tests.
//! `wasm_api` only adapts small configuration objects and exposes a stable
//! pointer to a separately packed render snapshot. The render snapshot never
//! aliases the authoritative state arrays.

mod parameters;
mod simulation;

pub use parameters::{Parameters, SimulationConfig, ValidationError};
pub use simulation::{
    Diagnostics, Simulation, DEVELOPMENT_STEPS_TOTAL, FIXED_TIMESTEP_MODEL_TIME, GRID_HEIGHT,
    GRID_LEN, GRID_WIDTH, LENS_HEIGHT_UM, LENS_WIDTH_UM, SNAPSHOT_FIELD_COUNT,
    SNAPSHOT_FIELD_ORDER,
};

#[cfg(target_arch = "wasm32")]
mod wasm_api;

#[cfg(target_arch = "wasm32")]
pub use wasm_api::{create_simulation, ReactionLensSimulation};
