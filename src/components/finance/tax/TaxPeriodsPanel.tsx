import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, TrendingUp, TrendingDown, Wallet, Search, FileWarning, CheckCircle2, ArrowRightCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { StatCard, StatCardGrid, SectionCard, StatusChip, EmptyState } from './TaxUI';

// ============================================================================
// PPN Summary & Register
// ----------------------------------------------------------------------------
// One screen that is BOTH the monthly PPN summary dashboard AND the
// accountant-style transaction register (the Excel the accountant keeps,
// modernized). Per period it answers: how much Output PPN was collected,
// how much Input PPN is claimable, which documents created those amounts,
// what must be paid, and why any excess input is carried forward.
//
// Attribution mirrors compute_period_ppn EXACTLY (by tax_period_id, the same
// key the engine uses) so the register lines always sum to the engine's
// input_ppn_total / output_ppn_total:
//   Input  = purchase_invoices.tax_amount
//          + finance_expenses.ppn_amount   (rows WITHOUT broker-line PPN)
//          + broker_items[].ppn_amount
//          + finance_expenses.pib_ppn_amount
//   Output = sales_invoices.tax_amount − approved credit_notes.tax_amount
// ============================================================================

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

type FakturState = 'missing' | 'generated' | 'uploaded' | 'reported' | 'recorded' | 'na';

interface RegisterLine {
  key: string;
  periodId: string;
  kind: 'output' | 'input';
  source: 'sales_invoice' | 'credit_note' | 'purchase_invoice' | 'expense' | 'broker' | 'pib';
  doc_number: string;
  doc_date: string;
  party: string;
  product: string | null;
  faktur_number: string | null;
  faktur_date: string | null;
  dpp: number | null;
  ppn: number; // signed — credit notes are negative output
  faktur_status: FakturState;
  remarks: string | null;
}

type TypeFilter = 'all' | 'output' | 'input';
type StatusFilter = 'all' | 'missing' | 'generated' | 'reported' | 'unreported';

function fmt(n: number) { return Number(n).toLocaleString('id-ID'); }
function fmtDate(s: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function periodLabel(r: Row) {
  return new Date(r.fiscal_year, r.period_month - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const SOURCE_TAG: Record<RegisterLine['source'], string> = {
  sales_invoice: 'SI',
  credit_note: 'CN',
  purchase_invoice: 'PI',
  expense: 'EXP',
  broker: 'BRK',
  pib: 'PIB',
};

// ── Batched register load for a set of periods ──────────────────────────────
async function loadRegister(periodIds: string[]): Promise<RegisterLine[]> {
  if (periodIds.length === 0) return [];

  const [piRes, feRes, siRes, cnRes] = await Promise.all([
    supabase
      .from('purchase_invoices')
      .select('id, invoice_number, invoice_date, subtotal, tax_amount, faktur_pajak_number, tax_period_id, suppliers:supplier_id(company_name)')
      .in('tax_period_id', periodIds)
      .gt('tax_amount', 0),
    supabase
      .from('finance_expenses')
      .select('id, voucher_number, expense_date, amount, ppn_amount, pib_ppn_amount, broker_items, description, tax_period_id, suppliers:supplier_id(company_name)')
      .in('tax_period_id', periodIds),
    supabase
      .from('sales_invoices')
      .select('id, invoice_number, invoice_date, total_amount, tax_amount, faktur_pajak_number, tax_period_id, customers:customer_id(company_name)')
      .in('tax_period_id', periodIds)
      .gt('tax_amount', 0),
    supabase
      .from('credit_notes')
      .select('id, credit_note_number, credit_note_date, tax_amount, tax_period_id, customers:customer_id(company_name)')
      .in('tax_period_id', periodIds)
      .eq('status', 'approved')
      .gt('tax_amount', 0),
  ]);
  for (const [name, res] of [['purchase_invoices', piRes], ['finance_expenses', feRes], ['sales_invoices', siRes], ['credit_notes', cnRes]] as const) {
    if (res.error) console.error(`PPN register: ${name} query failed`, res.error);
  }

  const sis = (siRes.data ?? []) as any[];
  const pis = (piRes.data ?? []) as any[];

  // Faktur workflow status + product names for the sales invoices.
  const siIds = sis.map(r => r.id);
  const piIds = pis.map(r => r.id);
  const [fakRes, siItemsRes, piItemsRes] = await Promise.all([
    siIds.length
      ? supabase.from('faktur_pajak').select('sales_invoice_id, faktur_number, issue_date, status').in('sales_invoice_id', siIds)
      : Promise.resolve({ data: [], error: null } as any),
    siIds.length
      ? supabase.from('sales_invoice_items').select('invoice_id, products(product_name)').in('invoice_id', siIds)
      : Promise.resolve({ data: [], error: null } as any),
    piIds.length
      ? supabase.from('purchase_invoice_items').select('purchase_invoice_id, description, products(product_name)').in('purchase_invoice_id', piIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const fakBySi = new Map<string, any>();
  for (const f of ((fakRes.data ?? []) as any[])) fakBySi.set(f.sales_invoice_id, f);

  const productNames = (rows: any[], idKey: string) => {
    const map = new Map<string, string[]>();
    for (const it of rows) {
      const name = it.products?.product_name ?? it.description ?? null;
      if (!name) continue;
      const list = map.get(it[idKey]) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(it[idKey], list);
    }
    return map;
  };
  const siProducts = productNames((siItemsRes.data ?? []) as any[], 'invoice_id');
  const piProducts = productNames((piItemsRes.data ?? []) as any[], 'purchase_invoice_id');

  const lines: RegisterLine[] = [];

  // ── Output: sales invoices ──
  for (const r of sis) {
    const fak = fakBySi.get(r.id);
    const fakturNumber = r.faktur_pajak_number || fak?.faktur_number || null;
    const status: FakturState = fak?.status ?? (fakturNumber ? 'generated' : 'missing');
    lines.push({
      key: `si-${r.id}`,
      periodId: r.tax_period_id,
      kind: 'output',
      source: 'sales_invoice',
      doc_number: r.invoice_number ?? '—',
      doc_date: r.invoice_date,
      party: r.customers?.company_name ?? '—',
      product: siProducts.get(r.id)?.join(', ') ?? null,
      faktur_number: fakturNumber,
      faktur_date: fak?.issue_date ?? null,
      dpp: Math.max(Number(r.total_amount ?? 0) - Number(r.tax_amount ?? 0), 0),
      ppn: Number(r.tax_amount),
      faktur_status: status,
      remarks: status === 'missing' ? 'Faktur Pajak not yet generated' : null,
    });
  }

  // ── Output reversals: approved credit notes ──
  for (const r of ((cnRes.data ?? []) as any[])) {
    lines.push({
      key: `cn-${r.id}`,
      periodId: r.tax_period_id,
      kind: 'output',
      source: 'credit_note',
      doc_number: r.credit_note_number ?? '—',
      doc_date: r.credit_note_date,
      party: r.customers?.company_name ?? '—',
      product: null,
      faktur_number: null,
      faktur_date: null,
      dpp: null,
      ppn: -Number(r.tax_amount),
      faktur_status: 'na',
      remarks: 'Credit note — reduces Output PPN',
    });
  }

  // ── Input: purchase invoices ──
  for (const r of pis) {
    const hasFaktur = !!r.faktur_pajak_number;
    lines.push({
      key: `pi-${r.id}`,
      periodId: r.tax_period_id,
      kind: 'input',
      source: 'purchase_invoice',
      doc_number: r.invoice_number ?? '—',
      doc_date: r.invoice_date,
      party: r.suppliers?.company_name ?? '—',
      product: piProducts.get(r.id)?.join(', ') ?? null,
      faktur_number: r.faktur_pajak_number ?? null,
      faktur_date: null,
      dpp: Number(r.subtotal ?? 0) || null,
      ppn: Number(r.tax_amount),
      faktur_status: hasFaktur ? 'recorded' : 'missing',
      remarks: hasFaktur ? null : 'Supplier Faktur Pajak not recorded on the invoice',
    });
  }

  // ── Input: expenses (regular PPN, broker lines, import PIB PPN) ──
  // Broker-line PPN and PIB PPN are additive; the header ppn_amount counts
  // ONLY when no broker line carries PPN (the engine's NOT EXISTS guard).
  for (const r of ((feRes.data ?? []) as any[])) {
    const brokerItems: any[] = Array.isArray(r.broker_items) ? r.broker_items : [];
    const hasBrokerPpn = brokerItems.some(it => Number(it?.ppn_amount ?? 0) > 0);
    const supplier = r.suppliers?.company_name ?? '—';

    if (!hasBrokerPpn && Number(r.ppn_amount) > 0) {
      lines.push({
        key: `exp-${r.id}`,
        periodId: r.tax_period_id,
        kind: 'input',
        source: 'expense',
        doc_number: r.voucher_number ?? '—',
        doc_date: r.expense_date,
        party: supplier,
        product: r.description ?? null,
        faktur_number: null,
        faktur_date: null,
        dpp: Number(r.amount ?? 0) || null,
        ppn: Number(r.ppn_amount),
        faktur_status: 'na',
        remarks: 'PPN on expense voucher',
      });
    }

    brokerItems.forEach((it, idx) => {
      const amt = Number(it?.ppn_amount ?? 0);
      if (amt <= 0) return;
      lines.push({
        key: `brk-${r.id}-${idx}`,
        periodId: r.tax_period_id,
        kind: 'input',
        source: 'broker',
        doc_number: it?.invoice_number || r.voucher_number || '—',
        doc_date: it?.invoice_date || r.expense_date,
        party: supplier,
        product: it?.description ?? r.description ?? null,
        faktur_number: it?.tax_invoice_number ?? null,
        faktur_date: null,
        dpp: Number(it?.dpp_amount ?? it?.amount ?? 0) || null,
        ppn: amt,
        faktur_status: it?.tax_invoice_number ? 'recorded' : 'missing',
        remarks: 'Broker / forwarder invoice line',
      });
    });

    if (Number(r.pib_ppn_amount) > 0) {
      lines.push({
        key: `pib-${r.id}`,
        periodId: r.tax_period_id,
        kind: 'input',
        source: 'pib',
        doc_number: r.voucher_number ?? '—',
        doc_date: r.expense_date,
        party: supplier,
        product: r.description ?? null,
        faktur_number: null,
        faktur_date: null,
        dpp: null,
        ppn: Number(r.pib_ppn_amount),
        faktur_status: 'na',
        remarks: 'Import PPN paid via PIB customs document',
      });
    }
  }

  return lines.sort((a, b) => (a.doc_date ?? '').localeCompare(b.doc_date ?? ''));
}

function matchesStatus(line: RegisterLine, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all':        return true;
    case 'missing':    return line.faktur_status === 'missing';
    case 'generated':  return line.faktur_status === 'generated' || line.faktur_status === 'uploaded';
    case 'reported':   return line.faktur_status === 'reported';
    case 'unreported': return line.faktur_status === 'missing' || line.faktur_status === 'generated' || line.faktur_status === 'uploaded';
  }
}

export function TaxPeriodsPanel() {
  const { dateRange } = useFinance();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<RegisterLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

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

  // Periods inside the global date range (page-level Month / Date Range filter).
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

  // Eagerly load the register for every period in range (capped at the 24
  // most recent) so the summary cards and filters cover the whole range
  // without needing an expand-click per month.
  const registerPeriodIds = useMemo(
    () => filtered.slice(0, 24).map(r => r.tax_period_id),
    [filtered],
  );
  const registerKey = registerPeriodIds.join(',');
  useEffect(() => {
    let cancelled = false;
    if (registerPeriodIds.length === 0) { setLines([]); return; }
    setLinesLoading(true);
    void loadRegister(registerPeriodIds)
      .then(l => { if (!cancelled) setLines(l); })
      .finally(() => { if (!cancelled) setLinesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerKey]);

  // Auto-expand when the range holds exactly one period (the common
  // "show me this month" case).
  useEffect(() => {
    if (filtered.length === 1) setExpanded(new Set([filtered[0].tax_period_id]));
  }, [registerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchLc = search.trim().toLowerCase();
  const filtersActive = typeFilter !== 'all' || statusFilter !== 'all' || searchLc !== '';

  const visibleLines = useMemo(() => lines.filter(l => {
    if (typeFilter !== 'all' && l.kind !== typeFilter) return false;
    if (!matchesStatus(l, statusFilter)) return false;
    if (searchLc) {
      const hay = `${l.doc_number} ${l.faktur_number ?? ''} ${l.party} ${l.product ?? ''}`.toLowerCase();
      if (!hay.includes(searchLc)) return false;
    }
    return true;
  }), [lines, typeFilter, statusFilter, searchLc]);

  const linesByPeriod = useMemo(() => {
    const map = new Map<string, RegisterLine[]>();
    for (const l of visibleLines) {
      const list = map.get(l.periodId) ?? [];
      list.push(l);
      map.set(l.periodId, list);
    }
    return map;
  }, [visibleLines]);

  // When document filters are active, hide months with no matching lines so a
  // search like an invoice number lands directly on the right month.
  const visiblePeriods = useMemo(
    () => (filtersActive ? filtered.filter(r => (linesByPeriod.get(r.tax_period_id) ?? []).length > 0) : filtered),
    [filtered, filtersActive, linesByPeriod],
  );

  const totals = useMemo(() => filtered.reduce(
    (a, r) => ({
      input: a.input + Number(r.input_ppn_total || 0),
      output: a.output + Number(r.output_ppn_total || 0),
      net: a.net + Number(r.net_ppn_payable || 0),
      cfOut: a.cfOut + Number(r.carry_forward_out || 0),
    }),
    { input: 0, output: 0, net: 0, cfOut: 0 },
  ), [filtered]);

  const fakturCounts = useMemo(() => {
    let missing = 0, reported = 0;
    for (const l of lines) {
      if (l.source !== 'sales_invoice') continue;
      if (l.faktur_status === 'missing') missing++;
      if (l.faktur_status === 'reported') reported++;
    }
    return { missing, reported };
  }, [lines]);

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

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Register table for one expanded period ────────────────────────────────
  function renderRegister(r: Row) {
    const periodLines = linesByPeriod.get(r.tax_period_id) ?? [];
    const outputLines = periodLines.filter(l => l.kind === 'output');
    const inputLines  = periodLines.filter(l => l.kind === 'input');
    const outputSum = outputLines.reduce((s, l) => s + l.ppn, 0);
    const inputSum  = inputLines.reduce((s, l) => s + l.ppn, 0);

    // Register-vs-engine mismatch guard: only meaningful when no document
    // filters are hiding lines.
    const allPeriodLines = lines.filter(l => l.periodId === r.tax_period_id);
    const rawOut = allPeriodLines.filter(l => l.kind === 'output').reduce((s, l) => s + l.ppn, 0);
    const rawIn  = allPeriodLines.filter(l => l.kind === 'input').reduce((s, l) => s + l.ppn, 0);
    const mismatch = !linesLoading && (
      Math.abs(rawOut - Number(r.output_ppn_total || 0)) > 1 ||
      Math.abs(rawIn  - Number(r.input_ppn_total  || 0)) > 1
    );

    const cells = 'py-1.5 pr-3 align-top';
    const lineRow = (l: RegisterLine) => (
      <tr key={l.key} className="border-b border-gray-100 hover:bg-white">
        <td className={cells}>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${l.kind === 'output' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {l.kind === 'output' ? 'Output' : 'Input'}
          </span>
          <span className="ml-1 text-[10px] text-gray-400">{SOURCE_TAG[l.source]}</span>
        </td>
        <td className={`${cells} font-mono font-semibold whitespace-nowrap`}>{l.doc_number}</td>
        <td className={`${cells} whitespace-nowrap`}>{fmtDate(l.doc_date)}</td>
        <td className={`${cells} font-mono`}>
          {l.faktur_number
            ? <span className="text-blue-700">{l.faktur_number}</span>
            : l.faktur_status === 'missing'
              ? <span className="text-orange-600 font-sans text-[10px]">Missing</span>
              : <span className="text-gray-300">—</span>}
        </td>
        <td className={`${cells} whitespace-nowrap`}>{fmtDate(l.faktur_date)}</td>
        <td className={`${cells} max-w-[150px] truncate text-gray-700`} title={l.party}>{l.party}</td>
        <td className={`${cells} max-w-[180px] truncate text-gray-500`} title={l.product ?? undefined}>{l.product ?? '—'}</td>
        <td className={`${cells} text-right font-mono`}>{l.dpp != null ? fmt(l.dpp) : '—'}</td>
        <td className={`${cells} text-right font-mono ${l.ppn < 0 ? 'text-red-600' : 'text-green-700'}`}>
          {l.kind === 'output' ? fmt(l.ppn) : ''}
        </td>
        <td className={`${cells} text-right font-mono text-red-700`}>
          {l.kind === 'input' ? fmt(l.ppn) : ''}
        </td>
        <td className={cells}>
          {l.faktur_status === 'na'
            ? <span className="text-gray-300 text-[10px]">—</span>
            : <StatusChip status={l.faktur_status} />}
        </td>
        <td className={`${cells} text-gray-500 max-w-[200px]`}>{l.remarks ?? ''}</td>
      </tr>
    );

    const groupHeader = (label: string, count: number) => (
      <tr className="bg-gray-100/70">
        <td colSpan={12} className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          {label} — {count} {count === 1 ? 'line' : 'lines'}
        </td>
      </tr>
    );

    const subtotalRow = (label: string, value: number, tint: string) => (
      <tr className="font-semibold border-t border-gray-300 bg-gray-50">
        <td colSpan={8} className="py-1.5 pr-3 text-right text-xs text-gray-500">{label}</td>
        <td className={`py-1.5 pr-3 text-right font-mono ${tint === 'green' ? 'text-green-700' : ''}`}>{tint === 'green' ? fmt(value) : ''}</td>
        <td className={`py-1.5 pr-3 text-right font-mono ${tint === 'red' ? 'text-red-700' : ''}`}>{tint === 'red' ? fmt(value) : ''}</td>
        <td colSpan={2}></td>
      </tr>
    );

    const net = Number(r.net_ppn_payable || 0);
    const cfIn = Number(r.carry_forward_in || 0);
    const cfOut = Number(r.carry_forward_out || 0);
    const engineOut = Number(r.output_ppn_total || 0);
    const engineIn = Number(r.input_ppn_total || 0);

    return (
      <td colSpan={9} className="px-4 pb-4 pt-1">
        {linesLoading ? (
          <p className="text-xs text-gray-500 py-2">Loading register…</p>
        ) : (
          <div className="space-y-3">
            {mismatch && (
              <p className="text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                The documents listed below do not sum to this period's computed totals — the period may be stale. Use Recompute to refresh it.
              </p>
            )}
            {filtersActive && (
              <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                Document filters are active — this register view is filtered; subtotals below reflect only the visible lines.
              </p>
            )}

            {periodLines.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-1">
                {filtersActive ? 'No documents match the current filters in this period.' : 'No PPN documents in this period.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="text-left py-1 pr-3">Type</th>
                      <th className="text-left py-1 pr-3">Invoice #</th>
                      <th className="text-left py-1 pr-3">Invoice Date</th>
                      <th className="text-left py-1 pr-3">Faktur #</th>
                      <th className="text-left py-1 pr-3">Faktur Date</th>
                      <th className="text-left py-1 pr-3">Customer / Supplier</th>
                      <th className="text-left py-1 pr-3">Product / Description</th>
                      <th className="text-right py-1 pr-3">DPP</th>
                      <th className="text-right py-1 pr-3">Output PPN</th>
                      <th className="text-right py-1 pr-3">Input PPN</th>
                      <th className="text-left py-1 pr-3">Status</th>
                      <th className="text-left py-1">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outputLines.length > 0 && (
                      <>
                        {groupHeader('Output PPN — sales & credit notes', outputLines.length)}
                        {outputLines.map(lineRow)}
                        {subtotalRow('Total Output PPN', outputSum, 'green')}
                      </>
                    )}
                    {inputLines.length > 0 && (
                      <>
                        {groupHeader('Input PPN — purchases, imports & expenses', inputLines.length)}
                        {inputLines.map(lineRow)}
                        {subtotalRow('Total Input PPN claimed', inputSum, 'red')}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Monthly reconciliation — the "why am I paying this" box ── */}
            <div className="max-w-md rounded-lg border border-gray-200 bg-white p-3">
              <h5 className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
                PPN Reconciliation — {periodLabel(r)}
              </h5>
              <dl className="text-xs space-y-1">
                <div className="flex justify-between">
                  <dt className="text-gray-600">Output PPN collected</dt>
                  <dd className="font-mono text-green-700">Rp {fmt(engineOut)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-600">Less: Input PPN claimed</dt>
                  <dd className="font-mono text-red-700">(Rp {fmt(engineIn)})</dd>
                </div>
                {cfIn > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Less: Carry-forward from previous period</dt>
                    <dd className="font-mono text-red-700">(Rp {fmt(cfIn)})</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
                  {net > 0 ? (
                    <>
                      <dt className="text-gray-900">Net PPN payable</dt>
                      <dd className="font-mono text-blue-700">Rp {fmt(net)}</dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-gray-900">Excess Input PPN</dt>
                      <dd className="font-mono text-gray-900">Rp {fmt(cfOut)}</dd>
                    </>
                  )}
                </div>
                {cfOut > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600 flex items-center gap-1">
                      <ArrowRightCircle className="w-3 h-3" /> Carried forward to next period
                    </dt>
                    <dd className="font-mono text-gray-700">Rp {fmt(cfOut)}</dd>
                  </div>
                )}
              </dl>
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                {net > 0
                  ? <>Output PPN exceeded claimable Input PPN{cfIn > 0 ? ' (after applying the carry-forward from the previous period)' : ''}. Amount payable this period: <span className="font-semibold">Rp {fmt(net)}</span>.</>
                  : cfOut > 0
                    ? <>Input PPN{cfIn > 0 ? ' plus the carry-forward from the previous period' : ''} exceeded Output PPN by <span className="font-semibold">Rp {fmt(cfOut)}</span>. This amount has been carried forward to the next tax period, so nothing is payable now.</>
                    : <>Output and Input PPN are balanced — nothing is payable and nothing is carried forward this period.</>}
              </p>
            </div>
          </div>
        )}
      </td>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">PPN Summary & Register</h3>
          <p className="text-xs text-gray-500">
            Monthly PPN position with the full accountant register per period. Click a month to see every document behind the numbers.
          </p>
        </div>
        <span className="text-xs text-gray-500 hidden md:inline">
          {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
        </span>
      </div>

      {!loading && filtered.length > 0 && (
        <StatCardGrid cols={3}>
          <StatCard label="Total Output PPN" value={totals.output} tone="green" icon={<TrendingUp className="w-4 h-4" />} hint="PPN collected on sales, net of credit notes" />
          <StatCard label="Total Input PPN" value={totals.input} tone="red" icon={<TrendingDown className="w-4 h-4" />} hint="Claimable PPN paid on purchases, imports & expenses" />
          <StatCard label="Net PPN Payable" value={totals.net} tone="blue" icon={<Wallet className="w-4 h-4" />} hint="Amount owed to the tax office for periods in range" />
          <StatCard label="Carry Forward" value={totals.cfOut} tone="gray" icon={<ArrowRightCircle className="w-4 h-4" />} hint="Excess Input PPN moved to the next period" />
          <StatCard label="Missing Faktur" value={fakturCounts.missing} money={false} tone={fakturCounts.missing > 0 ? 'orange' : 'gray'} icon={<FileWarning className="w-4 h-4" />} hint="Sales invoices without a Faktur Pajak" />
          <StatCard label="Reported Faktur" value={fakturCounts.reported} money={false} tone="green" icon={<CheckCircle2 className="w-4 h-4" />} hint="Fakturs already reported to the tax office" />
        </StatCardGrid>
      )}

      {/* ── Document filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(['all', 'output', 'input'] as TypeFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 text-xs rounded-md transition ${typeFilter === t ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {t === 'all' ? 'All' : t === 'output' ? 'Output PPN' : 'Input PPN'}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
        >
          <option value="all">All faktur statuses</option>
          <option value="missing">Missing Faktur</option>
          <option value="generated">Generated Faktur</option>
          <option value="reported">Reported</option>
          <option value="unreported">Unreported</option>
        </select>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer, supplier, invoice or faktur number…"
            className="w-full text-xs border border-gray-200 rounded-lg pl-8 pr-2 py-1.5 bg-white"
          />
        </div>
        {filtersActive && (
          <button
            onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setSearch(''); }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="No PPN periods in the selected date range"
            hint="Periods are created automatically when a Sales Invoice, Purchase Invoice, or Expense with PPN is posted. Try widening the date range."
          />
        </SectionCard>
      ) : visiblePeriods.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="No documents match the current filters"
            hint="Clear the type / status / search filters, or widen the date range."
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
                <th className="text-right px-3 py-2">Output PPN</th>
                <th className="text-right px-3 py-2">Input PPN</th>
                <th className="text-right px-3 py-2">Carry Fwd In</th>
                <th className="text-right px-3 py-2">Net Payable</th>
                <th className="text-right px-3 py-2">Carry Fwd Out</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visiblePeriods.map(r => {
                const isOpen = expanded.has(r.tax_period_id);
                const docCount = (linesByPeriod.get(r.tax_period_id) ?? []).length;
                return (
                  <>
                    <tr
                      key={r.tax_period_id}
                      className={`border-t cursor-pointer select-none ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      onClick={() => toggleExpand(r.tax_period_id)}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {periodLabel(r)}
                        {!linesLoading && docCount > 0 && (
                          <span className="ml-2 text-[10px] text-gray-400">{docCount} docs</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                      <td className="px-3 py-2 text-right text-green-700">{fmt(r.output_ppn_total)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{fmt(r.input_ppn_total)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.carry_forward_in)}</td>
                      <td className="px-3 py-2 text-right font-semibold">Rp {fmt(r.net_ppn_payable)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.carry_forward_out)}</td>
                      <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
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
                    {isOpen && (
                      <tr key={`${r.tax_period_id}-detail`} className="bg-blue-50/40">
                        {renderRegister(r)}
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
