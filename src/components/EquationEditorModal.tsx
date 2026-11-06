import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Compass,
  Download,
  FileCode,
  Flame,
  Folder,
  FolderOpen,
  Gauge,
  Info,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sigma,
  Sliders,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Wind,
  X,
} from 'lucide-react';
import Modal from './ui/Modal';
import NumberField from './ui/NumberField';
import {downloadBlob} from '../utils/download';
import {
  EQUATION_CATALOG,
  EQUATION_TEMPLATES,
  SAFE_DEFAULT_EQUATIONS,
  checkIfModified,
  normalizeCustomEquations,
  normalizeCustomEquationsReport,
  safeEvaluateMath,
  type CustomEquationsConfig,
  type EquationEvaluationContext,
  type EquationNode,
} from '../utils/customEquations';

// ---------------------------------------------------------------------------
// Tipos y constantes
// ---------------------------------------------------------------------------

type Config = CustomEquationsConfig;
type CategoryId = EquationNode['category'];
type EditableType = NonNullable<EquationNode['editableType']>;
type ResettableType = Exclude<EditableType, 'sandbox'>;
type UserEquation = Config['userEquations'][number];
type Scope = Record<string, number>;

/** Subsecciones de la configuración cuyo valor es un objeto de parámetros. */
type SectionKey =
  | 'soderberg'
  | 'ainleyMathieson'
  | 'sizing'
  | 'zweifel'
  | 'thermodynamics'
  | 'kinematics'
  | 'geometry'
  | 'userDefinedLoss';

type NumericKeys<T> = {[P in keyof T]-?: T[P] extends number ? P : never}[keyof T];
type StringKeys<T> = {[P in keyof T]-?: T[P] extends string ? P : never}[keyof T];

interface SavedEquationProfile {
  id: string;
  name: string;
  config: Config;
}

interface UndoState {
  message: string;
  previousConfig: Config;
  previousDraft: Config;
}

interface Notice {
  tone: 'ok' | 'warn' | 'danger';
  text: string;
}

interface EquationEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Configuración aplicada al cálculo. */
  config: CustomEquationsConfig;
  /** Aplica (y persiste) una configuración nueva. Solo se llama al pulsar «Aplicar», al restablecer o al deshacer. */
  onSaveConfig: (newConfig: CustomEquationsConfig) => void;
  /** Valores de la etapa activa para la vista previa; null si todavía no hay un diseño calculado. */
  evalContext: EquationEvaluationContext | null;
  currentStageName: string;
}

const PROFILES_STORAGE_KEY = 'axial-turbine.equation-profiles.v1';
const MAX_IMPORT_BYTES = 256 * 1024;
const UNDO_WINDOW_MS = 6000;
const PREVIEW_DEBOUNCE_MS = 300;

const SECTION_BY_TYPE: Record<ResettableType, SectionKey> = {
  soderberg: 'soderberg',
  ainley: 'ainleyMathieson',
  sizing: 'sizing',
  zweifel: 'zweifel',
  thermo: 'thermodynamics',
  kinematics: 'kinematics',
  geometry: 'geometry',
  user_loss: 'userDefinedLoss',
};

interface CategoryMeta {
  id: CategoryId;
  name: string;
  icon: ComponentType<{className?: string}>;
}

const CATEGORIES: CategoryMeta[] = [
  {id: 'thermodynamics', name: 'Termodinámica y expansión', icon: Flame},
  {id: 'kinematics', name: 'Cinemática y triángulos de velocidades', icon: Wind},
  {id: 'geometry', name: 'Geometría y canal meridional', icon: Compass},
  {id: 'losses', name: 'Modelos de pérdidas', icon: Gauge},
  {id: 'sandbox', name: 'Fórmulas libres y pruebas', icon: Code2},
];

const CATEGORY_NAME: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((category) => [category.id, category.name]),
) as Record<CategoryId, string>;

// Valores de prueba para validar las expresiones mientras se escriben. Cada ámbito replica las
// variables que el solver pasa a esa expresión (turbine1D / customEquations), así que sus claves son
// también la lista de variables que se muestra al usuario. Ángulos en radianes.
// Soderberg: row vale 0 en el estator y 1 en el rotor; tc es t/c.
const SODERBERG_TEST_SCOPE: Scope = {eps: 35, AR: 2.2, row: 1, tc: 0.2};

type AinleyExpressionKey = 'customYpExpression' | 'customYpStatorExpression' | 'customYsExpression' | 'customYtcExpression';

const AINLEY_TEST_SCOPES: Record<AinleyExpressionKey, Scope> = {
  // Perfil del rotor.
  customYpExpression: {
    Yp_base: 0.08,
    Yp_nozzle: 0.05,
    Yp_impulse: 0.1,
    xi: 0.5,
    xi_signed: 0.5,
    t_over_c: 0.2,
    s_over_c: 0.8,
    beta1: 0.25,
    beta2: -0.9,
    AR: 2,
    nozzleA: 0.025,
    nozzleB: 0.065,
    impulseA: 0.075,
    impulseB: 0.165,
  },
  // Perfil del estator.
  customYpStatorExpression: {
    Yp_base: 0.05,
    Yp_nozzle: 0.046,
    Yp_impulse: 0.12,
    xi: 0.2,
    xi_signed: 0.2,
    nozzleA: 0.025,
    nozzleB: 0.065,
    impulseA: 0.075,
    impulseB: 0.165,
    abs_alpha1: 60,
    alpha0: -0.2,
    alpha1: 1.05,
    s_over_c: 0.8,
    t_over_c: 0.2,
    AR: 2,
  },
  // Se evalúa en las dos filas: solo variables comunes (en el estator b1 = α0, b2 = α1, bm = α_m).
  customYsExpression: {secondaryCoeff: 0.033, AR: 2, lambda: 0.0165, CL_sc: 0.8, b1: 0.25, b2: -0.9, bm: -0.35},
  // Holgura de punta del rotor.
  customYtcExpression: {
    B_tip: 0.5,
    tipClearanceRatio: 0.015,
    secondaryCoeff: 0.033,
    AR: 2,
    CL_sc: 0.8,
    beta1: 0.25,
    beta2: -0.9,
    beta_m: -0.35,
    b1: 0.25,
    b2: -0.9,
    bm: -0.35,
  },
};

const SIZING_TEST_SCOPE: Scope = {Area: 0.005, Area_ideal: 0.005, effectiveArea: 0.005, blockage: 0.02, Rm: 0.1};

const ZWEIFEL_TEST_SCOPE: Scope = {s: 25, c_ax: 38, b1_rad: 0.3, b2_rad: 0.5, b1: 0.3, b2: 0.5, psi_Z: 0.85};

const YS_PLACEHOLDER =
  '(secondaryCoeff / AR) * Math.pow(CL_sc, 2) * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3)) * (Math.cos(b2) / Math.cos(b1))';

const DEFAULT_SANDBOX_EXPRESSION = '0.04 + 0.06 * Math.pow(eps / 100, 2) * (0.975 + 0.075 / AR)';

// ---------------------------------------------------------------------------
// Utilidades puras
// ---------------------------------------------------------------------------

const cloneConfig = (config: Config): Config => structuredClone(config);

const sameConfig = (a: Config, b: Config): boolean => JSON.stringify(a) === JSON.stringify(b);

const sameSection = <K extends keyof Config>(config: Config, key: K): boolean =>
  JSON.stringify(config[key]) === JSON.stringify(SAFE_DEFAULT_EQUATIONS[key]);

function patchSection<K extends SectionKey>(config: Config, key: K, patch: Partial<Config[K]>): Config {
  const next = {...config};
  next[key] = {...config[key], ...patch};
  return next;
}

function resetSection(config: Config, type: ResettableType): Config {
  const key = SECTION_BY_TYPE[type];
  const next = patchSection(config, key, structuredClone(SAFE_DEFAULT_EQUATIONS[key]));
  return {...next, isModified: checkIfModified(next)};
}

const SODERBERG_NUMERIC_KEYS = (Object.keys(SAFE_DEFAULT_EQUATIONS.soderberg) as (keyof Config['soderberg'])[]).filter(
  (key) => typeof SAFE_DEFAULT_EQUATIONS.soderberg[key] === 'number',
);

/** Misma condición que usa el solver para decidir si Soderberg sale de la correlación de referencia. */
function isSoderbergCustom(soderberg: Config['soderberg']): boolean {
  if (!soderberg.enabled) return false;
  if (soderberg.useCustomFormula) return true;
  return SODERBERG_NUMERIC_KEYS.some((key) => soderberg[key] !== SAFE_DEFAULT_EQUATIONS.soderberg[key]);
}

function isCategoryModified(config: Config, category: CategoryId): boolean {
  switch (category) {
    case 'thermodynamics':
      return !sameSection(config, 'thermodynamics');
    case 'kinematics':
      return !sameSection(config, 'kinematics');
    case 'geometry':
      return !sameSection(config, 'sizing') || !sameSection(config, 'zweifel') || !sameSection(config, 'geometry');
    case 'losses':
      return (
        isSoderbergCustom(config.soderberg) ||
        !sameSection(config, 'ainleyMathieson') ||
        !sameSection(config, 'userDefinedLoss')
      );
    case 'sandbox':
      return config.userEquations.length > 0;
  }
}

function getExpressionError(expression: unknown, scope: Scope, fallback: number): string | null {
  if (typeof expression !== 'string') return 'La expresión no es texto.';
  if (!expression.trim()) return 'La expresión está vacía.';
  return safeEvaluateMath(expression, scope, fallback).error;
}

function formatDefault(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '—';
}

function variableList(scope: Scope): string {
  return Object.keys(scope).join(', ');
}

function buildBasicScope(ctx: EquationEvaluationContext): Scope {
  return {
    eps: ctx.eps_deg,
    AR: ctx.aspectRatio,
    turning: ctx.eps_deg,
    Rm: ctx.Rm_m,
    U: ctx.U_ms,
    Va: ctx.Va_ms,
    PR: ctx.PR,
    m_dot: ctx.m_dot,
  };
}

function buildUserEquationScope(ctx: EquationEvaluationContext): Scope {
  return {
    ...buildBasicScope(ctx),
    phi: ctx.flowCoeff_phi,
    beta1: ctx.beta1_deg,
    beta2: ctx.beta2_deg,
    Mach: ctx.Mach_abs1,
    MachRel: ctx.Mach_rel1,
    dh_is_kJkg: ctx.dh0_kJkg,
    eta_tt: ctx.eta_tt,
  };
}

const USER_LOSS_VARIABLES = [
  'dh_is', 'dh_actual', 'dh_loss_stator', 'dh_loss_rotor', 'dh_loss_soderberg', 'dh_loss_ainley',
  'Mach', 'MachRel', 'MachRel2', 'U', 'Va', 'V1', 'W1', 'V2', 'W2', 'AR', 'eps', 'phi', 'psi', 'PR',
  'm_dot', 'P01', 'T01', 'gamma', 'zeta_N', 'zeta_R', 'Yp_rotor', 'Ys_rotor', 'Ytc_rotor',
] as const;

function buildUserLossScope(ctx: EquationEvaluationContext): Scope {
  return {
    dh_is: ctx.dh_is_Jkg,
    dh_actual: ctx.dh0_kJkg * 1000,
    dh_loss_stator: ctx.dh_loss_stator_Jkg,
    dh_loss_rotor: ctx.dh_loss_rotor_Jkg,
    dh_loss_soderberg: ctx.dh_loss_soderberg_Jkg,
    dh_loss_ainley: ctx.dh_loss_ainley_Jkg,
    Mach: ctx.Mach_abs1,
    MachRel: ctx.Mach_rel1,
    MachRel2: ctx.Mach_rel2,
    U: ctx.U_ms,
    Va: ctx.Va_ms,
    V1: ctx.V1_ms,
    W1: ctx.W1_ms,
    V2: ctx.V2_ms,
    W2: ctx.W2_ms,
    AR: ctx.aspectRatio,
    eps: ctx.eps_deg,
    phi: ctx.flowCoeff_phi,
    psi: ctx.stageLoading_psi,
    PR: ctx.PR,
    m_dot: ctx.m_dot,
    P01: ctx.P01_bar * 1e5,
    T01: ctx.T01_K,
    gamma: ctx.gamma,
    zeta_N: ctx.zeta_N,
    zeta_R: ctx.zeta_R,
    Yp_rotor: ctx.Yp_rotor,
    Ys_rotor: ctx.Ys_rotor,
    Ytc_rotor: ctx.Ytc_rotor,
  };
}

/** Valores de muestra (todos distintos y no nulos) para validar la sintaxis cuando aún no hay diseño. */
const USER_LOSS_SAMPLE_SCOPE: Scope = Object.fromEntries(
  USER_LOSS_VARIABLES.map((name, index) => [name, 1 + 0.137 * (index + 1)]),
);

function isStoredProfile(value: unknown): value is {id: string; name: string; config: unknown} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' && !!record.config && typeof record.config === 'object';
}

function loadSavedProfiles(): SavedEquationProfile[] {
  try {
    const stored = localStorage.getItem(PROFILES_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isStoredProfile)
      .map((profile) => ({id: profile.id, name: profile.name, config: normalizeCustomEquations(profile.config)}));
  } catch {
    return [];
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Controles reutilizables
// ---------------------------------------------------------------------------

const TEXTAREA_CLASS =
  'w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 font-mono text-base text-ink placeholder:text-ink-3 sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent';

interface ExpressionFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** undefined: sin validación visible; null: válida; string: mensaje de error. */
  error?: string | null;
  hint?: ReactNode;
  multiline?: boolean;
  rows?: number;
  className?: string;
}

function ExpressionField({label, value, onChange, placeholder, error, hint, multiline = false, rows = 2, className = ''}: ExpressionFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const messageId = `${id}-message`;
  const describedBy = [hint ? hintId : null, error !== undefined ? messageId : null].filter(Boolean).join(' ') || undefined;
  const invalid = typeof error === 'string';
  const invalidRing = invalid ? 'ring-2 ring-rose-300' : '';

  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-label font-medium text-ink-2">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={`${TEXTAREA_CLASS} ${invalidRing}`}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className={`field w-full font-mono max-sm:h-10 max-sm:text-base ${invalidRing}`}
        />
      )}
      {hint && (
        <div id={hintId} className="text-caption text-ink-3">
          {hint}
        </div>
      )}
      {error !== undefined && (
        <p id={messageId} className={`text-caption ${invalid ? 'text-danger' : 'text-ok'}`}>
          {invalid ? `Expresión no válida: ${error}` : 'Expresión válida.'}
        </p>
      )}
    </div>
  );
}

function Toggle({checked, onChange, children}: {checked: boolean; onChange: (checked: boolean) => void; children: ReactNode}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-body font-medium text-ink-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
      />
      <span>{children}</span>
    </label>
  );
}

function VariableHint({scope, note}: {scope: Scope; note?: ReactNode}) {
  return (
    <p className="text-caption leading-relaxed text-ink-3">
      Admite aritmética y funciones <code className="font-mono text-ink-2">Math.*</code>. Variables:{' '}
      <code className="font-mono text-ink-2">{variableList(scope)}</code>.{note ? <> {note}</> : null}
    </p>
  );
}

interface ParamSpec<K extends SectionKey> {
  key: NumericKeys<Config[K]>;
  label: string;
  symbol?: string;
  unit?: string;
  hint?: string;
  min?: number;
  max?: number;
  step: number;
}

interface SectionNumberFieldsProps<K extends SectionKey> {
  section: K;
  specs: ParamSpec<K>[];
  draft: Config;
  onPatch: (section: K, patch: Partial<Config[K]>) => void;
  className?: string;
}

function SectionNumberFields<K extends SectionKey>({section, specs, draft, onPatch, className = ''}: SectionNumberFieldsProps<K>) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 ${className}`}>
      {specs.map((spec) => {
        const raw: unknown = draft[section][spec.key];
        const value = typeof raw === 'number' ? raw : Number.NaN;
        const defaultValue: unknown = SAFE_DEFAULT_EQUATIONS[section][spec.key];
        return (
          <NumberField
            key={String(spec.key)}
            label={spec.label}
            symbol={spec.symbol}
            unit={spec.unit}
            value={value}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            hint={spec.hint}
            typical={`${formatDefault(defaultValue)} (por defecto)`}
            onChange={(next) => onPatch(section, {[spec.key]: next} as Partial<Config[K]>)}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Especificación de los parámetros numéricos
// ---------------------------------------------------------------------------

const SODERBERG_ZETA_SPECS: ParamSpec<'soderberg'>[] = [
  {key: 'a', label: 'Constante base', symbol: 'a', hint: 'Pérdida con deflexión nula.', min: 0, max: 0.2, step: 0.005},
  {key: 'b', label: 'Sensibilidad a la deflexión', symbol: 'b', hint: 'Peso del término (ε/100)^c.', min: 0, max: 0.3, step: 0.005},
  {key: 'c', label: 'Exponente de deflexión', symbol: 'c', hint: 'Forma de la curva frente a ε.', min: 0.5, max: 4, step: 0.1},
  {
    key: 'tk',
    label: 'Corrección por espesor',
    symbol: 't_k',
    hint: 'Se resta t_k·(t/c)/0,20. Con 0 no hay corrección.',
    min: 0,
    max: 0.05,
    step: 0.001,
  },
];

const SODERBERG_ROTOR_SPECS: ParamSpec<'soderberg'>[] = [
  {key: 'd', label: 'Intercepto', symbol: 'd', hint: 'Término independiente de AR.', min: 0.5, max: 1.5, step: 0.005},
  {key: 'e', label: 'Pendiente', symbol: 'e', hint: 'Penalización proporcional a 1/AR.', min: 0, max: 0.5, step: 0.005},
];

const SODERBERG_STATOR_SPECS: ParamSpec<'soderberg'>[] = [
  {key: 'dStator', label: 'Intercepto', symbol: 'd', hint: 'Término independiente de AR.', min: 0.5, max: 1.5, step: 0.005},
  {key: 'eStator', label: 'Pendiente', symbol: 'e', hint: 'Penalización proporcional a 1/AR.', min: 0, max: 0.5, step: 0.005},
];

const AINLEY_SPECS: ParamSpec<'ainleyMathieson'>[] = [
  {key: 'nozzleA', label: 'Tobera: constante', symbol: 'A_N', hint: 'Perfil de tobera pura (α₁ = 0).', min: 0, max: 0.1, step: 0.005},
  {key: 'nozzleB', label: 'Tobera: pendiente', symbol: 'B_N', hint: 'Crecimiento con el ángulo de salida.', min: 0, max: 0.3, step: 0.005},
  {key: 'impulseA', label: 'Impulso: constante', symbol: 'A_I', hint: 'Perfil de impulso puro (R = 0).', min: 0, max: 0.2, step: 0.005},
  {key: 'impulseB', label: 'Impulso: pendiente', symbol: 'B_I', hint: 'Crecimiento con el ángulo de salida.', min: 0, max: 0.4, step: 0.005},
  {key: 'secondaryCoeff', label: 'Coeficiente secundario', symbol: 'λ', hint: 'Pérdida secundaria ∝ λ/AR.', min: 0, max: 0.08, step: 0.001},
  {
    key: 'tipClearanceCoeff',
    label: 'Coeficiente de holgura de punta',
    symbol: 'B_tip',
    hint: '0,50 sin banda; 0,25 con banda; 0 anula la pérdida por holgura.',
    min: 0,
    max: 0.8,
    step: 0.05,
  },
];

const SIZING_SPECS: ParamSpec<'sizing'>[] = [
  {
    key: 'aspectRatioTarget',
    label: 'Relación de aspecto para la cuerda automática',
    symbol: 'h/c',
    hint: 'Se usa cuando no se indica una cuerda axial en Geometría.',
    min: 0.5,
    max: 8,
    step: 0.1,
  },
];

const ZWEIFEL_SPECS: ParamSpec<'zweifel'>[] = [
  {key: 'multiplier', label: 'Multiplicador de la ecuación', hint: 'Valor clásico de Zweifel: 2.', min: 0.1, max: 10, step: 0.1},
];

const THERMO_SPECS: ParamSpec<'thermodynamics'>[] = [
  {
    key: 'reheatFactorPerStage',
    label: 'Factor de recalentamiento por etapa',
    symbol: 'α_rh',
    hint: 'Compensa la divergencia de las isobaras en varias etapas. 0 lo desactiva.',
    min: 0,
    max: 0.05,
    step: 0.001,
  },
  {
    key: 'kineticEnergyCarryOverFraction',
    label: 'Recuperación cinética entre etapas',
    hint: 'Fracción de la energía cinética de salida aprovechada por la tobera siguiente.',
    min: 0,
    max: 0.8,
    step: 0.05,
  },
];

const KINEMATICS_SPECS: ParamSpec<'kinematics'>[] = [
  {
    key: 'eulerWorkMultiplier',
    label: 'Multiplicador del trabajo de Euler',
    hint: 'Corrección del trabajo específico (1 = Euler ideal).',
    min: 0.8,
    max: 1.05,
    step: 0.01,
  },
  {
    key: 'deHallerMin',
    label: 'Límite mínimo de De Haller',
    symbol: 'W₂/W₁',
    hint: 'Criterio clásico de desprendimiento: 0,72.',
    min: 0.6,
    max: 0.85,
    step: 0.01,
  },
];

const GEOMETRY_SPECS: ParamSpec<'geometry'>[] = [
  {
    key: 'freeVortexExponent',
    label: 'Exponente de vórtice radial',
    symbol: 'n',
    hint: 'Ley Vθ · rⁿ = cte. 1 = vórtice libre; 0 = remolino constante.',
    min: 0,
    max: 1.5,
    step: 0.1,
  },
];

// ---------------------------------------------------------------------------
// Árbol de ecuaciones accesible (patrón tree de WAI-ARIA)
// ---------------------------------------------------------------------------

interface CategoryGroup extends CategoryMeta {
  nodes: EquationNode[];
  subfolders: {title: string; nodes: EquationNode[]}[];
}

type TreeEntry = {kind: 'folder'; key: string; categoryId: CategoryId} | {kind: 'node'; key: string; categoryId: CategoryId; nodeId: string};

interface EquationTreeProps {
  groups: CategoryGroup[];
  isExpanded: (id: CategoryId) => boolean;
  onToggle: (id: CategoryId, expand?: boolean) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  modifiedCategories: ReadonlySet<CategoryId>;
  labelledBy: string;
}

function EquationTree({groups, isExpanded, onToggle, selectedId, onSelect, modifiedCategories, labelledBy}: EquationTreeProps) {
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const [focusedKey, setFocusedKey] = useState<string>(`node:${selectedId}`);

  const entries = useMemo<TreeEntry[]>(() => {
    const list: TreeEntry[] = [];
    groups.forEach((group) => {
      list.push({kind: 'folder', key: `folder:${group.id}`, categoryId: group.id});
      if (isExpanded(group.id)) {
        group.subfolders.forEach((subfolder) =>
          subfolder.nodes.forEach((node) =>
            list.push({kind: 'node', key: `node:${node.id}`, categoryId: group.id, nodeId: node.id}),
          ),
        );
      }
    });
    return list;
  }, [groups, isExpanded]);

  const activeKey = entries.some((entry) => entry.key === focusedKey) ? focusedKey : entries[0]?.key;

  const focusEntry = (key: string | undefined) => {
    if (!key) return;
    setFocusedKey(key);
    itemRefs.current.get(key)?.focus();
  };

  const registerRef = (key: string) => (element: HTMLLIElement | null) => {
    if (element) itemRefs.current.set(key, element);
    else itemRefs.current.delete(key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = entries.findIndex((entry) => entry.key === activeKey);
    const current = entries[index];
    if (!current) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        focusEntry(entries[Math.min(entries.length - 1, index + 1)]?.key);
        break;
      case 'ArrowUp':
        focusEntry(entries[Math.max(0, index - 1)]?.key);
        break;
      case 'Home':
        focusEntry(entries[0]?.key);
        break;
      case 'End':
        focusEntry(entries[entries.length - 1]?.key);
        break;
      case 'ArrowRight':
        if (current.kind === 'folder') {
          if (!isExpanded(current.categoryId)) onToggle(current.categoryId, true);
          else focusEntry(entries[index + 1]?.kind === 'node' ? entries[index + 1].key : undefined);
        }
        break;
      case 'ArrowLeft':
        if (current.kind === 'folder') {
          if (isExpanded(current.categoryId)) onToggle(current.categoryId, false);
        } else {
          focusEntry(`folder:${current.categoryId}`);
        }
        break;
      case 'Enter':
      case ' ':
        if (current.kind === 'folder') onToggle(current.categoryId);
        else onSelect(current.nodeId);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  return (
    <ul role="tree" aria-labelledby={labelledBy} onKeyDown={handleKeyDown} className="space-y-1.5">
      {groups.map((group) => {
        const expanded = isExpanded(group.id);
        const folderKey = `folder:${group.id}`;
        const Icon = group.icon;
        const FolderIcon = expanded ? FolderOpen : Folder;
        const modified = modifiedCategories.has(group.id);
        return (
          <li
            key={group.id}
            ref={registerRef(folderKey)}
            role="treeitem"
            aria-expanded={expanded}
            tabIndex={activeKey === folderKey ? 0 : -1}
            onFocus={(event) => {
              if (event.target === event.currentTarget) setFocusedKey(folderKey);
            }}
            className="group/folder rounded-lg border border-line bg-surface focus-visible:outline-none"
          >
            <div
              onClick={() => {
                setFocusedKey(folderKey);
                onToggle(group.id);
              }}
              className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 hover:bg-surface-sunken group-focus-visible/folder:outline-2 group-focus-visible/folder:outline-offset-[-2px] group-focus-visible/folder:outline-accent-strong"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {expanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                )}
                <FolderIcon className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="truncate text-label font-semibold text-ink">{group.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {modified && (
                  <span className="flex items-center" title="Con cambios respecto a los valores de referencia">
                    <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
                    <span className="sr-only">(con cambios)</span>
                  </span>
                )}
                <span className="rounded bg-surface-sunken px-1.5 text-caption tabular-nums text-ink-3">
                  {group.nodes.length}
                </span>
              </span>
            </div>

            {expanded && (
              <ul role="group" className="space-y-0.5 border-t border-line bg-surface-muted py-1 pl-4 pr-1">
                {group.subfolders.map((subfolder) => (
                  <li key={subfolder.title} role="none">
                    {group.subfolders.length > 1 && (
                      <span className="block px-2 pb-0.5 pt-1.5 text-caption font-medium text-ink-3" aria-hidden="true">
                        {subfolder.title}
                      </span>
                    )}
                    <ul role="none" className="space-y-0.5">
                      {subfolder.nodes.map((node) => {
                        const nodeKey = `node:${node.id}`;
                        const isSelected = node.id === selectedId;
                        return (
                          <li
                            key={node.id}
                            ref={registerRef(nodeKey)}
                            role="treeitem"
                            aria-selected={isSelected}
                            tabIndex={activeKey === nodeKey ? 0 : -1}
                            onFocus={() => setFocusedKey(nodeKey)}
                            onClick={() => {
                              setFocusedKey(nodeKey);
                              onSelect(node.id);
                            }}
                            className={`flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-strong ${
                              isSelected
                                ? 'bg-accent-soft font-semibold text-accent-strong ring-1 ring-cyan-300'
                                : 'text-ink-2 hover:bg-surface-sunken hover:text-ink'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <FileCode
                                className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-accent-strong' : 'text-ink-3'}`}
                                aria-hidden="true"
                              />
                              <span className="truncate text-label">{node.name}</span>
                            </span>
                            {node.editableType && (
                              <span className="shrink-0 rounded bg-surface-sunken px-1.5 text-caption text-ink-3">editable</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Modal principal
// ---------------------------------------------------------------------------

export function EquationEditorModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  evalContext,
  currentStageName,
}: EquationEditorModalProps) {
  const ids = useId();
  const treeLabelId = `${ids}-tree-label`;
  const searchId = `${ids}-search`;
  const mobileSelectId = `${ids}-mobile-select`;
  const profileSelectId = `${ids}-profile-select`;
  const profileNameId = `${ids}-profile-name`;
  const userEquationSelectId = `${ids}-user-equation`;
  const importInputRef = useRef<HTMLInputElement>(null);

  const [selectedEqId, setSelectedEqId] = useState<string>('thermo_state');
  const [draft, setDraft] = useState<Config>(() => cloneConfig(config));
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<CategoryId, boolean>>({
    thermodynamics: true,
    kinematics: true,
    geometry: true,
    losses: true,
    sandbox: true,
  });
  const [sandboxExpr, setSandboxExpr] = useState(DEFAULT_SANDBOX_EXPRESSION);
  const [sandboxResult, setSandboxResult] = useState<{value: number; error: string | null} | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [profileName, setProfileName] = useState(config.name);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedEquationProfile[]>(loadSavedProfiles);
  const [selectedUserEquationId, setSelectedUserEquationId] = useState('');

  // Sincroniza el borrador con la configuración aplicada: al abrir el modal, o cuando la
  // configuración cambia desde fuera y el borrador no tenía cambios pendientes.
  const [syncedConfig, setSyncedConfig] = useState(config);
  const [syncedOpen, setSyncedOpen] = useState(isOpen);
  if (config !== syncedConfig || isOpen !== syncedOpen) {
    const justOpened = isOpen && !syncedOpen;
    setSyncedConfig(config);
    setSyncedOpen(isOpen);
    if (justOpened || sameConfig(draft, syncedConfig)) {
      setDraft(cloneConfig(config));
      if (justOpened) {
        setProfileName(config.name);
        setNotice(null);
        setUndo(null);
      }
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(savedProfiles));
    } catch {
      // Sin almacenamiento disponible, los perfiles siguen en memoria durante la sesión.
    }
  }, [savedProfiles]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const isDirty = useMemo(() => !sameConfig(draft, config), [draft, config]);
  const isModifiedFromSafe = useMemo(() => checkIfModified(draft), [draft]);
  const previewDraft = useDebouncedValue(draft, PREVIEW_DEBOUNCE_MS);

  const selectedNode = useMemo(
    () => EQUATION_CATALOG.find((equation) => equation.id === selectedEqId) ?? EQUATION_CATALOG[0],
    [selectedEqId],
  );
  const editableType = selectedNode.editableType;

  const allGroups = useMemo<CategoryGroup[]>(
    () =>
      CATEGORIES.map((category) => {
        const nodes = EQUATION_CATALOG.filter((equation) => equation.category === category.id);
        return {...category, nodes, subfolders: groupBySubfolder(nodes)};
      }),
    [],
  );

  const query = searchQuery.trim().toLocaleLowerCase('es');
  const visibleGroups = useMemo<CategoryGroup[]>(() => {
    if (!query) return allGroups;
    return allGroups
      .map((group) => {
        const nodes = group.nodes.filter(
          (equation) =>
            equation.name.toLocaleLowerCase('es').includes(query) ||
            equation.asciiFormula.toLocaleLowerCase('es').includes(query) ||
            equation.description.toLocaleLowerCase('es').includes(query) ||
            equation.subfolder.toLocaleLowerCase('es').includes(query) ||
            equation.symbols.some(
              (symbol) =>
                symbol.symbol.toLocaleLowerCase('es').includes(query) || symbol.name.toLocaleLowerCase('es').includes(query),
            ),
        );
        return {...group, nodes, subfolders: groupBySubfolder(nodes)};
      })
      .filter((group) => group.nodes.length > 0);
  }, [allGroups, query]);

  const isExpanded = useMemo(
    () => (id: CategoryId) => (query ? true : expandedFolders[id]),
    [query, expandedFolders],
  );

  const modifiedCategories = useMemo(
    () => new Set(CATEGORIES.map((category) => category.id).filter((id) => isCategoryModified(draft, id))),
    [draft],
  );

  // Validación inmediata de cada expresión editable.
  const expressionErrors = useMemo(
    () => ({
      soderbergZeta: getExpressionError(draft.soderberg.customExpression, SODERBERG_TEST_SCOPE, 0.05),
      soderbergAr: getExpressionError(draft.soderberg.customArExpression, SODERBERG_TEST_SCOPE, 1),
      customYpExpression: getExpressionError(draft.ainleyMathieson.customYpExpression, AINLEY_TEST_SCOPES.customYpExpression, 0.08),
      customYpStatorExpression: getExpressionError(draft.ainleyMathieson.customYpStatorExpression, AINLEY_TEST_SCOPES.customYpStatorExpression, 0.05),
      customYsExpression: getExpressionError(draft.ainleyMathieson.customYsExpression, AINLEY_TEST_SCOPES.customYsExpression, 0.02),
      customYtcExpression: getExpressionError(draft.ainleyMathieson.customYtcExpression, AINLEY_TEST_SCOPES.customYtcExpression, 0.01),
      height: getExpressionError(draft.sizing.customHeightExpression, SIZING_TEST_SCOPE, 0.01),
      zweifel: getExpressionError(draft.zweifel.customZweifelExpression, ZWEIFEL_TEST_SCOPE, 0.85),
      userLoss: getExpressionError(
        draft.userDefinedLoss.lossFractionExpression,
        evalContext ? buildUserLossScope(evalContext) : USER_LOSS_SAMPLE_SCOPE,
        0,
      ),
    }),
    [draft.soderberg, draft.ainleyMathieson, draft.sizing, draft.zweifel, draft.userDefinedLoss, evalContext],
  );

  // Expresiones que el solver usaría ahora mismo para la ecuación seleccionada.
  const activeExpressionChecks = useMemo(() => {
    const checks: {label: string; error: string | null}[] = [];
    if (editableType === 'soderberg' && draft.soderberg.useCustomFormula) {
      checks.push({label: 'ζ₀', error: expressionErrors.soderbergZeta}, {label: 'Factor AR', error: expressionErrors.soderbergAr});
    }
    if (editableType === 'ainley' && draft.ainleyMathieson.useCustomFormula) {
      checks.push(
        {label: 'Yp rotor', error: expressionErrors.customYpExpression},
        {label: 'Yp estator', error: expressionErrors.customYpStatorExpression},
        {label: 'Ys', error: expressionErrors.customYsExpression},
        {label: 'Ytc', error: expressionErrors.customYtcExpression},
      );
    }
    if (editableType === 'sizing' && draft.sizing.useCustomHeightFormula) {
      checks.push({label: 'Altura h', error: expressionErrors.height});
    }
    if (editableType === 'zweifel' && draft.zweifel.useCustomZweifelFormula) {
      checks.push({label: 'Zweifel ψ(s)', error: expressionErrors.zweifel});
    }
    if (editableType === 'user_loss') {
      checks.push({label: 'f_loss', error: expressionErrors.userLoss});
    }
    return checks;
  }, [
    editableType,
    expressionErrors,
    draft.soderberg.useCustomFormula,
    draft.ainleyMathieson.useCustomFormula,
    draft.sizing.useCustomHeightFormula,
    draft.zweifel.useCustomZweifelFormula,
  ]);
  const hasInvalidExpression = activeExpressionChecks.some((check) => check.error !== null);

  const liveEvaluation = useMemo(() => {
    if (!evalContext) return null;
    try {
      return selectedNode.evaluate(evalContext, previewDraft);
    } catch {
      return {outputLabel: 'No se ha podido evaluar', outputValue: '—', unit: '', detail: 'Valores fuera de rango o divergencia numérica.'};
    }
  }, [selectedNode, evalContext, previewDraft]);

  const selectedUserEquation: UserEquation | undefined =
    draft.userEquations.find((equation) => equation.id === selectedUserEquationId) ?? draft.userEquations[0];
  const previewUserEquation = previewDraft.userEquations.find((equation) => equation.id === selectedUserEquation?.id);
  const userEquationEvaluation = useMemo(() => {
    if (!previewUserEquation || !evalContext) return null;
    return safeEvaluateMath(previewUserEquation.expression, buildUserEquationScope(evalContext), 0);
  }, [previewUserEquation, evalContext]);

  const userLossPreview = useMemo(() => {
    if (!evalContext) return null;
    const ctx = evalContext;
    const fallback = ctx.dh_is_Jkg > 0 ? (ctx.dh_loss_stator_Jkg + ctx.dh_loss_rotor_Jkg) / ctx.dh_is_Jkg : 0;
    return safeEvaluateMath(previewDraft.userDefinedLoss.lossFractionExpression, buildUserLossScope(ctx), fallback);
  }, [previewDraft.userDefinedLoss.lossFractionExpression, evalContext]);

  // --- Edición del borrador -------------------------------------------------

  const updateDraft = (updater: (previous: Config) => Config) => setDraft((previous) => updater(previous));

  const patchDraft = <K extends SectionKey>(section: K, patch: Partial<Config[K]>) =>
    updateDraft((previous) => patchSection(previous, section, patch));

  const setSectionString = <K extends SectionKey>(section: K, key: StringKeys<Config[K]>, value: string) =>
    patchDraft(section, {[key]: value} as Partial<Config[K]>);

  // --- Acciones ---------------------------------------------------------------

  const handleApply = () => {
    const applied: Config = {...draft, isModified: checkIfModified(draft)};
    setDraft(applied);
    onSaveConfig(applied);
    setNotice({tone: 'ok', text: 'Cambios aplicados al cálculo.'});
  };

  const discardAndClose = () => {
    setDraft(cloneConfig(config));
    setNotice(null);
    onClose();
  };

  const handleRequestClose = () => {
    if (isDirty && !window.confirm('Tienes cambios sin aplicar. ¿Cerrar y descartarlos?')) return;
    discardAndClose();
  };

  const handleResetAll = () => {
    const confirmed = window.confirm(
      '¿Restablecer todas las ecuaciones a los valores de referencia? Se aplicará al cálculo y se descartarán los cambios sin aplicar. Podrás deshacerlo durante unos segundos.',
    );
    if (!confirmed) return;
    const safe = cloneConfig(SAFE_DEFAULT_EQUATIONS);
    setUndo({message: 'Ecuaciones restablecidas a los valores de referencia.', previousConfig: config, previousDraft: draft});
    setDraft(safe);
    setProfileName(safe.name);
    setSelectedProfileId('');
    setNotice(null);
    onSaveConfig(safe);
  };

  const handleResetCurrentEquation = () => {
    if (!editableType || editableType === 'sandbox') return;
    // Se restablece la sección en lo aplicado y en el borrador por separado, para no aplicar
    // de rebote otros cambios pendientes del borrador.
    const applied = resetSection(config, editableType);
    const nextDraft = resetSection(draft, editableType);
    setUndo({
      message: `«${selectedNode.name}» restablecida a los valores de referencia.`,
      previousConfig: config,
      previousDraft: draft,
    });
    setDraft(nextDraft);
    onSaveConfig(applied);
  };

  const handleUndo = () => {
    if (!undo) return;
    setDraft(undo.previousDraft);
    onSaveConfig(undo.previousConfig);
    setUndo(null);
    setNotice({tone: 'ok', text: 'Se ha deshecho el restablecimiento.'});
  };

  const handleApplyTemplate = (templateId: string) => {
    const template = EQUATION_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const merged = cloneConfig({
      ...SAFE_DEFAULT_EQUATIONS,
      ...template.config,
      name: template.label,
      isModified: templateId !== 'default_safe',
    });
    setDraft(merged);
    setProfileName(template.label);
    setSelectedProfileId('');
    setNotice({tone: 'ok', text: `Plantilla «${template.label}» cargada en el borrador. Pulsa «Aplicar» para usarla.`});
  };

  const saveEquationProfile = () => {
    const name = profileName.trim();
    if (!name) {
      setNotice({tone: 'danger', text: 'Escribe un nombre para guardar la configuración.'});
      return;
    }
    const existing = savedProfiles.find((profile) => profile.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'));
    const profile: SavedEquationProfile = {
      id: existing?.id ?? `perfil-${Date.now()}`,
      name,
      config: normalizeCustomEquations({...draft, name}),
    };
    setSavedProfiles((previous) =>
      existing ? previous.map((item) => (item.id === existing.id ? profile : item)) : [...previous, profile],
    );
    setSelectedProfileId(profile.id);
    updateDraft((previous) => ({...previous, name}));
    setNotice({tone: 'ok', text: `Perfil «${name}» guardado en este navegador.`});
  };

  const loadEquationProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = savedProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    setDraft(normalizeCustomEquations(profile.config));
    setProfileName(profile.name);
    setNotice({tone: 'ok', text: `Perfil «${profile.name}» cargado en el borrador. Pulsa «Aplicar» para usarlo.`});
  };

  const deleteEquationProfile = () => {
    const profile = savedProfiles.find((item) => item.id === selectedProfileId);
    if (!profile || !window.confirm(`¿Eliminar el perfil «${profile.name}» de este navegador?`)) return;
    setSavedProfiles((previous) => previous.filter((item) => item.id !== profile.id));
    setSelectedProfileId('');
    setNotice({tone: 'ok', text: `Perfil «${profile.name}» eliminado.`});
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'});
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `ecuaciones-turbina-${date}.json`);
  };

  const handleImportJSON = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    // Se vacía para que volver a elegir el mismo fichero dispare otra vez el evento.
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setNotice({
        tone: 'danger',
        text: `El archivo ocupa ${Math.ceil(file.size / 1024)} KB y el máximo admitido es 256 KB.`,
      });
      return;
    }
    file
      .text()
      .then((text) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setNotice({tone: 'danger', text: 'El archivo no contiene un JSON válido.'});
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setNotice({tone: 'danger', text: 'El JSON debe ser un objeto con la configuración de ecuaciones.'});
          return;
        }
        const {config: imported, resetCount} = normalizeCustomEquationsReport(parsed);
        const next: Config = {...imported, isModified: checkIfModified(imported)};
        setDraft(next);
        setProfileName(next.name);
        setSelectedProfileId('');
        const resetText =
          resetCount === 0
            ? ''
            : resetCount === 1
              ? ' 1 campo con formato no válido se ha restablecido.'
              : ` ${resetCount} campos con formato no válido se han restablecido.`;
        setNotice({
          tone: resetCount > 0 ? 'warn' : 'ok',
          text: `Archivo «${file.name}» cargado en el borrador.${resetText} Pulsa «Aplicar» para usarlo.`,
        });
      })
      .catch(() => setNotice({tone: 'danger', text: 'No se ha podido leer el archivo.'}));
  };

  const testSandboxExpression = () => {
    if (!evalContext) return;
    setSandboxResult(safeEvaluateMath(sandboxExpr, buildBasicScope(evalContext), 0.05));
  };

  const addUserEquation = () => {
    const id = `ecuacion-${Date.now()}`;
    updateDraft((previous) => ({
      ...previous,
      userEquations: [
        ...previous.userEquations,
        {
          id,
          name: `Ecuación ${previous.userEquations.length + 1}`,
          expression: 'eta_tt',
          description: 'Expresión añadida por el usuario. No está conectada a ninguna ecuación del solver.',
        },
      ],
    }));
    setSelectedUserEquationId(id);
  };

  const updateUserEquation = (id: string, changes: Partial<UserEquation>) =>
    updateDraft((previous) => ({
      ...previous,
      userEquations: previous.userEquations.map((equation) => (equation.id === id ? {...equation, ...changes} : equation)),
    }));

  const deleteUserEquation = (id: string) =>
    updateDraft((previous) => ({
      ...previous,
      userEquations: previous.userEquations.filter((equation) => equation.id !== id),
    }));

  const toggleFolder = (id: CategoryId, expand?: boolean) =>
    setExpandedFolders((previous) => ({...previous, [id]: expand ?? !previous[id]}));

  const setAllFolders = (expand: boolean) =>
    setExpandedFolders({thermodynamics: expand, kinematics: expand, geometry: expand, losses: expand, sandbox: expand});

  // --- Render ------------------------------------------------------------------

  const statusBadge = isModifiedFromSafe ? (
    <span className="hidden items-center gap-1 rounded-full border border-amber-200 bg-warn-soft px-2.5 py-0.5 text-caption font-semibold text-warn sm:inline-flex">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Modificado
    </span>
  ) : (
    <span className="hidden items-center gap-1 rounded-full border border-emerald-200 bg-ok-soft px-2.5 py-0.5 text-caption font-semibold text-ok sm:inline-flex">
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Valores de referencia
    </span>
  );

  const footer = (
    <>
      <span className="mr-auto flex items-center gap-1.5 text-label" aria-live="polite">
        {isDirty ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-warn-soft px-2.5 py-0.5 font-semibold text-warn">
            <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" /> Cambios sin aplicar
          </span>
        ) : (
          <span className="text-ink-3">Sin cambios pendientes</span>
        )}
      </span>
      <button type="button" onClick={handleResetAll} className="btn-secondary text-danger">
        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restablecer todo
      </button>
      <button type="button" onClick={discardAndClose} className="btn-secondary">
        Cancelar
      </button>
      <button type="button" onClick={handleApply} disabled={!isDirty} className="btn-primary">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Aplicar
      </button>
    </>
  );

  return (
    <Modal
      open={isOpen}
      onClose={handleRequestClose}
      size="full"
      title={
        <span className="flex min-w-0 flex-col">
          <span>Ecuaciones y correlaciones</span>
          <span className="truncate text-label font-normal text-ink-3">
            Etapa en cálculo: <span className="font-medium text-ink-2">{currentStageName}</span>
          </span>
        </span>
      }
      headerActions={statusBadge}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* Plantillas, perfiles y archivos */}
        <section aria-label="Plantillas, perfiles y archivos" className="space-y-3 rounded-card border border-line bg-surface-muted p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-label font-semibold text-ink-2">
              <Sparkles className="h-4 w-4 text-warn" aria-hidden="true" /> Plantillas
            </span>
            {EQUATION_TEMPLATES.map((template) => {
              const active = draft.name === template.label;
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleApplyTemplate(template.id)}
                  title={template.description}
                  className={`min-h-9 rounded-lg border px-2.5 py-1 text-label ${
                    active
                      ? 'border-cyan-300 bg-accent-soft font-semibold text-accent-strong'
                      : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-sunken'
                  }`}
                >
                  {template.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor={profileSelectId} className="flex items-center gap-1.5 text-label font-medium text-ink-2">
                <Save className="h-4 w-4 text-accent" aria-hidden="true" /> Perfiles guardados
              </label>
              <select
                id={profileSelectId}
                value={selectedProfileId}
                onChange={(event) => loadEquationProfile(event.target.value)}
                className="field w-full max-sm:h-10 max-sm:text-base"
              >
                <option value="">Cargar un perfil…</option>
                {savedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor={profileNameId} className="text-label font-medium text-ink-2">
                Nombre de la configuración
              </label>
              <input
                id={profileNameId}
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Por ejemplo: Soderberg calibrado"
                className="field w-full max-sm:h-10 max-sm:text-base"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveEquationProfile} className="btn-secondary">
                <Save className="h-4 w-4" aria-hidden="true" /> Guardar perfil
              </button>
              <button type="button" onClick={deleteEquationProfile} disabled={!selectedProfileId} className="btn-secondary">
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar
              </button>
              <button type="button" onClick={handleExportJSON} className="btn-secondary">
                <Download className="h-4 w-4" aria-hidden="true" /> Exportar JSON
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()} className="btn-secondary">
                <Upload className="h-4 w-4" aria-hidden="true" /> Importar JSON
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportJSON}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </div>
          <p className="text-caption text-ink-3">
            Los perfiles se guardan en este navegador. Usa el JSON para llevarlos a otro equipo. Plantillas, perfiles e
            importaciones se cargan en el borrador: no cambian el cálculo hasta que pulses «Aplicar».
          </p>
        </section>

        {notice && (
          <div
            role={notice.tone === 'danger' ? 'alert' : 'status'}
            className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-label ${
              notice.tone === 'danger'
                ? 'border-rose-200 bg-danger-soft text-danger'
                : notice.tone === 'warn'
                  ? 'border-amber-200 bg-warn-soft text-warn'
                  : 'border-emerald-200 bg-ok-soft text-ok'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Cerrar el aviso"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface/60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {undo && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-label text-ink-2 shadow-card">
            <span>{undo.message}</span>
            <button type="button" onClick={handleUndo} className="btn-secondary">
              <Undo2 className="h-4 w-4" aria-hidden="true" /> Deshacer
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-6">
          {/* Selector de ecuación: árbol en escritorio, desplegable en móvil */}
          <div className="flex flex-col gap-1 lg:hidden">
            <label htmlFor={mobileSelectId} className="text-label font-medium text-ink-2">
              Ecuación
            </label>
            <select
              id={mobileSelectId}
              value={selectedNode.id}
              onChange={(event) => setSelectedEqId(event.target.value)}
              className="field h-10 w-full text-base"
            >
              {allGroups.map((group) => (
                <optgroup key={group.id} label={group.name}>
                  {group.nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                      {node.editableType ? ' (editable)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <aside className="hidden min-w-0 flex-col gap-2 lg:sticky lg:top-0 lg:flex lg:max-h-[calc(100dvh-11rem)] lg:self-start lg:overflow-y-auto">
            <h3 id={treeLabelId} className="text-body font-semibold text-ink">
              Árbol de ecuaciones
            </h3>
            <div className="relative">
              <label htmlFor={searchId} className="sr-only">
                Filtrar ecuaciones o variables
              </label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Filtrar ecuaciones o variables"
                autoComplete="off"
                className="field w-full pl-8 pr-8"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Borrar el filtro"
                  className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-sunken hover:text-ink"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 text-label">
              <button type="button" onClick={() => setAllFolders(true)} className="font-medium text-accent hover:text-accent-strong hover:underline">
                Expandir todo
              </button>
              <button type="button" onClick={() => setAllFolders(false)} className="font-medium text-accent hover:text-accent-strong hover:underline">
                Contraer todo
              </button>
            </div>
            {visibleGroups.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-muted px-3 py-4 text-center text-label text-ink-3">
                Ninguna ecuación coincide con el filtro.
              </p>
            ) : (
              <EquationTree
                groups={visibleGroups}
                isExpanded={isExpanded}
                onToggle={toggleFolder}
                selectedId={selectedNode.id}
                onSelect={setSelectedEqId}
                modifiedCategories={modifiedCategories}
                labelledBy={treeLabelId}
              />
            )}
          </aside>

          {/* Inspector de la ecuación seleccionada */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1 text-label text-ink-3">
                <span>{CATEGORY_NAME[selectedNode.category]}</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-medium text-accent-strong">{selectedNode.subfolder}</span>
              </nav>
              {editableType && editableType !== 'sandbox' && (
                <button
                  type="button"
                  onClick={handleResetCurrentEquation}
                  className="btn-secondary"
                  title="Restablece los parámetros de esta ecuación a los valores de referencia y lo aplica al cálculo"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restablecer esta ecuación
                </button>
              )}
            </div>

            <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-ink">{selectedNode.name}</h3>
                  <p className="mt-1 max-w-3xl text-body leading-relaxed text-ink-2">{selectedNode.description}</p>
                </div>
                <p className="max-w-full rounded-lg border border-line bg-surface-muted px-2.5 py-1 text-caption text-ink-3">
                  Referencia: <span className="font-medium text-ink-2">{selectedNode.theoreticalRef}</span>
                </p>
              </div>

              <figure className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-4">
                <figcaption className="flex items-center gap-1.5 text-label font-semibold text-ink-2">
                  <Sigma className="h-4 w-4 text-accent" aria-hidden="true" /> Formulación
                </figcaption>
                <div className="overflow-x-auto whitespace-pre-wrap break-words py-1 font-mono text-lg text-ink select-all">
                  {selectedNode.asciiFormula}
                </div>
              </figure>

              <div className="rounded-lg border border-line bg-surface p-3.5" aria-live="polite">
                <div className="mb-1.5 flex items-center gap-1.5 text-label font-semibold text-ink-2">
                  <Gauge className="h-4 w-4 text-accent" aria-hidden="true" /> Vista previa con el borrador
                </div>
                {!evalContext ? (
                  <p className="text-label text-ink-3">
                    Todavía no hay un diseño calculado. Carga el ejemplo o lanza el barrido para ver los valores de la etapa.
                  </p>
                ) : hasInvalidExpression ? (
                  <p className="text-label text-danger">
                    Hay expresiones no válidas; corrígelas para ver la vista previa. Mientras tanto, el solver usaría la fórmula
                    de respaldo.
                  </p>
                ) : liveEvaluation ? (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body text-ink-2">
                        {liveEvaluation.outputLabel}:{' '}
                        <span className="text-title font-semibold tabular-nums text-accent-strong">
                          {liveEvaluation.outputValue} {liveEvaluation.unit}
                        </span>
                      </p>
                      {liveEvaluation.detail && <p className="text-label text-ink-3">{liveEvaluation.detail}</p>}
                      {activeExpressionChecks.length > 0 && (
                        <p className="mt-1 flex items-center gap-1 text-caption text-ok">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {activeExpressionChecks.map((check) => check.label).join(', ')}: expresiones válidas
                        </p>
                      )}
                    </div>
                    <span className="text-caption text-ink-3">Etapa: {currentStageName}</span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-card border border-line bg-surface p-4 shadow-card">
              <h4 className="mb-2 flex items-center gap-1.5 text-body font-semibold text-ink">
                <Info className="h-4 w-4 text-accent" aria-hidden="true" /> Variables y unidades
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-label">
                  <caption className="sr-only">Símbolos de la ecuación «{selectedNode.name}»</caption>
                  <thead>
                    <tr className="border-b border-line text-caption text-ink-3">
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Símbolo
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Magnitud
                      </th>
                      <th scope="col" className="px-2 py-1.5 font-medium">
                        Unidad
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selectedNode.symbols.map((symbol) => (
                      <tr key={symbol.symbol}>
                        <th scope="row" className="whitespace-nowrap px-2 py-1.5 font-mono font-semibold text-accent-strong">
                          {symbol.symbol}
                        </th>
                        <td className="px-2 py-1.5 text-ink-2">{symbol.name}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-ink-3">{symbol.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {editableType && (
              <section className="flex flex-col gap-4 rounded-card border border-cyan-200 bg-surface p-4 shadow-card sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <h4 className="flex items-center gap-2 text-title font-semibold text-ink">
                    <Sliders className="h-4 w-4 text-accent" aria-hidden="true" /> Parámetros editables
                  </h4>
                  {editableType !== 'sandbox' && (
                    <span className="text-caption text-ink-3">Los cambios se aplican al cálculo al pulsar «Aplicar».</span>
                  )}
                </div>

                {editableType === 'soderberg' && (
                  <div className="flex flex-col gap-4">
                    <p
                      className={`self-start rounded-full border px-2.5 py-0.5 text-caption font-medium ${
                        isSoderbergCustom(draft.soderberg)
                          ? 'border-amber-200 bg-warn-soft text-warn'
                          : 'border-emerald-200 bg-ok-soft text-ok'
                      }`}
                    >
                      {isSoderbergCustom(draft.soderberg)
                        ? 'El solver usará la versión personalizada de Soderberg'
                        : 'El solver usará la correlación de referencia de Soderberg'}
                    </p>
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-body font-semibold text-ink-2">Pérdida nominal ζ₀ = a + b·(ε/100)^c − t_k·(t/c)/0,20</legend>
                      <SectionNumberFields section="soderberg" specs={SODERBERG_ZETA_SPECS} draft={draft} onPatch={patchDraft} />
                    </fieldset>
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <fieldset className="rounded-lg border border-line p-3">
                        <legend className="px-1 text-body font-semibold text-ink-2">Rotor: d, e</legend>
                        <SectionNumberFields
                          section="soderberg"
                          specs={SODERBERG_ROTOR_SPECS}
                          draft={draft}
                          onPatch={patchDraft}
                          className="xl:grid-cols-2"
                        />
                      </fieldset>
                      <fieldset className="rounded-lg border border-line p-3">
                        <legend className="px-1 text-body font-semibold text-ink-2">Estator: d, e</legend>
                        <SectionNumberFields
                          section="soderberg"
                          specs={SODERBERG_STATOR_SPECS}
                          draft={draft}
                          onPatch={patchDraft}
                          className="xl:grid-cols-2"
                        />
                      </fieldset>
                    </div>
                    <p className="text-caption text-ink-3">Factor de aspecto: 1 + ζ = (1 + ζ₀)·(d + e/AR), con d y e propios de cada fila.</p>

                    <div className="border-t border-line pt-3">
                      <Toggle
                        checked={draft.soderberg.useCustomFormula}
                        onChange={(checked) => patchDraft('soderberg', {useCustomFormula: checked})}
                      >
                        Usar expresiones propias para Soderberg
                      </Toggle>
                    </div>
                    {draft.soderberg.useCustomFormula && (
                      <div className="grid grid-cols-1 gap-3 rounded-lg border border-cyan-200 bg-surface-muted p-3 xl:grid-cols-2">
                        <ExpressionField
                          label="Expresión de ζ₀"
                          value={draft.soderberg.customExpression}
                          onChange={(value) => setSectionString('soderberg', 'customExpression', value)}
                          placeholder={SAFE_DEFAULT_EQUATIONS.soderberg.customExpression}
                          error={expressionErrors.soderbergZeta}
                        />
                        <ExpressionField
                          label="Expresión del factor de aspecto f(AR)"
                          value={draft.soderberg.customArExpression}
                          onChange={(value) => setSectionString('soderberg', 'customArExpression', value)}
                          placeholder={SAFE_DEFAULT_EQUATIONS.soderberg.customArExpression}
                          error={expressionErrors.soderbergAr}
                        />
                        <div className="xl:col-span-2">
                          <VariableHint scope={SODERBERG_TEST_SCOPE} note="row vale 0 en el estator y 1 en el rotor; tc es t/c." />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editableType === 'ainley' && (
                  <div className="flex flex-col gap-4">
                    <SectionNumberFields section="ainleyMathieson" specs={AINLEY_SPECS} draft={draft} onPatch={patchDraft} />
                    <div className="border-t border-line pt-3">
                      <Toggle
                        checked={draft.ainleyMathieson.useCustomFormula}
                        onChange={(checked) => patchDraft('ainleyMathieson', {useCustomFormula: checked})}
                      >
                        Usar expresiones propias en el modelo de Ainley-Mathieson
                      </Toggle>
                    </div>
                    {draft.ainleyMathieson.useCustomFormula && (
                      <div className="grid grid-cols-1 gap-3 rounded-lg border border-cyan-200 bg-surface-muted p-3 xl:grid-cols-2">
                        {(
                          [
                            ['customYpExpression', 'Pérdida de perfil del rotor (Yp)', SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYpExpression],
                            ['customYpStatorExpression', 'Pérdida de perfil del estator', SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYpStatorExpression],
                            ['customYsExpression', 'Pérdida secundaria (Ys)', YS_PLACEHOLDER],
                            ['customYtcExpression', 'Pérdida por holgura de punta (Ytc)', SAFE_DEFAULT_EQUATIONS.ainleyMathieson.customYtcExpression],
                          ] as const
                        ).map(([key, label, placeholder]) => (
                          <ExpressionField
                            key={key}
                            label={label}
                            value={draft.ainleyMathieson[key]}
                            onChange={(value) => setSectionString('ainleyMathieson', key, value)}
                            placeholder={placeholder}
                            error={expressionErrors[key]}
                            hint={<VariableHint scope={AINLEY_TEST_SCOPES[key]} />}
                          />
                        ))}
                        <p className="text-caption text-ink-3 xl:col-span-2">
                          Ángulos en radianes. Los resultados conservan los límites físicos de seguridad del solver.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {editableType === 'sizing' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3">
                      <NumberField
                        label="Bloqueo por capa límite"
                        symbol="K_bloqueo"
                        unit="%"
                        value={Number((draft.sizing.blockageFactor * 100).toFixed(4))}
                        min={0}
                        max={15}
                        step={0.5}
                        hint="A_efectiva = A / (1 − K). 0 % es el canal ideal."
                        typical="4 % en turbinas de gas; 8–15 % en microturbinas o Reynolds bajo"
                        onChange={(value) => patchDraft('sizing', {blockageFactor: value / 100})}
                      />
                      <input
                        type="range"
                        min={0}
                        max={0.15}
                        step={0.005}
                        value={draft.sizing.blockageFactor}
                        onChange={(event) => patchDraft('sizing', {blockageFactor: Number(event.target.value)})}
                        aria-label="Bloqueo por capa límite (control deslizante)"
                        className="w-full cursor-pointer accent-accent"
                      />
                    </div>
                    <SectionNumberFields section="sizing" specs={SIZING_SPECS} draft={draft} onPatch={patchDraft} />
                    <div className="border-t border-line pt-3">
                      <Toggle
                        checked={draft.sizing.useCustomHeightFormula}
                        onChange={(checked) => patchDraft('sizing', {useCustomHeightFormula: checked})}
                      >
                        Usar una ecuación propia para la altura del álabe (afecta al área y a la geometría)
                      </Toggle>
                    </div>
                    {draft.sizing.useCustomHeightFormula && (
                      <div className="rounded-lg border border-cyan-200 bg-surface-muted p-3">
                        <ExpressionField
                          label="h = f(Area, effectiveArea, blockage, Rm), en metros"
                          value={draft.sizing.customHeightExpression}
                          onChange={(value) => setSectionString('sizing', 'customHeightExpression', value)}
                          placeholder={SAFE_DEFAULT_EQUATIONS.sizing.customHeightExpression}
                          error={expressionErrors.height}
                          hint={<VariableHint scope={SIZING_TEST_SCOPE} />}
                        />
                      </div>
                    )}
                  </div>
                )}

                {editableType === 'zweifel' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3">
                      <NumberField
                        label="Coeficiente objetivo de Zweifel"
                        symbol="ψ_Z"
                        value={draft.zweifel.psi_Z_target}
                        min={0.6}
                        max={1.2}
                        step={0.01}
                        hint="0,60 muy sólido (conservador) · 0,85 óptimo clásico · 1,10 muy espaciado (riesgo alto)."
                        typical={`${formatDefault(SAFE_DEFAULT_EQUATIONS.zweifel.psi_Z_target)} (por defecto)`}
                        onChange={(value) => patchDraft('zweifel', {psi_Z_target: value})}
                      />
                      <input
                        type="range"
                        min={0.6}
                        max={1.2}
                        step={0.01}
                        value={draft.zweifel.psi_Z_target}
                        onChange={(event) => patchDraft('zweifel', {psi_Z_target: Number(event.target.value)})}
                        aria-label="Coeficiente objetivo de Zweifel (control deslizante)"
                        className="w-full cursor-pointer accent-accent"
                      />
                    </div>
                    <SectionNumberFields section="zweifel" specs={ZWEIFEL_SPECS} draft={draft} onPatch={patchDraft} />
                    <div className="border-t border-line pt-3">
                      <Toggle
                        checked={draft.zweifel.useCustomZweifelFormula}
                        onChange={(checked) => patchDraft('zweifel', {useCustomZweifelFormula: checked})}
                      >
                        Resolver el paso con una expresión propia
                      </Toggle>
                    </div>
                    {draft.zweifel.useCustomZweifelFormula && (
                      <div className="rounded-lg border border-cyan-200 bg-surface-muted p-3">
                        <ExpressionField
                          label="ψ_Z = f(s, c_ax, b1_rad, b2_rad)"
                          value={draft.zweifel.customZweifelExpression}
                          onChange={(value) => setSectionString('zweifel', 'customZweifelExpression', value)}
                          placeholder={SAFE_DEFAULT_EQUATIONS.zweifel.customZweifelExpression}
                          error={expressionErrors.zweifel}
                          hint={<VariableHint scope={ZWEIFEL_TEST_SCOPE} note="El paso se obtiene resolviendo la expresión numéricamente." />}
                        />
                      </div>
                    )}
                  </div>
                )}

                {editableType === 'thermo' && (
                  <SectionNumberFields section="thermodynamics" specs={THERMO_SPECS} draft={draft} onPatch={patchDraft} className="xl:grid-cols-2" />
                )}

                {editableType === 'kinematics' && (
                  <SectionNumberFields section="kinematics" specs={KINEMATICS_SPECS} draft={draft} onPatch={patchDraft} className="xl:grid-cols-2" />
                )}

                {editableType === 'geometry' && (
                  <div className="flex flex-col gap-3">
                    <SectionNumberFields section="geometry" specs={GEOMETRY_SPECS} draft={draft} onPatch={patchDraft} />
                    {draft.geometry.freeVortexExponent !== 1 && (
                      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-label text-warn">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        Con n ≠ 1 el equilibrio radial no recalcula la velocidad axial a lo largo del radio: las secciones de
                        buje y punta son orientativas.
                      </p>
                    )}
                  </div>
                )}

                {editableType === 'user_loss' && (
                  <div className="flex flex-col gap-3">
                    <Toggle
                      checked={draft.userDefinedLoss.enabled}
                      onChange={(checked) => patchDraft('userDefinedLoss', {enabled: checked})}
                    >
                      Usar este modelo propio en el solver
                    </Toggle>
                    <PlainTextField
                      label="Nombre del modelo"
                      value={draft.userDefinedLoss.name}
                      onChange={(value) => setSectionString('userDefinedLoss', 'name', value)}
                    />
                    <ExpressionField
                      label="Fracción del salto isentrópico perdida, f_loss (adimensional)"
                      value={draft.userDefinedLoss.lossFractionExpression}
                      onChange={(value) => setSectionString('userDefinedLoss', 'lossFractionExpression', value)}
                      placeholder={SAFE_DEFAULT_EQUATIONS.userDefinedLoss.lossFractionExpression}
                      error={expressionErrors.userLoss}
                      multiline
                      rows={3}
                    />
                    <p className="rounded-lg border border-line bg-surface-muted p-3 text-caption leading-relaxed text-ink-2">
                      Variables: <code className="font-mono">{USER_LOSS_VARIABLES.join(', ')}</code>. La fracción se limita a
                      [0, 0,95] y η_tt = 1 − f_loss. Esta correlación propia necesita una validación independiente.
                    </p>
                    <div className="rounded-lg border border-line bg-surface p-3 text-label" aria-live="polite">
                      <span className="font-semibold text-ink-2">Resultado en la etapa actual: </span>
                      {!userLossPreview ? (
                        <span className="text-ink-3">sin diseño calculado.</span>
                      ) : userLossPreview.error ? (
                        <span className="text-danger">
                          expresión no válida; el solver usará la pérdida de Soderberg como respaldo.
                        </span>
                      ) : (
                        <span className="tabular-nums text-ok">
                          {(Math.max(0, Math.min(0.95, userLossPreview.value)) * 100).toFixed(2)} % de pérdida · η_tt{' '}
                          {(100 * (1 - Math.max(0, Math.min(0.95, userLossPreview.value)))).toFixed(1)} %
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {editableType === 'sandbox' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3">
                      <ExpressionField
                        label="Expresión de prueba"
                        value={sandboxExpr}
                        onChange={(value) => {
                          setSandboxExpr(value);
                          setSandboxResult(null);
                        }}
                        multiline
                        rows={2}
                        hint={<VariableHint scope={SANDBOX_VARIABLES_SCOPE} note="Las pruebas no cambian el cálculo." />}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={testSandboxExpression} disabled={!evalContext} className="btn-primary">
                          <Sparkles className="h-4 w-4" aria-hidden="true" /> Evaluar con la etapa actual
                        </button>
                        {!evalContext && <span className="text-caption text-ink-3">Necesita un diseño calculado.</span>}
                        {sandboxResult && (
                          <span
                            role="status"
                            className={`rounded-lg border px-2.5 py-1 text-label font-semibold ${
                              sandboxResult.error ? 'border-rose-200 bg-danger-soft text-danger' : 'border-emerald-200 bg-ok-soft text-ok'
                            }`}
                          >
                            {sandboxResult.error ? sandboxResult.error : `Resultado = ${sandboxResult.value.toPrecision(6)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h5 className="text-body font-semibold text-ink">Biblioteca de ecuaciones de usuario</h5>
                          <p className="text-caption text-ink-3">
                            Añade expresiones, pruébalas con la etapa actual y guárdalas dentro de un perfil.
                          </p>
                        </div>
                        <button type="button" onClick={addUserEquation} className="btn-secondary">
                          <Plus className="h-4 w-4" aria-hidden="true" /> Añadir ecuación
                        </button>
                      </div>
                      {selectedUserEquation && (
                        <>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="flex min-w-52 flex-1 flex-col gap-1">
                              <label htmlFor={userEquationSelectId} className="text-label font-medium text-ink-2">
                                Ecuación de usuario
                              </label>
                              <select
                                id={userEquationSelectId}
                                value={selectedUserEquation.id}
                                onChange={(event) => setSelectedUserEquationId(event.target.value)}
                                className="field w-full max-sm:h-10 max-sm:text-base"
                              >
                                {draft.userEquations.map((equation) => (
                                  <option key={equation.id} value={equation.id}>
                                    {equation.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <button
                              type="button"
                              onClick={() => deleteUserEquation(selectedUserEquation.id)}
                              className="btn-secondary text-danger"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar ecuación
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                            <PlainTextField
                              label="Nombre"
                              value={selectedUserEquation.name}
                              onChange={(value) => updateUserEquation(selectedUserEquation.id, {name: value})}
                            />
                            <PlainTextField
                              label="Descripción"
                              value={selectedUserEquation.description}
                              onChange={(value) => updateUserEquation(selectedUserEquation.id, {description: value})}
                            />
                            <ExpressionField
                              className="xl:col-span-2"
                              label="Expresión"
                              value={selectedUserEquation.expression}
                              onChange={(value) => updateUserEquation(selectedUserEquation.id, {expression: value})}
                              multiline
                              rows={2}
                              hint={<VariableHint scope={USER_EQUATION_VARIABLES_SCOPE} />}
                            />
                            <p className="text-label xl:col-span-2" aria-live="polite">
                              {!evalContext ? (
                                <span className="text-ink-3">Sin diseño calculado: no hay valores de prueba.</span>
                              ) : userEquationEvaluation?.error ? (
                                <span className="text-danger">Fórmula no válida: {userEquationEvaluation.error}</span>
                              ) : userEquationEvaluation ? (
                                <span className="font-semibold tabular-nums text-ok">
                                  Resultado de prueba: {userEquationEvaluation.value.toPrecision(6)}
                                </span>
                              ) : null}
                            </p>
                            <p className="text-caption leading-relaxed text-warn xl:col-span-2">
                              Estas ecuaciones se guardan y se evalúan como pruebas independientes: no cambian el diseño. Las
                              expresiones propias de Soderberg y Ainley-Mathieson sí están conectadas al solver.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Auxiliares de render
// ---------------------------------------------------------------------------

/** Ámbitos usados solo para listar variables disponibles (los valores no importan). */
const SANDBOX_VARIABLES_SCOPE: Scope = {eps: 0, AR: 0, turning: 0, Rm: 0, U: 0, Va: 0, PR: 0, m_dot: 0};
const USER_EQUATION_VARIABLES_SCOPE: Scope = {
  ...SANDBOX_VARIABLES_SCOPE,
  phi: 0,
  beta1: 0,
  beta2: 0,
  Mach: 0,
  MachRel: 0,
  dh_is_kJkg: 0,
  eta_tt: 0,
};

function groupBySubfolder(nodes: EquationNode[]): {title: string; nodes: EquationNode[]}[] {
  const map = new Map<string, EquationNode[]>();
  nodes.forEach((node) => {
    const list = map.get(node.subfolder);
    if (list) list.push(node);
    else map.set(node.subfolder, [node]);
  });
  return [...map.entries()].map(([title, items]) => ({title, nodes: items}));
}

function PlainTextField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium text-ink-2">
        {label}
      </label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} className="field w-full max-sm:h-10 max-sm:text-base" />
    </div>
  );
}


export default EquationEditorModal;
