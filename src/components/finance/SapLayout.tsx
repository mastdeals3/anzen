import { ReactNode } from 'react';

export const SAP_INPUT = 'w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-400';

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
  right?: ReactNode;
}

export function SapField({ label, children, span = 6, required, right }: SapFieldProps) {
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
    </div>
  );
}
