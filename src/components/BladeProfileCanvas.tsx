/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RadialBladeDesign, BladeProfileResult, BladeSectionParams, Point2D } from '../utils/bladeGeometry';
import { Check, Copy, Eye, Info, Layers, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { formatNumber } from '../utils/format';

interface BladeProfileCanvasProps {
  radialDesign: RadialBladeDesign;
  stageName?: string;
}

type SectionName = BladeSectionParams['sectionName'];
type SectionFilter = 'all' | SectionName;
type Alignment = 'le' | 'centroid' | 'te';

interface ViewState {
  zoom: number;
  pan: Point2D;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface ViewTransform {
  scale: number;
  originX: number;
  originY: number;
}

interface ChartPalette {
  background: string;
  grid: string;
  axis: string;
  text: string;
  labelBackground: string;
  accent: string;
  ss: string;
  ps: string;
  sections: Record<SectionName, string>;
  fontMono: string;
}

interface VisibleProfile {
  profile: BladeProfileResult;
  section: SectionName;
  offset: Point2D;
  /** Desplazamientos tangenciales [mm] de las copias de cascada que se dibujan (sin incluir la principal). */
  cascadeShifts: number[];
}

/** Límites de zoom compartidos por la rueda, el pellizco y los botones. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.2;
/** Copias de la cascada a cada lado de la sección (máximo 3). */
const CASCADE_STEPS = 2;
const MAX_CASCADE_STEPS = 3;
const VIEW_MARGIN = 0.1;
/**
 * Con un área de dibujo de al menos 768 px (contenedor @3xl) la leyenda, las capas y las métricas se superponen al canvas:
 * se reserva su franja para no tapar el dibujo. Por debajo van bajo el canvas.
 */
const OVERLAY_BREAKPOINT_PX = 768;
const OVERLAY_INSET_TOP_PX = 64;
const OVERLAY_INSET_BOTTOM_PX = 48;
const COMPACT_INSET_BOTTOM_PX = 36;
const FLOW_VECTOR_RATIO = 0.38;
const CANVAS_FONT_PX = 11;
const HINT_DURATION_MS = 1600;
const GRID_STEPS_MM = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const INITIAL_VIEW: ViewState = { zoom: 1, pan: { x: 0, y: 0 } };

const SECTION_ORDER: SectionName[] = ['Hub', 'Mid', 'Tip'];
const SECTION_LABEL: Record<SectionName, string> = { Hub: 'Buje', Mid: 'Media', Tip: 'Punta' };
const SECTION_TOKEN: Record<SectionName, string> = {
  Hub: 'var(--color-series-hub)',
  Mid: 'var(--color-series-mid)',
  Tip: 'var(--color-series-tip)',
};

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Lee los tokens del tema para pintar el canvas con los mismos colores que el resto de la interfaz. */
function readChartPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (token: string, fallback: string) => styles.getPropertyValue(token).trim() || fallback;
  return {
    background: '#f8fafc',
    grid: read('--color-grid', '#e2e8f0'),
    axis: read('--color-axis', '#94a3b8'),
    text: read('--color-ink-3', '#526175'),
    labelBackground: 'rgba(255, 255, 255, 0.88)',
    accent: read('--color-accent', '#0e7490'),
    ss: read('--color-series-ss', '#dc2626'),
    ps: read('--color-series-ps', '#2563eb'),
    sections: {
      Hub: read('--color-series-hub', '#0891b2'),
      Mid: read('--color-series-mid', '#059669'),
      Tip: read('--color-series-tip', '#d97706'),
    },
    fontMono: read('--font-mono', 'ui-monospace, monospace'),
  };
}

/** Desplazamiento que alinea el apilado radial en el borde de ataque, el centroide (media cuerda) o el borde de salida. */
function getAlignmentOffset(profile: BladeProfileResult, alignment: Alignment): Point2D {
  if (alignment === 'le') return { x: 0, y: 0 };
  const fraction = alignment === 'te' ? 1 : 0.5;
  const x = profile.params.c_ax * fraction;
  return { x: -x, y: -x * Math.tan(toRad(profile.params.stagger_deg)) };
}

/** Extremos de los vectores de flujo relativo W₁ (entrada) y W₂ (salida) en mm, ya desplazados. */
function flowVectorPoints(profile: BladeProfileResult, offset: Point2D) {
  const { c_ax, stagger_deg, beta_flow_1, beta_flow_2 } = profile.params;
  const length = c_ax * FLOW_VECTOR_RATIO;
  const b1 = toRad(beta_flow_1);
  const b2 = toRad(beta_flow_2);
  const inletHead = { x: offset.x, y: offset.y };
  const inletTail = { x: offset.x - length * Math.cos(b1), y: offset.y - length * Math.sin(b1) };
  const outletTail = { x: c_ax + offset.x, y: c_ax * Math.tan(toRad(stagger_deg)) + offset.y };
  const outletHead = { x: outletTail.x + length * Math.cos(b2), y: outletTail.y + length * Math.sin(b2) };
  return { inletTail, inletHead, outletTail, outletHead };
}

/** Caja envolvente [mm] de lo que realmente se dibuja: contornos, copias de cascada y, si están visibles, los vectores de flujo. */
function computeBounds(profiles: VisibleProfile[], includeFlowVectors: boolean): Bounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  profiles.forEach(({ profile, offset, cascadeShifts }) => {
    const contour = profile.curves.fullContour;
    [0, ...cascadeShifts].forEach((shift) => {
      contour.forEach((point) => include(point.x + offset.x, point.y + offset.y + shift));
    });
    if (includeFlowVectors) {
      const { inletTail, outletHead } = flowVectorPoints(profile, offset);
      include(inletTail.x, inletTail.y);
      include(outletHead.x, outletHead.y);
    }
  });

  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/** Franja libre de superposiciones [px] y su centro, que es el punto fijo del encuadre y del zoom con botones. */
function drawingArea(width: number, height: number) {
  const top = width >= OVERLAY_BREAKPOINT_PX ? OVERLAY_INSET_TOP_PX : 0;
  const bottom = width >= OVERLAY_BREAKPOINT_PX ? OVERLAY_INSET_BOTTOM_PX : COMPACT_INSET_BOTTOM_PX;
  const usableHeight = Math.max(height - top - bottom, height * 0.5);
  return { usableHeight, center: { x: width / 2, y: top + usableHeight / 2 } };
}

/**
 * Transformación mm → píxeles: encaja la caja envolvente centrada en la zona libre con un margen del 10 %
 * y aplica zoom y desplazamiento. La usan tanto el dibujo como la lectura de coordenadas del cursor.
 */
function computeViewTransform(width: number, height: number, bounds: Bounds | null, zoom: number, pan: Point2D): ViewTransform {
  const box = bounds ?? { minX: -10, maxX: 10, minY: -10, maxY: 10 };
  const { usableHeight, center } = drawingArea(width, height);
  const spanX = Math.max(box.maxX - box.minX, 1e-3);
  const spanY = Math.max(box.maxY - box.minY, 1e-3);
  const usableW = Math.max(width * (1 - 2 * VIEW_MARGIN), 1);
  const usableH = Math.max(usableHeight * (1 - 2 * VIEW_MARGIN), 1);
  const scale = Math.min(usableW / spanX, usableH / spanY) * zoom;
  const centerX = (box.minX + box.maxX) / 2;
  const centerY = (box.minY + box.maxY) / 2;
  return {
    scale,
    originX: center.x - centerX * scale + pan.x,
    originY: center.y + centerY * scale + pan.y,
  };
}

/**
 * Nuevo estado de vista al hacer zoom alrededor de un punto de pantalla (cursor, centro del pellizco o centro del canvas):
 * el punto bajo el cursor se mantiene fijo.
 */
function zoomAround(view: ViewState, nextZoom: number, anchor: Point2D, size: { w: number; h: number }): ViewState {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / view.zoom;
  const { center } = drawingArea(size.w, size.h);
  const cx = center.x;
  const cy = center.y;
  return {
    zoom,
    pan: {
      x: anchor.x - cx - (anchor.x - cx - view.pan.x) * ratio,
      y: anchor.y - cy - (anchor.y - cy - view.pan.y) * ratio,
    },
  };
}

function niceGridStep(scale: number): number {
  return GRID_STEPS_MM.find((step) => step * scale >= 28) ?? GRID_STEPS_MM[GRID_STEPS_MM.length - 1];
}

/**
 * Texto con un fondo claro detrás, para que se lea sobre la rejilla y los perfiles. Con `swatch`, el
 * color de la serie se dibuja como una barra a la izquierda y el texto va en `color`: los colores de
 * serie (buje, media, punta) no llegan a 4,5:1 sobre el fondo con texto de 11 px.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  palette: ChartPalette,
  width: number,
  height: number,
  swatch?: string,
) {
  const metrics = ctx.measureText(text);
  const padX = 3;
  const swatchW = swatch ? 3 : 0;
  const textOffset = padX + (swatch ? swatchW + 3 : 0);
  const boxW = metrics.width + textOffset + padX;
  const boxH = CANVAS_FONT_PX + 5;
  const left = Math.min(Math.max(x, 2), Math.max(2, width - boxW - 2));
  const baseline = Math.min(Math.max(y, boxH), height - 4);
  const top = baseline - CANVAS_FONT_PX - 1;
  ctx.save();
  ctx.fillStyle = palette.labelBackground;
  ctx.fillRect(left, top, boxW, boxH);
  if (swatch) {
    ctx.fillStyle = swatch;
    ctx.fillRect(left + padX, top + 2, swatchW, boxH - 4);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, left + textOffset, baseline);
  ctx.restore();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number, color: string) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: SegmentedOption<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-sunken p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 rounded-md text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              active ? 'bg-surface text-accent shadow-sm' : 'text-ink-3 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const SECTION_OPTIONS: SegmentedOption<SectionFilter>[] = [
  { value: 'all', label: 'Superpuestas' },
  { value: 'Hub', label: 'Buje' },
  { value: 'Mid', label: 'Media' },
  { value: 'Tip', label: 'Punta' },
];

const ALIGNMENT_OPTIONS: SegmentedOption<Alignment>[] = [
  { value: 'le', label: 'Borde de ataque' },
  { value: 'centroid', label: 'Centroide' },
  { value: 'te', label: 'Borde de salida' },
];

export const BladeProfileCanvas: React.FC<BladeProfileCanvasProps> = ({ radialDesign, stageName = 'Etapa 1' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hudXRef = useRef<HTMLSpanElement | null>(null);
  const hudYRef = useRef<HTMLSpanElement | null>(null);
  const transformRef = useRef<ViewTransform>({ scale: 1, originX: 0, originY: 0 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const pointersRef = useRef(new Map<number, Point2D>());
  const dragRef = useRef<{ start: Point2D; startPan: Point2D } | null>(null);
  const pinchRef = useRef<{ startDistance: number; startMid: Point2D; startView: ViewState } | null>(null);
  const viewRef = useRef<ViewState>(INITIAL_VIEW);
  const hintTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const [activeSection, setActiveSection] = useState<SectionFilter>('all');
  const [alignment, setAlignment] = useState<Alignment>('le');
  const [showControlPoints, setShowControlPoints] = useState(true);
  const [showCamberLine, setShowCamberLine] = useState(true);
  const [showStaggerLine, setShowStaggerLine] = useState(true);
  const [showCascade, setShowCascade] = useState(true);
  const [showFlowVectors, setShowFlowVectors] = useState(true);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsVersion, setFontsVersion] = useState(0);
  const [wheelHint, setWheelHint] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [copyState, setCopyState] = useState<{ section: SectionName; ok: boolean } | null>(null);

  // Copias para los manejadores nativos y de puntero, que no deben volver a registrarse en cada render.
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const { hub, mid, tip, bladeCount_Z, solidity_mid, pitch_mid_mm, hb_mm, zweifelLoading } = radialDesign;

  const visibleProfiles = useMemo<VisibleProfile[]>(() => {
    const bySection: Record<SectionName, BladeProfileResult> = { Hub: hub, Mid: mid, Tip: tip };
    const sections = activeSection === 'all' ? SECTION_ORDER : [activeSection];
    const steps = Math.min(CASCADE_STEPS, MAX_CASCADE_STEPS);
    return sections.map((section) => {
      const profile = bySection[section];
      const pitch = profile.params.pitch_s;
      const drawCascade = showCascade && activeSection !== 'all' && Number.isFinite(pitch) && pitch > 0;
      const cascadeShifts = drawCascade ? Array.from({ length: steps }, (_, k) => [(k + 1) * pitch, -(k + 1) * pitch]).flat() : [];
      return { profile, section, offset: getAlignmentOffset(profile, alignment), cascadeShifts };
    });
  }, [hub, mid, tip, activeSection, alignment, showCascade]);

  const bounds = useMemo(() => computeBounds(visibleProfiles, showFlowVectors), [visibleProfiles, showFlowVectors]);
  const transform = useMemo(() => computeViewTransform(size.w, size.h, bounds, view.zoom, view.pan), [size, bounds, view]);
  const gridStep = niceGridStep(transform.scale);
  const gridVisible = gridStep * transform.scale >= 8;

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // Tamaño del área de dibujo: se observa el contenedor para redibujar al redimensionar o girar el móvil.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const next = { w: Math.round(rect.width), h: Math.round(rect.height) };
      setSize((previous) => (previous.w === next.w && previous.h === next.h ? previous : next));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Redibuja cuando las fuentes autoalojadas terminan de cargar (el canvas no se actualiza solo).
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) setFontsVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  // Dibujo
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || size.w === 0 || size.h === 0) return;

    const { w: width, h: height } = size;
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.round(width * dpr);
    const pixelH = Math.round(height * dpr);
    if (canvas.width !== pixelW) canvas.width = pixelW;
    if (canvas.height !== pixelH) canvas.height = pixelH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = readChartPalette();
    const font = `${CANVAS_FONT_PX}px ${palette.fontMono}`;
    const { scale, originX, originY } = transform;
    const toX = (mm: number) => originX + mm * scale;
    const toY = (mm: number) => originY - mm * scale;

    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);

    // Rejilla con paso «redondo» que se adapta al zoom
    const gridPx = gridStep * scale;
    if (gridVisible) {
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ((originX % gridPx) + gridPx) % gridPx; x < width; x += gridPx) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
      }
      for (let y = ((originY % gridPx) + gridPx) % gridPx; y < height; y += gridPx) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
      }
      ctx.stroke();
    }

    // Ejes de referencia
    ctx.save();
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, originY);
    ctx.lineTo(width, originY);
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, height);
    ctx.stroke();
    ctx.restore();

    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    const axisLabelX = 'x axial [mm]';
    drawLabel(ctx, axisLabelX, width - ctx.measureText(axisLabelX).width - 12, originY - 6, palette.text, palette, width, height);
    drawLabel(ctx, 'y tangencial [mm]', originX + 6, 18, palette.text, palette, width, height);

    const singleSection = activeSection !== 'all';

    const traceContour = (contour: Point2D[], offset: Point2D, shift: number) => {
      ctx.beginPath();
      contour.forEach((point, index) => {
        const x = toX(point.x + offset.x);
        const y = toY(point.y + offset.y + shift);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };

    visibleProfiles.forEach(({ profile, section, offset, cascadeShifts }, sectionIndex) => {
      const color = palette.sections[section];
      const contour = profile.curves.fullContour;
      if (!contour || contour.length === 0) return;
      const { c_ax, r_le, r_te, stagger_deg, beta_flow_1, beta_flow_2 } = profile.params;

      // Copias de la cascada (solo con una sección activa)
      cascadeShifts.forEach((shift) => {
        ctx.save();
        traceContour(contour, offset, shift);
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      });

      // Paso s entre álabes adyacentes
      const firstShift = cascadeShifts.find((shift) => shift > 0);
      if (firstShift !== undefined) {
        const x = toX(offset.x);
        const y1 = toY(offset.y);
        const y2 = toY(offset.y + firstShift);
        ctx.save();
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.stroke();
        ctx.restore();
        ctx.font = font;
        drawLabel(ctx, `s = ${firstShift.toFixed(1)} mm`, x + 8, (y1 + y2) / 2, palette.accent, palette, width, height);
      }

      // Perfil principal
      ctx.save();
      traceContour(contour, offset, 0);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();

      // Línea media
      if (showCamberLine && profile.curves.camberLine.length > 1) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        profile.curves.camberLine.forEach((point, index) => {
          const x = toX(point.x + offset.x);
          const y = toY(point.y + offset.y);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Cuerda / calado
      if (showStaggerLine) {
        ctx.save();
        ctx.strokeStyle = palette.axis;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(r_le + offset.x), toY(offset.y));
        ctx.lineTo(toX(c_ax - r_te + offset.x), toY((c_ax - r_te - r_le) * Math.tan(toRad(stagger_deg)) + offset.y));
        ctx.stroke();
        ctx.restore();
      }

      // Polígonos de control de Bézier (etiquetas solo con una sección activa, para no saturar)
      if (showControlPoints) {
        const sides: { points: Point2D[]; color: string; suffix: string; dy: number }[] = [
          { points: profile.controlPoints.suctionSide, color: palette.ss, suffix: 'ss', dy: -5 },
          { points: profile.controlPoints.pressureSide, color: palette.ps, suffix: 'ps', dy: 14 },
        ];
        sides.forEach(({ points, color: sideColor, suffix, dy }) => {
          ctx.save();
          ctx.strokeStyle = sideColor;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          points.forEach((point, index) => {
            const x = toX(point.x + offset.x);
            const y = toY(point.y + offset.y);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.restore();

          points.forEach((point, index) => {
            const x = toX(point.x + offset.x);
            const y = toY(point.y + offset.y);
            ctx.fillStyle = sideColor;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            if (singleSection) {
              ctx.font = font;
              drawLabel(ctx, `P${index}_${suffix}`, x + 5, y + dy, sideColor, palette, width, height);
            }
          });
        });
      }

      // Vectores de flujo relativo W₁ y W₂; en vista superpuesta las etiquetas se escalonan por sección
      if (showFlowVectors) {
        const { inletTail, inletHead, outletTail, outletHead } = flowVectorPoints(profile, offset);
        const labelShift = singleSection ? 0 : sectionIndex * (CANVAS_FONT_PX + 6);
        const segments: [Point2D, Point2D][] = [
          [inletTail, inletHead],
          [outletTail, outletHead],
        ];
        segments.forEach(([from, to]) => {
          const fx = toX(from.x);
          const fy = toY(from.y);
          const tx = toX(to.x);
          const ty = toY(to.y);
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(tx, ty);
          ctx.stroke();
          ctx.restore();
          drawArrowHead(ctx, fx, fy, tx, ty, 6, color);
        });

        ctx.font = font;
        // Texto en tinta (AA) y el color de la sección solo en la barra de la etiqueta.
        const inletText = `β₁ = ${formatNumber(beta_flow_1, 1)}°`;
        drawLabel(
          ctx,
          inletText,
          toX(inletTail.x) - ctx.measureText(inletText).width - 16,
          toY(inletTail.y) - 6 - labelShift,
          palette.text,
          palette,
          width,
          height,
          color,
        );
        drawLabel(
          ctx,
          `β₂ = ${formatNumber(beta_flow_2, 1)}°`,
          toX(outletHead.x) + 8,
          toY(outletHead.y) + 14 + labelShift,
          palette.text,
          palette,
          width,
          height,
          color,
        );
      }
    });
  }, [size, transform, gridStep, gridVisible, visibleProfiles, activeSection, showControlPoints, showCamberLine, showStaggerLine, showFlowVectors, fontsVersion]);

  const showWheelHint = useCallback(() => {
    setWheelHint(true);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setWheelHint(false), HINT_DURATION_MS);
  }, []);

  // Rueda nativa (no pasiva): solo amplía con Ctrl/Cmd o pellizco del trackpad; si no, la página se desplaza normalmente.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        showWheelHint();
        return;
      }
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
      setView((current) => zoomAround(current, current.zoom * factor, anchor, sizeRef.current));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [showWheelHint]);

  const updateHud = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !hudXRef.current || !hudYRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, originX, originY } = transformRef.current;
    hudXRef.current.textContent = ((clientX - rect.left - originX) / scale).toFixed(1);
    hudYRef.current.textContent = ((originY - (clientY - rect.top)) / scale).toFixed(1);
  };

  const clearHud = () => {
    if (hudXRef.current) hudXRef.current.textContent = '—';
    if (hudYRef.current) hudYRef.current.textContent = '—';
  };

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point2D => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startPinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b) return;
    pinchRef.current = {
      startDistance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: viewRef.current,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointersRef.current.set(event.pointerId, localPoint(event));
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // El puntero ya no está activo (p. ej. se soltó antes de procesar el evento): seguimos sin captura.
    }
    if (event.pointerType === 'touch') {
      // Un dedo desplaza la página; desplazamiento y zoom del dibujo solo con dos.
      if (pointersRef.current.size === 2) startPinch();
      return;
    }
    dragRef.current = { start: { x: event.clientX, y: event.clientY }, startPan: viewRef.current.pan };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType !== 'touch') updateHud(event.clientX, event.clientY);
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, localPoint(event));

    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const midPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAround(pinch.startView, pinch.startView.zoom * (distance / pinch.startDistance), pinch.startMid, sizeRef.current);
      setView({ zoom: zoomed.zoom, pan: { x: zoomed.pan.x + midPoint.x - pinch.startMid.x, y: zoomed.pan.y + midPoint.y - pinch.startMid.y } });
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      setView((current) => ({
        zoom: current.zoom,
        pan: { x: drag.startPan.x + event.clientX - drag.start.x, y: drag.startPan.y + event.clientY - drag.start.y },
      }));
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const zoomFromCenter = (factor: number) => {
    setView((current) => zoomAround(current, current.zoom * factor, drawingArea(sizeRef.current.w, sizeRef.current.h).center, sizeRef.current));
  };

  const handleCopyProfilePoints = (section: BladeProfileResult) => {
    const data = {
      sectionName: section.params.sectionName,
      radius_mm: section.params.radius * 1000,
      c_ax_mm: section.params.c_ax,
      stagger_deg: section.params.stagger_deg,
      controlPoints: section.controlPoints,
      suctionSide: section.curves.suctionSide,
      pressureSide: section.curves.pressureSide,
      camberLine: section.curves.camberLine,
    };
    const name = section.params.sectionName;
    const finish = (ok: boolean) => {
      setCopyState({ section: name, ok });
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyState(null), 2000);
    };
    if (!navigator.clipboard) {
      finish(false);
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(
      () => finish(true),
      () => finish(false),
    );
  };

  const layerToggles: { label: string; checked: boolean; onChange: (value: boolean) => void; hint?: string }[] = [
    { label: 'Puntos de Bézier (P0–P3)', checked: showControlPoints, onChange: setShowControlPoints },
    { label: 'Línea media', checked: showCamberLine, onChange: setShowCamberLine },
    { label: 'Cuerda y calado (γ)', checked: showStaggerLine, onChange: setShowStaggerLine },
    { label: 'Cascada (paso de Zweifel)', checked: showCascade, onChange: setShowCascade, hint: activeSection === 'all' ? 'Elige una sección para verla' : undefined },
    { label: 'Vectores de flujo (W₁, W₂)', checked: showFlowVectors, onChange: setShowFlowVectors },
  ];

  const metrics = [
    { label: 'Álabes', value: `Z = ${bladeCount_Z}` },
    { label: 'Solidez', value: `σ = ${formatNumber(solidity_mid, 2)}` },
    { label: 'Paso', value: `s = ${formatNumber(pitch_mid_mm, 1)} mm` },
    { label: 'Zweifel', value: `ψ_Z = ${formatNumber(zweifelLoading, 2)}` },
  ];

  const iconButton =
    'p-1.5 rounded-md text-ink-2 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="bg-surface border border-line rounded-card shadow-card overflow-hidden flex flex-col min-w-0">
      <div className="px-4 sm:px-5 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-lg bg-accent-soft flex items-center justify-center text-accent-strong">
            <Layers className="w-4 h-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-ink flex flex-wrap items-center gap-2">
              Perfil del álabe del rotor
              <span className="text-caption font-medium bg-accent-soft text-accent-strong px-2 py-0.5 rounded-md">{stageName}</span>
            </h3>
            <p className="text-caption text-ink-3">
              Bézier de 4 puntos (extradós e intradós) · vórtice libre (r·V<sub>θ</sub> = cte.) · criterio de Zweifel
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Sección radial" options={SECTION_OPTIONS} value={activeSection} onChange={setActiveSection} />
          <div className="inline-flex flex-wrap items-center gap-1">
            <span className="text-caption text-ink-3 px-1">Apilado</span>
            <Segmented label="Apilado radial" options={ALIGNMENT_OPTIONS} value={alignment} onChange={setAlignment} />
          </div>
          <div role="group" aria-label="Zoom" className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken p-1">
            <button type="button" onClick={() => zoomFromCenter(ZOOM_STEP)} disabled={view.zoom >= ZOOM_MAX} aria-label="Acercar" title="Acercar" className={iconButton}>
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => zoomFromCenter(1 / ZOOM_STEP)} disabled={view.zoom <= ZOOM_MIN} aria-label="Alejar" title="Alejar" className={iconButton}>
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setView(INITIAL_VIEW)} aria-label="Restablecer la vista" title="Restablecer la vista" className={iconButton}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Área de dibujo. Si es estrecha, la leyenda, las capas y las métricas van debajo; si es ancha (@3xl), superpuestas. */}
      <div className="relative @container">
        <div ref={containerRef} className="relative w-full h-[380px] sm:h-[460px] xl:h-[520px] bg-surface-muted select-none overflow-hidden">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Perfil 2D del rotor de ${stageName}: secciones de buje, media y punta, ${bladeCount_Z} álabes, paso medio ${pitch_mid_mm.toFixed(1)} mm`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onPointerLeave={clearHud}
            className="block w-full h-full touch-pan-y cursor-grab active:cursor-grabbing"
          />

          {wheelHint && (
            <p role="status" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg bg-surface/95 border border-line px-3 py-1.5 text-label text-ink-2 shadow-card pointer-events-none">
              Ctrl + rueda para ampliar
            </p>
          )}

          <div className="absolute bottom-3 left-3 rounded-md bg-surface/90 border border-line px-2.5 py-1 text-caption text-ink-3 flex items-center gap-3 pointer-events-none">
            <span className="font-mono">
              x <span ref={hudXRef} className="text-ink">—</span> · y <span ref={hudYRef} className="text-ink">—</span> mm
            </span>
            <span className="tabular-nums">{view.zoom.toFixed(2)}×</span>
            {gridVisible && <span className="hidden @3xl:inline tabular-nums">rejilla {gridStep} mm</span>}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3 border-t border-line @3xl:border-0 @3xl:p-0">
          <ul aria-label="Secciones radiales" className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2 @3xl:absolute @3xl:top-3 @3xl:left-3 @3xl:flex-col @3xl:gap-1 @3xl:rounded-lg @3xl:bg-surface/90 @3xl:border @3xl:border-line @3xl:px-3 @3xl:py-2 @3xl:shadow-card">
            <li className="hidden @3xl:block font-semibold text-ink">Secciones (vórtice libre)</li>
            {visibleProfiles.map(({ profile, section }) => (
              <li key={section} className="flex items-center gap-2 tabular-nums">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: SECTION_TOKEN[section] }} aria-hidden="true" />
                {SECTION_LABEL[section]} · r/Rm = {profile.params.r_ratio.toFixed(2)} · {(profile.params.radius * 1000).toFixed(0)} mm
              </li>
            ))}
          </ul>

          <details
            open={layersOpen}
            onToggle={(event) => setLayersOpen(event.currentTarget.open)}
            className="text-label text-ink-2 @3xl:absolute @3xl:top-3 @3xl:right-3 @3xl:max-w-[230px] @3xl:rounded-lg @3xl:bg-surface/90 @3xl:border @3xl:border-line @3xl:px-3 @3xl:py-2 @3xl:shadow-card"
          >
            <summary className="cursor-pointer select-none font-semibold text-ink flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
              Capas
            </summary>
            <div className="mt-2 space-y-1.5">
              {layerToggles.map((toggle) => (
                <label key={toggle.label} className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 accent-accent" checked={toggle.checked} onChange={(event) => toggle.onChange(event.target.checked)} />
                  <span>
                    {toggle.label}
                    {toggle.hint && toggle.checked && <span className="block text-caption text-ink-3">{toggle.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </details>

          <dl className="grid grid-cols-2 @md:grid-cols-4 gap-2 @3xl:absolute @3xl:bottom-3 @3xl:right-3 @3xl:flex @3xl:items-center @3xl:gap-3 @3xl:rounded-md @3xl:bg-ok-soft @3xl:border @3xl:border-emerald-200 @3xl:px-3 @3xl:py-1.5">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-md bg-ok-soft px-2.5 py-1.5 @3xl:bg-transparent @3xl:p-0 flex flex-col @3xl:flex-row @3xl:items-baseline @3xl:gap-1.5">
                <dt className="text-caption text-ok">{metric.label}</dt>
                <dd className="text-label font-semibold text-ink tabular-nums">{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="p-4 sm:p-5 border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-label font-semibold text-ink-2 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
            Variación radial de parámetros (vórtice libre)
          </h4>
          <span className="text-label text-ink-3">
            Altura de álabe h<sub>b</sub> = <strong className="font-semibold text-ink tabular-nums">{hb_mm.toFixed(1)} mm</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-label tabular-nums border-collapse">
            <caption className="sr-only">Parámetros del perfil en buje, sección media y punta</caption>
            <thead>
              <tr className="border-b border-line text-caption text-ink-3">
                <th scope="col" className="py-1.5 px-2 font-medium">Sección</th>
                <th scope="col" className="py-1.5 px-2 font-medium">Radio [mm]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">β flujo 1 [°]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">β flujo 2 [°]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">β metal 1 [°]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">β metal 2 [°]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">Calado γ [°]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">c<sub>ax</sub> [mm]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">t<sub>max</sub> [mm]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">Paso s [mm]</th>
                <th scope="col" className="py-1.5 px-2 font-medium">Copiar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-2">
              {[hub, mid, tip].map((sec) => {
                const name = sec.params.sectionName;
                const copied = copyState?.section === name ? copyState : null;
                return (
                  <tr key={name} className="hover:bg-surface-muted transition-colors">
                    <th scope="row" className="py-2 px-2 font-semibold text-ink">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SECTION_TOKEN[name] }} aria-hidden="true" />
                        {SECTION_LABEL[name]}
                      </span>
                    </th>
                    <td className="py-2 px-2">{(sec.params.radius * 1000).toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.beta_flow_1.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.beta_flow_2.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.beta_metal_1.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.beta_metal_2.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.stagger_deg.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.c_ax.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.t_max.toFixed(1)}</td>
                    <td className="py-2 px-2">{sec.params.pitch_s.toFixed(1)}</td>
                    <td className="py-2 px-2">
                      <button
                        type="button"
                        onClick={() => handleCopyProfilePoints(sec)}
                        aria-label={`Copiar los puntos (x, y) de la sección ${SECTION_LABEL[name].toLowerCase()} en JSON`}
                        title={copied ? (copied.ok ? 'Copiado' : 'No se pudo copiar') : 'Copiar los puntos (x, y) en JSON'}
                        className="p-1 rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {copied?.ok ? <Check className="w-3.5 h-3.5 text-ok" aria-hidden="true" /> : <Copy className={`w-3.5 h-3.5 ${copied && !copied.ok ? 'text-danger' : ''}`} aria-hidden="true" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sr-only" aria-live="polite">
          {copyState ? (copyState.ok ? 'Coordenadas copiadas al portapapeles' : 'No se pudieron copiar las coordenadas') : ''}
        </p>
      </div>
    </div>
  );
};
