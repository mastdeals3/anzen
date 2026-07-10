import { ReactNode } from 'react';

/*
  SapLayout — canonical Finance form primitives.

  Every Finance form uses these so a rewrite in one screen doesn't drift the
  overall look-and-feel:
    • SAP_INPUT             base input class (h-7, text-sm, gray-300 border)
    • SAP_INPUT_ERROR       add-on class for invalid state (red border + ring)
    • SAP_BTN_PRIMARY       h-7 blue submit button used in every dialog footer
    • SAP_BTN_SECONDARY     h-7 gray cancel button used in every dialog footer
    • SapRow                12-col grid row
    • SapField              cell with label + optional right slot + optional
                            inline FieldError
    • FieldError            single-source validation message (red, 10px)
*/

export const SAP_INPUT       = 'w-full h-7 px-2.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 disabled:bg-gray-50 disabled:text-gray-500';
export const SAP_INPUT_ERROR = '!border-red-400 focus:!border-red-500 focus:!ring-red-200';

export const SAP_BTN_PRIMARY   = 'h-7 px-3 text-xs font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
export const SAP_BTN_SECONDARY = 'h-7 px-3 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50';

interface SapRowProps {
  children: ReactNode;
}

export function SapRow({ children }: SapRowProps) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {children}
    </div>
  );
}

interface SapFieldProps {
  label: string;
  children: ReactNode;
  span?: number;
  required?: boolean;
  /** Optional right-aligned chip / mode toggle inside the label bar. */
  right?: ReactNode;
  /** Optional single-line validation message shown below the input. */
  error?: string | null;
  /** Optional hint text shown below the input when there is no error. */
  hint?: string | null;
}

export function SapField({ label, children, span = 6, required, right, error, hint }: SapFieldProps) {
  return (
    <div className={`col-span-${span}`}>
      <label className="block text-xs font-medium text-gray-700 mb-0.5 flex items-center justify-between">
        <span>
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {right}
      </label>
      {children}
      {error ? (
        <FieldError message={error} />
      ) : hint ? (
        <div className="mt-0.5 text-[10px] text-gray-400 leading-tight">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * FieldError — the ONE validation message used in every Finance form.
 * Single spacing rule (mt-0.5), single colour (red-600), single size (10px).
 */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-0.5 text-[10px] font-medium text-red-600 leading-tight">
      {message}
    </div>
  );
}
