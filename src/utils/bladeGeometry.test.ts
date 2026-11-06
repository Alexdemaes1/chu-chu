/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBladeProfile,
  calculateRadialEquilibriumBladeSections,
  calculateCascadeSizing,
  evaluateCubicBezier,
  sampleCubicBezier,
  VORTEX_EXPONENT_WARNING_MESSAGE,
  type BladeSectionParams,
} from './bladeGeometry.ts';

test('evaluateCubicBezier boundary conditions and monotonicity', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 20 };
  const p2 = { x: 30, y: 25 };
  const p3 = { x: 50, y: 10 };

  const start = evaluateCubicBezier(p0, p1, p2, p3, 0);
  const end = evaluateCubicBezier(p0, p1, p2, p3, 1);
  const mid = evaluateCubicBezier(p0, p1, p2, p3, 0.5);

  assert.equal(start.x, 0);
  assert.equal(start.y, 0);
  assert.equal(end.x, 50);
  assert.equal(end.y, 10);
  assert.ok(mid.x > 15 && mid.x < 35, 'Midpoint x should be intermediate');
  assert.ok(mid.y > 10, 'Midpoint y should reflect elevated control points');

  const samples = sampleCubicBezier(p0, p1, p2, p3, 20);
  assert.equal(samples.length, 21);
});

test('generateBladeProfile creates valid 4-control-point curves and closed contour', () => {
  const params: BladeSectionParams = {
    sectionName: 'Mid',
    radius: 0.25,
    r_ratio: 1.0,
    c_ax: 45.0,
    stagger_deg: 42.0,
    beta_flow_1: 25.0,
    beta_flow_2: 62.0,
    beta_metal_1: 25.0,
    beta_metal_2: 60.0,
    t_max: 7.2,
    x_tmax_ratio: 0.40,
    r_le: 1.3,
    r_te: 0.6,
    pitch_s: 38.0,
  };

  const result = generateBladeProfile(params);

  // Check 4 control points exist
  assert.equal(result.controlPoints.suctionSide.length, 4);
  assert.equal(result.controlPoints.pressureSide.length, 4);
  assert.equal(result.controlPoints.camberLine.length, 4);

  // Check sampled curves
  assert.ok(result.curves.suctionSide.length >= 50);
  assert.ok(result.curves.pressureSide.length >= 50);
  assert.ok(result.curves.leadingEdgeArc.length >= 10);
  assert.ok(result.curves.trailingEdgeArc.length >= 10);
  assert.ok(result.curves.fullContour.length > 100);

  // Check metrics
  assert.ok(result.metrics.trueChord > params.c_ax, 'True chord should be greater than axial chord');
  assert.ok(result.metrics.camber_deg > 0, 'Camber turning angle should be positive');
  assert.ok(result.metrics.zweifelLoading > 0.5 && result.metrics.zweifelLoading < 1.5);
});

test('calculateRadialEquilibriumBladeSections applies free vortex law across Hub, Mid, Tip', () => {
  const radialDesign = calculateRadialEquilibriumBladeSections({
    Rm_m: 0.28,
    hb_m: 0.052,
    U_mid_ms: 320,
    Va_mid_ms: 175,
    V_theta1_mid_ms: 360,
    V_theta2_mid_ms: 40,
    c_ax_mid_mm: 42,
    psi_Zweifel: 0.85,
  });

  // Verify radii ordering: Hub < Mid < Tip
  assert.ok(radialDesign.R_hub_mm < radialDesign.Rm_mm);
  assert.ok(radialDesign.Rm_mm < radialDesign.R_tip_mm);

  // Verify blade count is physically realistic
  assert.ok(radialDesign.bladeCount_Z >= 20 && radialDesign.bladeCount_Z <= 100, `Blade count ${radialDesign.bladeCount_Z} should be reasonable`);

  // Verify pitch ordering: pitch_hub < pitch_mid < pitch_tip
  assert.ok(radialDesign.hub.params.pitch_s < radialDesign.mid.params.pitch_s);
  assert.ok(radialDesign.mid.params.pitch_s < radialDesign.tip.params.pitch_s);

  // Verify free vortex effect on tangential velocity and relative angle:
  // Since r_hub < r_mid, V_theta1(hub) > V_theta1(mid).
  // But U(hub) < U(mid).
  // Therefore W_theta1(hub) = V_theta1(hub) - U(hub) is significantly larger than at tip!
  assert.ok(
    radialDesign.hub.params.beta_flow_1 > radialDesign.tip.params.beta_flow_1,
    `Hub beta1 (${radialDesign.hub.params.beta_flow_1.toFixed(1)}°) should be steeper than Tip beta1 (${radialDesign.tip.params.beta_flow_1.toFixed(1)}°)`
  );

  // Verify structural thickness taper: Hub is thicker than Tip
  assert.ok(
    radialDesign.hub.params.t_max > radialDesign.tip.params.t_max,
    'Hub should be thicker than Tip for centrifugal bending root stress resistance'
  );
});

const mirrorBaseOptions = {
  Rm_m: 0.12,
  hb_m: 0.03,
  Va_mid_ms: 340,
  c_ax_mid_mm: 20,
  psi_Zweifel: 0.85,
  incidence_deg: 2.5,
  deviation_deg: 4,
};

const forwardTriangles = { U_mid_ms: 565, V_theta1_mid_ms: 465, V_theta2_mid_ms: -100 };

test('calculateRadialEquilibriumBladeSections keeps the co-rotating convention: β_metal1 = β1 + i, β_metal2 = β2 − δ', () => {
  const design = calculateRadialEquilibriumBladeSections({ ...mirrorBaseOptions, ...forwardTriangles });
  for (const section of [design.hub, design.mid, design.tip]) {
    const { beta_flow_1, beta_flow_2, beta_metal_1, beta_metal_2 } = section.params;
    assert.ok(Math.abs(beta_metal_1 - (beta_flow_1 + 2.5)) < 1e-12);
    assert.ok(Math.abs(beta_metal_2 - (beta_flow_2 - 4)) < 1e-12);
  }
  // With U > 0 the relative flow turns towards negative angles, so the deviation adds turning.
  const { params } = design.mid;
  assert.ok(Math.abs(params.beta_metal_2 - params.beta_metal_1) > Math.abs(params.beta_flow_2 - params.beta_flow_1));
});

test('calculateRadialEquilibriumBladeSections mirrors metal angles, stagger and contour for (U, Vθ1, Vθ2) → (−U, −Vθ1, −Vθ2)', () => {
  const forward = calculateRadialEquilibriumBladeSections({ ...mirrorBaseOptions, ...forwardTriangles });
  const mirrored = calculateRadialEquilibriumBladeSections({
    ...mirrorBaseOptions,
    U_mid_ms: -forwardTriangles.U_mid_ms,
    V_theta1_mid_ms: -forwardTriangles.V_theta1_mid_ms,
    V_theta2_mid_ms: -forwardTriangles.V_theta2_mid_ms,
  });
  assert.equal(mirrored.bladeCount_Z, forward.bladeCount_Z);
  for (const key of ['hub', 'mid', 'tip'] as const) {
    const a = forward[key];
    const b = mirrored[key];
    assert.ok(Math.abs(a.params.beta_metal_1 + b.params.beta_metal_1) < 1e-9, `${key}: β_metal1 must change sign`);
    assert.ok(Math.abs(a.params.beta_metal_2 + b.params.beta_metal_2) < 1e-9, `${key}: β_metal2 must change sign`);
    assert.ok(Math.abs(a.params.stagger_deg + b.params.stagger_deg) < 1e-9, `${key}: stagger must change sign`);
    assert.ok(Math.abs(a.metrics.camber_deg - b.metrics.camber_deg) < 1e-9, `${key}: camber must be equal`);
    assert.ok(a.metrics.camber_deg > 0);
    a.curves.fullContour.forEach((point, index) => {
      const image = b.curves.fullContour[index];
      assert.ok(Math.abs(point.x - image.x) < 1e-9 && Math.abs(point.y + image.y) < 1e-9, `${key}: contour point ${index} must be mirrored`);
    });
  }
});

test('calculateCascadeSizing returns ψ_Zweifel equal to the target up to the rounding of Z', () => {
  // Rotor triangles of the 1D example: U = 565.5 m/s, Va = 339.3 m/s, Vθ1 = 464.6 m/s, Vθ2 = −101.4 m/s.
  const options = {
    Rm_m: 0.12,
    hb_m: 0.03,
    U_mid_ms: 565.49,
    Va_mid_ms: 339.29,
    V_theta1_mid_ms: 464.59,
    V_theta2_mid_ms: -101.36,
    c_ax_mid_mm: 20,
    psi_Zweifel: 0.85,
  };
  const sizing = calculateCascadeSizing(options);
  const beta1 = Math.atan2(options.V_theta1_mid_ms - options.U_mid_ms, options.Va_mid_ms);
  const beta2 = Math.atan2(options.V_theta2_mid_ms - options.U_mid_ms, options.Va_mid_ms);
  const tanDiff = Math.abs(Math.tan(beta1) - Math.tan(beta2));
  const idealPitch = options.psi_Zweifel * options.c_ax_mid_mm / (2 * Math.cos(beta2) ** 2 * tanDiff);
  const rawZ = 2 * Math.PI * options.Rm_m * 1000 / idealPitch;
  assert.ok(sizing.bladeCount_Z > 12 && sizing.bladeCount_Z < 180, 'Z must not be clamped in this case');
  // ψ_Z ∝ s ∝ 1/Z: the only error left is the integer rounding of Z.
  const expected = options.psi_Zweifel * rawZ / sizing.bladeCount_Z;
  assert.ok(Math.abs(sizing.zweifelLoading - expected) < 1e-12, `ψ_Z ${sizing.zweifelLoading} vs ${expected}`);
  assert.ok(Math.abs(sizing.zweifelLoading / options.psi_Zweifel - 1) <= 0.5 / sizing.bladeCount_Z + 1e-12);
  assert.ok(Math.abs(sizing.solidity_mid - options.c_ax_mid_mm / sizing.pitch_mid_mm) < 1e-12);
});

test('RadialBladeDesign.zweifelLoading coincide con el dimensionado para cualquier multiplicador y fórmula', () => {
  // Mismos triángulos que el caso anterior. Con k = 1.6 el ψ_Z antiguo (ángulos de metal y k = 2 fijo)
  // daba ≈ 1.06 para un objetivo de 0.85; el valor auditado debe ser el del propio dimensionado.
  const common = {
    Rm_m: 0.12, hb_m: 0.03, U_mid_ms: 565.49, Va_mid_ms: 339.29,
    V_theta1_mid_ms: 464.59, V_theta2_mid_ms: -101.36, c_ax_mid_mm: 20, psi_Zweifel: 0.85,
  };
  for (const zweifelMultiplier of [2, 1.6, 1.3]) {
    const design = calculateRadialEquilibriumBladeSections({ ...common, zweifelMultiplier });
    const sizing = calculateCascadeSizing({ ...common, zweifelMultiplier });
    assert.equal(design.bladeCount_Z, sizing.bladeCount_Z);
    assert.ok(Math.abs(design.zweifelLoading - sizing.zweifelLoading) < 1e-12, `k = ${zweifelMultiplier}`);
    // Solo queda el error del redondeo de Z: |ψ_Z/objetivo − 1| ≤ 0.5/Z
    assert.ok(Math.abs(design.zweifelLoading / 0.85 - 1) <= 0.5 / design.bladeCount_Z + 1e-12, `ψ_Z = ${design.zweifelLoading}`);
  }
  // Fórmula propia: ψ_Z = s/c_ax (lineal en s) ⇒ el paso ideal es 0.85·c_ax y la carga real ≈ 0.85
  const custom = { ...common, useCustomZweifelFormula: true, customZweifelExpression: 's / c_ax' };
  const design = calculateRadialEquilibriumBladeSections(custom);
  const sizing = calculateCascadeSizing(custom);
  assert.ok(Math.abs(design.zweifelLoading - design.pitch_mid_mm / 20) < 1e-12);
  assert.ok(Math.abs(design.zweifelLoading - sizing.zweifelLoading) < 1e-12);
});

test('generateBladeProfile exposes segmentRanges that match the real arc and side lengths', () => {
  const design = calculateRadialEquilibriumBladeSections({ ...mirrorBaseOptions, ...forwardTriangles });
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;
  for (const profile of [design.hub, design.mid, design.tip]) {
    const { segmentRanges, curves } = profile;
    assert.deepEqual(segmentRanges, {
      le: { start: 0, end: 20 },
      ss: { start: 21, end: 70 },
      te: { start: 71, end: 86 },
      ps: { start: 87, end: 136 },
    });
    assert.equal(curves.fullContour.length, 137);
    // Each segment ends where the next surface starts.
    const at = (index: number) => curves.fullContour[index];
    assert.ok(close(at(segmentRanges.le.end), curves.suctionSide[0]));
    assert.ok(close(at(segmentRanges.ss.end), curves.suctionSide[curves.suctionSide.length - 1]));
    assert.ok(close(at(segmentRanges.te.end), curves.pressureSide[curves.pressureSide.length - 1]));
    assert.ok(close(at(segmentRanges.ps.end), curves.pressureSide[0]));
  }
});

test('calculateRadialEquilibriumBladeSections flags vortex exponents other than 1 and ignores non-string Zweifel expressions', () => {
  const freeVortex = calculateRadialEquilibriumBladeSections({ ...mirrorBaseOptions, ...forwardTriangles });
  assert.equal(freeVortex.vortexExponentWarning, false);
  const forcedVortex = calculateRadialEquilibriumBladeSections({ ...mirrorBaseOptions, ...forwardTriangles, vortexExponent: 0.5 });
  assert.equal(forcedVortex.vortexExponentWarning, true);
  assert.ok(VORTEX_EXPONENT_WARNING_MESSAGE.length > 0);

  const corrupt = calculateRadialEquilibriumBladeSections({
    ...mirrorBaseOptions,
    ...forwardTriangles,
    useCustomZweifelFormula: true,
    customZweifelExpression: 42 as unknown as string,
  });
  assert.equal(corrupt.bladeCount_Z, freeVortex.bladeCount_Z);
  const sizing = calculateCascadeSizing({
    Rm_m: 0.12, hb_m: 0.03, ...forwardTriangles, Va_mid_ms: 340, c_ax_mid_mm: 20,
    useCustomZweifelFormula: true, customZweifelExpression: null as unknown as string,
  });
  assert.ok(Number.isFinite(sizing.zweifelLoading));
});
