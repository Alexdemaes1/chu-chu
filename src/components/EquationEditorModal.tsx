/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  type CustomEquationsConfig,
  type EquationEvaluationContext,
  type EquationNode,
  SAFE_DEFAULT_EQUATIONS,
  EQUATION_TEMPLATES,
  EQUATION_CATALOG,
  checkIfModified,
  evaluateCustomSoderberg,
  evaluateCustomBladeHeight,
  safeEvaluateMath,
  normalizeCustomEquations,
} from '../utils/customEquations';
import {
  X,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Code2,
  Sparkles,
  Download,
  Upload,
  Info,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  ShieldCheck,
  Cpu,
  Layers,
  Wind,
  Search,
  BookOpen,
  Compass,
  Gauge,
  Flame,
  Sigma,
  ChevronsUpDown,
  Save,
  Trash2,
} from 'lucide-react';

interface SavedEquationProfile {
  id: string;
  name: string;
  config: CustomEquationsConfig;
}

const PROFILES_STORAGE_KEY = 'axial-turbine.equation-profiles.v1';

const getExpressionError = (expression: string, scope: Record<string, number>, fallback: number) =>
  expression.trim() ? safeEvaluateMath(expression, scope, fallback).error : 'La expresión está vacía.';

interface EquationEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: CustomEquationsConfig;
  onSaveConfig: (newConfig: CustomEquationsConfig) => void;
  evalContext: EquationEvaluationContext;
  currentStageName: string;
}

export const EquationEditorModal: React.FC<EquationEditorModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  evalContext,
  currentStageName,
}) => {
  // Active selected equation node from the tree
  const [selectedEqId, setSelectedEqId] = useState<string>('thermo_state');
  // Draft configuration
  const [draft, setDraft] = useState<CustomEquationsConfig>({ ...config });
  // Tree search query
  const [searchQuery, setSearchQuery] = useState<string>('');
  // Expanded state for folders
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    thermodynamics: true,
    kinematics: true,
    geometry: true,
    losses: true,
    sandbox: true,
  });
  // Sandbox custom test state
  const [sandboxExpr, setSandboxExpr] = useState<string>('0.04 + 0.06 * Math.pow(eps / 100, 2) * (0.975 + 0.075 / AR)');
  const [sandboxResult, setSandboxResult] = useState<{ value: number; error: string | null } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string>(config.name);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [savedProfiles, setSavedProfiles] = useState<SavedEquationProfile[]>(() => {
    try {
      const stored = localStorage.getItem(PROFILES_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed
        .filter((profile) => profile && typeof profile.id === 'string' && typeof profile.name === 'string' && profile.config)
        .map((profile) => ({ ...profile, config: normalizeCustomEquations(profile.config) })) : [];
    } catch {
      return [];
    }
  });
  const [selectedUserEquationId, setSelectedUserEquationId] = useState<string>('');

  // Sync draft if external config changes
  React.useEffect(() => {
    setDraft({ ...config });
  }, [config, isOpen]);

  React.useEffect(() => {
    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(savedProfiles));
    } catch {
      // The profile remains available in memory for the current session.
    }
  }, [savedProfiles]);

  React.useEffect(() => {
    if (!draft.userEquations.some((equation) => equation.id === selectedUserEquationId)) {
      setSelectedUserEquationId(draft.userEquations[0]?.id ?? '');
    }
  }, [draft.userEquations, selectedUserEquationId]);

  const isModifiedFromSafe = useMemo(() => checkIfModified(draft), [draft]);

  // Selected equation definition
  const selectedNode = useMemo(() => {
    return EQUATION_CATALOG.find((eq) => eq.id === selectedEqId) || EQUATION_CATALOG[0];
  }, [selectedEqId]);

  // Group equations by category for STAR-CCM+ tree
  const categories = useMemo(() => {
    const list = [
      {
        id: 'thermodynamics',
        name: '1. Física Termodinámica & Expansión',
        icon: Flame,
        badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      },
      {
        id: 'kinematics',
        name: '2. Cinemática & Triángulos de Velocidad',
        icon: Wind,
        badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
      },
      {
        id: 'geometry',
        name: '3. Geometría & Canal Meridional',
        icon: Compass,
        badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      },
      {
        id: 'losses',
        name: '4. Modelos de Pérdidas Aerodinámicas',
        icon: Gauge,
        badgeColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
      },
      {
        id: 'sandbox',
        name: '5. Sandbox & Fórmulas Libres',
        icon: Code2,
        badgeColor: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
      },
    ];

    const q = searchQuery.toLowerCase().trim();

    return list.map((cat) => {
      const items = EQUATION_CATALOG.filter((eq) => eq.category === cat.id).filter((eq) => {
        if (!q) return true;
        return (
          eq.name.toLowerCase().includes(q) ||
          eq.asciiFormula.toLowerCase().includes(q) ||
          eq.description.toLowerCase().includes(q) ||
          eq.subfolder.toLowerCase().includes(q) ||
          eq.symbols.some((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
        );
      });

      // Subgroup by subfolder
      const subfolderMap: Record<string, EquationNode[]> = {};
      items.forEach((item) => {
        if (!subfolderMap[item.subfolder]) subfolderMap[item.subfolder] = [];
        subfolderMap[item.subfolder].push(item);
      });

      return {
        ...cat,
        items,
        subfolders: Object.entries(subfolderMap).map(([title, nodes]) => ({ title, nodes })),
      };
    });
  }, [searchQuery]);

  // Live evaluation of selected node
  const liveEvaluation = useMemo(() => {
    if (!selectedNode) return null;
    try {
      return selectedNode.evaluate(evalContext, draft);
    } catch {
      return {
        outputLabel: 'Error de evaluación',
        outputValue: 'N/A',
        unit: '',
        detail: 'Valores fuera de rango o divergencia matemática',
      };
    }
  }, [selectedNode, evalContext, draft]);

  const selectedUserEquation = draft.userEquations.find((equation) => equation.id === selectedUserEquationId);
  const userEquationEvaluation = useMemo(() => {
    if (!selectedUserEquation) return null;
    return safeEvaluateMath(selectedUserEquation.expression, {
      eps: evalContext.eps_deg,
      AR: evalContext.aspectRatio,
      turning: evalContext.eps_deg,
      Rm: evalContext.Rm_m,
      U: evalContext.U_ms,
      Va: evalContext.Va_ms,
      PR: evalContext.PR,
      m_dot: evalContext.m_dot,
      phi: evalContext.flowCoeff_phi,
      beta1: evalContext.beta1_deg,
      beta2: evalContext.beta2_deg,
      Mach: evalContext.Mach_abs1,
      MachRel: evalContext.Mach_rel1,
      dh_is_kJkg: evalContext.dh0_kJkg,
      eta_tt: evalContext.eta_tt,
    }, 0);
  }, [selectedUserEquation, evalContext]);

  const activeExpressionChecks = useMemo(() => {
    const checks: { label: string; error: string | null }[] = [];
    if (selectedNode.editableType === 'soderberg' && draft.soderberg.useCustomFormula) {
      checks.push(
        { label: 'ζ₀', error: getExpressionError(draft.soderberg.customExpression, { eps: 35, AR: 2.2 }, 0.05) },
        { label: 'Factor AR', error: getExpressionError(draft.soderberg.customArExpression, { eps: 35, AR: 2.2 }, 1) },
      );
    }
    if (selectedNode.editableType === 'ainley' && draft.ainleyMathieson.useCustomFormula) {
      const baseScope = {
        Yp_base: 0.08, Yp_nozzle: 0.05, Yp_impulse: 0.1, xi: 0.5, t_over_c: 0.2,
        s_over_c: 0.8, beta1: 0.25, beta2: 0.5, beta_m: 0.375, b1: 0.25, b2: 0.5, bm: 0.375,
        AR: 2, nozzleA: 0.025, nozzleB: 0.065, impulseA: 0.075, impulseB: 0.165,
        secondaryCoeff: 0.033, lambda: 0.0165, CL_sc: 0.8, B_tip: 0.5, tipClearanceRatio: 0.015,
        abs_alpha1: 30, alpha1: 0.5, alpha0: 0, alpha_m: 0.25,
      };
      checks.push(
        { label: 'Yp rotor', error: getExpressionError(draft.ainleyMathieson.customYpExpression, baseScope, 0.08) },
        { label: 'Yp estator', error: getExpressionError(draft.ainleyMathieson.customYpStatorExpression, baseScope, 0.05) },
        { label: 'Ys', error: getExpressionError(draft.ainleyMathieson.customYsExpression, baseScope, 0.02) },
        { label: 'Ytc', error: getExpressionError(draft.ainleyMathieson.customYtcExpression, baseScope, 0.01) },
      );
    }
    if (selectedNode.editableType === 'sizing' && draft.sizing.useCustomHeightFormula) {
      checks.push({ label: 'Altura h', error: getExpressionError(draft.sizing.customHeightExpression, { Area: 0.005, Area_ideal: 0.005, effectiveArea: 0.005, blockage: 0.02, Rm: 0.1 }, 0.01) });
    }
    if (selectedNode.editableType === 'zweifel' && draft.zweifel.useCustomZweifelFormula) {
      checks.push({ label: 'Zweifel ψ(s)', error: getExpressionError(draft.zweifel.customZweifelExpression, { s: 25, c_ax: 38, b1_rad: 0.3, b2_rad: 0.5, b1: 0.3, b2: 0.5, psi_Z: 0.85 }, 0.85) });
    }
    return checks;
  }, [selectedNode.editableType, draft.soderberg, draft.ainleyMathieson, draft.sizing, draft.zweifel]);

  if (!isOpen) return null;

  // Toggle folder open/collapse
  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const handleExpandAll = (expand: boolean) => {
    const updated: Record<string, boolean> = {};
    categories.forEach((c) => {
      updated[c.id] = expand;
    });
    setExpandedFolders(updated);
  };

  // Reset all to safe defaults
  const handleResetToSafeDefaults = () => {
    const safe = JSON.parse(JSON.stringify(SAFE_DEFAULT_EQUATIONS));
    setDraft(safe);
    setProfileName(safe.name);
    setSelectedProfileId('');
    onSaveConfig(safe);
  };

  // Reset specific equation category to safe default
  const handleResetCurrentEquation = () => {
    if (!selectedNode.editableType) return;
    const type = selectedNode.editableType;
    setDraft((prev) => {
      const safe = SAFE_DEFAULT_EQUATIONS;
      const updated = { ...prev };
      if (type === 'soderberg') updated.soderberg = JSON.parse(JSON.stringify(safe.soderberg));
      if (type === 'ainley') updated.ainleyMathieson = JSON.parse(JSON.stringify(safe.ainleyMathieson));
      if (type === 'sizing') updated.sizing = JSON.parse(JSON.stringify(safe.sizing));
      if (type === 'zweifel') updated.zweifel = JSON.parse(JSON.stringify(safe.zweifel));
      if (type === 'thermo') updated.thermodynamics = JSON.parse(JSON.stringify(safe.thermodynamics));
      if (type === 'kinematics') updated.kinematics = JSON.parse(JSON.stringify(safe.kinematics));
      if (type === 'geometry') updated.geometry = JSON.parse(JSON.stringify(safe.geometry));
      onSaveConfig(updated);
      return updated;
    });
  };

  // Apply industrial template
  const handleApplyTemplate = (templateId: string) => {
    const tmpl = EQUATION_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return;
    const merged: CustomEquationsConfig = {
      ...SAFE_DEFAULT_EQUATIONS,
      ...tmpl.config,
      name: tmpl.label,
      isModified: templateId !== 'default_safe',
    };
    setDraft(merged);
    setProfileName(tmpl.label);
    setSelectedProfileId('');
    onSaveConfig(merged);
  };

  const saveEquationProfile = () => {
    const name = profileName.trim();
    if (!name) {
      setImportError('Escribe un nombre para guardar la configuración.');
      return;
    }
    const existing = savedProfiles.find((profile) => profile.name.toLowerCase() === name.toLowerCase());
    const profile: SavedEquationProfile = {
      id: existing?.id ?? `profile-${Date.now()}`,
      name,
      config: normalizeCustomEquations({ ...draft, name }),
    };
    setSavedProfiles((previous) => existing
      ? previous.map((item) => item.id === existing.id ? profile : item)
      : [...previous, profile]);
    setSelectedProfileId(profile.id);
    setDraft(profile.config);
    onSaveConfig(profile.config);
    setImportError(null);
  };

  const applyEquationProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = savedProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    const applied = normalizeCustomEquations(profile.config);
    setDraft(applied);
    setProfileName(profile.name);
    onSaveConfig(applied);
  };

  const deleteEquationProfile = () => {
    if (!selectedProfileId) return;
    setSavedProfiles((previous) => previous.filter((profile) => profile.id !== selectedProfileId));
    setSelectedProfileId('');
  };

  const addUserEquation = () => {
    const id = `user-equation-${Date.now()}`;
    updateDraft((previous) => ({
      ...previous,
      userEquations: [...previous.userEquations, {
        id,
        name: `Ecuación ${previous.userEquations.length + 1}`,
        expression: 'eta_tt',
        description: 'Expresión añadida por el usuario. Aún no está asignada a una ecuación del solver.',
      }],
    }));
    setSelectedUserEquationId(id);
  };

  const updateUserEquation = (id: string, changes: Partial<CustomEquationsConfig['userEquations'][number]>) => {
    updateDraft((previous) => ({
      ...previous,
      userEquations: previous.userEquations.map((equation) => equation.id === id ? { ...equation, ...changes } : equation),
    }));
  };

  const deleteUserEquation = (id: string) => {
    updateDraft((previous) => ({
      ...previous,
      userEquations: previous.userEquations.filter((equation) => equation.id !== id),
    }));
  };

  // Export JSON configuration
  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `turbomachine_starccm_equations_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON configuration
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.soderberg || !parsed.ainleyMathieson) {
          throw new Error('Estructura de ecuaciones no válida');
        }
        const updated = normalizeCustomEquations({ ...parsed, isModified: true });
        setDraft(updated);
        setProfileName(updated.name);
        setSelectedProfileId('');
        onSaveConfig(updated);
      } catch (err: any) {
        setImportError(`Error al importar: ${err?.message || 'Archivo JSON corrupto'}`);
      }
    };
    reader.readAsText(file);
  };

  // Sandbox evaluator
  const testSandboxExpression = () => {
    const res = safeEvaluateMath(
      sandboxExpr,
      {
        eps: evalContext.eps_deg,
        AR: evalContext.aspectRatio,
        turning: evalContext.eps_deg,
        Rm: evalContext.Rm_m,
        U: evalContext.U_ms,
        Va: evalContext.Va_ms,
        PR: evalContext.PR,
        m_dot: evalContext.m_dot,
      },
      0.05
    );
    setSandboxResult(res);
  };

  const updateDraft = (updater: (prev: CustomEquationsConfig) => CustomEquationsConfig) => {
    const updated = updater({ ...draft, isModified: true });
    setDraft(updated);
    onSaveConfig(updated);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 md:p-4">
      <div className="bg-slate-950 border border-slate-700/80 rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* --- HEADER: STAR-CCM+ STYLE TOPBAR --- */}
        <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Árbol de Ecuaciones & Modelos de Física (Estilo STAR-CCM+)
                </h2>
                {isModifiedFromSafe ? (
                  <span className="px-2 py-0.5 text-[11px] font-mono font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    Modificado
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Punto Seguro (Canónico)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Ecuaciones termodinámicas, cinemáticas, geométricas y de pérdidas para:{' '}
                <span className="text-cyan-300 font-semibold">{currentStageName}</span>
              </p>
            </div>
          </div>

          {/* Action buttons: Reset Punto Seguro, Templates, Close */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetToSafeDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition-all shadow-sm"
              title="Restablecer todas las ecuaciones a valores bibliográficos seguros"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Punto Seguro Global</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Cerrar ventana"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* --- TEMPLATES & CONFIG BAR --- */}
        <div className="px-5 py-2 bg-slate-900/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 overflow-x-auto py-0.5">
            <span className="text-slate-400 font-semibold text-[11px] flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" /> Plantillas:
            </span>
            {EQUATION_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => handleApplyTemplate(tmpl.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all border whitespace-nowrap ${
                  draft.name === tmpl.label
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-semibold shadow'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:bg-slate-850 hover:text-slate-200'
                }`}
                title={tmpl.description}
              >
                {tmpl.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportJSON}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono transition-colors"
              title="Exportar calibración completa de ecuaciones a JSON"
            >
              <Download className="w-3 h-3 text-cyan-400" />
              <span>Exportar JSON</span>
            </button>
            <label className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono cursor-pointer transition-colors">
              <Upload className="w-3 h-3 text-amber-400" />
              <span>Importar JSON</span>
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>
          </div>
        </div>

        <div className="px-5 py-2.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center gap-2.5 text-xs">
          <span className="text-slate-300 font-semibold flex items-center gap-1.5"><Save className="w-3.5 h-3.5 text-cyan-400" /> Perfiles guardados</span>
          <select
            value={selectedProfileId}
            onChange={(e) => applyEquationProfile(e.target.value)}
            className="min-w-48 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200"
            aria-label="Cargar perfil de ecuaciones guardado"
          >
            <option value="">Cargar configuración…</option>
            {savedProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          <input
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Nombre de la configuración"
            aria-label="Nombre de la configuración de ecuaciones"
            className="min-w-48 flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-slate-500"
          />
          <button
            onClick={saveEquationProfile}
            className="flex items-center gap-1.5 rounded bg-cyan-700 hover:bg-cyan-600 px-3 py-1.5 text-white font-semibold"
            title="Guardar este conjunto de ecuaciones en este navegador"
          ><Save className="w-3.5 h-3.5" /> Guardar perfil</button>
          <button
            onClick={deleteEquationProfile}
            disabled={!selectedProfileId}
            className="flex items-center gap-1.5 rounded border border-slate-700 px-2.5 py-1.5 text-slate-300 hover:bg-rose-950 hover:text-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Eliminar el perfil seleccionado"
          ><Trash2 className="w-3.5 h-3.5" /> Eliminar</button>
          <span className="w-full text-[10px] text-slate-500">Se guardan automáticamente en este navegador. Usa JSON para trasladarlos a otro equipo.</span>
        </div>

        {/* Error message if file import fails */}
        {importError && (
          <div className="px-5 py-2 bg-rose-950/60 border-b border-rose-800 text-rose-300 text-xs flex items-center justify-between">
            <span>{importError}</span>
            <button onClick={() => setImportError(null)} className="text-rose-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* --- MAIN SPLIT CONTAINER: STAR-CCM+ TREE (LEFT) + INSPECTOR (RIGHT) --- */}
        <div className="flex-1 flex overflow-hidden">
          {/* ========================================================= */}
          {/* LEFT PANEL: STAR-CCM+ SIMULATION PHYSICS TREE EXPLORER   */}
          {/* ========================================================= */}
          <div className="w-80 md:w-96 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">
            {/* Tree search & quick controls */}
            <div className="p-3 border-b border-slate-800 bg-slate-900/40 flex flex-col gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrar ecuaciones o variables..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-900 border border-slate-700/80 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">Árbol de Simulación</span>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <button
                    onClick={() => handleExpandAll(true)}
                    className="hover:text-cyan-400 transition-colors"
                  >
                    [+ Expandir]
                  </button>
                  <button
                    onClick={() => handleExpandAll(false)}
                    className="hover:text-cyan-400 transition-colors"
                  >
                    [- Colapsar]
                  </button>
                </div>
              </div>
            </div>

            {/* Tree folder list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 font-mono text-xs select-none">
              {categories.map((cat) => {
                const isExpanded = expandedFolders[cat.id];
                const IconComponent = cat.icon;
                const hasModified =
                  (cat.id === 'losses' && (checkIfModified(draft) && (draft.soderberg.useCustomFormula || draft.soderberg.b !== 0.06 || draft.ainleyMathieson.secondaryCoeff !== 0.033))) ||
                  (cat.id === 'geometry' && draft.sizing.blockageFactor > 0);

                return (
                  <div key={cat.id} className="rounded-lg bg-slate-900/40 border border-slate-800/60 overflow-hidden">
                    {/* Folder Header */}
                    <button
                      onClick={() => toggleFolder(cat.id)}
                      className="w-full px-2.5 py-2 flex items-center justify-between hover:bg-slate-850/80 transition-colors text-left"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-200 text-xs truncate">
                          {cat.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasModified && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        )}
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400">
                          {cat.items.length}
                        </span>
                      </div>
                    </button>

                    {/* Subfolders & Equation Items */}
                    {isExpanded && (
                      <div className="pl-4 pr-1 py-1 space-y-1 border-t border-slate-800/40 bg-slate-950/60">
                        {cat.subfolders.map((sub) => (
                          <div key={sub.title} className="space-y-0.5">
                            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <span className="w-1 h-1 rounded-full bg-slate-600" />
                              <span>{sub.title}</span>
                            </div>

                            <div className="pl-2 space-y-0.5">
                              {sub.nodes.map((node) => {
                                const isSelected = selectedEqId === node.id;
                                return (
                                  <button
                                    key={node.id}
                                    onClick={() => setSelectedEqId(node.id)}
                                    className={`w-full px-2 py-1.5 rounded-md flex items-center justify-between text-left transition-all ${
                                      isSelected
                                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 font-semibold shadow-sm'
                                        : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 truncate">
                                      <FileCode className={`w-3 h-3 shrink-0 ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`} />
                                      <span className="truncate text-[11px]">{node.name}</span>
                                    </div>
                                    {node.editableType && (
                                      <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-300 uppercase shrink-0">
                                        edit
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tree Footer / Stage info */}
            <div className="p-2.5 border-t border-slate-800 bg-slate-900/60 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Etapa en cálculo:</span>
              <span className="text-cyan-300 font-mono font-semibold">{currentStageName}</span>
            </div>
          </div>

          {/* ========================================================= */}
          {/* RIGHT PANEL: STAR-CCM+ OBJECT & EQUATION INSPECTOR        */}
          {/* ========================================================= */}
          <div className="flex-1 bg-slate-900/20 overflow-y-auto p-4 md:p-6 flex flex-col gap-5">
            {/* Breadcrumb Path & Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                <span className="hover:text-slate-200">Simulación</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                <span className="hover:text-slate-200">{selectedNode.category}</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                <span className="text-cyan-400 font-semibold">{selectedNode.subfolder}</span>
              </div>

              {selectedNode.editableType && (
                <button
                  onClick={handleResetCurrentEquation}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-mono"
                  title="Restablecer los parámetros de esta ecuación a valores canónicos estándar"
                >
                  <RotateCcw className="w-3 h-3 text-cyan-400" />
                  <span>↺ Reset Ecuación a Punto Seguro</span>
                </button>
              )}
            </div>

            {/* Equation Title & Description Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white tracking-wide">
                    {selectedNode.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                    {selectedNode.description}
                  </p>
                </div>
                <div className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 font-mono shrink-0">
                  Ref: <span className="text-cyan-300 font-semibold">{selectedNode.theoreticalRef}</span>
                </div>
              </div>

              {/* Mathematical Equation Display Box (LaTeX style) */}
              <div className="bg-slate-950/90 border border-cyan-500/30 rounded-lg p-4 flex flex-col gap-2 shadow-inner">
                <div className="text-[11px] font-mono text-cyan-400 font-semibold uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Sigma className="w-3.5 h-3.5" /> Formulación Matemática
                  </span>
                  <span className="text-slate-400 font-normal lowercase">{selectedNode.asciiFormula}</span>
                </div>
                <div className="py-2 text-center text-lg md:text-xl font-serif text-cyan-100 tracking-wide select-all overflow-x-auto">
                  {selectedNode.latex}
                </div>
              </div>

              {/* Live Stage Evaluation Box */}
              {liveEvaluation && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded bg-cyan-950/80 border border-cyan-800 text-cyan-400">
                      <Gauge className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {liveEvaluation.outputLabel}:{' '}
                        <span className="text-cyan-300 font-mono text-sm ml-1 font-bold">
                          {liveEvaluation.outputValue} {liveEvaluation.unit}
                        </span>
                      </div>
                      {liveEvaluation.detail && (
                        <div className="text-[11px] text-slate-400 font-mono">
                          {liveEvaluation.detail}
                        </div>
                      )}
                      {activeExpressionChecks.map((check) => (
                        <div key={check.label} className={`text-[11px] font-mono ${check.error ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {check.label}: {check.error ? `expresión no válida (${check.error}); se usará la fórmula de respaldo` : 'expresión válida'}
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Evaluado en vivo para {currentStageName}
                  </span>
                </div>
              )}
            </div>

            {/* Variable Symbols & Units Table */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2.5">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <Info className="w-3.5 h-3.5 text-cyan-400" /> Variables & Unidades Físicas
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                      <th className="py-1.5 px-2">Símbolo</th>
                      <th className="py-1.5 px-2">Magnitud / Concepto</th>
                      <th className="py-1.5 px-2">Unidad SI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {selectedNode.symbols.map((s) => (
                      <tr key={s.symbol} className="hover:bg-slate-800/30">
                        <td className="py-1.5 px-2 text-cyan-300 font-semibold">{s.symbol}</td>
                        <td className="py-1.5 px-2 text-slate-300">{s.name}</td>
                        <td className="py-1.5 px-2 text-slate-400">{s.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ========================================================= */}
            {/* PARAMETRIC CONTROLS (IF EDITABLE NODE IS SELECTED)        */}
            {/* ========================================================= */}
            {selectedNode.editableType && (
              <div className="bg-slate-900/80 border border-cyan-500/30 rounded-xl p-5 flex flex-col gap-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-cyan-400" />
                    Parámetros Editables & Criterios Empíricos
                  </h4>
                  <span className="text-[11px] font-mono text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
                    Afecta en tiempo real al cálculo de la turbina
                  </span>
                </div>

                {/* 1. SODERBERG CONTROLS */}
                {selectedNode.editableType === 'soderberg' && (
                  <div className="space-y-4 text-xs font-mono">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Constante Base (a) [Def: 0.04]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.01"
                          max="0.15"
                          value={draft.soderberg.a}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.04;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, a: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Pérdida a deflexión nula.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Sensibilidad Angular (b) [Def: 0.06]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.01"
                          max="0.25"
                          value={draft.soderberg.b}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.06;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, b: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Ponderación cuadrática con ε.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Exponente de Deflexión (c) [Def: 2.0]</div>
                        <input
                          type="number"
                          step="0.1"
                          min="1.0"
                          max="3.5"
                          value={draft.soderberg.c}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 2.0;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, c: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Gradiente con deflexión ε.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Intercepto de Esbeltez (d) [Def: 0.975]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.8"
                          max="1.2"
                          value={draft.soderberg.d}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.975;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, d: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Término independiente de AR.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Penalización Pared (e) [Def: 0.075]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.01"
                          max="0.25"
                          value={draft.soderberg.e}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.075;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, e: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Penalización para 1/AR.</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.soderberg.useCustomFormula}
                          onChange={(e) => {
                            const chk = e.target.checked;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, useCustomFormula: chk } }));
                          }}
                          className="rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-0"
                        />
                        <span className="text-slate-300 text-xs font-semibold">
                          Habilitar Fórmula JavaScript Libre de Soderberg
                        </span>
                      </label>
                    </div>

                    {draft.soderberg.useCustomFormula && (
                      <div className="space-y-2 bg-slate-950 p-3 rounded-lg border border-cyan-500/40">
                        <div className="text-slate-400 text-[11px]">Expresión para ζ₀(eps):</div>
                        <input
                          type="text"
                          value={draft.soderberg.customExpression}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, customExpression: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 font-mono text-xs"
                        />
                        <div className="text-slate-400 text-[11px]">Expresión para Factor de Aspecto f(AR):</div>
                        <input
                          type="text"
                          value={draft.soderberg.customArExpression}
                          onChange={(e) => {
                            const val = e.target.value;
                            updateDraft((p) => ({ ...p, soderberg: { ...p.soderberg, customArExpression: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 font-mono text-xs"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 2. AINLEY-MATHIESON CONTROLS */}
                {selectedNode.editableType === 'ainley' && (
                  <div className="space-y-4 text-xs font-mono">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Tobera Base A [Def: 0.025]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.01"
                          max="0.10"
                          value={draft.ainleyMathieson.nozzleA}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.025;
                            updateDraft((p) => ({ ...p, ainleyMathieson: { ...p.ainleyMathieson, nozzleA: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Perfil pura tobera (α₁=0).</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Impulsión Base A [Def: 0.075]</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.02"
                          max="0.20"
                          value={draft.ainleyMathieson.impulseA}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.075;
                            updateDraft((p) => ({ ...p, ainleyMathieson: { ...p.ainleyMathieson, impulseA: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Perfil pura impulsión (R=0).</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Coef. Secundario λ [Def: 0.033]</div>
                        <input
                          type="number"
                          step="0.002"
                          min="0.01"
                          max="0.08"
                          value={draft.ainleyMathieson.secondaryCoeff}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.033;
                            updateDraft((p) => ({ ...p, ainleyMathieson: { ...p.ainleyMathieson, secondaryCoeff: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">Pérdida secundaria λ/AR.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Coef. Huelgo B_tip [Def: 0.50]</div>
                        <input
                          type="number"
                          step="0.05"
                          min="0.10"
                          max="0.80"
                          value={draft.ainleyMathieson.tipClearanceCoeff}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.50;
                            updateDraft((p) => ({ ...p, ainleyMathieson: { ...p.ainleyMathieson, tipClearanceCoeff: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-[10px] text-slate-400 mt-1 block">0.50 voladizo / 0.25 banda.</span>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 border-t border-slate-800 pt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.ainleyMathieson.useCustomFormula}
                        onChange={(e) => updateDraft((p) => ({
                          ...p,
                          ainleyMathieson: { ...p.ainleyMathieson, useCustomFormula: e.target.checked },
                        }))}
                        className="rounded text-cyan-500 bg-slate-900 border-slate-700"
                      />
                      <span className="text-slate-200 text-xs font-semibold">Usar expresiones personalizadas en el modelo A&amp;M</span>
                    </label>
                    {draft.ainleyMathieson.useCustomFormula && (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 bg-slate-950 p-3 rounded-lg border border-cyan-500/40">
                        {([
                          ['customYpExpression', 'Pérdida de perfil del rotor (Yp)', 'Yp_base * Math.pow(t_over_c / 0.20, xi)'],
                          ['customYpStatorExpression', 'Pérdida de perfil del estator', 'nozzleA + nozzleB * Math.pow(abs_alpha1 / 100, 2.4) * Math.pow(s_over_c, -0.4)'],
                          ['customYsExpression', 'Pérdida secundaria (Ys)', '(secondaryCoeff / AR) * Math.pow(CL_sc, 2) * Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3)'],
                          ['customYtcExpression', 'Pérdida de holgura (Ytc)', 'B_tip * tipClearanceRatio * Math.pow(CL_sc, 2) * Math.pow(Math.cos(b2), 2) / Math.pow(Math.cos(bm), 3)'],
                        ] as const).map(([key, label, placeholder]) => (
                          <label key={key} className="block space-y-1.5">
                            <span className="text-slate-300 text-[11px]">{label}</span>
                            <input
                              type="text"
                              value={draft.ainleyMathieson[key]}
                              onChange={(e) => updateDraft((p) => ({
                                ...p,
                                ainleyMathieson: { ...p.ainleyMathieson, [key]: e.target.value },
                              }))}
                              placeholder={placeholder}
                              className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-cyan-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                            />
                          </label>
                        ))}
                        <p className="xl:col-span-2 text-[11px] text-slate-400 leading-relaxed">
                          Expresiones permitidas: aritmética y funciones `Math.*`. Variables disponibles: Yp_base, Yp_nozzle, Yp_impulse, xi, t_over_c, s_over_c, nozzleA, nozzleB, impulseA, impulseB, secondaryCoeff, AR, CL_sc, b1, b2, bm, B_tip y tipClearanceRatio. Los resultados conservan límites físicos de seguridad.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. SIZING & BLOCKAGE CONTROLS */}
                {selectedNode.editableType === 'sizing' && (
                  <div className="space-y-4 text-xs font-mono">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-semibold">
                          Factor de Bloqueo de Capa Límite (K_bloqueo):
                        </span>
                        <span className="text-cyan-300 text-sm font-bold">
                          {(draft.sizing.blockageFactor * 100).toFixed(1)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="0.15"
                        step="0.005"
                        value={draft.sizing.blockageFactor}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          updateDraft((p) => ({ ...p, sizing: { ...p.sizing, blockageFactor: val } }));
                        }}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>0% (Ideal / Sin bloqueo)</span>
                        <span>4% (Típico turbina de gas)</span>
                        <span>8% - 15% (Microturbinas / Baja Re)</span>
                      </div>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <label className="block text-slate-300 text-[11px] mb-1">Relación de aspecto para cuerda automática (h/c)</label>
                      <input type="number" step="0.1" min="0.5" max="8" value={draft.sizing.aspectRatioTarget} onChange={(e) => updateDraft((p) => ({ ...p, sizing: { ...p.sizing, aspectRatioTarget: Math.max(0.5, Number(e.target.value) || 1.6) } }))} className="w-full bg-slate-900 border border-slate-700 px-2 py-1.5 rounded text-cyan-200" />
                      <span className="text-[10px] text-slate-400 mt-1 block">Se aplica cuando no se especifica una cuerda axial en Geometría.</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={draft.sizing.useCustomHeightFormula} onChange={(e) => updateDraft((p) => ({ ...p, sizing: { ...p.sizing, useCustomHeightFormula: e.target.checked } }))} className="rounded text-cyan-500 bg-slate-900 border-slate-700" />
                      <span className="text-slate-200 font-semibold">Usar ecuación personalizada de altura (afecta área y geometría)</span>
                    </label>
                    {draft.sizing.useCustomHeightFormula && (
                      <div className="bg-slate-950 p-3 rounded-lg border border-cyan-500/40 space-y-2">
                        <label className="block text-slate-300 text-[11px]">h = f(Area, effectiveArea, blockage, Rm)</label>
                        <input type="text" value={draft.sizing.customHeightExpression} onChange={(e) => updateDraft((p) => ({ ...p, sizing: { ...p.sizing, customHeightExpression: e.target.value } }))} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-cyan-200 font-mono text-xs" />
                        <p className="text-[11px] text-slate-400">La altura devuelta debe estar en metros. Ejemplo: (Area / (1 - blockage)) / (2 * Math.PI * Rm).</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. ZWEIFEL LOADING CONTROLS */}
                {selectedNode.editableType === 'zweifel' && (
                  <div className="space-y-4 text-xs font-mono">
                    <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300 font-semibold">
                          Coeficiente Objetivo de Carga Zweifel (Ψ_Z):
                        </span>
                        <span className="text-cyan-300 text-sm font-bold">
                          {draft.zweifel.psi_Z_target.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.60"
                        max="1.20"
                        step="0.02"
                        value={draft.zweifel.psi_Z_target}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          updateDraft((p) => ({ ...p, zweifel: { ...p.zweifel, psi_Z_target: val } }));
                        }}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>0.60 (Muy sólido / Conservador)</span>
                        <span>0.85 (Óptimo clásico Zweifel)</span>
                        <span>1.10 (Muy espaciado / Alto riesgo)</span>
                      </div>
                      <label className="block text-slate-300 text-[11px]">Multiplicador de la ecuación</label>
                      <input type="number" step="0.1" min="0.1" max="10" value={draft.zweifel.multiplier} onChange={(e) => updateDraft((p) => ({ ...p, zweifel: { ...p.zweifel, multiplier: Number(e.target.value) || 2 } }))} className="w-full bg-slate-900 border border-slate-700 px-2 py-1.5 rounded text-cyan-200" />
                      <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-slate-800">
                        <input type="checkbox" checked={draft.zweifel.useCustomZweifelFormula} onChange={(e) => updateDraft((p) => ({ ...p, zweifel: { ...p.zweifel, useCustomZweifelFormula: e.target.checked } }))} className="rounded text-cyan-500 bg-slate-900 border-slate-700" />
                        <span className="text-slate-200 font-semibold">Resolver paso con expresión personalizada</span>
                      </label>
                      {draft.zweifel.useCustomZweifelFormula && (
                        <div className="space-y-1.5">
                          <input type="text" value={draft.zweifel.customZweifelExpression} onChange={(e) => updateDraft((p) => ({ ...p, zweifel: { ...p.zweifel, customZweifelExpression: e.target.value } }))} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-cyan-200 font-mono text-xs" />
                          <p className="text-[11px] text-slate-400">Variables: s, c_ax, b1_rad, b2_rad, psi_Z. El paso se obtiene resolviendo la expresión numéricamente.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. THERMODYNAMIC CORRECTION CONTROLS */}
                {selectedNode.editableType === 'thermo' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Factor Reheat por Etapa (α_rh)</div>
                        <input
                          type="number"
                          step="0.005"
                          min="0.00"
                          max="0.05"
                          value={draft.thermodynamics.reheatFactorPerStage}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.015;
                            updateDraft((p) => ({ ...p, thermodynamics: { ...p.thermodynamics, reheatFactorPerStage: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">Compensación de isobaras multietapa.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Recuperación Cinética Inter-Etapa</div>
                        <input
                          type="number"
                          step="0.05"
                          min="0.00"
                          max="0.80"
                          value={draft.thermodynamics.kineticEnergyCarryOverFraction}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.0;
                            updateDraft((p) => ({ ...p, thermodynamics: { ...p.thermodynamics, kineticEnergyCarryOverFraction: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">Fracción de V₂ aprovechada en siguiente tobera.</span>
                      </div>
                    </div>
                  </div>
                )}

                {selectedNode.editableType === 'user_loss' && (
                  <div className="space-y-3 text-xs font-mono">
                    <label className="flex items-center gap-2 rounded-lg border border-cyan-800/60 bg-slate-950 p-3 text-slate-200">
                      <input type="checkbox" checked={draft.userDefinedLoss.enabled} onChange={(e) => updateDraft((p) => ({ ...p, userDefinedLoss: { ...p.userDefinedLoss, enabled: e.target.checked } }))} />
                      Usar este modelo propio en el solver
                    </label>
                    <label className="block space-y-1">
                      <span className="text-slate-400">Nombre del modelo</span>
                      <input value={draft.userDefinedLoss.name} onChange={(e) => updateDraft((p) => ({ ...p, userDefinedLoss: { ...p.userDefinedLoss, name: e.target.value } }))} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-slate-100" />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-slate-400">Fracción de salto isentrópico perdida: f_loss (adimensional)</span>
                      <textarea rows={3} value={draft.userDefinedLoss.lossFractionExpression} onChange={(e) => updateDraft((p) => ({ ...p, userDefinedLoss: { ...p.userDefinedLoss, lossFractionExpression: e.target.value } }))} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-cyan-200 font-mono" />
                    </label>
                    <p className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-[11px] leading-relaxed text-slate-300">Variables: dh_is, dh_actual, dh_loss_stator, dh_loss_rotor, dh_loss_soderberg, dh_loss_ainley, Mach, MachRel, MachRel2, U, Va, V1, W1, V2, W2, AR, eps, phi, psi, PR, m_dot, P01, T01, gamma, zeta_N, zeta_R, Yp_rotor, Ys_rotor, Ytc_rotor. La fracción se limita a [0, 0.95], por tanto η_tt = 1 − f_loss. Esta correlación propia requiere validación independiente.</p>
                    <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 text-[11px] text-emerald-200">Resultado en la etapa actual: {(() => {
                      const c = evalContext;
                      const fallback = c.dh_is_Jkg > 0 ? (c.dh_loss_stator_Jkg + c.dh_loss_rotor_Jkg) / c.dh_is_Jkg : 0;
                      const { value, error } = safeEvaluateMath(draft.userDefinedLoss.lossFractionExpression, {
                        dh_is: c.dh_is_Jkg, dh_actual: c.dh0_kJkg * 1000,
                        dh_loss_stator: c.dh_loss_stator_Jkg, dh_loss_rotor: c.dh_loss_rotor_Jkg,
                        dh_loss_soderberg: c.dh_loss_soderberg_Jkg, dh_loss_ainley: c.dh_loss_ainley_Jkg,
                        Mach: c.Mach_abs1, MachRel: c.Mach_rel1, MachRel2: c.Mach_rel2,
                        U: c.U_ms, Va: c.Va_ms, V1: c.V1_ms, W1: c.W1_ms, V2: c.V2_ms, W2: c.W2_ms,
                        AR: c.aspectRatio, eps: c.eps_deg, phi: c.flowCoeff_phi, psi: c.stageLoading_psi,
                        PR: c.PR, m_dot: c.m_dot, P01: c.P01_bar * 1e5, T01: c.T01_K,
                        gamma: c.gamma, zeta_N: c.zeta_N, zeta_R: c.zeta_R, Yp_rotor: c.Yp_rotor, Ys_rotor: c.Ys_rotor, Ytc_rotor: c.Ytc_rotor,
                      }, fallback);
                      return error ? <span className="text-rose-300">Expresión no válida: {error}; el solver usará la pérdida de Soderberg como respaldo.</span> : `${(Math.max(0, Math.min(0.95, value)) * 100).toFixed(2)}% de pérdida · η_tt ${(Math.max(5, 100 * (1 - value))).toFixed(1)}%`;
                    })()}</div>
                  </div>
                )}

                {/* 6. KINEMATIC & EULER CONTROLS */}
                {selectedNode.editableType === 'kinematics' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Multiplicador Trabajo Euler (Slip / Rendimiento)</div>
                        <input
                          type="number"
                          step="0.01"
                          min="0.80"
                          max="1.05"
                          value={draft.kinematics.eulerWorkMultiplier}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 1.0;
                            updateDraft((p) => ({ ...p, kinematics: { ...p.kinematics, eulerWorkMultiplier: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">Factor de corrección de trabajo específico.</span>
                      </div>

                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <div className="text-slate-400 text-[11px] mb-1">Límite Mínimo De Haller (W₂/W₁)</div>
                        <input
                          type="number"
                          step="0.02"
                          min="0.60"
                          max="0.85"
                          value={draft.kinematics.deHallerMin}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0.72;
                            updateDraft((p) => ({ ...p, kinematics: { ...p.kinematics, deHallerMin: val } }));
                          }}
                          className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block">Criterio clásico de desprendimiento (0.72).</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 7. GEOMETRY & VORTEX CONTROLS */}
                {selectedNode.editableType === 'geometry' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <div className="text-slate-400 text-[11px] mb-1">Exponente de Vórtice Radial (n en Vθ · r^n = cte)</div>
                      <input
                        type="number"
                        step="0.1"
                        min="0.0"
                        max="1.5"
                        value={draft.geometry.freeVortexExponent}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 1.0;
                          updateDraft((p) => ({ ...p, geometry: { ...p.geometry, freeVortexExponent: val } }));
                        }}
                        className="w-full bg-slate-900 border border-slate-700 px-2 py-1 rounded text-cyan-300 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">1.0 = Free Vortex canónico (dH0/dr = 0).</span>
                    </div>
                  </div>
                )}

                {/* 8. SANDBOX FREE EXPRESSION EVALUATOR */}
                {selectedNode.editableType === 'sandbox' && (
                  <div className="space-y-3 text-xs font-mono">
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Expresión matemática (aritmética y funciones Math permitidas):</span>
                        <span className="text-slate-500">Variables disponibles: eps, AR, turning, Rm, U, Va, PR, m_dot</span>
                      </div>
                      <textarea
                        rows={2}
                        value={sandboxExpr}
                        onChange={(e) => setSandboxExpr(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 px-2.5 py-1.5 rounded text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono text-xs"
                      />
                      <div className="flex items-center justify-between">
                        <button
                          onClick={testSandboxExpression}
                          className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-colors flex items-center gap-1.5 shadow"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Evaluar Expresión en Vivo</span>
                        </button>
                        {sandboxResult && (
                          <div className={`px-2.5 py-1 rounded font-bold ${sandboxResult.error ? 'bg-rose-950/80 text-rose-300 border border-rose-800' : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'}`}>
                            {sandboxResult.error ? sandboxResult.error : `Resultado = ${sandboxResult.value.toFixed(6)}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-950 p-3 rounded-lg border border-purple-800/60 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h5 className="text-slate-100 font-semibold">Biblioteca de ecuaciones de usuario</h5>
                          <p className="text-[11px] text-slate-400 mt-1">Añade expresiones, pruébalas con el punto actual y guárdalas dentro de un perfil.</p>
                        </div>
                        <button onClick={addUserEquation} className="px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-600 text-white font-semibold flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" /> Añadir ecuación
                        </button>
                      </div>
                      {draft.userEquations.length > 0 && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={selectedUserEquationId}
                              onChange={(e) => setSelectedUserEquationId(e.target.value)}
                              className="min-w-52 flex-1 bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-slate-100"
                              aria-label="Seleccionar ecuación de usuario"
                            >
                              {draft.userEquations.map((equation) => <option key={equation.id} value={equation.id}>{equation.name}</option>)}
                            </select>
                            {selectedUserEquation && <button onClick={() => deleteUserEquation(selectedUserEquation.id)} className="px-2.5 py-2 rounded border border-rose-800 text-rose-300 hover:bg-rose-950 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Eliminar ecuación</button>}
                          </div>
                          {selectedUserEquation && (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                              <label className="block space-y-1.5">
                                <span className="text-[11px] text-slate-300">Nombre</span>
                                <input value={selectedUserEquation.name} onChange={(e) => updateUserEquation(selectedUserEquation.id, { name: e.target.value })} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-slate-100" />
                              </label>
                              <label className="block space-y-1.5">
                                <span className="text-[11px] text-slate-300">Descripción</span>
                                <input value={selectedUserEquation.description} onChange={(e) => updateUserEquation(selectedUserEquation.id, { description: e.target.value })} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-slate-100" />
                              </label>
                              <label className="block space-y-1.5 xl:col-span-2">
                                <span className="text-[11px] text-slate-300">Expresión (se evalúa en tiempo real)</span>
                                <textarea rows={2} value={selectedUserEquation.expression} onChange={(e) => updateUserEquation(selectedUserEquation.id, { expression: e.target.value })} className="w-full bg-slate-900 border border-slate-700 px-2.5 py-2 rounded text-cyan-200 font-mono text-xs" />
                              </label>
                              <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
                                <span className="text-[11px] text-slate-400">Variables: eps, AR, turning, Rm, U, Va, PR, m_dot, phi, beta1, beta2, Mach, MachRel, dh_is_kJkg, eta_tt</span>
                                {userEquationEvaluation && (
                                  <span className={`font-mono text-xs font-semibold ${userEquationEvaluation.error ? 'text-rose-300' : 'text-emerald-300'}`}>
                                    {userEquationEvaluation.error ? `Fórmula inválida: ${userEquationEvaluation.error}` : `Resultado de prueba: ${userEquationEvaluation.value.toPrecision(6)}`}
                                  </span>
                                )}
                              </div>
                              <p className="xl:col-span-2 text-[11px] text-amber-200/90 leading-relaxed">Estas ecuaciones se guardan y evalúan como pruebas independientes. Para que una ecuación nueva altere el diseño debe conectarse explícitamente a un modelo del solver; las expresiones personalizadas de Soderberg y A&amp;M sí están conectadas.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* --- FOOTER: SUMMARY & ACCEPT --- */}
        <div className="px-5 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-400">
            <Info className="w-3.5 h-3.5 text-cyan-400" />
            <span>Los parámetros y expresiones conectados se aplican en tiempo real; guarda un perfil para conservar este conjunto.</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetToSafeDefaults}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Restablecer Todo
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-all shadow-md shadow-cyan-950"
            >
              Aceptar y Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
