import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Loader2, Search } from 'lucide-react';
import { NumberField } from '../ui/NumberField';
import { MIN_VIABLE_HUB_TIP_RATIO, type DesignCandidate, type MachFlag } from '../../utils/designOptimization';
import { candidateKey, type TurbineDesignModel } from '../../hooks/useTurbineDesign';

export const SWEEP_PANEL_ID = 'sweep-panel';
export const SWEEP_RUN_BUTTON_ID = 'sweep-run';

type SortKey = 'rank' | 'phi' | 'psi' | 'eta' | 'PR' | 'h' | 'hubTip' | 'U' | 'mach';

const COLUMNS: { key: Exclude<SortKey, 'rank'>; label: string; unit?: string; title: string }[] = [
  { key: 'phi', label: 'φ', title: 'Coeficiente de flujo' },
  { key: 'psi', label: 'ψ', title: 'Coeficiente de carga' },
  { key: 'eta', label: 'ηtt', unit: '%', title: 'Rendimiento total a total global' },
  { key: 'PR', label: 'PR', title: 'Relación de presiones de la etapa barrida' },
  { key: 'h', label: 'h', unit: 'mm', title: 'Altura de álabe (salida del rotor) de la etapa barrida' },
  { key: 'hubTip', label: 'Rh/Rt', title: 'Relación buje/punta mínima de todas las etapas' },
  { key: 'U', label: 'U', unit: 'm/s', title: 'Velocidad periférica media máxima' },
  { key: 'mach', label: 'Mach', title: 'Mach máximo de salida (M_abs1, M_rel2, M_abs2) en todas las etapas' },
];

const fmt = (value: number, digits: number) =>
  Number.isFinite(value) ? value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const MACH_FLAG_STYLE: Record<MachFlag, { label: string; className: string }> = {
  ok: { label: 'subsónico', className: 'text-ok' },
  transonic: { label: 'transónico', className: 'text-warn' },
  supersonic: { label: 'supersónico', className: 'text-danger' },
};

function valueOf(candidate: DesignCandidate, key: Exclude<SortKey, 'rank'>, stageIndex: number): number {
  switch (key) {
    case 'phi': return candidate.phi;
    case 'psi': return candidate.psi;
    case 'eta': return candidate.efficiency;
    case 'PR': return candidate.PR;
    case 'h': return candidate.result.stageResults[stageIndex]?.bladeHeight_mm ?? Number.NaN;
    case 'hubTip': return candidate.minimumHubTipRatio;
    case 'U': return candidate.maxMeanPeripheralSpeedMs;
    case 'mach': return candidate.maxMach;
  }
}

function formatCell(candidate: DesignCandidate, key: Exclude<SortKey, 'rank'>, stageIndex: number): string {
  const value = valueOf(candidate, key, stageIndex);
  switch (key) {
    case 'eta': return fmt(value * 100, 1);
    case 'h': return fmt(value, 1);
    case 'U': return fmt(value, 0);
    case 'PR': return fmt(value, 3);
    case 'hubTip':
    case 'mach': return fmt(value, 2);
    default: return fmt(value, 2);
  }
}

export interface SweepPanelProps {
  model: TurbineDesignModel;
}

export function SweepPanel({ model }: SweepPanelProps) {
  const { sweep, design, activeStage, activeStageIdx, stale } = model;
  const ranges = sweep.ranges;
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'rank', descending: false });

  const fastestRpm = Math.max(0, ...design.stages.map((stage) => stage.N));
  const maxRadiusMm = fastestRpm > 0 ? ranges.maxMeanPeripheralSpeed * 60 / (2 * Math.PI * fastestRpm) * 1000 : undefined;
  const stageIndex = sweep.context?.stageIndex ?? activeStageIdx;

  const sortedCandidates = useMemo(() => {
    const list = sweep.candidates.map((candidate, rank) => ({ candidate, rank }));
    if (sort.key === 'rank') return list;
    const key = sort.key;
    return [...list].sort((a, b) => {
      const difference = valueOf(a.candidate, key, stageIndex) - valueOf(b.candidate, key, stageIndex);
      return sort.descending ? -difference : difference;
    });
  }, [sweep.candidates, sort, stageIndex]);

  const toggleSort = (key: SortKey) => {
    setSort((previous) => (previous.key === key ? { key, descending: !previous.descending } : { key, descending: key === 'eta' }));
  };

  const stageName = activeStage?.name ?? 'la etapa activa';

  return (
    <section id={SWEEP_PANEL_ID} aria-labelledby="sweep-title" className="scroll-mt-24 space-y-3">
      <div>
        <h3 id="sweep-title" className="text-label font-semibold text-ink">Barrido de diseño φ–ψ</h3>
        <p className="mt-1 text-caption text-ink-3">
          Barre {stageName} con R fijo. El trabajo y el radio medio salen de ṁ y de las potencias objetivo de los ejes.
        </p>
      </div>

      {stale && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-label text-warn">
          La potencia ya no coincide con el objetivo: vuelve a lanzar el barrido.
        </p>
      )}

      {sweep.highCost && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-warn-soft p-3 text-label text-warn">
          <p>
            Barrido costoso: {sweep.cost.toLocaleString('es-ES')} combinaciones (puntos² × etapas). Puede tardar varios segundos y la
            página no responderá mientras calcula.
          </p>
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={sweep.allowHighCost}
              onChange={(event) => model.setAllowHighCostSweep(event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Lanzar de todos modos
          </label>
        </div>
      )}

      <button
        id={SWEEP_RUN_BUTTON_ID}
        type="button"
        onClick={model.runSweep}
        disabled={sweep.isSweeping || (sweep.highCost && !sweep.allowHighCost)}
        aria-busy={sweep.isSweeping}
        className={`btn-primary h-10 w-full ${stale ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-surface' : ''}`}
      >
        {sweep.isSweeping ? (
          <>
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            Calculando…
          </>
        ) : (
          <>
            <Search className="h-4 w-4" aria-hidden="true" />
            Barrer {stageName} ({(sweep.points * sweep.points).toLocaleString('es-ES')} diseños)
          </>
        )}
      </button>

      <div aria-live="polite" className="space-y-2">
        {sweep.blocker && (
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-label text-warn">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {sweep.blocker}
          </p>
        )}
        {sweep.error && (
          <p className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-label text-warn">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {sweep.error}
          </p>
        )}
        {sweep.visible && sweep.success && (
          <p className="flex items-start gap-2 rounded-lg bg-ok-soft px-3 py-2 text-label text-ok">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {sweep.success}
          </p>
        )}
      </div>

      {sweep.visible && sortedCandidates.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label font-medium text-ink-2">Mejores candidatos (pulsa uno para aplicarlo)</p>
          <div className="relative overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[460px] text-caption tabular-nums">
              <caption className="sr-only">Candidatos del barrido φ–ψ de {stageName}</caption>
              <thead className="bg-surface-muted text-ink-3">
                <tr>
                  <th scope="col" className="px-1.5 py-1.5 text-left font-semibold">
                    <button type="button" onClick={() => toggleSort('rank')} className="rounded hover:text-ink">#</button>
                  </th>
                  {COLUMNS.map((column) => {
                    const active = sort.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                        className="px-1.5 py-1.5 text-right font-semibold"
                      >
                        <button
                          type="button"
                          title={column.title}
                          onClick={() => toggleSort(column.key)}
                          className={`inline-flex items-center gap-0.5 rounded hover:text-ink ${active ? 'text-accent-strong' : ''}`}
                        >
                          {column.label}
                          {column.unit && <span className="font-normal">({column.unit})</span>}
                          {active && (sort.descending
                            ? <ArrowDown className="h-3 w-3" aria-hidden="true" />
                            : <ArrowUp className="h-3 w-3" aria-hidden="true" />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedCandidates.map(({ candidate, rank }) => {
                  const applied = sweep.appliedKey === candidateKey(candidate);
                  const flag = MACH_FLAG_STYLE[candidate.machFlag];
                  const shaftSummary = candidate.shaftPowerErrors
                    .map((shaft) => `${shaft.shaftName}: ${fmt(shaft.actualMW, 3)} / ${fmt(shaft.targetMW, 3)} MW (${shaft.errorPercent >= 0 ? '+' : ''}${fmt(shaft.errorPercent, 1)} %)`)
                    .join(' · ');
                  return (
                    <tr
                      key={candidateKey(candidate)}
                      className={`${applied ? 'bg-accent-soft' : candidate.feasible ? 'bg-surface' : 'bg-surface text-ink-3'} hover:bg-surface-muted`}
                    >
                      <td className="px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => model.applySweepCandidate(candidate)}
                          aria-pressed={applied}
                          title={`${candidate.feasible ? 'Viable' : 'No cumple las restricciones'}. ${shaftSummary}`}
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold focus-visible:outline-2 focus-visible:outline-accent-strong ${
                            applied ? 'bg-accent text-white' : candidate.feasible ? 'bg-ok-soft text-ok' : 'bg-surface-sunken text-ink-3'
                          }`}
                        >
                          {rank + 1}
                          <span className="sr-only">
                            {applied ? ' (aplicado)' : ''}{candidate.feasible ? ', viable' : ', no viable'}; aplicar este candidato
                          </span>
                        </button>
                      </td>
                      {COLUMNS.map((column) => (
                        <td key={column.key} className="px-1.5 py-1 text-right">
                          {column.key === 'mach' ? (
                            <span className={flag.className} title={flag.label}>
                              {formatCell(candidate, column.key, stageIndex)}
                              {candidate.machFlag !== 'ok' && <span aria-hidden="true"> ●</span>}
                              <span className="sr-only"> ({flag.label})</span>
                            </span>
                          ) : (
                            formatCell(candidate, column.key, stageIndex)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-caption text-ink-3">
            Verde: viable para el eje de esta etapa. Mach en ámbar: transónico, 0,95–1,3 (sin pérdidas por choque en el
            modelo); en rojo: supersónico, por encima de 1,3, excluido de los viables. Tampoco son viables los diseños con
            Rh/Rt geométrico por debajo de {fmt(MIN_VIABLE_HUB_TIP_RATIO, 2)} en alguna etapa. Pasa el cursor por el número
            para ver la potencia de cada eje.
          </p>
        </div>
      )}

      <details className="group rounded-lg border border-line">
        <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-label font-semibold text-ink-2 hover:bg-surface-muted">
          Opciones avanzadas
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          <div className="grid grid-cols-2 gap-2">
            <NumberField compact label="φ mínimo" value={ranges.phiMin} min={0.05} max={3} step={0.05} onChange={(value) => model.setSweepRange('phiMin', value)} />
            <NumberField compact label="φ máximo" value={ranges.phiMax} min={0.05} max={3} step={0.05} onChange={(value) => model.setSweepRange('phiMax', value)} />
            <NumberField compact label="ψ mínimo" value={ranges.psiMin} min={0.1} max={5} step={0.1} onChange={(value) => model.setSweepRange('psiMin', value)} />
            <NumberField compact label="ψ máximo" value={ranges.psiMax} min={0.1} max={5} step={0.1} onChange={(value) => model.setSweepRange('psiMax', value)} />
            <NumberField
              compact
              label="Puntos por parámetro"
              value={ranges.points}
              min={2}
              max={100}
              step={1}
              onChange={(value) => model.setSweepRange('points', Math.round(value))}
            />
            <NumberField
              compact
              label="Tolerancia de potencia"
              unit="%"
              value={ranges.powerTolerance}
              min={0}
              max={50}
              step={1}
              onChange={(value) => model.setSweepRange('powerTolerance', value)}
            />
          </div>
          {(ranges.phiMax <= ranges.phiMin || ranges.psiMax <= ranges.psiMin) && (
            <p className="text-caption text-danger">El máximo de cada rango debe ser mayor que el mínimo.</p>
          )}
          <NumberField
            label="Velocidad periférica media máxima"
            symbol="Uₘₐₓ"
            unit="m/s"
            value={ranges.maxMeanPeripheralSpeed}
            min={50}
            max={1200}
            step={10}
            onChange={(value) => model.setSweepRange('maxMeanPeripheralSpeed', value)}
            hint={`Límite de velocidad periférica media: U = ω·Rm ≤ ${fmt(ranges.maxMeanPeripheralSpeed, 0)} m/s (criterio cinemático, no tensional).${
              maxRadiusMm !== undefined ? ` Con ${fastestRpm.toLocaleString('es-ES')} rpm: Rₘ ≤ ${fmt(maxRadiusMm, 1)} mm.` : ''
            }`}
          />
          <label className="flex items-start gap-2 text-label text-ink-2">
            <input
              type="checkbox"
              checked={sweep.requireTwoDimensionalFlow}
              onChange={(event) => model.setRequireTwoDimensionalFlow(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            <span>
              Descartar diseños con Rh/Rt ≤ 0,80
              <span className="mt-0.5 block text-caption text-ink-3">
                Solo conserva diseños en los que se admite la hipótesis de flujo bidimensional y se puede omitir el equilibrio radial.
              </span>
            </span>
          </label>
        </div>
      </details>
    </section>
  );
}

export default SweepPanel;
