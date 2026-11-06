import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {X} from 'lucide-react';

export type ModalSize = 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Id que recibe el título del modal (y que usa aria-labelledby). Por defecto se genera uno. */
  labelledBy?: string;
  size?: ModalSize;
  /** Zona fija inferior para botones de acción (Aplicar, Cancelar…). */
  footer?: ReactNode;
  /** Controles extra en la cabecera, a la izquierda del botón de cierre. */
  headerActions?: ReactNode;
  /** Clases extra para el cuerpo desplazable. */
  bodyClassName?: string;
  children?: ReactNode;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'w-[min(42rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]',
  lg: 'w-[min(72rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)]',
  full: 'w-[calc(100vw-1rem)] h-[calc(100dvh-1rem)] sm:w-[calc(100vw-2rem)] sm:h-[calc(100dvh-2rem)]',
};

const FOCUSABLE_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Contador compartido para que varios modales anidados no restauren el scroll antes de tiempo.
let scrollLockCount = 0;
let previousBodyOverflow = '';

function lockBodyScroll(): void {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

/**
 * Modal accesible sobre el <dialog> nativo (showModal): atrapa el foco, cierra con Escape y con
 * clic en el fondo, bloquea el scroll de la página y devuelve el foco al control que lo abrió.
 */
export default function Modal({
  open,
  onClose,
  title,
  labelledBy,
  size = 'md',
  footer,
  headerActions,
  bodyClassName = '',
  children,
}: ModalProps) {
  const autoId = useId();
  const titleId = labelledBy ?? `${autoId}-title`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnBackdrop = useRef(false);

  // onClose puede cambiar en cada render del padre; se lee siempre la última versión.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Valor actual de `open`, para saber tras un cierre nativo si el padre sigue queriendo el modal.
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);

  const focusPreferred = () => {
    const preferred =
      bodyRef.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      closeButtonRef.current;
    preferred?.focus();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    lockBodyScroll();
    focusPreferred();

    return () => {
      if (dialog.open) dialog.close();
      unlockBodyScroll();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // Escape se atiende aquí y se cancela en origen: el navegador no siempre deja cancelar el evento
    // «cancel» (Chromium lo cierra igualmente en un segundo Escape sin interacción entre medias), y el
    // estado del padre debe ser la única fuente de verdad (p. ej. si pide confirmación y se rechaza).
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onCloseRef.current();
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    // Otras vías de cancelación (p. ej. el gesto «atrás» en Android).
    event.preventDefault();
    onCloseRef.current();
  };

  const handleNativeClose = () => {
    // Cierre nativo por otra vía: se sincroniza el estado del padre. Si el padre decide seguir
    // abierto (p. ej. rechaza descartar cambios), se vuelve a abrir el <dialog> para no quedar
    // invisible con el scroll de la página bloqueado.
    if (openRef.current) onCloseRef.current();
    window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (openRef.current && dialog && !dialog.open && dialog.isConnected) {
        dialog.showModal();
        focusPreferred();
      }
    }, 0);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDialogElement>) => {
    pointerDownOnBackdrop.current = event.target === event.currentTarget;
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    // Solo cuenta como clic en el fondo si empezó y terminó fuera del contenido.
    if (pointerDownOnBackdrop.current && event.target === event.currentTarget) onCloseRef.current();
    pointerDownOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      className={`m-auto overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink-2 shadow-modal backdrop:bg-scrim open:flex open:flex-col ${SIZE_CLASSES[size]}`}
    >
      {open && (
        <>
          <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 id={titleId} className="min-w-0 flex-1 text-title font-semibold text-ink">
              {title}
            </h2>
            {headerActions}
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Cerrar"
              onClick={() => onCloseRef.current()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </header>
          <div ref={bodyRef} className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 ${bodyClassName}`}>
            {children}
          </div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-muted px-4 py-3 sm:px-5">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}

export {Modal};
