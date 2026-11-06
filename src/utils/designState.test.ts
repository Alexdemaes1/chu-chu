import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMultiStageInputs,
  closedFormMeanRadius,
  createBlankDesign,
  decodeDesignToken,
  DEFAULT_SWEEP_RANGES,
  deserializeDesign,
  encodeDesignToken,
  getDesignBlockers,
  getShaftConsistencyWarnings,
  parseDesignPayload,
  readDesignPayloadFromHash,
  readDesignFromHash,
  serializeDesign,
  SHARE_HASH_PREFIX,
  SWEEP_RANGE_LIMITS,
  withAvailableLossModel,
  type DesignState,
} from './designState.ts';
import { createExampleDesign, EXAMPLE_TARGET_POWER_MW } from './exampleDesign.ts';
import { calculateMultiStageTurbine } from './turbine1D.ts';
import { SAFE_DEFAULT_EQUATIONS } from './customEquations.ts';

test('serialize → deserialize devuelve el mismo diseño', () => {
  const design: DesignState = {
    ...createExampleDesign(),
    name: 'Turbina «ñandú» · ṁ 2,5 kg/s',
    requireTwoDimensionalFlow: true,
  };
  design.stages = [
    ...design.stages,
    {
      ...design.stages[0],
      id: 'stage-2',
      name: 'Etapa 2',
      rowConfiguration: 'counterrotating',
      direction: -1,
      psiTarget: 1.4,
      interStageCoupling: 'vaneless',
    },
  ];
  design.editedFields = ['stage-1:R', 'stage-2:R'];

  const restored = deserializeDesign(serializeDesign(design));
  assert.deepEqual(restored, design);
});

test('el enlace en base64url conserva el diseño, incluidos caracteres no ASCII', () => {
  const design: DesignState = { ...createExampleDesign(), name: 'Diseño ψ–φ con tildes: áéíóú' };
  const token = encodeDesignToken(design);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeDesignToken(token), design);
  assert.deepEqual(readDesignFromHash(`${SHARE_HASH_PREFIX}${token}`), design);
  assert.equal(readDesignFromHash('#otra-cosa'), null);
  assert.equal(decodeDesignToken('%%%no-es-base64%%%'), null);
});

test('JSON corrupto o con tipos incorrectos devuelve null', () => {
  const valid = JSON.parse(serializeDesign(createExampleDesign()));
  const corruptCases: unknown[] = [
    '{ no es json',
    'null',
    '42',
    '[]',
    { ...valid, globalInputs: null },
    { ...valid, globalInputs: { ...valid.globalInputs, m_dot: 'mucho' } },
    { ...valid, globalInputs: { ...valid.globalInputs, gasKey: 'plasma' } },
    { ...valid, stages: [] },
    { ...valid, stages: 'Etapa 1' },
    { ...valid, stages: [{ ...valid.stages[0], N: null }] },
    { ...valid, stages: [{ ...valid.stages[0], direction: 2 }] },
    { ...valid, stages: [{ ...valid.stages[0], rowConfiguration: 'mixta' }] },
    { ...valid, stages: [{ ...valid.stages[0], psiTarget: 'alto' }] },
    { ...valid, stages: Array.from({ length: 7 }, (_, i) => ({ ...valid.stages[0], id: `s${i}` })) },
    { ...valid, lossModel: 'magia' },
    { ...valid, name: { texto: 'x' } },
    { ...valid, requireTwoDimensionalFlow: 'sí' },
  ];
  for (const corrupt of corruptCases) {
    assert.equal(deserializeDesign(corrupt), null, `debería rechazar ${JSON.stringify(corrupt).slice(0, 80)}`);
  }
});

test('una versión desconocida devuelve null', () => {
  const valid = JSON.parse(serializeDesign(createExampleDesign()));
  assert.equal(deserializeDesign({ ...valid, v: 2 }), null);
  assert.equal(deserializeDesign({ ...valid, v: '1' }), null);
  const { v: _omitted, ...withoutVersion } = valid;
  assert.equal(deserializeDesign(withoutVersion), null);
});

test('los campos opcionales que faltan toman su valor por defecto y los ids duplicados se regeneran', () => {
  const valid = JSON.parse(serializeDesign(createExampleDesign()));
  delete valid.sweepRanges;
  delete valid.editedFields;
  valid.stages = [valid.stages[0], { ...valid.stages[0] }];
  const restored = deserializeDesign(valid);
  assert.ok(restored);
  assert.equal(restored.sweepRanges.points, 25);
  assert.notEqual(restored.stages[0].id, restored.stages[1].id);
  assert.deepEqual(restored.editedFields, restored.stages.map((stage) => `${stage.id}:R`));
});

test('el ejemplo está listo, sin bloqueos, y su objetivo coincide con la potencia calculada', () => {
  const example = createExampleDesign();
  assert.deepEqual(getDesignBlockers(example), []);
  const stage = example.stages[0];
  assert.equal(stage.shaftName, 'Eje 1');
  assert.equal(stage.psiTarget, undefined);
  assert.ok(EXAMPLE_TARGET_POWER_MW > 0.45 && EXAMPLE_TARGET_POWER_MW < 0.6);
  const result = calculateMultiStageTurbine(buildMultiStageInputs(example, SAFE_DEFAULT_EQUATIONS));
  assert.ok(Math.abs(result.power_total_MW - EXAMPLE_TARGET_POWER_MW) < 1e-4);
});

test('un diseño nuevo explica qué falta, incluido el barrido', () => {
  const fields = getDesignBlockers(createBlankDesign()).map((blocker) => blocker.field);
  assert.deepEqual(fields, ['gasKey', 'm_dot', 'P01', 'T01', 'N', 'R', 'coefficients', 'shaftTarget', 'Rm']);
});

test('bloqueos concretos: R fuera de rango y primera etapa contrarrotativa', () => {
  const design = createExampleDesign();
  design.stages[0] = { ...design.stages[0], R: 0.9, rowConfiguration: 'counterrotating' };
  const messages = getDesignBlockers(design).map((blocker) => blocker.message);
  assert.ok(messages.some((message) => message.includes('R debe estar entre 0 y 0,85')));
  assert.ok(messages.some((message) => message.includes('no puede ser contrarrotativa')));
});

test('radio medio en forma cerrada: Rm = √(P / (ṁ · Σψω²))', () => {
  const design = createExampleDesign();
  // Sin ψ objetivo no hay forma cerrada: se mantiene el radio.
  assert.equal(closedFormMeanRadius(design), null);

  design.stages = [{ ...design.stages[0], psiTarget: 1.5, shaftTargetPowerMW: 0.5 }];
  const omega = 2 * Math.PI * 45000 / 60;
  const expected = Math.sqrt(0.5e6 / (2.5 * 1.5 * omega * omega));
  const Rm = closedFormMeanRadius(design);
  assert.ok(Rm !== null);
  assert.ok(Math.abs(Rm - expected) < 1e-12);
  assert.ok(Math.abs(Rm - 0.07750) < 1e-4);

  // Un eje sin objetivo invalida la forma cerrada.
  design.stages = [{ ...design.stages[0], shaftTargetPowerMW: undefined }];
  assert.equal(closedFormMeanRadius(design), null);
});

test('aviso si dos etapas del mismo eje tienen rpm o sentido distintos', () => {
  const design = createExampleDesign();
  const second = { ...design.stages[0], id: 'stage-2', name: 'Etapa 2', N: 30000, direction: -1 as const };
  const warnings = getShaftConsistencyWarnings([design.stages[0], second]);
  assert.equal(warnings.length, 2);
  assert.deepEqual(getShaftConsistencyWarnings([design.stages[0], { ...second, shaftName: 'Eje 2' }]), []);
});

test('los rangos del barrido fuera de los límites de la interfaz vuelven a su valor por defecto', () => {
  const design = createExampleDesign();
  const raw = JSON.parse(serializeDesign(design));
  raw.sweepRanges = { ...raw.sweepRanges, points: 100000, maxMeanPeripheralSpeed: 0, powerTolerance: 80, phiMin: 0.9, phiMax: 0.4 };
  const loaded = deserializeDesign(raw);
  assert.ok(loaded);
  assert.equal(loaded.sweepRanges.points, DEFAULT_SWEEP_RANGES.points);
  assert.equal(loaded.sweepRanges.maxMeanPeripheralSpeed, DEFAULT_SWEEP_RANGES.maxMeanPeripheralSpeed);
  assert.equal(loaded.sweepRanges.powerTolerance, DEFAULT_SWEEP_RANGES.powerTolerance);
  // φ mínimo ≥ φ máximo: se restauran los dos.
  assert.equal(loaded.sweepRanges.phiMin, DEFAULT_SWEEP_RANGES.phiMin);
  assert.equal(loaded.sweepRanges.phiMax, DEFAULT_SWEEP_RANGES.phiMax);
  for (const key of Object.keys(SWEEP_RANGE_LIMITS) as (keyof typeof SWEEP_RANGE_LIMITS)[]) {
    assert.ok(loaded.sweepRanges[key] >= SWEEP_RANGE_LIMITS[key].min && loaded.sweepRanges[key] <= SWEEP_RANGE_LIMITS[key].max, key);
  }
});

test('el enlace y el fichero llevan las ecuaciones activas: null si son las de por defecto', () => {
  const design = createExampleDesign();
  // Autoguardado: sin ecuaciones.
  assert.equal(parseDesignPayload(serializeDesign(design))?.customEquations, undefined);
  // Ecuaciones por defecto: marcador null.
  const token = encodeDesignToken(design, SAFE_DEFAULT_EQUATIONS);
  assert.equal(readDesignPayloadFromHash(`${SHARE_HASH_PREFIX}${token}`)?.customEquations, null);
  // Ecuaciones modificadas: viajan normalizadas y el diseño sigue siendo el mismo.
  const custom = {
    ...SAFE_DEFAULT_EQUATIONS,
    userDefinedLoss: { ...SAFE_DEFAULT_EQUATIONS.userDefinedLoss, enabled: true },
  };
  const payload = readDesignPayloadFromHash(`${SHARE_HASH_PREFIX}${encodeDesignToken({ ...design, lossModel: 'user_defined' }, custom)}`);
  assert.ok(payload);
  assert.equal(payload.design.lossModel, 'user_defined');
  assert.equal(payload.customEquations?.userDefinedLoss.enabled, true);
  assert.equal(decodeDesignToken(encodeDesignToken(design, custom))?.name, design.name);
});

test('un diseño con modelo de pérdidas propio sin esa ecuación activa pasa a Soderberg', () => {
  const design: DesignState = { ...createExampleDesign(), lossModel: 'user_defined' };
  design.stages = [{ ...design.stages[0], lossModel: 'user_defined' }];
  const { design: fixed, downgraded } = withAvailableLossModel(design, SAFE_DEFAULT_EQUATIONS);
  assert.equal(downgraded, true);
  assert.equal(fixed.lossModel, 'soderberg');
  assert.equal(fixed.stages[0].lossModel, undefined);
  const enabled = { ...SAFE_DEFAULT_EQUATIONS, userDefinedLoss: { ...SAFE_DEFAULT_EQUATIONS.userDefinedLoss, enabled: true } };
  assert.deepEqual(withAvailableLossModel(design, enabled), { design, downgraded: false });
});
