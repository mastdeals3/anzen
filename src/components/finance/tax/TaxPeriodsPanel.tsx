import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';

interface Row {
  tax_period_id: string;
  fiscal_year: number;
  period_month: number;
  status: string;
  filing_status: string;
  input_ppn_total: number;
  output_ppn_total: number;
  carry_forward_in: number;
  net_ppn_payable: number;
  carry_forward_out: number;
  payment_due_date: string | null;
  filing_due_date: string | null;
}

export function TaxPeriodsPanel() {
  const { dateRange } = useFinance();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const { data, error } = await supabase
      .from('vw_ppn_net_by_period')
      .select('*')
      .order('fiscal_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(120);
    if (!error && data) setRows(data as Row[]);
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

  async function recompute(id: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('compute_period_ppn', { p_period_id: id });
      if (error) throw error;
      await refresh();
    } catch (err) {
      alert('Recompute failed: ' + (err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">PPN Periods — Input / Output / Net / Carry Forward</h3>
        <span className="text-xs text-gray-500 hidden md:inline">
          {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
        </span>
      </div>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 p-4 border rounded bg-yellow-50">
          No PPN periods in the selected date range. Periods are created automatically when a Sales Invoice, Purchase Invoice, or Expense with PPN is posted.
        </p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Input PPN</th>
                <th className="text-right px-3 py-2">Output PPN</th>
                <th className="text-right px-3 py-2">Carry Fwd In</th>
                <th className="text-right px-3 py-2">Net Payable</th>
                <th className="text-right px-3 py-2">Carry Fwd Out</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.tax_period_id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.fiscal_year}-{String(r.period_month).padStart(2,'0')}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-right">{Number(r.input_ppn_total).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right">{Number(r.output_ppn_total).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right">{Number(r.carry_forward_in).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right font-semibold">Rp {Number(r.net_ppn_payable).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right">{Number(r.carry_forward_out).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => void recompute(r.tax_period_id)}
                      disabled={busyId === r.tax_period_id || r.status === 'closed'}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${busyId === r.tax_period_id ? 'animate-spin' : ''}`} />
                      Recompute
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
