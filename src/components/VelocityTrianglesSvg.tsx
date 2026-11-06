import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import type { VelocityTriangleStation } from '../utils/turbine1D';

interface VelocityTrianglesSvgProps {
  inlet: VelocityTriangleStation;
  outlet: VelocityTriangleStation;
  U: number;
  turbineType: 'axial' | 'radial';
  stageName?: string;
  direction?: 1 | -1;
  isVanelessCoupled?: boolean;
}

/* Geometría del dibujo, en unidades del viewBox. El viewBox se ajusta al ancho real del
   contenedor (1 unidad = 1 px), así que los tamaños de letra son píxeles de pantalla. */
const plotHeightFor = (width: number) => Math.min(270, Math.max(210, Math.round(width * 0.42)));
const PAD_X = 30;
const PAD_TOP = 34;
const PAD_BOTTOM = 36;
const ARC_R_ALPHA = 30;
const ARC_R_BETA = 48;
const FONT = 12;
const MIN_WIDTH = 240;
const MAX_WIDTH = 760;

const MACH_WARN = 0.95;
const MACH_DANGER = 1.0;

function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (raw: number) => {
      const next = Math.round(raw);
      if (next > 0) setWidth((previous) => (previous === next ? previous : next));
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

interface Layout {
  width: number;
  height: number;
  scale: number;
  originX: number;
  originY: number;
}

/**
 * Escala y origen comunes a las dos estaciones, para que los triángulos se puedan comparar a simple vista.
 * El rango horizontal cubre con signo 0, Vθ y Wθ (= Vθ − U) de ambas estaciones.
 */
function computeLayout(stations: VelocityTriangleStation[], rawWidth: number): Layout | null {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth));
  const xs = stations.flatMap((station) => [0, station.V_theta, station.W_theta]);
  const vas = stations.map((station) => station.Va);
  if (![...xs, ...vas].every(Number.isFinite)) return null;
  const maxVa = Math.max(...vas);
  if (!(maxVa > 0)) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = Math.max(maxX - minX, maxVa * 0.25);
  const height = plotHeightFor(width);
  const originY = height - PAD_BOTTOM;
  const scale = Math.min((width - 2 * PAD_X) / spanX, (originY - PAD_TOP) / maxVa);
  const drawnWidth = (maxX - minX) * scale;
  const originX = (width - drawnWidth) / 2 - minX * scale;
  return { width, height, scale, originX, originY };
}

const fmt = (value: number, digits: number) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

function machTone(value: number): string {
  if (!Number.isFinite(value)) return 'text-ink-3';
  if (value > MACH_DANGER) return 'text-danger';
  if (value > MACH_WARN) return 'text-warn';
  return 'text-ink';
}

type Point = { x: number; y: number };

/** Posición de la etiqueta de un vector: hacia el 60 % de su longitud y desplazada hacia fuera del triángulo. */
function vectorLabel(from: Point, to: Point, centroid: Point, offset = 13) {
  const mid = { x: from.x + (to.x - from.x) * 0.6, y: from.y + (to.y - from.y) * 0.6 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (nx * (mid.x - centroid.x) + ny * (mid.y - centroid.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const anchor: 'start' | 'middle' | 'end' = nx > 0.3 ? 'start' : nx < -0.3 ? 'end' : 'middle';
  return { x: mid.x + nx * offset, y: mid.y + ny * offset, anchor };
}

/**
 * Arco de ángulo medido desde la dirección axial (vertical hacia abajo en el dibujo).
 * En pantalla (y hacia abajo), pasar de «abajo» hacia la derecha es antihorario: sweep-flag 0 si el ángulo es positivo.
 */
function angleArc(apex: Point, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const end = { x: apex.x + radius * Math.sin(rad), y: apex.y + radius * Math.cos(rad) };
  const path = `M ${apex.x} ${apex.y + radius} A ${radius} ${radius} 0 0 ${angleDeg > 0 ? 0 : 1} ${end.x} ${end.y}`;
  // Símbolo en la bisectriz si la cuña es ancha; si es estrecha, justo por fuera del extremo del arco.
  const sign = angleDeg >= 0 ? 1 : -1;
  const narrow = Math.abs(angleDeg) < 28;
  const labelAngle = narrow ? sign * (Math.abs(angleDeg) + 6) : angleDeg / 2;
  const labelRad = (labelAngle * Math.PI) / 180;
  const labelRadius = narrow ? radius + 2 : radius + 9;
  const label = {
    x: apex.x + labelRadius * Math.sin(labelRad) + (narrow ? sign * 3 : 0),
    y: apex.y + labelRadius * Math.cos(labelRad),
    anchor: (narrow ? (sign > 0 ? 'start' : 'end') : 'middle') as 'start' | 'middle' | 'end',
  };
  return { path, label };
}

interface StationPlotProps {
  station: VelocityTriangleStation;
  index: '1' | '2';
  title: string;
  layout: Layout;
  idPrefix: string;
}

function StationPlot({ station, index, title, layout, idPrefix }: StationPlotProps) {
  const { width, height, scale, originX, originY } = layout;
  const titleId = `${idPrefix}-title-${index}`;
  const markerV = `${idPrefix}-arrow-v-${index}`;
  const markerW = `${idPrefix}-arrow-w-${index}`;
  const markerU = `${idPrefix}-arrow-u-${index}`;

  const apex = { x: originX, y: originY - station.Va * scale };
  const baseV = { x: originX + station.V_theta * scale, y: originY };
  const baseW = { x: originX + station.W_theta * scale, y: originY };
  const centroid = { x: (apex.x + baseV.x + baseW.x) / 3, y: (apex.y + baseV.y + baseW.y) / 3 };

  const labelV = vectorLabel(apex, baseV, centroid);
  const labelW = vectorLabel(apex, baseW, centroid);
  const showAlpha = Math.abs(station.alpha) > 0.5;
  const showBeta = Math.abs(station.beta) > 0.5;
  const arcAlpha = angleArc(apex, ARC_R_ALPHA, station.alpha);
  const arcBeta = angleArc(apex, ARC_R_BETA, station.beta);
  const uLength = Math.abs(baseV.x - baseW.x);
  // La etiqueta de Va se centra sobre el vértice sin salirse del dibujo (ancho estimado del texto).
  const vaLabel = `Va = ${fmt(station.Va, 0)} m/s`;
  const vaHalfWidth = (vaLabel.length * FONT * 0.6) / 2;
  const vaLabelX = Math.min(width - vaHalfWidth - 4, Math.max(vaHalfWidth + 4, apex.x));

  const summary =
    `${title}: V = ${fmt(station.V, 1)} m/s, W = ${fmt(station.W, 1)} m/s, ` +
    `α = ${fmt(station.alpha, 1)}°, β = ${fmt(station.beta, 1)}°, Va = ${fmt(station.Va, 1)} m/s, ` +
    `U = ${fmt(Math.abs(station.U), 1)} m/s.`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
      role="img"
      aria-labelledby={titleId}
      fontSize={FONT}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <title id={titleId}>{summary}</title>
      <defs>
        {[
          { id: markerV, className: 'fill-series-v' },
          { id: markerW, className: 'fill-series-w' },
          { id: markerU, className: 'fill-series-u' },
        ].map((marker) => (
          <marker
            key={marker.id}
            id={marker.id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" className={marker.className} />
          </marker>
        ))}
      </defs>

      {/* Ejes: dirección tangencial (horizontal) y axial (vertical) */}
      <line x1={PAD_X / 2} y1={originY} x2={width - PAD_X / 2} y2={originY} className="stroke-grid" strokeWidth={1} />
      <line x1={originX} y1={PAD_TOP - 14} x2={originX} y2={originY + 8} className="stroke-grid" strokeWidth={1} />
      <text x={width - PAD_X / 2} y={originY - 6} textAnchor="end" className="fill-ink-3">
        θ+
      </text>

      {/* Componente axial Va */}
      <line
        x1={apex.x}
        y1={apex.y}
        x2={apex.x}
        y2={originY}
        className="stroke-axis"
        strokeWidth={1.25}
        strokeDasharray="4 3"
      />
      <text x={vaLabelX} y={apex.y - 10} textAnchor="middle" className="fill-ink-3">
        {vaLabel}
      </text>

      {/* Arcos de ángulo */}
      {showAlpha && (
        <g>
          <path d={arcAlpha.path} fill="none" className="stroke-series-v" strokeWidth={1.25} />
          <text
            x={arcAlpha.label.x}
            y={arcAlpha.label.y}
            textAnchor={arcAlpha.label.anchor}
            dominantBaseline="middle"
            fontWeight={600}
            className="fill-series-v"
          >
            α{index === '1' ? '₁' : '₂'}
          </text>
        </g>
      )}
      {showBeta && (
        <g>
          <path d={arcBeta.path} fill="none" className="stroke-series-w" strokeWidth={1.25} strokeDasharray="3 2" />
          <text
            x={arcBeta.label.x}
            y={arcBeta.label.y}
            textAnchor={arcBeta.label.anchor}
            dominantBaseline="middle"
            fontWeight={600}
            className="fill-series-w"
          >
            β{index === '1' ? '₁' : '₂'}
          </text>
        </g>
      )}

      {/* U: de la base de W a la base de V (V = W + U) */}
      {uLength > 1 && (
        <line
          x1={baseW.x}
          y1={originY}
          x2={baseV.x}
          y2={originY}
          className="stroke-series-u"
          strokeWidth={2.5}
          markerEnd={`url(#${markerU})`}
        />
      )}
      <text x={(baseW.x + baseV.x) / 2} y={originY + 22} textAnchor="middle" fontWeight={600} className="fill-series-u">
        U = {fmt(Math.abs(station.U), 1)} m/s
      </text>

      {/* Velocidades absoluta V y relativa W */}
      <line
        x1={apex.x}
        y1={apex.y}
        x2={baseW.x}
        y2={baseW.y}
        className="stroke-series-w"
        strokeWidth={2.5}
        markerEnd={`url(#${markerW})`}
      />
      <line
        x1={apex.x}
        y1={apex.y}
        x2={baseV.x}
        y2={baseV.y}
        className="stroke-series-v"
        strokeWidth={2.5}
        markerEnd={`url(#${markerV})`}
      />
      <text
        x={labelV.x}
        y={labelV.y}
        textAnchor={labelV.anchor}
        dominantBaseline="middle"
        fontSize={FONT + 1}
        fontWeight={700}
        className="fill-series-v"
      >
        V{index === '1' ? '₁' : '₂'}
      </text>
      <text
        x={labelW.x}
        y={labelW.y}
        textAnchor={labelW.anchor}
        dominantBaseline="middle"
        fontSize={FONT + 1}
        fontWeight={700}
        className="fill-series-w"
      >
        W{index === '1' ? '₁' : '₂'}
      </text>
    </svg>
  );
}

interface TileProps {
  label: React.ReactNode;
  value: string;
  unit?: string;
  valueClass?: string;
}

function Tile({ label, value, unit, valueClass = 'text-ink' }: TileProps) {
  return (
    <div className="rounded-md bg-surface-muted px-2 py-1.5">
      <dt className="text-caption text-ink-3">{label}</dt>
      <dd className={`text-label font-semibold tabular-nums ${valueClass}`}>
        {value}
        {unit && value !== '—' && <span className="ml-0.5 font-normal text-ink-3">{unit}</span>}
      </dd>
    </div>
  );
}

interface StationBlockProps {
  station: VelocityTriangleStation;
  index: '1' | '2';
  title: string;
  layout: Layout | null;
  idPrefix: string;
  measureRef?: React.Ref<HTMLDivElement>;
}

function StationBlock({ station, index, title, layout, idPrefix, measureRef }: StationBlockProps) {
  const sub = index === '1' ? '₁' : '₂';
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={`Estación ${index}: ${title}`}>
      <header className="flex flex-col gap-0.5">
        <p className="text-caption text-ink-3">Estación {index}</p>
        <h4 className="text-body font-semibold text-ink">{title}</h4>
        <p className="flex flex-wrap gap-x-3 text-label font-semibold tabular-nums">
          <span className="text-series-v">
            V{sub} = {fmt(station.V, 1)} m/s
          </span>
          <span className="text-series-w">
            W{sub} = {fmt(station.W, 1)} m/s
          </span>
        </p>
      </header>

      <div ref={measureRef} className="w-full">
        {layout ? (
          <StationPlot station={station} index={index} title={title} layout={layout} idPrefix={idPrefix} />
        ) : (
          <p className="rounded-md bg-surface-muted px-3 py-6 text-center text-label text-ink-3">
            No se puede dibujar el triángulo: hay velocidades no válidas o nulas.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-1.5">
        <Tile label={<>V<sub>θ</sub></>} value={fmt(station.V_theta, 1)} unit="m/s" valueClass="text-series-v" />
        <Tile label={<>W<sub>θ</sub></>} value={fmt(station.W_theta, 1)} unit="m/s" valueClass="text-series-w" />
        <Tile label={<>V<sub>a</sub></>} value={fmt(station.Va, 1)} unit="m/s" />
        <Tile label={`α${sub}`} value={fmt(station.alpha, 1)} unit="°" valueClass="text-series-v" />
        <Tile label={`β${sub}`} value={fmt(station.beta, 1)} unit="°" valueClass="text-series-w" />
        <Tile
          label={
            <>
              M<sub>abs</sub> / M<sub>rel</sub>
            </>
          }
          value={`${fmt(station.Mach_abs, 2)} / ${fmt(station.Mach_rel, 2)}`}
          valueClass={machTone(Math.max(station.Mach_abs, station.Mach_rel))}
        />
      </dl>
    </section>
  );
}

export const VelocityTrianglesSvg: React.FC<VelocityTrianglesSvgProps> = ({
  inlet,
  outlet,
  U,
  turbineType,
  stageName,
  direction = 1,
  isVanelessCoupled = false,
}) => {
  const rawId = useId();
  const idPrefix = `vt${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [measureRef, measuredWidth] = useMeasuredWidth(320);
  const layout = computeLayout([inlet, outlet], measuredWidth);
  const isCounter = direction === -1;

  const inletTitle = isVanelessCoupled
    ? 'Entrada al rotor (sin estator)'
    : turbineType === 'axial'
      ? 'Entrada al rotor (salida del estator)'
      : 'Entrada al rotor (tobera radial)';
  const outletTitle = turbineType === 'axial' ? 'Salida del rotor' : 'Salida del rotor (exductor)';

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {stageName && <span className="text-body font-semibold text-ink">{stageName}</span>}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-semibold ${
              isCounter
                ? 'border-pink-200 bg-pink-50 text-series-u'
                : 'border-cyan-200 bg-accent-soft text-accent-strong'
            }`}
          >
            {isCounter ? 'Contrarrotativo (−)' : 'Corrotativo (+)'}
          </span>
          {isVanelessCoupled && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-warn-soft px-2 py-0.5 text-caption font-semibold text-warn">
              Sin estator intermedio
            </span>
          )}
        </div>
        <span className="text-label text-ink-3 tabular-nums">
          U = <span className="font-semibold text-series-u">{fmt(Math.abs(U), 1)} m/s</span> · sentido{' '}
          {isCounter ? 'negativo' : 'positivo'}
        </span>
      </div>

      {/* Columnas de igual ancho útil, para que la escala común se vea también igual en pantalla. */}
      <div className="grid gap-4 @2xl:grid-cols-2 @2xl:gap-0">
        <div className="min-w-0 @2xl:pr-3">
          <StationBlock
            station={inlet}
            index="1"
            title={inletTitle}
            layout={layout}
            idPrefix={idPrefix}
            measureRef={measureRef}
          />
        </div>
        <div className="min-w-0 border-t border-line pt-4 @2xl:border-l @2xl:border-t-0 @2xl:pl-3 @2xl:pt-0">
          <StationBlock station={outlet} index="2" title={outletTitle} layout={layout} idPrefix={idPrefix} />
        </div>
      </div>

      <p className="text-caption text-ink-3">
        Ángulos medidos desde la dirección axial; θ+ es el sentido tangencial positivo. Misma escala en las dos
        estaciones.
      </p>
    </div>
  );
};
