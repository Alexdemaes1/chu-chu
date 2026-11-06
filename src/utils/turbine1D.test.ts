import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAinleyMathiesonLosses,
  calculateMultiStageTurbine,
  calculateTurbineStage1D,
  GAS_PRESETS,
  ymToZeta,
  type MultiStageInputs,
  type StageConfig,
  type TurbineInputs,
} from './turbine1D';
import {
  SAFE_DEFAULT_EQUATIONS,
  checkIfModified,
  evaluateCustomSoderberg,
  safeEvaluateMath,
  EQUATION_CATALOG,
  type CustomEquationsConfig,
  type EquationEvaluationContext,
} from './customEquations';

/** |actual − expected| ≤ rel·|expected| */
function assertRel(actual: number, expected: number, rel: number, label: string) {
  const tolerance = rel * Math.abs(expected);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: esperado ${expected} ± ${tolerance.toExponential(2)}, obtenido ${actual}`,
  );
}

const deg = Math.PI / 180;

/**
 * Caso de referencia (el mismo que «Cargar ejemplo» en la app): etapa axial de turbina de gas,
 * reacción 50 %, gas de combustión γ = 1.333, cp = 1148 J/(kg·K), R = 287.05 J/(kg·K).
 */
const EXAMPLE_INPUTS: TurbineInputs = {
  m_dot: 2.5,
  P01: 400000,
  T01: 1100,
  PR: 2.2,
  N: 45000,
  Rm: 0.12,
  R: 0.5,
  turbineType: 'axial',
  gasKey: 'combustionGas',
  phi: 0.60,
  pitchToChord: 0.80,
  tmaxToChord: 0.20,
  tipClearanceRatio: 0.015,
};

test('Etapa de referencia: magnitudes cinemáticas y termodinámicas fijadas a 1e-3', () => {
  const res = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'soderberg' });
  const { gamma, Cp, R_gas } = GAS_PRESETS.combustionGas;

  // Independientes de las pérdidas (cálculo a mano):
  //   U = 2π·0.12·45000/60 = 565.487 m/s
  //   Δh_is = cp·T01·[1 − (1/2.2)^((γ−1)/γ)] = 1148·1100·(1 − 0.821216) = 225765.7 J/kg
  assertRel(res.U, 565.487, 1e-3, 'U');
  assertRel(res.dh_is, 225765.7, 1e-3, 'Δh_is');
  assertRel(res.C0, Math.sqrt(2 * 225765.7), 1e-3, 'C0');
  assertRel(res.phi, 0.60, 1e-9, 'φ');
  assert.ok(Math.abs(res.reaction_actual - 0.5) < 1e-6, `R = ${res.reaction_actual}`);

  // Valores de η y del estado que sí dependen de las pérdidas (a través de ψ = η·Δh_is/U²),
  // re-baselineados tras los cambios de física de esta versión:
  //  - Soderberg sin el término −0.006(t/c)/0.20 (ζ* publicado con t/c = 0.20): ζ_N y ζ_R suben
  //    ≈ 0.006·F_AR, por lo que η_tt baja de 0.9099 a 0.9016.
  //  - Ainley-Mathieson con la conversión exacta Y→ζ (≈ 0.70·Y a M ≈ 0.95-1.0) y el factor de
  //    Dunham-Came en Ys (cos α1/cos α0 ≈ 0.59): η_AM sube de 0.866 a 0.919. Es coherente con el
  //    diagrama de Smith para φ = 0.6, ψ ≈ 0.64 (≈ 92-93 % sin pérdidas por fuga).
  assertRel(res.eta_Soderberg_tt, 0.90163, 1e-3, 'η_tt Soderberg');
  assertRel(res.eta_AM_tt, 0.91882, 1e-3, 'η_tt A&M (evaluado con los triángulos de Soderberg)');
  assertRel(res.psi, 0.63657, 1e-3, 'ψ');
  assertRel(res.inletTriangle.alpha, 53.7495, 1e-3, 'α1');
  assertRel(res.outletTriangle.beta, -53.7495, 1e-3, 'β2');
  assertRel(res.T2_static, 956.605, 1e-3, 'T2');
  assertRel(res.T03_actual, 922.685, 1e-3, 'T03');
  assertRel(res.T3_static, 867.947, 1e-3, 'T3');
  assertRel(res.P3_static, 142336.6, 1e-3, 'P3');
  assertRel(res.rho3_static, 0.571302, 1e-3, 'ρ3');
  assertRel(res.bladeHeight, 0.0171057, 1e-3, 'h (salida del rotor)');
  assertRel(res.Ns, 0.951776, 1e-3, 'Ns');
  assertRel(res.Ds, 2.500855, 1e-3, 'Ds');
  assertRel(res.power_kW, 508.893, 1e-3, 'Potencia');
  assertRel(res.eta_total_to_static, 0.708549, 1e-3, 'η_ts');

  // Cadena a mano a partir de η: cada magnitud se reconstruye con las ecuaciones del modelo.
  const eta = res.efficiency_recommended;
  const U = 2 * Math.PI * 0.12 * 45000 / 60;
  const Va = 0.6 * U;
  const psi = eta * res.dh_is / (U * U);
  const Vt1 = U * (0.5 + psi / 2);
  const Vt2 = U * (0.5 - psi / 2);
  const V1 = Math.hypot(Va, Vt1);
  const V2 = Math.hypot(Va, Vt2);
  const W2 = Math.hypot(Va, Vt2 - U);
  const T03 = 1100 - eta * res.dh_is / Cp;
  const T3 = T03 - V2 * V2 / (2 * Cp);
  const P3 = (400000 / 2.2) * Math.pow(T3 / T03, gamma / (gamma - 1));
  const rho3 = P3 / (R_gas * T3);
  const h = 2.5 / (rho3 * Va) / (2 * Math.PI * 0.12);
  assertRel(res.psi, psi, 1e-9, 'ψ = η·Δh_is/U²');
  assertRel(res.inletTriangle.alpha, Math.atan2(Vt1, Va) / deg, 1e-9, 'α1 = atan(Vθ1/Va)');
  assertRel(res.T2_static, 1100 - V1 * V1 / (2 * Cp), 1e-9, 'T2 = T01 − V1²/2cp');
  assertRel(res.T03_actual, T03, 1e-9, 'T03');
  assertRel(res.T3_static, T3, 1e-9, 'T3');
  assertRel(res.P3_static, P3, 1e-9, 'P3');
  assertRel(res.rho3_static, rho3, 1e-9, 'ρ3');
  assertRel(res.bladeHeight, h, 1e-9, 'h = ṁ/(ρ3·Va·2πRm)');
  assertRel(res.power_kW, 2.5 * eta * res.dh_is / 1000, 1e-9, 'P = ṁ·η·Δh_is');

  // Punto fijo de Soderberg comprobado a mano con los ángulos resultantes (AR = 1.6):
  //   ζ_N = (1 + 0.04 + 0.06(α1/100)²)(0.993 + 0.021/1.6) − 1,  ζ_R = (1 + 0.04 + 0.06(ε_R/100)²)(0.975 + 0.075/1.6) − 1
  const alpha1 = res.inletTriangle.alpha;
  const epsR = Math.abs(res.outletTriangle.beta - res.inletTriangle.beta);
  const zetaN = (1.04 + 0.06 * (alpha1 / 100) ** 2) * (0.993 + 0.021 / 1.6) - 1;
  const zetaR = (1.04 + 0.06 * (epsR / 100) ** 2) * (0.975 + 0.075 / 1.6) - 1;
  const etaHand = 1 - (zetaN * V1 * V1 / 2 + zetaR * W2 * W2 / 2) / res.dh_is;
  assertRel(res.soderbergLoss.zeta_N, zetaN, 1e-9, 'ζ_N');
  assertRel(res.soderbergLoss.zeta_R, zetaR, 1e-9, 'ζ_R');
  assertRel(res.eta_Soderberg_tt, etaHand, 1e-6, 'η_tt Soderberg a mano');

  // Triángulos coherentes
  const { inletTriangle, outletTriangle } = res;
  assertRel(inletTriangle.V, Math.hypot(inletTriangle.Va, inletTriangle.V_theta), 1e-12, 'V1');
  assert.ok(Math.abs(inletTriangle.W_theta - (inletTriangle.V_theta - res.U)) < 1e-9, 'Wθ1 = Vθ1 − U');
  assertRel(outletTriangle.V, Math.hypot(outletTriangle.Va, outletTriangle.V_theta), 1e-12, 'V2');
  assert.ok(res.eta_NASA_ts < res.eta_NASA_tt, 'η_ts < η_tt por la energía cinética de salida');
});

test('Etapa de referencia con Ainley-Mathieson activo', () => {
  const res = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'ainley_mathieson' });
  // Re-baselineado: conversión Y→ζ exacta + Dunham-Came (véase el test anterior).
  assertRel(res.eta_AM_tt, 0.91776, 1e-3, 'η_tt A&M');
  assert.equal(res.efficiency_recommended, res.eta_AM_tt);
  assertRel(res.power_kW, 517.998, 1e-3, 'Potencia A&M');
  const am = res.ainleyMathiesonLoss;
  // ζ = ymToZeta(Y, M) con el Mach de salida de cada fila
  assertRel(am.zeta_stator, ymToZeta(am.Y_tot_stator, res.inletTriangle.Mach_abs, 1.333), 1e-9, 'ζ estator');
  assertRel(am.zeta_rotor, ymToZeta(am.Y_tot_rotor, res.outletTriangle.Mach_rel, 1.333), 1e-9, 'ζ rotor');
  // Con R = 0.5 el ejemplo tiene Ys del estator menor que Yp (antes de Dunham-Came era 1.6 veces mayor)
  assert.ok(am.Ys_stator < am.Yp_stator, `Ys_N = ${am.Ys_stator}, Yp_N = ${am.Yp_stator}`);
});

test('ymToZeta: conversión exacta Y→ζ para γ = 1.333 e Y = 0.1', () => {
  // A mano: M = 0.5 → 1 + ½(γ−1)M² = 1.041625; r = 1.041625^4.003 = 1.17734; p01/p2 = 1.19507;
  // T2s/T0 = 1.19507^(−0.24981) = 0.956457; ζ = (0.960039 − 0.956457)/0.039961 = 0.0896.
  assertRel(ymToZeta(0.1, 0.5, 1.333), 0.0896, 1e-3, 'M = 0.5');
  assertRel(ymToZeta(0.1, 0.9, 1.333), 0.0718, 1e-3, 'M = 0.9');
  assertRel(ymToZeta(0.1, 0.01, 1.333), 0.1, 1e-4, 'M → 0');
  assert.equal(ymToZeta(0.1, 0, 1.333), 0.1, 'M = 0 devuelve Y');
  assert.equal(ymToZeta(0, 0.8, 1.333), 0);
  assert.ok(ymToZeta(0.1, 0.9, 1.333) < ymToZeta(0.1, 0.5, 1.333), 'ζ/Y decrece con M');
});

test('Soderberg por defecto: ζ* = 0.04 + 0.06(ε/100)² y factores de aspecto por fila', () => {
  // ε = 0, 40 y 80° → 0.04, 0.04 + 0.06·0.16 = 0.0496, 0.04 + 0.06·0.64 = 0.0784
  for (const [eps, expected] of [[0, 0.0400], [40, 0.0496], [80, 0.0784]] as const) {
    const res = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, eps, 3, { row: 'rotor', tmaxToChord: 0.20 });
    assert.ok(Math.abs(res.zeta_nominal - expected) < 1e-12, `ε = ${eps}: ${res.zeta_nominal}`);
    assert.equal(res.isCustom, false);
  }
  // AR = 1.6: F_N = 0.993 + 0.021/1.6 = 1.006125; F_R = 0.975 + 0.075/1.6 = 1.021875
  const stator = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, 40, 1.6, { row: 'stator' });
  const rotor = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, 40, 1.6, { row: 'rotor' });
  assertRel(stator.arFactor, 1.006125, 1e-12, 'F_N');
  assertRel(rotor.arFactor, 1.021875, 1e-12, 'F_R');
  assertRel(stator.zeta_final, 1.0496 * 1.006125 - 1, 1e-12, 'ζ_N');
  assertRel(rotor.zeta_final, 1.0496 * 1.021875 - 1, 1e-12, 'ζ_R');
  // Con tk = 0 por defecto, t/c no altera ζ*
  const thick = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, 40, 1.6, { row: 'rotor', tmaxToChord: 0.25 });
  assert.equal(thick.zeta_nominal, rotor.zeta_nominal);
});

test('Soderberg: rama personalizada equivalente idéntica a la por defecto y continua en sus parámetros', () => {
  const customFormula: CustomEquationsConfig = {
    ...SAFE_DEFAULT_EQUATIONS,
    soderberg: { ...SAFE_DEFAULT_EQUATIONS.soderberg, useCustomFormula: true },
  };
  for (const row of ['stator', 'rotor'] as const) {
    for (const eps of [0, 23.7, 53.85, 110]) {
      for (const AR of [0.8, 1.6, 4.2]) {
        const reference = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, eps, AR, { row, tmaxToChord: 0.2 });
        const viaExpressions = evaluateCustomSoderberg(customFormula, eps, AR, { row, tmaxToChord: 0.2 });
        assert.equal(viaExpressions.zeta_final, reference.zeta_final, `${row} ε=${eps} AR=${AR}`);
        assert.equal(viaExpressions.isCustom, true);
      }
    }
  }

  // Identidad exacta también en el motor completo (estator y rotor)
  const base = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'soderberg' });
  const custom = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'soderberg', customEquations: customFormula });
  assert.equal(custom.soderbergLoss.zeta_N, base.soderbergLoss.zeta_N);
  assert.equal(custom.soderbergLoss.zeta_R, base.soderbergLoss.zeta_R);
  assert.equal(custom.eta_Soderberg_tt, base.eta_Soderberg_tt);

  // Antes, a = 0.0401 activaba una rama con las constantes del rotor en el estator y η saltaba
  // unos 2 puntos. Ahora Δa = 1e-4 ⇒ Δζ ≈ 1e-4 ⇒ Δη ≈ 1e-4·(V1² + W2²)/(2Δh_is) ≈ 2e-4.
  const nudged: CustomEquationsConfig = {
    ...SAFE_DEFAULT_EQUATIONS,
    soderberg: { ...SAFE_DEFAULT_EQUATIONS.soderberg, a: 0.0401 },
  };
  const nudgedRun = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'soderberg', customEquations: nudged });
  const deltaEta = Math.abs(nudgedRun.eta_Soderberg_tt - base.eta_Soderberg_tt);
  assert.ok(deltaEta < 0.001 && deltaEta > 0, `|Δη_tt| = ${deltaEta}`);
});

test('Ainley-Mathieson: fracción de impulso con signo', () => {
  const common = {
    alpha0_deg: 0,
    alpha1_deg: 60,
    pitchToChord: 0.8,
    tmaxToChord: 0.2,
    bladeHeight: 0.02,
    chord: 0.0125,
    gamma: 1.333,
    M_abs1: 0.6,
    M_rel2: 0.6,
    V1: 400,
    W2: 400,
    V2: 200,
    dh_is: 200000,
  };
  const yp = (beta1_deg: number, beta2_deg: number) =>
    calculateAinleyMathiesonLosses({ ...common, beta1_deg, beta2_deg }).Yp_rotor;

  // Yp de tobera a |β2| = 60°, s/c = 0.8: 0.025 + 0.065·0.6^2.4·0.8^−0.4 = 0.0458564
  const ypNozzle = yp(0, -60);
  assertRel(ypNozzle, 0.0458564, 1e-5, 'Yp(β1 = 0)');
  // (a) β1 del mismo signo que β2 (reacción) ⇒ ξ = 0 ⇒ Yp igual al de β1 = 0
  assert.equal(yp(-20, -60), ypNozzle);
  // (b) signo opuesto ⇒ ξ = 20/60: Yp = Yp_N + ξ²(Yp_I − Yp_N) = 0.0458564 + (1/9)(0.1249831 − 0.0458564) = 0.0546483
  assertRel(yp(20, -60), 0.0546483, 1e-5, 'Yp(β1 = +20°)');
  assert.ok(yp(20, -60) > ypNozzle);
  // Impulso puro β1 = −β2 ⇒ ξ = 1 ⇒ Yp = Yp_I = 0.1249831
  assertRel(yp(60, -60), 0.1249831, 1e-5, 'Yp impulso');
  // (c) espejo de sentido de giro: los mismos ángulos con signo contrario dan el mismo Yp
  for (const [b1, b2] of [[20, -60], [-20, -60], [35, -45]]) {
    assert.equal(yp(-b1, -b2), yp(b1, b2), `espejo β1=${b1}, β2=${b2}`);
  }

  // (c) en el motor completo: direction = −1 da las mismas pérdidas
  const fwd = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'ainley_mathieson' });
  const rev = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel: 'ainley_mathieson', direction: -1 });
  assertRel(rev.ainleyMathiesonLoss.Yp_rotor, fwd.ainleyMathiesonLoss.Yp_rotor, 1e-12, 'Yp_R espejo');
  assertRel(rev.eta_AM_tt, fwd.eta_AM_tt, 1e-12, 'η espejo');
  assert.ok(rev.U < 0 && rev.torque_Nm < 0);

  // (d) R = 0.5, s/c y t/c por defecto: triángulos simétricos ⇒ Yp_rotor = Yp_stator
  const am = fwd.ainleyMathiesonLoss;
  assert.ok(Math.abs(am.Yp_rotor - am.Yp_stator) / am.Yp_stator < 1e-6, `${am.Yp_rotor} vs ${am.Yp_stator}`);

  // (e) Etapa repetida R = 0.5 con ψ > 1: la etapa 2 recibe α0 = α2 de la 1 (mismo Rm) y sus triángulos
  //     son espejo exacto (α0 = −β1, α1 = −β2) ⇒ ξ_N = ξ_R y Yp_estator = Yp_rotor.
  const repeating = calculateMultiStageTurbine({
    m_dot: 4, P01: 600000, T01: 1200, gasKey: 'combustionGas', lossModel: 'ainley_mathieson',
    stages: [1, 2].map((n) => ({
      id: `s${n}`, name: `Etapa ${n}`, PR: 1.5, psiTarget: 1.6, N: 30000, direction: 1 as const, Rm: 0.15, R: 0.5, phi: 0.6,
      turbineType: 'axial' as const,
    })),
  });
  const s2 = repeating.stageResults[1];
  const alpha0 = Math.atan2(s2.inputs.statorInletSwirl ?? 0, s2.inletTriangle.Va) / deg;
  assert.ok(Math.abs(alpha0) > 5, `α0 de la etapa 2 = ${alpha0}`);
  assertRel(alpha0, -s2.inletTriangle.beta, 1e-6, 'α0 = −β1');
  assertRel(s2.ainleyMathiesonLoss.Yp_stator, s2.ainleyMathiesonLoss.Yp_rotor, 1e-6, 'Yp_N = Yp_R con remolino de entrada');
});

test('Ainley-Mathieson: pérdida secundaria con el factor de Dunham-Came', () => {
  // Rotor β1 = 10°, β2 = −60°, AR = 0.02/0.0125 = 1.6, K_s = 0.033:
  //   tan βm = (0.176327 − 1.732051)/2 = −0.777862; cos βm = 0.789320
  //   CL/(s/c) = 2·1.908378·0.789320 = 3.012642
  //   Ys = (0.033/1.6)·3.012642²·(0.25/0.789320³)·(cos 60°/cos 10°) = 0.0951633·0.507713 = 0.0483157
  const rotor = calculateAinleyMathiesonLosses({
    alpha0_deg: 0, alpha1_deg: 60, beta1_deg: 10, beta2_deg: -60,
    pitchToChord: 0.8, tmaxToChord: 0.2, bladeHeight: 0.02, chord: 0.0125,
    gamma: 1.333, M_abs1: 0.6, M_rel2: 0.6, V1: 400, W2: 400, V2: 200, dh_is: 200000,
  });
  assertRel(rotor.Ys_rotor, 0.0483157, 1e-5, 'Ys rotor');
  // Estator α0 = 0, α1 = 60°: Ys = 0.033/1.6·(2 tan60·cos αm)²·cos²60/cos³αm·cos 60 = 0.0409265 < Yp = 0.0458564
  assertRel(rotor.Ys_stator, 0.0409265, 1e-5, 'Ys estator');
  assert.ok(rotor.Ys_stator < rotor.Yp_stator);

  // La expresión por defecto de la fórmula propia reproduce el mismo valor
  const customFormula: CustomEquationsConfig = {
    ...SAFE_DEFAULT_EQUATIONS,
    ainleyMathieson: { ...SAFE_DEFAULT_EQUATIONS.ainleyMathieson, useCustomFormula: true },
  };
  const viaExpression = calculateAinleyMathiesonLosses({
    alpha0_deg: 0, alpha1_deg: 60, beta1_deg: 10, beta2_deg: -60,
    pitchToChord: 0.8, tmaxToChord: 0.2, bladeHeight: 0.02, chord: 0.0125,
    gamma: 1.333, M_abs1: 0.6, M_rel2: 0.6, V1: 400, W2: 400, V2: 200, dh_is: 200000,
    customEquations: customFormula,
  });
  assertRel(viaExpression.Ys_rotor, rotor.Ys_rotor, 1e-12, 'Ys rotor por expresión');
  assertRel(viaExpression.Ys_stator, rotor.Ys_stator, 1e-12, 'Ys estator por expresión');
  assertRel(viaExpression.Yp_rotor, rotor.Yp_rotor, 1e-12, 'Yp rotor por expresión');
});

test('P2 estática incluye la pérdida del estator', () => {
  const { gamma, Cp } = GAS_PRESETS.combustionGas;
  for (const lossModel of ['soderberg', 'ainley_mathieson'] as const) {
    const res = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel });
    const dhN = lossModel === 'soderberg' ? res.soderbergLoss.dh_loss_stator : res.ainleyMathiesonLoss.dh_loss_stator;
    assert.ok(dhN > 0);
    const P2_isentropic = 400000 * Math.pow(res.T2_static / 1100, gamma / (gamma - 1));
    const P2_hand = 400000 * Math.pow((res.T2_static - dhN / Cp) / 1100, gamma / (gamma - 1));
    assertRel(res.P2_static, P2_hand, 1e-12, `P2 ${lossModel}`);
    assert.ok(res.P2_static < P2_isentropic, 'la pérdida reduce P2');
    assert.ok(res.P3_static < res.P2_static && res.P2_static < res.inputs.P01, 'P3 < P2 < P01');
  }
  // Ejemplo con Soderberg (re-baselineado): P2 = 220053 Pa frente a 228046 Pa isentrópica.
  assertRel(calculateTurbineStage1D(EXAMPLE_INPUTS).P2_static, 220053.4, 1e-3, 'P2 del ejemplo');

  // Sin estator (fila contrarrotativa) P2 es la isentrópica
  const rotorOnly = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, rowConfiguration: 'counterrotating', inletSwirlOverride: 150 });
  assert.equal(rotorOnly.soderbergLoss.dh_loss_stator, 0);
  assertRel(rotorOnly.P2_static, 400000 * Math.pow(rotorOnly.T2_static / 1100, gamma / (gamma - 1)), 1e-12, 'P2 sin estator');
});

test('Multietapa: el estator de la etapa 2 parte del remolino de salida de la etapa 1', () => {
  for (const psiTarget of [0.8, 1.6]) {
    const stage = (id: string): StageConfig => ({
      id, name: id, rowConfiguration: 'normal', PR: 1.8, psiTarget, N: 30000, direction: 1,
      Rm: 0.15, R: 0.5, phi: 0.6, turbineType: 'axial', interStageCoupling: 'vaned',
    });
    const inputs: MultiStageInputs = {
      m_dot: 4, P01: 600000, T01: 1200, gasKey: 'combustionGas', lossModel: 'soderberg',
      stages: [stage('e1'), stage('e2')],
    };
    const res = calculateMultiStageTurbine(inputs);
    const [s1, s2] = res.stageResults;
    // Etapa 1: entrada axial ⇒ ε_N = |α1|
    assertRel(s1.soderbergLoss.eps_stator_deg, Math.abs(s1.inletTriangle.alpha), 1e-12, 'ε_N etapa 1');
    // Etapa 2 (mismo Rm y φ ⇒ misma Va): α0 = α2 de la etapa 1 ⇒ ε_N = |α1₂ − α2₁|
    const expected = Math.abs(s2.inletTriangle.alpha - s1.outletTriangle.alpha);
    assertRel(s2.soderbergLoss.eps_stator_deg, expected, 1e-9, `ε_N etapa 2 (ψ = ${psiTarget})`);
    assert.equal(s2.inputs.statorInletSwirl, s1.outletTriangle.V_theta);
    // T1 incluye la energía cinética del remolino de entrada
    const Va = s2.inletTriangle.Va;
    const Vt0 = s1.outletTriangle.V_theta;
    assertRel(s2.T1_static, s2.inputs.T01 - (Va * Va + Vt0 * Vt0) / (2 * GAS_PRESETS.combustionGas.Cp), 1e-12, 'T1 etapa 2');
    if (psiTarget > 1) {
      // Con ψ > 1 el flujo sale con remolino contrario (α2 < 0) y el estator 2 gira más que el 1
      assert.ok(s1.outletTriangle.alpha < 0);
      assert.ok(s2.soderbergLoss.eps_stator_deg > Math.abs(s2.inletTriangle.alpha));
    } else {
      assert.ok(s1.outletTriangle.alpha > 0);
      assert.ok(s2.soderbergLoss.eps_stator_deg < Math.abs(s2.inletTriangle.alpha));
    }
  }

  // Conservación de r·Vθ con radios distintos
  const res = calculateMultiStageTurbine({
    m_dot: 4, P01: 600000, T01: 1200, gasKey: 'combustionGas',
    stages: [
      { id: 'a', name: 'a', PR: 1.6, N: 30000, direction: 1, Rm: 0.15, R: 0.5, phi: 0.6, turbineType: 'axial' },
      { id: 'b', name: 'b', PR: 1.6, N: 30000, direction: 1, Rm: 0.18, R: 0.5, phi: 0.6, turbineType: 'axial' },
    ],
  });
  assertRel(res.stageResults[1].inputs.statorInletSwirl ?? Number.NaN, res.stageResults[0].outletTriangle.V_theta * 0.15 / 0.18, 1e-12, 'Vθ0 = Vθ2·Rm1/Rm2');
  // Una sola etapa: entrada axial sin cambios
  assert.equal(calculateTurbineStage1D(EXAMPLE_INPUTS).inputs.statorInletSwirl, undefined);
});

test('Multietapa: nombre de eje respetado y respaldo por rpm', () => {
  const stage: StageConfig = { id: 'a', name: 'a', PR: 1.6, N: 30000, direction: 1, Rm: 0.15, R: 0.5, phi: 0.6, turbineType: 'axial' };
  const named = calculateMultiStageTurbine({ m_dot: 4, P01: 600000, T01: 1200, gasKey: 'combustionGas', stages: [{ ...stage, shaftName: 'Eje 1' }] });
  assert.equal(named.shaftResults[0].shaftName, 'Eje 1');
  const unnamed = calculateMultiStageTurbine({ m_dot: 4, P01: 600000, T01: 1200, gasKey: 'combustionGas', stages: [stage] });
  assert.equal(unnamed.shaftResults[0].shaftName, 'Eje 30.000 rpm');
});

test('Ejemplo de la app (motor multietapa) coincide con la etapa aislada', () => {
  const res = calculateMultiStageTurbine({
    m_dot: 2.5, P01: 400000, T01: 1100, gasKey: 'combustionGas', lossModel: 'soderberg',
    pitchToChord: 0.8, tmaxToChord: 0.2, tipClearanceRatio: 0.015,
    stages: [{ id: 'stage-1', name: 'Etapa 1', rowConfiguration: 'normal', PR: 2.2, N: 45000, direction: 1, Rm: 0.12, R: 0.5, phi: 0.6, turbineType: 'axial' }],
  });
  // Potencia del ejemplo: ṁ·η·Δh_is = 2.5·0.90163·225765.7 = 508.89 kW
  assertRel(res.power_total_kW, 508.893, 1e-3, 'Potencia del ejemplo');
  assertRel(res.stageResults[0].eta_Soderberg_tt, calculateTurbineStage1D(EXAMPLE_INPUTS).eta_Soderberg_tt, 1e-12, 'η');
  // Con una sola etapa, el η_ts global coincide con el de la etapa (misma definición).
  assertRel(res.eta_overall_ts, res.stageResults[0].eta_total_to_static, 1e-12, 'η_ts global = η_ts de la etapa');
});

test('1D Turbine Stage: Radial inflow turbine stage (90° IFR)', () => {
  const inputs: TurbineInputs = {
    m_dot: 0.8,
    P01: 300000,
    T01: 950,
    PR: 2.5,
    N: 70000,
    Rm: 0.055,
    R: 0.5,
    turbineType: 'radial',
    gasKey: 'combustionGas',
    phi: 0.45,
  };

  const res = calculateTurbineStage1D(inputs);
  assert.equal(res.inputs.turbineType, 'radial');
  assert.ok(res.U > 350 && res.U < 450, `Radial tip speed U ~ 400 m/s, got ${res.U}`);
  assert.ok(res.eta_Balje > 0.75, `Radial Balje efficiency good, got ${res.eta_Balje}`);
  assert.ok(res.outletTriangle.V_theta === 0, `Radial optimal exit has zero swirl`);
});

test('Etapa de impulso (R = 0): ξ = 1 en Ainley-Mathieson', () => {
  const inputs: TurbineInputs = {
    m_dot: 5.0,
    P01: 600000,
    T01: 1200,
    PR: 2.0,
    N: 18000,
    Rm: 0.17,
    R: 0.0,
    turbineType: 'axial',
    gasKey: 'air',
    phi: 0.50,
  };

  const res = calculateTurbineStage1D(inputs);
  assert.ok(Math.abs(res.reaction_actual) < 1e-6, `R = ${res.reaction_actual}`);
  assert.ok(res.psi > 1.4 && res.psi < 2.5, `ψ de impulso ≈ 1.8-2.0, obtenido ${res.psi}`);
  // R = 0 ⇒ β1 = −β2 ⇒ ξ = 1 ⇒ Yp = Yp_I(|β2|) = 0.075 + 0.165(|β2|/100)^2.6·0.8^−0.6
  const b2 = Math.abs(res.outletTriangle.beta);
  assertRel(res.inletTriangle.beta, -res.outletTriangle.beta, 1e-9, 'β1 = −β2');
  const ypImpulse = 0.075 + 0.165 * Math.pow(b2 / 100, 2.6) * Math.pow(0.8, -0.6);
  assertRel(res.ainleyMathiesonLoss.Yp_rotor, Math.min(0.25, ypImpulse), 1e-9, 'Yp de impulso');
});

test('Multi-Stage Turbine: 2-stage conventional axial turbine with reheat factor', () => {
  const multiInputs: MultiStageInputs = {
    m_dot: 5.0,
    P01: 800000,
    T01: 1300,
    gasKey: 'combustionGas',
    stages: [
      { id: 'stage-1', name: 'Etapa 1 (HP)', PR: 1.8, N: 36000, direction: 1, Rm: 0.16, R: 0.50, phi: 0.58, turbineType: 'axial' },
      { id: 'stage-2', name: 'Etapa 2 (LP)', PR: 1.8, N: 32000, direction: 1, Rm: 0.19, R: 0.50, phi: 0.58, turbineType: 'axial' },
    ],
  };

  const res = calculateMultiStageTurbine(multiInputs);
  assert.equal(res.stageResults.length, 2);
  assert.ok(Math.abs(res.PR_overall - 1.8 * 1.8) < 1e-12, 'PR_overall = 3.24');
  assert.equal(res.stageResults[1].inputs.P01, res.stageResults[0].P03, 'P01 de la etapa 2 = P03 de la etapa 1');
  assert.equal(res.stageResults[1].inputs.T01, res.stageResults[0].T03_actual, 'T01 de la etapa 2 = T03 de la etapa 1');
  assert.ok(res.reheatFactor >= 1.0, `Reheat factor must be >= 1.0, got ${res.reheatFactor}`);
  assert.ok(res.power_total_kW > 1000, `Total power must be positive and significant: ${res.power_total_kW} kW`);

  // η_ts global = Δh real total / Δh isentrópico desde (P01, T01) hasta la P estática de salida de la última etapa.
  const { gamma, Cp } = res.gas;
  const lastP3 = res.stageResults[1].P3_static;
  const dhIsToStatic = Cp * 1300 * (1 - Math.pow(lastP3 / 800000, (gamma - 1) / gamma));
  assertRel(res.eta_overall_ts, res.dh_actual_overall / dhIsToStatic, 1e-12, 'η_ts global (cálculo a mano)');
  assert.ok(res.eta_overall_ts < res.eta_overall_tt, 'η_ts global < η_tt global');
});

test('Multi-Stage Turbine: 2-stage Vaneless Counter-Rotating Turbine (CRTF)', () => {
  const crInputs: MultiStageInputs = {
    m_dot: 3.5,
    P01: 600000,
    T01: 1250,
    gasKey: 'combustionGas',
    stages: [
      { id: 'stage-1', name: 'Rotor 1 (Co-rotativo +)', PR: 1.7, N: 38000, direction: 1, Rm: 0.14, R: 0.50, phi: 0.60, turbineType: 'axial' },
      {
        id: 'stage-2', name: 'Rotor 2 (Contrarrotativo -)', PR: 1.7, N: 36000, direction: -1, Rm: 0.15, R: 0.50, phi: 0.60,
        turbineType: 'axial', interStageCoupling: 'vaneless',
      },
    ],
  };

  const res = calculateMultiStageTurbine(crInputs);
  assert.equal(res.isCounterRotating, true, 'Machine must detect counter-rotating architecture');
  assert.equal(res.vanelessStagesCount, 1, 'Vaneless coupling counted correctly');

  const s1 = res.stageResults[0];
  const s2 = res.stageResults[1];
  assert.ok(s1.U > 0, 'Stage 1 blade velocity is positive');
  assert.ok(s2.U < 0, 'Stage 2 blade velocity is negative (counter-rotating)');
  // Hueco sin álabes: se conserva r·V_θ, así que V_θ1,2 = V_θ2,1 · Rm1/Rm2 = V_θ2,1 · 0.14/0.15
  assertRel(s2.inletTriangle.V_theta, s1.outletTriangle.V_theta * (0.14 / 0.15), 1e-9, 'r·V_θ conservado en el hueco');
  assert.equal(s2.inputs.statorInletSwirl, undefined, 'Sin estator no hay remolino de entrada de estator');
  // Sin estator, las estaciones 1 y 2 son el mismo plano: mismo estado estático
  assert.equal(s2.T1_static, s2.T2_static, 'T1 = T2 sin estator');
  assert.equal(s2.P1_static, s2.P2_static, 'P1 = P2 sin estator');
  assert.ok(s1.torque_Nm > 0, 'Stage 1 torque is positive');
  assert.ok(s2.torque_Nm < 0, 'Stage 2 torque is negative (counter-rotating)');
  assert.ok(Math.abs(res.net_torque_Nm) < Math.abs(s1.torque_Nm), 'Net torque reduced by counter-rotation');
});

test('Loss Models: Soderberg vs Ainley-Mathieson calculation and switching comparison', () => {
  const baseInputs: TurbineInputs = {
    m_dot: 3.0,
    P01: 500000,
    T01: 1150,
    PR: 2.0,
    N: 40000,
    Rm: 0.13,
    R: 0.5,
    turbineType: 'axial',
    gasKey: 'combustionGas',
    phi: 0.60,
  };

  const resSoderberg = calculateTurbineStage1D({ ...baseInputs, lossModel: 'soderberg' });
  assert.equal(resSoderberg.activeLossModel, 'soderberg');
  assert.ok(resSoderberg.eta_Soderberg_tt > 0.80 && resSoderberg.eta_Soderberg_tt < 0.95, `Soderberg eta_tt in range: ${resSoderberg.eta_Soderberg_tt}`);
  assert.ok(resSoderberg.eta_Soderberg_ts < resSoderberg.eta_Soderberg_tt, 'Soderberg eta_ts < eta_tt');
  assert.equal(resSoderberg.efficiency_recommended, resSoderberg.eta_Soderberg_tt);

  const resAM = calculateTurbineStage1D({ ...baseInputs, lossModel: 'ainley_mathieson' });
  assert.equal(resAM.activeLossModel, 'ainley_mathieson');
  assert.ok(resAM.ainleyMathiesonLoss.Yp_rotor > 0, 'Rotor profile loss Yp must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.Ys_rotor > 0, 'Rotor secondary loss Ys must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.Ytc_rotor > 0, 'Rotor tip clearance loss Ytc must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.CL_rotor > 0, 'Rotor aerodynamic lift coefficient must be positive');
  assert.ok(resAM.eta_AM_tt > 0.85 && resAM.eta_AM_tt < 0.95, `Ainley-Mathieson eta_tt in range: ${resAM.eta_AM_tt}`);
  assert.ok(resAM.eta_AM_ts < resAM.eta_AM_tt, 'Ainley-Mathieson eta_ts < eta_tt');
  assert.equal(resAM.efficiency_recommended, resAM.eta_AM_tt);

  // Ambos modelos se calculan siempre; cambiar el activo solo mueve el punto de funcionamiento
  assert.ok(Math.abs(resSoderberg.eta_AM_tt - resAM.eta_AM_tt) < 0.01, 'A&M consistente entre ejecuciones');
  assert.ok(Math.abs(resAM.eta_Soderberg_tt - resSoderberg.eta_Soderberg_tt) < 0.01, 'Soderberg consistente entre ejecuciones');
  const diffPct = Math.abs(resSoderberg.power_kW - resAM.power_kW) / resSoderberg.power_kW;
  assert.ok(diffPct < 0.05, `Difference between loss models should be within 5%, got ${(diffPct * 100).toFixed(2)}%`);
});

test('1D Turbine Stage: Hydrogen gas (H2) properties and cryo-turbopump expansion', () => {
  assert.equal(GAS_PRESETS.hydrogen.gamma, 1.3975);
  assert.equal(GAS_PRESETS.hydrogen.R_gas, 4124.0);
  assert.ok(Math.abs(GAS_PRESETS.hydrogen.Cp - 14498.8428) < 0.01);

  const inputs: TurbineInputs = {
    m_dot: 4.2,
    P01: 3500000,
    T01: 720,
    PR: 1.65,
    N: 52000,
    Rm: 0.115,
    R: 0.5,
    turbineType: 'axial',
    gasKey: 'hydrogen',
    phi: 0.55,
  };

  const res = calculateTurbineStage1D(inputs);
  // Δh_is = cp·T01·[1 − (1/1.65)^((γ−1)/γ)] = 14498.84·720·(1 − 0.866879) = 1.3897e6 J/kg
  assertRel(res.dh_is, 14498.842767295599 * 720 * (1 - Math.pow(1 / 1.65, 0.3975 / 1.3975)), 1e-12, 'Δh_is H₂');
  assert.ok(res.dh_is > 1e6, `Hydrogen dh_is must be > 1 MJ/kg, got ${res.dh_is} J/kg`);
  assert.ok(res.C0 > 1400, `C0 must be > 1400 m/s for H2, got ${res.C0}`);
  assert.ok(res.power_kW > 4000, `Shaft power output in MW range: ${res.power_kW} kW`);
  assert.ok(res.eta_Soderberg_tt > 0.65 && res.eta_Soderberg_tt < 0.95, `Soderberg eta for H2: ${res.eta_Soderberg_tt}`);
  assert.ok(res.eta_AM_tt > 0.50 && res.eta_AM_tt < 0.95, `Ainley-Mathieson eta for H2: ${res.eta_AM_tt}`);
});

test('Custom Equations: Modification, parameter tuning, safe evaluation and reset', () => {
  assert.equal(checkIfModified(SAFE_DEFAULT_EQUATIONS), false, 'Safe default must report not modified');

  const customConfig: CustomEquationsConfig = {
    ...SAFE_DEFAULT_EQUATIONS,
    soderberg: { ...SAFE_DEFAULT_EQUATIONS.soderberg, a: 0.08, b: 0.12 },
    sizing: { ...SAFE_DEFAULT_EQUATIONS.sizing, blockageFactor: 0.05 },
  };
  assert.equal(checkIfModified(customConfig), true, 'Modified config must be detected');

  const baseInputs: TurbineInputs = {
    m_dot: 3.0,
    P01: 500000,
    T01: 1150,
    PR: 2.0,
    N: 40000,
    Rm: 0.13,
    R: 0.5,
    turbineType: 'axial',
    gasKey: 'combustionGas',
    phi: 0.60,
    lossModel: 'soderberg',
  };

  const defaultRun = calculateTurbineStage1D(baseInputs);
  const customRun = calculateTurbineStage1D({ ...baseInputs, customEquations: customConfig });
  assert.ok(customRun.soderbergLoss.zeta_R > defaultRun.soderbergLoss.zeta_R, 'Custom Soderberg loss coefficient must be higher');
  assert.ok(customRun.eta_Soderberg_tt < defaultRun.eta_Soderberg_tt, 'Custom conservative Soderberg efficiency must be lower');
  assert.ok(customRun.bladeHeight > defaultRun.bladeHeight, '5% boundary layer blockage must increase blade height');
  const actualRatio = customRun.bladeHeight / defaultRun.bladeHeight;
  assert.ok(Math.abs(actualRatio - 1 / 0.95) < 0.02, `Blade height ratio ~ ${1 / 0.95}, got ${actualRatio}`);

  const safeMath = safeEvaluateMath('0.04 + 0.06 * Math.pow(eps / 100, 2)', { eps: 50 }, 0.05);
  assert.equal(safeMath.error, null);
  assert.ok(Math.abs(safeMath.value - 0.055) < 1e-12);

  const badMath = safeEvaluateMath('0.04 +++ *** / invalid', { eps: 50 }, 0.077);
  assert.ok(badMath.error !== null, 'Bad syntax must return descriptive error');
  assert.equal(badMath.value, 0.077, 'Bad syntax must safely return fallback value');
});

test('Catálogo de ecuaciones: cobertura y evaluación de todos los nodos', () => {
  assert.ok(EQUATION_CATALOG.length >= 25, `Must have at least 25 registered equations (got ${EQUATION_CATALOG.length})`);

  const categories = new Set(EQUATION_CATALOG.map((eq) => eq.category));
  for (const category of ['thermodynamics', 'kinematics', 'geometry', 'losses', 'sandbox'] as const) {
    assert.ok(categories.has(category), `Falta la categoría ${category}`);
  }

  const dummyCtx: EquationEvaluationContext = {
    m_dot: 3.5, P01_bar: 6.0, T01_K: 1250, P02_bar: 3.5, T02_K: 1100, T02s_K: 1080,
    gamma: 1.333, cp_JkgK: 1150, Rgas_JkgK: 287, PR: 1.71, U_ms: 550, Va_ms: 330,
    V1_ms: 520, W1_ms: 360, V2_ms: 360, W2_ms: 520, Vtheta1_ms: 400, Vtheta2_ms: 150,
    Wtheta1_ms: -150, Wtheta2_ms: -400, alpha1_deg: 50.5, alpha2_deg: 24.5, beta1_deg: -24.5,
    beta2_deg: -50.5, eps_deg: 26.0, Mach_abs1: 0.80, Mach_rel1: 0.55, speedOfSound_ms: 650,
    dh0_kJkg: 145, dh0s_kJkg: 175, reaction_R: 0.50, flowCoeff_phi: 0.60, stageLoading_psi: 1.25,
    bladeHeight_mm: 12.5, annulusArea_m2: 0.011, Rm_m: 0.14, Rhub_m: 0.133, Rtip_m: 0.146,
    aspectRatio: 0.85, chord_mm: 15.0, solidity_sc: 0.85, numBlades: 17, eta_tt: 0.83, eta_ts: 0.75,
    reheatFactor: 1.01, dh_is_Jkg: 175000, dh_loss_stator_Jkg: 9000, dh_loss_rotor_Jkg: 10000,
    dh_loss_soderberg_Jkg: 19000, dh_loss_ainley_Jkg: 18000, Mach_rel2: 0.9, zeta_N: 0.06,
    zeta_R: 0.07, Yp_rotor: 0.04, Ys_rotor: 0.03, Ytc_rotor: 0.015,
  };

  for (const eq of EQUATION_CATALOG) {
    assert.ok(eq.id && eq.name && eq.latex && eq.theoreticalRef, `Nodo incompleto: ${eq.id}`);
    assert.ok(eq.symbols.length > 0, `Equation ${eq.id} must have symbols`);
    assert.ok(!/AI Studio/i.test(eq.theoreticalRef), `Referencia heredada en ${eq.id}`);
    const evalResult = eq.evaluate(dummyCtx, SAFE_DEFAULT_EQUATIONS);
    assert.ok(evalResult.outputLabel, `Equation ${eq.id} evaluation must return outputLabel`);
    assert.ok(evalResult.outputValue !== undefined, `Equation ${eq.id} evaluation must return outputValue`);
  }

  // La vista previa de Soderberg usa la misma correlación, fila y t/c que el solver
  const nominal = EQUATION_CATALOG.find((eq) => eq.id === 'loss_soderberg_nominal');
  assert.ok(nominal);
  const preview = nominal.evaluate(dummyCtx, SAFE_DEFAULT_EQUATIONS);
  const solver = evaluateCustomSoderberg(SAFE_DEFAULT_EQUATIONS, 26.0, 0.85, { row: 'rotor', tmaxToChord: 0.20 });
  assert.equal(preview.outputValue, solver.zeta_nominal.toFixed(4));
  assert.equal(preview.outputValue, (0.04 + 0.06 * 0.26 ** 2).toFixed(4));
});
