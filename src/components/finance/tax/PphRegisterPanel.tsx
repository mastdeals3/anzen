import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { StatCard, StatCardGrid, SectionCard, StatusChip, EmptyState } from './TaxUI';

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
  // Derived by the engine (vw_pph_by_period_type), shared with Calendar / Period Close.
  payment_status: string | null;
  payment_source: string | null;
}

interface SourceLine {
  module: 'journal';
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

  const codes = row.tax_type === 'PPh_Unifikasi'
    ? ['2131', '1155', '2132', '2138']
    : [({ PPh21: '2131', PPh22: '1155', PPh23: '2132', 'PPh4(2)': '2138' } as Record<string, string>)[row.tax_type]];
  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select('id, debit, credit, description, chart_of_accounts!inner(code), suppliers(company_name), journal_entries!inner(entry_date, entry_number, reference_number, source_module, is_posted, is_reversed)')
    .in('chart_of_accounts.code', codes.filter(Boolean))
    .eq('journal_entries.is_posted', true)
    .eq('journal_entries.is_reversed', false)
    .gte('journal_entries.entry_date', startDate)
    .lte('journal_entries.entry_date', endDate);
  if (error) throw error;
  return (data || []).flatMap((line: any) => {
    const journal = Array.isArray(line.journal_entries) ? line.journal_entries[0] : line.journal_entries;
    const account = Array.isArray(line.chart_of_accounts) ? line.chart_of_accounts[0] : line.chart_of_accounts;
    const supplier = Array.isArray(line.suppliers) ? line.suppliers[0] : line.suppliers;
    const amount = account.code === '1155' ? Number(line.debit || 0) : Number(line.credit || 0);
    if (amount <= 0) return [];
    return [{
      module: 'journal' as const,
      id: line.id,
      doc_number: journal.reference_number || journal.entry_number,
      doc_date: journal.entry_date,
      party: supplier?.company_name || '—',
      description: line.description,
      pph_code: account.code,
      pph_amount: amount,
      payment_method: null,
      recon_status: journal.source_module,
    }];
  }).sort((a, b) => a.doc_date.localeCompare(b.doc_date));
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

  const totals = useMemo(() => filtered.reduce(
    (a, r) => ({
      total: a.total + Number(r.pph_total || 0),
      paid: a.paid + Number(r.pph_paid_total || 0),
      outstanding: a.outstanding + Number(r.pph_outstanding || 0),
    }),
    { total: 0, paid: 0, outstanding: 0 },
  ), [filtered]);

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
      <div>
        <h3 className="text-lg font-semibold text-gray-900">PPh Register</h3>
        <p className="text-xs text-gray-500">Withholding tax (PPh) by period and type. Click a period row to see the source documents.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActive(t)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${active === t ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
          >
            {pphTabLabel(t)}
          </button>
        ))}
      </div>

      {!loading && filtered.length > 0 && (
        <StatCardGrid cols={3}>
          <StatCard label={`Total ${active} Withheld`} value={totals.total} tone="orange" hint="Across periods in range" />
          <StatCard label="Paid to Tax Office" value={totals.paid} tone="green" />
          <StatCard label="Outstanding" value={totals.outstanding} tone="red" hint="Not yet remitted" />
        </StatCardGrid>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={`No ${active} periods in the selected date range`}
            hint="PPh periods are created automatically once expenses, vouchers, or imports with PPh are posted. Try widening the date range."
          />
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
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
                        <StatusChip status={r.payment_status ?? r.status} />
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
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">
                                        Journal
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
        </SectionCard>
      )}
    </div>
  );
}
