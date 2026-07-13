import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { TaxAttachments } from './TaxAttachments';

interface Period {
  id: string;
  fiscal_year: number;
  period_month: number;
  tax_type: string;
  status: string;
}
interface BankAccount { id: string; account_name: string; bank_name: string; }
interface Payment {
  id: string;
  tax_period_id: string;
  tax_type: string;
  payment_date: string;
  amount: number;
  billing_code: string | null;
  ntpn: string | null;
  status: string;
  journal_entry_id: string | null;
}

const KINDS = [
  { value: 'billing_code',        label: 'Billing Code / SSE' },
  { value: 'ntpn',                label: 'NTPN receipt' },
  { value: 'government_receipt',  label: 'Government receipt' },
  { value: 'bank_transfer_proof', label: 'Bank transfer proof' },
  { value: 'other',               label: 'Other' },
] as const;

export function TaxPaymentsPanel() {
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
    government_reference: '',
    notes: '',
  });

  async function refresh() {
    setLoading(true);
    const [p, b, tp] = await Promise.all([
      supabase.from('tax_periods').select('id, fiscal_year, period_month, tax_type, status').order('fiscal_year', { ascending: false }).order('period_month', { ascending: false }),
      supabase.from('bank_accounts').select('id, account_name, bank_name').eq('is_active', true).order('account_name'),
      supabase.from('tax_payments').select('id, tax_period_id, tax_type, payment_date, amount, billing_code, ntpn, status, journal_entry_id').order('payment_date', { ascending: false }).limit(100),
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
        p_government_reference: form.government_reference || null,
        p_notes: form.notes || null,
      });
      if (error) throw error;
      await refresh();
      const newId = data as string;
      const created = payments.find(p => p.id === newId) ?? null;
      setSelected(created);
      setShowForm(false);
      setForm(f => ({ ...f, amount: '', billing_code: '', ntpn: '', government_reference: '', notes: '' }));
    } catch (err) {
      alert('Failed to record tax payment: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Tax Payments</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Record Tax Payment
        </button>
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
                type="number"
                step="0.01"
                min="0"
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
                  <option key={b.id} value={b.id}>{b.account_name} ({b.bank_name})</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Billing Code (Kode Billing)
              <input
                value={form.billing_code}
                onChange={e => setForm(f => ({ ...f, billing_code: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              NTPN
              <input
                value={form.ntpn}
                onChange={e => setForm(f => ({ ...f, ntpn: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
              />
            </label>
            <label className="text-sm">
              Gov Reference
              <input
                value={form.government_reference}
                onChange={e => setForm(f => ({ ...f, government_reference: e.target.value }))}
                className="mt-1 w-full border rounded px-2 py-1.5"
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
            Posts a journal entry (Dr Tax Payable · Cr Bank) and links via <code>journal_entry_id</code>.
            Bank Reconciliation will pick it up automatically.
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
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">NTPN / Billing</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">JE</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className={`border-t ${selected?.id === p.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-2">{p.payment_date}</td>
                  <td className="px-3 py-2">{p.tax_type}</td>
                  <td className="px-3 py-2 text-right">Rp {Number(p.amount).toLocaleString('id-ID')}</td>
                  <td className="px-3 py-2 truncate max-w-[240px]">{p.ntpn || p.billing_code || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      p.status === 'reconciled' ? 'bg-green-100 text-green-800' :
                      p.status === 'posted'     ? 'bg-blue-100 text-blue-800' :
                                                  'bg-gray-100 text-gray-700'
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{p.journal_entry_id ? p.journal_entry_id.slice(0,8) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setSelected(p)}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                    >
                      Files
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="border rounded p-4 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Attachments for {selected.tax_type} · {selected.payment_date}</h4>
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
