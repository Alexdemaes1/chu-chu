import {useId, useMemo, useRef, useState} from 'react';
import {FileText, Search, X} from 'lucide-react';
import Modal from './ui/Modal';
import {DOC_CATEGORIES, TURBINE_DOCUMENTATION, type DocCategory, type DocSection} from '../utils/turbineDocumentation';

interface TurbineDocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type CategoryFilter = DocCategory | 'all';

const SEARCH_INDEX: Record<string, string> = Object.fromEntries(
  TURBINE_DOCUMENTATION.map((doc) => [
    doc.id,
    [
      doc.title,
      doc.subtitle,
      doc.tag,
      doc.summary,
      ...doc.equations.map((equation) => `${equation.name} ${equation.formula} ${equation.description}`),
      ...doc.details,
      ...doc.designTips,
    ]
      .join(' ')
      .toLocaleLowerCase('es'),
  ]),
);

function isCategoryFilter(value: string): value is CategoryFilter {
  return value === 'all' || DOC_CATEGORIES.some((category) => category.id === value);
}

/** Documentación técnica del modelo: índice filtrable a la izquierda y ficha del tema a la derecha. */
export function TurbineDocumentationModal({isOpen, onClose}: TurbineDocumentationModalProps) {
  const ids = useId();
  const searchId = `${ids}-search`;
  const categoryId = `${ids}-category`;
  const articleRef = useRef<HTMLElement>(null);

  const [selectedId, setSelectedId] = useState(TURBINE_DOCUMENTATION[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    return TURBINE_DOCUMENTATION.filter(
      (doc) => (category === 'all' || doc.category === category) && (!query || SEARCH_INDEX[doc.id].includes(query)),
    );
  }, [search, category]);

  const selected: DocSection | undefined = filtered.find((doc) => doc.id === selectedId) ?? filtered[0];

  const selectTopic = (id: string) => {
    setSelectedId(id);
    articleRef.current?.scrollIntoView({block: 'start'});
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex flex-col">
          <span>Documentación técnica</span>
          <span className="text-label font-normal text-ink-3">Ecuaciones, supuestos y referencias del prediseño</span>
        </span>
      }
    >
      <div className="grid min-h-[60dvh] grid-cols-1 gap-4 md:grid-cols-[15.5rem_minmax(0,1fr)] md:gap-6">
        <nav
          aria-label="Índice de la documentación"
          className="flex min-w-0 flex-col gap-2 md:sticky md:top-0 md:max-h-[calc(100dvh-9rem)] md:self-start md:overflow-y-auto"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor={searchId} className="text-label font-medium text-ink-2">
              Buscar
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ecuación, símbolo o tema"
                autoComplete="off"
                className="field h-10 w-full pl-8 pr-8 text-base sm:h-9 sm:text-sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Borrar la búsqueda"
                  className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-sunken hover:text-ink"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={categoryId} className="text-label font-medium text-ink-2">
              Tema
            </label>
            <select
              id={categoryId}
              value={category}
              onChange={(event) => {
                if (isCategoryFilter(event.target.value)) setCategory(event.target.value);
              }}
              className="field h-10 w-full text-base sm:h-9 sm:text-sm"
            >
              <option value="all">Todos los temas</option>
              {DOC_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <p className="px-1 pt-1 text-caption font-medium text-ink-3" aria-live="polite">
            {filtered.length === 1 ? '1 tema' : `${filtered.length} temas`}
          </p>

          <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:pb-0">
            {filtered.map((doc, index) => {
              const isActive = selected?.id === doc.id;
              return (
                <li key={doc.id} className="shrink-0 md:shrink">
                  <button
                    type="button"
                    onClick={() => selectTopic(doc.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`w-full max-w-[14rem] rounded-lg border px-2.5 py-2 text-left md:max-w-none ${
                      isActive
                        ? 'border-cyan-300 bg-accent-soft text-accent-strong'
                        : 'border-transparent text-ink-2 hover:bg-surface-sunken'
                    }`}
                  >
                    <span className="block text-caption tabular-nums text-ink-3">
                      {String(index + 1).padStart(2, '0')} · {doc.tag}
                    </span>
                    <span className="block text-label font-semibold">{doc.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <article ref={articleRef} className="min-w-0 scroll-mt-4 space-y-5 text-ink-2">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-center text-ink-3">
              <FileText className="mb-3 h-9 w-9" aria-hidden="true" />
              <p className="font-semibold text-ink-2">No hay temas que coincidan</p>
              <p className="mt-1 text-body">Prueba con otra búsqueda o con otro tema.</p>
            </div>
          ) : (
            <>
              <header className="border-b border-line pb-4">
                <span className="mb-2 inline-flex rounded-full border border-cyan-200 bg-accent-soft px-2.5 py-0.5 text-caption font-semibold text-accent-strong">
                  {selected.tag}
                </span>
                <h3 className="text-xl font-semibold text-ink">{selected.title}</h3>
                <p className="mt-1 text-body text-ink-3">{selected.subtitle}</p>
                <p className="mt-3 max-w-4xl text-body leading-relaxed text-ink-2">{selected.summary}</p>
                <ul className="mt-3 flex flex-wrap gap-2 text-caption" aria-label="Ámbito del modelo">
                  <li className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-ink-2">Modelo 1D de línea media</li>
                  <li className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-ink-2">Gas ideal · propiedades constantes</li>
                  <li className="rounded-full border border-amber-200 bg-warn-soft px-2.5 py-1 font-medium text-warn">Prediseño</li>
                </ul>
              </header>

              <section aria-labelledby={`${ids}-equations`}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h4 id={`${ids}-equations`} className="text-title font-semibold text-ink">
                    Ecuaciones del cálculo
                  </h4>
                  <span className="text-caption text-ink-3">
                    {selected.equations.length === 1 ? '1 relación' : `${selected.equations.length} relaciones`}
                  </span>
                </div>
                <ol className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {selected.equations.map((equation, index) => (
                    <li key={equation.name} className="space-y-2.5 rounded-card border border-line bg-surface p-3.5 shadow-card">
                      <div className="flex items-start gap-2">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-caption font-bold tabular-nums text-accent-strong"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <h5 className="pt-0.5 text-body font-semibold text-ink">{equation.name}</h5>
                      </div>
                      <div className="overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-surface-muted px-3 py-2.5 font-mono text-body text-ink select-all">
                        {equation.formula}
                      </div>
                      <p className="text-label leading-relaxed text-ink-2">{equation.description}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="rounded-card border border-line bg-surface p-3.5">
                  <h4 className="mb-2 text-body font-semibold text-ink">Supuestos y notas</h4>
                  <ul className="list-disc space-y-2 pl-4 text-label leading-relaxed text-ink-2 marker:text-accent">
                    {selected.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-card border border-cyan-200 bg-accent-soft p-3.5">
                  <h4 className="mb-2 text-body font-semibold text-accent-strong">Lectura de diseño</h4>
                  <ul className="list-disc space-y-2 pl-4 text-label leading-relaxed text-ink-2 marker:text-accent">
                    {selected.designTips.map((tip, index) => (
                      <li key={index}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </section>

              <footer className="border-t border-line pt-3">
                <h4 className="mb-2 text-body font-semibold text-ink">Bibliografía de referencia</h4>
                <ul className="flex flex-wrap gap-2">
                  {selected.references.map((reference, index) => (
                    <li
                      key={index}
                      className="max-w-full rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-label leading-relaxed text-ink-2"
                    >
                      {reference}
                    </li>
                  ))}
                </ul>
              </footer>
            </>
          )}
        </article>
      </div>
    </Modal>
  );
}

export default TurbineDocumentationModal;
