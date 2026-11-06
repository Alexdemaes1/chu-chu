import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Download,
  FilePlus2,
  FolderOpen,
  Link2,
  RotateCcw,
  Sliders,
  Wind,
} from 'lucide-react';

export interface AppHeaderProps {
  designName: string;
  onDesignNameChange: (name: string) => void;
  audit: { critical: number; warning: number } | null;
  onOpenAlerts: () => void;
  onOpenDocs: () => void;
  onOpenEquations: () => void;
  isCustomEquationsActive: boolean;
  onOpenGuide: () => void;
  onResetExample: () => void;
  onNewDesign: () => void;
  onShareLink: () => void;
  onExportJson: () => void;
  onImportFile: (file: File) => void;
}

const headerButton =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2 text-label sm:px-2.5 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong';
const neutralButton = `${headerButton} border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink`;

function alertsTone(audit: AppHeaderProps['audit']): { className: string; label: string } {
  if (!audit) return { className: `${headerButton} border-line bg-surface-muted text-ink-3 hover:bg-surface-sunken`, label: '—' };
  if (audit.critical > 0) {
    return { className: `${headerButton} border-rose-300 bg-danger-soft text-danger hover:bg-rose-100`, label: String(audit.critical) };
  }
  if (audit.warning > 0) {
    return { className: `${headerButton} border-amber-300 bg-warn-soft text-warn hover:bg-amber-100`, label: String(audit.warning) };
  }
  return { className: `${headerButton} border-emerald-300 bg-ok-soft text-ok hover:bg-emerald-100`, label: '0' };
}

interface MenuAction {
  id: string;
  label: string;
  icon: typeof Download;
  run: () => void;
}

function DesignMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={neutralButton}
      >
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Diseño</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Acciones del diseño"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-line bg-surface p-1 shadow-modal"
        >
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  action.run();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body text-ink-2 hover:bg-surface-muted hover:text-ink focus-visible:bg-surface-muted focus-visible:outline-none"
              >
                <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppHeader({
  designName,
  onDesignNameChange,
  audit,
  onOpenAlerts,
  onOpenDocs,
  onOpenEquations,
  isCustomEquationsActive,
  onOpenGuide,
  onResetExample,
  onNewDesign,
  onShareLink,
  onExportJson,
  onImportFile,
}: AppHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const alerts = alertsTone(audit);
  const alertsDescription = !audit
    ? 'Alertas: sin diseño calculado'
    : `Alertas: ${audit.critical} críticas, ${audit.warning} avisos`;

  const actions: MenuAction[] = [
    { id: 'share', label: 'Compartir enlace', icon: Link2, run: onShareLink },
    { id: 'export', label: 'Exportar diseño (JSON)', icon: Download, run: onExportJson },
    { id: 'import', label: 'Importar diseño (JSON)…', icon: FolderOpen, run: () => fileInputRef.current?.click() },
    { id: 'example', label: 'Restablecer ejemplo', icon: RotateCcw, run: onResetExample },
    { id: 'new', label: 'Nuevo diseño', icon: FilePlus2, run: onNewDesign },
  ];

  return (
    <header
      data-noprint
      className="relative z-40 border-b md:sticky md:top-0 border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85"
    >
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4 xl:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            <Wind className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-title font-bold text-ink">Turbina 1D</p>
            <p className="hidden text-caption text-ink-3 sm:block">Prediseño mean-line de etapas axiales</p>
          </div>
        </div>

        <div className="order-last w-full min-w-0 md:order-none md:w-auto md:flex-1 md:max-w-sm">
          <label htmlFor={nameId} className="sr-only">Nombre del diseño</label>
          <input
            id={nameId}
            type="text"
            value={designName}
            maxLength={80}
            placeholder="Nombre del diseño"
            onChange={(event) => onDesignNameChange(event.target.value)}
            title="Nombre del diseño (se usa al exportar y compartir)"
            className="field h-9 w-full text-label font-medium"
          />
        </div>

        <nav aria-label="Acciones principales" className="ml-auto flex flex-wrap items-center gap-1 sm:gap-1.5">
          <button type="button" onClick={onOpenAlerts} className={alerts.className} title={alertsDescription} aria-label={alertsDescription}>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Alertas</span>
            <span className="tabular-nums">{alerts.label}</span>
          </button>
          <button type="button" onClick={onOpenDocs} className={neutralButton} title="Documentación técnica, fórmulas y referencias" aria-label="Documentación">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Documentación</span>
          </button>
          <button
            type="button"
            onClick={onOpenEquations}
            className={isCustomEquationsActive
              ? `${headerButton} border-amber-300 bg-warn-soft text-warn hover:bg-amber-100`
              : neutralButton}
            title={isCustomEquationsActive ? 'Ecuaciones personalizadas activas' : 'Ecuaciones y correlaciones'}
            aria-label={isCustomEquationsActive ? 'Ecuaciones (personalizadas activas)' : 'Ecuaciones'}
          >
            <Sliders className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Ecuaciones</span>
            {isCustomEquationsActive && <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />}
          </button>
          <DesignMenu actions={actions} />
          <button type="button" onClick={onOpenGuide} className={neutralButton} title="Guía rápida de prediseño" aria-label="Guía">
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Guía</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onImportFile(file);
            }}
          />
        </nav>
      </div>
    </header>
  );
}

export default AppHeader;
