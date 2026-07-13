import { useEffect, useMemo, useState } from 'react';
import { FileText, Hash } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { TaxAttachments } from './TaxAttachments';

interface SalesInvoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  tax_amount: number | null;
  total_amount: number;
  faktur_pajak_number: string | null;
  customer_id: string | null;
}
interface Customer { id: string; name: string; }
interface FakturRow {
  id: string;
  sales_invoice_id: string;
  faktur_number: string;
  issue_date: string;
  dpp_amount: number;
  ppn_amount: number;
  status: string;
}

const FAKTUR_KINDS = [
  { value: 'pdf', label: 'PDF Faktur' },
  { value: 'xml', label: 'XML' },
  { value: 'csv', label: 'CSV' },
  { value: 'other', label: 'Other' },
] as const;

export function FakturPajakPanel() {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [fakturs, setFakturs] = useState<Record<string, FakturRow>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const { data: inv } = await supabase
      .from('sales_invoices')
      .select('id, invoice_number, invoice_date, tax_amount, total_amount, faktur_pajak_number, customer_id')
      .gt('tax_amount', 0)
      .order('invoice_date', { ascending: false })
      .limit(200);
    const invoices = (inv as SalesInvoice[] | null) ?? [];
    setInvoices(invoices);

    const custIds = Array.from(new Set(invoices.map(i => i.customer_id).filter(Boolean))) as string[];
    if (custIds.length) {
      const { data: cs } = await supabase.from('customers').select('id, name').in('id', custIds);
      setCustomers(Object.fromEntries(((cs as Customer[] | null) ?? []).map(c => [c.id, c.name])));
    }

    const invIds = invoices.map(i => i.id);
    if (invIds.length) {
      const { data: fs } = await supabase
        .from('faktur_pajak')
        .select('id, sales_invoice_id, faktur_number, issue_date, dpp_amount, ppn_amount, status')
        .in('sales_invoice_id', invIds);
      setFakturs(Object.fromEntries(((fs as FakturRow[] | null) ?? []).map(f => [f.sales_invoice_id, f])));
    }
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);

  const withoutFaktur = useMemo(
    () => invoices.filter(i => !i.faktur_pajak_number || i.faktur_pajak_number === ''),
    [invoices]
  );

  async function generateFor(invoiceId: string) {
    setBusyId(invoiceId);
    try {
      const { error } = await supabase.rpc('assign_faktur_pajak_number', { p_sales_invoice_id: invoiceId });
      if (error) throw error;
      await refresh();
    } catch (err) {
      alert('Failed to generate Faktur Pajak: ' + (err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function markStatus(fakturRowId: string, status: 'uploaded' | 'reported') {
    const { error } = await supabase.from('faktur_pajak').update({ status, reported_at: status === 'reported' ? new Date().toISOString() : null }).eq('id', fakturRowId);
    if (error) alert(error.message);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" /> Faktur Pajak — Sales Invoices with PPN
        </h3>
        <span className="text-xs text-gray-500">{withoutFaktur.length} invoice(s) missing Faktur Pajak</span>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-gray-500">No sales invoices with PPN in the last 200 records.</p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Invoice #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Customer</th>
                <th className="text-right px-3 py-2">DPP</th>
                <th className="text-right px-3 py-2">PPN</th>
                <th className="text-left px-3 py-2">Faktur #</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const fak = fakturs[inv.id];
                return (
                  <tr key={inv.id} className={`border-t ${selected === inv.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2 font-medium">{inv.invoice_number}</td>
                    <td className="px-3 py-2">{inv.invoice_date}</td>
                    <td className="px-3 py-2">{inv.customer_id ? (customers[inv.customer_id] ?? '—') : '—'}</td>
                    <td className="px-3 py-2 text-right">{Number((inv.total_amount ?? 0) - (inv.tax_amount ?? 0)).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 text-right">{Number(inv.tax_amount ?? 0).toLocaleString('id-ID')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{inv.faktur_pajak_number ?? '—'}</td>
                    <td className="px-3 py-2">
                      {fak ? (
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          fak.status === 'reported' ? 'bg-green-100 text-green-800' :
                          fak.status === 'uploaded' ? 'bg-blue-100 text-blue-800' :
                                                     'bg-gray-100 text-gray-700'
                        }`}>{fak.status}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      {!inv.faktur_pajak_number && (
                        <button
                          onClick={() => void generateFor(inv.id)}
                          disabled={busyId === inv.id}
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-50 inline-flex items-center gap-1"
                        >
                          <Hash className="w-3 h-3" />
                          {busyId === inv.id ? '…' : 'Generate #'}
                        </button>
                      )}
                      {fak && (
                        <>
                          <button
                            onClick={() => setSelected(inv.id === selected ? null : inv.id)}
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                          >
                            Files
                          </button>
                          {fak.status !== 'reported' && (
                            <button
                              onClick={() => void markStatus(fak.id, fak.status === 'generated' ? 'uploaded' : 'reported')}
                              className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                            >
                              → {fak.status === 'generated' ? 'Uploaded' : 'Reported'}
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && fakturs[selected] && (
        <div className="border rounded p-4 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Attachments · Faktur {fakturs[selected].faktur_number}</h4>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-500">Close</button>
          </div>
          <TaxAttachments
            table="faktur_pajak_files"
            parentId={fakturs[selected].id}
            storagePrefix="faktur_pajak"
            allowedKinds={FAKTUR_KINDS}
          />
        </div>
      )}
    </div>
  );
}
