import {
  calculateMultiStageTurbine,
  type MultiStageInputs,
  type MultiStageOutputs,
  type StageConfig,
  type TurbineOutputs,
} from './turbine1D';
import { EXIT_MACH_CONVERGENT_DIVERGENT, EXIT_MACH_TRANSONIC } from './exportGeometry';

export interface SweepRange {
  min: number;
  max: number;
  points: number;
}

/**
 * Mach classification of a candidate from the highest exit Mach number of all rows:
 * 'ok' ≤ 0.95 < 'transonic' ≤ 1.3 < 'supersonic' (needs a convergent-divergent passage).
 */
export type MachFlag = 'ok' | 'transonic' | 'supersonic';

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
  /** Highest of M_abs1 (stator exit), M_rel2 (rotor exit) and M_abs2 (stage exit) over all rows. */
  maxMach: number;
  machFlag: MachFlag;
  result: MultiStageOutputs;
}

export interface DesignSweepOptions {
  stageIndex: number;
  phi: SweepRange;
  psi: SweepRange;
  shaftPowerTolerancePercent: number;
  maxMeanPeripheralSpeedMs: number;
  requireTwoDimensionalFlow: boolean;
  /** Number of best candidates kept (default 8). */
  maxCandidates?: number;
}

/**
 * Best candidates, feasible first and then by efficiency. When the sweep cannot run, the list is
 * empty and `blocker` explains, in Spanish, what the user has to fix first.
 */
export type DesignSweepResult = DesignCandidate[] & { blocker?: string };

export const DEFAULT_SHAFT_NAME = 'Eje 1';

/** Shaft name used to group rows: the row's own name or 'Eje 1'. */
export function shaftNameOf(stage?: Pick<StageConfig, 'shaftName'> | null): string {
  return stage?.shaftName || DEFAULT_SHAFT_NAME;
}

/** Highest exit Mach number (M_abs1, M_rel2 and M_abs2) over all rows of a result. */
export function maxExitMachOf(result: MultiStageOutputs): number {
  let maxMach = 0;
  for (const row of result.stageResults) {
    for (const mach of [row.inletTriangle.Mach_abs, row.outletTriangle.Mach_rel, row.outletTriangle.Mach_abs]) {
      if (Number.isFinite(mach) && mach > maxMach) maxMach = mach;
    }
  }
  return maxMach;
}

export function machFlagOf(maxMach: number): MachFlag {
  if (maxMach > EXIT_MACH_CONVERGENT_DIVERGENT) return 'supersonic';
  if (maxMach > EXIT_MACH_TRANSONIC) return 'transonic';
  return 'ok';
}

/**
 * Lowest hub-to-tip ratio a viable candidate may have in any row. Below about 0.4 the free-vortex
 * mean-line model stops representing the hub section (very high hub reaction swings, twist and
 * blockage), and a negative value means the annulus 2π·Rm·h does not exist at all.
 */
export const MIN_VIABLE_HUB_TIP_RATIO = 0.4;

/**
 * Geometric hub-to-tip ratio (Rm − h/2)/(Rm + h/2) from the unclamped hub radius. The solver clamps
 * its reported hub radius to 5 mm, so this is the value that reveals blades taller than 2·Rm.
 */
export function geometricHubTipRatioOf(row: TurbineOutputs): number {
  const meanRadius = row.inputs.Rm;
  const height = row.bladeHeight;
  if (!(Number.isFinite(meanRadius) && meanRadius > 0 && Number.isFinite(height) && height > 0)) return Number.NaN;
  return (meanRadius - height / 2) / (meanRadius + height / 2);
}

const MAX_RADIUS_UPDATES = 3;
const RADIUS_TOLERANCE = 1e-4;
const MAX_REACTION = 0.85;

const valuesInRange = ({ min, max, points }: SweepRange): number[] => {
  const count = Math.max(2, Math.round(points));
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
};

const isValidRange = ({ min, max, points }: SweepRange) =>
  Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(points) && min > 0 && max > min;

const blocked = (blocker: string): DesignSweepResult => Object.assign([] as DesignCandidate[], { blocker });

/** Returns the first reason why the sweep cannot run, or null when the inputs are complete. */
function findSweepBlocker(base: MultiStageInputs, options: DesignSweepOptions): string | null {
  const { stages } = base;
  if (!stages[options.stageIndex]) return 'La fila seleccionada no existe.';
  if (stages[0]?.rowConfiguration === 'counterrotating') {
    return 'La fila 1 no puede ser contrarrotativa: la primera fila necesita estator.';
  }
  for (let index = 0; index < stages.length; index++) {
    const row = stages[index];
    if (!Number.isFinite(row.R) || row.R < 0 || row.R > MAX_REACTION) {
      return `El grado de reacción de la fila ${index + 1} debe estar entre 0 y 0,85.`;
    }
    if (!Number.isFinite(row.N) || row.N <= 0) {
      return `La fila ${index + 1} necesita una velocidad de giro mayor que cero.`;
    }
  }
  if (!Number.isFinite(base.m_dot) || base.m_dot <= 0) return 'El gasto másico debe ser mayor que cero.';
  if (!isValidRange(options.phi) || !isValidRange(options.psi)) {
    return 'Revisa los rangos del barrido: los límites deben ser positivos y el máximo mayor que el mínimo.';
  }

  const shaftTargets = new Map<string, number | undefined>();
  for (const row of stages) {
    const key = `${shaftNameOf(row)}:${row.N}:${row.direction}`;
    const target = row.shaftTargetPowerMW;
    if (target !== undefined && Number.isFinite(target) && target > 0) shaftTargets.set(key, target);
    else if (!shaftTargets.has(key)) shaftTargets.set(key, undefined);
  }
  if ([...shaftTargets.values()].some((target) => target === undefined)) {
    return 'Asigna la potencia objetivo a cada eje antes del barrido; con ṁ y esas potencias se calcula el radio medio común.';
  }

  for (let index = 0; index < stages.length; index++) {
    if (index === options.stageIndex) continue;
    const row = stages[index];
    const hasPsiTarget = row.psiTarget !== undefined && Number.isFinite(row.psiTarget) && row.psiTarget > 0;
    const hasPR = Number.isFinite(row.PR) && row.PR > 1;
    if (!(Number.isFinite(row.phi) && row.phi > 0) || (!hasPsiTarget && !hasPR)) {
      return `Define el PR o barre primero la fila ${index + 1}`;
    }
  }
  return null;
}

/**
 * Sweeps φ and ψ for one row while recomputing every row and the shaft totals.
 *
 * The common mean radius closes the total power target. Rows with a ψ target (the swept row and
 * any other row with `psiTarget`) contribute ψ·ω²·Rm² each; the other rows keep their own pressure
 * ratio and contribute their actual Δh0. Hence
 *   Rm² = (P/ṁ − ΣΔh0_fixed) / Σ ψ_j·ω_j²,
 * solved by fixed-point iteration because Δh0_fixed depends weakly on Rm through the losses.
 * Rows without φ, or without either PR > 1 or ψ target, block the sweep instead of receiving
 * invented values.
 */
export function optimizeStageDesign(
  base: MultiStageInputs,
  options: DesignSweepOptions,
): DesignSweepResult {
  const blocker = findSweepBlocker(base, options);
  if (blocker) return blocked(blocker);

  const stageIndex = options.stageIndex;
  const selectedShaftName = shaftNameOf(base.stages[stageIndex]);
  const maxCandidates = Math.max(1, Math.round(options.maxCandidates ?? 8));

  const shaftTargets = new Map<string, number>();
  for (const row of base.stages) {
    const target = row.shaftTargetPowerMW;
    if (target !== undefined && target > 0) shaftTargets.set(`${shaftNameOf(row)}:${row.N}:${row.direction}`, target);
  }
  const totalTargetPowerW = [...shaftTargets.values()].reduce((sum, targetMW) => sum + targetMW * 1e6, 0);
  const targetSpecificWork = totalTargetPowerW / base.m_dot;

  const hasPsiTarget = (row: StageConfig) => row.psiTarget !== undefined && Number.isFinite(row.psiTarget) && row.psiTarget > 0;
  const fixedRowIndices = base.stages
    .map((row, index) => (index !== stageIndex && !hasPsiTarget(row) ? index : -1))
    .filter((index) => index >= 0);

  const candidates: DesignCandidate[] = [];
  let rowsExhaustTarget = 0;
  let warmStartRadius: number | undefined;

  for (const phi of valuesInRange(options.phi)) {
    for (const psi of valuesInRange(options.psi)) {
      const stages: StageConfig[] = base.stages.map((row, index) => ({
        ...row,
        shaftName: shaftNameOf(row),
        phi: index === stageIndex ? phi : row.phi,
        psiTarget: index === stageIndex ? psi : hasPsiTarget(row) ? row.psiTarget : undefined,
      }));
      const loadingRateSum = stages.reduce((sum, row) => {
        if (row.psiTarget === undefined) return sum;
        const omega = 2 * Math.PI * row.N / 60;
        return sum + row.psiTarget * omega * omega;
      }, 0);
      if (!(loadingRateSum > 0)) continue;

      const run = (radius: number) => calculateMultiStageTurbine({
        ...base,
        stages: stages.map((row) => ({ ...row, Rm: radius })),
      });
      const radiusFrom = (fixedWork: number) => {
        const remaining = targetSpecificWork - fixedWork;
        return remaining > 0 ? Math.sqrt(remaining / loadingRateSum) : Number.NaN;
      };

      let meanRadiusM = radiusFrom(0);
      let result: MultiStageOutputs;
      if (fixedRowIndices.length === 0) {
        result = run(meanRadiusM);
      } else {
        meanRadiusM = warmStartRadius ?? meanRadiusM;
        result = run(meanRadiusM);
        for (let update = 0; update < MAX_RADIUS_UPDATES; update++) {
          const fixedWork = fixedRowIndices.reduce((sum, index) => sum + result.stageResults[index].dh_actual, 0);
          const nextRadius = radiusFrom(fixedWork);
          if (!Number.isFinite(nextRadius)) { meanRadiusM = Number.NaN; break; }
          if (Math.abs(nextRadius - meanRadiusM) <= RADIUS_TOLERANCE * meanRadiusM) break;
          meanRadiusM = nextRadius;
          result = run(meanRadiusM);
        }
        if (!Number.isFinite(meanRadiusM)) { rowsExhaustTarget++; continue; }
        warmStartRadius = meanRadiusM;
      }
      if (!(Number.isFinite(meanRadiusM) && meanRadiusM > 0)) continue;

      const stageResult = result.stageResults[stageIndex];
      const maxMeanPeripheralSpeedMs = Math.max(...stages.map((row) => 2 * Math.PI * row.N / 60 * meanRadiusM));
      const minimumHubTipRatio = Math.min(...result.stageResults.map(geometricHubTipRatioOf));
      const shaftPowerErrors = result.shaftResults
        .filter((shaft) => shaft.targetPowerMW !== undefined && shaft.targetPowerMW > 0)
        .map((shaft) => {
          const targetMW = shaft.targetPowerMW ?? 0;
          return {
            shaftName: shaft.shaftName,
            targetMW,
            actualMW: shaft.power_MW,
            errorPercent: 100 * (shaft.power_MW - targetMW) / targetMW,
          };
        });
      const closedOnLoading = Math.abs(stageResult.psi - psi) <= Math.max(0.01, psi * 0.01);
      const withinTolerance = (shaft: { errorPercent: number }) => Math.abs(shaft.errorPercent) <= options.shaftPowerTolerancePercent;
      const allShaftTargetsMet = shaftPowerErrors.every(withinTolerance);
      const selectedShaftTargetsMet = shaftPowerErrors
        .filter((shaft) => shaft.shaftName === selectedShaftName)
        .every(withinTolerance);
      // Every row must be buildable, not only the swept one; NaN ratios fail the comparison.
      const rowsPlausible = result.stageResults.every((row) => row.T03_actual > 0 && row.P03 > 0
        && Number.isFinite(row.bladeHeight) && row.bladeHeight > 0
        && row.geometryLossConverged);
      const physicallyPlausible = rowsPlausible
        && stageResult.reaction_actual >= 0 && stageResult.reaction_actual <= 1
        && minimumHubTipRatio >= MIN_VIABLE_HUB_TIP_RATIO;
      const maxMach = maxExitMachOf(result);
      const machFlag = machFlagOf(maxMach);

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
        // Candidates that need a convergent-divergent passage are never viable for this model.
        feasible: closedOnLoading && selectedShaftTargetsMet && physicallyPlausible
          && machFlag !== 'supersonic'
          && maxMeanPeripheralSpeedMs <= options.maxMeanPeripheralSpeedMs
          && (!options.requireTwoDimensionalFlow || minimumHubTipRatio > 0.8),
        maxMeanPeripheralSpeedMs,
        minimumHubTipRatio,
        maxMach,
        machFlag,
        result,
      });
      candidates.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.efficiency - a.efficiency);
      if (candidates.length > maxCandidates) candidates.pop();
    }
  }

  if (candidates.length === 0 && rowsExhaustTarget > 0) {
    return blocked(`Las filas con PR fijo ya entregan la potencia objetivo o más: baja su PR o sube la potencia objetivo antes de barrer la fila ${stageIndex + 1}.`);
  }
  return candidates;
}
