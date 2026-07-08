import { ReactNode } from 'react';

/**
 * SapLayout — the SAP Business One / Tally Prime layout primitives.
 *
 * Everything a finance form needs to look like a proper ERP form:
 *   • Horizontal labels (LEFT of the input, not stacked above)
 *   • True 3-column form grid
 *   • Hairline dividers instead of card wrappers with heavy shadows
 *   • Locked input height (28 px), locked label width (72 px)
 *
 * Rule: never freehand a `<div className="grid grid-cols-...">`
 * inside a finance dialog. Use these primitives so density is
 * consistent across every screen in the module.
 *
 * Anatomy of a SAP-style form
 *
 *   ┌──── SapForm ─────────────────────────────────────────┐
 *   │  ┌─ SapRow (12-col grid) ────────────────────────┐   │
 *   │  │  SapField(4) SapField(4) SapField(4)          │   │  each field
 *   │  └──────────────────────────────────────────────┘   │  = label | input
 *   │  ┌─ SapRow ─────────────────────────────────────┐   │
 *   │  │  SapField(6) SapField(6)                     │   │
 *   │  └──────────────────────────────────────────────┘   │
 *   │  ── SapDivider ─────────────────────────────────    │
 *   │  ┌─ SapSection title="Reimbursement Lines" ────┐   │
 *   │  │  <FinanceTable> …                            │   │
 *   │  └──────────────────────────────────────────────┘   │
 *   └──────────────────────────────────────────────────────┘
 */

// ─── Constants ─────────────────────────────────────────────────────────────
// Locked field height across the finance module. 28 px matches SAP B1's
// "compact grid" and lets the whole Expense form fit ~500 px tall.
export const SAP_H = 'h-7';                          // 28 px
export const SAP_INPUT = 'w-full h-7 px-1.5 text-[11px] border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 rounded-none';
export const SAP_INPUT_MONEY = 'w-full h-7 px-1.5 text-[11px] text-right font-mono tabular-nums border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 rounded-none';
export const SAP_SELECT = 'w-full h-7 px-1 text-[11px] border border-gray-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 rounded-none';

// ─── SapForm ─────────────────────────────────────────────────────────────
/**
 * Outer form wrapper. Gives every row the same 6px vertical gap and locks
 * the total left/right padding to 0 — padding lives on the modal body.
 */
export function SapForm({ children, id, onSubmit }: {
  children: ReactNode;
  id?: string;
  onSubmit?: (e: React.FormEvent) => void;
}) {
  return (
    <form id={id} onSubmit={onSubmit} className="flex flex-col gap-1.5">
      {children}
    </form>
  );
}

// ─── SapRow ──────────────────────────────────────────────────────────────
/**
 * A row inside a form. Always 12 columns wide with a 6 px inter-field gap.
 * Fields declare their own col-span via the `span` prop on SapField.
 */
export function SapRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-12 gap-x-1.5 gap-y-1.5 items-center">{children}</div>;
}

// ─── SapField ────────────────────────────────────────────────────────────
/**
 * Horizontal label + input pair.
 *
 * • Label sits LEFT of the input (SAP B1 style), fixed width, 10 px UPPER.
 * • Field takes `span` grid columns of 12 total. Default 4 → 3 fields per row.
 * • Pass the input as children — labels are added by this component.
 *
 * Use span=4 for standard fields, span=6 for wider (Description),
 * span=12 for full-width, span=2/3 for very compact toggles.
 */
export function SapField({
  label,
  required,
  span = 4,
  labelWidth = 'w-[72px]',
  children,
  right,
}: {
  label: string;
  required?: boolean;
  span?: 2 | 3 | 4 | 5 | 6 | 8 | 12;
  /** Override the fixed label column width. Default 72 px. */
  labelWidth?: string;
  children: ReactNode;
  /** Optional trailing element rendered flush right of the input (badge, ↻, …). */
  right?: ReactNode;
}) {
  const spanCls =
    span === 12 ? 'col-span-12'
    : span === 8 ? 'col-span-8'
    : span === 6 ? 'col-span-6'
    : span === 5 ? 'col-span-5'
    : span === 3 ? 'col-span-3'
    : span === 2 ? 'col-span-2'
    : 'col-span-4';
  return (
    <div className={`${spanCls} flex items-center gap-1.5 min-w-0`}>
      <label className={`${labelWidth} shrink-0 text-[9px] font-semibold uppercase tracking-wide text-gray-500 leading-none`}>
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
      {right && <div className="shrink-0 flex items-center">{right}</div>}
    </div>
  );
}

// ─── SapDivider ──────────────────────────────────────────────────────────
/**
 * Hairline between logical groups of rows. NEVER wrap groups in cards or
 * boxes with shadows — a single hairline gives grouping without the
 * vertical bloat of a card.
 */
export function SapDivider() {
  return <div className="border-t border-gray-200" />;
}

// ─── SapSection ──────────────────────────────────────────────────────────
/**
 * Optional labelled band for a table or non-form block. Title is 10 px
 * UPPER, hugs the top of its content. Use sparingly — most rows don't need
 * a title.
 */
export function SapSection({
  title,
  right,
  children,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {(title || right) && (
        <div className="flex items-center justify-between h-5">
          {title && <span className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{title}</span>}
          {right && <div className="flex items-center gap-1">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── SapKPI ──────────────────────────────────────────────────────────────
/**
 * The compact summary chip used in the footer / totals bar. Label 9 px,
 * value 11 px mono. Never wrap in a card.
 */
export function SapKPI({
  label,
  value,
  tint = 'default',
  emphasis,
}: {
  label: string;
  value: ReactNode;
  tint?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  emphasis?: boolean;
}) {
  const tintCls =
    tint === 'success' ? 'text-green-700'
    : tint === 'danger' ? 'text-red-700'
    : tint === 'warning' ? 'text-orange-700'
    : tint === 'info' ? 'text-blue-700'
    : 'text-gray-900';
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`font-mono tabular-nums ${emphasis ? 'text-sm font-bold' : 'text-[11px]'} ${tintCls}`}>{value}</span>
    </div>
  );
}
