import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Save } from 'lucide-react';
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
}

interface CoaOption { id: string; code: string; name: string; account_type: string; account_group: string | null }
interface BankOption { id: string; bank_name: string; account_name: string; account_number: string; currency: string }
interface TaxOption { id: string; code: string; name: string; tax_type: string; rate: number }
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
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [coa, setCoa] = useState<CoaOption[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxOption[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<string[]>([]);
  const [documentClassifications, setDocumentClassifications] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [exceptionResult, coaResult, bankResult, taxResult, expenseResult, pettyResult,
        receiptResult, paymentResult, bankLineResult, journalResult] = await Promise.all([
        supabase.from('finance_exception_correction_dashboard').select('*').order('date', { ascending: true, nullsFirst: false }),
        supabase.from('chart_of_accounts').select('id,code,name,account_type,account_group').eq('is_active', true).eq('is_header', false).order('code'),
        supabase.from('bank_accounts').select('id,bank_name,account_name,account_number,currency').eq('is_active', true).order('bank_name'),
        supabase.from('tax_codes').select('id,code,name,tax_type,rate').eq('is_active', true).order('code'),
        supabase.from('finance_expenses').select('expense_category,payment_method'),
        supabase.from('petty_cash_transactions').select('expense_category'),
        supabase.from('receipt_vouchers').select('payment_method'),
        supabase.from('payment_vouchers').select('payment_method'),
        supabase.from('bank_statement_lines').select('payment_kind'),
        supabase.from('journal_entries').select('source_module'),
      ]);
      const failed = [exceptionResult, coaResult, bankResult, taxResult, expenseResult, pettyResult,
        receiptResult, paymentResult, bankLineResult, journalResult].find(result => result.error);
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

  const updateEdit = (rowId: string, field: keyof RowEdit, value: string) => {
    setEdits(current => ({ ...current, [rowId]: { ...current[rowId], [field]: value || undefined } }));
    setMessage(null);
  };

  const editedRows = useMemo(() => rows.filter(row => {
    const edit = edits[row.row_id];
    return edit && Object.values(edit).some(Boolean);
  }), [rows, edits]);

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
        exception_id: row.exception_id,
        document_type: row.document_type,
        document_id: row.document_id,
        journal_entry_id: row.journal_entry_id,
        journal_line_id: row.journal_line_id,
        ...edits[row.row_id],
      }));
      const { data, error: saveError } = await supabase.rpc('save_finance_exception_corrections', { p_corrections: corrections });
      if (saveError) throw saveError;
      const result = data as { saved?: number; resolved?: number } | null;
      setEdits({});
      setExpanded(new Set());
      setMessage(`${result?.saved ?? corrections.length} correction(s) saved. ${result?.resolved ?? 0} exception(s) resolved.`);
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
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{rows.length} unresolved</span>
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

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-[1500px] divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              {['Date','Voucher Number','Journal Number','Amount','Bank','Customer / Supplier','Document Type','Current Category','Current GL Account','Problem','Status'].map(label =>
                <th key={label} className="px-2 py-2">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {rows.map(row => {
              const isExpanded = expanded.has(row.row_id);
              const edit = edits[row.row_id] ?? {};
              return [
                <tr key={row.row_id} className={edits[row.row_id] ? 'bg-blue-50/40' : ''}>
                  <td className="px-2 py-2 align-top"><button onClick={() => setExpanded(current => { const next = new Set(current); if (isExpanded) next.delete(row.row_id); else next.add(row.row_id); return next; })} className="rounded p-0.5 hover:bg-gray-100" aria-label="Edit exception">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                  <td className="whitespace-nowrap px-2 py-2 align-top">{row.date || '—'}</td>
                  <td className="px-2 py-2 align-top font-medium text-gray-900">{row.voucher_number || '—'}</td>
                  <td className="px-2 py-2 align-top">{row.journal_number || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top">{formatAmount(row.amount, row.currency)}</td>
                  <td className="max-w-44 px-2 py-2 align-top">{row.bank || '—'}</td>
                  <td className="max-w-40 px-2 py-2 align-top">{row.customer_supplier || '—'}</td>
                  <td className="px-2 py-2 align-top">{humanize(row.document_type)}</td>
                  <td className="px-2 py-2 align-top">{humanize(row.current_category)}</td>
                  <td className="max-w-44 px-2 py-2 align-top">{row.current_gl_account || '—'}</td>
                  <td className="max-w-80 px-2 py-2 align-top text-gray-700">{row.problem}</td>
                  <td className="px-2 py-2 align-top"><span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{row.status}</span></td>
                </tr>,
                isExpanded && <tr key={`${row.row_id}:edit`} className="bg-gray-50/70">
                  <td colSpan={12} className="px-4 py-3">
                    <div className="mb-3 grid gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 md:grid-cols-3">
                      <div><span className="font-semibold">Business problem:</span> {row.problem}</div>
                      <div><span className="font-semibold">Why it needs review:</span> {row.why_not_automatic}</div>
                      <div><span className="font-semibold">Recommended action:</span> {row.recommended_action}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                      <SelectField label="Expense Category" value={edit.expense_category} onChange={value => updateEdit(row.row_id,'expense_category',value)} disabled={!canManage}>
                        {expenseCategories.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>
                      <SelectField label="Chart of Accounts" value={edit.account_id} onChange={value => updateEdit(row.row_id,'account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {coa.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>
                      <SelectField label="Bank Account" value={edit.bank_account_id} onChange={value => updateEdit(row.row_id,'bank_account_id',value)} disabled={!canManage}>
                        {banks.map(bank => <option key={bank.id} value={bank.id}>{bank.bank_name} — {bank.account_name} — {bank.currency}</option>)}
                      </SelectField>
                      <SelectField label="Loan Account" value={edit.loan_account_id} onChange={value => updateEdit(row.row_id,'loan_account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {loanAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>
                      <SelectField label="Capital Account" value={edit.capital_account_id} onChange={value => updateEdit(row.row_id,'capital_account_id',value)} disabled={!canManage || !row.journal_line_id}>
                        {capitalAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                      </SelectField>
                      <SelectField label="Tax Category" value={edit.tax_code_id} onChange={value => updateEdit(row.row_id,'tax_code_id',value)} disabled={!canManage}>
                        {taxCodes.map(tax => <option key={tax.id} value={tax.id}>{tax.code} — {tax.name} ({tax.rate}%)</option>)}
                      </SelectField>
                      <SelectField label="Payment Type" value={edit.payment_type} onChange={value => updateEdit(row.row_id,'payment_type',value)} disabled={!canManage}>
                        {paymentTypes.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>
                      <SelectField label="Document Classification" value={edit.document_classification} onChange={value => updateEdit(row.row_id,'document_classification',value)} disabled={!canManage || !row.journal_entry_id}>
                        {documentClassifications.map(value => <option key={value} value={value}>{humanize(value)}</option>)}
                      </SelectField>
                    </div>
                    <div className="mt-3 grid max-w-2xl gap-3 sm:grid-cols-2">
                      <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Historical Exchange Rate</span><input type="number" min="0" step="0.000001" value={edit.exchange_rate ?? ''} onChange={event => updateEdit(row.row_id,'exchange_rate',event.target.value)} disabled={!canManage} placeholder={row.expense_exchange_rate?.toString() || 'No change'} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-100" /></label>
                      <label className="block"><span className="mb-1 block text-[11px] font-medium text-gray-600">Faktur Pajak Number</span><input value={edit.faktur_pajak_number ?? ''} onChange={event => updateEdit(row.row_id,'faktur_pajak_number',event.target.value)} disabled={!canManage} placeholder={row.current_faktur_pajak_number || 'No change'} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs disabled:bg-gray-100" /></label>
                    </div>
                  </td>
                </tr>
              ];
            })}
            {!rows.length && <tr><td colSpan={12} className="px-4 py-16 text-center text-sm text-emerald-700">No unresolved Finance exceptions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
