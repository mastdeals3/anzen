import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';

type PphType = 'PPh21' | 'PPh22' | 'PPh23' | 'PPh4(2)' | 'PPh_Unifikasi';

const TABS: PphType[] = ['PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'];

function pphTabLabel(t: PphType): string {
  if (t === 'PPh21') return 'PPh21 (Manual)';
  if (t === 'PPh_Unifikasi') return 'All Types (Consolidated)';
  return t;
}

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

interface SourceLine {
  module: 'expense' | 'payment_voucher' | 'import';
  id: string;
  doc_number: string;
  doc_date: string;
  party: string;
  description: string | null;
  pph_code: string | null;
  pph_amount: number;
  payment_method: string | null;
  recon_status: string | null;
}

function fmt(n: number) {
  return Number(n).toLocaleString('id-ID');
}
function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadPphDetail(row: Row): Promise<SourceLine[]> {
  const yr = row.fiscal_year;
  const mo = row.period_month;
  const startDate = `${yr}-${String(mo).padStart(2,'0')}-01`;
  // Last day of the calendar month. new Date(yr, mo, 0) is correct locally
  // (mo is 1-indexed here; day 0 rolls back to the previous month's last
  // day), but toISOString() converts to UTC and drops a day in +XX
  // timezones, so we construct the string directly to stay TZ-safe.
  const lastDay = new Date(yr, mo, 0).getDate();
  const endDate = `${yr}-${String(mo).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const [feRes, pvRes, importRes] = await Promise.all([
    supabase
      .from('finance_expenses')
      .select('id, voucher_number, expense_date, pph_amount, description, payment_method, expense_category, pph_code:pph_code_id(code, tax_type), suppliers:supplier_id(company_name), staff:paid_by_staff_id(full_name)')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .gt('pph_amount', 0),
    supabase
      .from('payment_vouchers')
      .select('id, voucher_number, voucher_date, pph_amount, description, pph_code:pph_code_id(code, tax_type), suppliers:supplier_id(company_name)')
      .gte('voucher_date', startDate)
      .lte('voucher_date', endDate)
      .gt('pph_amount', 0),
    // Import PPh 22: pib_import (pib_pph_amount) + pph_import (whole amount).
    // Mirrors compute_period_ppn's import branch. Always PPh22.
    supabase
      .from('finance_expenses')
      .select('id, voucher_number, expense_date, amount, pib_pph_amount, description, expense_category, suppliers:supplier_id(company_name)')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .in('expense_category', ['pib_import', 'pph_import']),
  ]);

  const pphType = row.tax_type;

  const expenses: SourceLine[] = ((feRes.data ?? []) as any[])
    .filter(r => {
      // Import categories are handled by the import branch below; exclude here
      // to avoid double-counting (matches the engine's NOT IN import guard).
      if (r.expense_category === 'pib_import' || r.expense_category === 'pph_import') return false;
      const codeType = r.pph_code?.tax_type ?? null;
      return pphType === 'PPh_Unifikasi' || codeType === pphType;
    })
    .map(r => ({
      module: 'expense' as const,
      id: r.id,
      doc_number: r.voucher_number ?? '—',
      doc_date: r.expense_date,
      party: r.suppliers?.company_name ?? r.staff?.full_name ?? '—',
      description: r.description,
      pph_code: r.pph_code?.code ?? null,
      pph_amount: Number(r.pph_amount),
      payment_method: r.payment_method,
      recon_status: null,
    }));

  const vouchers: SourceLine[] = ((pvRes.data ?? []) as any[])
    .filter(r => {
      const codeType = r.pph_code?.tax_type ?? null;
      return pphType === 'PPh_Unifikasi' || codeType === pphType;
    })
    .map(r => ({
      module: 'payment_voucher' as const,
      id: r.id,
      doc_number: r.voucher_number ?? '—',
      doc_date: r.voucher_date,
      party: r.suppliers?.company_name ?? '—',
      description: r.description,
      pph_code: r.pph_code?.code ?? null,
      pph_amount: Number(r.pph_amount),
      payment_method: null,
      recon_status: null,
    }));

  // Import PPh 22 — only relevant to the PPh22 and consolidated tabs.
  const imports: SourceLine[] = (pphType === 'PPh22' || pphType === 'PPh_Unifikasi')
    ? ((importRes.data ?? []) as any[])
        .map(r => {
          const amt = r.expense_category === 'pib_import'
            ? Number(r.pib_pph_amount ?? 0)
            : Number(r.amount ?? 0);
          return { r, amt };
        })
        .filter(({ amt }) => amt > 0)
        .map(({ r, amt }) => ({
          module: 'import' as const,
          id: `${r.id}-imp`,
          doc_number: r.voucher_number ?? '—',
          doc_date: r.expense_date,
          party: r.suppliers?.company_name ?? '—',
          description: r.description,
          pph_code: 'PPh22 Import',
          pph_amount: amt,
          payment_method: null,
          recon_status: null,
        }))
    : [];

  return [...expenses, ...vouchers, ...imports].sort((a, b) => a.doc_date.localeCompare(b.doc_date));
}

export function PphRegisterPanel() {
  const { dateRange } = useFinance();
  const [active, setActive] = useState<PphType>('PPh21');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceLine[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setExpandedId(null);
    setDetail(null);
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

  async function toggleExpand(row: Row) {
    if (expandedId === row.tax_period_id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(row.tax_period_id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const lines = await loadPphDetail(row);
      setDetail(lines);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`px-3 py-1 text-sm rounded border ${active === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'}`}
          >
            {pphTabLabel(t)}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">Click a period row to see the source documents.</p>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 p-4 border rounded bg-yellow-50">
          No {active} periods in the selected date range. Periods are created automatically once expenses with PPh are posted.
        </p>
      ) : (
        <div className="border rounded overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-6 px-2 py-2"></th>
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
              {filtered.map(r => {
                const isOpen = expandedId === r.tax_period_id;
                return (
                  <>
                    <tr
                      key={r.tax_period_id}
                      className={`border-t cursor-pointer select-none ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      onClick={() => void toggleExpand(r)}
                    >
                      <td className="px-2 py-2 text-gray-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-3 py-2 font-medium">{r.fiscal_year}-{String(r.period_month).padStart(2,'0')}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          r.status === 'closed'   ? 'bg-gray-200 text-gray-700' :
                          r.status === 'open'     ? 'bg-blue-100 text-blue-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{fmt(r.pph_total)}</td>
                      <td className="px-3 py-2 text-right text-green-700">{fmt(r.pph_paid_total)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-orange-700">
                        Rp {fmt(r.pph_outstanding)}
                      </td>
                      <td className="px-3 py-2">{r.payment_due_date ?? '—'}</td>
                      <td className="px-3 py-2">{r.filing_due_date ?? '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.tax_period_id}-detail`} className="bg-blue-50/30">
                        <td colSpan={8} className="px-6 pb-4 pt-2">
                          <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                            Source Documents — {active} withheld in {r.fiscal_year}-{String(r.period_month).padStart(2,'0')}
                          </h4>
                          {detailLoading ? (
                            <p className="text-xs text-gray-500">Loading source documents…</p>
                          ) : !detail || detail.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">No source documents found for this period and PPh type.</p>
                          ) : (
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="text-gray-500 border-b">
                                  <th className="text-left py-1 pr-3">Module</th>
                                  <th className="text-left py-1 pr-3">Document</th>
                                  <th className="text-left py-1 pr-3">Date</th>
                                  <th className="text-left py-1 pr-3">Supplier / Staff</th>
                                  <th className="text-left py-1 pr-3">Description</th>
                                  <th className="text-left py-1 pr-3">PPh Code</th>
                                  <th className="text-right py-1">PPh Withheld</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map(l => (
                                  <tr key={l.id} className="border-b border-gray-100 hover:bg-white">
                                    <td className="py-1.5 pr-3">
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                        l.module === 'expense' ? 'bg-orange-100 text-orange-700'
                                          : l.module === 'import' ? 'bg-blue-100 text-blue-700'
                                          : 'bg-purple-100 text-purple-700'
                                      }`}>
                                        {l.module === 'expense' ? 'Expense'
                                          : l.module === 'import' ? 'Import PPh22'
                                          : 'Payment Voucher'}
                                      </span>
                                    </td>
                                    <td className="py-1.5 pr-3 font-mono font-semibold">{l.doc_number}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(l.doc_date)}</td>
                                    <td className="py-1.5 pr-3 max-w-[140px] truncate text-gray-700" title={l.party}>{l.party}</td>
                                    <td className="py-1.5 pr-3 max-w-[180px] truncate text-gray-500" title={l.description ?? undefined}>{l.description ?? '—'}</td>
                                    <td className="py-1.5 pr-3">
                                      {l.pph_code
                                        ? <span className="font-mono text-blue-700">{l.pph_code}</span>
                                        : <span className="text-orange-500 italic">⚠ No code</span>}
                                    </td>
                                    <td className="py-1.5 text-right font-mono font-semibold text-orange-700">
                                      Rp {fmt(l.pph_amount)}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="font-semibold border-t-2 border-gray-300 bg-gray-50">
                                  <td colSpan={6} className="py-1.5 pr-3 text-right text-xs text-gray-500">Total {active} Withheld</td>
                                  <td className="py-1.5 text-right font-mono text-orange-700">
                                    Rp {fmt(detail.reduce((s, l) => s + l.pph_amount, 0))}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
