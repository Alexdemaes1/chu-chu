# CLAUDE.md

Contexto para Claude Code en este repositorio.

## Qué es

App web de **prediseño 1D (mean-line) de etapas de turbina axial**: termodinámica, triángulos de velocidades,
pérdidas (Soderberg / Ainley-Mathieson / ecuación propia), geometría del álabe, rotor 3D y exportación STL/CSV.
Es 100 % cliente (no hay backend, ni API, ni claves): una SPA estática de Vite desplegada en Vercel.

**El dueño del proyecto no es programador.** Explícale los cambios en lenguaje llano, en español, y pregúntale
antes de tomar decisiones de producto. Él aporta el conocimiento de turbomáquinas; tú, el de software.

## Stack

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · three.js · lucide-react. Tests con `node:test` lanzados con `tsx`.

## Comandos

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tests de física
npm run typecheck
npm run lint:theme # falla si queda alguna clase del antiguo tema oscuro
npm run build
npm run check      # typecheck, tests, lint:theme y build: ejecútalo SIEMPRE antes de hacer commit
```

## Estructura

- `src/utils/turbine1D.ts`: motor de cálculo. Lógica pura, sin React. **Toda la física va aquí o en `utils/`**, nunca en componentes.
- `src/utils/customEquations.ts`: correlaciones editables y `safeEvaluateMath` (evaluador de expresiones en sandbox; no usar `eval`).
- `src/utils/bladeGeometry.ts`: perfiles Bézier y equilibrio radial (vórtice libre).
- `src/utils/designOptimization.ts`: barrido φ-ψ (`shaftNameOf`, `blocker`, `maxMach`/`machFlag` por candidato).
- `src/utils/exportGeometry.ts`: STL binario, CSV de coordenadas (`cad` o `excel`) y auditoría de diseño por etapa (Mach de salida incluido).
- `src/utils/designState.ts`: guardar y cargar el diseño (localStorage, enlace y JSON). `exampleDesign.ts`: diseño de ejemplo inicial.
- `src/utils/download.ts`: `downloadBlob(blob, nombre)`; úsalo para cualquier descarga.
- `src/utils/format.ts`: `formatNumber(valor, decimales)` con coma decimal; úsalo para toda cifra que se muestra en pantalla.
- `src/hooks/useTurbineDesign.ts`: estado del diseño y todo lo derivado (resultados, bloqueos, auditoría, barrido).
- `src/App.tsx`: solo composición de paneles; el estado vive en el hook.
- `src/components/layout/`: cabecera y guía. `components/inputs/`: panel de entradas, editor de etapa y barrido.
  `components/results/`: KPIs, tabla de resultados y alertas.
- `src/components/ui/`: primitivas comunes. `NumberField` (campo numérico con coma decimal, rango y unidad),
  `Modal` (sobre `<dialog>`: Escape, foco y bloqueo de scroll) y `Tabs`. Úsalas en lugar de reinventarlas.
- `src/components/ErrorBoundary.tsx`: pantalla de recuperación si algo falla al dibujar.
- `src/utils/gasLabels.ts`: nombres de gases y modelos de pérdidas en español.
- `src/components/`: visor 3D, triángulos, mapas de Balje/Smith, perfil del álabe y modales de ecuaciones y documentación.
- `scripts/check-theme.mjs`: comprobación de `npm run lint:theme`.

## Reglas

- Cualquier cambio en la física (`utils/`) lleva un test en `*.test.ts` con valores de referencia justificados (libro, paper o cálculo a mano).
- Interfaz en **español**; unidades del SI en el motor (Pa, K, m, kg/s) y unidades de ingeniería en la UI (bar, mm, kW).
- No reintroducir dependencias de Google AI Studio / Gemini ni backend (`express`); el proyecto vino de ahí y se limpió.
- Despliegue: cada push a `main` despliega en Vercel automáticamente (`vercel.json`). El CI de GitHub Actions ejecuta `npm run check`.
- Commits pequeños y con mensaje descriptivo en español.
- Fuentes alojadas en el proyecto (`@fontsource-variable`); no cargar nada de CDNs externos: `vercel.json` fija una
  Content-Security-Policy que solo permite recursos propios.

## Tema visual (importante)

Tema claro único, construido con **tokens semánticos** definidos en el bloque `@theme` de `src/index.css`.
No hay reglas `!important` que reasignen colores: cada clase significa lo que dice.

- Superficies: `bg-canvas` (fondo de página), `bg-surface` (tarjetas), `bg-surface-muted`, `bg-surface-sunken`.
- Líneas: `border-line`, `border-line-strong`; en gráficos, `var(--color-grid)` y `var(--color-axis)`. Fondo de modal: `bg-scrim`.
- Texto: `text-ink` (principal), `text-ink-2` (secundario), `text-ink-3` (apagado, sigue cumpliendo AA).
- Acento y estados: `accent`, `accent-strong`, `accent-soft`; `ok`, `warn`, `danger` y sus `-soft`.
- Series de gráficos: `series-hub/mid/tip`, `series-v/w/u` (triángulos), `series-ss/ps` (perfil). En SVG y canvas
  se leen con `var(--color-…)` o `getComputedStyle`.
- Tipografía: `text-caption` (12 px, mínimo absoluto), `text-label`, `text-body`, `text-title`, `text-kpi`.
- Forma: `rounded-card` + `shadow-card` para tarjetas, `shadow-modal` para modales.
- Utilidades: `btn-primary`, `btn-secondary` y `field` (inputs).
- **Monoespaciada solo para expresiones, coordenadas y código.** Las cifras van en sans con `tabular-nums`.

Mapa para migrar clases antiguas (quitando siempre el sufijo de opacidad `/NN`):
`bg-slate-950→bg-surface-muted`, `bg-slate-900→bg-surface`, `bg-slate-800→bg-surface-sunken`, `bg-slate-700→bg-line`;
`text-white/slate-100→text-ink` (blanco real solo sobre fondo de acento sólido), `text-slate-200/300→text-ink-2`,
`text-slate-400/500→text-ink-3`; `border-slate-800→border-line`, `border-slate-700→border-line-strong`;
cian→`accent`, ámbar→`warn`, esmeralda→`ok`, rosa→`danger`; `bg-*-950→bg-*-soft`; `text-[8|9|10px]→text-caption`,
`text-[11px]→text-label`.

`npm run lint:theme` (incluido en `check` y en el CI) falla si reaparece alguna clase del tema oscuro antiguo.

## Pendientes (backlog, por prioridad)

Hecho en la integración de noviembre de 2026: tema claro con tokens (sin hack `!important`), `BladeProfileCanvas` y visor 3D
rehechos, `App.tsx` troceado en hook y paneles, diseño persistente (localStorage, enlace y JSON), `any` eliminados,
correcciones de física (Y→ζ, ξ con signo, Dunham-Came, Soderberg continuo, remolino de entrada del estator, P2 con
pérdida del estator) y avisos de Mach de salida en la auditoría y el barrido.

1. **Turbinas radiales**: el motor las soporta (`turbineType: 'radial'`, hay test) pero la UI solo ofrece axiales.
   Antes de añadir el selector, preguntar al dueño qué validez física da al modelo radial.
2. **Decisiones de producto pendientes del barrido** (preguntar al dueño):
   - Una fila sin PR ni ψ bloquea el barrido de las demás y no hay campo de PR en la UI: con dos filas nuevas,
     ninguna se puede barrer (hay que quitar la segunda, barrer y volver a añadirla). Se resuelve con el «modo directo».
   - Al añadir una fila, el objetivo del eje sigue siendo la potencia de una etapa: la fila 1 ya lo cumple y barrer la
     fila 2 da candidatos degenerados (Rh/Rt ≈ 0,02, h ≈ 430 mm) que hoy se marcan viables. Valorar un Rh/Rt mínimo.
3. **Modo directo**: Rm, φ y ψ editables a mano sin pasar por el barrido.
4. **Informe imprimible** del diseño (vista `/#informe` con `@media print`; la base de impresión ya existe).
5. **Comparar diseños**: «Fijar como referencia» con deltas en los KPIs y «Deshacer» del barrido.
6. **Web Worker para el barrido φ-ψ** con progreso y cancelación (ahora: «Calculando…» y umbral de coste por filas).
7. Tests de componentes (Vitest + Testing Library) para el flujo «Ejemplo → cambiar T01 → KPIs visibles».
8. Validar las correlaciones contra casos publicados (Dixon & Hall, ejemplos resueltos) y documentar el margen de error.
9. Física aplazada:
   - Pérdida por Mach/choque (Kacker-Okapuu, drag-rise para M₂ > 1).
   - Soderberg con corrección de Reynolds (μ de Sutherland) y forma de Dixon con T3/T2 para η_tt.
   - A&M: s/c del dimensionado por Zweifel acoplado a las pérdidas, con (s/c)_opt; pérdida de perfil del estator
     con interpolación en ξ cuando α0 ≠ 0; `T1_static` de una fila solo-rotor sin su remolino de entrada.
   - Equilibrio radial con Va(r) para `vortexExponent ≠ 1` (ahora solo se avisa en la UI).
   - Alturas de álabe y AR por fila (estator h2, rotor h3); ahora `bladeHeight` es la salida del rotor.
   - Comprobación explícita de ṁ de bloqueo por fila (hoy cubierta por los umbrales de Mach).
   - `tmaxToChord` editable: entonces habrá que añadirlo a `EquationEvaluationContext` (hoy el catálogo usa
     `CATALOG_TMAX_TO_CHORD = 0.20`).
10. Interfaz:
    - KaTeX para las fórmulas del editor de ecuaciones (ahora se muestra la forma ascii).
    - Separador decimal: los KPIs y la tabla muestran punto (`toFixed`) y otros textos coma (`es-ES`); unificar.
    - Activar `<StrictMode>` en `main.tsx` y comprobar que el visor 3D sobrevive al doble montaje en desarrollo.
    - Gestos avanzados: pinch-zoom completo en el perfil 2D y gestos en el 3D.
