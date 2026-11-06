import { GAS_PRESETS, type LossModel } from './turbine1D';

/** Clave de un fluido predefinido del motor. */
export type GasKey = keyof typeof GAS_PRESETS;

/**
 * Etiquetas en español de los fluidos predefinidos. Se mantienen aparte del motor para no tocar
 * la física: `GAS_PRESETS` conserva sus nombres originales.
 */
const GAS_LABELS_ES: Record<string, string> = {
  combustionGas: 'Gases de combustión',
  air: 'Aire seco',
  hydrogen: 'Hidrógeno',
  superheatedSteam: 'Vapor sobrecalentado',
  carbonDioxide: 'CO₂ supercrítico',
};

const decimalFormatter = (fractionDigits: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });

const gammaFormatter = decimalFormatter(3);
const cpFormatter = decimalFormatter(0);

export function isGasKey(value: unknown): value is GasKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GAS_PRESETS, value);
}

/** Nombre del fluido en español (cae al nombre del motor si no hay traducción). */
export function gasLabel(key: string): string {
  if (!isGasKey(key)) return 'Fluido sin definir';
  return GAS_LABELS_ES[key] ?? GAS_PRESETS[key].name;
}

/** Línea secundaria con las propiedades del gas: «γ = 1,333 · cp = 1148 J/(kg·K)». */
export function gasDetail(key: string): string {
  if (!isGasKey(key)) return '';
  const gas = GAS_PRESETS[key];
  return `γ = ${gammaFormatter.format(gas.gamma)} · cp = ${cpFormatter.format(gas.Cp)} J/(kg·K)`;
}

/** Lista ordenada de fluidos para los selectores. */
export const GAS_OPTIONS: { key: GasKey; label: string; detail: string }[] = Object.keys(GAS_PRESETS).map((key) => ({
  key,
  label: gasLabel(key),
  detail: gasDetail(key),
}));

/** Nombre corto del modelo de pérdidas activo. */
export function lossModelLabel(model: LossModel, userDefinedName?: string): string {
  if (model === 'ainley_mathieson') return 'Ainley-Mathieson simplificado';
  if (model === 'user_defined') return userDefinedName?.trim() || 'Modelo propio';
  return 'Soderberg';
}
