import { useEffect, useMemo, useState } from 'react';
import { Plus, Download, Trash2, Pencil, Receipt, Wallet, CheckCircle2, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { TaxAttachments } from './TaxAttachments';
import { sanitizeExportRows } from '../../../utils/csvSafe';
import { FinanceModal as Modal } from '../FinanceModal';
import { StatCard, StatCardGrid, SectionCard, StatusChip, EmptyState } from './TaxUI';

interface Period {
  id: string;
  fiscal_year: number;
  period_month: number;
  tax_type: string;
  status: string;
}
interface BankAccount {
  id: string;
  account_name: string;
  bank_name: string;
  alias: string | null;
  currency: string | null;
}
interface Payment {
  id: string;
  tax_period_id: string;
  tax_type: string;
  payment_date: string;
  amount: number;
  billing_code: string | null;
  ntpn: string | null;
  payment_reference: string | null;
  government_reference: string | null;
  status: string;
  journal_entry_id: string | null;
  bank_account_id: string | null;
  notes: string | null;
}

const KINDS = [
  { value: 'billing_code',        label: 'Billing Code (Kode Billing)' },
  { value: 'ntpn',                label: 'NTPN receipt' },
  { value: 'government_receipt',  label: 'Government receipt' },
  { value: 'bank_transfer_proof', label: 'Bank transfer proof' },
  { value: 'other',               label: 'Other' },
] as const;

function bankLabel(b: BankAccount): string {
  return b.alias || `${b.bank_name} - ${b.account_name}`;
}

export function TaxPaymentsPanel() {
  const { dateRange } = useFinance();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [bslPickerPayment, setBslPickerPayment] = useState<Payment | null>(null);
  const [bslCandidates, setBslCandidates] = useState<any[]>([]);
  const [bslPickerLoading, setBslPickerLoading] = useState(false);
  const [bslLinking, setBslLinking] = useState(false);

  const emptyForm = {
    tax_period_id: '',
    tax_type: 'PPN',
    payment_date: new Date().toISOString().slice(0, 10),
    amount: '',
    bank_account_id: '',
    billing_code: '',
    ntpn: '',
    payment_reference: '',
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);

  async function refresh() {
    setLoading(true);
    const [p, b, tp] = await Promise.all([
      supabase.from('tax_periods')
        .select('id, fiscal_year, period_month, tax_type, status')
        .order('fiscal_year', { ascending: false })
        .order('period_month', { ascending: false }),
      supabase.from('bank_accounts')
        .select('id, account_name, bank_name, alias, currency')
        .eq('is_active', true)
        .order('alias', { nullsFirst: false })
        .order('account_name'),
      supabase.from('tax_payments')
        .select('id, tax_period_id, tax_type, payment_date, amount, billing_code, ntpn, payment_reference, government_reference, status, journal_entry_id, bank_account_id, notes')
        .order('payment_date', { ascending: false })
        .limit(500),
    ]);
    setPeriods((p.data as Period[] | null) ?? []);
    setBanks((b.data as BankAccount[] | null) ?? []);
    setPayments((tp.data as Payment[] | null) ?? []);
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);

  const openPeriods = useMemo(
    () => periods.filter(p => p.status !== 'closed' && p.tax_type === form.tax_type),
    [periods, form.tax_type]
  );

  const filteredPayments = useMemo(() => {
    if (!dateRange?.startDate || !dateRange?.endDate) return payments;
    return payments.filter(p => p.payment_date >= dateRange.startDate && p.payment_date <= dateRange.endDate);
  }, [payments, dateRange]);

  const bankById = useMemo(() => {
    const map = new Map<string, BankAccount>();
    for (const b of banks) map.set(b.id, b);
    return map;
  }, [banks]);

  const periodLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of periods) map.set(p.id, `${p.fiscal_year}-${String(p.period_month).padStart(2,'0')}`);
    return map;
  }, [periods]);

  const totals = useMemo(() => {
    let total = 0, reconciled = 0, pending = 0;
    for (const p of filteredPayments) {
      total += Number(p.amount ?? 0);
      if (p.status === 'reconciled') reconciled += Number(p.amount ?? 0);
      else pending += Number(p.amount ?? 0);
    }
    return { total, reconciled, pending, count: filteredPayments.length };
  }, [filteredPayments]);

  function startEdit(p: Payment) {
    setEditingId(p.id);
    setForm({
      tax_period_id: p.tax_period_id,
      tax_type: p.tax_type,
      payment_date: p.payment_date,
      amount: String(p.amount),
      bank_account_id: p.bank_account_id ?? '',
      billing_code: p.billing_code ?? '',
      ntpn: p.ntpn ?? '',
      payment_reference: p.payment_reference ?? '',
      notes: p.notes ?? '',
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tax_period_id || !form.bank_account_id || !form.amount) {
      alert('Period, bank account and amount are required.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.rpc('update_tax_payment', {
          p_id: editingId,
          p_payment_date: form.payment_date,
          p_amount: Number(form.amount),
          p_bank_account_id: form.bank_account_id,
          p_billing_code: form.billing_code || null,
          p_ntpn: form.ntpn || null,
          p_government_reference: null,
          p_notes: form.notes || null,
          p_payment_reference: form.payment_reference || null,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc('record_tax_payment', {
          p_tax_period_id: form.tax_period_id,
          p_tax_type: form.tax_type,
          p_payment_date: form.payment_date,
          p_amount: Number(form.amount),
          p_bank_account_id: form.bank_account_id,
          p_billing_code: form.billing_code || null,
          p_ntpn: form.ntpn || null,
          p_government_reference: null,
          p_notes: form.notes || null,
          p_payment_reference: form.payment_reference || null,
        });
        if (error) throw error;
        const newId = data as string;
        await refresh();
        cancelForm();
        // After refresh, open BSL picker for the newly created payment
        const { data: newPmt } = await supabase
          .from('tax_payments')
          .select('id, tax_type, payment_date, amount, bank_account_id, journal_entry_id, status, billing_code, ntpn, payment_reference, notes, tax_period_id')
          .eq('id', newId)
          .maybeSingle();
        if (newPmt) void openBslPicker(newPmt as Payment);
        return;
      }
      await refresh();
      cancelForm();
    } catch (err) {
      alert((editingId ? 'Failed to update' : 'Failed to record') + ' tax payment: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function del(p: Payment) {
    if (!confirm(`Delete ${p.tax_type} tax payment of Rp ${Number(p.amount).toLocaleString('id-ID')} on ${p.payment_date}?\n\nThis reverses the journal entry, releases any bank reconciliation match, and removes attachments. The delete is safe: any orphan will abort the operation.`)) return;
    setBusyDeleteId(p.id);
    try {
      const { error } = await supabase.rpc('delete_tax_payment', { p_id: p.id });
      if (error) throw error;
      if (selected?.id === p.id) setSelected(null);
      await refresh();
    } catch (err) {
      alert('Failed to delete tax payment: ' + (err as Error).message);
    } finally {
      setBusyDeleteId(null);
    }
  }

  async function openBslPicker(p: Payment) {
    setBslPickerPayment(p);
    setBslCandidates([]);
    setBslPickerLoading(true);
    try {
      // Match the Expense picker pattern (loadUnlinkedBankTransactions):
      // no hard date filter. Bank clearing routinely lags tax payments by
      // more than the previous ±7-day window, hiding the correct BSL row
      // and forcing users to drop into raw SQL. Instead we take every
      // fully-unmatched debit row on the same bank account, sort by
      // proximity to the payment_date, and rank exact-amount matches first.
      let q = supabase
        .from('bank_statement_lines')
        .select('id, transaction_date, description, debit_amount, bank_account_id')
        .is('matched_tax_payment_id', null)
        .is('matched_expense_id', null)
        .is('matched_receipt_id', null)
        .is('matched_petty_cash_id', null)
        .is('matched_fund_transfer_id', null)
        .is('matched_entry_id', null)
        .eq('reconciliation_status', 'unmatched')
        .gt('debit_amount', 0)
        .order('transaction_date', { ascending: false })
        .limit(200);

      if (p.bank_account_id) q = q.eq('bank_account_id', p.bank_account_id);

      const { data } = await q;
      const amount = Number(p.amount);
      const payDate = new Date(p.payment_date).getTime();
      const scored = (data ?? []).map((b: any) => ({
        row: b,
        amountDiff: Math.abs(Number(b.debit_amount) - amount),
        dateDiff: Math.abs(new Date(b.transaction_date).getTime() - payDate),
      }));
      scored.sort((a, b) => {
        // Exact-amount matches first, then closest date.
        const aExact = a.amountDiff < 1 ? 0 : 1;
        const bExact = b.amountDiff < 1 ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        if (a.dateDiff !== b.dateDiff) return a.dateDiff - b.dateDiff;
        return a.amountDiff - b.amountDiff;
      });
      setBslCandidates(scored.slice(0, 50).map(s => s.row));
    } catch (err) {
      console.error('Error fetching BSL candidates:', err);
    } finally {
      setBslPickerLoading(false);
    }
  }

  async function linkBsl(bslId: string) {
    if (!bslPickerPayment?.journal_entry_id) {
      alert('❌ Tax payment has no journal entry. Record it again if needed.');
      return;
    }
    setBslLinking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('bank_statement_lines')
        .update({
          reconciliation_status: 'matched',
          matched_tax_payment_id: bslPickerPayment.id,
          matched_entry_id: bslPickerPayment.journal_entry_id,
          matched_at: new Date().toISOString(),
          matched_by: user.id,
          manually_unlinked: false,
          notes: `Linked to tax payment: ${bslPickerPayment.tax_type} ${bslPickerPayment.payment_date}`,
        })
        .eq('id', bslId);
      if (error) throw error;
      setBslPickerPayment(null);
      setBslCandidates([]);
      await refresh();
      alert('Bank statement linked. Tax payment status updated to Reconciled.');
    } catch (err: any) {
      alert('Error linking bank statement: ' + err.message);
    } finally {
      setBslLinking(false);
    }
  }

  function exportExcel() {
    const rows = filteredPayments.map(p => ({
      'Date': p.payment_date,
      'Tax Type': p.tax_type,
      'Period': periodLabelById.get(p.tax_period_id) ?? '',
      'Bank': p.bank_account_id ? (bankById.get(p.bank_account_id) ? bankLabel(bankById.get(p.bank_account_id)!) : '—') : '—',
      'Amount (Rp)': Number(p.amount),
      'NTPN': p.ntpn ?? '',
      'Billing Code': p.billing_code ?? '',
      'Payment Ref': p.payment_reference ?? '',
      'Status': p.status,
      'JE #': p.journal_entry_id ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(sanitizeExportRows(rows));
    ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 36 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tax Payments');
    XLSX.writeFile(wb, `Tax_Payments_${dateRange.startDate}_${dateRange.endDate}.xlsx`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold">Tax Payments</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 hidden md:inline">
            {dateRange?.startDate ?? '—'} → {dateRange?.endDate ?? '—'}
          </span>
          <button
            onClick={exportExcel}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={() => { if (showForm) cancelForm(); else setShowForm(true); }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Record Tax Payment
          </button>
        </div>
      </div>

      <Modal
        isOpen={showForm}
        onClose={cancelForm}
        title={editingId ? 'Edit Tax Payment' : 'Record Tax Payment'}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={submit} className="space-y-3">
          {editingId && (
            <p className="text-xs text-blue-800 font-medium">
              Editing existing tax payment — this reverses the current journal entry and posts a fresh one.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              Tax Type
              <select
                value={form.tax_type}
                onChange={e => setForm(f => ({ ...f, tax_type: e.target.value, tax_period_id: editingId ? f.tax_period_id : '' }))}
                className="mt-1 w-full border rounded px-2 py-1.5 disabled:bg-gray-100"
                disabled={!!editingId}
              >
                {(['PPN','PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'] as const).map(t => (
                  <option key={t} value={t}>
                    {t === 'PPh21' ? 'PPh21 (Manual)' : t === 'PPh_Unifikasi' ? 'PPh Unifikasi (Consolidated)' : t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Tax Period
              <select
                value={form.tax_period_id}
                onChange={e => setForm(f => ({ ...f, tax_period_id: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5 disabled:bg-gray-100"
                required
                disabled={!!editingId}
              >
                <option value="">— select —</option>
                {openPeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fiscal_year}-{String(p.period_month).padStart(2,'0')} ({p.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Payment Date
              <input
                type="date"
                value={form.payment_date}
                onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                required
              />
            </label>
            <label className="text-sm">
              Amount (Rp)
              <input
                type="number" step="0.01" min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                required
              />
            </label>
            <label className="text-sm">
              Bank Account
              <select
                value={form.bank_account_id}
                onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                required
              >
                <option value="">— select —</option>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>
                    {bankLabel(b)}{b.currency ? ` (${b.currency})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Billing Code (Kode Billing)
              <input
                value={form.billing_code}
                onChange={e => setForm(f => ({ ...f, billing_code: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                placeholder="e.g. 820260713000123"
              />
            </label>
            <label className="text-sm">
              NTPN
              <input
                value={form.ntpn}
                onChange={e => setForm(f => ({ ...f, ntpn: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                placeholder="16-char DJP reference"
              />
            </label>
            <label className="text-sm">
              Payment Reference
              <input
                value={form.payment_reference}
                onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                placeholder="Bank transfer reference"
              />
            </label>
            <label className="text-sm md:col-span-3">
              Notes
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
              />
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={cancelForm} className="px-3 py-1.5 text-sm border rounded">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (editingId ? 'Updating…' : 'Posting…') : (editingId ? 'Update & Repost' : 'Post & Journal')}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Posts <b>Dr Tax Payable · Cr Bank</b> via the shared journal engine. The resulting entry
            appears in Bank Reconciliation and auto-flips this payment to "reconciled" once matched.
          </p>
        </form>
      </Modal>

      {!loading && filteredPayments.length > 0 && (
        <StatCardGrid cols={4}>
          <StatCard label="Payments" value={totals.count} money={false} tone="blue" icon={<Receipt className="w-4 h-4" />} />
          <StatCard label="Total paid" value={totals.total} tone="green" icon={<Wallet className="w-4 h-4" />} />
          <StatCard label="Reconciled" value={totals.reconciled} tone="green" icon={<CheckCircle2 className="w-4 h-4" />} />
          <StatCard label="Awaiting reconcile" value={totals.pending} tone={totals.pending > 0 ? 'orange' : 'gray'} icon={<Clock className="w-4 h-4" />} />
        </StatCardGrid>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filteredPayments.length === 0 ? (
        <SectionCard><EmptyState icon={<Receipt className="w-6 h-6" />} title="No tax payments in the selected date range" hint="Record a tax payment with the button above, or widen the date range." /></SectionCard>
      ) : (
        <SectionCard>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Bank</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">NTPN / Billing / Ref</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map(p => {
                const bank = p.bank_account_id ? bankById.get(p.bank_account_id) : null;
                return (
                  <tr key={p.id} className={`border-t ${selected?.id === p.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2">{p.payment_date}</td>
                    <td className="px-3 py-2">{p.tax_type}</td>
                    <td className="px-3 py-2">{periodLabelById.get(p.tax_period_id) ?? '—'}</td>
                    <td className="px-3 py-2">{bank ? bankLabel(bank) : '—'}</td>
                    <td className="px-3 py-2 text-right">Rp {Number(p.amount).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.ntpn && <div><span className="text-gray-400">NTPN:</span> {p.ntpn}</div>}
                      {p.billing_code && <div><span className="text-gray-400">Billing:</span> {p.billing_code}</div>}
                      {p.payment_reference && <div><span className="text-gray-400">Ref:</span> {p.payment_reference}</div>}
                      {!p.ntpn && !p.billing_code && !p.payment_reference && '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span title={p.status === 'posted' ? 'Awaiting bank reconciliation — use "Link Bank Stmt" to match' : undefined}>
                        <StatusChip status={p.status} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      <button
                        onClick={() => setSelected(p.id === selected?.id ? null : p)}
                        className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                        title="Attachments"
                      >
                        Files
                      </button>
                      {p.status === 'posted' && p.journal_entry_id && (
                        <button
                          onClick={() => void openBslPicker(p)}
                          className="text-xs px-2 py-1 border rounded hover:bg-purple-50 text-purple-700 border-purple-200 inline-flex items-center gap-1"
                          title="Link a bank statement line to reconcile this payment"
                        >
                          Link Bank Stmt
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(p)}
                        disabled={p.status === 'reconciled'}
                        className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        title={p.status === 'reconciled' ? 'Unmatch in Bank Reconciliation first (admin can override)' : 'Edit — reverses & reposts JE'}
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <button
                        onClick={() => void del(p)}
                        disabled={busyDeleteId === p.id}
                        className="text-xs px-2 py-1 border rounded hover:bg-red-50 text-red-600 disabled:opacity-40 inline-flex items-center gap-1"
                        title="Delete — reverses JE and releases bank reconciliation"
                      >
                        <Trash2 className="w-3 h-3" />
                        {busyDeleteId === p.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </SectionCard>
      )}

      {selected && (
        <div className="border rounded p-4 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Attachments · {selected.tax_type} · {selected.payment_date}</h4>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-500">Close</button>
          </div>
          <TaxAttachments
            table="tax_payment_files"
            parentId={selected.id}
            storagePrefix="tax_payments"
            allowedKinds={KINDS}
          />
        </div>
      )}

      <Modal
        isOpen={!!bslPickerPayment}
        onClose={() => setBslPickerPayment(null)}
        title="Link Bank Statement Line"
        maxWidth="max-w-lg"
      >
        {bslPickerPayment && (
          <div>
            <p className="text-xs text-gray-500 mb-4">
              Tax payment: <span className="font-medium text-purple-700">{bslPickerPayment.tax_type}</span> ·{' '}
              Rp {Number(bslPickerPayment.amount).toLocaleString('id-ID')} · {bslPickerPayment.payment_date}
              {bslPickerPayment.bank_account_id && bankById.get(bslPickerPayment.bank_account_id) && (
                <> · <span className="text-gray-600">{bankLabel(bankById.get(bslPickerPayment.bank_account_id)!)}</span></>
              )}
            </p>
            {bslPickerLoading ? (
              <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600" /></div>
            ) : bslCandidates.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4 border rounded-lg bg-gray-50">
                No unmatched bank statement lines available on this account.
                <div className="mt-2 text-xs text-gray-400">Import the bank statement first, then return here to link.</div>
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto border rounded-lg divide-y">
                {bslCandidates.map((b: any) => {
                  const exact = Math.abs(Number(b.debit_amount) - Number(bslPickerPayment.amount)) < 1;
                  return (
                    <button
                      key={b.id}
                      onClick={() => void linkBsl(b.id)}
                      disabled={bslLinking}
                      className={`w-full p-3 text-left hover:bg-purple-50 disabled:opacity-50 text-sm flex justify-between items-center ${exact ? 'bg-emerald-50/50' : ''}`}
                    >
                      <div>
                        <div className="font-medium text-gray-800">{b.description}</div>
                        <div className="text-xs text-gray-400">
                          {new Date(b.transaction_date).toLocaleDateString('id-ID')}
                          {exact ? <span className="ml-2 text-emerald-700 font-medium">Exact amount</span> : null}
                        </div>
                      </div>
                      <div className="font-medium text-red-600 text-sm">
                        Rp {Number(b.debit_amount).toLocaleString('id-ID')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button onClick={() => setBslPickerPayment(null)} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">
                Skip for now
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
