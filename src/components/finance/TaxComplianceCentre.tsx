import { Suspense, useState } from 'react';
import { Calendar, FileText, Receipt, Layers, TrendingUp, Lock, ShieldCheck } from 'lucide-react';
import { TaxCalendarPanel } from './tax/TaxCalendarPanel';
import { TaxPeriodsPanel } from './tax/TaxPeriodsPanel';
import { PphRegisterPanel } from './tax/PphRegisterPanel';
import { TaxPaymentsPanel } from './tax/TaxPaymentsPanel';
import { FakturPajakPanel } from './tax/FakturPajakPanel';
import { PeriodClosePanel } from './tax/PeriodClosePanel';
import { TaxReportsPanel } from './tax/TaxReportsPanel';
import { FinancePage } from './FinancePage';
import { FinanceButton } from './FinanceUI';

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
    <FinancePage title="Tax Compliance" subtitle="Periods, registers, payments, Faktur Pajak, and reports">
      <div className="space-y-2">
      <div className="border-b border-gray-200 bg-white p-1">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map(t => (
            <FinanceButton
              key={t.id}
              onClick={() => setActive(t.id)}
              variant={active === t.id ? 'primary' : 'ghost'}
            >
              {t.icon}
              {t.label}
            </FinanceButton>
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
    </FinancePage>
  );
}
