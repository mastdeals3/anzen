import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

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
      .limit(36);
    if (!error && data) setRows(data as Row[]);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

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
      <h3 className="text-lg font-semibold">PPN Periods — Input / Output / Net / Carry Forward</h3>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No PPN periods yet. Seed them from the Tax Calendar tab.</p>
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
              {rows.map(r => (
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
