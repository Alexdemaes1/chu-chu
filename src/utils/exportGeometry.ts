/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RadialBladeDesign, Point2D } from './bladeGeometry';

/**
 * Generate a Binary STL Blob from a 3D vertex position array and optional triangle index array.
 * Binary STL format:
 * - 80-byte header
 * - 4-byte UINT32: number of triangles
 * - For each triangle:
 *   - 3x Float32: normal vector (nx, ny, nz)
 *   - 3x Float32: vertex 1 (x, y, z)
 *   - 3x Float32: vertex 2 (x, y, z)
 *   - 3x Float32: vertex 3 (x, y, z)
 *   - 2-byte UINT16: attribute byte count (0)
 */
export function generateBinarySTL(
  positions: Float32Array | number[],
  indices?: Uint32Array | Uint16Array | number[],
  numInstances: number = 1
): Blob {
  const isIndexed = indices !== undefined && indices.length > 0;
  const numBaseTriangles = isIndexed ? indices.length / 3 : positions.length / 9;
  const totalTriangles = numBaseTriangles * numInstances;

  // Header (80 bytes) + Triangle count (4 bytes) + Triangles (50 bytes each)
  const bufferLength = 84 + totalTriangles * 50;
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  // 80-byte ASCII Header
  const headerStr = 'TURBOMACHINE 3D BLADE/ROTOR GEOMETRY - AI STUDIO ENGINEERING CAD STL';
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < headerStr.length ? headerStr.charCodeAt(i) : 0);
  }

  // 4-byte UINT32: Number of triangles (Little Endian)
  view.setUint32(80, totalTriangles, true);

  let offset = 84;

  for (let inst = 0; inst < numInstances; inst++) {
    const angle = inst * ((2 * Math.PI) / numInstances);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let t = 0; t < numBaseTriangles; t++) {
      let i1 = 0, i2 = 0, i3 = 0;
      if (isIndexed) {
        i1 = indices![t * 3] * 3;
        i2 = indices![t * 3 + 1] * 3;
        i3 = indices![t * 3 + 2] * 3;
      } else {
        i1 = t * 9;
        i2 = t * 9 + 3;
        i3 = t * 9 + 6;
      }

      // Base coordinates
      const x1_raw = positions[i1], y1_raw = positions[i1 + 1], z1 = positions[i1 + 2];
      const x2_raw = positions[i2], y2_raw = positions[i2 + 1], z2 = positions[i2 + 2];
      const x3_raw = positions[i3], y3_raw = positions[i3 + 1], z3 = positions[i3 + 2];

      // Rotate around Z axis if multi-instance rotor
      const x1 = x1_raw * cosA - y1_raw * sinA;
      const y1 = x1_raw * sinA + y1_raw * cosA;

      const x2 = x2_raw * cosA - y2_raw * sinA;
      const y2 = x2_raw * sinA + y2_raw * cosA;

      const x3 = x3_raw * cosA - y3_raw * sinA;
      const y3 = x3_raw * sinA + y3_raw * cosA;

      // Normal vector calculation via cross product
      const ax = x2 - x1, ay = y2 - y1, az = z2 - z1;
      const bx = x3 - x1, by = y3 - y1, bz = z3 - z1;
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        nx /= len; ny /= len; nz /= len;
      } else {
        nx = 0; ny = 0; nz = 1;
      }

      // Normal
      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;

      // Vertex 1
      view.setFloat32(offset, x1, true); offset += 4;
      view.setFloat32(offset, y1, true); offset += 4;
      view.setFloat32(offset, z1, true); offset += 4;

      // Vertex 2
      view.setFloat32(offset, x2, true); offset += 4;
      view.setFloat32(offset, y2, true); offset += 4;
      view.setFloat32(offset, z2, true); offset += 4;

      // Vertex 3
      view.setFloat32(offset, x3, true); offset += 4;
      view.setFloat32(offset, y3, true); offset += 4;
      view.setFloat32(offset, z3, true); offset += 4;

      // Attribute byte count (UINT16 = 0)
      view.setUint16(offset, 0, true); offset += 2;
    }
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}

/**
 * Generate CSV file of 3D profile coordinates for ANSYS TurboGrid, BladeGen, or OpenFOAM blockMesh.
 */
export function generateBladeCoordinatesCSV(radialDesign: RadialBladeDesign): string {
  const { hub, mid, tip, bladeCount_Z, Rm_mm, R_hub_mm, R_tip_mm } = radialDesign;

  const lines: string[] = [
    '# TURBOMACHINE 3D BLADE PROFILE COORDINATES',
    `# Blade Count Z: ${bladeCount_Z}`,
    `# Hub Radius: ${R_hub_mm.toFixed(2)} mm, Mid Radius: ${Rm_mm.toFixed(2)} mm, Tip Radius: ${R_tip_mm.toFixed(2)} mm`,
    '# Coordinate System: Axial=Z [mm], Radial=R [mm], Tangential=Theta [deg], Cartesian=(X, Y, Z) [mm]',
    'Section,PointIndex,X_Cartesian_mm,Y_Cartesian_mm,Z_Axial_mm,Radius_mm,Theta_deg,ProfileSurface'
  ];

  const sections = [
    { name: 'Hub', data: hub, radius: R_hub_mm },
    { name: 'Mid', data: mid, radius: Rm_mm },
    { name: 'Tip', data: tip, radius: R_tip_mm }
  ];

  sections.forEach(({ name, data, radius }) => {
    const contour = data.curves.fullContour;
    const totalPts = contour.length;

    contour.forEach((pt, idx) => {
      // pt.x is axial chord position [mm], pt.y is tangential offset in development plane [mm]
      const theta_rad = pt.y / radius;
      const theta_deg = (theta_rad * 180) / Math.PI;

      const X = radius * Math.cos(theta_rad);
      const Y = radius * Math.sin(theta_rad);
      const Z = pt.x;

      let surface = 'Suction';
      if (idx < 20) surface = 'LeadingEdge';
      else if (idx > totalPts - 30) surface = 'Pressure';
      else if (idx > totalPts / 2 - 10 && idx < totalPts / 2 + 10) surface = 'TrailingEdge';
      else if (idx >= totalPts / 2) surface = 'Pressure';

      lines.push(`${name},${idx},${X.toFixed(4)},${Y.toFixed(4)},${Z.toFixed(4)},${radius.toFixed(3)},${theta_deg.toFixed(4)},${surface}`);
    });
  });

  return lines.join('\n');
}

/**
 * Aerodynamic and Structural Rule-Based Diagnostic Engine for technical assessment.
 */
export interface AerodynamicDiagnostic {
  severity: 'optimal' | 'warning' | 'critical';
  title: string;
  metric: string;
  value: string;
  limit: string;
  diagnosis: string;
  recommendation: string;
}

export function auditTurbomachineryDesign(params: {
  M_rel1: number;
  M_abs1: number;
  M_rel2: number;
  psi_Zweifel: number;
  solidity: number;
  turningAngle_deg: number;
  incidence_deg: number;
  deviation_deg: number;
  reaction: number;
  hubTipRatio: number;
}): AerodynamicDiagnostic[] {
  const diagnostics: AerodynamicDiagnostic[] = [];

  // 1. Compressibility & Shock Waves (Relative Inlet Mach M_rel1)
  if (params.M_rel1 > 1.05) {
    diagnostics.push({
      severity: 'critical',
      title: 'Flujo Relativo Supersónico en Entrada',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel < 0.95',
      diagnosis: 'Riesgo severo de ondas de choque desprendidas en borde de ataque, desprendimiento de capa límite y drástica caída de rendimiento isentrópico.',
      recommendation: 'Reducir RPM o aumentar el radio medio Rm para disminuir la velocidad tangencial relativa W1, o afinar el radio del borde de ataque r_le.',
    });
  } else if (params.M_rel1 > 0.88) {
    diagnostics.push({
      severity: 'warning',
      title: 'Régimen Transónico Alto',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel < 0.85',
      diagnosis: 'Aceleración local en el extradós puede alcanzar números de Mach supersónicos locales con ondas de choque débiles.',
      recommendation: 'Vigilar la curvatura del extradós adelantando la posición del espesor máximo x_tmax.',
    });
  } else {
    diagnostics.push({
      severity: 'optimal',
      title: 'Régimen de Flujo Subsónico Óptimo',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel < 0.85',
      diagnosis: 'Flujo subsónico suave sin ondas de choque ni pérdidas por compresibilidad parásitas.',
      recommendation: 'Parámetro excelente para máxima eficiencia aerodinámica.',
    });
  }

  // 2. Zweifel Loading & Diffusion Loss (Solidez y Carga de Zweifel)
  if (params.psi_Zweifel > 1.15) {
    diagnostics.push({
      severity: 'critical',
      title: 'Sobrecarga Aerodinámica de Zweifel',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: 'ψ_Z ≤ 1.00',
      diagnosis: 'Gradiente adverso de presión excesivo en el extradós. Alto riesgo de desprendimiento masivo de capa límite (stall).',
      recommendation: 'Aumentar el número de álabes Z o la solidez c_ax/s reduciendo ψ_Z hacia 0.85.',
    });
  } else if (params.psi_Zweifel < 0.65) {
    diagnostics.push({
      severity: 'warning',
      title: 'Solidez Excesiva (Pérdidas por Fricción)',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: '0.75 ≤ ψ_Z ≤ 0.95',
      diagnosis: 'Demasiados álabes en la corona. Aumentan innecesariamente la superficie mojada y las pérdidas por fricción superficial.',
      recommendation: 'Disminuir el número de álabes Z incrementando el paso circunferencial s.',
    });
  } else {
    diagnostics.push({
      severity: 'optimal',
      title: 'Carga de Zweifel Óptima',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: '0.75 ≤ ψ_Z ≤ 1.00',
      diagnosis: 'Balance perfecto entre pérdidas de fricción y prevención del desprendimiento de capa límite según criterio de Zweifel.',
      recommendation: 'Configuración óptima para diseño de turbomáquinas axiales de alta eficiencia.',
    });
  }

  // 3. Turning Angle (Deflexión de flujo)
  if (params.turningAngle_deg > 75) {
    diagnostics.push({
      severity: 'warning',
      title: 'Alta Deflexión Angular del Flujo',
      metric: 'Δβ',
      value: `${params.turningAngle_deg.toFixed(1)}°`,
      limit: 'Δβ ≤ 70°',
      diagnosis: 'Curvatura severa de la línea media (camber). Puede generar vórtices de paso secundarios intensos en esquinas de buje y punta.',
      recommendation: 'Considerar repartir la entalpía en más etapas o aumentar el grado de reacción R para moderar el giro relativo.',
    });
  }

  // 4. Reaction Degree (Grado de Reacción R)
  if (params.reaction < 0.1) {
    diagnostics.push({
      severity: 'warning',
      title: 'Grado de Reacción Muy Bajo (R < 0.1)',
      metric: 'R',
      value: params.reaction.toFixed(2),
      limit: '0.3 ≤ R ≤ 0.6',
      diagnosis: 'Régimen de impulso puro / acción: elevadas pérdidas en tobera estatórica y alto número de Mach de salida del estator.',
      recommendation: 'Si no es una etapa de regulación de impulsos tipo Curtis, elevar R a 0.40 - 0.50 para maximizar el rendimiento.',
    });
  }

  // 5. Applicability of the 2D-flow assumption. The app does not solve ISRE/NISRE.
  if (params.hubTipRatio <= 0.8) {
    diagnostics.push({
      severity: 'warning',
      title: 'El equilibrio radial puede ser necesario',
      metric: 'Rh/Rt',
      value: params.hubTipRatio.toFixed(3),
      limit: 'Rh/Rt > 0.80 para asumir flujo bidimensional',
      diagnosis: 'La relación raíz/punta está bajo el umbral indicado en las diapositivas; el modelo actual no resuelve el equilibrio radial.',
      recommendation: 'Activa el filtro Rh/Rt > 0,80 o trata este resultado como una fila que requiere análisis radial.',
    });
  }

  return diagnostics;
}
