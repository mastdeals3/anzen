import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { StatCard, StatCardGrid, SectionCard, StatusChip, EmptyState } from './TaxUI';

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

interface InputLine {
  source: 'journal';
  doc_number: string;
  doc_date: string;
  party: string;
  description: string | null;
  ppn_amount: number;
  tax_period_id: string;
  id: string;
}

interface OutputLine {
  source: 'journal';
  doc_number: string;
  doc_date: string;
  customer: string;
  ppn_amount: number;
  faktur_number: string | null;
  id: string;
}

function fmt(n: number) { return Number(n).toLocaleString('id-ID'); }
function fmtDate(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Period detail uses the same journal-native report views as the period totals.
// Source documents provide labels and Faktur metadata only; their stored tax
// amounts are not independently summed here.
async function loadDetail(row: Row): Promise<{ input: InputLine[]; output: OutputLine[] }> {
  const startDate = `${row.fiscal_year}-${String(row.period_month).padStart(2, '0')}-01`;
  const lastDay = new Date(row.fiscal_year, row.period_month, 0).getDate();
  const endDate = `${row.fiscal_year}-${String(row.period_month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const [inputRes, outputRes] = await Promise.all([
    supabase.from('vw_input_ppn_report').select('*').gte('expense_date', startDate).lte('expense_date', endDate),
    supabase.from('vw_output_ppn_report').select('*').gte('invoice_date', startDate).lte('invoice_date', endDate),
  ]);
  const invoiceNumbers = (outputRes.data || []).map((item: any) => item.invoice_number).filter(Boolean);
  const fakturByInvoice = new Map<string, string | null>();
  if (invoiceNumbers.length) {
    const { data } = await supabase.from('sales_invoices').select('invoice_number, faktur_pajak_number').in('invoice_number', invoiceNumbers);
    (data || []).forEach(item => fakturByInvoice.set(item.invoice_number, item.faktur_pajak_number));
  }
  const input: InputLine[] = (inputRes.data || []).map((item: any) => ({
    source: 'journal', id: item.reference, doc_number: item.reference,
    doc_date: item.expense_date, party: item.supplier, description: item.description,
    ppn_amount: Number(item.ppn_amount), tax_period_id: row.tax_period_id,
  }));
  const output: OutputLine[] = (outputRes.data || []).map((item: any) => ({
    source: 'journal', id: item.invoice_number, doc_number: item.invoice_number,
    doc_date: item.invoice_date, customer: item.customer,
    ppn_amount: Number(item.ppn_amount),
    faktur_number: fakturByInvoice.get(item.invoice_number) ?? null,
  }));
  return { input, output };
}

export function TaxPeriodsPanel() {
  const { dateRange } = useFinance();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ input: InputLine[]; output: OutputLine[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const totals = useMemo(() => filtered.reduce(
    (a, r) => ({
      input: a.input + Number(r.input_ppn_total || 0),
      output: a.output + Number(r.output_ppn_total || 0),
      net: a.net + Number(r.net_ppn_payable || 0),
      cfOut: a.cfOut + Number(r.carry_forward_out || 0),
    }),
    { input: 0, output: 0, net: 0, cfOut: 0 },
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
      const d = await loadDetail(row);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">PPN Periods</h3>
          <p className="text-xs text-gray-500">Input / Output / Net PPN and carry-forward per period. Click a row to see source documents.</p>
        </div>
        <span className="text-xs text-gray-500 hidden md:inline">
          {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
        </span>
      </div>

      {!loading && filtered.length > 0 && (
        <StatCardGrid cols={4}>
          <StatCard label="Input PPN (Masukan)" value={totals.input} tone="red" icon={<TrendingDown className="w-4 h-4" />} hint="Tax credit on purchases/imports" />
          <StatCard label="Output PPN (Keluaran)" value={totals.output} tone="green" icon={<TrendingUp className="w-4 h-4" />} hint="Collected on sales, net of credit notes" />
          <StatCard label="Net PPN Payable" value={totals.net} tone="blue" icon={<Wallet className="w-4 h-4" />} hint="Across periods in range" />
          <StatCard label="Carry Forward Out" value={totals.cfOut} tone="gray" hint="Excess input carried to next period" />
        </StatCardGrid>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="No PPN periods in the selected date range"
            hint="Periods are created automatically when a Sales Invoice, Purchase Invoice, or Expense with PPN is posted. Try widening the date range."
          />
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 w-6"></th>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Input PPN</th>
                <th className="text-right px-3 py-2">Output PPN</th>
                <th className="text-right px-3 py-2">Carry Fwd In</th>
                <th className="text-right px-3 py-2">Net Payable</th>
                <th className="text-right px-3 py-2">Carry Fwd Out</th>
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
                      <td className="px-3 py-2 text-gray-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-3 py-2 font-medium">{r.fiscal_year}-{String(r.period_month).padStart(2,'0')}</td>
                      <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                      <td className="px-3 py-2 text-right text-red-700">{fmt(r.input_ppn_total)}</td>
                      <td className="px-3 py-2 text-right text-green-700">{fmt(r.output_ppn_total)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.carry_forward_in)}</td>
                      <td className="px-3 py-2 text-right font-semibold">Rp {fmt(r.net_ppn_payable)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.carry_forward_out)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.tax_period_id}-detail`} className="bg-blue-50/40">
                        <td colSpan={8} className="px-4 pb-4 pt-1">
                          {detailLoading ? (
                            <p className="text-xs text-gray-500 py-2">Loading source documents…</p>
                          ) : detail ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {/* Input PPN */}
                              <div>
                                <h4 className="text-xs font-semibold text-red-700 mb-1 uppercase tracking-wide">
                                  Input PPN — {detail.input.length} documents
                                </h4>
                                {detail.input.length === 0 ? (
                                  <p className="text-xs text-gray-400">No input PPN documents this period.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-500 border-b">
                                        <th className="text-left py-1">Doc</th>
                                        <th className="text-left py-1">Date</th>
                                        <th className="text-left py-1">Supplier</th>
                                        <th className="text-right py-1">PPN</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.input.map(l => (
                                        <tr key={l.id} className="border-b border-gray-100">
                                          <td className="py-1 pr-2 font-mono">
                                            <span className="text-[10px] text-gray-400 mr-1">JE</span>
                                            {l.doc_number}
                                          </td>
                                          <td className="py-1 pr-2 whitespace-nowrap">{fmtDate(l.doc_date)}</td>
                                          <td className="py-1 pr-2 text-gray-600 max-w-[140px] truncate" title={l.party}>{l.party}</td>
                                          <td className="py-1 text-right text-red-700 font-mono">{fmt(l.ppn_amount)}</td>
                                        </tr>
                                      ))}
                                      <tr className="font-semibold">
                                        <td colSpan={3} className="py-1 text-right text-xs text-gray-500">Total Input PPN</td>
                                        <td className="py-1 text-right text-red-700 font-mono">
                                          {fmt(detail.input.reduce((s, l) => s + l.ppn_amount, 0))}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                              </div>
                              {/* Output PPN */}
                              <div>
                                <h4 className="text-xs font-semibold text-green-700 mb-1 uppercase tracking-wide">
                                  Output PPN — {detail.output.length} documents
                                </h4>
                                {detail.output.length === 0 ? (
                                  <p className="text-xs text-gray-400">No output PPN documents this period.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-500 border-b">
                                        <th className="text-left py-1">Invoice</th>
                                        <th className="text-left py-1">Date</th>
                                        <th className="text-left py-1">Customer</th>
                                        <th className="text-left py-1">Faktur</th>
                                        <th className="text-right py-1">PPN</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.output.map(l => (
                                        <tr key={l.id} className="border-b border-gray-100">
                                          <td className="py-1 pr-2 font-mono">
                                            <span className="text-[10px] text-gray-400 mr-1">JE</span>
                                            {l.doc_number}
                                          </td>
                                          <td className="py-1 pr-2 whitespace-nowrap">{fmtDate(l.doc_date)}</td>
                                          <td className="py-1 pr-2 text-gray-600 max-w-[120px] truncate" title={l.customer}>{l.customer}</td>
                                          <td className="py-1 pr-2">
                                            {l.faktur_number
                                              ? <span className="text-green-700 font-mono">{l.faktur_number}</span>
                                              : <span className="text-orange-500 text-[10px]">Missing</span>}
                                          </td>
                                          <td className={`py-1 text-right font-mono ${l.ppn_amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(l.ppn_amount)}</td>
                                        </tr>
                                      ))}
                                      <tr className="font-semibold">
                                        <td colSpan={4} className="py-1 text-right text-xs text-gray-500">Total Output PPN</td>
                                        <td className="py-1 text-right text-green-700 font-mono">
                                          {fmt(detail.output.reduce((s, l) => s + l.ppn_amount, 0))}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
                          ) : null}
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
