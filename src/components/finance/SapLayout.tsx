import { ReactNode } from 'react';

export const SAP_INPUT = 'w-full h-8 px-2 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500';

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
      <label className="block text-[11px] font-medium text-gray-600 mb-0.5 flex items-center justify-between">
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
