import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Copy, MoreHorizontal, Pencil, Plus, RotateCw, RotateCcw, Trash2 } from 'lucide-react';
import { NumberField } from '../ui/NumberField';
import { shaftNameOf } from '../../utils/designOptimization';
import { isReactionSet, MAX_REACTION, MAX_STAGES, type DesignField } from '../../utils/designState';
import { COPY_STAGE_BLOCKED_MESSAGE, hasCoefficients, type TurbineDesignModel } from '../../hooks/useTurbineDesign';

export const STAGE_FIELD_IDS = {
  rowConfiguration: 'field-stage-config',
  direction: 'field-stage-direction',
  shaft: 'field-stage-shaft',
  shaftTarget: 'field-shaft-target',
  N: 'field-stage-n',
  R: 'field-stage-r',
} as const;

const SHAFT_OPTIONS = ['Eje 1', 'Eje 2', 'Eje 3'];

const formatNumber = (value: number, digits: number) =>
  Number.isFinite(value)
    ? value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';

interface StageMenuProps {
  stageName: string;
  canDelete: boolean;
  canDuplicate: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function StageMenu({ stageName, canDelete, canDuplicate, onRename, onDuplicate, onDelete }: StageMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    containerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const itemClass =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-body text-ink-2 hover:bg-surface-muted hover:text-ink focus-visible:bg-surface-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Opciones de ${stageName}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 w-7 items-center justify-center rounded-md text-current hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-strong"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Opciones de ${stageName}`}
          onKeyDown={onKeyDown}
          className="absolute left-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-modal"
        >
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => run(onRename)}>
            <Pencil className="h-4 w-4 text-ink-3" aria-hidden="true" /> Renombrar
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className={itemClass} disabled={!canDuplicate} onClick={() => run(onDuplicate)}>
            <Copy className="h-4 w-4 text-ink-3" aria-hidden="true" /> Duplicar
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`${itemClass} text-danger hover:text-danger`}
            disabled={!canDelete}
            title={canDelete ? undefined : 'El diseño necesita al menos una etapa'}
            onClick={() => run(onDelete)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

export interface StageEditorProps {
  model: TurbineDesignModel;
}

export function StageEditor({ model }: StageEditorProps) {
  const {
    design,
    activeStageIdx,
    activeStage,
    activeResult,
    activeShaftStatus,
    activeShaftTarget,
    shaftWarnings,
    blockers,
  } = model;
  const stages = design.stages;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const configHintId = useId();
  const addStageHintId = useId();

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

  if (!activeStage) return null;

  const errorOf = (field: DesignField) =>
    blockers.find((blocker) => blocker.stageIndex === activeStageIdx && blocker.field === field)?.message;

  const shaftName = shaftNameOf(activeStage);
  const shaftOptions = [...new Set([...SHAFT_OPTIONS, ...stages.map((stage) => shaftNameOf(stage))])];
  const reactionSet = isReactionSet(design, activeStage.id);
  const isFirst = activeStageIdx === 0;
  const addStageHint = stages.length < MAX_STAGES && !model.canAddStage ? COPY_STAGE_BLOCKED_MESSAGE : null;

  const startRename = (id: string, name: string) => {
    setRenameDraft(name);
    setRenamingId(id);
  };
  const finishRename = (index: number, save: boolean) => {
    if (save) model.renameStage(index, renameDraft);
    setRenamingId(null);
  };

  const confirmDelete = (index: number) => {
    const name = stages[index]?.name ?? `Etapa ${index + 1}`;
    if (window.confirm(`¿Eliminar «${name}»? Esta acción no se puede deshacer.`)) model.removeStage(index);
  };

  return (
    <section aria-labelledby="stage-editor-title" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id="stage-editor-title" className="text-label font-semibold text-ink">Etapas</h3>
        <button
          type="button"
          onClick={model.addStage}
          disabled={!model.canAddStage}
          aria-describedby={addStageHint ? addStageHintId : undefined}
          title={stages.length >= MAX_STAGES ? `Máximo ${MAX_STAGES} etapas` : 'Añade una etapa con la velocidad, reacción y eje de la anterior'}
          className="btn-secondary h-8 px-2.5 text-label"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Añadir etapa
        </button>
      </div>
      {addStageHint && <p id={addStageHintId} className="text-caption text-ink-3">{addStageHint}</p>}

      <ul className="flex flex-wrap gap-1.5" aria-label="Etapas del diseño">
        {stages.map((stage, index) => {
          const active = index === activeStageIdx;
          const label = `${stage.name} · ${shaftNameOf(stage)}`;
          return (
            <li
              key={stage.id}
              className={`flex items-center rounded-lg border pl-1 ${
                active ? 'border-accent bg-accent-soft text-accent-strong' : 'border-line-strong bg-surface text-ink-2'
              }`}
            >
              {renamingId === stage.id ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  aria-label={`Nuevo nombre de ${stage.name}`}
                  value={renameDraft}
                  maxLength={80}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => finishRename(index, true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') finishRename(index, true);
                    if (event.key === 'Escape') finishRename(index, false);
                  }}
                  className="field h-8 w-36 text-label"
                />
              ) : (
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => model.setActiveStageIdx(index)}
                  onDoubleClick={() => startRename(stage.id, stage.name)}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-label font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-strong"
                  title={stage.direction === -1 ? `${label} (sentido opuesto)` : label}
                >
                  {stage.direction === -1
                    ? <RotateCcw className="h-3.5 w-3.5" aria-label="sentido opuesto" />
                    : <RotateCw className="h-3.5 w-3.5" aria-label="sentido positivo" />}
                  {label}
                </button>
              )}
              <StageMenu
                stageName={stage.name}
                canDelete={stages.length > 1}
                canDuplicate={stages.length < MAX_STAGES && hasCoefficients(stage)}
                onRename={() => startRename(stage.id, stage.name)}
                onDuplicate={() => model.duplicateStage(index)}
                onDelete={() => confirmDelete(index)}
              />
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={STAGE_FIELD_IDS.rowConfiguration} className="text-label font-medium text-ink-2">Configuración</label>
          <select
            id={STAGE_FIELD_IDS.rowConfiguration}
            value={activeStage.rowConfiguration ?? 'normal'}
            onChange={(event) => model.setRowConfiguration(activeStageIdx, event.target.value === 'counterrotating' ? 'counterrotating' : 'normal')}
            aria-describedby={isFirst ? configHintId : undefined}
            aria-invalid={errorOf('rowConfiguration') ? true : undefined}
            className="field h-10 w-full text-base sm:h-9 sm:text-sm"
          >
            <option value="normal">Normal · estator + rotor</option>
            <option value="counterrotating" disabled={isFirst}>Contrarrotativo · solo rotor</option>
          </select>
          {isFirst && <p id={configHintId} className="text-caption text-ink-3">La primera fila necesita estator.</p>}
          {!isFirst && activeStage.rowConfiguration === 'counterrotating' && (
            <p className="text-caption text-ink-3">Usa el remolino de salida de la fila anterior y no tiene pérdidas de estator.</p>
          )}
          {errorOf('rowConfiguration') && <p role="alert" className="text-caption text-danger">{errorOf('rowConfiguration')}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={STAGE_FIELD_IDS.direction} className="text-label font-medium text-ink-2">Sentido de giro</label>
          <select
            id={STAGE_FIELD_IDS.direction}
            value={activeStage.direction === -1 ? 'counter' : 'normal'}
            onChange={(event) => model.setStageDirection(activeStageIdx, event.target.value === 'counter' ? -1 : 1)}
            className="field h-10 w-full text-base sm:h-9 sm:text-sm"
          >
            <option value="normal">Positivo</option>
            <option value="counter">Opuesto</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={STAGE_FIELD_IDS.shaft} className="text-label font-medium text-ink-2">Eje</label>
          <select
            id={STAGE_FIELD_IDS.shaft}
            value={shaftName}
            onChange={(event) => model.setStageShaft(activeStageIdx, event.target.value)}
            className="field h-10 w-full text-base sm:h-9 sm:text-sm"
          >
            {shaftOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        <NumberField
          id={STAGE_FIELD_IDS.shaftTarget}
          label={`Potencia objetivo de ${shaftName}`}
          unit="MW"
          value={activeShaftTarget ?? Number.NaN}
          placeholder="Sin objetivo"
          min={0}
          max={500}
          step={0.1}
          onChange={(value) => model.setShaftTarget(shaftName, value > 0 ? value : undefined)}
          hint="Con ṁ y esta potencia el barrido fija el radio medio común."
          error={errorOf('shaftTarget')}
        />
      </div>

      {activeShaftStatus && activeShaftStatus.targetMW !== undefined && activeShaftStatus.errorPercent !== undefined && (
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-label text-ink-2">
          {activeShaftStatus.shaftName}: calculada{' '}
          <strong className="font-semibold tabular-nums text-ink">{formatNumber(activeShaftStatus.powerMW, 3)} MW</strong>
          {' '}frente a {formatNumber(activeShaftStatus.targetMW, 3)} MW ·{' '}
          <span className={`tabular-nums ${Math.abs(activeShaftStatus.errorPercent) > Math.max(0.5, design.sweepRanges.powerTolerance) ? 'text-warn' : 'text-ok'}`}>
            desvío {activeShaftStatus.errorPercent >= 0 ? '+' : ''}{formatNumber(activeShaftStatus.errorPercent, 1)} %
          </span>
        </p>
      )}
      {shaftWarnings.map((warning) => (
        <p key={warning} role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-label text-warn">{warning}</p>
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <NumberField
          id={STAGE_FIELD_IDS.N}
          label="Velocidad de giro"
          symbol="N"
          unit="rpm"
          value={activeStage.N > 0 ? activeStage.N : Number.NaN}
          min={0}
          commitOnBlur
          max={200000}
          step={500}
          typical="3000–60 000 rpm"
          onChange={(value) => model.setStageSpeed(activeStageIdx, value)}
          error={errorOf('N')}
        />
        <NumberField
          id={STAGE_FIELD_IDS.R}
          label="Grado de reacción"
          symbol="R"
          value={reactionSet ? activeStage.R : Number.NaN}
          min={0}
          max={MAX_REACTION}
          step={0.05}
          typical="0,3–0,6 (0 = impulso)"
          onChange={(value) => model.setStageReaction(activeStageIdx, value)}
          error={errorOf('R')}
        />
      </div>

      <div className="rounded-lg bg-surface-muted p-3">
        <p className="text-label font-semibold text-ink">Resultado del barrido</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
          <dt className="text-ink-3">PRₜₜ de la etapa</dt>
          <dd className="text-right font-semibold tabular-nums text-ink">
            {activeResult ? `${formatNumber(activeResult.inputs.PR, 3)} : 1` : '—'}
          </dd>
          <dt className="text-ink-3">Radio medio común Rₘ</dt>
          <dd className="text-right font-semibold tabular-nums text-ink">
            {activeStage.Rm > 0 ? `${formatNumber(activeStage.Rm * 1000, 1)} mm` : 'pendiente del barrido'}
          </dd>
          <dt className="text-ink-3">Coeficientes φ · ψ</dt>
          <dd className="text-right font-semibold tabular-nums text-ink">
            {activeResult ? `${formatNumber(activeResult.phi, 3)} · ${formatNumber(activeResult.psi, 3)}` : '—'}
          </dd>
        </dl>
        <p className="mt-2 text-caption text-ink-3">
          {activeStage.psiTarget !== undefined
            ? `El PR cierra el trabajo pedido por ψ = ${formatNumber(activeStage.psiTarget, 3)} tras las pérdidas.`
            : 'Esta etapa conserva su PR; el barrido define φ, ψ y el radio medio.'}
        </p>
        {errorOf('coefficients') && <p className="mt-1 text-caption text-warn">{errorOf('coefficients')}</p>}
      </div>
    </section>
  );
}

export default StageEditor;
