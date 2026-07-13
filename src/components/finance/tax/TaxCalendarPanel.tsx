import { useEffect, useMemo, useState } from 'react';
import { Calendar, AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { formatDate } from '../../../utils/dateFormat';

interface PeriodStatus {
  id: string;
  fiscal_year: number;
  period_month: number;
  tax_type: string;
  status: string;
  filing_status: string;
  payment_due_date: string | null;
  filing_due_date: string | null;
  net_ppn: number | null;
  pph_total: number | null;
  reconciled_payments_count: number;
  unreconciled_payments_count: number;
  missing_faktur_count: number;
}

function statusChip(period: PeriodStatus): { color: string; icon: JSX.Element; label: string } {
  const today = new Date();
  const dueDate = period.payment_due_date ? new Date(period.payment_due_date) : null;
  const overdue = dueDate && dueDate < today && !['paid','closed','filed'].includes(period.status);
  if (period.status === 'closed')          return { color: 'bg-green-100 text-green-800', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Closed' };
  if (period.status === 'paid')            return { color: 'bg-green-50 text-green-700', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Paid' };
  if (overdue)                             return { color: 'bg-red-100 text-red-800',   icon: <AlertCircle className="w-3 h-3" />, label: 'Overdue' };
  if (period.status === 'payment_pending') return { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-3 h-3" />, label: 'Payment pending' };
  return { color: 'bg-gray-100 text-gray-700', icon: <Clock className="w-3 h-3" />, label: 'Open' };
}

export function TaxCalendarPanel() {
  const { dateRange } = useFinance();
  const [rows, setRows] = useState<PeriodStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setLoading(true);
    const { data } = await supabase
      .from('vw_tax_period_status')
      .select('*')
      .order('fiscal_year', { ascending: false })
      .order('period_month', { ascending: false })
      .order('tax_type', { ascending: true })
      .limit(240);
    setRows((data as PeriodStatus[] | null) ?? []);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

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

  const grouped = useMemo(() => {
    const byPeriod = new Map<string, PeriodStatus[]>();
    for (const r of filtered) {
      const key = `${r.fiscal_year}-${String(r.period_month).padStart(2,'0')}`;
      const arr = byPeriod.get(key) ?? [];
      arr.push(r);
      byPeriod.set(key, arr);
    }
    return Array.from(byPeriod.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  async function generateNotifications() {
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc('generate_tax_notifications');
      if (error) throw error;
      await refresh();
    } catch (err) {
      alert('Failed to refresh notifications: ' + (err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5" /> Tax Calendar
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 hidden md:inline">
            Filter: {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
          </span>
          <button
            onClick={() => void generateNotifications()}
            disabled={refreshing}
            title="Push overdue / due-soon / missing-faktur into the Dashboard notification stream"
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Sync notifications
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Periods are created automatically whenever a Sales Invoice, Purchase Invoice, or Expense with tax is
        recorded. Companion PPh21/22/23/4(2)/Unifikasi periods are added automatically alongside each PPN
        period. No manual seeding required.
      </p>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : grouped.length === 0 ? (
        <div className="text-sm text-gray-600 p-4 border rounded bg-yellow-50">
          No tax periods yet. Create a Sales Invoice, Purchase Invoice or Expense with a tax amount — the matching PPN period plus companion PPh periods will appear here automatically.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([periodKey, items]) => (
            <div key={periodKey} className="border rounded overflow-hidden">
              <div className="bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 flex items-center justify-between">
                <span>Period {periodKey}</span>
                <span className="text-gray-500">{items.length} tax type(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-left px-3 py-2">Payment Due</th>
                      <th className="text-left px-3 py-2">Filing Due</th>
                      <th className="text-right px-3 py-2">Faktur Missing</th>
                      <th className="text-right px-3 py-2">Reconciled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(r => {
                      const chip = statusChip(r);
                      const amount = r.tax_type === 'PPN' ? (r.net_ppn ?? 0) : (r.pph_total ?? 0);
                      return (
                        <tr key={r.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{r.tax_type}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${chip.color}`}>
                              {chip.icon}{chip.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">Rp {Number(amount ?? 0).toLocaleString('id-ID')}</td>
                          <td className="px-3 py-2">{r.payment_due_date ? formatDate(r.payment_due_date) : '—'}</td>
                          <td className="px-3 py-2">{r.filing_due_date ? formatDate(r.filing_due_date) : '—'}</td>
                          <td className="px-3 py-2 text-right">
                            {r.missing_faktur_count > 0
                              ? <span className="text-yellow-700 font-medium">{r.missing_faktur_count}</span>
                              : <span className="text-gray-400">0</span>}
                          </td>
                          <td className="px-3 py-2 text-right">{r.reconciled_payments_count}/{r.reconciled_payments_count + r.unreconciled_payments_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
