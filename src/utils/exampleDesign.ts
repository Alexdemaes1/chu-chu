/**
 * Diseño de ejemplo con el que arranca la app: el mismo caso de referencia que valida
 * turbine1D.test.ts (etapa axial de turbina de gas, reacción 50 %).
 */
import { calculateMultiStageTurbine, type StageConfig } from './turbine1D';
import { SAFE_DEFAULT_EQUATIONS } from './customEquations';
import { buildMultiStageInputs, DEFAULT_SWEEP_RANGES, reactionKey, type DesignState } from './designState';

const EXAMPLE_STAGE: StageConfig = {
  id: 'stage-1',
  name: 'Etapa 1',
  rowConfiguration: 'normal',
  shaftName: 'Eje 1',
  PR: 2.2,
  N: 45000,
  direction: 1,
  Rm: 0.12,
  R: 0.5,
  phi: 0.6,
  turbineType: 'axial',
};

const EXAMPLE_GLOBAL_INPUTS: DesignState['globalInputs'] = {
  m_dot: 2.5,
  P01: 4e5,
  T01: 1100,
  gasKey: 'combustionGas',
};

/**
 * Potencia objetivo del eje = potencia que da el propio ejemplo con las ecuaciones por defecto
 * (≈0,51 MW), redondeada a 0,1 kW. Se calcula en lugar de fijarla a mano para que el ejemplo
 * arranque «al día» aunque cambien las correlaciones de pérdidas, y el barrido funcione a la primera.
 */
function computeExampleTargetMW(): number {
  const result = calculateMultiStageTurbine(buildMultiStageInputs({
    globalInputs: EXAMPLE_GLOBAL_INPUTS,
    stages: [EXAMPLE_STAGE],
    lossModel: 'soderberg',
  }, SAFE_DEFAULT_EQUATIONS));
  const power = result.power_total_MW;
  return Number.isFinite(power) && power > 0 ? Math.round(power * 1e4) / 1e4 : 0.5136;
}

export const EXAMPLE_TARGET_POWER_MW = computeExampleTargetMW();

/** Estado inicial de la app (salvo que haya un diseño en el enlace o en localStorage). */
export const EXAMPLE_DESIGN: DesignState = {
  name: 'Ejemplo · turbina de gas 0,5 MW',
  globalInputs: EXAMPLE_GLOBAL_INPUTS,
  // Sin psiTarget: el PR fija el trabajo y el barrido define después φ, ψ y el radio medio.
  stages: [{ ...EXAMPLE_STAGE, shaftTargetPowerMW: EXAMPLE_TARGET_POWER_MW }],
  lossModel: 'soderberg',
  sweepRanges: DEFAULT_SWEEP_RANGES,
  requireTwoDimensionalFlow: false,
  editedFields: [reactionKey(EXAMPLE_STAGE.id)],
};

/** Copia independiente del ejemplo, para cargarlo sin compartir referencias con la constante. */
export function createExampleDesign(): DesignState {
  return {
    ...EXAMPLE_DESIGN,
    globalInputs: { ...EXAMPLE_DESIGN.globalInputs },
    stages: EXAMPLE_DESIGN.stages.map((stage) => ({ ...stage })),
    sweepRanges: { ...EXAMPLE_DESIGN.sweepRanges },
    editedFields: [...EXAMPLE_DESIGN.editedFields],
  };
}
