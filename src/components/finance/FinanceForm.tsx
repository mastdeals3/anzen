import { ReactNode } from 'react';
import {
  BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, BTN_SUCCESS,
  FORM_HINT, FORM_LABEL, INPUT, INPUT_MONEY, SELECT, TEXTAREA,
} from './uiTokens';

/**
 * FinanceForm primitives — ERP-style form spacing / sizing in ONE place.
 *
 * Every finance form imports these instead of hand-rolling grid/label/input
 * classes. Field height, label size, gaps and grid columns all live here
 * so a single change ripples across every dialog.
 *
 * Rules (from the ERP density brief)
 *   • Input / dropdown / date picker: h-8 (32 px)
 *   • Button: h-[30px]
 *   • Label: 10px uppercase, tight
 *   • Value / body text: 11px
 *   • Grid gaps: gap-x-3, gap-y-2  (very tight vertical rhythm)
 *   • Sections: section title 12px bold, 4px bottom margin, no giant dividers
 *
 * Do not tune these per-form. If a form needs a different shape, extend
 * this file so the whole module picks it up.
 */

// ─── Tokens ────────────────────────────────────────────────────────────────
export const F_INPUT  = INPUT;
export const F_INPUT_MONEY = INPUT_MONEY;
export const F_SELECT = SELECT;
export const F_TEXTAREA = TEXTAREA;
export const F_LABEL  = FORM_LABEL;
export const F_HINT   = FORM_HINT;
export const F_HELP   = 'text-[10px] text-red-600 mt-0.5';
export const F_BTN_H  = 'h-7';
export const F_BTN_PRIMARY   = BTN_PRIMARY;
export const F_BTN_SECONDARY = BTN_SECONDARY;
export const F_BTN_DANGER    = BTN_DANGER;
export const F_BTN_SUCCESS   = BTN_SUCCESS;

// ─── Section ──────────────────────────────────────────────────────────────
/**
 * A visual section inside a form. Small title above, a hairline border
 * below the title, and tight top margin between sections. No card wrappers,
 * no shadows — just a labelled band that keeps content grouped without
 * eating vertical space.
 */
export function FormSection({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-2 last:mb-0">
      {title && (
        <div className="flex items-center justify-between border-b border-gray-200 pb-0.5 mb-1.5">
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{title}</h4>
          {right && <div className="text-[10px] text-gray-500">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────
/**
 * Multi-column form grid. Defaults to 2 columns; use `cols` to change.
 * Field spans within the grid use FormField's `span` prop.
 */
export function FormGrid({ cols = 2, children }: { cols?: 2 | 3 | 4 | 6 | 12; children: ReactNode }) {
  const gridCls = cols === 12 ? 'grid-cols-1 sm:grid-cols-12'
                : cols === 6  ? 'grid-cols-1 sm:grid-cols-6'
                : cols === 4  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                : cols === 3  ? 'grid-cols-1 sm:grid-cols-3'
                : 'grid-cols-1 sm:grid-cols-2';
  return <div className={`grid ${gridCls} gap-x-3 gap-y-2`}>{children}</div>;
}

// ─── Field ────────────────────────────────────────────────────────────────
/**
 * Wraps a label + input. The label is fixed height so aligned fields
 * across a row are always vertically level even when one has a hint.
 */
export function FormField({
  label, required, hint, error, span = 1, children,
}: {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** Grid column span. Defaults to 1. Ignored when parent isn't a 12-col grid. */
  span?: 1 | 2 | 3 | 4 | 6 | 12;
  children: ReactNode;
}) {
  const spanCls =
    span === 12 ? 'sm:col-span-12'
    : span === 6 ? 'sm:col-span-6'
    : span === 4 ? 'sm:col-span-4'
    : span === 3 ? 'sm:col-span-3'
    : span === 2 ? 'sm:col-span-2'
    : '';
  return (
    <div className={spanCls}>
      {label && (
        <label className={F_LABEL}>
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? <div className={F_HELP}>{error}</div> : hint ? <div className={F_HINT}>{hint}</div> : null}
    </div>
  );
}
