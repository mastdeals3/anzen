import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Save, Search, SlidersHorizontal } from 'lucide-react';
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
  current_account_id: string | null;
  current_tax_code_id: string | null;
  current_payment_type: string | null;
  current_document_classification: string | null;
  current_faktur_pajak_number: string | null;
  expense_exchange_rate: number | null;
  current_subcategory: string | null;
  current_reference: string | null;
  current_supplier_id: string | null;
  current_customer_id: string | null;
  from_bank_account_id: string | null;
  to_bank_account_id: string | null;
  from_bank_alias: string | null;
  to_bank_alias: string | null;
  bank_alias: string | null;
  bank_statement_line_id: string | null;
  current_source_document: string | null;
  current_finance_classification: string | null;
}

interface CoaOption { id: string; code: string; name: string; account_type: string; account_group: string | null }
interface BankOption { id: string; bank_name: string; account_name: string; account_number: string; alias: string | null; currency: string }
interface TaxOption { id: string; code: string; name: string; tax_type: string; rate: number }
interface PartyOption { id: string; company_name: string }
interface LinkOption { id: string; type: string; label: string; journalId?: string | null }
interface RowEdit {
  expense_category?: string;
  account_id?: string;
  bank_account_id?: string;
  loan_account_id?: string;
  capital_account_id?: string;
  tax_code_id?: string;
  payment_type?: string;
  document_classification?: string;
  exchange_rate?: string;
  faktur_pajak_number?: string;
  expense_subcategory?: string;
  supplier_id?: string;
  customer_id?: string;
  reference?: string;
  finance_classification?: string;
  from_bank_account_id?: string;
  to_bank_account_id?: string;
  linked_document_type?: string;
  linked_document_id?: string;
}

const humanize = (value: string | null | undefined) => value
  ? value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())
  : '—';

const formatAmount = (amount: number | null, currency: string | null) => {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(amount) + ` ${currency || ''}`;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const bankLabel = (bank: BankOption) => bank.alias || `${bank.bank_name} ${bank.currency}`;

const sourceRoute = (row: ExceptionRow) => {
  const routes: Record<string, string> = {
    expense: 'expenses', receipt: 'receipt', payment: 'payment', fund_transfer: 'fund-transfer',
    petty_cash: 'petty-cash', bank_reconciliation: 'bank-reconciliation', journal: 'journal-register',
    tax_payment: 'tax', sales_invoice: 'receivables', purchase_invoice: 'purchase',
  };
  return routes[row.document_type] || 'journal-register';
};

const SelectField = ({ label, value, onChange, children, disabled = false }: {
  label: string; value?: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean;
}) => (
  <label className="block min-w-0">
    <span className="mb-1 block text-[11px] font-medium text-gray-600">{label}</span>
    <select value={value ?? ''} onChange={event => onChange(event.target.value)} disabled={disabled}
      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:bg-gray-100">
      <option value="">No change</option>
      {children}
    </select>
  </label>
);

export function FinanceExceptionCorrectionDashboard({ canManage, onSaved }: { canManage: boolean; onSaved?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [coa, setCoa] = useState<CoaOption[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxOption[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<string[]>([]);
  const [documentClassifications, setDocumentClassifications] = useState<string[]>([]);
  const [expenseSubcategories, setExpenseSubcategories] = useState<string[]>([]);
  const [financeClassifications, setFinanceClassifications] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [linkOptions, setLinkOptions] = useState<Record<string, LinkOption[]>>({});
  const [loadingLinks, setLoadingLinks] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filter = useCallback((key: string) => searchParams.get(key) || '', [searchParams]);
  const setFilter = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [exceptionResult, coaResult, bankResult, taxResult, expenseResult, pettyResult,
        receiptResult, paymentResult, bankLineResult, journalResult, supplierResult, customerResult,
        loanResult, capitalResult] = await Promise.all([
        supabase.from('finance_exception_correction_dashboard').select('*').order('date', { ascending: true, nullsFirst: false }),
        supabase.from('chart_of_accounts').select('id,code,name,account_type,account_group').eq('is_active', true).eq('is_header', false).order('code'),
        supabase.from('bank_accounts').select('id,bank_name,account_name,account_number,alias,currency').eq('is_active', true).order('bank_name'),
        supabase.from('tax_codes').select('id,code,name,tax_type,rate').eq('is_active', true).order('code'),
        supabase.from('finance_expenses').select('expense_category,expense_type,payment_method'),
        supabase.from('petty_cash_transactions').select('expense_category'),
        supabase.from('receipt_vouchers').select('payment_method'),
        supabase.from('payment_vouchers').select('payment_method'),
        supabase.from('bank_statement_lines').select('payment_kind'),
        supabase.from('journal_entries').select('source_module'),
        supabase.from('suppliers').select('id,company_name').eq('is_active', true).order('company_name'),
        supabase.from('customers').select('id,company_name').order('company_name'),
        supabase.from('loans').select('loan_type'),
        supabase.from('capital_contributions').select('contribution_type'),
      ]);
      const failed = [exceptionResult, coaResult, bankResult, taxResult, expenseResult, pettyResult,
        receiptResult, paymentResult, bankLineResult, journalResult, supplierResult, customerResult,
        loanResult, capitalResult].find(result => result.error);
      if (failed?.error) throw failed.error;

      setRows((exceptionResult.data ?? []) as ExceptionRow[]);
      setCoa((coaResult.data ?? []) as CoaOption[]);
      setBanks((bankResult.data ?? []) as BankOption[]);
      setTaxCodes((taxResult.data ?? []) as TaxOption[]);
      setExpenseCategories([...new Set([
        ...(expenseResult.data ?? []).map(row => row.expense_category),
        ...(pettyResult.data ?? []).map(row => row.expense_category),
      ].filter(Boolean) as string[])].sort());
      setPaymentTypes([...new Set([
        ...(expenseResult.data ?? []).map(row => row.payment_method),
        ...(receiptResult.data ?? []).map(row => row.payment_method),
        ...(paymentResult.data ?? []).map(row => row.payment_method),
        ...(bankLineResult.data ?? []).map(row => row.payment_kind),
      ].filter(Boolean) as string[])].sort());
      setDocumentClassifications([...new Set((journalResult.data ?? []).map(row => row.source_module).filter(Boolean) as string[])].sort());
      setExpenseSubcategories([...new Set((expenseResult.data ?? []).map(row => row.expense_type).filter(Boolean) as string[])].sort());
      setFinanceClassifications([...new Set([
        ...(loanResult.data ?? []).map(row => row.loan_type),
        ...(capitalResult.data ?? []).map(row => row.contribution_type),
      ].filter(Boolean) as string[])].sort());
      setSuppliers((supplierResult.data ?? []) as PartyOption[]);
      setCustomers((customerResult.data ?? []) as PartyOption[]);
    } catch (loadError: unknown) {
      setError(errorMessage(loadError, 'Could not load Finance exceptions.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const loadLinkOptions = useCallback(async (row: ExceptionRow) => {
    if (row.document_type !== 'bank_reconciliation' || linkOptions[row.row_id] || row.amount == null) return;
    setLoadingLinks(row.row_id);
    try {
      const amount = Math.abs(row.amount);
      const [journals, receipts, payments, expenses, transfers] = await Promise.all([
        supabase.from('journal_entries').select('id,entry_number,entry_date,source_module').eq('is_posted', true).eq('is_reversed', false).eq('total_debit', amount).limit(50),
        supabase.from('receipt_vouchers').select('id,voucher_number,voucher_date,journal_entry_id').eq('amount', amount).eq('is_posted', true).limit(50),
        supabase.from('payment_vouchers').select('id,voucher_number,voucher_date,journal_entry_id').eq('amount', amount).eq('is_posted', true).limit(50),
        supabase.from('finance_expenses').select('id,voucher_number,expense_date,journal_entry_id').eq('amount', amount).limit(50),
        supabase.from('fund_transfers').select('id,transfer_number,transfer_date,journal_entry_id').or(`amount.eq.${amount},from_amount.eq.${amount},to_amount.eq.${amount}`).eq('status', 'posted').limit(50),
      ]);
      const failed = [journals, receipts, payments, expenses, transfers].find(result => result.error);
      if (failed?.error) throw failed.error;
      const options: LinkOption[] = [
        ...(receipts.data ?? []).map(x => ({ id: x.id, type: 'receipt', label: `Receipt ${x.voucher_number} · ${x.voucher_date}`, journalId: x.journal_entry_id })),
        ...(payments.data ?? []).map(x => ({ id: x.id, type: 'payment', label: `Payment ${x.voucher_number} · ${x.voucher_date}`, journalId: x.journal_entry_id })),
        ...(expenses.data ?? []).map(x => ({ id: x.id, type: 'expense', label: `Expense ${x.voucher_number || x.id.slice(0, 8)} · ${x.expense_date}`, journalId: x.journal_entry_id })),
        ...(transfers.data ?? []).map(x => ({ id: x.id, type: 'fund_transfer', label: `Fund Transfer ${x.transfer_number} · ${x.transfer_date}`, journalId: x.journal_entry_id })),
        ...(journals.data ?? []).map(x => ({ id: x.id, type: 'journal', label: `Journal ${x.entry_number} · ${x.entry_date} · ${humanize(x.source_module)}`, journalId: x.id })),
      ];
      setLinkOptions(current => ({ ...current, [row.row_id]: options }));
    } catch (linkError: unknown) {
      setError(errorMessage(linkError, 'Could not load eligible correction links.'));
    } finally {
      setLoadingLinks(null);
    }
  }, [linkOptions]);

  const toggleExpanded = (row: ExceptionRow) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(row.row_id)) next.delete(row.row_id); else next.add(row.row_id);
      return next;
    });
    void loadLinkOptions(row);
  };

  const updateEdit = (rowId: string, field: keyof RowEdit, value: string) => {
    setEdits(current => ({ ...current, [rowId]: { ...current[rowId], [field]: value || undefined } }));
    setMessage(null);
  };

  const editedRows = useMemo(() => rows.filter(row => {
    const edit = edits[row.row_id];
    return edit && Object.values(edit).some(Boolean);
  }), [rows, edits]);

  const filteredRows = useMemo(() => {
    const search = filter('search').toLowerCase();
    return rows.filter(row => {
      if (filter('type') && row.document_type !== filter('type')) return false;
      if (filter('status') && row.status !== filter('status')) return false;
      if (filter('currency') && row.currency !== filter('currency')) return false;
      if (filter('bank') && ![row.current_bank_account_id,row.from_bank_account_id,row.to_bank_account_id].includes(filter('bank'))) return false;
      if (filter('supplier') && row.current_supplier_id !== filter('supplier')) return false;
      if (filter('customer') && row.current_customer_id !== filter('customer')) return false;
      if (filter('from') && (!row.date || row.date < filter('from'))) return false;
      if (filter('to') && (!row.date || row.date > filter('to'))) return false;
      if (search && ![
        row.voucher_number,row.journal_number,row.customer_supplier,row.problem,row.current_gl_account,
        row.current_category,row.current_subcategory,row.bank_alias,row.from_bank_alias,row.to_bank_alias,row.current_reference,
      ].filter(Boolean).join(' ').toLowerCase().includes(search)) return false;
      return true;
    });
  // searchParams is the source of truth for filters.
  }, [rows, filter]);

  const types = useMemo(() => [...new Set(rows.map(row => row.document_type))].sort(), [rows]);
  const currencies = useMemo(() => [...new Set(rows.map(row => row.currency).filter(Boolean) as string[])].sort(), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map(row => row.status))].sort(), [rows]);

  const financeHref = (route: string, extra: Record<string, string | null | undefined> = {}) => {
    const keep = new URLSearchParams();
    ['from','to','bank','search','currency'].forEach(key => { const value = searchParams.get(key); if (value) keep.set(key, value); });
    Object.entries(extra).forEach(([key,value]) => { if (value) keep.set(key, value); });
    const query = keep.toString();
    return `/finance/${route}${query ? `?${query}` : ''}`;
  };

  const loanAccounts = useMemo(() => coa.filter(account =>
    account.account_type === 'liability' && /loan|borrow/i.test(`${account.name} ${account.account_group || ''}`)), [coa]);
  const capitalAccounts = useMemo(() => coa.filter(account => account.account_type === 'equity'), [coa]);

  const saveAll = async () => {
    if (!editedRows.length) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const corrections = editedRows.map(row => ({
        row_id: row.row_id,
        exception_id: row.exception_id,
        document_type: row.document_type,
        document_id: row.document_id,
        journal_entry_id: row.journal_entry_id,
        journal_line_id: row.journal_line_id,
        confirm_resolved: true,
        ...edits[row.row_id],
      }));
      const { data, error: saveError } = await supabase.rpc('save_finance_exception_corrections_v2', { p_corrections: corrections });
      if (saveError) throw saveError;
      const result = data as { saved?: number; resolved?: number; resolved_row_ids?: string[] } | null;
      const resolvedIds = new Set(result?.resolved_row_ids ?? []);
      if (resolvedIds.size) setRows(current => current.filter(row => !resolvedIds.has(row.row_id)));
      setEdits({});
      setExpanded(new Set());
      setMessage(`${result?.saved ?? corrections.length} correction(s) saved. ${resolvedIds.size || result?.resolved || 0} exception(s) resolved. Finance verification refreshed.`);
      onSaved?.();
      window.dispatchEvent(new CustomEvent('finance-data-changed'));
      await load(true);
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, 'Could not save Finance corrections. No changes were committed.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-gray-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading unresolved exceptions…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Finance Exception Correction</h2>
          <p className="text-xs text-gray-500">Correct historical classifications in place. Posted amounts and journal identity are protected.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{filteredRows.length === rows.length ? rows.length : `${filteredRows.length} of ${rows.length}`} unresolved</span>
          <button onClick={() => load()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </button>
          <button onClick={saveAll} disabled={!canManage || saving || editedRows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />{saving ? 'Saving…' : `SAVE ALL${editedRows.length ? ` (${editedRows.length})` : ''}`}
          </button>
        </div>
      </div>

      {!canManage && <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Only Admin and Accounts users can save corrections.</div>}
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>}
      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700">{message}</div>}

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700"><SlidersHorizontal className="h-3.5 w-3.5" />Filters</span>
          <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="text-xs font-medium text-blue-600 hover:underline">Clear all</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="relative xl:col-span-2"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-gray-400" /><input value={filter('search')} onChange={event => setFilter('search', event.target.value)} placeholder="Search voucher, journal, party, problem…" className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-xs" /></label>
          <select value={filter('type')} onChange={event => setFilter('type',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All document types</option>{types.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select>
          <select value={filter('status')} onChange={event => setFilter('status',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select value={filter('currency')} onChange={event => setFilter('currency',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All currencies</option>{currencies.map(value => <option key={value} value={value}>{value}</option>)}</select>
          <select value={filter('bank')} onChange={event => setFilter('bank',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All banks</option>{banks.map(value => <option key={value.id} value={value.id}>{bankLabel(value)}</option>)}</select>
          <select value={filter('supplier')} onChange={event => setFilter('supplier',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All suppliers</option>{suppliers.map(value => <option key={value.id} value={value.id}>{value.company_name}</option>)}</select>
          <select value={filter('customer')} onChange={event => setFilter('customer',event.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs"><option value="">All customers</option>{customers.map(value => <option key={value.id} value={value.id}>{value.company_name}</option>)}</select>
          <label className="flex items-center gap-1 text-[11px] text-gray-500">From<input type="date" value={filter('from')} onChange={event => setFilter('from',event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700" /></label>
          <label className="flex items-center gap-1 text-[11px] text-gray-500">To<input type="date" value={filter('to')} onChange={event => setFilter('to',event.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700" /></label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-[1900px] divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              {['Date','Voucher Number','Journal Number','Amount','Bank','From Bank','To Bank','Customer / Supplier','Document Type','Current Category','Current GL Account','Problem','Status','Correction'].map(label =>
                <th key={label} className="px-2 py-2">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredRows.map(row => {
              const isExpanded = expanded.has(row.row_id);
              const edit = edits[row.row_id] ?? {};
              return [
                <tr key={row.row_id} className={edits[row.row_id] ? 'bg-blue-50/40' : ''}>
                  <td className="px-2 py-2 align-top"><button onClick={() => toggleExpanded(row)} className="rounded p-0.5 hover:bg-gray-100" aria-label="Edit exception">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                  <td className="whitespace-nowrap px-2 py-2 align-top">{row.date || '—'}</td>
                  <td className="px-2 py-2 align-top font-medium text-gray-900">{row.voucher_number || '—'}</td>
                  <td className="px-2 py-2 align-top">{row.journal_number || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top">{formatAmount(row.amount, row.currency)}</td>
                  <td className="max-w-44 px-2 py-2 align-top font-medium">{row.bank_alias || row.bank || '—'}</td>
                  <td className="max-w-32 px-2 py-2 align-top">{row.from_bank_alias || '—'}</td>
                  <td className="max-w-32 px-2 py-2 align-top">{row.to_bank_alias || '—'}</td>
                  <td className="max-w-40 px-2 py-2 align-top">{row.customer_supplier || '—'}</td>
                  <td className="px-2 py-2 align-top">{humanize(row.document_type)}</td>
                  <td className="px-2 py-2 align-top">{humanize(row.current_category)}</td>
                  <td className="max-w-44 px-2 py-2 align-top">{row.current_gl_account || '—'}</td>
                  <td className="max-w-80 px-2 py-2 align-top text-gray-700">{row.problem}</td>
                  <td className="px-2 py-2 align-top"><span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{row.status}</span></td>
                  <td className="px-2 py-2 align-top"><button type="button" onClick={() => toggleExpanded(row)} className="whitespace-nowrap rounded-md bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700">{isExpanded ? 'Close editor' : 'Edit correction'}</button></td>
                </tr>,
                isExpanded && <tr key={`${row.row_id}:edit`} className="bg-gray-50/70">
                  <td colSpan={15} className="px-4 py-3">
                    <div className="mb-3 grid gap-2 rounded-md border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-5">
                      {[['Voucher Number',row.voucher_number],['Journal Number',row.journal_number],['Date',row.date],['Amount',formatAmount(row.amount,row.currency)],['Currency',row.currency],['Bank Alias',row.bank_alias || row.bank],['Current GL',row.current_gl_account],['Current Category',humanize(row.current_category)],['Current Subcategory',humanize(row.current_subcategory)],['Source Document',row.current_source_document]].map(([label,value]) => <div key={label}><div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div><div className="mt-0.5 break-words text-xs font-medium text-gray-800">{value || '—'}</div></div>)}
                      {row.document_type === 'fund_transfer' && <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-3 rounded bg-blue-50 px-3 py-2 font-semibold text-blue-900"><span>{row.from_bank_alias || 'From bank'}</span><span>→</span><span>{row.to_bank_alias || 'To bank'}</span></div>}
                    </div>
                    <div className="mb-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 md:grid-cols-3">
                      <div><span className="font-semibold">Business problem:</span> {row.problem}</div>
                      <div><span className="font-semibold">Why it needs review:</span> {row.why_not_automatic}</div>
                      <div><span className="font-semibold">Recommended action:</span> {row.recommended_action}</div>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {row.journal_entry_id && <a href={financeHref('journal-register',{ journal: row.journal_entry_id })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Journal <ExternalLink className="h-3 w-3" /></a>}
                      <a href={financeHref(sourceRoute(row),{ document: row.document_id })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Source document <ExternalLink className="h-3 w-3" /></a>
                      {row.current_gl_account && <a href={financeHref('ledger',{ account: row.current_gl_account.split(' · ')[0] })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Ledger <ExternalLink className="h-3 w-3" /></a>}
                      {(row.current_bank_account_id || row.bank_statement_line_id) && <a href={financeHref('bank-reconciliation',{ bank: row.current_bank_account_id, bankLine: row.bank_statement_line_id })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Bank Reconciliation <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                      {['expense','petty_cash','capital_contribution'].includes(row.document_type) && <SelectField label="Expense Category" value={edit.expense_category} onChange={value => updateEdit(row.row_id,'expense_category',value)} disabled={!canManage}>
                        {expenseCategories.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>}
                      {row.document_type === 'expense' && <SelectField label="Expense Subcategory" value={edit.expense_subcategory} onChange={value => updateEdit(row.row_id,'expense_subcategory',value)} disabled={!canManage}>
                        {expenseSubcategories.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>}
                      {['expense','payment'].includes(row.document_type) && <SelectField label="Supplier" value={edit.supplier_id} onChange={value => updateEdit(row.row_id,'supplier_id',value)} disabled={!canManage}>
                        {suppliers.map(value => <option key={value.id} value={value.id}>{value.company_name}</option>)}
                      </SelectField>}
                      {row.document_type === 'receipt' && <SelectField label="Customer" value={edit.customer_id} onChange={value => updateEdit(row.row_id,'customer_id',value)} disabled={!canManage}>
                        {customers.map(value => <option key={value.id} value={value.id}>{value.company_name}</option>)}
                      </SelectField>}
                      {['loan','capital_contribution'].includes(row.document_type) && <SelectField label="Finance Classification" value={edit.finance_classification} onChange={value => updateEdit(row.row_id,'finance_classification',value)} disabled={!canManage}>
                        {financeClassifications.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>}
                      {row.document_type === 'fund_transfer' && <SelectField label="From Bank" value={edit.from_bank_account_id} onChange={value => updateEdit(row.row_id,'from_bank_account_id',value)} disabled={!canManage}>
                        {banks.map(bank => <option key={bank.id} value={bank.id}>{bankLabel(bank)}</option>)}
                      </SelectField>}
                      {row.document_type === 'fund_transfer' && <SelectField label="To Bank" value={edit.to_bank_account_id} onChange={value => updateEdit(row.row_id,'to_bank_account_id',value)} disabled={!canManage}>
                        {banks.map(bank => <option key={bank.id} value={bank.id}>{bankLabel(bank)}</option>)}
                      </SelectField>}
                      <SelectField label="Chart of Accounts" value={edit.account_id} onChange={value => updateEdit(row.row_id,'account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {coa.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>
                      <SelectField label="Bank Account" value={edit.bank_account_id} onChange={value => updateEdit(row.row_id,'bank_account_id',value)} disabled={!canManage}>
                        {banks.map(bank => <option key={bank.id} value={bank.id}>{bankLabel(bank)}</option>)}
                      </SelectField>
                      {['loan','loan_transaction','loan_repayment'].includes(row.document_type) && <SelectField label="Loan Account" value={edit.loan_account_id} onChange={value => updateEdit(row.row_id,'loan_account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {loanAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>}
                      {row.document_type === 'capital_contribution' && <SelectField label="Capital Account" value={edit.capital_account_id} onChange={value => updateEdit(row.row_id,'capital_account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {capitalAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>}
                      {['expense','payment','tax_payment','sales_invoice','purchase_invoice'].includes(row.document_type) && <SelectField label="Tax Category" value={edit.tax_code_id} onChange={value => updateEdit(row.row_id,'tax_code_id',value)} disabled={!canManage}>
                        {taxCodes.map(tax => <option key={tax.id} value={tax.id}>{tax.code} — {tax.name} ({tax.rate}%)</option>)}
                      </SelectField>}
                      {['expense','receipt','payment','bank_reconciliation'].includes(row.document_type) && <SelectField label="Payment Type" value={edit.payment_type} onChange={value => updateEdit(row.row_id,'payment_type',value)} disabled={!canManage}>
                        {paymentTypes.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>}
                      <SelectField label="Document Classification" value={edit.document_classification} onChange={value => updateEdit(row.row_id,'document_classification',value)} disabled={!canManage || !row.journal_entry_id}>
                        {documentClassifications.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>
                      {row.document_type === 'bank_reconciliation' && <SelectField label="Correct Linked Document / Journal" value={edit.linked_document_id ? `${edit.linked_document_type}:${edit.linked_document_id}` : ''} onChange={value => { const separator=value.indexOf(':'); updateEdit(row.row_id,'linked_document_type',separator > 0 ? value.slice(0,separator) : ''); updateEdit(row.row_id,'linked_document_id',separator > 0 ? value.slice(separator+1) : ''); }} disabled={!canManage || loadingLinks === row.row_id}>
                        {(linkOptions[row.row_id] ?? []).map(option => <option key={`${option.type}:${option.id}`} value={`${option.type}:${option.id}`}>{option.label}</option>)}
                      </SelectField>}
                    </div>
                    <div className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
                      {['expense','receipt','payment'].includes(row.document_type) && <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Reference</span><input value={edit.reference ?? ''} onChange={event => updateEdit(row.row_id,'reference',event.target.value)} disabled={!canManage} placeholder={row.current_reference || 'No change'} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-100" /></label>}
                      {(row.currency !== 'IDR' || /exchange rate/i.test(`${row.problem} ${row.why_not_automatic}`)) && <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Historical Exchange Rate</span><input type="number" min="0" step="0.000001" value={edit.exchange_rate ?? ''} onChange={event => updateEdit(row.row_id,'exchange_rate',event.target.value)} disabled={!canManage} placeholder={row.expense_exchange_rate?.toString() || 'No change'} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-100" /></label>}
                      {['sales_invoice','purchase_invoice'].includes(row.document_type) && <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Faktur Pajak Number</span><input value={edit.faktur_pajak_number ?? ''} onChange={event => updateEdit(row.row_id,'faktur_pajak_number',event.target.value)} disabled={!canManage} placeholder={row.current_faktur_pajak_number || 'No change'} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-100" /></label>}
                    </div>
                  </td>
                </tr>
              ];
            })}
            {!filteredRows.length && <tr><td colSpan={15} className="px-4 py-16 text-center text-sm text-emerald-700">{rows.length ? 'No exceptions match the current filters.' : 'No unresolved Finance exceptions.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
