import { Suspense, useState } from 'react';
import { Calendar, FileText, Receipt, Layers, TrendingUp, Lock, ShieldCheck } from 'lucide-react';
import { TaxCalendarPanel } from './tax/TaxCalendarPanel';
import { TaxPeriodsPanel } from './tax/TaxPeriodsPanel';
import { PphRegisterPanel } from './tax/PphRegisterPanel';
import { TaxPaymentsPanel } from './tax/TaxPaymentsPanel';
import { FakturPajakPanel } from './tax/FakturPajakPanel';
import { PeriodClosePanel } from './tax/PeriodClosePanel';
import { TaxReportsPanel } from './tax/TaxReportsPanel';

type TaxSubTab =
  | 'calendar' | 'periods' | 'pph' | 'payments' | 'faktur' | 'close' | 'reports';

const TABS: { id: TaxSubTab; label: string; icon: JSX.Element }[] = [
  { id: 'calendar', label: 'Calendar',       icon: <Calendar className="w-4 h-4" /> },
  { id: 'periods',  label: 'PPN Periods',    icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'pph',      label: 'PPh Register',   icon: <Layers className="w-4 h-4" /> },
  { id: 'payments', label: 'Tax Payments',   icon: <Receipt className="w-4 h-4" /> },
  { id: 'faktur',   label: 'Faktur Pajak',   icon: <FileText className="w-4 h-4" /> },
  { id: 'close',    label: 'Period Close',   icon: <Lock className="w-4 h-4" /> },
  { id: 'reports',  label: 'Tax Reports',    icon: <ShieldCheck className="w-4 h-4" /> },
];

export function TaxComplianceCentre() {
  const [active, setActive] = useState<TaxSubTab>('calendar');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition whitespace-nowrap ${
                active === t.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
        {active === 'calendar' && <TaxCalendarPanel />}
        {active === 'periods'  && <TaxPeriodsPanel />}
        {active === 'pph'      && <PphRegisterPanel />}
        {active === 'payments' && <TaxPaymentsPanel />}
        {active === 'faktur'   && <FakturPajakPanel />}
        {active === 'close'    && <PeriodClosePanel />}
        {active === 'reports'  && <TaxReportsPanel />}
      </Suspense>
    </div>
  );
}
