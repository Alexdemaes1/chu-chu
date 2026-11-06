import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import type { MultiStageOutputs, TurbineOutputs } from '../../utils/turbine1D';
import { formatNumber } from '../../utils/format';

export interface ResultsTableProps {
  result: MultiStageOutputs;
  activeStageIdx: number;
}

const EMPTY = '—';

/** Valor de una celda: número que se formatea, o null cuando la magnitud no aplica (celda vacía). */
type CellValue = number | null;

interface RowDef {
  key: string;
  /** Símbolo o nombre corto, en la tabla. */
  label: ReactNode;
  /** Mismo nombre en texto plano, para la copia TSV. */
  plainLabel: string;
  /** Aclaración breve de la estación o la definición. */
  detail?: string;
  unit: string;
  digits: number;
  stage: (stage: TurbineOutputs, index: number) => CellValue;
  global?: (result: MultiStageOutputs) => CellValue;
  /** Prefijo para el valor global cuando es un máximo y no un total. */
  globalNote?: string;
}

interface GroupDef {
  title: string;
  rows: RowDef[];
  note?: string;
}

const toBar = (pa: number) => pa / 1e5;
const toKJ = (j: number) => j / 1000;
const toMm = (m: number) => m * 1000;
const pct = (fraction: number) => fraction * 100;

function lossBreakdownOf(stage: TurbineOutputs) {
  return stage.activeLossModel === 'ainley_mathieson' ? stage.ainleyMathiesonLoss : stage.soderbergLoss;
}

function maxOver(result: MultiStageOutputs, pick: (stage: TurbineOutputs) => number): CellValue {
  const values = result.stageResults.map(pick).filter((value) => Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : Number.NaN;
}

function sumOver(result: MultiStageOutputs, pick: (stage: TurbineOutputs) => number): number {
  return result.stageResults.reduce((acc, stage) => acc + pick(stage), 0);
}

function lastStage(result: MultiStageOutputs): TurbineOutputs | undefined {
  return result.stageResults[result.stageResults.length - 1];
}

function buildGroups(result: MultiStageOutputs): GroupDef[] {
  const hasUserDefinedLoss = result.stageResults.some((stage) => stage.activeLossModel === 'user_defined');
  const singleShaft = result.shaftResults.length === 1;

  return [
    {
      title: 'Termodinámica',
      rows: [
        {
          key: 'pr',
          label: <>PR<sub>tt</sub></>,
          plainLabel: 'PRtt',
          detail: 'P₀ entrada / P₀ salida',
          unit: '–',
          digits: 3,
          stage: (s) => s.inputs.PR,
          global: (r) => r.PR_overall,
        },
        {
          key: 'p0in',
          label: <>P<sub>01</sub></>,
          plainLabel: 'P01',
          detail: 'Total, entrada de la etapa',
          unit: 'bar',
          digits: 3,
          stage: (s) => toBar(s.inputs.P01),
          global: (r) => toBar(r.inputs.P01),
        },
        {
          key: 't0in',
          label: <>T<sub>01</sub></>,
          plainLabel: 'T01',
          detail: 'Total, entrada de la etapa',
          unit: 'K',
          digits: 1,
          stage: (s) => s.inputs.T01,
          global: (r) => r.inputs.T01,
        },
        {
          key: 't1',
          label: <>T<sub>1</sub></>,
          plainLabel: 'T1',
          detail: 'Estática, entrada del estator',
          unit: 'K',
          digits: 1,
          stage: (s) => s.T1_static,
        },
        {
          key: 'p1',
          label: <>P<sub>1</sub></>,
          plainLabel: 'P1',
          detail: 'Estática, entrada del estator',
          unit: 'bar',
          digits: 3,
          stage: (s) => toBar(s.P1_static),
        },
        {
          key: 't2',
          label: <>T<sub>2</sub></>,
          plainLabel: 'T2',
          detail: 'Estática, entrada del rotor',
          unit: 'K',
          digits: 1,
          stage: (s) => s.T2_static,
        },
        {
          key: 'p2',
          label: <>P<sub>2</sub></>,
          plainLabel: 'P2',
          detail: 'Estática, entrada del rotor',
          unit: 'bar',
          digits: 3,
          stage: (s) => toBar(s.P2_static),
        },
        {
          key: 't3',
          label: <>T<sub>3</sub></>,
          plainLabel: 'T3',
          detail: 'Estática, salida del rotor',
          unit: 'K',
          digits: 1,
          stage: (s) => s.T3_static,
          global: (r) => lastStage(r)?.T3_static ?? Number.NaN,
        },
        {
          key: 'p3',
          label: <>P<sub>3</sub></>,
          plainLabel: 'P3',
          detail: 'Estática, salida del rotor',
          unit: 'bar',
          digits: 3,
          stage: (s) => toBar(s.P3_static),
          global: (r) => toBar(lastStage(r)?.P3_static ?? Number.NaN),
        },
        {
          key: 't03',
          label: <>T<sub>03</sub></>,
          plainLabel: 'T03',
          detail: 'Total, salida de la etapa',
          unit: 'K',
          digits: 1,
          stage: (s) => s.T03_actual,
          global: (r) => lastStage(r)?.T03_actual ?? Number.NaN,
        },
        {
          key: 'p03',
          label: <>P<sub>03</sub></>,
          plainLabel: 'P03',
          detail: 'Total, salida de la etapa',
          unit: 'bar',
          digits: 3,
          stage: (s) => toBar(s.P03),
          global: (r) => toBar(lastStage(r)?.P03 ?? Number.NaN),
        },
        {
          key: 'dh',
          label: <>Δh<sub>0</sub></>,
          plainLabel: 'Δh0',
          detail: 'Trabajo específico real',
          unit: 'kJ/kg',
          digits: 2,
          stage: (s) => toKJ(s.dh_actual),
          global: (r) => toKJ(r.dh_actual_overall),
        },
        {
          key: 'dhis',
          label: <>Δh<sub>is</sub></>,
          plainLabel: 'Δh_is',
          detail: 'Salto isentrópico total a total',
          unit: 'kJ/kg',
          digits: 2,
          stage: (s) => toKJ(s.dh_is),
          global: (r) => toKJ(r.dh_is_overall),
        },
        {
          key: 'power',
          label: 'Potencia',
          plainLabel: 'Potencia',
          unit: 'kW',
          digits: 1,
          stage: (s) => s.power_kW,
          global: (r) => r.power_total_kW,
        },
        {
          key: 'torque',
          label: 'Par',
          plainLabel: 'Par',
          detail: singleShaft ? 'En el eje' : 'Global solo con un eje',
          unit: 'N·m',
          digits: 0,
          stage: (s) => Math.abs(s.torque_Nm),
          global: singleShaft ? (r) => Math.abs(r.shaftResults[0].torque_Nm) : undefined,
        },
      ],
    },
    {
      title: 'Cinemática',
      rows: [
        {
          key: 'u',
          label: 'U',
          plainLabel: 'U',
          detail: 'Velocidad periférica media',
          unit: 'm/s',
          digits: 1,
          stage: (s) => Math.abs(s.U),
          global: (r) => maxOver(r, (s) => Math.abs(s.U)),
          globalNote: 'máx.',
        },
        {
          key: 'phi',
          label: 'φ',
          plainLabel: 'φ',
          detail: 'Coeficiente de flujo Va/U',
          unit: '–',
          digits: 3,
          stage: (s) => s.phi,
        },
        {
          key: 'psi',
          label: 'ψ',
          plainLabel: 'ψ',
          detail: 'Coeficiente de carga Δh₀/U²',
          unit: '–',
          digits: 3,
          stage: (s) => s.psi,
        },
        {
          key: 'reaction',
          label: 'R',
          plainLabel: 'R',
          detail: 'Grado de reacción cinemático',
          unit: '–',
          digits: 3,
          stage: (s) => s.reaction_actual,
        },
        {
          key: 'alpha1',
          label: <>α<sub>1</sub></>,
          plainLabel: 'α1',
          detail: 'Absoluto, entrada del rotor',
          unit: '°',
          digits: 1,
          stage: (s) => s.inletTriangle.alpha,
        },
        {
          key: 'beta1',
          label: <>β<sub>1</sub></>,
          plainLabel: 'β1',
          detail: 'Relativo, entrada del rotor',
          unit: '°',
          digits: 1,
          stage: (s) => s.inletTriangle.beta,
        },
        {
          key: 'alpha2',
          label: <>α<sub>2</sub></>,
          plainLabel: 'α2',
          detail: 'Absoluto, salida del rotor',
          unit: '°',
          digits: 1,
          stage: (s) => s.outletTriangle.alpha,
        },
        {
          key: 'beta2',
          label: <>β<sub>2</sub></>,
          plainLabel: 'β2',
          detail: 'Relativo, salida del rotor',
          unit: '°',
          digits: 1,
          stage: (s) => s.outletTriangle.beta,
        },
        {
          key: 'mabs1',
          label: <>M<sub>abs,1</sub></>,
          plainLabel: 'M_abs1',
          detail: 'Salida del estator',
          unit: '–',
          digits: 3,
          stage: (s) => s.inletTriangle.Mach_abs,
          global: (r) => maxOver(r, (s) => s.inletTriangle.Mach_abs),
          globalNote: 'máx.',
        },
        {
          key: 'mrel1',
          label: <>M<sub>rel,1</sub></>,
          plainLabel: 'M_rel1',
          detail: 'Entrada del rotor',
          unit: '–',
          digits: 3,
          stage: (s) => s.inletTriangle.Mach_rel,
          global: (r) => maxOver(r, (s) => s.inletTriangle.Mach_rel),
          globalNote: 'máx.',
        },
        {
          key: 'mrel2',
          label: <>M<sub>rel,2</sub></>,
          plainLabel: 'M_rel2',
          detail: 'Salida del rotor',
          unit: '–',
          digits: 3,
          stage: (s) => s.outletTriangle.Mach_rel,
          global: (r) => maxOver(r, (s) => s.outletTriangle.Mach_rel),
          globalNote: 'máx.',
        },
      ],
    },
    {
      title: 'Pérdidas',
      note: hasUserDefinedLoss
        ? 'Con la ecuación de pérdidas propia, el reparto entre estator y rotor se toma de Soderberg.'
        : undefined,
      rows: [
        {
          key: 'lossStator',
          label: 'Estator',
          plainLabel: 'Pérdida estator',
          detail: 'Pérdida de entalpía',
          unit: 'kJ/kg',
          digits: 2,
          stage: (s) => toKJ(lossBreakdownOf(s).dh_loss_stator),
          global: (r) => toKJ(sumOver(r, (s) => lossBreakdownOf(s).dh_loss_stator)),
        },
        {
          key: 'lossRotor',
          label: 'Rotor',
          plainLabel: 'Pérdida rotor',
          detail: 'Pérdida de entalpía',
          unit: 'kJ/kg',
          digits: 2,
          stage: (s) => toKJ(lossBreakdownOf(s).dh_loss_rotor),
          global: (r) => toKJ(sumOver(r, (s) => lossBreakdownOf(s).dh_loss_rotor)),
        },
        {
          key: 'lossExit',
          label: 'Salida',
          plainLabel: 'Energía cinética de salida',
          detail: 'Energía cinética de salida',
          unit: 'kJ/kg',
          digits: 2,
          stage: (s) => toKJ(lossBreakdownOf(s).dh_loss_exit),
          global: (r) => {
            const last = lastStage(r);
            return last ? toKJ(lossBreakdownOf(last).dh_loss_exit) : Number.NaN;
          },
        },
        {
          key: 'etaTt',
          label: <>η<sub>tt</sub></>,
          plainLabel: 'ηtt',
          detail: 'Modelo activo',
          unit: '%',
          digits: 2,
          stage: (s) => pct(s.efficiency_recommended),
          global: (r) => pct(r.eta_overall_tt),
        },
        {
          key: 'etaTs',
          label: <>η<sub>ts</sub></>,
          plainLabel: 'ηts',
          detail: 'Modelo activo',
          unit: '%',
          digits: 2,
          stage: (s) => pct(s.eta_total_to_static),
          global: (r) => pct(r.eta_overall_ts),
        },
      ],
    },
    {
      title: 'Geometría',
      rows: [
        {
          key: 'h',
          label: 'h',
          plainLabel: 'h',
          detail: 'Altura de álabe, salida del rotor',
          unit: 'mm',
          digits: 2,
          stage: (s) => s.bladeHeight_mm,
        },
        {
          key: 'rm',
          label: <>R<sub>m</sub></>,
          plainLabel: 'Rm',
          detail: 'Radio medio',
          unit: 'mm',
          digits: 1,
          stage: (s) => toMm(s.inputs.Rm),
        },
        {
          key: 'rh',
          label: <>R<sub>hub</sub></>,
          plainLabel: 'Rhub',
          detail: 'Raíz, salida del rotor',
          unit: 'mm',
          digits: 1,
          stage: (s) => toMm(s.hubRadius),
        },
        {
          key: 'rt',
          label: <>R<sub>tip</sub></>,
          plainLabel: 'Rtip',
          detail: 'Punta, salida del rotor',
          unit: 'mm',
          digits: 1,
          stage: (s) => toMm(s.tipRadius),
        },
        {
          key: 'hubtip',
          label: <>R<sub>hub</sub>/R<sub>tip</sub></>,
          plainLabel: 'Rhub/Rtip',
          unit: '–',
          digits: 3,
          stage: (s) => s.hubToTipRatio,
        },
        {
          key: 'ns',
          label: <>N<sub>s</sub></>,
          plainLabel: 'Ns',
          detail: 'Velocidad específica (rad)',
          unit: '–',
          digits: 3,
          stage: (s) => s.Ns,
        },
        {
          key: 'ds',
          label: <>D<sub>s</sub></>,
          plainLabel: 'Ds',
          detail: 'Diámetro específico',
          unit: '–',
          digits: 2,
          stage: (s) => s.Ds,
        },
      ],
    },
  ];
}

/** Celda para el portapapeles: punto decimal sin separador de miles (buildTsv lo pasa a coma). */
function formatCell(value: CellValue, digits: number): string {
  if (value === null) return '';
  return Number.isFinite(value) ? value.toFixed(digits) : EMPTY;
}

/** Celda en pantalla: coma decimal, como el resto de la interfaz. */
function displayCell(value: CellValue, digits: number): string {
  if (value === null) return '';
  return formatNumber(value, digits, EMPTY);
}

/** TSV con coma decimal, listo para pegar en una hoja de cálculo en español. */
function buildTsv(groups: GroupDef[], result: MultiStageOutputs, stageHeaders: string[]): string {
  const toSheet = (text: string) => (/^-?\d/.test(text) ? text.replace('.', ',') : text);
  const lines: string[] = [['Magnitud', 'Descripción', 'Unidad', ...stageHeaders, 'Global'].join('\t')];
  for (const group of groups) {
    lines.push(group.title);
    for (const row of group.rows) {
      const stageCells = result.stageResults.map((stage, index) => toSheet(formatCell(row.stage(stage, index), row.digits)));
      const globalCell = row.global ? toSheet(formatCell(row.global(result), row.digits)) : '';
      lines.push([row.plainLabel, row.detail ?? '', row.unit, ...stageCells, globalCell].join('\t'));
    }
  }
  return lines.join('\n');
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('copy failed');
}

type CopyState = 'idle' | 'copied' | 'error';

export function ResultsTable({ result, activeStageIdx }: ResultsTableProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const groups = buildGroups(result);
  const stageCount = result.stageResults.length;
  const stageHeaders = result.stageResults.map((_, index) => `Etapa ${index + 1}`);
  const shaftLabels = result.stageResults.map((_, index) => {
    const config = result.inputs.stages[index];
    return config?.shaftName ?? 'Eje 1';
  });
  const showShaftLabels = new Set(shaftLabels).size > 1;

  const handleCopy = async () => {
    window.clearTimeout(resetTimer.current);
    try {
      await copyText(buildTsv(groups, result, stageHeaders));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 2500);
  };

  const activeCell = (index: number) => (index === activeStageIdx ? 'bg-accent-soft' : '');
  const columnCount = stageCount + 3;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-3">
          {stageCount} {stageCount === 1 ? 'etapa' : 'etapas'}
          {stageCount > 1 && ' · la etapa activa está resaltada'}
        </p>
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-caption">
            {copyState === 'copied' && <span className="text-ok">Tabla copiada</span>}
            {copyState === 'error' && <span className="text-danger">No se pudo copiar</span>}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="btn-secondary h-8 px-2.5 text-label"
            title="Copia la tabla separada por tabuladores y con coma decimal, lista para pegar en una hoja de cálculo"
          >
            {copyState === 'copied' ? (
              <Check className="size-4 text-ok" aria-hidden="true" />
            ) : (
              <ClipboardCopy className="size-4" aria-hidden="true" />
            )}
            Copiar tabla
          </button>
        </div>
      </div>

      {/* w-0 + min-w-full: la tabla ancha no ensancha la columna que la contiene; se desplaza dentro. */}
      <div className="w-0 min-w-full overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max border-collapse text-body tabular-nums">
          <caption className="sr-only">
            Resultados por etapa y globales: termodinámica, cinemática, pérdidas y geometría
          </caption>
          <thead>
            <tr className="border-b border-line-strong bg-surface-muted">
              <th
                scope="col"
                className="sticky left-0 z-10 w-36 bg-surface-muted px-3 py-2 text-left text-caption font-semibold text-ink-3"
              >
                Magnitud
              </th>
              <th scope="col" className="px-2 py-2 text-left text-caption font-semibold text-ink-3">
                Unidad
              </th>
              {stageHeaders.map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  aria-current={index === activeStageIdx ? 'true' : undefined}
                  className={`px-3 py-2 text-right text-label font-semibold ${
                    index === activeStageIdx ? 'bg-accent-soft text-accent-strong' : 'text-ink-2'
                  }`}
                >
                  <span className="block">{header}</span>
                  {showShaftLabels && (
                    <span className="block text-caption font-normal text-ink-3">{shaftLabels[index]}</span>
                  )}
                </th>
              ))}
              <th
                scope="col"
                className="border-l border-line px-3 py-2 text-right text-label font-semibold text-ink"
              >
                Global
              </th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.title} className="border-b border-line last:border-b-0">
              <tr>
                <th
                  scope="colgroup"
                  colSpan={columnCount}
                  className="bg-surface px-3 pb-1 pt-3 text-left text-label font-semibold text-accent-strong"
                >
                  {group.title}
                </th>
              </tr>
              {group.rows.map((row) => {
                const globalValue = row.global ? row.global(result) : null;
                const globalText = displayCell(globalValue, row.digits);
                return (
                  <tr key={row.key} className="group/row border-t border-line first:border-t-0 hover:bg-surface-muted">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-36 bg-surface px-3 py-1.5 text-left font-normal group-hover/row:bg-surface-muted"
                    >
                      {/* Ancho acotado: la descripción pasa a una segunda línea y no tapa los valores. */}
                      <span className="block max-w-[8.5rem] whitespace-normal">
                        <span className="block font-medium text-ink">{row.label}</span>
                        {row.detail && <span className="block text-caption leading-tight text-ink-3">{row.detail}</span>}
                      </span>
                    </th>
                    <td className="px-2 py-1.5 text-label text-ink-3">{row.unit}</td>
                    {result.stageResults.map((stage, index) => {
                      const text = displayCell(row.stage(stage, index), row.digits);
                      return (
                        <td
                          key={index}
                          className={`px-3 py-1.5 text-right ${text === EMPTY ? 'text-ink-3' : 'text-ink-2'} ${activeCell(index)}`}
                        >
                          {text}
                        </td>
                      );
                    })}
                    <td className="border-l border-line px-3 py-1.5 text-right font-semibold text-ink">
                      {globalText && row.globalNote && globalText !== EMPTY && (
                        <span className="mr-1 text-caption font-normal text-ink-3">{row.globalNote}</span>
                      )}
                      {globalText}
                    </td>
                  </tr>
                );
              })}
              {group.note && (
                <tr>
                  <td colSpan={columnCount} className="px-3 pb-2 pt-1 text-caption text-ink-3">
                    {group.note}
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
