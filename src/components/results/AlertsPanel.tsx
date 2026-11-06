import { useId, type ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, ClipboardList, Lightbulb, type LucideIcon } from 'lucide-react';
import type { AerodynamicDiagnostic } from '../../utils/exportGeometry';

export interface AlertsPanelProps {
  diagnostics: AerodynamicDiagnostic[] | null;
}

type Severity = AerodynamicDiagnostic['severity'];

interface SeverityStyle {
  heading: string;
  icon: LucideIcon;
  iconClass: string;
  accent: string;
  badge: string;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'optimal'];

const SEVERITY_STYLE: Record<Severity, SeverityStyle> = {
  critical: {
    heading: 'Críticas',
    icon: AlertOctagon,
    iconClass: 'text-danger',
    accent: 'border-l-danger',
    badge: 'bg-danger-soft text-danger',
  },
  warning: {
    heading: 'Avisos',
    icon: AlertTriangle,
    iconClass: 'text-warn',
    accent: 'border-l-warn',
    badge: 'bg-warn-soft text-warn',
  },
  optimal: {
    heading: 'Dentro de límites',
    icon: CheckCircle2,
    iconClass: 'text-ok',
    accent: 'border-l-ok',
    badge: 'bg-ok-soft text-ok',
  },
};

/** Muestra «M_rel,1» o «ψ_Z» con subíndice real en lugar del guion bajo. */
function withSubscripts(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /_([A-Za-z0-9,]+)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<sub key={start}>{match[1]}</sub>);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MetricChip({ diagnostic }: { diagnostic: AerodynamicDiagnostic }) {
  const metric = diagnostic.metric.trim();
  const value = diagnostic.value.trim();
  const limit = diagnostic.limit.trim();
  if (!metric && !value && !limit) return null;
  return (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 rounded-md border border-line bg-surface-muted px-2 py-0.5 text-label text-ink-2 tabular-nums">
      {(metric || value) && (
        <span className="font-semibold text-ink">
          {withSubscripts(metric)}
          {metric && value && ' = '}
          {value}
        </span>
      )}
      {limit && <span className="text-ink-3">(límite: {withSubscripts(limit)})</span>}
    </span>
  );
}

function AlertCard({ diagnostic }: { diagnostic: AerodynamicDiagnostic }) {
  const style = SEVERITY_STYLE[diagnostic.severity];
  const Icon = style.icon;
  return (
    <li className={`rounded-lg border border-l-4 border-line bg-surface p-3 ${style.accent}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="flex min-w-0 items-start gap-2 text-body font-semibold text-ink">
          <Icon className={`mt-0.5 size-4 shrink-0 ${style.iconClass}`} aria-hidden="true" />
          <span>{diagnostic.title}</span>
        </h4>
        <MetricChip diagnostic={diagnostic} />
      </div>
      {diagnostic.diagnosis && <p className="mt-2 text-body text-ink-2">{diagnostic.diagnosis}</p>}
      {diagnostic.recommendation && (
        <div className="mt-2 flex gap-2 rounded-md bg-surface-muted p-2.5">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-caption font-semibold text-accent-strong">Recomendación</p>
            <p className="text-body text-ink-2">{diagnostic.recommendation}</p>
          </div>
        </div>
      )}
    </li>
  );
}

export function AlertsPanel({ diagnostics }: AlertsPanelProps) {
  const idPrefix = useId();
  if (diagnostics === null) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center">
        <ClipboardList className="size-6 text-ink-3" aria-hidden="true" />
        <p className="text-body font-semibold text-ink-2">Todavía no hay un diseño que auditar</p>
        <p className="max-w-sm text-label text-ink-3">
          Completa las condiciones de entrada y lanza el barrido para revisar Mach, carga de Zweifel, solidez y
          geometría de cada etapa.
        </p>
      </div>
    );
  }

  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: diagnostics.filter((diagnostic) => diagnostic.severity === severity),
  })).filter((group) => group.items.length > 0);

  const problemCount = diagnostics.filter((diagnostic) => diagnostic.severity !== 'optimal').length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-ink-3">
        Criterios de diseño que el barrido no impone como restricciones. Úsalos para decidir qué ajustar antes de
        exportar la geometría.
      </p>

      {problemCount === 0 && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-ok-soft p-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
          <div>
            <p className="text-body font-semibold text-ok">Sin alertas</p>
            <p className="text-label text-ink-2">El diseño cumple todos los criterios supervisados.</p>
          </div>
        </div>
      )}

      {groups.map((group) => {
        const style = SEVERITY_STYLE[group.severity];
        const headingId = `${idPrefix}-${group.severity}`;
        return (
          <section key={group.severity} aria-labelledby={headingId} className="flex flex-col gap-2">
            <h3 id={headingId} className="flex items-center gap-2 text-label font-semibold text-ink-2">
              {style.heading}
              <span className={`rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums ${style.badge}`}>
                {group.items.length}
              </span>
            </h3>
            <ul role="list" className="flex flex-col gap-2">
              {group.items.map((diagnostic, index) => (
                <AlertCard key={`${diagnostic.title}-${diagnostic.metric}-${index}`} diagnostic={diagnostic} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
