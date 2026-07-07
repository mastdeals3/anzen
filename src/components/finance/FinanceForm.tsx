import { ReactNode } from 'react';

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
export const F_INPUT  = 'w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
export const F_INPUT_MONEY = 'w-full h-8 px-2 text-[11px] text-right font-mono tabular-nums border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
export const F_SELECT = 'w-full h-8 px-2 text-[11px] border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';
export const F_TEXTAREA = 'w-full px-2 py-1 text-[11px] border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none';
export const F_LABEL  = 'block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5';
export const F_HINT   = 'text-[10px] text-gray-400 mt-0.5';
export const F_HELP   = 'text-[10px] text-red-600 mt-0.5';
export const F_BTN_H  = 'h-[30px]';
export const F_BTN_PRIMARY   = `inline-flex items-center gap-1 ${F_BTN_H} px-3 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded`;
export const F_BTN_SECONDARY = `inline-flex items-center gap-1 ${F_BTN_H} px-3 text-[11px] font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded`;
export const F_BTN_DANGER    = `inline-flex items-center gap-1 ${F_BTN_H} px-3 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded`;
export const F_BTN_SUCCESS   = `inline-flex items-center gap-1 ${F_BTN_H} px-3 text-[11px] font-semibold text-white bg-green-600 hover:bg-green-700 rounded`;

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
  const gridCls = cols === 12 ? 'grid-cols-12'
                : cols === 6  ? 'grid-cols-6'
                : cols === 4  ? 'grid-cols-4'
                : cols === 3  ? 'grid-cols-3'
                : 'grid-cols-2';
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
    span === 12 ? 'col-span-12'
    : span === 6 ? 'col-span-6'
    : span === 4 ? 'col-span-4'
    : span === 3 ? 'col-span-3'
    : span === 2 ? 'col-span-2'
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
