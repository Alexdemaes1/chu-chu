import {Component, type ErrorInfo, type ReactNode} from 'react';

/** Clave de localStorage con las ecuaciones activas; es lo único que se borra al restablecer. */
const ACTIVE_EQUATIONS_STORAGE_KEY = 'axial-turbine.active-equations.v1';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Captura cualquier excepción durante el renderizado y muestra una pantalla de recuperación
 * en lugar de dejar la página en blanco.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error al dibujar la aplicación:', error, info.componentStack);
  }

  private handleResetEquations = (): void => {
    try {
      window.localStorage.removeItem(ACTIVE_EQUATIONS_STORAGE_KEY);
    } catch {
      // Sin acceso al almacenamiento (modo privado o bloqueado): basta con recargar.
    }
    window.location.reload();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <main className="min-h-dvh flex items-center justify-center bg-canvas px-4 py-10">
        <section
          role="alert"
          aria-labelledby="error-boundary-title"
          className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-card"
        >
          <h1 id="error-boundary-title" className="text-title font-semibold text-ink">
            Algo ha fallado al dibujar la app
          </h1>
          <p className="mt-2 text-body text-ink-2">
            La causa más habitual es una configuración de ecuaciones guardada que no tiene un formato válido
            (por ejemplo, un fichero importado y editado a mano). Puedes restablecer solo las ecuaciones
            personalizadas, sin tocar nada más, o simplemente recargar la página.
          </p>
          <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 font-mono text-caption text-ink-3 break-words">
            {error.message || 'Error desconocido'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={this.handleResetEquations}>
              Restablecer ecuaciones
            </button>
            <button type="button" className="btn-secondary" onClick={this.handleReload}>
              Recargar
            </button>
          </div>
        </section>
      </main>
    );
  }
}
