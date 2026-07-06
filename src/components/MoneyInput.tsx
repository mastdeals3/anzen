import { forwardRef, useState } from 'react';

/**
 * MoneyInput — Indonesian-formatted money input.
 *
 *   • Live thousands separators using Indonesian locale (`1.250.000` not `1,250,000`)
 *   • Cursor stays put while typing (native contentEditable would break this;
 *     we count separators before/after re-format and re-apply the caret).
 *   • Default zero disappears the instant the user types (empty display when
 *     value === 0 and the field is not focused, or immediately on focus).
 *
 * The value prop is a plain number. onChange emits a plain number.
 * Downstream code doesn't need to know about formatting.
 */

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  value: number | null | undefined;
  onChange: (n: number) => void;
  /** Show empty (no "0") when value is exactly 0 and field not focused. Default true. */
  hideZero?: boolean;
  /** Allow decimal (Indonesian comma). Default false. */
  decimal?: boolean;
}

// Format a number as an Indonesian-locale string with dot thousands separator.
function formatId(n: number, decimal: boolean): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('id-ID', decimal ? {} : { maximumFractionDigits: 0 });
}

// Parse the Indonesian-formatted string back to a number.
function parseId(s: string, decimal: boolean): number {
  if (!s) return 0;
  let cleaned = s.replace(/\s/g, '');
  if (decimal) {
    // Indonesian decimal: 1.250.000,50 → 1250000.50
    cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
  } else {
    // Integer-only: strip everything non-digit (and leading -)
    cleaned = cleaned.replace(/[^\d-]/g, '');
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Count how many "separator characters" (dot or comma) precede a given caret
// position inside a formatted Indonesian number string.
function countSeparatorsBefore(s: string, caret: number): number {
  let n = 0;
  for (let i = 0; i < caret && i < s.length; i++) {
    if (s[i] === '.' || s[i] === ',') n += 1;
  }
  return n;
}

// Find the caret position in the newly formatted string that corresponds to
// having `digitCount` digits before it. Preserves feel that the cursor sits
// after the "last digit the user just typed."
function caretPositionForDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === digitCount) return i + 1;
    }
  }
  return formatted.length;
}

// Count digits in a string up to a given position.
function countDigitsBefore(s: string, caret: number): number {
  let n = 0;
  for (let i = 0; i < caret && i < s.length; i++) {
    if (/\d/.test(s[i])) n += 1;
  }
  return n;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, hideZero = true, decimal = false, className = '', onFocus, onBlur, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);
  const numeric = Number(value ?? 0);
  const showEmpty = hideZero && numeric === 0 && !focused;
  const display = showEmpty ? '' : formatId(numeric, decimal);

  return (
    <input
      {...rest}
      ref={ref}
      // We must use type="text" to keep control of formatting + caret; inputMode
      // still surfaces the numeric keypad on mobile.
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      value={display}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      onChange={(e) => {
        const input = e.currentTarget;
        const before = input.value;
        const rawCaret = input.selectionStart ?? before.length;
        // Digits typed BEFORE the caret is the anchor we want to preserve.
        const digitsBeforeCaret = countDigitsBefore(before, rawCaret);
        const parsed = parseId(before, decimal);
        const formatted = formatId(parsed, decimal);
        onChange(parsed);
        // Reposition the caret to sit right after the same digit index.
        // Rerender happens on the parent update so we schedule a microtask.
        requestAnimationFrame(() => {
          const next = caretPositionForDigits(formatted, digitsBeforeCaret);
          try { input.setSelectionRange(next, next); } catch { /* ignore */ }
        });
      }}
      className={className}
    />
  );
});
