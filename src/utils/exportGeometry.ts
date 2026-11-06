/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContourSegmentRanges, Point2D, RadialBladeDesign } from './bladeGeometry';

/** Default 80-byte header of the binary STL files. Coordinates are written in millimetres. */
export const DEFAULT_STL_HEADER = 'Turbina 1D - unidades: mm';

/**
 * Turns any text into a valid binary-STL header: printable ASCII only, at most 80 characters and
 * never starting with "solid" (some readers would take the file for an ASCII STL).
 */
function sanitizeStlHeader(header: string): string {
  const ascii = header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[·•–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
    .trim();
  const text = ascii.length > 0 ? ascii : DEFAULT_STL_HEADER;
  const safe = /^solid/i.test(text) ? `STL ${text}` : text;
  return safe.slice(0, 80);
}

/**
 * Generates a binary STL Blob from a vertex position array and an optional triangle index array.
 *
 * Binary STL layout: 80-byte header, UINT32 triangle count and, for each triangle, the normal and
 * the three vertices as 12 Float32 values followed by a UINT16 attribute (0). Total size 84 + 50·n.
 *
 * `numInstances` > 1 repeats the geometry rotated around the Z axis (a full rotor from one blade).
 * The legacy call `generateBinarySTL(positions, indices, numInstances)` is still accepted.
 *
 * @throws Error (message in Spanish) if the mesh is empty, the indices are not a multiple of 3 or
 * out of range, or any coordinate is not finite.
 */
export function generateBinarySTL(
  positions: Float32Array | number[],
  indices?: Uint32Array | Uint16Array | number[],
  header?: string,
  numInstances?: number,
): Blob;
/** @deprecated Pass the header as third argument and the instance count as fourth. */
export function generateBinarySTL(
  positions: Float32Array | number[],
  indices: Uint32Array | Uint16Array | number[] | undefined,
  numInstances: number,
): Blob;
export function generateBinarySTL(
  positions: Float32Array | number[],
  indices?: Uint32Array | Uint16Array | number[],
  headerOrInstances?: string | number,
  numInstancesArg?: number,
): Blob {
  const header = typeof headerOrInstances === 'string' ? headerOrInstances : DEFAULT_STL_HEADER;
  const numInstances = typeof headerOrInstances === 'number' ? headerOrInstances : numInstancesArg ?? 1;

  if (!Number.isInteger(numInstances) || numInstances < 1) {
    throw new Error('El número de copias del álabe debe ser un entero mayor o igual que 1.');
  }
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error('La malla no es válida: el número de coordenadas debe ser un múltiplo de 3 y mayor que cero.');
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new Error(`La malla no es válida: la coordenada ${i} no es un número finito.`);
    }
  }

  const vertexCount = positions.length / 3;
  const isIndexed = indices !== undefined && indices.length > 0;
  if (isIndexed) {
    if (indices.length % 3 !== 0) {
      throw new Error('La malla no es válida: el número de índices debe ser un múltiplo de 3.');
    }
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error(`La malla no es válida: el índice ${index} está fuera de rango (0 a ${vertexCount - 1}).`);
      }
    }
  } else if (positions.length % 9 !== 0) {
    throw new Error('La malla no es válida: sin índices, el número de coordenadas debe ser un múltiplo de 9.');
  }

  const numBaseTriangles = isIndexed ? indices.length / 3 : positions.length / 9;
  const totalTriangles = numBaseTriangles * numInstances;
  if (totalTriangles === 0) {
    throw new Error('La malla no contiene triángulos.');
  }

  const buffer = new ArrayBuffer(84 + totalTriangles * 50);
  const view = new DataView(buffer);

  const headerText = sanitizeStlHeader(header);
  for (let i = 0; i < 80; i++) {
    view.setUint8(i, i < headerText.length ? headerText.charCodeAt(i) : 0);
  }
  view.setUint32(80, totalTriangles, true);

  let offset = 84;
  const writeVector = (x: number, y: number, z: number) => {
    view.setFloat32(offset, x, true);
    view.setFloat32(offset + 4, y, true);
    view.setFloat32(offset + 8, z, true);
    offset += 12;
  };

  for (let instance = 0; instance < numInstances; instance++) {
    const angle = instance * ((2 * Math.PI) / numInstances);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let t = 0; t < numBaseTriangles; t++) {
      const i1 = isIndexed ? indices[t * 3] * 3 : t * 9;
      const i2 = isIndexed ? indices[t * 3 + 1] * 3 : t * 9 + 3;
      const i3 = isIndexed ? indices[t * 3 + 2] * 3 : t * 9 + 6;

      // Rotate around the Z axis for the rotor copies.
      const x1 = positions[i1] * cosA - positions[i1 + 1] * sinA;
      const y1 = positions[i1] * sinA + positions[i1 + 1] * cosA;
      const z1 = positions[i1 + 2];
      const x2 = positions[i2] * cosA - positions[i2 + 1] * sinA;
      const y2 = positions[i2] * sinA + positions[i2 + 1] * cosA;
      const z2 = positions[i2 + 2];
      const x3 = positions[i3] * cosA - positions[i3 + 1] * sinA;
      const y3 = positions[i3] * sinA + positions[i3 + 1] * cosA;
      const z3 = positions[i3 + 2];

      // Facet normal from the cross product (right-hand rule on the vertex order).
      const ax = x2 - x1, ay = y2 - y1, az = z2 - z1;
      const bx = x3 - x1, by = y3 - y1, bz = z3 - z1;
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz);
      if (length > 1e-12) {
        nx /= length; ny /= length; nz /= length;
      } else {
        nx = 0; ny = 0; nz = 1;
      }

      writeVector(nx, ny, nz);
      writeVector(x1, y1, z1);
      writeVector(x2, y2, z2);
      writeVector(x3, y3, z3);
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}

export type BladeCoordinatesCsvFormat = 'cad' | 'excel';

export interface BladeCoordinatesCsvOptions {
  /**
   * 'cad' (default): comma separator, decimal point and '#' comment lines, for ANSYS TurboGrid,
   * BladeGen, OpenFOAM or numpy. 'excel': semicolon separator, decimal comma and UTF-8 BOM, so a
   * Spanish-locale Excel opens it in columns with a double click; the table starts on line 1 and
   * the metadata goes at the end.
   */
  format?: BladeCoordinatesCsvFormat;
}

type ProfileSurface = 'LeadingEdge' | 'Suction' | 'TrailingEdge' | 'Pressure';

const SURFACE_LABELS_ES: Record<ProfileSurface, string> = {
  LeadingEdge: 'Borde de ataque',
  Suction: 'Extradós',
  TrailingEdge: 'Borde de salida',
  Pressure: 'Intradós',
};

const SECTION_LABELS_ES: Record<'Hub' | 'Mid' | 'Tip', string> = {
  Hub: 'Buje',
  Mid: 'Medio',
  Tip: 'Punta',
};

function surfaceAt(index: number, ranges: ContourSegmentRanges): ProfileSurface {
  if (index <= ranges.le.end) return 'LeadingEdge';
  if (index <= ranges.ss.end) return 'Suction';
  if (index <= ranges.te.end) return 'TrailingEdge';
  return 'Pressure';
}

/** Closed contours repeat the first point at the end; CSV consumers prefer an open polyline. */
function withoutClosingDuplicate(contour: Point2D[]): Point2D[] {
  if (contour.length < 2) return contour;
  const first = contour[0];
  const last = contour[contour.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y) < 1e-9 ? contour.slice(0, -1) : contour;
}

/**
 * Generates a CSV with the 3D coordinates of the hub, mid and tip profiles. Each point is labelled
 * with the surface it belongs to (from `segmentRanges`) and the closing point that repeats the
 * first one is left out.
 */
export function generateBladeCoordinatesCSV(
  radialDesign: RadialBladeDesign,
  options: BladeCoordinatesCsvOptions = {},
): string {
  const format: BladeCoordinatesCsvFormat = options.format === 'excel' ? 'excel' : 'cad';
  const { hub, mid, tip, bladeCount_Z, Rm_mm, R_hub_mm, R_tip_mm } = radialDesign;
  const sections = [
    { name: 'Hub' as const, data: hub, radius: R_hub_mm },
    { name: 'Mid' as const, data: mid, radius: Rm_mm },
    { name: 'Tip' as const, data: tip, radius: R_tip_mm },
  ];

  const rows: { section: 'Hub' | 'Mid' | 'Tip'; index: number; values: number[]; surface: ProfileSurface }[] = [];
  for (const { name, data, radius } of sections) {
    const contour = withoutClosingDuplicate(data.curves.fullContour);
    contour.forEach((point, index) => {
      // point.x is the axial position [mm]; point.y is the pitchwise offset on the developed plane [mm].
      const thetaRad = point.y / radius;
      rows.push({
        section: name,
        index,
        values: [
          radius * Math.cos(thetaRad),
          radius * Math.sin(thetaRad),
          point.x,
          radius,
          (thetaRad * 180) / Math.PI,
        ],
        surface: surfaceAt(index, data.segmentRanges),
      });
    });
  }

  const decimals = [4, 4, 4, 3, 4];

  if (format === 'cad') {
    const lines = [
      '# TURBOMACHINE 3D BLADE PROFILE COORDINATES',
      `# Blade Count Z: ${bladeCount_Z}`,
      `# Hub Radius: ${R_hub_mm.toFixed(2)} mm, Mid Radius: ${Rm_mm.toFixed(2)} mm, Tip Radius: ${R_tip_mm.toFixed(2)} mm`,
      '# Coordinate System: Axial=Z [mm], Radial=R [mm], Tangential=Theta [deg], Cartesian=(X, Y, Z) [mm]',
      'Section,PointIndex,X_Cartesian_mm,Y_Cartesian_mm,Z_Axial_mm,Radius_mm,Theta_deg,ProfileSurface',
    ];
    for (const row of rows) {
      const numbers = row.values.map((value, i) => value.toFixed(decimals[i]));
      lines.push([row.section, String(row.index), ...numbers, row.surface].join(','));
    }
    return lines.join('\n');
  }

  const decimalComma = (value: number, digits: number) => value.toFixed(digits).replace('.', ',');
  const lines = [
    'Sección;Punto;X (mm);Y (mm);Z axial (mm);Radio (mm);Theta (°);Superficie',
  ];
  for (const row of rows) {
    const numbers = row.values.map((value, i) => decimalComma(value, decimals[i]));
    lines.push([SECTION_LABELS_ES[row.section], String(row.index), ...numbers, SURFACE_LABELS_ES[row.surface]].join(';'));
  }
  lines.push(
    '',
    'Dato;Valor',
    `Número de álabes Z;${bladeCount_Z}`,
    `Radio de buje (mm);${decimalComma(R_hub_mm, 2)}`,
    `Radio medio (mm);${decimalComma(Rm_mm, 2)}`,
    `Radio de punta (mm);${decimalComma(R_tip_mm, 2)}`,
    'Sistema de coordenadas;Z axial, R radial y Theta tangencial; X e Y cartesianas (mm)',
  );
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Aerodynamic and structural rule-based diagnostics for the technical assessment of one stage.
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

export interface TurbomachineryAuditParams {
  /** Relative Mach number at rotor inlet (station 1). */
  M_rel1: number;
  /** Absolute Mach number at stator exit / rotor inlet (station 1). */
  M_abs1: number;
  /** Relative Mach number at rotor exit (station 2). */
  M_rel2: number;
  /** Absolute Mach number at rotor exit (station 2). Optional. */
  M_abs2?: number;
  psi_Zweifel: number;
  solidity: number;
  turningAngle_deg: number;
  incidence_deg: number;
  deviation_deg: number;
  reaction: number;
  hubTipRatio: number;
  /** Prefix for every title, e.g. 'Etapa 2'. */
  stageLabel?: string;
}

/** Above this exit Mach number the flow is transonic and the model has no shock losses. */
export const EXIT_MACH_TRANSONIC = 0.95;
/** Above this exit Mach number a convergent cascade relies on post-expansion. */
export const EXIT_MACH_SUPERSONIC = 1.0;
/** Above this exit Mach number a convergent-divergent passage is needed. */
export const EXIT_MACH_CONVERGENT_DIVERGENT = 1.3;

function exitMachDiagnostic(row: string, metric: string, mach: number): AerodynamicDiagnostic | null {
  if (!Number.isFinite(mach) || mach <= EXIT_MACH_TRANSONIC) return null;
  const value = mach.toFixed(2);
  if (mach > EXIT_MACH_CONVERGENT_DIVERGENT) {
    return {
      severity: 'critical',
      title: `${row}: requiere paso convergente-divergente`,
      metric,
      value,
      limit: `${metric} ≤ ${EXIT_MACH_CONVERGENT_DIVERGENT.toFixed(2)}`,
      diagnosis: 'Requiere paso convergente-divergente; el resultado 1D no es fiable. El modelo no incluye pérdidas por choque ni el bloqueo de la garganta.',
      recommendation: 'Reduce la relación de presiones de la etapa (o reparte el salto en más etapas), o sube el grado de reacción si el problema está en el estator.',
    };
  }
  if (mach > EXIT_MACH_SUPERSONIC) {
    return {
      severity: 'warning',
      title: `${row}: salida supersónica`,
      metric,
      value,
      limit: `${metric} ≤ ${EXIT_MACH_SUPERSONIC.toFixed(2)}`,
      diagnosis: 'Salida supersónica: una rejilla convergente depende de la post-expansión; η optimista.',
      recommendation: 'Trata el rendimiento como un límite superior. Para bajar el Mach, reduce la relación de presiones de la etapa o reparte el salto en más etapas.',
    };
  }
  return {
    severity: 'warning',
    title: `${row}: salida transónica`,
    metric,
    value,
    limit: `${metric} ≤ ${EXIT_MACH_TRANSONIC.toFixed(2)}`,
    diagnosis: 'Salida transónica: el modelo no incluye pérdidas por choque, así que el rendimiento puede ser algo optimista.',
    recommendation: 'Aceptable en turbinas de alta carga; si quieres margen, reduce ligeramente la relación de presiones de la etapa.',
  };
}

export function auditTurbomachineryDesign(params: TurbomachineryAuditParams): AerodynamicDiagnostic[] {
  const diagnostics: AerodynamicDiagnostic[] = [];

  // 1. Relative Mach number at rotor inlet (leading-edge shocks).
  if (params.M_rel1 > 1.05) {
    diagnostics.push({
      severity: 'critical',
      title: 'Flujo relativo supersónico a la entrada del rotor',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel,1 ≤ 1.05',
      diagnosis: 'Riesgo de ondas de choque desprendidas en el borde de ataque, desprendimiento de la capa límite y una caída fuerte del rendimiento.',
      recommendation: 'Reduce las rpm o el radio medio para bajar la velocidad relativa W1, o afina el radio del borde de ataque.',
    });
  } else if (params.M_rel1 > 0.88) {
    diagnostics.push({
      severity: 'warning',
      title: 'Entrada al rotor en régimen transónico alto',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel,1 ≤ 0.88',
      diagnosis: 'La aceleración local en el extradós puede alcanzar Mach supersónico con ondas de choque débiles.',
      recommendation: 'Vigila la curvatura del extradós adelantando la posición del espesor máximo.',
    });
  } else {
    diagnostics.push({
      severity: 'optimal',
      title: 'Entrada al rotor subsónica',
      metric: 'M_rel,1',
      value: params.M_rel1.toFixed(2),
      limit: 'M_rel,1 ≤ 0.88',
      diagnosis: 'Flujo subsónico a la entrada del rotor, sin ondas de choque en el borde de ataque.',
      recommendation: 'Sin cambios necesarios.',
    });
  }

  // 2. Exit Mach numbers: stator exit, rotor exit (relative) and stage exit (absolute).
  const exitChecks: [string, string, number | undefined][] = [
    ['Salida del estator', 'M_abs,1', params.M_abs1],
    ['Salida del rotor', 'M_rel,2', params.M_rel2],
    ['Salida de la etapa', 'M_abs,2', params.M_abs2],
  ];
  const exitDiagnostics = exitChecks
    .map(([row, metric, mach]) => (mach === undefined ? null : exitMachDiagnostic(row, metric, mach)))
    .filter((diagnostic): diagnostic is AerodynamicDiagnostic => diagnostic !== null);
  if (exitDiagnostics.length > 0) {
    diagnostics.push(...exitDiagnostics);
  } else {
    const finiteExits = exitChecks
      .map(([, , mach]) => mach)
      .filter((mach): mach is number => mach !== undefined && Number.isFinite(mach));
    if (finiteExits.length > 0) {
      diagnostics.push({
        severity: 'optimal',
        title: 'Mach de salida subsónico',
        metric: 'M_salida máx.',
        value: Math.max(...finiteExits).toFixed(2),
        limit: `M ≤ ${EXIT_MACH_TRANSONIC.toFixed(2)}`,
        diagnosis: 'Las salidas del estator y del rotor son subsónicas: el modelo 1D sin pérdidas por choque es aplicable.',
        recommendation: 'Sin cambios necesarios.',
      });
    }
  }

  // 3. Zweifel loading.
  if (params.psi_Zweifel > 1.15) {
    diagnostics.push({
      severity: 'critical',
      title: 'Sobrecarga aerodinámica de Zweifel',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: 'ψ_Z ≤ 1.15',
      diagnosis: 'Gradiente adverso de presión excesivo en el extradós, con alto riesgo de desprendimiento de la capa límite.',
      recommendation: 'Aumenta el número de álabes o la solidez c_ax/s para bajar ψ_Z hacia 0,85.',
    });
  } else if (params.psi_Zweifel < 0.65) {
    diagnostics.push({
      severity: 'warning',
      title: 'Solidez excesiva (pérdidas por fricción)',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: 'ψ_Z ≥ 0.65',
      diagnosis: 'Demasiados álabes en la corona: aumentan la superficie mojada y las pérdidas por fricción.',
      recommendation: 'Reduce el número de álabes aumentando el paso circunferencial s.',
    });
  } else {
    diagnostics.push({
      severity: 'optimal',
      title: 'Carga de Zweifel adecuada',
      metric: 'ψ_Z',
      value: params.psi_Zweifel.toFixed(2),
      limit: '0.65 ≤ ψ_Z ≤ 1.15',
      diagnosis: 'Buen equilibrio entre pérdidas por fricción y riesgo de desprendimiento según el criterio de Zweifel.',
      recommendation: 'Sin cambios necesarios.',
    });
  }

  // 4. Flow turning.
  if (params.turningAngle_deg > 75) {
    diagnostics.push({
      severity: 'warning',
      title: 'Deflexión del flujo elevada',
      metric: 'Δβ',
      value: `${params.turningAngle_deg.toFixed(1)}°`,
      limit: 'Δβ ≤ 75°',
      diagnosis: 'Curvatura severa de la línea media: puede generar vórtices secundarios intensos en las esquinas de buje y punta.',
      recommendation: 'Reparte el salto entálpico en más etapas o sube el grado de reacción para moderar el giro relativo.',
    });
  }

  // 5. Degree of reaction.
  if (params.reaction < 0.1) {
    diagnostics.push({
      severity: 'warning',
      title: 'Grado de reacción muy bajo',
      metric: 'R',
      value: params.reaction.toFixed(2),
      limit: 'R ≥ 0.10',
      diagnosis: 'Etapa casi de acción: pérdidas elevadas en la tobera del estator y Mach alto a su salida.',
      recommendation: 'Salvo que sea una etapa de regulación tipo Curtis, sube R hacia 0,40-0,50 para mejorar el rendimiento.',
    });
  }

  // 6. Applicability of the 2D-flow assumption (the app does not solve radial equilibrium).
  if (params.hubTipRatio <= 0.8) {
    diagnostics.push({
      severity: 'warning',
      title: 'Puede hacer falta el equilibrio radial',
      metric: 'Rh/Rt',
      value: params.hubTipRatio.toFixed(3),
      limit: 'Rh/Rt > 0.80',
      diagnosis: 'Con una relación buje/punta de 0,80 o menos el flujo deja de ser bidimensional y el modelo no resuelve el equilibrio radial.',
      recommendation: 'Activa el filtro Rh/Rt > 0,80 en el barrido o trata esta fila como una que requiere análisis radial.',
    });
  }

  if (params.stageLabel) {
    const prefix = params.stageLabel.trim();
    if (prefix) {
      return diagnostics.map((diagnostic) => ({ ...diagnostic, title: `${prefix} · ${diagnostic.title}` }));
    }
  }
  return diagnostics;
}
