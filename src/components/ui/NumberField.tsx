import {useId, useState, type KeyboardEvent, type ReactNode} from 'react';

export interface NumberFieldProps {
  /** Texto de la etiqueta visible. */
  label: ReactNode;
  /** Símbolo de la magnitud (ṁ, P₀₁, R…), mostrado junto a la etiqueta. */
  symbol?: ReactNode;
  /** Unidad mostrada dentro del campo, a la derecha (bar, K, rpm…). */
  unit?: ReactNode;
  value: number;
  /** Solo recibe números finitos. Durante la escritura, solo valores dentro de [min, max]. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Incremento de las flechas ↑/↓ del teclado. */
  step?: number;
  /** Explicación breve bajo el campo. */
  hint?: ReactNode;
  /** Valor o rango típico, mostrado como «Típico: …». */
  typical?: ReactNode;
  /** Mensaje de error; pinta el campo en rojo. */
  error?: ReactNode;
  id?: string;
  /** Variante densa: oculta la pista y el valor típico (el error se sigue mostrando). */
  compact?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Solo aplica el valor al salir del campo o con Enter (y con las flechas), no en cada pulsación.
   * Para magnitudes cuyos valores parciales («1», «13», «130» al escribir 1300) recalcularían o
   * bloquearían todo el diseño a cada dígito.
   */
  commitOnBlur?: boolean;
}

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Convierte el texto del usuario en número; admite coma decimal. Devuelve null si no es válido. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (!NUMBER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  // Elimina el ruido de coma flotante (0.30000000000000004 → 0.3).
  return String(Number(value.toPrecision(12)));
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return result;
}

function isInRange(value: number, min?: number, max?: number): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

function decimalsOf(step: number): number {
  const text = formatValue(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function describeRange(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `entre ${formatValue(min)} y ${formatValue(max)}`;
  if (min !== undefined) return `mayor o igual que ${formatValue(min)}`;
  if (max !== undefined) return `menor o igual que ${formatValue(max)}`;
  return '';
}

/**
 * Campo numérico con texto local: se puede borrar y reescribir sin que el valor salte,
 * admite 0 y coma decimal, y ajusta a [min, max] al salir del campo.
 */
export default function NumberField({
  label,
  symbol,
  unit,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  typical,
  error,
  id,
  compact = false,
  disabled = false,
  placeholder,
  className = '',
  commitOnBlur = false,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const unitId = `${autoId}-unit`;
  const hintId = `${autoId}-hint`;
  const typicalId = `${autoId}-typical`;
  const messageId = `${autoId}-message`;

  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatValue(value));

  // Sin foco, el texto refleja siempre la prop; con foco, manda lo que escribe el usuario.
  const text = focused ? draft : formatValue(value);
  const parsedDraft = focused ? parseDecimal(draft) : null;
  const invalidWhileTyping = focused && draft.trim() !== '' && parsedDraft === null;
  const outOfRangeWhileTyping = parsedDraft !== null && !isInRange(parsedDraft, min, max);

  const showHint = !compact && hint !== undefined && hint !== null && hint !== '';
  const showTypical = !compact && typical !== undefined && typical !== null && typical !== '';
  const hasError = error !== undefined && error !== null && error !== '' && error !== false;

  const describedBy = [
    unit !== undefined ? unitId : null,
    showHint ? hintId : null,
    showTypical ? typicalId : null,
    hasError || invalidWhileTyping || outOfRangeWhileTyping ? messageId : null,
  ]
    .filter(Boolean)
    .join(' ');

  const emit = (next: number) => {
    if (Number.isFinite(next) && next !== value) onChange(next);
  };

  const commit = () => {
    const parsed = parseDecimal(draft);
    if (parsed === null) {
      // Texto vacío o no válido: se restaura el último valor válido.
      setDraft(formatValue(value));
      return;
    }
    const clamped = clamp(parsed, min, max);
    emit(clamped);
    setDraft(formatValue(clamped));
  };

  const handleChange = (nextText: string) => {
    setDraft(nextText);
    if (commitOnBlur) return;
    const parsed = parseDecimal(nextText);
    if (parsed !== null && isInRange(parsed, min, max)) emit(parsed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commit();
      return;
    }
    if (step === undefined || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const base = parseDecimal(draft) ?? value;
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    const factor = event.shiftKey ? 10 : 1;
    const decimals = decimalsOf(step);
    const stepped = Number((base + direction * factor * step).toFixed(decimals));
    const next = clamp(stepped, min, max);
    setDraft(formatValue(next));
    emit(next);
  };

  const borderClass = hasError
    ? 'border-rose-400 focus-visible:outline-danger'
    : 'border-line-strong focus-visible:outline-accent';

  let message: ReactNode = null;
  if (hasError) {
    message = <span className="text-danger">{error}</span>;
  } else if (invalidWhileTyping) {
    message = <span className="text-warn">Escribe un número válido; al salir se recupera el valor anterior.</span>;
  } else if (outOfRangeWhileTyping) {
    message = (
      <span className="text-warn">Debe estar {describeRange(min, max)}; se ajustará al salir del campo.</span>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col ${compact ? 'gap-1' : 'gap-1.5'} ${className}`}>
      <label
        htmlFor={inputId}
        className={`${compact ? 'text-caption' : 'text-label'} font-medium text-ink-2 flex items-baseline gap-1.5`}
      >
        <span>{label}</span>
        {symbol !== undefined && symbol !== null && (
          <span className="font-normal text-ink-3">{symbol}</span>
        )}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={hasError || invalidWhileTyping || undefined}
          aria-describedby={describedBy || undefined}
          onFocus={() => {
            setDraft(formatValue(value));
            setFocused(true);
          }}
          onBlur={() => {
            commit();
            setFocused(false);
          }}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className={`w-full rounded-lg border bg-surface text-ink tabular-nums h-10 sm:h-9 text-base sm:text-sm pl-2.5 ${
            unit !== undefined ? 'pr-14' : 'pr-2.5'
          } ${borderClass} focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-3`}
        />
        {unit !== undefined && (
          <span
            id={unitId}
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-label text-ink-3"
          >
            {unit}
          </span>
        )}
      </div>
      {showHint && (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      )}
      {showTypical && (
        <p id={typicalId} className="text-caption text-ink-3">
          Típico: {typical}
        </p>
      )}
      {message && (
        <p id={messageId} className="text-caption" role={hasError ? 'alert' : undefined}>
          {message}
        </p>
      )}
    </div>
  );
}

export {NumberField};
