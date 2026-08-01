use serde::{Deserialize, Serialize};

use crate::{Parameters, ValidationError};

const BASE_DIMS: [usize; 3] = [128, 72, 104];
const BASE_ORIGIN_UM: [f64; 3] = [-11.357_723_577, -6.023_313_349, -0.175_549_622];
const BASE_PITCH_UM: [f64; 3] = [0.178_861_789, 0.169_670_799, 0.177_774_811];
const MAX_RENDER_VOXELS: usize = 60_000;
const TWO_PI: f64 = std::f64::consts::PI * 2.0;
const TWO_PHOTON_DOSE_RATE: f64 = 2_200.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeVolumeConfig {
    pub parameters: Parameters,
    pub memory_budget_bytes: usize,
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
    pub scan_points: usize,
    pub exposure_step: u32,
    pub exposure_steps_total: u32,
    pub development_step: u32,
    pub development_steps_total: u32,
    pub simulated_time_seconds: f64,
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
        memory_floor: 48 * 1024 * 1024,
    },
    Tier {
        name: "balanced",
        dims: [96, 54, 78],
        theta_samples: 10,
        phi_samples: 16,
        memory_floor: 24 * 1024 * 1024,
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

pub struct WholeVolumeSimulation {
    parameters: Parameters,
    tier: Tier,
    dims: [usize; 3],
    origin_um: [f64; 3],
    pitch_um: [f64; 3],
    memory_budget_bytes: usize,
    occupancy: Vec<u8>,
    oxygen: Vec<f32>,
    radicals: Vec<f32>,
    conversion: Vec<f32>,
    remaining: Vec<f32>,
    dose: Vec<f32>,
    developer_integral: Vec<f32>,
    active: Vec<u8>,
    active_indices: Vec<usize>,
    scan_path: Vec<usize>,
    render_indices: Vec<usize>,
    render_snapshot: Vec<f32>,
    psf_kernel: Vec<KernelVoxel>,
    exposure_step: u32,
    exposure_steps_total: u32,
    development_step: u32,
    development_steps_total: u32,
    simulated_time_seconds: f64,
    previous_focus: Option<usize>,
    focus: [f32; 3],
}

impl WholeVolumeSimulation {
    pub fn try_new(
        config: WholeVolumeConfig,
        base_occupancy: &[u8],
    ) -> Result<Self, ValidationError> {
        config.parameters.validate()?;
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
        let pitch_um = [
            BASE_PITCH_UM[0] * (BASE_DIMS[0] - 1) as f64 / (dims[0] - 1) as f64,
            BASE_PITCH_UM[1] * (BASE_DIMS[1] - 1) as f64 / (dims[1] - 1) as f64,
            BASE_PITCH_UM[2] * (BASE_DIMS[2] - 1) as f64 / (dims[2] - 1) as f64,
        ];
        let occupancy = resample_occupancy(base_occupancy, dims);
        let parameters = config.parameters;
        let scan_path = build_scan_path(&occupancy, dims, &parameters, pitch_um);
        let occupied_indices: Vec<usize> = occupancy
            .iter()
            .enumerate()
            .filter_map(|(index, occupied)| (*occupied != 0).then_some(index))
            .collect();
        let render_indices = sample_indices(&occupied_indices, MAX_RENDER_VOXELS);
        let mut simulation = Self {
            oxygen: vec![parameters.oxygen as f32; len],
            radicals: vec![0.0; len],
            conversion: vec![0.0; len],
            remaining: vec![1.0; len],
            dose: vec![0.0; len],
            developer_integral: vec![0.0; len],
            active: vec![0; len],
            active_indices: Vec::with_capacity((len / 8).max(1024)),
            render_snapshot: vec![0.0; render_indices.len() * 7],
            psf_kernel: Vec::new(),
            exposure_step: 0,
            exposure_steps_total: schedule_steps(scan_path.len(), parameters.passes),
            development_step: 0,
            development_steps_total: 180,
            simulated_time_seconds: 0.0,
            previous_focus: None,
            focus: [0.0, 0.0, 7.0],
            parameters,
            tier,
            dims,
            origin_um: BASE_ORIGIN_UM,
            pitch_um,
            memory_budget_bytes: config.memory_budget_bytes,
            occupancy,
            scan_path,
            render_indices,
        };
        simulation.rebuild_psf();
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
        self.parameters = parameters;
        if slicing_changed {
            self.scan_path =
                build_scan_path(&self.occupancy, self.dims, &self.parameters, self.pitch_um);
        }
        self.exposure_steps_total = schedule_steps(self.scan_path.len(), self.parameters.passes);
        if optics_changed {
            self.rebuild_psf();
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.oxygen.fill(self.parameters.oxygen as f32);
        self.radicals.fill(0.0);
        self.conversion.fill(0.0);
        self.remaining.fill(1.0);
        self.dose.fill(0.0);
        self.developer_integral.fill(0.0);
        self.active.fill(0);
        self.active_indices.clear();
        self.exposure_step = 0;
        self.development_step = 0;
        self.simulated_time_seconds = 0.0;
        self.previous_focus = None;
        self.focus = [0.0, 0.0, 7.0];
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
        let pitch_distance =
            (self.pitch_um[0] * self.pitch_um[0] + self.pitch_um[1] * self.pitch_um[1]).sqrt();
        let illuminated_dt = pitch_distance / self.parameters.speed.max(1e-9);
        let mut elapsed = 0.0;

        // A UI step is a scheduling bucket, not one oversized focal event.
        // Visit every scan target in the bucket so thin walls, roofs, and the
        // chimney cannot disappear from the simulated exposure.
        for target in start..end {
            let focus_index = self.scan_path[target % self.scan_path.len()];
            let focus_xyz = self.xyz(focus_index);
            if let Some(previous) = self.previous_focus {
                let a = self.xyz(previous);
                let distance = ((a[0] - focus_xyz[0]).powi(2)
                    + (a[1] - focus_xyz[1]).powi(2)
                    + (a[2] - focus_xyz[2]).powi(2))
                .sqrt();
                if distance > pitch_distance * 2.5 {
                    let jump_speed = (self.parameters.speed * 8.0).max(200.0);
                    elapsed += distance / jump_speed;
                }
            }
            self.deposit_psf(focus_index, illuminated_dt);
            elapsed += illuminated_dt;
            self.previous_focus = Some(focus_index);
            self.focus = [
                focus_xyz[0] as f32,
                focus_xyz[1] as f32,
                focus_xyz[2] as f32,
            ];
        }
        self.evolve_active_dark(elapsed);
        self.simulated_time_seconds += elapsed;
    }

    fn deposit_psf(&mut self, focus_index: usize, dt: f64) {
        let [fx, fy, fz] = index_to_ijk(focus_index, self.dims);
        let pulse_factor = (self.parameters.power / 16.0).powi(2)
            * (80.0 / self.parameters.repetition_rate)
            * (100.0 / self.parameters.pulse_duration);
        let dose_scale = (pulse_factor * dt * TWO_PHOTON_DOSE_RATE).max(0.0) as f32;
        for kernel_index in 0..self.psf_kernel.len() {
            let kernel = &self.psf_kernel[kernel_index];
            let x = fx as isize + kernel.dx;
            let y = fy as isize + kernel.dy;
            let z = fz as isize + kernel.dz;
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
            if self.active[index] == 0 {
                self.active[index] = 1;
                self.active_indices.push(index);
            }
            let increment = dose_scale * kernel.weight;
            self.dose[index] += increment;
            let oxygen = self.oxygen[index] as f64;
            let quench = 1.0 - (-self.parameters.oxygen_quench * increment as f64 * 0.018).exp();
            self.oxygen[index] = (oxygen * (1.0 - quench)).max(0.0) as f32;
            let inhibition = 1.0 / (1.0 + 4.0 * self.oxygen[index] as f64);
            let radicals = increment as f64 * self.parameters.radical_yield * inhibition;
            self.radicals[index] = (self.radicals[index] as f64 + radicals).min(8.0) as f32;
            let propagation = self.parameters.propagation * radicals * 0.18;
            let next_conversion =
                1.0 - (1.0 - self.conversion[index] as f64) * (-propagation).exp();
            self.conversion[index] = next_conversion.clamp(0.0, 1.0) as f32;
        }
    }

    fn evolve_active_dark(&mut self, dt: f64) {
        if dt <= 0.0 {
            return;
        }
        let oxygen_eq = self.parameters.oxygen as f32;
        let oxygen_recovery = 1.0 - (-self.parameters.oxygen_diffusion * dt * 14.0).exp();
        let radical_decay = (-self.parameters.dark_loss * dt).exp();
        for position in 0..self.active_indices.len() {
            let index = self.active_indices[position];
            let oxygen = self.oxygen[index] as f64;
            self.oxygen[index] = (oxygen + (oxygen_eq as f64 - oxygen) * oxygen_recovery) as f32;
            let radical = self.radicals[index] as f64;
            let terminated = radical
                * (-(self.parameters.dark_loss
                    + self.parameters.oxygen_quench * self.oxygen[index] as f64)
                    * dt)
                    .exp()
                * radical_decay;
            self.radicals[index] = terminated.clamp(0.0, 8.0) as f32;
        }
    }

    pub fn advance_development_steps(&mut self, requested: u32) -> u32 {
        let count = requested.min(
            self.development_steps_total
                .saturating_sub(self.development_step),
        );
        let dt = self.parameters.development_time / self.development_steps_total as f64;
        for _ in 0..count {
            for position in 0..self.active_indices.len() {
                let index = self.active_indices[position];
                let [x, y, z] = index_to_ijk(index, self.dims);
                let edge = x
                    .min(self.dims[0] - 1 - x)
                    .min(y.min(self.dims[1] - 1 - y))
                    .min(z.min(self.dims[2] - 1 - z)) as f64;
                let depth_um =
                    (edge + 0.5) * self.pitch_um[0].min(self.pitch_um[1]).min(self.pitch_um[2]);
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
            self.development_step += 1;
            self.simulated_time_seconds += dt;
        }
        count
    }

    fn rebuild_psf(&mut self) {
        self.psf_kernel = build_vectorial_psf(
            self.parameters.na,
            self.parameters.wavelength,
            self.tier,
            self.pitch_um,
        );
    }

    fn xyz(&self, index: usize) -> [f64; 3] {
        let [x, y, z] = index_to_ijk(index, self.dims);
        [
            self.origin_um[0] + x as f64 * self.pitch_um[0],
            self.origin_um[1] + y as f64 * self.pitch_um[1],
            self.origin_um[2] + z as f64 * self.pitch_um[2],
        ]
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

    pub fn diagnostics(&self) -> VolumeDiagnostics {
        let owned_memory_bytes = self.occupancy.capacity()
            + self.oxygen.capacity() * 4
            + self.radicals.capacity() * 4
            + self.conversion.capacity() * 4
            + self.remaining.capacity() * 4
            + self.dose.capacity() * 4
            + self.developer_integral.capacity() * 4
            + self.active.capacity()
            + self.active_indices.capacity() * std::mem::size_of::<usize>()
            + self.scan_path.capacity() * std::mem::size_of::<usize>()
            + self.render_snapshot.capacity() * 4;
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
            psf_model: "vectorial Debye / circular polarization / two-photon I²",
            psf_pupil_samples: self.tier.theta_samples * self.tier.phi_samples,
            psf_kernel_voxels: self.psf_kernel.len(),
            scan_points: self.scan_path.len(),
            exposure_step: self.exposure_step,
            exposure_steps_total: self.exposure_steps_total,
            development_step: self.development_step,
            development_steps_total: self.development_steps_total,
            simulated_time_seconds: self.simulated_time_seconds,
            checksum: checksum(self),
        }
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
) -> Vec<usize> {
    let mut path = Vec::new();
    let layer_stride = (parameters.layer_height / pitch_um[2]).round().max(1.0) as usize;
    let hatch_stride = (parameters.hatch_spacing / pitch_um[1]).round().max(1.0) as usize;
    for z in (0..dims[2]).step_by(layer_stride) {
        let rotate = ((parameters.hatch_angle + (z / layer_stride % 2) as f64 * 90.0)
            .to_radians()
            .cos())
        .abs()
            < 0.5;
        if rotate {
            for x in (0..dims[0]).step_by(hatch_stride) {
                if (x + z) % 2 == 0 {
                    for y in 0..dims[1] {
                        let index = flatten(x, y, z, dims);
                        if occupancy[index] != 0 {
                            path.push(index);
                        }
                    }
                } else {
                    for y in (0..dims[1]).rev() {
                        let index = flatten(x, y, z, dims);
                        if occupancy[index] != 0 {
                            path.push(index);
                        }
                    }
                }
            }
            continue;
        }
        for y in (0..dims[1]).step_by(hatch_stride) {
            if (y + z) % 2 == 0 {
                for x in 0..dims[0] {
                    let index = flatten(x, y, z, dims);
                    if occupancy[index] != 0 {
                        path.push(index);
                    }
                }
            } else {
                for x in (0..dims[0]).rev() {
                    let index = flatten(x, y, z, dims);
                    if occupancy[index] != 0 {
                        path.push(index);
                    }
                }
            }
        }
    }
    path
}

fn sample_indices(source: &[usize], maximum: usize) -> Vec<usize> {
    if source.len() <= maximum {
        return source.to_vec();
    }
    (0..maximum)
        .map(|index| source[index * (source.len() - 1) / (maximum - 1)])
        .collect()
}

fn build_vectorial_psf(
    na: f64,
    wavelength_nm: f64,
    tier: Tier,
    pitch: [f64; 3],
) -> Vec<KernelVoxel> {
    let wavelength_um = wavelength_nm * 1e-3;
    let refractive_index = 1.52_f64;
    let theta_max = (na / refractive_index).clamp(0.0, 0.999_999).asin();
    let lateral = 0.61 * wavelength_um / na.max(0.1);
    let axial = 2.0 * refractive_index * wavelength_um / na.max(0.1).powi(2);
    let rx = ((2.4 * lateral / pitch[0]).ceil() as isize).clamp(2, 10);
    let ry = ((2.4 * lateral / pitch[1]).ceil() as isize).clamp(2, 10);
    let rz = ((2.2 * axial / pitch[2]).ceil() as isize).clamp(3, 18);
    let wave_number = TWO_PI * refractive_index / wavelength_um;
    let inv_sqrt_two = 1.0 / 2.0_f64.sqrt();
    let mut raw = Vec::new();
    let mut peak = 0.0_f64;

    for dz in -rz..=rz {
        for dy in -ry..=ry {
            for dx in -rx..=rx {
                let x = dx as f64 * pitch[0];
                let y = dy as f64 * pitch[1];
                let z = dz as f64 * pitch[2];
                let mut field = [[Complex::default(); 2]; 3];
                for ti in 0..tier.theta_samples {
                    let theta = theta_max * (ti as f64 + 0.5) / tier.theta_samples as f64;
                    let sin_theta = theta.sin();
                    let cos_theta = theta.cos();
                    let apodization = cos_theta.sqrt() * sin_theta;
                    for pi in 0..tier.phi_samples {
                        let phi = TWO_PI * (pi as f64 + 0.5) / tier.phi_samples as f64;
                        let sx = sin_theta * phi.cos();
                        let sy = sin_theta * phi.sin();
                        let sz = cos_theta;
                        let phase = wave_number * (x * sx + y * sy + z * (sz - 1.0));
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
                            field[component][0].add_phase(
                                amplitudes[component].0 * apodization,
                                amplitudes[component].1 * apodization,
                                phase,
                            );
                        }
                    }
                }
                let intensity = field.iter().map(|pair| pair[0].norm_squared()).sum::<f64>();
                let two_photon = intensity * intensity;
                peak = peak.max(two_photon);
                raw.push((dx, dy, dz, two_photon));
            }
        }
    }
    raw.into_iter()
        .filter_map(|(dx, dy, dz, value)| {
            let weight = (value / peak.max(1e-30)) as f32;
            (weight >= 0.0005).then_some(KernelVoxel { dx, dy, dz, weight })
        })
        .collect()
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

fn checksum(simulation: &WholeVolumeSimulation) -> String {
    let mut hash = 2_166_136_261_u32;
    let stride = (simulation.conversion.len() / 4096).max(1);
    for index in (0..simulation.conversion.len()).step_by(stride) {
        for byte in simulation.conversion[index].to_bits().to_le_bytes() {
            hash ^= byte as u32;
            hash = hash.wrapping_mul(16_777_619);
        }
        for byte in simulation.remaining[index].to_bits().to_le_bytes() {
            hash ^= byte as u32;
            hash = hash.wrapping_mul(16_777_619);
        }
    }
    format!("{hash:08x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_selection_is_monotonic() {
        assert_eq!(select_tier(64 * 1024 * 1024).name, "full");
        assert_eq!(select_tier(30 * 1024 * 1024).name, "balanced");
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
    fn full_benchy_exposure_reaches_lower_and_upper_features() {
        let occupancy = include_bytes!("../../../public/benchy/3dbenchy-occupancy.bin");
        let mut simulation = WholeVolumeSimulation::try_new(
            WholeVolumeConfig {
                parameters: Parameters::default(),
                memory_budget_bytes: 64 * 1024 * 1024,
            },
            occupancy,
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
    }
}
