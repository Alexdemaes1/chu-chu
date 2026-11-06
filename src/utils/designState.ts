/**
 * Estado persistible del diseño: tipos, valores por defecto, validación de bloqueos,
 * radio medio en forma cerrada y (de)serialización versionada para localStorage, enlace y JSON.
 *
 * Lógica pura, sin React: se prueba en designState.test.ts.
 */
import type { LossModel, MultiStageInputs, StageConfig } from './turbine1D';
import { checkIfModified, normalizeCustomEquations, type CustomEquationsConfig } from './customEquations';
import { shaftNameOf } from './designOptimization';
import { isGasKey, type GasKey } from './gasLabels';

export interface GlobalInputs {
  /** Flujo másico [kg/s]. */
  m_dot: number;
  /** Presión total de entrada [Pa]. */
  P01: number;
  /** Temperatura total de entrada [K]. */
  T01: number;
  gasKey: GasKey | '';
}

export interface SweepRanges {
  phiMin: number;
  phiMax: number;
  psiMin: number;
  psiMax: number;
  /** Puntos por parámetro (la malla tiene points² combinaciones por fila). */
  points: number;
  /** Tolerancia de potencia por eje [%]. */
  powerTolerance: number;
  /** Límite cinemático de velocidad periférica media [m/s]. */
  maxMeanPeripheralSpeed: number;
}

export interface DesignState {
  name: string;
  globalInputs: GlobalInputs;
  stages: StageConfig[];
  lossModel: LossModel;
  sweepRanges: SweepRanges;
  requireTwoDimensionalFlow: boolean;
  /**
   * Campos introducidos por el usuario, como `${stageId}:R`. El grado de reacción admite 0, así que
   * hace falta distinguir «sin definir» de «R = 0».
   */
  editedFields: string[];
}

export const DESIGN_STATE_VERSION = 1;
export const DESIGN_STORAGE_KEY = 'axial-turbine.design.v1';
/** Copia del diseño propio (con sus ecuaciones) antes de sustituirlo por uno de un enlace o fichero. */
export const DESIGN_BACKUP_STORAGE_KEY = 'axial-turbine.design.v1.backup';
export const SHARE_HASH_PREFIX = '#d=';
export const MAX_STAGES = 6;
export const MAX_DESIGN_FILE_BYTES = 256 * 1024;
export const DEFAULT_DESIGN_NAME = 'Diseño sin título';

export const MIN_MASS_FLOW = 0.01;
export const MIN_P01_PA = 0.1e5;
export const MIN_T01_K = 250;
export const MAX_REACTION = 0.85;

export const DEFAULT_SWEEP_RANGES: SweepRanges = {
  phiMin: 0.3,
  phiMax: 1.1,
  psiMin: 0.4,
  psiMax: 2.0,
  points: 25,
  powerTolerance: 5,
  maxMeanPeripheralSpeed: 630,
};

/** Límites de cada campo del barrido: los mismos que admite la interfaz. */
export const SWEEP_RANGE_LIMITS: Record<keyof SweepRanges, { min: number; max: number }> = {
  phiMin: { min: 0.05, max: 3 },
  phiMax: { min: 0.05, max: 3 },
  psiMin: { min: 0.1, max: 5 },
  psiMax: { min: 0.1, max: 5 },
  points: { min: 2, max: 100 },
  powerTolerance: { min: 0, max: 50 },
  maxMeanPeripheralSpeed: { min: 50, max: 1200 },
};

export const LOSS_MODELS: readonly LossModel[] = ['soderberg', 'ainley_mathieson', 'user_defined'];

export const reactionKey = (stageId: string): string => `${stageId}:R`;

export function isReactionSet(state: Pick<DesignState, 'editedFields'>, stageId: string): boolean {
  return state.editedFields.includes(reactionKey(stageId));
}

/** Nombre por defecto de una etapa según su posición. */
export const defaultStageName = (index: number): string => `Etapa ${index + 1}`;
const DEFAULT_STAGE_NAME_PATTERN = /^Etapa \d+$/;

/** Renumera las etapas que conservan su nombre por defecto («Etapa N») tras insertar o borrar filas. */
export function renumberDefaultStageNames(stages: StageConfig[]): StageConfig[] {
  return stages.map((stage, index) => (
    DEFAULT_STAGE_NAME_PATTERN.test(stage.name) && stage.name !== defaultStageName(index)
      ? { ...stage, name: defaultStageName(index) }
      : stage
  ));
}

let stageIdCounter = 0;
/** Id único para una etapa nueva. */
export function createStageId(): string {
  stageIdCounter += 1;
  return `stage-${Date.now().toString(36)}-${stageIdCounter}`;
}

export function createBlankStage(index: number, id: string = createStageId()): StageConfig {
  return {
    id,
    name: defaultStageName(index),
    rowConfiguration: 'normal',
    shaftName: 'Eje 1',
    PR: 0,
    N: 0,
    direction: 1,
    Rm: 0,
    R: 0,
    phi: 0,
    turbineType: 'axial',
  };
}

/** Diseño vacío para empezar de cero: sin fluido, sin condiciones y una etapa por definir. */
export function createBlankDesign(): DesignState {
  return {
    name: 'Diseño nuevo',
    globalInputs: { m_dot: 0, P01: 0, T01: 0, gasKey: '' },
    stages: [createBlankStage(0, 'stage-1')],
    lossModel: 'soderberg',
    sweepRanges: { ...DEFAULT_SWEEP_RANGES },
    requireTwoDimensionalFlow: false,
    editedFields: [],
  };
}

/** Hipótesis de rejilla fijas del prediseño (las mismas en el ejemplo y en la app). */
export const CASCADE_ASSUMPTIONS = {
  pitchToChord: 0.8,
  tmaxToChord: 0.2,
  tipClearanceRatio: 0.015,
} as const;

/**
 * Entradas del motor a partir del estado del diseño, con los valores tal cual (sin recortes
 * ocultos): solo debe llamarse para calcular cuando getDesignBlockers no devuelve nada, o para
 * el barrido, que fija él mismo el radio medio y los coeficientes de la fila barrida.
 */
export function buildMultiStageInputs(
  state: Pick<DesignState, 'globalInputs' | 'stages' | 'lossModel'>,
  customEquations: CustomEquationsConfig,
): MultiStageInputs {
  return {
    m_dot: state.globalInputs.m_dot,
    P01: state.globalInputs.P01,
    T01: state.globalInputs.T01,
    gasKey: state.globalInputs.gasKey || undefined,
    stages: state.stages.map((stage) => ({ ...stage, shaftName: shaftNameOf(stage) })),
    lossModel: state.lossModel,
    ...CASCADE_ASSUMPTIONS,
    customEquations,
  };
}

// ---------------------------------------------------------------------------
// Ejes y radio medio
// ---------------------------------------------------------------------------

export interface ShaftGroup {
  /** Clave igual a la que usa el motor: nombre, rpm y sentido. */
  key: string;
  name: string;
  N: number;
  direction: 1 | -1;
  stageIndices: number[];
  targetMW?: number;
}

/** Agrupa las filas por eje con la misma clave que calculateMultiStageTurbine. */
export function groupStagesByShaft(stages: StageConfig[]): ShaftGroup[] {
  const groups = new Map<string, ShaftGroup>();
  stages.forEach((stage, index) => {
    const name = shaftNameOf(stage);
    const key = `${name}:${stage.N}:${stage.direction}`;
    const group = groups.get(key) ?? { key, name, N: stage.N, direction: stage.direction, stageIndices: [] };
    group.stageIndices.push(index);
    if (stage.shaftTargetPowerMW !== undefined && stage.shaftTargetPowerMW > 0) group.targetMW = stage.shaftTargetPowerMW;
    groups.set(key, group);
  });
  return [...groups.values()];
}

/** Potencia objetivo del eje con ese nombre (la de cualquiera de sus filas), si existe. */
export function shaftTargetOf(stages: StageConfig[], shaftName: string): number | undefined {
  const row = stages.find((stage) => shaftNameOf(stage) === shaftName
    && stage.shaftTargetPowerMW !== undefined && stage.shaftTargetPowerMW > 0);
  return row?.shaftTargetPowerMW;
}

/** Avisos de coherencia: filas de un mismo eje con rpm o sentido distintos. */
export function getShaftConsistencyWarnings(stages: StageConfig[]): string[] {
  const byName = new Map<string, StageConfig[]>();
  for (const stage of stages) {
    const name = shaftNameOf(stage);
    byName.set(name, [...(byName.get(name) ?? []), stage]);
  }
  const warnings: string[] = [];
  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    const speeds = new Set(rows.map((row) => row.N));
    const directions = new Set(rows.map((row) => row.direction));
    if (speeds.size > 1) warnings.push(`${name}: sus etapas giran a rpm distintas; un mismo eje debe tener una sola velocidad.`);
    if (directions.size > 1) warnings.push(`${name}: sus etapas tienen sentidos de giro distintos; revisa el eje asignado.`);
  }
  return warnings;
}

/**
 * Radio medio común en forma cerrada, el mismo cierre que usa el barrido:
 * P_total = ṁ · Rm² · Σ ψ_i ω_i²  →  Rm = √(P_total / (ṁ · Σ ψ_i ω_i²)).
 *
 * Solo es válido si todas las filas tienen ψ objetivo y todos los ejes tienen potencia objetivo;
 * en otro caso devuelve null y el radio actual se mantiene.
 */
export function closedFormMeanRadius(state: Pick<DesignState, 'globalInputs' | 'stages'>): number | null {
  const { stages, globalInputs } = state;
  if (stages.length === 0 || !(globalInputs.m_dot > 0)) return null;
  if (!stages.every((stage) => stage.psiTarget !== undefined && stage.psiTarget > 0 && stage.N > 0)) return null;
  const groups = groupStagesByShaft(stages);
  if (!groups.every((group) => group.targetMW !== undefined)) return null;
  const totalPowerW = groups.reduce((sum, group) => sum + (group.targetMW ?? 0) * 1e6, 0);
  const loadingRateSum = stages.reduce((sum, stage) => {
    const omega = 2 * Math.PI * stage.N / 60;
    return sum + (stage.psiTarget ?? 0) * omega * omega;
  }, 0);
  if (!(totalPowerW > 0) || !(loadingRateSum > 0)) return null;
  const Rm = Math.sqrt(totalPowerW / (globalInputs.m_dot * loadingRateSum));
  return Number.isFinite(Rm) && Rm > 0 ? Rm : null;
}

// ---------------------------------------------------------------------------
// Bloqueos: qué falta para poder calcular
// ---------------------------------------------------------------------------

export type DesignField =
  | 'gasKey'
  | 'm_dot'
  | 'P01'
  | 'T01'
  | 'N'
  | 'R'
  | 'rowConfiguration'
  | 'coefficients'
  | 'shaftTarget'
  | 'Rm';

export interface DesignBlocker {
  field: DesignField;
  message: string;
  /** Índice de la etapa a la que se refiere, si es un campo de etapa. */
  stageIndex?: number;
}

/** Campos que solo se resuelven lanzando el barrido (no impiden barrer). */
export const SWEEP_RESOLVED_FIELDS: readonly DesignField[] = ['coefficients', 'shaftTarget', 'Rm'];

/**
 * Lista concreta de lo que impide calcular el diseño. Vacía = el diseño está listo.
 * Los mensajes están pensados para mostrarse tal cual en la lista de comprobación.
 */
export function getDesignBlockers(state: Pick<DesignState, 'globalInputs' | 'stages' | 'editedFields'>): DesignBlocker[] {
  const blockers: DesignBlocker[] = [];
  const { globalInputs, stages } = state;

  if (!isGasKey(globalInputs.gasKey)) blockers.push({ field: 'gasKey', message: 'Elige el fluido de trabajo.' });
  if (!(globalInputs.m_dot > MIN_MASS_FLOW)) {
    blockers.push({ field: 'm_dot', message: 'El flujo másico ṁ debe ser mayor que 0,01 kg/s.' });
  }
  if (!(globalInputs.P01 >= MIN_P01_PA)) {
    blockers.push({ field: 'P01', message: 'La presión total P₀₁ debe ser de al menos 0,1 bar.' });
  }
  if (!(globalInputs.T01 >= MIN_T01_K)) {
    blockers.push({ field: 'T01', message: 'La temperatura total T₀₁ debe ser de al menos 250 K.' });
  }

  stages.forEach((stage, stageIndex) => {
    const label = stage.name || defaultStageName(stageIndex);
    if (!(stage.N > 0)) {
      blockers.push({ field: 'N', stageIndex, message: `${label}: falta la velocidad de giro N.` });
    }
    if (!isReactionSet(state, stage.id)) {
      blockers.push({ field: 'R', stageIndex, message: `${label}: define el grado de reacción R.` });
    } else if (!(stage.R >= 0 && stage.R <= MAX_REACTION)) {
      blockers.push({ field: 'R', stageIndex, message: `${label}: R debe estar entre 0 y 0,85.` });
    }
    if (stageIndex === 0 && stage.rowConfiguration === 'counterrotating') {
      blockers.push({
        field: 'rowConfiguration',
        stageIndex,
        message: 'La primera etapa no puede ser contrarrotativa: necesita estator.',
      });
    }
    const hasLoading = (stage.psiTarget !== undefined && stage.psiTarget > 0) || stage.PR > 1;
    if (!hasLoading || !(stage.phi > 0)) {
      blockers.push({
        field: 'coefficients',
        stageIndex,
        message: `${label}: faltan φ y ψ; se obtienen con el barrido de esta etapa.`,
      });
    }
  });

  if (stages.some((stage) => !(stage.Rm > 0))) {
    for (const group of groupStagesByShaft(stages)) {
      if (group.targetMW === undefined) {
        blockers.push({
          field: 'shaftTarget',
          stageIndex: group.stageIndices[0],
          message: `${group.name}: asigna la potencia objetivo del eje (la necesita el barrido).`,
        });
      }
    }
    blockers.push({ field: 'Rm', message: 'Pulsa Barrer para calcular el radio medio.' });
  }

  return blockers;
}

// ---------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------

export interface SerializedDesign extends DesignState {
  v: typeof DESIGN_STATE_VERSION;
  /**
   * Ecuaciones activas del autor al compartir o exportar: null si eran las de por defecto.
   * No aparece en el autoguardado ni en diseños de versiones anteriores.
   */
  customEquations?: CustomEquationsConfig | null;
}

/** Diseño leído junto con las ecuaciones que lo acompañan. */
export interface DesignPayload {
  design: DesignState;
  /**
   * undefined: el diseño no dice con qué ecuaciones se calculó (autoguardado o versión anterior);
   * null: el autor usaba las de por defecto; objeto: las del autor, ya normalizadas.
   */
  customEquations?: CustomEquationsConfig | null;
}

/**
 * JSON del diseño. Con `customEquations` (enlace y fichero) incluye también las ecuaciones activas,
 * para que quien lo abra obtenga los mismos resultados.
 */
export function serializeDesign(state: DesignState, customEquations?: CustomEquationsConfig): string {
  const payload: SerializedDesign = {
    v: DESIGN_STATE_VERSION,
    name: state.name,
    globalInputs: state.globalInputs,
    stages: state.stages,
    lossModel: state.lossModel,
    sweepRanges: state.sweepRanges,
    requireTwoDimensionalFlow: state.requireTwoDimensionalFlow,
    editedFields: state.editedFields,
  };
  if (customEquations !== undefined) payload.customEquations = checkIfModified(customEquations) ? customEquations : null;
  return JSON.stringify(payload);
}

/**
 * Si el diseño usa el modelo de pérdidas propio y esas ecuaciones no lo tienen activo, el motor
 * calcularía con Soderberg: se pasa a Soderberg de forma explícita para que la etiqueta no engañe.
 */
export function withAvailableLossModel(
  state: DesignState,
  customEquations: CustomEquationsConfig,
): { design: DesignState; downgraded: boolean } {
  if (customEquations.userDefinedLoss.enabled) return { design: state, downgraded: false };
  const stageUsesUserLoss = state.stages.some((stage) => stage.lossModel === 'user_defined');
  if (state.lossModel !== 'user_defined' && !stageUsesUserLoss) return { design: state, downgraded: false };
  return {
    design: {
      ...state,
      lossModel: state.lossModel === 'user_defined' ? 'soderberg' : state.lossModel,
      stages: state.stages.map((stage) => (
        stage.lossModel === 'user_defined' ? { ...stage, lossModel: undefined } : stage
      )),
    },
    downgraded: true,
  };
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const MAX_NAME_LENGTH = 80;

function readName(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return null;
  return value.slice(0, MAX_NAME_LENGTH);
}

function readGlobalInputs(value: unknown): GlobalInputs | null {
  if (!isRecord(value)) return null;
  const { m_dot, P01, T01, gasKey } = value;
  if (!isFiniteNumber(m_dot) || !isFiniteNumber(P01) || !isFiniteNumber(T01)) return null;
  if (m_dot < 0 || P01 < 0 || T01 < 0) return null;
  if (gasKey !== '' && !isGasKey(gasKey)) return null;
  return { m_dot, P01, T01, gasKey };
}

function optionalFiniteNumber(value: unknown): { ok: boolean; value?: number } {
  if (value === undefined || value === null) return { ok: true };
  return isFiniteNumber(value) ? { ok: true, value } : { ok: false };
}

function readStage(value: unknown, index: number): StageConfig | null {
  if (!isRecord(value)) return null;
  const { id, name, rowConfiguration, shaftName, PR, N, direction, Rm, R, phi, turbineType, interStageCoupling, lossModel } = value;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
  const stageName = readName(name, defaultStageName(index));
  if (stageName === null) return null;
  if (rowConfiguration !== undefined && rowConfiguration !== 'normal' && rowConfiguration !== 'counterrotating') return null;
  if (shaftName !== undefined && (typeof shaftName !== 'string' || shaftName.length > MAX_NAME_LENGTH)) return null;
  if (!isFiniteNumber(PR) || !isFiniteNumber(N) || !isFiniteNumber(Rm) || !isFiniteNumber(R) || !isFiniteNumber(phi)) return null;
  if (N < 0 || Rm < 0 || PR < 0 || phi < 0) return null;
  if (direction !== 1 && direction !== -1) return null;
  if (turbineType !== 'axial' && turbineType !== 'radial') return null;
  if (interStageCoupling !== undefined && interStageCoupling !== 'vaneless' && interStageCoupling !== 'vaned') return null;
  if (lossModel !== undefined && !LOSS_MODELS.includes(lossModel as LossModel)) return null;
  const target = optionalFiniteNumber(value.shaftTargetPowerMW);
  const psiTarget = optionalFiniteNumber(value.psiTarget);
  if (!target.ok || !psiTarget.ok) return null;

  const stage: StageConfig = {
    id,
    name: stageName,
    rowConfiguration: rowConfiguration ?? 'normal',
    shaftName: shaftName ?? 'Eje 1',
    PR,
    N,
    direction,
    Rm,
    R,
    phi,
    turbineType,
  };
  if (target.value !== undefined && target.value > 0) stage.shaftTargetPowerMW = target.value;
  if (psiTarget.value !== undefined && psiTarget.value > 0) stage.psiTarget = psiTarget.value;
  if (interStageCoupling !== undefined) stage.interStageCoupling = interStageCoupling;
  if (lossModel !== undefined) stage.lossModel = lossModel as LossModel;
  return stage;
}

/** Rangos del barrido: un valor fuera de los límites de la interfaz vuelve a su valor por defecto. */
function readSweepRanges(value: unknown): SweepRanges {
  const ranges = { ...DEFAULT_SWEEP_RANGES };
  if (!isRecord(value)) return ranges;
  for (const key of Object.keys(DEFAULT_SWEEP_RANGES) as (keyof SweepRanges)[]) {
    const candidate = value[key];
    const { min, max } = SWEEP_RANGE_LIMITS[key];
    if (isFiniteNumber(candidate) && candidate >= min && candidate <= max) ranges[key] = candidate;
  }
  ranges.points = Math.round(ranges.points);
  if (!(ranges.phiMax > ranges.phiMin)) {
    ranges.phiMin = DEFAULT_SWEEP_RANGES.phiMin;
    ranges.phiMax = DEFAULT_SWEEP_RANGES.phiMax;
  }
  if (!(ranges.psiMax > ranges.psiMin)) {
    ranges.psiMin = DEFAULT_SWEEP_RANGES.psiMin;
    ranges.psiMax = DEFAULT_SWEEP_RANGES.psiMax;
  }
  return ranges;
}

/**
 * Valida y reconstruye un diseño guardado. Acepta el texto JSON o el objeto ya analizado.
 * Devuelve null si el JSON está corrupto, la versión no es conocida o algún campo esencial
 * no tiene el tipo esperado. Los campos opcionales que falten toman su valor por defecto.
 */
export function deserializeDesign(input: unknown): DesignState | null {
  return parseDesignPayload(input)?.design ?? null;
}

/** Como deserializeDesign, pero devuelve también las ecuaciones que viajan con el diseño. */
export function parseDesignPayload(input: unknown): DesignPayload | null {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!isRecord(raw) || raw.v !== DESIGN_STATE_VERSION) return null;

  const globalInputs = readGlobalInputs(raw.globalInputs);
  if (!globalInputs) return null;

  if (!Array.isArray(raw.stages) || raw.stages.length === 0 || raw.stages.length > MAX_STAGES) return null;
  const stages: StageConfig[] = [];
  for (const [index, item] of raw.stages.entries()) {
    const stage = readStage(item, index);
    if (!stage) return null;
    stages.push(stage);
  }
  const storedEditedFields = Array.isArray(raw.editedFields)
    ? raw.editedFields.filter((field): field is string => typeof field === 'string')
    : null;
  const editedFields = new Set<string>();

  // Ids duplicados romperían la fusión del barrido: se regeneran.
  const seen = new Set<string>();
  stages.forEach((stage, index) => {
    const originalId = stage.id;
    if (seen.has(originalId)) stages[index] = { ...stage, id: createStageId() };
    const id = stages[index].id;
    seen.add(id);
    // Sin lista guardada, se asume que el autor definió R en todas las etapas.
    if (storedEditedFields === null || storedEditedFields.includes(reactionKey(originalId))) {
      editedFields.add(reactionKey(id));
    }
  });

  const lossModel = raw.lossModel === undefined ? 'soderberg' : raw.lossModel;
  if (!LOSS_MODELS.includes(lossModel as LossModel)) return null;

  const name = readName(raw.name, DEFAULT_DESIGN_NAME);
  if (name === null) return null;

  if (raw.requireTwoDimensionalFlow !== undefined && typeof raw.requireTwoDimensionalFlow !== 'boolean') return null;

  const design: DesignState = {
    name: name || DEFAULT_DESIGN_NAME,
    globalInputs,
    stages,
    lossModel: lossModel as LossModel,
    sweepRanges: readSweepRanges(raw.sweepRanges),
    requireTwoDimensionalFlow: raw.requireTwoDimensionalFlow === true,
    editedFields: [...editedFields],
  };
  const payload: DesignPayload = { design };
  if (raw.customEquations === null) payload.customEquations = null;
  else if (isRecord(raw.customEquations)) payload.customEquations = normalizeCustomEquations(raw.customEquations);
  return payload;
}

// ---------------------------------------------------------------------------
// Enlace para compartir (base64url del JSON en UTF-8)
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(token: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(token)) return null;
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeDesignToken(state: DesignState, customEquations?: CustomEquationsConfig): string {
  return bytesToBase64Url(new TextEncoder().encode(serializeDesign(state, customEquations)));
}

export function decodeDesignPayload(token: string): DesignPayload | null {
  const bytes = base64UrlToBytes(token.trim());
  if (!bytes) return null;
  try {
    return parseDesignPayload(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

export function decodeDesignToken(token: string): DesignState | null {
  return decodeDesignPayload(token)?.design ?? null;
}

/** Lee el diseño (y sus ecuaciones) de un hash del tipo «#d=…». Null si no hay o no es válido. */
export function readDesignPayloadFromHash(hash: string): DesignPayload | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null;
  return decodeDesignPayload(hash.slice(SHARE_HASH_PREFIX.length));
}

/** Lee un diseño de un hash del tipo «#d=…». Devuelve null si no hay o no es válido. */
export function readDesignFromHash(hash: string): DesignState | null {
  return readDesignPayloadFromHash(hash)?.design ?? null;
}

export function buildShareUrl(state: DesignState, base: string, customEquations?: CustomEquationsConfig): string {
  return `${base}${SHARE_HASH_PREFIX}${encodeDesignToken(state, customEquations)}`;
}
