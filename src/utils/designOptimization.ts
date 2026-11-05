import { calculateMultiStageTurbine, type MultiStageInputs, type MultiStageOutputs } from './turbine1D';

export interface SweepRange {
  min: number;
  max: number;
  points: number;
}

export interface DesignCandidate {
  phi: number;
  psi: number;
  achievedPsi: number;
  PR: number;
  meanRadiusM: number;
  efficiency: number;
  powerMW: number;
  shaftPowerErrors: { shaftName: string; targetMW: number; actualMW: number; errorPercent: number }[];
  allShaftTargetsMet: boolean;
  feasible: boolean;
  maxMeanPeripheralSpeedMs: number;
  minimumHubTipRatio: number;
  result: MultiStageOutputs;
}

export interface DesignSweepOptions {
  stageIndex: number;
  phi: SweepRange;
  psi: SweepRange;
  shaftPowerTolerancePercent: number;
  maxMeanPeripheralSpeedMs: number;
  requireTwoDimensionalFlow: boolean;
}

const valuesInRange = ({ min, max, points }: SweepRange): number[] => {
  const count = Math.max(2, Math.round(points));
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
};

/** Sweep phi and psi for one row while recomputing all downstream rows and shaft totals. */
export function optimizeStageDesign(
  base: MultiStageInputs,
  options: DesignSweepOptions,
): DesignCandidate[] {
  const stage = base.stages[options.stageIndex];
  if (!stage) return [];
  const shaftTargets = new Map<string, { name: string; targetMW?: number; N: number; direction: number }>();
  for (const row of base.stages) {
    const name = row.shaftName || `Eje ${row.N.toLocaleString()} rpm`;
    const key = `${name}:${row.N}:${row.direction}`;
    const group = shaftTargets.get(key) || { name, N: row.N, direction: row.direction, targetMW: undefined };
    if (row.shaftTargetPowerMW !== undefined && row.shaftTargetPowerMW > 0) group.targetMW = row.shaftTargetPowerMW;
    shaftTargets.set(key, group);
  }
  const completePowerTargets = [...shaftTargets.values()].every((shaft) => shaft.targetMW !== undefined);
  const totalTargetPowerW = [...shaftTargets.values()].reduce((sum, shaft) => sum + (shaft.targetMW ?? 0) * 1e6, 0);
  if (!completePowerTargets || totalTargetPowerW <= 0 || base.m_dot <= 0) return [];

  const phiMid = (options.phi.min + options.phi.max) / 2;
  const psiMid = (options.psi.min + options.psi.max) / 2;
  const candidates: DesignCandidate[] = [];

  for (const phi of valuesInRange(options.phi)) {
    for (const psi of valuesInRange(options.psi)) {
      const stages = base.stages.map((item, index) => ({
        ...item,
        phi: index === options.stageIndex ? phi : item.phi > 0 ? item.phi : phiMid,
        psiTarget: index === options.stageIndex ? psi : item.psiTarget && item.psiTarget > 0 ? item.psiTarget : psiMid,
      }));
      // With common mean radius, the total shaft-power targets set the dimensional scale:
      // P = mdot * Rm^2 * sum(psi_i * omega_i^2).
      const loadingRateSum = stages.reduce((sum, row) => {
        const omega = 2 * Math.PI * row.N / 60;
        return sum + (row.psiTarget ?? psiMid) * omega * omega;
      }, 0);
      const meanRadiusM = Math.sqrt(totalTargetPowerW / (base.m_dot * loadingRateSum));
      const maxMeanPeripheralSpeedMs = Math.max(...stages.map((row) => 2 * Math.PI * row.N / 60 * meanRadiusM));
      const sizedStages = stages.map((row) => ({ ...row, Rm: meanRadiusM }));
      const result = calculateMultiStageTurbine({ ...base, stages: sizedStages });
      const stageResult = result.stageResults[options.stageIndex];
      const minimumHubTipRatio = Math.min(...result.stageResults.map((row) => row.hubToTipRatio));
      const shaftPowerErrors = result.shaftResults
        .filter((shaft) => shaft.targetPowerMW !== undefined && shaft.targetPowerMW > 0)
        .map((shaft) => ({
          shaftName: shaft.shaftName,
          targetMW: shaft.targetPowerMW!,
          actualMW: shaft.power_MW,
          errorPercent: 100 * (shaft.power_MW - shaft.targetPowerMW!) / shaft.targetPowerMW!,
        }));
      const closedOnLoading = Math.abs(stageResult.psi - psi) <= Math.max(0.01, psi * 0.01);
      const allShaftTargetsMet = shaftPowerErrors.every((shaft) => Math.abs(shaft.errorPercent) <= options.shaftPowerTolerancePercent);
      const selectedShaftName = stage.shaftName || `Eje ${stage.N.toLocaleString()} rpm`;
      const selectedShaftTargetsMet = shaftPowerErrors
        .filter((shaft) => shaft.shaftName === selectedShaftName)
        .every((shaft) => Math.abs(shaft.errorPercent) <= options.shaftPowerTolerancePercent);
      const physicallyPlausible = stageResult.reaction_actual >= 0 && stageResult.reaction_actual <= 1
        && stageResult.T03_actual > 0 && stageResult.P03 > 0
        && Number.isFinite(stageResult.bladeHeight) && stageResult.bladeHeight > 0
        && stageResult.hubRadius > 0 && stageResult.tipRadius > stageResult.hubRadius
        && stageResult.geometryLossConverged;
      candidates.push({
        phi,
        psi,
        achievedPsi: stageResult.psi,
        PR: stageResult.inputs.PR,
        meanRadiusM,
        efficiency: result.eta_overall_tt,
        powerMW: result.power_total_MW,
        shaftPowerErrors,
        allShaftTargetsMet,
        // A coordinate sweep can only enforce the target for the shaft being tuned.
        // Other shaft targets remain visible and are checked after each row is tuned.
        feasible: closedOnLoading && selectedShaftTargetsMet && physicallyPlausible
          && maxMeanPeripheralSpeedMs <= options.maxMeanPeripheralSpeedMs
          && (!options.requireTwoDimensionalFlow || minimumHubTipRatio > 0.8),
        maxMeanPeripheralSpeedMs,
        minimumHubTipRatio,
        result,
      });
      candidates.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.efficiency - a.efficiency);
      if (candidates.length > 8) candidates.pop();
    }
  }

  return candidates;
}
