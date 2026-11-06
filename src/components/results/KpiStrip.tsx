import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import type { MultiStageOutputs } from '../../utils/turbine1D';
import { machFlagOf } from '../../utils/designOptimization';
import { formatNumber } from '../../utils/format';

export interface KpiStripProps {
  result: MultiStageOutputs | null;
  lossModelLabel: string;
  audit: { critical: number; warning: number } | null;
  stale: boolean;
  onOpenAlerts: () => void;
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'muted';

const EMPTY = '—';

function formatFixed(value: number | undefined, digits: number): string {
  return value !== undefined ? formatNumber(value, digits, EMPTY) : EMPTY;
}

function formatPower(kW: number | undefined): { value: string; unit: string; hint: string } {
  if (kW === undefined || !Number.isFinite(kW)) return { value: EMPTY, unit: 'kW', hint: '' };
  const abs = Math.abs(kW);
  if (abs < 1000) {
    return { value: formatNumber(kW, 1), unit: 'kW', hint: `${formatNumber(kW / 1000, 2)} MW` };
  }
  return { value: formatNumber(kW / 1000, 2), unit: 'MW', hint: `${formatNumber(kW, 0)} kW` };
}

function formatTorque(Nm: number | undefined): { value: string; unit: string } {
  if (Nm === undefined || !Number.isFinite(Nm)) return { value: EMPTY, unit: 'N·m' };
  if (Math.abs(Nm) >= 10000) return { value: formatNumber(Nm / 1000, 2), unit: 'kN·m' };
  return { value: formatNumber(Nm, 0), unit: 'N·m' };
}

interface MachPeak {
  value: number;
  quantity: ReactNode;
  stage: number;
}

/**
 * Mach máximo de salida de fila: M_abs,1 (salida del estator), M_rel,2 (salida del rotor) y
 * M_abs,2 (salida de la etapa). Es el mismo conjunto y los mismos umbrales que usa el barrido.
 */
function findMachPeak(result: MultiStageOutputs): MachPeak | null {
  let peak: MachPeak | null = null;
  for (const [index, stage] of result.stageResults.entries()) {
    const candidates: { value: number; quantity: ReactNode }[] = [
      { value: stage.inletTriangle.Mach_abs, quantity: <>M<sub>abs,1</sub></> },
      { value: stage.outletTriangle.Mach_rel, quantity: <>M<sub>rel,2</sub></> },
      { value: stage.outletTriangle.Mach_abs, quantity: <>M<sub>abs,2</sub></> },
    ];
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate.value)) continue;
      if (!peak || candidate.value > peak.value) {
        peak = { value: candidate.value, quantity: candidate.quantity, stage: index + 1 };
      }
    }
  }
  return peak;
}

const TONE_CARD: Record<Tone, string> = {
  neutral: 'bg-surface border-line',
  muted: 'bg-surface border-line',
  ok: 'bg-surface border-line',
  warn: 'bg-warn-soft border-amber-200',
  danger: 'bg-danger-soft border-rose-200',
};

const TONE_VALUE: Record<Tone, string> = {
  neutral: 'text-ink',
  muted: 'text-ink-3',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
};

interface KpiCardContentProps {
  label: ReactNode;
  value: string;
  unit?: string;
  hint?: ReactNode;
  tone: Tone;
  adornment?: ReactNode;
}

function KpiCardContent({ label, value, unit, hint, tone, adornment }: KpiCardContentProps) {
  const isEmpty = value === EMPTY;
  return (
    <>
      <span className="flex items-center justify-between gap-2 text-caption font-medium text-ink-3">
        <span className="truncate">{label}</span>
        {adornment}
      </span>
      <span className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
        <span
          className={`text-kpi font-semibold tabular-nums tracking-tight ${isEmpty ? 'text-ink-3' : TONE_VALUE[tone]}`}
        >
          {value}
        </span>
        {unit && !isEmpty && <span className="text-label text-ink-3">{unit}</span>}
      </span>
      <span className="mt-0.5 block min-h-4 truncate text-caption text-ink-3 tabular-nums">{hint}</span>
    </>
  );
}

const CARD_BASE = 'flex h-full flex-col rounded-card border p-3 shadow-card';

function KpiCard(props: KpiCardContentProps) {
  return (
    <li className={`${CARD_BASE} ${TONE_CARD[props.tone]}`}>
      <KpiCardContent {...props} />
    </li>
  );
}

export function KpiStrip({ result, lossModelLabel, audit, stale, onOpenAlerts }: KpiStripProps) {
  const stageCount = result?.stageResults.length ?? 0;

  const power = formatPower(result?.power_total_kW);
  const etaTt = result ? result.eta_overall_tt * 100 : undefined;
  const etaTs = result ? result.eta_overall_ts * 100 : undefined;

  const shafts = result?.shaftResults ?? [];
  const mainShaft = shafts.reduce<(typeof shafts)[number] | null>(
    (best, shaft) => (!best || Math.abs(shaft.torque_Nm) > Math.abs(best.torque_Nm) ? shaft : best),
    null,
  );
  const torque = formatTorque(mainShaft ? Math.abs(mainShaft.torque_Nm) : undefined);
  const torqueHint = mainShaft
    ? shafts.length > 1
      ? `Máx. de ${shafts.length} ejes · ${mainShaft.shaftName}`
      : mainShaft.shaftName
    : '';

  let uPeak: { value: number; stage: number } | null = null;
  for (const [index, stage] of (result?.stageResults ?? []).entries()) {
    const u = Math.abs(stage.U);
    if (Number.isFinite(u) && (!uPeak || u > uPeak.value)) uPeak = { value: u, stage: index + 1 };
  }

  const machPeak = result ? findMachPeak(result) : null;
  // Ámbar: transónico (0,95–1,3, sin pérdidas por choque en el modelo); rojo: supersónico (> 1,3,
  // necesita paso convergente-divergente y el barrido lo descarta).
  const machFlag = machPeak ? machFlagOf(machPeak.value) : 'ok';
  const machTone: Tone = machFlag === 'supersonic' ? 'danger' : machFlag === 'transonic' ? 'warn' : 'neutral';
  const machLabel = machFlag === 'supersonic'
    ? 'Flujo supersónico: requiere paso convergente-divergente'
    : 'Flujo transónico';

  const stageHint = (stage: number) => (stageCount > 1 ? ` · etapa ${stage}` : '');

  const auditTotal = audit ? audit.critical + audit.warning : null;
  const auditTone: Tone = !audit ? 'muted' : audit.critical > 0 ? 'danger' : audit.warning > 0 ? 'warn' : 'ok';
  const auditHint = !audit
    ? 'Sin diseño'
    : audit.critical + audit.warning === 0
      ? 'Sin alertas'
      : [
          audit.critical > 0 ? `${audit.critical} ${audit.critical === 1 ? 'crítica' : 'críticas'}` : null,
          audit.warning > 0 ? `${audit.warning} ${audit.warning === 1 ? 'aviso' : 'avisos'}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const auditIcon = !audit ? null : audit.critical > 0 ? (
    <span className="flex items-center gap-1 text-danger">
      <span className="size-2 rounded-full bg-danger" aria-hidden="true" />
      <AlertTriangle className="size-3.5" aria-hidden="true" />
    </span>
  ) : audit.warning > 0 ? (
    <AlertTriangle className="size-3.5 text-warn" aria-hidden="true" />
  ) : (
    <CheckCircle2 className="size-3.5 text-ok" aria-hidden="true" />
  );

  return (
    <section aria-labelledby="kpi-strip-title">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <h2 id="kpi-strip-title" className="text-label font-semibold text-ink-2">
            Resultados globales
          </h2>
          {stale && result && (
            <span
              className="inline-flex items-center rounded-full border border-amber-200 bg-warn-soft px-2 py-0.5 text-caption font-semibold text-warn"
              title="Las entradas han cambiado: la potencia ya no coincide con el objetivo. Vuelve a lanzar el barrido."
            >
              Provisional
            </span>
          )}
        </div>
        <p className="text-caption text-ink-3">
          Modelo de pérdidas: <span className="font-medium text-ink-2">{lossModelLabel}</span>
          {stageCount > 0 && (
            <>
              {' · '}
              {stageCount} {stageCount === 1 ? 'etapa' : 'etapas'}
            </>
          )}
        </p>
      </div>

      <ul role="list" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Potencia" value={power.value} unit={power.unit} hint={power.hint} tone="neutral" />
        <KpiCard
          label={<>η<sub>tt</sub> global</>}
          value={formatFixed(etaTt, 1)}
          unit="%"
          hint="Total a total"
          tone="neutral"
        />
        <KpiCard
          label={<>η<sub>ts</sub> global</>}
          value={formatFixed(etaTs, 1)}
          unit="%"
          hint="Total a estática"
          tone="neutral"
        />
        <KpiCard
          label={<>PR<sub>tt</sub> global</>}
          value={formatFixed(result?.PR_overall, 2)}
          unit=":1"
          hint={result ? `P₀₁ / P₀₃ en ${stageCount} ${stageCount === 1 ? 'etapa' : 'etapas'}` : ''}
          tone="neutral"
        />
        <KpiCard label="Par" value={torque.value} unit={torque.unit} hint={torqueHint} tone="neutral" />
        <KpiCard
          label="U media máx."
          value={formatFixed(uPeak?.value, 0)}
          unit="m/s"
          hint={uPeak ? `Radio medio${stageHint(uPeak.stage)}` : ''}
          tone="neutral"
        />
        <KpiCard
          label="Mach máx."
          value={formatFixed(machPeak?.value, 2)}
          hint={
            machPeak ? (
              <>
                {machPeak.quantity}
                {stageHint(machPeak.stage)}
              </>
            ) : (
              ''
            )
          }
          tone={machTone}
          adornment={
            machTone === 'neutral' ? undefined : (
              <span className="flex items-center gap-1" title={machLabel}>
                <AlertTriangle className={`size-3.5 ${machTone === 'danger' ? 'text-danger' : 'text-warn'}`} aria-hidden="true" />
                <span className="sr-only">{machLabel}</span>
              </span>
            )
          }
        />
        <li className="h-full">
          <button
            type="button"
            onClick={onOpenAlerts}
            disabled={!audit}
            aria-label={audit ? `Alertas del diseño: ${auditHint}. Abrir la pestaña de alertas` : 'Alertas: sin diseño'}
            className={`${CARD_BASE} ${TONE_CARD[auditTone]} w-full text-left transition-colors enabled:cursor-pointer enabled:hover:border-line-strong enabled:hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:cursor-default`}
          >
            <KpiCardContent
              label="Alertas"
              value={auditTotal === null ? EMPTY : String(auditTotal)}
              hint={
                <span className="flex items-center justify-between gap-1">
                  <span className="truncate">{auditHint}</span>
                  {audit && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
                </span>
              }
              tone={auditTone}
              adornment={auditIcon}
            />
          </button>
        </li>
      </ul>
    </section>
  );
}
