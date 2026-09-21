use serde::{Deserialize, Serialize};

use super::{invalid, Result};

/// Prescribed specimen temperature, never an inferred furnace temperature.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemperaturePoint {
    pub time_s: f64,
    pub temperature_k: f64,
}

pub fn validate(points: &[TemperaturePoint]) -> Result<()> {
    if !(2..=128).contains(&points.len()) || points[0].time_s != 0.0 {
        return Err(invalid(
            "schedule must start at zero and contain 2–128 points",
        ));
    }
    let mut previous = -1.0;
    for point in points {
        if !point.time_s.is_finite()
            || point.time_s <= previous
            || point.time_s > 604_800.0
            || !point.temperature_k.is_finite()
            || !(273.15..=1_673.15).contains(&point.temperature_k)
        {
            return Err(invalid(
                "schedule requires increasing seconds (up to 7 days) and 273.15–1673.15 K",
            ));
        }
        previous = point.time_s;
    }
    Ok(())
}

pub fn temperature(points: &[TemperaturePoint], time: f64) -> f64 {
    for pair in points.windows(2) {
        if time <= pair[1].time_s {
            let fraction = (time - pair[0].time_s) / (pair[1].time_s - pair[0].time_s);
            return pair[0].temperature_k
                + fraction * (pair[1].temperature_k - pair[0].temperature_k);
        }
    }
    points.last().expect("validated schedule").temperature_k
}

pub fn next_knot(points: &[TemperaturePoint], time: f64) -> f64 {
    points
        .iter()
        .find(|point| point.time_s > time)
        .map_or(time, |point| point.time_s)
}
