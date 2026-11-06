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
npm run build
npm run check      # typecheck, tests y build: ejecútalo SIEMPRE antes de hacer commit
```

## Estructura

- `src/utils/turbine1D.ts`: motor de cálculo. Lógica pura, sin React. **Toda la física va aquí o en `utils/`**, nunca en componentes.
- `src/utils/customEquations.ts`: correlaciones editables y `safeEvaluateMath` (evaluador de expresiones en sandbox; no usar `eval`).
- `src/utils/bladeGeometry.ts`: perfiles Bézier y equilibrio radial (vórtice libre).
- `src/utils/designOptimization.ts`: barrido φ-ψ.
- `src/utils/exportGeometry.ts`: STL binario, CSV de coordenadas y auditoría de diseño.
- `src/App.tsx`: estado e interfaz (unas 1.200 líneas; ver pendientes).
- `src/components/`: visor 3D, triángulos, mapas de Balje/Smith, perfil del álabe, modales.

## Reglas

- Cualquier cambio en la física (`utils/`) lleva un test en `*.test.ts` con valores de referencia justificados (libro, paper o cálculo a mano).
- Interfaz en **español**; unidades del SI en el motor (Pa, K, m, kg/s) y unidades de ingeniería en la UI (bar, mm, kW).
- No reintroducir dependencias de Google AI Studio / Gemini ni backend (`express`); el proyecto vino de ahí y se limpió.
- Despliegue: cada push a `main` despliega en Vercel automáticamente (`vercel.json`). El CI de GitHub Actions ejecuta `npm run check`.
- Commits pequeños y con mensaje descriptivo en español.

## Tema visual (importante)

La app usa **tema claro**, pero los componentes se escribieron con clases oscuras (`bg-slate-900`, `text-white`…).
`src/index.css` las **reasigna a colores claros con `!important`**. Consecuencias:
- `text-white` se pinta oscuro. Para texto blanco de verdad usa `text-[#fff]`.
- Las clases nuevas deben ser claras (`bg-white`, `text-slate-800`, `border-slate-200`).

## Pendientes (backlog, por prioridad)

1. **Quitar el hack de tema de `index.css`**: sustituir en los componentes las clases oscuras por sus equivalentes claros y borrar las reglas `!important`. Comprobar visualmente cada panel.
2. **`BladeProfileCanvas`** (perfil 2D del álabe, bajo el visor 3D) conserva el estilo oscuro original y algunos textos tienen poco contraste. Adaptarlo al tema claro; los perfiles se ven pequeños con el zoom inicial.
3. **Trocear `App.tsx`**: sacar el panel de entradas, el de resultados y el barrido a componentes, y el estado derivado a hooks (`useTurbineDesign`).
4. **Persistir el diseño** en `localStorage` o en la URL (ahora solo se guardan las ecuaciones personalizadas) y añadir exportar/importar el diseño en JSON.
5. **Turbinas radiales**: el motor las soporta (`turbineType: 'radial'`, hay test) pero la UI solo ofrece axiales.
6. Tipar los `any` que quedan (`App.tsx` `handleStageFieldChange`, `BladeProfileCanvas`, `catch (err: any)`).
7. Tests de componentes (Vitest + Testing Library) para el flujo «Cargar ejemplo → resultados».
8. Validar las correlaciones contra casos publicados (Dixon & Hall, ejemplos resueltos) y documentar el margen de error.
