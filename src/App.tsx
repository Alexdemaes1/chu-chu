/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, lazy, Suspense } from 'react';
import {
  calculateMultiStageTurbine,
  GAS_PRESETS,
  type StageConfig,
  type MultiStageInputs,
  type LossModel,
} from './utils/turbine1D';
import { VelocityTrianglesSvg } from './components/VelocityTrianglesSvg';
import { BaljeSmithCharts } from './components/BaljeSmithCharts';
// Componentes pesados (three.js, canvas) en chunks aparte: la primera carga es más ligera.
const Rotor3DVisualizer = lazy(() => import('./components/Rotor3DVisualizer').then((m) => ({ default: m.Rotor3DVisualizer })));
const BladeProfileCanvas = lazy(() => import('./components/BladeProfileCanvas').then((m) => ({ default: m.BladeProfileCanvas })));
import { TurbineDocumentationModal } from './components/TurbineDocumentationModal';
import { EquationEditorModal } from './components/EquationEditorModal';
import {
  SAFE_DEFAULT_EQUATIONS,
  type CustomEquationsConfig,
  type EquationEvaluationContext,
  checkIfModified,
  normalizeCustomEquations,
  evaluateCustomBladeHeight,
} from './utils/customEquations';
import { calculateRadialEquilibriumBladeSections } from './utils/bladeGeometry';
import { optimizeStageDesign, type DesignCandidate } from './utils/designOptimization';
import { auditTurbomachineryDesign, generateBladeCoordinatesCSV } from './utils/exportGeometry';
import {
  Wind,
  Settings2,
  Layers,
  X,
  Plus,
  Sliders,
  AlertTriangle,
  FileSpreadsheet,
  BookOpen,
  CircleHelp,
} from 'lucide-react';

export default function App() {
  const [globalInputs, setGlobalInputs] = useState<{
    m_dot: number;
    P01: number;
    T01: number;
    gasKey: keyof typeof GAS_PRESETS | '';
  }>({
    m_dot: 0,
    P01: 0,
    T01: 0,
    gasKey: '',
  });

  const [stages, setStages] = useState<StageConfig[]>([{
    id: 'stage-1', name: 'Etapa 1', rowConfiguration: 'normal', PR: 0, N: 0, direction: 1, Rm: 0, R: 0, phi: 0, turbineType: 'axial',
  }]);
  const [editedStageFields, setEditedStageFields] = useState<Set<string>>(new Set());
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  const [lossModel, setLossModel] = useState<LossModel>('soderberg');

  // Left Panel Sub-Tabs: Pestaña 1 (Termodinámicos y Operativos) vs Pestaña 2 (Geometría del Álabe)
  const [controlTab, setControlTab] = useState<'thermo' | 'geometry'>('thermo');

  // Right Panel Sub-Tabs: Triángulos, resultados, mapas y alertas.
  const [analysisTab, setAnalysisTab] = useState<'triangles' | 'table' | 'audit' | 'balje'>('triangles');
  const [isDocumentationOpen, setIsDocumentationOpen] = useState(false);

  // Equation Editor Modal State
  const [isEqModalOpen, setIsEqModalOpen] = useState<boolean>(false);
  const [customEquations, setCustomEquations] = useState<CustomEquationsConfig>(() => {
    try {
      const stored = localStorage.getItem('axial-turbine.active-equations.v1');
      return stored ? normalizeCustomEquations(JSON.parse(stored)) : SAFE_DEFAULT_EQUATIONS;
    } catch {
      return SAFE_DEFAULT_EQUATIONS;
    }
  });
  const isCustomEquationsActive = useMemo(() => checkIfModified(customEquations), [customEquations]);

  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const [sweepRanges, setSweepRanges] = useState({ phiMin: 0.3, phiMax: 1.1, psiMin: 0.4, psiMax: 2.0, points: 25, powerTolerance: 5, maxMeanPeripheralSpeed: 630 });
  const [sweepResults, setSweepResults] = useState<DesignCandidate[]>([]);
  const [requireTwoDimensionalFlow, setRequireTwoDimensionalFlow] = useState(false);
  const [sweepError, setSweepError] = useState('');
  const [sweepBestApplied, setSweepBestApplied] = useState(false);
  const [allowHighCostSweep, setAllowHighCostSweep] = useState(false);
  const estimatedSweepCandidates = Math.max(2, Math.round(sweepRanges.points)) ** 2;
  const highCostSweep = estimatedSweepCandidates > 400;
  const fastestDesignRPM = Math.max(0, ...stages.map((stage) => stage.N));
  const speedLimitedMeanRadiusMm = fastestDesignRPM > 0
    ? sweepRanges.maxMeanPeripheralSpeed * 60 / (2 * Math.PI * fastestDesignRPM) * 1000
    : undefined;

  const handleGlobalInputsChange = (update: (previous: typeof globalInputs) => typeof globalInputs) => {
    setGlobalInputs(update);
    setStages((previous) => previous.map((stage) => ({ ...stage, Rm: 0 })));
    setSweepResults([]);
    setSweepBestApplied(false);
  };

  // Preliminary profile assumptions stay internal until the profile-design phase.
  const profileIncidenceDeg = 0;
  const profileDeviationDeg = 3.0;

  // Compute Full Multi-Stage Turbine Solution
  const isStageReady = !!globalInputs.gasKey
    && globalInputs.m_dot > 0 && globalInputs.P01 > 0 && globalInputs.T01 > 0
    && stages.length > 0
    && stages.every((stage, index) => stage.rowConfiguration !== 'counterrotating' || index > 0)
    && stages.every((stage) => (stage.psiTarget !== undefined ? stage.psiTarget > 0 : stage.PR > 1) && stage.N > 0 && stage.Rm > 0 && stage.phi > 0
      && stage.R >= 0 && stage.R <= 0.85 && editedStageFields.has(`${stage.id}:R`));
  const isDesignReady = isStageReady;

  const multiStageInputs: MultiStageInputs = useMemo(() => {
    return {
      m_dot: Math.max(globalInputs.m_dot, 0.1),
      P01: Math.max(globalInputs.P01, 10_000),
      T01: Math.max(globalInputs.T01, 200),
      gasKey: globalInputs.gasKey || 'air',
      stages: stages.map((stage) => ({
        ...stage,
        PR: stage.PR > 1 ? stage.PR : 1.2,
        N: stage.N > 0 ? stage.N : 3000,
        Rm: stage.Rm > 0 ? stage.Rm : 0.05,
        R: stage.R,
        phi: stage.phi > 0 ? stage.phi : 0.4,
      })),
      lossModel,
      pitchToChord: 0.80,
      tmaxToChord: 0.20,
      tipClearanceRatio: 0.015,
      customEquations,
    };
  }, [globalInputs, stages, editedStageFields, lossModel, customEquations]);

  const multiResults = useMemo(() => {
    return calculateMultiStageTurbine(multiStageInputs);
  }, [multiStageInputs]);

  // Current active stage for focused inspection
  const safeActiveIdx = Math.min(activeStageIdx, stages.length - 1);
  const currentStage = stages[safeActiveIdx] || stages[0];
  const currentStageResult = multiResults.stageResults[safeActiveIdx] || multiResults.stageResults[0];
  const currentShaftResult = multiResults.shaftResults.find((shaft) => shaft.shaftName === currentStage.shaftName);
  const aspectRatioTarget = Math.max(0.2, customEquations.sizing.aspectRatioTarget || 1.6);
  const derivedRotorChordMm = currentStageResult.bladeHeight_mm / aspectRatioTarget;

  const meridionalGeometry = useMemo(() => {
    if (!isStageReady || !currentStageResult) return null;
    const Rm = currentStageResult.inputs.Rm;
    const makeStation = (label: string, P: number, T: number, Va: number) => {
      const rho = P / (currentStageResult.gas.R_gas * T);
      const idealArea = globalInputs.m_dot / Math.max(1e-9, rho * Va);
      const sizing = evaluateCustomBladeHeight(customEquations, idealArea, Rm);
      const h = sizing.bladeHeight;
      const Rhub = Rm - h / 2;
      const Rtip = Rm + h / 2;
      return {
        label,
        rho,
        area: sizing.effectiveArea,
        height: h,
        chord: h / aspectRatioTarget,
        hubRadius: Rhub,
        tipRadius: Rtip,
        hubTipRatio: Rhub / Rtip,
      };
    };
    return [
      makeStation('Entrada de fila', currentStageResult.P1_static, currentStageResult.T1_static, currentStageResult.inletTriangle.Va),
      makeStation(currentStage.rowConfiguration === 'counterrotating' ? 'Entrada del rotor' : 'Salida del estator · entrada del rotor', currentStageResult.P2_static, currentStageResult.T2_static, currentStageResult.inletTriangle.Va),
      makeStation('Salida del rotor', currentStageResult.P3_static, currentStageResult.T3_static, currentStageResult.outletTriangle.Va),
    ];
  }, [isStageReady, currentStageResult, currentStage, globalInputs.m_dot, customEquations, aspectRatioTarget]);

  const statorCascadeGeometry = useMemo(() => {
    if (!isStageReady || currentStage.rowConfiguration === 'counterrotating' || !meridionalGeometry) return null;
    const station = meridionalGeometry[1];
    const c = station.chord;
    const alphaIn = 0;
    const alphaOut = currentStageResult.inletTriangle.alpha * Math.PI / 180;
    const tanDiff = Math.abs(Math.tan(alphaIn) - Math.tan(alphaOut));
    const cos2 = Math.max(0.08, Math.cos(alphaOut) ** 2);
    const zweifelDenominator = customEquations.zweifel.multiplier * cos2 * tanDiff;
    const pitchIdeal = zweifelDenominator > 1e-8
      ? customEquations.zweifel.psi_Z_target * c / zweifelDenominator
      : Number.POSITIVE_INFINITY;
    const bladeCount = Math.max(12, Math.min(180, Math.round(2 * Math.PI * currentStage.Rm / pitchIdeal)));
    const pitch = 2 * Math.PI * currentStage.Rm / bladeCount;
    return {
      bladeCount,
      pitchMm: pitch * 1000,
      solidity: c / pitch,
      heightMm: station.height * 1000,
      meanRadiusMm: currentStage.Rm * 1000,
      chordMm: c * 1000,
    };
  }, [isStageReady, currentStage.rowConfiguration, currentStageResult.inletTriangle.alpha, currentStage.Rm, meridionalGeometry, customEquations.zweifel]);

  // Context for Star-CCM+ Equation Tree Inspector
  const equationEvalContext: EquationEvaluationContext = useMemo(() => {
    const inTri = currentStageResult.inletTriangle;
    const outTri = currentStageResult.outletTriangle;
    const gas = currentStageResult.gas;
    const a1 = Math.sqrt(gas.gamma * gas.R_gas * currentStageResult.T2_static);
    return {
      m_dot: globalInputs.m_dot,
      P01_bar: currentStageResult.inputs.P01 / 1e5,
      T01_K: currentStageResult.inputs.T01,
      P02_bar: currentStageResult.P03 / 1e5,
      T02_K: currentStageResult.T03_actual,
      T02s_K: currentStageResult.T03_is,
      gamma: gas.gamma,
      cp_JkgK: gas.Cp,
      Rgas_JkgK: gas.R_gas,
      PR: currentStage.PR,
      U_ms: Math.abs(currentStageResult.U),
      Va_ms: inTri.Va,
      V1_ms: inTri.V,
      W1_ms: inTri.W,
      V2_ms: outTri.V,
      W2_ms: outTri.W,
      Vtheta1_ms: Math.abs(inTri.V_theta),
      Vtheta2_ms: Math.abs(outTri.V_theta),
      Wtheta1_ms: inTri.W_theta,
      Wtheta2_ms: outTri.W_theta,
      alpha1_deg: inTri.alpha,
      alpha2_deg: outTri.alpha,
      beta1_deg: inTri.beta,
      beta2_deg: outTri.beta,
      eps_deg: Math.abs(outTri.beta - inTri.beta),
      Mach_abs1: inTri.Mach_abs,
      Mach_rel1: inTri.Mach_rel,
      speedOfSound_ms: a1,
      dh0_kJkg: currentStageResult.dh_actual / 1000,
      dh0s_kJkg: currentStageResult.dh_is / 1000,
      reaction_R: currentStageResult.reaction_actual,
      flowCoeff_phi: currentStageResult.phi,
      stageLoading_psi: currentStageResult.psi,
      bladeHeight_mm: currentStageResult.bladeHeight_mm,
      annulusArea_m2: currentStageResult.bladeHeight * 2 * Math.PI * currentStage.Rm,
      Rm_m: currentStage.Rm,
      Rhub_m: currentStageResult.hubRadius,
      Rtip_m: currentStageResult.tipRadius,
      aspectRatio: currentStageResult.soderbergLoss.aspectRatio,
      chord_mm: derivedRotorChordMm,
      solidity_sc: 0.85,
      numBlades: 17,
      eta_tt: currentStageResult.efficiency_recommended,
      eta_ts: currentStageResult.eta_total_to_static,
      reheatFactor: multiResults.reheatFactor || 1.0,
      dh_is_Jkg: currentStageResult.dh_is,
      dh_loss_stator_Jkg: currentStageResult.soderbergLoss.dh_loss_stator,
      dh_loss_rotor_Jkg: currentStageResult.soderbergLoss.dh_loss_rotor,
      dh_loss_soderberg_Jkg: currentStageResult.soderbergLoss.dh_loss_total,
      dh_loss_ainley_Jkg: currentStageResult.ainleyMathiesonLoss.dh_loss_total,
      Mach_rel2: currentStageResult.outletTriangle.Mach_rel,
      zeta_N: currentStageResult.soderbergLoss.zeta_N,
      zeta_R: currentStageResult.soderbergLoss.zeta_R,
      Yp_rotor: currentStageResult.ainleyMathiesonLoss.Yp_rotor,
      Ys_rotor: currentStageResult.ainleyMathiesonLoss.Ys_rotor,
      Ytc_rotor: currentStageResult.ainleyMathiesonLoss.Ytc_rotor,
    };
  }, [currentStageResult, currentStage, globalInputs, multiResults, derivedRotorChordMm]);

  // Radial 3-Section Blade Design (Free Vortex + 4-Point Bézier)
  const radialBladeDesign = useMemo(() => {
    if (!currentStageResult || !isStageReady) return null;
    return calculateRadialEquilibriumBladeSections({
      Rm_m: currentStageResult.inputs.Rm,
      hb_m: currentStageResult.bladeHeight,
      U_mid_ms: currentStageResult.U,
      Va_mid_ms: currentStageResult.inletTriangle.Va,
      V_theta1_mid_ms: currentStageResult.inletTriangle.V_theta,
      V_theta2_mid_ms: currentStageResult.outletTriangle.V_theta,
      c_ax_mid_mm: derivedRotorChordMm,
      psi_Zweifel: customEquations.zweifel.psi_Z_target,
      zweifelMultiplier: customEquations.zweifel.multiplier,
      useCustomZweifelFormula: customEquations.zweifel.useCustomZweifelFormula,
      customZweifelExpression: customEquations.zweifel.customZweifelExpression,
      vortexExponent: customEquations.geometry.freeVortexExponent,
      incidence_deg: profileIncidenceDeg,
      deviation_deg: profileDeviationDeg,
      t_max_mid_mm: derivedRotorChordMm * 0.20,
    });
  }, [currentStageResult, derivedRotorChordMm, customEquations, isStageReady]);

  // Thermodynamic & Aerodynamic Risk Diagnostics
  const designAuditDiagnostics = useMemo(() => {
    if (!isDesignReady || !currentStageResult || !radialBladeDesign) return [];
    const turning = Math.abs(currentStageResult.outletTriangle.beta - currentStageResult.inletTriangle.beta);

    const diagnostics = auditTurbomachineryDesign({
      M_rel1: currentStageResult.inletTriangle.Mach_rel,
      M_abs1: currentStageResult.inletTriangle.Mach_abs,
      M_rel2: currentStageResult.outletTriangle.Mach_rel,
      psi_Zweifel: radialBladeDesign.mid.metrics.zweifelLoading,
      solidity: radialBladeDesign.solidity_mid,
      turningAngle_deg: turning,
      incidence_deg: profileIncidenceDeg,
      deviation_deg: profileDeviationDeg,
      reaction: currentStage.R,
      hubTipRatio: radialBladeDesign.R_hub_mm / radialBladeDesign.R_tip_mm,
    });
    return diagnostics.filter((diagnostic) => diagnostic.severity !== 'optimal'
      && !(requireTwoDimensionalFlow && diagnostic.metric === 'Rh/Rt'));
  }, [isDesignReady, currentStageResult, radialBladeDesign, currentStage, requireTwoDimensionalFlow]);

  const criticalIssuesCount = designAuditDiagnostics.filter((d) => d.severity === 'critical').length;
  const warningIssuesCount = designAuditDiagnostics.filter((d) => d.severity === 'warning').length;

  const handleStageFieldChange = (idx: number, field: keyof StageConfig, val: any) => {
    setStages((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val, ...(field === 'PR' ? { psiTarget: undefined } : {}) };
      const changesDimensionalClosure = ['N', 'R', 'shaftName', 'shaftTargetPowerMW', 'direction', 'rowConfiguration'].includes(field);
      return changesDimensionalClosure ? copy.map((stage) => ({ ...stage, Rm: 0 })) : copy;
    });
    if (field === 'phi' || field === 'PR' || field === 'R' || field === 'N' || field === 'Rm') setSweepResults([]);
    if (['PR', 'N', 'Rm', 'R', 'phi'].includes(field)) {
      const stage = stages[idx];
      if (stage) setEditedStageFields((prev) => new Set(prev).add(`${stage.id}:${field}`));
    }
  };

  const runDesignSweep = () => {
    setSweepError('');
    setSweepResults([]);
    setSweepBestApplied(false);
    if (globalInputs.m_dot <= 0 || globalInputs.P01 <= 0 || globalInputs.T01 <= 0 || !globalInputs.gasKey
      || stages.some((stage) => stage.N <= 0 || !editedStageFields.has(`${stage.id}:R`))) {
      setSweepError('Completa el gas, las condiciones de entrada y, para cada fila, la velocidad y el grado de reacción. El radio se calcula.');
      return;
    }
    const shaftTargets = new Map<string, number | undefined>();
    for (const stage of stages) {
      const key = `${stage.shaftName || `Eje ${stage.N.toLocaleString()} rpm`}:${stage.N}:${stage.direction}`;
      if (stage.shaftTargetPowerMW !== undefined) shaftTargets.set(key, stage.shaftTargetPowerMW);
      else if (!shaftTargets.has(key)) shaftTargets.set(key, undefined);
    }
    if ([...shaftTargets.values()].some((target) => target === undefined || target <= 0)) {
      setSweepError('Asigna la potencia objetivo a cada eje antes del barrido; con ṁ y esas potencias se calcula el radio medio común.');
      return;
    }
    if (highCostSweep && !allowHighCostSweep) {
      setSweepError(`Este barrido requiere ${estimatedSweepCandidates.toLocaleString()} diseños. Confirma el aviso de coste para ejecutarlo.`);
      return;
    }
    const rangesAreValid = sweepRanges.phiMin > 0 && sweepRanges.phiMax > sweepRanges.phiMin
      && sweepRanges.psiMin > 0 && sweepRanges.psiMax > sweepRanges.psiMin;
    if (!rangesAreValid) {
      setSweepError('Revisa los límites: el máximo debe ser mayor que el mínimo y ambos deben ser positivos.');
      return;
    }
    const candidates = optimizeStageDesign(multiStageInputs, {
      stageIndex: safeActiveIdx,
      phi: { min: sweepRanges.phiMin, max: sweepRanges.phiMax, points: sweepRanges.points },
      psi: { min: sweepRanges.psiMin, max: sweepRanges.psiMax, points: sweepRanges.points },
      shaftPowerTolerancePercent: sweepRanges.powerTolerance,
      maxMeanPeripheralSpeedMs: sweepRanges.maxMeanPeripheralSpeed,
      requireTwoDimensionalFlow,
    });
    setSweepResults(candidates.slice(0, 8));
    if (candidates.length === 0) {
      setSweepError('No se pudo formar un espacio de búsqueda. Comprueba que cada eje tenga una potencia objetivo y que todas las filas tengan rpm.');
      return;
    }
    const bestFeasible = candidates.find((candidate) => candidate.feasible);
    if (bestFeasible) {
      applySweepCandidate(bestFeasible);
      setSweepBestApplied(true);
    } else {
      setSweepError('No se encontró un candidato que cierre ψ, respete las restricciones geométricas simplificadas y cumpla la potencia objetivo del eje seleccionado dentro de la tolerancia.');
    }
  };

  const applySweepCandidate = (candidate: DesignCandidate) => {
    const designedStages = candidate.result.inputs.stages.map((stage, index) => ({
      ...stage,
      PR: candidate.result.stageResults[index].inputs.PR,
      Rm: candidate.meanRadiusM,
      phi: candidate.result.stageResults[index].phi,
      psiTarget: candidate.result.stageResults[index].psi,
    }));
    setStages(designedStages);
    setEditedStageFields((previous) => {
      const next = new Set(previous);
      designedStages.forEach((stage) => {
        next.add(`${stage.id}:R`);
        next.add(`${stage.id}:phi`);
      });
      return next;
    });
    setAnalysisTab('triangles');
  };

  // Caso de referencia (el mismo que valida turbine1D.test.ts): etapa axial de
  // turbina de gas, reacción 50 %, para que la app muestre resultados al instante.
  const loadExampleDesign = () => {
    const exampleStage: StageConfig = {
      id: 'stage-1', name: 'Etapa 1', rowConfiguration: 'normal',
      PR: 2.2, N: 45000, direction: 1, Rm: 0.12, R: 0.5, phi: 0.6, turbineType: 'axial',
    };
    setGlobalInputs({ m_dot: 2.5, P01: 400_000, T01: 1100, gasKey: 'combustionGas' });
    setStages([exampleStage]);
    setEditedStageFields(new Set(['PR', 'N', 'Rm', 'R', 'phi'].map((field) => `${exampleStage.id}:${field}`)));
    setActiveStageIdx(0);
    setSweepResults([]);
    setSweepBestApplied(false);
    setSweepError('');
    setAnalysisTab('triangles');
  };

  const handleAddStage = () => {
    if (stages.length >= 6) return;
    const newId = `stage-${Date.now()}`;
    const newStage: StageConfig = {
      id: newId,
      name: `Etapa ${stages.length + 1}`,
      rowConfiguration: 'normal',
      PR: 0,
      N: 0,
      direction: 1,
      Rm: 0,
      R: 0,
      phi: 0,
      turbineType: 'axial',
    };
    setStages((prev) => [...prev.map((stage) => ({ ...stage, Rm: 0 })), newStage]);
    setSweepResults([]);
    setSweepBestApplied(false);
    setActiveStageIdx(stages.length);
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#f3f6fa] text-slate-800 flex flex-col font-sans">
      {/* 1. TOP BAR DASHBOARD CONTRACT */}
      <header className="min-h-14 h-auto border-b border-slate-200 bg-white/95 backdrop-blur px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2 sm:gap-4 shrink-0 sticky top-0 z-40">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Wind className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
                Turbina axial
              </span>
              <span className="hidden sm:inline text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 whitespace-nowrap">
                PREDISEÑO 1D / 3D
              </span>
            </div>
          </div>
        </div>

        {/* Primary Actions & AI Assistant Launcher */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
          <button
            onClick={() => setIsGuideOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-50 border border-sky-200 text-sky-800 hover:bg-sky-100 transition-colors"
            title="Abrir guía de diseño"
          >
            <CircleHelp className="w-4 h-4" />
            <span className="hidden sm:inline">Guía rápida</span>
          </button>
          <button
            onClick={() => setAnalysisTab('audit')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              criticalIssuesCount > 0
                ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-200 border-rose-700/80 animate-pulse'
                : warningIssuesCount > 0
                ? 'bg-amber-950/80 hover:bg-amber-900 text-amber-200 border-amber-700/80'
                : 'bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border-cyan-700/80'
            }`}
            title="Ver alertas por criterios de diseño excedidos"
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="hidden sm:inline">Alertas</span>
            {criticalIssuesCount > 0 ? (
              <span className="text-[10px] rounded-full bg-rose-400/20 px-1.5 text-rose-700">{criticalIssuesCount}</span>
            ) : warningIssuesCount > 0 ? (
              <span className="text-[10px] rounded-full bg-amber-400/20 px-1.5 text-amber-800">{warningIssuesCount}</span>
            ) : (
              <span className="text-[10px] text-emerald-700">0</span>
            )}
          </button>

          {/* Technical Documentation Button */}
          <button
            onClick={() => setIsDocumentationOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-700/80 text-slate-300 hover:text-cyan-300 hover:border-cyan-700/80 transition-all shadow-sm"
            title="Revisar documentación técnica, fórmulas y referencias teóricas"
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Documentación</span>
          </button>

          {/* Custom Equation Editor Button */}
          <button
            onClick={() => setIsEqModalOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shadow-sm ${
              isCustomEquationsActive
                ? 'bg-amber-950/80 text-amber-300 border-amber-700/80 hover:bg-amber-900'
                : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:text-cyan-300 hover:border-cyan-700/80'
            }`}
            title="Modificar o añadir ecuaciones de cálculo (Soderberg, Ainley-Mathieson, bloqueo, Zweifel)"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Ecuaciones</span>
            {isCustomEquationsActive && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="Ecuaciones personalizadas activas" />
            )}
          </button>

        </div>
      </header>

      {/* 2. OVERALL MULTI-STAGE TELEMETRY KPI STRIP */}
      <div className="bg-slate-950 border-b border-slate-800/80 px-6 py-2.5">
        <div className="max-w-[1800px] mx-auto grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <div>
              <span className="block text-[10px] font-mono uppercase text-slate-400">PRₜₜ Global</span>
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {isStageReady ? `${multiResults.PR_overall.toFixed(2)}:1` : '—'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">{stages.length} etapa{stages.length > 1 ? 's' : ''}</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <div>
              <span className="block text-[10px] font-mono uppercase text-slate-400">η Global (tt)</span>
              <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                {isStageReady ? `${(multiResults.eta_overall_tt * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono text-cyan-400 block font-semibold">
                {lossModel === 'soderberg' ? 'Soderberg' : lossModel === 'ainley_mathieson' ? 'A&M simplificado' : customEquations.userDefinedLoss.name}
              </span>
              <span className="text-[10px] font-mono text-slate-400">Rf={multiResults.reheatFactor.toFixed(3)}</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <div>
              <span className="block text-[10px] font-mono uppercase text-slate-400">Potencia Total</span>
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {!isStageReady ? '—' : multiResults.power_total_kW >= 1000
                  ? `${multiResults.power_total_MW.toFixed(2)} MW`
                  : `${multiResults.power_total_kW.toFixed(1)} kW`}
              </span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400">{stages.length} etapa{stages.length > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* 3. MAIN DASHBOARD 3-PANEL VIEWPORT (STRUCTURED EXACTLY AS USER REQUEST 6) */}
      <main className="flex-1 max-w-[1800px] w-full mx-auto p-3 sm:p-4 xl:p-6 grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-5 min-w-0">
        {/* PANEL 1: PANEL IZQUIERDO (CONTROLES CON PESTAÑA 1: TERMODINÁMICOS Y PESTAÑA 2: GEOMETRÍA) */}
        <aside className="xl:col-span-3 flex flex-col gap-4 min-w-0">
          <div className="bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
            {/* Control Panel Header with Subtabs */}
            <div className="bg-slate-950 p-2 border-b border-slate-800 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setControlTab('thermo')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  controlTab === 'thermo'
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Operación</span>
              </button>

              <button
                onClick={() => setControlTab('geometry')}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  controlTab === 'geometry'
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Geometría</span>
              </button>
            </div>

            {/* TAB 1: PARÁMETROS TERMODINÁMICOS Y OPERATIVOS CON SLIDERS Y NUMERIC INPUT EDITABLE */}
            {controlTab === 'thermo' && (
              <div className="p-4 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-220px)]">
                {/* Global Gas & Mass Flow */}
                <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/80">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
                      Condiciones de entrada
                    </span>
                    <button
                      type="button"
                      onClick={loadExampleDesign}
                      className="px-2 py-1 text-[11px] font-semibold rounded-md bg-cyan-600 text-[#fff] hover:bg-cyan-700 transition-colors"
                      title="Rellenar con una etapa de turbina de gas de referencia"
                    >
                      Cargar ejemplo
                    </button>
                  </div>
                  <div className="space-y-3">
                    {/* Gas preset selector */}
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Fluido</label>
                      <select
                        value={globalInputs.gasKey}
                        onChange={(e) =>
                          handleGlobalInputsChange((prev) => ({
                            ...prev,
                            gasKey: e.target.value as keyof typeof GAS_PRESETS,
                          }))
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="">Seleccionar fluido…</option>
                        {Object.entries(GAS_PRESETS).map(([k, g]) => (
                          <option key={k} value={k}>
                            {g.name} (γ={g.gamma})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">Modelo de pérdidas</label>
                      <select
                        value={lossModel}
                        onChange={(e) => setLossModel(e.target.value as LossModel)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-700"
                      >
                        <option value="soderberg">Soderberg</option>
                        <option value="ainley_mathieson">Ainley–Mathieson simplificado</option>
                        <option value="user_defined" disabled={!customEquations.userDefinedLoss.enabled}>{customEquations.userDefinedLoss.name || 'Modelo propio'}{!customEquations.userDefinedLoss.enabled ? ' (actívalo en Ecuaciones)' : ''}</option>
                      </select>
                    </div>

                    {/* m_dot slider + direct number input */}
                    <div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <label className="text-slate-300 font-medium">Flujo Másico (ṁ)</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="50"
                            value={globalInputs.m_dot || ''}
                            onChange={(e) =>
                              handleGlobalInputsChange((prev) => ({
                                ...prev,
                                m_dot: parseFloat(e.target.value) || 0,
                              }))
                            }
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-cyan-300 focus:outline-none focus:border-cyan-500"
                          />
                          <span className="text-[10px] text-slate-400 font-mono">kg/s</span>
                        </div>
                      </div>
                    </div>

                    {/* P01 slider + direct number input */}
                    <div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <label className="text-slate-300 font-medium">Presión Total P₀₁</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            max="200"
                            value={globalInputs.P01 ? Number((globalInputs.P01 / 1e5).toFixed(2)) : ''}
                            onChange={(e) =>
                              handleGlobalInputsChange((prev) => ({
                                ...prev,
                                P01: (parseFloat(e.target.value) || 0) * 1e5,
                              }))
                            }
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-cyan-300 focus:outline-none focus:border-cyan-500"
                          />
                          <span className="text-[10px] text-slate-400 font-mono">bar</span>
                        </div>
                      </div>
                    </div>

                    {/* T01 slider + direct number input */}
                    <div>
                      <div className="flex justify-between items-center text-xs mb-1">
                        <label className="text-slate-300 font-medium">Temperatura Total T₀₁</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            step="10"
                            min="300"
                            max="2000"
                            value={globalInputs.T01 || ''}
                            onChange={(e) =>
                              handleGlobalInputsChange((prev) => ({
                                ...prev,
                                T01: parseFloat(e.target.value) || 0,
                              }))
                            }
                            className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-cyan-300 focus:outline-none focus:border-cyan-500"
                          />
                          <span className="text-[10px] text-slate-400 font-mono">K</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Escalonamiento Selector & Parameters */}
                <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/80">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 font-semibold">
                      Fila Activa: {currentStage.shaftName ? `${currentStage.shaftName} · ` : ''}{currentStage.name}
                    </span>
                    <button
                      onClick={handleAddStage}
                      disabled={stages.length >= 6}
                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700 disabled:opacity-40 hover:bg-slate-700 flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Añadir</span>
                    </button>
                  </div>

                  {/* Stage Switcher Pills */}
                  <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                    {stages.map((stg, i) => (
                      <button
                        key={stg.id}
                        onClick={() => setActiveStageIdx(i)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-medium whitespace-nowrap transition-colors ${
                          i === safeActiveIdx
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                        }`}
                      >
                        {stg.shaftName || `Fila ${i + 1}`} {stg.direction === -1 ? '⟲' : '⟳'}
                      </button>
                    ))}
                  </div>

                  <div className="mb-3">
                    <label className="text-[11px] text-slate-400 block mb-1">Configuración de fila axial</label>
                    <select
                      value={currentStage.rowConfiguration ?? 'normal'}
                      onChange={(e) => {
                        const rowConfiguration = e.target.value as 'normal' | 'counterrotating';
                        const previous = stages[safeActiveIdx - 1];
                        const direction = rowConfiguration === 'counterrotating' && previous
                          ? (previous.direction === 1 ? -1 : 1)
                          : currentStage.direction;
                        handleStageFieldChange(safeActiveIdx, 'rowConfiguration', rowConfiguration);
                        handleStageFieldChange(safeActiveIdx, 'direction', direction);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="normal">Normal · estator + rotor</option>
                      <option value="counterrotating">Contrarrotativo · rotor solo</option>
                    </select>
                    {currentStage.rowConfiguration === 'counterrotating' && <p className="mt-1 text-[10px] text-cyan-200/80">Usa el remolino de salida de la fila anterior y omite las pérdidas de estator.</p>}
                  </div>

                  {/* Direction selector */}
                  <div className="mb-3">
                    <label className="text-[11px] text-slate-400 block mb-1">Sentido del rotor</label>
                    <select
                      value={currentStage.direction === -1 ? 'counter' : 'normal'}
                      onChange={(e) => handleStageFieldChange(safeActiveIdx, 'direction', e.target.value === 'counter' ? -1 : 1)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="normal">Sentido positivo</option>
                      <option value="counter">Sentido opuesto</option>
                    </select>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-400">Eje
                      <select value={currentStage.shaftName || 'Eje 1'} onChange={(e) => handleStageFieldChange(safeActiveIdx, 'shaftName', e.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200">
                        <option value="Eje 1">Eje 1</option>
                        <option value="Eje 2">Eje 2</option>
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-400">Objetivo del eje (MW)
                      <input type="number" min="0" step="0.1" value={currentStage.shaftTargetPowerMW ?? ''} onChange={(e) => handleStageFieldChange(safeActiveIdx, 'shaftTargetPowerMW', e.target.value ? Number(e.target.value) : undefined)} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-right font-mono text-xs text-cyan-300" />
                    </label>
                  </div>

                  {currentShaftResult?.targetPowerMW !== undefined && (
                    <div className="mb-3 rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-[11px] text-slate-300">
                      Potencia objetivo de {currentShaftResult.shaftName}: <strong className="text-cyan-200">{currentShaftResult.targetPowerMW.toFixed(1)} MW</strong>
                      {isStageReady && <span className="block mt-1">Calculada para el eje: <strong className="text-white">{currentShaftResult.power_MW.toFixed(2)} MW</strong> · desvío {(((currentShaftResult.power_MW / currentShaftResult.targetPowerMW) - 1) * 100).toFixed(1)}%</span>}
                    </div>
                  )}

                  {/* RPM slider + direct number input */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <label className="text-slate-300 font-medium">Velocidad de Giro (N)</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="1000"
                          min="3000"
                          max="120000"
                          value={currentStage.N || ''}
                          onChange={(e) =>
                            handleStageFieldChange(safeActiveIdx, 'N', parseFloat(e.target.value) || 0)
                          }
                          className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 font-mono">RPM</span>
                      </div>
                    </div>
                  </div>

                  {/* PR is derived from the thermodynamic closure */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <label className="text-slate-300 font-medium">PRₜₜ calculada</label>
                      <span className="font-mono text-cyan-300">{isStageReady ? `${currentStageResult.inputs.PR.toFixed(3)}:1` : 'se obtiene en el barrido'}</span>
                    </div>
                    {currentStage.psiTarget !== undefined && <p className="mt-1 text-[10px] text-cyan-300">PR cerrado para ψ = {currentStage.psiTarget.toFixed(3)}.</p>}
                  </div>

                  {/* Mean radius is derived from target power, mass flow and the swept loading factors. */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <label className="text-slate-300 font-medium">Radio medio común calculado</label>
                      <span className="font-mono text-cyan-300">{isStageReady ? `${(currentStage.Rm * 1000).toFixed(1)} mm` : 'se obtiene del barrido'}</span>
                    </div>
                  </div>

                  {/* Reaction R slider + direct number input */}
                  <div className="mb-3">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <label className="text-slate-300 font-medium">Grado de Reacción (R)</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.02"
                          min="0.0"
                          max="0.85"
                          value={editedStageFields.has(`${currentStage.id}:R`) ? Number(currentStage.R.toFixed(2)) : ''}
                          onChange={(e) =>
                            handleStageFieldChange(safeActiveIdx, 'R', parseFloat(e.target.value) || 0)
                          }
                          className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-mono text-right text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 font-mono">-</span>
                      </div>
                    </div>
                  </div>

                  {/* Flow and loading coefficients are selected by the sweep */}
                  <div className="rounded-md border border-slate-800 bg-slate-900/70 px-2.5 py-2">
                    <div className="flex justify-between items-center text-xs mb-1">
                      <label className="text-slate-300 font-medium">Coeficientes seleccionados</label>
                      <span className="font-mono text-cyan-300">{isStageReady ? `φ ${currentStageResult.phi.toFixed(3)} · ψ ${currentStageResult.psi.toFixed(3)}` : 'pendiente del barrido'}</span>
                    </div>
                    <p className="text-[9px] text-slate-500">La app explora φ y ψ; el PR se deriva del cierre termodinámico con pérdidas.</p>
                  </div>

                  <section className="mt-3 rounded-lg border border-cyan-900/70 bg-slate-900/80 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-xs font-semibold text-cyan-200">Barrido de diseño φ–ψ</h3>
                      <span className="text-[10px] text-slate-400">R fijado</span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-slate-400 mb-2">
                      Barre la fila seleccionada. El trabajo y el radio se derivan de ṁ y las potencias objetivo; no se introducen manualmente.
                    </p>
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-x-2 gap-y-1.5 items-center text-[10px] text-slate-400">
                      <span /> <span>mín.</span><span>máx.</span>
                      <span>φ</span>
                      <input aria-label="phi mínimo" type="number" step="0.05" value={sweepRanges.phiMin} onChange={(e) => setSweepRanges((r) => ({ ...r, phiMin: Number(e.target.value) }))} className="min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200" />
                      <input aria-label="phi máximo" type="number" step="0.05" value={sweepRanges.phiMax} onChange={(e) => setSweepRanges((r) => ({ ...r, phiMax: Number(e.target.value) }))} className="min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200" />
                      <span>ψ</span>
                      <input aria-label="psi mínimo" type="number" step="0.1" value={sweepRanges.psiMin} onChange={(e) => setSweepRanges((r) => ({ ...r, psiMin: Number(e.target.value) }))} className="min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200" />
                      <input aria-label="psi máximo" type="number" step="0.1" value={sweepRanges.psiMax} onChange={(e) => setSweepRanges((r) => ({ ...r, psiMax: Number(e.target.value) }))} className="min-w-0 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <label className="flex items-center gap-1.5">Puntos por parámetro
                        <input type="number" min="2" max="100" step="1" value={sweepRanges.points} onChange={(e) => { const value = Math.round(Number(e.target.value)); setSweepRanges((r) => ({ ...r, points: Math.max(2, Math.min(100, Number.isFinite(value) ? value : 2)) })); setAllowHighCostSweep(false); }} className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right text-slate-200" />
                      </label>
                      <label className="flex items-center gap-1.5">Tolerancia eje ±
                        <input type="number" min="0" max="50" step="1" value={sweepRanges.powerTolerance} onChange={(e) => setSweepRanges((r) => ({ ...r, powerTolerance: Math.max(0, Number(e.target.value)) }))} className="w-12 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-slate-200" />%
                      </label>
                    </div>
                    <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">Límite de velocidad periférica media Uₘₐₓ
                      <input aria-label="Límite de velocidad periférica media" type="number" min="1" max="1200" step="5" value={sweepRanges.maxMeanPeripheralSpeed} onChange={(e) => setSweepRanges((r) => ({ ...r, maxMeanPeripheralSpeed: Math.max(1, Number(e.target.value) || 1) }))} className="w-20 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-right text-slate-200" /> <span>m/s</span>
                    </label>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">Criterio del script: U₁ = ω₁Rₘ ≤ 630 m/s (el notebook usaba 625). Es un límite de velocidad periférica, no un cálculo de tensión mecánica.</p>
                    {speedLimitedMeanRadiusMm !== undefined && <p className="mt-1 text-[9px] text-slate-500">Con {fastestDesignRPM.toLocaleString()} rpm: Rₘ ≤ {speedLimitedMeanRadiusMm.toFixed(1)} mm.</p>}
                    <label className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-300"><input type="checkbox" checked={requireTwoDimensionalFlow} onChange={(e) => { setRequireTwoDimensionalFlow(e.target.checked); setSweepResults([]); }} className="mt-0.5" /> Aplicar filtro: descartar diseños con Rh/Rt ≤ 0,80</label>
                    <p className="mt-1 text-[9px] leading-relaxed text-slate-500">Desactivado: no se aplica este criterio. Activado: solo conserva diseños con Rh/Rt &gt; 0,80 en todas las filas, donde se admite la hipótesis bidimensional y se puede omitir el cálculo de equilibrio radial.</p>
                    {highCostSweep && <div role="alert" className="mt-2 rounded border border-amber-700/70 bg-amber-950/30 p-2 text-[10px] leading-relaxed text-amber-200">
                      Coste elevado: {estimatedSweepCandidates.toLocaleString()} combinaciones φ–ψ, con hasta 28 cierres termodinámicos por combinación y fila. Puede tardar y bloquear la pantalla.
                      <label className="mt-1.5 flex items-center gap-1.5"><input type="checkbox" checked={allowHighCostSweep} onChange={(e) => setAllowHighCostSweep(e.target.checked)} /> Continuar con este barrido</label>
                    </div>}
                    <button type="button" onClick={runDesignSweep} disabled={highCostSweep && !allowHighCostSweep} className="mt-2 w-full rounded-md bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                      Barrer {estimatedSweepCandidates.toLocaleString()} diseños
                    </button>
                    {sweepError && <p role="status" className="mt-2 text-[10px] leading-relaxed text-amber-300">{sweepError}</p>}
                    {sweepBestApplied && <p role="status" className="mt-2 text-[10px] text-emerald-300">Mejor candidato viable aplicado. PR, φ y ψ ya corresponden a este diseño.</p>}
                    {sweepResults.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-t border-slate-700 pt-2">
                        <p className="text-[10px] font-medium text-slate-300">Mejores candidatos por rendimiento global</p>
                        {sweepResults.slice(0, 5).map((candidate, index) => (
                          <button key={`${candidate.phi}-${candidate.psi}`} type="button" onClick={() => applySweepCandidate(candidate)} className={`w-full rounded border px-2 py-1.5 text-left text-[10px] ${candidate.feasible ? 'border-emerald-800 bg-emerald-950/30 hover:bg-emerald-950/60' : 'border-slate-700 bg-slate-950/60 opacity-70'}`}>
                            <span className="flex justify-between gap-2 text-slate-200"><strong>#{index + 1} {candidate.feasible ? `Viable para ${currentStage.shaftName || 'esta fila'}` : 'Fuera de restricciones de fila'}</strong><strong>{(candidate.efficiency * 100).toFixed(1)}% ηtt global</strong></span>
                            <span className="mt-0.5 block text-slate-400">φ {candidate.phi.toFixed(2)} · ψ {candidate.psi.toFixed(2)} (calculado {candidate.achievedPsi.toFixed(2)}) · PR {candidate.PR.toFixed(3)}</span>
                            <span className="block text-slate-400">h {candidate.result.stageResults[safeActiveIdx].bladeHeight_mm.toFixed(1)} mm · Rh/Rt mín. {candidate.minimumHubTipRatio.toFixed(3)} · R {candidate.result.stageResults[safeActiveIdx].reaction_actual.toFixed(2)} · U media máx. {candidate.maxMeanPeripheralSpeedMs.toFixed(0)} m/s</span>
                            {candidate.shaftPowerErrors.map((shaft) => <span key={shaft.shaftName} className={`block ${Math.abs(shaft.errorPercent) <= sweepRanges.powerTolerance ? 'text-emerald-300' : 'text-amber-300'}`}>{shaft.shaftName}: {shaft.actualMW.toFixed(2)}/{shaft.targetMW.toFixed(2)} MW ({shaft.errorPercent >= 0 ? '+' : ''}{shaft.errorPercent.toFixed(1)}%)</span>)}
                            {candidate.shaftPowerErrors.length > 1 && <span className={`block ${candidate.allShaftTargetsMet ? 'text-emerald-300' : 'text-amber-300'}`}>Conjunto multieje: {candidate.allShaftTargetsMet ? 'cumple' : 'requiere ajustar otras filas'}</span>}
                          </button>
                        ))}
                    <p className="text-[9px] text-slate-500">Pulsa otro candidato para comparar. La viabilidad local aplica al eje de esta fila; comprueba el cumplimiento global de todos los ejes al completar el diseño. U media se evalúa en todas las filas.</p>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}

            {controlTab === 'geometry' && isStageReady && radialBladeDesign && (
              <div className="p-4 flex flex-col gap-3">
                <div>
                  <label className="text-sm font-semibold text-slate-800">Geometría meridional calculada</label>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Alturas y radios salen de continuidad con la densidad y velocidad axial de cada estación. La cuerda se obtiene con AR = h/c = {aspectRatioTarget.toFixed(2)}.</p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[390px] text-[11px]">
                    <thead className="bg-slate-100 text-slate-500"><tr><th className="px-2 py-2 text-left">Estación</th><th className="px-2 py-2 text-right">h</th><th className="px-2 py-2 text-right">Rhub</th><th className="px-2 py-2 text-right">Rtip</th><th className="px-2 py-2 text-right">cax</th></tr></thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">{meridionalGeometry?.filter((station) => currentStage.rowConfiguration !== 'counterrotating' || station.label !== 'Entrada de fila').map((station) => <tr key={station.label}><td className="px-2 py-2">{station.label}</td><td className="px-2 py-2 text-right">{(station.height * 1000).toFixed(1)} mm</td><td className="px-2 py-2 text-right">{(station.hubRadius * 1000).toFixed(1)} mm</td><td className="px-2 py-2 text-right">{(station.tipRadius * 1000).toFixed(1)} mm</td><td className="px-2 py-2 text-right">{(station.chord * 1000).toFixed(1)} mm</td></tr>)}</tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-200 pt-3 text-xs">
                  {statorCascadeGeometry && <><span className="text-slate-500">Álabes de estator</span><strong className="text-right text-slate-800">{statorCascadeGeometry.bladeCount}</strong><span className="text-slate-500">Solidez de estator c/s</span><strong className="text-right text-slate-800">{statorCascadeGeometry.solidity.toFixed(2)}</strong><span className="text-slate-500">Paso de estator</span><strong className="text-right text-slate-800">{statorCascadeGeometry.pitchMm.toFixed(1)} mm</strong></>}
                  <span className="text-slate-500">Álabes de rotor</span><strong className="text-right text-slate-800">{radialBladeDesign.bladeCount_Z}</strong>
                  <span className="text-slate-500">Solidez de rotor c/s</span><strong className="text-right text-slate-800">{radialBladeDesign.solidity_mid.toFixed(2)}</strong>
                  <span className="text-slate-500">Paso de rotor</span><strong className="text-right text-slate-800">{radialBladeDesign.pitch_mid_mm.toFixed(1)} mm</strong>
                  <span className="text-slate-500">AR (h/c)</span><strong className="text-right text-slate-800">{aspectRatioTarget.toFixed(2)}</strong>
                  <span className="text-slate-500">Relación buje/punta (rotor)</span><strong className="text-right text-slate-800">{(radialBladeDesign.R_hub_mm / radialBladeDesign.R_tip_mm).toFixed(3)}</strong>
                  <span className="text-slate-500">Cierre pérdidas-geometría</span><strong className={`text-right ${currentStageResult.geometryLossConverged ? 'text-emerald-700' : 'text-amber-700'}`}>{currentStageResult.geometryLossConverged ? `Convergió · ${currentStageResult.geometryLossIterations} iter.` : `Límite · ${currentStageResult.geometryLossIterations} iter.`}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const csv = generateBladeCoordinatesCSV(radialBladeDesign);
                    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `${currentStage.name.replace(/\s+/g, '_')}_coordenadas_alabe.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  title="Coordenadas X, Y, Z de las secciones buje / medio / punta (ANSYS TurboGrid, OpenFOAM…)"
                >
                  Descargar coordenadas del álabe (CSV)
                </button>
                <p className="border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500">El cierre recalcula alturas, cuerda, pérdidas y estados termodinámicos hasta converger. La vista 3D usa placas rectas extruidas, con espesor solo visual; no genera perfil aerodinámico ni torsión radial.</p>
              </div>
            )}
            {controlTab === 'geometry' && !isStageReady && (
              <p className="p-4 text-sm leading-relaxed text-slate-500">Primero completa las condiciones de entrada y los parámetros de la etapa.</p>
            )}
          </div>
        </aside>

        {/* PANEL 2: PANEL CENTRAL (VISUALIZADOR 3D THREE.JS ADAPTATIVO CON BARRA FLOTANTE DE HERRAMIENTAS) */}
        <section className="xl:col-span-6 flex flex-col gap-4 min-h-[520px] xl:min-h-[640px] min-w-0">
          {isDesignReady && radialBladeDesign ? (
            <Suspense fallback={<div className="min-h-[460px] rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-center text-sm text-slate-500">Cargando visor…</div>}>
              <Rotor3DVisualizer
                radialDesign={radialBladeDesign}
                stageName={currentStage.name}
                rpm={currentStage.N}
                rotationDirection={currentStage.direction}
                statorGeometry={statorCascadeGeometry ?? undefined}
              />
              <BladeProfileCanvas radialDesign={radialBladeDesign} stageName={currentStage.name} />
            </Suspense>
          ) : (
            <div className="w-full h-full min-h-[460px] bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-center p-6 text-center">
              <span className="text-sm text-slate-500">{isStageReady ? 'La geometría meridional y el modelo conceptual se calculan con el diseño actual.' : 'Introduce las condiciones de entrada y los parámetros de diseño para empezar.'}</span>
            </div>
          )}
        </section>

        {/* PANEL 3: PANEL DERECHO / INFERIOR (RESULTADOS Y GRÁFICOS: TRIÁNGULOS 2D, TABLA REAL TIME, AUDITORÍA IA) */}
        <section className="xl:col-span-3 flex flex-col gap-4 min-w-0">
          <div className="bg-slate-900/95 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
            {/* View Sub-Tabs for Right Panel */}
            <div className={`${isStageReady ? 'bg-slate-950 p-1.5 border-b border-slate-800 flex flex-wrap items-center gap-1' : 'hidden'}`}>
              <button
                onClick={() => setAnalysisTab('triangles')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  analysisTab === 'triangles'
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wind className="w-3.5 h-3.5" />
                <span>Triángulos</span>
              </button>

              <button
                onClick={() => setAnalysisTab('table')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  analysisTab === 'table'
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Resultados</span>
              </button>

              <button
                onClick={() => setAnalysisTab('audit')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  analysisTab === 'audit'
                    ? 'bg-slate-800 text-amber-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Alertas{designAuditDiagnostics.length > 0 ? ` (${designAuditDiagnostics.length})` : ''}</span>
              </button>

              <button
                onClick={() => setAnalysisTab('balje')}
                className={`py-1.5 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                  analysisTab === 'balje'
                    ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Diagramas de Balje (Ns-Ds) y de Smith (φ-ψ)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Mapas</span>
              </button>
            </div>

            {!isStageReady && (
              <div className="p-5 text-sm leading-relaxed text-slate-500">
                Completa las condiciones de entrada y los parámetros de la etapa para ver los resultados.
              </div>
            )}

            {/* TAB CONTENT: VELOCITY TRIANGLES 2D */}
            {isStageReady && analysisTab === 'triangles' && (
              <div className="p-3.5 flex flex-col gap-3">
                <VelocityTrianglesSvg
                  inlet={currentStageResult.inletTriangle}
                  outlet={currentStageResult.outletTriangle}
                  U={currentStageResult.U}
                  turbineType={currentStage.turbineType}
                  stageName={currentStage.name}
                  direction={currentStage.direction}
                  isVanelessCoupled={safeActiveIdx > 0 && currentStage.interStageCoupling === 'vaneless'}
                />

                {/* Stage Telemetry Grid */}
                <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 block">U de Álabe:</span>
                    <strong className="text-white">{Math.abs(currentStageResult.U).toFixed(1)} m/s</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">
                      η_tt ({currentStageResult.activeLossModel === 'ainley_mathieson' ? 'A&M simplificado' : currentStageResult.activeLossModel === 'user_defined' ? customEquations.userDefinedLoss.name : 'Soderberg'}):
                    </span>
                    <strong className="text-emerald-400">{(currentStageResult.efficiency_recommended * 100).toFixed(1)}%</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Potencia Etapa:</span>
                    <strong className="text-white">{currentStageResult.power_kW.toFixed(1)} kW</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">Mach Relativo M1:</span>
                    <strong className="text-amber-300">{currentStageResult.inletTriangle.Mach_rel.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* MAPAS DE BALJE (Ns-Ds) Y SMITH (φ-ψ) */}
            {isStageReady && analysisTab === 'balje' && (
              <div className="p-3.5">
                <BaljeSmithCharts
                  Ns={currentStageResult.Ns}
                  Ds={currentStageResult.Ds}
                  phi={currentStageResult.phi}
                  psi={currentStageResult.psi}
                  etaBalje={currentStageResult.eta_Balje}
                  etaNASA={currentStageResult.efficiency_recommended}
                  turbineType={currentStage.turbineType}
                />
              </div>
            )}

            {/* RESUMEN DE RESULTADOS PRINCIPALES */}
            {isStageReady && analysisTab === "table" && (
              <div className="p-3.5">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-200">
                    <tr><td className="py-2 text-slate-500">Relación de presión PRₜₜ</td><td className="py-2 text-right font-semibold text-slate-800">{currentStage.PR.toFixed(2)}:1</td></tr>
                    <tr><td className="py-2 text-slate-500">Rendimiento ηₜₜ</td><td className="py-2 text-right font-semibold text-slate-800">{(currentStageResult.efficiency_recommended * 100).toFixed(1)}%</td></tr>
                    <tr><td className="py-2 text-slate-500">Trabajo específico</td><td className="py-2 text-right font-semibold text-slate-800">{(currentStageResult.dh_actual / 1000).toFixed(1)} kJ/kg</td></tr>
                    <tr><td className="py-2 text-slate-500">Potencia</td><td className="py-2 text-right font-semibold text-slate-800">{currentStageResult.power_kW.toFixed(1)} kW</td></tr>
                    <tr><td className="py-2 text-slate-500">Velocidad periférica U</td><td className="py-2 text-right font-semibold text-slate-800">{Math.abs(currentStageResult.U).toFixed(1)} m/s</td></tr>
                    <tr><td className="py-2 text-slate-500">Mach relativo de entrada</td><td className="py-2 text-right font-semibold text-slate-800">{currentStageResult.inletTriangle.Mach_rel.toFixed(2)}</td></tr>
                    <tr><td className="py-2 text-slate-500">Altura de álabe</td><td className="py-2 text-right font-semibold text-slate-800">{currentStageResult.bladeHeight_mm.toFixed(1)} mm</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB CONTENT: ALERTAS DE CRITERIOS NO APLICADOS COMO RESTRICCIONES */}
            {isDesignReady && analysisTab === 'audit' && (
              <div className="p-3.5 space-y-2.5 overflow-y-auto max-h-[580px] text-xs">
                <p className="text-[11px] text-slate-500">Solo se muestran criterios excedidos que el barrido no impone como restricciones.</p>

                {designAuditDiagnostics.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">No hay alertas para los criterios supervisados en esta etapa.</p>}
                {designAuditDiagnostics.map((diag, i) => (
                  <div
                    key={i}
                    className={`p-2.5 rounded-lg border ${
                      diag.severity === 'critical'
                        ? 'bg-rose-950/30 border-rose-800/80 text-rose-200'
                        : diag.severity === 'warning'
                        ? 'bg-amber-950/30 border-amber-800/80 text-amber-200'
                        : 'bg-amber-50 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-[11px] text-white flex items-center gap-1.5">
                        {diag.severity === 'critical' && <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />}
                        {diag.severity === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                        {diag.title}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
                        {diag.metric} = {diag.value}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-700 line-clamp-3">{diag.diagnosis}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {isGuideOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsGuideOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-guide-title"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 p-5 sm:p-6 border-b border-slate-200">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Ayuda opcional</p>
                <h2 id="design-guide-title" className="mt-1 text-xl font-bold text-slate-900">Guía rápida de prediseño</h2>
                <p className="mt-1 text-sm text-slate-600">Sigue este orden para definir y revisar un concepto de turbina axial.</p>
              </div>
              <button onClick={() => setIsGuideOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar guía">
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="grid gap-3 p-5 sm:p-6 sm:grid-cols-2">
              {[
                { number: '01', title: 'Define el punto de operación', body: 'Elige un fluido y ajusta el flujo másico, la presión total y la temperatura de entrada.', action: 'Ir a condiciones', run: () => setControlTab('thermo') },
                { number: '02', title: 'Configura las etapas', body: 'Selecciona las filas, fija velocidad y reacción, asigna eje y potencia objetivo y ejecuta el barrido φ–ψ.', action: 'Ver etapas', run: () => setControlTab('thermo') },
                { number: '03', title: 'Revisa la geometría', body: 'La app deriva alturas, radios, cuerdas, pasos y número de álabes desde los estados calculados.', action: 'Ver geometría', run: () => setControlTab('geometry') },
                { number: '04', title: 'Revisa antes de exportar', body: 'Comprueba triángulos de velocidad, pérdidas y avisos de auditoría. Usa los resultados como predimensionado.', action: 'Ver triángulos', run: () => setAnalysisTab('triangles') },
              ].map((step) => (
                <article key={step.number} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="text-xs font-mono font-bold text-sky-700">PASO {step.number}</span>
                  <h3 className="mt-1 font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-1.5 min-h-12 text-sm leading-relaxed text-slate-600">{step.body}</p>
                  <button
                    onClick={() => { step.run(); setIsGuideOpen(false); }}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-800 hover:text-sky-950"
                  >
                    {step.action}<span aria-hidden="true">→</span>
                  </button>
                </article>
              ))}
            </div>
            <p className="px-5 pb-5 sm:px-6 sm:pb-6 text-xs text-slate-500">La herramienta estima conceptos de etapa axial; valida los casos importantes con métodos más detallados.</p>
          </section>
        </div>
      )}

      {/* 4. FLOATING AI ASSISTANT CHAT & CFD AUDITOR MODAL */}
      <TurbineDocumentationModal isOpen={isDocumentationOpen} onClose={() => setIsDocumentationOpen(false)} />

      {/* 5. CUSTOM EQUATIONS & PHYSICS TREE MODAL (STAR-CCM+ STYLE) */}
      <EquationEditorModal
        isOpen={isEqModalOpen}
        onClose={() => setIsEqModalOpen(false)}
        config={customEquations}
        onSaveConfig={(newCfg) => {
          setCustomEquations(newCfg);
          if (!newCfg.userDefinedLoss.enabled && lossModel === 'user_defined') setLossModel('soderberg');
          try {
            localStorage.setItem('axial-turbine.active-equations.v1', JSON.stringify(newCfg));
          } catch {
            // Keep the active in-memory configuration if browser storage is unavailable.
          }
        }}
        evalContext={equationEvalContext}
        currentStageName={currentStage.name}
      />

    </div>
  );
}
