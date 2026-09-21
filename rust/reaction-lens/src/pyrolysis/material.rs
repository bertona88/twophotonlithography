use serde::{Deserialize, Serialize};

use super::{invalid, Diagnostic, Result};

/// Hypothetical, inert, one-way P -> y C + (1-y) V. No elemental or sp² claim.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub version: String,
    pub reaction_a_per_s: f64,
    pub reaction_e_j_mol: f64,
    pub char_yield: f64,
    pub network_a_per_s: f64,
    pub network_e_j_mol: f64,
    pub polymer_density_kg_m3: f64,
    pub char_density_kg_m3: f64,
    pub network_density_gain_kg_m3: f64,
    pub initial_porosity: f64,
    pub transient_porosity: f64,
    pub diffusivity_m2_s: f64,
    pub network_diffusivity_gain: f64,
    pub surface_transfer_m_s: f64,
    pub min_solid_fraction: f64,
    pub min_density_kg_m3: f64,
    pub min_jacobian: f64,
    pub max_porosity: f64,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            version: "inert-demo-v1".into(),
            reaction_a_per_s: 2.0e5,
            reaction_e_j_mol: 110_000.0,
            char_yield: 0.25,
            network_a_per_s: 2.0e4,
            network_e_j_mol: 120_000.0,
            polymer_density_kg_m3: 1_200.0,
            char_density_kg_m3: 1_600.0,
            network_density_gain_kg_m3: 200.0,
            initial_porosity: 0.05,
            transient_porosity: 0.15,
            diffusivity_m2_s: 1.0e-15,
            network_diffusivity_gain: 1.0,
            surface_transfer_m_s: 1.0e-7,
            min_solid_fraction: 1.0e-6,
            min_density_kg_m3: 1.0,
            min_jacobian: 1.0e-8,
            max_porosity: 0.95,
        }
    }
}

impl Material {
    pub fn validate(&self) -> Result<()> {
        if self.version != "inert-demo-v1" {
            return Err(invalid("unsupported material version"));
        }
        for (name, value, lo, hi) in [
            ("reaction A", self.reaction_a_per_s, 0.0, 1e15),
            ("reaction E", self.reaction_e_j_mol, 0.0, 1e6),
            ("char yield", self.char_yield, 0.0, 1.0),
            ("network A", self.network_a_per_s, 0.0, 1e15),
            ("network E", self.network_e_j_mol, 0.0, 1e6),
            ("polymer density", self.polymer_density_kg_m3, 1.0, 1e5),
            ("char density", self.char_density_kg_m3, 1.0, 1e5),
            (
                "network density gain",
                self.network_density_gain_kg_m3,
                0.0,
                1e5,
            ),
            ("initial porosity", self.initial_porosity, 0.0, 0.999),
            ("transient porosity", self.transient_porosity, 0.0, 1.0),
            ("diffusivity", self.diffusivity_m2_s, 0.0, 1e-6),
            (
                "network diffusivity gain",
                self.network_diffusivity_gain,
                0.0,
                100.0,
            ),
            ("surface transfer", self.surface_transfer_m_s, 0.0, 1.0),
            ("minimum solid", self.min_solid_fraction, 1e-12, 0.999),
            ("minimum density", self.min_density_kg_m3, 1e-6, 1e5),
            ("minimum Jacobian", self.min_jacobian, 1e-12, 0.999),
            ("maximum porosity", self.max_porosity, 0.0, 0.9999),
        ] {
            if !value.is_finite() || !(lo..=hi).contains(&value) {
                return Err(invalid(&format!(
                    "{name} must be finite and in [{lo}, {hi}]"
                )));
            }
        }
        self.properties(1.0, 0.0, 0.0, 0, 0.0)?;
        Ok(())
    }

    pub fn initial_density(&self) -> f64 {
        (1.0 - self.initial_porosity) * self.polymer_density_kg_m3
    }

    /// Returns (micro-porosity, stress-free bulk density, natural volume ratio).
    /// This is a constitutive diagnostic; it is NOT solved deformation.
    pub fn properties(
        &self,
        p: f64,
        c: f64,
        order: f64,
        cell: usize,
        time: f64,
    ) -> Result<[f64; 3]> {
        let solid = p + c;
        let check = |quantity: &str, value: f64, bound: f64, lower: bool| {
            if !value.is_finite() || if lower { value < bound } else { value > bound } {
                Err(Diagnostic {
                    code: "material-state-out-of-domain".into(),
                    message: format!("{quantity} violates the material validity domain; last accepted state retained"),
                    quantity: quantity.into(), value, bound, cell: Some(cell), trial_time_s: time,
                })
            } else {
                Ok(())
            }
        };
        check(
            "retained-solid-fraction",
            solid,
            self.min_solid_fraction,
            true,
        )?;
        let char_fraction = c / solid;
        let porosity =
            self.initial_porosity + self.transient_porosity * char_fraction * (1.0 - order);
        check("micro-porosity", porosity, self.max_porosity, false)?;
        let skeleton = (1.0 - char_fraction) * self.polymer_density_kg_m3
            + char_fraction * (self.char_density_kg_m3 + order * self.network_density_gain_kg_m3);
        let density = (1.0 - porosity) * skeleton;
        check("free-density-kg-m3", density, self.min_density_kg_m3, true)?;
        let jacobian = solid * self.initial_density() / density;
        check("natural-jacobian", jacobian, self.min_jacobian, true)?;
        Ok([porosity, density, jacobian])
    }
}

pub fn arrhenius(a: f64, e: f64, temperature_k: f64) -> f64 {
    a * (-e / (8.314_462_618 * temperature_k)).exp()
}
