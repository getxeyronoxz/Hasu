/**
 * Accent colour: the generated 50..950 scale and the server-side validation of
 * `appearance.accent`. Run: node --import tsx --test tests/accent.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ACCENT_STEPS, DEFAULT_ACCENT, PRESET_ACCENTS, accentScale, hexToOklch } from "../src/lib/accent";
import { DEFAULT_APP_SETTINGS, normalizeSettings, patchSettings } from "../settings/appSettings";

const HEX = /^#[0-9a-f]{6}$/;

test("accentScale returns 11 valid hex steps with the base as step 400", () => {
  for (const { hex } of PRESET_ACCENTS) {
    const scale = accentScale(hex);
    assert.deepEqual(Object.keys(scale), [...ACCENT_STEPS]);
    assert.equal(ACCENT_STEPS.length, 11);
    for (const step of ACCENT_STEPS) assert.match(scale[step], HEX, `${hex} step ${step}`);
    assert.equal(scale["400"], hex);
  }
});

test("accentScale lightness falls monotonically from 50 to 950", () => {
  for (const { hex } of PRESET_ACCENTS) {
    const scale = accentScale(hex);
    const lightness = ACCENT_STEPS.map((step) => hexToOklch(scale[step]).L);
    for (let i = 1; i < lightness.length; i++) {
      assert.ok(lightness[i - 1] > lightness[i], `${hex}: step ${ACCENT_STEPS[i - 1]} must be lighter than ${ACCENT_STEPS[i]}`);
    }
  }
  // Extreme picks never invert the order, even when neighbouring steps collapse.
  for (const hex of ["#ffffff", "#000000", "#808080"]) {
    const scale = accentScale(hex);
    const lightness = ACCENT_STEPS.map((step) => hexToOklch(scale[step]).L);
    for (let i = 1; i < lightness.length; i++) assert.ok(lightness[i - 1] >= lightness[i] - 0.01, `${hex} step ${ACCENT_STEPS[i]}`);
  }
});

test("steps 300 and 500 stay close to the picked colour", () => {
  for (const { hex } of PRESET_ACCENTS) {
    const base = hexToOklch(hex).L;
    const scale = accentScale(hex);
    assert.ok(Math.abs(hexToOklch(scale["300"]).L - base) < 0.2, `${hex} 300`);
    assert.ok(Math.abs(hexToOklch(scale["500"]).L - base) < 0.2, `${hex} 500`);
  }
});

test("the default accent yields one stable scale, whatever its spelling", () => {
  const scale = accentScale(DEFAULT_ACCENT);
  assert.equal(scale["400"], DEFAULT_ACCENT);
  assert.deepEqual(accentScale(DEFAULT_ACCENT.toUpperCase()), scale);
  assert.deepEqual(accentScale(DEFAULT_ACCENT), scale);
  assert.equal(PRESET_ACCENTS[0].hex, DEFAULT_ACCENT);
});

test("accentScale falls back to the default scale on invalid input", () => {
  const fallback = accentScale(DEFAULT_ACCENT);
  for (const bad of ["", "red", "#12", "#gggggg", "#12345678", "22d3ee", null, undefined, 42, {}]) {
    assert.deepEqual(accentScale(bad as unknown as string), fallback, String(bad));
  }
});

test("app settings default to the cyan accent, including for files saved before it existed", () => {
  assert.equal(DEFAULT_APP_SETTINGS.appearance.accent, DEFAULT_ACCENT);
  assert.equal(normalizeSettings({}).appearance.accent, DEFAULT_ACCENT);
  assert.equal(normalizeSettings({ voice: { pitch: 2 } }).appearance.accent, DEFAULT_ACCENT);
});

test("app settings sanitise the accent", () => {
  const accentOf = (value: unknown) => normalizeSettings({ appearance: { accent: value } }).appearance.accent;
  assert.equal(accentOf("#ABCDEF"), "#abcdef");
  assert.equal(accentOf(" #ec4899 "), "#ec4899");
  assert.equal(accentOf("#f0a"), "#ff00aa");
  for (const bad of ["red", "#12", "#gggggg", "#12345678", "javascript:alert(1)", "#22d3ee; background: red", 12, null, {}]) {
    assert.equal(accentOf(bad), DEFAULT_ACCENT, String(bad));
  }
  assert.equal(normalizeSettings({ appearance: "oops" }).appearance.accent, DEFAULT_ACCENT);
});

test("patching the accent merges partially and keeps the previous value on bad input", () => {
  const picked = patchSettings(DEFAULT_APP_SETTINGS, { appearance: { accent: "#8B5CF6" } });
  assert.equal(picked.appearance.accent, "#8b5cf6");
  assert.deepEqual(picked.voice, DEFAULT_APP_SETTINGS.voice);

  const unrelated = patchSettings(picked, { voice: { pitch: 3 } });
  assert.equal(unrelated.appearance.accent, "#8b5cf6");
  assert.equal(unrelated.voice.pitch, 3);

  assert.equal(patchSettings(picked, { appearance: { accent: "not a colour" } }).appearance.accent, "#8b5cf6");
  assert.equal(patchSettings(picked, { appearance: null }).appearance.accent, "#8b5cf6");
  assert.equal(patchSettings(picked, { appearance: { accent: DEFAULT_ACCENT } }).appearance.accent, DEFAULT_ACCENT);
});
