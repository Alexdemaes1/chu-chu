import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_DEFAULT_EQUATIONS,
  compileExpression,
  normalizeCustomEquations,
  normalizeCustomEquationsReport,
  safeEvaluateMath,
  type CustomEquationsConfig,
} from './customEquations';
import { calculateTurbineStage1D, type TurbineInputs } from './turbine1D';

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
  phi: 0.6,
  pitchToChord: 0.8,
  tmaxToChord: 0.2,
  tipClearanceRatio: 0.015,
};

/** Comprueba recursivamente que `actual` tiene la misma forma y los mismos tipos que `reference`. */
function assertSameShape(actual: unknown, reference: unknown, path = 'config') {
  if (Array.isArray(reference)) {
    assert.ok(Array.isArray(actual), `${path} debe ser un array`);
    return;
  }
  if (typeof reference === 'object' && reference !== null) {
    assert.ok(typeof actual === 'object' && actual !== null && !Array.isArray(actual), `${path} debe ser un objeto`);
    const actualRecord = actual as Record<string, unknown>;
    const referenceRecord = reference as Record<string, unknown>;
    assert.deepEqual(Object.keys(actualRecord).sort(), Object.keys(referenceRecord).sort(), `${path}: claves`);
    for (const key of Object.keys(referenceRecord)) {
      assertSameShape(actualRecord[key], referenceRecord[key], `${path}.${key}`);
    }
    return;
  }
  assert.equal(typeof actual, typeof reference, `${path}: tipo`);
  if (typeof reference === 'number') assert.ok(Number.isFinite(actual), `${path} debe ser finito`);
}

function assertSolverFinite(config: CustomEquationsConfig) {
  for (const lossModel of ['soderberg', 'ainley_mathieson', 'user_defined'] as const) {
    const res = calculateTurbineStage1D({ ...EXAMPLE_INPUTS, lossModel, customEquations: config });
    assert.ok(Number.isFinite(res.efficiency_recommended), `η no finito con ${lossModel}`);
    assert.ok(Number.isFinite(res.bladeHeight) && res.bladeHeight > 0, `h no finita con ${lossModel}`);
    assert.ok(Number.isFinite(res.power_kW), `potencia no finita con ${lossModel}`);
  }
}

test('normalize: la configuración por defecto pasa intacta y sin restablecimientos', () => {
  const { config, resetCount } = normalizeCustomEquationsReport(SAFE_DEFAULT_EQUATIONS);
  assert.equal(resetCount, 0);
  assert.deepEqual(config, SAFE_DEFAULT_EQUATIONS);
  assert.notEqual(config.soderberg, SAFE_DEFAULT_EQUATIONS.soderberg, 'devuelve copias, no las referencias por defecto');
  assert.deepEqual(normalizeCustomEquations(undefined), SAFE_DEFAULT_EQUATIONS);
  assert.equal(normalizeCustomEquationsReport(undefined).resetCount, 0);
  assert.equal(normalizeCustomEquationsReport({}).resetCount, 0);
});

test('normalize: JSON corrupto se restablece campo a campo y el solver sigue dando valores finitos', () => {
  const corrupt: Record<string, unknown> = {
    version: 999,
    name: { nested: 'objeto en name' },
    isModified: 'sí',
    unknownTopLevel: { anything: true },
    userEquations: [
      { id: 'ok', name: 'Válida', expression: 'eps * 2', description: 'conservada' },
      { id: 1, name: 'id numérico', expression: 'eps', description: '' },
      null,
      'texto',
    ],
    userDefinedLoss: { enabled: 'true', name: 42, lossFractionExpression: null },
    soderberg: {
      a: '0.05',          // texto numérico: se acepta
      b: Number.NaN,      // no finito
      c: '',              // texto vacío: Number('') sería 0, no se acepta
      d: null,
      customExpression: 123,
      customArExpression: 'x'.repeat(2001),
      extraKey: 5,
    },
    ainleyMathieson: 7,
    sizing: { blockageFactor: 'abc', aspectRatioTarget: Infinity, useCustomHeightFormula: 1 },
    zweifel: { psi_Z_target: 'cero coma nueve', multiplier: '2.5' },
    thermodynamics: [],
    kinematics: { eulerWorkMultiplier: true },
    geometry: { freeVortexExponent: '1e0' },
  };

  const { config, resetCount } = normalizeCustomEquationsReport(corrupt);
  assertSameShape(config, SAFE_DEFAULT_EQUATIONS);

  // Restablecidos (20): name y isModified (2); 3 ecuaciones de usuario (5); enabled, name y
  // expresión de userDefinedLoss (8); b, c, d, customExpression y customArExpression de Soderberg
  // (13); la sección A&M entera (14); blockageFactor, aspectRatioTarget y useCustomHeightFormula
  // (17); psi_Z_target (18); la sección thermodynamics entera (19) y eulerWorkMultiplier (20).
  assert.equal(resetCount, 20);

  assert.equal(config.version, SAFE_DEFAULT_EQUATIONS.version);
  assert.equal(config.name, SAFE_DEFAULT_EQUATIONS.name);
  assert.equal(config.isModified, false);
  assert.deepEqual(config.userEquations, [{ id: 'ok', name: 'Válida', expression: 'eps * 2', description: 'conservada' }]);
  assert.deepEqual(config.userDefinedLoss, SAFE_DEFAULT_EQUATIONS.userDefinedLoss);
  assert.equal(config.soderberg.a, 0.05);
  assert.equal(config.soderberg.b, SAFE_DEFAULT_EQUATIONS.soderberg.b);
  assert.equal(config.soderberg.c, SAFE_DEFAULT_EQUATIONS.soderberg.c);
  assert.equal(config.soderberg.d, SAFE_DEFAULT_EQUATIONS.soderberg.d);
  assert.equal(config.soderberg.customExpression, SAFE_DEFAULT_EQUATIONS.soderberg.customExpression);
  assert.equal(config.soderberg.customArExpression, SAFE_DEFAULT_EQUATIONS.soderberg.customArExpression);
  assert.ok(!('extraKey' in config.soderberg), 'las claves desconocidas se descartan');
  assert.ok(!('unknownTopLevel' in config));
  assert.deepEqual(config.ainleyMathieson, SAFE_DEFAULT_EQUATIONS.ainleyMathieson);
  assert.equal(config.sizing.blockageFactor, 0);
  assert.equal(config.sizing.aspectRatioTarget, 1.6);
  assert.equal(config.sizing.useCustomHeightFormula, false);
  assert.equal(config.zweifel.psi_Z_target, SAFE_DEFAULT_EQUATIONS.zweifel.psi_Z_target);
  assert.equal(config.zweifel.multiplier, 2.5, 'texto numérico aceptado');
  assert.deepEqual(config.thermodynamics, SAFE_DEFAULT_EQUATIONS.thermodynamics);
  assert.equal(config.kinematics.eulerWorkMultiplier, 1);
  assert.equal(config.geometry.freeVortexExponent, 1);

  assertSolverFinite(config);
});

test('normalize: entradas no objeto', () => {
  for (const value of [null, 42, 'texto', [1, 2], true]) {
    const { config, resetCount } = normalizeCustomEquationsReport(value);
    assert.deepEqual(config, SAFE_DEFAULT_EQUATIONS);
    assert.equal(resetCount, value === null ? 0 : 1, `resetCount para ${JSON.stringify(value)}`);
  }
});

test('normalize: números, booleanos y expresiones con tipo incorrecto en cada sección', () => {
  const nullExpressions = normalizeCustomEquationsReport({
    ainleyMathieson: { useCustomFormula: true, customYpExpression: null, customYsExpression: 3, nozzleA: '0.03' },
    soderberg: { useCustomFormula: true, customExpression: null },
    sizing: { useCustomHeightFormula: true, customHeightExpression: { a: 1 } },
  });
  assert.equal(nullExpressions.resetCount, 4);
  assert.equal(nullExpressions.config.ainleyMathieson.useCustomFormula, true);
  assert.equal(nullExpressions.config.ainleyMathieson.nozzleA, 0.03);
  assert.equal(nullExpressions.config.ainleyMathieson.customYpExpression, SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYpExpression);
  assertSolverFinite(nullExpressions.config);
});

test('normalize: migra las expresiones por defecto antiguas', () => {
  const legacy = normalizeCustomEquations({
    soderberg: { customArExpression: '0.975 + 0.075 / AR' },
    ainleyMathieson: {
      customYsExpression: '(secondaryCoeff / AR) * Math.pow(CL_sc, 2) * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3))',
    },
  });
  assert.equal(legacy.soderberg.customArExpression, SAFE_DEFAULT_EQUATIONS.soderberg.customArExpression);
  assert.equal(legacy.ainleyMathieson.customYsExpression, SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYsExpression);
  // Una expresión propia (distinta del texto antiguo exacto) se respeta
  const own = normalizeCustomEquations({ soderberg: { customArExpression: '0.97 + 0.08 / AR' } });
  assert.equal(own.soderberg.customArExpression, '0.97 + 0.08 / AR');
});

test('normalize: configuraciones antiguas sin los campos nuevos de Soderberg toman sus valores por defecto', () => {
  const { config, resetCount } = normalizeCustomEquationsReport({
    version: 1,
    soderberg: { enabled: true, useCustomFormula: false, a: 0.04, b: 0.06, c: 2, d: 0.975, e: 0.075 },
  });
  assert.equal(resetCount, 0);
  assert.equal(config.soderberg.dStator, 0.993);
  assert.equal(config.soderberg.eStator, 0.021);
  assert.equal(config.soderberg.tk, 0);
});

test('Evaluador: rechaza nombres heredados de Object.prototype', () => {
  for (const expr of ['constructor(5)', 'valueOf()', 'isPrototypeOf(1)', 'toString()', 'hasOwnProperty(1)', '__proto__(1)']) {
    const res = safeEvaluateMath(expr, { eps: 1 }, 0.123);
    assert.equal(res.value, 0.123, expr);
    assert.ok(res.error?.startsWith('Función no permitida'), `${expr}: ${res.error}`);
  }
  for (const expr of ['constructor', 'toString', '__proto__', 'valueOf + 1']) {
    const res = safeEvaluateMath(expr, { eps: 1 }, 0.5);
    assert.equal(res.value, 0.5, expr);
    assert.ok(res.error?.startsWith('Variable no disponible'), `${expr}: ${res.error}`);
  }
});

test('Evaluador: aridad, errores en español y entradas no válidas', () => {
  const arity = safeEvaluateMath('Math.pow(2)', {}, 1);
  assert.equal(arity.value, 1);
  assert.match(arity.error ?? '', /^Math\.pow espera 2 argumentos y recibe 1\./);
  assert.match(safeEvaluateMath('Math.sqrt(1, 2)', {}, 1).error ?? '', /espera 1 argumento/);
  assert.equal(safeEvaluateMath('Math.max(1, 5, 3)', {}, 0).value, 5);
  assert.equal(safeEvaluateMath('Math.hypot(3, 4)', {}, 0).value, 5);

  assert.match(safeEvaluateMath('1 / 0', {}, 2).error ?? '', /no es un número finito/);
  assert.match(safeEvaluateMath('(1 + 2', {}, 2).error ?? '', /^Se esperaba «\)»/);
  assert.match(safeEvaluateMath('2 $ 3', {}, 2).error ?? '', /^Carácter no permitido en la posición 3/);
  assert.match(safeEvaluateMath('x'.repeat(1025), {}, 2).error ?? '', /supera 1024 caracteres/);
  assert.match(safeEvaluateMath('('.repeat(150) + '1' + ')'.repeat(150), {}, 2).error ?? '', /anidada en exceso/);
  // Todas terminan con el aviso de respaldo en español
  assert.match(safeEvaluateMath('foo(1)', {}, 2).error ?? '', /Se aplica la fórmula de respaldo\.$/);

  // Valores que no son texto (JSON corrupto que no pasó por normalize)
  const notText = safeEvaluateMath(null as unknown as string, {}, 3);
  assert.equal(notText.value, 3);
  assert.match(notText.error ?? '', /no es un texto/);
  // Vacía: respaldo sin error
  assert.deepEqual(safeEvaluateMath('   ', {}, 4), { value: 4, error: null });
  // Variable del alcance que no es número
  assert.equal(safeEvaluateMath('x + 1', { x: 'a' as unknown as number }, 9).value, 9);
});

test('Evaluador: precedencia y asociatividad', () => {
  assert.equal(safeEvaluateMath('2 + 3 * 4', {}, 0).value, 14);
  assert.equal(safeEvaluateMath('-2^2', {}, 0).value, -4);
  assert.equal(safeEvaluateMath('2^3^2', {}, 0).value, 512);
  assert.equal(safeEvaluateMath('2**-1', {}, 0).value, 0.5);
  assert.equal(safeEvaluateMath('10 % 4 - 1', {}, 0).value, 1);
  assert.equal(safeEvaluateMath('pi - Math.PI', {}, 1).value, 0);
  // El alcance tiene prioridad sobre las constantes
  assert.equal(safeEvaluateMath('pi', { pi: 3 }, 0).value, 3);
});

test('Evaluador: las expresiones por defecto dan exactamente lo mismo que su fórmula en JavaScript', () => {
  const am = SAFE_DEFAULT_EQUATIONS.ainleyMathieson;
  const so = SAFE_DEFAULT_EQUATIONS.soderberg;
  const b1 = 0.29;
  const b2 = -0.94;
  const bm = Math.atan(0.5 * (Math.tan(b1) + Math.tan(b2)));
  const scope = {
    eps: 53.85, AR: 1.6, row: 1, tc: 0.2, Yp_base: 0.041, xi: 0.3, t_over_c: 0.2, s_over_c: 0.8,
    secondaryCoeff: 0.033, CL_sc: 2.6, b1, b2, bm, B_tip: 0.5, tipClearanceRatio: 0.015,
    nozzleA: 0.025, nozzleB: 0.065, abs_alpha1: 53.85, Area: 0.012, blockage: 0.02, Rm: 0.12,
    dh_loss_stator: 9000, dh_loss_rotor: 11000, dh_is: 225000,
  };
  const cases: [string, number][] = [
    [so.customExpression, 0.04 + 0.06 * Math.pow(scope.eps / 100, 2)],
    [so.customArExpression, (1 - 1) * (0.993 + 0.021 / scope.AR) + 1 * (0.975 + 0.075 / scope.AR)],
    [am.customYpExpression, scope.Yp_base * Math.pow(scope.t_over_c / 0.20, scope.xi)],
    [am.customYsExpression, (scope.secondaryCoeff / scope.AR) * Math.pow(scope.CL_sc, 2)
      * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3)) * (Math.cos(b2) / Math.cos(b1))],
    [am.customYpStatorExpression, scope.Yp_base * Math.pow(scope.t_over_c / 0.20, scope.xi)],
    [am.customYtcExpression, scope.B_tip * scope.tipClearanceRatio * Math.pow(scope.CL_sc, 2)
      * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3))],
    [SAFE_DEFAULT_EQUATIONS.sizing.customHeightExpression, (scope.Area / (1 - scope.blockage)) / (2 * Math.PI * scope.Rm)],
    [SAFE_DEFAULT_EQUATIONS.userDefinedLoss.lossFractionExpression, (scope.dh_loss_stator + scope.dh_loss_rotor) / scope.dh_is],
  ];
  for (const [expr, expected] of cases) {
    const res = safeEvaluateMath(expr, scope, Number.NaN);
    assert.equal(res.error, null, expr);
    assert.equal(res.value, expected, expr);
  }
  // Fila del estator en la expresión de aspecto de Soderberg: 0.993 + 0.021/1.6 = 1.006125
  assert.equal(safeEvaluateMath(so.customArExpression, { ...scope, row: 0 }, Number.NaN).value, 0.993 + 0.021 / 1.6);
});

test('Evaluador: compila una vez (caché) y es rápido en bucles', () => {
  const expr = SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYsExpression;
  const first = compileExpression(expr);
  assert.equal(first.ok, true);
  assert.equal(compileExpression(expr), first, 'la segunda compilación sale de la caché');
  assert.equal(compileExpression('Math.pow(').ok, false);

  // La caché está acotada: tras 300 expresiones distintas sigue funcionando
  for (let i = 0; i < 300; i++) compileExpression(`eps + ${i}`);
  assert.equal(safeEvaluateMath('eps + 7', { eps: 1 }, 0).value, 8);

  const scope = { secondaryCoeff: 0.033, AR: 1.6, CL_sc: 2.6, b1: 0.29, b2: -0.94, bm: -0.4 };
  safeEvaluateMath(expr, scope, 0);
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < 10_000; i++) {
    sum += safeEvaluateMath(expr, { ...scope, CL_sc: 2 + i * 1e-5 }, 0).value;
  }
  const elapsed = performance.now() - start;
  assert.ok(Number.isFinite(sum));
  assert.ok(elapsed < 50, `10 000 evaluaciones de la fórmula A&M en ${elapsed.toFixed(1)} ms (límite 50 ms)`);
});
