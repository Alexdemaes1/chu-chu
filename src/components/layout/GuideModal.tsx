import { ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';

export type GuideTarget = 'operation' | 'sweep' | 'geometry' | 'triangles';

export interface GuideModalProps {
  open: boolean;
  onClose: () => void;
  /** Lleva al usuario a la zona de la app correspondiente a cada paso. */
  onNavigate: (target: GuideTarget) => void;
}

const STEPS: { title: string; body: string; action: string; target: GuideTarget }[] = [
  {
    title: 'Define el punto de operación',
    body: 'Elige el fluido y ajusta el flujo másico, la presión total y la temperatura total de entrada.',
    action: 'Ir a las condiciones',
    target: 'operation',
  },
  {
    title: 'Configura las etapas y barre φ–ψ',
    body: 'Fija la velocidad y la reacción de cada etapa, asigna su eje y la potencia objetivo, y lanza el barrido para obtener φ, ψ y el radio medio.',
    action: 'Ir al barrido',
    target: 'sweep',
  },
  {
    title: 'Revisa la geometría',
    body: 'La app deriva alturas, radios, cuerdas, pasos y número de álabes a partir de los estados calculados.',
    action: 'Ver la geometría',
    target: 'geometry',
  },
  {
    title: 'Comprueba antes de exportar',
    body: 'Revisa los triángulos de velocidades, las pérdidas y las alertas. Usa los resultados como predimensionado.',
    action: 'Ver los triángulos',
    target: 'triangles',
  },
];

export function GuideModal({ open, onClose, onNavigate }: GuideModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Guía rápida de prediseño" size="md">
      <p className="text-body text-ink-2">
        Sigue este orden para definir y revisar un concepto de turbina axial. Al abrir la app ya hay un ejemplo
        cargado: puedes cambiar cualquier entrada y ver el efecto al momento.
      </p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col rounded-card bg-surface-muted p-4">
            <span className="text-caption font-semibold text-accent-strong">Paso {index + 1}</span>
            <h3 className="mt-1 text-body font-semibold text-ink">{step.title}</h3>
            <p className="mt-1.5 flex-1 text-body text-ink-2">{step.body}</p>
            <button
              type="button"
              onClick={() => {
                onNavigate(step.target);
                onClose();
              }}
              className="mt-3 inline-flex items-center gap-1 self-start rounded-md text-body font-semibold text-accent-strong hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
            >
              {step.action}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-caption text-ink-3">
        La herramienta estima conceptos de etapa axial con un modelo 1D de línea media; valida los casos
        importantes con métodos más detallados.
      </p>
    </Modal>
  );
}

export default GuideModal;
