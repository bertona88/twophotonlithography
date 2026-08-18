import assert from "node:assert/strict";
import test from "node:test";

import {
  opticalSetupImportNotice,
  parseOpticalSetupHandoff,
} from "../app/opticalsetup-handoff.js";

const identity = {
  from: "opticalsetup",
  v: "1",
};

test("imports the four compatible OpticalSetup laser parameters", () => {
  const handoff = parseOpticalSetupHandoff({
    ...identity,
    wavelengthNm: "780",
    sourcePowerMw: "16",
    repetitionRateMHz: "80",
    pulseDurationFs: "100",
  });

  assert.deepEqual(handoff, {
    params: {
      wavelength: 780,
      power: 16,
      repetitionRate: 80,
      pulseDuration: 100,
    },
    imported: ["wavelength", "power", "repetitionRate", "pulseDuration"],
    rejected: [],
  });
  assert.match(opticalSetupImportNotice(handoff), /Imported 4 compatible laser parameters/);
  assert.match(opticalSetupImportNotice(handoff), /verify delivery losses and pulse broadening/);
});

test("accepts partial presets and exact destination boundaries", () => {
  const query = new URLSearchParams({
    ...identity,
    wavelengthNm: "500",
    sourcePowerMw: "1000",
    repetitionRateMHz: "100",
    pulseDurationFs: "400",
  });
  const handoff = parseOpticalSetupHandoff(query);
  assert.deepEqual(handoff.params, {
    wavelength: 500,
    power: 1000,
    repetitionRate: 100,
    pulseDuration: 400,
  });

  const partial = parseOpticalSetupHandoff({ ...identity, wavelengthNm: "1064" });
  assert.deepEqual(partial.params, { wavelength: 1064 });
  assert.deepEqual(partial.imported, ["wavelength"]);
});

test("rejects invalid supplied values without clamping valid neighbors", () => {
  const handoff = parseOpticalSetupHandoff({
    ...identity,
    wavelengthNm: "1065",
    sourcePowerMw: "",
    repetitionRateMHz: "Infinity",
    pulseDurationFs: ["100", "120"],
    ignoredFutureKey: "kept out of the model",
  });

  assert.deepEqual(handoff.params, {});
  assert.deepEqual(handoff.imported, []);
  assert.deepEqual(handoff.rejected, [
    "wavelength",
    "source power",
    "repetition rate",
    "pulse duration",
  ]);
  assert.match(opticalSetupImportNotice(handoff), /no laser values supported/);
});

test("accepts only the sender's canonical unsigned-decimal number grammar", () => {
  for (const raw of ["0x10", "+80", "080", "1e2", "80.", ".80", "-0"]) {
    const handoff = parseOpticalSetupHandoff({ ...identity, repetitionRateMHz: raw });
    assert.deepEqual(handoff.imported, [], raw);
    assert.deepEqual(handoff.rejected, ["repetition rate"], raw);
  }
  assert.deepEqual(
    parseOpticalSetupHandoff({ ...identity, repetitionRateMHz: "80.5" }).params,
    { repetitionRate: 80.5 },
  );
});

test("ignores unrelated, unsupported-version, and duplicate-identity queries", () => {
  assert.equal(parseOpticalSetupHandoff({ wavelengthNm: "780" }), null);
  assert.equal(parseOpticalSetupHandoff({ ...identity, v: "2", wavelengthNm: "780" }), null);
  assert.equal(parseOpticalSetupHandoff({ ...identity, from: ["opticalsetup", "other"] }), null);
  assert.equal(parseOpticalSetupHandoff({ ...identity, v: ["1", "1"] }), null);
  assert.equal(opticalSetupImportNotice(null), null);
});
