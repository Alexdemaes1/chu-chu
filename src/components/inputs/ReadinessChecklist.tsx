import { CircleAlert, ChevronRight } from 'lucide-react';
import type { DesignBlocker } from '../../utils/designState';

export interface ReadinessChecklistProps {
  blockers: DesignBlocker[];
  /** Lleva al campo correspondiente (cambia de etapa y le da el foco). */
  onSelect?: (blocker: DesignBlocker) => void;
  title?: string;
  className?: string;
}

/** Lista de lo que falta para poder calcular, con acceso directo a cada campo. */
export function ReadinessChecklist({
  blockers,
  onSelect,
  title = 'Para calcular el diseño falta:',
  className = '',
}: ReadinessChecklistProps) {
  if (blockers.length === 0) return null;
  return (
    <div className={`rounded-card bg-surface-muted p-4 ${className}`}>
      <p className="text-label font-semibold text-ink">{title}</p>
      <ul className="mt-2 space-y-1">
        {blockers.map((blocker, index) => {
          const content = (
            <>
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span className="flex-1">{blocker.message}</span>
              {onSelect && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />}
            </>
          );
          return (
            <li key={`${blocker.field}-${blocker.stageIndex ?? 'g'}-${index}`}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(blocker)}
                  className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-body text-ink-2 hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-strong"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-start gap-2 px-1.5 py-1 text-body text-ink-2">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ReadinessChecklist;
