use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};

use crate::parameters::{photoinitiator_absorption_factor, MIN_NUMERICAL_APERTURE};
use crate::{Parameters, ValidationError};

const BASE_DIMS: [usize; 3] = [128, 72, 104];
const BASE_ORIGIN_UM: [f64; 3] = [-11.357_723_577, -6.023_313_349, -0.175_549_622];
const BASE_PITCH_UM: [f64; 3] = [0.178_861_789, 0.169_670_799, 0.177_774_811];
const REFRACTIVE_INDEX: f64 = 1.52;
const MAX_RENDER_VOXELS: usize = 60_000;
const TARGET_RENDER_VOXELS: usize = 45_000;
const RENDER_HALO_PASSES: usize = 4;
const TWO_PI: f64 = std::f64::consts::PI * 2.0;
const REFERENCE_NA: f64 = 1.4;
const REFERENCE_WAVELENGTH_NM: f64 = 780.0;
const PSF_RELATIVE_CUTOFF: f64 = 0.0005;
const PSF_SUBVOXEL_RELATIVE_CUTOFF: f64 = 0.01;
const TWO_PHOTON_DOSE_RATE: f64 = 2_200.0;
const MAX_RADICAL_ACTIVITY: f64 = 8.0;
const DIFFUSION_COURANT_SAFETY: f64 = 0.45;
const MIN_VOLUME_MEMORY_BUDGET_BYTES: usize = 8 * 1024 * 1024;
const MAX_VOLUME_DIFFUSION_SUBSTEPS_PER_BUCKET: usize = 1_024;
const XY_SLICE_FIELD_COUNT: usize = 5;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeVolumeConfig {
    pub parameters: Parameters,
    pub memory_budget_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsfPreview {
    pub model: &'static str,
    pub quality_tier: &'static str,
    pub pupil_samples: usize,
    pub kernel_voxels: usize,
    pub na: f64,
    pub wavelength_nm: f64,
    pub cone_half_angle_rad: f64,
    /// Half-widths of the normalized two-photon PSF at 50% peak intensity.
    pub fwhm_radii_um: [f64; 3],
    /// Half-widths of the normalized two-photon PSF at 10% peak intensity.
    pub tenth_max_radii_um: [f64; 3],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDiagnostics {
    pub solver: &'static str,
    pub quality_tier: &'static str,
    pub grid_width: usize,
    pub grid_height: usize,
    pub grid_depth: usize,
    pub voxel_pitch_um: [f64; 3],
    pub memory_budget_bytes: usize,
    pub owned_memory_bytes: usize,
    pub downgrade_reason: Option<&'static str>,
    pub psf_model: &'static str,
    pub psf_pupil_samples: usize,
    pub psf_kernel_voxels: usize,
    pub psf_preview: PsfPreview,
    pub scan_points: usize,
    pub layer_count: usize,
    pub path_length_um: f64,
    pub estimated_exposure_seconds: f64,
    pub exposure_step: u32,
    pub exposure_steps_total: u32,
    pub development_step: u32,
    pub development_steps_total: u32,
    pub simulated_time_seconds: f64,
    pub oxygen_mean: f64,
    pub radical_max: f64,
    pub conversion_mean: f64,
    pub gelled_fraction: f64,
    pub surviving_fraction: f64,
    pub target_voxels: usize,
    pub render_voxels: usize,
    pub off_target_active_voxels: usize,
    pub off_target_conversion_mean: f64,
    pub off_target_gelled_fraction: f64,
    pub off_target_surviving_fraction: f64,
    pub checksum: String,
}

#[derive(Clone, Copy)]
struct Tier {
    name: &'static str,
    dims: [usize; 3],
    theta_samples: usize,
    phi_samples: usize,
    memory_floor: usize,
}

const TIERS: [Tier; 4] = [
    Tier {
        name: "full",
        dims: [128, 72, 104],
        theta_samples: 14,
        phi_samples: 24,
        memory_floor: 64 * 1024 * 1024,
    },
    Tier {
        name: "balanced",
        dims: [96, 54, 78],
        theta_samples: 10,
        phi_samples: 16,
        memory_floor: 32 * 1024 * 1024,
    },
    Tier {
        name: "economy",
        dims: [64, 36, 52],
        theta_samples: 8,
        phi_samples: 12,
        memory_floor: 12 * 1024 * 1024,
    },
    Tier {
        name: "minimal",
        dims: [48, 27, 39],
        theta_samples: 6,
        phi_samples: 8,
        memory_floor: 0,
    },
];

#[derive(Clone, Copy, Default)]
struct Complex {
    re: f64,
    im: f64,
}

impl Complex {
    fn add_phase(&mut self, amplitude_re: f64, amplitude_im: f64, phase: f64) {
        let (sin, cos) = phase.sin_cos();
        self.re += amplitude_re * cos - amplitude_im * sin;
        self.im += amplitude_re * sin + amplitude_im * cos;
    }

    fn norm_squared(self) -> f64 {
        self.re * self.re + self.im * self.im
    }
}

#[derive(Clone)]
struct KernelVoxel {
    dx: isize,
    dy: isize,
    dz: isize,
    weight: f32,
}

#[derive(Clone, Copy)]
struct DebyeOptics {
    theta_max: f64,
    wave_number: f64,
    field_scale: f64,
    tier: Tier,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScanPoint {
    index: u32,
    starts_segment: bool,
}

#[derive(Clone, Copy)]
struct ScanPointTiming {
    focus: [f32; 3],
    previous_index: u32,
    illuminated_seconds: f64,
    jump_seconds: f64,
}

#[derive(Clone)]
struct DynamicDiagnostics {
    oxygen_mean: f64,
    radical_max: f64,
    conversion_mean: f64,
    gelled_fraction: f64,
    surviving_fraction: f64,
    off_target_active_voxels: usize,
    off_target_conversion_mean: f64,
    off_target_gelled_fraction: f64,
    off_target_surviving_fraction: f64,
    checksum: String,
}

impl Default for DynamicDiagnostics {
    fn default() -> Self {
        Self {
            oxygen_mean: 1.0,
            radical_max: 0.0,
            conversion_mean: 0.0,
            gelled_fraction: 0.0,
            surviving_fraction: 1.0,
            off_target_active_voxels: 0,
            off_target_conversion_mean: 0.0,
            off_target_gelled_fraction: 0.0,
            off_target_surviving_fraction: 0.0,
            checksum: String::new(),
        }
    }
}

struct ScanSchedule {
    path: Vec<ScanPoint>,
    layer_positions: Vec<f32>,
}

pub struct WholeVolumeSimulation {
    parameters: Parameters,
    tier: Tier,
    dims: [usize; 3],
    origin_um: [f64; 3],
    pitch_um: [f64; 3],
    memory_budget_bytes: usize,
    occupancy: Vec<u8>,
    occupied_indices: Vec<u32>,
    photoinitiator: Vec<f32>,
    oxygen: Vec<f32>,
    radicals: Vec<f32>,
    conversion: Vec<f32>,
    remaining: Vec<f32>,
    developer_integral: Vec<f32>,
    developer_depth_um: Vec<f32>,
    scratch_photoinitiator: Vec<f32>,
    scratch_oxygen: Vec<f32>,
    scratch_radicals: Vec<f32>,
    active: Vec<u8>,
    active_indices: Vec<u32>,
    active_frontier: Vec<u32>,
    spare_frontier: Vec<u32>,
    scan_path: Vec<ScanPoint>,
    scan_timing: Vec<ScanPointTiming>,
    scan_path_segments: Vec<f32>,
    layer_positions: Vec<f32>,
    render_indices: Vec<usize>,
    render_snapshot: Vec<f32>,
    xy_slice_snapshot: Vec<f32>,
    xy_slice_z_um: f32,
    psf_kernel: Vec<KernelVoxel>,
    psf_preview: PsfPreview,
    exposure_step: u32,
    exposure_steps_total: u32,
    development_step: u32,
    development_steps_total: u32,
    simulated_time_seconds: f64,
    inactive_initiator_baseline: f32,
    inactive_oxygen_baseline: f32,
    previous_focus: Option<usize>,
    focus: [f32; 3],
    cached_path_length_um: f64,
    cached_estimated_exposure_seconds: f64,
    cached_dynamic_diagnostics: DynamicDiagnostics,
}

impl WholeVolumeSimulation {
    pub fn try_new(
        config: WholeVolumeConfig,
        base_occupancy: &[u8],
    ) -> Result<Self, ValidationError> {
        config.parameters.validate()?;
        if config.memory_budget_bytes < MIN_VOLUME_MEMORY_BUDGET_BYTES {
            return Err(ValidationError::new(format!(
                "memoryBudgetBytes must be at least {MIN_VOLUME_MEMORY_BUDGET_BYTES}"
            )));
        }
        let expected = BASE_DIMS[0] * BASE_DIMS[1] * BASE_DIMS[2];
        if base_occupancy.len() != expected {
            return Err(ValidationError::new(format!(
                "3DBenchy occupancy has {} bytes; expected {expected}",
                base_occupancy.len()
            )));
        }
        let tier = select_tier(config.memory_budget_bytes);
        let dims = tier.dims;
        let len = dims[0] * dims[1] * dims[2];
        let pitch_um = tier_pitch(tier);
        let occupancy = resample_occupancy(base_occupancy, dims);
        let parameters = config.parameters;
        let scan_schedule =
            build_scan_path(&occupancy, dims, &parameters, pitch_um, BASE_ORIGIN_UM);
        validate_volume_work(&scan_schedule.path, dims, pitch_um, &parameters)?;
        let occupied_indices: Vec<u32> = occupancy
            .iter()
            .enumerate()
            .filter_map(|(index, occupied)| (*occupied != 0).then_some(index as u32))
            .collect();
        let occupied_render_indices: Vec<usize> = occupied_indices
            .iter()
            .map(|index| *index as usize)
            .collect();
        let render_indices = build_render_indices(
            &occupancy,
            &occupied_render_indices,
            dims,
            MAX_RENDER_VOXELS,
        );
        let developer_depth_um =
            target_developer_depths(&occupancy, &occupied_render_indices, dims, pitch_um);
        let scan_path_segments =
            build_scan_path_segments(&scan_schedule.path, dims, BASE_ORIGIN_UM, pitch_um);
        let scan_timing = build_scan_timing(
            &scan_schedule.path,
            dims,
            BASE_ORIGIN_UM,
            pitch_um,
            &parameters,
        );
        let cached_path_length_um = packed_segment_length(&scan_path_segments);
        let cached_estimated_exposure_seconds =
            estimated_exposure_seconds(&scan_schedule.path, dims, pitch_um, &parameters);
        let psf_kernel = build_vectorial_psf(parameters.na, parameters.wavelength, tier, pitch_um);
        let psf_preview = summarize_psf(
            &psf_kernel,
            parameters.na,
            parameters.wavelength,
            tier,
            pitch_um,
        );
        let mut simulation = Self {
            photoinitiator: vec![parameters.initiator as f32; len],
            oxygen: vec![parameters.oxygen as f32; len],
            radicals: vec![0.0; len],
            conversion: vec![0.0; len],
            remaining: vec![1.0; len],
            developer_integral: vec![0.0; len],
            developer_depth_um,
            scratch_photoinitiator: vec![0.0; len],
            scratch_oxygen: vec![0.0; len],
            scratch_radicals: vec![0.0; len],
            active: vec![0; len],
            active_indices: Vec::with_capacity((len / 8).max(1024)),
            active_frontier: Vec::with_capacity((len / 64).max(256)),
            spare_frontier: Vec::with_capacity((len / 64).max(256)),
            render_snapshot: vec![0.0; render_indices.len() * 7],
            xy_slice_snapshot: vec![0.0; dims[0] * dims[1] * XY_SLICE_FIELD_COUNT],
            xy_slice_z_um: BASE_ORIGIN_UM[2] as f32,
            psf_kernel,
            psf_preview,
            exposure_step: 0,
            exposure_steps_total: schedule_steps(scan_schedule.path.len(), parameters.passes),
            development_step: 0,
            development_steps_total: 180,
            simulated_time_seconds: 0.0,
            inactive_initiator_baseline: parameters.initiator as f32,
            inactive_oxygen_baseline: parameters.oxygen as f32,
            previous_focus: None,
            focus: [0.0, 0.0, 7.0],
            parameters,
            tier,
            dims,
            origin_um: BASE_ORIGIN_UM,
            pitch_um,
            memory_budget_bytes: config.memory_budget_bytes,
            occupancy,
            occupied_indices,
            scan_path: scan_schedule.path,
            scan_timing,
            scan_path_segments,
            layer_positions: scan_schedule.layer_positions,
            render_indices,
            cached_path_length_um,
            cached_estimated_exposure_seconds,
            cached_dynamic_diagnostics: DynamicDiagnostics::default(),
        };
        simulation.refresh_dynamic_diagnostics();
        Ok(simulation)
    }

    pub fn set_parameters(&mut self, parameters: Parameters) -> Result<(), ValidationError> {
        parameters.validate()?;
        let optics_changed = parameters.na != self.parameters.na
            || parameters.wavelength != self.parameters.wavelength;
        let slicing_changed = parameters.layer_height != self.parameters.layer_height
            || parameters.hatch_spacing != self.parameters.hatch_spacing
            || parameters.hatch_angle != self.parameters.hatch_angle
            || parameters.contour_count != self.parameters.contour_count;
        let candidate_schedule = slicing_changed.then(|| {
            build_scan_path(
                &self.occupancy,
                self.dims,
                &parameters,
                self.pitch_um,
                self.origin_um,
            )
        });
        let candidate_path = candidate_schedule
            .as_ref()
            .map(|schedule| schedule.path.as_slice())
            .unwrap_or(&self.scan_path);
        validate_volume_work(candidate_path, self.dims, self.pitch_um, &parameters)?;
        let initiator_limit = parameters.initiator as f32;
        let oxygen_limit = parameters.oxygen as f32;
        self.inactive_initiator_baseline = self.inactive_initiator_baseline.min(initiator_limit);
        self.inactive_oxygen_baseline = self.inactive_oxygen_baseline.min(oxygen_limit);
        for value in &mut self.photoinitiator {
            *value = value.min(initiator_limit);
        }
        for value in &mut self.oxygen {
            *value = value.min(oxygen_limit);
        }
        self.parameters = parameters;
        if let Some(schedule) = candidate_schedule {
            self.scan_path_segments =
                build_scan_path_segments(&schedule.path, self.dims, self.origin_um, self.pitch_um);
            self.scan_path = schedule.path;
            self.layer_positions = schedule.layer_positions;
        }
        self.exposure_steps_total = schedule_steps(self.scan_path.len(), self.parameters.passes);
        self.scan_timing = build_scan_timing(
            &self.scan_path,
            self.dims,
            self.origin_um,
            self.pitch_um,
            &self.parameters,
        );
        self.cached_path_length_um = packed_segment_length(&self.scan_path_segments);
        self.cached_estimated_exposure_seconds =
            estimated_exposure_seconds(&self.scan_path, self.dims, self.pitch_um, &self.parameters);
        if optics_changed {
            self.rebuild_psf();
        }
        self.refresh_dynamic_diagnostics();
        Ok(())
    }

    pub fn reset(&mut self) {
        self.photoinitiator.fill(self.parameters.initiator as f32);
        self.oxygen.fill(self.parameters.oxygen as f32);
        self.radicals.fill(0.0);
        self.conversion.fill(0.0);
        self.remaining.fill(1.0);
        self.developer_integral.fill(0.0);
        self.scratch_photoinitiator.fill(0.0);
        self.scratch_oxygen.fill(0.0);
        self.scratch_radicals.fill(0.0);
        self.active.fill(0);
        self.active_indices.clear();
        self.active_frontier.clear();
        self.spare_frontier.clear();
        self.exposure_step = 0;
        self.development_step = 0;
        self.simulated_time_seconds = 0.0;
        self.inactive_initiator_baseline = self.parameters.initiator as f32;
        self.inactive_oxygen_baseline = self.parameters.oxygen as f32;
        self.previous_focus = None;
        self.focus = [0.0, 0.0, 7.0];
        self.refresh_dynamic_diagnostics();
    }

    pub fn advance_exposure_steps(&mut self, requested: u32) -> u32 {
        let count = requested.min(self.exposure_steps_total.saturating_sub(self.exposure_step));
        for _ in 0..count {
            self.advance_one_exposure();
            self.exposure_step += 1;
        }
        count
    }

    fn advance_one_exposure(&mut self) {
        if self.scan_path.is_empty() {
            return;
        }
        let passes = self.parameters.passes.max(1.0) as usize;
        let total_targets = self.scan_path.len() * passes;
        let (start, end) =
            exposure_bucket(self.exposure_step, self.exposure_steps_total, total_targets);
        let mut elapsed = 0.0;

        // A UI step is a scheduling bucket, not one oversized focal event.
        // Visit every scan target in the bucket so thin walls, roofs, and the
        // chimney cannot disappear from the simulated exposure.
        for target in start..end {
            let path_index = target % self.scan_path.len();
            let scan_point = self.scan_path[path_index];
            let timing = self.scan_timing[path_index];
            let focus_index = scan_point.index as usize;
            if let Some(previous) = self.previous_focus {
                if scan_point.starts_segment {
                    elapsed += if previous == timing.previous_index as usize {
                        timing.jump_seconds
                    } else {
                        index_distance(previous, focus_index, self.dims, self.pitch_um)
                            / (self.parameters.speed * 8.0).max(200.0)
                    };
                }
            }
            let illuminated_dt = timing.illuminated_seconds;
            self.deposit_psf(focus_index, illuminated_dt);
            elapsed += illuminated_dt;
            self.previous_focus = Some(focus_index);
            self.focus = timing.focus;
        }
        self.evolve_active_dark(elapsed);
        self.simulated_time_seconds += elapsed;
    }

    fn deposit_psf(&mut self, focus_index: usize, dt: f64) {
        let [fx, fy, fz] = index_to_ijk(focus_index, self.dims);
        let pulse_factor = (self.parameters.power / 16.0).powi(2)
            * (80.0 / self.parameters.repetition_rate)
            * (100.0 / self.parameters.pulse_duration)
            * photoinitiator_absorption_factor(
                self.parameters.wavelength,
                self.parameters.pi_absorption_peak,
            );
        let dose_scale = (pulse_factor * dt * TWO_PHOTON_DOSE_RATE).clamp(0.0, f32::MAX as f64);
        for kernel_index in 0..self.psf_kernel.len() {
            let kernel = &self.psf_kernel[kernel_index];
            let (dx, dy, dz, weight) = (kernel.dx, kernel.dy, kernel.dz, kernel.weight as f64);
            let x = fx as isize + dx;
            let y = fy as isize + dy;
            let z = fz as isize + dz;
            if x < 0
                || y < 0
                || z < 0
                || x >= self.dims[0] as isize
                || y >= self.dims[1] as isize
                || z >= self.dims[2] as isize
            {
                continue;
            }
            let index = flatten(x as usize, y as usize, z as usize, self.dims);
            self.activate_with_halo(index);
            let integrated_source = dose_scale * weight;
            let initiator = self.photoinitiator[index] as f64;
            let depletion = (-self.parameters.pi_depletion * integrated_source * 0.018).exp();
            self.photoinitiator[index] =
                (initiator * depletion).clamp(0.0, self.parameters.initiator) as f32;
            let oxygen_inhibition = 1.0 / (1.0 + 4.0 * self.oxygen[index] as f64);
            let generated = self.parameters.radical_yield
                * integrated_source
                * initiator
                * oxygen_inhibition
                * 2.8;
            self.radicals[index] =
                (self.radicals[index] as f64 + generated).clamp(0.0, MAX_RADICAL_ACTIVITY) as f32;
        }
    }

    fn activate_with_halo(&mut self, index: usize) {
        let [x, y, z] = index_to_ijk(index, self.dims);
        let width = self.dims[0];
        let height = self.dims[1];
        let depth = self.dims[2];
        self.activate_index(index);
        if x > 0 {
            self.activate_index(index - 1);
        }
        if x + 1 < width {
            self.activate_index(index + 1);
        }
        if y > 0 {
            self.activate_index(index - width);
        }
        if y + 1 < height {
            self.activate_index(index + width);
        }
        let plane = width * height;
        if z > 0 {
            self.activate_index(index - plane);
        }
        if z + 1 < depth {
            self.activate_index(index + plane);
        }
    }

    fn activate_index(&mut self, index: usize) {
        if self.active[index] == 0 {
            self.active[index] = 1;
            self.active_indices.push(index as u32);
            self.active_frontier.push(index as u32);
            self.scratch_photoinitiator[index] = self.photoinitiator[index];
            self.scratch_oxygen[index] = self.oxygen[index];
            self.scratch_radicals[index] = self.radicals[index];
        }
    }

    fn expand_active_frontier(&mut self) {
        self.spare_frontier.clear();
        std::mem::swap(&mut self.active_frontier, &mut self.spare_frontier);
        for position in 0..self.spare_frontier.len() {
            let index = self.spare_frontier[position] as usize;
            let neighbors = neighbor_indices(index, self.dims);
            let has_inactive_neighbor =
                neighbors.iter().any(|neighbor| self.active[*neighbor] == 0);
            if !has_inactive_neighbor {
                continue;
            }
            let pi_flux = self.parameters.pi_diffusion > 0.0
                && neighbors
                    .iter()
                    .any(|neighbor| self.photoinitiator[*neighbor] != self.photoinitiator[index]);
            let oxygen_flux = self.parameters.oxygen_diffusion > 0.0
                && neighbors
                    .iter()
                    .any(|neighbor| self.oxygen[*neighbor] != self.oxygen[index]);
            let radical_flux = self.parameters.radical_diffusion > 0.0
                && neighbors
                    .iter()
                    .any(|neighbor| self.radicals[*neighbor] != self.radicals[index]);
            if pi_flux || oxygen_flux || radical_flux {
                self.activate_with_halo(index);
            } else {
                // This boundary may receive flux from its active neighbor in
                // the upcoming substep. Keep it live until that happens.
                self.active_frontier.push(index as u32);
            }
        }
    }

    fn evolve_active_dark(&mut self, dt: f64) {
        if dt <= 0.0 {
            return;
        }
        let substeps = diffusion_substeps(dt, &self.parameters, self.pitch_um);
        let substep_dt = dt / substeps as f64;
        let inverse_pitch_squared = [
            1.0 / self.pitch_um[0].powi(2),
            1.0 / self.pitch_um[1].powi(2),
            1.0 / self.pitch_um[2].powi(2),
        ];
        let diffusion_enabled = self.parameters.oxygen_diffusion > 0.0
            || self.parameters.radical_diffusion > 0.0
            || self.parameters.pi_diffusion > 0.0;
        for _ in 0..substeps {
            // Advance the sparse halo with the CFL cadence. A cell reached by
            // one substep can therefore transfer into the next ring during the
            // same long scan bucket instead of waiting for another UI update.
            if diffusion_enabled {
                self.expand_active_frontier();
            }
            for position in 0..self.active_indices.len() {
                let index = self.active_indices[position] as usize;
                let neighbors = neighbor_indices(index, self.dims);
                let laplacian_pi = laplacian_with_neighbors(
                    &self.photoinitiator,
                    index,
                    neighbors,
                    inverse_pitch_squared,
                );
                let laplacian_oxygen =
                    laplacian_with_neighbors(&self.oxygen, index, neighbors, inverse_pitch_squared);
                let laplacian_radicals = laplacian_with_neighbors(
                    &self.radicals,
                    index,
                    neighbors,
                    inverse_pitch_squared,
                );
                self.scratch_photoinitiator[index] = (self.photoinitiator[index] as f64
                    + substep_dt * self.parameters.pi_diffusion * laplacian_pi)
                    .clamp(0.0, self.parameters.initiator)
                    as f32;
                self.scratch_oxygen[index] = (self.oxygen[index] as f64
                    + substep_dt * self.parameters.oxygen_diffusion * laplacian_oxygen)
                    .clamp(0.0, self.parameters.oxygen)
                    as f32;
                self.scratch_radicals[index] = (self.radicals[index] as f64
                    + substep_dt * self.parameters.radical_diffusion * laplacian_radicals)
                    .clamp(0.0, MAX_RADICAL_ACTIVITY)
                    as f32;
            }

            // Diffusion is double buffered. Reaction is then integrated with
            // bounded exponential/rational losses so dark loss, oxygen quench,
            // and bimolecular termination are each applied exactly once.
            for position in 0..self.active_indices.len() {
                let index = self.active_indices[position] as usize;
                let initiator = self.scratch_photoinitiator[index] as f64;
                let oxygen = self.scratch_oxygen[index] as f64;
                let radical = self.scratch_radicals[index] as f64;
                let oxygen_after =
                    oxygen * (-0.2 * self.parameters.oxygen_quench * radical * substep_dt).exp();
                let linear_survivor = radical
                    * (-(self.parameters.dark_loss + self.parameters.oxygen_quench * oxygen)
                        * substep_dt)
                        .exp();
                let radical_after = linear_survivor
                    / (1.0 + self.parameters.termination * linear_survivor * substep_dt);
                let conversion = self.conversion[index] as f64;
                let conversion_after = 1.0
                    - (1.0 - conversion)
                        * (-self.parameters.propagation * radical_after * substep_dt).exp();

                self.photoinitiator[index] = initiator as f32;
                self.oxygen[index] = oxygen_after.clamp(0.0, self.parameters.oxygen) as f32;
                self.radicals[index] = radical_after.clamp(0.0, MAX_RADICAL_ACTIVITY) as f32;
                self.conversion[index] = conversion_after.clamp(conversion, 1.0) as f32;
            }
        }
    }

    pub fn advance_development_steps(&mut self, requested: u32) -> u32 {
        let count = requested.min(
            self.development_steps_total
                .saturating_sub(self.development_step),
        );
        let dt = self.parameters.development_time / self.development_steps_total as f64;
        for _ in 0..count {
            if self.development_step == 0 {
                for index in 0..self.occupancy.len() {
                    if self.occupancy[index] == 0 && self.active[index] == 0 {
                        self.remaining[index] = 0.0;
                    }
                }
            }
            for position in 0..self.occupied_indices.len() {
                let index = self.occupied_indices[position] as usize;
                self.advance_developer_at(index, self.developer_depth_um[position] as f64, dt);
            }
            let bath_depth = 0.5 * self.pitch_um[0].min(self.pitch_um[1]).min(self.pitch_um[2]);
            for position in 0..self.active_indices.len() {
                let index = self.active_indices[position] as usize;
                if self.occupancy[index] == 0 {
                    self.advance_developer_at(index, bath_depth, dt);
                }
            }
            self.development_step += 1;
        }
        count
    }

    fn advance_developer_at(&mut self, index: usize, depth_um: f64, dt: f64) {
        let ingress_rate = 0.22 / (depth_um * depth_um + 0.04);
        self.developer_integral[index] += (ingress_rate * dt) as f32;
        let developer = 1.0 - (-(self.developer_integral[index] as f64)).exp();
        let gel = ((self.conversion[index] as f64 - self.parameters.gel_point)
            / (1.0 - self.parameters.gel_point))
            .clamp(0.0, 1.0);
        let resistance = (self.parameters.developer_resistance * gel).exp();
        let loss = self.parameters.developer_rate * developer * dt / resistance;
        self.remaining[index] = (self.remaining[index] as f64 * (-loss).exp()) as f32;
    }

    fn rebuild_psf(&mut self) {
        self.psf_kernel = build_vectorial_psf(
            self.parameters.na,
            self.parameters.wavelength,
            self.tier,
            self.pitch_um,
        );
        self.psf_preview = summarize_psf(
            &self.psf_kernel,
            self.parameters.na,
            self.parameters.wavelength,
            self.tier,
            self.pitch_um,
        );
    }

    fn xyz(&self, index: usize) -> [f64; 3] {
        index_to_xyz(index, self.dims, self.origin_um, self.pitch_um)
    }

    pub fn focus(&self) -> [f32; 3] {
        self.focus
    }

    pub fn exposure_progress(&self) -> f64 {
        self.exposure_step as f64 / self.exposure_steps_total.max(1) as f64
    }

    pub fn development_progress(&self) -> f64 {
        self.development_step as f64 / self.development_steps_total.max(1) as f64
    }

    pub fn snapshot(&mut self) -> &[f32] {
        let oxygen_scale = self.parameters.oxygen.max(1e-9) as f32;
        for output in 0..self.render_indices.len() {
            let index = self.render_indices[output];
            let position = self.xyz(index);
            let base = output * 7;
            self.render_snapshot[base] = position[0] as f32;
            self.render_snapshot[base + 1] = position[1] as f32;
            self.render_snapshot[base + 2] = position[2] as f32;
            self.render_snapshot[base + 3] = self.conversion[index];
            self.render_snapshot[base + 4] = (self.oxygen[index] / oxygen_scale).clamp(0.0, 1.0);
            self.render_snapshot[base + 5] =
                (self.radicals[index].ln_1p() / 5.0_f32.ln()).clamp(0.0, 1.0);
            self.render_snapshot[base + 6] = self.remaining[index];
        }
        &self.render_snapshot
    }

    pub fn snapshot_len(&self) -> usize {
        self.render_snapshot.len()
    }

    /// Packed authoritative XY chemistry plane at the grid layer nearest
    /// `requested_z_um`. Each cell contains normalized oxygen, raw radical
    /// activity, conversion, remaining mass, and target occupancy.
    pub fn xy_slice_snapshot(&mut self, requested_z_um: f64) -> &[f32] {
        let z = ((requested_z_um - self.origin_um[2]) / self.pitch_um[2])
            .round()
            .clamp(0.0, (self.dims[2] - 1) as f64) as usize;
        self.xy_slice_z_um = (self.origin_um[2] + z as f64 * self.pitch_um[2]) as f32;
        let oxygen_scale = self.parameters.oxygen.max(1e-9) as f32;
        let plane_len = self.dims[0] * self.dims[1];
        let plane_start = z * plane_len;
        for plane_index in 0..plane_len {
            let index = plane_start + plane_index;
            let output = plane_index * XY_SLICE_FIELD_COUNT;
            self.xy_slice_snapshot[output] = (self.oxygen[index] / oxygen_scale).clamp(0.0, 1.0);
            self.xy_slice_snapshot[output + 1] = self.radicals[index];
            self.xy_slice_snapshot[output + 2] = self.conversion[index];
            self.xy_slice_snapshot[output + 3] = self.remaining[index];
            self.xy_slice_snapshot[output + 4] = if self.occupancy[index] != 0 { 1.0 } else { 0.0 };
        }
        &self.xy_slice_snapshot
    }

    pub fn xy_slice_len(&self) -> usize {
        self.xy_slice_snapshot.len()
    }

    pub fn xy_slice_width(&self) -> usize {
        self.dims[0]
    }

    pub fn xy_slice_height(&self) -> usize {
        self.dims[1]
    }

    pub fn xy_slice_z_um(&self) -> f32 {
        self.xy_slice_z_um
    }

    /// Packed illuminated XYZXYZ segments for the authoritative scan schedule.
    pub fn scan_path_segments(&self) -> &[f32] {
        &self.scan_path_segments
    }

    pub fn layer_positions(&self) -> &[f32] {
        &self.layer_positions
    }

    pub fn diagnostics(&mut self) -> VolumeDiagnostics {
        self.refresh_dynamic_diagnostics();
        self.cached_diagnostics()
    }

    pub fn cached_diagnostics(&self) -> VolumeDiagnostics {
        let owned_memory_bytes = self.occupancy.capacity()
            + self.occupied_indices.capacity() * std::mem::size_of::<u32>()
            + self.photoinitiator.capacity() * std::mem::size_of::<f32>()
            + self.oxygen.capacity() * 4
            + self.radicals.capacity() * 4
            + self.conversion.capacity() * 4
            + self.remaining.capacity() * 4
            + self.developer_integral.capacity() * 4
            + self.developer_depth_um.capacity() * std::mem::size_of::<f32>()
            + self.scratch_photoinitiator.capacity() * std::mem::size_of::<f32>()
            + self.scratch_oxygen.capacity() * std::mem::size_of::<f32>()
            + self.scratch_radicals.capacity() * std::mem::size_of::<f32>()
            + self.active.capacity()
            + self.active_indices.capacity() * std::mem::size_of::<u32>()
            + self.active_frontier.capacity() * std::mem::size_of::<u32>()
            + self.spare_frontier.capacity() * std::mem::size_of::<u32>()
            + self.scan_path.capacity() * std::mem::size_of::<ScanPoint>()
            + self.scan_timing.capacity() * std::mem::size_of::<ScanPointTiming>()
            + self.scan_path_segments.capacity() * std::mem::size_of::<f32>()
            + self.layer_positions.capacity() * std::mem::size_of::<f32>()
            + self.render_indices.capacity() * std::mem::size_of::<usize>()
            + self.render_snapshot.capacity() * std::mem::size_of::<f32>()
            + self.xy_slice_snapshot.capacity() * std::mem::size_of::<f32>()
            + self.psf_kernel.capacity() * std::mem::size_of::<KernelVoxel>()
            + self.cached_dynamic_diagnostics.checksum.capacity();
        let dynamic = &self.cached_dynamic_diagnostics;
        VolumeDiagnostics {
            solver: "Rust/Wasm 3D volume",
            quality_tier: self.tier.name,
            grid_width: self.dims[0],
            grid_height: self.dims[1],
            grid_depth: self.dims[2],
            voxel_pitch_um: self.pitch_um,
            memory_budget_bytes: self.memory_budget_bytes,
            owned_memory_bytes,
            downgrade_reason: (self.tier.name != "full")
                .then_some("memory budget selected a coarser grid and PSF quadrature"),
            psf_model: "vectorial Debye / fixed specimen power / adaptive voxel I²",
            psf_pupil_samples: self.tier.theta_samples * self.tier.phi_samples,
            psf_kernel_voxels: self.psf_kernel.len(),
            psf_preview: self.psf_preview.clone(),
            scan_points: self.scan_path.len(),
            layer_count: self.layer_positions.len(),
            path_length_um: self.cached_path_length_um,
            estimated_exposure_seconds: self.cached_estimated_exposure_seconds,
            exposure_step: self.exposure_step,
            exposure_steps_total: self.exposure_steps_total,
            development_step: self.development_step,
            development_steps_total: self.development_steps_total,
            simulated_time_seconds: self.simulated_time_seconds,
            oxygen_mean: dynamic.oxygen_mean,
            radical_max: dynamic.radical_max,
            conversion_mean: dynamic.conversion_mean,
            gelled_fraction: dynamic.gelled_fraction,
            surviving_fraction: dynamic.surviving_fraction,
            target_voxels: self.occupied_indices.len(),
            render_voxels: self.render_indices.len(),
            off_target_active_voxels: dynamic.off_target_active_voxels,
            off_target_conversion_mean: dynamic.off_target_conversion_mean,
            off_target_gelled_fraction: dynamic.off_target_gelled_fraction,
            off_target_surviving_fraction: dynamic.off_target_surviving_fraction,
            checksum: dynamic.checksum.clone(),
        }
    }

    fn refresh_dynamic_diagnostics(&mut self) {
        self.cached_dynamic_diagnostics = calculate_dynamic_diagnostics(self);
    }
}

fn schedule_steps(scan_points: usize, passes: f64) -> u32 {
    ((scan_points as f64 * passes / 240.0).round() as u32).clamp(360, 1800)
}

fn exposure_bucket(step: u32, steps_total: u32, targets_total: usize) -> (usize, usize) {
    let denominator = steps_total.max(1) as usize;
    let start = step as usize * targets_total / denominator;
    let end = (step as usize + 1) * targets_total / denominator;
    (start.min(targets_total), end.min(targets_total))
}

fn select_tier(memory_budget_bytes: usize) -> Tier {
    TIERS
        .iter()
        .copied()
        .find(|candidate| memory_budget_bytes >= candidate.memory_floor)
        .unwrap_or(TIERS[3])
}

fn tier_pitch(tier: Tier) -> [f64; 3] {
    [
        BASE_PITCH_UM[0] * (BASE_DIMS[0] - 1) as f64 / (tier.dims[0] - 1) as f64,
        BASE_PITCH_UM[1] * (BASE_DIMS[1] - 1) as f64 / (tier.dims[1] - 1) as f64,
        BASE_PITCH_UM[2] * (BASE_DIMS[2] - 1) as f64 / (tier.dims[2] - 1) as f64,
    ]
}

pub fn preview_vectorial_psf(
    na: f64,
    wavelength_nm: f64,
    memory_budget_bytes: usize,
) -> Result<PsfPreview, ValidationError> {
    if !na.is_finite() || na <= 0.0 {
        return Err(ValidationError::new(
            "na must be finite and greater than zero",
        ));
    }
    if !wavelength_nm.is_finite() || wavelength_nm <= 0.0 {
        return Err(ValidationError::new(
            "wavelength must be finite and greater than zero",
        ));
    }
    let tier = select_tier(memory_budget_bytes);
    let pitch = tier_pitch(tier);
    let kernel = build_vectorial_psf(na, wavelength_nm, tier, pitch);
    Ok(summarize_psf(&kernel, na, wavelength_nm, tier, pitch))
}

fn resample_occupancy(base: &[u8], dims: [usize; 3]) -> Vec<u8> {
    let mut output = vec![0; dims[0] * dims[1] * dims[2]];
    for z in 0..dims[2] {
        let bz = z * (BASE_DIMS[2] - 1) / (dims[2] - 1);
        for y in 0..dims[1] {
            let by = y * (BASE_DIMS[1] - 1) / (dims[1] - 1);
            for x in 0..dims[0] {
                let bx = x * (BASE_DIMS[0] - 1) / (dims[0] - 1);
                output[flatten(x, y, z, dims)] = base[flatten(bx, by, bz, BASE_DIMS)];
            }
        }
    }
    output
}

fn build_scan_path(
    occupancy: &[u8],
    dims: [usize; 3],
    parameters: &Parameters,
    pitch_um: [f64; 3],
    origin_um: [f64; 3],
) -> ScanSchedule {
    let mut path = Vec::new();
    let mut layer_positions = Vec::new();
    let mut occupied_layers = Vec::new();
    for z in 0..dims[2] {
        let base = z * dims[0] * dims[1];
        if occupancy[base..base + dims[0] * dims[1]]
            .iter()
            .any(|value| *value != 0)
        {
            occupied_layers.push(z);
        }
    }
    if occupied_layers.is_empty() {
        return ScanSchedule {
            path,
            layer_positions,
        };
    }

    let first_occupied = occupied_layers[0];
    let last_occupied = *occupied_layers.last().expect("occupied layer exists");
    let first_physical_z = origin_um[2] + first_occupied as f64 * pitch_um[2];
    let last_physical_z = origin_um[2] + last_occupied as f64 * pitch_um[2];
    let physical_layer_count =
        ((last_physical_z - first_physical_z) / parameters.layer_height).floor() as usize;
    let mut candidate_layers = Vec::with_capacity(physical_layer_count + 2);
    for layer in 0..=physical_layer_count {
        let desired_z = first_physical_z + layer as f64 * parameters.layer_height;
        let desired_voxel = (desired_z - origin_um[2]) / pitch_um[2];
        candidate_layers.push(nearest_occupied_layer(&occupied_layers, desired_voxel));
    }
    candidate_layers.push(last_occupied);
    candidate_layers.sort_unstable();
    candidate_layers.dedup();

    let plane_len = dims[0] * dims[1];
    let contour_count = parameters.contour_count as usize;
    for z in candidate_layers {
        let layer_base = z * plane_len;
        let mut interior = occupancy[layer_base..layer_base + plane_len].to_vec();
        if !interior.iter().any(|value| *value != 0) {
            continue;
        }
        let mut layer_path = Vec::new();
        for _ in 0..contour_count {
            let boundary = boundary_shell(&interior, [dims[0], dims[1]]);
            if !boundary.iter().any(|value| *value != 0) {
                break;
            }
            append_boundary_shell(&boundary, [dims[0], dims[1]], z, dims, &mut layer_path);
            interior = erode_layer(&interior, [dims[0], dims[1]]);
        }
        let emitted_layer = layer_positions.len();
        append_hatch(
            &interior,
            [dims[0], dims[1]],
            z,
            dims,
            parameters.hatch_spacing,
            parameters.hatch_angle + (emitted_layer % 2) as f64 * 90.0,
            pitch_um,
            &mut layer_path,
        );
        if layer_path.is_empty() {
            let local = occupancy[layer_base..layer_base + plane_len]
                .iter()
                .position(|value| *value != 0)
                .expect("nonempty layer has a voxel");
            layer_path.push(ScanPoint {
                index: (layer_base + local) as u32,
                starts_segment: true,
            });
        }
        layer_path[0].starts_segment = true;
        path.extend(layer_path);
        layer_positions.push((origin_um[2] + z as f64 * pitch_um[2]) as f32);
    }
    ScanSchedule {
        path,
        layer_positions,
    }
}

fn nearest_occupied_layer(occupied_layers: &[usize], desired: f64) -> usize {
    let insertion = occupied_layers.partition_point(|layer| (*layer as f64) < desired);
    if insertion == 0 {
        return occupied_layers[0];
    }
    if insertion == occupied_layers.len() {
        return *occupied_layers
            .last()
            .expect("occupied layers are nonempty");
    }
    let below = occupied_layers[insertion - 1];
    let above = occupied_layers[insertion];
    if desired - below as f64 <= above as f64 - desired {
        below
    } else {
        above
    }
}

fn boundary_shell(layer: &[u8], dims: [usize; 2]) -> Vec<u8> {
    let mut boundary = vec![0; layer.len()];
    for y in 0..dims[1] {
        for x in 0..dims[0] {
            let index = x + dims[0] * y;
            if layer[index] == 0 {
                continue;
            }
            let touches_bath = x == 0
                || y == 0
                || x + 1 == dims[0]
                || y + 1 == dims[1]
                || layer[index - 1] == 0
                || layer[index + 1] == 0
                || layer[index - dims[0]] == 0
                || layer[index + dims[0]] == 0;
            boundary[index] = touches_bath as u8;
        }
    }
    boundary
}

fn erode_layer(layer: &[u8], dims: [usize; 2]) -> Vec<u8> {
    let mut eroded = vec![0; layer.len()];
    if dims[0] < 3 || dims[1] < 3 {
        return eroded;
    }
    for y in 1..dims[1] - 1 {
        for x in 1..dims[0] - 1 {
            let index = x + dims[0] * y;
            eroded[index] = (layer[index] != 0
                && layer[index - 1] != 0
                && layer[index + 1] != 0
                && layer[index - dims[0]] != 0
                && layer[index + dims[0]] != 0) as u8;
        }
    }
    eroded
}

fn append_boundary_shell(
    boundary: &[u8],
    plane_dims: [usize; 2],
    z: usize,
    dims: [usize; 3],
    path: &mut Vec<ScanPoint>,
) {
    const NEIGHBORS: [(isize, isize); 8] = [
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
    ];
    let mut visited = vec![0_u8; boundary.len()];
    loop {
        let Some(mut current) = boundary
            .iter()
            .zip(&visited)
            .position(|(is_boundary, was_visited)| *is_boundary != 0 && *was_visited == 0)
        else {
            break;
        };
        let component_start = current;
        let component_path_start = path.len();
        let mut starts_segment = true;
        loop {
            visited[current] = 1;
            let x = current % plane_dims[0];
            let y = current / plane_dims[0];
            path.push(ScanPoint {
                index: flatten(x, y, z, dims) as u32,
                starts_segment,
            });
            starts_segment = false;
            let next = NEIGHBORS.iter().find_map(|(dx, dy)| {
                let nx = x as isize + dx;
                let ny = y as isize + dy;
                if nx < 0 || ny < 0 || nx >= plane_dims[0] as isize || ny >= plane_dims[1] as isize
                {
                    return None;
                }
                let candidate = nx as usize + plane_dims[0] * ny as usize;
                (boundary[candidate] != 0 && visited[candidate] == 0).then_some(candidate)
            });
            match next {
                Some(next) => current = next,
                None => break,
            }
        }
        if path.len() > component_path_start + 1 {
            let end_x = current % plane_dims[0];
            let end_y = current / plane_dims[0];
            let start_x = component_start % plane_dims[0];
            let start_y = component_start / plane_dims[0];
            if end_x.abs_diff(start_x) <= 1 && end_y.abs_diff(start_y) <= 1 {
                path.push(ScanPoint {
                    index: flatten(start_x, start_y, z, dims) as u32,
                    starts_segment: false,
                });
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn append_hatch(
    interior: &[u8],
    plane_dims: [usize; 2],
    z: usize,
    dims: [usize; 3],
    spacing_um: f64,
    angle_degrees: f64,
    pitch_um: [f64; 3],
    path: &mut Vec<ScanPoint>,
) {
    // Normalize modulo 180 degrees: a hatch direction is undirected, so
    // theta and theta+180 produce bit-identical schedules.
    let angle = angle_degrees.rem_euclid(180.0).to_radians();
    let (sin, cos) = angle.sin_cos();
    let direction = [cos, sin];
    let normal = [-sin, cos];
    let center = [
        (plane_dims[0] - 1) as f64 * 0.5,
        (plane_dims[1] - 1) as f64 * 0.5,
    ];
    // Projection of a voxel's half-width onto the hatch normal. Selecting
    // cells whose footprint intersects a mathematical line rasterizes every
    // angle without collapsing it to an X/Y branch.
    let line_half_width =
        0.5 * (normal[0].abs() * pitch_um[0] + normal[1].abs() * pitch_um[1]) + 1e-12;
    let mut lines: BTreeMap<i64, Vec<(f64, usize)>> = BTreeMap::new();
    for y in 0..plane_dims[1] {
        for x in 0..plane_dims[0] {
            let local = x + plane_dims[0] * y;
            if interior[local] == 0 {
                continue;
            }
            let physical = [
                (x as f64 - center[0]) * pitch_um[0],
                (y as f64 - center[1]) * pitch_um[1],
            ];
            let across = normal[0] * physical[0] + normal[1] * physical[1];
            let line = (across / spacing_um).round() as i64;
            if (across - line as f64 * spacing_um).abs() > line_half_width {
                continue;
            }
            let along = direction[0] * physical[0] + direction[1] * physical[1];
            lines
                .entry(line)
                .or_default()
                .push((along, flatten(x, y, z, dims)));
        }
    }

    let continuity_limit = 2.1 * (pitch_um[0] * pitch_um[0] + pitch_um[1] * pitch_um[1]).sqrt();
    for (line_ordinal, (_, mut points)) in lines.into_iter().enumerate() {
        points.sort_by(|left, right| left.0.total_cmp(&right.0).then(left.1.cmp(&right.1)));
        if line_ordinal % 2 != 0 {
            points.reverse();
        }
        let mut previous = None;
        for (_, index) in points {
            let starts_segment = previous
                .map(|previous_index| {
                    index_distance(previous_index, index, dims, pitch_um) > continuity_limit
                })
                .unwrap_or(true);
            path.push(ScanPoint {
                index: index as u32,
                starts_segment,
            });
            previous = Some(index);
        }
    }
}

fn build_scan_path_segments(
    path: &[ScanPoint],
    dims: [usize; 3],
    origin_um: [f64; 3],
    pitch_um: [f64; 3],
) -> Vec<f32> {
    let mut segments = Vec::new();
    // A one-voxel feature is a stationary exposure rather than a traversed
    // edge. Export a one-pitch dwell-equivalent marker so its finite dose is
    // visible and included in the same path-length contract as every segment.
    let stationary_dwell = pitch_um.into_iter().fold(f64::INFINITY, f64::min);
    for path_index in 0..path.len() {
        let start = index_to_xyz(path[path_index].index as usize, dims, origin_um, pitch_um);
        if is_singleton_segment(path, path_index) {
            let end = [start[0] + stationary_dwell, start[1], start[2]];
            segments.extend(start.into_iter().chain(end).map(|value| value as f32));
        } else if path_index + 1 < path.len() && !path[path_index + 1].starts_segment {
            let end = index_to_xyz(
                path[path_index + 1].index as usize,
                dims,
                origin_um,
                pitch_um,
            );
            segments.extend(start.into_iter().chain(end).map(|value| value as f32));
        }
    }
    segments
}

fn build_scan_timing(
    path: &[ScanPoint],
    dims: [usize; 3],
    origin_um: [f64; 3],
    pitch_um: [f64; 3],
    parameters: &Parameters,
) -> Vec<ScanPointTiming> {
    if path.is_empty() {
        return Vec::new();
    }
    let jump_speed = (parameters.speed * 8.0).max(200.0);
    path.iter()
        .enumerate()
        .map(|(path_index, point)| {
            let previous_index = path[(path_index + path.len() - 1) % path.len()].index;
            let xyz = index_to_xyz(point.index as usize, dims, origin_um, pitch_um);
            ScanPointTiming {
                focus: [xyz[0] as f32, xyz[1] as f32, xyz[2] as f32],
                previous_index,
                illuminated_seconds: illuminated_distance_at(path, path_index, dims, pitch_um)
                    / parameters.speed,
                jump_seconds: index_distance(
                    previous_index as usize,
                    point.index as usize,
                    dims,
                    pitch_um,
                ) / jump_speed,
            }
        })
        .collect()
}

fn packed_segment_length(segments: &[f32]) -> f64 {
    segments
        .chunks_exact(6)
        .map(|segment| {
            ((segment[3] as f64 - segment[0] as f64).powi(2)
                + (segment[4] as f64 - segment[1] as f64).powi(2)
                + (segment[5] as f64 - segment[2] as f64).powi(2))
            .sqrt()
        })
        .sum()
}

fn estimated_exposure_seconds(
    path: &[ScanPoint],
    dims: [usize; 3],
    pitch_um: [f64; 3],
    parameters: &Parameters,
) -> f64 {
    if path.is_empty() {
        return 0.0;
    }
    let passes = parameters.passes as usize;
    let total_targets = path.len() * passes;
    let steps_total = schedule_steps(path.len(), parameters.passes);
    let jump_speed = (parameters.speed * 8.0).max(200.0);
    let mut total = 0.0;
    let mut previous = None;
    for step in 0..steps_total {
        let (start, end) = exposure_bucket(step, steps_total, total_targets);
        let mut elapsed = 0.0;
        for target in start..end {
            let path_index = target % path.len();
            let point = path[path_index];
            if let Some(previous_index) = previous {
                if point.starts_segment {
                    let distance = index_distance(
                        previous_index as usize,
                        point.index as usize,
                        dims,
                        pitch_um,
                    );
                    elapsed += distance / jump_speed;
                }
            }
            elapsed += illuminated_distance_at(path, path_index, dims, pitch_um) / parameters.speed;
            previous = Some(point.index);
        }
        total += elapsed;
    }
    total
}

fn illuminated_distance_at(
    path: &[ScanPoint],
    path_index: usize,
    dims: [usize; 3],
    pitch_um: [f64; 3],
) -> f64 {
    let point = path[path_index];
    let mut distance = 0.0;
    if path_index > 0 && !point.starts_segment {
        distance += 0.5
            * index_distance(
                path[path_index - 1].index as usize,
                point.index as usize,
                dims,
                pitch_um,
            );
    }
    if path_index + 1 < path.len() && !path[path_index + 1].starts_segment {
        distance += 0.5
            * index_distance(
                point.index as usize,
                path[path_index + 1].index as usize,
                dims,
                pitch_um,
            );
    }
    if is_singleton_segment(path, path_index) {
        distance = pitch_um.into_iter().fold(f64::INFINITY, f64::min);
    }
    distance
}

fn is_singleton_segment(path: &[ScanPoint], path_index: usize) -> bool {
    let has_previous_edge = path_index > 0 && !path[path_index].starts_segment;
    let has_next_edge = path_index + 1 < path.len() && !path[path_index + 1].starts_segment;
    !has_previous_edge && !has_next_edge
}

fn sample_indices(source: &[usize], maximum: usize) -> Vec<usize> {
    if source.len() <= maximum {
        return source.to_vec();
    }
    (0..maximum)
        .map(|index| source[index * (source.len() - 1) / (maximum - 1)])
        .collect()
}

fn sample_indices_by_layer(source: &[usize], maximum: usize, dims: [usize; 3]) -> Vec<usize> {
    if source.len() <= maximum {
        return source.to_vec();
    }
    let mut layers = vec![Vec::new(); dims[2]];
    for &index in source {
        layers[index_to_ijk(index, dims)[2]].push(index);
    }
    let mut allocations = vec![0_usize; dims[2]];
    let mut unsaturated: Vec<usize> = layers
        .iter()
        .enumerate()
        .filter_map(|(z, layer)| (!layer.is_empty()).then_some(z))
        .collect();
    let mut remaining = maximum;
    while remaining > 0 && !unsaturated.is_empty() {
        let share = remaining.div_ceil(unsaturated.len());
        let mut next = Vec::new();
        let mut assigned = 0_usize;
        for z in unsaturated {
            let available = layers[z].len() - allocations[z];
            let take = available.min(share).min(remaining - assigned);
            allocations[z] += take;
            assigned += take;
            if allocations[z] < layers[z].len() {
                next.push(z);
            }
            if assigned == remaining {
                break;
            }
        }
        if assigned == 0 {
            break;
        }
        remaining -= assigned;
        unsaturated = next;
    }

    let mut sampled = Vec::with_capacity(maximum - remaining);
    for (z, layer) in layers.iter().enumerate() {
        sampled.extend(sample_indices(layer, allocations[z]));
    }
    sampled
}

fn build_render_indices(
    occupancy: &[u8],
    occupied_indices: &[usize],
    dims: [usize; 3],
    maximum: usize,
) -> Vec<usize> {
    let target_budget = TARGET_RENDER_VOXELS
        .min(maximum.saturating_mul(3) / 4)
        .min(occupied_indices.len());
    let mut render_indices = sample_indices_by_layer(occupied_indices, target_budget, dims);

    let mut halo = occupancy.to_vec();
    for _ in 0..RENDER_HALO_PASSES {
        let previous = halo.clone();
        for (index, included) in previous.iter().enumerate() {
            if *included == 0 {
                continue;
            }
            for neighbor in neighbor_indices(index, dims) {
                halo[neighbor] = 1;
            }
        }
    }
    let surrounding: Vec<usize> = halo
        .iter()
        .enumerate()
        .filter_map(|(index, included)| (*included != 0 && occupancy[index] == 0).then_some(index))
        .collect();
    let surrounding_budget = maximum.saturating_sub(render_indices.len());
    render_indices.extend(sample_indices_by_layer(
        &surrounding,
        surrounding_budget,
        dims,
    ));

    if render_indices.len() < maximum && target_budget < occupied_indices.len() {
        let selected: std::collections::BTreeSet<usize> = render_indices.iter().copied().collect();
        let remaining_target: Vec<usize> = occupied_indices
            .iter()
            .copied()
            .filter(|index| !selected.contains(index))
            .collect();
        render_indices.extend(sample_indices_by_layer(
            &remaining_target,
            maximum - render_indices.len(),
            dims,
        ));
    }
    render_indices
}

fn target_developer_depths(
    occupancy: &[u8],
    occupied_indices: &[usize],
    dims: [usize; 3],
    pitch_um: [f64; 3],
) -> Vec<f32> {
    let mut bath = vec![0_u8; occupancy.len()];
    let mut bath_queue = VecDeque::new();
    for index in 0..occupancy.len() {
        let [x, y, z] = index_to_ijk(index, dims);
        let boundary =
            x == 0 || x + 1 == dims[0] || y == 0 || y + 1 == dims[1] || z == 0 || z + 1 == dims[2];
        if boundary && occupancy[index] == 0 {
            bath[index] = 1;
            bath_queue.push_back(index);
        }
    }
    while let Some(index) = bath_queue.pop_front() {
        for neighbor in neighbor_indices(index, dims) {
            if occupancy[neighbor] == 0 && bath[neighbor] == 0 {
                bath[neighbor] = 1;
                bath_queue.push_back(neighbor);
            }
        }
    }

    let mut depth_steps = vec![u16::MAX; occupancy.len()];
    let mut material_queue = VecDeque::new();
    for &index in occupied_indices {
        let [x, y, z] = index_to_ijk(index, dims);
        let touches_domain =
            x == 0 || x + 1 == dims[0] || y == 0 || y + 1 == dims[1] || z == 0 || z + 1 == dims[2];
        let touches_bath = neighbor_indices(index, dims)
            .iter()
            .any(|neighbor| bath[*neighbor] != 0);
        if touches_domain || touches_bath {
            depth_steps[index] = 0;
            material_queue.push_back(index);
        }
    }
    while let Some(index) = material_queue.pop_front() {
        let next_depth = depth_steps[index].saturating_add(1);
        for neighbor in neighbor_indices(index, dims) {
            if occupancy[neighbor] != 0 && depth_steps[neighbor] == u16::MAX {
                depth_steps[neighbor] = next_depth;
                material_queue.push_back(neighbor);
            }
        }
    }

    let pitch = pitch_um.into_iter().fold(f64::INFINITY, f64::min);
    occupied_indices
        .iter()
        .map(|index| {
            let steps = depth_steps[*index];
            assert_ne!(steps, u16::MAX, "occupied material must reach the bath");
            ((steps as f64 + 0.5) * pitch) as f32
        })
        .collect()
}

fn build_vectorial_psf(
    na: f64,
    wavelength_nm: f64,
    tier: Tier,
    pitch: [f64; 3],
) -> Vec<KernelVoxel> {
    let wavelength_um = wavelength_nm * 1e-3;
    let lateral = 0.61 * wavelength_um / na.max(MIN_NUMERICAL_APERTURE);
    let axial = 2.0 * REFRACTIVE_INDEX * wavelength_um / na.max(MIN_NUMERICAL_APERTURE).powi(2);
    let rx = ((2.4 * lateral / pitch[0]).ceil() as isize).clamp(2, 10);
    let ry = ((2.4 * lateral / pitch[1]).ceil() as isize).clamp(2, 10);
    let rz = ((2.2 * axial / pitch[2]).ceil() as isize).clamp(3, 18);
    let optics = debye_optics(na, wavelength_nm, tier);
    let point_peak = debye_two_photon([0.0; 3], optics);
    let reference_optics = debye_optics(REFERENCE_NA, REFERENCE_WAVELENGTH_NM, tier);
    let reference_point_peak = debye_two_photon([0.0; 3], reference_optics);
    let reference_cell_source =
        voxel_averaged_two_photon([0.0; 3], pitch, reference_optics, reference_point_peak);
    let mut raw = Vec::new();
    let mut cell_peak = 0.0_f64;

    for dz in -rz..=rz {
        for dy in -ry..=ry {
            for dx in -rx..=rx {
                let center = [
                    dx as f64 * pitch[0],
                    dy as f64 * pitch[1],
                    dz as f64 * pitch[2],
                ];
                let cell_source = voxel_averaged_two_photon(center, pitch, optics, point_peak);
                cell_peak = cell_peak.max(cell_source);
                raw.push((dx, dy, dz, cell_source));
            }
        }
    }
    raw.into_iter()
        .filter_map(|(dx, dy, dz, value)| {
            let relative_shape = value / cell_peak.max(1e-30);
            let weight = (value / reference_cell_source.max(1e-30)) as f32;
            (relative_shape >= PSF_RELATIVE_CUTOFF).then_some(KernelVoxel { dx, dy, dz, weight })
        })
        .collect()
}

fn debye_optics(na: f64, wavelength_nm: f64, tier: Tier) -> DebyeOptics {
    let wavelength_um = wavelength_nm * 1e-3;
    let theta_max = (na / REFRACTIVE_INDEX).clamp(0.0, 0.999_999).asin();
    let pupil_radius = theta_max.sin().max(1e-12);
    let pupil_area = std::f64::consts::PI * pupil_radius * pupil_radius;
    let quadrature = theta_max / tier.theta_samples as f64 * TWO_PI / tier.phi_samples as f64;
    DebyeOptics {
        theta_max,
        wave_number: TWO_PI * REFRACTIVE_INDEX / wavelength_um,
        // The angular integral is normalized to fixed total pupil power. The
        // wavelength factor preserves the expected tighter-focus intensity at
        // shorter wavelengths. A reference cell below fixes the arbitrary
        // absolute scale without erasing the NA dependence.
        field_scale: quadrature / pupil_area.sqrt() * (REFERENCE_WAVELENGTH_NM / wavelength_nm),
        tier,
    }
}

fn debye_two_photon(position: [f64; 3], optics: DebyeOptics) -> f64 {
    let [x, y, z] = position;
    let inv_sqrt_two = 1.0 / 2.0_f64.sqrt();
    let mut field = [Complex::default(); 3];
    for ti in 0..optics.tier.theta_samples {
        let theta = optics.theta_max * (ti as f64 + 0.5) / optics.tier.theta_samples as f64;
        let sin_theta = theta.sin();
        let cos_theta = theta.cos();
        let apodization = cos_theta.sqrt() * sin_theta * optics.field_scale;
        for pi in 0..optics.tier.phi_samples {
            let phi = TWO_PI * (pi as f64 + 0.5) / optics.tier.phi_samples as f64;
            let sx = sin_theta * phi.cos();
            let sy = sin_theta * phi.sin();
            let sz = cos_theta;
            let phase = optics.wave_number * (x * sx + y * sy + z * (sz - 1.0));
            // Circular input e=(x+i y)/sqrt(2), projected onto the
            // transverse plane of each refracted Debye ray.
            let dot_re = sx * inv_sqrt_two;
            let dot_im = sy * inv_sqrt_two;
            let amplitudes = [
                (inv_sqrt_two - sx * dot_re, -sx * dot_im),
                (-sy * dot_re, inv_sqrt_two - sy * dot_im),
                (-sz * dot_re, -sz * dot_im),
            ];
            for component in 0..3 {
                field[component].add_phase(
                    amplitudes[component].0 * apodization,
                    amplitudes[component].1 * apodization,
                    phase,
                );
            }
        }
    }
    let intensity = field.into_iter().map(Complex::norm_squared).sum::<f64>();
    intensity * intensity
}

fn voxel_averaged_two_photon(
    center: [f64; 3],
    pitch: [f64; 3],
    optics: DebyeOptics,
    point_peak: f64,
) -> f64 {
    let center_source = debye_two_photon(center, optics);
    let relative_source = center_source / point_peak.max(1e-30);
    let samples = psf_subvoxel_samples(pitch, optics, relative_source);
    if samples == [1; 3] {
        return center_source;
    }

    let mut source_sum = 0.0;
    let mut sample_count = 0_usize;
    for iz in 0..samples[2] {
        for iy in 0..samples[1] {
            for ix in 0..samples[0] {
                let ordinals = [ix, iy, iz];
                let position = std::array::from_fn(|axis| {
                    center[axis]
                        + ((ordinals[axis] as f64 + 0.5) / samples[axis] as f64 - 0.5) * pitch[axis]
                });
                source_sum += debye_two_photon(position, optics);
                sample_count += 1;
            }
        }
    }
    source_sum / sample_count as f64
}

fn psf_subvoxel_samples(pitch: [f64; 3], optics: DebyeOptics, relative_source: f64) -> [usize; 3] {
    let needs_subvoxel = relative_source >= PSF_SUBVOXEL_RELATIVE_CUTOFF;
    let wavelength_um = TWO_PI * REFRACTIVE_INDEX / optics.wave_number;
    let na = optics.theta_max.sin() * REFRACTIVE_INDEX;
    let estimated_fwhm = [
        0.37 * wavelength_um / na.max(MIN_NUMERICAL_APERTURE),
        0.37 * wavelength_um / na.max(MIN_NUMERICAL_APERTURE),
        1.1 * REFRACTIVE_INDEX * wavelength_um / na.max(MIN_NUMERICAL_APERTURE).powi(2),
    ];
    std::array::from_fn(|axis| {
        if needs_subvoxel && estimated_fwhm[axis] < 2.0 * pitch[axis] {
            2
        } else {
            1
        }
    })
}

fn summarize_psf(
    kernel: &[KernelVoxel],
    na: f64,
    wavelength_nm: f64,
    tier: Tier,
    pitch: [f64; 3],
) -> PsfPreview {
    PsfPreview {
        model: "vectorial Debye / fixed specimen power / adaptive voxel I²",
        quality_tier: tier.name,
        pupil_samples: tier.theta_samples * tier.phi_samples,
        kernel_voxels: kernel.len(),
        na,
        wavelength_nm,
        cone_half_angle_rad: (na / REFRACTIVE_INDEX).clamp(0.0, 0.999_999).asin(),
        fwhm_radii_um: [
            axis_isovalue_radius(kernel, 0, pitch[0], 0.5),
            axis_isovalue_radius(kernel, 1, pitch[1], 0.5),
            axis_isovalue_radius(kernel, 2, pitch[2], 0.5),
        ],
        tenth_max_radii_um: [
            axis_isovalue_radius(kernel, 0, pitch[0], 0.1),
            axis_isovalue_radius(kernel, 1, pitch[1], 0.1),
            axis_isovalue_radius(kernel, 2, pitch[2], 0.1),
        ],
    }
}

fn axis_isovalue_radius(kernel: &[KernelVoxel], axis: usize, pitch_um: f64, target: f64) -> f64 {
    let coordinate = |voxel: &KernelVoxel, component: usize| match component {
        0 => voxel.dx,
        1 => voxel.dy,
        _ => voxel.dz,
    };
    let maximum_offset = kernel
        .iter()
        .filter(|voxel| {
            (0..3).all(|component| component == axis || coordinate(voxel, component) == 0)
        })
        .map(|voxel| coordinate(voxel, axis).unsigned_abs())
        .max()
        .unwrap_or(1)
        + 1;
    let peak_weight = kernel
        .iter()
        .map(|voxel| voxel.weight as f64)
        .fold(0.0_f64, f64::max)
        .max(f64::EPSILON);
    let target_weight = target * peak_weight;
    let mut previous_offset = 0_usize;
    let mut previous_weight = peak_weight;

    for offset in 1..=maximum_offset {
        let mut weight_sum = 0.0_f64;
        let mut sample_count = 0_usize;
        for voxel in kernel {
            let on_axis =
                (0..3).all(|component| component == axis || coordinate(voxel, component) == 0);
            if on_axis && coordinate(voxel, axis).unsigned_abs() == offset {
                weight_sum += voxel.weight as f64;
                sample_count += 1;
            }
        }
        let weight = if sample_count == 0 {
            0.0
        } else {
            weight_sum / sample_count as f64
        };
        if weight <= target_weight && previous_weight >= target_weight {
            let span = (previous_weight - weight).max(f64::EPSILON);
            let fraction = ((previous_weight - target_weight) / span).clamp(0.0, 1.0);
            return (previous_offset as f64 + fraction) * pitch_um;
        }
        previous_offset = offset;
        previous_weight = weight;
    }

    maximum_offset as f64 * pitch_um
}

fn flatten(x: usize, y: usize, z: usize, dims: [usize; 3]) -> usize {
    x + dims[0] * (y + dims[1] * z)
}

fn index_to_ijk(index: usize, dims: [usize; 3]) -> [usize; 3] {
    let z = index / (dims[0] * dims[1]);
    let remainder = index - z * dims[0] * dims[1];
    let y = remainder / dims[0];
    [remainder - y * dims[0], y, z]
}

fn index_to_xyz(
    index: usize,
    dims: [usize; 3],
    origin_um: [f64; 3],
    pitch_um: [f64; 3],
) -> [f64; 3] {
    let [x, y, z] = index_to_ijk(index, dims);
    [
        origin_um[0] + x as f64 * pitch_um[0],
        origin_um[1] + y as f64 * pitch_um[1],
        origin_um[2] + z as f64 * pitch_um[2],
    ]
}

fn index_distance(left: usize, right: usize, dims: [usize; 3], pitch_um: [f64; 3]) -> f64 {
    let a = index_to_ijk(left, dims);
    let b = index_to_ijk(right, dims);
    (((a[0] as f64 - b[0] as f64) * pitch_um[0]).powi(2)
        + ((a[1] as f64 - b[1] as f64) * pitch_um[1]).powi(2)
        + ((a[2] as f64 - b[2] as f64) * pitch_um[2]).powi(2))
    .sqrt()
}

fn validate_volume_work(
    path: &[ScanPoint],
    dims: [usize; 3],
    pitch_um: [f64; 3],
    parameters: &Parameters,
) -> Result<(), ValidationError> {
    let maximum_elapsed = maximum_exposure_bucket_seconds(path, dims, pitch_um, parameters);
    let required = required_diffusion_substeps(maximum_elapsed, parameters, pitch_um);
    if !required.is_finite() || required > MAX_VOLUME_DIFFUSION_SUBSTEPS_PER_BUCKET as f64 {
        return Err(ValidationError::new(format!(
            "whole-volume exposure requires {required} diffusion substeps in one schedule bucket; maximum is {MAX_VOLUME_DIFFUSION_SUBSTEPS_PER_BUCKET}"
        )));
    }
    Ok(())
}

fn maximum_exposure_bucket_seconds(
    path: &[ScanPoint],
    dims: [usize; 3],
    pitch_um: [f64; 3],
    parameters: &Parameters,
) -> f64 {
    if path.is_empty() {
        return 0.0;
    }
    let total_targets = path.len() * parameters.passes as usize;
    let steps_total = schedule_steps(path.len(), parameters.passes);
    let jump_speed = (parameters.speed * 8.0).max(200.0);
    let mut maximum = 0.0_f64;
    let mut previous = None;
    for step in 0..steps_total {
        let (start, end) = exposure_bucket(step, steps_total, total_targets);
        let mut elapsed = 0.0;
        for target in start..end {
            let path_index = target % path.len();
            let point = path[path_index];
            if let Some(previous_index) = previous {
                if point.starts_segment {
                    elapsed += index_distance(
                        previous_index as usize,
                        point.index as usize,
                        dims,
                        pitch_um,
                    ) / jump_speed;
                }
            }
            elapsed += illuminated_distance_at(path, path_index, dims, pitch_um) / parameters.speed;
            previous = Some(point.index);
        }
        maximum = maximum.max(elapsed);
    }
    maximum
}

fn required_diffusion_substeps(dt: f64, parameters: &Parameters, pitch_um: [f64; 3]) -> f64 {
    let max_diffusivity = parameters
        .oxygen_diffusion
        .max(parameters.radical_diffusion)
        .max(parameters.pi_diffusion);
    let inverse_square_sum = pitch_um
        .iter()
        .map(|pitch| 1.0 / (pitch * pitch))
        .sum::<f64>();
    (2.0 * max_diffusivity * dt * inverse_square_sum / DIFFUSION_COURANT_SAFETY)
        .ceil()
        .max(1.0)
}

fn diffusion_substeps(dt: f64, parameters: &Parameters, pitch_um: [f64; 3]) -> usize {
    // For an anisotropic 3D seven-point stencil, positivity requires
    // 2 D dt sum(1/d_i^2) <= 1. Keep a conservative margin and adapt to the
    // real scan-bucket elapsed time rather than assuming a fixed UI timestep.
    required_diffusion_substeps(dt, parameters, pitch_um) as usize
}

fn neighbor_indices(index: usize, dims: [usize; 3]) -> [usize; 6] {
    let [x, y, z] = index_to_ijk(index, dims);
    let plane = dims[0] * dims[1];
    [
        if x > 0 { index - 1 } else { index },
        if x + 1 < dims[0] { index + 1 } else { index },
        if y > 0 { index - dims[0] } else { index },
        if y + 1 < dims[1] {
            index + dims[0]
        } else {
            index
        },
        if z > 0 { index - plane } else { index },
        if z + 1 < dims[2] {
            index + plane
        } else {
            index
        },
    ]
}

#[inline(always)]
fn laplacian_with_neighbors(
    field: &[f32],
    index: usize,
    neighbors: [usize; 6],
    inverse_pitch_squared: [f64; 3],
) -> f64 {
    let center = field[index] as f64;
    (field[neighbors[0]] as f64 + field[neighbors[1]] as f64 - 2.0 * center)
        * inverse_pitch_squared[0]
        + (field[neighbors[2]] as f64 + field[neighbors[3]] as f64 - 2.0 * center)
            * inverse_pitch_squared[1]
        + (field[neighbors[4]] as f64 + field[neighbors[5]] as f64 - 2.0 * center)
            * inverse_pitch_squared[2]
}

fn hash_word(hash: &mut u32, word: u32) {
    *hash ^= word;
    *hash = hash.wrapping_mul(16_777_619);
}

fn calculate_dynamic_diagnostics(simulation: &WholeVolumeSimulation) -> DynamicDiagnostics {
    let mut hash = 2_166_136_261_u32;
    for word in [
        simulation.exposure_step,
        simulation.development_step,
        simulation.simulated_time_seconds.to_bits() as u32,
        (simulation.simulated_time_seconds.to_bits() >> 32) as u32,
        simulation.inactive_initiator_baseline.to_bits(),
        simulation.inactive_oxygen_baseline.to_bits(),
    ] {
        hash_word(&mut hash, word);
    }
    for value in [
        simulation.parameters.initiator,
        simulation.parameters.oxygen,
    ] {
        let bits = value.to_bits();
        for word in [bits as u32, (bits >> 32) as u32] {
            hash_word(&mut hash, word);
        }
    }
    let target_denominator = simulation.occupied_indices.len().max(1) as f64;
    let oxygen_scale = simulation.parameters.oxygen.max(1e-9);
    let mut oxygen_sum = 0.0;
    let mut radical_max = 0.0_f64;
    let mut conversion_sum = 0.0;
    let mut gelled = 0_usize;
    let mut surviving = 0_usize;
    let mut off_target_active = 0_usize;
    let mut off_target_conversion_sum = 0.0;
    let mut off_target_gelled = 0_usize;
    let mut off_target_surviving = 0_usize;

    // P/O/R/X can only differ from their homogeneous initial conditions on
    // the active diffusion domain. Development state changes on the target
    // occupancy and on active off-target spill. Accumulate telemetry while
    // hashing those domains so a diagnostics refresh traverses each target
    // only once and each active spill cell at most twice.
    for &index in &simulation.active_indices {
        let index = index as usize;
        hash_word(&mut hash, index as u32);
        for value in [
            simulation.photoinitiator[index],
            simulation.oxygen[index],
            simulation.radicals[index],
            simulation.conversion[index],
        ] {
            hash_word(&mut hash, value.to_bits());
        }
        if simulation.occupancy[index] == 0 {
            off_target_active += 1;
            off_target_conversion_sum += simulation.conversion[index] as f64;
            off_target_gelled +=
                (simulation.conversion[index] as f64 >= simulation.parameters.gel_point) as usize;
            off_target_surviving += (simulation.remaining[index] >= 0.5) as usize;
        }
    }
    for &index in &simulation.occupied_indices {
        let index = index as usize;
        oxygen_sum += simulation.oxygen[index] as f64 / oxygen_scale;
        radical_max = radical_max.max(simulation.radicals[index] as f64);
        conversion_sum += simulation.conversion[index] as f64;
        gelled += (simulation.conversion[index] as f64 >= simulation.parameters.gel_point) as usize;
        surviving += (simulation.remaining[index] >= 0.5) as usize;
        hash_word(&mut hash, index as u32);
        for value in [
            simulation.remaining[index],
            simulation.developer_integral[index],
        ] {
            hash_word(&mut hash, value.to_bits());
        }
    }
    for &index in &simulation.active_indices {
        let index = index as usize;
        if simulation.occupancy[index] != 0 {
            continue;
        }
        hash_word(&mut hash, index as u32);
        for value in [
            simulation.remaining[index],
            simulation.developer_integral[index],
        ] {
            hash_word(&mut hash, value.to_bits());
        }
    }
    let off_target_denominator = off_target_active.max(1) as f64;
    DynamicDiagnostics {
        oxygen_mean: oxygen_sum / target_denominator,
        radical_max,
        conversion_mean: conversion_sum / target_denominator,
        gelled_fraction: gelled as f64 / target_denominator,
        surviving_fraction: surviving as f64 / target_denominator,
        off_target_active_voxels: off_target_active,
        off_target_conversion_mean: off_target_conversion_sum / off_target_denominator,
        off_target_gelled_fraction: off_target_gelled as f64 / off_target_denominator,
        off_target_surviving_fraction: off_target_surviving as f64 / off_target_denominator,
        checksum: format!("{hash:08x}"),
    }
}

#[cfg(test)]
fn checksum(simulation: &WholeVolumeSimulation) -> String {
    calculate_dynamic_diagnostics(simulation).checksum
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFFICIAL_OCCUPANCY: &[u8] =
        include_bytes!("../../../public/benchy/3dbenchy-occupancy.bin");

    fn minimal_simulation(parameters: Parameters) -> WholeVolumeSimulation {
        WholeVolumeSimulation::try_new(
            WholeVolumeConfig {
                parameters,
                memory_budget_bytes: 8 * 1024 * 1024,
            },
            OFFICIAL_OCCUPANCY,
        )
        .expect("official occupancy should initialize")
    }

    fn box_schedule(parameters: &Parameters) -> ScanSchedule {
        let dims = [19, 13, 2];
        build_scan_path(
            &vec![1; dims[0] * dims[1] * dims[2]],
            dims,
            parameters,
            [0.2, 0.2, 0.2],
            [0.0, 0.0, 0.0],
        )
    }

    #[test]
    fn tier_selection_is_monotonic() {
        assert_eq!(select_tier(64 * 1024 * 1024).name, "full");
        assert_eq!(select_tier(32 * 1024 * 1024).name, "balanced");
        assert_eq!(select_tier(30 * 1024 * 1024).name, "economy");
        assert_eq!(select_tier(14 * 1024 * 1024).name, "economy");
        assert_eq!(select_tier(4 * 1024 * 1024).name, "minimal");
    }

    #[test]
    fn vectorial_psf_is_positive_and_centered() {
        let kernel = build_vectorial_psf(1.4, 780.0, TIERS[3], [0.3; 3]);
        assert!(!kernel.is_empty());
        assert!(kernel
            .iter()
            .all(|sample| sample.weight.is_finite() && sample.weight > 0.0));
        assert!(kernel.iter().any(|sample| sample.dx == 0
            && sample.dy == 0
            && sample.dz == 0
            && sample.weight > 0.99));
    }

    #[test]
    fn fixed_specimen_power_preserves_na_and_wavelength_concentration() {
        let tier = TIERS[0];
        let pitch = tier_pitch(tier);
        let center_weight = |na, wavelength_nm| {
            build_vectorial_psf(na, wavelength_nm, tier, pitch)
                .into_iter()
                .find(|sample| sample.dx == 0 && sample.dy == 0 && sample.dz == 0)
                .expect("the PSF kernel must include its focal cell")
                .weight as f64
        };

        let lower_na = center_weight(0.9, REFERENCE_WAVELENGTH_NM);
        let reference = center_weight(REFERENCE_NA, REFERENCE_WAVELENGTH_NM);
        let longer_wavelength = center_weight(REFERENCE_NA, 1_064.0);

        assert!((reference - 1.0).abs() < 1e-6);
        assert!(reference > lower_na);
        assert!(reference > longer_wavelength);
    }

    #[test]
    fn adaptive_psf_quadrature_is_local_and_strictly_bounded() {
        let full_pitch = tier_pitch(TIERS[0]);
        let high_na = debye_optics(1.4, 780.0, TIERS[0]);
        let center_samples = psf_subvoxel_samples(full_pitch, high_na, 1.0);
        let tail_samples = psf_subvoxel_samples(full_pitch, high_na, 0.001);
        let minimal_samples = psf_subvoxel_samples(
            tier_pitch(TIERS[3]),
            debye_optics(1.4, 780.0, TIERS[3]),
            1.0,
        );

        assert_eq!(center_samples, [2, 2, 1]);
        assert_eq!(tail_samples, [1, 1, 1]);
        assert_eq!(minimal_samples, [2, 2, 2]);
        assert!(minimal_samples.into_iter().product::<usize>() <= 8);

        let point_source = debye_two_photon([0.0; 3], high_na);
        let cell_source = voxel_averaged_two_photon([0.0; 3], full_pitch, high_na, point_source);
        assert!(cell_source.is_finite() && cell_source > 0.0);
        assert!(cell_source < point_source);
    }

    #[test]
    fn psf_preview_tracks_na_and_wavelength_from_the_debye_kernel() {
        let lower_na = preview_vectorial_psf(0.9, 780.0, 64 * 1024 * 1024).unwrap();
        let higher_na = preview_vectorial_psf(1.4, 780.0, 64 * 1024 * 1024).unwrap();
        let shorter_wavelength = preview_vectorial_psf(1.4, 500.0, 64 * 1024 * 1024).unwrap();
        let longer_wavelength = preview_vectorial_psf(1.4, 1_064.0, 64 * 1024 * 1024).unwrap();

        assert!(higher_na.cone_half_angle_rad > lower_na.cone_half_angle_rad);
        assert!(higher_na.fwhm_radii_um[0] < lower_na.fwhm_radii_um[0]);
        assert!(higher_na.fwhm_radii_um[2] < lower_na.fwhm_radii_um[2]);
        assert!(shorter_wavelength.fwhm_radii_um[0] < higher_na.fwhm_radii_um[0]);
        assert!(shorter_wavelength.fwhm_radii_um[2] < higher_na.fwhm_radii_um[2]);
        assert!(longer_wavelength.fwhm_radii_um[0] > higher_na.fwhm_radii_um[0]);
        assert!(longer_wavelength.fwhm_radii_um[2] > higher_na.fwhm_radii_um[2]);
        assert!(higher_na
            .fwhm_radii_um
            .iter()
            .chain(higher_na.tenth_max_radii_um.iter())
            .all(|radius| radius.is_finite() && *radius > 0.0));
    }

    #[test]
    fn exposure_buckets_cover_every_scan_target_once() {
        let targets = 17_001;
        let steps = schedule_steps(targets, 1.0);
        let mut cursor = 0;
        for step in 0..steps {
            let (start, end) = exposure_bucket(step, steps, targets);
            assert_eq!(start, cursor);
            assert!(end > start);
            cursor = end;
        }
        assert_eq!(cursor, targets);
    }

    #[test]
    fn parameter_validation_enforces_public_bounds() {
        Parameters {
            na: MIN_NUMERICAL_APERTURE,
            ..Parameters::default()
        }
        .validate()
        .expect("the public numerical-aperture lower bound must be solver-safe");

        let parameters = Parameters {
            na: MIN_NUMERICAL_APERTURE - 0.001,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("na"));
        let parameters = Parameters {
            na: 1.491,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("na"));

        Parameters {
            speed: 100_000.0,
            ..Parameters::default()
        }
        .validate()
        .expect("the public scan-speed upper bound must be solver-safe");

        let parameters = Parameters {
            layer_height: 0.249,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("layerHeight"));
        let parameters = Parameters {
            hatch_spacing: 0.249,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("hatchSpacing"));
        let parameters = Parameters {
            contour_count: 1.5,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("contourCount"));
        let parameters = Parameters {
            contour_count: 65.0,
            ..Parameters::default()
        };
        assert!(parameters
            .validate()
            .unwrap_err()
            .to_string()
            .contains("contourCount"));
    }

    #[test]
    fn whole_volume_rejects_unbounded_work_and_too_little_memory() {
        let low_memory = WholeVolumeSimulation::try_new(
            WholeVolumeConfig {
                parameters: Parameters::default(),
                memory_budget_bytes: MIN_VOLUME_MEMORY_BUDGET_BYTES - 1,
            },
            OFFICIAL_OCCUPANCY,
        )
        .err()
        .expect("undersized memory budget must fail");
        assert!(low_memory.to_string().contains("memoryBudgetBytes"));

        let unsafe_parameters = Parameters {
            power: 0.0,
            speed: 1e-10,
            ..Parameters::default()
        };
        let unsafe_config = WholeVolumeSimulation::try_new(
            WholeVolumeConfig {
                parameters: unsafe_parameters.clone(),
                memory_budget_bytes: MIN_VOLUME_MEMORY_BUDGET_BYTES,
            },
            OFFICIAL_OCCUPANCY,
        )
        .err()
        .expect("unbounded physical schedule must fail");
        assert!(unsafe_config.to_string().contains("whole-volume exposure"));

        let mut simulation = minimal_simulation(Parameters::default());
        let original = simulation.parameters.clone();
        assert!(simulation.set_parameters(unsafe_parameters).is_err());
        assert_eq!(
            simulation.parameters, original,
            "rejection is transactional"
        );
    }

    #[test]
    fn inactive_bulk_history_is_part_of_the_checksum() {
        let raised = Parameters {
            initiator: 2.0,
            oxygen: 2.0,
            ..Parameters::default()
        };
        let mut live_raised = minimal_simulation(Parameters::default());
        live_raised
            .set_parameters(raised.clone())
            .expect("bounded concentration increase should apply");
        let mut fresh_raised = minimal_simulation(raised);
        assert_eq!(live_raised.parameters, fresh_raised.parameters);
        assert_eq!(live_raised.photoinitiator[0], 1.0);
        assert_eq!(fresh_raised.photoinitiator[0], 2.0);
        assert_ne!(checksum(&live_raised), checksum(&fresh_raised));
        assert!(live_raised.diagnostics().oxygen_mean < fresh_raised.diagnostics().oxygen_mean);
    }

    #[test]
    fn every_tier_worst_case_indices_fit_the_advertised_budget() {
        let parameters = Parameters {
            layer_height: 0.25,
            hatch_spacing: 0.25,
            contour_count: 64.0,
            ..Parameters::default()
        };
        for (budget_megabytes, tier_name) in [
            (64, "full"),
            (32, "balanced"),
            (12, "economy"),
            (8, "minimal"),
        ] {
            let mut simulation = WholeVolumeSimulation::try_new(
                WholeVolumeConfig {
                    parameters: parameters.clone(),
                    memory_budget_bytes: budget_megabytes * 1024 * 1024,
                },
                OFFICIAL_OCCUPANCY,
            )
            .expect("advertised tier should initialize");
            assert_eq!(simulation.tier.name, tier_name);
            for index in 0..simulation.occupancy.len() {
                simulation.activate_index(index);
            }
            let diagnostics = simulation.diagnostics();
            assert!(
                diagnostics.owned_memory_bytes <= diagnostics.memory_budget_bytes,
                "{tier_name} worst-case ownership {} exceeded {}",
                diagnostics.owned_memory_bytes,
                diagnostics.memory_budget_bytes
            );
        }
    }

    #[test]
    fn arbitrary_hatch_angles_alternate_and_preserve_undirected_symmetry() {
        let mut parameters = Parameters {
            layer_height: 0.2,
            hatch_spacing: 0.8,
            contour_count: 0.0,
            hatch_angle: 37.0,
            ..Parameters::default()
        };
        let base = box_schedule(&parameters);

        parameters.hatch_angle = 217.0;
        let half_turn = box_schedule(&parameters);
        assert_eq!(base.path, half_turn.path, "theta+180 must be identical");

        parameters.hatch_angle = 127.0;
        let quarter_turn = box_schedule(&parameters);
        assert_ne!(base.path, quarter_turn.path, "theta+90 must rotate hatches");

        parameters.hatch_angle = 38.0;
        let nearby = box_schedule(&parameters);
        assert_ne!(base.path, nearby.path, "angles must not collapse to X/Y");

        let first_layer: Vec<usize> = base
            .path
            .iter()
            .filter(|point| index_to_ijk(point.index as usize, [19, 13, 2])[2] == 0)
            .map(|point| point.index as usize)
            .collect();
        let second_layer: Vec<usize> = base
            .path
            .iter()
            .filter(|point| index_to_ijk(point.index as usize, [19, 13, 2])[2] == 1)
            .map(|point| point.index as usize - 19 * 13)
            .collect();
        assert_ne!(first_layer, second_layer, "37 and 127 degree layers differ");
        assert_eq!(base.layer_positions, vec![0.0, 0.2]);
    }

    #[test]
    fn contours_include_outer_and_hole_boundaries_and_exclude_the_hatch_band() {
        let dims = [13, 13];
        let mut ring = vec![1_u8; dims[0] * dims[1]];
        for y in 5..8 {
            for x in 5..8 {
                ring[x + dims[0] * y] = 0;
            }
        }
        let boundary = boundary_shell(&ring, dims);
        assert_eq!(boundary[0], 1, "outer edge is a contour");
        assert_eq!(boundary[4 + dims[0] * 6], 1, "hole edge is a contour");
        assert_eq!(boundary[3 + dims[0] * 3], 0, "bulk is not a contour");

        let eroded = erode_layer(&ring, dims);
        let mut hatch = Vec::new();
        append_hatch(
            &eroded,
            dims,
            0,
            [dims[0], dims[1], 1],
            0.8,
            37.0,
            [0.2, 0.2, 0.2],
            &mut hatch,
        );
        assert!(!hatch.is_empty());
        assert!(hatch
            .iter()
            .all(|point| boundary[point.index as usize] == 0));

        let mut contour_path = Vec::new();
        append_boundary_shell(&boundary, dims, 0, [dims[0], dims[1], 1], &mut contour_path);
        assert!(contour_path.iter().any(|point| point.index == 0));
        assert!(contour_path
            .iter()
            .any(|point| point.index as usize == 4 + dims[0] * 6));
        let first_component_end = contour_path
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, point)| point.starts_segment.then_some(index))
            .unwrap_or(contour_path.len());
        assert_eq!(
            contour_path[0].index,
            contour_path[first_component_end - 1].index,
            "a contour pass must close its outer loop"
        );
    }

    #[test]
    fn rendering_preserves_sparse_upper_layers_and_includes_surrounding_resin() {
        let dims = [8, 8, 8];
        let mut occupancy = vec![0_u8; dims[0] * dims[1] * dims[2]];
        for z in 1..4 {
            for y in 1..7 {
                for x in 1..7 {
                    occupancy[flatten(x, y, z, dims)] = 1;
                }
            }
        }
        occupancy[flatten(3, 3, 6, dims)] = 1;
        occupancy[flatten(4, 3, 6, dims)] = 1;
        let occupied: Vec<usize> = occupancy
            .iter()
            .enumerate()
            .filter_map(|(index, value)| (*value != 0).then_some(index))
            .collect();
        let rendered = build_render_indices(&occupancy, &occupied, dims, 72);
        assert_eq!(rendered.len(), 72);
        assert!(rendered
            .iter()
            .any(|index| index_to_ijk(*index, dims)[2] == 6));
        assert!(rendered.iter().any(|index| occupancy[*index] == 0));
    }

    #[test]
    fn developer_depth_uses_only_bath_accessible_specimen_surfaces() {
        let dims = [7, 7, 7];
        let mut occupancy = vec![0_u8; dims[0] * dims[1] * dims[2]];
        for z in 1..6 {
            for y in 1..6 {
                for x in 1..6 {
                    occupancy[flatten(x, y, z, dims)] = 1;
                }
            }
        }
        occupancy[flatten(3, 3, 3, dims)] = 0;
        let occupied: Vec<usize> = occupancy
            .iter()
            .enumerate()
            .filter_map(|(index, value)| (*value != 0).then_some(index))
            .collect();
        let depths = target_developer_depths(&occupancy, &occupied, dims, [0.2; 3]);
        let depth_by_index: BTreeMap<usize, f32> = occupied.iter().copied().zip(depths).collect();
        assert_eq!(depth_by_index[&flatten(1, 3, 3, dims)], 0.1);
        assert!(
            depth_by_index[&flatten(3, 3, 2, dims)] > 0.1,
            "a sealed cavity must not become an artificial developer source"
        );

        occupancy[flatten(3, 3, 1, dims)] = 0;
        occupancy[flatten(3, 3, 2, dims)] = 0;
        let occupied_open: Vec<usize> = occupancy
            .iter()
            .enumerate()
            .filter_map(|(index, value)| (*value != 0).then_some(index))
            .collect();
        let open_depths = target_developer_depths(&occupancy, &occupied_open, dims, [0.2; 3]);
        let open_by_index: BTreeMap<usize, f32> =
            occupied_open.iter().copied().zip(open_depths).collect();
        assert_eq!(open_by_index[&flatten(3, 2, 3, dims)], 0.1);
    }

    #[test]
    fn geometry_exports_and_metadata_are_consistent_at_every_tier() {
        let parameters = Parameters::default();
        let mut layer_counts = Vec::new();
        for tier in TIERS {
            let occupancy = resample_occupancy(OFFICIAL_OCCUPANCY, tier.dims);
            let pitch = [
                BASE_PITCH_UM[0] * (BASE_DIMS[0] - 1) as f64 / (tier.dims[0] - 1) as f64,
                BASE_PITCH_UM[1] * (BASE_DIMS[1] - 1) as f64 / (tier.dims[1] - 1) as f64,
                BASE_PITCH_UM[2] * (BASE_DIMS[2] - 1) as f64 / (tier.dims[2] - 1) as f64,
            ];
            let schedule =
                build_scan_path(&occupancy, tier.dims, &parameters, pitch, BASE_ORIGIN_UM);
            assert!(schedule
                .layer_positions
                .windows(2)
                .all(|pair| pair[0] < pair[1]));
            assert!(schedule.layer_positions.last().copied().unwrap_or_default() > 17.0);
            assert!(schedule.layer_positions.windows(2).all(|pair| {
                let spacing = (pair[1] - pair[0]) as f64;
                (spacing - parameters.layer_height).abs() <= pitch[2] + 1e-5
                    || pair[1] == *schedule.layer_positions.last().expect("layer exists")
            }));
            layer_counts.push(schedule.layer_positions.len());
            let segments =
                build_scan_path_segments(&schedule.path, tier.dims, BASE_ORIGIN_UM, pitch);
            assert_eq!(segments.len() % 6, 0);
            assert!(packed_segment_length(&segments) > 0.0);
        }
        assert!(
            layer_counts.iter().max().unwrap() - layer_counts.iter().min().unwrap() <= 2,
            "physical layer count drifted by tier: {layer_counts:?}"
        );

        let mut simulation = minimal_simulation(parameters);
        let diagnostics = simulation.diagnostics();
        assert_eq!(diagnostics.layer_count, simulation.layer_positions.len());
        assert_eq!(simulation.scan_path_segments.len() % 6, 0);
        assert_eq!(
            diagnostics.path_length_um,
            packed_segment_length(&simulation.scan_path_segments)
        );
        let illuminated_path_length: f64 = (0..simulation.scan_path.len())
            .map(|index| {
                illuminated_distance_at(
                    &simulation.scan_path,
                    index,
                    simulation.dims,
                    simulation.pitch_um,
                )
            })
            .sum();
        assert!(
            (diagnostics.path_length_um - illuminated_path_length).abs()
                < diagnostics.path_length_um * 1e-6
        );
        assert_eq!(
            diagnostics.estimated_exposure_seconds,
            estimated_exposure_seconds(
                &simulation.scan_path,
                simulation.dims,
                simulation.pitch_um,
                &simulation.parameters,
            )
        );
        assert!(diagnostics.owned_memory_bytes <= diagnostics.memory_budget_bytes);
    }

    #[test]
    fn singleton_scan_hits_have_exported_finite_dwell() {
        let path = vec![ScanPoint {
            index: flatten(2, 2, 0, [5, 5, 1]) as u32,
            starts_segment: true,
        }];
        let pitch = [0.3, 0.4, 0.5];
        let segments = build_scan_path_segments(&path, [5, 5, 1], [0.0; 3], pitch);
        assert_eq!(segments.len(), 6);
        assert!((packed_segment_length(&segments) - 0.3).abs() < 1e-6);
        assert_eq!(illuminated_distance_at(&path, 0, [5, 5, 1], pitch), 0.3);
    }

    #[test]
    fn sparse_diffusion_expands_to_a_second_ring_and_zero_diffusion_does_not() {
        let mut simulation = minimal_simulation(Parameters::default());
        simulation.parameters.dark_loss = 0.0;
        simulation.parameters.oxygen_quench = 0.0;
        simulation.parameters.termination = 0.0;
        simulation.parameters.propagation = 0.0;
        simulation.parameters.pi_diffusion = 0.0;
        simulation.parameters.oxygen_diffusion = 0.0;
        simulation.parameters.radical_diffusion = 0.1;
        simulation.active.fill(0);
        simulation.active_indices.clear();
        simulation.active_frontier.clear();
        simulation.spare_frontier.clear();
        simulation.radicals.fill(0.0);
        let center = flatten(
            simulation.dims[0] / 2,
            simulation.dims[1] / 2,
            simulation.dims[2] / 2,
            simulation.dims,
        );
        simulation.radicals[center] = 1.0;
        simulation.activate_index(center);
        assert!(diffusion_substeps(1.0, &simulation.parameters, simulation.pitch_um) > 1);
        simulation.evolve_active_dark(1.0);
        let second_ring = center + 2;
        assert!(simulation.radicals[second_ring] > 0.0);
        let mass = simulation
            .radicals
            .iter()
            .map(|value| *value as f64)
            .sum::<f64>();
        assert!(
            (mass - 1.0).abs() < 1e-5,
            "diffusion changed mass to {mass}"
        );

        simulation.active.fill(0);
        simulation.active_indices.clear();
        simulation.active_frontier.clear();
        simulation.spare_frontier.clear();
        simulation.radicals.fill(0.0);
        simulation.radicals[center] = 1.0;
        simulation.parameters.radical_diffusion = 0.0;
        simulation.activate_index(center);
        simulation.evolve_active_dark(0.2);
        simulation.evolve_active_dark(0.2);
        assert_eq!(simulation.radicals[second_ring], 0.0);
        assert_eq!(simulation.radicals[center], 1.0);
    }

    #[test]
    fn every_volume_chemistry_control_changes_authoritative_fields() {
        let steps = 64;
        let mut baseline = minimal_simulation(Parameters::default());
        assert_eq!(baseline.advance_exposure_steps(steps), steps);
        let baseline_checksum = checksum(&baseline);
        let baseline_pi = baseline.photoinitiator.clone();
        let baseline_oxygen = baseline.oxygen.clone();
        let baseline_radicals = baseline.radicals.clone();
        let baseline_conversion = baseline.conversion.clone();
        assert!(baseline.conversion.iter().any(|value| *value > 0.0));
        assert!(baseline.photoinitiator.iter().all(|value| value.is_finite()
            && *value >= 0.0
            && *value <= baseline.parameters.initiator as f32));
        assert!(baseline.oxygen.iter().all(|value| value.is_finite()
            && *value >= 0.0
            && *value <= baseline.parameters.oxygen as f32));
        assert!(baseline.radicals.iter().all(|value| value.is_finite()
            && *value >= 0.0
            && *value <= MAX_RADICAL_ACTIVITY as f32));
        assert!(baseline
            .conversion
            .iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(value)));

        let mut controls: Vec<(&str, Parameters)> = Vec::new();
        controls.push((
            "initiator",
            Parameters {
                initiator: 0.0,
                ..Parameters::default()
            },
        ));
        controls.push((
            "piDepletion",
            Parameters {
                pi_depletion: 0.0,
                ..Parameters::default()
            },
        ));
        controls.push((
            "termination",
            Parameters {
                termination: 0.0,
                ..Parameters::default()
            },
        ));
        controls.push((
            "oxygenDiffusion",
            Parameters {
                oxygen_diffusion: 0.0,
                ..Parameters::default()
            },
        ));
        controls.push((
            "radicalDiffusion",
            Parameters {
                radical_diffusion: 0.0,
                ..Parameters::default()
            },
        ));
        controls.push((
            "piDiffusion",
            Parameters {
                pi_diffusion: 0.0,
                ..Parameters::default()
            },
        ));

        for (name, parameters) in controls {
            let mut variant = minimal_simulation(parameters);
            assert_eq!(variant.advance_exposure_steps(steps), steps);
            assert_ne!(checksum(&variant), baseline_checksum, "{name} checksum");
            match name {
                "initiator" => assert_ne!(variant.conversion, baseline_conversion),
                "piDepletion" | "piDiffusion" => {
                    assert_ne!(variant.photoinitiator, baseline_pi)
                }
                "oxygenDiffusion" => assert_ne!(variant.oxygen, baseline_oxygen),
                "termination" | "radicalDiffusion" => {
                    assert_ne!(variant.radicals, baseline_radicals)
                }
                _ => unreachable!(),
            }
        }
    }

    #[test]
    fn volume_replay_is_batch_independent_and_timeline_matches_estimate() {
        let mut one_step = minimal_simulation(Parameters::default());
        assert_eq!(one_step.scan_timing.len(), one_step.scan_path.len());
        assert_eq!(one_step.advance_exposure_steps(1), 1);
        assert!(one_step.simulated_time_seconds > 0.0);
        assert!(one_step.conversion.iter().any(|value| *value > 0.0));

        let mut single_batch = minimal_simulation(Parameters::default());
        let mut chunked = minimal_simulation(Parameters::default());
        let steps = single_batch.exposure_steps_total;
        assert_eq!(single_batch.advance_exposure_steps(steps), steps);
        let mut remaining = steps;
        while remaining > 0 {
            let chunk = remaining.min(7);
            assert_eq!(chunked.advance_exposure_steps(chunk), chunk);
            remaining -= chunk;
        }
        assert_eq!(single_batch.photoinitiator, chunked.photoinitiator);
        assert_eq!(single_batch.oxygen, chunked.oxygen);
        assert_eq!(single_batch.radicals, chunked.radicals);
        assert_eq!(single_batch.conversion, chunked.conversion);
        assert_eq!(checksum(&single_batch), checksum(&chunked));
        let diagnostics = single_batch.diagnostics();
        assert!(
            (diagnostics.simulated_time_seconds - diagnostics.estimated_exposure_seconds).abs()
                < 1e-10
        );
    }

    #[test]
    fn dynamic_diagnostics_refresh_only_when_requested() {
        let mut simulation = minimal_simulation(Parameters::default());
        let initial = simulation.cached_diagnostics();
        assert_eq!(simulation.advance_exposure_steps(1), 1);

        let cached = simulation.cached_diagnostics();
        assert_eq!(cached.exposure_step, 1);
        assert_eq!(cached.checksum, initial.checksum);
        assert_eq!(cached.conversion_mean, initial.conversion_mean);

        let refreshed = simulation.diagnostics();
        assert_ne!(refreshed.checksum, initial.checksum);
        assert!(refreshed.conversion_mean > initial.conversion_mean);
        assert_eq!(simulation.cached_diagnostics().checksum, refreshed.checksum);
    }

    #[test]
    fn development_and_statistics_cover_the_complete_target_mask() {
        let mut simulation = minimal_simulation(Parameters::default());
        assert!(simulation.active_indices.is_empty());
        let steps = simulation.development_steps_total;
        assert_eq!(simulation.advance_development_steps(steps), steps);
        assert_eq!(simulation.simulated_time_seconds, 0.0);
        assert!(simulation
            .occupied_indices
            .iter()
            .all(|index| simulation.developer_integral[*index as usize] > 0.0));
        assert!(simulation
            .occupied_indices
            .iter()
            .any(|index| simulation.remaining[*index as usize] < 0.5));
        let diagnostics = simulation.diagnostics();
        assert!(diagnostics.surviving_fraction < 1.0);
        assert_eq!(diagnostics.conversion_mean, 0.0);
        assert_eq!(diagnostics.gelled_fraction, 0.0);
    }

    #[test]
    fn development_reports_and_retains_gelled_off_target_spill() {
        let mut simulation = minimal_simulation(Parameters::default());
        let target = simulation.occupied_indices[0] as usize;
        let spill = neighbor_indices(target, simulation.dims)
            .into_iter()
            .find(|index| simulation.occupancy[*index] == 0)
            .expect("the target surface must touch surrounding resin");
        simulation.activate_index(spill);
        simulation.conversion[spill] = 1.0;
        let steps = simulation.development_steps_total;
        assert_eq!(simulation.advance_development_steps(steps), steps);
        let diagnostics = simulation.diagnostics();
        assert_eq!(diagnostics.off_target_active_voxels, 1);
        assert_eq!(diagnostics.off_target_gelled_fraction, 1.0);
        assert!(diagnostics.off_target_surviving_fraction > 0.0);
        assert!(simulation.remaining[spill] > 0.0);
    }

    #[test]
    fn xy_slice_exports_the_requested_authoritative_volume_plane() {
        let mut simulation = minimal_simulation(Parameters::default());
        let index = simulation.occupied_indices[simulation.occupied_indices.len() / 2] as usize;
        let [x, y, z] = index_to_ijk(index, simulation.dims);
        simulation.oxygen[index] = 0.25 * simulation.parameters.oxygen as f32;
        simulation.radicals[index] = 2.5;
        simulation.conversion[index] = 0.625;
        simulation.remaining[index] = 0.375;
        let requested_z = simulation.origin_um[2] + z as f64 * simulation.pitch_um[2];
        let width = simulation.dims[0];
        let height = simulation.dims[1];

        let slice = simulation.xy_slice_snapshot(requested_z).to_vec();
        let base = (x + width * y) * XY_SLICE_FIELD_COUNT;
        assert_eq!(slice.len(), width * height * XY_SLICE_FIELD_COUNT);
        assert_eq!(slice[base], 0.25);
        assert_eq!(slice[base + 1], 2.5);
        assert_eq!(slice[base + 2], 0.625);
        assert_eq!(slice[base + 3], 0.375);
        assert_eq!(slice[base + 4], 1.0);
        assert!((simulation.xy_slice_z_um() as f64 - requested_z).abs() < 1e-5);
    }

    #[test]
    fn full_benchy_exposure_reaches_lower_and_upper_features() {
        let mut simulation = WholeVolumeSimulation::try_new(
            WholeVolumeConfig {
                parameters: Parameters::default(),
                memory_budget_bytes: 64 * 1024 * 1024,
            },
            OFFICIAL_OCCUPANCY,
        )
        .expect("official occupancy should initialize");
        let steps = simulation.exposure_steps_total;
        assert_eq!(simulation.advance_exposure_steps(steps), steps);

        let upper_start = simulation.dims[2] * 3 / 4;
        let mut lower_max = 0.0_f32;
        let mut upper_max = 0.0_f32;
        for index in 0..simulation.conversion.len() {
            if simulation.occupancy[index] == 0 {
                continue;
            }
            let z = index_to_ijk(index, simulation.dims)[2];
            if z < simulation.dims[2] / 4 {
                lower_max = lower_max.max(simulation.conversion[index]);
            } else if z >= upper_start {
                upper_max = upper_max.max(simulation.conversion[index]);
            }
        }
        assert!(
            lower_max > simulation.parameters.gel_point as f32,
            "the hull conversion reached only {lower_max}"
        );
        assert!(
            upper_max > simulation.parameters.gel_point as f32,
            "the cabin conversion reached only {upper_max}"
        );
        assert!(
            simulation.focus[2] > 17.0,
            "the completed focus should reach the chimney"
        );
        let diagnostics = simulation.diagnostics();
        assert!(
            diagnostics.conversion_mean > 0.85,
            "high-NA target conversion regressed to {}",
            diagnostics.conversion_mean
        );
        assert!(
            diagnostics.gelled_fraction > 0.97,
            "high-NA target gel fraction regressed to {}",
            diagnostics.gelled_fraction
        );
        assert!(diagnostics.off_target_active_voxels > 0);
        assert!(diagnostics.off_target_conversion_mean > 0.0);
        assert!(diagnostics.render_voxels <= MAX_RENDER_VOXELS);
        assert!(
            diagnostics.owned_memory_bytes <= diagnostics.memory_budget_bytes,
            "full tier owns {} bytes against a {} byte budget",
            diagnostics.owned_memory_bytes,
            diagnostics.memory_budget_bytes
        );
        assert!(
            (diagnostics.simulated_time_seconds - diagnostics.estimated_exposure_seconds).abs()
                < 1e-10
        );
    }
}
