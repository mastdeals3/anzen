import { useEffect, useMemo, useState } from 'react';
import { Plus, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../lib/supabase';
import { useFinance } from '../../../contexts/FinanceContext';
import { TaxAttachments } from './TaxAttachments';
import { sanitizeExportRows } from '../../../utils/csvSafe';

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

  const [form, setForm] = useState({
    tax_period_id: '',
    tax_type: 'PPN',
    payment_date: new Date().toISOString().slice(0, 10),
    amount: '',
    bank_account_id: '',
    billing_code: '',
    ntpn: '',
    payment_reference: '',
    notes: '',
  });

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tax_period_id || !form.bank_account_id || !form.amount) {
      alert('Period, bank account and amount are required.');
      return;
    }
    setSaving(true);
    try {
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
      await refresh();
      const newId = data as string;
      const created = payments.find(p => p.id === newId) ?? null;
      setSelected(created);
      setShowForm(false);
      setForm(f => ({ ...f, amount: '', billing_code: '', ntpn: '', payment_reference: '', notes: '' }));
    } catch (err) {
      alert('Failed to record tax payment: ' + (err as Error).message);
    } finally {
      setSaving(false);
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
            onClick={() => setShowForm(v => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> Record Tax Payment
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={submit} className="border rounded p-4 space-y-3 bg-blue-50/40">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              Tax Type
              <select
                value={form.tax_type}
                onChange={e => setForm(f => ({ ...f, tax_type: e.target.value, tax_period_id: '' }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
              >
                {['PPN','PPh21','PPh22','PPh23','PPh4(2)','PPh_Unifikasi'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Tax Period
              <select
                value={form.tax_period_id}
                onChange={e => setForm(f => ({ ...f, tax_period_id: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
                required
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
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm border rounded">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Posting…' : 'Post & Journal'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Posts <b>Dr Tax Payable · Cr Bank</b> via the shared journal engine. The resulting entry
            appears in Bank Reconciliation and auto-flips this payment to "reconciled" once matched.
          </p>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto border rounded">
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
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        p.status === 'reconciled' ? 'bg-green-100 text-green-800' :
                        p.status === 'posted'     ? 'bg-blue-100 text-blue-800' :
                                                    'bg-gray-100 text-gray-700'
                      }`}>{p.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setSelected(p.id === selected?.id ? null : p)}
                        className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                      >
                        Files
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredPayments.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500 text-sm">No tax payments in the selected date range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
