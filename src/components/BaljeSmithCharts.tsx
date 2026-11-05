import React from 'react';

interface BaljeSmithChartsProps {
  Ns: number;
  Ds: number;
  phi: number;
  psi: number;
  etaBalje: number;
  etaNASA: number;
  turbineType: 'axial' | 'radial';
}

export const BaljeSmithCharts: React.FC<BaljeSmithChartsProps> = ({
  Ns,
  Ds,
  phi,
  psi,
  etaBalje,
  etaNASA,
  turbineType,
}) => {
  // Chart 1: Balje Chart (log Ns vs log Ds)
  // Ns range: 0.15 to 3.0 (log scale)
  // Ds range: 1.2 to 8.0 (log scale)
  const minNs = 0.2;
  const maxNs = 3.0;
  const minDs = 1.2;
  const maxDs = 7.0;

  const logMinNs = Math.log10(minNs);
  const logMaxNs = Math.log10(maxNs);
  const logMinDs = Math.log10(minDs);
  const logMaxDs = Math.log10(maxDs);

  const baljeW = 320;
  const baljeH = 200;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 30;

  const nToX = (nVal: number) => {
    const val = Math.max(minNs, Math.min(maxNs, nVal));
    const frac = (Math.log10(val) - logMinNs) / (logMaxNs - logMinNs);
    return padL + frac * (baljeW - padL - padR);
  };

  const dToY = (dVal: number) => {
    const val = Math.max(minDs, Math.min(maxDs, dVal));
    const frac = (Math.log10(val) - logMinDs) / (logMaxDs - logMinDs);
    return (baljeH - padB) - frac * (baljeH - padT - padB);
  };

  const currentBaljeX = nToX(Ns);
  const currentBaljeY = dToY(Ds);

  // Chart 2: Smith Chart (phi vs psi)
  // phi: 0.2 to 1.2 (linear)
  // psi: 0.4 to 2.8 (linear)
  const minPhi = 0.2;
  const maxPhi = 1.2;
  const minPsi = 0.4;
  const maxPsi = 2.8;

  const phiToX = (pVal: number) => {
    const val = Math.max(minPhi, Math.min(maxPhi, pVal));
    const frac = (val - minPhi) / (maxPhi - minPhi);
    return padL + frac * (baljeW - padL - padR);
  };

  const psiToY = (psVal: number) => {
    const val = Math.max(minPsi, Math.min(maxPsi, psVal));
    const frac = (val - minPsi) / (maxPsi - minPsi);
    return (baljeH - padB) - frac * (baljeH - padT - padB);
  };

  const currentSmithX = phiToX(phi);
  const currentSmithY = psiToY(psi);

  return (
    <div className="grid grid-cols-1 gap-3.5">
      {/* Balje Chart */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Correlación Dimensional
            </span>
            <h4 className="text-sm font-semibold text-slate-200">
              Diagrama de Balje (Ns — Ds)
            </h4>
          </div>
          <div className="text-right font-mono text-xs">
            <span className="text-slate-400">η Balje: </span>
            <span className="text-emerald-400 font-semibold">{(etaBalje * 100).toFixed(1)}%</span>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center">
          <svg viewBox={`0 0 ${baljeW} ${baljeH}`} className="w-full h-auto">
            {/* Grid lines */}
            {[0.3, 0.5, 1.0, 2.0].map((tick) => (
              <g key={`ns-${tick}`}>
                <line
                  x1={nToX(tick)}
                  y1={padT}
                  x2={nToX(tick)}
                  y2={baljeH - padB}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={nToX(tick)}
                  y={baljeH - padB + 14}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {tick}
                </text>
              </g>
            ))}

            {[2.0, 3.0, 5.0].map((tick) => (
              <g key={`ds-${tick}`}>
                <line
                  x1={padL}
                  y1={dToY(tick)}
                  x2={baljeW - padR}
                  y2={dToY(tick)}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={padL - 6}
                  y={dToY(tick) + 3}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/* Balje Optimum Ellipses (Axial & Radial zones) */}
            {/* Axial Optimum contour: Ns ~ 0.95, Ds ~ 3.1 */}
            <ellipse
              cx={nToX(0.95)}
              cy={dToY(3.1)}
              rx="46"
              ry="26"
              fill="rgba(6, 182, 212, 0.08)"
              stroke="rgba(6, 182, 212, 0.4)"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <text
              x={nToX(0.95)}
              y={dToY(3.1) - 12}
              fill="#06b6d4"
              fontSize="8"
              fontFamily="monospace"
              textAnchor="middle"
            >
              Zona Óptima Axial (90%+)
            </text>

            {/* Radial Inflow Optimum contour: Ns ~ 0.68, Ds ~ 3.7 */}
            <ellipse
              cx={nToX(0.68)}
              cy={dToY(3.7)}
              rx="38"
              ry="24"
              fill="rgba(245, 158, 11, 0.06)"
              stroke="rgba(245, 158, 11, 0.4)"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <text
              x={nToX(0.68)}
              y={dToY(3.7) + 18}
              fill="#f59e0b"
              fontSize="8"
              fontFamily="monospace"
              textAnchor="middle"
            >
              Zona Radial IFR
            </text>

            {/* Operating Point Crosshair */}
            <line
              x1={currentBaljeX}
              y1={padT}
              x2={currentBaljeX}
              y2={baljeH - padB}
              stroke="#ec4899"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <line
              x1={padL}
              y1={currentBaljeY}
              x2={baljeW - padR}
              y2={currentBaljeY}
              stroke="#ec4899"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <circle
              cx={currentBaljeX}
              cy={currentBaljeY}
              r="5"
              fill="#ec4899"
              stroke="#ffffff"
              strokeWidth="1.5"
            />

            {/* Axis labels */}
            <text
              x={baljeW / 2 + 10}
              y={baljeH - 6}
              fill="#94a3b8"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
            >
              Ns (Velocidad Específica, rad)
            </text>
            <text
              x={-baljeH / 2 + 6}
              y="12"
              fill="#94a3b8"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
              transform="rotate(-90)"
            >
              Ds (Diámetro Específico)
            </text>
          </svg>
        </div>

        <div className="flex justify-between items-center text-[11px] font-mono pt-2 border-t border-slate-800 text-slate-300">
          <span>Punto de diseño actual:</span>
          <span>
            Ns = <strong className="text-pink-400">{Ns.toFixed(3)}</strong>, Ds ={' '}
            <strong className="text-pink-400">{Ds.toFixed(2)}</strong>
          </span>
        </div>
      </div>

      {/* Smith Chart (Stage loading vs Flow coefficient) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 flex flex-col">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Correlación de Pérdidas
            </span>
            <h4 className="text-sm font-semibold text-slate-200">
              Diagrama de Smith / NASA (ψ — φ)
            </h4>
          </div>
          <div className="text-right font-mono text-xs">
            <span className="text-slate-400">η NASA tt: </span>
            <span className="text-emerald-400 font-semibold">{(etaNASA * 100).toFixed(1)}%</span>
          </div>
        </div>

        <div className="relative flex-1 flex items-center justify-center">
          <svg viewBox={`0 0 ${baljeW} ${baljeH}`} className="w-full h-auto">
            {/* Grid lines for phi */}
            {[0.4, 0.6, 0.8, 1.0].map((tick) => (
              <g key={`phi-${tick}`}>
                <line
                  x1={phiToX(tick)}
                  y1={padT}
                  x2={phiToX(tick)}
                  y2={baljeH - padB}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={phiToX(tick)}
                  y={baljeH - padB + 14}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {tick.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Grid lines for psi */}
            {[0.8, 1.2, 1.6, 2.0, 2.4].map((tick) => (
              <g key={`psi-${tick}`}>
                <line
                  x1={padL}
                  y1={psiToY(tick)}
                  x2={baljeW - padR}
                  y2={psiToY(tick)}
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x={padL - 6}
                  y={psiToY(tick) + 3}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  {tick.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Smith Efficiency Contours (approximate Smith lines) */}
            {/* 90% contour */}
            <path
              d={`M ${phiToX(0.4)} ${psiToY(1.0)} Q ${phiToX(0.7)} ${psiToY(1.3)} ${phiToX(1.0)} ${psiToY(1.8)}`}
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <text
              x={phiToX(0.72)}
              y={psiToY(1.35) - 4}
              fill="#10b981"
              fontSize="8"
              fontFamily="monospace"
            >
              η = 90%
            </text>

            {/* 86% contour */}
            <path
              d={`M ${phiToX(0.35)} ${psiToY(1.6)} Q ${phiToX(0.75)} ${psiToY(2.0)} ${phiToX(1.1)} ${psiToY(2.5)}`}
              fill="none"
              stroke="#64748b"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={phiToX(0.75)}
              y={psiToY(2.0) - 4}
              fill="#64748b"
              fontSize="8"
              fontFamily="monospace"
            >
              η = 86%
            </text>

            {/* Operating Point Crosshair */}
            <line
              x1={currentSmithX}
              y1={padT}
              x2={currentSmithX}
              y2={baljeH - padB}
              stroke="#06b6d4"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <line
              x1={padL}
              y1={currentSmithY}
              x2={baljeW - padR}
              y2={currentSmithY}
              stroke="#06b6d4"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
            <circle
              cx={currentSmithX}
              cy={currentSmithY}
              r="5"
              fill="#06b6d4"
              stroke="#ffffff"
              strokeWidth="1.5"
            />

            {/* Axis labels */}
            <text
              x={baljeW / 2 + 10}
              y={baljeH - 6}
              fill="#94a3b8"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
            >
              φ (Coeficiente de Flujo Va / U)
            </text>
            <text
              x={-baljeH / 2 + 6}
              y="12"
              fill="#94a3b8"
              fontSize="10"
              fontFamily="monospace"
              textAnchor="middle"
              transform="rotate(-90)"
            >
              ψ (Coeficiente de Carga Δh / U²)
            </text>
          </svg>
        </div>

        <div className="flex justify-between items-center text-[11px] font-mono pt-2 border-t border-slate-800 text-slate-300">
          <span>Punto cinemático:</span>
          <span>
            φ = <strong className="text-cyan-400">{phi.toFixed(3)}</strong>, ψ ={' '}
            <strong className="text-cyan-400">{psi.toFixed(3)}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
