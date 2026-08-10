import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { formatFinancePeriod } from '../../../utils/financePeriod';
import { useFinance } from '../../../contexts/FinanceContext';
import { StatCard, StatCardGrid, SectionCard, StatusChip, EmptyState, taxPaymentBusinessStatus } from './TaxUI';

type PphType = 'PPh21' | 'PPh22' | 'PPh23' | 'PPh4(2)' | 'PPh_Unifikasi';

const TABS: PphType[] = ['PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'];
const CONSOLIDATED_TYPES: PphType[] = ['PPh21','PPh22','PPh23','PPh4(2)'];

function pphTabLabel(t: PphType): string {
  if (t === 'PPh21') return 'PPh21';
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
  module: 'expense' | 'payment_voucher' | 'import';
  id: string;
  doc_number: string;
  doc_date: string;
  period_date: string;
  party: string;
  description: string | null;
  pph_code: string | null;
  pph_amount: number;
  payment_method: string | null;
  recon_status: string | null;
  journal_reference: string | null;
  journal_id: string | null;
  posting_date: string | null;
  journal_status: string | null;
  tax_type: string;
  source_status: string;
  is_official: boolean;
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

  const [feRes, pvRes, importRes, bankPaymentRes, allocationRes, linkedVoucherRes] = await Promise.all([
    supabase
      .from('finance_expenses')
      .select('id, voucher_number, expense_date, due_date, pph_amount, description, payment_method, expense_category, approval_status, pph_code:pph_code_id(code, tax_type), suppliers:supplier_id(company_name), staff:staff_id(full_name)')
      .gt('pph_amount', 0),
    supabase
      .from('payment_vouchers')
      .select('id, voucher_number, voucher_date, pph_amount, description, is_posted, pph_code:pph_code_id(code, tax_type), suppliers:supplier_id(company_name), staff:staff_id(full_name)')
      .gte('voucher_date', startDate)
      .lte('voucher_date', endDate)
      .gt('pph_amount', 0),
    // Import PPh 22: pib_import (pib_pph_amount) + pph_import (whole amount).
    // Mirrors compute_period_ppn's import branch. Always PPh22.
    supabase
      .from('finance_expenses')
      .select('id, voucher_number, expense_date, due_date, amount, pib_pph_amount, description, expense_category, approval_status, suppliers:supplier_id(company_name)')
      .in('expense_category', ['pib_import', 'pph_import']),
    supabase
      .from('bank_statement_lines')
      .select('matched_expense_id, transaction_date, payment_kind')
      .not('matched_expense_id', 'is', null),
    supabase
      .from('voucher_allocations')
      .select('finance_expense_id, payment_voucher_id, payment_kind')
      .not('finance_expense_id', 'is', null),
    supabase
      .from('payment_vouchers')
      .select('id, voucher_date, is_posted'),
  ]);

  // Mirror get_expense_pph_period_date(): latest linked supplier payment,
  // otherwise due date, otherwise the legacy document date.
  const linkedVouchers = new Map<string, any>(
    ((linkedVoucherRes.data ?? []) as any[]).map(v => [v.id, v]),
  );
  const latestPaymentDate = new Map<string, string>();
  const addPaymentDate = (expenseId: string | null, date: string | null) => {
    if (!expenseId || !date) return;
    const current = latestPaymentDate.get(expenseId);
    if (!current || date > current) latestPaymentDate.set(expenseId, date);
  };
  for (const line of (bankPaymentRes.data ?? []) as any[]) {
    if ((line.payment_kind ?? 'supplier') === 'supplier') {
      addPaymentDate(line.matched_expense_id, line.transaction_date);
    }
  }
  for (const allocation of (allocationRes.data ?? []) as any[]) {
    if ((allocation.payment_kind ?? 'supplier') !== 'supplier') continue;
    const voucher = linkedVouchers.get(allocation.payment_voucher_id);
    if (voucher?.is_posted) addPaymentDate(allocation.finance_expense_id, voucher.voucher_date);
  }
  const periodDate = (expense: any): string =>
    latestPaymentDate.get(expense.id) ?? expense.due_date ?? expense.expense_date;
  const isSelectedPeriod = (expense: any): boolean => {
    const date = periodDate(expense);
    return date >= startDate && date <= endDate;
  };

  const expenseData = ((feRes.data ?? []) as any[]).filter(isSelectedPeriod);
  const importData = ((importRes.data ?? []) as any[]).filter(isSelectedPeriod);

  const sourceRows = [
    ...expenseData,
    ...((pvRes.data ?? []) as any[]),
    ...importData,
  ];
  const sourceIds = [...new Set(sourceRows.map(r => r.id).filter(Boolean))];
  const journalRes = sourceIds.length
    ? await supabase
      .from('journal_entries')
      .select('id, reference_id, entry_number, entry_date, is_posted, is_reversed')
      .eq('is_posted', true)
      .eq('is_reversed', false)
      .in('reference_id', sourceIds)
    : { data: [] as any[] };
  const journals = new Map<string, any>(((journalRes.data ?? []) as any[]).map(j => [j.reference_id, j]));
  const journalFields = (id: string) => {
    const journal = journals.get(id);
    return {
      journal_reference: journal?.entry_number ?? null,
      journal_id: journal?.id ?? null,
      posting_date: journal?.entry_date ?? null,
      journal_status: journal
        ? (journal.is_reversed ? 'Reversed' : journal.is_posted ? 'Posted' : 'Draft')
        : 'Not posted',
    };
  };

  const pphType = row.tax_type;

  const expenses: SourceLine[] = expenseData
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
      period_date: periodDate(r),
      party: r.suppliers?.company_name ?? r.staff?.full_name ?? '—',
      description: r.description,
      pph_code: r.pph_code?.code ?? null,
      pph_amount: Number(r.pph_amount),
      tax_type: r.pph_code?.tax_type ?? pphType,
      source_status: r.approval_status === 'approved' ? 'Approved' : 'Pending Approval',
      is_official: r.approval_status === 'approved',
      payment_method: r.payment_method,
      recon_status: null,
      ...journalFields(r.id),
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
      period_date: r.voucher_date,
      party: r.suppliers?.company_name ?? r.staff?.full_name ?? '—',
      description: r.description,
      pph_code: r.pph_code?.code ?? null,
      pph_amount: Number(r.pph_amount),
      tax_type: r.pph_code?.tax_type ?? pphType,
      source_status: r.is_posted ? 'Posted' : 'Draft',
      is_official: Boolean(r.is_posted),
      payment_method: null,
      recon_status: null,
      ...journalFields(r.id),
    }));

  // Import PPh 22 — only relevant to the PPh22 and consolidated tabs.
  const imports: SourceLine[] = (pphType === 'PPh22' || pphType === 'PPh_Unifikasi')
    ? importData
        .map(r => {
          const amt = r.expense_category === 'pib_import'
            ? Number(r.pib_pph_amount ?? 0)
            : Number(r.amount ?? 0);
          return { r, amt };
        })
        .filter(({ amt }) => amt > 0)
        .map(({ r, amt }) => ({
          module: 'import' as const,
          id: r.id,
          doc_number: r.voucher_number ?? '—',
          doc_date: r.expense_date,
          period_date: periodDate(r),
          party: r.suppliers?.company_name ?? '—',
          description: r.description,
          pph_code: 'PPh22 Import',
          pph_amount: amt,
          tax_type: 'PPh22',
          source_status: r.approval_status === 'approved' ? 'Approved' : 'Pending Approval',
          is_official: r.approval_status === 'approved',
          payment_method: null,
          recon_status: null,
          ...journalFields(r.id),
        }))
    : [];

  return [...expenses, ...vouchers, ...imports].sort((a, b) =>
    a.period_date.localeCompare(b.period_date) || a.doc_date.localeCompare(b.doc_date),
  );
}

function consolidateRows(rows: Row[]): Row[] {
  const grouped = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.fiscal_year}-${row.period_month}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row, tax_period_id: key, tax_type: 'PPh_Unifikasi' });
      continue;
    }
    existing.pph_total += Number(row.pph_total || 0);
    existing.pph_paid_total += Number(row.pph_paid_total || 0);
    existing.pph_outstanding += Number(row.pph_outstanding || 0);
    if (row.payment_status === 'overdue') existing.payment_status = 'overdue';
  }
  return [...grouped.values()].sort((a, b) => b.fiscal_year - a.fiscal_year || b.period_month - a.period_month);
}

interface Props {
  onOpenExpense?: (id: string) => void;
  onOpenPayment?: (id: string) => void;
  onOpenJournal?: (id: string) => void;
}

export function PphRegisterPanel({ onOpenExpense, onOpenPayment, onOpenJournal }: Props) {
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
      let query = supabase
        .from('vw_pph_by_period_type')
        .select('*')
        .order('fiscal_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(active === 'PPh_Unifikasi' ? 240 : 60);
      query = active === 'PPh_Unifikasi'
        ? query.in('tax_type', CONSOLIDATED_TYPES)
        : query.eq('tax_type', active);
      const { data } = await query;
      if (!cancelled) {
        const sourceRows = (data as Row[] | null) ?? [];
        setRows(active === 'PPh_Unifikasi' ? consolidateRows(sourceRows) : sourceRows);
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
          <StatCard label={`Total ${pphTabLabel(active)} Withheld`} value={totals.total} tone="orange" hint="Across periods in range" />
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
            hint="PPh periods are created automatically once expenses, vouchers, or imports with PPh are approved. Try widening the date range."
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
                const businessStatus = taxPaymentBusinessStatus({
                  paymentStatus: r.payment_status,
                  paidAmount: r.pph_paid_total,
                  outstandingAmount: r.pph_outstanding,
                });
                const officialDetail = isOpen && detail ? detail.filter(line => line.is_official) : [];
                const pendingDetail = isOpen && detail ? detail.filter(line => !line.is_official) : [];
                const missingJournalDetail = officialDetail.filter(line => !line.journal_id);
                const detailTotal = officialDetail.reduce((sum, line) => sum + line.pph_amount, 0);
                const traceDifference = detailTotal - Number(r.pph_total || 0);
                return (
                  <Fragment key={r.tax_period_id}>
                    <tr
                      key={r.tax_period_id}
                      className={`border-t cursor-pointer select-none ${isOpen ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      onClick={() => void toggleExpand(r)}
                    >
                      <td className="px-2 py-2 text-gray-400">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-3 py-2 font-medium">{formatFinancePeriod(r.fiscal_year, r.period_month)}</td>
                      <td className="px-3 py-2">
                        <StatusChip status={businessStatus} />
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
                        <td colSpan={10} className="px-6 pb-4 pt-2">
                          <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                            Source Documents — {pphTabLabel(active)} withheld in {formatFinancePeriod(r.fiscal_year, r.period_month)}
                          </h4>
                          {detailLoading ? (
                            <p className="text-xs text-gray-500">Loading source documents…</p>
                          ) : officialDetail.length === 0 && Number(r.pph_total || 0) > 0 ? (
                            <p className="text-xs font-medium text-red-700">Audit trace mismatch: this Register amount has no approved source document. Review the source-document lifecycle.</p>
                          ) : officialDetail.length > 0 ? (
                            <>
                            {missingJournalDetail.length > 0 && (
                              <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                                Accounting warning: {missingJournalDetail.length} approved source document{missingJournalDetail.length === 1 ? '' : 's'} {missingJournalDetail.length === 1 ? 'has' : 'have'} no active posted journal. The withholding remains in the official Register; open the document to correct its journal lifecycle.
                              </div>
                            )}
                            {Math.abs(traceDifference) > 0.01 && (
                              <p className="mb-2 text-xs font-medium text-red-700">
                                Audit trace mismatch: source documents total Rp {fmt(detailTotal)}, Register total Rp {fmt(r.pph_total)}.
                              </p>
                            )}
                            <table className="w-full text-xs border-collapse">
                              <thead>
                                <tr className="text-gray-500 border-b">
                                  <th className="text-left py-1 pr-3">Module</th>
                                  <th className="text-left py-1 pr-3">Tax Type</th>
                                  <th className="text-left py-1 pr-3">Document</th>
                                  <th className="text-left py-1 pr-3">Document Date</th>
                                  <th className="text-left py-1 pr-3">PPh Period Date</th>
                                  <th className="text-left py-1 pr-3">Employee / Supplier</th>
                                  <th className="text-left py-1 pr-3">Description</th>
                                  <th className="text-left py-1 pr-3">PPh Code</th>
                                  <th className="text-left py-1 pr-3">Posting Date</th>
                                  <th className="text-left py-1 pr-3">Journal Ref</th>
                                  <th className="text-left py-1 pr-3">Status</th>
                                  <th className="text-right py-1">PPh Withheld</th>
                                </tr>
                              </thead>
                              <tbody>
                                {officialDetail.map(l => (
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
                                    <td className="py-1.5 pr-3 font-semibold">{l.tax_type}</td>
                                    <td className="py-1.5 pr-3 font-mono font-semibold">
                                      <button type="button" className="text-blue-700 hover:underline" onClick={() => {
                                        if (l.module === 'payment_voucher') onOpenPayment?.(l.id);
                                        else onOpenExpense?.(l.id);
                                      }}>{l.doc_number}</button>
                                    </td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(l.doc_date)}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium text-blue-700">{fmtDate(l.period_date)}</td>
                                    <td className="py-1.5 pr-3 max-w-[140px] truncate text-gray-700" title={l.party}>{l.party}</td>
                                    <td className="py-1.5 pr-3 max-w-[180px] truncate text-gray-500" title={l.description ?? undefined}>{l.description ?? '—'}</td>
                                    <td className="py-1.5 pr-3">
                                      {l.pph_code
                                        ? <span className="font-mono text-blue-700">{l.pph_code}</span>
                                        : <span className="text-orange-500 italic">⚠ No code</span>}
                                    </td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{l.posting_date ? fmtDate(l.posting_date) : '—'}</td>
                                    <td className="py-1.5 pr-3 font-mono">
                                      {l.journal_id
                                        ? <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenJournal?.(l.journal_id!)}>{l.journal_reference}</button>
                                        : '—'}
                                    </td>
                                    <td className="py-1.5 pr-3" title={`Journal: ${l.journal_status ?? '—'}`}>
                                      <StatusChip status={businessStatus} />
                                      <div className="mt-0.5 text-[10px] text-gray-500">{l.source_status}</div>
                                    </td>
                                    <td className="py-1.5 text-right font-mono font-semibold text-orange-700">
                                      Rp {fmt(l.pph_amount)}
                                    </td>
                                  </tr>
                                ))}
                                <tr className="font-semibold border-t-2 border-gray-300 bg-gray-50">
                                  <td colSpan={11} className="py-1.5 pr-3 text-right text-xs text-gray-500">Total {pphTabLabel(active)} Withheld</td>
                                  <td className="py-1.5 text-right font-mono text-orange-700">
                                    Rp {fmt(detailTotal)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                            </>
                          ) : null}

                          {!detailLoading && pendingDetail.length > 0 && (
                            <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3">
                              <h5 className="text-xs font-semibold text-amber-900">Pending Approval / Not Posted</h5>
                              <p className="mb-2 text-[11px] text-amber-800">
                                These transactions are not approved and are excluded from the official Register until approval.
                              </p>
                              <table className="w-full text-xs border-collapse bg-white">
                                <thead>
                                  <tr className="border-b text-gray-500">
                                    <th className="p-1.5 text-left">Document No.</th>
                                    <th className="p-1.5 text-left">Module</th>
                                    <th className="p-1.5 text-left">Employee / Supplier</th>
                                    <th className="p-1.5 text-left">Tax Type</th>
                                    <th className="p-1.5 text-right">Tax Amount</th>
                                    <th className="p-1.5 text-left">Status</th>
                                    <th className="p-1.5 text-left">Expected Posting Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pendingDetail.map(line => (
                                    <tr key={`pending-${line.module}-${line.id}`} className="border-b border-gray-100">
                                      <td className="p-1.5 font-mono font-semibold">
                                        <button type="button" className="text-blue-700 hover:underline" onClick={() => {
                                          if (line.module === 'payment_voucher') onOpenPayment?.(line.id);
                                          else onOpenExpense?.(line.id);
                                        }}>{line.doc_number}</button>
                                      </td>
                                      <td className="p-1.5">{line.module === 'payment_voucher' ? 'Payment Voucher' : line.module === 'import' ? 'Import PPh22' : 'Expense'}</td>
                                      <td className="p-1.5">{line.party}</td>
                                      <td className="p-1.5 font-medium">{line.tax_type}</td>
                                      <td className="p-1.5 text-right font-mono">Rp {fmt(line.pph_amount)}</td>
                                      <td className="p-1.5">{line.source_status}</td>
                                      <td className="p-1.5 whitespace-nowrap">{fmtDate(line.doc_date)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
