import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface ExceptionRow {
  row_id: string;
  exception_id: number | null;
  document_type: string;
  document_id: string;
  date: string | null;
  voucher_number: string | null;
  journal_number: string | null;
  amount: number | null;
  currency: string | null;
  bank: string | null;
  customer_supplier: string | null;
  current_category: string | null;
  current_gl_account: string | null;
  status: string;
  problem: string;
  why_not_automatic: string;
  recommended_action: string;
  current_bank_account_id: string | null;
  journal_entry_id: string | null;
  journal_line_id: string | null;
  current_reference: string | null;
  current_supplier_id: string | null;
  current_customer_id: string | null;
  from_bank_account_id: string | null;
  to_bank_account_id: string | null;
  from_bank_alias: string | null;
  to_bank_alias: string | null;
  bank_alias: string | null;
  bank_statement_line_id: string | null;
  current_subcategory: string | null;
  current_source_document: string | null;
}

const humanize = (value: string | null | undefined) => value
  ? value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : '—';
const formatAmount = (amount: number | null, currency: string | null) => amount == null
  ? '—' : `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} ${currency || ''}`;
const sourceRoute = (type: string) => ({
  expense: 'expenses', receipt: 'receipt', payment: 'payment', fund_transfer: 'contra', fund_transfers: 'contra',
  petty_cash: 'petty-cash', bank_reconciliation: 'bank-reconciliation', journal: 'journal-register',
  tax_payment: 'tax', sales_invoice: 'receivables', purchase_invoice: 'purchase',
}[type] || 'journal-register');

const financeHref = (route: string, params: URLSearchParams, extra: Record<string, string | null | undefined> = {}) => {
  const keep = new URLSearchParams();
  ['from', 'to', 'bank', 'search', 'currency', 'type', 'status'].forEach(key => {
    const value = params.get(key); if (value) keep.set(key, value);
  });
  Object.entries(extra).forEach(([key, value]) => { if (value) keep.set(key, value); });
  const query = keep.toString();
  return `/finance/${route}${query ? `?${query}` : ''}`;
};

type OpenDocument = (row: ExceptionRow) => void;

export function FinanceExceptionCorrectionDashboard({ onOpenDocument }: {
  canManage: boolean;
  onOpenDocument?: OpenDocument;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filter = useCallback((key: string) => searchParams.get(key) || '', [searchParams]);
  const setFilter = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: queryError } = await supabase
      .from('finance_exception_correction_dashboard')
      .select('*').order('date', { ascending: true, nullsFirst: false });
    if (queryError) setError(queryError.message);
    else setRows((data ?? []) as ExceptionRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = useMemo(() => {
    const search = filter('search').toLowerCase();
    return rows.filter(row => {
      if (filter('type') && row.document_type !== filter('type')) return false;
      if (filter('status') && row.status !== filter('status')) return false;
      if (filter('currency') && row.currency !== filter('currency')) return false;
      if (filter('bank') && ![row.current_bank_account_id, row.from_bank_account_id, row.to_bank_account_id].includes(filter('bank'))) return false;
      if (filter('from') && (!row.date || row.date < filter('from'))) return false;
      if (filter('to') && (!row.date || row.date > filter('to'))) return false;
      return !search || [row.voucher_number, row.journal_number, row.customer_supplier, row.problem,
        row.current_gl_account, row.current_category, row.current_subcategory, row.bank_alias,
        row.from_bank_alias, row.to_bank_alias, row.current_reference].filter(Boolean).join(' ').toLowerCase().includes(search);
    });
  }, [filter, rows]);

  const types = useMemo(() => [...new Set(rows.map(row => row.document_type))].sort(), [rows]);
  const currencies = useMemo(() => [...new Set(rows.map(row => row.currency).filter(Boolean) as string[])].sort(), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map(row => row.status))].sort(), [rows]);
  const toggle = (row: ExceptionRow) => setExpanded(current => {
    const next = new Set(current); if (next.has(row.row_id)) next.delete(row.row_id); else next.add(row.row_id); return next;
  });

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-gray-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading unresolved exceptions…</div>;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-base font-semibold text-gray-900">Finance Exception Correction</h2><p className="text-xs text-gray-500">Open the original business document and correct it using its normal Finance workflow.</p></div>
      <div className="flex items-center gap-2"><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{filteredRows.length === rows.length ? rows.length : `${filteredRows.length} of ${rows.length}`} unresolved</span><button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"><RefreshCw className="h-3.5 w-3.5" />Refresh</button></div>
    </div>
    {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
      <div className="mb-2 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700"><SlidersHorizontal className="h-3.5 w-3.5" />Filters</span><button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="text-xs font-medium text-blue-600 hover:underline">Clear all</button></div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <label className="relative xl:col-span-2"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" /><input value={filter('search')} onChange={event => setFilter('search', event.target.value)} placeholder="Search voucher, journal, party, problem…" className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-xs" /></label>
        <select value={filter('type')} onChange={event => setFilter('type', event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All document types</option>{types.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select>
        <select value={filter('status')} onChange={event => setFilter('status', event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select>
        <select value={filter('currency')} onChange={event => setFilter('currency', event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All currencies</option>{currencies.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <label className="flex items-center gap-1 text-[11px] text-gray-500">From<input type="date" value={filter('from')} onChange={event => setFilter('from', event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs" /></label>
        <label className="flex items-center gap-1 text-[11px] text-gray-500">To<input type="date" value={filter('to')} onChange={event => setFilter('to', event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs" /></label>
      </div>
    </div>
    <div className="overflow-x-auto rounded-lg border border-gray-200"><table className="min-w-[1700px] divide-y divide-gray-200 text-xs"><thead className="bg-gray-50 text-left font-medium uppercase tracking-wide text-gray-500"><tr><th className="w-8 px-2 py-2" />{['Date','Voucher Number','Journal Number','Amount','Bank','From Bank','To Bank','Customer / Supplier','Document Type','Current Category','Current GL Account','Problem','Status','Correction'].map(label => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-200 bg-white">
      {filteredRows.map(row => { const isExpanded = expanded.has(row.row_id); const route = sourceRoute(row.document_type); const href = financeHref(route, searchParams, { document: row.document_id }); return <>
        <tr key={row.row_id}>
          <td className="px-2 py-2 align-top"><button type="button" onClick={() => toggle(row)} aria-label={isExpanded ? 'Collapse exception' : 'Expand exception'} className="rounded p-0.5 hover:bg-gray-100">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
          <td className="px-2 py-2 align-top">{row.date || '—'}</td><td className="px-2 py-2 align-top font-medium">{row.voucher_number || '—'}</td><td className="px-2 py-2 align-top">{row.journal_number || '—'}</td><td className="px-2 py-2 text-right align-top">{formatAmount(row.amount, row.currency)}</td><td className="px-2 py-2 align-top font-medium">{row.bank_alias || row.bank || '—'}</td><td className="px-2 py-2 align-top">{row.from_bank_alias || '—'}</td><td className="px-2 py-2 align-top">{row.to_bank_alias || '—'}</td><td className="px-2 py-2 align-top">{row.customer_supplier || '—'}</td><td className="px-2 py-2 align-top">{humanize(row.document_type)}</td><td className="px-2 py-2 align-top">{humanize(row.current_category)}</td><td className="px-2 py-2 align-top">{row.current_gl_account || '—'}</td><td className="max-w-80 px-2 py-2 align-top">{row.problem}</td><td className="px-2 py-2 align-top"><span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{humanize(row.status)}</span></td><td className="px-2 py-2 align-top"><button type="button" onClick={() => toggle(row)} className="whitespace-nowrap rounded-md bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700">{isExpanded ? 'Close' : 'Open correction'}</button></td>
        </tr>
        {isExpanded && <tr key={`${row.row_id}:details`} className="bg-gray-50/70"><td colSpan={15} className="px-4 py-3"><div className="mb-3 grid gap-2 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">{[['Voucher Number',row.voucher_number],['Journal Number',row.journal_number],['Date',row.date],['Amount',formatAmount(row.amount,row.currency)],['Currency',row.currency],['Bank Alias',row.bank_alias || row.bank],['Current GL',row.current_gl_account],['Current Category',humanize(row.current_category)],['Current Subcategory',humanize(row.current_subcategory)],['Source Document',row.current_source_document]].map(([label,value]) => <div key={label}><div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div><div className="mt-0.5 break-words text-xs font-medium text-gray-800">{value || '—'}</div></div>)}</div><div className="mb-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 md:grid-cols-3"><div><span className="font-semibold">Business problem:</span> {row.problem}</div><div><span className="font-semibold">Why it needs review:</span> {row.why_not_automatic}</div><div><span className="font-semibold">Recommended action:</span> {row.recommended_action}</div></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpenDocument?.(row)} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Open original {humanize(row.document_type)} editor</button><a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Open in new tab <ExternalLink className="h-3 w-3" /></a>{row.journal_entry_id && <a href={financeHref('journal-register',searchParams,{ journal: row.journal_entry_id })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Journal <ExternalLink className="h-3 w-3" /></a>}{(row.current_bank_account_id || row.bank_statement_line_id) && <a href={financeHref('bank-reconciliation',searchParams,{ bank: row.current_bank_account_id, bankLine: row.bank_statement_line_id })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Bank Reconciliation <ExternalLink className="h-3 w-3" /></a>}</div></td></tr>}
      </>; })}
      {!filteredRows.length && <tr><td colSpan={15} className="px-4 py-16 text-center text-sm text-emerald-700">{rows.length ? 'No exceptions match the current filters.' : 'No unresolved Finance exceptions.'}</td></tr>}
    </tbody></table></div>
  </div>;
}
