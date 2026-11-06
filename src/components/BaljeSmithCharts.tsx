import React, { useId, useLayoutEffect, useRef, useState } from 'react';

interface BaljeSmithChartsProps {
  Ns: number;
  Ds: number;
  phi: number;
  psi: number;
  /** η_tt de Soderberg (referencia del mapa de Balje). */
  etaBalje: number;
  /** η_tt del modelo de pérdidas activo. */
  etaModel: number;
  /** Nombre que acompaña a etaModel, p. ej. «η_tt (Soderberg)». */
  etaModelLabel: string;
  turbineType: 'axial' | 'radial';
}

/* El viewBox se ajusta al ancho real (1 unidad = 1 px): los tamaños de letra son píxeles de pantalla. */
const FONT = 12;
const PAD = { left: 52, right: 18, top: 16, bottom: 44 };
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;

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

interface AxisSpec {
  min: number;
  max: number;
  log: boolean;
  ticks: number[];
  format: (value: number) => string;
  label: string;
}

interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Posición en pantalla sin recortar al rango del mapa. */
  sx: (value: number) => number;
  sy: (value: number) => number;
}

type AxisStatus = 'below' | 'inside' | 'above';

function axisFraction(axis: AxisSpec, value: number): number {
  if (axis.log) {
    return (Math.log10(value) - Math.log10(axis.min)) / (Math.log10(axis.max) - Math.log10(axis.min));
  }
  return (value - axis.min) / (axis.max - axis.min);
}

function axisStatus(axis: AxisSpec, value: number): AxisStatus {
  if (value < axis.min) return 'below';
  if (value > axis.max) return 'above';
  return 'inside';
}

function buildFrame(rawWidth: number, x: AxisSpec, y: AxisSpec): Frame {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rawWidth));
  const height = Math.min(300, Math.max(220, Math.round(width * 0.62)));
  const left = PAD.left;
  const right = width - PAD.right;
  const top = PAD.top;
  const bottom = height - PAD.bottom;
  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    sx: (value) => left + axisFraction(x, value) * (right - left),
    sy: (value) => bottom - axisFraction(y, value) * (bottom - top),
  };
}

const fmt = (value: number, digits: number) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
const fmtPct = (fraction: number) => (Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)} %` : '—');

interface DesignPoint {
  x: number;
  y: number;
  xName: string;
  yName: string;
  xDigits: number;
  yDigits: number;
}

interface MapChartProps {
  eyebrow: string;
  title: string;
  eta?: { label: string; value: number };
  x: AxisSpec;
  y: AxisSpec;
  point: DesignPoint;
  pointFill: string;
  pointStroke: string;
  overlays: (frame: Frame) => React.ReactNode;
}

function MapChart({ eyebrow, title, eta, x, y, point, pointFill, pointStroke, overlays }: MapChartProps) {
  const [measureRef, measuredWidth] = useMeasuredWidth(320);
  const rawId = useId();
  const titleId = `map${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const clipId = `${titleId}-clip`;
  const frame = buildFrame(measuredWidth, x, y);

  const finite = Number.isFinite(point.x) && Number.isFinite(point.y) && (!x.log || point.x > 0) && (!y.log || point.y > 0);
  const statusX = finite ? axisStatus(x, point.x) : 'inside';
  const statusY = finite ? axisStatus(y, point.y) : 'inside';
  const outside = finite && (statusX !== 'inside' || statusY !== 'inside');

  const INSET = 12;
  const px = !finite
    ? 0
    : statusX === 'below'
      ? frame.left + INSET
      : statusX === 'above'
        ? frame.right - INSET
        : frame.sx(point.x);
  const py = !finite
    ? 0
    : statusY === 'below'
      ? frame.bottom - INSET
      : statusY === 'above'
        ? frame.top + INSET
        : frame.sy(point.y);

  // Flecha hacia el borde por el que se sale el punto.
  let arrow: string | null = null;
  if (outside) {
    const dx = statusX === 'below' ? -1 : statusX === 'above' ? 1 : 0;
    const dy = statusY === 'below' ? 1 : statusY === 'above' ? -1 : 0;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const tip = { x: px + ux * 17, y: py + uy * 17 };
    const base = { x: px + ux * 9, y: py + uy * 9 };
    const half = 5;
    arrow = `M ${tip.x} ${tip.y} L ${base.x - uy * half} ${base.y + ux * half} L ${base.x + uy * half} ${base.y - ux * half} Z`;
  }

  const pointText = `${point.xName} = ${fmt(point.x, point.xDigits)}, ${point.yName} = ${fmt(point.y, point.yDigits)}`;
  const summary = !finite
    ? `${title}: punto de diseño no disponible.`
    : outside
      ? `${title}: el punto de diseño (${pointText}) queda fuera del mapa.`
      : `${title}: punto de diseño en ${pointText}.`;

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <header className="flex flex-col gap-0.5">
        <p className="text-caption text-ink-3">{eyebrow}</p>
        <h4 className="text-body font-semibold text-ink">{title}</h4>
        {/* La línea de η se reserva siempre para que los dos mapas queden alineados. */}
        <p className="min-h-[1.125rem] text-label text-ink-3 tabular-nums">
          {eta && (
            <>
              {eta.label}: <span className="font-semibold text-ok">{fmtPct(eta.value)}</span>
            </>
          )}
        </p>
      </header>

      <div ref={measureRef} className="w-full">
        <svg
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          className="block h-auto w-full"
          role="img"
          aria-labelledby={titleId}
          fontSize={FONT}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <title id={titleId}>{summary}</title>
          <defs>
            <clipPath id={clipId}>
              <rect x={frame.left} y={frame.top} width={frame.right - frame.left} height={frame.bottom - frame.top} />
            </clipPath>
          </defs>

          <rect
            x={frame.left}
            y={frame.top}
            width={frame.right - frame.left}
            height={frame.bottom - frame.top}
            className="fill-surface stroke-line-strong"
            strokeWidth={1}
          />

          {x.ticks.map((tick) => (
            <g key={`x-${tick}`}>
              <line x1={frame.sx(tick)} y1={frame.top} x2={frame.sx(tick)} y2={frame.bottom} className="stroke-grid" />
              <text x={frame.sx(tick)} y={frame.bottom + 16} textAnchor="middle" className="fill-ink-3">
                {x.format(tick)}
              </text>
            </g>
          ))}
          {y.ticks.map((tick) => (
            <g key={`y-${tick}`}>
              <line x1={frame.left} y1={frame.sy(tick)} x2={frame.right} y2={frame.sy(tick)} className="stroke-grid" />
              <text x={frame.left - 7} y={frame.sy(tick)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3">
                {y.format(tick)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>{overlays(frame)}</g>

          {finite && !outside && (
            <g className={pointStroke}>
              <line x1={px} y1={frame.top} x2={px} y2={frame.bottom} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.7} />
              <line x1={frame.left} y1={py} x2={frame.right} y2={py} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.7} />
            </g>
          )}
          {finite && (
            <g>
              {arrow && <path d={arrow} className={pointFill} />}
              <circle
                cx={px}
                cy={py}
                r={outside ? 6 : 5.5}
                className={outside ? `fill-surface ${pointStroke}` : `${pointFill} stroke-ink`}
                strokeWidth={outside ? 2 : 1.5}
              />
            </g>
          )}

          <text x={(frame.left + frame.right) / 2} y={frame.height - 8} textAnchor="middle" className="fill-ink-2">
            {x.label}
          </text>
          <text
            x={-(frame.top + frame.bottom) / 2}
            y={15}
            textAnchor="middle"
            transform="rotate(-90)"
            className="fill-ink-2"
          >
            {y.label}
          </text>
        </svg>
      </div>

      <p className="text-label tabular-nums">
        {!finite ? (
          <span className="text-ink-3">Punto de diseño no disponible.</span>
        ) : outside ? (
          <span className="font-medium text-warn">Fuera del mapa ({pointText})</span>
        ) : (
          <span className="text-ink-2">
            Punto de diseño: <span className="font-semibold text-ink">{pointText}</span>
          </span>
        )}
      </p>
    </section>
  );
}

const BALJE_X: AxisSpec = {
  min: 0.2,
  max: 3.0,
  log: true,
  ticks: [0.2, 0.3, 0.5, 1, 2, 3],
  format: (value) => String(value),
  label: 'Ns, velocidad específica (rad)',
};

const BALJE_Y: AxisSpec = {
  min: 1.2,
  max: 7.0,
  log: true,
  ticks: [1.5, 2, 3, 5, 7],
  format: (value) => String(value),
  label: 'Ds, diámetro específico',
};

const SMITH_X: AxisSpec = {
  min: 0.2,
  max: 1.2,
  log: false,
  ticks: [0.2, 0.4, 0.6, 0.8, 1.0, 1.2],
  format: (value) => value.toFixed(1),
  label: 'φ = Va / U',
};

const SMITH_Y: AxisSpec = {
  min: 0.4,
  max: 2.8,
  log: false,
  ticks: [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8],
  format: (value) => value.toFixed(1),
  label: 'ψ = Δh₀ / U²',
};

export const BaljeSmithCharts: React.FC<BaljeSmithChartsProps> = ({
  Ns,
  Ds,
  phi,
  psi,
  etaBalje,
  etaModel,
  etaModelLabel,
  turbineType,
}) => {
  // La η de Soderberg solo aporta información si el modelo activo es otro.
  const activeIsSoderberg = /soderberg/i.test(etaModelLabel);
  const axialActive = turbineType === 'axial';

  const baljeOverlays = (frame: Frame) => {
    const plotW = frame.right - frame.left;
    const plotH = frame.bottom - frame.top;
    const zones = [
      {
        key: 'axial',
        cx: frame.sx(0.95),
        cy: frame.sy(3.1),
        rx: plotW * 0.18,
        ry: plotH * 0.17,
        className: 'fill-accent-soft stroke-accent',
        textClass: 'fill-accent-strong',
        label: 'Óptimo axial (η ≳ 90 %)',
        labelX: frame.sx(0.95),
        labelY: frame.sy(3.1) - plotH * 0.17 - 7,
        anchor: 'middle' as const,
        active: axialActive,
      },
      {
        key: 'radial',
        cx: frame.sx(0.68),
        cy: frame.sy(3.7),
        rx: plotW * 0.145,
        ry: plotH * 0.16,
        className: 'fill-warn-soft stroke-series-w',
        textClass: 'fill-series-w',
        label: 'Radial',
        labelX: frame.sx(0.68) - plotW * 0.145 - 5,
        labelY: frame.sy(3.7),
        anchor: 'end' as const,
        active: !axialActive,
      },
    ];
    return zones.map((zone) => (
      <g key={zone.key} opacity={zone.active ? 1 : 0.55}>
        <ellipse
          cx={zone.cx}
          cy={zone.cy}
          rx={zone.rx}
          ry={zone.ry}
          className={zone.className}
          fillOpacity={zone.active ? 0.7 : 0.4}
          strokeWidth={zone.active ? 1.5 : 1}
          strokeDasharray="4 3"
        />
        <text
          x={zone.labelX}
          y={zone.labelY}
          textAnchor={zone.anchor}
          dominantBaseline="middle"
          fontWeight={600}
          className={zone.textClass}
        >
          {zone.label}
        </text>
      </g>
    ));
  };

  const smithOverlays = (frame: Frame) => (
    <g>
      <path
        d={`M ${frame.sx(0.35)} ${frame.sy(1.6)} Q ${frame.sx(0.75)} ${frame.sy(2.0)} ${frame.sx(1.1)} ${frame.sy(2.5)}`}
        fill="none"
        className="stroke-axis"
        strokeWidth={1.25}
        strokeDasharray="4 3"
      />
      <text x={frame.sx(0.75)} y={frame.sy(2.0) - 8} textAnchor="middle" className="fill-ink-3">
        η ≈ 86 %
      </text>
      <path
        d={`M ${frame.sx(0.4)} ${frame.sy(1.0)} Q ${frame.sx(0.7)} ${frame.sy(1.3)} ${frame.sx(1.0)} ${frame.sy(1.8)}`}
        fill="none"
        className="stroke-ok"
        strokeWidth={1.5}
        strokeDasharray="5 3"
      />
      <text x={frame.sx(0.72)} y={frame.sy(1.35) - 8} textAnchor="middle" fontWeight={600} className="fill-ok">
        η ≈ 90 %
      </text>
    </g>
  );

  return (
    <div className="@container flex flex-col gap-3">
      <div className="grid gap-4 @2xl:grid-cols-2 @2xl:gap-0">
        <div className="min-w-0 @2xl:pr-3">
          <MapChart
            eyebrow="Similitud dimensional"
            title="Balje (Ns–Ds)"
            eta={activeIsSoderberg ? undefined : { label: 'ηₜₜ Soderberg', value: etaBalje }}
            x={BALJE_X}
            y={BALJE_Y}
            point={{ x: Ns, y: Ds, xName: 'Ns', yName: 'Ds', xDigits: 3, yDigits: 2 }}
            pointFill="fill-series-u"
            pointStroke="stroke-series-u"
            overlays={baljeOverlays}
          />
        </div>
        <div className="min-w-0 border-t border-line pt-4 @2xl:border-l @2xl:border-t-0 @2xl:pl-3 @2xl:pt-0">
          <MapChart
            eyebrow="Carga y caudal de la etapa"
            title="Smith (ψ–φ)"
            eta={{ label: etaModelLabel, value: etaModel }}
            x={SMITH_X}
            y={SMITH_Y}
            point={{ x: phi, y: psi, xName: 'φ', yName: 'ψ', xDigits: 3, yDigits: 3 }}
            pointFill="fill-accent"
            pointStroke="stroke-accent"
            overlays={smithOverlays}
          />
        </div>
      </div>
      <p className="text-caption text-ink-3">Contornos y zonas orientativos (Smith 1965; Balje 1981).</p>
    </div>
  );
};
