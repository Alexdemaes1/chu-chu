import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Contenido extra tras la etiqueta (contador, punto de estado…). */
  badge?: ReactNode;
  title?: string;
}

export interface TabsProps<T extends string> {
  /** Prefijo de los ids: las pestañas son `${idBase}-tab-${id}` y los paneles `${idBase}-panel-${id}`. */
  idBase: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Nombre accesible de la lista de pestañas. */
  label: string;
  /** 'fill' reparte el ancho a partes iguales; 'wrap' deja que las pestañas fluyan. */
  layout?: 'fill' | 'wrap';
  className?: string;
}

export const tabId = (idBase: string, id: string) => `${idBase}-tab-${id}`;
export const tabPanelId = (idBase: string, id: string) => `${idBase}-panel-${id}`;

/**
 * Lista de pestañas accesible (patrón WAI-ARIA): role tablist/tab, aria-selected, tabindex
 * itinerante y navegación con flechas, Inicio y Fin. Los paneles se pintan con <TabPanel>.
 */
export function Tabs<T extends string>({
  idBase,
  items,
  value,
  onChange,
  label,
  layout = 'fill',
  className = '',
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (id: T) => {
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(idBase, id))}`)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = items.findIndex((item) => item.id === value);
    if (currentIndex === -1) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex].id;
    onChange(next);
    focusTab(next);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={`flex gap-1 rounded-lg bg-surface-sunken p-1 ${layout === 'wrap' ? 'flex-wrap' : ''} ${className}`}
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={tabId(idBase, item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idBase, item.id)}
            tabIndex={selected ? 0 : -1}
            title={item.title}
            onClick={() => onChange(item.id)}
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-label font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-strong ${
              layout === 'fill' ? 'flex-1' : ''
            } ${selected ? 'bg-surface text-accent-strong shadow-sm' : 'text-ink-3 hover:bg-surface-muted hover:text-ink'}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  id: string;
  /** Si es false el panel no se pinta (los paneles inactivos no se montan). */
  active: boolean;
  className?: string;
  children?: ReactNode;
}

export function TabPanel({ idBase, id, active, className = '', children }: TabPanelProps) {
  if (!active) return null;
  return (
    <div
      id={tabPanelId(idBase, id)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, id)}
      tabIndex={0}
      className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {children}
    </div>
  );
}

export default Tabs;
