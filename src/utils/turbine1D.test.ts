import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTurbineStage1D,
  calculateMultiStageTurbine,
  GAS_PRESETS,
  type TurbineInputs,
} from './turbine1D';
import {
  SAFE_DEFAULT_EQUATIONS,
  checkIfModified,
  safeEvaluateMath,
  EQUATION_CATALOG,
  type CustomEquationsConfig,
} from './customEquations';

test('1D Turbine Stage: Baseline 50% reaction axial gas turbine', () => {
  const inputs: TurbineInputs = {
    m_dot: 2.5,          // 2.5 kg/s
    P01: 400000,         // 4.0 bar
    T01: 1100,           // 1100 K
    PR: 2.2,             // Pressure ratio
    N: 45000,            // 45,000 RPM
    Rm: 0.12,            // 0.12 m mean radius
    R: 0.5,              // 50% reaction stage
    turbineType: 'axial',
    gasKey: 'combustionGas',
    phi: 0.60,
  };

  const res = calculateTurbineStage1D(inputs);

  // 1. Blade peripheral speed U = 2 * pi * Rm * N / 60
  const expectedU = (2 * Math.PI * inputs.Rm * inputs.N) / 60;
  assert.ok(Math.abs(res.U - expectedU) < 1e-4, `Expected U ~ ${expectedU}, got ${res.U}`);
  assert.ok(res.U > 500 && res.U < 650, `U should be around 565 m/s, got ${res.U}`);

  // 2. Isentropic enthalpy drop and C0
  assert.ok(res.dh_is > 200000 && res.dh_is < 350000, `dh_is should be ~225 kJ/kg, got ${res.dh_is}`);
  const expectedC0 = Math.sqrt(2 * res.dh_is);
  assert.ok(Math.abs(res.C0 - expectedC0) < 1e-4, `C0 calculation mismatch`);

  // 3. Velocity ratio nu = U / C0
  assert.ok(res.nu > 0.6 && res.nu < 0.9, `Velocity ratio nu should be reasonable, got ${res.nu}`);

  // 4. Flow and loading coefficients
  assert.ok(Math.abs(res.phi - 0.60) < 1e-4, `phi must match input`);
  assert.ok(res.psi > 0.5 && res.psi < 2.5, `psi should be physically sound, got ${res.psi}`);

  // 5. Velocity triangles
  const { inletTriangle, outletTriangle } = res;
  // V1^2 = Va^2 + V_theta1^2
  const v1_calc = Math.sqrt(inletTriangle.Va ** 2 + inletTriangle.V_theta ** 2);
  assert.ok(Math.abs(inletTriangle.V - v1_calc) < 1e-4, `Inlet V magnitude must match components`);

  // W_theta1 = V_theta1 - U
  assert.ok(Math.abs(inletTriangle.W_theta - (inletTriangle.V_theta - res.U)) < 1e-4, `Inlet relative swirl check`);

  // Outlet triangle
  const v2_calc = Math.sqrt(outletTriangle.Va ** 2 + outletTriangle.V_theta ** 2);
  assert.ok(Math.abs(outletTriangle.V - v2_calc) < 1e-4, `Outlet V magnitude must match components`);

  // Reaction consistency
  // Kinematic reaction R = 1 - (V_theta1 + V_theta2)/(2*U)
  assert.ok(Math.abs(res.reaction_actual - inputs.R) < 0.05, `Reaction actual ${res.reaction_actual} must match input R ${inputs.R}`);

  // 6. Efficiency estimations (Balje & NASA SP-8110)
  assert.ok(res.eta_Balje >= 0.70 && res.eta_Balje <= 0.95, `Balje efficiency in realistic range: ${res.eta_Balje}`);
  assert.ok(res.eta_NASA_tt >= 0.70 && res.eta_NASA_tt <= 0.95, `NASA total-to-total efficiency in realistic range: ${res.eta_NASA_tt}`);
  assert.ok(res.eta_NASA_ts < res.eta_NASA_tt, `Total-to-static must be lower than total-to-total due to exit kinetic energy`);

  // 7. Power output
  assert.ok(res.power_kW > 300 && res.power_kW < 1000, `Shaft power in kW range for micro-turbine: ${res.power_kW}`);
  assert.ok(res.torque_Nm > 50 && res.torque_Nm < 200, `Shaft torque in realistic range: ${res.torque_Nm}`);
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

test('1D Turbine Stage: Impulse stage (R = 0.0)', () => {
  const inputs: TurbineInputs = {
    m_dot: 5.0,
    P01: 600000,
    T01: 1200,
    PR: 2.0,
    N: 18000,            // 18,000 RPM (realistic for impulse stage with U ~ 320 m/s)
    Rm: 0.17,            // 0.17 m mean radius
    R: 0.0,              // Pure impulse stage
    turbineType: 'axial',
    gasKey: 'air',
    phi: 0.50,
  };

  const res = calculateTurbineStage1D(inputs);
  assert.ok(res.reaction_actual < 0.05, `Reaction should be close to 0, got ${res.reaction_actual}`);
  assert.ok(res.psi > 1.4 && res.psi < 2.5, `Impulse stage has higher stage loading psi ~ 1.8-2.0, got ${res.psi}`);
});

test('Multi-Stage Turbine: 2-stage conventional axial turbine with reheat factor', () => {
  const multiInputs = {
    m_dot: 5.0,
    P01: 800000, // 8.0 bar
    T01: 1300,   // 1300 K
    gasKey: 'combustionGas' as const,
    stages: [
      {
        id: 'stage-1',
        name: 'Etapa 1 (HP)',
        PR: 1.8,
        N: 36000,
        direction: 1 as const,
        Rm: 0.16,
        R: 0.50,
        phi: 0.58,
        turbineType: 'axial' as const,
      },
      {
        id: 'stage-2',
        name: 'Etapa 2 (LP)',
        PR: 1.8,
        N: 32000,
        direction: 1 as const,
        Rm: 0.19,
        R: 0.50,
        phi: 0.58,
        turbineType: 'axial' as const,
      },
    ],
  };

  const res = calculateMultiStageTurbine(multiInputs);
  assert.equal(res.stageResults.length, 2);
  assert.ok(Math.abs(res.PR_overall - 1.8 * 1.8) < 1e-4, 'PR_overall should be 3.24');
  assert.ok(res.stageResults[1].inputs.P01 < res.stageResults[0].inputs.P01, 'Stage 2 inlet pressure matches Stage 1 exit');
  assert.ok(res.stageResults[1].inputs.T01 < res.stageResults[0].inputs.T01, 'Stage 2 inlet temperature matches Stage 1 exit');
  assert.ok(res.reheatFactor >= 1.0, `Reheat factor must be >= 1.0, got ${res.reheatFactor}`);
  assert.ok(res.power_total_kW > 1000, `Total power must be positive and significant: ${res.power_total_kW} kW`);
});

test('Multi-Stage Turbine: 2-stage Vaneless Counter-Rotating Turbine (CRTF)', () => {
  const crInputs = {
    m_dot: 3.5,
    P01: 600000, // 6.0 bar
    T01: 1250,   // 1250 K
    gasKey: 'combustionGas' as const,
    stages: [
      {
        id: 'stage-1',
        name: 'Rotor 1 (Co-rotativo +)',
        PR: 1.7,
        N: 38000,
        direction: 1 as const, // Forward rotation
        Rm: 0.14,
        R: 0.50,
        phi: 0.60,
        turbineType: 'axial' as const,
      },
      {
        id: 'stage-2',
        name: 'Rotor 2 (Contrarrotativo -)',
        PR: 1.7,
        N: 36000,
        direction: -1 as const, // Counter-rotating!
        Rm: 0.15,
        R: 0.50,
        phi: 0.60,
        turbineType: 'axial' as const,
        interStageCoupling: 'vaneless' as const, // Direct swirl transfer!
      },
    ],
  };

  const res = calculateMultiStageTurbine(crInputs);
  assert.equal(res.isCounterRotating, true, 'Machine must detect counter-rotating architecture');
  assert.equal(res.vanelessStagesCount, 1, 'Vaneless coupling counted correctly');

  const s1 = res.stageResults[0];
  const s2 = res.stageResults[1];

  // Stage 1 rotates in + direction, Stage 2 in - direction
  assert.ok(s1.U > 0, 'Stage 1 blade velocity is positive');
  assert.ok(s2.U < 0, 'Stage 2 blade velocity is negative (counter-rotating)');

  // Swirl transfer verification: V_theta entering Stage 2 equals V_theta leaving Stage 1
  assert.ok(
    Math.abs(s2.inletTriangle.V_theta - s1.outletTriangle.V_theta) < 1e-4,
    `Stage 2 inlet swirl (${s2.inletTriangle.V_theta}) must match Stage 1 outlet swirl (${s1.outletTriangle.V_theta})`
  );

  // Torque cancellation in counter-rotating turbine
  assert.ok(s1.torque_Nm > 0, 'Stage 1 torque is positive');
  assert.ok(s2.torque_Nm < 0, 'Stage 2 torque is negative (counter-rotating)');
  assert.ok(
    Math.abs(res.net_torque_Nm) < Math.abs(s1.torque_Nm),
    'Net torque is significantly lower due to counter-rotation torque cancellation'
  );
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

  // 1. Calculate with Soderberg model
  const resSoderberg = calculateTurbineStage1D({ ...baseInputs, lossModel: 'soderberg' });
  assert.equal(resSoderberg.activeLossModel, 'soderberg');
  assert.ok(resSoderberg.soderbergLoss, 'Soderberg breakdown must exist');
  assert.ok(resSoderberg.eta_Soderberg_tt > 0.80 && resSoderberg.eta_Soderberg_tt < 0.95, `Soderberg eta_tt in range: ${resSoderberg.eta_Soderberg_tt}`);
  assert.ok(resSoderberg.eta_Soderberg_ts < resSoderberg.eta_Soderberg_tt, 'Soderberg eta_ts < eta_tt');
  assert.equal(resSoderberg.efficiency_recommended, resSoderberg.eta_Soderberg_tt);

  // 2. Calculate with Ainley & Mathieson model
  const resAM = calculateTurbineStage1D({ ...baseInputs, lossModel: 'ainley_mathieson' });
  assert.equal(resAM.activeLossModel, 'ainley_mathieson');
  assert.ok(resAM.ainleyMathiesonLoss, 'Ainley-Mathieson breakdown must exist');
  assert.ok(resAM.ainleyMathiesonLoss.Yp_rotor > 0, 'Rotor profile loss Yp must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.Ys_rotor > 0, 'Rotor secondary loss Ys must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.Ytc_rotor > 0, 'Rotor tip clearance loss Ytc must be positive');
  assert.ok(resAM.ainleyMathiesonLoss.CL_rotor > 0, 'Rotor aerodynamic lift coefficient must be positive');
  assert.ok(resAM.eta_AM_tt > 0.78 && resAM.eta_AM_tt < 0.95, `Ainley-Mathieson eta_tt in range: ${resAM.eta_AM_tt}`);
  assert.ok(resAM.eta_AM_ts < resAM.eta_AM_tt, 'Ainley-Mathieson eta_ts < eta_tt');
  assert.equal(resAM.efficiency_recommended, resAM.eta_AM_tt);

  // 3. Verify both models are simultaneously calculated and available in stage outputs
  assert.ok(Math.abs(resSoderberg.eta_AM_tt - resAM.eta_AM_tt) < 0.03, 'Ainley-Mathieson values computed consistently across runs');
  assert.ok(Math.abs(resAM.eta_Soderberg_tt - resSoderberg.eta_Soderberg_tt) < 0.03, 'Soderberg values computed consistently across runs');

  // 4. Verify power output responds to selected loss model
  assert.ok(resSoderberg.power_kW > 0, 'Soderberg power is positive');
  assert.ok(resAM.power_kW > 0, 'Ainley-Mathieson power is positive');
  // Both give realistic engineering estimates within reasonable relative difference
  const diffPct = Math.abs(resSoderberg.power_kW - resAM.power_kW) / resSoderberg.power_kW;
  assert.ok(diffPct < 0.12, `Difference between loss models should be within 12%, got ${(diffPct * 100).toFixed(2)}%`);
});

test('1D Turbine Stage: Hydrogen gas (H2) properties and cryo-turbopump expansion', () => {
  assert.ok(GAS_PRESETS.hydrogen, 'Hydrogen preset must exist in GAS_PRESETS');
  assert.equal(GAS_PRESETS.hydrogen.gamma, 1.3975);
  assert.equal(GAS_PRESETS.hydrogen.R_gas, 4124.0);
  assert.ok(Math.abs(GAS_PRESETS.hydrogen.Cp - 14498.8428) < 0.01);

  const inputs: TurbineInputs = {
    m_dot: 4.2,          // 4.2 kg/s
    P01: 3500000,        // 35 bar
    T01: 720,            // 720 K
    PR: 1.65,            // Expansion ratio
    N: 52000,            // 52,000 RPM (rocket turbopump speed)
    Rm: 0.115,           // 115 mm mean radius
    R: 0.5,              // 50% reaction
    turbineType: 'axial',
    gasKey: 'hydrogen',
    phi: 0.55,
  };

  const res = calculateTurbineStage1D(inputs);

  // High Cp of hydrogen (~14.3 kJ/kg·K) causes high enthalpy drop even for moderate PR and T01
  assert.ok(res.dh_is > 1e6, `Hydrogen dh_is must be > 1 MJ/kg due to huge Cp, got ${res.dh_is} J/kg`);
  assert.ok(res.C0 > 1400, `Theoretical spouting velocity C0 must be > 1400 m/s for H2, got ${res.C0}`);

  // Power output is large due to high dh (~5-7 MW for 4.2 kg/s)
  assert.ok(res.power_kW > 4000, `Shaft power output in MW range: ${res.power_kW} kW`);

  // Both loss models work accurately with hydrogen
  assert.ok(res.eta_Soderberg_tt > 0.65 && res.eta_Soderberg_tt < 0.95, `Soderberg eta for H2: ${res.eta_Soderberg_tt}`);
  assert.ok(res.eta_AM_tt > 0.50 && res.eta_AM_tt < 0.95, `Ainley-Mathieson eta for H2: ${res.eta_AM_tt}`);
});

test('Custom Equations: Modification, parameter tuning, safe evaluation and reset', () => {
  // 1. Check default safe state
  assert.equal(checkIfModified(SAFE_DEFAULT_EQUATIONS), false, 'Safe default must report not modified');

  // 2. Custom Soderberg with conservative high-loss coefficients
  const customConfig: CustomEquationsConfig = {
    ...SAFE_DEFAULT_EQUATIONS,
    soderberg: {
      ...SAFE_DEFAULT_EQUATIONS.soderberg,
      a: 0.08, // Increased base loss
      b: 0.12, // Double turning sensitivity
    },
    sizing: {
      ...SAFE_DEFAULT_EQUATIONS.sizing,
      blockageFactor: 0.05, // 5% boundary layer blockage
    },
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

  // Custom conservative Soderberg must have higher loss and lower efficiency
  assert.ok(
    customRun.soderbergLoss.zeta_R > defaultRun.soderbergLoss.zeta_R,
    'Custom Soderberg loss coefficient must be higher'
  );
  assert.ok(
    customRun.eta_Soderberg_tt < defaultRun.eta_Soderberg_tt,
    'Custom conservative Soderberg efficiency must be lower'
  );

  // 5% blockage must increase annulus area and blade height
  assert.ok(
    customRun.bladeHeight > defaultRun.bladeHeight,
    '5% boundary layer blockage must increase blade height'
  );
  const expectedHeightRatio = 1 / (1 - 0.05);
  const actualRatio = customRun.bladeHeight / defaultRun.bladeHeight;
  assert.ok(
    Math.abs(actualRatio - expectedHeightRatio) < 0.02,
    `Blade height ratio ~ ${expectedHeightRatio}, got ${actualRatio}`
  );

  // 3. Test safeEvaluateMath sandbox error handling
  const safeMath = safeEvaluateMath('0.04 + 0.06 * Math.pow(eps / 100, 2)', { eps: 50 }, 0.05);
  assert.equal(safeMath.error, null);
  assert.ok(Math.abs(safeMath.value - 0.055) < 1e-4);

  // Syntax error returns fallback without crashing
  const badMath = safeEvaluateMath('0.04 +++ *** / invalid', { eps: 50 }, 0.077);
  assert.ok(badMath.error !== null, 'Bad syntax must return descriptive error');
  assert.equal(badMath.value, 0.077, 'Bad syntax must safely return fallback value');
});

test('Star-CCM+ Equation Catalog: Comprehensive coverage of thermodynamics, kinematics, geometry, losses, and sandbox', () => {
  assert.ok(Array.isArray(EQUATION_CATALOG), 'EQUATION_CATALOG must be an array');
  assert.ok(EQUATION_CATALOG.length >= 25, `Must have at least 25 registered equations (got ${EQUATION_CATALOG.length})`);

  // Verify categories
  const categories = new Set(EQUATION_CATALOG.map((eq: any) => eq.category));
  assert.ok(categories.has('thermodynamics'), 'Must contain thermodynamics category');
  assert.ok(categories.has('kinematics'), 'Must contain kinematics category');
  assert.ok(categories.has('geometry'), 'Must contain geometry category');
  assert.ok(categories.has('losses'), 'Must contain losses category');
  assert.ok(categories.has('sandbox'), 'Must contain sandbox category');

  // Verify each node structure
  const dummyCtx = {
    m_dot: 3.5,
    P01_bar: 6.0,
    T01_K: 1250,
    P02_bar: 3.5,
    T02_K: 1100,
    T02s_K: 1080,
    gamma: 1.333,
    cp_JkgK: 1150,
    Rgas_JkgK: 287,
    PR: 1.71,
    U_ms: 550,
    Va_ms: 330,
    V1_ms: 520,
    W1_ms: 360,
    V2_ms: 360,
    W2_ms: 520,
    Vtheta1_ms: 400,
    Vtheta2_ms: 150,
    Wtheta1_ms: -150,
    Wtheta2_ms: -400,
    alpha1_deg: 50.5,
    alpha2_deg: 24.5,
    beta1_deg: -24.5,
    beta2_deg: -50.5,
    eps_deg: 26.0,
    Mach_abs1: 0.80,
    Mach_rel1: 0.55,
    speedOfSound_ms: 650,
    dh0_kJkg: 145,
    dh0s_kJkg: 175,
    reaction_R: 0.50,
    flowCoeff_phi: 0.60,
    stageLoading_psi: 1.25,
    bladeHeight_mm: 12.5,
    annulusArea_m2: 0.011,
    Rm_m: 0.14,
    Rhub_m: 0.133,
    Rtip_m: 0.146,
    aspectRatio: 0.85,
    chord_mm: 15.0,
    solidity_sc: 0.85,
    numBlades: 17,
    eta_tt: 0.83,
    eta_ts: 0.75,
    reheatFactor: 1.01,
  };

  EQUATION_CATALOG.forEach((eq: any) => {
    assert.ok(eq.id, 'Equation must have id');
    assert.ok(eq.name, 'Equation must have name');
    assert.ok(eq.latex, 'Equation must have LaTeX representation');
    assert.ok(eq.theoreticalRef, 'Equation must have citation');
    assert.ok(Array.isArray(eq.symbols) && eq.symbols.length > 0, 'Equation must have symbols');

    const evalResult = eq.evaluate(dummyCtx, SAFE_DEFAULT_EQUATIONS);
    assert.ok(evalResult.outputLabel, `Equation ${eq.id} evaluation must return outputLabel`);
    assert.ok(evalResult.outputValue !== undefined, `Equation ${eq.id} evaluation must return outputValue`);
  });
});



