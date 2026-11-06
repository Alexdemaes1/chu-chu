import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRadialEquilibriumBladeSections } from './bladeGeometry.ts';
import {
  DEFAULT_STL_HEADER,
  auditTurbomachineryDesign,
  generateBinarySTL,
  generateBladeCoordinatesCSV,
  type TurbomachineryAuditParams,
} from './exportGeometry.ts';
import { calculateMultiStageTurbine, type MultiStageInputs, type TurbineOutputs } from './turbine1D.ts';

const design = calculateRadialEquilibriumBladeSections({
  Rm_m: 0.12,
  hb_m: 0.03,
  U_mid_ms: 565.49,
  Va_mid_ms: 339.29,
  V_theta1_mid_ms: 464.59,
  V_theta2_mid_ms: -101.36,
  c_ax_mid_mm: 20,
  psi_Zweifel: 0.85,
  incidence_deg: 0,
  deviation_deg: 3,
});

const SURFACE_OF_SEGMENT = { le: 'LeadingEdge', ss: 'Suction', te: 'TrailingEdge', ps: 'Pressure' } as const;

test('generateBladeCoordinatesCSV (CAD) labels every point with the surface of its real segment', () => {
  const csv = generateBladeCoordinatesCSV(design);
  const lines = csv.split('\n');
  assert.ok(lines[0].startsWith('#'));
  const header = lines.find((line) => !line.startsWith('#'));
  assert.equal(header, 'Section,PointIndex,X_Cartesian_mm,Y_Cartesian_mm,Z_Axial_mm,Radius_mm,Theta_deg,ProfileSurface');
  const rows = lines.filter((line) => !line.startsWith('#') && line !== header).map((line) => line.split(','));

  for (const [section, profile] of [['Hub', design.hub], ['Mid', design.mid], ['Tip', design.tip]] as const) {
    const sectionRows = rows.filter((row) => row[0] === section);
    const contour = profile.curves.fullContour;
    // The closing point (equal to the first one) is not written.
    assert.equal(sectionRows.length, contour.length - 1, `${section}: closing duplicate must be removed`);
    for (const [segment, surface] of Object.entries(SURFACE_OF_SEGMENT) as [keyof typeof SURFACE_OF_SEGMENT, string][]) {
      const range = profile.segmentRanges[segment];
      const lastWritten = Math.min(range.end, contour.length - 2);
      const labelled = sectionRows.filter((row) => row[7] === surface).map((row) => Number(row[1]));
      const expected = Array.from({ length: lastWritten - range.start + 1 }, (_, i) => range.start + i);
      assert.deepEqual(labelled, expected, `${section}: ${surface} must cover exactly ${range.start}-${lastWritten}`);
    }
    const first = sectionRows[0].slice(2, 5).join(',');
    const last = sectionRows[sectionRows.length - 1].slice(2, 5).join(',');
    assert.notEqual(first, last, `${section}: first and last points must differ`);
  }
});

test('generateBladeCoordinatesCSV (Excel) uses semicolons, decimal comma, BOM and starts the table on line 1', () => {
  const csv = generateBladeCoordinatesCSV(design, { format: 'excel' });
  assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM expected');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Sección;Punto;X (mm);Y (mm);Z axial (mm);Radio (mm);Theta (°);Superficie');
  assert.ok(!csv.includes('#'));
  const firstRow = lines[1].split(';');
  assert.equal(firstRow.length, 8);
  assert.equal(firstRow[0], 'Buje');
  assert.equal(firstRow[7], 'Borde de ataque');
  assert.match(firstRow[2], /^-?\d+,\d{4}$/);
  assert.ok(!lines[1].includes('.'), 'no decimal points in Excel format');
  const dataRows = lines.slice(1, lines.indexOf(''));
  assert.equal(dataRows.length, 3 * (design.mid.curves.fullContour.length - 1));
  assert.ok(lines.some((line) => line.startsWith('Número de álabes Z;')), 'metadata at the end');
});

const readHeader = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer()).slice(0, 80);
  return String.fromCharCode(...bytes).replace(/\0+$/, '');
};

test('generateBinarySTL writes 84 + 50·n bytes and an ASCII header with units', async () => {
  // Two triangles of a unit square, indexed.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const blob = generateBinarySTL(positions, indices);
  assert.equal(blob.size, 84 + 50 * 2);
  const header = await readHeader(blob);
  assert.equal(header, DEFAULT_STL_HEADER);
  assert.ok(!/AI STUDIO/i.test(header));
  assert.ok(!/^solid/i.test(header));
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getUint32(80, true), 2);
  assert.equal(view.getFloat32(84 + 8, true), 1, 'normal of a CCW triangle in the XY plane is +Z');

  const rotor = generateBinarySTL(positions, indices, 'Turbina 1D - Etapa 1 · Eje 1 - unidades: mm', 22);
  assert.equal(rotor.size, 84 + 50 * 2 * 22);
  assert.equal(await readHeader(rotor), 'Turbina 1D - Etapa 1 - Eje 1 - unidades: mm');

  const legacy = generateBinarySTL(positions, indices, 3);
  assert.equal(legacy.size, 84 + 50 * 2 * 3);

  const soup = generateBinarySTL([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.equal(soup.size, 84 + 50);

  const tricky = await readHeader(generateBinarySTL(positions, indices, `solid ${'x'.repeat(100)}`));
  assert.ok(!/^solid/i.test(tricky));
  assert.equal(tricky.length, 80);
});

test('generateBinarySTL rejects invalid meshes with a Spanish error', () => {
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0];
  assert.throws(() => generateBinarySTL(positions, [0, 1]), /múltiplo de 3/);
  assert.throws(() => generateBinarySTL(positions, [0, 1, 3]), /fuera de rango/);
  assert.throws(() => generateBinarySTL([0, 0, Number.NaN, 1, 0, 0, 1, 1, 0], [0, 1, 2]), /no es un número finito/);
  assert.throws(() => generateBinarySTL([], undefined), /malla/);
  assert.throws(() => generateBinarySTL(positions, [0, 1, 2], 'Turbina', 0), /copias/);
});

const EXAMPLE: MultiStageInputs = {
  m_dot: 2.5,
  P01: 400000,
  T01: 1100,
  gasKey: 'combustionGas',
  stages: [{
    id: 'stage-1', name: 'Etapa 1', shaftName: 'Eje 1', PR: 2.2, N: 45000, direction: 1,
    Rm: 0.12, R: 0.5, phi: 0.6, turbineType: 'axial',
  }],
};

const auditOf = (stage: TurbineOutputs, extra: Partial<TurbomachineryAuditParams> = {}) => auditTurbomachineryDesign({
  M_rel1: stage.inletTriangle.Mach_rel,
  M_abs1: stage.inletTriangle.Mach_abs,
  M_rel2: stage.outletTriangle.Mach_rel,
  M_abs2: stage.outletTriangle.Mach_abs,
  psi_Zweifel: 0.85,
  solidity: 1.2,
  turningAngle_deg: 60,
  incidence_deg: 0,
  deviation_deg: 3,
  reaction: 0.5,
  hubTipRatio: 0.85,
  ...extra,
});

test('auditTurbomachineryDesign warns (without critical) for the transonic example', () => {
  const stage = calculateMultiStageTurbine(EXAMPLE).stageResults[0];
  // Example (Soderberg, η_tt ≈ 0.902): M_abs1 ≈ 0.948 at stator exit, just below the 0.95
  // transonic threshold, and M_rel2 ≈ 0.996 at rotor exit (transonic, still subsonic).
  assert.ok(stage.inletTriangle.Mach_abs > 0.9 && stage.inletTriangle.Mach_abs <= 0.95);
  assert.ok(stage.outletTriangle.Mach_rel > 0.95 && stage.outletTriangle.Mach_rel < 1.0);
  const diagnostics = auditOf(stage);
  assert.equal(diagnostics.filter((d) => d.severity === 'critical').length, 0);
  const machWarnings = diagnostics.filter((d) => d.severity === 'warning' && (d.metric === 'M_abs,1' || d.metric === 'M_rel,2'));
  assert.deepEqual(machWarnings.map((d) => d.metric), ['M_rel,2']);
  assert.ok(machWarnings.every((d) => /transónica|supersónica/.test(d.title)));
});

test('auditTurbomachineryDesign flags PR = 6 as critical (convergent-divergent passage needed)', () => {
  const stage = calculateMultiStageTurbine({ ...EXAMPLE, stages: [{ ...EXAMPLE.stages[0], PR: 6 }] }).stageResults[0];
  const critical = auditOf(stage).filter((d) => d.severity === 'critical');
  assert.ok(critical.some((d) => d.metric === 'M_rel,2' && /convergente-divergente/.test(d.title)));
});

test('auditTurbomachineryDesign applies the exit-Mach thresholds and the stage label', () => {
  const stage = calculateMultiStageTurbine(EXAMPLE).stageResults[0];
  const at = (mach: number) => auditOf(stage, { M_abs1: 0.5, M_rel2: mach, M_abs2: undefined }).find((d) => d.metric === 'M_rel,2');
  assert.equal(at(0.9), undefined);
  assert.equal(at(0.97)?.severity, 'warning');
  assert.match(at(0.97)?.diagnosis ?? '', /no incluye pérdidas por choque/);
  assert.equal(at(1.1)?.severity, 'warning');
  assert.match(at(1.1)?.diagnosis ?? '', /post-expansión/);
  assert.equal(at(1.35)?.severity, 'critical');

  const subsonic = auditOf(stage, { M_abs1: 0.6, M_rel2: 0.7, M_abs2: 0.4 });
  assert.ok(subsonic.some((d) => d.severity === 'optimal' && d.metric === 'M_salida máx.'));

  const labelled = auditOf(stage, { stageLabel: 'Etapa 2' });
  assert.ok(labelled.every((d) => d.title.startsWith('Etapa 2 · ')));
});
