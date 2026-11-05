/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom Equations & Loss Model Customizer for Turbomachinery 1D Solver
 * 
 * Allows users to modify formulas, empirical exponents, blockage factors,
 * and loss criteria directly from the UI, with sandbox evaluation, live preview,
 * error boundary fallback, and 1-click reset to safe defaults.
 */

export interface CustomEquationsConfig {
  version: number;
  name: string;
  isModified: boolean;
  userEquations: { id: string; name: string; expression: string; description: string }[];
  userDefinedLoss: {
    enabled: boolean;
    name: string;
    lossFractionExpression: string;
  };

  // --- 1. SODERBERG (1949) MODEL CUSTOMIZATION ---
  soderberg: {
    enabled: boolean;
    useCustomFormula: boolean;
    // Parameterized form: zeta0 = a + b * (eps / 100)^c
    a: number;          // Default 0.04
    b: number;          // Default 0.06
    c: number;          // Default 2.0
    // Aspect ratio correction: (1 + zeta0) * (d + e / AR) - 1
    d: number;          // Default 0.975
    e: number;          // Default 0.075
    // Arbitrary JS expression if useCustomFormula is true: (eps, AR) => number
    customExpression: string; // e.g. "0.04 + 0.06 * Math.pow(eps / 100, 2)"
    customArExpression: string; // e.g. "0.975 + 0.075 / AR"
  };

  // --- 2. AINLEY & MATHIESON (1951) MODEL CUSTOMIZATION ---
  ainleyMathieson: {
    enabled: boolean;
    useCustomFormula: boolean;
    // Profile loss base constants
    nozzleA: number;    // Default 0.025
    nozzleB: number;    // Default 0.065
    impulseA: number;   // Default 0.075
    impulseB: number;   // Default 0.165
    // Secondary loss constant: lambda = secondaryCoeff / AR
    secondaryCoeff: number; // Default 0.033 (Dunham-Came uses ~0.0334, Kacker-Okapuu uses modified)
    // Tip clearance coefficient: B_tip (0.5 for unshrouded, 0.25 for shrouded)
    tipClearanceCoeff: number; // Default 0.50
    // Custom expressions
    customYpExpression: string;
    customYsExpression: string;
    customYpStatorExpression: string;
    customYtcExpression: string;
  };

  // --- 3. BLADE SIZING & CONTINUITY CUSTOMIZATION ---
  sizing: {
    // Endwall boundary layer blockage factor (0.0 to 0.15): A_effective = A / (1 - blockageFactor)
    blockageFactor: number; // Default 0.00 (0% blockage)
    // Aspect ratio target for automatic chord estimation (bladeHeight / chord)
    aspectRatioTarget: number; // Default 1.6
    // Custom blade height formula if desired: (Area, Rm, blockage) => number
    useCustomHeightFormula: boolean;
    customHeightExpression: string; // e.g. "(Area / (1 - blockage)) / (2 * Math.PI * Rm)"
  };

  // --- 4. ZWEIFEL CRITERION & SOLIDITY ---
  zweifel: {
    // Target Zweifel loading coefficient (optimal ~0.80 - 0.90)
    psi_Z_target: number; // Default 0.85
    // Zweifel equation multiplier
    multiplier: number; // Default 2.0 (standard 2 * (s/c) * cos^2(b2) * |tan(b1) - tan(b2)|)
    useCustomZweifelFormula: boolean;
    customZweifelExpression: string; // e.g. "2 * (s / c_ax) * Math.pow(Math.cos(b2_rad), 2) * Math.abs(Math.tan(b1_rad) - Math.tan(b2_rad))"
  };

  // --- 5. THERMODYNAMIC & POLYTROPIC CORRECTIONS ---
  thermodynamics: {
    // Reheat factor per stage multiplier for multistage: Rf = 1 + reheatPerStage * (stages - 1)
    reheatFactorPerStage: number; // Default 0.015
    // Kinetic energy carry-over factor for multistage (fraction of V2 recovered by next stage)
    kineticEnergyCarryOverFraction: number; // Default 0.00 (0 to 0.80)
    // Polytropic efficiency model option
    usePolytropicCorrection: boolean; // Default false
    polytropicEfficiencyTarget: number; // Default 0.90
  };

  // --- 6. VELOCITY TRIANGLES & KINEMATICS (EULER) ---
  kinematics: {
    // Slip / work deficiency multiplier for Euler equation (1.0 = ideal Euler work)
    eulerWorkMultiplier: number; // Default 1.0
    // De Haller diffusion ratio threshold: DH = W2 / W1 >= deHallerMin
    deHallerMin: number; // Default 0.72
    // Flow coefficient empirical correction multiplier
    flowCoeffMultiplier: number; // Default 1.0
  };

  // --- 7. GENERAL GEOMETRY & RADIAL EQUILIBRIUM ---
  geometry: {
    // Free vortex exponent n in V_theta * r^n = const (1.0 = free vortex, 0.0 = constant swirl)
    freeVortexExponent: number; // Default 1.0
    // Tip/hub radius ratio limit check threshold
    maxHubTipRatio: number; // Default 0.92
    // Empirical stagger angle offset (degrees)
    staggerOffsetDeg: number; // Default 0.0
  };
}

export const SAFE_DEFAULT_EQUATIONS: CustomEquationsConfig = {
  version: 1,
  name: 'Predeterminado (Punto Seguro - Modelos Canónicos)',
  isModified: false,
  userEquations: [],
  userDefinedLoss: {
    enabled: false,
    name: 'Modelo de pérdidas propio',
    lossFractionExpression: '(dh_loss_stator + dh_loss_rotor) / dh_is',
  },

  soderberg: {
    enabled: true,
    useCustomFormula: false,
    a: 0.04,
    b: 0.06,
    c: 2.0,
    d: 0.975,
    e: 0.075,
    customExpression: '0.04 + 0.06 * Math.pow(eps / 100, 2)',
    customArExpression: '0.975 + 0.075 / AR',
  },

  ainleyMathieson: {
    enabled: true,
    useCustomFormula: false,
    nozzleA: 0.025,
    nozzleB: 0.065,
    impulseA: 0.075,
    impulseB: 0.165,
    secondaryCoeff: 0.033,
    tipClearanceCoeff: 0.50,
    customYpExpression: 'Yp_base * Math.pow(t_over_c / 0.20, xi)',
    customYsExpression: '(secondaryCoeff / AR) * Math.pow(CL_sc, 2) * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3))',
    customYpStatorExpression: 'nozzleA + nozzleB * Math.pow(abs_alpha1 / 100, 2.4) * Math.pow(s_over_c, -0.4)',
    customYtcExpression: 'B_tip * tipClearanceRatio * Math.pow(CL_sc, 2) * (Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3))',
  },

  sizing: {
    blockageFactor: 0.00,
    aspectRatioTarget: 1.6,
    useCustomHeightFormula: false,
    customHeightExpression: '(Area / (1 - blockage)) / (2 * Math.PI * Rm)',
  },

  zweifel: {
    psi_Z_target: 0.85,
    multiplier: 2.0,
    useCustomZweifelFormula: false,
    customZweifelExpression: '2 * (s / c_ax) * Math.pow(Math.cos(b2_rad), 2) * Math.abs(Math.tan(b1_rad) - Math.tan(b2_rad))',
  },

  thermodynamics: {
    reheatFactorPerStage: 0.015,
    kineticEnergyCarryOverFraction: 0.00,
    usePolytropicCorrection: false,
    polytropicEfficiencyTarget: 0.90,
  },

  kinematics: {
    eulerWorkMultiplier: 1.0,
    deHallerMin: 0.72,
    flowCoeffMultiplier: 1.0,
  },

  geometry: {
    freeVortexExponent: 1.0,
    maxHubTipRatio: 0.92,
    staggerOffsetDeg: 0.0,
  },
};

/** Mergea configuraciones antiguas/importadas con las ecuaciones disponibles actualmente. */
export function normalizeCustomEquations(value: unknown): CustomEquationsConfig {
  const parsed = value && typeof value === 'object' ? value as Partial<CustomEquationsConfig> : {};
  const base = SAFE_DEFAULT_EQUATIONS;
  const userEquations = Array.isArray(parsed.userEquations)
    ? parsed.userEquations.filter((equation) => equation
      && typeof equation.id === 'string'
      && typeof equation.name === 'string'
      && typeof equation.expression === 'string'
      && typeof equation.description === 'string')
    : [];

  return {
    ...base,
    ...parsed,
    userEquations,
    userDefinedLoss: { ...base.userDefinedLoss, ...parsed.userDefinedLoss },
    soderberg: { ...base.soderberg, ...parsed.soderberg },
    ainleyMathieson: { ...base.ainleyMathieson, ...parsed.ainleyMathieson },
    sizing: { ...base.sizing, ...parsed.sizing },
    zweifel: { ...base.zweifel, ...parsed.zweifel },
    thermodynamics: { ...base.thermodynamics, ...parsed.thermodynamics },
    kinematics: { ...base.kinematics, ...parsed.kinematics },
    geometry: { ...base.geometry, ...parsed.geometry },
  };
}

export interface EquationTemplate {
  id: string;
  label: string;
  description: string;
  badge: string;
  config: Partial<CustomEquationsConfig>;
}

export const EQUATION_TEMPLATES: EquationTemplate[] = [
  {
    id: 'default_safe',
    label: 'Punto Seguro (Estándar Canónico)',
    description: 'Valores bibliográficos clásicos de Soderberg (1949), Ainley & Mathieson (1951) y Zweifel (1945).',
    badge: 'Seguro / Default',
    config: SAFE_DEFAULT_EQUATIONS,
  },
  {
    id: 'soderberg_conservative',
    label: 'Soderberg Conservador (Alta Deflexión)',
    description: 'Incrementa la penalización por deflexión angular extrema (b=0.08, c=2.2) para perfiles muy curvados.',
    badge: 'Conservador',
    config: {
      name: 'Soderberg Conservador',
      soderberg: {
        ...SAFE_DEFAULT_EQUATIONS.soderberg,
        a: 0.045,
        b: 0.08,
        c: 2.2,
      },
    },
  },
  {
    id: 'dunham_came_modified',
    label: 'Ainley-Mathieson Dunham-Came (1970)',
    description: 'Ajuste empírico de Dunham & Came con coeficiente secundario incrementado para álabes de baja relación de aspecto.',
    badge: 'Aeronáutico',
    config: {
      name: 'Dunham-Came (1970)',
      ainleyMathieson: {
        ...SAFE_DEFAULT_EQUATIONS.ainleyMathieson,
        secondaryCoeff: 0.038,
        tipClearanceCoeff: 0.55,
      },
    },
  },
  {
    id: 'hydrogen_cryo_turbopump',
    label: 'Turbobomba Criogénica (H₂ - Alta Carga)',
    description: 'Optimizado para alta velocidad periférica, solidez Zweifel reforzada (ψ_Z = 0.80) y huelgo de punta estricto.',
    badge: 'Propulsión H₂',
    config: {
      name: 'Criogénica H₂',
      soderberg: {
        ...SAFE_DEFAULT_EQUATIONS.soderberg,
        a: 0.035,
        b: 0.055,
      },
      ainleyMathieson: {
        ...SAFE_DEFAULT_EQUATIONS.ainleyMathieson,
        tipClearanceCoeff: 0.40, // Huelgo más sellado
      },
      zweifel: {
        ...SAFE_DEFAULT_EQUATIONS.zweifel,
        psi_Z_target: 0.80, // Mayor solidez para evitar desprendimiento en hidrógeno
      },
      sizing: {
        ...SAFE_DEFAULT_EQUATIONS.sizing,
        blockageFactor: 0.02, // 2% de bloqueo por capa límite
      },
    },
  },
  {
    id: 'micro_turbine_annulus',
    label: 'Microturbina con Bloqueo de Capa Límite',
    description: 'Incorpora 4.5% de factor de bloqueo por capa límite de pared extrema y mayor huelgo relativo de punta.',
    badge: 'Microturbinas',
    config: {
      name: 'Microturbina (Bloqueo 4.5%)',
      sizing: {
        ...SAFE_DEFAULT_EQUATIONS.sizing,
        blockageFactor: 0.045,
        aspectRatioTarget: 1.2,
      },
      ainleyMathieson: {
        ...SAFE_DEFAULT_EQUATIONS.ainleyMathieson,
        tipClearanceCoeff: 0.65, // Mayor huelgo relativo en microturbomaquinaria
      },
    },
  },
];

/** Evalúa expresiones aritméticas con un parser y funciones Math permitidas (sin ejecutar JavaScript arbitrario). */
export function safeEvaluateMath(
  expr: string,
  scope: Record<string, number>,
  fallback: number
): { value: number; error: string | null } {
  try {
    if (!expr || !expr.trim()) return { value: fallback, error: null };
    if (expr.length > 1024) throw new Error('La expresión supera 1024 caracteres.');

    type Token = { kind: 'number' | 'identifier' | 'operator' | 'eof'; value: string };
    const tokens: Token[] = [];
    let cursor = 0;
    while (cursor < expr.length) {
      const rest = expr.slice(cursor);
      if (/^\s+/.test(rest)) { cursor += rest.match(/^\s+/)![0].length; continue; }
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (number) { tokens.push({ kind: 'number', value: number[0] }); cursor += number[0].length; continue; }
      const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
      if (identifier) { tokens.push({ kind: 'identifier', value: identifier[0] }); cursor += identifier[0].length; continue; }
      const operator = rest.match(/^(\*\*|[+\-*/%^(),])/);
      if (operator) { tokens.push({ kind: 'operator', value: operator[0] }); cursor += operator[0].length; continue; }
      throw new Error(`Carácter no permitido en la posición ${cursor + 1}.`);
    }
    if (tokens.length > 512) throw new Error('La expresión contiene demasiados elementos.');
    tokens.push({ kind: 'eof', value: '' });

    const functions: Record<string, (...args: number[]) => number> = {
      'Math.abs': Math.abs, 'Math.sqrt': Math.sqrt, 'Math.pow': Math.pow,
      'Math.min': Math.min, 'Math.max': Math.max, 'Math.sin': Math.sin,
      'Math.cos': Math.cos, 'Math.tan': Math.tan, 'Math.asin': Math.asin,
      'Math.acos': Math.acos, 'Math.atan': Math.atan, 'Math.atan2': Math.atan2,
      'Math.exp': Math.exp, 'Math.log': Math.log, 'Math.log10': Math.log10,
      'Math.floor': Math.floor, 'Math.ceil': Math.ceil, 'Math.round': Math.round,
      'Math.sign': Math.sign, 'Math.hypot': Math.hypot,
    };
    const constants: Record<string, number> = { 'Math.PI': Math.PI, 'Math.E': Math.E, pi: Math.PI };
    let index = 0;
    let depth = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];
    const accept = (value: string) => peek().value === value ? (take(), true) : false;
    const expect = (value: string) => { if (!accept(value)) throw new Error(`Se esperaba "${value}".`); };

    const primary = (): number => {
      if (++depth > 100) throw new Error('La expresión está anidada en exceso.');
      let value: number;
      const token = peek();
      if (token.kind === 'number') {
        value = Number(take().value);
      } else if (accept('(')) {
        value = addSub();
        expect(')');
      } else if (token.kind === 'identifier') {
        const name = take().value;
        if (accept('(')) {
          const fn = functions[name];
          if (!fn) throw new Error(`Función no permitida: ${name}. Usa funciones Math admitidas.`);
          const args: number[] = [];
          if (!accept(')')) {
            do { args.push(addSub()); } while (accept(','));
            expect(')');
          }
          value = fn(...args);
        } else if (Object.prototype.hasOwnProperty.call(scope, name)) {
          value = scope[name];
        } else if (Object.prototype.hasOwnProperty.call(constants, name)) {
          value = constants[name];
        } else {
          throw new Error(`Variable no disponible: ${name}.`);
        }
      } else {
        throw new Error('Se esperaba un número, variable o paréntesis.');
      }
      depth--;
      return value;
    };

    const power = (): number => {
      const left = primary();
      if (accept('^') || accept('**')) return Math.pow(left, unary());
      return left;
    };
    const unary = (): number => accept('+') ? unary() : accept('-') ? -unary() : power();
    const mulDiv = (): number => {
      let value = unary();
      while (peek().value === '*' || peek().value === '/' || peek().value === '%') {
        const op = take().value;
        const right = unary();
        value = op === '*' ? value * right : op === '/' ? value / right : value % right;
      }
      return value;
    };
    const addSub = (): number => {
      let value = mulDiv();
      while (peek().value === '+' || peek().value === '-') {
        const op = take().value;
        const right = mulDiv();
        value = op === '+' ? value + right : value - right;
      }
      return value;
    };

    const result = addSub();
    if (peek().kind !== 'eof') throw new Error(`Elemento inesperado: ${peek().value}.`);
    if (!Number.isFinite(result)) throw new Error(`El resultado no es finito (${result}).`);
    return { value: result, error: null };
  } catch (err: any) {
    return {
      value: fallback,
      error: `${err?.message || 'Expresión no válida'} Se aplica la fórmula de respaldo.`,
    };
  }
}

/**
 * Checks whether the current equations configuration differs from safe defaults.
 */
export function checkIfModified(config: CustomEquationsConfig): boolean {
  try {
    const safeStr = JSON.stringify(SAFE_DEFAULT_EQUATIONS);
    const currStr = JSON.stringify({ ...config, isModified: false, name: SAFE_DEFAULT_EQUATIONS.name });
    return safeStr !== currStr;
  } catch {
    return false;
  }
}

/**
 * Calculates custom Soderberg loss coefficient based on configuration.
 */
export function evaluateCustomSoderberg(
  config: CustomEquationsConfig | undefined,
  eps_deg: number,
  AR: number,
  options: { row?: 'stator' | 'rotor'; tmaxToChord?: number } = {}
): { zeta_nominal: number; arFactor: number; zeta_final: number; isCustom: boolean } {
  const safe_AR = Math.max(0.4, Math.min(10.0, AR));
  const safe_eps = Math.max(0, Math.min(180, eps_deg));
  const row = options.row ?? 'rotor';
  const safe_t_over_c = Math.max(0, Math.min(0.5, options.tmaxToChord ?? 0.20));

  // Soderberg's published nominal correlation includes a thickness correction.
  const default_zeta_nom =
    0.04 + 0.06 * Math.pow(safe_eps / 100, 2) - 0.006 * (safe_t_over_c / 0.20);
  // The published aspect-ratio constants differ for stator and rotor rows.
  const default_arFactor = row === 'stator'
    ? 0.993 + 0.021 / safe_AR
    : 0.975 + 0.075 / safe_AR;

  const s = config?.soderberg;
  const safeSoderberg = SAFE_DEFAULT_EQUATIONS.soderberg;
  const hasCustomSoderberg = !!s && s.enabled && (
    s.useCustomFormula ||
    s.a !== safeSoderberg.a ||
    s.b !== safeSoderberg.b ||
    s.c !== safeSoderberg.c ||
    s.d !== safeSoderberg.d ||
    s.e !== safeSoderberg.e
  );

  if (!s || !hasCustomSoderberg) {
    const zeta_final = Math.max(0, (1 + default_zeta_nom) * default_arFactor - 1);
    return { zeta_nominal: default_zeta_nom, arFactor: default_arFactor, zeta_final, isCustom: false };
  }

  let zeta_nominal = default_zeta_nom;
  let arFactor = default_arFactor;

  if (s.useCustomFormula) {
    const evalNom = safeEvaluateMath(s.customExpression, { eps: safe_eps, AR: safe_AR }, default_zeta_nom);
    zeta_nominal = evalNom.value;
    const evalAr = safeEvaluateMath(s.customArExpression, { eps: safe_eps, AR: safe_AR }, default_arFactor);
    arFactor = evalAr.value;
  } else {
    zeta_nominal = s.a + s.b * Math.pow(safe_eps / 100, s.c);
    arFactor = s.d + s.e / safe_AR;
  }

  const zeta_final = Math.max(0, (1 + zeta_nominal) * arFactor - 1);
  return { zeta_nominal, arFactor, zeta_final, isCustom: true };
}

/**
 * Evaluates custom annulus area and blade height applying boundary layer blockage.
 */
export function evaluateCustomBladeHeight(
  config: CustomEquationsConfig | undefined,
  Area_ideal: number,
  Rm: number
): { bladeHeight: number; effectiveArea: number; blockage: number } {
  const blockage = config?.sizing?.blockageFactor ?? 0.0;
  const safeBlockage = Math.max(0, Math.min(0.20, blockage));
  const safeRm = Math.max(0.01, Rm);
  const defaultArea = Area_ideal / Math.max(0.5, 1.0 - safeBlockage);
  const defaultHeight = defaultArea / (2 * Math.PI * safeRm);
  const sizing = config?.sizing;
  const customHeight = sizing?.useCustomHeightFormula
    ? safeEvaluateMath(sizing.customHeightExpression, {
        Area: Area_ideal,
        Area_ideal,
        effectiveArea: defaultArea,
        blockage: safeBlockage,
        Rm: safeRm,
      }, defaultHeight).value
    : defaultHeight;
  const bladeHeight = Math.max(0.001, Math.min(10, customHeight));
  const effectiveArea = sizing?.useCustomHeightFormula
    ? 2 * Math.PI * safeRm * bladeHeight
    : defaultArea;

  return { bladeHeight, effectiveArea, blockage: safeBlockage };
}

export interface EquationSymbol {
  symbol: string;
  name: string;
  unit: string;
}

export interface EquationEvaluationContext {
  m_dot: number;
  P01_bar: number;
  T01_K: number;
  P02_bar: number;
  T02_K: number;
  T02s_K: number;
  gamma: number;
  cp_JkgK: number;
  Rgas_JkgK: number;
  PR: number;
  U_ms: number;
  Va_ms: number;
  V1_ms: number;
  W1_ms: number;
  V2_ms: number;
  W2_ms: number;
  Vtheta1_ms: number;
  Vtheta2_ms: number;
  Wtheta1_ms: number;
  Wtheta2_ms: number;
  alpha1_deg: number;
  alpha2_deg: number;
  beta1_deg: number;
  beta2_deg: number;
  eps_deg: number;
  Mach_abs1: number;
  Mach_rel1: number;
  speedOfSound_ms: number;
  dh0_kJkg: number;
  dh0s_kJkg: number;
  reaction_R: number;
  flowCoeff_phi: number;
  stageLoading_psi: number;
  bladeHeight_mm: number;
  annulusArea_m2: number;
  Rm_m: number;
  Rhub_m: number;
  Rtip_m: number;
  aspectRatio: number;
  chord_mm: number;
  solidity_sc: number;
  numBlades: number;
  eta_tt: number;
  eta_ts: number;
  reheatFactor: number;
  dh_is_Jkg: number;
  dh_loss_stator_Jkg: number;
  dh_loss_rotor_Jkg: number;
  dh_loss_soderberg_Jkg: number;
  dh_loss_ainley_Jkg: number;
  Mach_rel2: number;
  zeta_N: number;
  zeta_R: number;
  Yp_rotor: number;
  Ys_rotor: number;
  Ytc_rotor: number;
}

export interface EquationNode {
  id: string;
  name: string;
  category: 'thermodynamics' | 'kinematics' | 'geometry' | 'losses' | 'sandbox';
  subfolder: string;
  latex: string;
  asciiFormula: string;
  description: string;
  theoreticalRef: string;
  symbols: EquationSymbol[];
  editableType?: 'soderberg' | 'ainley' | 'sizing' | 'zweifel' | 'thermo' | 'kinematics' | 'geometry' | 'sandbox' | 'user_loss';
  evaluate: (ctx: EquationEvaluationContext, cfg: CustomEquationsConfig) => {
    outputLabel: string;
    outputValue: number | string;
    unit: string;
    detail?: string;
  };
}

export const EQUATION_CATALOG: EquationNode[] = [
  // ==========================================
  // 1. TERMODINÁMICA GENERAL Y FLUIDODINÁMICA
  // ==========================================
  {
    id: 'thermo_state',
    name: 'Ecuación de Estado del Gas Ideal',
    category: 'thermodynamics',
    subfolder: 'Gas Ideal & Termodinámica',
    latex: 'P = \\rho \\cdot R_{gas} \\cdot T',
    asciiFormula: 'P = rho * R_gas * T',
    description: 'Relaciona la presión estática, densidad másica y temperatura absoluta del fluido compresible en cada estación meridional.',
    theoreticalRef: 'Dixon & Hall (2014) - Fluid Mechanics & Thermodynamics of Turbomachinery, Cap. 2',
    symbols: [
      { symbol: 'P', name: 'Presión estática', unit: 'Pa / bar' },
      { symbol: 'rho', name: 'Densidad del fluido', unit: 'kg/m³' },
      { symbol: 'R_gas', name: 'Constante específica del gas (Ru / M)', unit: 'J/(kg·K)' },
      { symbol: 'T', name: 'Temperatura estática absoluta', unit: 'K' },
    ],
    evaluate: (ctx) => {
      const rho1 = (ctx.P01_bar * 1e5) / (ctx.Rgas_JkgK * ctx.T01_K);
      return { outputLabel: 'Densidad de entrada rho_01', outputValue: rho1.toFixed(3), unit: 'kg/m³', detail: `P₀₁=${ctx.P01_bar} bar, T₀₁=${ctx.T01_K} K` };
    },
  },
  {
    id: 'thermo_gas_const',
    name: 'Constante Específica del Gas',
    category: 'thermodynamics',
    subfolder: 'Gas Ideal & Termodinámica',
    latex: 'R_{gas} = \\frac{R_u}{M_{mol}}',
    asciiFormula: 'R_gas = Ru / M_mol',
    description: 'Cociente entre la constante universal de los gases (Ru = 8314.46 J/(kmol·K)) y la masa molar del gas seleccionado.',
    theoreticalRef: 'NASA SP-8110 / Cohen, Rogers & Saravanamuttoo',
    symbols: [
      { symbol: 'R_gas', name: 'Constante individual del gas', unit: 'J/(kg·K)' },
      { symbol: 'Ru', name: 'Constante universal (8314.46)', unit: 'J/(kmol·K)' },
      { symbol: 'M_mol', name: 'Masa molar del fluido', unit: 'kg/kmol' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'R_gas del fluido activo',
      outputValue: ctx.Rgas_JkgK.toFixed(1),
      unit: 'J/(kg·K)',
      detail: `Aire=287, H₂=4124, Vapor=461.5, sCO₂=188.9`,
    }),
  },
  {
    id: 'thermo_specific_heats',
    name: 'Calores Específicos cp y cv',
    category: 'thermodynamics',
    subfolder: 'Gas Ideal & Termodinámica',
    latex: 'c_p = \\frac{\\gamma \\cdot R_{gas}}{\\gamma - 1}, \\quad c_v = \\frac{R_{gas}}{\\gamma - 1}',
    asciiFormula: 'cp = (gamma * R_gas) / (gamma - 1)',
    description: 'Capacidad calorífica a presión y volumen constante en función del coeficiente adiabático isentrópico gamma (cp - cv = R_gas).',
    theoreticalRef: 'Anderson (Modern Compressible Flow), Dixon & Hall',
    symbols: [
      { symbol: 'cp', name: 'Calor específico a presión constante', unit: 'J/(kg·K)' },
      { symbol: 'gamma', name: 'Coeficiente adiabático (Cp/Cv)', unit: '-' },
      { symbol: 'cv', name: 'Calor específico a volumen constante', unit: 'J/(kg·K)' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'cp del gas de trabajo',
      outputValue: ctx.cp_JkgK.toFixed(1),
      unit: 'J/(kg·K)',
      detail: `gamma = ${ctx.gamma.toFixed(3)}`,
    }),
  },
  {
    id: 'thermo_isentropic_exp',
    name: 'Relaciones Isentrópicas de Expansión',
    category: 'thermodynamics',
    subfolder: 'Isentrópica & Relaciones Totales',
    latex: 'T_{02s} = T_{01} \\cdot \\left(\\frac{1}{PR}\\right)^{\\frac{\\gamma - 1}{\\gamma}}, \\quad P_{02} = \\frac{P_{01}}{PR}',
    asciiFormula: 'T02s = T01 * (1 / PR)^((gamma - 1) / gamma)',
    description: 'Temperatura y presión totales teóricas al final de una expansión adiabática reversible sin pérdidas.',
    theoreticalRef: 'Dixon & Hall (2014), Cap. 2; Balje (1981)',
    symbols: [
      { symbol: 'T02s', name: 'Temperatura total isentrópica de salida', unit: 'K' },
      { symbol: 'T01', name: 'Temperatura total de entrada', unit: 'K' },
      { symbol: 'PR', name: 'Relación de presiones totales (P01 / P02)', unit: '-' },
      { symbol: 'gamma', name: 'Exponente isoentrópico', unit: '-' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'T₀₂_isentrópica',
      outputValue: ctx.T02s_K.toFixed(1),
      unit: 'K',
      detail: `T₀₁=${ctx.T01_K} K, PR=${ctx.PR}:1, Caída isentrópica=${(ctx.T01_K - ctx.T02s_K).toFixed(1)} K`,
    }),
  },
  {
    id: 'thermo_total_static',
    name: 'Relación Total a Estática de Temperatura y Presión',
    category: 'thermodynamics',
    subfolder: 'Isentrópica & Relaciones Totales',
    latex: '\\frac{T_0}{T} = 1 + \\frac{\\gamma - 1}{2} M^2, \\quad \\frac{P_0}{P} = \\left(1 + \\frac{\\gamma - 1}{2} M^2\\right)^{\\frac{\\gamma}{\\gamma - 1}}',
    asciiFormula: 'T0 / T = 1 + ((gamma - 1) / 2) * M^2',
    description: 'Convierte propiedades totales (de remanso) a propiedades termodinámicas estáticas locales en función del número de Mach.',
    theoreticalRef: 'Liepmann & Roshko (Elements of Gasdynamics)',
    symbols: [
      { symbol: 'T0', name: 'Temperatura total o de remanso', unit: 'K' },
      { symbol: 'T', name: 'Temperatura estática', unit: 'K' },
      { symbol: 'P0', name: 'Presión total', unit: 'bar' },
      { symbol: 'M', name: 'Número de Mach del flujo', unit: '-' },
    ],
    evaluate: (ctx) => {
      const M = ctx.Mach_abs1;
      const tRatio = 1 + 0.5 * (ctx.gamma - 1) * M * M;
      const T_static = ctx.T01_K / tRatio;
      return { outputLabel: 'Temperatura estática T₁', outputValue: T_static.toFixed(1), unit: 'K', detail: `M_abs1=${M.toFixed(2)}, T₀₁/T₁=${tRatio.toFixed(3)}` };
    },
  },
  {
    id: 'thermo_speed_sound',
    name: 'Velocidad del Sonido y Número de Mach',
    category: 'thermodynamics',
    subfolder: 'Gas Ideal & Termodinámica',
    latex: 'a = \\sqrt{\\gamma \\cdot R_{gas} \\cdot T}, \\quad M = \\frac{V}{a}, \\quad M_{rel} = \\frac{W}{a}',
    asciiFormula: 'a = sqrt(gamma * R_gas * T), M = V / a',
    description: 'Velocidad de propagación de ondas acústicas en el medio gaseoso y números de Mach absoluto y relativo en cascada.',
    theoreticalRef: 'NASA SP-8110, Dixon & Hall Cap. 2',
    symbols: [
      { symbol: 'a', name: 'Velocidad del sonido local', unit: 'm/s' },
      { symbol: 'V', name: 'Velocidad absoluta del flujo', unit: 'm/s' },
      { symbol: 'W', name: 'Velocidad relativa al rotor', unit: 'm/s' },
      { symbol: 'M', name: 'Mach absoluto', unit: '-' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Velocidad del sonido a₁',
      outputValue: ctx.speedOfSound_ms.toFixed(1),
      unit: 'm/s',
      detail: `M_abs1 = ${ctx.Mach_abs1.toFixed(2)}, M_rel1 = ${ctx.Mach_rel1.toFixed(2)}`,
    }),
  },
  {
    id: 'thermo_isentropic_dh',
    name: 'Salto Entálpico Isentrópico de Etapa',
    category: 'thermodynamics',
    subfolder: 'Isentrópica & Relaciones Totales',
    latex: '\\Delta h_{0s} = c_p \\cdot (T_{01} - T_{02s}) = c_p \\cdot T_{01} \\left[1 - \\left(\\frac{1}{PR}\\right)^{\\frac{\\gamma - 1}{\\gamma}}\\right]',
    asciiFormula: 'dh0s = cp * (T01 - T02s)',
    description: 'Máxima energía específica recuperable en la etapa mediante expansión isentrópica ideal entre P01 y P02.',
    theoreticalRef: 'Dixon & Hall (2014), Balje (1981)',
    symbols: [
      { symbol: 'dh0s', name: 'Salto entálpico isentrópico total', unit: 'kJ/kg' },
      { symbol: 'cp', name: 'Calor específico a presión cte', unit: 'J/(kg·K)' },
      { symbol: 'T01', name: 'Temperatura de remanso a la entrada', unit: 'K' },
      { symbol: 'PR', name: 'Relación de presiones de etapa', unit: '-' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Salto isentrópico Δh₀s',
      outputValue: ctx.dh0s_kJkg.toFixed(2),
      unit: 'kJ/kg',
      detail: `Potencia ideal @ ${ctx.m_dot} kg/s: ${(ctx.dh0s_kJkg * ctx.m_dot).toFixed(1)} kW`,
    }),
  },
  {
    id: 'thermo_reheat',
    name: 'Factor de Recalentamiento Multietapa (Reheat Factor)',
    category: 'thermodynamics',
    subfolder: 'Isentrópica & Relaciones Totales',
    latex: 'R_f = 1 + \\alpha_{rh} \\cdot (N_{etapas} - 1), \\quad \\sum \\Delta h_{0s,i} = R_f \\cdot \\Delta h_{0s,global}',
    asciiFormula: 'Rf = 1 + alpha_rh * (N_stages - 1)',
    description: 'Compensa la divergencia de las isobaras en el diagrama h-s en turbinas multietapa, haciendo que la suma de saltos isentrópicos individuales supere el salto global.',
    theoreticalRef: 'Cohen, Rogers & Saravanamuttoo - Gas Turbine Theory, Cap. 7',
    symbols: [
      { symbol: 'Rf', name: 'Factor de recalentamiento (típico 1.01 - 1.05)', unit: '-' },
      { symbol: 'alpha_rh', name: 'Coeficiente de recalentamiento por etapa', unit: '-' },
      { symbol: 'N_etapas', name: 'Número de escalonamientos de la turbina', unit: '-' },
    ],
    evaluate: (ctx, cfg) => {
      const rf = ctx.reheatFactor || (1 + cfg.thermodynamics.reheatFactorPerStage);
      return { outputLabel: 'Factor Reheat Rf activo', outputValue: rf.toFixed(4), unit: '-', detail: `alpha_rh=${cfg.thermodynamics.reheatFactorPerStage}` };
    },
  },
  {
    id: 'thermo_polytropic',
    name: 'Rendimiento Politrópico de Pequeña Etapa',
    category: 'thermodynamics',
    subfolder: 'Isentrópica & Relaciones Totales',
    latex: '\\eta_p = \\frac{\\ln(T_{02}/T_{01})}{\\frac{\\gamma - 1}{\\gamma} \\cdot \\ln(P_{02}/P_{01})}',
    asciiFormula: 'eta_p = ln(T02 / T01) / (((gamma - 1) / gamma) * ln(P02 / P01))',
    description: 'Eficiencia intrínseca infinitesimal libre de la distorsión del salto de presión total (small-stage efficiency).',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 2; Cumpsty (Compressor Aerodynamics)',
    symbols: [
      { symbol: 'eta_p', name: 'Rendimiento politrópico', unit: '-' },
      { symbol: 'T01, T02', name: 'Temperaturas totales de entrada y salida', unit: 'K' },
      { symbol: 'P01, P02', name: 'Presiones totales de entrada y salida', unit: 'bar' },
    ],
    evaluate: (ctx) => {
      const pr = Math.max(1.05, ctx.PR);
      const tRatio = Math.max(0.5, ctx.T02_K / ctx.T01_K);
      const exp = (ctx.gamma - 1) / ctx.gamma;
      const eta_p = Math.abs(Math.log(tRatio)) / (exp * Math.log(pr));
      const safe_eta_p = Math.max(0.6, Math.min(0.98, eta_p));
      return { outputLabel: 'Rendimiento politrópico eta_p', outputValue: (safe_eta_p * 100).toFixed(1), unit: '%', detail: `eta_tt = ${(ctx.eta_tt * 100).toFixed(1)}%` };
    },
  },

  // ==========================================
  // 2. CINEMÁTICA Y TRIÁNGULOS DE VELOCIDAD
  // ==========================================
  {
    id: 'kin_blade_speed',
    name: 'Velocidad Periférica del Álabe',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: 'U = \\omega \\cdot R_m = \\frac{2 \\pi N}{60} \\cdot R_m',
    asciiFormula: 'U = (2 * PI * N / 60) * Rm',
    description: 'Velocidad lineal del álabe a la altura del radio medio, determinante de la capacidad de trabajo según el límite mecánico del disco.',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 3, Balje (1981)',
    symbols: [
      { symbol: 'U', name: 'Velocidad periférica', unit: 'm/s' },
      { symbol: 'N', name: 'Velocidad de giro del eje', unit: 'RPM' },
      { symbol: 'Rm', name: 'Radio medio de la etapa', unit: 'm' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Velocidad periférica U',
      outputValue: ctx.U_ms.toFixed(1),
      unit: 'm/s',
      detail: `Rm = ${(ctx.Rm_m * 1000).toFixed(1)} mm`,
    }),
  },
  {
    id: 'kin_axial_velocity',
    name: 'Coeficiente de Flujo y Velocidad Axial',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: '\\phi = \\frac{V_a}{U} \\implies V_a = \\phi \\cdot U',
    asciiFormula: 'Va = phi * U',
    description: 'Define la velocidad de traslación meridional del gas a través del canal anular normal al plano de rotación.',
    theoreticalRef: 'Smith (1965) - Smith Chart for Axial Turbines, NASA SP-8110',
    symbols: [
      { symbol: 'Va', name: 'Velocidad axial del flujo', unit: 'm/s' },
      { symbol: 'phi', name: 'Coeficiente de flujo (Va / U)', unit: '-' },
      { symbol: 'U', name: 'Velocidad periférica', unit: 'm/s' },
    ],
    editableType: 'kinematics',
    evaluate: (ctx, cfg) => {
      const correctedVa = ctx.Va_ms * (cfg.kinematics?.flowCoeffMultiplier ?? 1.0);
      return { outputLabel: 'Velocidad axial Va', outputValue: correctedVa.toFixed(1), unit: 'm/s', detail: `phi = ${ctx.flowCoeff_phi.toFixed(3)}` };
    },
  },
  {
    id: 'kin_vector_rel',
    name: 'Descomposición Cinemática Vectorial',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: '\\vec{V} = \\vec{U} + \\vec{W}, \\quad V_\\theta = W_\\theta + U, \\quad V = \\sqrt{V_a^2 + V_\\theta^2}, \\quad W = \\sqrt{V_a^2 + W_\\theta^2}',
    asciiFormula: 'V = sqrt(Va^2 + Vtheta^2), W = sqrt(Va^2 + Wtheta^2)',
    description: 'Suma vectorial que conecta el marco inercial absoluto (V) con el marco de referencia relativo al rotor giratorio (W).',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 3',
    symbols: [
      { symbol: 'V', name: 'Velocidad absoluta', unit: 'm/s' },
      { symbol: 'W', name: 'Velocidad relativa', unit: 'm/s' },
      { symbol: 'U', name: 'Velocidad del rotor', unit: 'm/s' },
      { symbol: 'Vtheta, Wtheta', name: 'Componentes tangenciales', unit: 'm/s' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Velocidad absoluta V₁ / relativa W₁',
      outputValue: `${ctx.V1_ms.toFixed(1)} / ${ctx.W1_ms.toFixed(1)}`,
      unit: 'm/s',
      detail: `V₂=${ctx.V2_ms.toFixed(1)} m/s, W₂=${ctx.W2_ms.toFixed(1)} m/s`,
    }),
  },
  {
    id: 'kin_flow_angles',
    name: 'Ángulos de Flujo Absoluto y Relativo',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: '\\tan \\alpha = \\frac{V_\\theta}{V_a}, \\quad \\tan \\beta = \\frac{W_\\theta}{V_a}',
    asciiFormula: 'alpha = atan(Vtheta / Va), beta = atan(Wtheta / Va)',
    description: 'Orientación angular de los vectores respecto a la dirección axial normal. Determinan los calados de las palas estatóricas y rotóricas.',
    theoreticalRef: 'Aungier (Turbine Aerodynamics), NASA SP-8110',
    symbols: [
      { symbol: 'alpha', name: 'Ángulo absoluto de flujo (estator)', unit: '°' },
      { symbol: 'beta', name: 'Ángulo relativo de flujo (rotor)', unit: '°' },
      { symbol: 'Va', name: 'Velocidad axial', unit: 'm/s' },
      { symbol: 'Vtheta, Wtheta', name: 'Componentes circunferenciales', unit: 'm/s' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Ángulos de etapa alpha₁ / beta₁',
      outputValue: `${ctx.alpha1_deg.toFixed(1)}° / ${ctx.beta1_deg.toFixed(1)}°`,
      unit: 'grados',
      detail: `Salida: alpha₂=${ctx.alpha2_deg.toFixed(1)}°, beta₂=${ctx.beta2_deg.toFixed(1)}°, Deflexión eps=${ctx.eps_deg.toFixed(1)}°`,
    }),
  },
  {
    id: 'kin_euler_work',
    name: 'Ecuación Fundamental de Euler para Turbomáquinas',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: 'w_{euler} = U_1 \\cdot V_{\\theta 1} - U_2 \\cdot V_{\\theta 2} = \\Delta h_0',
    asciiFormula: 'w_euler = U1 * Vtheta1 - U2 * Vtheta2',
    description: 'Conservación del momento de la cantidad de movimiento angular a través del rotor. Cuantifica el trabajo mecánico extraído por unidad de masa.',
    theoreticalRef: 'Euler (1754), Dixon & Hall (2014) Cap. 1',
    symbols: [
      { symbol: 'w_euler', name: 'Trabajo específico de Euler', unit: 'kJ/kg' },
      { symbol: 'U1, U2', name: 'Velocidad periférica en entrada y salida del rotor', unit: 'm/s' },
      { symbol: 'Vtheta1, Vtheta2', name: 'Componentes tangenciales absolutas', unit: 'm/s' },
    ],
    editableType: 'kinematics',
    evaluate: (ctx, cfg) => {
      const mult = cfg.kinematics?.eulerWorkMultiplier ?? 1.0;
      const w = ctx.dh0_kJkg * mult;
      return { outputLabel: 'Trabajo de Euler w_euler', outputValue: w.toFixed(2), unit: 'kJ/kg', detail: `Slip/Work multiplier = ${mult.toFixed(2)}` };
    },
  },
  {
    id: 'kin_stage_loading',
    name: 'Coeficiente de Carga Entálpica',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: '\\psi = \\frac{\\Delta h_0}{U^2} = \\frac{V_{\\theta 1} - V_{\\theta 2}}{U}',
    asciiFormula: 'psi = dh0 / (U^2)',
    description: 'Intensidad de carga adimensionalizada respecto a la energía cinética del rotor. Fundamental para el diagrama de Smith (Smith Chart).',
    theoreticalRef: 'Smith (1965), Dixon & Hall Cap. 3',
    symbols: [
      { symbol: 'psi', name: 'Coeficiente de carga (Stage Loading Coefficient)', unit: '-' },
      { symbol: 'dh0', name: 'Salto entálpico real de la etapa', unit: 'J/kg' },
      { symbol: 'U', name: 'Velocidad de álabe', unit: 'm/s' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Coeficiente de carga psi',
      outputValue: ctx.stageLoading_psi.toFixed(3),
      unit: '-',
      detail: `Óptimo en Smith Chart: ~1.2 a 2.0`,
    }),
  },
  {
    id: 'kin_reaction_deg',
    name: 'Grado de Reacción Cinemático',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: 'R = \\frac{h_1 - h_2}{\\Delta h_0} = \\frac{W_2^2 - W_1^2 + U_1^2 - U_2^2}{2 \\cdot \\Delta h_0}',
    asciiFormula: 'R = (W2^2 - W1^2 + U1^2 - U2^2) / (2 * dh0)',
    description: 'Fracción del salto entálpico estático total de la etapa que se produce en el rotor respecto al salto total de la etapa.',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 3, NASA SP-8110',
    symbols: [
      { symbol: 'R', name: 'Grado de reacción (0=Acción pura, 0.5=Reacción 50%)', unit: '-' },
      { symbol: 'W1, W2', name: 'Velocidades relativas en el rotor', unit: 'm/s' },
      { symbol: 'dh0', name: 'Salto entálpico total de etapa', unit: 'J/kg' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Grado de Reacción R',
      outputValue: ctx.reaction_R.toFixed(3),
      unit: '-',
      detail: `R = 0.50 produce triángulos simétricos y máxima eficiencia`,
    }),
  },
  {
    id: 'kin_dehaller',
    name: 'Criterio de Difusión de De Haller',
    category: 'kinematics',
    subfolder: 'Triángulos & Cinemática',
    latex: 'DH = \\frac{W_2}{W_1} \\ge 0.72',
    asciiFormula: 'DH = W2 / W1',
    description: 'Límite aerodinámico para evitar desprendimiento de capa límite por gradiente adverso de presión en el rotor.',
    theoreticalRef: 'De Haller (1953) - Das Verhalten von Tragflügelgittern in Axialverdichtern',
    symbols: [
      { symbol: 'DH', name: 'Relación de desaceleración de De Haller', unit: '-' },
      { symbol: 'W2', name: 'Velocidad relativa de salida', unit: 'm/s' },
      { symbol: 'W1', name: 'Velocidad relativa de entrada', unit: 'm/s' },
    ],
    editableType: 'kinematics',
    evaluate: (ctx, cfg) => {
      const dh = ctx.W2_ms / Math.max(1, ctx.W1_ms);
      const minDH = cfg.kinematics?.deHallerMin ?? 0.72;
      const status = dh >= minDH ? 'Seguro (Aceleración)' : 'Alerta Desprendimiento';
      return { outputLabel: 'Criterio De Haller W₂/W₁', outputValue: dh.toFixed(3), unit: '-', detail: `Límite=${minDH} · Estado: ${status}` };
    },
  },

  // ==========================================
  // 3. GEOMETRÍA Y CANAL MERIDIONAL
  // ==========================================
  {
    id: 'geom_annulus_area',
    name: 'Ecuación de Continuidad y Área Anular Ideal',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'A_{ideal} = \\frac{\\dot{m}}{\\rho_2 \\cdot V_a}',
    asciiFormula: 'A_ideal = m_dot / (rho2 * Va)',
    description: 'Área geométrica de paso meridional requerida para evacuar el flujo másico conservando la velocidad axial de diseño.',
    theoreticalRef: 'NASA SP-8110, Dixon & Hall Cap. 3',
    symbols: [
      { symbol: 'A_ideal', name: 'Área anular ideal', unit: 'm² / cm²' },
      { symbol: 'm_dot', name: 'Flujo másico', unit: 'kg/s' },
      { symbol: 'rho2', name: 'Densidad estática a la salida', unit: 'kg/m³' },
      { symbol: 'Va', name: 'Velocidad axial', unit: 'm/s' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Área anular ideal A',
      outputValue: (ctx.annulusArea_m2 * 1e4).toFixed(1),
      unit: 'cm²',
      detail: `m_dot = ${ctx.m_dot} kg/s, Va = ${ctx.Va_ms.toFixed(1)} m/s`,
    }),
  },
  {
    id: 'geom_blockage',
    name: 'Factor de Bloqueo de Capa Límite',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'A_{efectiva} = \\frac{A_{ideal}}{1 - K_{bloqueo}}',
    asciiFormula: 'A_efectiva = A_ideal / (1 - K_bloqueo)',
    description: 'Compensa el desplazamiento de masa provocado por el crecimiento de la capa límite en las paredes del buje y de la carcasa exterior.',
    theoreticalRef: 'Aungier (2006) - Turbine Aerodynamics, ASME Turbo Expo',
    symbols: [
      { symbol: 'A_efectiva', name: 'Área anular real corregida', unit: 'm²' },
      { symbol: 'A_ideal', name: 'Área teórica por continuidad', unit: 'm²' },
      { symbol: 'K_bloqueo', name: 'Fracción de bloqueo de capa límite (0.00 a 0.15)', unit: '-' },
    ],
    editableType: 'sizing',
    evaluate: (ctx, cfg) => {
      const k = cfg.sizing.blockageFactor;
      const aEff = ctx.annulusArea_m2 / Math.max(0.5, 1 - k);
      return { outputLabel: 'Área efectiva corregida', outputValue: (aEff * 1e4).toFixed(1), unit: 'cm²', detail: `Bloqueo K = ${(k * 100).toFixed(1)}%` };
    },
  },
  {
    id: 'geom_blade_height',
    name: 'Altura Radial del Álabe',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'h = \\frac{A_{efectiva}}{2 \\pi \\cdot R_m} = r_{tip} - r_{hub}',
    asciiFormula: 'h = A_efectiva / (2 * PI * Rm)',
    description: 'Envergadura física del perfil radial entre la pared del rotor (buje) y la carcasa exterior (punta).',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 3, NASA SP-8110',
    symbols: [
      { symbol: 'h', name: 'Altura del álabe', unit: 'mm' },
      { symbol: 'A_efectiva', name: 'Área anular de paso de flujo', unit: 'm²' },
      { symbol: 'Rm', name: 'Radio medio de la etapa', unit: 'm' },
    ],
    editableType: 'sizing',
    evaluate: (ctx) => ({
      outputLabel: 'Altura física del álabe (h)',
      outputValue: ctx.bladeHeight_mm.toFixed(2),
      unit: 'mm',
      detail: `Rm = ${(ctx.Rm_m * 1000).toFixed(1)} mm, Relación Aspecto AR = ${ctx.aspectRatio.toFixed(2)}`,
    }),
  },
  {
    id: 'geom_radii',
    name: 'Radios de Buje y Punta',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'r_{hub} = R_m - \\frac{h}{2}, \\quad r_{tip} = R_m + \\frac{h}{2}',
    asciiFormula: 'r_hub = Rm - h / 2, r_tip = Rm + h / 2',
    description: 'Límites radiales internos y externos del canal de paso meridional de la turbina.',
    theoreticalRef: 'Balje (1981) - Turbomachines, Cap. 4',
    symbols: [
      { symbol: 'r_hub', name: 'Radio del buje o raíz', unit: 'mm' },
      { symbol: 'r_tip', name: 'Radio de punta o carcasa', unit: 'mm' },
      { symbol: 'Rm', name: 'Radio medio meridional', unit: 'mm' },
      { symbol: 'h', name: 'Altura del álabe', unit: 'mm' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Radios r_hub / r_tip',
      outputValue: `${(ctx.Rhub_m * 1000).toFixed(1)} / ${(ctx.Rtip_m * 1000).toFixed(1)}`,
      unit: 'mm',
      detail: `Radio medio Rm = ${(ctx.Rm_m * 1000).toFixed(1)} mm`,
    }),
  },
  {
    id: 'geom_hub_tip',
    name: 'Relación de Radios Buje / Punta',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: '\\nu = \\frac{r_{hub}}{r_{tip}}',
    asciiFormula: 'nu = r_hub / r_tip',
    description: 'Parámetro adimensional que caracteriza la cilindricidad del canal. Valores inferiores a 0.7 exigen cálculo tridimensional por fuerte torsión.',
    theoreticalRef: 'NASA SP-8110, Dixon & Hall Cap. 6',
    symbols: [
      { symbol: 'nu', name: 'Relación de radios (Hub-to-Tip Ratio)', unit: '-' },
      { symbol: 'r_hub', name: 'Radio de buje', unit: 'm' },
      { symbol: 'r_tip', name: 'Radio de punta', unit: 'm' },
    ],
    evaluate: (ctx) => {
      const nu = ctx.Rhub_m / Math.max(1e-4, ctx.Rtip_m);
      return { outputLabel: 'Relación r_hub / r_tip', outputValue: nu.toFixed(3), unit: '-', detail: nu >= 0.7 ? 'Régimen cuasi-2D cilíndrico' : 'Régimen 3D con torsión acusada' };
    },
  },
  {
    id: 'geom_aspect_ratio',
    name: 'Relación de Esbeltez o Aspecto',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'AR = \\frac{h}{c}',
    asciiFormula: 'AR = bladeHeight / chord',
    description: 'Cociente entre la altura del álabe y la cuerda aerodinámica. Crucial para las pérdidas secundarias en los modelos de Soderberg y Ainley-Mathieson.',
    theoreticalRef: 'Soderberg (1949), Dunham & Came (1970)',
    symbols: [
      { symbol: 'AR', name: 'Aspect Ratio', unit: '-' },
      { symbol: 'h', name: 'Altura del álabe', unit: 'mm' },
      { symbol: 'c', name: 'Cuerda aerodinámica del perfil', unit: 'mm' },
    ],
    editableType: 'sizing',
    evaluate: (ctx) => ({
      outputLabel: 'Relación de Aspecto (AR)',
      outputValue: ctx.aspectRatio.toFixed(2),
      unit: '-',
      detail: `Cuerda c = ${ctx.chord_mm.toFixed(1)} mm, Altura h = ${ctx.bladeHeight_mm.toFixed(1)} mm`,
    }),
  },
  {
    id: 'geom_zweifel',
    name: 'Criterio de Carga Óptima de Zweifel',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: '\\frac{s}{c} = \\frac{\\Psi_Z}{2 \\cdot \\cos^2 \\beta_2 \\cdot |\\tan \\beta_1 - \\tan \\beta_2|}',
    asciiFormula: 's / c = psi_Z / (2 * cos^2(beta2) * |tan(beta1) - tan(beta2)|)',
    description: 'Correlación de Zweifel (1945) para minimizar las pérdidas globales por balance entre fricción superficial (muchos álabes) y desprendimiento (pocos álabes).',
    theoreticalRef: 'Zweifel (1945) - The Spacing of Turbo-Machine Blading',
    symbols: [
      { symbol: 's / c', name: 'Relación paso/cuerda (Pitch-to-chord ratio)', unit: '-' },
      { symbol: 'Psi_Z', name: 'Coeficiente de carga de Zweifel (óptimo 0.80 - 0.90)', unit: '-' },
      { symbol: 'beta1, beta2', name: 'Ángulos relativos de entrada y salida', unit: 'rad / °' },
    ],
    editableType: 'zweifel',
    evaluate: (ctx, cfg) => {
      const psi = cfg.zweifel.psi_Z_target;
      return { outputLabel: 'Relación s/c óptima', outputValue: ctx.solidity_sc.toFixed(3), unit: '-', detail: `Psi_Zweifel objetivo = ${psi.toFixed(2)}` };
    },
  },
  {
    id: 'geom_blade_count',
    name: 'Conteo Óptimo de Álabes del Rodete',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'Z = \\mathrm{round}\\left(\\frac{2 \\pi \\cdot R_m}{s}\\right) = \\mathrm{round}\\left(\\frac{2 \\pi \\cdot R_m}{c \\cdot (s/c)}\\right)',
    asciiFormula: 'Z = round((2 * PI * Rm) / s)',
    description: 'Número entero de álabes distribuidos anularmente en el rotor para satisfacer la solidez óptima calculada.',
    theoreticalRef: 'Zweifel (1945), NASA SP-8110',
    symbols: [
      { symbol: 'Z', name: 'Número de álabes del rodete', unit: '-' },
      { symbol: 'Rm', name: 'Radio medio', unit: 'm' },
      { symbol: 's', name: 'Paso tangencial entre álabes', unit: 'mm' },
      { symbol: 'c', name: 'Cuerda', unit: 'mm' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Número de álabes Z',
      outputValue: ctx.numBlades,
      unit: 'álabes',
      detail: `Paso tangencial s = ${(2 * Math.PI * ctx.Rm_m * 1000 / ctx.numBlades).toFixed(1)} mm`,
    }),
  },
  {
    id: 'geom_radial_equilibrium',
    name: 'Equilibrio Radial y Vórtice Libre',
    category: 'geometry',
    subfolder: 'Canal Anular & Álabe',
    latex: 'V_\\theta(r) \\cdot r^n = \\text{constante} \\quad (n=1 \\implies \\text{Free Vortex})',
    asciiFormula: 'Vtheta(r) * r^n = const',
    description: 'Garantiza que la fuerza centrífuga del flujo en rotación esté equilibrada por el gradiente radial de presión estática (dP/dr = rho * Vtheta^2 / r).',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 6, Horlock (Axial Flow Turbines)',
    symbols: [
      { symbol: 'Vtheta(r)', name: 'Velocidad tangencial a radio r', unit: 'm/s' },
      { symbol: 'r', name: 'Radio radial local', unit: 'm' },
      { symbol: 'n', name: 'Exponente de vórtice (1.0=Vórtice libre, 0.0=Swirl constante)', unit: '-' },
    ],
    editableType: 'geometry',
    evaluate: (ctx, cfg) => {
      const n = cfg.geometry?.freeVortexExponent ?? 1.0;
      return { outputLabel: 'Exponente de vórtice radial n', outputValue: n.toFixed(2), unit: '-', detail: n === 1.0 ? 'Distribución canónica Free Vortex' : `Ley radial Vθ · r^${n}` };
    },
  },

  // ==========================================
  // 4. MODELOS DE PÉRDIDAS AERODINÁMICAS
  // ==========================================
  {
    id: 'loss_soderberg_nominal',
    name: 'Coeficiente Base de Pérdida de Soderberg',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: '\\zeta_{ref} = 0.04 + 0.06(\\epsilon/100)^2 - 0.006[(t/c)/0.20]',
    asciiFormula: 'zeta_ref = 0.04 + 0.06*(eps/100)^2 - 0.006*((t/c)/0.20)',
    description: 'Correlación de referencia de Soderberg con corrección por espesor; en este editor se evalúa con t/c = 0.20. Los parámetros a, b y c representan un ajuste personalizado.',
    theoreticalRef: 'Soderberg (1949), Dixon & Hall (2014) Cap. 3',
    symbols: [
      { symbol: 'zeta0', name: 'Coeficiente nominal de pérdida de energía cinética', unit: '-' },
      { symbol: 'eps', name: 'Deflexión total del flujo (|beta1 - beta2|)', unit: '°' },
      { symbol: 'a', name: 'Constante base a deflexión nula (0.04)', unit: '-' },
      { symbol: 'b', name: 'Coeficiente de sensibilidad angular (0.06)', unit: '-' },
      { symbol: 'c', name: 'Exponente cuadrático de deflexión (2.0)', unit: '-' },
    ],
    editableType: 'soderberg',
    evaluate: (ctx, cfg) => {
      const s = cfg.soderberg;
      const usesCustomParameters = s.useCustomFormula || s.a !== SAFE_DEFAULT_EQUATIONS.soderberg.a || s.b !== SAFE_DEFAULT_EQUATIONS.soderberg.b || s.c !== SAFE_DEFAULT_EQUATIONS.soderberg.c;
      const z0 = usesCustomParameters
        ? s.a + s.b * Math.pow(ctx.eps_deg / 100, s.c)
        : 0.04 + 0.06 * Math.pow(ctx.eps_deg / 100, 2) - 0.006;
      return { outputLabel: 'zeta_ref nominal (t/c = 0.20)', outputValue: z0.toFixed(4), unit: '-', detail: `Deflexión eps = ${ctx.eps_deg.toFixed(1)}°` };
    },
  },
  {
    id: 'loss_soderberg_ar',
    name: 'Corrección por Relación de Aspecto (Soderberg)',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: 'Rotor: (1 + \\zeta_{ref})(0.975 + 0.075/AR) - 1; Estator: (1 + \\zeta_{ref})(0.993 + 0.021/AR) - 1',
    asciiFormula: '1 + zeta = (1 + zeta0) * (d + e / AR)',
    description: 'La correlación de referencia usa constantes distintas para rotor y estator. La configuración personalizada expone d y e para ajustar el factor de aspecto.',
    theoreticalRef: 'Soderberg (1949), Stenning (Turbomachines)',
    symbols: [
      { symbol: 'zeta', name: 'Coeficiente total de pérdida de Soderberg', unit: '-' },
      { symbol: 'zeta0', name: 'Pérdida nominal', unit: '-' },
      { symbol: 'AR', name: 'Relación de aspecto (h / c)', unit: '-' },
      { symbol: 'd', name: 'Intercepto de esbeltez (0.975)', unit: '-' },
      { symbol: 'e', name: 'Penalización por pared extrema (0.075)', unit: '-' },
    ],
    editableType: 'soderberg',
    evaluate: (ctx, cfg) => {
      const res = evaluateCustomSoderberg(cfg, ctx.eps_deg, ctx.aspectRatio);
      return { outputLabel: 'zeta total de Soderberg', outputValue: res.zeta_final.toFixed(4), unit: '-', detail: `Factor AR = ${res.arFactor.toFixed(4)} @ AR=${ctx.aspectRatio.toFixed(2)}` };
    },
  },
  {
    id: 'loss_ainley_profile',
    name: 'Ainley & Mathieson - Pérdida de Perfil',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: 'Y_{p,N}=A_N+B_N(|\\beta_2|/100)^{2.4}(s/c)^{-0.4};\\;Y_{p,I}=A_I+B_I(|\\beta_2|/100)^{2.6}(s/c)^{-0.6};\\;Y_p=\\mathrm{clamp}([Y_{p,N}+\\xi^2(Y_{p,I}-Y_{p,N})](t/c/0.20)^\\xi,0.015,0.25)',
    asciiFormula: 'xi=min(1,abs(beta1)/max(1,abs(beta2))); Yp=clamp((Yp_nozzle+xi^2*(Yp_impulse-Yp_nozzle))*(t/c/0.20)^xi,0.015,0.25)',
    description: 'Aproximación algebraica implementada por esta app; los cuatro parámetros de perfil y la expresión final pueden editarse. No reproduce los mapas originales completos de Ainley–Mathieson.',
    theoreticalRef: 'Ainley & Mathieson (1951) - ARC R&M 2891, Dunham & Came (1970)',
    symbols: [
      { symbol: 'Yp', name: 'Coeficiente de pérdida de presión total de perfil', unit: '-' },
      { symbol: 't / c', name: 'Espesor máximo relativo', unit: '-' },
      { symbol: 'beta1, beta2', name: 'Ángulos relativos de flujo', unit: '°' },
    ],
    editableType: 'ainley',
    evaluate: (_, cfg) => {
      const am = cfg.ainleyMathieson;
      return { outputLabel: 'Pérdida de perfil base tobera', outputValue: am.nozzleA.toFixed(3), unit: '-', detail: `Impulsión base = ${am.impulseA.toFixed(3)}` };
    },
  },
  {
    id: 'loss_ainley_secondary',
    name: 'Ainley & Mathieson - Pérdida Secundaria',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: 'Y_s=\\mathrm{clamp}[(K_s/AR)(C_L/(s/c))^2 \\cos^2\\beta_2/\\max(0.02,\\cos^3\\beta_m),0,0.25]',
    asciiFormula: 'Ys = clamp((secondaryCoeff/AR)*CL_sc^2*cos(b2)^2/max(0.02,cos(bm)^3),0,0.25)',
    description: 'Pérdida debida a los vórtices de paso generados por el gradiente de presión transversal en las paredes extremas del canal anular.',
    theoreticalRef: 'Ainley & Mathieson (1951), Dunham & Came (1970)',
    symbols: [
      { symbol: 'Ys', name: 'Coeficiente de pérdida secundaria', unit: '-' },
      { symbol: 'lambda', name: 'Coeficiente secundario empírico (típico 0.033)', unit: '-' },
      { symbol: 'CL', name: 'Coeficiente de sustentación aerodinámica', unit: '-' },
      { symbol: 'AR', name: 'Relación de aspecto (h/c)', unit: '-' },
    ],
    editableType: 'ainley',
    evaluate: (ctx, cfg) => {
      const lambda = cfg.ainleyMathieson.secondaryCoeff;
      const factor = lambda / Math.max(0.5, ctx.aspectRatio);
      return { outputLabel: 'Factor secundario lambda / AR', outputValue: factor.toFixed(4), unit: '-', detail: `lambda = ${lambda.toFixed(4)}, AR = ${ctx.aspectRatio.toFixed(2)}` };
    },
  },
  {
    id: 'loss_ainley_tip',
    name: 'Ainley & Mathieson - Pérdida por Huelgo Radial',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: 'Y_{tc}=\\mathrm{clamp}[B_{tip}(k/h)(C_L/(s/c))^2 \\cos^2\\beta_2/\\max(0.02,\\cos^3\\beta_m),0,0.12]',
    asciiFormula: 'Ytc = clamp(B_tip*(k/h)*CL_sc^2*cos(b2)^2/max(0.02,cos(bm)^3),0,0.12)',
    description: 'Pérdida por fuga de flujo y vórtice de fuga en el huelgo radial entre el extremo del álabe giratorio y la carcasa estática.',
    theoreticalRef: 'Ainley & Mathieson (1951), Kacker & Okapuu (1982)',
    symbols: [
      { symbol: 'Ytc', name: 'Coeficiente de pérdida por juego de punta', unit: '-' },
      { symbol: 'B_tip', name: 'Constante de juego (0.50 sin banda, 0.25 con banda)', unit: '-' },
      { symbol: 'k / h', name: 'Juego relativo entre punta y carcasa', unit: '-' },
    ],
    editableType: 'ainley',
    evaluate: (_, cfg) => {
      const bTip = cfg.ainleyMathieson.tipClearanceCoeff;
      return { outputLabel: 'Coeficiente B_tip de huelgo', outputValue: bTip.toFixed(2), unit: '-', detail: bTip <= 0.3 ? 'Álabe con banda (shrouded)' : 'Álabe en voladizo (unshrouded)' };
    },
  },
  {
    id: 'loss_efficiency_tt_ts',
    name: 'Rendimientos Total a Total y Total a Estático',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: '\\eta_{tt}=1-\\frac{\\Delta h_{loss,N}+\\Delta h_{loss,R}}{\\Delta h_{is}};\\quad\\eta_{ts}=\\frac{\\Delta h_0}{c_pT_{01}[1-(P_3/P_{01})^{(\\gamma-1)/\\gamma}]}',
    asciiFormula: 'eta_tt = 1 - dh_loss_total/dh_is; eta_ts = dh_actual / dh_is_to_exit_static_pressure',
    description: 'η_tt es la eficiencia de pérdida usada en la iteración. η_ts se calcula finalmente con la presión estática real de salida; no se obtiene restando directamente V₂²/2 a η_tt.',
    theoreticalRef: 'Dixon & Hall (2014) Cap. 2 y 3, Balje (1981)',
    symbols: [
      { symbol: 'eta_tt', name: 'Rendimiento Total a Total', unit: '%' },
      { symbol: 'eta_ts', name: 'Rendimiento Total a Estático', unit: '%' },
      { symbol: 'dh0', name: 'Salto entálpico real', unit: 'kJ/kg' },
      { symbol: 'dh0s', name: 'Salto entálpico isentrópico', unit: 'kJ/kg' },
      { symbol: 'V2', name: 'Velocidad absoluta de salida', unit: 'm/s' },
    ],
    evaluate: (ctx) => ({
      outputLabel: 'Rendimiento eta_tt / eta_ts',
      outputValue: `${(ctx.eta_tt * 100).toFixed(1)}% / ${(ctx.eta_ts * 100).toFixed(1)}%`,
      unit: '%',
      detail: `Pérdida cinética residual = ${(0.5 * ctx.V2_ms * ctx.V2_ms / 1000).toFixed(1)} kJ/kg`,
    }),
  },
  {
    id: 'loss_user_defined',
    name: 'Modelo de pérdidas definido por el usuario',
    category: 'losses',
    subfolder: 'Modelos de Pérdidas',
    latex: '\\eta_{tt,user}=1-\\mathrm{clamp}(f_{loss},0,0.95)',
    asciiFormula: 'lossFraction = f(inputs); eta_tt = 1 - clamp(lossFraction, 0, 0.95)',
    description: 'Permite definir una nueva ley para la fracción de salto isentrópico perdida. La expresión seleccionada se evalúa dentro del solver y el resultado se limita al intervalo [0, 0.95].',
    theoreticalRef: 'Modelo definido por el usuario; requiere validación independiente.',
    symbols: [
      { symbol: 'dh_is', name: 'Salto isentrópico', unit: 'J/kg' },
      { symbol: 'dh_loss_stator', name: 'Pérdida de estator Soderberg de referencia', unit: 'J/kg' },
      { symbol: 'dh_loss_rotor', name: 'Pérdida de rotor Soderberg de referencia', unit: 'J/kg' },
      { symbol: 'Mach_rel2', name: 'Mach relativo a la salida del rotor', unit: '-' },
      { symbol: 'AR', name: 'Relación de aspecto', unit: '-' },
    ],
    editableType: 'user_loss',
    evaluate: (ctx, cfg) => {
      const custom = cfg.userDefinedLoss;
      const variables = {
        dh_is: ctx.dh_is_Jkg,
        dh_loss_stator: ctx.dh_loss_stator_Jkg,
        dh_loss_rotor: ctx.dh_loss_rotor_Jkg,
        dh_loss_soderberg: ctx.dh_loss_soderberg_Jkg,
        Mach: ctx.Mach_abs1,
        MachRel: ctx.Mach_rel1,
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
      };
      const fallback = ctx.dh_is_Jkg > 0 ? ctx.dh_loss_soderberg_Jkg / ctx.dh_is_Jkg : 0;
      const lossFraction = safeEvaluateMath(custom.lossFractionExpression, variables, fallback).value;
      const limitedLoss = Math.max(0, Math.min(0.95, lossFraction));
      return {
        outputLabel: `Pérdida fraccional · ${custom.name}`,
        outputValue: limitedLoss.toFixed(4),
        unit: '-',
        detail: `η_tt estimada = ${(100 * (1 - limitedLoss)).toFixed(1)}%${custom.enabled ? '' : ' · activa el modelo para usarlo en el solver'}`,
      };
    },
  },

  // ==========================================
  // 5. SANDBOX Y FÓRMULAS LIBRES
  // ==========================================
  {
    id: 'sandbox_eval',
    name: 'Sandbox de Expresiones Matemáticas Libres',
    category: 'sandbox',
    subfolder: 'Sandbox & Personalización',
    latex: 'f(\\epsilon, AR, \\text{turning}, R_m) = \\dots',
    asciiFormula: 'custom_expression(...)',
    description: 'Entorno de cálculo en tiempo real donde puedes escribir cualquier expresión matemática en JavaScript seguro con acceso al alcance de variables de la etapa.',
    theoreticalRef: 'Evaluador Seguro de Álgebra de AI Studio Build',
    symbols: [
      { symbol: 'eps', name: 'Deflexión total en grados', unit: '°' },
      { symbol: 'AR', name: 'Relación de aspecto (h/c)', unit: '-' },
      { symbol: 'turning', name: 'Giro del álabe (|beta1 - beta2|)', unit: '°' },
      { symbol: 'Rm', name: 'Radio medio de la etapa', unit: 'm' },
    ],
    editableType: 'sandbox',
    evaluate: () => ({
      outputLabel: 'Sandbox Matemático Activo',
      outputValue: 'En línea',
      unit: '',
      detail: 'Introduce expresiones matemáticas personalizadas para evaluar en vivo',
    }),
  },
];
