import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CircleAlert, FileSpreadsheet, Layers, Wind, X } from 'lucide-react';
import { NOTICE_ACTION_LABELS, useTurbineDesign, type Notice, type NoticeAction } from './hooks/useTurbineDesign';
import { AppHeader } from './components/layout/AppHeader';
import { GuideModal, type GuideTarget } from './components/layout/GuideModal';
import { InputsPanel, GLOBAL_FIELD_IDS, type InputsTab } from './components/inputs/InputsPanel';
import { STAGE_FIELD_IDS } from './components/inputs/StageEditor';
import { SWEEP_PANEL_ID, SWEEP_RUN_BUTTON_ID } from './components/inputs/SweepPanel';
import { ReadinessChecklist } from './components/inputs/ReadinessChecklist';
import { KpiStrip } from './components/results/KpiStrip';
import { ResultsTable } from './components/results/ResultsTable';
import { AlertsPanel } from './components/results/AlertsPanel';
import { VelocityTrianglesSvg } from './components/VelocityTrianglesSvg';
import { BaljeSmithCharts } from './components/BaljeSmithCharts';
import { Tabs, TabPanel } from './components/ui/Tabs';
import type { DesignBlocker, DesignField } from './utils/designState';

// Componentes pesados (three.js, canvas) y modales en chunks aparte: la primera carga es más ligera.
const loadRotor3D = () => import('./components/Rotor3DVisualizer');
const Rotor3DVisualizer = lazy(() => loadRotor3D().then((module) => ({ default: module.Rotor3DVisualizer })));
const BladeProfileCanvas = lazy(() => import('./components/BladeProfileCanvas').then((module) => ({ default: module.BladeProfileCanvas })));
const EquationEditorModal = lazy(() => import('./components/EquationEditorModal').then((module) => ({ default: module.EquationEditorModal })));
const TurbineDocumentationModal = lazy(() => import('./components/TurbineDocumentationModal').then((module) => ({ default: module.TurbineDocumentationModal })));

type AnalysisTab = 'triangles' | 'table' | 'audit' | 'balje';

const RESULTS_SECTION_ID = 'results-panel';
const INPUTS_SECTION_ID = 'inputs-panel';
const ANALYSIS_TABS_ID = 'analysis';
const NOTICE_TIMEOUT_MS = 6000;

const FIELD_TARGETS: Record<DesignField, string> = {
  gasKey: GLOBAL_FIELD_IDS.gasKey,
  m_dot: GLOBAL_FIELD_IDS.m_dot,
  P01: GLOBAL_FIELD_IDS.P01,
  T01: GLOBAL_FIELD_IDS.T01,
  N: STAGE_FIELD_IDS.N,
  R: STAGE_FIELD_IDS.R,
  rowConfiguration: STAGE_FIELD_IDS.rowConfiguration,
  shaftTarget: STAGE_FIELD_IDS.shaftTarget,
  coefficients: SWEEP_RUN_BUTTON_ID,
  Rm: SWEEP_RUN_BUTTON_ID,
};

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Desplaza hasta un elemento (y opcionalmente le da el foco) cuando ya está pintado. */
function revealElement(id: string, focusId?: string) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const element = document.getElementById(id);
      if (!element) return;
      element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: focusId === undefined ? 'start' : 'center' });
      const focusTarget = focusId ? document.getElementById(focusId) : null;
      focusTarget?.focus({ preventScroll: true });
    });
  });
}

const fmt = (value: number, digits: number) =>
  Number.isFinite(value) ? value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

function ViewerFallback({ label, className }: { label: string; className: string }) {
  return (
    <div className={`flex items-center justify-center rounded-card border border-line bg-surface-muted text-body text-ink-3 ${className}`}>
      {label}
    </div>
  );
}

function NoticeToast({ notice, onDismiss, onAction }: {
  notice: Notice;
  onDismiss: () => void;
  onAction: (action: NoticeAction) => void;
}) {
  useEffect(() => {
    // Los avisos con algo que copiar o con una acción no se cierran solos: necesitan tiempo.
    if (notice.copyable || notice.action) return undefined;
    const timer = window.setTimeout(onDismiss, NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  const tone = {
    ok: 'border-emerald-300 bg-ok-soft text-ok',
    warn: 'border-amber-300 bg-warn-soft text-warn',
    danger: 'border-rose-300 bg-danger-soft text-danger',
    info: 'border-line-strong bg-surface text-ink-2',
  }[notice.tone];

  return (
    <div
      data-noprint
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className={`fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-card border p-3 shadow-modal sm:inset-x-auto sm:right-4 sm:bottom-4 ${tone}`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-body font-medium">{notice.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent-strong"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {notice.action && (
        <button
          type="button"
          onClick={() => {
            const action = notice.action;
            onDismiss();
            if (action) onAction(action);
          }}
          className="btn-secondary mt-2 h-8 px-2.5 text-label"
        >
          {NOTICE_ACTION_LABELS[notice.action]}
        </button>
      )}
      {notice.copyable && (
        <input
          type="text"
          readOnly
          value={notice.copyable}
          aria-label="Enlace del diseño"
          onFocus={(event) => event.currentTarget.select()}
          className="field mt-2 w-full font-mono text-caption"
        />
      )}
    </div>
  );
}

export default function App() {
  const model = useTurbineDesign();
  const {
    design,
    multiResults,
    activeResult,
    activeStage,
    activeStageIdx,
    activeBladeDesign,
    statorGeometry,
    blockers,
    isReady,
    stale,
    auditCounts,
    diagnostics,
    notice,
  } = model;

  const [inputsTab, setInputsTab] = useState<InputsTab>('operation');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('triangles');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isEquationsOpen, setIsEquationsOpen] = useState(false);

  // El visor 3D (three.js) se descarga en segundo plano cuando el navegador está libre.
  useEffect(() => {
    const preload = () => {
      void loadRotor3D();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const openAlerts = useCallback(() => {
    setAnalysisTab('audit');
    revealElement(RESULTS_SECTION_ID);
  }, []);

  const goToSweep = useCallback(() => {
    setInputsTab('operation');
    revealElement(SWEEP_PANEL_ID, SWEEP_RUN_BUTTON_ID);
  }, []);

  const selectBlocker = useCallback((blocker: DesignBlocker) => {
    if (blocker.stageIndex !== undefined) model.setActiveStageIdx(blocker.stageIndex);
    setInputsTab('operation');
    const target = FIELD_TARGETS[blocker.field];
    revealElement(target, target);
  }, [model]);

  const navigateFromGuide = useCallback((target: GuideTarget) => {
    if (target === 'operation') {
      setInputsTab('operation');
      revealElement(INPUTS_SECTION_ID);
    } else if (target === 'sweep') {
      goToSweep();
    } else if (target === 'geometry') {
      setInputsTab('geometry');
      revealElement(INPUTS_SECTION_ID);
    } else {
      setAnalysisTab('triangles');
      revealElement(RESULTS_SECTION_ID);
    }
  }, [goToSweep]);

  const confirmAndRun = (message: string, action: () => void) => {
    if (window.confirm(message)) action();
  };

  const stageCount = design.stages.length;
  const isVanelessCoupled = activeStageIdx > 0
    && (activeStage?.rowConfiguration === 'counterrotating' || activeStage?.interStageCoupling === 'vaneless');
  const diagnosticsTotal = auditCounts ? auditCounts.critical + auditCounts.warning : 0;

  return (
    <div className="flex min-h-dvh w-full flex-col overflow-x-clip bg-canvas text-ink-2">
      <AppHeader
        designName={design.name}
        onDesignNameChange={model.setDesignName}
        audit={auditCounts}
        onOpenAlerts={openAlerts}
        onOpenDocs={() => setIsDocsOpen(true)}
        onOpenEquations={() => setIsEquationsOpen(true)}
        isCustomEquationsActive={model.isCustomEquationsActive}
        onOpenGuide={() => setIsGuideOpen(true)}
        onResetExample={() => confirmAndRun(
          '¿Restablecer el ejemplo? Se sustituirá el diseño actual (expórtalo antes si quieres conservarlo).',
          model.loadExample,
        )}
        onNewDesign={() => confirmAndRun(
          '¿Empezar un diseño nuevo vacío? Se sustituirá el diseño actual (expórtalo antes si quieres conservarlo).',
          model.newDesign,
        )}
        onShareLink={() => {
          void model.shareLink();
        }}
        onExportJson={model.exportDesignFile}
        onImportFile={(file) => {
          void model.importDesignFile(file);
        }}
      />

      <div className="mx-auto w-full max-w-[1800px] space-y-3 px-3 pt-3 sm:px-4 xl:px-6">
        <KpiStrip
          result={multiResults}
          lossModelLabel={model.lossModelLabel}
          audit={auditCounts}
          stale={stale}
          onOpenAlerts={openAlerts}
        />
        {stale && (
          <div role="status" className="flex flex-col gap-2 rounded-card border border-amber-300 bg-warn-soft px-4 py-3 text-warn sm:flex-row sm:items-center">
            <p className="flex flex-1 items-start gap-2 text-body font-medium">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Diseño desactualizado: la potencia ya no coincide con el objetivo; vuelve a lanzar el barrido.
            </p>
            <button type="button" onClick={goToSweep} className="btn-primary shrink-0">
              Ir al barrido
            </button>
          </div>
        )}
        {model.calculationError && (
          <p role="alert" className="flex items-start gap-2 rounded-card border border-rose-300 bg-danger-soft px-4 py-3 text-body text-danger">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {model.calculationError}
          </p>
        )}
      </div>

      <main className="mx-auto grid w-full min-w-0 max-w-[1800px] flex-1 grid-cols-1 items-start gap-4 px-3 py-3 sm:px-4 lg:grid-cols-2 xl:grid-cols-12 xl:gap-5 xl:px-6">
        {/* Resultados: primero en móvil, a la derecha en tableta y escritorio. */}
        <section
          id={RESULTS_SECTION_ID}
          aria-label="Resultados y análisis"
          className="order-1 min-w-0 scroll-mt-20 lg:order-2 xl:order-3 xl:col-span-3 xl:sticky xl:top-16 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto"
        >
          <div className="rounded-card border border-line bg-surface shadow-card">
            <div className="space-y-2 border-b border-line p-2">
              {stageCount > 1 && (
                <label className="flex items-center gap-2 px-1 text-label text-ink-3">
                  Etapa
                  <select
                    value={activeStageIdx}
                    onChange={(event) => model.setActiveStageIdx(Number(event.target.value))}
                    className="field h-9 min-w-0 flex-1 text-base sm:text-sm"
                  >
                    {design.stages.map((stage, index) => (
                      <option key={stage.id} value={index}>{stage.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <Tabs<AnalysisTab>
                idBase={ANALYSIS_TABS_ID}
                label="Análisis del diseño"
                layout="wrap"
                value={analysisTab}
                onChange={setAnalysisTab}
                items={[
                  { id: 'triangles', label: 'Triángulos', icon: <Wind className="h-4 w-4" aria-hidden="true" /> },
                  { id: 'table', label: 'Resultados', icon: <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> },
                  {
                    id: 'audit',
                    label: 'Alertas',
                    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
                    badge: diagnosticsTotal > 0
                      ? <span className="rounded-full bg-warn-soft px-1.5 text-caption tabular-nums text-warn">{diagnosticsTotal}</span>
                      : undefined,
                  },
                  { id: 'balje', label: 'Mapas', icon: <Layers className="h-4 w-4" aria-hidden="true" />, title: 'Diagramas de Balje (Ns–Ds) y de Smith (φ–ψ)' },
                ]}
              />
            </div>

            {!isReady && (
              <div className="space-y-3 p-4">
                <p className="text-body text-ink-3">Completa el diseño para ver los resultados.</p>
                <ReadinessChecklist blockers={blockers} onSelect={selectBlocker} />
              </div>
            )}

            <TabPanel idBase={ANALYSIS_TABS_ID} id="triangles" active={analysisTab === 'triangles' && activeResult !== null} className="space-y-3 p-3">
              {activeResult && activeStage && (
                <>
                  <VelocityTrianglesSvg
                    inlet={activeResult.inletTriangle}
                    outlet={activeResult.outletTriangle}
                    U={activeResult.U}
                    turbineType={activeStage.turbineType}
                    stageName={activeStage.name}
                    direction={activeStage.direction}
                    isVanelessCoupled={isVanelessCoupled}
                  />
                  <dl className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'U media', value: fmt(Math.abs(activeResult.U), 1), unit: 'm/s' },
                      { label: `ηtt de la etapa (${model.lossModelLabel})`, value: fmt(activeResult.efficiency_recommended * 100, 1), unit: '%' },
                      { label: 'Potencia de la etapa', value: fmt(activeResult.power_kW, 1), unit: 'kW' },
                      { label: 'M salida estator · M rel. salida rotor', value: `${fmt(activeResult.inletTriangle.Mach_abs, 2)} · ${fmt(activeResult.outletTriangle.Mach_rel, 2)}`, unit: '' },
                    ].map((tile) => (
                      <div key={tile.label} className="rounded-lg bg-surface-muted px-3 py-2">
                        <dt className="text-caption text-ink-3">{tile.label}</dt>
                        <dd className="mt-0.5 text-body font-semibold tabular-nums text-ink">
                          {tile.value}
                          {tile.unit && <span className="ml-1 text-label font-normal text-ink-3">{tile.unit}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </TabPanel>

            <TabPanel idBase={ANALYSIS_TABS_ID} id="table" active={analysisTab === 'table' && multiResults !== null} className="p-3">
              {multiResults && <ResultsTable result={multiResults} activeStageIdx={activeStageIdx} />}
            </TabPanel>

            <TabPanel idBase={ANALYSIS_TABS_ID} id="audit" active={analysisTab === 'audit' && isReady} className="p-3">
              <AlertsPanel diagnostics={diagnostics} />
            </TabPanel>

            <TabPanel idBase={ANALYSIS_TABS_ID} id="balje" active={analysisTab === 'balje' && activeResult !== null} className="p-3">
              {activeResult && activeStage && (
                <BaljeSmithCharts
                  Ns={activeResult.Ns}
                  Ds={activeResult.Ds}
                  phi={activeResult.phi}
                  psi={activeResult.psi}
                  etaBalje={activeResult.eta_Balje}
                  etaModel={activeResult.efficiency_recommended}
                  etaModelLabel={`η_tt (${model.lossModelLabel})`}
                  turbineType={activeStage.turbineType}
                />
              )}
            </TabPanel>
          </div>
        </section>

        {/* Entradas: tras los resultados en móvil, a la izquierda en tableta y escritorio. */}
        <aside
          id={INPUTS_SECTION_ID}
          aria-label="Entradas del diseño"
          className="order-2 min-w-0 scroll-mt-20 lg:order-1 xl:col-span-3 xl:sticky xl:top-16 xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto"
        >
          <InputsPanel model={model} tab={inputsTab} onTabChange={setInputsTab} onSelectBlocker={selectBlocker} />
        </aside>

        {/* Visores: al final en móvil, a todo el ancho en tableta y en el centro en escritorio. */}
        <section aria-label="Visores de geometría" className="order-3 flex min-w-0 flex-col gap-4 lg:col-span-2 xl:order-2 xl:col-span-6">
          {activeBladeDesign && activeStage ? (
            <>
              <Suspense fallback={<ViewerFallback label="Cargando visor 3D…" className="h-[45vh] sm:h-[min(68vh,580px)]" />}>
                <Rotor3DVisualizer
                  radialDesign={activeBladeDesign}
                  stageName={activeStage.name}
                  rpm={activeStage.N}
                  rotationDirection={activeStage.direction}
                  statorGeometry={statorGeometry ?? undefined}
                />
              </Suspense>
              <Suspense fallback={<ViewerFallback label="Cargando perfil 2D…" className="h-[380px] sm:h-[460px] xl:h-[520px]" />}>
                <BladeProfileCanvas radialDesign={activeBladeDesign} stageName={activeStage.name} />
              </Suspense>
            </>
          ) : (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-card border border-line bg-surface p-6 text-center shadow-card">
              <p className="max-w-md text-body text-ink-3">
                El rotor 3D y el perfil del álabe aparecen en cuanto el diseño está completo.
              </p>
              <ReadinessChecklist blockers={blockers} onSelect={selectBlocker} className="w-full max-w-md text-left" />
            </div>
          )}
        </section>
      </main>

      {notice && (
        <NoticeToast
          key={notice.id}
          notice={notice}
          onDismiss={model.dismissNotice}
          onAction={(action) => {
            if (action === 'restore-backup') model.restoreBackupDesign();
          }}
        />
      )}

      <GuideModal open={isGuideOpen} onClose={() => setIsGuideOpen(false)} onNavigate={navigateFromGuide} />

      {isDocsOpen && (
        <Suspense fallback={null}>
          <TurbineDocumentationModal isOpen onClose={() => setIsDocsOpen(false)} />
        </Suspense>
      )}

      {isEquationsOpen && (
        <Suspense fallback={null}>
          <EquationEditorModal
            isOpen
            onClose={() => setIsEquationsOpen(false)}
            config={model.customEquations}
            onSaveConfig={model.saveCustomEquations}
            evalContext={model.equationContext}
            currentStageName={activeStage?.name ?? ''}
          />
        </Suspense>
      )}
    </div>
  );
}
