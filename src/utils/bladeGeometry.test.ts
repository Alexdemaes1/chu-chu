/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBladeProfile,
  calculateRadialEquilibriumBladeSections,
  evaluateCubicBezier,
  sampleCubicBezier,
  BladeSectionParams,
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
