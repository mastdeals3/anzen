import { lazy, Suspense, useState } from 'react';
import { Calendar, FileText, Receipt, Layers, TrendingUp, Lock, ShieldCheck } from 'lucide-react';
import { TaxReports } from './TaxReports';
import { TaxCalendarPanel } from './tax/TaxCalendarPanel';
import { TaxPeriodsPanel } from './tax/TaxPeriodsPanel';
import { PphRegisterPanel } from './tax/PphRegisterPanel';
import { TaxPaymentsPanel } from './tax/TaxPaymentsPanel';
import { FakturPajakPanel } from './tax/FakturPajakPanel';
import { PeriodClosePanel } from './tax/PeriodClosePanel';

type TaxSubTab =
  | 'calendar' | 'periods' | 'pph' | 'payments' | 'faktur' | 'close' | 'reports';

const TABS: { id: TaxSubTab; label: string; icon: JSX.Element }[] = [
  { id: 'calendar', label: 'Calendar',        icon: <Calendar className="w-4 h-4" /> },
  { id: 'periods',  label: 'PPN Periods',     icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'pph',      label: 'PPh Register',    icon: <Layers className="w-4 h-4" /> },
  { id: 'payments', label: 'Tax Payments',    icon: <Receipt className="w-4 h-4" /> },
  { id: 'faktur',   label: 'Faktur Pajak',    icon: <FileText className="w-4 h-4" /> },
  { id: 'close',    label: 'Period Close',    icon: <Lock className="w-4 h-4" /> },
  { id: 'reports',  label: 'Registers (legacy)', icon: <ShieldCheck className="w-4 h-4" /> },
];

export function TaxComplianceCentre() {
  const [active, setActive] = useState<TaxSubTab>('calendar');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-t border-b-2 transition -mb-[9px] ${
              active === t.id
                ? 'text-blue-700 border-blue-600 bg-blue-50/40'
                : 'text-gray-600 border-transparent hover:text-gray-900'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
        {active === 'calendar' && <TaxCalendarPanel />}
        {active === 'periods'  && <TaxPeriodsPanel />}
        {active === 'pph'      && <PphRegisterPanel />}
        {active === 'payments' && <TaxPaymentsPanel />}
        {active === 'faktur'   && <FakturPajakPanel />}
        {active === 'close'    && <PeriodClosePanel />}
        {active === 'reports'  && <TaxReports />}
      </Suspense>
    </div>
  );
}
