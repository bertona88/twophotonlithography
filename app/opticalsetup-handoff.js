const HANDOFF_SOURCE = 'opticalsetup';
const HANDOFF_VERSION = '1';
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const FIELDS = [
  { query: 'wavelengthNm', key: 'wavelength', label: 'wavelength', min: 500, max: 1064 },
  { query: 'sourcePowerMw', key: 'power', label: 'source power', min: 0, max: 1000 },
  { query: 'repetitionRateMHz', key: 'repetitionRate', label: 'repetition rate', min: 10, max: 100 },
  { query: 'pulseDurationFs', key: 'pulseDuration', label: 'pulse duration', min: 50, max: 400 },
  { query: 'numericalAperture', key: 'na', label: 'numerical aperture', min: 0.01, max: 1.49 },
];

function valuesFor(input, key) {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const value = input?.[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function singleValue(input, key) {
  const values = valuesFor(input, key);
  return values.length === 1 ? values[0] : null;
}

export function parseOpticalSetupHandoff(input = {}) {
  if (singleValue(input, 'from') !== HANDOFF_SOURCE
    || singleValue(input, 'v') !== HANDOFF_VERSION) return null;

  const basisValues = valuesFor(input, 'basis');
  const basis = basisValues.length === 0 ? undefined
    : basisValues.length === 1 && basisValues[0] === 'paper' ? 'paper'
      : null;
  if (basis === null) return null;

  const params = {};
  const imported = [];
  const rejected = [];

  for (const field of FIELDS) {
    const values = valuesFor(input, field.query);
    if (!values.length) continue;
    const raw = values.length === 1 ? values[0].trim() : '';
    const value = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
    if (values.length !== 1 || !Number.isFinite(value) || value < field.min || value > field.max) {
      rejected.push(field.label);
      continue;
    }
    params[field.key] = value;
    imported.push(field.key);
  }

  return { params, imported, rejected, ...(basis ? { basis } : {}) };
}

export function opticalSetupImportNotice(handoff) {
  if (!handoff) return null;
  if (!handoff.imported.length) {
    return 'The OpticalSetup link contained no setup values supported by this lab.';
  }

  const count = handoff.imported.length;
  let notice = `Imported ${count} compatible setup ${count === 1 ? 'parameter' : 'parameters'} from OpticalSetup.`;
  if (handoff.rejected.length) notice += ` Ignored invalid ${handoff.rejected.join(', ')}.`;
  if (handoff.basis === 'paper') {
    notice += ' This is a partial literature preset: only verified exact values were supplied; all other controls keep the lab defaults.';
  }
  if (handoff.imported.includes('power') && handoff.imported.includes('pulseDuration')) {
    notice += ' Source power and pulse duration were copied into specimen-plane controls; verify delivery losses and pulse broadening.';
  } else if (handoff.imported.includes('power')) {
    notice += ' Source power was copied into the specimen-plane power control; verify delivery losses.';
  } else if (handoff.imported.includes('pulseDuration')) {
    notice += ' Pulse duration was copied into the specimen-plane duration control; verify pulse broadening.';
  }
  if (handoff.basis === 'paper') {
    notice += handoff.imported.includes('na')
      ? ' NA comes from the literature preset, not a traced sample path.'
      : ' NA keeps the lab default because the literature subset supplies no NA.';
  } else {
    notice += handoff.imported.includes('na')
      ? ' NA was copied from the single objective traced to the sample.'
      : ' NA keeps the lab default because no single traced objective was supplied.';
  }
  notice += ' Scan, photoinitiator, bandwidth, and polarization settings keep the lab defaults; its optical model assumes circular polarization.';
  return notice;
}
