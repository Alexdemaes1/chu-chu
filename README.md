# Turbina 1D: prediseño de etapas de turbina axial

Aplicación web para el **prediseño preliminar (1D, mean-line)** de etapas de turbina axial.
A partir de las condiciones de entrada y de unos pocos parámetros por etapa, calcula al instante
el rendimiento, la potencia, los triángulos de velocidades, las pérdidas y una geometría inicial del álabe.

> Es una herramienta de **diseño preliminar**: sirve para explorar el espacio de diseño y llegar a un
> punto de partida razonable antes de pasar a CFD o a herramientas 2D/3D. No sustituye a esas herramientas.

## Qué hace

- **Entradas globales:** fluido (gas de combustión, aire, H₂, vapor, sCO₂), caudal másico ṁ, presión y temperatura totales de entrada.
- **Por etapa:** relación de presiones, rpm, radio medio, grado de reacción R y coeficiente de flujo φ. Admite varias etapas, ejes y configuraciones contrarrotativas.
- **Resultados:** rendimiento total-a-total y total-a-estático, potencia, factor de recalentamiento, números de Mach y altura de álabe.
- **Modelos de pérdidas:** Soderberg, Ainley-Mathieson simplificado o una ecuación propia (editor de ecuaciones).
- **Gráficos:** triángulos de velocidades, diagramas de Smith y Balje, perfil del álabe (Bézier) en tres secciones radiales (vórtice libre) y rotor en 3D (three.js).
- **Auditoría:** avisos de diseño (Mach relativo, carga de Zweifel, solidez, deflexión, relación cubo/punta…).
- **Barrido de diseño:** optimización φ-ψ para cumplir una potencia objetivo por eje.
- **Exportación:** STL (CAD/impresión 3D) y coordenadas CSV del álabe.

Pulsa **«Cargar ejemplo»** en el panel izquierdo para ver un caso completo (etapa de turbina de gas, reacción 50 %).

## Desarrollo

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tests de la física (node:test con tsx)
npm run typecheck  # comprobación de tipos
npm run build      # build de producción en dist/
npm run check      # typecheck, tests y build seguidos
```

## Estructura

```
src/
  App.tsx                     interfaz principal (3 paneles)
  components/                 gráficos, visor 3D y modales
  utils/turbine1D.ts          motor de cálculo 1D (termodinámica, triángulos y pérdidas)
  utils/customEquations.ts    correlaciones editables y evaluador seguro de expresiones
  utils/bladeGeometry.ts      geometría del álabe (Bézier y equilibrio radial)
  utils/designOptimization.ts barrido φ-ψ
  utils/exportGeometry.ts     exportación STL/CSV y auditoría de diseño
  utils/*.test.ts             tests
```

## Despliegue

Desplegado en Vercel como sitio estático (Vite). Cada push a `main` despliega automáticamente.

## Referencias

Soderberg (1949); Ainley & Mathieson (ARC R&M 2891, 1951); Dixon & Hall, *Fluid Mechanics and
Thermodynamics of Turbomachinery*; Horlock, *Axial Flow Turbines*; Balje, *Turbomachines*.
