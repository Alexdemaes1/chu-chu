/**
 * Estado del diseño y todo lo que se deriva de él: resultados del motor, bloqueos, auditoría por
 * etapa, geometría, persistencia y barrido φ-ψ. App.tsx y los paneles solo componen y pintan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateMultiStageTurbine,
  type LossModel,
  type MultiStageOutputs,
  type StageConfig,
  type TurbineOutputs,
} from '../utils/turbine1D';
import {
  checkIfModified,
  evaluateCustomBladeHeight,
  normalizeCustomEquations,
  SAFE_DEFAULT_EQUATIONS,
  type CustomEquationsConfig,
  type EquationEvaluationContext,
} from '../utils/customEquations';
import {
  calculateCascadeSizing,
  calculateRadialEquilibriumBladeSections,
  type RadialBladeDesign,
} from '../utils/bladeGeometry';
import {
  auditTurbomachineryDesign,
  generateBladeCoordinatesCSV,
  type AerodynamicDiagnostic,
  type BladeCoordinatesCsvFormat,
  type TurbomachineryAuditParams,
} from '../utils/exportGeometry';
import {
  optimizeStageDesign,
  shaftNameOf,
  type DesignCandidate,
} from '../utils/designOptimization';
import {
  buildMultiStageInputs,
  buildShareUrl,
  closedFormMeanRadius,
  createBlankDesign,
  createStageId,
  defaultStageName,
  deserializeDesign,
  DESIGN_BACKUP_STORAGE_KEY,
  DESIGN_STORAGE_KEY,
  getDesignBlockers,
  getShaftConsistencyWarnings,
  groupStagesByShaft,
  isReactionSet,
  MAX_DESIGN_FILE_BYTES,
  MAX_STAGES,
  parseDesignPayload,
  reactionKey,
  readDesignPayloadFromHash,
  renumberDefaultStageNames,
  serializeDesign,
  SHARE_HASH_PREFIX,
  shaftTargetOf,
  SWEEP_RESOLVED_FIELDS,
  withAvailableLossModel,
  type DesignBlocker,
  type DesignPayload,
  type DesignState,
  type GlobalInputs,
  type SweepRanges,
} from '../utils/designState';
import { createExampleDesign } from '../utils/exampleDesign';
import { lossModelLabel } from '../utils/gasLabels';
import { downloadBlob } from '../utils/download';

export const EQUATIONS_STORAGE_KEY = 'axial-turbine.active-equations.v1';

/** Umbral de coste del barrido: puntos² × filas. Por encima se pide confirmación. */
export const SWEEP_COST_THRESHOLD = 5000;

/** Hipótesis de perfil preliminares (internas hasta la fase de diseño de perfiles). */
const PROFILE_INCIDENCE_DEG = 0;
const PROFILE_DEVIATION_DEG = 3.0;
const THICKNESS_TO_CHORD = 0.2;

const AUTOSAVE_DELAY_MS = 600;
/** Tolerancia mínima de potencia [%] para considerar el diseño al día. */
const MIN_STALE_TOLERANCE_PERCENT = 0.5;

export type NoticeTone = 'ok' | 'warn' | 'danger' | 'info';
/** Acción que el aviso ofrece como botón. 'restore-backup': volver al diseño anterior guardado. */
export type NoticeAction = 'restore-backup';
export interface Notice {
  id: number;
  tone: NoticeTone;
  text: string;
  /** Texto adicional que el usuario puede copiar (p. ej. el enlace si el portapapeles falla). */
  copyable?: string;
  action?: NoticeAction;
}

/** Texto del botón de cada acción de aviso. */
export const NOTICE_ACTION_LABELS: Record<NoticeAction, string> = {
  'restore-backup': 'Recuperar mi diseño',
};

export interface SweepContext {
  /** Fila barrida. */
  stageIndex: number;
  /** Ids de las filas en el momento del barrido: la lista solo vale si siguen siendo los mismos. */
  stageIds: string[];
}

export interface SweepState {
  candidates: DesignCandidate[];
  context: SweepContext | null;
  error: string;
  /** Motivo por el que optimizeStageDesign no ha podido barrer. */
  blocker: string;
  success: string;
  /** Clave (φ:ψ) del candidato aplicado. */
  appliedKey: string | null;
}

const EMPTY_SWEEP: SweepState = { candidates: [], context: null, error: '', blocker: '', success: '', appliedKey: null };

export const candidateKey = (candidate: Pick<DesignCandidate, 'phi' | 'psi'>): string => `${candidate.phi}:${candidate.psi}`;

export interface ShaftStatus {
  shaftName: string;
  N: number;
  direction: 1 | -1;
  powerMW: number;
  targetMW?: number;
  /** Desvío respecto al objetivo [%], si hay objetivo. */
  errorPercent?: number;
}

export interface StageAnalysis {
  bladeDesign: RadialBladeDesign;
  diagnostics: AerodynamicDiagnostic[];
}

export interface MeridionalStation {
  label: string;
  height: number;
  chord: number;
  hubRadius: number;
  tipRadius: number;
}

export interface StatorGeometry {
  bladeCount: number;
  pitchMm: number;
  solidity: number;
  heightMm: number;
  meanRadiusMm: number;
  chordMm: number;
}

export type InitialSource = 'link' | 'invalid-link-storage' | 'invalid-link-example' | 'storage' | 'example';

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------

function readStoredDesign(): DesignState | null {
  try {
    const stored = localStorage.getItem(DESIGN_STORAGE_KEY);
    return stored ? deserializeDesign(stored) : null;
  } catch {
    return null;
  }
}

function loadInitialEquations(): CustomEquationsConfig {
  try {
    const stored = localStorage.getItem(EQUATIONS_STORAGE_KEY);
    return stored ? normalizeCustomEquations(JSON.parse(stored)) : SAFE_DEFAULT_EQUATIONS;
  } catch {
    return SAFE_DEFAULT_EQUATIONS;
  }
}

const sameEquations = (a: CustomEquationsConfig, b: CustomEquationsConfig): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Guarda el diseño actual (con sus ecuaciones) en la copia de respaldo antes de sustituirlo por
 * otro distinto. Devuelve true si la copia se ha escrito.
 */
function backupDesign(current: DesignState, currentEquations: CustomEquationsConfig, incoming: DesignState, incomingEquations: CustomEquationsConfig): boolean {
  if (serializeDesign(current) === serializeDesign(incoming) && sameEquations(currentEquations, incomingEquations)) return false;
  try {
    localStorage.setItem(DESIGN_BACKUP_STORAGE_KEY, serializeDesign(current, currentEquations));
    return true;
  } catch {
    return false;
  }
}

interface ExternalDesignLoad {
  design: DesignState;
  equations: CustomEquationsConfig;
  notice: Omit<Notice, 'id'>;
}

/**
 * Prepara un diseño que llega de un enlace, de un fichero o de la copia de respaldo: aplica sus
 * ecuaciones si las trae, evita un modelo de pérdidas propio que no exista en ellas y deja copia
 * del diseño que se sustituye.
 */
function prepareExternalDesign(
  payload: DesignPayload,
  current: { design: DesignState; equations: CustomEquationsConfig } | null,
  currentEquations: CustomEquationsConfig,
  intro: string,
  isRestore = false,
): ExternalDesignLoad {
  const equations = payload.customEquations === undefined
    ? currentEquations
    : payload.customEquations ?? SAFE_DEFAULT_EQUATIONS;
  const { design, downgraded } = withAvailableLossModel(payload.design, equations);
  const backedUp = current ? backupDesign(current.design, current.equations, design, equations) : false;

  const parts = [intro];
  let tone: NoticeTone = 'ok';
  if (payload.customEquations !== undefined && !sameEquations(equations, currentEquations)) {
    if (isRestore) parts.push('También se han restablecido sus ecuaciones.');
    else {
      parts.push(payload.customEquations
        ? 'Se han aplicado las ecuaciones personalizadas que trae.'
        : 'Se calcula con las ecuaciones por defecto, como lo hizo su autor.');
    }
  } else if (payload.customEquations === undefined && checkIfModified(currentEquations)) {
    tone = 'warn';
    parts.push('No indica con qué ecuaciones se calculó: se usan tus ecuaciones personalizadas.');
  }
  if (downgraded) {
    tone = 'warn';
    parts.push('Usaba un modelo de pérdidas propio que no está activo: se calcula con Soderberg.');
  }
  if (backedUp) {
    parts.push(isRestore ? 'El diseño que tenías abierto pasa a ser la copia.' : 'Tu diseño anterior queda guardado como copia.');
  }
  return {
    design,
    equations,
    notice: { tone, text: parts.join(' '), action: backedUp ? 'restore-backup' : undefined },
  };
}

interface InitialState {
  design: DesignState;
  equations: CustomEquationsConfig;
  source: InitialSource;
  notice: Notice | null;
}

/** Prioridad: diseño del enlace (#d=…), luego el guardado en el navegador y, si no, el ejemplo. */
function loadInitialState(): InitialState {
  const storedEquations = loadInitialEquations();
  let invalidLink = false;
  try {
    if (window.location.hash.startsWith(SHARE_HASH_PREFIX)) {
      const payload = readDesignPayloadFromHash(window.location.hash);
      if (payload) {
        const stored = readStoredDesign();
        const prepared = prepareExternalDesign(
          payload,
          stored ? { design: stored, equations: storedEquations } : null,
          storedEquations,
          'Diseño cargado desde el enlace compartido.',
        );
        return {
          design: prepared.design,
          equations: prepared.equations,
          source: 'link',
          notice: { id: 1, ...prepared.notice },
        };
      }
      invalidLink = true;
    }
  } catch {
    invalidLink = true;
  }
  const stored = readStoredDesign();
  const fallback = stored ?? createExampleDesign();
  const { design, downgraded } = withAvailableLossModel(fallback, storedEquations);
  const opened = stored ? 'el último diseño guardado' : 'el ejemplo';
  let notice: Notice | null = null;
  if (invalidLink) {
    notice = { id: 1, tone: 'warn', text: `El enlace no contiene un diseño válido; se ha abierto ${opened}.` };
  } else if (downgraded) {
    notice = { id: 1, tone: 'warn', text: 'El diseño usaba un modelo de pérdidas propio que no está activo: se calcula con Soderberg.' };
  }
  const source: InitialSource = invalidLink
    ? (stored ? 'invalid-link-storage' : 'invalid-link-example')
    : (stored ? 'storage' : 'example');
  return { design, equations: storedEquations, source, notice };
}

function removeShareHash(): void {
  try {
    if (window.location.hash.startsWith(SHARE_HASH_PREFIX)) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  } catch {
    // Sin History API: el hash se queda, pero el diseño ya está cargado.
  }
}

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

/** Aplica el radio medio en forma cerrada si todas las filas tienen ψ y todos los ejes objetivo. */
function withClosedFormRadius(state: DesignState): DesignState {
  const Rm = closedFormMeanRadius(state);
  if (Rm === null) return state;
  return { ...state, stages: state.stages.map((stage) => ({ ...stage, Rm })) };
}

/** La fila tiene φ y un trabajo definido (ψ objetivo o PR): una copia suya se puede barrer o calcular. */
export function hasCoefficients(stage: StageConfig | undefined): boolean {
  if (!stage) return false;
  const hasLoading = (stage.psiTarget !== undefined && stage.psiTarget > 0) || stage.PR > 1;
  return hasLoading && stage.phi > 0;
}

/** Mensaje para explicar por qué no se puede copiar una fila todavía. */
export const COPY_STAGE_BLOCKED_MESSAGE = 'Barre antes esta etapa: la copia hereda sus coeficientes φ y ψ y, sin ellos, ninguna de las dos se podría barrer.';

function patchStage(state: DesignState, index: number, patch: Partial<StageConfig>): DesignState {
  return { ...state, stages: state.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) };
}

/** Primer nombre «Eje k» que no usa ninguna fila. */
function nextFreeShaftName(stages: StageConfig[]): string {
  const used = new Set(stages.map((stage) => shaftNameOf(stage)));
  let k = 1;
  while (used.has(`Eje ${k}`)) k += 1;
  return `Eje ${k}`;
}

/**
 * Cambia el sentido de giro de una fila. Un eje gira en un solo sentido: si otras filas comparten su
 * eje, la fila pasa a un eje libre sin potencia objetivo (el usuario debe repartir la potencia).
 */
function patchStageDirection(state: DesignState, index: number, patch: Partial<StageConfig> & { direction: 1 | -1 }): DesignState {
  const stage = state.stages[index];
  if (!stage) return state;
  const shaftName = shaftNameOf(stage);
  const sharesShaft = state.stages.some((row, i) => i !== index && shaftNameOf(row) === shaftName);
  if (patch.direction === stage.direction || !sharesShaft) return patchStage(state, index, patch);
  return patchStage(state, index, {
    ...patch,
    shaftName: nextFreeShaftName(state.stages),
    shaftTargetPowerMW: undefined,
  });
}

function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'diseno';
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Contexto numérico del editor de ecuaciones. Sin diseño calculado es null: nunca valores inventados. */
function buildEquationContext(
  result: MultiStageOutputs | null,
  stageResult: TurbineOutputs | null,
  bladeDesign: RadialBladeDesign | null,
  chordMm: number,
  m_dot: number,
): EquationEvaluationContext | null {
  if (!result || !stageResult) return null;
  const inTri = stageResult.inletTriangle;
  const outTri = stageResult.outletTriangle;
  const gas = stageResult.gas;
  return {
    m_dot,
    P01_bar: stageResult.inputs.P01 / 1e5,
    T01_K: stageResult.inputs.T01,
    P02_bar: stageResult.P03 / 1e5,
    T02_K: stageResult.T03_actual,
    T02s_K: stageResult.T03_is,
    gamma: gas.gamma,
    cp_JkgK: gas.Cp,
    Rgas_JkgK: gas.R_gas,
    PR: stageResult.inputs.PR,
    U_ms: Math.abs(stageResult.U),
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
    speedOfSound_ms: Math.sqrt(gas.gamma * gas.R_gas * stageResult.T2_static),
    dh0_kJkg: stageResult.dh_actual / 1000,
    dh0s_kJkg: stageResult.dh_is / 1000,
    reaction_R: stageResult.reaction_actual,
    flowCoeff_phi: stageResult.phi,
    stageLoading_psi: stageResult.psi,
    bladeHeight_mm: stageResult.bladeHeight_mm,
    annulusArea_m2: stageResult.bladeHeight * 2 * Math.PI * stageResult.inputs.Rm,
    Rm_m: stageResult.inputs.Rm,
    Rhub_m: stageResult.hubRadius,
    Rtip_m: stageResult.tipRadius,
    aspectRatio: stageResult.soderbergLoss.aspectRatio,
    chord_mm: chordMm,
    solidity_sc: bladeDesign ? bladeDesign.solidity_mid : Number.NaN,
    numBlades: bladeDesign ? bladeDesign.bladeCount_Z : Number.NaN,
    eta_tt: stageResult.efficiency_recommended,
    eta_ts: stageResult.eta_total_to_static,
    reheatFactor: result.reheatFactor,
    dh_is_Jkg: stageResult.dh_is,
    dh_loss_stator_Jkg: stageResult.soderbergLoss.dh_loss_stator,
    dh_loss_rotor_Jkg: stageResult.soderbergLoss.dh_loss_rotor,
    dh_loss_soderberg_Jkg: stageResult.soderbergLoss.dh_loss_total,
    dh_loss_ainley_Jkg: stageResult.ainleyMathiesonLoss.dh_loss_total,
    Mach_rel2: outTri.Mach_rel,
    zeta_N: stageResult.soderbergLoss.zeta_N,
    zeta_R: stageResult.soderbergLoss.zeta_R,
    Yp_rotor: stageResult.ainleyMathiesonLoss.Yp_rotor,
    Ys_rotor: stageResult.ainleyMathiesonLoss.Ys_rotor,
    Ytc_rotor: stageResult.ainleyMathiesonLoss.Ytc_rotor,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTurbineDesign() {
  const [initial] = useState(loadInitialState);
  const [design, setDesign] = useState<DesignState>(initial.design);
  const [activeStageIdx, setActiveStageIdxState] = useState(0);
  const [customEquations, setCustomEquations] = useState<CustomEquationsConfig>(initial.equations);
  const [sweep, setSweep] = useState<SweepState>(EMPTY_SWEEP);
  const [isSweeping, setIsSweeping] = useState(false);
  const [allowHighCostSweep, setAllowHighCostSweep] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(initial.notice);

  /** Último diseño y ecuaciones, para los manejadores que no deben volver a registrarse en cada cambio. */
  const latest = useRef({ design: initial.design, equations: initial.equations });
  useEffect(() => {
    latest.current = { design, equations: customEquations };
  }, [design, customEquations]);

  /** Se incrementa en cada invalidación: un barrido en curso cuyo número no coincide se descarta. */
  const sweepGeneration = useRef(0);

  const showNotice = useCallback((tone: NoticeTone, text: string, copyable?: string, action?: NoticeAction) => {
    setNotice({ id: Date.now(), tone, text, copyable, action });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const invalidateSweep = useCallback(() => {
    sweepGeneration.current += 1;
    setSweep(EMPTY_SWEEP);
    setIsSweeping(false);
  }, []);

  /** Cambio material del diseño: se aplica y se invalida el barrido. */
  const commit = useCallback((updater: (previous: DesignState) => DesignState) => {
    setDesign(updater);
    invalidateSweep();
  }, [invalidateSweep]);

  // El hash del enlace se quita tras cargarlo: si no, al recargar volvería a pisar los cambios.
  useEffect(() => {
    removeShareHash();
  }, []);

  // Autoguardado con retardo.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DESIGN_STORAGE_KEY, serializeDesign(design));
      } catch {
        // Almacenamiento no disponible (modo privado, cuota): el diseño sigue en memoria.
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [design]);

  // Las ecuaciones activas se guardan siempre que cambian (editor, enlace, fichero o copia).
  useEffect(() => {
    try {
      localStorage.setItem(EQUATIONS_STORAGE_KEY, JSON.stringify(customEquations));
    } catch {
      // Se mantiene la configuración activa en memoria si el navegador no deja guardar.
    }
  }, [customEquations]);

  // ---------------------------------------------------------------------------
  // Derivados
  // ---------------------------------------------------------------------------

  const { globalInputs, stages, lossModel, sweepRanges, requireTwoDimensionalFlow } = design;
  const safeActiveIdx = Math.min(Math.max(0, activeStageIdx), stages.length - 1);
  const activeStage = stages[safeActiveIdx];

  const blockers = useMemo(() => getDesignBlockers(design), [design]);
  const isReady = blockers.length === 0;
  const shaftWarnings = useMemo(() => getShaftConsistencyWarnings(stages), [stages]);
  const isCustomEquationsActive = useMemo(() => checkIfModified(customEquations), [customEquations]);
  const activeLossModelLabel = lossModelLabel(lossModel, customEquations.userDefinedLoss.name);

  const engineInputs = useMemo(
    () => buildMultiStageInputs({ globalInputs, stages, lossModel }, customEquations),
    [globalInputs, stages, lossModel, customEquations],
  );

  const calculation = useMemo((): { result: MultiStageOutputs | null; error: string } => {
    if (!isReady) return { result: null, error: '' };
    try {
      return { result: calculateMultiStageTurbine(engineInputs), error: '' };
    } catch {
      return { result: null, error: 'El motor no ha podido resolver este diseño. Revisa las entradas o las ecuaciones personalizadas.' };
    }
  }, [isReady, engineInputs]);
  const multiResults = calculation.result;
  const activeResult = multiResults?.stageResults[safeActiveIdx] ?? null;

  const shaftStatus = useMemo((): ShaftStatus[] => {
    if (!multiResults) return [];
    return multiResults.shaftResults.map((shaft) => ({
      shaftName: shaft.shaftName,
      N: shaft.N,
      direction: shaft.direction,
      powerMW: shaft.power_MW,
      targetMW: shaft.targetPowerMW,
      errorPercent: shaft.targetPowerMW && shaft.targetPowerMW > 0
        ? 100 * (shaft.power_MW - shaft.targetPowerMW) / shaft.targetPowerMW
        : undefined,
    }));
  }, [multiResults]);

  const staleTolerance = Math.max(MIN_STALE_TOLERANCE_PERCENT, sweepRanges.powerTolerance);
  /** La potencia calculada ya no cumple el objetivo de algún eje: hay que volver a barrer. */
  const stale = shaftStatus.some((shaft) => shaft.errorPercent !== undefined && Math.abs(shaft.errorPercent) > staleTolerance);

  const activeShaftStatus = activeStage
    ? shaftStatus.find((shaft) => shaft.shaftName === shaftNameOf(activeStage)
      && shaft.N === activeStage.N && shaft.direction === activeStage.direction) ?? null
    : null;
  const activeShaftTarget = activeStage ? shaftTargetOf(stages, shaftNameOf(activeStage)) : undefined;

  const aspectRatioTarget = Math.max(0.2, customEquations.sizing.aspectRatioTarget || 1.6);

  /** Geometría del álabe y auditoría de cada etapa. */
  const stageAnalyses = useMemo((): StageAnalysis[] | null => {
    if (!multiResults) return null;
    const labelled = stages.length > 1;
    return multiResults.stageResults.map((result, index) => {
      const chordMm = result.bladeHeight_mm / aspectRatioTarget;
      const bladeDesign = calculateRadialEquilibriumBladeSections({
        Rm_m: result.inputs.Rm,
        hb_m: result.bladeHeight,
        U_mid_ms: result.U,
        Va_mid_ms: result.inletTriangle.Va,
        V_theta1_mid_ms: result.inletTriangle.V_theta,
        V_theta2_mid_ms: result.outletTriangle.V_theta,
        c_ax_mid_mm: chordMm,
        psi_Zweifel: customEquations.zweifel.psi_Z_target,
        zweifelMultiplier: customEquations.zweifel.multiplier,
        useCustomZweifelFormula: customEquations.zweifel.useCustomZweifelFormula,
        customZweifelExpression: customEquations.zweifel.customZweifelExpression,
        vortexExponent: customEquations.geometry.freeVortexExponent,
        incidence_deg: PROFILE_INCIDENCE_DEG,
        deviation_deg: PROFILE_DEVIATION_DEG,
        t_max_mid_mm: chordMm * THICKNESS_TO_CHORD,
      });
      const auditParams: TurbomachineryAuditParams = {
        M_rel1: result.inletTriangle.Mach_rel,
        M_abs1: result.inletTriangle.Mach_abs,
        M_rel2: result.outletTriangle.Mach_rel,
        M_abs2: result.outletTriangle.Mach_abs,
        psi_Zweifel: bladeDesign.zweifelLoading,
        solidity: bladeDesign.solidity_mid,
        turningAngle_deg: Math.abs(result.outletTriangle.beta - result.inletTriangle.beta),
        incidence_deg: PROFILE_INCIDENCE_DEG,
        deviation_deg: PROFILE_DEVIATION_DEG,
        // Grado de reacción real de los triángulos: en filas sin estator el R de entrada no se usa.
        reaction: result.reaction_actual,
        hubTipRatio: bladeDesign.R_hub_mm / bladeDesign.R_tip_mm,
        stageLabel: labelled ? stages[index]?.name || defaultStageName(index) : undefined,
      };
      const diagnostics = auditTurbomachineryDesign(auditParams)
        // Con el filtro Rh/Rt activo, el barrido ya impone esa condición.
        .filter((diagnostic) => !(requireTwoDimensionalFlow && diagnostic.metric === 'Rh/Rt'));
      return { bladeDesign, diagnostics };
    });
  }, [multiResults, stages, aspectRatioTarget, customEquations, requireTwoDimensionalFlow]);

  const diagnostics = useMemo(
    () => (stageAnalyses ? stageAnalyses.flatMap((analysis) => analysis.diagnostics) : null),
    [stageAnalyses],
  );
  const auditCounts = useMemo(() => {
    if (!diagnostics) return null;
    return {
      critical: diagnostics.filter((diagnostic) => diagnostic.severity === 'critical').length,
      warning: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    };
  }, [diagnostics]);

  const activeBladeDesign = stageAnalyses?.[safeActiveIdx]?.bladeDesign ?? null;
  const activeChordMm = activeResult ? activeResult.bladeHeight_mm / aspectRatioTarget : Number.NaN;

  /** Alturas y radios por estación a partir de la continuidad (fila activa). */
  const meridionalGeometry = useMemo((): MeridionalStation[] | null => {
    if (!activeResult || !activeStage) return null;
    const Rm = activeResult.inputs.Rm;
    const station = (label: string, P: number, T: number, Va: number): MeridionalStation => {
      const rho = P / (activeResult.gas.R_gas * T);
      const idealArea = globalInputs.m_dot / Math.max(1e-9, rho * Va);
      const height = evaluateCustomBladeHeight(customEquations, idealArea, Rm).bladeHeight;
      return { label, height, chord: height / aspectRatioTarget, hubRadius: Rm - height / 2, tipRadius: Rm + height / 2 };
    };
    const rotorOnly = activeStage.rowConfiguration === 'counterrotating';
    const stations = [
      station('Salida del estator · entrada del rotor', activeResult.P2_static, activeResult.T2_static, activeResult.inletTriangle.Va),
      station('Salida del rotor', activeResult.P3_static, activeResult.T3_static, activeResult.outletTriangle.Va),
    ];
    if (rotorOnly) {
      stations[0] = { ...stations[0], label: 'Entrada del rotor' };
      return stations;
    }
    return [
      station('Entrada de la etapa', activeResult.P1_static, activeResult.T1_static, activeResult.inletTriangle.Va),
      ...stations,
    ];
  }, [activeResult, activeStage, globalInputs.m_dot, customEquations, aspectRatioTarget]);

  /** Rejilla del estator dimensionada con Zweifel en marco absoluto (U = 0). */
  const statorGeometry = useMemo((): StatorGeometry | null => {
    if (!activeResult || !activeStage || activeStage.rowConfiguration === 'counterrotating' || !meridionalGeometry) return null;
    const exitStation = meridionalGeometry[meridionalGeometry.length - 2];
    const previous = safeActiveIdx > 0 ? multiResults?.stageResults[safeActiveIdx - 1] : undefined;
    const sizing = calculateCascadeSizing({
      Rm_m: activeResult.inputs.Rm,
      hb_m: exitStation.height,
      U_mid_ms: 0,
      Va_mid_ms: activeResult.inletTriangle.Va,
      V_theta1_mid_ms: previous ? previous.outletTriangle.V_theta : 0,
      V_theta2_mid_ms: activeResult.inletTriangle.V_theta,
      c_ax_mid_mm: exitStation.chord * 1000,
      psi_Zweifel: customEquations.zweifel.psi_Z_target,
      zweifelMultiplier: customEquations.zweifel.multiplier,
      useCustomZweifelFormula: customEquations.zweifel.useCustomZweifelFormula,
      customZweifelExpression: customEquations.zweifel.customZweifelExpression,
    });
    return {
      bladeCount: sizing.bladeCount_Z,
      pitchMm: sizing.pitch_mid_mm,
      solidity: sizing.solidity_mid,
      heightMm: exitStation.height * 1000,
      meanRadiusMm: activeResult.inputs.Rm * 1000,
      chordMm: exitStation.chord * 1000,
    };
  }, [activeResult, activeStage, meridionalGeometry, multiResults, safeActiveIdx, customEquations.zweifel]);

  const equationContext = useMemo(
    () => buildEquationContext(multiResults, activeResult, activeBladeDesign, activeChordMm, globalInputs.m_dot),
    [multiResults, activeResult, activeBladeDesign, activeChordMm, globalInputs.m_dot],
  );

  // ---------------------------------------------------------------------------
  // Acciones sobre el diseño
  // ---------------------------------------------------------------------------

  const setActiveStageIdx = useCallback((index: number) => {
    setActiveStageIdxState(index);
  }, []);

  const setDesignName = useCallback((name: string) => {
    setDesign((previous) => ({ ...previous, name: name.slice(0, 80) }));
  }, []);

  /**
   * Entradas globales. T₀₁, P₀₁ y fluido mantienen el radio y se recalcula en vivo; ṁ intenta
   * el radio en forma cerrada y, si no se puede, lo mantiene (el aviso de desactualizado lo indica).
   */
  const setGlobalInput = useCallback(<K extends keyof GlobalInputs>(key: K, value: GlobalInputs[K]) => {
    commit((previous) => {
      const next = { ...previous, globalInputs: { ...previous.globalInputs, [key]: value } };
      return key === 'm_dot' ? withClosedFormRadius(next) : next;
    });
  }, [commit]);

  const setLossModel = useCallback((model: LossModel) => {
    commit((previous) => ({ ...previous, lossModel: model }));
  }, [commit]);

  const setStageSpeed = useCallback((index: number, N: number) => {
    commit((previous) => withClosedFormRadius(patchStage(previous, index, { N })));
  }, [commit]);

  const setStageReaction = useCallback((index: number, R: number) => {
    commit((previous) => {
      const stage = previous.stages[index];
      if (!stage) return previous;
      const key = reactionKey(stage.id);
      const editedFields = previous.editedFields.includes(key) ? previous.editedFields : [...previous.editedFields, key];
      return { ...patchStage(previous, index, { R }), editedFields };
    });
  }, [commit]);

  const setStageDirection = useCallback((index: number, direction: 1 | -1) => {
    commit((previous) => withClosedFormRadius(patchStageDirection(previous, index, { direction })));
  }, [commit]);

  const setRowConfiguration = useCallback((index: number, rowConfiguration: 'normal' | 'counterrotating') => {
    if (index === 0 && rowConfiguration === 'counterrotating') return;
    commit((previous) => {
      const stage = previous.stages[index];
      if (!stage) return previous;
      const before = previous.stages[index - 1];
      const direction = rowConfiguration === 'counterrotating' && before
        ? (before.direction === 1 ? -1 : 1)
        : stage.direction;
      return withClosedFormRadius(patchStageDirection(previous, index, { rowConfiguration, direction }));
    });
  }, [commit]);

  /**
   * Cambia el eje de una fila. Si el eje destino ya tiene filas, adopta su potencia objetivo. Si está
   * vacío, la fila solo conserva su objetivo cuando estaba sola en su eje (equivale a renombrarlo);
   * si lo compartía, el objetivo era de todo ese eje y el nuevo queda sin objetivo.
   */
  const setStageShaft = useCallback((index: number, shaftName: string) => {
    commit((previous) => {
      const stage = previous.stages[index];
      if (!stage) return previous;
      const others = previous.stages.filter((_, i) => i !== index);
      const hasOtherRows = others.some((row) => shaftNameOf(row) === shaftName);
      const leavesSharedShaft = others.some((row) => shaftNameOf(row) === shaftNameOf(stage));
      const shaftTargetPowerMW = hasOtherRows
        ? shaftTargetOf(others, shaftName)
        : leavesSharedShaft ? undefined : stage.shaftTargetPowerMW;
      return withClosedFormRadius(patchStage(previous, index, { shaftName, shaftTargetPowerMW }));
    });
  }, [commit]);

  /** Potencia objetivo de un eje: se guarda en todas sus filas para que no haya objetivos dispares. */
  const setShaftTarget = useCallback((shaftName: string, targetMW: number | undefined) => {
    const value = targetMW !== undefined && targetMW > 0 ? targetMW : undefined;
    commit((previous) => withClosedFormRadius({
      ...previous,
      stages: previous.stages.map((stage) => (shaftNameOf(stage) === shaftName ? { ...stage, shaftTargetPowerMW: value } : stage)),
    }));
  }, [commit]);

  /** Añade una etapa que copia velocidad, reacción, eje, sentido y coeficientes de la anterior. */
  const addStage = useCallback(() => {
    if (stages.length >= MAX_STAGES || !hasCoefficients(stages[stages.length - 1])) return;
    const newIndex = stages.length;
    commit((previous) => {
      if (previous.stages.length >= MAX_STAGES) return previous;
      const last = previous.stages[previous.stages.length - 1];
      const id = createStageId();
      const stage: StageConfig = {
        id,
        name: defaultStageName(previous.stages.length),
        rowConfiguration: 'normal',
        shaftName: shaftNameOf(last),
        shaftTargetPowerMW: last.shaftTargetPowerMW,
        PR: last.PR,
        psiTarget: last.psiTarget,
        N: last.N,
        direction: last.direction,
        Rm: last.Rm,
        R: last.R,
        phi: last.phi,
        turbineType: last.turbineType,
      };
      const editedFields = isReactionSet(previous, last.id)
        ? [...previous.editedFields, reactionKey(id)]
        : previous.editedFields;
      return withClosedFormRadius({ ...previous, stages: [...previous.stages, stage], editedFields });
    });
    setActiveStageIdxState(newIndex);
  }, [commit, stages.length]);

  const duplicateStage = useCallback((index: number) => {
    if (stages.length >= MAX_STAGES || !stages[index] || !hasCoefficients(stages[index])) return;
    commit((previous) => {
      const source = previous.stages[index];
      if (!source || previous.stages.length >= MAX_STAGES) return previous;
      const id = createStageId();
      const copy: StageConfig = {
        ...source,
        id,
        name: /^Etapa \d+$/.test(source.name) ? defaultStageName(index + 1) : `${source.name} (copia)`.slice(0, 80),
      };
      const list = [...previous.stages];
      list.splice(index + 1, 0, copy);
      const editedFields = isReactionSet(previous, source.id)
        ? [...previous.editedFields, reactionKey(id)]
        : previous.editedFields;
      return withClosedFormRadius({ ...previous, stages: renumberDefaultStageNames(list), editedFields });
    });
    setActiveStageIdxState(index + 1);
  }, [commit, stages]);

  const removeStage = useCallback((index: number) => {
    if (stages.length <= 1 || !stages[index]) return;
    const removedId = stages[index].id;
    commit((previous) => {
      if (previous.stages.length <= 1) return previous;
      const list = previous.stages.filter((stage) => stage.id !== removedId);
      // La nueva primera fila necesita estator.
      if (list[0]?.rowConfiguration === 'counterrotating') list[0] = { ...list[0], rowConfiguration: 'normal' };
      const editedFields = previous.editedFields.filter((field) => !field.startsWith(`${removedId}:`));
      return withClosedFormRadius({ ...previous, stages: renumberDefaultStageNames(list), editedFields });
    });
    setActiveStageIdxState((current) => {
      if (index < current) return current - 1;
      if (index === current) return Math.min(index, stages.length - 2);
      return current;
    });
  }, [commit, stages]);

  const renameStage = useCallback((index: number, name: string) => {
    const trimmed = name.trim().slice(0, 80);
    setDesign((previous) => patchStage(previous, index, { name: trimmed || defaultStageName(index) }));
  }, []);

  const setSweepRange = useCallback(<K extends keyof SweepRanges>(key: K, value: SweepRanges[K]) => {
    commit((previous) => ({ ...previous, sweepRanges: { ...previous.sweepRanges, [key]: value } }));
    if (key === 'points') setAllowHighCostSweep(false);
  }, [commit]);

  const setRequireTwoDimensionalFlow = useCallback((value: boolean) => {
    commit((previous) => ({ ...previous, requireTwoDimensionalFlow: value }));
  }, [commit]);

  const loadDesign = useCallback((next: DesignState) => {
    setDesign(next);
    setActiveStageIdxState(0);
    setAllowHighCostSweep(false);
    invalidateSweep();
  }, [invalidateSweep]);

  const loadExample = useCallback(() => {
    loadDesign(createExampleDesign());
    showNotice('ok', 'Ejemplo restablecido.');
  }, [loadDesign, showNotice]);

  const newDesign = useCallback(() => {
    loadDesign(createBlankDesign());
    showNotice('info', 'Diseño nuevo: completa la lista de comprobación para calcular.');
  }, [loadDesign, showNotice]);

  const saveCustomEquations = useCallback((config: CustomEquationsConfig) => {
    setCustomEquations(config);
    setDesign((previous) => withAvailableLossModel(previous, config).design);
    invalidateSweep();
  }, [invalidateSweep]);

  /** Carga un diseño externo (enlace o fichero) con sus ecuaciones y deja copia del actual. */
  const loadExternalDesign = useCallback((payload: DesignPayload, intro: string, isRestore = false) => {
    const current = latest.current;
    const prepared = prepareExternalDesign(payload, current, current.equations, intro, isRestore);
    setCustomEquations(prepared.equations);
    loadDesign(prepared.design);
    showNotice(prepared.notice.tone, prepared.notice.text, undefined, prepared.notice.action);
  }, [loadDesign, showNotice]);

  /** Vuelve al diseño guardado como copia; el actual pasa a ser la copia (se puede alternar). */
  const restoreBackupDesign = useCallback(() => {
    let payload: DesignPayload | null = null;
    try {
      const raw = localStorage.getItem(DESIGN_BACKUP_STORAGE_KEY);
      payload = raw ? parseDesignPayload(raw) : null;
    } catch {
      payload = null;
    }
    if (!payload) {
      showNotice('danger', 'No hay ninguna copia de tu diseño anterior en este navegador.');
      return;
    }
    loadExternalDesign(payload, 'Se ha recuperado tu diseño anterior.', true);
  }, [loadExternalDesign, showNotice]);

  // ---------------------------------------------------------------------------
  // Compartir, exportar e importar
  // ---------------------------------------------------------------------------

  const shareLink = useCallback(async () => {
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const url = buildShareUrl(design, base, customEquations);
    const withEquations = checkIfModified(customEquations)
      ? ' Incluye tus ecuaciones personalizadas: quien lo abra verá este mismo diseño con los mismos resultados.'
      : ' Quien lo abra verá este mismo diseño, calculado con las ecuaciones por defecto.';
    try {
      await navigator.clipboard.writeText(url);
      showNotice('ok', `Enlace copiado al portapapeles.${withEquations}`);
    } catch {
      showNotice('info', 'No se ha podido copiar automáticamente. Copia el enlace:', url);
    }
  }, [design, customEquations, showNotice]);

  const exportDesignFile = useCallback(() => {
    const pretty = JSON.stringify(JSON.parse(serializeDesign(design, customEquations)), null, 2);
    downloadBlob(new Blob([pretty], { type: 'application/json' }), `${slugify(design.name)}.json`);
  }, [design, customEquations]);

  const importDesignFile = useCallback(async (file: File) => {
    if (file.size > MAX_DESIGN_FILE_BYTES) {
      showNotice('danger', 'El fichero es demasiado grande para ser un diseño (máximo 256 KB).');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      showNotice('danger', 'No se ha podido leer el fichero.');
      return;
    }
    const imported = parseDesignPayload(text);
    if (!imported) {
      showNotice('danger', 'El fichero no es un diseño válido de Turbina 1D o es de una versión desconocida.');
      return;
    }
    loadExternalDesign(imported, `Diseño «${imported.design.name}» importado.`);
  }, [loadExternalDesign, showNotice]);

  // Un enlace pegado en la misma pestaña cambia solo el hash: se pide confirmación, como al
  // restablecer el ejemplo, y el diseño actual queda como copia recuperable.
  useEffect(() => {
    const onHashChange = () => {
      if (!window.location.hash.startsWith(SHARE_HASH_PREFIX)) return;
      const payload = readDesignPayloadFromHash(window.location.hash);
      removeShareHash();
      if (!payload) {
        showNotice('warn', 'El enlace no contiene un diseño válido.');
        return;
      }
      const confirmed = window.confirm(
        `¿Abrir el diseño «${payload.design.name}» del enlace? Sustituirá al actual, que quedará guardado como copia para recuperarlo.`,
      );
      if (confirmed) loadExternalDesign(payload, 'Diseño cargado desde el enlace compartido.');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [loadExternalDesign, showNotice]);

  const downloadBladeCsv = useCallback((format: BladeCoordinatesCsvFormat) => {
    if (!activeBladeDesign || !activeStage) return;
    const csv = generateBladeCoordinatesCSV(activeBladeDesign, { format });
    const suffix = format === 'excel' ? 'excel' : 'cad';
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `${slugify(activeStage.name)}_coordenadas_alabe_${suffix}.csv`,
    );
  }, [activeBladeDesign, activeStage]);

  // ---------------------------------------------------------------------------
  // Barrido φ-ψ
  // ---------------------------------------------------------------------------

  const sweepPoints = Math.max(2, Math.round(sweepRanges.points));
  const sweepCost = sweepPoints * sweepPoints * stages.length;
  const highCostSweep = sweepCost > SWEEP_COST_THRESHOLD;

  /** Bloqueos que impiden barrer (los que resuelve el propio barrido no cuentan). */
  const sweepBlockers = useMemo((): DesignBlocker[] => {
    const list = blockers.filter((blocker) => !SWEEP_RESOLVED_FIELDS.includes(blocker.field));
    // Filas de un mismo eje con rpm o sentido distintos: el motor las separaría en ejes con el mismo
    // nombre y el objetivo de potencia se contaría dos veces.
    for (const warning of shaftWarnings) list.push({ field: 'shaftTarget', message: warning });
    for (const group of groupStagesByShaft(stages)) {
      if (group.targetMW === undefined) {
        list.push({
          field: 'shaftTarget',
          stageIndex: group.stageIndices[0],
          message: `Asigna la potencia objetivo de ${group.name}: con ṁ y esa potencia se calcula el radio medio común.`,
        });
      }
    }
    return list;
  }, [blockers, stages, shaftWarnings]);

  const sweepVisible = sweep.context !== null
    && sweep.context.stageIndex === safeActiveIdx
    && sameIds(sweep.context.stageIds, stages.map((stage) => stage.id));

  /**
   * Aplica un candidato fusionando por id: φ, PR y Rm en todas las filas; ψ solo en la barrida.
   * φ es el de entrada (antes del multiplicador de φ de las ecuaciones), no el φ resultante.
   */
  const applyCandidateToDesign = useCallback((candidate: DesignCandidate, context: SweepContext) => {
    const sweptId = context.stageIds[context.stageIndex];
    const indexById = new Map(candidate.result.inputs.stages.map((stage, index) => [stage.id, index]));
    setDesign((previous) => ({
      ...previous,
      stages: previous.stages.map((stage) => {
        const index = indexById.get(stage.id);
        if (index === undefined) return stage;
        const result = candidate.result.stageResults[index];
        if (!result) return stage;
        const inputPhi = candidate.result.inputs.stages[index]?.phi ?? stage.phi;
        const next: StageConfig = { ...stage, phi: inputPhi, PR: result.inputs.PR, Rm: candidate.meanRadiusM };
        if (stage.id === sweptId) next.psiTarget = result.psi;
        return next;
      }),
    }));
  }, []);

  const applySweepCandidate = useCallback((candidate: DesignCandidate) => {
    if (!sweep.context) return;
    applyCandidateToDesign(candidate, sweep.context);
    setSweep((previous) => ({
      ...previous,
      appliedKey: candidateKey(candidate),
      error: '',
      success: candidate.feasible
        ? 'Candidato aplicado. PR, φ, ψ y el radio medio corresponden ahora a este diseño.'
        : 'Candidato aplicado, aunque no cumple todas las restricciones del barrido.',
    }));
  }, [applyCandidateToDesign, sweep.context]);

  const runSweep = useCallback(() => {
    if (isSweeping) return;
    const fail = (error: string) => setSweep({ ...EMPTY_SWEEP, error });
    if (sweepBlockers.length > 0) {
      fail(`Antes de barrer: ${sweepBlockers[0].message}`);
      return;
    }
    const ranges = sweepRanges;
    const rangesAreValid = ranges.phiMin > 0 && ranges.phiMax > ranges.phiMin
      && ranges.psiMin > 0 && ranges.psiMax > ranges.psiMin;
    if (!rangesAreValid) {
      fail('Revisa los rangos: el máximo debe ser mayor que el mínimo y ambos, positivos.');
      return;
    }
    if (highCostSweep && !allowHighCostSweep) {
      fail(`Este barrido evalúa ${sweepCost.toLocaleString('es-ES')} combinaciones. Confirma el aviso de coste para lanzarlo.`);
      return;
    }

    const context: SweepContext = { stageIndex: safeActiveIdx, stageIds: stages.map((stage) => stage.id) };
    const inputs = engineInputs;
    const generation = sweepGeneration.current + 1;
    sweepGeneration.current = generation;
    setSweep(EMPTY_SWEEP);
    setIsSweeping(true);

    // Se deja pintar el estado «Calculando…» antes de bloquear el hilo con el cálculo.
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (sweepGeneration.current !== generation) return;
        let next: SweepState;
        try {
          const output = optimizeStageDesign(inputs, {
            stageIndex: context.stageIndex,
            phi: { min: ranges.phiMin, max: ranges.phiMax, points: sweepPoints },
            psi: { min: ranges.psiMin, max: ranges.psiMax, points: sweepPoints },
            shaftPowerTolerancePercent: ranges.powerTolerance,
            maxMeanPeripheralSpeedMs: ranges.maxMeanPeripheralSpeed,
            requireTwoDimensionalFlow,
          });
          if (output.blocker) {
            next = { ...EMPTY_SWEEP, blocker: output.blocker };
          } else if (output.length === 0) {
            next = { ...EMPTY_SWEEP, error: 'No se ha podido formar el espacio de búsqueda. Comprueba los objetivos de potencia y las rpm de cada etapa.' };
          } else {
            const best = output.find((candidate) => candidate.feasible);
            next = { ...EMPTY_SWEEP, candidates: [...output], context };
            if (best) {
              applyCandidateToDesign(best, context);
              next.appliedKey = candidateKey(best);
              next.success = 'Mejor candidato viable aplicado. PR, φ, ψ y el radio medio corresponden ahora a este diseño.';
            } else {
              next.error = 'Ningún candidato cierra ψ, cumple la potencia objetivo del eje dentro de la tolerancia y respeta las restricciones. Amplía los rangos o revisa el objetivo.';
            }
          }
        } catch {
          next = { ...EMPTY_SWEEP, error: 'El barrido se ha interrumpido por un error de cálculo. Revisa los rangos y las ecuaciones personalizadas.' };
        }
        if (sweepGeneration.current !== generation) return;
        setSweep(next);
        setIsSweeping(false);
      }, 0);
    });
  }, [
    isSweeping, sweepBlockers, sweepRanges, highCostSweep, allowHighCostSweep, sweepCost, safeActiveIdx,
    stages, engineInputs, sweepPoints, requireTwoDimensionalFlow, applyCandidateToDesign,
  ]);

  return {
    // Estado
    design,
    initialSource: initial.source,
    activeStageIdx: safeActiveIdx,
    activeStage,
    customEquations,
    isCustomEquationsActive,
    lossModelLabel: activeLossModelLabel,
    notice,

    // Derivados
    blockers,
    isReady,
    calculationError: calculation.error,
    multiResults,
    activeResult,
    stale,
    shaftStatus,
    activeShaftStatus,
    activeShaftTarget,
    shaftWarnings,
    canAddStage: stages.length < MAX_STAGES && hasCoefficients(stages[stages.length - 1]),
    stageAnalyses,
    activeBladeDesign,
    diagnostics,
    auditCounts,
    meridionalGeometry,
    statorGeometry,
    aspectRatioTarget,
    equationContext,

    // Acciones
    setActiveStageIdx,
    setDesignName,
    setGlobalInput,
    setLossModel,
    setStageSpeed,
    setStageReaction,
    setStageDirection,
    setRowConfiguration,
    setStageShaft,
    setShaftTarget,
    addStage,
    duplicateStage,
    removeStage,
    renameStage,
    loadExample,
    newDesign,
    saveCustomEquations,
    shareLink,
    exportDesignFile,
    importDesignFile,
    downloadBladeCsv,
    showNotice,
    dismissNotice,
    restoreBackupDesign,

    // Barrido
    sweep: {
      ...sweep,
      visible: sweepVisible,
      isSweeping,
      cost: sweepCost,
      points: sweepPoints,
      highCost: highCostSweep,
      allowHighCost: allowHighCostSweep,
      blockers: sweepBlockers,
      ranges: sweepRanges,
      requireTwoDimensionalFlow,
    },
    setSweepRange,
    setRequireTwoDimensionalFlow,
    setAllowHighCostSweep,
    runSweep,
    applySweepCandidate,
  };
}

export type TurbineDesignModel = ReturnType<typeof useTurbineDesign>;
