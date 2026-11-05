/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeEvaluateMath } from './customEquations';

export interface Point2D {
  x: number;
  y: number;
}

export interface BladeSectionParams {
  sectionName: 'Hub' | 'Mid' | 'Tip';
  radius: number;          // [m]
  r_ratio: number;         // r / Rm
  c_ax: number;            // Axial chord [mm]
  stagger_deg: number;     // Stagger angle gamma [deg] (measured from axial)
  beta_flow_1: number;     // Aerodynamic inlet relative flow angle [deg]
  beta_flow_2: number;     // Aerodynamic outlet relative flow angle [deg]
  beta_metal_1: number;    // Metal inlet angle [deg]
  beta_metal_2: number;    // Metal outlet angle [deg]
  t_max: number;           // Maximum profile thickness [mm]
  x_tmax_ratio: number;    // Axial location of t_max (typically 0.35 - 0.45)
  r_le: number;            // Leading edge radius [mm]
  r_te: number;            // Trailing edge radius [mm]
  pitch_s: number;         // Zweifel pitch spacing [mm]
}

export interface BladeProfileResult {
  params: BladeSectionParams;
  controlPoints: {
    suctionSide: [Point2D, Point2D, Point2D, Point2D];
    pressureSide: [Point2D, Point2D, Point2D, Point2D];
    camberLine: [Point2D, Point2D, Point2D, Point2D];
  };
  curves: {
    suctionSide: Point2D[];
    pressureSide: Point2D[];
    leadingEdgeArc: Point2D[];
    trailingEdgeArc: Point2D[];
    camberLine: Point2D[];
    fullContour: Point2D[];
  };
  metrics: {
    trueChord: number;
    c_ax: number;
    stagger_deg: number;
    camber_deg: number;
    throatEstimate: number;
    pitch_to_chord: number;
    zweifelLoading: number;
  };
}

export interface RadialBladeDesign {
  hub: BladeProfileResult;
  mid: BladeProfileResult;
  tip: BladeProfileResult;
  bladeCount_Z: number;
  solidity_mid: number;
  pitch_mid_mm: number;
  hb_mm: number;
  Rm_mm: number;
  R_hub_mm: number;
  R_tip_mm: number;
  psi_Zweifel: number;
}

export interface CascadeSizing {
  bladeCount_Z: number;
  solidity_mid: number;
  pitch_mid_mm: number;
  hb_mm: number;
  Rm_mm: number;
  R_hub_mm: number;
  R_tip_mm: number;
  psi_Zweifel: number;
  zweifelLoading: number;
}

/** Sizes a rotor cascade without generating any aerodynamic profile contours. */
export function calculateCascadeSizing(options: {
  Rm_m: number;
  hb_m: number;
  U_mid_ms: number;
  Va_mid_ms: number;
  V_theta1_mid_ms: number;
  V_theta2_mid_ms: number;
  c_ax_mid_mm: number;
  psi_Zweifel?: number;
  zweifelMultiplier?: number;
  useCustomZweifelFormula?: boolean;
  customZweifelExpression?: string;
}): CascadeSizing {
  const {
    Rm_m, hb_m, U_mid_ms, Va_mid_ms, V_theta1_mid_ms, V_theta2_mid_ms,
    c_ax_mid_mm, psi_Zweifel = 0.85, zweifelMultiplier = 2,
    useCustomZweifelFormula = false, customZweifelExpression = '',
  } = options;
  const beta1 = Math.atan2(V_theta1_mid_ms - U_mid_ms, Va_mid_ms);
  const beta2 = Math.atan2(V_theta2_mid_ms - U_mid_ms, Va_mid_ms);
  const cAx = Math.max(1, c_ax_mid_mm);
  const multiplier = Math.max(0.1, Math.min(10, zweifelMultiplier));
  const tanDiff = Math.abs(Math.tan(beta1) - Math.tan(beta2));
  const cos2Beta2 = Math.max(0.08, Math.cos(beta2) ** 2);
  let pitchIdeal = tanDiff > 1e-8
    ? psi_Zweifel * cAx / (multiplier * cos2Beta2 * tanDiff)
    : cAx * 1e6;

  if (useCustomZweifelFormula && customZweifelExpression.trim()) {
    const evaluateAtPitch = (pitch: number) => safeEvaluateMath(customZweifelExpression, {
      s: pitch, c_ax: cAx, b1_rad: beta1, b2_rad: beta2,
      b1: beta1, b2: beta2, psi_Z: psi_Zweifel,
    }, Number.NaN).value;
    let lo = Math.max(0.1, cAx * 0.005);
    let hi = Math.max(lo * 2, cAx * 8);
    let fLo = evaluateAtPitch(lo) - psi_Zweifel;
    let fHi = evaluateAtPitch(hi) - psi_Zweifel;
    if (Number.isFinite(fLo) && Number.isFinite(fHi) && fLo * fHi <= 0) {
      for (let iteration = 0; iteration < 60; iteration++) {
        const mid = 0.5 * (lo + hi);
        const fMid = evaluateAtPitch(mid) - psi_Zweifel;
        if (!Number.isFinite(fMid)) break;
        if (Math.abs(fMid) < 1e-7) { lo = mid; hi = mid; break; }
        if (fLo * fMid <= 0) { hi = mid; fHi = fMid; }
        else { lo = mid; fLo = fMid; }
      }
      pitchIdeal = 0.5 * (lo + hi);
    }
  }

  const Rm_mm = Rm_m * 1000;
  const rawCount = 2 * Math.PI * Rm_mm / Math.max(1e-9, pitchIdeal);
  const bladeCount_Z = Math.max(12, Math.min(180, Math.round(rawCount)));
  const pitch_mid_mm = 2 * Math.PI * Rm_mm / bladeCount_Z;
  const solidity_mid = cAx / pitch_mid_mm;
  const zweifelLoading = multiplier * solidity_mid * cos2Beta2 * tanDiff;
  const hb_mm = hb_m * 1000;
  return {
    bladeCount_Z,
    solidity_mid,
    pitch_mid_mm,
    hb_mm,
    Rm_mm,
    R_hub_mm: Math.max(0.01, Rm_m - hb_m / 2) * 1000,
    R_tip_mm: (Rm_m + hb_m / 2) * 1000,
    psi_Zweifel,
    zweifelLoading,
  };
}

/**
 * Evaluates a cubic Bézier curve at parameter t in [0, 1]
 */
export function evaluateCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/**
 * Samples a cubic Bézier curve into N points
 */
export function sampleCubicBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  samples: number = 50
): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    points.push(evaluateCubicBezier(p0, p1, p2, p3, t));
  }
  return points;
}

/**
 * Radians to Degrees & Degrees to Radians helpers
 */
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Generates a 2D blade profile using 4-control-point Bézier curves
 * for the pressure side (intradós) and suction side (extradós),
 * joined smoothly with leading edge and trailing edge circular arcs.
 */
export function generateBladeProfile(params: BladeSectionParams): BladeProfileResult {
  const {
    c_ax,
    stagger_deg,
    beta_metal_1,
    beta_metal_2,
    t_max,
    x_tmax_ratio = 0.40,
    r_le,
    r_te,
    pitch_s,
  } = params;

  // Stagger angle in radians
  const stagger_rad = stagger_deg * DEG2RAD;
  const trueChord = c_ax / Math.max(0.2, Math.cos(stagger_rad));

  // Determine direction of camber:
  // In turbines, flow typically enters with lower angle and turns to higher exit angle (e.g. beta1 ~ 30°, beta2 ~ 65°)
  // The suction side has greater convex curvature on one side.
  const camber_deg = Math.abs(beta_metal_2 - beta_metal_1);
  const turnSign = beta_metal_2 >= beta_metal_1 ? 1 : -1;

  // Axial positioning of leading and trailing edge centers
  const le_center: Point2D = { x: r_le, y: 0 };
  const te_center: Point2D = {
    x: c_ax - r_te,
    y: (c_ax - r_te - r_le) * Math.tan(stagger_rad),
  };

  // Inlet and outlet metal unit vectors
  const beta1_rad = beta_metal_1 * DEG2RAD;
  const beta2_rad = beta_metal_2 * DEG2RAD;

  // Tangents at inlet and outlet (x is axial direction, y is pitchwise direction)
  // For axial coordinate x: dx = cos(beta), dy = sin(beta)
  // When measured from axial: dx = cos(beta), dy = sin(beta)
  const tan_le_dir: Point2D = {
    x: Math.cos(beta1_rad),
    y: Math.sin(beta1_rad),
  };

  const tan_te_dir: Point2D = {
    x: Math.cos(beta2_rad),
    y: Math.sin(beta2_rad),
  };

  // Normal vectors to the inlet and outlet flow directions for thickness offset
  const norm_le: Point2D = {
    x: -tan_le_dir.y * turnSign,
    y: tan_le_dir.x * turnSign,
  };

  const norm_te: Point2D = {
    x: -tan_te_dir.y * turnSign,
    y: tan_te_dir.x * turnSign,
  };

  // 1. Camber line control points (P0_c to P3_c)
  const p0_c: Point2D = { x: le_center.x, y: le_center.y };
  const p3_c: Point2D = { x: te_center.x, y: te_center.y };

  const chord_dist = Math.hypot(p3_c.x - p0_c.x, p3_c.y - p0_c.y);
  const k1 = chord_dist * 0.38;
  const k2 = chord_dist * 0.38;

  const p1_c: Point2D = {
    x: p0_c.x + k1 * tan_le_dir.x,
    y: p0_c.y + k1 * tan_le_dir.y,
  };

  const p2_c: Point2D = {
    x: p3_c.x - k2 * tan_te_dir.x,
    y: p3_c.y - k2 * tan_te_dir.y,
  };

  // 2. Extradós / Suction Side (SS) control points:
  // Starts on LE circle on the suction side, arcs around maximum thickness location, and ends on TE circle
  const p0_ss: Point2D = {
    x: le_center.x + r_le * norm_le.x,
    y: le_center.y + r_le * norm_le.y,
  };

  const p3_ss: Point2D = {
    x: te_center.x + r_te * norm_te.x,
    y: te_center.y + r_te * norm_te.y,
  };

  // Location of max suction surface deflection
  const ss_apex_x = c_ax * x_tmax_ratio;
  const t_ss = t_max * 0.65; // ~65% of thickness goes to suction side from camber line
  const ss_apex_y =
    evaluateCubicBezier(p0_c, p1_c, p2_c, p3_c, x_tmax_ratio).y + norm_le.y * t_ss;

  // Intermediate control points for Suction Side to maintain high curvature at throat & no inflection
  const p1_ss: Point2D = {
    x: p0_ss.x + k1 * 0.9 * tan_le_dir.x + norm_le.x * (t_ss * 0.4),
    y: p0_ss.y + k1 * 0.9 * tan_le_dir.y + norm_le.y * (t_ss * 0.4),
  };

  const p2_ss: Point2D = {
    x: ss_apex_x + (p3_ss.x - ss_apex_x) * 0.4,
    y: ss_apex_y + (p3_ss.y - ss_apex_y) * 0.35,
  };

  // 3. Intradós / Pressure Side (PS) control points:
  // Starts on LE circle on the pressure side, shallower concave or flat surface, ends on TE circle
  const p0_ps: Point2D = {
    x: le_center.x - r_le * norm_le.x,
    y: le_center.y - r_le * norm_le.y,
  };

  const p3_ps: Point2D = {
    x: te_center.x - r_te * norm_te.x,
    y: te_center.y - r_te * norm_te.y,
  };

  const t_ps = t_max * 0.35; // ~35% of thickness on pressure side
  const p1_ps: Point2D = {
    x: p0_ps.x + k1 * 0.7 * tan_le_dir.x - norm_le.x * (t_ps * 0.2),
    y: p0_ps.y + k1 * 0.7 * tan_le_dir.y - norm_le.y * (t_ps * 0.2),
  };

  const p2_ps: Point2D = {
    x: p3_ps.x - k2 * 0.65 * tan_te_dir.x - norm_te.x * (t_ps * 0.15),
    y: p3_ps.y - k2 * 0.65 * tan_te_dir.y - norm_te.y * (t_ps * 0.15),
  };

  // Sample curves (50 segments each)
  const suctionPoints = sampleCubicBezier(p0_ss, p1_ss, p2_ss, p3_ss, 50);
  const pressurePoints = sampleCubicBezier(p0_ps, p1_ps, p2_ps, p3_ps, 50);
  const camberPoints = sampleCubicBezier(p0_c, p1_c, p2_c, p3_c, 50);

  // Generate Leading Edge circular arc connecting p0_ps -> p0_ss
  const leArcPoints: Point2D[] = [];
  const startAngle_le = Math.atan2(p0_ps.y - le_center.y, p0_ps.x - le_center.x);
  let endAngle_le = Math.atan2(p0_ss.y - le_center.y, p0_ss.x - le_center.x);

  // Ensure arc wraps around the front (x < le_center.x)
  if (turnSign > 0 && endAngle_le < startAngle_le) {
    endAngle_le += 2 * Math.PI;
  } else if (turnSign < 0 && endAngle_le > startAngle_le) {
    endAngle_le -= 2 * Math.PI;
  }

  for (let i = 0; i <= 20; i++) {
    const angle = startAngle_le + (i / 20) * (endAngle_le - startAngle_le);
    leArcPoints.push({
      x: le_center.x + r_le * Math.cos(angle),
      y: le_center.y + r_le * Math.sin(angle),
    });
  }

  // Generate Trailing Edge circular arc connecting p3_ss -> p3_ps
  const teArcPoints: Point2D[] = [];
  const startAngle_te = Math.atan2(p3_ss.y - te_center.y, p3_ss.x - te_center.x);
  let endAngle_te = Math.atan2(p3_ps.y - te_center.y, p3_ps.x - te_center.x);

  if (turnSign > 0 && endAngle_te < startAngle_te) {
    endAngle_te += 2 * Math.PI;
  } else if (turnSign < 0 && endAngle_te > startAngle_te) {
    endAngle_te -= 2 * Math.PI;
  }

  for (let i = 0; i <= 16; i++) {
    const angle = startAngle_te + (i / 16) * (endAngle_te - startAngle_te);
    teArcPoints.push({
      x: te_center.x + r_te * Math.cos(angle),
      y: te_center.y + r_te * Math.sin(angle),
    });
  }

  // Assemble full closed perimeter: LE arc -> Suction Side -> TE arc -> Pressure Side (reversed)
  const fullContour: Point2D[] = [
    ...leArcPoints,
    ...suctionPoints.slice(1),
    ...teArcPoints.slice(1),
    ...pressurePoints.slice(0, -1).reverse(),
  ];

  // Estimate throat opening (o) from adjacent blade passage: o ~ pitch * cos(beta_metal_2)
  const throatEstimate = pitch_s > 0 ? pitch_s * Math.cos(beta2_rad) : c_ax * 0.45;
  const pitch_to_chord = pitch_s > 0 ? pitch_s / trueChord : 0.8;

  // Zweifel loading coefficient estimation:
  // psi_Z = 2 * (s / c_ax) * cos^2(beta2) * |tan(beta1) - tan(beta2)|
  const zweifelLoading =
    pitch_s > 0
      ? 2 *
        (pitch_s / c_ax) *
        Math.pow(Math.cos(beta2_rad), 2) *
        Math.abs(Math.tan(beta1_rad) - Math.tan(beta2_rad))
      : 0.85;

  return {
    params,
    controlPoints: {
      suctionSide: [p0_ss, p1_ss, p2_ss, p3_ss],
      pressureSide: [p0_ps, p1_ps, p2_ps, p3_ps],
      camberLine: [p0_c, p1_c, p2_c, p3_c],
    },
    curves: {
      suctionSide: suctionPoints,
      pressureSide: pressurePoints,
      leadingEdgeArc: leArcPoints,
      trailingEdgeArc: teArcPoints,
      camberLine: camberPoints,
      fullContour,
    },
    metrics: {
      trueChord,
      c_ax,
      stagger_deg,
      camber_deg,
      throatEstimate,
      pitch_to_chord,
      zweifelLoading,
    },
  };
}

/**
 * Calculates 3 radial sections (Hub, Mid, Tip) using the Free Vortex Radial Equilibrium law:
 *   r * V_theta1 = const
 *   r * V_theta2 = const
 *   Va = const
 *   U(r) = U_mid * (r / Rm)
 *
 * Then sizes axial chord and blade count via Zweifel Solidity criterion.
 */
export function calculateRadialEquilibriumBladeSections(options: {
  Rm_m: number;              // Mean radius [m]
  hb_m: number;              // Blade height [m]
  U_mid_ms: number;          // Mean peripheral speed [m/s]
  Va_mid_ms: number;         // Axial velocity [m/s]
  V_theta1_mid_ms: number;   // Inlet absolute swirl at mid [m/s]
  V_theta2_mid_ms: number;   // Outlet absolute swirl at mid [m/s]
  c_ax_mid_mm?: number;      // Axial chord at mid [mm] (optional, default scaled to hb)
  psi_Zweifel?: number;      // Zweifel criterion target (default 0.85)
  incidence_deg?: number;    // Aerodynamic incidence angle [deg] (default 0)
  deviation_deg?: number;    // Aerodynamic exit deviation angle [deg] (default 3.0)
  t_max_mid_mm?: number;     // Max thickness at mid [mm]
  vortexExponent?: number;   // V_theta * r^n = const (default 1, free vortex)
  zweifelMultiplier?: number;
  useCustomZweifelFormula?: boolean;
  customZweifelExpression?: string;
}): RadialBladeDesign {
  const {
    Rm_m,
    hb_m,
    U_mid_ms,
    Va_mid_ms,
    V_theta1_mid_ms,
    V_theta2_mid_ms,
    psi_Zweifel = 0.85,
    incidence_deg = 0.0,
    deviation_deg = 3.0,
    vortexExponent = 1.0,
    zweifelMultiplier = 2.0,
    useCustomZweifelFormula = false,
    customZweifelExpression = '',
  } = options;

  const Rm_mm = Rm_m * 1000;
  const hb_mm = hb_m * 1000;

  // Free vortex invariant constants: C_theta = r * V_theta
  const nVortex = Math.max(0, Math.min(1.5, vortexExponent));
  const C1 = Math.pow(Rm_m, nVortex) * V_theta1_mid_ms;
  const C2 = Math.pow(Rm_m, nVortex) * V_theta2_mid_ms;

  // Radii
  const r_hub_m = Math.max(0.01, Rm_m - hb_m / 2);
  const r_tip_m = Rm_m + hb_m / 2;

  const R_hub_mm = r_hub_m * 1000;
  const R_tip_mm = r_tip_m * 1000;

  // Default axial chord if not provided: realistic aspect ratio hb / c_ax ~ 1.8 to 2.5
  const c_ax_mid = options.c_ax_mid_mm || Math.max(15, Math.min(120, hb_mm / 1.8));

  // 1. Compute mid section flow angles to size pitch & blade count via Zweifel
  const W_theta1_mid = V_theta1_mid_ms - U_mid_ms;
  const W_theta2_mid = V_theta2_mid_ms - U_mid_ms;
  const beta_flow_1_mid = Math.atan2(W_theta1_mid, Va_mid_ms) * RAD2DEG;
  const beta_flow_2_mid = Math.atan2(W_theta2_mid, Va_mid_ms) * RAD2DEG;

  const beta2_mid_rad = beta_flow_2_mid * DEG2RAD;
  const beta1_mid_rad = beta_flow_1_mid * DEG2RAD;

  // Zweifel optimal pitch spacing at mid:
  // s = (psi_Z * c_ax) / (2 * cos^2(beta2) * |tan(beta1) - tan(beta2)|)
  const tanDiff_mid = Math.abs(Math.tan(beta1_mid_rad) - Math.tan(beta2_mid_rad));
  const cos2_beta2_mid = Math.max(0.08, Math.pow(Math.cos(beta2_mid_rad), 2));
  const multiplier = Math.max(0.1, Math.min(10, zweifelMultiplier));
  const denominator_mid = multiplier * cos2_beta2_mid * tanDiff_mid;
  let pitch_mid_ideal_mm = denominator_mid > 1e-8
    ? (psi_Zweifel * c_ax_mid) / denominator_mid
    : c_ax_mid * 1e6;

  if (useCustomZweifelFormula && customZweifelExpression.trim()) {
    const evaluateZweifelAtPitch = (pitch_mm: number) => safeEvaluateMath(customZweifelExpression, {
      s: pitch_mm,
      c_ax: c_ax_mid,
      b1_rad: beta1_mid_rad,
      b2_rad: beta2_mid_rad,
      b1: beta1_mid_rad,
      b2: beta2_mid_rad,
      psi_Z: psi_Zweifel,
    }, Number.NaN).value;
    let lo = Math.max(0.1, c_ax_mid * 0.005);
    let hi = Math.max(lo * 2, c_ax_mid * 8);
    let fLo = evaluateZweifelAtPitch(lo) - psi_Zweifel;
    let fHi = evaluateZweifelAtPitch(hi) - psi_Zweifel;
    if (Number.isFinite(fLo) && Number.isFinite(fHi) && fLo * fHi <= 0) {
      for (let iteration = 0; iteration < 60; iteration++) {
        const midPitch = 0.5 * (lo + hi);
        const fMid = evaluateZweifelAtPitch(midPitch) - psi_Zweifel;
        if (!Number.isFinite(fMid)) break;
        if (Math.abs(fMid) < 1e-7) { lo = midPitch; hi = midPitch; break; }
        if (fLo * fMid <= 0) { hi = midPitch; fHi = fMid; }
        else { lo = midPitch; fLo = fMid; }
      }
      pitch_mid_ideal_mm = 0.5 * (lo + hi);
    }
  }

  // Blade count Z = round(2 * pi * Rm / s)
  const rawZ = (2 * Math.PI * Rm_mm) / pitch_mid_ideal_mm;
  const bladeCount_Z = Math.max(12, Math.min(180, Math.round(rawZ)));

  // Actual pitch at mid, hub, and tip based on integer blade count Z
  const pitch_mid_mm = (2 * Math.PI * Rm_mm) / bladeCount_Z;
  const pitch_hub_mm = (2 * Math.PI * R_hub_mm) / bladeCount_Z;
  const pitch_tip_mm = (2 * Math.PI * R_tip_mm) / bladeCount_Z;

  const solidity_mid = c_ax_mid / pitch_mid_mm;

  // Max thickness:
  // Hub undergoes highest centrifugal bending stress -> thicker (120-135% of mid)
  // Tip undergoes lowest centrifugal stress -> thinner (70-80% of mid) to minimize tip shock/weight
  const t_max_mid = options.t_max_mid_mm || Math.max(2.5, c_ax_mid * 0.16);
  const t_max_hub = t_max_mid * 1.25;
  const t_max_tip = t_max_mid * 0.75;

  // Helper to compute section parameters under free vortex
  const computeSection = (
    name: 'Hub' | 'Mid' | 'Tip',
    radius_m: number,
    c_ax: number,
    t_max: number,
    pitch_s: number
  ): BladeSectionParams => {
    const r_ratio = radius_m / Rm_m;
    const U_r = U_mid_ms * r_ratio;

    // Free vortex tangential velocities: V_theta(r) = C / r
    const V_theta1_r = C1 / Math.pow(radius_m, nVortex);
    const V_theta2_r = C2 / Math.pow(radius_m, nVortex);

    // Relative velocities: W_theta = V_theta - U
    const W_theta1_r = V_theta1_r - U_r;
    const W_theta2_r = V_theta2_r - U_r;

    // Aerodynamic flow angles
    const beta_flow_1 = Math.atan2(W_theta1_r, Va_mid_ms) * RAD2DEG;
    const beta_flow_2 = Math.atan2(W_theta2_r, Va_mid_ms) * RAD2DEG;

    // Metal angles with incidence & deviation
    const beta_metal_1 = beta_flow_1 + incidence_deg;
    const beta_metal_2 = beta_flow_2 - deviation_deg;

    // Stagger angle gamma: weighted mean between metal angles
    const stagger_deg = beta_metal_1 * 0.45 + beta_metal_2 * 0.55;

    // LE and TE radii
    const r_le = Math.max(0.6, t_max * 0.18);
    const r_te = Math.max(0.3, t_max * 0.08);

    return {
      sectionName: name,
      radius: radius_m,
      r_ratio,
      c_ax,
      stagger_deg,
      beta_flow_1,
      beta_flow_2,
      beta_metal_1,
      beta_metal_2,
      t_max,
      x_tmax_ratio: name === 'Hub' ? 0.38 : name === 'Mid' ? 0.40 : 0.42,
      r_le,
      r_te,
      pitch_s,
    };
  };

  const hubParams = computeSection('Hub', r_hub_m, c_ax_mid * 1.05, t_max_hub, pitch_hub_mm);
  const midParams = computeSection('Mid', Rm_m, c_ax_mid, t_max_mid, pitch_mid_mm);
  const tipParams = computeSection('Tip', r_tip_m, c_ax_mid * 0.95, t_max_tip, pitch_tip_mm);

  const hubResult = generateBladeProfile(hubParams);
  const midResult = generateBladeProfile(midParams);
  const tipResult = generateBladeProfile(tipParams);

  return {
    hub: hubResult,
    mid: midResult,
    tip: tipResult,
    bladeCount_Z,
    solidity_mid,
    pitch_mid_mm,
    hb_mm,
    Rm_mm,
    R_hub_mm,
    R_tip_mm,
    psi_Zweifel,
  };
}
