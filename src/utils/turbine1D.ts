/**
 * Turbomachine 1D Mean-Line Aerothermodynamic Calculation Engine
 * 
 * Based on classic turbomachinery loss models and aerothermodynamics:
 * - Soderberg (1949) Correlation for Axial Turbine Losses
 * - Ainley & Mathieson (1951, ARC R&M 2891) Profile, Secondary, and Tip-Clearance Loss Model
 * - Dixon & Hall, Fluid Mechanics and Thermodynamics of Turbomachinery
 * - Horlock, Axial Flow Turbines
 */

import {
  type CustomEquationsConfig,
  SAFE_DEFAULT_EQUATIONS,
  evaluateCustomSoderberg,
  evaluateCustomBladeHeight,
  finiteOr,
  safeEvaluateMath,
} from './customEquations';

export interface GasProperties {
  name: string;
  gamma: number; // Ratio of specific heats (Cp / Cv)
  R_gas: number; // Gas constant [J/(kg·K)]
  Cp: number;    // Specific heat at constant pressure [J/(kg·K)]
}

export const GAS_PRESETS: Record<string, GasProperties> = {
  combustionGas: {
    name: 'Combustion Gas (Turbine Exhaust)',
    gamma: 1.333,
    R_gas: 287.05,
    Cp: 1148.0,
  },
  air: {
    name: 'Dry Air (Standard Gas)',
    gamma: 1.400,
    R_gas: 287.05,
    Cp: 1004.7,
  },
  hydrogen: {
    name: 'Hydrogen Gas (H₂ / Cryo-Turbopump)',
    gamma: 1.3975,
    R_gas: 4124.0,
    Cp: 14498.842767295599,
  },
  superheatedSteam: {
    name: 'Superheated Steam',
    gamma: 1.300,
    R_gas: 461.5,
    Cp: 1999.8,
  },
  carbonDioxide: {
    name: 'sCO2 (Supercritical CO2)',
    gamma: 1.280,
    R_gas: 188.92,
    Cp: 863.6,
  },
};

export type LossModel = 'soderberg' | 'ainley_mathieson' | 'user_defined';

export interface StageConfig {
  id: string;
  name: string;
  /** normal = stator + rotor; counterrotating = rotor row only */
  rowConfiguration?: 'normal' | 'counterrotating';
  shaftName?: string;
  shaftTargetPowerMW?: number;
  PR: number;              // Stage total-to-total pressure ratio P01 / P03
  /** Optional design target. When set, the solver finds PR consistent with this loading coefficient. */
  psiTarget?: number;
  N: number;               // Rotational speed magnitude [RPM]
  direction: 1 | -1;       // 1: Co-rotativo (+), -1: Contrarrotativo (-)
  Rm: number;              // Mean radius [m]
  R: number;               // Degree of reaction (0.0 to 0.9)
  phi: number;             // Flow coefficient (Va / |U|)
  turbineType: 'axial' | 'radial';
  interStageCoupling?: 'vaneless' | 'vaned'; // Vaneless directly transfers exit swirl from previous stage
  lossModel?: LossModel;   // Loss model override for this stage
}

export interface TurbineInputs {
  m_dot: number;      // Mass flow rate [kg/s]
  P01: number;        // Total inlet pressure [Pa] (or bar * 1e5)
  T01: number;        // Total inlet temperature [K]
  PR: number;         // Total-to-total pressure ratio P01/P03
  N: number;          // Rotational speed [RPM]
  Rm: number;         // Mean radius [m]
  R: number;          // Degree of reaction (0.0 to 1.0)
  turbineType: 'axial' | 'radial';
  rowConfiguration?: 'normal' | 'counterrotating';
  phi?: number;       // Flow coefficient (optional, default auto-sized ~0.55-0.65)
  direction?: 1 | -1; // Rotation direction (+1 or -1)
  inletSwirlOverride?: number; // Forced inlet swirl V_theta1 from previous stage (fila sin estator)
  /**
   * Remolino absoluto a la entrada del estator, V_θ0 [m/s], con el signo global de las velocidades
   * tangenciales. Por defecto 0 (entrada axial). Solo afecta a filas con estator: fija α₀, la deflexión
   * del estator y el estado estático de la estación 1.
   */
  statorInletSwirl?: number;
  gasKey?: keyof typeof GAS_PRESETS;
  customGamma?: number;
  customCp?: number;
  customRgas?: number;
  lossModel?: LossModel; // 'soderberg' | 'ainley_mathieson'
  axialChord?: number; // Axial chord [m]
  pitchToChord?: number; // s / c (for Ainley-Mathieson, default ~0.80)
  tmaxToChord?: number;  // t_max / c (for Ainley-Mathieson, default ~0.20)
  tipClearanceRatio?: number; // k / h (for Ainley-Mathieson, default ~0.015)
  customEquations?: CustomEquationsConfig;
}

export interface MultiStageInputs {
  m_dot: number;
  P01: number;
  T01: number;
  gasKey?: keyof typeof GAS_PRESETS;
  customGamma?: number;
  customCp?: number;
  customRgas?: number;
  stages: StageConfig[];
  lossModel?: LossModel; // Global active loss model ('soderberg' | 'ainley_mathieson')
  axialChord?: number; // Shared axial chord [m]
  pitchToChord?: number; // Shared pitch / chord ratio
  tmaxToChord?: number; // Shared maximum thickness / chord ratio
  tipClearanceRatio?: number; // Rotor tip clearance / blade height
  customEquations?: CustomEquationsConfig;
}

export interface SoderbergLossBreakdown {
  model: 'soderberg';
  zeta_N_nominal: number;       // Nominal stator loss coeff (AR = 3)
  zeta_N: number;               // Aspect-ratio-corrected stator loss coeff
  zeta_R_nominal: number;       // Nominal rotor loss coeff (AR = 3)
  zeta_R: number;               // Aspect-ratio-corrected rotor loss coeff
  eps_stator_deg: number;       // Stator turning angle [deg]
  eps_rotor_deg: number;        // Rotor turning angle [deg] (Delta beta)
  aspectRatio: number;          // h / c
  dh_loss_stator: number;       // Stator enthalpy loss [J/kg]
  dh_loss_rotor: number;        // Rotor enthalpy loss [J/kg]
  dh_loss_total: number;        // Total enthalpy loss [J/kg]
  dh_loss_exit: number;         // Exit kinetic energy debit [J/kg]
  eta_tt: number;               // Total-to-total efficiency
  eta_ts: number;               // Total-to-static efficiency
}

export interface AinleyMathiesonLossBreakdown {
  model: 'ainley_mathieson';
  // Stator components
  Yp_stator: number;            // Profile loss coeff
  Ys_stator: number;            // Secondary loss coeff
  Y_tot_stator: number;         // Total pressure loss coeff
  zeta_stator: number;          // Enthalpy loss coeff
  // Rotor components
  Yp_rotor: number;             // Profile loss coeff
  Ys_rotor: number;             // Secondary loss coeff
  Ytc_rotor: number;            // Tip clearance loss coeff
  Y_tot_rotor: number;          // Total pressure loss coeff
  zeta_rotor: number;           // Enthalpy loss coeff
  CL_rotor: number;             // Rotor aerodynamic lift coefficient
  pitchToChord: number;         // s / c
  aspectRatio: number;          // h / c
  dh_loss_stator: number;       // Stator enthalpy loss [J/kg]
  dh_loss_rotor: number;        // Rotor enthalpy loss [J/kg]
  dh_loss_total: number;        // Total enthalpy loss [J/kg]
  dh_loss_exit: number;         // Exit kinetic energy debit [J/kg]
  eta_tt: number;               // Total-to-total efficiency
  eta_ts: number;               // Total-to-static efficiency
}

export interface MultiStageOutputs {
  inputs: MultiStageInputs;
  gas: GasProperties;
  stageResults: TurbineOutputs[];
  PR_overall: number; // Overall total-to-total pressure ratio
  dh_is_overall: number;
  dh_actual_overall: number;
  reheatFactor: number;
  eta_overall_tt: number;
  /**
   * Overall total-to-static efficiency: actual work / isentropic drop from P01, T01 to the
   * static pressure at the last rotor exit (same definition as the per-stage eta_ts).
   */
  eta_overall_ts: number;
  power_total_kW: number;
  power_total_MW: number;
  net_torque_Nm: number;
  shaftResults: { shaftName: string; N: number; direction: 1 | -1; power_MW: number; torque_Nm: number; targetPowerMW?: number }[];
  isCounterRotating: boolean;
  vanelessStagesCount: number;
  activeLossModel: LossModel;
}

export interface VelocityTriangleStation {
  stationName: string;
  V: number;          // Absolute velocity magnitude [m/s]
  Va: number;         // Axial / meridional velocity component [m/s]
  V_theta: number;    // Absolute tangential swirl component [m/s]
  W: number;          // Relative velocity magnitude [m/s]
  Wa: number;         // Relative axial component (equal to Va) [m/s]
  W_theta: number;    // Relative tangential component [m/s]
  U: number;          // Blade peripheral speed [m/s]
  alpha: number;      // Absolute flow angle from axial direction [deg]
  alpha_rad: number;  // Absolute flow angle in radians
  beta: number;       // Relative flow angle from axial direction [deg]
  beta_rad: number;   // Relative flow angle in radians
  Mach_abs: number;   // Absolute Mach number
  Mach_rel: number;   // Relative Mach number
}

export interface TurbineOutputs {
  // Input mirrors
  inputs: TurbineInputs;
  gas: GasProperties;

  // Primary velocities & kinematics
  U: number;            // Peripheral speed at mean radius [m/s]
  omega: number;        // Rotational speed [rad/s]
  C0: number;           // Theoretical isentropic spouting velocity [m/s]
  nu: number;           // Blade-to-jet speed ratio (U / C0)

  // Thermodynamics & Stage Enthalpies
  dh_is: number;        // Total isentropic enthalpy drop [J/kg]
  dh_actual: number;    // Actual total enthalpy drop [J/kg]
  T03_is: number;       // Isentropic total exit temperature [K]
  T03_actual: number;   // Actual total exit temperature [K]
  P03: number;          // Total exit pressure [Pa]
  T1_static: number;    // Stator inlet static temperature [K], con V₀² = Va² + V_θ0² (sin estator, igual a T2)
  P1_static: number;    // Stator inlet static pressure [Pa]
  T2_static: number;    // Rotor inlet static temperature [K]
  /**
   * Presión estática a la salida del estator / entrada del rotor [Pa]. Incluye la pérdida del
   * estator del modelo activo: T2s = T2 − Δh_loss,N/cp y P2 = P01·(T2s/T01)^(γ/(γ−1)).
   */
  P2_static: number;
  T3_static: number;    // Rotor exit static temperature [K]
  P3_static: number;    // Rotor exit static pressure [Pa]
  rho3_static: number;  // Rotor exit static density [kg/m³]
  volume_flow_exit: number; // Volume flow rate at exit Q3 [m³/s]

  // Coefficients
  phi: number;          // Flow coefficient Va / U
  psi: number;          // Stage loading / work coefficient dh_actual / U²
  psi_is: number;       // Isentropic stage loading dh_is / U²
  reaction_actual: number; // Computed kinematic degree of reaction

  // Velocity Triangles
  inletTriangle: VelocityTriangleStation;   // Station 1 (rotor inlet / stator exit)
  outletTriangle: VelocityTriangleStation;  // Station 2 (rotor outlet)

  // Loss Models & Performance
  activeLossModel: LossModel;
  eta_Soderberg_tt: number;      // Total-to-total efficiency via Soderberg
  eta_Soderberg_ts: number;      // Total-to-static efficiency via Soderberg
  soderbergLoss: SoderbergLossBreakdown;

  eta_AM_tt: number;             // Total-to-total efficiency via Ainley & Mathieson
  eta_AM_ts: number;             // Total-to-static efficiency via Ainley & Mathieson
  ainleyMathiesonLoss: AinleyMathiesonLossBreakdown;

  efficiency_recommended: number; // Active model total-to-total efficiency
  eta_NASA_tt: number;            // Backwards compatibility alias to active efficiency
  eta_NASA_ts: number;            // Total-to-static efficiency alias
  eta_total_to_static: number;    // Total-to-static efficiency alias
  eta_Balje: number;              // Secondary model efficiency
  lossBreakdown: {
    profileLoss: number;
    secondaryLoss: number;
    tipClearanceLoss: number;
    exitKineticLoss: number;
  };

  // Dimensional & Dimensionless Parameters
  Ns: number;           // Balje Specific Speed (rad-based): omega * sqrt(Q3) / (dh_is^0.75)
  Ds: number;           // Balje Specific Diameter: D * dh_is^0.25 / sqrt(Q3)
  annulusArea: number;  // Annulus flow area at the rotor exit (estación 3) [m²]
  bladeHeight: number;  // Blade height at the rotor exit (estación 3) [m]
  bladeHeight_mm: number;// Blade height at the rotor exit (estación 3) [mm]
  geometryLossIterations: number;
  geometryLossConverged: boolean;
  hubRadius: number;    // Hub radius at the rotor exit (estación 3) [m]
  tipRadius: number;    // Tip radius at the rotor exit (estación 3) [m]
  hubToTipRatio: number;// Rh / Rt at the rotor exit (estación 3)

  // Power & Mechanics
  power_kW: number;     // Turbine shaft power [kW]
  power_MW: number;     // Turbine shaft power [MW]
  torque_Nm: number;    // Shaft torque [N·m]
  eulerWork: number;    // Euler work = U*(V_theta1 - V_theta2) [J/kg]
}

/**
 * Normalizes an angle to [-180, 180] degrees
 */
export function normalizeAngleDeg(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle <= -180) angle += 360;
  return angle;
}

/**
 * Radian to Degree converter
 */
export function rad2deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Degree to Radian converter
 */
export function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 1. Soderberg's Loss Model (1949)
 * 
 * Based on empirical correlations for axial turbine cascades (Dixon & Hall section 3.5, Horlock):
 * - Nominal enthalpy loss coefficient (t/c = 0.20, Re = 1e5, AR = 3):
 *     zeta_ref = 0.04 + 0.06 * (epsilon / 100)^2
 *   (forma editable: a + b·(ε/100)^c − tk·(t/c)/0.20, con tk = 0 por defecto)
 * - Aspect ratio correction:
 *     Stator: (1 + zeta_ref) * (0.993 + 0.021 / AR) - 1
 *     Rotor:  (1 + zeta_ref) * (0.975 + 0.075 / AR) - 1
 * - Stator deflection: epsilon_N = |alpha1 - alpha0|; rotor deflection: epsilon_R = |beta2 - beta1|
 * - Stator loss: Delta_h_stator = zeta_N * (1/2) * V1^2
 * - Rotor loss: Delta_h_rotor = zeta_R * (1/2) * W2^2
 */
export function calculateSoderbergLosses(params: {
  eps_stator_deg: number;
  eps_rotor_deg: number;
  bladeHeight: number;
  chord: number;
  V1: number;
  W2: number;
  V2: number;
  dh_is: number;
  tmaxToChord?: number;
  isVaneless?: boolean;
  customEquations?: CustomEquationsConfig;
}): SoderbergLossBreakdown {
  const {
    eps_stator_deg,
    eps_rotor_deg,
    bladeHeight,
    chord,
    V1,
    W2,
    V2,
    dh_is,
    tmaxToChord = 0.20,
    isVaneless = false,
    customEquations,
  } = params;

  const aspectRatio = Math.max(0.6, Math.min(8.0, bladeHeight / Math.max(0.005, chord)));

  const customR = evaluateCustomSoderberg(customEquations, eps_rotor_deg, aspectRatio, {
    row: 'rotor',
    tmaxToChord,
  });
  const customN = evaluateCustomSoderberg(customEquations, eps_stator_deg, aspectRatio, {
    row: 'stator',
    tmaxToChord,
  });

  const zeta_N_nominal = customN.zeta_nominal;
  const zeta_R_nominal = customR.zeta_nominal;
  const zeta_N = isVaneless ? 0 : customN.zeta_final;
  const zeta_R = customR.zeta_final;

  // Enthalpy losses [J/kg]
  const dh_loss_stator = isVaneless ? 0 : zeta_N * 0.5 * (V1 * V1);
  const dh_loss_rotor = zeta_R * 0.5 * (W2 * W2);
  const dh_loss_exit = 0.5 * (V2 * V2);
  const dh_loss_total = dh_loss_stator + dh_loss_rotor;

  const safe_dh_is = Math.max(1, dh_is);
  const eta_tt = Math.max(0, Math.min(1, 1.0 - dh_loss_total / safe_dh_is));
  const eta_ts = Math.max(0, Math.min(eta_tt, eta_tt - dh_loss_exit / safe_dh_is));

  return {
    model: 'soderberg',
    zeta_N_nominal,
    zeta_N,
    zeta_R_nominal,
    zeta_R,
    eps_stator_deg,
    eps_rotor_deg,
    aspectRatio,
    dh_loss_stator,
    dh_loss_rotor,
    dh_loss_total,
    dh_loss_exit,
    eta_tt,
    eta_ts,
  };
}

/**
 * Convierte un coeficiente de pérdida de presión total Y = (p₀₁ − p₀₂)/(p₀₂ − p₂) en el coeficiente de
 * pérdida de entalpía ζ = (h₂ − h₂s)/(½V₂²) de la misma rejilla, con la relación exacta de gas ideal
 * en el Mach de salida M (absoluto en el estator, relativo en el rotor):
 *   r = (1 + ½(γ−1)M²)^(γ/(γ−1)) = p₀₂/p₂;   p₀₁/p₂ = r + Y(r − 1)
 *   T₂/T₀ = 1/(1 + ½(γ−1)M²);   T₂s/T₀ = (p₂/p₀₁)^((γ−1)/γ)
 *   ζ = (T₂/T₀ − T₂s/T₀)/(1 − T₂/T₀)
 * Para M → 0 tiende a ζ = Y, que se devuelve directamente cuando M < 1e-3.
 */
export function ymToZeta(Y: number, M: number, gamma: number): number {
  if (!(Y > 0)) return 0;
  const mach = Math.abs(M);
  if (!Number.isFinite(mach) || mach < 1e-3 || !(gamma > 1)) return Y;
  const k = 0.5 * (gamma - 1) * mach * mach;
  const r = Math.pow(1 + k, gamma / (gamma - 1));
  const p01_over_p2 = r + Y * (r - 1);
  const T2_over_T0 = 1 / (1 + k);
  const T2s_over_T0 = Math.pow(1 / p01_over_p2, (gamma - 1) / gamma);
  return Math.max(0, (T2_over_T0 - T2s_over_T0) / (1 - T2_over_T0));
}

/**
 * 2. Ainley & Mathieson Loss Model (1951, ARC R&M 2891)
 *
 * Classic standard 1D method decomposing total pressure losses into:
 * - Profile loss Y_p, interpolated between nozzle (ξ = 0) and impulse (ξ = 1) blading with the signed
 *   impulse fraction ξ = clamp(−sgn(β₂)·β₁/max(1,|β₂|), 0, 1). An inlet angle on the same side as the
 *   exit (reaction blading) gives ξ = 0, the conservative nozzle value.
 * - Secondary endwall loss Y_s (aspect ratio, blade loading CL/(s/c) and the Dunham-Came factor
 *   cos(exit)/cos(inlet))
 * - Tip clearance leakage loss Y_tc
 *
 * Converted to enthalpy loss with the exact gas relation ymToZeta(Y, M_exit, γ).
 */
export function calculateAinleyMathiesonLosses(params: {
  alpha0_deg: number;
  alpha1_deg: number;
  beta1_deg: number;
  beta2_deg: number;
  pitchToChord?: number;
  tmaxToChord?: number;
  bladeHeight: number;
  chord: number;
  tipClearanceRatio?: number;
  gamma: number;
  M_abs1: number;
  M_rel2: number;
  V1: number;
  W2: number;
  V2: number;
  dh_is: number;
  isVaneless?: boolean;
  customEquations?: CustomEquationsConfig;
}): AinleyMathiesonLossBreakdown {
  const {
    alpha0_deg,
    alpha1_deg,
    beta1_deg,
    beta2_deg,
    pitchToChord = 0.80,
    tmaxToChord = 0.20,
    bladeHeight,
    chord,
    tipClearanceRatio = 0.015,
    gamma,
    M_abs1,
    M_rel2,
    V1,
    W2,
    V2,
    dh_is,
    isVaneless = false,
    customEquations,
  } = params;

  const aspectRatio = Math.max(0.6, Math.min(8.0, bladeHeight / Math.max(0.005, chord)));
  const s_over_c = Math.max(0.45, Math.min(1.35, pitchToChord));
  const t_over_c = Math.max(0.10, Math.min(0.28, tmaxToChord));

  // Custom equation parameters (validated: a corrupt value falls back to the canonical constant)
  const amConfig = customEquations?.ainleyMathieson;
  const amDefaults = SAFE_DEFAULT_EQUATIONS.ainleyMathieson;
  const useCustomFormula = amConfig?.useCustomFormula === true;
  const nozzleA = finiteOr(amConfig?.nozzleA, amDefaults.nozzleA);
  const nozzleB = finiteOr(amConfig?.nozzleB, amDefaults.nozzleB);
  const impulseA = finiteOr(amConfig?.impulseA, amDefaults.impulseA);
  const impulseB = finiteOr(amConfig?.impulseB, amDefaults.impulseB);
  const secondaryCoeff = finiteOr(amConfig?.secondaryCoeff, amDefaults.secondaryCoeff);
  const B_tip = finiteOr(amConfig?.tipClearanceCoeff, amDefaults.tipClearanceCoeff);

  // --- ROTOR LOSSES ---
  const b1_rad = deg2rad(beta1_deg);
  const b2_rad = deg2rad(beta2_deg);

  // Mean flow angle beta_m
  const tan_bm = 0.5 * (Math.tan(b1_rad) + Math.tan(b2_rad));
  const cos_bm = 1 / Math.sqrt(1 + tan_bm * tan_bm);
  const cos_b2 = Math.cos(b2_rad);
  // Dunham-Came: Ys ∝ cos(salida)/cos(entrada)
  const dunhamCameRotor = Math.abs(cos_b2) / Math.max(0.05, Math.abs(Math.cos(b1_rad)));

  // Aerodynamic Lift parameter: CL / (s/c) = 2 * |tan(beta1) - tan(beta2)| * cos(beta_m)
  const CL_over_sc = 2 * Math.abs(Math.tan(b1_rad) - Math.tan(b2_rad)) * cos_bm;
  const CL_rotor = CL_over_sc * s_over_c;

  // 1. Rotor Profile Loss Yp
  const abs_b2 = Math.abs(beta2_deg);

  const Yp_nozzle_base = nozzleA + nozzleB * Math.pow(abs_b2 / 100, 2.4) * Math.pow(s_over_c, -0.4);
  const Yp_impulse_base = impulseA + impulseB * Math.pow(abs_b2 / 100, 2.6) * Math.pow(s_over_c, -0.6);

  // Signed impulse fraction: β₁ = −β₂ is pure impulse (ξ = 1), β₁ = 0 is a nozzle (ξ = 0). Inlet angles
  // on the same side as the exit are reaction blading and take the nozzle value (ξ clipped to 0).
  const xi_signed = (-(Math.sign(beta2_deg) || 1) * beta1_deg) / Math.max(1.0, abs_b2);
  const xi_R = Math.max(0, Math.min(1, xi_signed));
  const Yp_base = Yp_nozzle_base + xi_R * xi_R * (Yp_impulse_base - Yp_nozzle_base);
  const defaultYpRotor = Yp_base * Math.pow(t_over_c / 0.20, xi_R);
  const customYpRotor = useCustomFormula && amConfig
    ? safeEvaluateMath(amConfig.customYpExpression, {
        Yp_base, Yp_nozzle: Yp_nozzle_base, Yp_impulse: Yp_impulse_base,
        xi: xi_R, xi_signed, t_over_c, s_over_c, beta1: b1_rad, beta2: b2_rad,
        AR: aspectRatio, nozzleA, nozzleB, impulseA, impulseB,
      }, defaultYpRotor).value
    : defaultYpRotor;
  const Yp_rotor = Math.max(0.015, Math.min(0.25, customYpRotor));

  // 2. Rotor Secondary Loss Ys (Ainley-Mathieson with the Dunham-Came angle factor)
  const lambda_R = secondaryCoeff / aspectRatio;
  const defaultYsRotor = lambda_R * Math.pow(CL_over_sc, 2)
    * ((cos_b2 * cos_b2) / Math.max(0.02, Math.pow(cos_bm, 3)))
    * dunhamCameRotor;
  const customYsRotor = useCustomFormula && amConfig
    ? safeEvaluateMath(amConfig.customYsExpression, {
        secondaryCoeff, AR: aspectRatio, lambda: lambda_R, CL_sc: CL_over_sc,
        beta1: b1_rad, beta2: b2_rad, beta_m: Math.atan(tan_bm), b1: b1_rad, b2: b2_rad,
        bm: Math.atan(tan_bm),
      }, defaultYsRotor).value
    : defaultYsRotor;
  const Ys_rotor = Math.max(0, Math.min(0.25, customYsRotor));

  // 3. Rotor Tip Clearance Loss Ytc
  const defaultYtcRotor = B_tip * tipClearanceRatio * Math.pow(CL_over_sc, 2) * ((cos_b2 * cos_b2) / Math.max(0.02, Math.pow(cos_bm, 3)));
  const customYtcRotor = useCustomFormula && amConfig
    ? safeEvaluateMath(amConfig.customYtcExpression, {
        B_tip, tipClearanceRatio, secondaryCoeff, AR: aspectRatio, CL_sc: CL_over_sc,
        beta1: b1_rad, beta2: b2_rad, beta_m: Math.atan(tan_bm), b1: b1_rad, b2: b2_rad,
        bm: Math.atan(tan_bm),
      }, defaultYtcRotor).value
    : defaultYtcRotor;
  const Ytc_rotor = Math.max(0, Math.min(0.12, customYtcRotor));

  const Y_tot_rotor = Yp_rotor + Ys_rotor + Ytc_rotor;
  const zeta_rotor = ymToZeta(Y_tot_rotor, M_rel2, gamma);
  const dh_loss_rotor = zeta_rotor * 0.5 * (W2 * W2);

  // --- STATOR (NOZZLE) LOSSES ---
  let Yp_stator = 0;
  let Ys_stator = 0;
  let Y_tot_stator = 0;
  let zeta_stator = 0;
  let dh_loss_stator = 0;

  if (!isVaneless) {
    const a0_rad = deg2rad(alpha0_deg);
    const a1_rad = deg2rad(alpha1_deg);
    const tan_am = 0.5 * (Math.tan(a0_rad) + Math.tan(a1_rad));
    const cos_am = 1 / Math.sqrt(1 + tan_am * tan_am);
    const cos_a1 = Math.cos(a1_rad);
    const dunhamCameStator = Math.abs(cos_a1) / Math.max(0.05, Math.abs(Math.cos(a0_rad)));

    const CL_over_sc_N = 2 * Math.abs(Math.tan(a0_rad) - Math.tan(a1_rad)) * cos_am;
    const abs_a1 = Math.abs(alpha1_deg);

    // Same nozzle–impulse interpolation as the rotor, with (α₀, α₁) in place of (β₁, β₂): an inlet swirl
    // α₀ opposite to α₁ (repeating stage, upstream row) makes the vane partly impulse. With α₀ = 0, ξ = 0.
    const Yp_nozzle_base_N = nozzleA + nozzleB * Math.pow(abs_a1 / 100, 2.4) * Math.pow(s_over_c, -0.4);
    const Yp_impulse_base_N = impulseA + impulseB * Math.pow(abs_a1 / 100, 2.6) * Math.pow(s_over_c, -0.6);
    const xi_signed_N = (-(Math.sign(alpha1_deg) || 1) * alpha0_deg) / Math.max(1.0, abs_a1);
    const xi_N = Math.max(0, Math.min(1, xi_signed_N));
    const Yp_base_N = Yp_nozzle_base_N + xi_N * xi_N * (Yp_impulse_base_N - Yp_nozzle_base_N);
    const defaultYpStator = Yp_base_N * Math.pow(t_over_c / 0.20, xi_N);
    Yp_stator = useCustomFormula && amConfig
      ? safeEvaluateMath(amConfig.customYpStatorExpression, {
          Yp_base: Yp_base_N, Yp_nozzle: Yp_nozzle_base_N, Yp_impulse: Yp_impulse_base_N,
          xi: xi_N, xi_signed: xi_signed_N, nozzleA, nozzleB, impulseA, impulseB,
          abs_alpha1: abs_a1, alpha0: a0_rad, alpha1: a1_rad,
          s_over_c, t_over_c, AR: aspectRatio,
        }, defaultYpStator).value
      : defaultYpStator;
    Yp_stator = Math.max(0.015, Math.min(0.25, Yp_stator));

    const lambda_N = secondaryCoeff / aspectRatio;
    const defaultYsStator = lambda_N * Math.pow(CL_over_sc_N, 2)
      * ((cos_a1 * cos_a1) / Math.max(0.02, Math.pow(cos_am, 3)))
      * dunhamCameStator;
    Ys_stator = useCustomFormula && amConfig
      ? safeEvaluateMath(amConfig.customYsExpression, {
          secondaryCoeff, AR: aspectRatio, lambda: lambda_N, CL_sc: CL_over_sc_N,
          alpha0: a0_rad, alpha1: a1_rad, alpha_m: Math.atan(tan_am),
          b1: a0_rad, b2: a1_rad, bm: Math.atan(tan_am),
        }, defaultYsStator).value
      : defaultYsStator;
    Ys_stator = Math.max(0, Math.min(0.20, Ys_stator));

    Y_tot_stator = Yp_stator + Ys_stator;
    zeta_stator = ymToZeta(Y_tot_stator, M_abs1, gamma);
    dh_loss_stator = zeta_stator * 0.5 * (V1 * V1);
  }

  const dh_loss_exit = 0.5 * (V2 * V2);
  const dh_loss_total = dh_loss_stator + dh_loss_rotor;

  const safe_dh_is = Math.max(1, dh_is);
  const eta_tt = Math.max(0, Math.min(1, 1.0 - dh_loss_total / safe_dh_is));
  const eta_ts = Math.max(0, Math.min(eta_tt, eta_tt - dh_loss_exit / safe_dh_is));

  return {
    model: 'ainley_mathieson',
    Yp_stator,
    Ys_stator,
    Y_tot_stator,
    zeta_stator,
    Yp_rotor,
    Ys_rotor,
    Ytc_rotor,
    Y_tot_rotor,
    zeta_rotor,
    CL_rotor,
    pitchToChord: s_over_c,
    aspectRatio,
    dh_loss_stator,
    dh_loss_rotor,
    dh_loss_total,
    dh_loss_exit,
    eta_tt,
    eta_ts,
  };
}

/**
 * Main 1D Mean-Line Calculation Function
 */
export function calculateTurbineStage1D(inputs: TurbineInputs): TurbineOutputs {
  const {
    m_dot,
    P01,
    T01,
    PR,
    N,
    Rm,
    R,
    turbineType = 'axial',
    lossModel = 'soderberg',
  } = inputs;

  // Resolve gas properties
  const gas: GasProperties = inputs.gasKey && GAS_PRESETS[inputs.gasKey]
    ? GAS_PRESETS[inputs.gasKey]
    : {
        name: 'Custom Gas',
        gamma: inputs.customGamma || 1.333,
        R_gas: inputs.customRgas || 287.05,
        Cp: inputs.customCp || 1148.0,
      };

  const gamma = gas.gamma;
  const Cp = gas.Cp;
  const R_gas = gas.R_gas;

  // 1. Isentropic Enthalpy Drop
  const expP = (gamma - 1) / gamma;
  const PR_term = Math.pow(1 / PR, expP);
  const dh_is = Cp * T01 * (1 - PR_term); // [J/kg]
  const T03_is = T01 * PR_term;          // [K]
  const P03 = P01 / PR;                  // [Pa]

  // 2. Theoretical Spouting Velocity (C0)
  const C0 = Math.sqrt(2 * Math.max(0, dh_is)); // [m/s]

  // Peripheral Blade Speed (U)
  const dir: 1 | -1 = inputs.direction === -1 ? -1 : 1;
  const omega = (2 * Math.PI * N) / 60; // [rad/s]
  const U_mag = omega * Rm;             // [m/s]
  const U_signed = dir * U_mag;         // [m/s]

  // Velocity ratio
  const nu = C0 > 0 ? U_mag / C0 : 0;

  // Axial velocity Va
  const flowCoeffMult = finiteOr(inputs.customEquations?.kinematics?.flowCoeffMultiplier, 1.0);
  const phi = (inputs.phi && inputs.phi > 0 ? inputs.phi : 0.55) * flowCoeffMult;
  const Va = phi * U_mag;
  const activeLossModel: LossModel = lossModel;
  const eulerSlip = finiteOr(inputs.customEquations?.kinematics?.eulerWorkMultiplier, 1.0);
  const isVaneless = inputs.rowConfiguration === 'counterrotating' || inputs.inletSwirlOverride !== undefined;

  // Stator inlet (station 0/1): swirl inherited from an upstream row. Only meaningful with a stator.
  const V_theta0 = isVaneless ? 0 : finiteOr(inputs.statorInletSwirl, 0);
  const alpha0_deg = rad2deg(Math.atan2(V_theta0, Va));
  let dh_actual = 0.88 * dh_is;
  let psi = dh_actual / (U_mag * U_mag);
  let V_theta1 = 0;
  let V_theta2 = 0;
  let V1_mag_init = 0;
  let V2_mag_init = 0;
  let T2_static = T01;
  let P2_static = P01;
  let T03_actual = T01;
  let T3_static = T01;
  let P3_static = P03;
  let rho3_static = P3_static / (R_gas * T3_static);
  let volume_flow_exit = 0;
  let annulusAreaIdeal = 0;
  let annulusArea = 0;
  let bladeHeight = 0;
  let bladeHeight_mm = 0;
  let hubRadius = 0;
  let tipRadius = 0;
  let hubToTipRatio = 0;
  let chordEstimate = 0;
  let a2_pre = 0;
  let a3_pre = 0;
  let W_theta1_init = 0;
  let W_theta2_init = 0;
  let W1_init = 0;
  let W2_init = 0;
  let alpha1_deg_init = 0;
  let beta1_deg_init = 0;
  let beta2_deg_init = 0;
  let soderbergLoss!: SoderbergLossBreakdown;
  let ainleyMathiesonLoss!: AinleyMathiesonLossBreakdown;
  let efficiency_recommended = 0;
  let userLossFraction = 0;
  let geometryLossIterations = 0;
  let geometryLossConverged = false;

  const evaluateTrialState = () => {
    psi = dh_actual / (U_mag * U_mag);
    if (inputs.inletSwirlOverride !== undefined) {
      V_theta1 = inputs.inletSwirlOverride;
      V_theta2 = V_theta1 - dh_actual / U_signed;
    } else if (turbineType === 'axial') {
      V_theta1 = dir * U_mag * ((1 - R) + psi / 2);
      V_theta2 = dir * U_mag * ((1 - R) - psi / 2);
    } else {
      V_theta1 = dir * U_mag * 0.95;
      V_theta2 = 0;
    }

    V1_mag_init = Math.hypot(Va, V_theta1);
    V2_mag_init = Math.hypot(Va, V_theta2);
    T2_static = Math.max(200, T01 - V1_mag_init ** 2 / (2 * Cp));
    T03_actual = T01 - dh_actual / Cp;
    T3_static = Math.max(150, T03_actual - V2_mag_init ** 2 / (2 * Cp));
    P3_static = P03 * Math.pow(T3_static / T03_actual, gamma / (gamma - 1));
    rho3_static = P3_static / (R_gas * T3_static);

    volume_flow_exit = m_dot / Math.max(0.01, rho3_static);
    annulusAreaIdeal = volume_flow_exit / Math.max(10, Va);
    const sizing = evaluateCustomBladeHeight(inputs.customEquations, annulusAreaIdeal, Rm);
    bladeHeight = sizing.bladeHeight;
    annulusArea = sizing.effectiveArea;
    bladeHeight_mm = bladeHeight * 1000;
    hubRadius = Math.max(0.005, Rm - bladeHeight / 2);
    tipRadius = Rm + bladeHeight / 2;
    hubToTipRatio = hubRadius / tipRadius;
    chordEstimate = Math.max(0.005, inputs.axialChord && inputs.axialChord > 0
      ? inputs.axialChord
      : bladeHeight / Math.max(0.2, finiteOr(inputs.customEquations?.sizing?.aspectRatioTarget, 1.6)));

    a2_pre = Math.sqrt(gamma * R_gas * T2_static);
    a3_pre = Math.sqrt(gamma * R_gas * T3_static);
    W_theta1_init = V_theta1 - U_signed;
    W_theta2_init = V_theta2 - U_signed;
    W1_init = Math.hypot(Va, W_theta1_init);
    W2_init = Math.hypot(Va, W_theta2_init);
    alpha1_deg_init = rad2deg(Math.atan2(V_theta1, Va));
    beta1_deg_init = rad2deg(Math.atan2(W_theta1_init, Va));
    beta2_deg_init = rad2deg(Math.atan2(W_theta2_init, Va));

    soderbergLoss = calculateSoderbergLosses({
      eps_stator_deg: Math.abs(alpha1_deg_init - alpha0_deg),
      eps_rotor_deg: Math.abs(beta2_deg_init - beta1_deg_init),
      bladeHeight,
      chord: chordEstimate,
      V1: V1_mag_init,
      W2: W2_init,
      V2: V2_mag_init,
      dh_is,
      tmaxToChord: inputs.tmaxToChord ?? 0.20,
      isVaneless,
      customEquations: inputs.customEquations,
    });

    ainleyMathiesonLoss = calculateAinleyMathiesonLosses({
      alpha0_deg,
      alpha1_deg: alpha1_deg_init,
      beta1_deg: beta1_deg_init,
      beta2_deg: beta2_deg_init,
      pitchToChord: inputs.pitchToChord ?? 0.80,
      tmaxToChord: inputs.tmaxToChord ?? 0.20,
      bladeHeight,
      chord: chordEstimate,
      tipClearanceRatio: inputs.tipClearanceRatio ?? 0.015,
      gamma,
      M_abs1: V1_mag_init / a2_pre,
      M_rel2: W2_init / a3_pre,
      V1: V1_mag_init,
      W2: W2_init,
      V2: V2_mag_init,
      dh_is,
      isVaneless,
      customEquations: inputs.customEquations,
    });

    const customLoss = inputs.customEquations?.userDefinedLoss;
    if (activeLossModel === 'user_defined' && customLoss?.enabled === true) {
      const variables = {
        dh_is,
        dh_actual,
        dh_loss_stator: soderbergLoss.dh_loss_stator,
        dh_loss_rotor: soderbergLoss.dh_loss_rotor,
        dh_loss_soderberg: soderbergLoss.dh_loss_total,
        dh_loss_ainley: ainleyMathiesonLoss.dh_loss_total,
        Mach: V1_mag_init / a2_pre,
        MachRel: W1_init / a2_pre,
        MachRel2: W2_init / a3_pre,
        U: U_mag,
        Va,
        V1: V1_mag_init,
        W1: W1_init,
        V2: V2_mag_init,
        W2: W2_init,
        AR: bladeHeight / Math.max(chordEstimate, 1e-9),
        eps: Math.abs(beta2_deg_init - beta1_deg_init),
        phi,
        psi,
        PR,
        m_dot,
        P01,
        T01,
        gamma,
        zeta_N: soderbergLoss.zeta_N,
        zeta_R: soderbergLoss.zeta_R,
        Yp_rotor: ainleyMathiesonLoss.Yp_rotor,
        Ys_rotor: ainleyMathiesonLoss.Ys_rotor,
        Ytc_rotor: ainleyMathiesonLoss.Ytc_rotor,
      };
      const fallback = dh_is > 0 ? soderbergLoss.dh_loss_total / dh_is : 0;
      userLossFraction = Math.max(0, Math.min(0.95, safeEvaluateMath(customLoss.lossFractionExpression, variables, fallback).value));
      efficiency_recommended = 1 - userLossFraction;
    } else {
      efficiency_recommended = activeLossModel === 'ainley_mathieson'
        ? ainleyMathiesonLoss.eta_tt
        : soderbergLoss.eta_tt;
    }
  };

  // Reconcile losses, velocity triangles, exit state, and annulus size at the design point.
  for (let iteration = 0; iteration < 30; iteration++) {
    geometryLossIterations = iteration + 1;
    evaluateTrialState();
    const targetDh = efficiency_recommended * dh_is * eulerSlip;
    const residual = targetDh - dh_actual;
    if (Math.abs(residual) <= Math.max(1e-5, dh_is * 1e-8)) {
      dh_actual = targetDh;
      geometryLossConverged = true;
      break;
    }
    dh_actual += 0.65 * residual;
  }
  evaluateTrialState();
  const psi_is = dh_is / (U_mag * U_mag);

  // Static pressure at the stator exit including the stator loss of the active model:
  // h₂ − h₂s = Δh_loss,N, so T₂s = T₂ − Δh_loss,N/cp and P₂ = P₀₁(T₂s/T₀₁)^(γ/(γ−1)).
  // T₂ is unchanged (h₀ is conserved through the stator). The user-defined model gives only a
  // stage loss fraction, so it uses the Soderberg stator loss for this split.
  const dh_loss_stator_active = activeLossModel === 'ainley_mathieson'
    ? ainleyMathiesonLoss.dh_loss_stator
    : soderbergLoss.dh_loss_stator;
  const T2s_static = Math.max(1, T2_static - dh_loss_stator_active / Cp);
  P2_static = P01 * Math.pow(T2s_static / T01, gamma / (gamma - 1));

  // Total-to-static efficiency must use the isentropic enthalpy drop to the
  // actual exit static pressure, rather than subtracting exit kinetic energy
  // directly from eta_tt. This keeps the reported pressure basis consistent.
  const dh_is_to_exit_static = Cp * T01 * (1 - Math.pow(P3_static / P01, expP));
  const eta_ts = dh_is_to_exit_static > 0
    ? Math.max(0, Math.min(1, dh_actual / dh_is_to_exit_static))
    : 0;
  soderbergLoss.eta_ts = eta_ts;
  ainleyMathiesonLoss.eta_ts = eta_ts;

  // Relative tangential velocity components: W_theta = V_theta - U
  const W_theta1 = V_theta1 - U_signed;
  const W_theta2 = V_theta2 - U_signed;

  const V1 = Math.sqrt(Va * Va + V_theta1 * V_theta1);
  const W1 = Math.sqrt(Va * Va + W_theta1 * W_theta1);
  const V2 = Math.sqrt(Va * Va + V_theta2 * V_theta2);
  const W2 = Math.sqrt(Va * Va + W_theta2 * W_theta2);

  const alpha1_rad = Math.atan2(V_theta1, Va);
  const alpha1 = rad2deg(alpha1_rad);

  const beta1_rad = Math.atan2(W_theta1, Va);
  const beta1 = rad2deg(beta1_rad);

  const alpha2_rad = Math.atan2(V_theta2, Va);
  const alpha2 = rad2deg(alpha2_rad);

  const beta2_rad = Math.atan2(W_theta2, Va);
  const beta2 = rad2deg(beta2_rad);

  const a2 = Math.sqrt(gamma * R_gas * T2_static);
  const a3 = Math.sqrt(gamma * R_gas * T3_static);

  const inletTriangle: VelocityTriangleStation = {
    stationName:
      inputs.inletSwirlOverride !== undefined
        ? 'Rotor Inlet (Vaneless Coupled Swirl)'
        : turbineType === 'axial'
        ? 'Stator Exit / Rotor Inlet'
        : 'Nozzle Exit / Rotor Tip',
    V: V1,
    Va: Va,
    V_theta: V_theta1,
    W: W1,
    Wa: Va,
    W_theta: W_theta1,
    U: U_signed,
    alpha: alpha1,
    alpha_rad: alpha1_rad,
    beta: beta1,
    beta_rad: beta1_rad,
    Mach_abs: V1 / a2,
    Mach_rel: W1 / a2,
  };

  const outletTriangle: VelocityTriangleStation = {
    stationName: turbineType === 'axial' ? 'Rotor Exit' : 'Rotor Exducer Exit',
    V: V2,
    Va: Va,
    V_theta: V_theta2,
    W: W2,
    Wa: Va,
    W_theta: W_theta2,
    U: U_signed,
    alpha: alpha2,
    alpha_rad: alpha2_rad,
    beta: beta2,
    beta_rad: beta2_rad,
    Mach_abs: V2 / a3,
    Mach_rel: W2 / a3,
  };

  const reaction_actual = 1 - (V_theta1 + V_theta2) / (2 * U_signed);
  const eulerWork = U_signed * (V_theta1 - V_theta2);

  const power_W = m_dot * dh_actual;
  const power_kW = power_W / 1000;
  const power_MW = power_kW / 1000;
  const torque_Nm = (dir * power_W) / omega;

  // Station 1 is the row inlet. Without a stator it is the rotor inlet plane itself, so it carries
  // the inherited swirl V_θ1 and its static state is that of station 2 (no loss in between).
  const T1_static = isVaneless ? T2_static : T01 - (Va * Va + V_theta0 * V_theta0) / (2 * Cp);
  const P1_static = isVaneless
    ? P2_static
    : P01 * Math.pow(Math.max(0.1, T1_static / T01), gamma / (gamma - 1));

  // Balje Ns-Ds
  const Ns = (omega * Math.sqrt(volume_flow_exit)) / Math.pow(Math.max(1, dh_is), 0.75);
  const Ds = (2 * Rm * Math.pow(Math.max(1, dh_is), 0.25)) / Math.sqrt(volume_flow_exit);

  // Normalized loss breakdown fractions for chart rendering
  const activeLossObj = activeLossModel === 'ainley_mathieson' ? ainleyMathiesonLoss : soderbergLoss;
  const lossBreakdown = {
    profileLoss: activeLossModel === 'user_defined'
      ? userLossFraction
      : activeLossModel === 'ainley_mathieson'
      ? (ainleyMathiesonLoss.Yp_rotor * 0.5 * W2 * W2) / dh_is
      : soderbergLoss.dh_loss_stator / dh_is,
    secondaryLoss: activeLossModel === 'user_defined' ? 0 : activeLossModel === 'ainley_mathieson'
      ? (ainleyMathiesonLoss.Ys_rotor * 0.5 * W2 * W2) / dh_is
      : soderbergLoss.dh_loss_rotor / dh_is,
    tipClearanceLoss: activeLossModel === 'user_defined' ? 0 : activeLossModel === 'ainley_mathieson'
      ? (ainleyMathiesonLoss.Ytc_rotor * 0.5 * W2 * W2) / dh_is
      : 0,
    exitKineticLoss: activeLossObj.dh_loss_exit / dh_is,
  };

  return {
    inputs,
    gas,
    U: U_signed,
    omega,
    C0,
    nu,
    dh_is,
    dh_actual,
    T03_is,
    T03_actual,
    P03,
    T1_static,
    P1_static,
    T2_static,
    P2_static,
    T3_static,
    P3_static,
    rho3_static,
    volume_flow_exit,
    phi,
    psi,
    psi_is,
    reaction_actual,
    inletTriangle,
    outletTriangle,
    activeLossModel,
    eta_Soderberg_tt: soderbergLoss.eta_tt,
    eta_Soderberg_ts: soderbergLoss.eta_ts,
    soderbergLoss,
    eta_AM_tt: ainleyMathiesonLoss.eta_tt,
    eta_AM_ts: ainleyMathiesonLoss.eta_ts,
    ainleyMathiesonLoss,
    efficiency_recommended,
    eta_NASA_tt: efficiency_recommended,
    eta_NASA_ts: eta_ts,
    eta_total_to_static: eta_ts,
    eta_Balje: soderbergLoss.eta_tt,
    lossBreakdown,
    Ns,
    Ds,
    annulusArea,
    bladeHeight,
    bladeHeight_mm,
    geometryLossIterations,
    geometryLossConverged,
    hubRadius,
    tipRadius,
    hubToTipRatio,
    power_kW,
    power_MW,
    torque_Nm,
    eulerWork,
  };
}

/**
 * Multi-Stage Aerothermodynamic Calculation Engine
 * Supports co-rotating and counter-rotating stages with optional vaneless interstage coupling.
 */
export function calculateMultiStageTurbine(inputs: MultiStageInputs): MultiStageOutputs {
  const { m_dot, P01, T01, stages, lossModel = 'soderberg' } = inputs;

  const gas: GasProperties = inputs.gasKey && GAS_PRESETS[inputs.gasKey]
    ? GAS_PRESETS[inputs.gasKey]
    : {
        name: 'Custom Gas',
        gamma: inputs.customGamma || 1.333,
        R_gas: inputs.customRgas || 287.05,
        Cp: inputs.customCp || 1148.0,
      };

  const stageResults: TurbineOutputs[] = [];
  const shaftTotals = new Map<string, { shaftName: string; N: number; direction: 1 | -1; power_W: number; torque_Nm: number; targetPowerMW?: number }>();
  let currentP0 = P01;
  let currentT0 = T01;
  let lastExitSwirl: number | undefined = undefined;
  let lastExitRm: number | undefined = undefined;

  let dh_actual_overall = 0;
  let sum_dh_is_stages = 0;
  let net_torque_Nm = 0;
  let isCounterRotating = false;
  let vanelessCount = 0;

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage.direction === -1) {
      isCounterRotating = true;
    }

    const isRotorOnlyRow = stage.rowConfiguration === 'counterrotating';
    const useVaneless = isRotorOnlyRow || (i > 0 && stage.interStageCoupling === 'vaneless' && lastExitSwirl !== undefined);
    if (useVaneless) {
      vanelessCount++;
    }

    // A stator downstream of another row sees that row's exit swirl. Through the inter-row gap the
    // angular momentum r·V_θ is conserved, so V_θ0 = V_θ,exit · Rm_prev / Rm.
    const statorInletSwirl = i > 0
      && !useVaneless
      && (stage.rowConfiguration ?? 'normal') === 'normal'
      && lastExitSwirl !== undefined
      && lastExitRm !== undefined
      && stage.Rm > 0
      ? lastExitSwirl * (lastExitRm / stage.Rm)
      : undefined;
    // A rotor fed directly by the previous row (vaneless gap) sees the same r·V_θ conservation.
    const vanelessInletSwirl = useVaneless && lastExitSwirl !== undefined
      ? (lastExitRm !== undefined && lastExitRm > 0 && stage.Rm > 0
          ? lastExitSwirl * (lastExitRm / stage.Rm)
          : lastExitSwirl)
      : undefined;

    const makeStageInputs = (PR: number): TurbineInputs => ({
      m_dot,
      P01: currentP0,
      T01: currentT0,
      PR,
      N: stage.N,
      Rm: stage.Rm,
      R: stage.R,
      turbineType: stage.turbineType,
      rowConfiguration: stage.rowConfiguration ?? 'normal',
      phi: stage.phi,
      direction: stage.direction,
      inletSwirlOverride: vanelessInletSwirl,
      statorInletSwirl,
      gasKey: inputs.gasKey,
      customGamma: inputs.customGamma,
      customCp: inputs.customCp,
      customRgas: inputs.customRgas,
      lossModel: stage.lossModel || lossModel,
      axialChord: inputs.axialChord,
      pitchToChord: inputs.pitchToChord,
      tmaxToChord: inputs.tmaxToChord,
      tipClearanceRatio: inputs.tipClearanceRatio,
      customEquations: inputs.customEquations,
    });

    let resolvedPR = stage.PR;
    let res = calculateTurbineStage1D(makeStageInputs(resolvedPR));
    if (stage.psiTarget !== undefined && Number.isFinite(stage.psiTarget) && stage.psiTarget > 0) {
      // Design workflow: phi and psi define the triangles; pressure ratio is
      // the thermodynamic state that closes the requested Euler work after losses.
      let lo = 1.0001;
      let hi = 10;
      const lowResult = calculateTurbineStage1D(makeStageInputs(lo));
      const highResult = calculateTurbineStage1D(makeStageInputs(hi));
      if (stage.psiTarget >= lowResult.psi && stage.psiTarget <= highResult.psi) {
        for (let iteration = 0; iteration < 28; iteration++) {
          const mid = (lo + hi) / 2;
          const trial = calculateTurbineStage1D(makeStageInputs(mid));
          if (trial.psi < stage.psiTarget) lo = mid;
          else hi = mid;
        }
        resolvedPR = (lo + hi) / 2;
        res = calculateTurbineStage1D(makeStageInputs(resolvedPR));
      }
    }
    stageResults.push(res);

    dh_actual_overall += res.dh_actual;
    sum_dh_is_stages += res.dh_is;
    net_torque_Nm += res.torque_Nm;
    // A given shaftName is kept as is (the UI normalises it); the rpm label is only a fallback
    // for external callers that do not name their shafts.
    const shaftName = stage.shaftName ?? `Eje ${stage.N.toLocaleString('es-ES')} rpm`;
    const shaftKey = `${shaftName}:${stage.N}:${stage.direction}`;
    const shaftTotal = shaftTotals.get(shaftKey) || { shaftName, N: stage.N, direction: stage.direction, power_W: 0, torque_Nm: 0, targetPowerMW: undefined as number | undefined };
    shaftTotal.power_W += res.power_kW * 1000;
    shaftTotal.torque_Nm += res.torque_Nm;
    if (stage.shaftTargetPowerMW !== undefined) shaftTotal.targetPowerMW = stage.shaftTargetPowerMW;
    shaftTotals.set(shaftKey, shaftTotal);

    currentP0 = res.P03;
    currentT0 = res.T03_actual;
    lastExitSwirl = res.outletTriangle.V_theta;
    lastExitRm = stage.Rm;
  }

  const PR_overall = stageResults.reduce((acc, result) => acc * result.inputs.PR, 1.0);
  const expP = (gas.gamma - 1) / gas.gamma;
  const dh_is_overall = gas.Cp * T01 * (1 - Math.pow(1 / PR_overall, expP));

  const reheatFactor = dh_is_overall > 0 ? sum_dh_is_stages / dh_is_overall : 1.0;
  const eta_overall_tt = dh_is_overall > 0 ? dh_actual_overall / dh_is_overall : 0;

  const lastStageResult = stageResults[stageResults.length - 1];
  const dh_is_to_exit_static_overall = lastStageResult
    ? gas.Cp * T01 * (1 - Math.pow(lastStageResult.P3_static / P01, expP))
    : 0;
  const eta_overall_ts = dh_is_to_exit_static_overall > 0
    ? Math.max(0, Math.min(1, dh_actual_overall / dh_is_to_exit_static_overall))
    : 0;

  const power_total_W = m_dot * dh_actual_overall;
  const power_total_kW = power_total_W / 1000;
  const power_total_MW = power_total_kW / 1000;

  return {
    inputs,
    gas,
    stageResults,
    PR_overall,
    dh_is_overall,
    dh_actual_overall,
    reheatFactor,
    eta_overall_tt,
    eta_overall_ts,
    power_total_kW,
    power_total_MW,
    net_torque_Nm,
    shaftResults: Array.from(shaftTotals.values()).map((shaft) => ({
      shaftName: shaft.shaftName,
      N: shaft.N,
      direction: shaft.direction,
      power_MW: shaft.power_W / 1e6,
      torque_Nm: shaft.torque_Nm,
      targetPowerMW: shaft.targetPowerMW,
    })),
    isCounterRotating,
    vanelessStagesCount: vanelessCount,
    activeLossModel: lossModel,
  };
}
