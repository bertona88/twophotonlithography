//! Audited full-resolution export of the developed volume. Preparation is an
//! explicit hypothetical wash/dry rule, not a calibration of `remaining`.
use serde::{Deserialize, Serialize};

use super::{invalid, Result};
use crate::Parameters;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparationPolicy {
    pub dry_polymer_density_kg_m3: f64,
    pub min_conversion: f64,
    pub min_remaining: f64,
    pub memory_budget_bytes: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecimenCell {
    pub source_index: u32,
    pub component: u32,
    pub on_target: bool,
    pub solid_fraction: f64,
    pub dry_mass_kg: f64,
    pub conversion: f32,
    pub remaining: f32,
    pub photoinitiator: f32,
    pub oxygen: f32,
    pub radicals: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationLedger {
    pub input_retained_inventory_kg: f64,
    pub dry_polymer_mass_kg: f64,
    pub removed_soluble_mass_kg: f64,
    pub excluded_polymer_mass_kg: f64,
    pub off_target_dry_mass_kg: f64,
    pub components: u32,
    pub selected_cells: usize,
    pub near_threshold_cells: usize,
    pub near_threshold_polymer_mass_kg: f64,
    pub relative_balance_error: f64,
    pub estimated_peak_bytes: usize,
}

/// Owned immutable handoff: no rendering thresholds or sampled buffers enter.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevelopedSpecimen {
    pub schema_version: u32,
    pub model_version: String,
    pub source_checksum: String,
    pub source_parameters: Parameters,
    pub dims: [usize; 3],
    pub origin_m: [f64; 3],
    pub pitch_m: [f64; 3],
    pub policy: PreparationPolicy,
    pub assumptions: Vec<String>,
    pub ledger: PreparationLedger,
    pub cells: Vec<SpecimenCell>,
}

pub struct PreparationInput<'a> {
    pub dims: [usize; 3],
    pub origin_um: [f64; 3],
    pub pitch_um: [f64; 3],
    pub source_checksum: String,
    pub parameters: &'a Parameters,
    pub source_memory_bytes: usize,
    pub occupancy: &'a [u8],
    pub active: &'a [u8],
    pub conversion: &'a [f32],
    pub remaining: &'a [f32],
    pub photoinitiator: &'a [f32],
    pub oxygen: &'a [f32],
    pub radicals: &'a [f32],
}

pub fn prepare(
    input: PreparationInput<'_>,
    policy: PreparationPolicy,
) -> Result<DevelopedSpecimen> {
    if !policy.dry_polymer_density_kg_m3.is_finite()
        || !(1.0..=1e5).contains(&policy.dry_polymer_density_kg_m3)
        || !policy.min_conversion.is_finite()
        || !(input.parameters.gel_point..=1.0).contains(&policy.min_conversion)
        || !policy.min_remaining.is_finite()
        || !(1e-6..=1.0).contains(&policy.min_remaining)
    {
        return Err(invalid("preparation requires positive dry density, a conversion threshold at/above gel, and positive retention threshold"));
    }
    let count = input
        .dims
        .iter()
        .try_fold(1_usize, |n, &v| n.checked_mul(v))
        .filter(|&n| n > 0 && n <= u32::MAX as usize)
        .ok_or_else(|| invalid("invalid specimen dimensions"))?;
    if input.origin_um.iter().any(|v| !v.is_finite())
        || input.pitch_um.iter().any(|v| !v.is_finite() || *v <= 0.0)
        || [
            input.occupancy.len(),
            input.active.len(),
            input.conversion.len(),
            input.remaining.len(),
            input.photoinitiator.len(),
            input.oxygen.len(),
            input.radicals.len(),
        ]
        .iter()
        .any(|&n| n != count)
    {
        return Err(invalid(
            "specimen geometry or full-resolution field lengths are invalid",
        ));
    }
    if input
        .conversion
        .iter()
        .chain(input.remaining)
        .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        || input
            .photoinitiator
            .iter()
            .chain(input.oxygen)
            .chain(input.radicals)
            .any(|v| !v.is_finite() || *v < 0.0)
    {
        return Err(invalid("invalid source material fields"));
    }
    let eligible = |i: usize| input.occupancy[i] != 0 || input.active[i] != 0;
    let selected = |i: usize| {
        eligible(i)
            && input.conversion[i] as f64 >= policy.min_conversion
            && input.remaining[i] as f64 >= policy.min_remaining
    };
    let selected_count = (0..count).filter(|&i| selected(i)).count();
    if selected_count == 0 {
        return Err(invalid(
            "preparation found no load-bearing polymer under the stated extraction policy",
        ));
    }
    let peak = input
        .source_memory_bytes
        .saturating_add(count.saturating_mul(8))
        // Include Rust cells, sender/receiver JS objects and JSON/Blob copies.
        .saturating_add(selected_count.saturating_mul(2_048))
        .saturating_add(65_536);
    if peak > policy.memory_budget_bytes {
        return Err(invalid(
            "specimen preparation exceeds peak-memory budget; no physical cells were removed",
        ));
    }
    let mut labels = Vec::<u32>::new();
    labels
        .try_reserve_exact(count)
        .map_err(|_| invalid("could not allocate specimen connectivity"))?;
    labels.resize(count, 0);
    let mut queue = Vec::<usize>::new();
    queue
        .try_reserve_exact(selected_count)
        .map_err(|_| invalid("could not allocate connectivity queue"))?;
    let mut cells = Vec::new();
    cells
        .try_reserve_exact(selected_count)
        .map_err(|_| invalid("could not allocate owned specimen"))?;
    let mut components = 0;
    let [nx, ny, nz] = input.dims;
    for seed in 0..count {
        if !selected(seed) || labels[seed] != 0 {
            continue;
        }
        components += 1;
        labels[seed] = components;
        queue.clear();
        queue.push(seed);
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let x = i % nx;
            let y = (i / nx) % ny;
            let z = i / (nx * ny);
            for (valid, next) in [
                (x > 0, i.wrapping_sub(1)),
                (x + 1 < nx, i + 1),
                (y > 0, i.wrapping_sub(nx)),
                (y + 1 < ny, i + nx),
                (z > 0, i.wrapping_sub(nx * ny)),
                (z + 1 < nz, i + nx * ny),
            ] {
                if valid && labels[next] == 0 && selected(next) {
                    labels[next] = components;
                    queue.push(next);
                }
            }
        }
    }
    let pitch_m = input.pitch_um.map(|p| p * 1e-6);
    let full_mass = pitch_m.iter().product::<f64>() * policy.dry_polymer_density_kg_m3;
    let mut ledger = PreparationLedger {
        input_retained_inventory_kg: 0.0,
        dry_polymer_mass_kg: 0.0,
        removed_soluble_mass_kg: 0.0,
        excluded_polymer_mass_kg: 0.0,
        off_target_dry_mass_kg: 0.0,
        components,
        selected_cells: selected_count,
        near_threshold_cells: 0,
        near_threshold_polymer_mass_kg: 0.0,
        relative_balance_error: 0.0,
        estimated_peak_bytes: peak,
    };
    for (i, &component) in labels.iter().enumerate() {
        if !eligible(i) {
            continue;
        }
        let remaining = input.remaining[i] as f64;
        let conversion = input.conversion[i] as f64;
        let solid_fraction = remaining * conversion;
        let mass = full_mass * solid_fraction;
        ledger.input_retained_inventory_kg += full_mass * remaining;
        ledger.removed_soluble_mass_kg += full_mass * remaining * (1.0 - conversion);
        // Report extraction sensitivity without silently changing topology.
        if (conversion - policy.min_conversion).abs() <= 0.02
            || (remaining - policy.min_remaining).abs() <= 0.02
        {
            ledger.near_threshold_cells += 1;
            ledger.near_threshold_polymer_mass_kg += mass;
        }
        if component == 0 {
            ledger.excluded_polymer_mass_kg += mass;
            continue;
        }
        ledger.dry_polymer_mass_kg += mass;
        if input.occupancy[i] == 0 {
            ledger.off_target_dry_mass_kg += mass;
        }
        cells.push(SpecimenCell {
            source_index: i as u32,
            component,
            on_target: input.occupancy[i] != 0,
            solid_fraction,
            dry_mass_kg: mass,
            conversion: input.conversion[i],
            remaining: input.remaining[i],
            photoinitiator: input.photoinitiator[i],
            oxygen: input.oxygen[i],
            radicals: input.radicals[i],
        });
    }
    ledger.relative_balance_error = (ledger.dry_polymer_mass_kg
        + ledger.removed_soluble_mass_kg
        + ledger.excluded_polymer_mass_kg)
        / ledger.input_retained_inventory_kg
        - 1.0;
    Ok(DevelopedSpecimen {
        schema_version: 1, model_version: "dry-extraction-demo-v1".into(), source_checksum: input.source_checksum, source_parameters: input.parameters.clone(),
        dims: input.dims, origin_m: input.origin_um.map(|p| p * 1e-6), pitch_m, policy, ledger, cells,
        assumptions: vec![
            "Uncalibrated extraction: dry mass = dry polymer density × cell volume × remaining × conversion; retention counted once".into(),
            "Unconverted retained material is washed out; retained chemical species are unknown, not measured zero".into(),
            "Initially stress-free dry reference; drying and cure residual stress are unknown".into(),
            "Six-face connectivity only; edge/point contacts do not weld components; all fragments retained".into(),
            "No support/interface classification or mechanical coarsening; unresolved connections require review".into(),
            "Oxygen, radicals and photoinitiator are printing metadata, not furnace gases; source time is not calibrated pyrolysis time".into(),
        ],
    })
}
