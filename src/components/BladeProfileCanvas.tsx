/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  RadialBladeDesign,
  BladeProfileResult,
  Point2D,
} from '../utils/bladeGeometry';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Eye,
  Info,
  Maximize2,
  Copy,
  Check,
} from 'lucide-react';

interface BladeProfileCanvasProps {
  radialDesign: RadialBladeDesign;
  stageName?: string;
  onParameterChange?: {
    c_ax_mid: number;
    set_c_ax_mid: (val: number) => void;
    psi_Zweifel: number;
    set_psi_Zweifel: (val: number) => void;
    incidence_deg: number;
    set_incidence_deg: (val: number) => void;
    deviation_deg: number;
    set_deviation_deg: (val: number) => void;
    t_max_mid: number;
    set_t_max_mid: (val: number) => void;
  };
}

export const BladeProfileCanvas: React.FC<BladeProfileCanvasProps> = ({
  radialDesign,
  stageName = 'Etapa 1',
  onParameterChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // View state
  const [activeSection, setActiveSection] = useState<'all' | 'Hub' | 'Mid' | 'Tip'>('all');
  const [alignment, setAlignment] = useState<'le' | 'centroid' | 'te'>('le');
  const [showControlPoints, setShowControlPoints] = useState(true);
  const [showCamberLine, setShowCamberLine] = useState(true);
  const [showStaggerLine, setShowStaggerLine] = useState(true);
  const [showCascade, setShowCascade] = useState(true);
  const [showFlowVectors, setShowFlowVectors] = useState(true);
  const [cascadeBladesCount, setCascadeBladesCount] = useState<number>(2);

  // Pan & Zoom
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point2D>({ x: 0, y: 0 });
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const { hub, mid, tip, bladeCount_Z, solidity_mid, pitch_mid_mm, hb_mm, Rm_mm, R_hub_mm, R_tip_mm, psi_Zweifel } =
    radialDesign;

  // Compute centroid offsets for stacking alignment
  const getAlignmentOffset = (profile: BladeProfileResult): Point2D => {
    if (alignment === 'le') {
      return { x: 0, y: 0 };
    }
    if (alignment === 'te') {
      const teX = profile.params.c_ax;
      const teY = profile.params.c_ax * Math.tan((profile.params.stagger_deg * Math.PI) / 180);
      return { x: -teX, y: -teY };
    }
    // Centroid / Stacking axis approximation (mid-chord)
    const midX = profile.params.c_ax * 0.5;
    const midY = midX * Math.tan((profile.params.stagger_deg * Math.PI) / 180);
    return { x: -midX, y: -midY };
  };

  // Render to canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI display
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear background (Dark industrial theme)
    ctx.fillStyle = '#080d1a';
    ctx.fillRect(0, 0, width, height);

    // Compute bounding box in mm across active profiles to set initial scale
    const profilesToRender: {
      profile: BladeProfileResult;
      color: string;
      fillColor: string;
      label: string;
      dash?: number[];
    }[] = [];

    if (activeSection === 'all' || activeSection === 'Hub') {
      profilesToRender.push({
        profile: hub,
        color: '#06b6d4', // Cyan
        fillColor: 'rgba(6, 182, 212, 0.12)',
        label: 'Hub (Buje)',
      });
    }
    if (activeSection === 'all' || activeSection === 'Mid') {
      profilesToRender.push({
        profile: mid,
        color: '#10b981', // Emerald
        fillColor: 'rgba(16, 185, 129, 0.14)',
        label: 'Mid (Medio)',
      });
    }
    if (activeSection === 'all' || activeSection === 'Tip') {
      profilesToRender.push({
        profile: tip,
        color: '#f59e0b', // Amber
        fillColor: 'rgba(245, 158, 11, 0.12)',
        label: 'Tip (Punta)',
      });
    }

    // Determine scale: mm to pixels
    const maxAxial = Math.max(hub.params.c_ax, mid.params.c_ax, tip.params.c_ax);
    const maxPitch = showCascade ? mid.params.pitch_s * (cascadeBladesCount * 1.5) : maxAxial * 1.2;
    const fitScale = Math.min((width * 0.65) / maxAxial, (height * 0.6) / maxPitch);
    const currentScale = fitScale * zoom;

    // Origin: Center canvas with pan offset
    const originX = width * 0.35 + pan.x;
    const originY = height * 0.5 + pan.y;

    const toCanvasX = (mmX: number) => originX + mmX * currentScale;
    const toCanvasY = (mmY: number) => originY - mmY * currentScale; // Invert y for standard Cartesian

    // Draw background technical grid
    const gridSpacingMm = 10; // 10mm grid lines
    const gridSpacingPx = gridSpacingMm * currentScale;

    if (gridSpacingPx > 12) {
      ctx.strokeStyle = '#111c33';
      ctx.lineWidth = 1;

      const startGridX = originX % gridSpacingPx;
      for (let x = startGridX; x < width; x += gridSpacingPx) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const startGridY = originY % gridSpacingPx;
      for (let y = startGridY; y < height; y += gridSpacingPx) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw reference axes (Axial X and Pitchwise Y)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    // X Axis (Axial direction)
    ctx.beginPath();
    ctx.moveTo(0, originY);
    ctx.lineTo(width, originY);
    ctx.stroke();

    // Y Axis (Pitchwise direction)
    ctx.beginPath();
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axes Labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('Eje Axial (x) [mm]', width - 130, originY - 8);
    ctx.fillText('Eje Tangencial (y) [mm]', originX + 8, 16);

    // Function to render a blade profile instance
    const renderBladeInstance = (
      prof: BladeProfileResult,
      offset: Point2D,
      yShiftMm: number,
      color: string,
      fillColor: string,
      isGhost: boolean = false
    ) => {
      const contour = prof.curves.fullContour;
      if (!contour || contour.length === 0) return;

      ctx.save();
      ctx.beginPath();
      const firstX = toCanvasX(contour[0].x + offset.x);
      const firstY = toCanvasY(contour[0].y + offset.y + yShiftMm);
      ctx.moveTo(firstX, firstY);

      for (let i = 1; i < contour.length; i++) {
        const cx = toCanvasX(contour[i].x + offset.x);
        const cy = toCanvasY(contour[i].y + offset.y + yShiftMm);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath();

      if (isGhost) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
      ctx.restore();

      // Throat opening dimension (between adjacent blades if ghost and mid section)
      if (showCascade && yShiftMm > 0 && prof.params.sectionName === 'Mid') {
        // Draw pitch line
        const p1x = toCanvasX(offset.x);
        const p1y = toCanvasY(offset.y);
        const p2x = toCanvasX(offset.x);
        const p2y = toCanvasY(offset.y + yShiftMm);

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label pitch
        ctx.fillStyle = '#38bdf8';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`s = ${yShiftMm.toFixed(1)} mm`, p1x + 8, (p1y + p2y) / 2);
      }
    };

    // Render each profile
    profilesToRender.forEach(({ profile, color, fillColor }) => {
      const offset = getAlignmentOffset(profile);

      // Render cascade replicas if enabled
      if (showCascade && activeSection !== 'all') {
        const pitch = profile.params.pitch_s;
        for (let k = 1; k <= cascadeBladesCount; k++) {
          renderBladeInstance(profile, offset, k * pitch, color, fillColor, true);
          renderBladeInstance(profile, offset, -k * pitch, color, fillColor, true);
        }
      }

      // Render primary blade profile
      renderBladeInstance(profile, offset, 0, color, fillColor, false);

      // Camber line
      if (showCamberLine && profile.curves.camberLine) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        profile.curves.camberLine.forEach((pt, idx) => {
          const cx = toCanvasX(pt.x + offset.x);
          const cy = toCanvasY(pt.y + offset.y);
          if (idx === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Stagger chord line
      if (showStaggerLine) {
        ctx.save();
        ctx.strokeStyle = '#94a3b8';
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);

        const le_x = toCanvasX(profile.params.r_le + offset.x);
        const le_y = toCanvasY(offset.y);
        const te_x = toCanvasX(profile.params.c_ax - profile.params.r_te + offset.x);
        const te_y = toCanvasY(
          (profile.params.c_ax - profile.params.r_te - profile.params.r_le) *
            Math.tan((profile.params.stagger_deg * Math.PI) / 180) +
            offset.y
        );

        ctx.beginPath();
        ctx.moveTo(le_x, le_y);
        ctx.lineTo(te_x, te_y);
        ctx.stroke();
        ctx.restore();
      }

      // Bézier Control Points & Polygons
      if (showControlPoints && (activeSection === profile.params.sectionName || activeSection === 'all')) {
        const ss = profile.controlPoints.suctionSide;
        const ps = profile.controlPoints.pressureSide;

        // Draw Suction Side control polygon
        ctx.save();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'; // red for SS
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ss.forEach((pt, i) => {
          const cx = toCanvasX(pt.x + offset.x);
          const cy = toCanvasY(pt.y + offset.y);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();

        // Control nodes SS
        ss.forEach((pt, i) => {
          const cx = toCanvasX(pt.x + offset.x);
          const cy = toCanvasY(pt.y + offset.y);
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#fca5a5';
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillText(`P${i}_ss`, cx + 5, cy - 4);
        });

        // Draw Pressure Side control polygon
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.45)'; // blue for PS
        ctx.beginPath();
        ps.forEach((pt, i) => {
          const cx = toCanvasX(pt.x + offset.x);
          const cy = toCanvasY(pt.y + offset.y);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();

        // Control nodes PS
        ps.forEach((pt, i) => {
          const cx = toCanvasX(pt.x + offset.x);
          const cy = toCanvasY(pt.y + offset.y);
          ctx.fillStyle = '#3b82f6';
          ctx.beginPath();
          ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#93c5fd';
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillText(`P${i}_ps`, cx + 5, cy + 10);
        });
        ctx.restore();
      }

      // Flow vectors (Relative flow W1 and W2)
      if (showFlowVectors) {
        ctx.save();
        const vecLen = profile.params.c_ax * 0.38;

        // Inlet vector W1
        const b1_rad = (profile.params.beta_flow_1 * Math.PI) / 180;
        const in_x = toCanvasX(offset.x);
        const in_y = toCanvasY(offset.y);
        const in_dx = toCanvasX(offset.x - vecLen * Math.cos(b1_rad));
        const in_dy = toCanvasY(offset.y - vecLen * Math.sin(b1_rad));

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(in_dx, in_dy);
        ctx.lineTo(in_x, in_y);
        ctx.stroke();

        // Inlet arrowhead
        drawArrowHead(ctx, in_dx, in_dy, in_x, in_y, 6, color);

        ctx.fillStyle = color;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(
          `β₁=${profile.params.beta_flow_1.toFixed(1)}°`,
          in_dx - 35,
          in_dy - 6
        );

        // Outlet vector W2
        const b2_rad = (profile.params.beta_flow_2 * Math.PI) / 180;
        const out_x = toCanvasX(profile.params.c_ax + offset.x);
        const out_y = toCanvasY(
          profile.params.c_ax * Math.tan((profile.params.stagger_deg * Math.PI) / 180) + offset.y
        );
        const out_dx = toCanvasX(profile.params.c_ax + offset.x + vecLen * Math.cos(b2_rad));
        const out_dy = toCanvasY(
          profile.params.c_ax * Math.tan((profile.params.stagger_deg * Math.PI) / 180) +
            offset.y +
            vecLen * Math.sin(b2_rad)
        );

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(out_x, out_y);
        ctx.lineTo(out_dx, out_dy);
        ctx.stroke();

        drawArrowHead(ctx, out_x, out_y, out_dx, out_dy, 6, color);

        ctx.fillText(
          `β₂=${profile.params.beta_flow_2.toFixed(1)}°`,
          out_dx + 8,
          out_dy + 4
        );
        ctx.restore();
      }
    });

    // Helper: draw arrow head
    function drawArrowHead(
      context: CanvasRenderingContext2D,
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      size: number,
      arrowColor: string
    ) {
      const angle = Math.atan2(toY - fromY, toX - fromX);
      context.save();
      context.fillStyle = arrowColor;
      context.beginPath();
      context.moveTo(toX, toY);
      context.lineTo(
        toX - size * Math.cos(angle - Math.PI / 6),
        toY - size * Math.sin(angle - Math.PI / 6)
      );
      context.lineTo(
        toX - size * Math.cos(angle + Math.PI / 6),
        toY - size * Math.sin(angle + Math.PI / 6)
      );
      context.closePath();
      context.fill();
      context.restore}

    // Legend in upper left corner
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(16, 16, 210, 100, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('SECCIONES RADIALES (VÓRTICE LIBRE)', 28, 34);

    profilesToRender.forEach((p, idx) => {
      const ly = 54 + idx * 20;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(36, ly, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(
        `${p.label} - r/Rm=${p.profile.params.r_ratio.toFixed(2)} (${(p.profile.params.radius * 1000).toFixed(0)}mm)`,
        48,
        ly + 3
      );
    });
    ctx.restore();
  }, [
    hub,
    mid,
    tip,
    activeSection,
    alignment,
    showControlPoints,
    showCamberLine,
    showStaggerLine,
    showCascade,
    showFlowVectors,
    cascadeBladesCount,
    zoom,
    pan,
  ]);

  // Mouse interaction handlers for Pan & Zoom
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }

    // Coordinates tooltip in mm
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;
    const maxAxial = Math.max(hub.params.c_ax, mid.params.c_ax, tip.params.c_ax);
    const maxPitch = showCascade ? mid.params.pitch_s * (cascadeBladesCount * 1.5) : maxAxial * 1.2;
    const fitScale = Math.min((width * 0.65) / maxAxial, (height * 0.6) / maxPitch);
    const currentScale = fitScale * zoom;
    const originX = width * 0.35 + pan.x;
    const originY = height * 0.5 + pan.y;

    const mmX = (xPx - originX) / currentScale;
    const mmY = (originY - yPx) / currentScale;

    setHoverCoords({ x: mmX, y: mmY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => Math.max(0.4, Math.min(6.0, prev * zoomFactor)));
  };

  const resetView = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Copy coordinates JSON
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
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedSection(section.params.sectionName);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div className="bg-[#0b1329] border border-cyan-900/40 rounded-xl overflow-hidden shadow-2xl flex flex-col">
      {/* Header with Title & Controls */}
      <div className="bg-[#0f172a] px-5 py-3.5 border-b border-cyan-900/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-wide flex items-center gap-2">
              Geometría de Álabe 2D / Quasi-3D Bézier
              <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800/60">
                {stageName}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Curvas de Bézier de 4 puntos (Intradós/Extradós) · Vórtice Libre (r · V_θ = const) · Criterio de Zweifel
            </p>
          </div>
        </div>

        {/* View Mode & Alignment Selector */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Section Selector */}
          <div className="bg-[#080d1a] border border-slate-700/60 rounded-lg p-1 flex items-center gap-1 text-xs">
            {(['all', 'Hub', 'Mid', 'Tip'] as const).map((sec) => (
              <button
                key={sec}
                onClick={() => setActiveSection(sec)}
                className={`px-2.5 py-1 rounded font-medium transition-all ${
                  activeSection === sec
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {sec === 'all' ? 'Superpuestas (3D)' : sec}
              </button>
            ))}
          </div>

          {/* Stacking Alignment */}
          <div className="bg-[#080d1a] border border-slate-700/60 rounded-lg p-1 flex items-center gap-1 text-xs">
            <span className="text-[10px] font-mono text-slate-400 px-1.5">Apilado:</span>
            {[
              { id: 'le', label: 'Borde Ataque' },
              { id: 'centroid', label: 'Eje Centroide' },
              { id: 'te', label: 'Borde Salida' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setAlignment(opt.id as any)}
                className={`px-2 py-1 rounded text-xs transition-all ${
                  alignment === opt.id
                    ? 'bg-slate-700 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 bg-[#080d1a] border border-slate-700/60 rounded-lg p-1">
            <button
              onClick={() => setZoom((z) => Math.min(5.0, z * 1.2))}
              title="Acercar (Zoom In)"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.4, z * 0.8))}
              title="Alejar (Zoom Out)"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetView}
              title="Restablecer Vista"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div className="relative w-full h-[520px] bg-[#070b16] select-none overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="w-full h-full cursor-grab active:cursor-grabbing block"
        />

        {/* Floating Toggles Overlay */}
        <div className="absolute top-4 right-4 bg-[#0f172a]/90 backdrop-blur-md border border-slate-700/70 rounded-lg p-3 text-xs space-y-2 text-slate-300 shadow-xl max-w-[200px]">
          <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider mb-1 flex items-center gap-1">
            <Eye className="w-3 h-3 text-cyan-400" />
            Capas Visuales
          </div>

          <label className="flex items-center gap-2 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showControlPoints}
              onChange={(e) => setShowControlPoints(e.target.checked)}
              className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Puntos Bézier (P0-P3)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showCamberLine}
              onChange={(e) => setShowCamberLine(e.target.checked)}
              className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Línea Media (Camber)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showStaggerLine}
              onChange={(e) => setShowStaggerLine(e.target.checked)}
              className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Cuerda / Calado (γ)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showCascade}
              onChange={(e) => setShowCascade(e.target.checked)}
              className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Cascada (Paso Zweifel)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer hover:text-white">
            <input
              type="checkbox"
              checked={showFlowVectors}
              onChange={(e) => setShowFlowVectors(e.target.checked)}
              className="rounded bg-slate-800 border-slate-600 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Vectores de Flujo (W₁, W₂)</span>
          </label>
        </div>

        {/* Bottom Coordinates HUD */}
        <div className="absolute bottom-3 left-4 bg-[#0f172a]/85 backdrop-blur-md border border-slate-700/60 rounded-md px-3 py-1.5 font-mono text-[11px] text-slate-300 flex items-center gap-4">
          <span>
            X: <strong className="text-cyan-400">{hoverCoords ? hoverCoords.x.toFixed(1) : '0.0'} mm</strong>
          </span>
          <span>
            Y: <strong className="text-cyan-400">{hoverCoords ? hoverCoords.y.toFixed(1) : '0.0'} mm</strong>
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">
            Escala: <strong>{zoom.toFixed(2)}x</strong>
          </span>
        </div>

        {/* Zweifel Solidity KPI Badge */}
        <div className="absolute bottom-3 right-4 bg-emerald-950/80 backdrop-blur-md border border-emerald-600/40 rounded-md px-3 py-1.5 font-mono text-[11px] text-emerald-300 flex items-center gap-3">
          <span>
            Álabes <strong className="text-white">Z = {bladeCount_Z}</strong>
          </span>
          <span className="text-emerald-500/60">•</span>
          <span>
            Solidez <strong className="text-white">σ = {solidity_mid.toFixed(2)}</strong>
          </span>
          <span className="text-emerald-500/60">•</span>
          <span>
            Paso <strong className="text-white">s = {pitch_mid_mm.toFixed(1)} mm</strong>
          </span>
          <span className="text-emerald-500/60">•</span>
          <span>
            Zweifel <strong className="text-white">ψ_Z = {psi_Zweifel.toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {/* Interactive Controls & Parameters Table */}
      <div className="p-5 bg-[#090e1f] border-t border-cyan-900/40 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sliders if onParameterChange provided */}
        {onParameterChange && (
          <div className="bg-[#0f172a] p-4 rounded-lg border border-slate-800 space-y-3">
            <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              Sintonía Geométrica Rápida
            </h4>

            {/* C_ax */}
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Cuerda Axial (c_ax)</span>
                <span className="font-mono text-cyan-400">{onParameterChange.c_ax_mid.toFixed(1)} mm</span>
              </div>
              <input
                type="range"
                min="15"
                max="100"
                step="1"
                value={onParameterChange.c_ax_mid}
                onChange={(e) => onParameterChange.set_c_ax_mid(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            {/* Zweifel Target */}
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Coeficiente Zweifel (ψ_Z)</span>
                <span className="font-mono text-emerald-400">{onParameterChange.psi_Zweifel.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.65"
                max="1.20"
                step="0.05"
                value={onParameterChange.psi_Zweifel}
                onChange={(e) => onParameterChange.set_psi_Zweifel(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            {/* Max Thickness */}
            <div>
              <div className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Espesor Máximo (t_max)</span>
                <span className="font-mono text-amber-400">{onParameterChange.t_max_mid.toFixed(1)} mm</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="20.0"
                step="0.5"
                value={onParameterChange.t_max_mid}
                onChange={(e) => onParameterChange.set_t_max_mid(parseFloat(e.target.value))}
                className="w-full accent-amber-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            {/* Incidence / Deviation */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Incidencia (i):</label>
                <input
                  type="number"
                  step="0.5"
                  value={onParameterChange.incidence_deg}
                  onChange={(e) => onParameterChange.set_incidence_deg(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#080d1a] border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Desviación (δ):</label>
                <input
                  type="number"
                  step="0.5"
                  value={onParameterChange.deviation_deg}
                  onChange={(e) => onParameterChange.set_deviation_deg(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#080d1a] border border-slate-700 rounded px-2 py-1 text-xs font-mono text-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* Detailed Radial Table Hub / Mid / Tip */}
        <div className={`bg-[#0f172a] p-4 rounded-lg border border-slate-800 ${onParameterChange ? 'lg:col-span-2' : 'lg:col-span-3'} overflow-x-auto`}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              Variación Radial de Parámetros (Ley de Vórtice Libre)
            </h4>
            <span className="text-[11px] font-mono text-slate-400">
              Altura de álabe $h_b$ = <strong>{hb_mm.toFixed(1)} mm</strong>
            </span>
          </div>

          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-1.5 px-2">Sección</th>
                <th className="py-1.5 px-2">Radio [mm]</th>
                <th className="py-1.5 px-2">β_flow,1 [°]</th>
                <th className="py-1.5 px-2">β_flow,2 [°]</th>
                <th className="py-1.5 px-2">β_metal,1 [°]</th>
                <th className="py-1.5 px-2">β_metal,2 [°]</th>
                <th className="py-1.5 px-2">Calado γ [°]</th>
                <th className="py-1.5 px-2">c_ax [mm]</th>
                <th className="py-1.5 px-2">t_max [mm]</th>
                <th className="py-1.5 px-2">Paso s [mm]</th>
                <th className="py-1.5 px-2">Exportar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {[hub, mid, tip].map((sec) => (
                <tr key={sec.params.sectionName} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2 px-2 font-semibold flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          sec.params.sectionName === 'Hub'
                            ? '#06b6d4'
                            : sec.params.sectionName === 'Mid'
                            ? '#10b981'
                            : '#f59e0b',
                      }}
                    />
                    {sec.params.sectionName}
                  </td>
                  <td className="py-2 px-2">{(sec.params.radius * 1000).toFixed(1)}</td>
                  <td className="py-2 px-2 text-cyan-400">{sec.params.beta_flow_1.toFixed(1)}°</td>
                  <td className="py-2 px-2 text-cyan-400">{sec.params.beta_flow_2.toFixed(1)}°</td>
                  <td className="py-2 px-2 text-emerald-400">{sec.params.beta_metal_1.toFixed(1)}°</td>
                  <td className="py-2 px-2 text-emerald-400">{sec.params.beta_metal_2.toFixed(1)}°</td>
                  <td className="py-2 px-2 text-amber-400">{sec.params.stagger_deg.toFixed(1)}°</td>
                  <td className="py-2 px-2">{sec.params.c_ax.toFixed(1)}</td>
                  <td className="py-2 px-2">{sec.params.t_max.toFixed(1)}</td>
                  <td className="py-2 px-2">{sec.params.pitch_s.toFixed(1)}</td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => handleCopyProfilePoints(sec)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      title="Copiar puntos (x, y) de la sección"
                    >
                      {copiedSection === sec.params.sectionName ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
