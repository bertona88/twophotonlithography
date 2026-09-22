"use client";
import { useState } from "react";

export default function DrySpecimenControls({ available, gelPoint, onExport }: {
  available: boolean; gelPoint: number; onExport: (density: number, remaining: number) => void;
}) {
  const [density, setDensity] = useState(1200);
  const [remaining, setRemaining] = useState(0.01);
  return <section className="dry-specimen-controls" aria-label="Dry specimen preparation">
    <h3>Prepare a dry specimen</h3>
    <p className="sheet-note">Uncalibrated wash/dry assumption: dry mass = density × voxel volume × remaining × conversion. Unconverted material is washed out; cells below the stated thresholds are excluded and accounted for. Surviving off-target polymer and disconnected fragments are retained.</p>
    <label>Dry polymer density (kg/m³)<input type="number" min="1" max="100000" value={density} onChange={e => setDensity(e.target.valueAsNumber)} /></label>
    <label>Minimum retained fraction<input type="number" min="0.000001" max="1" step="0.01" value={remaining} onChange={e => setRemaining(e.target.valueAsNumber)} /></label>
    <p className="sheet-note">Minimum conversion: {gelPoint} (current gel point). Face contacts define connectivity. No measured residual-species or residual-stress model is available.</p>
    <button type="button" disabled={!available} onClick={() => onExport(density, remaining)}>Export full-resolution dry specimen</button>
    {!available && <p className="sheet-note">Complete development to prepare the authoritative volume.</p>}
    <a href="/carbonization">Open the radial Carbonization Lab ↗</a>
  </section>;
}
