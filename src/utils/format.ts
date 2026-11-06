/**
 * Formato de cifras para la interfaz en español: coma decimal y número fijo de decimales.
 * Úsalo para todo número que se muestra; para el portapapeles o CSV hay formatos propios.
 */
export const EMPTY_VALUE = '—';

export function formatNumber(value: number, digits: number, fallback: string = EMPTY_VALUE): string {
  if (!Number.isFinite(value)) return fallback;
  return value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
