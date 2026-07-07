import { useEffect, ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * FinanceModal — the ONE dialog used by every Finance Add / Edit / View.
 *
 * Purpose
 *   Enforce ERP-grade density (SAP Business One / Tally Prime / Dynamics NAV
 *   / Odoo Accounting) on every finance dialog with a single import. Do NOT
 *   use the app-wide `../Modal` inside finance — it targets CRM density and
 *   is intentionally roomier.
 *
 * Anatomy (locked)
 *   ┌────────────────────────────────────────────────┐
 *   │ Title                              [X]         │  h-9  (36px)
 *   ├────────────────────────────────────────────────┤
 *   │                                                │
 *   │ p-3 body (12px inset on every side)            │
 *   │                                                │
 *   ├────────────────────────────────────────────────┤
 *   │ optional footer — h-11, right-aligned buttons  │
 *   └────────────────────────────────────────────────┘
 *
 * • Header: 36px tall, text-xs bold (12px), matches Finance module titles.
 * • Body:   p-3 fixed. If body needs scroll, only body scrolls; header/footer stay pinned.
 * • Footer: optional slot for action buttons — kept out of the scroll region so Save/Cancel
 *   never slide off screen on tall forms.
 *
 * Sizes are Tailwind max-widths. `size="xl"` covers the biggest reference
 * dialogs (Expense with reimbursement lines, Purchase Invoice with items).
 */

interface FinanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Optional subtitle rendered in the header — 10px muted. */
  subtitle?: string;
  /** Optional pinned footer (Save / Cancel / etc). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Pass a Tailwind max-w-* to override the size preset. */
  maxWidth?: string;
  children: ReactNode;
}

const SIZE: Record<NonNullable<FinanceModalProps['size']>, string> = {
  sm:  'max-w-md',
  md:  'max-w-2xl',
  lg:  'max-w-4xl',
  xl:  'max-w-5xl',
  '2xl': 'max-w-6xl',
};

export function FinanceModal({
  isOpen, onClose, title, subtitle, footer, size = 'md', maxWidth, children,
}: FinanceModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const widthClass = maxWidth || SIZE[size];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-2">
        <div className="fixed inset-0 bg-gray-900/50" onClick={onClose} />
        <div className={`relative bg-white rounded shadow-xl border border-gray-300 w-full ${widthClass} max-h-[92vh] flex flex-col`}>
          {/* Header — 36px */}
          <div className="flex items-center justify-between h-9 px-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide truncate">{title}</h3>
              {subtitle && <span className="text-[10px] text-gray-400 truncate">{subtitle}</span>}
            </div>
            <button
              onClick={onClose}
              className="p-0.5 rounded hover:bg-gray-200"
              title="Close"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>

          {/* Body — p-3, scrollable */}
          <div className="flex-1 overflow-y-auto p-3">
            {children}
          </div>

          {/* Footer — pinned so Save / Cancel never scrolls off */}
          {footer && (
            <div className="flex items-center justify-end gap-1.5 h-11 px-3 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
