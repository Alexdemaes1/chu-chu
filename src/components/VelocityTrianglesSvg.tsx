import React from 'react';
import { VelocityTriangleStation } from '../utils/turbine1D';

interface VelocityTrianglesSvgProps {
  inlet: VelocityTriangleStation;
  outlet: VelocityTriangleStation;
  U: number;
  turbineType: 'axial' | 'radial';
  stageName?: string;
  direction?: 1 | -1;
  isVanelessCoupled?: boolean;
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
  const isCounter = direction === -1;
  const absU = Math.abs(U);
  // Scaling factors for SVG drawing
  // Max velocity component to fit within 560x260 viewport per triangle
  const maxVel = Math.max(
    U,
    inlet.V,
    inlet.W,
    inlet.Va,
    Math.abs(inlet.V_theta),
    outlet.V,
    outlet.W,
    outlet.Va,
    Math.abs(outlet.V_theta),
    200
  );

  const scale = 180 / maxVel; // pixels per m/s

  // Station 1: Inlet triangle
  // Origin at (160, 220)
  // Va goes UP (negative Y in SVG)
  // U goes RIGHT (positive X in SVG)
  // V_theta goes RIGHT
  // Apex is at (originX, originY - Va * scale)
  // Absolute velocity V goes from Apex to (originX + V_theta * scale, originY)
  // Relative velocity W goes from Apex to (originX + (V_theta - U) * scale, originY) or standard vector triangle:
  // Vector relation: V = U + W => W = V - U
  // In classic turbomachinery diagram:
  // Base line is tangential (U)
  // Normal line is axial / meridional (Va)

  const renderSingleTriangle = (
    station: VelocityTriangleStation,
    title: string,
    stationNum: '1' | '2',
    colorV = '#06b6d4', // laser cyan
    colorW = '#f59e0b', // telemetry amber
    colorU = '#e2e8f0'  // crisp white/slate
  ) => {
    const width = 360;
    const height = 240;
    const originX = 140;
    const originY = 190;

    const apexX = originX;
    const apexY = originY - station.Va * scale;

    const baseVX = originX + station.V_theta * scale;
    const baseWX = originX + (station.V_theta - station.U) * scale;
    const baseY = originY;

    // Angle arcs calculation
    const alphaRad = (station.alpha * Math.PI) / 180;
    const betaRad = (station.beta * Math.PI) / 180;
    const arcRadius = 42;

    const arcAlphaEndX = apexX + arcRadius * Math.sin(alphaRad);
    const arcAlphaEndY = apexY + arcRadius * Math.cos(alphaRad);

    const arcBetaEndX = apexX + (arcRadius + 12) * Math.sin(betaRad);
    const arcBetaEndY = apexY + (arcRadius + 12) * Math.cos(betaRad);

    return (
      <div className="flex-1 bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Estación {stationNum}
            </span>
            <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-cyan-400">V = {station.V.toFixed(1)} m/s</span>
            <span className="text-amber-400">W = {station.W.toFixed(1)} m/s</span>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center min-h-[220px]">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto max-h-[240px] overflow-visible"
          >
            <defs>
              <marker
                id={`arrow-v-${stationNum}`}
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={colorV} />
              </marker>
              <marker
                id={`arrow-w-${stationNum}`}
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={colorW} />
              </marker>
              <marker
                id={`arrow-u-${stationNum}`}
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={colorU} />
              </marker>
            </defs>

            {/* Grid & coordinate axes */}
            <line
              x1="20"
              y1={originY}
              x2={width - 20}
              y2={originY}
              stroke="#334155"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={apexX}
              y1="20"
              x2={apexX}
              y2={height - 20}
              stroke="#334155"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            {/* Axial velocity line (dashed normal) */}
            <line
              x1={apexX}
              y1={apexY}
              x2={apexX}
              y2={originY}
              stroke="#64748b"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={apexX - 8}
              y={(apexY + originY) / 2}
              fill="#94a3b8"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="end"
            >
              Va={station.Va.toFixed(0)}
            </text>

            {/* Peripheral speed vector U (horizontal baseline between W base and V base) */}
            <line
              x1={baseWX}
              y1={baseY}
              x2={baseVX}
              y2={baseY}
              stroke={colorU}
              strokeWidth="2.5"
              markerEnd={`url(#arrow-u-${stationNum})`}
            />
            <text
              x={(baseWX + baseVX) / 2}
              y={baseY + 16}
              fill={colorU}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="600"
              textAnchor="middle"
            >
              U = {U.toFixed(1)} m/s
            </text>

            {/* Absolute velocity vector V (Apex -> baseVX) */}
            <line
              x1={apexX}
              y1={apexY}
              x2={baseVX}
              y2={baseY}
              stroke={colorV}
              strokeWidth="2.5"
              markerEnd={`url(#arrow-v-${stationNum})`}
            />
            <text
              x={(apexX + baseVX) / 2 + 14}
              y={(apexY + baseY) / 2 - 6}
              fill={colorV}
              fontSize="12"
              fontFamily="monospace"
              fontWeight="700"
            >
              V{stationNum}
            </text>

            {/* Relative velocity vector W (Apex -> baseWX) */}
            <line
              x1={apexX}
              y1={apexY}
              x2={baseWX}
              y2={baseY}
              stroke={colorW}
              strokeWidth="2.5"
              markerEnd={`url(#arrow-w-${stationNum})`}
            />
            <text
              x={(apexX + baseWX) / 2 - 24}
              y={(apexY + baseY) / 2 - 6}
              fill={colorW}
              fontSize="12"
              fontFamily="monospace"
              fontWeight="700"
            >
              W{stationNum}
            </text>

            {/* Swirl components: V_theta and W_theta projections */}
            {Math.abs(station.V_theta) > 10 && (
              <text
                x={baseVX}
                y={baseY - 6}
                fill={colorV}
                fontSize="9"
                fontFamily="monospace"
                textAnchor={station.V_theta > 0 ? 'start' : 'end'}
              >
                Vθ={station.V_theta.toFixed(0)}
              </text>
            )}

            {/* Alpha arc (absolute angle) */}
            <path
              d={`M ${apexX} ${apexY + arcRadius} A ${arcRadius} ${arcRadius} 0 0 ${station.alpha > 0 ? 1 : 0} ${arcAlphaEndX} ${arcAlphaEndY}`}
              fill="none"
              stroke={colorV}
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <text
              x={apexX + 28}
              y={apexY + 28}
              fill={colorV}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              α{stationNum}={station.alpha.toFixed(1)}°
            </text>

            {/* Beta arc (relative angle) */}
            <path
              d={`M ${apexX} ${apexY + arcRadius + 12} A ${arcRadius + 12} ${arcRadius + 12} 0 0 ${station.beta > 0 ? 1 : 0} ${arcBetaEndX} ${arcBetaEndY}`}
              fill="none"
              stroke={colorW}
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <text
              x={apexX - 42}
              y={apexY + 44}
              fill={colorW}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              β{stationNum}={station.beta.toFixed(1)}°
            </text>
          </svg>
        </div>

        {/* Tabular summary for this station */}
        <div className="grid grid-cols-4 gap-2 pt-2.5 mt-2 border-t border-slate-800 text-center font-mono">
          <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
            <span className="block text-[10px] text-slate-400 uppercase">Vθ</span>
            <span className="text-xs font-semibold text-cyan-300">{station.V_theta.toFixed(1)}</span>
          </div>
          <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
            <span className="block text-[10px] text-slate-400 uppercase">Wθ</span>
            <span className="text-xs font-semibold text-amber-300">{station.W_theta.toFixed(1)}</span>
          </div>
          <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
            <span className="block text-[10px] text-slate-400 uppercase">M_abs</span>
            <span className="text-xs font-semibold text-slate-200">{station.Mach_abs.toFixed(2)}</span>
          </div>
          <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800/60">
            <span className="block text-[10px] text-slate-400 uppercase">M_rel</span>
            <span className="text-xs font-semibold text-slate-200">{station.Mach_rel.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {stageName && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md text-xs font-mono">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-semibold text-white">{stageName}</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                isCounter
                  ? 'bg-pink-950/80 text-pink-300 border border-pink-700/60'
                  : 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/60'
              }`}
            >
              {isCounter ? '⟲ Contrarrotativo (-)' : '⟳ Co-rotativo (+)'}
            </span>
            {isVanelessCoupled && (
              <span className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-2 py-0.5 rounded text-[11px]">
                ⚡ Sin Estator Intermedio (Vaneless)
              </span>
            )}
          </div>
          <span className="text-slate-500 whitespace-nowrap">
            U = {absU.toFixed(1)} m/s ({isCounter ? '-' : '+'} tangential)
          </span>
        </div>
      )}
      <div className="flex flex-col gap-3.5">
        {renderSingleTriangle(
          inlet,
          isVanelessCoupled
            ? 'Entrada al Rotor (Swirl Heredado Directo)'
            : turbineType === 'axial'
            ? 'Entrada al Rotor (Salida Estator)'
            : 'Entrada al Rotor (Boquilla Radial)',
          '1'
        )}
        {renderSingleTriangle(
          outlet,
          turbineType === 'axial' ? 'Salida del Rotor' : 'Salida del Exducer Axial',
          '2'
        )}
      </div>
    </div>
  );
};
