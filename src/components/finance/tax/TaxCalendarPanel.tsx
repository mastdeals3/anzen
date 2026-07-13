import { useEffect, useState } from 'react';
import { Calendar, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatDate } from '../../../utils/dateFormat';

type TaxType = 'PPN' | 'PPh21' | 'PPh22' | 'PPh23' | 'PPh4(2)' | 'PPh_Unifikasi';

const TAX_TYPES: TaxType[] = ['PPN','PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'];

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
  if (period.status === 'closed')     return { color: 'bg-green-100 text-green-800', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Closed' };
  if (period.status === 'paid')       return { color: 'bg-green-50 text-green-700', icon: <CheckCircle2 className="w-3 h-3" />, label: 'Paid' };
  if (overdue)                        return { color: 'bg-red-100 text-red-800',   icon: <AlertCircle className="w-3 h-3" />, label: 'Overdue' };
  if (period.status === 'payment_pending') return { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-3 h-3" />, label: 'Payment pending' };
  return { color: 'bg-gray-100 text-gray-700', icon: <Clock className="w-3 h-3" />, label: 'Open' };
}

export function TaxCalendarPanel() {
  const [rows, setRows] = useState<PeriodStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<TaxType | null>(null);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from('vw_tax_period_status')
      .select('*')
      .order('fiscal_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(72);
    if (!error && data) setRows(data as PeriodStatus[]);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  async function seedNext12(taxType: TaxType) {
    setBusyType(taxType);
    try {
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const { error } = await supabase.rpc('upsert_tax_period', {
          p_fiscal_year: d.getFullYear(),
          p_period_month: d.getMonth() + 1,
          p_tax_type: taxType,
        });
        if (error) throw error;
      }
      await refresh();
    } catch (err) {
      alert('Failed to seed periods: ' + (err as Error).message);
    } finally {
      setBusyType(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5" /> Tax Calendar
        </h3>
        <div className="flex flex-wrap gap-2">
          {TAX_TYPES.map(t => (
            <button
              key={t}
              onClick={() => void seedNext12(t)}
              disabled={busyType !== null}
              className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
              title={`Seed the last 12 ${t} periods (idempotent)`}
            >
              {busyType === t ? 'Seeding…' : `Seed ${t}`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-600 p-4 border rounded bg-yellow-50">
          No tax periods yet. Click a "Seed …" button above to create the last 12 months for a tax type.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
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
              {rows.map(r => {
                const chip = statusChip(r);
                const amount = r.tax_type === 'PPN' ? (r.net_ppn ?? 0) : (r.pph_total ?? 0);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.fiscal_year}-{String(r.period_month).padStart(2,'0')}</td>
                    <td className="px-3 py-2">{r.tax_type}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${chip.color}`}>
                        {chip.icon}{chip.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">Rp {Number(amount ?? 0).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2">{r.payment_due_date ? formatDate(r.payment_due_date) : '—'}</td>
                    <td className="px-3 py-2">{r.filing_due_date ? formatDate(r.filing_due_date) : '—'}</td>
                    <td className="px-3 py-2 text-right">{r.missing_faktur_count}</td>
                    <td className="px-3 py-2 text-right">{r.reconciled_payments_count}/{r.reconciled_payments_count + r.unreconciled_payments_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
