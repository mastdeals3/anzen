import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';

type PphType = 'PPh21' | 'PPh22' | 'PPh23' | 'PPh4(2)' | 'PPh_Unifikasi';

const TABS: PphType[] = ['PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'];

interface Row {
  tax_period_id: string;
  fiscal_year: number;
  period_month: number;
  tax_type: string;
  pph_total: number;
  pph_paid_total: number;
  pph_outstanding: number;
  status: string;
  payment_due_date: string | null;
  filing_due_date: string | null;
}

export function PphRegisterPanel() {
  const { dateRange } = useFinance();
  const [active, setActive] = useState<PphType>('PPh21');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('vw_pph_by_period_type')
        .select('*')
        .eq('tax_type', active)
        .order('fiscal_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(60);
      if (!cancelled) {
        setRows((data as Row[] | null) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [active]);

  const filtered = useMemo(() => {
    if (!dateRange?.startDate || !dateRange?.endDate) return rows;
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);
    return rows.filter(r => {
      const first = new Date(r.fiscal_year, r.period_month - 1, 1);
      const last  = new Date(r.fiscal_year, r.period_month, 0);
      return last >= start && first <= end;
    });
  }, [rows, dateRange]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`px-3 py-1 text-sm rounded border ${active === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 p-4 border rounded bg-yellow-50">
          No {active} periods in the selected date range. Periods are created automatically once expenses with PPh are posted.
        </p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Total PPh</th>
                <th className="text-right px-3 py-2">Paid</th>
                <th className="text-right px-3 py-2">Outstanding</th>
                <th className="text-left px-3 py-2">Payment Due</th>
                <th className="text-left px-3 py-2">Filing Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.tax_period_id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.fiscal_year}-{String(r.period_month).padStart(2,'0')}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-right">{Number(r.pph_total).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right">{Number(r.pph_paid_total).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right font-semibold">Rp {Number(r.pph_outstanding).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2">{r.payment_due_date ?? '—'}</td>
                  <td className="px-3 py-2">{r.filing_due_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
