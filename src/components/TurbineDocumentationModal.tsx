import React, { useMemo, useState } from 'react';
import { BookOpen, FileText, Search, X } from 'lucide-react';
import { DOC_CATEGORIES, TURBINE_DOCUMENTATION } from '../utils/turbineDocumentation';

interface TurbineDocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TurbineDocumentationModal: React.FC<TurbineDocumentationModalProps> = ({ isOpen, onClose }) => {
  const [selectedId, setSelectedId] = useState(TURBINE_DOCUMENTATION[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return TURBINE_DOCUMENTATION.filter((doc) => (category === 'all' || doc.category === category)
      && (!query || `${doc.title} ${doc.subtitle} ${doc.summary} ${doc.equations.map((e) => `${e.name} ${e.formula} ${e.description}`).join(' ')}`.toLocaleLowerCase().includes(query)));
  }, [search, category]);
  const selected = filtered.find((doc) => doc.id === selectedId) ?? filtered[0];

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="turbine-doc-title" className="w-full max-w-6xl h-[min(92vh,900px)] rounded-2xl border border-slate-300 bg-white shadow-2xl overflow-hidden flex flex-col">
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-sky-100 text-sky-800 flex items-center justify-center"><BookOpen className="w-5 h-5" /></span><div><h2 id="turbine-doc-title" className="font-semibold text-slate-950">Documentación técnica</h2><p className="text-xs text-slate-600">Ecuaciones, supuestos y referencias del prediseño</p></div></div>
          <button onClick={onClose} aria-label="Cerrar documentación" className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)] min-h-0 flex-1">
          <nav className="border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 p-3 flex flex-col min-h-0 gap-2">
            <div className="relative"><Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ecuación o tema" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-500" /></div>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar documentación por tema" className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2.5 text-sm text-slate-900"><option value="all">Todos los temas</option>{DOC_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-600 px-1 pt-1">Índice · {filtered.length} temas</div>
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto min-h-0">{filtered.map((doc, index) => <button key={doc.id} onClick={() => setSelectedId(doc.id)} className={`text-left shrink-0 md:shrink rounded-lg px-2.5 py-2 ${selected?.id === doc.id ? 'bg-sky-100 border border-sky-300 text-sky-950' : 'border border-transparent text-slate-700 hover:bg-slate-100'}`}><span className="block text-[10px] text-slate-600 font-mono mb-0.5">{String(index + 1).padStart(2, '0')} · {doc.tag}</span><span className="block text-xs font-semibold">{doc.title}</span></button>)}</div>
          </nav>
          <article className="min-w-0 overflow-y-auto p-4 sm:p-6 space-y-4 text-slate-900">
            {!selected ? <div className="h-full flex flex-col items-center justify-center text-center text-slate-600"><FileText className="w-9 h-9 mb-3" /><p className="font-semibold">No hay temas coincidentes</p><p className="text-sm mt-1">Prueba otra búsqueda o categoría.</p></div> : <>
              <header className="border-b border-slate-300 pb-4"><span className="inline-flex text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-950 border border-sky-300 mb-2">{selected.tag}</span><h3 className="text-lg sm:text-xl font-semibold">{selected.title}</h3><p className="text-sm text-slate-700 mt-1">{selected.subtitle}</p><p className="mt-3 max-w-4xl text-sm text-slate-800 leading-relaxed">{selected.summary}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-white border border-slate-300 px-2.5 py-1">Modelo 1D de línea media</span><span className="rounded-full bg-white border border-slate-300 px-2.5 py-1">Gas ideal · propiedades constantes</span><span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-1 text-amber-950">Prediseño</span></div></header>
              <section><div className="flex items-center justify-between gap-2 mb-2"><h4 className="text-sm uppercase tracking-wider text-sky-950 font-bold">Ecuaciones del cálculo</h4><span className="text-xs text-slate-700">{selected.equations.length} relaciones</span></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">{selected.equations.map((equation, index) => <div key={equation.name} className="bg-white border border-slate-300 rounded-xl p-3.5 space-y-2.5 shadow-sm"><div className="flex gap-2 items-start"><span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full bg-sky-100 text-sky-950 text-xs font-bold font-mono">{index + 1}</span><h5 className="text-sm font-semibold text-slate-950 pt-0.5">{equation.name}</h5></div><div className="font-mono text-xs sm:text-sm font-medium bg-sky-50 px-3 py-2.5 rounded-lg border border-sky-200 overflow-x-auto whitespace-nowrap select-all">{equation.formula}</div><p className="text-xs leading-relaxed text-slate-700">{equation.description}</p></div>)}</div></section>
              <section className="grid grid-cols-1 xl:grid-cols-2 gap-3"><div className="rounded-xl border border-slate-300 bg-white p-3.5"><h4 className="text-xs uppercase tracking-wider font-bold text-slate-950 mb-2">Supuestos y notas</h4><ul className="space-y-2 text-xs text-slate-800 leading-relaxed">{selected.details.map((detail, index) => <li key={index} className="flex gap-2"><span className="text-sky-800 font-bold">•</span><span>{detail}</span></li>)}</ul></div><div className="rounded-xl border border-sky-300 bg-sky-50 p-3.5"><h4 className="text-xs uppercase tracking-wider font-bold text-sky-950 mb-2">Lectura de diseño</h4><ul className="space-y-2 text-xs text-slate-800 leading-relaxed">{selected.designTips.map((tip, index) => <li key={index} className="flex gap-2"><span className="text-sky-800">•</span><span>{tip}</span></li>)}</ul></div></section>
              <footer className="border-t border-slate-300 pt-3"><h4 className="text-xs uppercase tracking-wider font-semibold text-slate-700 mb-2">Bibliografía de referencia</h4><div className="flex flex-wrap gap-2">{selected.references.map((reference, index) => <span key={index} className="max-w-full text-xs leading-relaxed text-slate-800 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5">{reference}</span>)}</div></footer>
            </>}
          </article>
        </div>
      </section>
    </div>
  );
};
