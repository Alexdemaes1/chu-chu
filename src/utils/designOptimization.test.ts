import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_VIABLE_HUB_TIP_RATIO,
  machFlagOf,
  optimizeStageDesign,
  shaftNameOf,
  type DesignSweepOptions,
} from './designOptimization.ts';
import type { MultiStageInputs, StageConfig } from './turbine1D.ts';

// 1D example: 2.5 kg/s, 4 bar, 1100 K, combustion gas, PR 2.2, 45 000 rpm, R = 0.5, φ = 0.6,
// Rm = 0.12 m. Its computed shaft power is 0.5089 MW (Soderberg, η_tt ≈ 0.902), used as target.
const EXAMPLE_STAGE: StageConfig = {
  id: 'stage-1',
  name: 'Etapa 1',
  shaftName: 'Eje 1',
  shaftTargetPowerMW: 0.5089,
  PR: 2.2,
  N: 45000,
  direction: 1,
  Rm: 0.12,
  R: 0.5,
  phi: 0.6,
  turbineType: 'axial',
};

const EXAMPLE: MultiStageInputs = {
  m_dot: 2.5,
  P01: 400000,
  T01: 1100,
  gasKey: 'combustionGas',
  stages: [EXAMPLE_STAGE],
};

const SWEEP: DesignSweepOptions = {
  stageIndex: 0,
  phi: { min: 0.3, max: 1.0, points: 8 },
  psi: { min: 0.8, max: 2.5, points: 8 },
  shaftPowerTolerancePercent: 1,
  maxMeanPeripheralSpeedMs: 700,
  requireTwoDimensionalFlow: false,
};

test('the example with a 0.5089 MW target gives viable candidates that meet the power', () => {
  const candidates = optimizeStageDesign(EXAMPLE, SWEEP);
  assert.equal(candidates.blocker, undefined);
  const viable = candidates.filter((candidate) => candidate.feasible);
  assert.ok(viable.length > 0, 'at least one viable candidate');
  for (const candidate of viable) {
    assert.ok(Math.abs(candidate.powerMW - 0.5089) / 0.5089 <= 0.01);
    assert.ok(candidate.meanRadiusM > 0);
    assert.notEqual(candidate.machFlag, 'supersonic');
    assert.equal(candidate.machFlag, machFlagOf(candidate.maxMach));
    // Single row with a ψ target: Rm² = P / (ṁ·ψ·ω²).
    const omega = 2 * Math.PI * 45000 / 60;
    assert.ok(Math.abs(candidate.meanRadiusM - Math.sqrt(0.5089e6 / (2.5 * candidate.psi * omega ** 2))) < 1e-12);
  }
});

test('sweeping row 2 keeps row 1 with its own pressure ratio and closes the power with the rest', () => {
  const base: MultiStageInputs = {
    ...EXAMPLE,
    stages: [
      { ...EXAMPLE_STAGE, shaftTargetPowerMW: undefined },
      { ...EXAMPLE_STAGE, id: 'stage-2', name: 'Etapa 2', PR: 1.8, shaftTargetPowerMW: 0.9 },
    ],
  };
  const candidates = optimizeStageDesign(base, { ...SWEEP, stageIndex: 1 });
  assert.equal(candidates.blocker, undefined);
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    const row1 = candidate.result.stageResults[0];
    assert.ok(Math.abs(row1.inputs.PR - 2.2) < 1e-3, `row 1 PR changed to ${row1.inputs.PR}`);
    assert.equal(candidate.result.inputs.stages[0].psiTarget, undefined, 'no invented ψ for row 1');
    assert.equal(candidate.result.inputs.stages[0].phi, 0.6);
  }
  const viable = candidates.filter((candidate) => candidate.feasible);
  assert.ok(viable.length > 0);
  // Rm² = (P/ṁ − Δh0_row1) / (ψ2·ω²), with the radius iteration converged to 1e-4.
  for (const candidate of viable) {
    assert.ok(Math.abs(candidate.powerMW - 0.9) / 0.9 <= 0.01, `power ${candidate.powerMW}`);
  }
});

test('a non-swept row without PR or ψ target, or without φ, blocks the sweep', () => {
  const noPR: MultiStageInputs = {
    ...EXAMPLE,
    stages: [{ ...EXAMPLE_STAGE, PR: 0, psiTarget: undefined }, { ...EXAMPLE_STAGE, id: 'stage-2' }],
  };
  const result = optimizeStageDesign(noPR, { ...SWEEP, stageIndex: 1 });
  assert.equal(result.length, 0);
  assert.equal(result.blocker, 'Define el PR o barre primero la fila 1');

  const noPhi: MultiStageInputs = {
    ...EXAMPLE,
    stages: [{ ...EXAMPLE_STAGE, phi: 0 }, { ...EXAMPLE_STAGE, id: 'stage-2' }],
  };
  assert.equal(optimizeStageDesign(noPhi, { ...SWEEP, stageIndex: 1 }).blocker, 'Define el PR o barre primero la fila 1');
});

test('a counter-rotating first row or a reaction outside [0, 0.85] blocks the sweep', () => {
  const counter: MultiStageInputs = { ...EXAMPLE, stages: [{ ...EXAMPLE_STAGE, rowConfiguration: 'counterrotating' }] };
  const counterResult = optimizeStageDesign(counter, SWEEP);
  assert.equal(counterResult.length, 0);
  assert.match(counterResult.blocker ?? '', /fila 1/);

  const highReaction: MultiStageInputs = {
    ...EXAMPLE,
    stages: [EXAMPLE_STAGE, { ...EXAMPLE_STAGE, id: 'stage-2', R: 0.9 }],
  };
  assert.match(optimizeStageDesign(highReaction, SWEEP).blocker ?? '', /fila 2/);

  const noTarget: MultiStageInputs = { ...EXAMPLE, stages: [{ ...EXAMPLE_STAGE, shaftTargetPowerMW: undefined }] };
  assert.match(optimizeStageDesign(noTarget, SWEEP).blocker ?? '', /potencia objetivo/);
});

test('supersonic candidates are never viable and the Mach flag follows the thresholds', () => {
  assert.equal(machFlagOf(0.9), 'ok');
  assert.equal(machFlagOf(0.99), 'transonic');
  assert.equal(machFlagOf(1.2), 'transonic');
  assert.equal(machFlagOf(1.31), 'supersonic');
  // Three times the example power through the same row forces exit Mach numbers above 1.3.
  const loaded: MultiStageInputs = { ...EXAMPLE, stages: [{ ...EXAMPLE_STAGE, shaftTargetPowerMW: 1.6 }] };
  const candidates = optimizeStageDesign(loaded, { ...SWEEP, psi: { min: 1, max: 3, points: 6 }, maxCandidates: 48 });
  assert.ok(candidates.some((candidate) => candidate.machFlag === 'supersonic'), 'some candidates must be supersonic');
  for (const candidate of candidates) {
    assert.equal(candidate.machFlag, machFlagOf(candidate.maxMach));
    if (candidate.machFlag === 'supersonic') assert.equal(candidate.feasible, false);
  }
});

test('shaftNameOf falls back to "Eje 1"', () => {
  assert.equal(shaftNameOf(undefined), 'Eje 1');
  assert.equal(shaftNameOf({}), 'Eje 1');
  assert.equal(shaftNameOf({ shaftName: 'Eje AP' }), 'Eje AP');
});

test('Barrido: un álabe más alto que 2·Rm (radio de buje negativo) nunca es viable', () => {
  // ṁ = 2.5 kg/s, 1.2 bar, 1100 K y solo 0.2 MW: a φ = 0.3, ψ = 0.8 sale Rm ≈ 0.067 m y h ≈ 0.21 m,
  // así que Rm − h/2 ≈ −0.037 m. El motor recorta el radio de buje a 5 mm, pero la relación
  // geométrica (Rm − h/2)/(Rm + h/2) es negativa y el candidato debe quedar descartado.
  const lowPressure: MultiStageInputs = {
    ...EXAMPLE,
    P01: 1.2e5,
    stages: [{ ...EXAMPLE_STAGE, PR: 1.5, shaftTargetPowerMW: 0.2 }],
  };
  const candidates = optimizeStageDesign(lowPressure, { ...SWEEP, maxCandidates: 64 });
  assert.equal(candidates.blocker, undefined);
  assert.ok(candidates.length > 0);
  const impossible = candidates.find((candidate) => {
    const row = candidate.result.stageResults[0];
    return candidate.meanRadiusM - row.bladeHeight / 2 <= 0;
  });
  assert.ok(impossible, 'el caso de prueba contiene al menos un álabe más alto que 2·Rm');
  assert.ok(impossible.minimumHubTipRatio < 0, `Rh/Rt geométrico = ${impossible.minimumHubTipRatio}`);
  for (const candidate of candidates) {
    if (candidate.feasible) {
      assert.ok(candidate.minimumHubTipRatio >= MIN_VIABLE_HUB_TIP_RATIO, `viable con Rh/Rt = ${candidate.minimumHubTipRatio}`);
    }
  }
  assert.equal(impossible.feasible, false);
});
